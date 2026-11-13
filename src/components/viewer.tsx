"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Heart, Info, Share2, Pencil, RotateCw, Trash2, MoreHorizontal, RotateCcw, Image as ImageIcon, Play, Pause, Archive,
  Lock, FolderInput, Copy, FolderPlus, FileImage, ExternalLink, Presentation, Type, EyeOff, Sparkles, Save, FolderMinus,
} from "lucide-react";
import type { Item } from "@/lib/types";
import { batch, prevUrl, origUrl } from "@/lib/api";
import { fmtDate, fmtSize, daysLeft } from "@/lib/format";
import { canvasToBlob, convertImage, decodeImage, loadOriginalBlobUrl, shareItems, uploadOne } from "@/lib/imaging";
import { InfoSheet, useActions, type Change } from "./actions";
import { useDialogs, useSettings } from "./providers";
import { Sheet } from "./ui";
import VideoPlayer from "./video-player";

type Props = {
  items: Item[]; index: number; setIndex: (i: number) => void; total: number; onLoadMore: () => void; onClose: () => void;
  onChange: (c: Change) => void; mode: "normal" | "trash" | "vault"; albumId?: number; retention: number;
};

export default function Viewer({ items, index, setIndex, total, onLoadMore, onClose, onChange, mode, albumId, retention }: Props) {
  const router = useRouter();
  const d = useDialogs();
  const { s } = useSettings();
  const A = useActions({ albumId, onChange });
  const it = items[index];
  const prev = items[index - 1];
  const next = items[index + 1];

  const root = useRef<HTMLDivElement>(null);
  const zoomEl = useRef<HTMLDivElement>(null);
  const pager = useRef<HTMLDivElement>(null);
  const bg = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [controls, setControls] = useState(true);
  const [rot, setRot] = useState(0);
  const [sheet, setSheet] = useState<null | "more" | "convert">(null);
  const [info, setInfo] = useState(false);
  const [slideshow, setSlideshow] = useState(false);
  const [hd, setHd] = useState<{ url: string; w: number; h: number; size: number } | null>(null);
  const [hdOffer, setHdOffer] = useState(false);
  const [hdBusy, setHdBusy] = useState(false);
  const [scaleShown, setScaleShown] = useState(1);

  const t = useRef({ sc: 1, tx: 0, ty: 0, pts: new Map<number, { x: number; y: number }>(), mode: "none" as "none" | "pan" | "pinch" | "x" | "y", sx: 0, sy: 0, tx0: 0, ty0: 0, sc0: 1, d0: 0, m0: { x: 0, y: 0 }, dx: 0, dy: 0, moved: false, lastTap: 0, lx: 0, ly: 0, timer: 0 as unknown as ReturnType<typeof setTimeout>, vt: 0, vx: 0, offerTimer: 0 as unknown as ReturnType<typeof setTimeout> });
  const live = useRef({ it, rot, box, hd, s, prev, next, index, items });
  live.current = { it, rot, box, hd, s, prev, next, index, items };

  const apply = (anim = false) => {
    const el = zoomEl.current;
    if (!el) return;
    el.style.transition = anim ? "transform 240ms cubic-bezier(.2,.8,.2,1)" : "none";
    el.style.transform = `translate3d(${t.current.tx}px, ${t.current.ty + (t.current.mode === "y" ? t.current.dy : 0)}px, 0) scale(${t.current.sc})`;
  };
  const setPager = (x: number, anim: boolean) => {
    if (!pager.current) return;
    pager.current.style.transition = anim ? "transform 240ms cubic-bezier(.2,.8,.2,1)" : "none";
    pager.current.style.transform = `translate3d(${x}px,0,0)`;
  };

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Reset per-item state
  useLayoutEffect(() => {
    const x = t.current;
    x.sc = 1; x.tx = 0; x.ty = 0; x.dx = 0; x.dy = 0; x.mode = "none";
    setScaleShown(1);
    apply(false); setPager(0, false);
    if (bg.current) bg.current.style.opacity = "1";
    setRot(0); setHdOffer(false);
    setHd((h) => { if (h) URL.revokeObjectURL(h.url); return null; });
    if (s.showInfoOnOpen && it?.kind === "image") setInfo(true);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it?.id]);

  useEffect(() => {
    if (!it || mode !== "normal") return;
    const id = setTimeout(() => batch("view", [it.id]).catch(() => {}), 800);
    return () => clearTimeout(id);
  }, [it?.id, mode]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (index >= items.length - 6 && items.length < total) onLoadMore(); }, [index, items.length, total, onLoadMore]);
  useEffect(() => () => { setHd((h) => { if (h) URL.revokeObjectURL(h.url); return null; }); }, []);

  const go = useCallback((delta: number, animated = true) => {
    const L = live.current;
    const ni = L.index + delta;
    if (ni < 0 || ni >= L.items.length) { setPager(0, true); return; }
    if (animated) {
      setPager(-delta * L.box.w, true);
      setTimeout(() => setIndex(ni), 200);
    } else setIndex(ni);
  }, [setIndex]);

  // keyboard
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1, false);
      else if (e.key === "ArrowLeft") go(-1, false);
      else if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [go, onClose]);

  // slideshow
  useEffect(() => {
    if (!slideshow) return;
    const id = setTimeout(() => { if (live.current.index < live.current.items.length - 1) go(1, true); else setIndex(0); }, (it?.kind === "video" ? 1500 : s.slideshowSeconds * 1000));
    return () => clearTimeout(id);
  }, [slideshow, index, go, setIndex, s.slideshowSeconds, it?.kind]);

  // lock body scroll
  useEffect(() => { const o = document.body.style.overflow; document.body.style.overflow = "hidden"; return () => { document.body.style.overflow = o; }; }, []);

  if (!it) return null;

  const dims = () => {
    const L = live.current;
    const w = L.hd?.w || L.it.width || L.it.previewWidth || 4;
    const h = L.hd?.h || L.it.height || L.it.previewHeight || 3;
    const odd = L.rot % 180 !== 0;
    const ar = odd ? h / w : w / h;
    const fw = Math.min(L.box.w, L.box.h * ar);
    return { fw, fh: fw / ar };
  };
  const clamp = () => {
    const x = t.current;
    const { fw, fh } = dims();
    const mx = Math.max(0, (fw * x.sc - live.current.box.w) / 2);
    const my = Math.max(0, (fh * x.sc - live.current.box.h) / 2);
    x.tx = Math.min(mx, Math.max(-mx, x.tx));
    x.ty = Math.min(my, Math.max(-my, x.ty));
  };
  const rel = (e: { clientX: number; clientY: number }) => {
    const r = root.current!.getBoundingClientRect();
    return { x: e.clientX - r.left - r.width / 2, y: e.clientY - r.top - r.height / 2 };
  };

  const hdAvailable = it.kind === "image" && it.hasPreview && it.previewWidth > 0 && it.width > it.previewWidth * 1.05;
  const maxZoom = hd || !hdAvailable ? 10 : 6;

  const zoomTo = (sc: number, p: { x: number; y: number }) => {
    const x = t.current;
    const k = sc / x.sc;
    x.tx = p.x - (p.x - x.tx) * k;
    x.ty = p.y - (p.y - x.ty) * k;
    x.sc = sc;
    if (sc <= 1.001) { x.tx = 0; x.ty = 0; x.sc = 1; }
    clamp(); apply(true); setScaleShown(x.sc);
  };

  const onDouble = (p: { x: number; y: number }) => {
    const L = live.current;
    if (!L.s.doubleTapZoom) return;
    const x = t.current;
    if (x.sc > 1.05) zoomTo(1, p);
    else {
      zoomTo(L.s.defaultZoom, p);
      if (L.s.hdPreview && hdAvailable && !L.hd) {
        setHdOffer(true);
        clearTimeout(x.offerTimer);
        x.offerTimer = setTimeout(() => setHdOffer(false), 6000);
      }
    }
  };

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const x = t.current;
    x.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (x.pts.size === 1) {
      x.sx = e.clientX; x.sy = e.clientY; x.tx0 = x.tx; x.ty0 = x.ty; x.moved = false; x.mode = "none"; x.dx = 0; x.dy = 0; x.vt = performance.now(); x.vx = 0; x.lx = e.clientX;
    } else if (x.pts.size === 2) {
      const [a, b] = [...x.pts.values()];
      x.mode = "pinch"; x.moved = true;
      x.d0 = Math.hypot(a.x - b.x, a.y - b.y) || 1; x.sc0 = x.sc;
      x.m0 = rel({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 }); x.tx0 = x.tx; x.ty0 = x.ty;
      setPager(0, false);
    }
  };
  const move = (e: React.PointerEvent) => {
    const x = t.current;
    if (!x.pts.has(e.pointerId)) return;
    x.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (x.mode === "pinch" && x.pts.size >= 2) {
      const [a, b] = [...x.pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const ns = Math.min(maxZoom, Math.max(0.8, x.sc0 * (dist / x.d0)));
      const m = rel({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 });
      const k = ns / x.sc0;
      x.sc = ns; x.tx = m.x - (x.m0.x - x.tx0) * k; x.ty = m.y - (x.m0.y - x.ty0) * k;
      apply(false);
      return;
    }
    if (x.pts.size !== 1) return;
    const dx = e.clientX - x.sx, dy = e.clientY - x.sy;
    if (!x.moved && Math.hypot(dx, dy) < 9) return;
    x.moved = true;
    if (x.mode === "none") {
      if (x.sc > 1.03) x.mode = "pan";
      else if (Math.abs(dx) > Math.abs(dy)) x.mode = live.current.s.swipeNav ? "x" : "pan";
      else x.mode = "y";
    }
    if (x.mode === "pan") { x.tx = x.tx0 + dx; x.ty = x.ty0 + dy; clamp(); apply(false); }
    else if (x.mode === "x") {
      const L = live.current;
      const atEdge = (dx > 0 && !L.prev) || (dx < 0 && !L.next);
      x.dx = atEdge ? dx * 0.3 : dx;
      const now = performance.now();
      x.vx = (e.clientX - x.lx) / Math.max(1, now - x.vt); x.lx = e.clientX; x.vt = now;
      setPager(x.dx, false);
    } else if (x.mode === "y") {
      x.dy = dy;
      apply(false);
      if (bg.current) bg.current.style.opacity = String(Math.max(0.2, 1 - Math.abs(dy) / 420));
    }
  };
  const up = (e: React.PointerEvent) => {
    const x = t.current;
    if (!x.pts.has(e.pointerId)) return;
    x.pts.delete(e.pointerId);
    if (x.mode === "pinch") {
      if (x.pts.size === 1) {
        const [p] = [...x.pts.values()];
        x.mode = "pan"; x.sx = p.x; x.sy = p.y; x.tx0 = x.tx; x.ty0 = x.ty;
      }
      if (x.sc < 1.05) { x.sc = 1; x.tx = 0; x.ty = 0; }
      clamp(); apply(true); setScaleShown(x.sc);
      return;
    }
    if (x.pts.size > 0) return;
    const L = live.current;
    if (x.mode === "x") {
      const w = L.box.w;
      const fling = Math.abs(x.vx) > 0.5;
      if ((x.dx < -w * 0.22 || (fling && x.vx < 0 && x.dx < -30)) && L.next) go(1, true);
      else if ((x.dx > w * 0.22 || (fling && x.vx > 0 && x.dx > 30)) && L.prev) go(-1, true);
      else setPager(0, true);
    } else if (x.mode === "y") {
      if (x.dy > 110) { onClose(); return; }
      x.dy = 0; x.mode = "none"; apply(true);
      if (bg.current) { bg.current.style.transition = "opacity 200ms"; bg.current.style.opacity = "1"; }
    } else if (!x.moved) {
      const now = Date.now();
      const p = rel(e);
      if (now - x.lastTap < 280 && Math.hypot(e.clientX - x.sx, e.clientY - x.sy) < 40) {
        clearTimeout(x.timer); x.lastTap = 0; onDouble(p);
      } else {
        x.lastTap = now;
        clearTimeout(x.timer);
        x.timer = setTimeout(() => { if (slideshow) setSlideshow(false); else setControls((c) => !c); }, 260);
      }
    } else if (x.mode === "pan") { clamp(); apply(false); }
    if ((x.mode as string) !== "y") x.mode = "none";
  };
  const wheel = (e: React.WheelEvent) => {
    const x = t.current;
    zoomTo(Math.min(maxZoom, Math.max(1, x.sc * (e.deltaY < 0 ? 1.2 : 1 / 1.2))), rel(e));
  };

  const loadHd = async () => {
    setHdBusy(true);
    try {
      const r = await loadOriginalBlobUrl(it);
      setHd((old) => { if (old) URL.revokeObjectURL(old.url); return r; });
      setHdOffer(false);
      d.toast(`Showing original quality · ${r.w}×${r.h}`);
    } catch (e) { d.toast((e as Error).message); }
    setHdBusy(false);
  };
  const backToNormal = () => { setHd((old) => { if (old) URL.revokeObjectURL(old.url); return null; }); };

  const saveRotation = async () => {
    try {
      d.toast("Saving rotation…");
      const blob = await (await fetch(origUrl(it))).blob();
      const dec = await decodeImage(blob, it.format);
      const odd = rot % 180 !== 0;
      const c = document.createElement("canvas");
      c.width = odd ? dec.h : dec.w; c.height = odd ? dec.w : dec.h;
      const x = c.getContext("2d")!;
      x.translate(c.width / 2, c.height / 2); x.rotate((rot * Math.PI) / 180); x.drawImage(dec.src, -dec.w / 2, -dec.h / 2);
      dec.close();
      const type = it.format === "png" ? "image/png" : "image/jpeg";
      const out = await canvasToBlob(c, type, s.editorQuality / 100);
      const name = it.name.replace(/(\.[^.]+)$/, s.preserveOriginal ? "_rotated$1" : "$1");
      await uploadOne(new File([out], name.replace(/\.(avif|heic|webp|bmp|heif)$/i, type === "image/png" ? ".png" : ".jpg"), { type }), s, s.preserveOriginal ? { albumId: it.albumId, takenAt: it.takenAt, edited: true } : { replaceId: it.id });
      onChange({ type: "reload" });
      d.toast(s.preserveOriginal ? "Saved rotated copy" : "Rotation saved");
      setRot(0);
    } catch (e) { d.toast((e as Error).message); }
  };

  const toggleFav = () => A.favorite([it], !it.favorite);
  const closeSheetThen = (f: () => void) => () => { setSheet(null); f(); };

  if (it.kind === "video") {
    return (
      <VideoPlayer key={it.id} item={it} hasPrev={!!prev} hasNext={!!next} onPrev={() => setIndex(index - 1)} onNext={() => setIndex(index + 1)} onClose={onClose}
        onEdit={() => router.push(`/edit/${it.id}`)} onShare={() => A.share([it])} onDelete={() => (mode === "trash" ? A.purge([it]) : A.trash([it]))}
        onFavorite={toggleFav} />
    );
  }

  const { fw, fh } = dims();
  const odd = rot % 180 !== 0;
  const imgW = odd ? fh : fw, imgH = odd ? fw : fh;
  const slideImg = (x: Item | undefined, offset: number) =>
    x && x.kind === "image" ? (
      <div className="absolute inset-0 grid place-items-center" style={{ transform: `translate3d(${offset * 100}%,0,0)` }}>
        <img src={prevUrl(x)} alt="" draggable={false} className="max-h-full max-w-full object-contain" />
      </div>
    ) : null;

  const trashed = !!it.trashedAt;
  return (
    <div ref={root} className="fixed inset-0 z-[60] overflow-hidden select-none" style={{ touchAction: "none" }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
      <div ref={bg} className="absolute inset-0 bg-black" />
      <div ref={pager} className="absolute inset-0 will-change-transform">
        {slideImg(prev, -1)}
        {slideImg(next, 1)}
        <div ref={zoomEl} className="absolute inset-0 grid place-items-center will-change-transform">
          {it.width === 0 && !it.hasPreview && (it.format === "heic" || it.format === "heif") ? (
            <div className="text-center text-white/80"><ImageIcon size={48} className="mx-auto mb-3" /><div className="font-semibold">{it.format.toUpperCase()} can’t be decoded in this browser</div><div className="mt-1 text-sm text-white/60">The file is stored safely. You can share or open it with another app.</div></div>
          ) : (
            <img key={(hd?.url ?? "p") + it.id} src={hd?.url ?? prevUrl(it)} alt={it.name} draggable={false} decoding="async"
              style={{ width: imgW, height: imgH, maxWidth: "none", transform: `rotate(${rot}deg)`, transition: "transform 220ms" }} className="object-contain" />
          )}
        </div>
      </div>

      {/* HD preview chip */}
      {(hdOffer || hd) && (
        <div className="absolute inset-x-0 top-20 z-10 flex justify-center px-4">
          <div className="on-media anim-pop flex items-center gap-3 rounded-full py-2 pl-4 pr-2 text-sm">
            <Sparkles size={16} className="text-yellow-300" />
            {hd ? (
              <><span>Original · {hd.w}×{hd.h} · {fmtSize(hd.size)}</span><button className="rounded-full bg-white/20 px-3 py-1.5 font-semibold" onClick={backToNormal}>Normal</button></>
            ) : (
              <><span>HD original available · {it.width}×{it.height}</span><button disabled={hdBusy} className="rounded-full bg-white px-3 py-1.5 font-semibold text-black" onClick={loadHd}>{hdBusy ? "Loading…" : "Preview HD"}</button></>
            )}
          </div>
        </div>
      )}

      {/* Top bar */}
      <div className={`absolute inset-x-0 top-0 z-20 px-3 safe-top transition-opacity duration-200 ${controls && !slideshow ? "opacity-100" : "pointer-events-none opacity-0"}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="on-media flex items-center gap-1 rounded-[26px] px-1.5 py-1.5">
          <button aria-label="Back" className="press grid h-10 w-10 place-items-center rounded-full" onClick={onClose}><ArrowLeft size={20} /></button>
          <div className="min-w-0 flex-1 px-1">
            <div className="truncate text-sm font-semibold">{it.name}</div>
            <div className="truncate text-[11px] text-white/70">
              {trashed ? `Deleted ${fmtDate(it.trashedAt!)} · ${daysLeft(it.trashedAt!, retention)} days left${it.trashAlbumName ? ` · from ${it.trashAlbumName}` : ""}` : `${fmtDate(it.takenAt)} · ${it.width ? `${it.width}×${it.height} · ` : ""}${fmtSize(it.size)}`}
            </div>
          </div>
          {!trashed && <button aria-label="Favourite" className="press grid h-10 w-10 place-items-center rounded-full" onClick={toggleFav}><Heart size={20} fill={it.favorite ? "#ff453a" : "none"} className={it.favorite ? "text-[#ff453a]" : ""} /></button>}
          <button aria-label="Info" className="press grid h-10 w-10 place-items-center rounded-full" onClick={() => setInfo(true)}><Info size={20} /></button>
        </div>
      </div>

      {/* Bottom bar */}
      <div className={`absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-[max(env(safe-area-inset-bottom),14px)] transition-opacity duration-200 ${controls && !slideshow ? "opacity-100" : "pointer-events-none opacity-0"}`} onPointerDown={(e) => e.stopPropagation()}>
        <div className="on-media flex w-full max-w-md items-center justify-around rounded-[30px] p-1.5">
          {trashed ? (
            <>
              <VB icon={<RotateCcw size={22} />} label="Restore" onClick={() => A.restore([it])} />
              <VB icon={<Info size={22} />} label="Info" onClick={() => setInfo(true)} />
              <VB icon={<Trash2 size={22} />} label="Delete" danger onClick={() => A.purge([it])} />
            </>
          ) : (
            <>
              <VB icon={<Share2 size={22} />} label="Share" onClick={() => A.share([it])} />
              {mode === "vault" ? <VB icon={<EyeOff size={22} />} label="Unhide" onClick={() => A.unhide([it])} /> : <VB icon={<Pencil size={22} />} label="Edit" onClick={() => router.push(`/edit/${it.id}`)} />}
              <VB icon={<RotateCw size={22} />} label="Rotate" onClick={() => setRot((r) => (r + 90) % 360)} />
              <VB icon={<Trash2 size={22} />} label="Delete" danger onClick={() => (mode === "vault" ? A.purge([it]) : A.trash([it]))} />
              <VB icon={<MoreHorizontal size={22} />} label="More" onClick={() => setSheet("more")} />
            </>
          )}
        </div>
      </div>

      {slideshow && <div className="on-media absolute bottom-8 left-1/2 z-20 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold" onPointerDown={(e) => e.stopPropagation()}><button className="flex items-center gap-2" onClick={() => setSlideshow(false)}><Pause size={14} />Stop slideshow</button></div>}
      {!slideshow && controls && scaleShown > 1.05 && <div className="on-media pointer-events-none absolute left-1/2 top-[88px] z-10 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold">{scaleShown.toFixed(1)}×</div>}

      <div onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => e.stopPropagation()}>
        <InfoSheet items={info ? [it] : null} onClose={() => setInfo(false)} />
        <Sheet open={sheet === "more"} onClose={() => setSheet(null)} title="More" z={90}>
          <div className="grid grid-cols-3 gap-2 pb-2">
            {[
              { i: <Presentation size={22} />, l: "Slideshow", f: () => { setSlideshow(true); setControls(false); } },
              { i: <ExternalLink size={22} />, l: "Open with…", f: () => A.share([it]) },
              { i: <Type size={22} />, l: "Set as wallpaper…", f: async () => { d.toast("Choose “Wallpaper” / “Set as” in the share sheet"); await A.share([it]); } },
              { i: <FileImage size={22} />, l: "Convert to JPEG/PNG", f: () => setSheet("convert") },
              ...(rot ? [{ i: <Save size={22} />, l: "Save rotation", f: saveRotation }] : []),
              { i: <FolderInput size={22} />, l: "Move", f: () => A.move([it]) },
              { i: <Copy size={22} />, l: "Copy", f: () => A.copy([it]) },
              { i: <FolderPlus size={22} />, l: "Add to album", f: () => A.copy([it], "Add to album") },
              ...(albumId ? [{ i: <FolderMinus size={22} />, l: "Remove from album", f: () => A.removeFromAlbum([it]) }] : []),
              { i: <Archive size={22} />, l: it.archived ? "Unarchive" : "Archive", f: () => A.archive([it], !it.archived) },
              { i: <Lock size={22} />, l: "Hide (private)", f: () => A.hide([it]) },
              { i: <Pencil size={22} />, l: "Rename", f: () => A.rename(it) },
              { i: <Info size={22} />, l: "Metadata", f: () => setInfo(true) },
              ...(hdAvailable ? [{ i: <Sparkles size={22} />, l: hd ? "Normal preview" : "Preview HD", f: () => (hd ? backToNormal() : loadHd()) }] : []),
            ].map((b) => (
              <button key={b.l} onClick={closeSheetThen(b.f)} className="card press flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium">{b.i}{b.l}</button>
            ))}
          </div>
        </Sheet>
        <Sheet open={sheet === "convert"} onClose={() => setSheet(null)} title="Convert (saves a new copy)" z={90}>
          <div className="space-y-2 pb-2">
            {(["jpeg", "png"] as const).map((f) => (
              <button key={f} className="card press w-full rounded-2xl px-4 py-3.5 text-left font-semibold" onClick={async () => {
                setSheet(null);
                try { d.toast(`Converting ${it.format.toUpperCase()} → ${f.toUpperCase()}…`); await convertImage(it, f, s); onChange({ type: "reload" }); d.toast("Converted copy saved in the same album"); } catch (e) { d.toast((e as Error).message); }
              }}>{it.format.toUpperCase()} → {f.toUpperCase()}<div className="muted text-xs font-normal">{it.format === "avif" ? "Decoded by the bundled AVIF decoder when the browser can’t" : "Original stays untouched"}</div></button>
            ))}
          </div>
        </Sheet>
      </div>
    </div>
  );
}

function VB({ icon, label, onClick, danger }: { icon: React.ReactNode; label: string; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={`press flex min-w-[54px] flex-1 flex-col items-center gap-0.5 rounded-[22px] py-2 text-[10.5px] font-semibold ${danger ? "text-[#ff6b61]" : ""}`}>{icon}{label}</button>;
}
// keep imports referenced for tree-shaking friendliness
void Play; void shareItems;
