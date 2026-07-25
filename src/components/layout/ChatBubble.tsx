"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import type { ChangeEvent, KeyboardEvent } from "react";
import { Icon } from "@/lib/icon-map";
import FloatingChatShell from "./chat/FloatingChatShell";
import { authHelper } from "@/lib/firebase";
import { useNotifications, OPEN_REFERENCE_EVENT } from "@/lib/notifications";
import {
  formatLeg,
  formatRouteHeader,
  cheapestPerAirline,
  cheapestFareClass,
} from "@/modules/travel-assistant/formatting/formatFlightResults";
import FlightCards, { type FlightLeg } from "./FlightCards";

interface BookingResult {
  pnr: string | null;
  holdExpiresAt: string | null;
  totalPayable: number | null;
  currency: string | null;
  screenshotUrl: string | null;
}

interface BookingState {
  jobId: string;
  status: "processing" | "success" | "failed";
  result?: BookingResult;
  error?: { message: string; detail: string | null };
}

interface DuplicateMatchInfo {
  matchScore: number;
  existingReport: {
    id: string;
    date: string;
    airline: string;
    totals: { sales: number; tickets: number; voids: number };
    savedAt: string;
  };
}

interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  hasResults?: boolean;
  legs?: FlightLeg[];
  showCards?: boolean;
  imageBlob?: Blob;
  salesReport?: { reportId: string; status: "pending" | "saved" | "discarded" };
  booking?: BookingState;
}

const SALES_REPORT_AIRLINES: { key: string; label: string; aliases: string[] }[] = [
  { key: "AERO", label: "Aero", aliases: ["aero"] },
  { key: "AIRPEACE", label: "Airpeace", aliases: ["airpeace", "air peace"] },
  { key: "IBOM", label: "Ibom", aliases: ["ibom"] },
  { key: "ARIK", label: "Arik", aliases: ["arik"] },
];

function matchSalesReportAirline(text: string): { key: string; label: string } | null {
  const t = text.toLowerCase();
  const match = SALES_REPORT_AIRLINES.find((a) => a.aliases.some((alias) => t.includes(alias)));
  return match ? { key: match.key, label: match.label } : null;
}

function detectAttachmentKind(file: File): "excel" | "image" | "other" {
  const name = file.name.toLowerCase();
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) return "excel";
  if (file.type.startsWith("image/")) return "image";
  return "other";
}

interface PendingRoundTrip {
  origin: string;
  destination: string;
  date: string;
}

interface HistoryEntry {
  referenceId: string;
  origin: string;
  destination: string;
  date: string;
  resultCount: number;
  createdAt: string;
  result: FlightLeg["result"];
}

interface ChatIdentity {
  sessionKey: string;
  displayName: string | null;
  isAuthenticated: boolean;
}

const ANON_KEY_STORAGE = "tdis_assistant_anon_key";

function getAnonSessionKey(): string {
  if (typeof window === "undefined") return "anon:server";
  let key = localStorage.getItem(ANON_KEY_STORAGE);
  if (!key) {
    key = `anon:${crypto.randomUUID()}`;
    localStorage.setItem(ANON_KEY_STORAGE, key);
  }
  return key;
}

let idCounter = 0;

function buildQuoteImagePayload(legs: FlightLeg[]) {
  const generatedAt = legs[0]?.result.searchedAt ?? new Date().toISOString();
  return {
    generatedAt,
    legs: legs.map((leg) => ({
      label: leg.label,
      origin: leg.result.query.origin,
      destination: leg.result.query.destination,
      date: leg.result.query.date,
      rows: cheapestPerAirline(leg.result.options).map((option) => {
        const fareClass = cheapestFareClass(option);
        return {
          airline: option.airline,
          fare: option.fare,
          seatStatus: option.seatStatus,
          baggage: fareClass?.baggage ?? null,
          seatsLeft: fareClass?.seatsLeft ?? null,
        };
      }),
    })),
  };
}

export default function ChatBubble() {
  const [open, setOpen] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: idCounter++,
      role: "assistant",
      text: 'Ask me for a flight quote — e.g. "Enugu ABV-LOS today" or "ABV to LOS 12th july to return 23rd". Searches Enugu Air, United Nigeria, XeJet, and Rano Air.',
    },
  ]);
  const [input, setInput] = useState<string>("");
  const [sending, setSending] = useState<boolean>(false);
  const [pending, setPending] = useState<PendingRoundTrip | null>(null);
  const [identity, setIdentity] = useState<ChatIdentity | null>(null);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [historyOpen, setHistoryOpen] = useState<boolean>(false);
  const [historyEntries, setHistoryEntries] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState<boolean>(false);
  // Set once an Excel sales-report file is attached, cleared once the user
  // names the airline (or cancels) — while set, the next typed message is
  // interpreted as an airline answer instead of a flight-search query.
  const [pendingUploadFile, setPendingUploadFile] = useState<File | null>(null);
  // Set only when the server's AirlineDetectionService returned a 70-89%
  // guess (see attemptGenerateOrDetect) — lets the next "yes" reply confirm
  // that specific guess instead of requiring the airline to be re-typed.
  const [pendingDetection, setPendingDetection] = useState<{ key: string; label: string; confidence: number } | null>(null);
  const [generatingReport, setGeneratingReport] = useState<boolean>(false);
  const [reportBusy, setReportBusy] = useState<Record<number, "saving" | "discarding" | undefined>>({});
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const greeted = useRef(false);
  // Guards the async book-on-hold poll loop from setting state after unmount.
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
    };
  }, []);
  const { setSessionKey, refresh } = useNotifications();

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  // Resolve who's chatting (logged-in Firebase user, or a stable anonymous
  // id) so the assistant can remember this session and greet accordingly.
  useEffect(() => {
    const unsubscribe = authHelper.onAuthStateChanged((user) => {
      setIdentity(
        user
          ? { sessionKey: `fb:${user.uid}`, displayName: user.displayName, isAuthenticated: true }
          : { sessionKey: getAnonSessionKey(), displayName: null, isAuthenticated: false }
      );
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (identity) setSessionKey(identity.sessionKey);
  }, [identity, setSessionKey]);

  // Fired as soon as results arrive (not waiting for the user to click
  // Share) so the image is already sitting in memory by the time they do.
  // The Web Share API only allows navigator.share() to be called
  // synchronously off a real user gesture — an await'd fetch right before
  // that call breaks "user activation" on most mobile browsers, which
  // silently fails and falls back to plain-text sharing instead of the
  // image. Pre-generating removes that fetch from the click path entirely.
  const prefetchQuoteImage = useCallback(async (id: number, legs: FlightLeg[]): Promise<void> => {
    try {
      const res = await fetch("/api/assistant/quote-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildQuoteImagePayload(legs)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      setMessages((m: ChatMessage[]) => m.map((msg) => (msg.id === id ? { ...msg, imageBlob: blob } : msg)));
    } catch (err) {
      console.error("[assistant] quote image prefetch failed:", err);
    }
  }, []);

  // Polls a Book-on-Hold job until it's terminal, updating the message the
  // "placing hold…" line is attached to. A hold is a multi-minute Playwright
  // run, so this is patient: every 4s for up to ~6 minutes.
  const pollBookingJob = useCallback((jobId: string, messageId: number): void => {
    const POLL_MS = 4000;
    const MAX_ATTEMPTS = 90; // ~6 min
    let attempts = 0;

    const setBooking = (booking: BookingState) =>
      setMessages((m: ChatMessage[]) => m.map((msg) => (msg.id === messageId ? { ...msg, booking } : msg)));

    const tick = async (): Promise<void> => {
      if (!mounted.current) return;
      attempts++;
      try {
        const res = await fetch(`/api/assistant/book-hold/${jobId}`, { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.status === "SUCCESS") {
            setBooking({ jobId, status: "success", result: data.result });
            return;
          }
          if (data.status === "FAILED") {
            setBooking({ jobId, status: "failed", error: data.error });
            return;
          }
        }
      } catch (err) {
        console.error("[assistant] booking poll failed:", err);
      }
      if (attempts >= MAX_ATTEMPTS) {
        setBooking({
          jobId,
          status: "failed",
          error: {
            message: "The hold is taking longer than expected — it may still complete. Check with an admin or try again.",
            detail: null,
          },
        });
        return;
      }
      if (mounted.current) setTimeout(tick, POLL_MS);
    };

    // First check after 3s — the run has barely started before then.
    setTimeout(tick, 3000);
  }, []);

  const sendMessage = useCallback(
    async (text: string): Promise<void> => {
      if (!text || sending) return;

      setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "user", text }]);
      setSending(true);

      try {
        const res = await fetch("/api/assistant/quote", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: text, pending, ...identity }),
        });

        if (!res.ok) {
          console.error(`[assistant] request failed: HTTP ${res.status}`);
          setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "assistant", text: describeHttpError(res.status) }]);
          setPending(null);
          return;
        }

        const data = await res.json();
        const legs: FlightLeg[] = [];
        if (data.outbound) legs.push({ label: "Outbound", result: data.outbound });
        if (data.return) legs.push({ label: "Return", result: data.return });
        if (data.result) legs.push({ label: "", result: data.result });
        const hasResults = legs.some((l) => l.result.options.length > 0);

        const bookingJobId: string | undefined = data.bookingJobId;
        const newId = idCounter++;
        setMessages((m: ChatMessage[]) => [
          ...m,
          {
            id: newId,
            role: "assistant",
            text: data.reply || "No response.",
            hasResults,
            legs,
            booking: bookingJobId ? { jobId: bookingJobId, status: "processing" } : undefined,
          },
        ]);
        setPending(data.pending ?? null);

        // A Book-on-Hold was just started — poll for the PNR/outcome.
        if (bookingJobId) pollBookingJob(bookingJobId, newId);

        // The notification itself is created server-side (durable, survives
        // reload); eagerly re-poll here just so the bell updates within a
        // second instead of waiting out the regular poll interval.
        if (hasResults) {
          refresh();
          prefetchQuoteImage(newId, legs);
        }
      } catch (err) {
        console.error("[assistant] request threw:", err);
        const reason = err instanceof Error ? err.message : String(err);
        setMessages((m: ChatMessage[]) => [
          ...m,
          {
            id: idCounter++,
            role: "assistant",
            text: `Couldn't reach the search service — check your connection and try again.${errorContactNote(reason)}`,
          },
        ]);
        setPending(null);
      } finally {
        setSending(false);
      }
    },
    [sending, pending, identity, refresh, prefetchQuoteImage, pollBookingJob]
  );

  // Builds the chat message for a successfully generated (PENDING_VERIFICATION)
  // daily report — shared by both the auto-detected and manually-named-
  // airline paths so the review UI is identical either way. Saving this
  // report automatically replaces any existing SAVED report for the same
  // airline/date server-side (see ReportGenerator.confirmReport) — no
  // separate overwrite choice needed, just an informational heads-up.
  function renderGeneratedReport(data: {
    reportId: string;
    reportText: string;
    needsReview: boolean;
    confidence: number;
    unknownStaff: string[];
    isDuplicate: boolean;
    duplicateMatch?: DuplicateMatchInfo;
  }): void {
    const needsReviewNote = data.needsReview
      ? `\n\n⚠️ Confidence ${Math.round(data.confidence * 100)}% — please double-check before saving.`
      : "";
    const unknownStaffNote =
      data.unknownStaff?.length > 0
        ? `\n\nUnrecognized staff codes (won't block saving, but worth naming in Admin → Sales Reports next time): ${data.unknownStaff.join(", ")}`
        : "";
    const duplicateNote =
      data.isDuplicate && data.duplicateMatch
        ? `\n\nℹ️ There's already a saved report for ${data.duplicateMatch.existingReport.airline} on ${data.duplicateMatch.existingReport.date} (${data.duplicateMatch.existingReport.totals.sales.toLocaleString()} in sales). Saving this will automatically replace it.`
        : "";

    setMessages((m: ChatMessage[]) => [
      ...m,
      {
        id: idCounter++,
        role: "assistant",
        text: `${data.reportText}${needsReviewNote}${unknownStaffNote}${duplicateNote}\n\nPlease verify this report. Reply Save if everything is correct, or Discard to cancel.`,
        salesReport: { reportId: data.reportId, status: "pending" },
      },
    ]);
  }

  // A monthly upload skips the review/Save step entirely server-side —
  // every date in the file is already parsed, saved, and (if it collided
  // with an existing date) superseded by the time this response comes
  // back. This just reports what happened; there's nothing left to
  // confirm or discard.
  function renderMonthlyUploadSummary(data: {
    airline: string;
    totalDatesProcessed: number;
    datesOverwritten: string[];
    totalGrandTotal: number;
    totalTickets: number;
    perDate: { reportDate: string; grandTotal: number; ticketCount: number; wasOverwrite: boolean; needsReview: boolean }[];
  }): void {
    const label = SALES_REPORT_AIRLINES.find((a) => a.key === data.airline)?.label ?? data.airline;
    const flaggedDays = data.perDate.filter((d) => d.needsReview);
    const lines = [
      `Detected a monthly ${label} report — processed ${data.totalDatesProcessed} day(s) automatically, no review needed.`,
      `Total: ${data.totalGrandTotal.toLocaleString()} across ${data.totalTickets} tickets.`,
      data.datesOverwritten.length > 0 ? `Replaced existing saved reports for: ${data.datesOverwritten.join(", ")}.` : null,
      flaggedDays.length > 0
        ? `⚠️ ${flaggedDays.length} day(s) had low-confidence parsing and may be worth a manual look: ${flaggedDays.map((d) => d.reportDate).join(", ")}.`
        : null,
    ].filter(Boolean);

    setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "assistant", text: lines.join("\n") }]);
  }

  // Manual/confirmed-airline path — used once the airline is already known,
  // either because the user typed it or confirmed a detection guess.
  async function handleGenerateReport(file: File, airlineKey: string, airlineLabel: string): Promise<void> {
    setGeneratingReport(true);
    try {
      const form = new FormData();
      form.set("airline", airlineKey);
      form.append("files", file);
      form.set("createdBy", identity?.displayName || identity?.sessionKey || "chat");
      const res = await fetch("/api/sales-reports/generate", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.isMonthly) renderMonthlyUploadSummary(data);
      else renderGeneratedReport(data);
    } catch (err) {
      console.error("[assistant] sales report generation failed:", err);
      const reason = err instanceof Error ? err.message : String(err);
      setMessages((m: ChatMessage[]) => [
        ...m,
        {
          id: idCounter++,
          role: "assistant",
          text: `Couldn't generate that report for ${airlineLabel} just now.${errorContactNote(reason)}`,
        },
      ]);
    } finally {
      setGeneratingReport(false);
    }
  }

  // First attempt: call /generate WITHOUT an airline, letting the server's
  // AirlineDetectionService decide. A confident detection (>=90%) generates
  // the report outright in one round trip; anything less comes back as a
  // 422 with the detection result, which we turn into either a quick
  // yes/no confirm (70-89%) or a from-scratch pick (<70%, or no guess at
  // all) — matching the confidence tiers the service itself defines.
  async function attemptGenerateOrDetect(file: File, inputLabel: string): Promise<void> {
    setGeneratingReport(true);
    try {
      const form = new FormData();
      form.append("files", file);
      form.set("createdBy", identity?.displayName || identity?.sessionKey || "chat");
      const res = await fetch("/api/sales-reports/generate", { method: "POST", body: form });

      if (res.status === 422) {
        const data = await res.json().catch(() => null);
        const detection = data?.detection;

        if (detection?.airline && detection.requiresConfirmation) {
          const label = SALES_REPORT_AIRLINES.find((a) => a.key === detection.airline)?.label ?? detection.airline;
          const pct = Math.round((detection.confidence ?? 0) * 100);
          setPendingUploadFile(file);
          setPendingDetection({ key: detection.airline, label, confidence: detection.confidence });
          setMessages((m: ChatMessage[]) => [
            ...m,
            {
              id: idCounter++,
              role: "assistant",
              text: `I believe this ${inputLabel} is for ${label} (${pct}% confidence). Reply "yes" to continue, name the correct airline, or "cancel".`,
            },
          ]);
          return;
        }

        setPendingUploadFile(file);
        setPendingDetection(null);
        setMessages((m: ChatMessage[]) => [
          ...m,
          {
            id: idCounter++,
            role: "assistant",
            text: `Got it — which airline is this ${inputLabel} for? Aero, Airpeace, Ibom, or Arik? (Reply "cancel" to skip this upload.)`,
          },
        ]);
        return;
      }

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (data.isMonthly) renderMonthlyUploadSummary(data);
      else renderGeneratedReport(data);
    } catch (err) {
      console.error("[assistant] sales report generation failed:", err);
      const reason = err instanceof Error ? err.message : String(err);
      setMessages((m: ChatMessage[]) => [
        ...m,
        { id: idCounter++, role: "assistant", text: `Couldn't generate that report just now.${errorContactNote(reason)}` },
      ]);
    } finally {
      setGeneratingReport(false);
    }
  }

  function handleFileSelected(e: ChangeEvent<HTMLInputElement>): void {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-selecting the same file later
    if (!file) return;

    setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "user", text: `📎 ${file.name}` }]);

    const kind = detectAttachmentKind(file);
    // Excel (.xls/.xlsx) and screenshots (images) both go through the exact
    // same flow now. Excel parses directly; screenshots are read by a
    // vision model server-side.
    if (kind === "excel" || kind === "image") {
      attemptGenerateOrDetect(file, kind === "image" ? "screenshot" : "sales report");
      return;
    }

    setMessages((m: ChatMessage[]) => [
      ...m,
      {
        id: idCounter++,
        role: "assistant",
        text: "I can process Excel sales-report exports (.xls/.xlsx) or screenshots of a report here — that file type isn't supported.",
      },
    ]);
  }

  async function saveSalesReport(m: ChatMessage): Promise<void> {
    if (!m.salesReport) return;
    setReportBusy((b) => ({ ...b, [m.id]: "saving" }));
    try {
      // The server auto-supersedes any existing SAVED report for the same
      // airline/date on its own (see ReportGenerator.confirmReport) — no
      // overwrite choice to pass here.
      const res = await fetch(`/api/sales-reports/${m.salesReport.reportId}/confirm`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ verifiedBy: identity?.displayName || identity?.sessionKey || "chat" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setMessages((msgs) => msgs.map((msg) => (msg.id === m.id ? { ...msg, salesReport: { ...msg.salesReport!, status: "saved" } } : msg)));
    } catch (err) {
      console.error("[assistant] sales report save failed:", err);
      const reason = err instanceof Error ? err.message : String(err);
      setMessages((msgs) => [
        ...msgs,
        { id: idCounter++, role: "assistant", text: `Couldn't save that report.${errorContactNote(reason)}` },
      ]);
    } finally {
      setReportBusy((b) => ({ ...b, [m.id]: undefined }));
    }
  }

  async function discardSalesReport(m: ChatMessage): Promise<void> {
    if (!m.salesReport) return;
    setReportBusy((b) => ({ ...b, [m.id]: "discarding" }));
    try {
      await fetch(`/api/sales-reports/${m.salesReport.reportId}/discard`, { method: "POST" });
    } catch (err) {
      console.error("[assistant] sales report discard failed:", err);
    } finally {
      setMessages((msgs) => msgs.map((msg) => (msg.id === m.id ? { ...msg, salesReport: { ...msg.salesReport!, status: "discarded" } } : msg)));
      setReportBusy((b) => ({ ...b, [m.id]: undefined }));
    }
  }

  function send(): void {
    const text = input.trim();
    if (!text) return;
    setInput("");

    if (pendingUploadFile) {
      const file = pendingUploadFile;
      if (/^cancel$/i.test(text)) {
        setPendingUploadFile(null);
        setPendingDetection(null);
        setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "user", text }, { id: idCounter++, role: "assistant", text: "Cancelled that upload." }]);
        return;
      }

      setMessages((m: ChatMessage[]) => [...m, { id: idCounter++, role: "user", text }]);

      // Confirming a detection guess ("yes") re-uses that guess directly
      // rather than requiring the airline to be re-typed.
      if (pendingDetection && /^(yes|y|correct|confirm)$/i.test(text)) {
        const detection = pendingDetection;
        setPendingUploadFile(null);
        setPendingDetection(null);
        handleGenerateReport(file, detection.key, detection.label);
        return;
      }

      const airline = matchSalesReportAirline(text);
      if (!airline) {
        setMessages((m: ChatMessage[]) => [
          ...m,
          { id: idCounter++, role: "assistant", text: 'I didn\'t recognize that airline — please reply Aero, Airpeace, Ibom, or Arik, or "cancel" to skip this upload.' },
        ]);
        return;
      }
      setPendingUploadFile(null);
      setPendingDetection(null);
      handleGenerateReport(file, airline.key, airline.label);
      return;
    }

    sendMessage(text);
  }

  // A notification bell click for a saved search dispatches this with the
  // reference ID — reuse the existing bare-reference-ID lookup shortcut
  // the orchestrator already supports rather than duplicating that logic.
  useEffect(() => {
    function onOpenReference(e: Event) {
      const referenceId = (e as CustomEvent<string>).detail;
      if (!referenceId) return;
      setOpen(true);
      sendMessage(referenceId);
    }
    window.addEventListener(OPEN_REFERENCE_EVENT, onOpenReference);
    return () => window.removeEventListener(OPEN_REFERENCE_EVENT, onOpenReference);
  }, [sendMessage]);

  useEffect(() => {
    if (!identity || greeted.current) return;
    greeted.current = true;
    fetch("/api/assistant/greet", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(identity),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.reply) setMessages([{ id: idCounter++, role: "assistant", text: data.reply }]);
      })
      .catch(() => {
        /* keep the default static greeting on failure */
      });
  }, [identity]);

  async function copyMessage(m: ChatMessage): Promise<void> {
    try {
      await navigator.clipboard.writeText(m.text);
      setCopiedId(m.id);
      setTimeout(() => setCopiedId((id) => (id === m.id ? null : id)), 1500);
    } catch (err) {
      console.error("[assistant] copy failed:", err);
    }
  }

  function shareTextToWhatsApp(text: string): void {
    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  function downloadImageAndOpenWhatsApp(blob: Blob): void {
    // No URL-scheme way to pre-attach an image to wa.me — download the
    // image and open WhatsApp Web/App so the user can attach it manually.
    // This is the guaranteed-delivery path: once we have a real image in
    // hand, every other path funnels back to this rather than ever
    // degrading to a plain-text message.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "tdis-flight-quote.png";
    a.click();
    URL.revokeObjectURL(url);
    window.open("https://wa.me/", "_blank", "noopener,noreferrer");
  }

  async function shareImageBlob(blob: Blob): Promise<void> {
    const file = new File([blob], "tdis-flight-quote.png", { type: "image/png" });

    // navigator.canShare (and even navigator.share itself) is inconsistent
    // across installed-PWA/WebView contexts on Android — some versions
    // throw synchronously rather than returning false for file shares, or
    // silently drop the files and would otherwise leave us with nothing.
    // Wrapping the whole check means any failure here still falls through
    // to the guaranteed image-download path below instead of propagating
    // and losing the image entirely.
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "TDIS Flight Quote" });
        return;
      }
    } catch (err) {
      // AbortError just means the user dismissed the share sheet — not a
      // failure worth falling back for.
      if (err instanceof Error && err.name === "AbortError") return;
      console.error("[assistant] navigator.share failed:", err);
    }

    downloadImageAndOpenWhatsApp(blob);
  }

  async function shareToWhatsApp(m: ChatMessage): Promise<void> {
    if (!m.legs || m.legs.length === 0) {
      shareTextToWhatsApp(m.text);
      return;
    }

    // The image is normally already prefetched (see prefetchQuoteImage) by
    // the time the user gets around to clicking Share, so this call is
    // synchronous from the click and navigator.share() still counts as
    // user-activated. Only fall back to fetching here if prefetch hasn't
    // finished yet (e.g. clicked immediately) or failed — that path may
    // not preserve the share gesture on strict mobile browsers, but it's
    // the best available fallback.
    if (m.imageBlob) {
      try {
        await shareImageBlob(m.imageBlob);
      } catch (err) {
        // We already have a valid image in hand at this point, so even an
        // unexpected failure here should still deliver the image rather
        // than degrading all the way down to a plain-text share.
        console.error("[assistant] WhatsApp image share failed unexpectedly:", err);
        downloadImageAndOpenWhatsApp(m.imageBlob);
      }
      return;
    }

    try {
      const res = await fetch("/api/assistant/quote-image", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(buildQuoteImagePayload(m.legs)),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await shareImageBlob(blob);
    } catch (err) {
      // Only reachable when image GENERATION itself failed — there's no
      // image to fall back to, so text is genuinely the last resort here.
      console.error("[assistant] WhatsApp image share failed:", err);
      shareTextToWhatsApp(m.text);
    }
  }

  function toggleCards(id: number): void {
    setMessages((m: ChatMessage[]) => m.map((msg) => (msg.id === id ? { ...msg, showCards: !msg.showCards } : msg)));
  }

  async function openHistory(): Promise<void> {
    setHistoryOpen(true);
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/assistant/history", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey: identity?.sessionKey }),
      });
      const data = await res.json();
      setHistoryEntries(data.searches ?? []);
    } catch (err) {
      console.error("[assistant] history fetch failed:", err);
      setHistoryEntries([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  function reopenSearch(entry: HistoryEntry): void {
    const legs: FlightLeg[] = [{ label: "", result: entry.result }];
    const text = `${entry.referenceId} — ${formatRouteHeader(entry.origin, entry.destination, entry.date)}\n${formatLeg(entry.result)}`;
    const newId = idCounter++;
    setMessages((m: ChatMessage[]) => [
      ...m,
      { id: newId, role: "assistant", text, hasResults: true, legs },
    ]);
    setHistoryOpen(false);
    prefetchQuoteImage(newId, legs);
  }

  // Per explicit product direction: unlike a public customer-facing bot, this
// tool's users are TDIS staff — the whole point of surfacing the actual
// reason is so it can be relayed to Muhammed (the developer) to fix, not
// hidden from them the way a stack trace would be from an end customer.
function errorContactNote(reason: string): string {
  return ` Please tell Muhammed the reason for the error, and he'll fix it: "${reason}"`;
}

function describeHttpError(status: number): string {
    if (status === 504) {
      return `That search is taking longer than expected and timed out — try narrowing it (e.g. name one airline) or try again in a moment.${errorContactNote(`HTTP 504`)}`;
    }
    if (status >= 500) {
      return `The search service hit an error on its end — try again in a moment.${errorContactNote(`HTTP ${status}`)}`;
    }
    return `That request didn't go through — try rephrasing it.${errorContactNote(`HTTP ${status}`)}`;
  }

  const headerExtras = (
    <button
      className="tdis-chat-headerbtn"
      onClick={() => (historyOpen ? setHistoryOpen(false) : openHistory())}
      aria-label={historyOpen ? "Back to conversation" : "Search history"}
      title={historyOpen ? "Back" : "Search history"}
    >
      {historyOpen ? "← Back" : "🕘"}
    </button>
  );

  return (
    <FloatingChatShell
      open={open}
      onOpen={() => setOpen(true)}
      onMinimize={() => setOpen(false)}
      title={
        <>
          <Icon name="sparkles" size={14} /> AI Operations Assistant
        </>
      }
      headerExtras={headerExtras}
    >
      {historyOpen ? (
        <div className="chat-bubble-history">
          {historyLoading ? (
            <div className="chat-bubble-history-empty">Loading…</div>
          ) : historyEntries.length === 0 ? (
            <div className="chat-bubble-history-empty">No past searches yet</div>
          ) : (
            historyEntries.map((entry) => (
              <button key={entry.referenceId} className="chat-bubble-history-item" onClick={() => reopenSearch(entry)}>
                <div className="chat-bubble-history-ref">{entry.referenceId}</div>
                <div className="chat-bubble-history-route">
                  {entry.origin} → {entry.destination} · {entry.date}
                </div>
                <div className="chat-bubble-history-meta">{entry.resultCount} result(s)</div>
              </button>
            ))
          )}
        </div>
      ) : (
        <>
            <div className="chat-bubble-messages" ref={scrollRef}>
              {messages.map((m: ChatMessage) => (
                <div id={`chat-msg-${m.id}`} key={m.id} className={`chat-bubble-msg-wrap ${m.role} ${m.showCards ? "wide" : ""}`}>
                  {m.showCards && m.legs ? (
                    <FlightCards legs={m.legs} />
                  ) : (
                    <div className={`chat-bubble-msg ${m.role}`}>{m.text}</div>
                  )}
                  {m.hasResults && (
                    <div className="chat-bubble-msg-actions">
                      <button onClick={() => copyMessage(m)}>
                        {copiedId === m.id ? "✓ Copied" : "📋 Copy"}
                      </button>
                      <button onClick={() => shareToWhatsApp(m)}>Share to WhatsApp</button>
                      <button onClick={() => toggleCards(m.id)}>{m.showCards ? "View Text" : "View Quote"}</button>
                    </div>
                  )}
                  {m.salesReport?.status === "pending" && (
                    <div className="chat-bubble-msg-actions">
                      <button onClick={() => saveSalesReport(m)} disabled={!!reportBusy[m.id]}>
                        {reportBusy[m.id] === "saving" ? "Saving…" : "Save Report"}
                      </button>
                      <button onClick={() => discardSalesReport(m)} disabled={!!reportBusy[m.id]}>
                        {reportBusy[m.id] === "discarding" ? "Discarding…" : "Discard"}
                      </button>
                    </div>
                  )}
                  {m.salesReport?.status === "saved" && (
                    <div className="chat-bubble-msg-actions">
                      <span>✓ Saved</span>
                    </div>
                  )}
                  {m.salesReport?.status === "discarded" && (
                    <div className="chat-bubble-msg-actions">
                      <span>Discarded</span>
                    </div>
                  )}
                  {m.booking?.status === "processing" && (
                    <div className="chat-bubble-msg assistant chat-bubble-typing">⏳ Placing the hold — this can take a minute or two…</div>
                  )}
                  {m.booking?.status === "success" && m.booking.result && (
                    <BookingResultCard result={m.booking.result} />
                  )}
                  {m.booking?.status === "failed" && m.booking.error && (
                    <div className="chat-bubble-msg assistant" style={{ borderLeft: "3px solid #e11d48" }}>
                      ⚠️ {m.booking.error.message}
                      {m.booking.error.detail ? errorContactNote(m.booking.error.detail) : ""}
                    </div>
                  )}
                </div>
              ))}
              {(sending || generatingReport) && (
                <div className="chat-bubble-msg assistant chat-bubble-typing">
                  {generatingReport ? "📊 Generating sales report…" : "🔍 Searching available flights…"}
                </div>
              )}
            </div>

            <div className="chat-bubble-input-row">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,image/*,application/pdf"
                style={{ display: "none" }}
                onChange={handleFileSelected}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                disabled={sending || generatingReport}
                aria-label="Attach a file"
                title="Attach a sales report, booking screenshot, or other document"
              >
                +
              </button>
              <input
                type="text"
                placeholder={
                  pendingDetection
                    ? `Yes for ${pendingDetection.label}, or name the airline…`
                    : pendingUploadFile
                    ? "Which airline? (Aero, Airpeace, Ibom, Arik)"
                    : pending
                    ? "Return date…"
                    : "Type a route and date…"
                }
                value={input}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setInput(e.target.value)}
                onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => e.key === "Enter" && send()}
                disabled={sending || generatingReport}
              />
              <button onClick={send} disabled={sending || generatingReport || !input.trim()}>
                Send
              </button>
            </div>
        </>
      )}
    </FloatingChatShell>
  );
}

// Confirmation card for a successful Book-on-Hold: PNR, hold expiry, total,
// and the captured confirmation screenshot (same-origin, click to enlarge).
function BookingResultCard({ result }: { result: BookingResult }) {
  return (
    <div
      className="chat-bubble-msg assistant"
      style={{ borderLeft: "3px solid #16a34a", display: "flex", flexDirection: "column", gap: 6 }}
    >
      <div>
        <strong>✅ Hold confirmed</strong>
      </div>
      {result.pnr && (
        <div>
          Booking reference (PNR): <strong>{result.pnr}</strong>
        </div>
      )}
      {result.holdExpiresAt && <div>Held until: {result.holdExpiresAt}</div>}
      {result.totalPayable != null && (
        <div>
          Total payable: {result.currency ? `${result.currency} ` : ""}
          {result.totalPayable.toLocaleString()}
        </div>
      )}
      {result.screenshotUrl && (
        <a href={result.screenshotUrl} target="_blank" rel="noopener noreferrer">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={result.screenshotUrl}
            alt="Enugu Air booking confirmation"
            style={{ maxWidth: "100%", borderRadius: 6, marginTop: 4 }}
          />
        </a>
      )}
    </div>
  );
}
