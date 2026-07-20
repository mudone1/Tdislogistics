import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import ServiceWorkerRegister from "@/components/layout/ServiceWorkerRegister";

const inter = Inter({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-inter",
  display: "swap",
});

const interTight = Inter_Tight({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-inter-tight",
  display: "swap",
});

export const metadata: Metadata = {
  title: "TDIS Logistics — Agent Dashboard",
  description:
    "TDIS Logistics agent operations dashboard — manage airline balances, client bookings, staff performance and payments.",
  robots: {
    index: false,
    follow: false,
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "TDIS",
  },
  other: {
    // Next's appleWebApp.capable only emits the newer unprefixed
    // mobile-web-app-capable tag — iOS Safari has relied on this exact
    // legacy prefixed tag for standalone/"Add to Home Screen" mode across
    // far more iOS versions, so it needs to be set explicitly alongside it.
    "apple-mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#123B58",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable}`}>
      <body>
        <ServiceWorkerRegister />
        <AppProvider>{children}</AppProvider>
      </body>
    </html>
  );
}
