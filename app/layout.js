import "./globals.css";

export const metadata = {
  title: "Jess' Stylist",
  description: "What should I wear?",
  openGraph: {
    title: "Jess' Stylist",
    description:
      "A personal styling and inspiration tool: outfit ideas from my own wardrobe.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#efe5d8",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
