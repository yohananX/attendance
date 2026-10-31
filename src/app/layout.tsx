import type { Metadata, Viewport } from "next";
import { Geist, Source_Serif_4 } from "next/font/google";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/ServiceWorkerRegister";

const geist = Geist({
  variable: "--font-geist",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const sourceSerif4 = Source_Serif_4({
  variable: "--font-serif",
  weight: ["600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Grace House School Attendance",
  description:
    "Attendance sign-in for Grace House School Saturday lessons (offline-first PWA).",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#2e5e4e",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${geist.variable} ${sourceSerif4.variable}`}>
      <body className={geist.className}>
        <ServiceWorkerRegister />
        {children}
      </body>
    </html>
  );
}
