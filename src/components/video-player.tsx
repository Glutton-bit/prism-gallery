"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft, Play, Pause, SkipBack, SkipForward, RotateCcw, RotateCw, Maximize, Minimize, Lock, Unlock, PictureInPicture2, MoreVertical,
  Subtitles, Volume2, Gauge, Info, Pencil, Share2, Trash2, Heart, Languages, ScreenShare, ChevronLeft, ChevronRight, Sun, VolumeX,
} from "lucide-react";
import type { Item } from "@/lib/types";
import { origUrl } from "@/lib/api";
import { fmtClock, fmtDateTime, fmtSize, fmtDur } from "@/lib/format";
import { useDialogs, useSettings } from "./providers";
import { Sheet } from "./ui";

const SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2];
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

function srtToVtt(srt: string) {
  return "WEBVTT\n\n" + srt.replace(/\r/g, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
}

type Props = {
  item: Item; hasPrev: boolean; hasNext: boolean; onPrev: () => void; onNext: () => void; onClose: () => void;
  onEdit: () => void; onShare: () => void; onDelete: () => void; onFavorite: () => void;
};

export default function VideoPlayer({ item, hasPrev, hasNext, onPrev, onNext, onClose, onEdit, onShare, onDelete, onFavorite }: Props) {
  const { s } = useSettings();
  const d = useDialogs();
  const wrap = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const subInput = useRef<HTMLInputElement>(null);
  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(item.durationMs / 1000);
  const [speed, setSpeed] = useState(s.videoSpeed);
  const [controls, setControls] = useState(true);
  const [locked, setLocked] = useState(false);
  const [showUnlock, setShowUnlock] = useState(false);
  const [bri, setBri] = useState(clamp01(s.videoBrightness / 100));
  const [vol, setVol] = useState(clamp01(s.videoVolume / 100));
  const [hud, setHud] = useState<null | { kind: "vol" | "bri" | "seek" | "speed"; text: string; pct?: number }>(null);
  const [menu, setMenu] = useState<null | "speed" | "more" | "audio" | "info">(null);
  const [scrub, setScrub] = useState<number | null>(null);
  const [subUrl, setSubUrl] = useState<string | null>(null);
  const [subsOn, setSubsOn] = useState(true);
  const [audioTracks, setAudioTracks] = useState<{ id: string; label: string; enabled: boolean }[]>([]);
  const [buffering, setBuffering] = useState(true);
  const [error, setError] = useState(false);
  const [fs, setFs] = useState(false);

  const L = useRef({ speed, locked, vol, bri, dur, s });
  L.current = { speed, locked, vol, bri, dur, s };
  const g = useRef({ x: 0, y: 0, t: 0, zone: 1, mode: "none" as "none" | "seek" | "vol" | "bri" | "ignore", moved: false, hold: false, long: 0 as unknown as ReturnType<typeof setTimeout>, v0: 0, b0: 0, t0: 0, lastTap: 0, tapTimer: 0 as unknown as ReturnType<typeof setTimeout>, seekTo: 0, hudT: 0 as unknown as ReturnType<typeof setTimeout>, hideT: 0 as unknown as ReturnType<typeof setTimeout>, lastSave: 0, lastSeek: 0, active: false });
  const posKey = `prism-pos-${item.id}`;

  const flashHud = (h: NonNullable<typeof hud>, ms = 900) => {
    setHud(h); clearTimeout(g.current.hudT);
    if (ms) g.current.hudT = setTimeout(() => setHud(null), ms);
  };
  const poke = useCallback(() => {
    setControls(true);
    clearTimeout(g.current.hideT);
    g.current.hideT = setTimeout(() => { if (vid.current && !vid.current.paused) setControls(false); }, 3500);
  }, []);

  const togglePlay = useCallback(() => {
    const v = vid.current; if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }, []);
  const seekBy = (sec: number) => {
    const v = vid.current; if (!v) return;
    v.currentTime = Math.min(Math.max(0, v.currentTime + sec), v.duration || 1e9);
    flashHud({ kind: "seek", text: `${sec > 0 ? "+" : "−"}${Math.abs(sec)}s` });
  };

  // setup
  useEffect(() => {
    const v = vid.current!;
    v.volume = L.current.vol;
    v.playbackRate = L.current.speed;
    const onMeta = () => {
      setDur(v.duration || item.durationMs / 1000); setBuffering(false);
      const at = parseFloat(localStorage.getItem(posKey) || "0");
      if (L.current.s.resume && at > 3 && v.duration && at < v.duration - 3) { v.currentTime = at; d.toast(`Resumed from ${fmtClock(at)}`); }
      const at2 = (v as unknown as { audioTracks?: { length: number; [i: number]: { id: string; label: string; language: string; enabled: boolean } } }).audioTracks;
      if (at2 && at2.length) setAudioTracks(Array.from({ length: at2.length }, (_, i) => ({ id: String(i), label: at2[i].label || at2[i].language || `Track ${i + 1}`, enabled: at2[i].enabled })));
      v.play().catch(() => setPlaying(false));
    };
    const onTime = () => {
      setCur(v.currentTime);
      const now = Date.now();
      if (now - g.current.lastSave > 1500) { g.current.lastSave = now; if (v.currentTime > 1) localStorage.setItem(posKey, String(v.currentTime)); }
    };
    const on = (n: string, f: () => void) => { v.addEventListener(n, f); return () => v.removeEventListener(n, f); };
    const offs = [
      on("loadedmetadata", onMeta), on("timeupdate", onTime),
      on("play", () => { setPlaying(true); poke(); }), on("pause", () => { setPlaying(false); setControls(true); if (v.currentTime > 1) localStorage.setItem(posKey, String(v.currentTime)); }),
      on("waiting", () => setBuffering(true)), on("playing", () => setBuffering(false)), on("canplay", () => setBuffering(false)),
      on("ended", () => { localStorage.removeItem(posKey); setControls(true); }),
      on("error", () => { setError(true); setBuffering(false); }),
    ];
    const fsc = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", fsc);
    return () => {
      offs.forEach((f) => f());
      document.removeEventListener("fullscreenchange", fsc);
      if (v.currentTime > 1 && v.duration && v.currentTime < v.duration - 2) localStorage.setItem(posKey, String(v.currentTime));
      v.pause();
      try { (screen.orientation as unknown as { unlock?: () => void }).unlock?.(); } catch { /* ignore */ }
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      clearTimeout(g.current.hideT); clearTimeout(g.current.hudT); clearTimeout(g.current.long); clearTimeout(g.current.tapTimer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  useEffect(() => { if (vid.current) vid.current.playbackRate = speed; }, [speed]);
  useEffect(() => {
    const tt = vid.current?.textTracks;
    if (tt && tt.length) for (let i = 0; i < tt.length; i++) tt[i].mode = subsOn ? "showing" : "hidden";
  }, [subsOn, subUrl]);
  useEffect(() => () => { if (subUrl) URL.revokeObjectURL(subUrl); }, [subUrl]);

  /* ---------------- gestures ---------------- */
  const down = (e: React.PointerEvent) => {
    const x = g.current;
    if (L.current.locked) { setShowUnlock(true); setTimeout(() => setShowUnlock(false), 2200); return; }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const r = wrap.current!.getBoundingClientRect();
    const rx = (e.clientX - r.left) / r.width;
    x.x = e.clientX; x.y = e.clientY; x.t = Date.now(); x.zone = rx < 0.33 ? 0 : rx > 0.67 ? 2 : 1;
    x.mode = "none"; x.moved = false; x.hold = false; x.active = true;
    x.v0 = vid.current!.volume; x.b0 = L.current.bri; x.t0 = vid.current!.currentTime; x.seekTo = x.t0;
    clearTimeout(x.long);
    x.long = setTimeout(() => {
      if (x.moved || !x.active) return;
      x.hold = true;
      vid.current!.playbackRate = L.current.s.holdSpeed;
      if (vid.current!.paused) vid.current!.play().catch(() => {});
      navigator.vibrate?.(12);
      flashHud({ kind: "speed", text: `${L.current.s.holdSpeed}× speed` }, 0);
    }, 420);
  };
  const move = (e: React.PointerEvent) => {
    const x = g.current;
    if (!x.active || L.current.locked || x.hold) return;
    const dx = e.clientX - x.x, dy = e.clientY - x.y;
    const r = wrap.current!.getBoundingClientRect();
    const sens = L.current.s.gestureSens;
    if (x.mode === "none") {
      if (Math.hypot(dx, dy) < 12) return;
      x.moved = true; clearTimeout(x.long);
      if (Math.abs(dx) > Math.abs(dy)) x.mode = "seek";
      else x.mode = x.zone === 2 ? "vol" : x.zone === 0 ? "bri" : "ignore";
    }
    if (x.mode === "seek") {
      const D = L.current.dur || 60;
      const delta = (dx / r.width) * Math.min(D, 120) * sens;
      const target = Math.min(D, Math.max(0, x.t0 + delta));
      x.seekTo = target;
      flashHud({ kind: "seek", text: `${delta >= 0 ? "+" : "−"}${fmtClock(Math.abs(target - x.t0))}  ·  ${fmtClock(target)} / ${fmtClock(D)}` }, 0);
      const now = performance.now();
      if (now - x.lastSeek > 120) { x.lastSeek = now; vid.current!.currentTime = target; }
    } else if (x.mode === "vol") {
      const v = clamp01(x.v0 - (dy / r.height) * 1.3 * sens);
      vid.current!.volume = v; vid.current!.muted = false; setVol(v);
      flashHud({ kind: "vol", text: `${Math.round(v * 100)}%`, pct: v }, 0);
    } else if (x.mode === "bri") {
      const b = clamp01(x.b0 - (dy / r.height) * 1.3 * sens);
      setBri(b);
      flashHud({ kind: "bri", text: `${Math.round(b * 100)}%`, pct: b }, 0);
    }
  };
  const up = () => {
    const x = g.current;
    if (!x.active) return;
    x.active = false;
    clearTimeout(x.long);
    if (x.hold) { vid.current!.playbackRate = L.current.speed; x.hold = false; setHud(null); return; }
    if (x.mode === "seek") { vid.current!.currentTime = x.seekTo; setHud(null); poke(); return; }
    if (x.mode === "vol" || x.mode === "bri") { clearTimeout(x.hudT); x.hudT = setTimeout(() => setHud(null), 700); return; }
    if (x.moved) return;
    const now = Date.now();
    if (now - x.lastTap < 300) {
      clearTimeout(x.tapTimer); x.lastTap = 0;
      if (x.zone === 1) { togglePlay(); poke(); }
    } else {
      x.lastTap = now;
      clearTimeout(x.tapTimer);
      x.tapTimer = setTimeout(() => setControls((c) => { if (!c) poke(); return !c; }), 280);
    }
  };

  const toggleFs = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await wrap.current!.requestFullscreen(); } catch { d.toast("Fullscreen isn’t available here"); }
  };
  const rotate = async () => {
    try {
      if (!document.fullscreenElement) await wrap.current!.requestFullscreen();
      const o = screen.orientation as unknown as { type: string; lock?: (t: string) => Promise<void> };
      await o.lock!(o.type.startsWith("portrait") ? "landscape" : "portrait");
    } catch { d.toast("Screen rotation lock isn’t supported by this browser — use your phone’s auto-rotate."); }
  };
  const pip = async () => {
    try { if (document.pictureInPictureElement) await document.exitPictureInPicture(); else await vid.current!.requestPictureInPicture(); } catch { d.toast("Picture-in-Picture isn’t supported here"); }
  };
  const loadSub = async (f: File) => {
    const text = await f.text();
    const vtt = f.name.toLowerCase().endsWith(".srt") ? srtToVtt(text) : text;
    setSubUrl(URL.createObjectURL(new Blob([vtt], { type: "text/vtt" })));
    setSubsOn(true); d.toast(`Subtitles loaded: ${f.name}`);
  };
  const pickAudio = (i: number) => {
    const a = (vid.current as unknown as { audioTracks?: { length: number; [k: number]: { enabled: boolean } } }).audioTracks;
    if (!a) return;
    for (let k = 0; k < a.length; k++) a[k].enabled = k === i;
    setAudioTracks((t) => t.map((x, k) => ({ ...x, enabled: k === i })));
  };

  const shown = scrub ?? cur;
  const showCtl = controls && !locked && !error;
  const stop = (e: React.PointerEvent) => e.stopPropagation();

  return (
    <div ref={wrap} className="fixed inset-0 z-[60] select-none overflow-hidden bg-black text-white">
      <video ref={vid} src={origUrl(item)} playsInline preload="metadata" className="absolute inset-0 h-full w-full object-contain" crossOrigin="anonymous">
        {subUrl && <track kind="subtitles" src={subUrl} srcLang="en" label="Subtitles" default />}
      </video>
      <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: (1 - bri) * 0.9 }} />
      <div className="absolute inset-0" style={{ touchAction: "none" }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />

      {buffering && !error && <div className="pointer-events-none absolute inset-0 grid place-items-center"><span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-white/80 border-t-transparent" /></div>}
      {error && (
        <div className="absolute inset-0 z-20 grid place-items-center p-8 text-center">
          <div><div className="text-lg font-semibold">This video can’t be played here</div><p className="mt-2 text-sm text-white/70">The browser’s media engine doesn’t support this codec/container ({item.format.toUpperCase()}). Share it to open it in another player.</p>
            <div className="mt-4 flex justify-center gap-2"><button className="on-media rounded-full px-5 py-2.5 font-semibold" onClick={onShare}>Open with…</button><button className="on-media rounded-full px-5 py-2.5 font-semibold" onClick={onClose}>Close</button></div></div>
        </div>
      )}

      {/* HUD */}
      {hud && (
        <div className="pointer-events-none absolute left-1/2 top-[22%] z-20 -translate-x-1/2">
          <div className="on-media anim-pop flex min-w-[120px] flex-col items-center gap-2 rounded-3xl px-5 py-3">
            {hud.kind === "vol" && (vol === 0 ? <VolumeX size={22} /> : <Volume2 size={22} />)}
            {hud.kind === "bri" && <Sun size={22} />}
            {hud.kind === "speed" && <Gauge size={22} />}
            <div className="text-base font-semibold tabular-nums">{hud.kind === "vol" ? "Volume " : hud.kind === "bri" ? "Brightness " : ""}{hud.text}</div>
            {hud.pct !== undefined && <div className="h-1.5 w-28 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-white" style={{ width: `${hud.pct * 100}%` }} /></div>}
          </div>
        </div>
      )}

      {/* Locked */}
      {locked && showUnlock && (
        <div className="absolute inset-x-0 bottom-24 z-30 flex justify-center" onPointerDown={stop}>
          <button className="on-media press flex items-center gap-2 rounded-full px-5 py-3 font-semibold" onClick={() => { setLocked(false); poke(); }}><Unlock size={18} />Unlock controls</button>
        </div>
      )}

      {/* Controls */}
      <div className={`absolute inset-0 z-10 flex flex-col justify-between transition-opacity duration-200 ${showCtl ? "opacity-100" : "pointer-events-none opacity-0"}`} style={{ pointerEvents: "none" }}>
        <div className="px-3 safe-top" style={{ pointerEvents: showCtl ? "auto" : "none" }} onPointerDown={stop}>
          <div className="on-media flex items-center gap-1 rounded-[26px] px-1.5 py-1.5">
            <button aria-label="Back" className="press grid h-10 w-10 place-items-center rounded-full" onClick={onClose}><ArrowLeft size={20} /></button>
            <div className="min-w-0 flex-1 px-1"><div className="truncate text-sm font-semibold">{item.name}</div><div className="truncate text-[11px] text-white/70">{item.width ? `${item.width}×${item.height} · ` : ""}{fmtSize(item.size)}</div></div>
            <button aria-label="Lock controls" className="press grid h-10 w-10 place-items-center rounded-full" onClick={() => { setLocked(true); setControls(false); d.toast("Controls locked"); }}><Lock size={19} /></button>
            <button aria-label="Picture in picture" className="press grid h-10 w-10 place-items-center rounded-full" onClick={pip}><PictureInPicture2 size={19} /></button>
            <button aria-label="More" className="press grid h-10 w-10 place-items-center rounded-full" onClick={() => setMenu("more")}><MoreVertical size={19} /></button>
          </div>
        </div>

        <div className="flex items-center justify-center gap-6" style={{ pointerEvents: showCtl ? "auto" : "none" }} onPointerDown={stop}>
          <button aria-label="Previous" disabled={!hasPrev} onClick={onPrev} className="on-media press grid h-11 w-11 place-items-center rounded-full disabled:opacity-30"><ChevronLeft size={22} /></button>
          <button aria-label="Back 10 seconds" onClick={() => seekBy(-s.seekSeconds)} className="on-media press relative grid h-14 w-14 place-items-center rounded-full"><RotateCcw size={24} /><span className="absolute text-[9px] font-bold">{s.seekSeconds}</span></button>
          <button aria-label={playing ? "Pause" : "Play"} onClick={togglePlay} className="on-media press grid h-[72px] w-[72px] place-items-center rounded-full">{playing ? <Pause size={32} fill="currentColor" /> : <Play size={32} fill="currentColor" className="ml-1" />}</button>
          <button aria-label="Forward 10 seconds" onClick={() => seekBy(s.seekSeconds)} className="on-media press relative grid h-14 w-14 place-items-center rounded-full"><RotateCw size={24} /><span className="absolute text-[9px] font-bold">{s.seekSeconds}</span></button>
          <button aria-label="Next" disabled={!hasNext} onClick={onNext} className="on-media press grid h-11 w-11 place-items-center rounded-full disabled:opacity-30"><ChevronRight size={22} /></button>
        </div>

        <div className="px-4 pb-[max(env(safe-area-inset-bottom),14px)]" style={{ pointerEvents: showCtl ? "auto" : "none" }} onPointerDown={stop}>
          <div className="on-media rounded-[28px] px-4 pb-2 pt-2">
            <div className="flex items-center gap-3">
              <span className="w-12 text-xs tabular-nums">{fmtClock(shown)}</span>
              <input type="range" min={0} max={dur || 1} step={0.05} value={Math.min(shown, dur || 1)} aria-label="Timeline"
                style={{ "--p": `${(shown / (dur || 1)) * 100}%` } as React.CSSProperties}
                onChange={(e) => { const v = Number(e.target.value); setScrub(v); if (vid.current) vid.current.currentTime = v; poke(); }}
                onPointerUp={() => setScrub(null)} onTouchEnd={() => setScrub(null)} />
              <span className="w-12 text-right text-xs tabular-nums">{fmtClock(dur)}</span>
            </div>
            <div className="flex items-center justify-around pt-0.5">
              <Tool label={`${speed}×`} icon={<Gauge size={19} />} onClick={() => setMenu("speed")} />
              <Tool label="Subtitles" icon={<Subtitles size={19} />} active={!!subUrl && subsOn} onClick={() => (subUrl ? setSubsOn((v) => !v) : subInput.current?.click())} />
              <Tool label="Audio" icon={<Languages size={19} />} onClick={() => setMenu("audio")} />
              <Tool label="Rotate" icon={<ScreenShare size={19} />} onClick={rotate} />
              <Tool label={fs ? "Exit" : "Full"} icon={fs ? <Minimize size={19} /> : <Maximize size={19} />} onClick={toggleFs} />
            </div>
          </div>
        </div>
      </div>
      <input ref={subInput} type="file" accept=".srt,.vtt,text/vtt" hidden onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) loadSub(f); }} />

      <div onPointerDown={stop}>
        <Sheet open={menu === "speed"} onClose={() => setMenu(null)} title="Playback speed" z={90}>
          <div className="grid grid-cols-4 gap-2 pb-2">
            {SPEEDS.map((v) => <button key={v} onClick={() => { setSpeed(v); setMenu(null); }} className={`press rounded-2xl py-3 font-semibold ${v === speed ? "accent-bg" : "card"}`}>{v}×</button>)}
          </div>
          <p className="muted px-1 pb-2 text-xs">Hold the screen for a temporary {s.holdSpeed}× boost (change in Settings → Video).</p>
        </Sheet>
        <Sheet open={menu === "audio"} onClose={() => setMenu(null)} title="Audio track" z={90}>
          {audioTracks.length > 1 ? audioTracks.map((a, i) => (
            <button key={a.id} onClick={() => { pickAudio(i); setMenu(null); }} className={`press mb-1.5 w-full rounded-2xl px-4 py-3 text-left font-medium ${a.enabled ? "accent-bg" : "card"}`}>{a.label}</button>
          )) : <p className="muted p-3 text-sm leading-relaxed">{audioTracks.length === 1 ? `Only one audio track: ${audioTracks[0].label}.` : "This browser engine doesn’t expose multiple audio tracks for this video (audio-track switching needs a native player such as Media3)."}</p>}
        </Sheet>
        <Sheet open={menu === "more"} onClose={() => setMenu(null)} title="Video" z={90}>
          <div className="grid grid-cols-3 gap-2 pb-2">
            {[
              { i: <Info size={22} />, l: "Video info", f: () => setMenu("info") },
              { i: <Pencil size={22} />, l: "Edit / Trim", f: onEdit },
              { i: <Share2 size={22} />, l: "Share", f: onShare },
              { i: <Heart size={22} fill={item.favorite ? "#ff453a" : "none"} />, l: item.favorite ? "Unfavourite" : "Favourite", f: onFavorite },
              { i: <Subtitles size={22} />, l: subUrl ? "Change subtitles" : "Add subtitles", f: () => subInput.current?.click() },
              { i: <Trash2 size={22} />, l: "Delete", f: onDelete },
            ].map((b) => (
              <button key={b.l} onClick={() => { setMenu(null); b.f(); }} className="card press flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium">{b.i}{b.l}</button>
            ))}
          </div>
        </Sheet>
        <Sheet open={menu === "info"} onClose={() => setMenu(null)} title="Video information" z={90}>
          {[
            ["Name", item.name], ["Format", item.format.toUpperCase()], ["Resolution", item.width ? `${item.width} × ${item.height}` : "Unknown"],
            ["Duration", fmtDur((dur || item.durationMs / 1000) * 1000)], ["Size", fmtSize(item.size)],
            ["Avg. bitrate", dur ? `${((item.size * 8) / dur / 1e6).toFixed(2)} Mbps` : "—"], ["Date", fmtDateTime(item.takenAt)], ["Album", item.albumName ?? "—"],
          ].map(([k, v]) => <div key={k} className="flex justify-between gap-4 border-b border-[var(--hair)] py-2.5 text-sm last:border-0"><span className="muted">{k}</span><span className="break-all text-right font-medium">{v}</span></div>)}
        </Sheet>
      </div>
    </div>
  );
}

function Tool({ icon, label, onClick, active }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean }) {
  return <button onClick={onClick} className={`press flex min-w-[56px] flex-col items-center gap-0.5 py-1 text-[10.5px] font-semibold ${active ? "text-yellow-300" : ""}`}>{icon}{label}</button>;
}
// SkipBack/SkipForward icons intentionally unused
void SkipBack; void SkipForward;
