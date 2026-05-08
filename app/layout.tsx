import type { Metadata } from "next";
import { Amiko, Lora, Mulish } from "next/font/google";
import "./globals.css";

/** Main headings (h1, major page titles) */
const amiko = Amiko({
  weight: ["400", "600", "700"],
  variable: "--font-amiko",
  subsets: ["latin"],
  display: "swap",
});

/** Section subheadings (h2, h3, card titles, section labels) */
const lora = Lora({
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-lora",
  subsets: ["latin"],
  display: "swap",
});

/** Body / paragraph / input / helper text */
const mulish = Mulish({
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-mulish",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Jake Swing Lockers",
  description: "Internal golf swing locker CRM",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${amiko.variable} ${lora.variable} ${mulish.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col font-body">{children}</body>
    </html>
  );
}
