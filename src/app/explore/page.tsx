"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Archive, CalendarDays, Camera, Clock, Copy, Eye, Film, Gift, Heart, HardDrive, Images, Lock, MapPin, Pencil, Search, Smartphone, Sparkles, Trash2, Video, Layers, Download, Map as MapIcon, History,
} from "lucide-react";
import { api, thumbUrl } from "@/lib/api";
import { fmtSize } from "@/lib/format";
import { useSettings } from "@/components/providers";

type Stats = Record<string, number> & { byAlbum: { id: number; name: string; size: number; count: number }[] };
type Memory = { key: string; title: string; subtitle: string; coverId: number; count: number; from: string; to: string };

export default function Explore() {
  const router = useRouter();
  const { s } = useSettings();
  const [stats, setStats] = useState<Stats | null>(null);
  const [mem, setMem] = useState<Memory[]>([]);
  const [q, setQ] = useState("");
  useEffect(() => {
    api<Stats>("/api/discover?type=stats").then(setStats).catch(() => {});
    api<{ memories: Memory[] }>("/api/discover?type=memories").then((r) => setMem(r.memories)).catch(() => {});
  }, []);

  const n = (k: string) => (stats ? stats[k] ?? 0 : undefined);
  const cats = [
    { href: "/c/photos", icon: Images, label: "All Photos", c: n("photos") },
    { href: "/c/camera", icon: Camera, label: "Camera", c: undefined },
    { href: "/c/screenshots", icon: Smartphone, label: "Screenshots", c: n("screenshots") },
    { href: "/c/screenrec", icon: Video, label: "Screen Recordings", c: n("screenrec") },
    { href: "/c/videos", icon: Film, label: "Videos", c: n("videos") },
    { href: "/c/gifs", icon: Layers, label: "GIFs", c: n("gifs") },
    { href: "/c/downloads", icon: Download, label: "Downloads", c: n("downloads") },
    { href: "/c/favorites", icon: Heart, label: "Favourites", c: n("favorites") },
    { href: "/c/recent", icon: Clock, label: "Recently Added", c: n("total") },
    { href: "/c/edited", icon: Pencil, label: "Recently Edited", c: n("edited") },
    { href: "/c/viewed", icon: Eye, label: "Recently Viewed", c: n("viewed") },
    { href: "/c/large", icon: HardDrive, label: "Large Files", c: n("large") },
    { href: "/discover/duplicates", icon: Copy, label: "Duplicates", c: undefined },
    { href: "/discover/similar", icon: Sparkles, label: "Similar Photos", c: undefined },
    { href: "/c/archived", icon: Archive, label: "Archived", c: n("archived") },
    ...(s.vaultHidden ? [] : [{ href: "/vault", icon: Lock, label: "Private (Hidden)", c: n("vault") }]),
    { href: "/trash", icon: Trash2, label: "Trash", c: n("trash") },
  ];
  const disc = [
    { href: "/discover/calendar", icon: CalendarDays, label: "Calendar" },
    { href: "/discover/timeline", icon: History, label: "Timeline" },
    { href: "/discover/map", icon: MapIcon, label: "Map" },
    { href: "/discover/places", icon: MapPin, label: "Places" },
  ];
  return (
    <div className="px-3 pb-6">
      <header className="sticky top-0 z-30 pb-2 safe-top">
        <div className="glass-strong rounded-[26px] px-4 py-2.5"><h1 className="text-[19px] font-bold">Explore</h1></div>
      </header>
      <form className="glass mb-5 flex items-center gap-2 rounded-full px-4 py-3" onSubmit={(e) => { e.preventDefault(); router.push(`/search?q=${encodeURIComponent(q)}`); }}>
        <Search size={18} className="muted" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, date, month, format, size, album, place…" className="!border-0 !bg-transparent !p-0" />
      </form>

      {mem.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 flex items-center gap-1.5 px-1 text-sm font-bold"><Gift size={15} className="accent-text" />Memories</h2>
          <div className="no-scrollbar -mx-3 flex gap-3 overflow-x-auto px-3">
            {mem.map((m) => (
              <Link key={m.key} href={`/c/range?from=${encodeURIComponent(m.from)}&to=${encodeURIComponent(m.to)}&title=${encodeURIComponent(m.title)}`} className="press relative h-44 w-36 shrink-0 overflow-hidden rounded-[26px] bg-black/10 shadow">
                <img src={thumbUrl({ id: m.coverId, modifiedAt: "2020-01-01", vaulted: false })} alt="" loading="lazy" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 to-transparent p-3 pt-10 text-white"><div className="text-sm font-bold leading-tight">{m.title}</div><div className="text-[11px] opacity-80">{m.subtitle} · {m.count}</div></div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-sm font-bold">Discover</h2>
        <div className="grid grid-cols-4 gap-2">
          {disc.map((x) => (
            <Link key={x.href} href={x.href} className="glass press flex flex-col items-center gap-1.5 rounded-3xl py-3.5 text-[11.5px] font-semibold"><x.icon size={22} className="accent-text" />{x.label}</Link>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 px-1 text-sm font-bold">Collections</h2>
        <div className="grid grid-cols-2 gap-2">
          {cats.map((c) => (
            <Link key={c.href} href={c.href} className="glass press flex items-center gap-3 rounded-2xl px-3.5 py-3">
              <span className="accent-bg grid h-9 w-9 shrink-0 place-items-center rounded-xl"><c.icon size={18} /></span>
              <span className="min-w-0"><span className="block truncate text-[13.5px] font-semibold">{c.label}</span>{c.c !== undefined && <span className="muted text-xs">{c.c.toLocaleString()}</span>}</span>
            </Link>
          ))}
        </div>
      </section>

      {stats && (
        <section className="glass rounded-3xl p-4">
          <h2 className="mb-1 flex items-center gap-1.5 text-sm font-bold"><HardDrive size={15} className="accent-text" />Library</h2>
          <div className="muted text-sm">{stats.total.toLocaleString()} items · {fmtSize(stats.size)} · {stats.located} with location</div>
          <div className="mt-3 space-y-2">
            {stats.byAlbum.filter((a) => a.size > 0).slice(0, 5).map((a) => (
              <div key={a.id}><div className="flex justify-between text-xs"><span className="font-medium">{a.name}</span><span className="muted">{fmtSize(a.size)}</span></div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"><div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${Math.max(3, (a.size / Math.max(1, stats.byAlbum[0].size)) * 100)}%` }} /></div></div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
