import { Capacitor } from "@capacitor/core";
import { isNativeAndroid, PrismStorage } from "@/components/storage-gate";
import type { Album, Item, MediaPage } from "./types";

const META_KEY = "prism-android-meta-v1";
type ItemOv = Partial<Pick<Item, "favorite" | "archived" | "vaulted" | "trashedAt" | "trashAlbumId" | "trashAlbumName" | "viewedAt" | "editedAt" | "albumId" | "customOrder" | "name" | "place">>;
type AlbumOv = Partial<Pick<Album, "name" | "pinned" | "pinOrder" | "sortOrder" | "hidden" | "coverMediaId" | "coverId">>;
interface LocalMeta {
  items: Record<string, ItemOv>;
  albums: Record<string, AlbumOv>;
  userAlbums: Album[];
  deletedIds: number[];
  nextId: number;
}

const itemCache = new Map<number, Item>();
const thumbCache = new Map<number, string>();
let scanCache: { items: Item[]; albums: Album[]; ts: number } | null = null;
let scanPending: Promise<{ items: Item[]; albums: Album[] }> | null = null;

function loadMeta(): LocalMeta {
  if (typeof window === "undefined") return { items: {}, albums: {}, userAlbums: [], deletedIds: [], nextId: -100 };
  try {
    const p = JSON.parse(localStorage.getItem(META_KEY) || "{}") as Partial<LocalMeta>;
    return { items: p.items ?? {}, albums: p.albums ?? {}, userAlbums: p.userAlbums ?? [], deletedIds: p.deletedIds ?? [], nextId: p.nextId ?? -100 };
  } catch {
    return { items: {}, albums: {}, userAlbums: [], deletedIds: [], nextId: -100 };
  }
}

function saveMeta(m: LocalMeta) {
  try { if (typeof window !== "undefined") localStorage.setItem(META_KEY, JSON.stringify(m)); } catch {}
}

type RawScan = { items: Item[]; albums: Album[] };
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open("prism-scan-v1", 1);
    r.onupgradeneeded = () => { r.result.createObjectStore("kv"); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await idbOpen();
    return await new Promise<T | null>((res) => {
      const q = db.transaction("kv").objectStore("kv").get(key);
      q.onsuccess = () => res((q.result as T) ?? null);
      q.onerror = () => res(null);
    });
  } catch { return null; }
}
async function idbSet(key: string, val: unknown): Promise<void> {
  try { const db = await idbOpen(); db.transaction("kv", "readwrite").objectStore("kv").put(val, key); } catch {}
}

let lastRaw: RawScan | null = null;
let lastSavedCount = -1;

async function ensureScanned(force = false): Promise<{ items: Item[]; albums: Album[] }> {
  if (!force && scanCache && Date.now() - scanCache.ts < 30000) return { items: scanCache.items, albums: scanCache.albums };
  if (!force && scanPending) return scanPending;
  scanPending = (async () => {
    let raw: RawScan;
    if (!force && !scanCache && lastRaw) {
      raw = lastRaw; // only our own metadata changed: rebuild without rescanning storage
    } else {
      const saved: RawScan | null = !force && !scanCache && !lastRaw ? await idbGet<RawScan>("raw") : null;
      raw = saved ?? (await PrismStorage.scanMedia());
      if (saved) setTimeout(() => { void ensureScanned(true).catch(() => {}); }, 50);
      else if (raw.items.length !== lastSavedCount) { lastSavedCount = raw.items.length; void idbSet("raw", raw); }
    }
    lastRaw = raw;
    const meta = loadMeta();
    const delSet = new Set(meta.deletedIds);
    const items: Item[] = [];
    for (const base of raw.items) {
      if (delSet.has(base.id)) continue;
      const ov = meta.items[String(base.id)];
      const merged = ov ? { ...base, ...ov } : base;
      itemCache.set(merged.id, merged);
      items.push(merged);
    }
    const vids = items.filter((it) => it.kind === "video" && !thumbCache.has(it.id)).slice(0, 30);
    if (vids.length) {
      void Promise.all(vids.map(async (v) => {
        try {
          const r = await PrismStorage.getThumb({ id: v.id, kind: v.kind, sourcePath: v.sourcePath });
          if (r.path) thumbCache.set(v.id, r.path);
        } catch {}
      }));
    }
    const counts = new Map<number, { count: number; videoCount: number; size: number; coverId: number | null; lastTaken: string | null }>();
    for (const it of items) {
      if (it.trashedAt || it.vaulted) continue;
      const e = counts.get(it.albumId) ?? { count: 0, videoCount: 0, size: 0, coverId: null, lastTaken: null };
      e.count += 1;
      if (it.kind === "video") e.videoCount += 1;
      e.size += it.size;
      if (e.coverId === null) e.coverId = it.id;
      if (!e.lastTaken || it.takenAt > e.lastTaken) e.lastTaken = it.takenAt;
      counts.set(it.albumId, e);
    }
    const albums: Album[] = [...raw.albums, ...meta.userAlbums].map((a) => {
      const ov = meta.albums[String(a.id)];
      const s = counts.get(a.id);
      return { ...a, ...(ov ?? {}), count: s?.count ?? 0, videoCount: s?.videoCount ?? 0, size: s?.size ?? 0, coverId: ov?.coverId ?? s?.coverId ?? a.coverId, coverMediaId: ov?.coverMediaId ?? s?.coverId ?? a.coverMediaId, lastTaken: s?.lastTaken ?? a.lastTaken };
    });
    scanCache = { items, albums, ts: Date.now() };
    return { items, albums };
  })();
  try { return await scanPending; } finally { scanPending = null; }
}

function matchesCat(it: Item, cat: string): boolean {
  const p = (it.sourcePath ?? "").toLowerCase();
  const a = (it.albumName ?? "").toLowerCase();
  const ok = !it.trashedAt && !it.vaulted;
  if (cat === "photos") return ok && !it.archived && it.kind === "image";
  if (cat === "camera") return ok && !it.archived && (a === "camera" || p.includes("/dcim/camera"));
  if (cat === "screenshots") return ok && (a.includes("screenshot") || p.includes("screenshot"));
  if (cat === "screenrec") return ok && it.kind === "video" && (a.includes("screen") || p.includes("screenrecorder"));
  if (cat === "videos") return ok && !it.archived && it.kind === "video";
  if (cat === "gifs") return ok && (it.animated || it.format === "gif");
  if (cat === "downloads") return ok && (a.includes("download") || p.includes("/download"));
  if (cat === "favorites") return ok && it.favorite;
  if (cat === "recent") return ok && new Date(it.takenAt).getTime() >= Date.now() - 7 * 86400000;
  if (cat === "edited") return ok && Boolean(it.editedAt);
  if (cat === "viewed") return ok && Boolean(it.viewedAt);
  if (cat === "large") return ok && it.size >= 5 * 1024 * 1024;
  if (cat === "archived") return ok && it.archived;
  if (cat === "place") return ok && Boolean(it.place || (it.lat !== null && it.lng !== null));
  return ok && !it.archived;
}

const PRIVATE_MSG = "The Private folder isn’t available in this version yet. It needs secure encryption that hasn’t been built, so nothing was hidden.";
const FORMATS: Record<string, string> = { jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", gif: "gif", bmp: "bmp", heic: "heic", heif: "heif", avif: "avif", mp4: "mp4", mkv: "mkv", webm: "webm", "3gp": "3gp" };
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
const num = (x: number | null | undefined) => x ?? 0;
const tms = (x: string | null | undefined) => (x ? new Date(x).getTime() || 0 : 0);

function readSetting<T>(key: string, fallback: T): T {
  try { const v = (JSON.parse(localStorage.getItem("prism-settings") || "{}") as Record<string, unknown>)[key]; return v === undefined ? fallback : (v as T); } catch { return fallback; }
}

const SCOPE_FILTERS: Record<string, (i: Item) => boolean> = {
  photos: (i) => i.kind === "image",
  videos: (i) => i.kind === "video",
  screenshots: (i) => matchesCat(i, "screenshots"),
  screenrec: (i) => matchesCat(i, "screenrec"),
  downloads: (i) => matchesCat(i, "downloads"),
  gifs: (i) => i.format === "gif" || Boolean(i.animated),
  favorites: (i) => Boolean(i.favorite),
  edited: (i) => Boolean(i.editedAt),
  viewed: (i) => Boolean(i.viewedAt),
  large: (i) => num(i.size) >= 10485760,
  archived: (i) => Boolean(i.archived),
};

function matchToken(i: Item, l: string, albumById: Map<number, Album>): boolean {
  if (["fav", "favorite", "favorites", "favourite", "favourites"].includes(l)) return Boolean(i.favorite);
  if (["video", "videos"].includes(l)) return i.kind === "video";
  if (["photo", "photos", "image", "images"].includes(l)) return i.kind === "image";
  if (["screenshot", "screenshots"].includes(l)) return matchesCat(i, "screenshots");
  if (FORMATS[l]) return (i.format ?? "").toLowerCase().replace("jpeg", "jpg") === FORMATS[l];
  let m = l.match(/^([<>]=?)(\d+(?:\.\d+)?)(kb|mb|gb)$/);
  if (m) {
    const mult = m[3] === "kb" ? 1024 : m[3] === "mb" ? 1048576 : 1073741824;
    const n = Math.round(parseFloat(m[2]) * mult);
    return m[1].startsWith(">") ? num(i.size) >= n : num(i.size) <= n;
  }
  m = l.match(/^([<>])(\d+(?:\.\d+)?)mp$/);
  if (m) {
    const n = Math.round(parseFloat(m[2]) * 1000000);
    const px = num(i.width) * num(i.height);
    return m[1] === ">" ? px >= n : px <= n;
  }
  if (l === "4k") return Math.max(num(i.width), num(i.height)) >= 3840;
  if (l === "hd" || l === "1080p") return Math.max(num(i.width), num(i.height)) >= 1920;
  const d = new Date(i.takenAt);
  if (/^(19|20)\d{2}$/.test(l)) return d.getFullYear() === Number(l);
  const mi = MONTHS.findIndex((x) => x === l || (l.length === 3 && x.startsWith(l)));
  if (mi >= 0) return d.getMonth() === mi;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(l)) return (i.takenAt ?? "").slice(0, l.length) === l;
  if (l.startsWith("album:") && l.length > 6) return (albumById.get(i.albumId)?.name ?? "").toLowerCase().includes(l.slice(6));
  if (l.startsWith("place:") && l.length > 6) return (i.place ?? "").toLowerCase().includes(l.slice(6));
  const hay = `${i.name} ${i.place ?? ""} ${i.camera ?? ""} ${albumById.get(i.albumId)?.name ?? ""}`.toLowerCase();
  return hay.includes(l.replace(/[%_]/g, ""));
}

const SORTERS: Record<string, (a: Item, b: Item) => number> = {
  oldest: (a, b) => tms(a.takenAt) - tms(b.takenAt) || a.id - b.id,
  modified: (a, b) => tms(b.modifiedAt) - tms(a.modifiedAt) || b.id - a.id,
  added: (a, b) => tms(b.createdAt) - tms(a.createdAt) || b.id - a.id,
  largest: (a, b) => num(b.size) - num(a.size) || b.id - a.id,
  smallest: (a, b) => num(a.size) - num(b.size) || a.id - b.id,
  nameaz: (a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id - b.id,
  nameza: (a, b) => b.name.toLowerCase().localeCompare(a.name.toLowerCase()) || b.id - a.id,
  resolution: (a, b) => num(b.width) * num(b.height) - num(a.width) * num(a.height) || b.id - a.id,
  longest: (a, b) => num(b.durationMs) - num(a.durationMs) || b.id - a.id,
  shortest: (a, b) => num(a.durationMs) - num(b.durationMs) || a.id - b.id,
  custom: (a, b) => num(a.customOrder) - num(b.customOrder) || tms(b.takenAt) - tms(a.takenAt) || b.id - a.id,
  viewed: (a, b) => tms(b.viewedAt) - tms(a.viewedAt) || b.id - a.id,
  edited: (a, b) => tms(b.editedAt) - tms(a.editedAt) || b.id - a.id,
  trashed: (a, b) => tms(b.trashedAt) - tms(a.trashedAt) || b.id - a.id,
};

function newUserAlbum(meta: LocalMeta, name: string): Album {
  const now = new Date().toISOString();
  const alb: Album = { id: meta.nextId--, name, kind: "user", hint: "Your album", path: null, isCamera: false, pinned: false, pinOrder: 99, sortOrder: 0, hidden: false, coverMediaId: null, coverId: null, coverV: Date.now(), count: 0, videoCount: 0, size: 0, createdAt: now, modifiedAt: now, lastTaken: null };
  return alb;
}

export function parseGps(dv: DataView): { lat: number; lng: number } | null {
  try {
    if (dv.byteLength < 12 || dv.getUint16(0) !== 0xffd8) return null;
    let off = 2;
    while (off + 4 < dv.byteLength) {
      if (dv.getUint8(off) !== 0xff) return null;
      const marker = dv.getUint8(off + 1);
      const len = dv.getUint16(off + 2);
      if (marker === 0xe1 && dv.getUint32(off + 4) === 0x45786966) {
        const t = off + 10;
        const le = dv.getUint16(t) === 0x4949;
        const u16 = (o: number) => dv.getUint16(t + o, le);
        const u32 = (o: number) => dv.getUint32(t + o, le);
        const ifd0 = u32(4);
        let gps = 0;
        const n0 = u16(ifd0);
        for (let i = 0; i < n0; i++) { const e = ifd0 + 2 + i * 12; if (u16(e) === 0x8825) gps = u32(e + 8); }
        if (!gps) return null;
        const rat = (o: number) => { const a = u32(o), b = u32(o + 4); return b ? a / b : 0; };
        let latRef = "N", lngRef = "E";
        let lat: number[] | null = null, lng: number[] | null = null;
        const n = u16(gps);
        for (let i = 0; i < n; i++) {
          const e = gps + 2 + i * 12;
          const tag = u16(e);
          if (tag === 1) latRef = String.fromCharCode(dv.getUint8(t + e + 8));
          else if (tag === 3) lngRef = String.fromCharCode(dv.getUint8(t + e + 8));
          else if (tag === 2) { const o = u32(e + 8); lat = [rat(o), rat(o + 8), rat(o + 16)]; }
          else if (tag === 4) { const o = u32(e + 8); lng = [rat(o), rat(o + 8), rat(o + 16)]; }
        }
        if (!lat || !lng) return null;
        let la = lat[0] + lat[1] / 60 + lat[2] / 3600;
        let lo = lng[0] + lng[1] / 60 + lng[2] / 3600;
        if (latRef === "S") la = -la;
        if (lngRef === "W") lo = -lo;
        if (!isFinite(la) || !isFinite(lo) || (la === 0 && lo === 0)) return null;
        return { lat: la, lng: lo };
      }
      off += 2 + len;
    }
  } catch { /* unreadable EXIF */ }
  return null;
}
async function readHead(url: string, max = 131072): Promise<DataView | null> {
  try {
    const res = await fetch(url);
    if (!res.ok || !res.body) return null;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let got = 0;
    while (got < max) { const { done, value } = await reader.read(); if (done || !value) break; chunks.push(value); got += value.length; }
    void reader.cancel().catch(() => {});
    const buf = new Uint8Array(got);
    let p = 0;
    for (const c of chunks) { buf.set(c, p); p += c.length; }
    return new DataView(buf.buffer);
  } catch { return null; }
}

const hashCache = new Map<number, string>();
function dHash(src: string): Promise<string | null> {
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 9; c.height = 8;
        const x = c.getContext("2d");
        if (!x) return res(null);
        x.drawImage(img, 0, 0, 9, 8);
        const d = x.getImageData(0, 0, 9, 8).data;
        let bits = "";
        for (let y = 0; y < 8; y++) for (let k = 0; k < 8; k++) {
          const a = (y * 9 + k) * 4, b = a + 4;
          bits += d[a] * 0.3 + d[a + 1] * 0.59 + d[a + 2] * 0.11 > d[b] * 0.3 + d[b + 1] * 0.59 + d[b + 2] * 0.11 ? "1" : "0";
        }
        res(bits);
      } catch { res(null); }
    };
    img.onerror = () => res(null);
    img.src = src;
  });
}

async function similarGroups(list: Item[]): Promise<Item[][]> {
  const cand = list.filter((i) => i.kind === "image" && !i.archived).sort((a, b) => tms(b.takenAt) - tms(a.takenAt)).slice(0, 400);
  if (!hashCache.size) { const saved = (await idbGet<Record<string, string>>("hashes")) ?? {}; for (const [k, v] of Object.entries(saved)) hashCache.set(Number(k), v); }
  let idx = 0; let dirty = false;
  const worker = async () => {
    while (idx < cand.length) {
      const it = cand[idx++];
      if (hashCache.has(it.id)) continue;
      const src = await ensureThumb(it);
      if (!src) continue;
      const h = await dHash(src);
      if (h) { hashCache.set(it.id, h); dirty = true; }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (dirty) void idbSet("hashes", Object.fromEntries(hashCache));
  const hs = cand.filter((i) => hashCache.has(i.id));
  const parent = hs.map((_, i) => i);
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const ham = (a: string, b: string) => { let d = 0; for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) d++; return d; };
  for (let a = 0; a < hs.length; a++) for (let b = a + 1; b < hs.length; b++) {
    if (ham(hashCache.get(hs[a].id) as string, hashCache.get(hs[b].id) as string) <= 5) parent[find(a)] = find(b);
  }
  const groups = new Map<number, Item[]>();
  hs.forEach((it, i) => { const r = find(i); groups.set(r, [...(groups.get(r) ?? []), it]); });
  return [...groups.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length);
}

async function handleAndroidApi(url: string, init?: RequestInit): Promise<unknown> {
  const method = (init?.method ?? "GET").toUpperCase();
  const parsed = new URL(url, "http://localhost");
  const pathname = parsed.pathname.replace(/\/+$/, "");
  const params = parsed.searchParams;
  let body: Record<string, unknown> = {};
  if (typeof init?.body === "string" && init.body) { try { body = JSON.parse(init.body) as Record<string, unknown>; } catch {} }

  if (pathname === "/api/albums") {
    if (method === "GET") return (await ensureScanned()).albums;
    if (method === "POST") {
      const meta = loadMeta();
      const now = new Date().toISOString();
      const alb: Album = { id: meta.nextId--, name: String(body.name ?? "New Album"), kind: "user", hint: "Your album", path: null, isCamera: false, pinned: false, pinOrder: 99, sortOrder: 0, hidden: false, coverMediaId: null, coverId: null, coverV: Date.now(), count: 0, videoCount: 0, size: 0, createdAt: now, modifiedAt: now, lastTaken: null };
      meta.userAlbums.push(alb);
      saveMeta(meta);
      scanCache = null;
      return alb;
    }
  }

  const albMatch = pathname.match(/^\/api\/albums\/(-?\d+)$/);
  if (albMatch) {
    const aid = Number(albMatch[1]);
    if (method === "GET") return (await ensureScanned()).albums.find((a) => a.id === aid) ?? null;
    if (method === "PATCH") {
      const meta = loadMeta();
      meta.albums[String(aid)] = { ...(meta.albums[String(aid)] ?? {}), ...(body as AlbumOv) };
      saveMeta(meta);
      scanCache = null;
      return (await ensureScanned(true)).albums.find((a) => a.id === aid) ?? { ok: true };
    }
    if (method === "DELETE") {
      const meta = loadMeta();
      meta.userAlbums = meta.userAlbums.filter((a) => a.id !== aid);
      meta.albums[String(aid)] = { ...(meta.albums[String(aid)] ?? {}), hidden: true };
      saveMeta(meta);
      scanCache = null;
      return { ok: true };
    }
  }

  if (pathname === "/api/media/batch" && method === "POST") {
    const action = String(body.action ?? "");
    const ids = Array.isArray(body.ids) ? (body.ids as unknown[]).map(Number) : [];
    const meta = loadMeta();
    const now = new Date().toISOString();
    const eraseFile = async (id: number) => {
      const it = itemCache.get(id);
      try { await PrismStorage.deleteFile({ id, kind: it?.kind ?? "image", sourcePath: it?.sourcePath ?? null }); } catch {}
      if (!meta.deletedIds.includes(id)) meta.deletedIds.push(id);
    };
    let removed = 0;
    let skipped = 0;

    if (action === "hide" || action === "vault") throw new Error(PRIVATE_MSG);
    if (action === "copy") throw new Error("Copy isn’t available in this version yet, because it would need a second file on your phone. Use Move instead.");

    if (action === "emptyTrash") {
      const all = (await ensureScanned()).items.filter((i) => i.trashedAt && !i.vaulted);
      for (const it of all) { await eraseFile(it.id); removed += 1; }
    } else if (action === "delete" || action === "purge") {
      for (const id of ids) { await eraseFile(id); removed += 1; }
    } else {
      let target = Number(body.albumId ?? body.targetAlbumId ?? 0);
      if (!target && body.albumName && (action === "move" || action === "addToAlbum")) {
        const nm = String(body.albumName).trim();
        if (nm) {
          const ex = (await ensureScanned()).albums.find((a) => a.name.toLowerCase() === nm.toLowerCase());
          if (ex) target = ex.id;
          else { const alb = newUserAlbum(meta, nm); meta.userAlbums.push(alb); target = alb.id; }
        }
      }
      let top = 0;
      if (action === "toTop") for (const it of (await ensureScanned()).items) top = Math.min(top, num(it.customOrder));
      let order = top - ids.length;
      for (const id of ids) {
        const prev = meta.items[String(id)] ?? {};
        const it = itemCache.get(id);
        if (action === "favorite") meta.items[String(id)] = { ...prev, favorite: true };
        else if (action === "unfavorite") meta.items[String(id)] = { ...prev, favorite: false };
        else if (action === "archive") meta.items[String(id)] = { ...prev, archived: true };
        else if (action === "unarchive") meta.items[String(id)] = { ...prev, archived: false };
        else if (action === "unvault" || action === "unhide") meta.items[String(id)] = { ...prev, vaulted: false };
        else if (action === "trash") meta.items[String(id)] = { ...prev, trashedAt: now, trashAlbumId: it?.albumId ?? null, trashAlbumName: it?.albumName ?? null };
        else if (action === "restore") meta.items[String(id)] = { ...prev, trashedAt: null };
        else if (action === "viewed" || action === "view") meta.items[String(id)] = { ...prev, viewedAt: now };
        else if (action === "setPlace") meta.items[String(id)] = { ...prev, place: body.place ? String(body.place) : null };
        else if (action === "toTop") meta.items[String(id)] = { ...prev, customOrder: order++ };
        else if ((action === "move" || action === "addToAlbum") && target) meta.items[String(id)] = { ...prev, albumId: target };
        else if (action === "removeFromAlbum") {
          if (prev.albumId !== undefined) { const { albumId: _gone, ...rest } = prev; void _gone; meta.items[String(id)] = rest; removed += 1; } else skipped += 1;
        }
      }
      if (action === "removeFromAlbum" && !removed) throw new Error("These items exist only in this album. Move them to another album, or delete them.");
    }
    saveMeta(meta);
    scanCache = null;
    return { ok: true, removed, skipped };
  }

  const itemMatch = pathname.match(/^\/api\/media\/(-?\d+)$/);
  if (itemMatch) {
    const id = Number(itemMatch[1]);
    if (method === "GET") {
      const found = (await ensureScanned()).items.find((i) => i.id === id);
      if (!found) { const e = new Error("Not found") as Error & { status?: number }; e.status = 404; throw e; }
      return found;
    }
    if (method === "PATCH") {
      const meta = loadMeta();
      meta.items[String(id)] = { ...(meta.items[String(id)] ?? {}), ...(body as ItemOv) };
      saveMeta(meta);
      scanCache = null;
      return (await ensureScanned(true)).items.find((i) => i.id === id) ?? { ok: true };
    }
    if (method === "DELETE") {
      const it = itemCache.get(id);
      try { await PrismStorage.deleteFile({ id, kind: it?.kind ?? "image", sourcePath: it?.sourcePath ?? null }); } catch {}
      const meta = loadMeta();
      if (!meta.deletedIds.includes(id)) meta.deletedIds.push(id);
      saveMeta(meta);
      scanCache = null;
      return { ok: true };
    }
  }

  if (pathname === "/api/media" && method === "GET") {
    const { items, albums } = await ensureScanned();
    const scope = params.get("scope") ?? "all";
    const aid = params.get("album") ?? params.get("albumId");
    const kind = params.get("kind");
    const q = (params.get("q") ?? "").trim();
    const offset = Math.max(0, Number(params.get("offset") ?? "0"));
    const limit = Math.min(500, Math.max(1, Number(params.get("limit") ?? "240")));
    const cam = albums.find((a) => a.isCamera);
    const albumById = new Map(albums.map((a) => [a.id, a]));
    const hiddenAlbumIds = new Set(albums.filter((a) => a.hidden).map((a) => a.id));
    let noCamera = false;

    let list = items.filter((i) => {
      if (scope === "trash") return Boolean(i.trashedAt) && !i.vaulted;
      if (scope === "hidden" || scope === "vault") return !i.trashedAt && Boolean(i.vaulted);
      if (i.trashedAt || i.vaulted) return false;
      if (scope !== "archived" && i.archived) return false;
      return true;
    });
    if (!["camera", "album", "trash", "hidden", "vault"].includes(scope) && !readSetting("showHiddenAlbums", false)) list = list.filter((i) => !hiddenAlbumIds.has(i.albumId));

    if (scope === "camera" || scope === "home") {
      if (!cam) { noCamera = true; list = []; } else list = list.filter((i) => i.albumId === cam.id);
    } else if (scope === "album") list = list.filter((i) => i.albumId === Number(aid ?? 0));
    else if (SCOPE_FILTERS[scope]) list = list.filter(SCOPE_FILTERS[scope]);

    if (kind === "image" || kind === "video") list = list.filter((i) => i.kind === kind);
    if (params.get("fav") === "1") list = list.filter((i) => i.favorite);
    const from = tms(params.get("from")), to = tms(params.get("to"));
    if (from) list = list.filter((i) => tms(i.takenAt) >= from);
    if (to) list = list.filter((i) => tms(i.takenAt) < to);
    const place = params.get("place");
    if (place) list = list.filter((i) => i.place === place);
    const only = params.get("only");
    if (only) { const set = new Set(only.split(",").map(Number)); list = list.filter((i) => set.has(i.id)); }
    if (q) for (const raw of q.match(/"[^"]+"|\S+/g) ?? []) { const t = raw.replace(/"/g, "").toLowerCase(); list = list.filter((i) => matchToken(i, t, albumById)); }

    let sort = params.get("sort") ?? "newest";
    if (scope === "recent") sort = "added";
    if (scope === "viewed" && sort === "newest") sort = "viewed";
    if (scope === "edited" && sort === "newest") sort = "edited";
    if (scope === "trash" && sort === "newest") sort = "trashed";
    list.sort(SORTERS[sort] ?? ((a, b) => tms(b.takenAt) - tms(a.takenAt) || b.id - a.id));

    if (params.get("ids") === "1") return { ids: list.map((i) => i.id) };
    return { items: list.slice(offset, offset + limit), total: list.length, offset, noCamera } as MediaPage;
  }

  if (pathname === "/api/albums/reorder" && method === "POST") {
    const meta = loadMeta();
    const pinned = Array.isArray(body.pinned) ? (body.pinned as unknown[]).map(Number) : [];
    const order = Array.isArray(body.order) ? (body.order as unknown[]).map(Number) : [];
    pinned.forEach((id, k) => { meta.albums[String(id)] = { ...(meta.albums[String(id)] ?? {}), pinOrder: k }; });
    order.forEach((id, k) => { meta.albums[String(id)] = { ...(meta.albums[String(id)] ?? {}), sortOrder: k }; });
    saveMeta(meta);
    scanCache = null;
    return { ok: true };
  }

  if (pathname === "/api/vault") {
    if (method === "GET") return { configured: false, authType: null, unlocked: false, count: 0 };
    throw new Error(PRIVATE_MSG);
  }

  if (pathname === "/api/storage") return { thumbs: 0, previews: 0, originals: 0 };

  if (pathname === "/api/discover") {
    const { items, albums } = await ensureScanned();
    const type = params.get("type") ?? "";
    const live = items.filter((i) => !i.trashedAt && !i.vaulted);
    const cnt = (f: (i: Item) => boolean) => live.filter(f).length;
    const sum = (l: Item[]) => l.reduce((a, i) => a + i.size, 0);
    if (type === "stats") {
      const trash = items.filter((i) => Boolean(i.trashedAt));
      const vault = items.filter((i) => i.vaulted && !i.trashedAt);
      return {
        total: live.length, size: sum(live), photos: cnt((i) => matchesCat(i, "photos")), videos: cnt((i) => matchesCat(i, "videos")),
        screenshots: cnt((i) => matchesCat(i, "screenshots")), screenrec: cnt((i) => matchesCat(i, "screenrec")), gifs: cnt((i) => matchesCat(i, "gifs")),
        downloads: cnt((i) => matchesCat(i, "downloads")), favorites: cnt((i) => i.favorite), edited: cnt((i) => matchesCat(i, "edited")),
        viewed: cnt((i) => matchesCat(i, "viewed")), large: cnt((i) => matchesCat(i, "large")), archived: cnt((i) => i.archived),
        trash: trash.length, trashSize: sum(trash), vault: vault.length, vaultSize: sum(vault),
        byAlbum: albums.map((a) => ({ id: a.id, name: a.name, size: a.size, count: a.count })),
      };
    }
    if (type === "calendar") {
      const m = new Map<string, { day: string; count: number; coverId: number }>();
      for (const i of live) { if (i.archived) continue; const day = i.takenAt.slice(0, 10); const e = m.get(day); if (e) e.count++; else m.set(day, { day, count: 1, coverId: i.id }); }
      return { days: [...m.values()] };
    }
    if (type === "timeline") {
      const m = new Map<string, { year: number; month: number; count: number; coverId: number }>();
      for (const i of live) { if (i.archived) continue; const d = new Date(i.takenAt); const k = `${d.getFullYear()}-${d.getMonth() + 1}`; const e = m.get(k); if (e) e.count++; else m.set(k, { year: d.getFullYear(), month: d.getMonth() + 1, count: 1, coverId: i.id }); }
      return { months: [...m.values()].sort((a, b) => b.year - a.year || b.month - a.month) };
    }
    if (type === "duplicates") {
      const m = new Map<string, Item[]>();
      for (const i of live) {
        if (i.archived || !num(i.size)) continue;
        const k = `${i.kind}|${i.size}|${num(i.width)}x${num(i.height)}|${num(i.durationMs)}`;
        m.set(k, [...(m.get(k) ?? []), i]);
      }
      return { groups: [...m.values()].filter((g) => g.length > 1).sort((a, b) => b.length - a.length) };
    }
    if (type === "similar") {
      try { return { groups: await similarGroups(live) }; } catch { return { groups: [] }; }
    }
    if (type === "memories") {
      const now = new Date();
      const out: { key: string; title: string; subtitle: string; coverId: number; count: number; from: string; to: string }[] = [];
      const cover = (g: Item[]) => (g.find((i) => i.kind === "image") ?? g[0]).id;
      const today = `${now.getMonth()}-${now.getDate()}`;
      const byYear = new Map<number, Item[]>();
      const byMonth = new Map<string, { y: number; m: number; g: Item[] }>();
      for (const i of live) {
        if (i.archived) continue;
        const d = new Date(i.takenAt);
        if (Number.isNaN(d.getTime())) continue;
        if (d.getFullYear() < now.getFullYear() && `${d.getMonth()}-${d.getDate()}` === today) byYear.set(d.getFullYear(), [...(byYear.get(d.getFullYear()) ?? []), i]);
        const k = `${d.getFullYear()}-${d.getMonth()}`;
        const e = byMonth.get(k) ?? { y: d.getFullYear(), m: d.getMonth(), g: [] };
        e.g.push(i); byMonth.set(k, e);
      }
      for (const [y, g] of [...byYear.entries()].sort((a, b) => b[0] - a[0])) {
        const ago = now.getFullYear() - y;
        out.push({ key: `otd-${y}`, title: "On this day", subtitle: `${ago} year${ago > 1 ? "s" : ""} ago`, coverId: cover(g), count: g.length, from: new Date(y, now.getMonth(), now.getDate()).toISOString(), to: new Date(y, now.getMonth(), now.getDate() + 1).toISOString() });
      }
      for (const x of [...byMonth.values()].sort((a, b) => b.y - a.y || b.m - a.m).filter((x) => x.g.length >= 8).slice(0, 6)) {
        out.push({ key: `m-${x.y}-${x.m}`, title: new Date(x.y, x.m, 1).toLocaleString("en", { month: "long", year: "numeric" }), subtitle: `${x.g.length} items`, coverId: cover(x.g), count: x.g.length, from: new Date(x.y, x.m, 1).toISOString(), to: new Date(x.y, x.m + 1, 1).toISOString() });
      }
      return { memories: out };
    }
    if (type === "map" || type === "places") {
      const pts: { id: number; lat: number; lng: number; place: string | null }[] = [];
      const cand = live.filter((i) => i.kind === "image" && (i.lat != null || (/^jpe?g$/i.test(i.format) && i.sourcePath))).sort((a, b) => tms(b.takenAt) - tms(a.takenAt)).slice(0, 800);
      const deadline = Date.now() + 25000;
      for (const i of cand) {
        if (i.lat != null && i.lng != null) { pts.push({ id: i.id, lat: i.lat, lng: i.lng, place: i.place }); continue; }
        const key = `gps:${i.id}:${i.modifiedAt}`;
        let g = await idbGet<{ lat: number; lng: number } | 0>(key);
        if (g === null && Date.now() < deadline) {
          const dv = await readHead(Capacitor.convertFileSrc(i.sourcePath as string));
          g = (dv ? parseGps(dv) : null) ?? 0;
          void idbSet(key, g);
        }
        if (g) pts.push({ id: i.id, lat: g.lat, lng: g.lng, place: i.place });
      }
      return { points: pts };
    }
    return { memories: [], groups: [], points: [], places: [] };
  }

  return { ok: true, items: [], groups: [], total: 0 };
}

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  if (isNativeAndroid()) return (await handleAndroidApi(url, init)) as T;
  const res = await fetch(url, init);
  let data: unknown = null;
  try { data = await res.json(); } catch {}
  if (!res.ok) {
    const err = new Error((data as { error?: string } | null)?.error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}

export const post = <T = unknown>(url: string, body: unknown) => api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const patch = <T = unknown>(url: string, body: unknown) => api<T>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const del = <T = unknown>(url: string) => api<T>(url, { method: "DELETE" });

function localSrc(id: number, thumb: boolean, fallback?: string | null): string {
  if (thumb && thumbCache.has(id)) return Capacitor.convertFileSrc(thumbCache.get(id)!);
  const p = fallback ?? itemCache.get(id)?.sourcePath;
  return p ? Capacitor.convertFileSrc(p) : "";
}

const ver = (i: { modifiedAt: string }) => new Date(i.modifiedAt).getTime();
export const thumbUrl = (i: Pick<Item, "id" | "modifiedAt" | "vaulted"> & { sourcePath?: string | null }) => isNativeAndroid() ? localSrc(i.id, true, i.sourcePath) : `/api/media/${i.id}/file?v=thumb&t=${ver(i)}`;
export const prevUrl = (i: Pick<Item, "id" | "modifiedAt" | "hasPreview"> & { sourcePath?: string | null }) => isNativeAndroid() ? localSrc(i.id, false, i.sourcePath) : `/api/media/${i.id}/file?v=${i.hasPreview ? "prev" : "orig"}&t=${ver(i)}`;
export const origUrl = (i: Pick<Item, "id" | "modifiedAt"> & { sourcePath?: string | null }) => isNativeAndroid() ? localSrc(i.id, false, i.sourcePath) : `/api/media/${i.id}/file?v=orig&t=${ver(i)}`;
export const batch = (action: string, ids: number[], extra: Record<string, unknown> = {}) => post<{ ok: boolean; removed?: number }>("/api/media/batch", { action, ids, ...extra });
const thumbInflight = new Map<number, Promise<string | null>>();
export function ensureThumb(i: { id: number; kind: string; sourcePath?: string | null }): Promise<string | null> {
  if (!isNativeAndroid()) return Promise.resolve(null);
  const have = thumbCache.get(i.id);
  if (have) return Promise.resolve(Capacitor.convertFileSrc(have));
  let p = thumbInflight.get(i.id);
  if (!p) {
    p = PrismStorage.getThumb({ id: i.id, kind: i.kind, sourcePath: i.sourcePath ?? null })
      .then((r) => { if (!r.path) return null; thumbCache.set(i.id, r.path); return Capacitor.convertFileSrc(r.path); })
      .catch(() => null)
      .finally(() => { thumbInflight.delete(i.id); });
    thumbInflight.set(i.id, p);
  }
  return p;
}
// END OF api.ts
