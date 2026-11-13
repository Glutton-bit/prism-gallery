import { Capacitor } from "@capacitor/core";
import { isNativeAndroid, PrismStorage } from "@/components/storage-gate";
import type { Album, Item, MediaPage } from "./types";

const META_KEY = "prism-android-meta-v1";

type ItemOverride = Partial<
  Pick<
    Item,
    | "favorite"
    | "archived"
    | "vaulted"
    | "trashedAt"
    | "trashAlbumId"
    | "trashAlbumName"
    | "viewedAt"
    | "editedAt"
    | "albumId"
    | "customOrder"
    | "name"
  >
>;

type AlbumOverride = Partial<
  Pick<Album, "name" | "pinned" | "pinOrder" | "sortOrder" | "hidden" | "coverMediaId" | "coverId">
>;

interface LocalMeta {
  items: Record<string, ItemOverride>;
  albums: Record<string, AlbumOverride>;
  userAlbums: Album[];
  deletedIds: number[];
  nextUserAlbumId: number;
}

const itemCache = new Map<number, Item>();
const thumbCache = new Map<number, string>();
let scanCache: { items: Item[]; albums: Album[]; ts: number } | null = null;
let scanPending: Promise<{ items: Item[]; albums: Album[] }> | null = null;

function loadMeta(): LocalMeta {
  try {
    const raw = localStorage.getItem(META_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<LocalMeta>;
      return {
        items: parsed.items ?? {},
        albums: parsed.albums ?? {},
        userAlbums: parsed.userAlbums ?? [],
        deletedIds: parsed.deletedIds ?? [],
        nextUserAlbumId: parsed.nextUserAlbumId ?? -100,
      };
    }
  } catch {
    // ignore storage read errors
  }
  return { items: {}, albums: {}, userAlbums: [], deletedIds: [], nextUserAlbumId: -100 };
}

function saveMeta(meta: LocalMeta) {
  try {
    localStorage.setItem(META_KEY, JSON.stringify(meta));
  } catch {
    // ignore storage write errors
  }
}

function invalidateScan() {
  scanCache = null;
}

async function ensureScanned(force = false): Promise<{ items: Item[]; albums: Album[] }> {
  if (!force && scanCache && Date.now() - scanCache.ts < 8000) {
    return { items: scanCache.items, albums: scanCache.albums };
  }
  if (!force && scanPending) {
    return scanPending;
  }

  scanPending = (async () => {
    const raw = await PrismStorage.scanMedia();
    const meta = loadMeta();
    const deletedSet = new Set(meta.deletedIds);

    const items: Item[] = [];
    for (const base of raw.items) {
      if (deletedSet.has(base.id)) continue;
      const ov = meta.items[String(base.id)];
      const merged: Item = ov ? { ...base, ...ov } : base;
      itemCache.set(merged.id, merged);
      items.push(merged);
    }

    // Warm video thumbnails in the background so grids render previews
    const videos = items.filter((it) => it.kind === "video" && !thumbCache.has(it.id)).slice(0, 40);
    if (videos.length > 0) {
      void Promise.all(
        videos.map(async (v) => {
          try {
            const res = await PrismStorage.getThumb({
              id: v.id,
              kind: v.kind,
              sourcePath: v.sourcePath,
            });
            if (res.path) thumbCache.set(v.id, res.path);
          } catch {
            // ignore thumbnail warmup failure
          }
        })
      );
    }

    const albumCounts = new Map<number, { count: number; videoCount: number; size: number; coverId: number | null; lastTaken: string | null }>();
    for (const it of items) {
      if (it.trashedAt || it.vaulted) continue;
      const entry = albumCounts.get(it.albumId) ?? {
        count: 0,
        videoCount: 0,
        size: 0,
        coverId: null,
        lastTaken: null,
      };
      entry.count += 1;
      if (it.kind === "video") entry.videoCount += 1;
      entry.size += it.size;
      if (entry.coverId === null) entry.coverId = it.id;
      if (!entry.lastTaken || it.takenAt > entry.lastTaken) entry.lastTaken = it.takenAt;
      albumCounts.set(it.albumId, entry);
    }

    const allBaseAlbums = [...raw.albums, ...meta.userAlbums];
    const albums: Album[] = allBaseAlbums.map((a) => {
      const ov = meta.albums[String(a.id)];
      const stats = albumCounts.get(a.id);
      const merged: Album = {
        ...a,
        ...(ov ?? {}),
        count: stats ? stats.count : 0,
        videoCount: stats ? stats.videoCount : 0,
        size: stats ? stats.size : 0,
        coverId: ov?.coverId ?? stats?.coverId ?? a.coverId,
        coverMediaId: ov?.coverMediaId ?? stats?.coverId ?? a.coverMediaId,
        lastTaken: stats?.lastTaken ?? a.lastTaken,
      }; 
