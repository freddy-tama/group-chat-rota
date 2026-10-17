import type { Metadata } from "next";
import { Atkinson_Hyperlegible, Bricolage_Grotesque, Caveat } from "next/font/google";
import "./globals.css";

const atkinson = Atkinson_Hyperlegible({ variable: "--font-atkinson", subsets: ["latin"], weight: ["400", "700"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], weight: ["600", "800"] });
const caveat = Caveat({ variable: "--font-caveat", subsets: ["latin"], weight: ["600", "700"] });

export const metadata: Metadata = {
  title: "Group Chat Rota",
  description: "Paste your staff group chat. Each message becomes a quoted constraint you confirm, and a solver builds the week's rota within your rest and hours rules.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${atkinson.variable} ${bricolage.variable} ${caveat.variable} antialiased`}>{children}</body>
    </html>
  );
}
