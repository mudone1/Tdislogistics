"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ROUTE_TO_TRAVEL_ASSISTANT_TOOL_NAME } from "@/modules/travel-assistant/ai/voiceTool";

// Genuinely new infrastructure for this codebase — every other async
// pattern here (pollBookingJob, the notification poll) is periodic
// re-fetch, not a persistent bidirectional connection. Kept self-contained
// so ChatBubble.tsx doesn't need to know anything about WebRTC/data-channel
// internals, only the { state, start, stop, toggleMute } surface below.

export type VoiceState = "idle" | "connecting" | "listening" | "speaking" | "error";

export interface UseRealtimeVoiceOptions {
  sessionKey: string | null;
  // Bridges a voice-originated request back into the existing text
  // pipeline. Must resolve to a SHORT plain-text summary suitable for the
  // model to speak (not the raw reply, which may be long/contain markup) —
  // the caller (ChatBubble) is responsible for producing that summary from
  // whatever sendMessage/dispatch actually returns.
  onToolCall: (message: string) => Promise<string>;
  // Live transcript pieces (both the user's own speech and the model's
  // spoken replies) so the UI can echo what's being heard, same as a typed
  // message would show. Optional — voice still works without it.
  onTranscript?: (role: "user" | "assistant", text: string) => void;
  // Hard cap on session length — OpenAI's own ~30 min platform cap is far
  // too generous for a small budget; this is the real cost control and is
  // enforced client-side since there's no server-side knob for a shorter
  // cap at token-mint time.
  maxDurationMs?: number;
}

export interface UseRealtimeVoiceResult {
  state: VoiceState;
  errorMessage: string | null;
  muted: boolean;
  start: () => Promise<void>;
  stop: () => void;
  toggleMute: () => void;
}

const DEFAULT_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export function useRealtimeVoice({
  sessionKey,
  onToolCall,
  onTranscript,
  maxDurationMs = DEFAULT_MAX_DURATION_MS,
}: UseRealtimeVoiceOptions): UseRealtimeVoiceResult {
  const [state, setState] = useState<VoiceState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const durationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Same guard idiom as ChatBubble's pollBookingJob — avoids setState after
  // the component (or a stop() mid-flight) has already torn things down.
  const mountedRef = useRef(true);

  const cleanup = useCallback(() => {
    if (durationTimerRef.current) {
      clearTimeout(durationTimerRef.current);
      durationTimerRef.current = null;
    }
    dcRef.current?.close();
    dcRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioElRef.current) {
      audioElRef.current.srcObject = null;
      audioElRef.current = null;
    }
  }, []);

  const stop = useCallback(() => {
    cleanup();
    if (mountedRef.current) setState("idle");
  }, [cleanup]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sendEvent = useCallback((event: Record<string, unknown>) => {
    if (dcRef.current?.readyState === "open") {
      dcRef.current.send(JSON.stringify(event));
    }
  }, []);

  const handleFunctionCall = useCallback(
    async (callId: string, argsJson: string) => {
      let message = "";
      try {
        message = (JSON.parse(argsJson) as { message?: string }).message ?? "";
      } catch {
        message = argsJson; // best-effort — speak something rather than silently drop the call
      }

      let summary: string;
      try {
        summary = await onToolCall(message);
      } catch (err) {
        console.error("[voice] onToolCall failed:", err);
        summary = "That didn't go through on this end — let the user know to try again in a moment.";
      }

      sendEvent({
        type: "conversation.item.create",
        item: { type: "function_call_output", call_id: callId, output: summary },
      });
      // A function_call_output alone does not make the model speak — this
      // second event is required (confirmed via OpenAI's own docs).
      sendEvent({ type: "response.create" });
    },
    [onToolCall, sendEvent]
  );

  const handleDataChannelMessage = useCallback(
    (raw: string) => {
      let event: Record<string, any>;
      try {
        event = JSON.parse(raw);
      } catch {
        return;
      }

      switch (event.type) {
        // Confirmed directly against OpenAI's current Realtime API docs.
        case "response.created":
          if (mountedRef.current) setState("speaking");
          break;

        case "response.done": {
          if (mountedRef.current) setState("listening");
          const output = event.response?.output ?? [];
          for (const item of output) {
            if (item?.type === "function_call" && item.name === ROUTE_TO_TRAVEL_ASSISTANT_TOOL_NAME) {
              handleFunctionCall(item.call_id, item.arguments ?? "{}");
            }
          }
          break;
        }

        // Live-transcript event names are inferred by convention, not
        // independently doc-confirmed for this API revision — if
        // transcripts don't show up, check the console.debug output below
        // for the real event type names and adjust these cases.
        case "conversation.item.input_audio_transcription.completed":
          if (typeof event.transcript === "string") onTranscript?.("user", event.transcript);
          break;
        case "response.audio_transcript.done":
        case "response.output_audio_transcript.done":
          if (typeof event.transcript === "string") onTranscript?.("assistant", event.transcript);
          break;

        case "error":
          console.error("[voice] realtime error event:", event);
          if (mountedRef.current) setErrorMessage(event.error?.message ?? "Voice session error");
          break;

        default:
          // Expected — this API surface has shifted between revisions and
          // this hook only needs the cases above. Left visible in dev
          // console (not silently swallowed) so a real gap is easy to spot.
          console.debug("[voice] event:", event.type);
      }
    },
    [handleFunctionCall, onTranscript]
  );

  const start = useCallback(async () => {
    if (!sessionKey) {
      setErrorMessage("Not ready yet — try again in a moment.");
      setState("error");
      return;
    }
    if (state === "connecting" || state === "listening" || state === "speaking") return;

    setErrorMessage(null);
    setState("connecting");

    try {
      const mintRes = await fetch("/api/assistant/voice-session", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionKey }),
      });
      const mintData = await mintRes.json().catch(() => ({}));
      if (!mintRes.ok || !mintData.clientSecret) {
        throw new Error(mintData.error || "Couldn't start voice mode");
      }
      const clientSecret: string = mintData.clientSecret;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      stream.getTracks().forEach((track) => pc.addTrack(track, stream));

      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioElRef.current = audioEl;
      pc.ontrack = (e) => {
        audioEl.srcObject = e.streams[0] ?? null;
      };

      pc.onconnectionstatechange = () => {
        if (!mountedRef.current) return;
        if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
          setErrorMessage("Voice connection dropped — switched back to text.");
          setState("error");
          cleanup();
        }
      };

      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (e) => handleDataChannelMessage(e.data);
      dc.onopen = () => {
        if (mountedRef.current) setState("listening");
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Model is already scoped into the ephemeral clientSecret at mint
      // time, so the calls endpoint doesn't need it repeated as a query
      // param — verify this holds at smoke-test time; some OpenAI examples
      // do append ?model= even with an ephemeral token.
      const sdpRes = await fetch("https://api.openai.com/v1/realtime/calls", {
        method: "POST",
        headers: {
          authorization: `Bearer ${clientSecret}`,
          "content-type": "application/sdp",
        },
        body: offer.sdp,
      });
      if (!sdpRes.ok) {
        throw new Error(`Voice connection setup failed (HTTP ${sdpRes.status})`);
      }
      const answerSdp = await sdpRes.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      durationTimerRef.current = setTimeout(() => {
        stop();
        if (mountedRef.current) {
          setErrorMessage("Voice session timed out after 5 minutes — start a new one if you need more.");
        }
      }, maxDurationMs);
    } catch (err) {
      console.error("[voice] start failed:", err);
      cleanup();
      if (mountedRef.current) {
        setErrorMessage(err instanceof Error ? err.message : "Couldn't start voice mode");
        setState("error");
      }
    }
  }, [sessionKey, state, cleanup, handleDataChannelMessage, maxDurationMs, stop]);

  const toggleMute = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      streamRef.current?.getAudioTracks().forEach((t) => {
        t.enabled = !next;
      });
      return next;
    });
  }, []);

  return { state, errorMessage, muted, start, stop, toggleMute };
}
