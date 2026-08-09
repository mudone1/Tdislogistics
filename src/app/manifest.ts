import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TDIS Logistics — Agent Dashboard",
    short_name: "TDIS",
    description:
      "TDIS Logistics agent operations dashboard — manage airline balances, client bookings, staff performance and payments.",
    start_url: "/",
    // "browser" (not "standalone") is deliberate — see layout.tsx's
    // appleWebApp comment. A standalone-mode installed PWA hands off any
    // link to a different origin (every airline portal) to a full-screen
    // system overlay (Android Custom Tab / iOS Safari View) with no way
    // for this app's own JS to track or switch between them. "browser"
    // mode means the home-screen icon opens TDIS in a normal browser tab
    // instead, so airline links open as genuine, switchable browser tabs —
    // trading the "no browser chrome" native-app look for real multi-tab
    // switching on mobile (same mechanism useAirlineSessions.ts already
    // relies on for desktop).
    display: "browser",
    background_color: "#ffffff",
    theme_color: "#123B58",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
