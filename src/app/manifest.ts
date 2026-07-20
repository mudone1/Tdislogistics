import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TDIS Logistics — Agent Dashboard",
    short_name: "TDIS",
    description:
      "TDIS Logistics agent operations dashboard — manage airline balances, client bookings, staff performance and payments.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#123B58",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
