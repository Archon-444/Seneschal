import { IBM_Plex_Sans_Arabic, Zilla_Slab } from "next/font/google";

// Public secure-link pages use the Record look: Zilla Slab for titles, Public
// Sans for text, IBM Plex Mono for money and dates, IBM Plex Sans Arabic for
// the Arabic side. Self-hosted via next/font; no runtime fetch.
const zillaSlab = Zilla_Slab({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-zilla-slab",
  display: "swap",
});
const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ["arabic"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-arabic",
  display: "swap",
});

export default function LinkLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={`${zillaSlab.variable} ${plexArabic.variable} record min-h-screen bg-desk text-ink`}>
      {children}
    </div>
  );
}
