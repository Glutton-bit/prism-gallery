"use client";
import { useEffect, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Images, FolderHeart, Compass, SlidersHorizontal } from "lucide-react";
import { useChrome, useSettings } from "./providers";

const TABS = [
  { href: "/", label: "Photos", icon: Images },
  { href: "/albums", label: "Albums", icon: FolderHeart },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/settings", label: "Settings", icon: SlidersHorizontal },
];

export function AppShell({ children }: { children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const { hideNav } = useChrome();
  const { s, ready } = useSettings();
  const fullscreen = path.startsWith("/edit");

  useEffect(() => {
    if (!ready || path !== "/" || sessionStorage.getItem("opened")) return;
    sessionStorage.setItem("opened", "1");
    if (s.defaultPage === "albums") router.replace("/albums");
    else if (s.defaultPage === "library") router.replace("/explore");
  }, [ready, path, s.defaultPage, router]);

  const active = (h: string) => (h === "/" ? path === "/" : path.startsWith(h));
  return (
    <>
      <main className={fullscreen ? "" : "mx-auto min-h-dvh max-w-3xl pb-32"}>{children}</main>
      {!fullscreen && !hideNav && (
        <nav className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),14px)]">
          <div className="glass-strong pointer-events-auto flex w-full max-w-md items-center justify-between rounded-[30px] p-1.5">
            {TABS.map((t) => {
              const on = active(t.href);
              return (
                <Link key={t.href} href={t.href} prefetch={false} className={`press flex flex-1 flex-col items-center gap-0.5 rounded-[24px] py-2 text-[11px] font-semibold ${on ? "bg-[var(--accent)]/15 accent-text" : "muted"}`}>
                  <t.icon size={22} strokeWidth={on ? 2.3 : 1.8} />
                  {t.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </>
  );
}
