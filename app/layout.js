import "./globals.css";
import { Playfair_Display } from "next/font/google";

// Editorial serif for the brand and headings - Didone-adjacent, in the
// spirit of the fashion-house references. Self-hosted by next/font at build.
const playfair = Playfair_Display({
  subsets: ["latin"],
  style: ["normal", "italic"],
  weight: ["400", "500", "600"],
  variable: "--font-display",
});

export const metadata = {
  title: "Personal Stylist",
  description: "What should I wear?",
  openGraph: {
    title: "Personal Stylist",
    description:
      "A personal styling and inspiration tool: outfit ideas from my own wardrobe.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className={playfair.variable}>
      <body>{children}</body>
    </html>
  );
}
