import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Barlow } from "next/font/google";
import { Suspense } from "react";
import NavLinks from "@/components/NavLinks";
import "./globals.css";

const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-barlow" });

export const metadata: Metadata = {
  title: "Recovery Lab",
  description: "A small, synthetic simulation of AI-assisted overdue payment outreach, its evaluation, and reporting.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${barlow.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-line bg-white">
          <nav aria-label="Main" className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6">
            <span className="flex items-center gap-2 text-lg font-semibold tracking-tight">
              <span aria-hidden="true" className="inline-block size-3 rounded-sm bg-accent" />
              Recovery Lab
            </span>
            <Suspense><NavLinks /></Suspense>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 sm:py-10">{children}</main>
        <footer className="border-t border-line">
          <p className="mx-auto max-w-6xl px-4 py-4 text-xs text-muted sm:px-6">
            Fictional businesses and synthetic data. No real messages or payments are sent. The rules checked here are a simplified model,
            not a legal standard.
          </p>
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
