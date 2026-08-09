"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AirlineSessionTarget {
  code: string;
  name: string;
  url: string;
}

interface StoredSession extends AirlineSessionTarget {
  openedAt: number;
}

const STORAGE_KEY = "tdis:airline-sessions:v1";
const WINDOW_NAME_PREFIX = "tdis-airline-";

function loadStored(): StoredSession[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(sessions: StoredSession[]) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
  } catch {
    /* sessionStorage unavailable (private mode, quota) — the bar just won't survive a refresh */
  }
}

// Real external airline portals can't be embedded inside TDIS — most send
// `X-Frame-Options: SAMEORIGIN` (see AirlinesSection.tsx), which a browser
// enforces regardless of anything this app does. So "tabs" here means
// genuine separate browser tabs, tracked and re-focusable from TDIS's own
// UI, not an in-app iframe workspace.
//
// The mechanism that actually makes "click Air Peace again -> jump back to
// the exact same tab, unreloaded" work is a STABLE per-airline window NAME:
// window.open(url, name) is native browser behavior — passing the same
// name a second time re-targets/focuses the existing tab with that name
// instead of opening a duplicate. This hook's job is just tracking which
// airlines are open for the UI bar, not simulating that behavior itself.
//
// Caveat, stated plainly: a window.open() handle cannot survive a page
// reload (it's not serializable), so only the DISPLAY LIST persists
// (sessionStorage) — not a live reference. A pill clicked after a TDIS
// refresh still works correctly either way: if the named tab is still open
// in the browser, it gets refocused (browser-native, not this code); if the
// user actually closed it, a fresh tab opens under the same name. Likewise,
// closeSession() below can only force-close a tab this hook still holds a
// live handle to (opened this page-load) — otherwise it just forgets it.
export function useAirlineSessions() {
  const [sessions, setSessions] = useState<StoredSession[]>(() => loadStored());
  const [activeCode, setActiveCode] = useState<string | null>(null);
  const handlesRef = useRef<Record<string, Window | null>>({});

  useEffect(() => {
    persist(sessions);
  }, [sessions]);

  // Prune sessions the user closed manually (outside TDIS's control) once
  // the TDIS tab regains focus. Best-effort only — see the caveat above,
  // this can only see handles opened during the current page-load.
  useEffect(() => {
    function reconcile() {
      const handles = handlesRef.current;
      const closedCodes = Object.keys(handles).filter((code) => handles[code] && handles[code]!.closed);
      if (closedCodes.length === 0) return;
      closedCodes.forEach((code) => delete handles[code]);
      setSessions((prev) => prev.filter((s) => !closedCodes.includes(s.code)));
      setActiveCode((prev) => (prev && closedCodes.includes(prev) ? null : prev));
    }
    window.addEventListener("focus", reconcile);
    document.addEventListener("visibilitychange", reconcile);
    return () => {
      window.removeEventListener("focus", reconcile);
      document.removeEventListener("visibilitychange", reconcile);
    };
  }, []);

  const openOrFocus = useCallback((airline: AirlineSessionTarget) => {
    const windowName = `${WINDOW_NAME_PREFIX}${airline.code}`;
    // Must run synchronously inside the triggering click handler — calling
    // window.open() after an await/setTimeout gets blocked as a popup by
    // most browsers.
    const handle = window.open(airline.url, windowName);
    if (handle) {
      handlesRef.current[airline.code] = handle;
      handle.focus();
    }
    setActiveCode(airline.code);
    setSessions((prev) => {
      if (prev.some((s) => s.code === airline.code)) return prev; // already tracked — just refocused
      return [...prev, { ...airline, openedAt: Date.now() }];
    });
  }, []);

  const closeSession = useCallback((code: string) => {
    const handle = handlesRef.current[code];
    if (handle && !handle.closed) handle.close();
    delete handlesRef.current[code];
    setSessions((prev) => prev.filter((s) => s.code !== code));
    setActiveCode((prev) => (prev === code ? null : prev));
  }, []);

  // Structurally can't do more than this: each airline is a genuinely
  // separate browser tab that never took over the TDIS tab to begin with,
  // so there's nothing to "un-minimize" — this just clears the active
  // highlight and returns focus to the TDIS tab itself as a sane default.
  const minimizeAll = useCallback(() => {
    setActiveCode(null);
    window.focus();
  }, []);

  return { sessions, activeCode, openOrFocus, closeSession, minimizeAll };
}
