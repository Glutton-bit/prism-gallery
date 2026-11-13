import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "@/components/providers";
import { AppShell } from "@/components/app-shell";

export const metadata: Metadata = {
  title: "Prism Gallery",
  description: "Liquid-glass gallery with Camera-only Home, albums, private vault, trash, photo and video editors.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/icon-192.png", apple: "/icon-192.png" },
  appleWebApp: { capable: true, title: "Prism", statusBarStyle: "black-translucent" },
};
export const viewport: Viewport = {
  themeColor: "#0a84ff",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

const boot = `try{var s=JSON.parse(localStorage.getItem('prism-settings')||'{}');var d=s.theme==='dark'||((!s.theme||s.theme==='system')&&matchMedia('(prefers-color-scheme: dark)').matches);var h=document.documentElement;if(d)h.classList.add('dark');if(s.accent)h.style.setProperty('--accent',s.accent);if(s.glass)h.style.setProperty('--glass-a',String(s.glass/100));if(s.lowMemory)h.dataset.lowmem='1';if(s.animations)h.dataset.anim=s.animations;}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: boot }} />
      </head>
      <body className="antialiased">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
