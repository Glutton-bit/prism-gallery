import { Capacitor } from "@capacitor/core";
import { isNativeAndroid, PrismStorage } from "@/components/storage-gate";
import type { Album, Item, MediaPage } from "./types";

const META_KEY = "prism-android-meta-v1";
type ItemOv = Partial<Pick<Item, "favorite" | "archived" | "vaulted" | "trashedAt" | "trashAlbumId" | "trashAlbumName" | "viewedAt" | "editedAt" | "albumId" | "customOrder" | "name">>;
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

async function ensureScanned(force = false): Promise<{ items: Item[]; albums: Album[] }> {
  if (!force && scanCache && Date.now() - scanCache.ts < 8000) return { items: scanCache.items, albums: scanCache.albums };
  if (!force && scanPending) return scanPending;
  scanPending = (async () => {
    const saved: RawScan | null = !force && !scanCache ? await idbGet<RawScan>("raw") : null;
    const raw: RawScan = saved ?? (await PrismStorage.scanMedia());
    if (saved) setTimeout(() => { void ensureScanned(true).catch(() => {}); }, 50);
    else void idbSet("raw", raw);
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
    const ids = Array.isArray(body.ids) ? body.ids.map(Number) : [];
    const meta = loadMeta();
    const now = new Date().toISOString();
    let removed = 0;
    if (action === "delete" || action === "purge") {
      for (const id of ids) {
        const it = itemCache.get(id);
        try { await PrismStorage.deleteFile({ id, kind: it?.kind ?? "image", sourcePath: it?.sourcePath ?? null }); } catch {}
        if (!meta.deletedIds.includes(id)) meta.deletedIds.push(id);
        removed += 1;
      }
    } else {
      for (const id of ids) {
        const prev = meta.items[String(id)] ?? {};
        const it = itemCache.get(id);
        if (action === "favorite") meta.items[String(id)] = { ...prev, favorite: true };
        else if (action === "unfavorite") meta.items[String(id)] = { ...prev, favorite: false };
        else if (action === "archive") meta.items[String(id)] = { ...prev, archived: true };
        else if (action === "unarchive") meta.items[String(id)] = { ...prev, archived: false };
        else if (action === "vault") meta.items[String(id)] = { ...prev, vaulted: true };
        else if (action === "unvault") meta.items[String(id)] = { ...prev, vaulted: false };
        else if (action === "trash") meta.items[String(id)] = { ...prev, trashedAt: now, trashAlbumId: it?.albumId ?? null, trashAlbumName: it?.albumName ?? null };
        else if (action === "restore") meta.items[String(id)] = { ...prev, trashedAt: null };
        else if (action === "viewed") meta.items[String(id)] = { ...prev, viewedAt: now };
        else if ((action === "move" || action === "addToAlbum" || action === "copy") && Number(body.albumId ?? body.targetAlbumId ?? 0)) {
          meta.items[String(id)] = { ...prev, albumId: Number(body.albumId ?? body.targetAlbumId) };
        }
      }
    }
    saveMeta(meta);
    scanCache = null;
    return { ok: true, removed };
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
    const aid = params.get("albumId") ?? params.get("album");
    const CAT_SCOPES = ["photos", "screenshots", "screenrec", "videos", "gifs", "downloads", "recent", "edited", "viewed", "large"];
    const cat = params.get("category") ?? params.get("cat") ?? params.get("slug") ?? (CAT_SCOPES.includes(scope) ? scope : "");
    const q = (params.get("q") ?? params.get("search") ?? "").trim().toLowerCase();
    const kind = params.get("kind");
    const sort = params.get("sort") ?? "takenAt";
    const mult = (params.get("dir") ?? "desc").toLowerCase() === "asc" ? 1 : -1;
    const offset = Math.max(0, Number(params.get("offset") ?? "0"));
    const limit = Math.max(1, Number(params.get("limit") ?? "200"));
    const cam = albums.find((a) => a.isCamera);
    let list = items.slice();
    let noCamera = false;

    if (scope === "trash") list = list.filter((i) => Boolean(i.trashedAt));
    else if (scope === "vault" || scope === "hidden") list = list.filter((i) => i.vaulted && !i.trashedAt);
    else if (scope === "archive" || scope === "archived") list = list.filter((i) => i.archived && !i.trashedAt && !i.vaulted);
    else if (scope === "favorites") list = list.filter((i) => i.favorite && !i.trashedAt && !i.vaulted);
    else if (scope === "album" && aid !== null) list = list.filter((i) => i.albumId === Number(aid) && !i.trashedAt && !i.vaulted);
    else if (scope === "category" || cat) list = list.filter((i) => matchesCat(i, cat || scope));
    else if (scope === "camera" || scope === "home") {
      if (cam && cam.count > 0) list = list.filter((i) => i.albumId === cam.id && !i.trashedAt && !i.vaulted && !i.archived);
      else { list = list.filter((i) => !i.trashedAt && !i.vaulted && !i.archived); noCamera = !cam; }
    } else list = list.filter((i) => !i.trashedAt && !i.vaulted && !i.archived);

    if (kind === "image" || kind === "video") list = list.filter((i) => i.kind === kind);
    if (q) list = list.filter((i) => i.name.toLowerCase().includes(q) || (i.albumName ?? "").toLowerCase().includes(q));
    list.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name) * mult;
      if (sort === "size") return (a.size - b.size) * mult;
      if (sort === "custom" || sort === "customOrder") return (a.customOrder - b.customOrder) * mult;
      return (new Date(sort === "modifiedAt" ? a.modifiedAt : a.takenAt).getTime() - new Date(sort === "modifiedAt" ? b.modifiedAt : b.takenAt).getTime()) * mult;
    });
    return { items: list.slice(offset, offset + limit), total: list.length, offset, noCamera } as MediaPage;
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
