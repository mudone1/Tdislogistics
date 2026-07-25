"use client";

// FloatingChatShell — the window chrome around the TDIS assistant.
// ---------------------------------------------------------------
// This module is PURELY presentational: it owns the floating icon, the
// draggable/resizable/dockable window, minimize/maximize/fullscreen/restore,
// an optional always-on-top overlay via the Document Picture-in-Picture API
// (with graceful fallback), and it persists the user's layout preferences to
// localStorage. It knows NOTHING about the assistant's intelligence, prompts,
// memory, APIs, or booking engine — the conversation itself is passed in as
// `children` and rendered unchanged.

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";

type Dock = "none" | "left" | "right" | "bottom";
type Mode = "normal" | "maximized" | "fullscreen";
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Point {
  x: number;
  y: number;
}

const MIN_W = 320;
const MIN_H = 380;
const MOBILE_BP = 600;
const FAB_SIZE = 56;
const EDGE_MARGIN = 20;

const KEYS = {
  rect: "tdis_chat_rect",
  fab: "tdis_chat_fab",
  dock: "tdis_chat_dock",
  mode: "tdis_chat_mode",
};

function clamp(v: number, lo: number, hi: number): number {
  if (hi < lo) return lo;
  return Math.min(Math.max(v, lo), hi);
}

// State that mirrors to localStorage. Initial render uses `initial`; the
// stored value (if any) is loaded on mount, so this is SSR-safe.
function usePersistentState<T>(key: string, initial: T): [T, (v: T | ((p: T) => T)) => void] {
  const [value, setValue] = useState<T>(initial);
  const loaded = useRef(false);
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw != null) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore malformed/absent storage */
    }
    loaded.current = true;
  }, [key]);
  useEffect(() => {
    if (!loaded.current) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage full / unavailable — layout memory is best-effort */
    }
  }, [key, value]);
  return [value, setValue];
}

function useViewport(): { w: number; h: number } {
  const [vp, setVp] = useState({ w: 1280, h: 800 });
  useEffect(() => {
    const on = () => setVp({ w: window.innerWidth, h: window.innerHeight });
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return vp;
}

function pipSupported(): boolean {
  return typeof window !== "undefined" && "documentPictureInPicture" in window;
}

// Clone the app's stylesheets into a Picture-in-Picture document so the
// portaled conversation looks identical there.
function copyStylesInto(target: Document): void {
  for (const node of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) {
    target.head.appendChild(node.cloneNode(true));
  }
}

export interface FloatingChatShellProps {
  open: boolean;
  onOpen: () => void;
  onMinimize: () => void;
  title: ReactNode;
  /** App-specific header content (e.g. a History toggle) shown before the window controls. */
  headerExtras?: ReactNode;
  /** The conversation body (messages + input). Rendered unchanged. */
  children: ReactNode;
}

export default function FloatingChatShell({
  open,
  onOpen,
  onMinimize,
  title,
  headerExtras,
  children,
}: FloatingChatShellProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const vp = useViewport();
  const isMobile = vp.w <= MOBILE_BP;

  const [rect, setRect] = usePersistentState<Rect>(KEYS.rect, { x: 0, y: 0, w: 380, h: 560 });
  const [fab, setFab] = usePersistentState<Point | null>(KEYS.fab, null);
  const [dock, setDock] = usePersistentState<Dock>(KEYS.dock, "none");
  const [mode, setMode] = usePersistentState<Mode>(KEYS.mode, "normal");

  const [pipWin, setPipWin] = useState<Window | null>(null);
  const windowRef = useRef<HTMLDivElement>(null);
  const fabRef = useRef<HTMLButtonElement>(null);

  // Give the window a sensible bottom-right home the first time it's used
  // (only when nothing was ever stored — x/y still at their 0 default).
  useEffect(() => {
    if (!mounted || isMobile) return;
    if (rect.x === 0 && rect.y === 0) {
      const w = Math.min(rect.w, vp.w - 32);
      const h = Math.min(rect.h, vp.h - 120);
      setRect({ x: vp.w - w - 24, y: vp.h - h - 88, w, h });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted]);

  // Default FAB position: bottom-right, once we know the viewport.
  useEffect(() => {
    if (mounted && fab == null) {
      setFab({ x: vp.w - FAB_SIZE - 24, y: vp.h - FAB_SIZE - 24 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mounted, fab]);

  // Close any PiP window if the whole widget unmounts.
  useEffect(() => {
    return () => {
      if (pipWin && !pipWin.closed) pipWin.close();
    };
  }, [pipWin]);

  const geometry = computeGeometry({ isMobile, dock, mode, rect, vp });

  // ── Window dragging (via the header) ──────────────────────────────
  const onHeaderPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      if (mode === "fullscreen" || isMobile) return;
      if ((e.target as HTMLElement).closest("button")) return; // let control buttons work
      const win = windowRef.current;
      if (!win) return;
      e.preventDefault();
      const r = win.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      const ox = r.left;
      const oy = r.top;

      const move = (ev: PointerEvent) => {
        const nx = clamp(ox + (ev.clientX - sx), 0, vp.w - r.width);
        const ny = clamp(oy + (ev.clientY - sy), 0, vp.h - r.height);
        win.style.left = `${nx}px`;
        win.style.top = `${ny}px`;
        win.style.right = "auto";
        win.style.bottom = "auto";
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        const nr = win.getBoundingClientRect();
        setRect({ x: nr.left, y: nr.top, w: nr.width, h: nr.height });
        setDock("none");
        setMode("normal");
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    },
    [mode, isMobile, vp.w, vp.h, setRect, setDock, setMode]
  );

  // ── Window resizing (edge/corner handles, floating mode only) ─────
  const onResizePointerDown = useCallback(
    (e: ReactPointerEvent, dir: string) => {
      e.preventDefault();
      e.stopPropagation();
      const win = windowRef.current;
      if (!win) return;
      const r = win.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;
        let w = r.width;
        let h = r.height;
        let left = r.left;
        let top = r.top;
        if (dir.includes("e")) w = r.width + dx;
        if (dir.includes("s")) h = r.height + dy;
        if (dir.includes("w")) {
          w = r.width - dx;
          left = r.left + dx;
        }
        if (dir.includes("n")) {
          h = r.height - dy;
          top = r.top + dy;
        }
        if (w < MIN_W) {
          if (dir.includes("w")) left = r.left + (r.width - MIN_W);
          w = MIN_W;
        }
        if (h < MIN_H) {
          if (dir.includes("n")) top = r.top + (r.height - MIN_H);
          h = MIN_H;
        }
        win.style.left = `${left}px`;
        win.style.top = `${top}px`;
        win.style.width = `${w}px`;
        win.style.height = `${h}px`;
        win.style.right = "auto";
        win.style.bottom = "auto";
      };
      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        const nr = win.getBoundingClientRect();
        setRect({ x: nr.left, y: nr.top, w: nr.width, h: nr.height });
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    },
    [setRect]
  );

  // ── FAB dragging (mouse + touch), with edge-snap and click-to-open ─
  const onFabPointerDown = useCallback(
    (e: ReactPointerEvent) => {
      const btn = fabRef.current;
      if (!btn) return;

      e.preventDefault();
      e.stopPropagation();

      const r = btn.getBoundingClientRect();
      const sx = e.clientX;
      const sy = e.clientY;
      const startX = fab?.x ?? r.left;
      const startY = fab?.y ?? r.top;
      let moved = false;

      const move = (ev: PointerEvent) => {
        const dx = ev.clientX - sx;
        const dy = ev.clientY - sy;

        if (Math.abs(dx) > 6 || Math.abs(dy) > 6) {
          moved = true;
        }

        if (moved) {
          const newX = clamp(startX + dx, 0, vp.w - FAB_SIZE);
          const newY = clamp(startY + dy, 0, vp.h - FAB_SIZE);
          setFab({ x: newX, y: newY });
        }
      };

      const up = () => {
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);

        if (!moved) {
          onOpen();
          return;
        }

        // Snap to nearest vertical edge after drag
        if (fab) {
          const distToLeft = fab.x;
          const distToRight = vp.w - (fab.x + FAB_SIZE);
          const snapX =
            distToLeft < distToRight
              ? EDGE_MARGIN
              : vp.w - FAB_SIZE - EDGE_MARGIN;

          const newY = clamp(fab.y, EDGE_MARGIN, vp.h - FAB_SIZE - EDGE_MARGIN);
          setFab({ x: snapX, y: newY });
        }
      };

      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
    },
    [vp.w, vp.h, onOpen, setFab, fab]
  );

  // ── Overlay (Document Picture-in-Picture) ─────────────────────────
  const openOverlay = useCallback(async () => {
    try {
      const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow: (o: object) => Promise<Window> } })
        .documentPictureInPicture;
      if (!dpip) return;
      const pw = await dpip.requestWindow({
        width: Math.round(clamp(rect.w, MIN_W, 640)),
        height: Math.round(clamp(rect.h, MIN_H, 900)),
      });
      copyStylesInto(pw.document);
      pw.document.body.classList.add("tdis-pip-body");
      pw.addEventListener("pagehide", () => setPipWin(null));
      setPipWin(pw);
    } catch (err) {
      console.error("[chat] overlay (PiP) failed, staying in-app:", err);
    }
  }, [rect.w, rect.h]);

  const closeOverlay = useCallback(() => {
    if (pipWin && !pipWin.closed) pipWin.close();
    setPipWin(null);
  }, [pipWin]);

  const handleMinimize = useCallback(() => {
    closeOverlay();
    onMinimize();
  }, [closeOverlay, onMinimize]);

  // Esc minimizes the window.
  const onWindowKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        handleMinimize();
      }
    },
    [handleMinimize]
  );

  if (!mounted) return null;

  const showResizeHandles = !isMobile && dock === "none" && mode === "normal";
  const controls = (
    <WindowControls
      dock={dock}
      mode={mode}
      pipActive={!!pipWin}
      pipAvailable={pipSupported()}
      onDock={(d) => {
        setDock((cur) => (cur === d ? "none" : d));
        setMode("normal");
      }}
      onToggleMaximize={() => setMode((m) => (m === "maximized" ? "normal" : "maximized"))}
      onToggleFullscreen={() => setMode((m) => (m === "fullscreen" ? "normal" : "fullscreen"))}
      onOverlay={() => (pipWin ? closeOverlay() : openOverlay())}
      onMinimize={handleMinimize}
    />
  );

  // The conversation body — rendered either inside the in-app window or,
  // when overlay is active, portaled into the PiP document.
  const body = (
    <>
      <div
        className="tdis-chat-header"
        onPointerDown={pipWin ? undefined : onHeaderPointerDown}
        style={{ cursor: pipWin || isMobile || mode === "fullscreen" ? "default" : "move" }}
      >
        <span className="tdis-chat-title">{title}</span>
        <span className="tdis-chat-header-actions">
          {headerExtras}
          {!pipWin && controls}
          {pipWin && (
            <button type="button" onClick={closeOverlay} aria-label="Bring chat back into the app" title="Bring back into app">
              ⤓
            </button>
          )}
        </span>
      </div>
      {children}
    </>
  );

  return (
    <>
      {/* Floating icon (shown while minimized/closed) */}
      <AnimatePresence>
        {!open && (
          <motion.button
            ref={fabRef}
            type="button"
            className="tdis-chat-fab"
            style={{
              position: "fixed",
              left: fab?.x ?? vp.w - FAB_SIZE - 24,
              top: fab?.y ?? vp.h - FAB_SIZE - 24,
              width: FAB_SIZE,
              height: FAB_SIZE,
            }}
            onPointerDown={onFabPointerDown}
            aria-label="Open AI Operations Assistant"
            title="Click to open • Drag to move"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path
                d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z"
                fill="currentColor"
              />
              <circle cx="18.5" cy="17.5" r="1.7" fill="currentColor" />
            </svg>
          </motion.button>
        )}
      </AnimatePresence>

      {/* In-app floating window (hidden while overlay/PiP is active) */}
      <AnimatePresence>
        {open && !pipWin && (
          <motion.div
            ref={windowRef}
            className={`tdis-chat-window dock-${dock} mode-${mode}${isMobile ? " is-mobile" : ""}`}
            style={geometry}
            role="dialog"
            aria-label="AI Operations Assistant"
            tabIndex={-1}
            onKeyDown={onWindowKeyDown}
            initial={{ opacity: 0, scale: 0.96, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 12 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          >
            {body}
            {showResizeHandles &&
              ["n", "s", "e", "w", "ne", "nw", "se", "sw"].map((dir) => (
                <div
                  key={dir}
                  className={`tdis-chat-resize r-${dir}`}
                  onPointerDown={(e) => onResizePointerDown(e, dir)}
                />
              ))}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Overlay: portal the same conversation into the always-on-top PiP window */}
      {open && pipWin && createPortal(<div className="tdis-chat-pip-root">{body}</div>, pipWin.document.body)}
    </>
  );
}

function computeGeometry({
  isMobile,
  dock,
  mode,
  rect,
  vp,
}: {
  isMobile: boolean;
  dock: Dock;
  mode: Mode;
  rect: Rect;
  vp: { w: number; h: number };
}): CSSProperties {
  if (isMobile) {
    return { left: 8, top: 8, width: vp.w - 16, height: vp.h - 16, borderRadius: 14 };
  }
  if (mode === "fullscreen") {
    return { left: 0, top: 0, width: vp.w, height: vp.h, borderRadius: 0 };
  }
  if (mode === "maximized") {
    const w = Math.min(1040, vp.w - 48);
    const h = Math.min(780, vp.h - 48);
    return { left: (vp.w - w) / 2, top: (vp.h - h) / 2, width: w, height: h };
  }
  if (dock === "left") {
    return { left: 0, top: 0, width: clamp(rect.w, MIN_W, vp.w * 0.6), height: vp.h, borderRadius: 0 };
  }
  if (dock === "right") {
    const w = clamp(rect.w, MIN_W, vp.w * 0.6);
    return { left: vp.w - w, top: 0, width: w, height: vp.h, borderRadius: 0 };
  }
  if (dock === "bottom") {
    const w = clamp(rect.w, MIN_W, vp.w - 32);
    const h = clamp(rect.h, MIN_H, vp.h - 32);
    return { left: vp.w - w - 16, top: vp.h - h - 16, width: w, height: h };
  }
  const w = clamp(rect.w, MIN_W, vp.w - 16);
  const h = clamp(rect.h, MIN_H, vp.h - 16);
  return { left: clamp(rect.x, 0, vp.w - w), top: clamp(rect.y, 0, vp.h - h), width: w, height: h };
}

function WindowControls({
  dock,
  mode,
  pipActive,
  pipAvailable,
  onDock,
  onToggleMaximize,
  onToggleFullscreen,
  onOverlay,
  onMinimize,
}: {
  dock: Dock;
  mode: Mode;
  pipActive: boolean;
  pipAvailable: boolean;
  onDock: (d: Dock) => void;
  onToggleMaximize: () => void;
  onToggleFullscreen: () => void;
  onOverlay: () => void;
  onMinimize: () => void;
}) {
  return (
    <span className="tdis-chat-controls" role="group" aria-label="Window controls">
      <button
        type="button"
        className={dock === "left" ? "active" : ""}
        onClick={() => onDock("left")}
        aria-label="Dock left"
        aria-pressed={dock === "left"}
        title="Dock left"
      >
        ▏
      </button>
      <button
        type="button"
        className={dock === "bottom" ? "active" : ""}
        onClick={() => onDock("bottom")}
        aria-label="Dock to bottom corner"
        aria-pressed={dock === "bottom"}
        title="Dock bottom"
      >
        ▁
      </button>
      <button
        type="button"
        className={dock === "right" ? "active" : ""}
        onClick={() => onDock("right")}
        aria-label="Dock right"
        aria-pressed={dock === "right"}
        title="Dock right"
      >
        ▕
      </button>
      <button
        type="button"
        onClick={onToggleMaximize}
        aria-label={mode === "maximized" ? "Restore" : "Maximize"}
        aria-pressed={mode === "maximized"}
        title={mode === "maximized" ? "Restore" : "Maximize"}
      >
        {mode === "maximized" ? "❐" : "▢"}
      </button>
      <button
        type="button"
        onClick={onToggleFullscreen}
        aria-label={mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
        aria-pressed={mode === "fullscreen"}
        title={mode === "fullscreen" ? "Exit fullscreen" : "Fullscreen"}
      >
        ⛶
      </button>
      {pipAvailable && (
        <button
          type="button"
          className={pipActive ? "active" : ""}
          onClick={onOverlay}
          aria-label={pipActive ? "Close overlay" : "Pop out as overlay"}
          aria-pressed={pipActive}
          title="Overlay (stay-on-top)"
        >
          ⧉
        </button>
      )}
      <button type="button" onClick={onMinimize} aria-label="Minimize to icon" title="Minimize">
        —
      </button>
    </span>
  );
}
