import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { Nav } from "./nav";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });

export const metadata: Metadata = {
  title: "Marketplace Agent",
  description: "List once on Craigslist and Mercari, answer every buyer from one inbox.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased`}>
      <body className="flex min-h-screen">
        <Nav />
        <main className="min-w-0 flex-1 px-8 py-6">{children}</main>
      </body>
    </html>
  );
}
