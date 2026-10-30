import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Grace House School Attendance",
  description:
    "Attendance sign-in for Grace House School Saturday lessons (offline-first PWA).",
};

export const viewport: Viewport = {
  themeColor: "#1a5c46",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
