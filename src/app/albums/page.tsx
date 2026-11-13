"use client";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowUpDown, Bluetooth, Camera, Check, CheckSquare, Download, Eye, EyeOff, FolderOpen, GripVertical, LayoutGrid, MessageCircle, MoveVertical, Pin, PinOff,
  Plus, Send, Smartphone, Trash2, Video, X, MoreHorizontal,
} from "lucide-react";
import type { Album } from "@/lib/types";
import { api, post, thumbUrl } from "@/lib/api";
import { ALBUM_SORTS } from "@/lib/sorts";
import { AlbumMenu, useAlbumOps } from "@/components/album-tools";
import { useChrome, useDialogs, useSettings } from "@/components/providers";
import { Chip, Empty, IconBtn, Sheet, Slider, Spinner } from "@/components/ui";
import { ImportSheet } from "@/components/import-sheet";

const HINT_ICON: Record<string, React.ReactNode> = {
  camera: <Camera size={14} />, screenshots: <Smartphone size={14} />, screenrec: <Video size={14} />, downloads: <Download size={14} />,
  "wa-images": <MessageCircle size={14} />, "wa-video": <MessageCircle size={14} />, telegram: <Send size={14} />, bluetooth: <Bluetooth size={14} />,
};
const LAYOUTS = [
  { v: "grid2", label: "Grid · 2 columns" }, { v: "grid3", label: "Grid · 3 columns" }, { v: "grid4", label: "Grid · 4 columns" },
  { v: "list", label: "List" }, { v: "large", label: "Large cards" }, { v: "compact", label: "Compact cards" },
] as const;

const coverUrl = (a: Album) => (a.coverId ? thumbUrl({ id: a.coverId, modifiedAt: new Date(a.coverV * 1000).toISOString(), vaulted: false }) : null);

export default function AlbumsPage() {
  const { s, update } = useSettings();
  const d = useDialogs();
  const router = useRouter();
  const { setHideNav } = useChrome();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [selMode, setSelMode] = useState(false);
  const [reorder, setReorder] = useState(false);
  const [sheet, setSheet] = useState<null | "sort" | "layout" | "import">(null);
  const [hiddenOnly, setHiddenOnly] = useState(false);
  const [menuFor, setMenuFor] = useState<Album | null>(null);
  const [dragId, setDragId] = useState<number | null>(null);
  const press = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppress = useRef(false);

  const load = useCallback(() => api<Album[]>("/api/albums").then(setAlbums).catch((e) => d.toast(e.message)).finally(() => setLoading(false)), [d]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!s.bgScan || s.lowMemory) return;
    const t = setInterval(() => { if (!document.hidden && !dragId) load(); }, 15000);
    return () => clearInterval(t);
  }, [s.bgScan, s.lowMemory, load, dragId]);
  const selecting = selMode || sel.size > 0;
  useEffect(() => { setHideNav(selecting); return () => setHideNav(false); }, [selecting, setHideNav]);
  const ops = useAlbumOps(() => { load(); });

  const sortKey = s.sorts["albums"] ?? "pinned";
  const visible = useMemo(() => albums.filter((a) => (hiddenOnly ? a.hidden : !a.hidden || s.showHiddenAlbums)), [albums, hiddenOnly, s.showHiddenAlbums]);
  const pinned = useMemo(() => visible.filter((a) => a.pinned).sort((a, b) => a.pinOrder - b.pinOrder), [visible]);
  const others = useMemo(() => {
    const o = visible.filter((a) => !a.pinned);
    const t = (x: string | null) => (x ? +new Date(x) : 0);
    const by: Record<string, (a: Album, b: Album) => number> = {
      nameaz: (a, b) => a.name.localeCompare(b.name), nameza: (a, b) => b.name.localeCompare(a.name),
      created: (a, b) => t(b.createdAt) - t(a.createdAt), modified: (a, b) => t(b.modifiedAt) - t(a.modifiedAt),
      most: (a, b) => b.count - a.count, fewest: (a, b) => a.count - b.count,
      pinned: (a, b) => (a.isCamera ? -1 : b.isCamera ? 1 : t(b.lastTaken) - t(a.lastTaken)),
      custom: (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name),
    };
    return o.sort(by[sortKey] ?? by.pinned);
  }, [visible, sortKey]);
  const hiddenCount = albums.filter((a) => a.hidden).length;
  const chosen = albums.filter((a) => sel.has(a.id));

  const toggle = (id: number) => setSel((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const exitSel = () => { setSel(new Set()); setSelMode(false); };

  const createAlbum = async () => {
    const name = await d.prompt({ title: "New album", placeholder: "Album name", confirmText: "Create" });
    if (!name?.trim()) return;
    try { await post("/api/albums", { name: name.trim() }); d.toast("Album created — add items from any gallery view"); load(); } catch (e) { d.toast((e as Error).message); }
  };

  /* ---- drag & drop ordering ---- */
  const persistOrder = async (list: Album[], isPinned: boolean) => {
    try { await post("/api/albums/reorder", isPinned ? { pinned: list.map((a) => a.id) } : { order: list.map((a) => a.id) }); } catch (e) { d.toast((e as Error).message); }
  };
  const startDrag = (e: React.PointerEvent, a: Album) => {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(a.id);
    if (!a.pinned && sortKey !== "custom") {
      // adopt the current visual order as the custom order
      update({ sorts: { ...s.sorts, albums: "custom" } });
      setAlbums((prev) => { const idx = new Map(others.map((x, i) => [x.id, i + 1])); return prev.map((x) => (idx.has(x.id) ? { ...x, sortOrder: idx.get(x.id)! } : x)); });
    }
  };
  const moveDrag = (e: React.PointerEvent, a: Album) => {
    if (dragId !== a.id) return;
    const el = document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-aid]") as HTMLElement | null;
    if (!el) return;
    const tid = Number(el.dataset.aid);
    if (tid === a.id) return;
    setAlbums((prev) => {
      const target = prev.find((x) => x.id === tid);
      if (!target || target.pinned !== a.pinned) return prev;
      const group = (a.pinned ? prev.filter((x) => x.pinned).sort((x, y) => x.pinOrder - y.pinOrder) : prev.filter((x) => !x.pinned && (hiddenOnly ? x.hidden : !x.hidden || s.showHiddenAlbums)).sort((x, y) => (others.findIndex((o) => o.id === x.id)) - (others.findIndex((o) => o.id === y.id))));
      const from = group.findIndex((x) => x.id === a.id), to = group.findIndex((x) => x.id === tid);
      if (from < 0 || to < 0) return prev;
      const [m] = group.splice(from, 1); group.splice(to, 0, m);
      const idx = new Map(group.map((x, i) => [x.id, i + 1]));
      return prev.map((x) => (idx.has(x.id) ? { ...x, [a.pinned ? "pinOrder" : "sortOrder"]: idx.get(x.id)! } : x));
    });
  };
  const endDrag = (a: Album) => {
    if (dragId === null) return;
    setDragId(null);
    const list = a.pinned ? [...albums.filter((x) => x.pinned)].sort((x, y) => x.pinOrder - y.pinOrder) : [...albums.filter((x) => !x.pinned)].sort((x, y) => x.sortOrder - y.sortOrder);
    persistOrder(list, a.pinned);
  };

  const layout = s.albumLayout;
  const gap = s.albumGap;
  const colsFor = layout === "grid2" ? 2 : layout === "grid3" ? 3 : layout === "grid4" ? 4 : layout === "compact" ? 2 : 1;

  const renderCard = (a: Album) => {
    const cu = coverUrl(a);
    const on = sel.has(a.id);
    const handle = reorder && (
      <div className="on-media absolute right-1.5 top-1.5 z-10 grid h-9 w-9 touch-none place-items-center rounded-full" style={{ touchAction: "none" }}
        onPointerDown={(e) => startDrag(e, a)} onPointerMove={(e) => moveDrag(e, a)} onPointerUp={() => endDrag(a)} onPointerCancel={() => endDrag(a)}><GripVertical size={18} /></div>
    );
    const badges = (
      <>
        {a.pinned && <span className="on-media absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full"><Pin size={12} /></span>}
        {a.isCamera && <span className="on-media absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold"><Camera size={10} />HOME</span>}
        {a.hidden && <span className="on-media absolute bottom-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full"><EyeOff size={12} /></span>}
        {selecting && <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full border-2 border-white shadow" style={{ background: on ? "var(--accent)" : "rgba(0,0,0,.25)" }}>{on && <Check size={13} strokeWidth={3} className="text-white" />}</span>}
      </>
    );
    const open = () => {
      if (suppress.current) return;
      if (selecting) toggle(a.id);
      else if (!reorder) router.push(`/albums/${a.id}`);
    };
    const pd = () => { if (reorder || selecting) return; press.current = setTimeout(() => { suppress.current = true; setSelMode(true); setSel(new Set([a.id])); navigator.vibrate?.(15); setTimeout(() => (suppress.current = false), 400); }, 480); };
    const pu = () => { if (press.current) clearTimeout(press.current); };
    const img = cu ? <img src={cu} alt="" loading="lazy" decoding="async" draggable={false} className="h-full w-full object-cover" /> : <div className="grid h-full w-full place-items-center muted"><FolderOpen size={28} /></div>;
    const common = { "data-aid": a.id, onClick: open, onPointerDown: pd, onPointerUp: pu, onPointerLeave: pu, onPointerCancel: pu, onContextMenu: (e: React.MouseEvent) => e.preventDefault() };

    if (layout === "list" || layout === "compact") {
      const sz = layout === "list" ? 64 : 44;
      return (
        <div {...common} className={`card press relative flex cursor-pointer items-center gap-3 rounded-2xl p-1.5 ${on ? "ring-2 ring-[var(--accent)]" : ""} ${dragId === a.id ? "opacity-60" : ""}`}>
          <div className="relative shrink-0 overflow-hidden rounded-xl bg-black/10" style={{ width: sz, height: sz }}>{img}</div>
          <div className="min-w-0 flex-1"><div className={`truncate font-semibold ${layout === "compact" ? "text-[13px]" : ""}`}>{a.name}</div><div className="muted flex items-center gap-1 text-xs">{HINT_ICON[a.hint]}{a.count.toLocaleString()} item{a.count === 1 ? "" : "s"}{a.pinned ? " · pinned" : ""}</div></div>
          {a.pinned && layout === "list" && <Pin size={14} className="accent-text" />}
          {selecting && <span className="grid h-6 w-6 place-items-center rounded-full border-2" style={{ background: on ? "var(--accent)" : "transparent", borderColor: on ? "var(--accent)" : "var(--hair)" }}>{on && <Check size={13} strokeWidth={3} className="text-white" />}</span>}
          {reorder && <div className="grid h-10 w-10 touch-none place-items-center" style={{ touchAction: "none" }} onPointerDown={(e) => startDrag(e, a)} onPointerMove={(e) => moveDrag(e, a)} onPointerUp={() => endDrag(a)} onPointerCancel={() => endDrag(a)}><GripVertical size={20} className="muted" /></div>}
        </div>
      );
    }
    return (
      <div {...common} className={`press relative cursor-pointer ${dragId === a.id ? "opacity-60" : ""}`}>
        <div className={`relative overflow-hidden rounded-[22px] bg-black/10 shadow-sm ${layout === "large" ? "aspect-[16/10]" : "aspect-square"} ${on ? "ring-[3px] ring-[var(--accent)]" : ""}`}>
          {img}
          {layout === "large" && <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-4 pt-10 text-white"><div className="text-lg font-bold">{a.name}</div><div className="text-xs opacity-80">{a.count.toLocaleString()} items{a.videoCount ? ` · ${a.videoCount} videos` : ""}</div></div>}
          {badges}{handle}
        </div>
        {layout !== "large" && <div className="px-1 pt-1.5"><div className="truncate text-[14px] font-semibold">{a.name}</div><div className="muted text-xs">{a.count.toLocaleString()}</div></div>}
      </div>
    );
  };

  const grid = (list: Album[]) => (
    <div className="grid px-3" style={{ gridTemplateColumns: `repeat(${colsFor}, minmax(0,1fr))`, gap }}>{list.map((a) => <Fragment key={a.id}>{renderCard(a)}</Fragment>)}</div>
  );

  return (
    <div>
      <header className="sticky top-0 z-30 px-3 pb-2 safe-top">
        {selecting ? (
          <div className="glass-strong anim-fade flex items-center gap-2 rounded-[26px] px-2 py-1.5">
            <IconBtn label="Cancel" onClick={exitSel}><X size={18} /></IconBtn>
            <div className="flex-1 px-1 font-semibold">{sel.size} selected</div>
            <button className="glass press rounded-full px-3 py-2 text-xs font-semibold" onClick={() => setSel(new Set(visible.map((a) => a.id)))}>Select all</button>
            <button className="glass press rounded-full px-3 py-2 text-xs font-semibold" onClick={() => setSel(new Set())}>None</button>
          </div>
        ) : (
          <div className="glass-strong flex items-center gap-2 rounded-[26px] px-2 py-1.5">
            <div className="min-w-0 flex-1 pl-2"><h1 className="text-[19px] font-bold leading-tight">Albums</h1><div className="muted text-xs">{loading ? "Scanning…" : `${visible.length} album${visible.length === 1 ? "" : "s"}${pinned.length ? ` · ${pinned.length} pinned` : ""}`}</div></div>
            <IconBtn label="Sort albums" onClick={() => setSheet("sort")}><ArrowUpDown size={18} /></IconBtn>
            <IconBtn label="Layout" onClick={() => setSheet("layout")}><LayoutGrid size={18} /></IconBtn>
            <IconBtn label="Reorder" active={reorder} onClick={() => setReorder((v) => !v)}><MoveVertical size={18} /></IconBtn>
            <IconBtn label="Select albums" onClick={() => setSelMode(true)}><CheckSquare size={18} /></IconBtn>
            <IconBtn label="New album" onClick={createAlbum}><Plus size={18} /></IconBtn>
          </div>
        )}
        {!selecting && (hiddenCount > 0 || hiddenOnly) && !s.showHiddenAlbums && (
          <div className="mt-2 flex gap-2"><Chip active={!hiddenOnly} onClick={() => setHiddenOnly(false)}>Albums</Chip><Chip active={hiddenOnly} onClick={() => setHiddenOnly(true)}><EyeOff size={13} className="mr-1 inline" />Hidden ({hiddenCount})</Chip></div>
        )}
        {reorder && !selecting && <div className="glass mt-2 rounded-2xl px-3 py-2 text-xs muted">Reorder mode: drag the <GripVertical size={12} className="inline" /> handle. Pinned albums reorder among themselves; others switch to “Custom order”.</div>}
      </header>

      {loading && !albums.length && <div className="grid place-items-center py-16 muted"><Spinner /></div>}
      {pinned.length > 0 && !hiddenOnly && (<><h2 className="muted flex items-center gap-1.5 px-5 pb-2 pt-2 text-xs font-bold uppercase tracking-wider"><Pin size={12} />Pinned</h2>{grid(pinned)}</>)}
      {others.length > 0 && (<>{pinned.length > 0 && !hiddenOnly && <h2 className="muted px-5 pb-2 pt-5 text-xs font-bold uppercase tracking-wider">All albums</h2>}<div className={pinned.length ? "" : "pt-1"}>{grid(others)}</div></>)}
      {!loading && !visible.length && (
        <Empty icon={<FolderOpen size={34} />} title={hiddenOnly ? "No hidden albums" : "No albums yet"} text="Albums appear automatically for every folder you import (Camera, Screenshots, WhatsApp, Telegram, Downloads…). You can also create your own.">
          <button className="accent-bg press rounded-full px-5 py-2.5 text-sm font-semibold" onClick={() => setSheet("import")}>Import folders</button>
          <button className="glass press rounded-full px-5 py-2.5 text-sm font-semibold" onClick={createAlbum}>New album</button>
        </Empty>
      )}

      {selecting && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),14px)]">
          <div className="glass-strong anim-sheet pointer-events-auto flex w-full max-w-md items-center justify-around rounded-[30px] p-1.5">
            {[
              { i: chosen.every((a) => a.pinned) ? <PinOff size={21} /> : <Pin size={21} />, l: chosen.every((a) => a.pinned) ? "Unpin" : "Pin", f: async () => { const on = !chosen.every((a) => a.pinned); for (const a of chosen) await ops.pin(a, on); exitSel(); } },
              { i: chosen.every((a) => a.hidden) ? <Eye size={21} /> : <EyeOff size={21} />, l: chosen.every((a) => a.hidden) ? "Unhide" : "Hide", f: async () => { const on = !chosen.every((a) => a.hidden); for (const a of chosen) await ops.hide(a, on); exitSel(); } },
              { i: <Trash2 size={21} />, l: "Delete", danger: true, f: async () => { if (await ops.remove(chosen)) exitSel(); } },
              ...(chosen.length === 1 ? [{ i: <MoreHorizontal size={21} />, l: "More", f: () => setMenuFor(chosen[0]) }] : []),
            ].map((b) => <button key={b.l} disabled={!sel.size} onClick={b.f} className={`press flex min-w-[60px] flex-1 flex-col items-center gap-0.5 rounded-[22px] py-2 text-[10.5px] font-semibold disabled:opacity-35 ${(b as { danger?: boolean }).danger ? "text-[var(--danger)]" : ""}`}>{b.i}{b.l}</button>)}
          </div>
        </div>
      )}

      {menuFor && <AlbumMenu album={menuFor} open onClose={() => setMenuFor(null)} onChanged={load} onDeleted={() => { setMenuFor(null); exitSel(); load(); }} />}

      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort albums">
        <div className="space-y-1 pb-2">
          {ALBUM_SORTS.map((o) => (
            <button key={o.key} onClick={() => { update({ sorts: { ...s.sorts, albums: o.key } }); setSheet(null); }} className="press flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left font-medium">{o.label}{sortKey === o.key && <Check size={18} className="accent-text" />}</button>
          ))}
          <p className="muted px-4 pt-2 text-xs">Pinned albums always stay at the top, in the order you arranged them.</p>
        </div>
      </Sheet>
      <Sheet open={sheet === "layout"} onClose={() => setSheet(null)} title="Album layout">
        <div className="space-y-1 pb-2">
          {LAYOUTS.map((o) => (
            <button key={o.v} onClick={() => update({ albumLayout: o.v })} className="press flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left font-medium">{o.label}{layout === o.v && <Check size={18} className="accent-text" />}</button>
          ))}
          <div className="px-4 pt-3"><div className="mb-1 flex justify-between text-sm font-medium"><span>Spacing</span><span className="muted">{gap}px</span></div><Slider min={2} max={28} value={gap} onChange={(v) => update({ albumGap: v })} /></div>
        </div>
      </Sheet>
      <ImportSheet open={sheet === "import"} onClose={() => setSheet(null)} onDone={load} />
      <Link href="/trash" className="hidden" />
    </div>
  );
}
