import type { Metadata, Viewport } from "next";
import { Amiri, Amiri_Quran, IBM_Plex_Sans_Arabic } from "next/font/google";
import "./globals.css";

// All fonts are downloaded at build time and served from this site (no font CDN at runtime).
const plexArabic = IBM_Plex_Sans_Arabic({
  variable: "--font-plex-arabic",
  subsets: ["arabic"],
  weight: ["400", "500", "600", "700"],
});

// Headings.
const amiri = Amiri({
  variable: "--font-amiri",
  subsets: ["arabic"],
  weight: ["400", "700"],
});

// Quran text only.
const amiriQuran = Amiri_Quran({
  variable: "--font-amiri-quran",
  subsets: ["arabic"],
  weight: "400",
});

export const metadata: Metadata = {
  title: "بيّنة — مسودات إجابات موثّقة للداعية",
  description: "يبحث في المصادر المعتمدة ويكتب مسودة إجابة قصيرة، كل جملة فيها مسندة إلى نصها ومُتحقَّق منها.",
};

export const viewport: Viewport = {
  themeColor: "#fbf7ef",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className={`${plexArabic.variable} ${amiri.variable} ${amiriQuran.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
