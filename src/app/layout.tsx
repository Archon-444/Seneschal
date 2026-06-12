import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Seneschal",
  description:
    "Know what is due. Know who owns it. Keep the proof.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
