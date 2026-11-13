"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowLeft, Undo2, Redo2, RotateCcw, RotateCw, FlipHorizontal, FlipVertical, Crop as CropIcon, SlidersHorizontal, Wand2, Pencil, Type, Smile, Frame, Droplets, Save, Eye, Trash2, Check,
} from "lucide-react";
import type { Item } from "@/lib/types";
import { origUrl } from "@/lib/api";
import { canvasToBlob, decodeImage, uploadOne } from "@/lib/imaging";
import { ADJ_KEYS, ADJ_LABELS, ADJ_RANGE, FILTERS, FRAMES, baseKey, composite, defaultEdit, renderBase, type AdjKey, type Crop, type DrawShape, type EditState, type Overlay } from "@/lib/photo-engine";
import { useDialogs, useSettings } from "./providers";
import { Btn, Chip, Segmented, Sheet, Slider, Spinner } from "./ui";

type Tool = "crop" | "geo" | "adjust" | "filters" | "draw" | "text" | "stickers" | "frames" | "fx";
const TOOLS: { id: Tool; label: string; icon: React.ReactNode }[] = [
  { id: "crop", label: "Crop", icon: <CropIcon size={20} /> }, { id: "geo", label: "Rotate", icon: <RotateCw size={20} /> },
  { id: "adjust", label: "Adjust", icon: <SlidersHorizontal size={20} /> }, { id: "filters", label: "Filters", icon: <Wand2 size={20} /> },
  { id: "draw", label: "Draw", icon: <Pencil size={20} /> }, { id: "text", label: "Text", icon: <Type size={20} /> },
  { id: "stickers", label: "Stickers", icon: <Smile size={20} /> }, { id: "frames", label: "Frames", icon: <Frame size={20} /> },
  { id: "fx", label: "Blur & fix", icon: <Droplets size={20} /> },
];
const ASPECTS: { k: string; label: string; r?: number }[] = [
  { k: "free", label: "Free" }, { k: "orig", label: "Original" }, { k: "1:1", label: "1:1", r: 1 }, { k: "4:3", label: "4:3", r: 4 / 3 }, { k: "3:4", label: "3:4", r: 3 / 4 },
  { k: "16:9", label: "16:9", r: 16 / 9 }, { k: "9:16", label: "9:16", r: 9 / 16 },
];
const COLORS = ["#ffffff", "#000000", "#ff453a", "#ff9f0a", "#ffd60a", "#30d158", "#0a84ff", "#bf5af2", "#ff2d55"];
const EMOJI = ["😀", "😍", "😎", "🥳", "🔥", "❤️", "⭐", "✨", "🎉", "🌈", "🌸", "🍕", "🐶", "🐱", "👑", "💯", "✅", "❌", "👍", "💬", "☀️", "🌙", "🎈", "📍"];
const SHAPES: { k: DrawShape; label: string }[] = [{ k: "pen", label: "Pen" }, { k: "marker", label: "Marker" }, { k: "line", label: "Line" }, { k: "arrow", label: "Arrow" }, { k: "rect", label: "Box" }, { k: "oval", label: "Oval" }, { k: "blur", label: "Blur brush" }];
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

export default function PhotoEditor({ item }: { item: Item }) {
  const router = useRouter();
  const d = useDialogs();
  const { s } = useSettings();
  const [ready, setReady] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("adjust");
  const [st, setSt] = useState<EditState>(defaultEdit());
  const [histLen, setHistLen] = useState(1);
  const [hi, setHi] = useState(0);
  const [compare, setCompare] = useState(false);
  const [adjKey, setAdjKey] = useState<AdjKey>("brightness");
  const [aspect, setAspect] = useState("free");
  const [shape, setShape] = useState<DrawShape>("pen");
  const [color, setColor] = useState("#ff453a");
  const [pen, setPen] = useState(0.008);
  const [fxMode, setFxMode] = useState<"blur" | "focus" | "redeye">("blur");
  const [redR, setRedR] = useState(0.035);
  const [textVal, setTextVal] = useState("Hello");
  const [bold, setBold] = useState(true);
  const [tbg, setTbg] = useState(false);
  const [sel, setSel] = useState<number | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [exportOpen, setExportOpen] = useState(false);
  const [fmt, setFmt] = useState<"jpeg" | "png" | "webp">(s.editorFormat);
  const [quality, setQuality] = useState(s.editorQuality);
  const [size, setSize] = useState<string>(s.editorMaxSize ? String(s.editorMaxSize) : "orig");
  const [busy, setBusy] = useState<string | null>(null);
  const [rect, setRect] = useState({ l: 0, t: 0, w: 1, h: 1 });

  const stage = useRef<HTMLDivElement>(null);
  const disp = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const work = useRef<{ c: HTMLCanvasElement; w: number; h: number } | null>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const lastKey = useRef("");
  const stRef = useRef(st); stRef.current = st;
  const hist = useRef<EditState[]>([defaultEdit()]);
  const hiRef = useRef(0);
  const live = useRef<Overlay | null>(null);
  const drag = useRef<null | { kind: "crop"; h: string; sx: number; sy: number; c: Crop } | { kind: "draw" } | { kind: "move"; i: number }>(null);

  const interactive = tool === "draw" || tool === "text" || tool === "stickers" || (tool === "fx" && fxMode !== "blur");

  /* ---------- history ---------- */
  const push = useCallback((next: EditState) => {
    if (JSON.stringify(next) === JSON.stringify(hist.current[hiRef.current])) return;
    hist.current = [...hist.current.slice(0, hiRef.current + 1), clone(next)];
    hiRef.current = hist.current.length - 1;
    setHistLen(hist.current.length); setHi(hiRef.current);
  }, []);
  const update = useCallback((fn: (s: EditState) => EditState, commit = true) => {
    const next = fn(clone(stRef.current));
    stRef.current = next; setSt(next);
    if (commit) push(next);
  }, [push]);
  const commit = useCallback(() => push(stRef.current), [push]);
  const goHist = (i: number) => { if (i < 0 || i >= hist.current.length) return; hiRef.current = i; setHi(i); const n = clone(hist.current[i]); stRef.current = n; setSt(n); setSel(null); };

  /* ---------- load ---------- */
  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const blob = await (await fetch(origUrl(item))).blob();
        blobRef.current = blob;
        const dec = await decodeImage(blob, item.format);
        const sc = Math.min(1, (s.lowMemory ? 1000 : 1400) / Math.max(dec.w, dec.h));
        const c = document.createElement("canvas");
        c.width = Math.round(dec.w * sc); c.height = Math.round(dec.h * sc);
        const x = c.getContext("2d")!; x.imageSmoothingQuality = "high"; x.drawImage(dec.src, 0, 0, c.width, c.height);
        work.current = { c, w: c.width, h: c.height };
        dec.close();
        if (dead) return;
        const t: Record<string, string> = {};
        for (const k of Object.keys(FILTERS)) {
          const e = defaultEdit(); e.filter = k;
          const b = renderBase(c, c.width, c.height, e, { maxDim: 96 });
          t[k] = b.toDataURL("image/jpeg", 0.6); b.width = b.height = 0;
        }
        setThumbs(t); setReady(true);
      } catch (e) { setErr((e as Error).message || "Could not open this image"); }
    })();
    return () => { dead = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  /* ---------- painting ---------- */
  const measure = useCallback(() => {
    const a = stage.current?.getBoundingClientRect(), b = disp.current?.getBoundingClientRect();
    if (!a || !b) return;
    setRect((r) => (Math.abs(r.l - (b.left - a.left)) < 0.5 && Math.abs(r.t - (b.top - a.top)) < 0.5 && Math.abs(r.w - b.width) < 0.5 && Math.abs(r.h - b.height) < 0.5 ? r : { l: b.left - a.left, t: b.top - a.top, w: b.width, h: b.height }));
  }, []);
  const paint = useCallback((lv?: Overlay | null) => {
    const base = baseRef.current, cv = disp.current;
    if (!base || !cv) return;
    const stp = compare ? defaultEdit() : { ...stRef.current, frame: interactive ? "none" : stRef.current.frame };
    const out = composite(base, stp, lv);
    cv.width = out.width; cv.height = out.height;
    cv.getContext("2d")!.drawImage(out, 0, 0);
    out.width = out.height = 0;
    requestAnimationFrame(measure);
  }, [compare, interactive, measure]);

  useEffect(() => {
    if (!ready || !work.current) return;
    const eff = compare ? defaultEdit() : st;
    const key = baseKey(eff, tool === "crop") + (compare ? "c" : "");
    if (key === lastKey.current && baseRef.current) { paint(); return; }
    const id = requestAnimationFrame(() => {
      lastKey.current = key;
      if (baseRef.current) baseRef.current.width = 0;
      const w = work.current!;
      baseRef.current = renderBase(w.c, w.w, w.h, eff, { maxDim: s.lowMemory ? 800 : 1100, ignoreCrop: tool === "crop" });
      paint();
    });
    return () => cancelAnimationFrame(id);
  }, [st, tool, ready, compare, paint, s.lowMemory]);
  useEffect(() => { window.addEventListener("resize", measure); return () => window.removeEventListener("resize", measure); }, [measure]);

  /* ---------- crop ---------- */
  const gAspect = rect.w / Math.max(1, rect.h);
  const applyAspect = (k: string) => {
    setAspect(k);
    const r = k === "free" ? undefined : k === "orig" ? gAspect : ASPECTS.find((a) => a.k === k)?.r;
    if (!r) return;
    let w = 1, h = 1;
    if (r > gAspect) h = gAspect / r; else w = r / gAspect;
    update((x) => { x.crop = { x: (1 - w) / 2, y: (1 - h) / 2, w, h }; return x; });
  };
  const cropDown = (e: React.PointerEvent, h: string) => {
    e.stopPropagation(); e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    drag.current = { kind: "crop", h, sx: e.clientX, sy: e.clientY, c: { ...stRef.current.crop } };
  };
  const cropMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (!dr || dr.kind !== "crop") return;
    const dx = (e.clientX - dr.sx) / rect.w, dy = (e.clientY - dr.sy) / rect.h, c0 = dr.c;
    const lock = aspect === "free" ? undefined : aspect === "orig" ? gAspect : ASPECTS.find((a) => a.k === aspect)?.r;
    let nc: Crop;
    if (dr.h === "move") nc = { ...c0, x: Math.min(1 - c0.w, Math.max(0, c0.x + dx)), y: Math.min(1 - c0.h, Math.max(0, c0.y + dy)) };
    else {
      const west = dr.h.includes("w"), north = dr.h.includes("n");
      const ax = west ? c0.x + c0.w : c0.x, ay = north ? c0.y + c0.h : c0.y;
      let cx = Math.min(1, Math.max(0, (west ? c0.x : c0.x + c0.w) + dx)), cy = Math.min(1, Math.max(0, (north ? c0.y : c0.y + c0.h) + dy));
      let w = Math.max(0.06, Math.abs(cx - ax)), h = Math.max(0.06, Math.abs(cy - ay));
      const maxW = cx < ax ? ax : 1 - ax, maxH = cy < ay ? ay : 1 - ay;
      w = Math.min(w, maxW); h = Math.min(h, maxH);
      if (lock) { h = (w * rect.w) / (rect.h * lock); if (h > maxH) { h = maxH; w = (h * rect.h * lock) / rect.w; } }
      cx = cx < ax ? ax - w : ax; cy = cy < ay ? ay - h : ay;
      nc = { x: cx, y: cy, w, h };
    }
    update((x) => { x.crop = nc; return x; }, false);
  };

  /* ---------- canvas pointer (draw / text / sticker / fx) ---------- */
  const norm = (e: React.PointerEvent): [number, number] => [Math.min(1, Math.max(0, (e.clientX - rect.l - (stage.current?.getBoundingClientRect().left ?? 0)) / rect.w)), Math.min(1, Math.max(0, (e.clientY - rect.t - (stage.current?.getBoundingClientRect().top ?? 0)) / rect.h))];
  const nearest = (p: [number, number]) => {
    let best = -1, bd = 0.16;
    stRef.current.overlays.forEach((o, i) => { if (o.t === "text" || o.t === "sticker") { const dd = Math.hypot(o.x - p[0], (o.y - p[1]) * (rect.h / rect.w)); if (dd < bd) { bd = dd; best = i; } } });
    return best;
  };
  const padDown = (e: React.PointerEvent) => {
    const p = norm(e);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (tool === "draw" || (tool === "fx" && false)) {
      live.current = { t: "draw", shape, color, size: pen, pts: [p] };
      drag.current = { kind: "draw" };
      paint(live.current);
    } else if (tool === "text" || tool === "stickers") {
      const i = nearest(p);
      if (i >= 0) { setSel(i); const o = stRef.current.overlays[i]; if (o.t === "text") setTextVal(o.text); drag.current = { kind: "move", i }; }
      else if (sel !== null && stRef.current.overlays[sel]) { update((x) => { const o = x.overlays[sel]; if (o && (o.t === "text" || o.t === "sticker")) { o.x = p[0]; o.y = p[1]; } return x; }); }
    } else if (tool === "fx" && fxMode === "focus") update((x) => { x.bgFocus = { x: p[0], y: p[1] }; return x; });
    else if (tool === "fx" && fxMode === "redeye") { update((x) => { x.overlays.push({ t: "redeye", x: p[0], y: p[1], r: redR }); return x; }); d.toast("Red-eye corrected — tap other eye or undo"); }
  };
  const padMove = (e: React.PointerEvent) => {
    const dr = drag.current;
    if (!dr) return;
    const p = norm(e);
    if (dr.kind === "draw" && live.current?.t === "draw") {
      const o = live.current;
      if (o.shape === "pen" || o.shape === "marker" || o.shape === "blur") { const l = o.pts[o.pts.length - 1]; if (Math.hypot(l[0] - p[0], l[1] - p[1]) > 0.003) o.pts.push(p); }
      else o.pts = [o.pts[0], p];
      paint(o);
    } else if (dr.kind === "move") update((x) => { const o = x.overlays[dr.i]; if (o && (o.t === "text" || o.t === "sticker")) { o.x = p[0]; o.y = p[1]; } return x; }, false);
  };
  const padUp = () => {
    const dr = drag.current;
    drag.current = null;
    if (dr?.kind === "draw" && live.current) { const o = live.current; live.current = null; update((x) => { x.overlays.push(o); return x; }); }
    else if (dr?.kind === "move") commit();
  };

  const addText = () => {
    if (!textVal.trim()) return;
    update((x) => { x.overlays.push({ t: "text", text: textVal, x: 0.5, y: 0.5, size: 0.07, color, bold, bg: tbg }); return x; });
    setSel(stRef.current.overlays.length - 1);
  };
  const addSticker = (e: string) => { update((x) => { x.overlays.push({ t: "sticker", e, x: 0.5, y: 0.5, size: 0.18 }); return x; }); setSel(stRef.current.overlays.length - 1); };
  const selO = sel !== null ? st.overlays[sel] : undefined;
  const editSel = (fn: (o: Overlay) => void, c = false) => { if (sel === null) return; update((x) => { const o = x.overlays[sel]; if (o) fn(o); return x; }, c); };
  const delSel = () => { if (sel === null) return; update((x) => { x.overlays.splice(sel, 1); return x; }); setSel(null); };

  /* ---------- geometry ---------- */
  const rotate = (dir: number) => update((x) => { x.rot = (x.rot + dir * 90 + 360) % 360; x.crop = { x: 0, y: 0, w: 1, h: 1 }; return x; });

  /* ---------- export ---------- */
  const croppedLong = useMemo(() => { const odd = st.rot % 180 !== 0; const w = odd ? item.height : item.width, h = odd ? item.width : item.height; return Math.max(w * st.crop.w, h * st.crop.h) || 1000; }, [st.rot, st.crop, item.width, item.height]);
  const maxDim = size === "orig" ? (s.lowMemory ? 4096 : 8192) : size.startsWith("p") ? Math.round((croppedLong * Number(size.slice(1))) / 100) : Number(size);
  const save = async (replace: boolean) => {
    setBusy("Rendering…");
    try {
      const blob = blobRef.current!;
      const dec = await decodeImage(blob, item.format);
      const base = renderBase(dec.src, dec.w, dec.h, stRef.current, { maxDim });
      dec.close();
      const out = composite(base, stRef.current);
      base.width = base.height = 0;
      const mime = fmt === "png" ? "image/png" : fmt === "webp" ? "image/webp" : "image/jpeg";
      if (fmt === "jpeg") { const bg = document.createElement("canvas"); bg.width = out.width; bg.height = out.height; const x = bg.getContext("2d")!; x.fillStyle = "#fff"; x.fillRect(0, 0, bg.width, bg.height); x.drawImage(out, 0, 0); out.width = out.height = 0; setBusy("Encoding…"); const b = await canvasToBlob(bg, mime, quality / 100); bg.width = bg.height = 0; await finish(b, mime, replace); return; }
      setBusy("Encoding…");
      const b = await canvasToBlob(out, mime, quality / 100);
      out.width = out.height = 0;
      await finish(b, mime, replace);
    } catch (e) { d.toast((e as Error).message || "Export failed"); setBusy(null); }
  };
  const finish = async (b: Blob, mime: string, replace: boolean) => {
    setBusy("Saving…");
    const ext = fmt === "jpeg" ? "jpg" : fmt;
    const stem = item.name.replace(/\.[^.]+$/, "");
    const name = replace ? `${stem}.${ext}` : `${stem}_edit.${ext}`;
    await uploadOne(new File([b], name, { type: mime, lastModified: new Date(item.takenAt).getTime() }), s, replace ? { replaceId: item.id } : { albumId: item.albumId, takenAt: item.takenAt, edited: true });
    setBusy(null); setExportOpen(false);
    d.toast(replace ? "Original replaced" : "Saved as a new copy — original untouched");
    router.back();
  };
  const close = async () => { if (histLen > 1 && !(await d.confirm({ title: "Discard edits?", message: "Your changes haven’t been saved.", confirmText: "Discard", danger: true }))) return; router.back(); };

  const adjRange = ADJ_RANGE[adjKey];
  const cropRect = { left: st.crop.x * rect.w, top: st.crop.y * rect.h, width: st.crop.w * rect.w, height: st.crop.h * rect.h };

  if (err) return <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--bg)] p-8 text-center"><div><p className="mb-4 font-semibold">{err}</p><Btn onClick={() => router.back()}>Go back</Btn></div></div>;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
      <div className="px-3 safe-top">
        <div className="glass-strong flex items-center gap-1 rounded-[26px] px-1.5 py-1.5">
          <button aria-label="Close" className="press grid h-10 w-10 place-items-center rounded-full" onClick={close}><ArrowLeft size={20} /></button>
          <button aria-label="Undo" disabled={hi === 0} className="press grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" onClick={() => goHist(hi - 1)}><Undo2 size={19} /></button>
          <button aria-label="Redo" disabled={hi >= histLen - 1} className="press grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" onClick={() => goHist(hi + 1)}><Redo2 size={19} /></button>
          <button aria-label="Reset" disabled={histLen <= 1} className="press grid h-10 w-10 place-items-center rounded-full disabled:opacity-30" onClick={() => { update(() => defaultEdit()); setSel(null); setAspect("free"); }}><RotateCcw size={18} /></button>
          <button aria-label="Hold to compare with original" className={`press grid h-10 place-items-center rounded-full px-3 ${compare ? "accent-bg" : ""}`} onPointerDown={() => setCompare(true)} onPointerUp={() => setCompare(false)} onPointerLeave={() => setCompare(false)} onPointerCancel={() => setCompare(false)}><span className="flex items-center gap-1 text-xs font-semibold"><Eye size={16} />Before</span></button>
          <div className="flex-1" />
          <button className="accent-bg press flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold" onClick={() => setExportOpen(true)} disabled={!ready}><Save size={16} />Save</button>
        </div>
      </div>

      <div ref={stage} className="relative min-h-0 flex-1 touch-none overflow-hidden p-3">
        {!ready && <div className="absolute inset-0 grid place-items-center muted"><Spinner size={30} /></div>}
        <div className="absolute inset-3 grid place-items-center">
          <canvas ref={disp} className="max-h-full max-w-full rounded-lg shadow-2xl" style={{ visibility: ready ? "visible" : "hidden" }} />
        </div>
        {ready && compare && <div className="on-media pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-full px-3 py-1 text-xs font-semibold">Original</div>}
        {ready && interactive && !compare && (
          <div className="absolute" style={{ left: rect.l, top: rect.t, width: rect.w, height: rect.h, touchAction: "none", cursor: "crosshair" }} onPointerDown={padDown} onPointerMove={padMove} onPointerUp={padUp} onPointerCancel={padUp}>
            {tool === "fx" && fxMode === "focus" && st.bgBlur > 0 && <div className="pointer-events-none absolute h-12 w-12 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow" style={{ left: `${st.bgFocus.x * 100}%`, top: `${st.bgFocus.y * 100}%` }} />}
            {(tool === "text" || tool === "stickers") && st.overlays.map((o, i) => (o.t === "text" || o.t === "sticker") && i === sel ? <div key={i} className="pointer-events-none absolute -translate-x-1/2 -translate-y-1/2 rounded-lg border-2 border-dashed border-white/90" style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%`, width: o.t === "sticker" ? `${(o.size * rect.h * 1.2)}px` : `${Math.min(rect.w, o.size * rect.h * 0.6 * Math.max(...o.text.split("\n").map((l) => l.length), 2) + 20)}px`, height: o.t === "sticker" ? `${o.size * rect.h * 1.2}px` : `${o.size * rect.h * 1.3 * o.text.split("\n").length}px` }} /> : null)}
          </div>
        )}
        {ready && tool === "crop" && !compare && (
          <div className="absolute" style={{ left: rect.l, top: rect.t, width: rect.w, height: rect.h, touchAction: "none" }}>
            <div className="absolute border-2 border-white" style={{ ...cropRect, boxShadow: "0 0 0 9999px rgba(0,0,0,.55)" }} onPointerDown={(e) => cropDown(e, "move")} onPointerMove={cropMove} onPointerUp={() => { drag.current = null; commit(); }}>
              {[1, 2].map((i) => <div key={i} className="pointer-events-none absolute bg-white/40" style={{ left: `${(i * 100) / 3}%`, top: 0, bottom: 0, width: 1 }} />)}
              {[1, 2].map((i) => <div key={i} className="pointer-events-none absolute bg-white/40" style={{ top: `${(i * 100) / 3}%`, left: 0, right: 0, height: 1 }} />)}
              {["nw", "ne", "sw", "se"].map((h) => (
                <div key={h} className="absolute grid h-11 w-11 place-items-center" style={{ [h.includes("n") ? "top" : "bottom"]: -22, [h.includes("w") ? "left" : "right"]: -22, touchAction: "none" }}
                  onPointerDown={(e) => cropDown(e, h)} onPointerMove={cropMove} onPointerUp={() => { drag.current = null; commit(); }}>
                  <span className="h-5 w-5 rounded-full border-2 border-white bg-[var(--accent)]" />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* tool panel */}
      <div className="px-3">
        <div className="glass-strong mb-2 max-h-[34dvh] overflow-y-auto rounded-[26px] p-3 no-scrollbar">
          {tool === "crop" && (
            <div>
              <div className="no-scrollbar mb-2 flex gap-2 overflow-x-auto">{ASPECTS.map((a) => <Chip key={a.k} active={aspect === a.k} onClick={() => applyAspect(a.k)}>{a.label}</Chip>)}</div>
              <p className="muted text-xs">Drag the box or its corners. Leave the tool to see the cropped result.</p>
              <Btn className="mt-2" onClick={() => { setAspect("free"); update((x) => { x.crop = { x: 0, y: 0, w: 1, h: 1 }; return x; }); }}>Reset crop</Btn>
            </div>
          )}
          {tool === "geo" && (
            <div className="space-y-2">
              <div className="grid grid-cols-4 gap-2">
                {[{ i: <RotateCcw size={20} />, l: "Left", f: () => rotate(-1) }, { i: <RotateCw size={20} />, l: "Right", f: () => rotate(1) }, { i: <FlipHorizontal size={20} />, l: "Flip H", f: () => update((x) => { x.flipH = !x.flipH; return x; }) }, { i: <FlipVertical size={20} />, l: "Flip V", f: () => update((x) => { x.flipV = !x.flipV; return x; }) }].map((b) => <button key={b.l} onClick={b.f} className="card press flex flex-col items-center gap-1 rounded-2xl py-2 text-xs font-medium">{b.i}{b.l}</button>)}
              </div>
              <Lbl t="Straighten" v={`${st.straighten.toFixed(0)}°`}><Slider min={-30} max={30} step={0.5} value={st.straighten} onChange={(v) => update((x) => { x.straighten = v; return x; }, false)} onCommit={commit} /></Lbl>
              <Lbl t="Perspective · vertical" v={String(st.perspV)}><Slider min={-100} max={100} value={st.perspV} onChange={(v) => update((x) => { x.perspV = v; return x; }, false)} onCommit={commit} /></Lbl>
              <Lbl t="Perspective · horizontal" v={String(st.perspH)}><Slider min={-100} max={100} value={st.perspH} onChange={(v) => update((x) => { x.perspH = v; return x; }, false)} onCommit={commit} /></Lbl>
            </div>
          )}
          {tool === "adjust" && (
            <div>
              <div className="no-scrollbar mb-1 flex gap-2 overflow-x-auto">{ADJ_KEYS.map((k) => <Chip key={k} active={adjKey === k} onClick={() => setAdjKey(k)}>{ADJ_LABELS[k]}{st.adj[k] ? <span className="ml-1 opacity-70">{Math.round(st.adj[k])}</span> : null}</Chip>)}</div>
              <Lbl t={ADJ_LABELS[adjKey]} v={String(Math.round(st.adj[adjKey]))}><Slider min={adjRange[0]} max={adjRange[1]} value={st.adj[adjKey]} onChange={(v) => update((x) => { x.adj[adjKey] = v; return x; }, false)} onCommit={commit} /></Lbl>
              <button className="accent-text text-xs font-semibold" onClick={() => update((x) => { x.adj[adjKey] = 0; return x; })}>Reset {ADJ_LABELS[adjKey].toLowerCase()}</button>
            </div>
          )}
          {tool === "filters" && (
            <div>
              <div className="no-scrollbar -mx-1 flex gap-2.5 overflow-x-auto px-1 pb-2">
                {Object.entries(FILTERS).map(([k, f]) => (
                  <button key={k} onClick={() => update((x) => { x.filter = k; if (k === "none") x.filterAmt = 100; return x; })} className="press shrink-0 text-center">
                    <div className={`h-16 w-16 overflow-hidden rounded-2xl bg-black/10 ${st.filter === k ? "ring-[3px] ring-[var(--accent)]" : ""}`}>{thumbs[k] && <img src={thumbs[k]} alt="" className="h-full w-full object-cover" />}</div>
                    <div className="mt-1 w-16 truncate text-[10.5px] font-medium">{f.name}</div><div className="muted w-16 truncate text-[9px]">{f.group}</div>
                  </button>
                ))}
              </div>
              {st.filter !== "none" && <Lbl t="Intensity" v={`${st.filterAmt}%`}><Slider min={0} max={100} value={st.filterAmt} onChange={(v) => update((x) => { x.filterAmt = v; return x; }, false)} onCommit={commit} /></Lbl>}
            </div>
          )}
          {tool === "draw" && (
            <div className="space-y-2">
              <div className="no-scrollbar flex gap-2 overflow-x-auto">{SHAPES.map((x) => <Chip key={x.k} active={shape === x.k} onClick={() => setShape(x.k)}>{x.label}</Chip>)}</div>
              {shape !== "blur" && <Swatches value={color} onChange={setColor} />}
              <Lbl t="Brush size" v={`${Math.round(pen * 1000)}`}><Slider min={2} max={50} value={pen * 1000} onChange={(v) => setPen(v / 1000)} /></Lbl>
              <p className="muted text-xs">Draw on the photo. {shape === "blur" ? "Blur brush hides faces, plates or text." : "Undo removes the last stroke."}</p>
            </div>
          )}
          {tool === "text" && (
            <div className="space-y-2">
              <textarea rows={2} value={textVal} onChange={(e) => { setTextVal(e.target.value); if (selO?.t === "text") editSel((o) => { if (o.t === "text") o.text = e.target.value; }); }} className="!rounded-2xl" placeholder="Type text…" />
              <Swatches value={selO?.t === "text" ? selO.color : color} onChange={(c) => { setColor(c); if (selO?.t === "text") editSel((o) => { if (o.t === "text") o.color = c; }, true); }} />
              <div className="flex gap-2"><Chip active={bold} onClick={() => { setBold(!bold); if (selO?.t === "text") editSel((o) => { if (o.t === "text") o.bold = !bold; }, true); }}>Bold</Chip><Chip active={tbg} onClick={() => { setTbg(!tbg); if (selO?.t === "text") editSel((o) => { if (o.t === "text") o.bg = !tbg; }, true); }}>Background</Chip><div className="flex-1" /><Btn kind="accent" onClick={addText}>Add text</Btn></div>
              {selO?.t === "text" && <Lbl t="Size" v=""><Slider min={2} max={20} value={selO.size * 100} onChange={(v) => editSel((o) => { if (o.t === "text") o.size = v / 100; })} onCommit={commit} /></Lbl>}
              {selO && <button className="flex items-center gap-1 text-xs font-semibold text-[var(--danger)]" onClick={delSel}><Trash2 size={14} />Delete selected</button>}
              <p className="muted text-xs">Drag text on the photo to move it, or tap a spot to place the selected item.</p>
            </div>
          )}
          {tool === "stickers" && (
            <div className="space-y-2">
              <div className="grid grid-cols-8 gap-1">{EMOJI.map((e) => <button key={e} onClick={() => addSticker(e)} className="press rounded-xl py-1.5 text-2xl">{e}</button>)}</div>
              {selO?.t === "sticker" && <><Lbl t="Size" v=""><Slider min={5} max={60} value={selO.size * 100} onChange={(v) => editSel((o) => { if (o.t === "sticker") o.size = v / 100; })} onCommit={commit} /></Lbl><button className="flex items-center gap-1 text-xs font-semibold text-[var(--danger)]" onClick={delSel}><Trash2 size={14} />Delete sticker</button></>}
            </div>
          )}
          {tool === "frames" && <div className="no-scrollbar flex gap-2 overflow-x-auto">{Object.entries(FRAMES).map(([k, l]) => <Chip key={k} active={st.frame === k} onClick={() => update((x) => { x.frame = k; return x; })}>{l}</Chip>)}</div>}
          {tool === "fx" && (
            <div className="space-y-2">
              <Segmented value={fxMode} onChange={setFxMode} options={[{ v: "blur", label: "Blur" }, { v: "focus", label: "Background" }, { v: "redeye", label: "Red-eye" }]} />
              {fxMode === "blur" && <Lbl t="Blur" v={String(st.blur)}><Slider min={0} max={100} value={st.blur} onChange={(v) => update((x) => { x.blur = v; if (v) x.bgBlur = 0; return x; }, false)} onCommit={commit} /></Lbl>}
              {fxMode === "focus" && <><Lbl t="Background blur" v={String(st.bgBlur)}><Slider min={0} max={100} value={st.bgBlur} onChange={(v) => update((x) => { x.bgBlur = v; if (v) x.blur = 0; return x; }, false)} onCommit={commit} /></Lbl><p className="muted text-xs">Tap the photo to move the sharp focus area (elliptical mask — not AI segmentation).</p></>}
              {fxMode === "redeye" && <><Lbl t="Eye size" v=""><Slider min={1} max={10} value={redR * 100} onChange={(v) => setRedR(v / 100)} /></Lbl><p className="muted text-xs">Tap each red eye. Only strongly red pixels are desaturated.</p></>}
            </div>
          )}
        </div>
        <div className="glass-strong mb-[max(env(safe-area-inset-bottom),10px)] flex gap-1 overflow-x-auto rounded-[26px] p-1.5 no-scrollbar">
          {TOOLS.map((t) => <button key={t.id} onClick={() => { setTool(t.id); setSel(null); }} className={`press flex min-w-[62px] flex-1 flex-col items-center gap-0.5 rounded-[20px] py-2 text-[10.5px] font-semibold ${tool === t.id ? "bg-[var(--accent)]/15 accent-text" : "muted"}`}>{t.icon}{t.label}</button>)}
        </div>
      </div>

      <Sheet open={exportOpen} onClose={() => !busy && setExportOpen(false)} title="Export" z={80}>
        <div className="space-y-4 px-1 pb-2">
          <div><div className="mb-1.5 text-sm font-medium">Format</div><Segmented value={fmt} onChange={setFmt} options={[{ v: "jpeg", label: "JPEG" }, { v: "png", label: "PNG" }, { v: "webp", label: "WebP" }]} /></div>
          {fmt !== "png" && <Lbl t="Quality" v={`${quality}%`}><Slider min={40} max={100} value={quality} onChange={setQuality} /></Lbl>}
          <div><div className="mb-1.5 text-sm font-medium">Resolution / resize</div>
            <div className="flex flex-wrap gap-2">{[["orig", "Original"], ["p75", "75%"], ["p50", "50%"], ["p25", "25%"], ["4096", "4096 px"], ["2048", "2048 px"], ["1080", "1080 px"], ["720", "720 px"]].map(([k, l]) => <Chip key={k} active={size === k} onClick={() => setSize(k)}>{l}</Chip>)}</div>
            <p className="muted mt-1.5 text-xs">Long edge ≈ {Math.min(Math.round(croppedLong), maxDim)} px</p></div>
          {busy ? <div className="flex items-center justify-center gap-2 py-3 text-sm font-medium"><Spinner size={18} />{busy}</div> : (
            <div className="space-y-2">
              <Btn kind="accent" className="w-full" onClick={() => save(false)}><Check size={16} />Save as copy (original preserved)</Btn>
              {!s.preserveOriginal && <Btn kind="danger" className="w-full" onClick={async () => { if (await d.confirm({ title: "Replace the original?", message: "The original file will be overwritten.", confirmText: "Replace", danger: true })) save(true); }}>Replace original</Btn>}
            </div>
          )}
        </div>
      </Sheet>
    </div>
  );
}

function Lbl({ t, v, children }: { t: string; v: string; children: React.ReactNode }) {
  return <div><div className="flex justify-between text-xs font-semibold"><span>{t}</span><span className="muted tabular-nums">{v}</span></div>{children}</div>;
}
function Swatches({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return <div className="no-scrollbar flex gap-2.5 overflow-x-auto py-1">{COLORS.map((c) => <button key={c} aria-label={c} onClick={() => onChange(c)} className="h-8 w-8 shrink-0 rounded-full border-2 border-white/70 shadow" style={{ background: c, outline: value === c ? "3px solid var(--accent)" : "none", outlineOffset: 1 }} />)}</div>;
}
