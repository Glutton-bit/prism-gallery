"use client";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, ArrowUpDown, Archive, Camera, CheckSquare, Copy, FolderInput, FolderMinus, FolderPlus, Heart, HeartOff, ImagePlus, Info,
  LayoutGrid, Lock, MoreHorizontal, RotateCcw, Search, Share2, Trash2, X, Download, EyeOff, ArrowUpToLine, Check,
} from "lucide-react";
import type { Item, MediaPage, Album } from "@/lib/types";
import { api, patch } from "@/lib/api";
import { DATE_SORTS, MIXED_SORTS, PHOTO_SORTS, VIDEO_SORTS, type SortOpt } from "@/lib/sorts";
import { daysLeft } from "@/lib/format";
import { importFiles } from "@/lib/imaging";
import { InfoSheet, useActions, type Change } from "./actions";
import { ImportSheet } from "./import-sheet";
import { MediaGrid } from "./media-grid";
import { useChrome, useDialogs, useSettings } from "./providers";
import { Btn, Chip, Empty, IconBtn, Sheet, Slider, Spinner, Segmented } from "./ui";

const Viewer = dynamic(() => import("./viewer"), { ssr: false });

export type BrowserProps = {
  scope: string;
  albumId?: number;
  title: string;
  subtitle?: string;
  prefKey: string;
  kindFilter?: "image" | "video";
  mode?: "normal" | "trash" | "vault";
  canImport?: boolean;
  back?: boolean;
  headerRight?: ReactNode;
  extraParams?: Record<string, string>;
  initialQ?: string;
  autoSearch?: boolean;
  home?: boolean;
  inAlbum?: boolean;
  emptyText?: string;
  banner?: ReactNode;
  onLocked?: () => void;
  reloadSignal?: number;
  onCount?: (n: number) => void;
};

export function MediaBrowser(p: BrowserProps) {
  const { s, update } = useSettings();
  const d = useDialogs();
  const router = useRouter();
  const { setHideNav } = useChrome();
  const [kind, setKind] = useState<"" | "image" | "video">(p.kindFilter ?? "");
  const [q, setQ] = useState(p.initialQ ?? "");
  const [dq, setDq] = useState(p.initialQ ?? "");
  const [searching, setSearching] = useState(!!p.autoSearch || !!p.initialQ);
  const [items, setItems] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [noCamera, setNoCamera] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [selMode, setSelMode] = useState(false);
  const [viewer, setViewer] = useState<number | null>(null);
  const [sheet, setSheet] = useState<null | "sort" | "view" | "more" | "import">(null);
  const [info, setInfo] = useState<Item[] | null>(null);
  const reqId = useRef(0);
  const sentinel = useRef<HTMLDivElement>(null);
  const itemsRef = useRef(items);
  itemsRef.current = items;

  const prefKey = kind && !p.kindFilter ? `${p.prefKey}:${kind}` : p.prefKey;
  const baseSorts: SortOpt[] = (kind || p.kindFilter) === "video" ? VIDEO_SORTS : (kind || p.kindFilter) === "image" ? PHOTO_SORTS : MIXED_SORTS;
  const sortOpts = p.inAlbum && !kind ? [...MIXED_SORTS, { key: "custom", label: "Custom order" }] : baseSorts;
  const sort = s.sorts[prefKey] && sortOpts.some((o) => o.key === s.sorts[prefKey]) ? s.sorts[prefKey] : "newest";
  const group = DATE_SORTS.has(sort) ? (s.groups[p.prefKey] ?? "day") : "none";
  const pageSize = s.lowMemory ? 60 : 120;
  const selecting = selMode || sel.size > 0;
  const trashMode = p.mode === "trash";
  const vaultMode = p.mode === "vault";

  useEffect(() => { const t = setTimeout(() => setDq(q), 250); return () => clearTimeout(t); }, [q]);
  useEffect(() => { setHideNav(selecting || viewer !== null); return () => setHideNav(false); }, [selecting, viewer, setHideNav]);

  const qs = useMemo(() => {
    const u = new URLSearchParams({ scope: p.scope, sort, q: dq, ...(p.albumId ? { album: String(p.albumId) } : {}), ...(kind ? { kind } : {}), ...(p.extraParams ?? {}) });
    return u;
  }, [p.scope, p.albumId, p.extraParams, sort, dq, kind]);

  const load = useCallback(async (offset: number, replace: boolean) => {
    const id = ++reqId.current;
    setLoading(true);
    try {
      const u = new URLSearchParams(qs);
      u.set("offset", String(offset)); u.set("limit", String(pageSize));
      const r = await api<MediaPage>(`/api/media?${u}`);
      if (id !== reqId.current) return;
      setItems((prev) => (replace ? r.items : [...prev, ...r.items.filter((x) => !prev.some((y) => y.id === x.id))]));
      setTotal(r.total);
      setNoCamera(!!r.noCamera);
      p.onCount?.(r.total);
    } catch (e) {
      if (id !== reqId.current) return;
      if ((e as { status?: number }).status === 401) p.onLocked?.();
      else d.toast((e as Error).message);
    } finally {
      if (id === reqId.current) setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qs, pageSize]);

  useEffect(() => { setSel(new Set()); setSelMode(false); load(0, true); }, [load, reloadKey, p.reloadSignal]);

  // poll for new media (folder / file change detection) while visible
  useEffect(() => {
    if (!s.bgScan || s.lowMemory) return;
    let last = total;
    const t = setInterval(async () => {
      if (document.hidden || viewer !== null || selecting) return;
      try {
        const u = new URLSearchParams(qs); u.set("limit", "1");
        const r = await api<MediaPage>(`/api/media?${u}`);
        if (r.total !== last) { last = r.total; setReloadKey((k) => k + 1); }
      } catch { /* ignore */ }
    }, 15000);
    return () => clearInterval(t);
  }, [s.bgScan, s.lowMemory, qs, total, viewer, selecting]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => {
      if (es[0].isIntersecting && !loading && itemsRef.current.length < total) load(itemsRef.current.length, false);
    }, { rootMargin: "1400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [loading, total, load, items.length]);

  const onChange = useCallback((c: Change) => {
    if (c.type === "reload") setReloadKey((k) => k + 1);
    else if (c.type === "remove") {
      setItems((prev) => prev.filter((x) => !c.ids.includes(x.id)));
      setTotal((t) => Math.max(0, t - c.ids.length));
      setSel((prev) => { const n = new Set(prev); c.ids.forEach((i) => n.delete(i)); return n; });
    } else setItems((prev) => prev.map((x) => (c.ids.includes(x.id) ? { ...x, ...c.patch } : x)));
  }, []);
  const A = useActions({ albumId: p.albumId, onChange });

  const chosen = items.filter((x) => sel.has(x.id));
  const toggle = useCallback((id: number) => setSel((prev) => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }), []);
  const setMany = useCallback((ids: number[], on: boolean) => setSel((prev) => { const n = new Set(prev); ids.forEach((i) => (on ? n.add(i) : n.delete(i))); return n; }), []);
  const enter = useCallback((id: number) => { setSelMode(true); setSel((prev) => new Set(prev).add(id)); }, []);
  const exitSel = () => { setSel(new Set()); setSelMode(false); };
  const selectAll = async () => {
    try {
      const u = new URLSearchParams(qs); u.set("ids", "1");
      const r = await api<{ ids: number[] }>(`/api/media?${u}`);
      setSel(new Set(r.ids));
    } catch { setSel(new Set(items.map((i) => i.id))); }
  };
  const invert = async () => {
    const u = new URLSearchParams(qs); u.set("ids", "1");
    const r = await api<{ ids: number[] }>(`/api/media?${u}`);
    setSel(new Set(r.ids.filter((i) => !sel.has(i))));
  };

  const setSort = (k: string) => { update({ sorts: { ...s.sorts, [prefKey]: k } }); setSheet(null); };
  const retention = s.trashDays;
  const badge = trashMode ? (it: Item) => (it.trashedAt ? `${daysLeft(it.trashedAt, retention)}d left` : undefined) : undefined;

  const allFav = chosen.length > 0 && chosen.every((x) => x.favorite);
  const deleteSel = async () => {
    if (trashMode) return A.purge(chosen);
    if (vaultMode) {
      const ok = await d.confirm({ title: `Delete ${chosen.length} private item${chosen.length > 1 ? "s" : ""} forever?`, message: "Private files skip the Trash and are erased permanently.", confirmText: "Delete forever", danger: true });
      if (!ok) return;
      try { const { batch } = await import("@/lib/api"); await batch("trash", chosen.map((c) => c.id)); await batch("delete", chosen.map((c) => c.id)); onChange({ type: "remove", ids: chosen.map((c) => c.id) }); } catch (e) { d.toast((e as Error).message); }
      return;
    }
    return A.trash(chosen);
  };

  const emptyNode = () => {
    if (p.home && noCamera) return <CameraSetup onDone={() => setReloadKey((k) => k + 1)} />;
    if (trashMode) return <Empty icon={<Trash2 size={34} />} title="Trash is empty" text={`Deleted photos and videos stay here for ${retention} days before they’re erased automatically.`} />;
    if (dq) return <Empty icon={<Search size={34} />} title="No results" text="Try a filename, year, month, format (avif, png), size (>5mb), 'video', 'fav' or album:name." />;
    return (
      <Empty icon={<ImagePlus size={34} />} title={p.emptyText ?? "Nothing here yet"} text={vaultMode ? "Hide photos and videos from the gallery to keep them here, encrypted." : "Import photos and videos to get started."}>
        {p.canImport !== false && !vaultMode && <Btn kind="accent" onClick={() => setSheet("import")}><ImagePlus size={16} />Import</Btn>}
      </Empty>
    );
  };

  return (
    <div>
      {/* Header */}
      <header className="sticky top-0 z-30 px-3 pb-2 safe-top">
        {selecting ? (
          <div className="glass-strong anim-fade flex items-center gap-2 rounded-[26px] px-2 py-1.5">
            <IconBtn label="Cancel selection" onClick={exitSel}><X size={18} /></IconBtn>
            <div className="min-w-0 flex-1 px-1"><div className="truncate text-[15px] font-semibold">{sel.size} selected</div></div>
            <button className="glass press rounded-full px-3 py-2 text-xs font-semibold" onClick={selectAll}>Select all</button>
            <button className="glass press rounded-full px-3 py-2 text-xs font-semibold" onClick={invert}>Invert</button>
            <button className="glass press rounded-full px-3 py-2 text-xs font-semibold" onClick={() => setSel(new Set())}>None</button>
          </div>
        ) : (
          <div className="glass-strong flex items-center gap-2 rounded-[26px] px-2 py-1.5">
            {p.back && <IconBtn label="Back" onClick={() => router.back()}><ArrowLeft size={18} /></IconBtn>}
            <div className="min-w-0 flex-1 pl-2">
              <h1 className="flex items-center gap-1.5 truncate text-[19px] font-bold leading-tight">{p.home && <Camera size={17} className="accent-text" />}{p.title}</h1>
              <div className="muted truncate text-xs">{p.subtitle ? `${p.subtitle} · ` : ""}{loading && !items.length ? "Loading…" : `${total.toLocaleString()} item${total === 1 ? "" : "s"}`}</div>
            </div>
            <IconBtn label="Search" active={searching} onClick={() => { setSearching((v) => !v); if (searching) setQ(""); }}><Search size={18} /></IconBtn>
            <IconBtn label="Sort by" onClick={() => setSheet("sort")}><ArrowUpDown size={18} /></IconBtn>
            <IconBtn label="View options" onClick={() => setSheet("view")}><LayoutGrid size={18} /></IconBtn>
            {trashMode ? (
              <IconBtn label="Empty trash" onClick={() => A.emptyTrash(total)} disabled={!total}><Trash2 size={18} /></IconBtn>
            ) : (
              p.canImport !== false && !vaultMode && <IconBtn label="Import" onClick={() => setSheet("import")}><ImagePlus size={18} /></IconBtn>
            )}
            {p.headerRight}
          </div>
        )}
        {searching && !selecting && (
          <div className="glass anim-fade mt-2 flex items-center gap-2 rounded-full px-4 py-2">
            <Search size={16} className="muted" />
            <input autoFocus type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={p.home ? "Search Camera: name, 2025, mp4, >5mb, fav…" : "Search name, date, format, size, album…"} className="!border-0 !bg-transparent !p-0" />
            {q && <button onClick={() => setQ("")} aria-label="Clear"><X size={16} /></button>}
          </div>
        )}
        {!p.kindFilter && !trashMode && !vaultMode && !selecting && (
          <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto">
            <Chip active={kind === ""} onClick={() => setKind("")}>All</Chip>
            <Chip active={kind === "image"} onClick={() => setKind("image")}>Photos</Chip>
            <Chip active={kind === "video"} onClick={() => setKind("video")}>Videos</Chip>
          </div>
        )}
        {trashMode && !selecting && (
          <div className="mt-2 space-y-2">
            <div className="no-scrollbar flex gap-2 overflow-x-auto">
              <Chip active={kind === ""} onClick={() => setKind("")}>All</Chip>
              <Chip active={kind === "image"} onClick={() => setKind("image")}>Photos</Chip>
              <Chip active={kind === "video"} onClick={() => setKind("video")}>Videos</Chip>
            </div>
            <div className="glass rounded-2xl px-3 py-2 text-xs muted">Items are erased automatically after <b className="text-[var(--fg)]">{retention} days</b>. Select items to restore or delete them forever.</div>
          </div>
        )}
      </header>

      {p.banner}

      {items.length > 0 && (
        <MediaGrid items={items} cols={s.gridCols} gap={s.gridGap} group={group} selecting={selecting} selected={sel} dragHoldMs={s.dragHoldMs}
          onOpen={setViewer} onToggle={toggle} onSetMany={setMany} onEnter={enter} badge={badge} />
      )}
      {!items.length && !loading && emptyNode()}
      {loading && <div className="grid place-items-center py-10 muted"><Spinner /></div>}
      <div ref={sentinel} className="h-8" />

      {/* Selection action bar */}
      {selecting && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),14px)]">
          <div className="glass-strong anim-sheet pointer-events-auto flex w-full max-w-md items-center justify-around rounded-[30px] p-1.5">
            {trashMode ? (
              <>
                <SelBtn icon={<RotateCcw size={21} />} label="Restore" disabled={!sel.size} onClick={() => A.restore(chosen)} />
                <SelBtn icon={<Info size={21} />} label="Info" disabled={!sel.size} onClick={() => setInfo(chosen)} />
                <SelBtn icon={<Trash2 size={21} />} label="Delete" danger disabled={!sel.size} onClick={deleteSel} />
              </>
            ) : (
              <>
                <SelBtn icon={<Share2 size={21} />} label="Share" disabled={!sel.size} onClick={() => A.share(chosen)} />
                {vaultMode ? <SelBtn icon={<EyeOff size={21} />} label="Unhide" disabled={!sel.size} onClick={() => A.unhide(chosen)} /> : <SelBtn icon={allFav ? <HeartOff size={21} /> : <Heart size={21} />} label={allFav ? "Unfav" : "Favourite"} disabled={!sel.size} onClick={() => A.favorite(chosen, !allFav)} />}
                {!vaultMode && <SelBtn icon={<FolderPlus size={21} />} label="Add to" disabled={!sel.size} onClick={() => A.copy(chosen, "Add to album")} />}
                <SelBtn icon={<Trash2 size={21} />} label="Delete" danger disabled={!sel.size} onClick={deleteSel} />
                {!vaultMode && <SelBtn icon={<MoreHorizontal size={21} />} label="More" disabled={!sel.size} onClick={() => setSheet("more")} />}
              </>
            )}
          </div>
        </div>
      )}

      {/* More sheet */}
      <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title={`${sel.size} selected`}>
        <div className="grid grid-cols-3 gap-2 pb-2">
          {[
            { i: <FolderInput size={22} />, l: "Move", f: () => A.move(chosen) },
            { i: <Copy size={22} />, l: "Copy", f: () => A.copy(chosen) },
            { i: <FolderPlus size={22} />, l: "Add to album", f: () => A.copy(chosen, "Add to album") },
            ...(p.inAlbum ? [{ i: <FolderMinus size={22} />, l: "Remove from album", f: () => A.removeFromAlbum(chosen) }] : []),
            ...(p.inAlbum ? [{ i: <ArrowUpToLine size={22} />, l: "Move to top (custom order)", f: () => A.toTop(chosen) }] : []),
            { i: <Heart size={22} />, l: "Favourite", f: () => A.favorite(chosen, true) },
            { i: <HeartOff size={22} />, l: "Unfavourite", f: () => A.favorite(chosen, false) },
            { i: <Lock size={22} />, l: "Hide (private)", f: () => A.hide(chosen) },
            { i: <EyeOff size={22} />, l: "Unhide", f: () => A.unhide(chosen) },
            { i: <Archive size={22} />, l: p.scope === "archived" ? "Unarchive" : "Archive", f: () => A.archive(chosen, p.scope !== "archived") },
            { i: <Info size={22} />, l: "Information", f: () => setInfo(chosen) },
            { i: <Download size={22} />, l: "Download", f: () => A.share(chosen, true) },
          ].map((b) => (
            <button key={b.l} onClick={() => { setSheet(null); b.f(); }} className="card press flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium">{b.i}{b.l}</button>
          ))}
        </div>
      </Sheet>

      {/* Sort sheet */}
      <Sheet open={sheet === "sort"} onClose={() => setSheet(null)} title="Sort by">
        <div className="space-y-1 pb-2">
          {sortOpts.map((o) => (
            <button key={o.key} onClick={() => setSort(o.key)} className="press flex w-full items-center justify-between rounded-2xl px-4 py-3 text-left font-medium hover:bg-[var(--card)]">
              {o.label}{sort === o.key && <Check size={18} className="accent-text" />}
            </button>
          ))}
          <p className="muted px-4 pt-2 text-xs">Remembered separately for “{p.title}”{kind ? ` (${kind === "video" ? "videos" : "photos"})` : ""}.</p>
        </div>
      </Sheet>

      {/* View options sheet */}
      <Sheet open={sheet === "view"} onClose={() => setSheet(null)} title="View options">
        <div className="space-y-5 px-1 pb-3">
          <div>
            <div className="mb-1 flex justify-between text-sm font-medium"><span>Thumbnail size</span><span className="muted">{s.gridCols} per row</span></div>
            <Slider min={2} max={7} value={9 - s.gridCols} onChange={(v) => update({ gridCols: 9 - v })} />
            <div className="muted flex justify-between text-[11px]"><span>Smaller</span><span>Larger</span></div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-sm font-medium"><span>Spacing</span><span className="muted">{s.gridGap}px</span></div>
            <Slider min={0} max={12} value={s.gridGap} onChange={(v) => update({ gridGap: v })} />
          </div>
          {DATE_SORTS.has(sort) && (
            <div>
              <div className="mb-1.5 text-sm font-medium">Group by</div>
              <Segmented value={group} onChange={(v) => update({ groups: { ...s.groups, [p.prefKey]: v } })} options={[{ v: "day", label: "Day" }, { v: "month", label: "Month" }, { v: "year", label: "Year" }]} />
            </div>
          )}
          <Btn className="w-full" onClick={() => { setSheet(null); setSelMode(true); }}><CheckSquare size={16} />Select items</Btn>
        </div>
      </Sheet>

      <ImportSheet open={sheet === "import"} onClose={() => setSheet(null)} albumId={p.albumId} onDone={() => setReloadKey((k) => k + 1)} />
      <InfoSheet items={info} onClose={() => setInfo(null)} />

      {viewer !== null && items[viewer] && (
        <Viewer items={items} index={Math.min(viewer, items.length - 1)} setIndex={setViewer} total={total}
          onLoadMore={() => { if (!loading && items.length < total) load(items.length, false); }}
          onClose={() => setViewer(null)} onChange={onChange} mode={p.mode ?? "normal"} albumId={p.albumId} retention={retention} />
      )}
      {viewer !== null && !items[viewer] && <ViewerCloser onClose={() => setViewer(null)} />}
    </div>
  );
}

function ViewerCloser({ onClose }: { onClose: () => void }) {
  useEffect(() => { onClose(); }, [onClose]);
  return null;
}

function SelBtn({ icon, label, onClick, disabled, danger }: { icon: ReactNode; label: string; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled} className={`press flex min-w-[56px] flex-1 flex-col items-center gap-0.5 rounded-[22px] py-2 text-[10.5px] font-semibold disabled:opacity-35 ${danger ? "text-[var(--danger)]" : ""}`}>{icon}{label}</button>
  );
}

export function CameraSetup({ onDone }: { onDone: () => void }) {
  const { s } = useSettings();
  const d = useDialogs();
  const folder = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [sample, setSample] = useState(false);

  const pickExisting = async () => {
    const r = await d.pickAlbum({ title: "Which album is your Camera folder?" });
    if (!r) return;
    try {
      let id = r.albumId;
      if (!id) { const a = await api<Album>("/api/albums", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: r.albumName }) }); id = a.id; }
      await patch(`/api/albums/${id}`, { isCamera: true });
      d.toast("Camera folder set"); onDone();
    } catch (e) { d.toast((e as Error).message); }
  };
  return (
    <>
      <Empty icon={<Camera size={36} />} title="Camera folder not found" text="Home only shows photos and videos from your Camera folder (DCIM/Camera). Import that folder so it can be identified by its real path — or tell the app which album is your Camera folder.">
        <input ref={folder} type="file" multiple hidden {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
          onChange={async (e) => {
            const l = Array.from(e.target.files ?? []); e.target.value = "";
            if (!l.length) return;
            setBusy("Importing…");
            const r = await importFiles(l, s, { usePaths: true }, (a, b) => setBusy(`Importing ${a}/${b}…`));
            setBusy(null); d.toast(`Imported ${r.ok} items`); onDone();
          }} />
        <Btn kind="accent" onClick={() => folder.current?.click()} disabled={!!busy}><Camera size={16} />{busy ?? "Select Camera folder"}</Btn>
        <Btn onClick={pickExisting}>Use an existing album</Btn>
        <Btn onClick={() => setSample(true)}>Add sample photos</Btn>
      </Empty>
      <ImportSheet open={sample} onClose={() => setSample(false)} onDone={onDone} />
    </>
  );
}
