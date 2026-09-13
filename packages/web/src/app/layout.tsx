import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "@/styles/globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "LLM Cost Autopilot",
  description:
    "Real-time LLM routing control plane — decision graph, live trace, and system observability.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`}>
      <body>
        <style>
          {`:root {
            --font-sans: var(--font-inter), -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
            --font-mono: var(--font-jetbrains-mono), ui-monospace, "SF Mono", Menlo, Consolas, monospace;
          }
          @keyframes lca-pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.35; }
          }`}
        </style>
        {children}
      </body>
    </html>
  );
}
