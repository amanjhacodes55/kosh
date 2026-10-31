import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Kosh: open-source core banking", template: "%s · Kosh" },
  description: "Core banking for Indian banks: CIF and KYC, savings and current accounts, FDs and RDs, loans with IRAC, treasury with CRR, SLR and call money, a double-entry ledger, maker-checker and end of day.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0f14" },
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
  ],
};

/** Sets the saved or system theme on <html> before the first paint (see src/client/theme.ts) */
const THEME_SCRIPT = `(()=>{try{var t=localStorage.getItem("kosh:theme"),d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches),r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light"}catch(e){}})()`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN" data-theme="dark" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body className="min-h-full font-sans">
        {children}
        <script
          dangerouslySetInnerHTML={{
            __html: `(()=>{const k=()=>document.querySelectorAll('#nl-badge-frame,#nl-badge,[id^="nl-badge"]').forEach(e=>e.remove());k();new MutationObserver(k).observe(document.documentElement,{childList:true,subtree:true})})()`,
          }}
        />
      </body>
    </html>
  );
}
