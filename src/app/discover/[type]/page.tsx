"use client";
import { use, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Check, ChevronLeft, ChevronRight, MapPin, Pencil, X } from "lucide-react";
import type { Item } from "@/lib/types";
import { api, batch, prevUrl, thumbUrl } from "@/lib/api";
import { fmtSize } from "@/lib/format";
import { useDialogs } from "@/components/providers";
import { Btn, Empty, IconBtn, Spinner } from "@/components/ui";

const TITLES: Record<string, string> = { duplicates: "Duplicates", similar: "Similar Photos", calendar: "Calendar", timeline: "Timeline", map: "Map", places: "Places" };

export default function Discover({ params }: { params: Promise<{ type: string }> }) {
  const { type } = use(params);
  const router = useRouter();
  return (
    <div className="px-3 pb-6">
      <header className="sticky top-0 z-30 pb-2 safe-top">
        <div className="glass-strong flex items-center gap-2 rounded-[26px] px-2 py-1.5">
          <IconBtn label="Back" onClick={() => router.back()}><ArrowLeft size={18} /></IconBtn>
          <h1 className="pl-1 text-[19px] font-bold">{TITLES[type] ?? "Discover"}</h1>
        </div>
      </header>
      {(type === "duplicates" || type === "similar") && <Groups kind={type} />}
      {type === "calendar" && <Calendar />}
      {type === "timeline" && <Timeline />}
      {(type === "map" || type === "places") && <MapView />}
    </div>
  );
}

function Groups({ kind }: { kind: "duplicates" | "similar" }) {
  const d = useDialogs();
  const [groups, setGroups] = useState<Item[][] | null>(null);
  const [keep, setKeep] = useState<Record<number, boolean>>({});
  const [preview, setPreview] = useState<Item | null>(null);
  const load = useCallback(() => {
    api<{ groups: Item[][] }>(`/api/discover?type=${kind}`).then((r) => {
      setGroups(r.groups);
      const k: Record<number, boolean> = {};
      r.groups.forEach((g) => g.forEach((it, i) => (k[it.id] = i === 0)));
      setKeep(k);
    }).catch((e) => d.toast(e.message));
  }, [kind, d]);
  useEffect(() => { load(); }, [load]);

  const removeIn = async (g: Item[]) => {
    const kept = g.filter((x) => keep[x.id]);
    const rm = g.filter((x) => !keep[x.id]);
    if (!kept.length) return d.toast("Keep at least one copy");
    if (!rm.length) return d.toast("Nothing to remove — all copies are marked Keep");
    const ok = await d.confirm({ title: `Move ${rm.length} copy${rm.length > 1 ? "ies" : ""} to Trash?`, message: `You’re keeping ${kept.length}. Removed copies can be restored from Trash.`, confirmText: "Move to Trash", danger: true });
    if (!ok) return;
    await batch("trash", rm.map((x) => x.id));
    d.toast(`Moved ${rm.length} to Trash`);
    setGroups((gs) => (gs ?? []).filter((x) => x !== g));
  };
  if (!groups) return <div className="grid place-items-center py-16 muted"><Spinner /></div>;
  if (!groups.length) return <Empty icon={<Check size={34} />} title={kind === "duplicates" ? "No duplicates found" : "No similar photos found"} text={kind === "duplicates" ? "Exact duplicates are detected by comparing file contents (SHA-1), entirely on your device/server." : "Similar photos are found by comparing perceptual hashes (dHash) computed while importing."} />;
  return (
    <div className="space-y-4">
      <p className="muted px-1 text-sm">Tap a photo to toggle <b>Keep</b> / <b>Remove</b>. Long-press (or tap the magnifier) to inspect. Nothing is deleted until you confirm — removed copies go to Trash.</p>
      {groups.map((g, gi) => (
        <div key={gi} className="glass rounded-3xl p-3">
          <div className="mb-2 flex items-center justify-between px-1 text-sm"><span className="font-semibold">{g.length} {kind === "duplicates" ? "identical copies" : "similar photos"} · {fmtSize(g[0].size)}</span></div>
          <div className="no-scrollbar flex gap-2 overflow-x-auto pb-1">
            {g.map((it) => (
              <div key={it.id} className="w-32 shrink-0">
                <button onClick={() => setKeep((k) => ({ ...k, [it.id]: !k[it.id] }))} className={`relative block aspect-square w-full overflow-hidden rounded-2xl ${keep[it.id] ? "ring-[3px] ring-[var(--accent)]" : "opacity-60"}`}>
                  <img src={thumbUrl(it)} alt="" className="h-full w-full object-cover" loading="lazy" />
                  <span className={`absolute left-1.5 top-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold ${keep[it.id] ? "accent-bg" : "bg-black/60 text-white"}`}>{keep[it.id] ? "KEEP" : "REMOVE"}</span>
                </button>
                <button onClick={() => setPreview(it)} className="mt-1 block w-full truncate text-left text-[11px] font-medium accent-text">Inspect</button>
                <div className="muted truncate text-[10.5px]">{it.albumName} · {it.width}×{it.height} · {fmtSize(it.size)}</div>
              </div>
            ))}
          </div>
          <Btn kind="danger" className="mt-2 w-full" onClick={() => removeIn(g)}>Remove unchecked copies</Btn>
        </div>
      ))}
      {preview && (
        <div className="fixed inset-0 z-[90] bg-black/90 anim-fade" onClick={() => setPreview(null)}>
          <img src={prevUrl(preview)} alt="" className="h-full w-full object-contain" />
          <div className="on-media absolute inset-x-4 top-4 flex items-center justify-between rounded-full px-4 py-2 text-xs safe-top"><span className="truncate">{preview.name} · {preview.albumName} · {preview.width}×{preview.height} · {fmtSize(preview.size)}</span><X size={18} /></div>
        </div>
      )}
    </div>
  );
}

function Calendar() {
  const [days, setDays] = useState<Record<string, { count: number; coverId: number }>>({});
  const [cur, setCur] = useState(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), 1); });
  useEffect(() => { api<{ days: { day: string; count: number; coverId: number }[] }>("/api/discover?type=calendar").then((r) => setDays(Object.fromEntries(r.days.map((x) => [x.day, x])))); }, []);
  const first = cur.getDay();
  const nDays = new Date(cur.getFullYear(), cur.getMonth() + 1, 0).getDate();
  const cells = Array.from({ length: first + nDays }, (_, i) => (i < first ? null : i - first + 1));
  const key = (day: number) => `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const total = Object.entries(days).filter(([k]) => k.startsWith(key(1).slice(0, 7))).reduce((a, [, v]) => a + v.count, 0);
  return (
    <div className="glass rounded-3xl p-3">
      <div className="mb-3 flex items-center justify-between">
        <IconBtn label="Previous month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() - 1, 1))}><ChevronLeft size={18} /></IconBtn>
        <div className="text-center"><div className="font-bold">{cur.toLocaleString("en", { month: "long", year: "numeric" })}</div><div className="muted text-xs">{total} items</div></div>
        <IconBtn label="Next month" onClick={() => setCur(new Date(cur.getFullYear(), cur.getMonth() + 1, 1))}><ChevronRight size={18} /></IconBtn>
      </div>
      <div className="muted mb-1 grid grid-cols-7 text-center text-[11px] font-semibold">{["S", "M", "T", "W", "T", "F", "S"].map((x, i) => <div key={i}>{x}</div>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((c, i) => {
          if (!c) return <div key={i} />;
          const dd = days[key(c)];
          const from = new Date(cur.getFullYear(), cur.getMonth(), c), to = new Date(cur.getFullYear(), cur.getMonth(), c + 1);
          const inner = (
            <div className="relative aspect-square overflow-hidden rounded-xl bg-black/5 dark:bg-white/5">
              {dd && <img src={thumbUrl({ id: dd.coverId, modifiedAt: "2020-01-01", vaulted: false })} alt="" className="h-full w-full object-cover" loading="lazy" />}
              <span className={`absolute left-1 top-0.5 text-[11px] font-bold ${dd ? "text-white drop-shadow" : "muted"}`}>{c}</span>
              {dd && <span className="on-media absolute bottom-0.5 right-0.5 rounded-full px-1 text-[9px] font-bold">{dd.count}</span>}
            </div>
          );
          return dd ? <Link key={i} href={`/c/range?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&title=${encodeURIComponent(from.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }))}`} className="press">{inner}</Link> : <div key={i}>{inner}</div>;
        })}
      </div>
    </div>
  );
}

function Timeline() {
  const [rows, setRows] = useState<{ year: number; month: number; count: number; coverId: number }[] | null>(null);
  useEffect(() => { api<{ months: typeof rows }>("/api/discover?type=timeline").then((r) => setRows(r.months)); }, []);
  const years = useMemo(() => { const m = new Map<number, NonNullable<typeof rows>>(); (rows ?? []).forEach((r) => m.set(r.year, [...(m.get(r.year) ?? []), r])); return [...m.entries()]; }, [rows]);
  if (!rows) return <div className="grid place-items-center py-16 muted"><Spinner /></div>;
  if (!rows.length) return <Empty icon={<MapPin size={34} />} title="No photos yet" />;
  return (
    <div className="space-y-5">
      {years.map(([y, ms]) => (
        <section key={y}>
          <Link href={`/c/range?from=${new Date(y, 0, 1).toISOString()}&to=${new Date(y + 1, 0, 1).toISOString()}&title=${y}`} className="mb-2 flex items-baseline justify-between px-1"><h2 className="text-xl font-bold">{y}</h2><span className="muted text-xs">{ms.reduce((a, b) => a + b.count, 0)} items · view year</span></Link>
          <div className="grid grid-cols-3 gap-2">
            {ms.map((m) => (
              <Link key={m.month} href={`/c/range?from=${new Date(y, m.month - 1, 1).toISOString()}&to=${new Date(y, m.month, 1).toISOString()}&title=${encodeURIComponent(new Date(y, m.month - 1, 1).toLocaleString("en", { month: "long", year: "numeric" }))}`} className="press relative aspect-square overflow-hidden rounded-2xl bg-black/10">
                <img src={thumbUrl({ id: m.coverId, modifiedAt: "2020-01-01", vaulted: false })} alt="" loading="lazy" className="h-full w-full object-cover" />
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-6 text-white"><div className="text-xs font-bold">{new Date(y, m.month - 1, 1).toLocaleString("en", { month: "short" })}</div><div className="text-[10px] opacity-80">{m.count}</div></div>
              </Link>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

type Pt = { id: number; lat: number; lng: number; place: string | null };
function MapView() {
  const d = useDialogs();
  const [pts, setPts] = useState<Pt[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const load = useCallback(() => api<{ points: Pt[] }>("/api/discover?type=map").then((r) => setPts(r.points)), []);
  useEffect(() => { load(); }, [load]);
  const clusters = useMemo(() => {
    const m = new Map<string, { key: string; lat: number; lng: number; ids: number[]; place: string | null }>();
    (pts ?? []).forEach((p) => {
      const k = `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`;
      const c = m.get(k) ?? { key: k, lat: p.lat, lng: p.lng, ids: [], place: p.place };
      c.ids.push(p.id); m.set(k, c);
    });
    return [...m.values()].sort((a, b) => b.ids.length - a.ids.length);
  }, [pts]);
  if (!pts) return <div className="grid place-items-center py-16 muted"><Spinner /></div>;
  if (!pts.length) return <Empty icon={<MapPin size={34} />} title="No geotagged photos" text="Photos with GPS EXIF data are plotted here. Map tiles need internet, so this offline map plots your photos on a world grid and groups them into places." />;
  const X = (lng: number) => ((lng + 180) / 360) * 360, Y = (lat: number) => ((90 - lat) / 180) * 180;
  const selC = clusters.find((c) => c.key === sel);
  return (
    <div className="space-y-4">
      <div className="glass overflow-hidden rounded-3xl p-2">
        <svg viewBox="0 0 360 180" className="w-full rounded-2xl" style={{ background: "linear-gradient(160deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent)" }}>
          {Array.from({ length: 11 }, (_, i) => <line key={`v${i}`} x1={i * 36} x2={i * 36} y1={0} y2={180} stroke="currentColor" strokeOpacity=".12" strokeWidth=".4" />)}
          {Array.from({ length: 7 }, (_, i) => <line key={`h${i}`} y1={i * 30} y2={i * 30} x1={0} x2={360} stroke="currentColor" strokeOpacity=".12" strokeWidth=".4" />)}
          <line x1="0" x2="360" y1="90" y2="90" stroke="currentColor" strokeOpacity=".25" strokeWidth=".5" />
          {clusters.map((c) => (
            <g key={c.key} onClick={() => setSel(c.key)} className="cursor-pointer">
              <circle cx={X(c.lng)} cy={Y(c.lat)} r={Math.min(7, 2.5 + Math.log2(c.ids.length + 1))} fill="var(--accent)" fillOpacity={sel === c.key ? 1 : 0.7} stroke="#fff" strokeWidth=".8" />
            </g>
          ))}
        </svg>
        <div className="muted px-2 py-1.5 text-[11px]">Offline world grid · {pts.length} geotagged items in {clusters.length} places</div>
      </div>
      {selC && (
        <div className="glass-strong anim-pop flex items-center gap-3 rounded-2xl p-3">
          <MapPin className="accent-text" /><div className="min-w-0 flex-1"><div className="truncate font-semibold">{selC.place || selC.key}</div><div className="muted text-xs">{selC.ids.length} items</div></div>
          <Link className="accent-bg rounded-full px-4 py-2 text-sm font-semibold" href={`/c/place?place=${encodeURIComponent(selC.place ?? "")}&title=${encodeURIComponent(selC.place ?? selC.key)}`}>Open</Link>
        </div>
      )}
      <div className="space-y-2">
        {clusters.map((c) => (
          <div key={c.key} className="glass flex items-center gap-3 rounded-2xl p-2.5">
            <img src={thumbUrl({ id: c.ids[0], modifiedAt: "2020-01-01", vaulted: false })} alt="" className="h-12 w-12 rounded-xl object-cover" />
            <Link href={`/c/place?place=${encodeURIComponent(c.place ?? "")}&title=${encodeURIComponent(c.place ?? c.key)}`} className="min-w-0 flex-1"><div className="truncate font-semibold">{c.place || c.key}</div><div className="muted text-xs">{c.ids.length} items · {c.lat.toFixed(2)}, {c.lng.toFixed(2)}</div></Link>
            <IconBtn label="Name this place" onClick={async () => { const v = await d.prompt({ title: "Name this place", value: c.place ?? "", placeholder: "e.g. Grandma’s house" }); if (v !== null) { await batch("setPlace", c.ids, { place: v.trim() }); load(); } }}><Pencil size={16} /></IconBtn>
          </div>
        ))}
      </div>
    </div>
  );
}
