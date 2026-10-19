import type { Metadata } from "next";
import { Barlow_Semi_Condensed, Playfair_Display } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

// A high-contrast display face for headings and the payout display, a condensed grotesque
// for body text (spec section 11).
const display = Playfair_Display({
  variable: "--font-display-face",
  subsets: ["latin"],
  weight: ["600", "700", "800"],
});

const body = Barlow_Semi_Condensed({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "MockBuddy",
  description: "Turn your own course material into realistic practice exams.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // The font variables live on <html> because globals.css applies the body font there.
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
