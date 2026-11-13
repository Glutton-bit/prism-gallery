"use client";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Camera, Check, ChevronRight, Fingerprint, Info } from "lucide-react";
import type { Album } from "@/lib/types";
import { api, patch, post, origUrl } from "@/lib/api";
import { defaultSettings } from "@/lib/defaults";
import { fmtSize } from "@/lib/format";
import { importFiles, makeThumbBlob } from "@/lib/imaging";
import { vaultStatus, type VaultStatus } from "@/components/actions";
import { useDialogs, useSettings } from "@/components/providers";
import { Btn, Segmented, Sheet, Slider, Toggle } from "@/components/ui";
import { ImportSheet } from "@/components/import-sheet";

const ACCENTS = ["#0a84ff", "#5e5ce6", "#bf5af2", "#ff2d55", "#ff9f0a", "#30d158", "#00c7be", "#ff6b35"];

function Section({ title, children, onTitleHold }: { title: string; children: ReactNode; onTitleHold?: () => void }) {
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <section className="mb-5">
      <h2 className="muted select-none px-3 pb-2 text-xs font-bold uppercase tracking-wider"
        onPointerDown={() => { if (onTitleHold) t.current = setTimeout(onTitleHold, 1200); }} onPointerUp={() => t.current && clearTimeout(t.current)} onPointerLeave={() => t.current && clearTimeout(t.current)}>{title}</h2>
      <div className="glass divide-y divide-[var(--hair)] overflow-hidden rounded-3xl">{children}</div>
    </section>
  );
}
function Row({ label, desc, children, onClick, stack }: { label: string; desc?: string; children?: ReactNode; onClick?: () => void; stack?: boolean }) {
  const C = onClick ? "button" : "div";
  return (
    <C onClick={onClick} className={`flex w-full gap-3 px-4 py-3.5 text-left ${stack ? "flex-col" : "items-center justify-between"} ${onClick ? "press" : ""}`}>
      <div className="min-w-0"><div className="text-[15px] font-medium">{label}</div>{desc && <div className="muted mt-0.5 text-xs leading-snug">{desc}</div>}</div>
      {children && <div className={stack ? "w-full" : "shrink-0"}>{children}</div>}
    </C>
  );
}
function Pick<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return <select value={String(value)} onChange={(e) => { const o = options.find((x) => String(x.v) === e.target.value)!; onChange(o.v); }} className="!w-auto !rounded-full !py-1.5 text-sm">{options.map((o) => <option key={String(o.v)} value={String(o.v)}>{o.label}</option>)}</select>;
}

export default function SettingsPage() {
  const { s, update } = useSettings();
  const d = useDialogs();
  const router = useRouter();
  const [albums, setAlbums] = useState<Album[]>([]);
  const [vs, setVs] = useState<VaultStatus | null>(null);
  const [usage, setUsage] = useState<{ thumbs: number; previews: number; originals: number } | null>(null);
  const [stats, setStats] = useState<{ size: number; trash: number; trashSize: number; vault: number; vaultSize: number; total: number } | null>(null);
  const [sheet, setSheet] = useState<null | "licenses" | "privacy" | "support" | "import">(null);
  const [busy, setBusy] = useState<string | null>(null);
  const camera = albums.find((a) => a.isCamera);

  const refresh = useCallback(() => {
    api<Album[]>("/api/albums").then(setAlbums).catch(() => {});
    vaultStatus().then(setVs).catch(() => {});
    api<typeof usage>("/api/storage").then(setUsage).catch(() => {});
    api<typeof stats>("/api/discover?type=stats").then(setStats).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const setCamera = async () => {
    const r = await d.pickAlbum({ title: "Identify Camera folder" });
    if (!r?.albumId) return;
    await patch(`/api/albums/${r.albumId}`, { isCamera: true });
    d.toast("Camera folder updated — Home now shows only this folder"); refresh();
  };
  const changeSecret = async () => {
    if (!vs?.configured) { router.push("/vault"); return; }
    const old = await d.prompt({ title: "Current " + (vs.authType === "pin" ? "PIN" : "password"), type: "password" });
    if (!old) return;
    const type = await d.confirm({ title: "Use a password instead?", message: `Currently using a ${vs.authType}. Choose “Password” for a longer secret, or “PIN” for digits.`, confirmText: vs.authType === "pin" ? "Password" : "PIN" }).then((x) => (x ? (vs.authType === "pin" ? "password" : "pin") : vs.authType!));
    const nw = await d.prompt({ title: type === "pin" ? "New PIN (4–8 digits)" : "New password (6+ chars)", type: "password" });
    if (!nw) return;
    try { await post("/api/vault", { action: "change", old, secret: nw, authType: type }); d.toast("Security updated"); refresh(); } catch (e) { d.toast((e as Error).message); }
  };
  const removeSecret = async () => {
    const v = await d.prompt({ title: "Remove protection", message: "Enter your PIN/password. All private files must be restored first.", type: "password" });
    if (!v) return;
    try { await post("/api/vault", { action: "remove", secret: v }); d.toast("Private folder removed"); update({ vaultHidden: false }); refresh(); } catch (e) { d.toast((e as Error).message); }
  };
  const clearCache = async () => {
    setBusy("Clearing…");
    try {
      for (const k of await caches.keys()) await caches.delete(k);
      d.toast("Cache cleared — thumbnails reload on demand");
    } catch { d.toast("Cache API unavailable"); }
    setBusy(null);
  };
  const rebuild = async () => {
    const ok = await d.confirm({ title: "Rebuild thumbnails?", message: `Regenerates every thumbnail at “${s.lowMemory ? "low" : s.thumbQuality}” quality from the original files (private items are skipped).`, confirmText: "Rebuild" });
    if (!ok) return;
    try {
      const r = await api<{ ids: number[] }>("/api/media?scope=all&ids=1&kind=");
      const ids = r.ids;
      for (let i = 0; i < ids.length; i++) {
        setBusy(`Rebuilding ${i + 1}/${ids.length}`);
        try {
          const meta = await api<{ format: string; kind: "image" | "video" }>(`/api/media/${ids[i]}`);
          const blob = await (await fetch(origUrl({ id: ids[i], modifiedAt: String(Date.now()) }))).blob();
          const th = await makeThumbBlob(blob, meta, s);
          await fetch(`/api/media/${ids[i]}/thumb`, { method: "PUT", body: th });
        } catch { /* skip undecodable */ }
      }
      for (const k of await caches.keys()) await caches.delete(k);
      d.toast("Thumbnails rebuilt");
    } catch (e) { d.toast((e as Error).message); }
    setBusy(null); refresh();
  };
  const scanFolder = useRef<HTMLInputElement>(null);

  return (
    <div className="px-3 pb-6">
      <header className="sticky top-0 z-30 pb-3 safe-top"><div className="glass-strong rounded-[26px] px-4 py-2.5"><h1 className="text-[19px] font-bold">Settings</h1></div></header>

      <Section title="Appearance">
        <Row label="Theme" stack><Segmented value={s.theme} onChange={(v) => update({ theme: v })} options={[{ v: "system", label: "System" }, { v: "light", label: "Light" }, { v: "dark", label: "Dark" }]} /></Row>
        <Row label="Accent colour" stack><div className="flex flex-wrap gap-3">{ACCENTS.map((c) => <button key={c} aria-label={c} onClick={() => update({ accent: c })} className="grid h-9 w-9 place-items-center rounded-full ring-2 ring-offset-2 ring-offset-transparent" style={{ background: c, ["--tw-ring-color" as string]: s.accent === c ? c : "transparent" }}>{s.accent === c && <Check size={16} className="text-white" />}</button>)}</div></Row>
        <Row label="Glass transparency" desc={`${s.glass}% surface opacity`} stack><Slider min={20} max={90} value={s.glass} onChange={(v) => update({ glass: v })} /></Row>
        <Row label="Animations" desc="‘Off’ disables all motion; ‘Reduced’ shortens it" stack><Segmented value={s.animations} onChange={(v) => update({ animations: v })} options={[{ v: "full", label: "Full" }, { v: "reduced", label: "Reduced" }, { v: "off", label: "Off" }]} /></Row>
        <Row label="Grid size" desc={`${s.gridCols} thumbnails per row`} stack><Slider min={2} max={7} value={9 - s.gridCols} onChange={(v) => update({ gridCols: 9 - v })} /></Row>
        <Row label="Thumbnail spacing" desc={`${s.gridGap}px`} stack><Slider min={0} max={12} value={s.gridGap} onChange={(v) => update({ gridGap: v })} /></Row>
      </Section>

      <Section title="Gallery">
        <Row label="Default opening page"><Pick value={s.defaultPage} onChange={(v) => update({ defaultPage: v })} options={[{ v: "home", label: "Home (Camera)" }, { v: "albums", label: "Albums" }, { v: "library", label: "Explore" }]} /></Row>
        <Row label="Camera folder" desc={camera ? `${camera.name}${camera.path ? ` · ${camera.path}` : ""} — Home shows only this folder` : "Not identified yet — Home is empty until you set it"} onClick={setCamera}><span className="flex items-center gap-1 text-sm accent-text"><Camera size={15} />Change<ChevronRight size={15} /></span></Row>
        <Row label="Import folder / scan" desc="Pick a folder (e.g. DCIM) — subfolders are identified from their real paths and become albums" onClick={() => setSheet("import")}><ChevronRight size={18} className="muted" /></Row>
        <Row label="Background scanning" desc="Checks for new media and folders every 15 s while the app is open"><Toggle checked={s.bgScan} onChange={(v) => update({ bgScan: v })} /></Row>
        <Row label="Show hidden albums" desc="Hidden albums are listed in Albums and included in categories"><Toggle checked={s.showHiddenAlbums} onChange={(v) => update({ showHiddenAlbums: v })} /></Row>
        <Row label="Thumbnail quality" desc="Applies to newly imported media; use Rebuild for existing" stack><Segmented value={s.thumbQuality} onChange={(v) => update({ thumbQuality: v })} options={[{ v: "low", label: "Low" }, { v: "balanced", label: "Balanced" }, { v: "high", label: "High" }]} /></Row>
        <Row label="Drag-select hold time" desc={`Hold ${(s.dragHoldMs / 1000).toFixed(1)} s on a photo, then drag across others`} stack><Slider min={400} max={3000} step={100} value={s.dragHoldMs} onChange={(v) => update({ dragHoldMs: v })} /></Row>
        <Row label="Reset remembered sorting" desc="Each section/album remembers its own sort order" onClick={() => { update({ sorts: {}, groups: {} }); d.toast("Sorting reset"); }}><ChevronRight size={18} className="muted" /></Row>
      </Section>

      <Section title="Photo viewer">
        <Row label="Double-tap to zoom"><Toggle checked={s.doubleTapZoom} onChange={(v) => update({ doubleTapZoom: v })} /></Row>
        <Row label="Default zoom" desc={`${s.defaultZoom.toFixed(1)}×`} stack><Slider min={1.5} max={5} step={0.5} value={s.defaultZoom} onChange={(v) => update({ defaultZoom: v })} /></Row>
        <Row label="Swipe between photos"><Toggle checked={s.swipeNav} onChange={(v) => update({ swipeNav: v })} /></Row>
        <Row label="HD preview prompt" desc="Offer the original when a lower-resolution preview is shown"><Toggle checked={s.hdPreview} onChange={(v) => update({ hdPreview: v })} /></Row>
        <Row label="Show details on open"><Toggle checked={s.showInfoOnOpen} onChange={(v) => update({ showInfoOnOpen: v })} /></Row>
        <Row label="Slideshow interval"><Pick value={s.slideshowSeconds} onChange={(v) => update({ slideshowSeconds: v })} options={[2, 3, 5, 8, 12].map((v) => ({ v, label: `${v} s` }))} /></Row>
      </Section>

      <Section title="Video player">
        <Row label="Default playback speed"><Pick value={s.videoSpeed} onChange={(v) => update({ videoSpeed: v })} options={[0.25, 0.5, 0.75, 1, 1.25, 1.5, 2].map((v) => ({ v, label: `${v}×` }))} /></Row>
        <Row label="Hold-to-speed-up rate"><Pick value={s.holdSpeed} onChange={(v) => update({ holdSpeed: v })} options={[1.5, 2, 3, 4].map((v) => ({ v, label: `${v}×` }))} /></Row>
        <Row label="Gesture sensitivity" desc={`${s.gestureSens.toFixed(1)}×`} stack><Slider min={0.5} max={2} step={0.1} value={s.gestureSens} onChange={(v) => update({ gestureSens: v })} /></Row>
        <Row label="Skip duration"><Pick value={s.seekSeconds} onChange={(v) => update({ seekSeconds: v })} options={[5, 10, 15, 30].map((v) => ({ v, label: `${v} s` }))} /></Row>
        <Row label="Resume playback" desc="Each video remembers its own position"><Toggle checked={s.resume} onChange={(v) => update({ resume: v })} /></Row>
        <Row label="Starting brightness" desc={`${s.videoBrightness}% (in-app dimming; Android’s system brightness can’t be set by a web app)`} stack><Slider min={10} max={100} value={s.videoBrightness} onChange={(v) => update({ videoBrightness: v })} /></Row>
        <Row label="Starting volume" desc={`${s.videoVolume}%`} stack><Slider min={0} max={100} value={s.videoVolume} onChange={(v) => update({ videoVolume: v })} /></Row>
        <Row label="Subtitle size" desc={`${s.subtitleSize}%`} stack><Slider min={60} max={220} step={10} value={s.subtitleSize} onChange={(v) => update({ subtitleSize: v })} /></Row>
        <Row label="Subtitle colour"><Pick value={s.subtitleColor} onChange={(v) => update({ subtitleColor: v })} options={[{ v: "#ffffff", label: "White" }, { v: "#ffe14d", label: "Yellow" }, { v: "#7dffb2", label: "Green" }, { v: "#7fd4ff", label: "Cyan" }]} /></Row>
      </Section>

      <Section title="Editor">
        <Row label="Export quality" desc={`${s.editorQuality}% (JPEG / WebP)`} stack><Slider min={50} max={100} value={s.editorQuality} onChange={(v) => update({ editorQuality: v })} /></Row>
        <Row label="Default image format"><Pick value={s.editorFormat} onChange={(v) => update({ editorFormat: v })} options={[{ v: "jpeg", label: "JPEG" }, { v: "png", label: "PNG" }, { v: "webp", label: "WebP" }]} /></Row>
        <Row label="Max export size"><Pick value={s.editorMaxSize} onChange={(v) => update({ editorMaxSize: v })} options={[{ v: 0, label: "Original" }, { v: 4096, label: "4096 px" }, { v: 2560, label: "2560 px" }, { v: 1920, label: "1920 px" }, { v: 1280, label: "1280 px" }]} /></Row>
        <Row label="Preserve original" desc="On: edits are always saved as a new copy. Off: ‘Replace original’ becomes available in the editor"><Toggle checked={s.preserveOriginal} onChange={(v) => update({ preserveOriginal: v })} /></Row>
      </Section>

      <Section title="Privacy" onTitleHold={() => router.push("/vault")}>
        <Row label="Private folder" desc={vs?.configured ? `Protected with a ${vs.authType} · AES-256-GCM encrypted${vs.unlocked ? " · unlocked" : ""}` : "Not set up yet"} onClick={() => router.push("/vault")}><ChevronRight size={18} className="muted" /></Row>
        <Row label={vs?.configured ? "Change PIN / password" : "Set up PIN / password"} onClick={changeSecret}><ChevronRight size={18} className="muted" /></Row>
        <Row label="Auto-lock"><Pick value={s.autoLock} onChange={(v) => update({ autoLock: v })} options={[{ v: 1, label: "1 min" }, { v: 5, label: "5 min" }, { v: 15, label: "15 min" }, { v: 60, label: "1 hour" }, { v: 0, label: "On exit" }]} /></Row>
        <Row label="Hide private folder entry" desc="Removes it from Explore. To open it: press and hold the ‘Privacy’ heading here for ~1 s"><Toggle checked={s.vaultHidden} onChange={(v) => update({ vaultHidden: v })} /></Row>
        <Row label="Biometric unlock" desc="Not available: fingerprint/face unlock requires a native Android app (BiometricPrompt)."><Fingerprint size={20} className="muted" /></Row>
        {vs?.configured && <Row label="Remove protection" desc="Only possible when the private folder is empty" onClick={removeSecret}><span className="text-sm text-[var(--danger)]">Remove</span></Row>}
      </Section>

      <Section title="Storage">
        <Row label="Library" desc={stats ? `${stats.total} items · ${fmtSize(stats.size)} visible · Trash ${stats.trash} (${fmtSize(stats.trashSize)}) · Private ${stats.vault} (${fmtSize(stats.vaultSize)})` : "…"} />
        <Row label="Files on disk" desc={usage ? `Originals ${fmtSize(usage.originals)} · Previews ${fmtSize(usage.previews)} · Thumbnails ${fmtSize(usage.thumbs)}` : "…"} />
        <Row label="Trash retention" desc="Older items are erased automatically"><Pick value={s.trashDays} onChange={(v) => update({ trashDays: v })} options={[7, 14, 30, 60, 90].map((v) => ({ v, label: `${v} days` }))} /></Row>
        <Row label="Low-memory mode" desc="Smaller thumbnails & pages, no blur effects, one import at a time, no polling (recommended for 4 GB devices)"><Toggle checked={s.lowMemory} onChange={(v) => update({ lowMemory: v })} /></Row>
        <Row label="Clear cache" desc="Clears the thumbnail/preview cache stored on this device" onClick={clearCache}><span className="text-sm accent-text">{busy ?? "Clear"}</span></Row>
        <Row label="Rebuild thumbnails" desc="Re-creates thumbnails at the current quality" onClick={rebuild}><span className="text-sm accent-text">{busy?.startsWith("Rebuilding") ? busy : "Rebuild"}</span></Row>
        <Row label="Reset all settings" onClick={async () => { if (await d.confirm({ title: "Reset settings?", message: "Albums and media are not affected.", confirmText: "Reset" })) { update({ ...defaultSettings }); } }}><span className="text-sm text-[var(--danger)]">Reset</span></Row>
      </Section>

      <Section title="About">
        <Row label="Prism Gallery" desc="Version 1.0.0 · web/PWA build"><Info size={18} className="muted" /></Row>
        <Row label="Developer" desc="Prism Gallery — independent, local-first gallery" />
        <Row label="Open-source licences" onClick={() => setSheet("licenses")}><ChevronRight size={18} className="muted" /></Row>
        <Row label="Privacy policy" onClick={() => setSheet("privacy")}><ChevronRight size={18} className="muted" /></Row>
        <Row label="Support & install guide" onClick={() => setSheet("support")}><ChevronRight size={18} className="muted" /></Row>
      </Section>

      <input ref={scanFolder} type="file" hidden />
      <ImportSheet open={sheet === "import"} onClose={() => setSheet(null)} onDone={refresh} showSamples />
      <Sheet open={sheet === "licenses"} onClose={() => setSheet(null)} title="Open-source licences">
        <div className="space-y-2 pb-2 text-sm">{[["Next.js, React", "MIT"], ["Drizzle ORM", "Apache-2.0"], ["node-postgres", "MIT"], ["lucide-react (icons)", "ISC"], ["exifr (EXIF/GPS)", "MIT"], ["@jsquash/avif (libavif + dav1d WASM AVIF decoder)", "Apache-2.0 / BSD-2-Clause"], ["Tailwind CSS", "MIT"]].map(([a, b]) => <div key={a} className="card flex justify-between gap-3 rounded-2xl px-4 py-3"><span className="font-medium">{a}</span><span className="muted shrink-0">{b}</span></div>)}</div>
      </Sheet>
      <Sheet open={sheet === "privacy"} onClose={() => setSheet(null)} title="Privacy policy">
        <div className="muted space-y-3 pb-3 text-sm leading-relaxed"><p>Prism Gallery is local-first. Your photos, videos, thumbnails, previews, metadata and settings are stored only on the server instance you run it on — nothing is sent to third parties, and there is no analytics, advertising or cloud backup.</p><p>Face recognition and cloud AI are not implemented, so no biometric or face data is created. Duplicate and similar-photo detection use hashes computed locally.</p><p>Private-folder files are AES-256-GCM encrypted; the key is derived from your PIN/password (scrypt) and kept in memory only while unlocked.</p></div>
      </Sheet>
      <Sheet open={sheet === "support"} onClose={() => setSheet(null)} title="Support & installation" tall>
        <div className="muted space-y-3 pb-3 text-sm leading-relaxed">
          <p><b className="text-[var(--fg)]">Install on Android:</b> open the app URL in Chrome → ⋮ menu → <i>Install app</i> / <i>Add to Home screen</i>. It then runs full-screen, caches its shell and thumbnails for offline browsing, and can be shared to.</p>
          <p><b className="text-[var(--fg)]">Getting your photos in:</b> Home → ＋ → <i>Choose a folder</i> and select DCIM (or Camera). Folder names come from the real path, so <code>DCIM/Camera</code> is identified as your Camera folder automatically.</p>
          <p><b className="text-[var(--fg)]">Gestures in video:</b> right side ↕ volume, left side ↕ brightness, centre double-tap pause/resume, ↔ drag seeks, press-and-hold = temporary {s.holdSpeed}× speed.</p>
          <p><b className="text-[var(--fg)]">Selection:</b> long-press to start selecting; keep holding ~{(s.dragHoldMs / 1000).toFixed(0)} s, then drag across items to select them (drag over selected ones to deselect).</p>
          <p><b className="text-[var(--fg)]">Known platform limits:</b> a browser app cannot scan the phone’s storage, set the system wallpaper/brightness, use fingerprint unlock, or write into MediaStore — those need a native Android build.</p>
        </div>
      </Sheet>
    </div>
  );
}
void importFiles;
