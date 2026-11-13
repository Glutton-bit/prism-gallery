import type { Settings } from "./defaults";
import type { Item } from "./types";
import { origUrl } from "./api";

export const IMAGE_EXT = ["jpg", "jpeg", "png", "webp", "gif", "bmp", "heic", "heif", "avif", "tif", "tiff", "ico", "svg"];
export const VIDEO_EXT = ["mp4", "mkv", "webm", "3gp", "mov", "m4v", "avi", "ts"];
const MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif", bmp: "image/bmp",
  heic: "image/heic", heif: "image/heif", avif: "image/avif", tif: "image/tiff", tiff: "image/tiff", ico: "image/x-icon", svg: "image/svg+xml",
  mp4: "video/mp4", mkv: "video/x-matroska", webm: "video/webm", "3gp": "video/3gpp", mov: "video/quicktime", m4v: "video/mp4", avi: "video/x-msvideo", ts: "video/mp2t",
};
export const extOf = (name: string) => (name.split(".").pop() ?? "").toLowerCase();
export const isMediaName = (n: string) => IMAGE_EXT.includes(extOf(n)) || VIDEO_EXT.includes(extOf(n));

/* ---------- decoding (browser decoder first, bundled WASM AVIF decoder as fallback) ---------- */
let avifReady: Promise<(b: ArrayBuffer) => Promise<ImageData | null>> | null = null;
async function avifDecoder() {
  avifReady ??= import("@jsquash/avif/decode").then(async (m) => {
    await m.init({ locateFile: (p: string) => (p.endsWith(".wasm") ? "/codecs/avif_dec.wasm" : p) } as never);
    return (b: ArrayBuffer) => m.default(b);
  });
  return avifReady;
}
export type Decoded = { src: CanvasImageSource; w: number; h: number; viaWasm: boolean; close: () => void };

export async function decodeImage(blob: Blob, format: string): Promise<Decoded> {
  try {
    const bmp = await createImageBitmap(blob);
    return { src: bmp, w: bmp.width, h: bmp.height, viaWasm: false, close: () => bmp.close() };
  } catch (e) {
    if (format !== "avif") throw e;
  }
  const dec = await avifDecoder();
  const data = await dec(await blob.arrayBuffer());
  if (!data) throw new Error("AVIF decode failed");
  const c = document.createElement("canvas");
  c.width = data.width;
  c.height = data.height;
  c.getContext("2d")!.putImageData(data, 0, 0);
  return { src: c, w: c.width, h: c.height, viaWasm: true, close: () => { c.width = c.height = 0; } };
}

export function canvasToBlob(c: HTMLCanvasElement, type: string, q: number) {
  return new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error("encode failed"))), type, q));
}
function drawCover(d: Decoded, size: number) {
  const c = document.createElement("canvas");
  const s = Math.min(1, size / Math.min(d.w, d.h));
  const ratio = Math.min(d.w, d.h);
  c.width = c.height = Math.max(1, Math.round(ratio * s));
  const sx = (d.w - ratio) / 2, sy = (d.h - ratio) / 2;
  c.getContext("2d")!.drawImage(d.src, sx, sy, ratio, ratio, 0, 0, c.width, c.height);
  return c;
}
function drawFit(d: Decoded, maxLong: number) {
  const s = Math.min(1, maxLong / Math.max(d.w, d.h));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(d.w * s));
  c.height = Math.max(1, Math.round(d.h * s));
  c.getContext("2d")!.drawImage(d.src, 0, 0, c.width, c.height);
  return c;
}
function dhash(d: Decoded) {
  const c = document.createElement("canvas");
  c.width = 9; c.height = 8;
  const x = c.getContext("2d", { willReadFrequently: true })!;
  x.drawImage(d.src, 0, 0, 9, 8);
  const px = x.getImageData(0, 0, 9, 8).data;
  const g = (i: number, j: number) => { const o = (j * 9 + i) * 4; return px[o] * 0.3 + px[o + 1] * 0.59 + px[o + 2] * 0.11; };
  let hex = "", nib = 0, n = 0;
  for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
    nib = (nib << 1) | (g(i, j) > g(i + 1, j) ? 1 : 0);
    if (++n % 4 === 0) { hex += nib.toString(16); nib = 0; }
  }
  return hex;
}
export const thumbParams = (s: Pick<Settings, "thumbQuality" | "lowMemory">) => {
  const q = s.lowMemory ? "low" : s.thumbQuality;
  return q === "low" ? { size: 200, q: 0.6 } : q === "high" ? { size: 480, q: 0.82 } : { size: 320, q: 0.72 };
};

/* ---------- video probing ---------- */
export async function probeVideo(blob: Blob) {
  const url = URL.createObjectURL(blob);
  const v = document.createElement("video");
  v.muted = true; v.preload = "metadata"; v.playsInline = true; v.src = url;
  try {
    await new Promise<void>((res, rej) => { v.onloadedmetadata = () => res(); v.onerror = () => rej(new Error("video unsupported")); setTimeout(() => rej(new Error("timeout")), 8000); });
    if (!isFinite(v.duration)) {
      v.currentTime = 1e9;
      await new Promise<void>((res) => { v.ontimeupdate = () => res(); setTimeout(res, 2000); });
    }
    const dur = isFinite(v.duration) ? v.duration : 0;
    v.currentTime = Math.min(dur * 0.1, 1);
    await new Promise<void>((res) => { v.onseeked = () => res(); setTimeout(res, 3000); });
    return { v, url, duration: dur };
  } catch (e) {
    URL.revokeObjectURL(url);
    throw e;
  }
}

/* ---------- import / upload ---------- */
export type Overrides = { albumId?: number; albumName?: string; albumPath?: string | null; replaceId?: number; edited?: boolean; durationMs?: number; takenAt?: string; name?: string };

export async function uploadOne(file: File, s: Pick<Settings, "thumbQuality" | "lowMemory">, o: Overrides = {}) {
  const name = o.name ?? file.name;
  const ext = extOf(name);
  const format = ext === "jpeg" ? "jpg" : ext || "bin";
  const mime = file.type || MIME[ext] || "application/octet-stream";
  const kind: "image" | "video" = mime.startsWith("video/") || VIDEO_EXT.includes(ext) ? "video" : "image";
  const tp = thumbParams(s);
  const meta: Record<string, unknown> = {
    name, mime, format, kind, takenAt: o.takenAt ?? new Date(file.lastModified).toISOString(),
    albumId: o.albumId, albumName: o.albumName, albumPath: o.albumPath ?? null, replaceId: o.replaceId, edited: o.edited,
    sourcePath: (file as File & { webkitRelativePath?: string }).webkitRelativePath || null,
    width: 0, height: 0, previewWidth: 0, previewHeight: 0, durationMs: o.durationMs ?? 0, animated: false, phash: "",
  };
  const form = new FormData();
  form.append("file", file);

  if (kind === "image") {
    try {
      const head = new Uint8Array(await file.slice(0, 512).arrayBuffer());
      const txt = new TextDecoder("latin1").decode(head);
      meta.animated = format === "gif" || (format === "avif" && txt.includes("avis")) || (format === "webp" && txt.includes("ANIM"));
    } catch { /* ignore */ }
    if (["jpg", "tif", "tiff", "heic", "heif", "avif", "png", "webp"].includes(format)) {
      try {
        const exifr = (await import("exifr")).default;
        const x = await exifr.parse(file, { gps: true, tiff: true, exif: true, translateValues: true });
        if (x) {
          const d = x.DateTimeOriginal ?? x.CreateDate;
          if (d instanceof Date && !isNaN(+d) && !o.takenAt) meta.takenAt = d.toISOString();
          if (typeof x.latitude === "number" && typeof x.longitude === "number") {
            meta.lat = x.latitude; meta.lng = x.longitude;
            meta.place = `${Math.abs(x.latitude).toFixed(1)}°${x.latitude >= 0 ? "N" : "S"}, ${Math.abs(x.longitude).toFixed(1)}°${x.longitude >= 0 ? "E" : "W"}`;
          }
          if (x.Make || x.Model) meta.camera = [x.Make, x.Model].filter(Boolean).join(" ");
          meta.exif = {
            Make: x.Make, Model: x.Model, LensModel: x.LensModel, ISO: x.ISO, FNumber: x.FNumber, ExposureTime: x.ExposureTime,
            FocalLength: x.FocalLength, Flash: typeof x.Flash === "string" ? x.Flash : undefined, Software: x.Software,
            Orientation: typeof x.Orientation === "string" ? x.Orientation : undefined, ColorSpace: typeof x.ColorSpace === "string" ? x.ColorSpace : undefined,
            GPSAltitude: x.GPSAltitude,
          };
        }
      } catch { /* no exif */ }
    }
    try {
      const d = await decodeImage(file, format);
      meta.width = d.w; meta.height = d.h;
      try { meta.phash = dhash(d); } catch { /* ignore */ }
      const tc = drawCover(d, tp.size);
      form.append("thumb", await canvasToBlob(tc, "image/webp", tp.q));
      const needsPrev = d.viaWasm || format === "bmp" || Math.max(d.w, d.h) > 2560;
      if (needsPrev) {
        const pc = drawFit(d, 1600);
        meta.previewWidth = pc.width; meta.previewHeight = pc.height;
        form.append("preview", await canvasToBlob(pc, "image/webp", 0.82));
        pc.width = pc.height = 0;
      }
      tc.width = tc.height = 0;
      d.close();
    } catch {
      meta.width = 0; // undecodable here (e.g. HEIC on Chrome): stored safely, shown with a placeholder
    }
  } else {
    try {
      const { v, url, duration } = await probeVideo(file);
      meta.width = v.videoWidth; meta.height = v.videoHeight;
      if (!o.durationMs) meta.durationMs = Math.round(duration * 1000);
      const c = document.createElement("canvas");
      const m = Math.min(v.videoWidth, v.videoHeight) || 1;
      const sc = Math.min(1, tp.size / m);
      c.width = c.height = Math.max(1, Math.round(m * sc));
      c.getContext("2d")!.drawImage(v, (v.videoWidth - m) / 2, (v.videoHeight - m) / 2, m, m, 0, 0, c.width, c.height);
      form.append("thumb", await canvasToBlob(c, "image/webp", tp.q));
      URL.revokeObjectURL(url);
      v.removeAttribute("src");
    } catch { /* unsupported codec: still imported */ }
  }
  form.append("meta", JSON.stringify(meta));
  const res = await fetch("/api/media", { method: "POST", body: form });
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
  return (await res.json()) as { id: number; albumId: number };
}

export type ImportTarget = { albumId?: number; albumName?: string; usePaths?: boolean };
export async function importFiles(files: File[], s: Pick<Settings, "thumbQuality" | "lowMemory">, target: ImportTarget, onProgress?: (done: number, total: number) => void) {
  const list = files.filter((f) => isMediaName(f.name));
  let done = 0, ok = 0;
  const failed: string[] = [];
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const f = list[next++];
      try {
        const o: Overrides = { albumId: target.albumId, albumName: target.albumName };
        const rel = (f as File & { webkitRelativePath?: string }).webkitRelativePath;
        if (target.usePaths && rel && rel.includes("/")) {
          const parts = rel.split("/");
          o.albumName = parts[parts.length - 2];
          o.albumPath = parts.slice(0, -1).join("/");
          o.albumId = undefined;
        }
        await uploadOne(f, s, o);
        ok++;
      } catch { failed.push(f.name); }
      onProgress?.(++done, list.length);
    }
  };
  await Promise.all(Array.from({ length: s.lowMemory ? 1 : 2 }, worker));
  return { ok, failed, skipped: files.length - list.length };
}

/* ---------- original loading (HD preview) ---------- */
export async function loadOriginalBlobUrl(item: Item): Promise<{ url: string; w: number; h: number; size: number }> {
  const res = await fetch(origUrl(item));
  if (!res.ok) throw new Error("Original unavailable");
  const blob = await res.blob();
  try {
    const bmp = await createImageBitmap(blob);
    const w = bmp.width, h = bmp.height;
    bmp.close();
    return { url: URL.createObjectURL(blob), w, h, size: blob.size };
  } catch {
    const d = await decodeImage(blob, item.format);
    const c = document.createElement("canvas");
    c.width = d.w; c.height = d.h;
    c.getContext("2d")!.drawImage(d.src, 0, 0);
    const out = await canvasToBlob(c, "image/png", 1);
    d.close();
    return { url: URL.createObjectURL(out), w: c.width, h: c.height, size: blob.size };
  }
}

export async function convertImage(item: Item, to: "jpeg" | "png", s: Pick<Settings, "thumbQuality" | "lowMemory" | "editorQuality">) {
  const blob = await (await fetch(origUrl(item))).blob();
  const d = await decodeImage(blob, item.format);
  const c = document.createElement("canvas");
  c.width = d.w; c.height = d.h;
  const x = c.getContext("2d")!;
  if (to === "jpeg") { x.fillStyle = "#fff"; x.fillRect(0, 0, c.width, c.height); }
  x.drawImage(d.src, 0, 0);
  d.close();
  const out = await canvasToBlob(c, `image/${to}`, s.editorQuality / 100);
  c.width = c.height = 0;
  const name = item.name.replace(/\.[^.]+$/, "") + (to === "jpeg" ? ".jpg" : ".png");
  return uploadOne(new File([out], name, { type: out.type, lastModified: new Date(item.takenAt).getTime() }), s, { albumId: item.albumId, takenAt: item.takenAt, edited: true });
}

/* ---------- sharing ---------- */
export async function shareItems(items: Item[], download = false) {
  const files: File[] = [];
  for (const it of items.slice(0, 20)) {
    const b = await (await fetch(origUrl(it))).blob();
    files.push(new File([b], it.name, { type: it.mime }));
  }
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!download && nav.canShare?.({ files })) {
    await nav.share({ files });
    return "shared";
  }
  for (const f of files) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(f); a.download = f.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  return "downloaded";
}

/* ---------- sample generator (offline, canvas-drawn) ---------- */
export async function generateSamples(s: Pick<Settings, "thumbQuality" | "lowMemory">, onProgress?: (d: number, t: number) => void) {
  const specs: { album: string; path: string; n: number; w: number; h: number; prefix: string; ext: "jpeg" | "png" }[] = [
    { album: "Camera", path: "DCIM/Camera", n: 18, w: 1600, h: 1200, prefix: "IMG_", ext: "jpeg" },
    { album: "Screenshots", path: "Pictures/Screenshots", n: 6, w: 720, h: 1560, prefix: "Screenshot_", ext: "png" },
    { album: "WhatsApp Images", path: "WhatsApp/Media/WhatsApp Images", n: 6, w: 1080, h: 1080, prefix: "IMG-WA", ext: "jpeg" },
    { album: "Download", path: "Download", n: 4, w: 1200, h: 800, prefix: "download_", ext: "jpeg" },
  ];
  const total = specs.reduce((a, b) => a + b.n, 0);
  let done = 0;
  for (const sp of specs) {
    for (let i = 0; i < sp.n; i++) {
      const c = document.createElement("canvas");
      c.width = sp.w; c.height = sp.h;
      const x = c.getContext("2d")!;
      const hue = (i * 47 + sp.album.length * 31) % 360;
      const g = x.createLinearGradient(0, 0, sp.w, sp.h);
      g.addColorStop(0, `hsl(${hue} 80% 62%)`); g.addColorStop(1, `hsl(${(hue + 70) % 360} 75% 38%)`);
      x.fillStyle = g; x.fillRect(0, 0, sp.w, sp.h);
      for (let k = 0; k < 9; k++) {
        x.fillStyle = `hsla(${(hue + k * 30) % 360} 90% ${60 + (k % 3) * 10}% / 0.35)`;
        x.beginPath(); x.arc(((k * 137 + i * 53) % 100) / 100 * sp.w, ((k * 71 + i * 29) % 100) / 100 * sp.h, sp.w * (0.06 + (k % 4) * 0.04), 0, Math.PI * 2); x.fill();
      }
      x.fillStyle = "rgba(255,255,255,.9)"; x.font = `700 ${sp.w * 0.09}px sans-serif`; x.textAlign = "center";
      x.fillText(sp.album, sp.w / 2, sp.h / 2); x.font = `500 ${sp.w * 0.04}px sans-serif`; x.fillText(`Sample ${i + 1}`, sp.w / 2, sp.h / 2 + sp.w * 0.07);
      const blob = await canvasToBlob(c, `image/${sp.ext}`, 0.9);
      const when = new Date(Date.now() - (i * 9 + (sp.album.length % 5)) * 86400000 * (sp.album === "Camera" ? 1.5 : 1));
      const name = `${sp.prefix}${when.toISOString().slice(0, 10).replace(/-/g, "")}_${String(i).padStart(4, "0")}.${sp.ext === "jpeg" ? "jpg" : "png"}`;
      await uploadOne(new File([blob], name, { type: blob.type, lastModified: +when }), s, { albumName: sp.album, albumPath: sp.path, takenAt: when.toISOString() });
      c.width = c.height = 0;
      onProgress?.(++done, total);
    }
  }
}

export async function makeThumbBlob(blob: Blob, item: Pick<Item, "format" | "kind">, s: Pick<Settings, "thumbQuality" | "lowMemory">) {
  const tp = thumbParams(s);
  if (item.kind === "image") {
    const d = await decodeImage(blob, item.format);
    const c = drawCover(d, tp.size);
    d.close();
    const out = await canvasToBlob(c, "image/webp", tp.q);
    c.width = c.height = 0;
    return out;
  }
  const { v, url } = await probeVideo(blob);
  const c = document.createElement("canvas");
  const m = Math.min(v.videoWidth, v.videoHeight) || 1;
  c.width = c.height = Math.max(1, Math.round(m * Math.min(1, tp.size / m)));
  c.getContext("2d")!.drawImage(v, (v.videoWidth - m) / 2, (v.videoHeight - m) / 2, m, m, 0, 0, c.width, c.height);
  URL.revokeObjectURL(url);
  return canvasToBlob(c, "image/webp", tp.q);
}
