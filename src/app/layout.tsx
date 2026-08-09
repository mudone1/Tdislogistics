import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight } from "next/font/google";
import "./globals.css";
import { AppProvider } from "@/lib/store";
import { NotificationProvider } from "@/lib/notifications";
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
  // No appleWebApp.capable / apple-mobile-web-app-capable here, deliberately
  // — that pair is what makes an iOS home-screen launch open in standalone
  // mode (no Safari chrome), which is exactly the mode that hands off any
  // link to a different origin (every airline portal) to a full-screen
  // Safari View overlay with no way for this app's own JS to track or
  // switch between them. Leaving both unset means an iOS "Add to Home
  // Screen" icon opens TDIS in a normal Safari tab instead, matching the
  // manifest's display:"browser" (see manifest.ts) so airline links open as
  // genuine, switchable tabs there too.
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
        <NotificationProvider>
          <AppProvider>{children}</AppProvider>
        </NotificationProvider>
      </body>
    </html>
  );
}
