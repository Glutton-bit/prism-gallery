"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Camera, Pause, Play, RotateCw, Save, Scissors, Type, Music, Gauge, Crop as CropIcon, SlidersHorizontal, Wand2, SplitSquareHorizontal, Trash2, Volume2, VolumeX, Plus, Minus } from "lucide-react";
import type { Item } from "@/lib/types";
import { origUrl } from "@/lib/api";
import { canvasToBlob, uploadOne } from "@/lib/imaging";
import { fmtClock } from "@/lib/format";
import { useDialogs, useSettings } from "./providers";
import { Btn, Chip, Segmented, Sheet, Slider, Spinner } from "./ui";

type Tab = "trim" | "split" | "crop" | "adjust" | "filters" | "text" | "audio" | "speed";
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "trim", label: "Trim", icon: <Scissors size={20} /> }, { id: "split", label: "Split/Cut", icon: <SplitSquareHorizontal size={20} /> },
  { id: "crop", label: "Crop", icon: <CropIcon size={20} /> }, { id: "adjust", label: "Adjust", icon: <SlidersHorizontal size={20} /> },
  { id: "filters", label: "Filters", icon: <Wand2 size={20} /> }, { id: "text", label: "Text", icon: <Type size={20} /> },
  { id: "audio", label: "Audio", icon: <Music size={20} /> }, { id: "speed", label: "Speed", icon: <Gauge size={20} /> },
];
const FILTERS: Record<string, { name: string; css: string; vignette?: number }> = {
  none: { name: "Original", css: "" }, vivid: { name: "Vivid", css: "saturate(1.35) contrast(1.1)" }, warm: { name: "Warm", css: "sepia(.25) saturate(1.2) hue-rotate(-10deg)" },
  cool: { name: "Cool", css: "hue-rotate(15deg) saturate(1.1) brightness(1.03)" }, bw: { name: "B&W", css: "grayscale(1)" }, noir: { name: "Noir", css: "grayscale(1) contrast(1.4) brightness(.9)", vignette: 0.5 },
  sepia: { name: "Sepia", css: "sepia(.9)" }, vintage: { name: "Vintage", css: "sepia(.4) contrast(.9) saturate(.9) brightness(1.05)", vignette: 0.4 }, cinematic: { name: "Cinematic", css: "contrast(1.2) saturate(.85) hue-rotate(-8deg) brightness(.95)", vignette: 0.35 },
};
const ASPECTS: { k: string; r?: number }[] = [{ k: "orig" }, { k: "1:1", r: 1 }, { k: "4:3", r: 4 / 3 }, { k: "3:4", r: 3 / 4 }, { k: "16:9", r: 16 / 9 }, { k: "9:16", r: 9 / 16 }, { k: "21:9", r: 21 / 9 }];
type TextItem = { id: number; text: string; x: number; y: number; size: number; color: string; from: number; to: number };

export default function VideoEditor({ item }: { item: Item }) {
  const router = useRouter();
  const d = useDialogs();
  const { s } = useSettings();
  const vid = useRef<HTMLVideoElement>(null);
  const cv = useRef<HTMLCanvasElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const musicRef = useRef<File | null>(null);
  const musicInput = useRef<HTMLInputElement>(null);
  const [tab, setTab] = useState<Tab>("trim");
  const [dur, setDur] = useState(item.durationMs / 1000 || 1);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [err, setErr] = useState(false);
  const [trim, setTrim] = useState({ a: 0, b: item.durationMs / 1000 || 1 });
  const [splits, setSplits] = useState<number[]>([]);
  const [cuts, setCuts] = useState<number[]>([]);
  const [aspect, setAspect] = useState("orig");
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0.5, y: 0.5 });
  const [rot, setRot] = useState(0);
  const [adj, setAdj] = useState({ brightness: 0, contrast: 0, saturation: 0 });
  const [filter, setFilter] = useState("none");
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [selT, setSelT] = useState<number | null>(null);
  const [tval, setTval] = useState("Your text");
  const [vol, setVol] = useState(100);
  const [mute, setMute] = useState(false);
  const [musicName, setMusicName] = useState<string | null>(null);
  const [musicVol, setMusicVol] = useState(70);
  const [speed, setSpeed] = useState(1);
  const [res, setRes] = useState<"480" | "720" | "1080" | "orig">("720");
  const [exportOpen, setExportOpen] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [dirty, setDirty] = useState(false);
  const mark = () => setDirty(true);

  const live = useRef({ trim, splits, cuts, aspect, zoom, pan, rot, adj, filter, texts, speed, vol, mute });
  live.current = { trim, splits, cuts, aspect, zoom, pan, rot, adj, filter, texts, speed, vol, mute };

  const segs = useMemo(() => {
    const pts = [trim.a, ...splits.filter((p) => p > trim.a + 0.05 && p < trim.b - 0.05).sort((x, y) => x - y), trim.b];
    return pts.slice(0, -1).map((a, i) => ({ a, b: pts[i + 1], cut: cuts.includes(Math.round(a * 1000)) }));
  }, [trim, splits, cuts]);
  const segsRef = useRef(segs); segsRef.current = segs;
  const kept = segs.filter((x) => !x.cut);
  const keptDur = kept.reduce((a, x) => a + (x.b - x.a), 0);

  /* ---- frame drawing shared by preview, export and frame extraction ---- */
  const outDims = useCallback((v: { videoWidth: number; videoHeight: number }, maxShort?: number) => {
    const L = live.current, odd = L.rot % 180 !== 0;
    const rw = odd ? v.videoHeight : v.videoWidth, rh = odd ? v.videoWidth : v.videoHeight;
    const r = L.aspect === "orig" ? rw / rh : ASPECTS.find((a) => a.k === L.aspect)!.r!;
    let cw: number, ch: number;
    if (rw / rh > r) { ch = rh; cw = rh * r; } else { cw = rw; ch = rw / r; }
    cw /= L.zoom; ch /= L.zoom;
    let W = cw, H = ch;
    if (maxShort) { const k = Math.min(1, maxShort / Math.min(cw, ch)); W = cw * k; H = ch * k; }
    return { rw, rh, cw, ch, W: Math.max(2, Math.round(W / 2) * 2), H: Math.max(2, Math.round(H / 2) * 2) };
  }, []);

  const drawFrame = useCallback((ctx: CanvasRenderingContext2D, v: HTMLVideoElement, dims: ReturnType<typeof outDims>, t: number) => {
    const L = live.current;
    const { rw, rh, cw, ch, W, H } = dims;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, H);
    const sx = (rw - cw) * L.pan.x, sy = (rh - ch) * L.pan.y, k = W / cw;
    ctx.setTransform(k, 0, 0, k, -sx * k, -sy * k);
    ctx.translate(rw / 2, rh / 2); ctx.rotate((L.rot * Math.PI) / 180);
    const f = `brightness(${1 + L.adj.brightness / 100}) contrast(${1 + L.adj.contrast / 100}) saturate(${1 + L.adj.saturation / 100}) ${FILTERS[L.filter].css}`;
    if ("filter" in ctx) ctx.filter = f;
    try { ctx.drawImage(v, -v.videoWidth / 2, -v.videoHeight / 2); } catch { /* not ready */ }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if ("filter" in ctx) ctx.filter = "none";
    const vg = FILTERS[L.filter].vignette;
    if (vg) { const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.75); g.addColorStop(0, "rgba(0,0,0,0)"); g.addColorStop(1, `rgba(0,0,0,${vg})`); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); }
    for (const tx of L.texts) {
      if (t < tx.from || t > tx.to) continue;
      const fs = tx.size * H;
      ctx.font = `800 ${fs}px ui-rounded, system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.lineWidth = fs * 0.09; ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineJoin = "round";
      tx.text.split("\n").forEach((ln, i, a) => { const y = tx.y * H + (i - (a.length - 1) / 2) * fs * 1.15; ctx.strokeText(ln, tx.x * W, y); ctx.fillStyle = tx.color; ctx.fillText(ln, tx.x * W, y); });
    }
  }, []);

  const paint = useCallback(() => {
    const v = vid.current, c = cv.current;
    if (!v || !c || !v.videoWidth) return;
    const dims = outDims(v, 540);
    if (c.width !== dims.W || c.height !== dims.H) { c.width = dims.W; c.height = dims.H; }
    drawFrame(c.getContext("2d")!, v, dims, v.currentTime);
  }, [outDims, drawFrame]);

  useEffect(() => { paint(); }, [aspect, zoom, pan, rot, adj, filter, texts, paint, cur]);

  /* ---- playback inside kept segments ---- */
  useEffect(() => {
    const v = vid.current!;
    let raf = 0;
    const loop = () => {
      const t = v.currentTime;
      const ss = segsRef.current;
      setCur(t);
      if (!v.paused) {
        const inSeg = ss.find((x) => t >= x.a - 0.02 && t < x.b);
        if (!inSeg || inSeg.cut) {
          const nxt = ss.find((x) => !x.cut && x.a > t - 0.02);
          if (nxt) v.currentTime = nxt.a; else { v.pause(); const f = ss.find((x) => !x.cut); if (f) v.currentTime = f.a; }
        }
      }
      paint();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const onMeta = () => { const dd = v.duration; if (isFinite(dd) && dd > 0) { setDur(dd); setTrim((tr) => (tr.b === 1 || tr.b > dd ? { a: tr.a, b: dd } : tr)); } v.currentTime = 0.01; };
    v.addEventListener("loadedmetadata", onMeta);
    v.addEventListener("play", () => setPlaying(true)); v.addEventListener("pause", () => setPlaying(false));
    v.addEventListener("error", () => setErr(true));
    return () => { cancelAnimationFrame(raf); v.removeEventListener("loadedmetadata", onMeta); v.pause(); };
  }, [paint]);
  useEffect(() => { if (vid.current) { vid.current.playbackRate = speed; vid.current.volume = Math.min(1, vol / 100); vid.current.muted = mute; } }, [speed, vol, mute]);

  const toggle = () => { const v = vid.current!; if (v.paused) { const t = v.currentTime; if (t >= trim.b - 0.05 || t < trim.a) v.currentTime = trim.a; v.play().catch(() => {}); } else v.pause(); };
  const seek = (t: number) => { const v = vid.current!; v.currentTime = Math.min(dur, Math.max(0, t)); };

  /* ---- timeline drag ---- */
  const tdrag = useRef<null | "a" | "b" | "play">(null);
  const posToTime = (e: React.PointerEvent) => { const r = track.current!.getBoundingClientRect(); return Math.min(dur, Math.max(0, ((e.clientX - r.left) / r.width) * dur)); };
  const tDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const t = posToTime(e), r = track.current!.getBoundingClientRect(), px = (x: number) => (x / dur) * r.width;
    const dA = Math.abs(px(t) - px(trim.a)), dB = Math.abs(px(t) - px(trim.b));
    tdrag.current = tab === "trim" && Math.min(dA, dB) < 26 ? (dA < dB ? "a" : "b") : "play";
    tMove(e);
  };
  const tMove = (e: React.PointerEvent) => {
    if (!tdrag.current) return;
    const t = posToTime(e);
    if (tdrag.current === "a") { setTrim((x) => ({ ...x, a: Math.min(t, x.b - 0.2) })); seek(t); mark(); }
    else if (tdrag.current === "b") { setTrim((x) => ({ ...x, b: Math.max(t, x.a + 0.2) })); seek(t); mark(); }
    else seek(t);
  };
  const nudge = (which: "a" | "b", dt: number) => { setTrim((x) => { const n = { ...x }; n[which] = Math.min(dur, Math.max(0, n[which] + dt)); if (n.b - n.a < 0.2) return x; seek(n[which]); return n; }); mark(); };

  /* ---- actions ---- */
  const splitHere = () => { const t = cur; if (t <= trim.a + 0.1 || t >= trim.b - 0.1) return d.toast("Move the playhead inside the trimmed range to split"); if (splits.some((p) => Math.abs(p - t) < 0.1)) return; setSplits((x) => [...x, t].sort((p, q) => p - q)); mark(); };
  const toggleCut = (a: number) => { const k = Math.round(a * 1000); if (!cuts.includes(k) && kept.length <= 1) return d.toast("Keep at least one segment"); setCuts((c) => (c.includes(k) ? c.filter((x) => x !== k) : [...c, k])); mark(); };
  const extractFrame = async () => {
    const v = vid.current!;
    try {
      const dims = outDims(v);
      const c = document.createElement("canvas"); c.width = dims.W; c.height = dims.H;
      drawFrame(c.getContext("2d")!, v, dims, v.currentTime);
      const b = await canvasToBlob(c, "image/jpeg", 0.92);
      await uploadOne(new File([b], `${item.name.replace(/\.[^.]+$/, "")}_frame_${Math.round(v.currentTime * 1000)}.jpg`, { type: "image/jpeg", lastModified: new Date(item.takenAt).getTime() }), s, { albumId: item.albumId, takenAt: item.takenAt, edited: true });
      d.toast("Frame saved as a photo in this album");
    } catch (e) { d.toast((e as Error).message); }
  };
  const addText = () => { const id = Date.now(); setTexts((t) => [...t, { id, text: tval, x: 0.5, y: 0.5, size: 0.08, color: "#ffffff", from: 0, to: dur }]); setSelT(id); mark(); };
  const upT = (fn: (t: TextItem) => void) => { setTexts((ts) => ts.map((t) => { if (t.id !== selT) return t; const n = { ...t }; fn(n); return n; })); mark(); };
  const selText = texts.find((t) => t.id === selT);

  /* ---- export (real-time re-encode via MediaRecorder) ---- */
  const doExport = async () => {
    const supported = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4"].find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m));
    if (!supported) return d.toast("This browser can’t encode video (MediaRecorder unavailable).");
    setProgress(0);
    const ev = document.createElement("video");
    ev.src = origUrl(item); ev.crossOrigin = "anonymous"; ev.playsInline = true; ev.preload = "auto";
    let ac: AudioContext | null = null, music: HTMLAudioElement | null = null, musicUrl = "";
    try {
      await new Promise<void>((res, rej) => { ev.onloadeddata = () => res(); ev.onerror = () => rej(new Error("Could not load video")); });
      const dims = outDims(ev, res === "orig" ? 1080 : Number(res));
      const c = document.createElement("canvas"); c.width = dims.W; c.height = dims.H;
      const ctx = c.getContext("2d")!;
      const stream = c.captureStream(30);
      const L = live.current;
      if (!L.mute || musicRef.current) {
        ac = new AudioContext(); await ac.resume();
        const dest = ac.createMediaStreamDestination();
        if (!L.mute) { const g = ac.createGain(); g.gain.value = Math.min(2, L.vol / 100); ac.createMediaElementSource(ev).connect(g).connect(dest); } else ev.muted = true;
        if (musicRef.current) { musicUrl = URL.createObjectURL(musicRef.current); music = new Audio(musicUrl); music.loop = true; const mg = ac.createGain(); mg.gain.value = musicVol / 100; ac.createMediaElementSource(music).connect(mg).connect(dest); }
        dest.stream.getAudioTracks().forEach((t) => stream.addTrack(t));
      } else ev.muted = true;
      const rec = new MediaRecorder(stream, { mimeType: supported, videoBitsPerSecond: dims.H >= 1000 ? 6_000_000 : dims.H >= 700 ? 3_500_000 : 1_800_000 });
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      const stopped = new Promise<void>((r) => (rec.onstop = () => r()));
      ev.playbackRate = L.speed;
      const wake = (navigator as Navigator & { wakeLock?: { request: (t: string) => Promise<{ release: () => void }> } }).wakeLock;
      const lock = await wake?.request("screen").catch(() => null);
      rec.start(500);
      music?.play().catch(() => {});
      const total = keptDur;
      let done = 0;
      for (const sg of segsRef.current.filter((x) => !x.cut)) {
        ev.currentTime = sg.a;
        await new Promise<void>((r) => { ev.onseeked = () => r(); });
        await ev.play();
        await new Promise<void>((r) => {
          const tick = () => {
            drawFrame(ctx, ev, dims, ev.currentTime);
            const t = ev.currentTime;
            setProgress(Math.min(1, (done + Math.max(0, t - sg.a)) / total));
            if (t >= sg.b - 0.03 || ev.ended) { ev.pause(); r(); } else requestAnimationFrame(tick);
          };
          tick();
        });
        done += sg.b - sg.a;
      }
      music?.pause();
      await new Promise((r) => setTimeout(r, 250));
      rec.stop(); await stopped; lock?.release();
      const blob = new Blob(chunks, { type: supported.split(";")[0] });
      const ext = supported.startsWith("video/mp4") ? "mp4" : "webm";
      setProgress(1);
      await uploadOne(new File([blob], `${item.name.replace(/\.[^.]+$/, "")}_edit.${ext}`, { type: blob.type, lastModified: new Date(item.takenAt).getTime() }), s, { albumId: item.albumId, takenAt: item.takenAt, edited: true, durationMs: Math.round((total / L.speed) * 1000) });
      d.toast("Edited video saved as a new copy — original untouched");
      setProgress(null); setExportOpen(false); router.back();
    } catch (e) { d.toast((e as Error).message || "Export failed"); setProgress(null); }
    finally { ac?.close().catch(() => {}); if (musicUrl) URL.revokeObjectURL(musicUrl); ev.removeAttribute("src"); }
  };
  const close = async () => { if (dirty && !(await d.confirm({ title: "Discard edits?", confirmText: "Discard", danger: true }))) return; router.back(); };

  const pct = (t: number) => `${(t / dur) * 100}%`;
  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-[var(--bg)]">
      <div className="px-3 safe-top">
        <div className="glass-strong flex items-center gap-1 rounded-[26px] px-1.5 py-1.5">
          <button aria-label="Close" className="press grid h-10 w-10 place-items-center rounded-full" onClick={close}><ArrowLeft size={20} /></button>
          <div className="min-w-0 flex-1 px-1"><div className="truncate text-sm font-semibold">Video editor</div><div className="muted truncate text-[11px]">{item.name} · result {fmtClock(keptDur / speed)}</div></div>
          <button aria-label="Extract frame" className="press glass grid h-10 w-10 place-items-center rounded-full" onClick={extractFrame}><Camera size={18} /></button>
          <button className="accent-bg press ml-1 flex items-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-semibold" onClick={() => setExportOpen(true)}><Save size={16} />Export</button>
        </div>
      </div>

      <div className="relative grid min-h-0 flex-1 place-items-center p-3">
        <video ref={vid} src={origUrl(item)} crossOrigin="anonymous" playsInline preload="auto" muted={mute} className="hidden" />
        <canvas ref={cv} className="max-h-full max-w-full rounded-xl bg-black shadow-2xl" />
        {err && <div className="absolute inset-0 grid place-items-center p-8 text-center"><div><p className="font-semibold">This video’s codec can’t be decoded by the browser, so it can’t be edited here.</p><Btn className="mt-3" onClick={() => router.back()}>Go back</Btn></div></div>}
        <button onClick={toggle} aria-label={playing ? "Pause" : "Play"} className="on-media press absolute bottom-5 left-1/2 grid h-14 w-14 -translate-x-1/2 place-items-center rounded-full">{playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-0.5" />}</button>
      </div>

      <div className="px-3">
        {/* timeline */}
        <div className="glass-strong mb-2 rounded-[26px] px-4 pb-3 pt-2">
          <div className="muted mb-1 flex justify-between text-[11px] font-semibold tabular-nums"><span>{fmtClock(cur)}</span><span>Trim {fmtClock(trim.a)} – {fmtClock(trim.b)}</span><span>{fmtClock(dur)}</span></div>
          <div ref={track} className="relative h-14 touch-none select-none rounded-xl bg-black/15 dark:bg-white/10" onPointerDown={tDown} onPointerMove={tMove} onPointerUp={() => (tdrag.current = null)} onPointerCancel={() => (tdrag.current = null)}>
            {segs.map((sg, i) => <div key={i} className="absolute inset-y-0" style={{ left: pct(sg.a), width: `${((sg.b - sg.a) / dur) * 100}%`, background: sg.cut ? "repeating-linear-gradient(45deg, rgba(255,69,58,.25) 0 6px, rgba(255,69,58,.1) 6px 12px)" : "color-mix(in srgb, var(--accent) 45%, transparent)", borderLeft: i ? "2px solid #fff" : undefined }} />)}
            <div className="absolute inset-y-0 left-0 bg-black/45" style={{ width: pct(trim.a) }} />
            <div className="absolute inset-y-0 right-0 bg-black/45" style={{ width: `${((dur - trim.b) / dur) * 100}%` }} />
            <div className="absolute -inset-y-1 w-3 -translate-x-1/2 rounded-md bg-[var(--accent)] shadow" style={{ left: pct(trim.a) }}><div className="mx-auto mt-4 h-6 w-0.5 rounded bg-white" /></div>
            <div className="absolute -inset-y-1 w-3 -translate-x-1/2 rounded-md bg-[var(--accent)] shadow" style={{ left: pct(trim.b) }}><div className="mx-auto mt-4 h-6 w-0.5 rounded bg-white" /></div>
            <div className="pointer-events-none absolute -inset-y-2 w-0.5 -translate-x-1/2 bg-white shadow" style={{ left: pct(cur) }}><span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rounded-full bg-white" /></div>
          </div>
        </div>

        <div className="glass-strong mb-2 max-h-[30dvh] overflow-y-auto rounded-[26px] p-3 no-scrollbar">
          {tab === "trim" && (
            <div className="space-y-2">
              <p className="muted text-xs">Drag the blue handles on the timeline, or fine-tune below.</p>
              <div className="grid grid-cols-2 gap-2">
                {(["a", "b"] as const).map((w) => (
                  <div key={w} className="card rounded-2xl p-2 text-center"><div className="text-xs font-semibold">{w === "a" ? "Start" : "End"} · {fmtClock(trim[w])}.{String(Math.round((trim[w] % 1) * 10))}</div>
                    <div className="mt-1 flex items-center justify-center gap-1"><Chip onClick={() => nudge(w, -1)}>−1s</Chip><Chip onClick={() => nudge(w, -0.1)}><Minus size={12} className="inline" />.1</Chip><Chip onClick={() => nudge(w, 0.1)}><Plus size={12} className="inline" />.1</Chip><Chip onClick={() => nudge(w, 1)}>+1s</Chip></div>
                    <button className="accent-text mt-1 text-xs font-semibold" onClick={() => { setTrim((x) => (w === "a" ? { ...x, a: Math.min(cur, x.b - 0.2) } : { ...x, b: Math.max(cur, x.a + 0.2) })); mark(); }}>Set to playhead</button></div>
                ))}
              </div>
              <Btn onClick={() => { setTrim({ a: 0, b: dur }); setSplits([]); setCuts([]); }}>Reset trim</Btn>
            </div>
          )}
          {tab === "split" && (
            <div className="space-y-2">
              <div className="flex gap-2"><Btn kind="accent" onClick={splitHere}><Scissors size={16} />Split at playhead</Btn><Btn onClick={() => { setSplits([]); setCuts([]); }}>Clear splits</Btn></div>
              <p className="muted text-xs">Split, then mark segments to <b>Cut</b> (remove) — the rest is joined in the export.</p>
              {segs.map((sg, i) => (
                <div key={i} className="card flex items-center justify-between rounded-2xl px-3 py-2 text-sm"><span className={sg.cut ? "muted line-through" : "font-medium"}>Segment {i + 1} · {fmtClock(sg.a)}–{fmtClock(sg.b)}</span>
                  <button onClick={() => toggleCut(sg.a)} className={`press rounded-full px-3 py-1 text-xs font-semibold ${sg.cut ? "accent-bg" : "bg-[var(--danger)] text-white"}`}>{sg.cut ? "Restore" : "Cut"}</button></div>
              ))}
            </div>
          )}
          {tab === "crop" && (
            <div className="space-y-2">
              <div className="no-scrollbar flex gap-2 overflow-x-auto">{ASPECTS.map((a) => <Chip key={a.k} active={aspect === a.k} onClick={() => { setAspect(a.k); mark(); }}>{a.k === "orig" ? "Original" : a.k}</Chip>)}<Chip onClick={() => { setRot((r) => (r + 90) % 360); mark(); }}><RotateCw size={13} className="mr-1 inline" />Rotate</Chip></div>
              <Row t="Zoom" v={`${zoom.toFixed(1)}×`}><Slider min={1} max={4} step={0.05} value={zoom} onChange={(v) => { setZoom(v); mark(); }} /></Row>
              <Row t="Pan horizontal" v=""><Slider min={0} max={100} value={pan.x * 100} onChange={(v) => { setPan((p) => ({ ...p, x: v / 100 })); mark(); }} /></Row>
              <Row t="Pan vertical" v=""><Slider min={0} max={100} value={pan.y * 100} onChange={(v) => { setPan((p) => ({ ...p, y: v / 100 })); mark(); }} /></Row>
            </div>
          )}
          {tab === "adjust" && (["brightness", "contrast", "saturation"] as const).map((k) => <Row key={k} t={k[0].toUpperCase() + k.slice(1)} v={String(adj[k])}><Slider min={-100} max={100} value={adj[k]} onChange={(v) => { setAdj((a) => ({ ...a, [k]: v })); mark(); }} /></Row>)}
          {tab === "filters" && <div className="no-scrollbar flex gap-2 overflow-x-auto">{Object.entries(FILTERS).map(([k, f]) => <Chip key={k} active={filter === k} onClick={() => { setFilter(k); mark(); }}>{f.name}</Chip>)}</div>}
          {tab === "text" && (
            <div className="space-y-2">
              <div className="flex gap-2"><input type="text" value={tval} onChange={(e) => { setTval(e.target.value); if (selText) upT((t) => (t.text = e.target.value)); }} /><Btn kind="accent" onClick={addText}>Add</Btn></div>
              <div className="no-scrollbar flex gap-2 overflow-x-auto">{texts.map((t) => <Chip key={t.id} active={t.id === selT} onClick={() => { setSelT(t.id); setTval(t.text); }}>{t.text.slice(0, 14)}</Chip>)}</div>
              {selText && (<>
                <Row t="Size" v=""><Slider min={3} max={25} value={selText.size * 100} onChange={(v) => upT((t) => (t.size = v / 100))} /></Row>
                <Row t="Horizontal" v=""><Slider min={0} max={100} value={selText.x * 100} onChange={(v) => upT((t) => (t.x = v / 100))} /></Row>
                <Row t="Vertical" v=""><Slider min={0} max={100} value={selText.y * 100} onChange={(v) => upT((t) => (t.y = v / 100))} /></Row>
                <div className="flex flex-wrap items-center gap-2">{["#ffffff", "#ffd60a", "#ff453a", "#30d158", "#0a84ff", "#000000"].map((c) => <button key={c} aria-label={c} onClick={() => upT((t) => (t.color = c))} className="h-7 w-7 rounded-full border-2 border-white/70" style={{ background: c }} />)}</div>
                <div className="flex items-center gap-2 text-xs"><span className="muted">Visible {fmtClock(selText.from)}–{fmtClock(selText.to)}</span><Chip onClick={() => upT((t) => (t.from = Math.min(cur, t.to - 0.2)))}>From playhead</Chip><Chip onClick={() => upT((t) => (t.to = Math.max(cur, t.from + 0.2)))}>To playhead</Chip></div>
                <button className="flex items-center gap-1 text-xs font-semibold text-[var(--danger)]" onClick={() => { setTexts((t) => t.filter((x) => x.id !== selT)); setSelT(null); }}><Trash2 size={14} />Delete text</button>
              </>)}
            </div>
          )}
          {tab === "audio" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2"><Chip active={mute} onClick={() => { setMute(!mute); mark(); }}>{mute ? <VolumeX size={13} className="mr-1 inline" /> : <Volume2 size={13} className="mr-1 inline" />}{mute ? "Muted" : "Mute"}</Chip></div>
              <Row t="Video volume" v={`${vol}%`}><Slider min={0} max={200} value={vol} onChange={(v) => { setVol(v); mark(); }} /></Row>
              <input ref={musicInput} type="file" accept="audio/*" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) { musicRef.current = f; setMusicName(f.name); mark(); } }} />
              <div className="flex items-center gap-2"><Btn onClick={() => musicInput.current?.click()}><Music size={16} />{musicName ? "Change music" : "Add music"}</Btn>{musicName && <button className="muted truncate text-xs" onClick={() => { musicRef.current = null; setMusicName(null); }}>{musicName} ✕</button>}</div>
              {musicName && <Row t="Music volume" v={`${musicVol}%`}><Slider min={0} max={100} value={musicVol} onChange={setMusicVol} /></Row>}
              <p className="muted text-xs">Music is mixed into the export and loops to the video length.</p>
            </div>
          )}
          {tab === "speed" && <div className="flex flex-wrap gap-2">{[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].map((v) => <Chip key={v} active={speed === v} onClick={() => { setSpeed(v); mark(); }}>{v}×</Chip>)}</div>}
        </div>
        <div className="glass-strong mb-[max(env(safe-area-inset-bottom),10px)] flex gap-1 overflow-x-auto rounded-[26px] p-1.5 no-scrollbar">
          {TABS.map((t) => <button key={t.id} onClick={() => setTab(t.id)} className={`press flex min-w-[62px] flex-1 flex-col items-center gap-0.5 rounded-[20px] py-2 text-[10.5px] font-semibold ${tab === t.id ? "bg-[var(--accent)]/15 accent-text" : "muted"}`}>{t.icon}{t.label}</button>)}
        </div>
      </div>

      <Sheet open={exportOpen} onClose={() => progress === null && setExportOpen(false)} title="Export video" z={80}>
        <div className="space-y-4 px-1 pb-2">
          <div><div className="mb-1.5 text-sm font-medium">Resolution (short side)</div><Segmented value={res} onChange={setRes} options={[{ v: "480", label: "480p" }, { v: "720", label: "720p" }, { v: "1080", label: "1080p" }, { v: "orig", label: "Max" }]} /></div>
          <div className="card rounded-2xl p-3 text-xs leading-relaxed muted">Result: <b className="text-[var(--fg)]">{fmtClock(keptDur / speed)}</b> from {kept.length} segment{kept.length > 1 ? "s" : ""}. Export re-encodes in real time on this device to WebM and saves a <b>new copy</b> — the original is never modified. Keep the screen on until it finishes.</div>
          {progress !== null ? (
            <div className="space-y-2 text-center"><div className="h-2 overflow-hidden rounded-full bg-black/10 dark:bg-white/15"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${progress * 100}%` }} /></div><div className="flex items-center justify-center gap-2 text-sm font-medium"><Spinner size={16} />{Math.round(progress * 100)}%</div></div>
          ) : <Btn kind="accent" className="w-full" onClick={doExport}><Save size={16} />Export as new video</Btn>}
        </div>
      </Sheet>
    </div>
  );
}
function Row({ t, v, children }: { t: string; v: string; children: React.ReactNode }) {
  return <div><div className="flex justify-between text-xs font-semibold"><span>{t}</span><span className="muted tabular-nums">{v}</span></div>{children}</div>;
}
