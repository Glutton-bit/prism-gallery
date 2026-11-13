import { and, asc, desc, eq, getTableColumns, ilike, inArray, isNotNull, isNull, notInArray, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { albums, media } from "@/db/schema";
import { getSettings, purgeExpiredTrash } from "./lib";

const { exif: _e, sha1: _s, phash: _p, storageKey: _k, ...listCols } = getTableColumns(media);
void _e; void _s; void _p; void _k;
export { listCols };

const FORMATS: Record<string, string> = {
  jpg: "jpg", jpeg: "jpg", png: "png", webp: "webp", gif: "gif", bmp: "bmp", heic: "heic", heif: "heif", avif: "avif",
  mp4: "mp4", mkv: "mkv", webm: "webm", "3gp": "3gp",
};
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const albumHint = (hint: string) =>
  inArray(media.albumId, db.select({ id: albums.id }).from(albums).where(eq(albums.hint, hint)));

function tokenCond(t: string): SQL | undefined {
  const l = t.toLowerCase();
  if (["fav", "favorite", "favorites", "favourite", "favourites"].includes(l)) return eq(media.favorite, true);
  if (["video", "videos"].includes(l)) return eq(media.kind, "video");
  if (["photo", "photos", "image", "images"].includes(l)) return eq(media.kind, "image");
  if (["screenshot", "screenshots"].includes(l)) return albumHint("screenshots");
  if (FORMATS[l]) return eq(media.format, FORMATS[l]);
  let m = l.match(/^([<>]=?)(\d+(?:\.\d+)?)(kb|mb|gb)$/);
  if (m) {
    const mult = m[3] === "kb" ? 1024 : m[3] === "mb" ? 1048576 : 1073741824;
    const n = Math.round(parseFloat(m[2]) * mult);
    return m[1].startsWith(">") ? sql`${media.size} >= ${n}` : sql`${media.size} <= ${n}`;
  }
  m = l.match(/^([<>])(\d+(?:\.\d+)?)mp$/);
  if (m) {
    const n = Math.round(parseFloat(m[2]) * 1_000_000);
    return m[1] === ">" ? sql`${media.width} * ${media.height} >= ${n}` : sql`${media.width} * ${media.height} <= ${n}`;
  }
  if (l === "4k") return sql`greatest(${media.width}, ${media.height}) >= 3840`;
  if (l === "hd" || l === "1080p") return sql`greatest(${media.width}, ${media.height}) >= 1920`;
  if (/^(19|20)\d{2}$/.test(l)) return sql`extract(year from ${media.takenAt}) = ${Number(l)}`;
  const mi = MONTHS.findIndex((x) => x === l || (l.length === 3 && x.startsWith(l)));
  if (mi >= 0) return sql`extract(month from ${media.takenAt}) = ${mi + 1}`;
  if (/^\d{4}-\d{2}(-\d{2})?$/.test(l)) return sql`to_char(${media.takenAt}, 'YYYY-MM-DD') like ${l + "%"}`;
  if (l.startsWith("album:") && l.length > 6)
    return inArray(media.albumId, db.select({ id: albums.id }).from(albums).where(ilike(albums.name, `%${l.slice(6)}%`)));
  if (l.startsWith("place:") && l.length > 6) return ilike(media.place, `%${l.slice(6)}%`);
  const like = `%${l.replace(/[%_]/g, "")}%`;
  return or(
    ilike(media.name, like),
    ilike(media.place, like),
    ilike(media.camera, like),
    inArray(media.albumId, db.select({ id: albums.id }).from(albums).where(ilike(albums.name, like))),
  );
}

export function orderFor(sort: string): SQL[] {
  switch (sort) {
    case "oldest": return [asc(media.takenAt), asc(media.id)];
    case "modified": return [desc(media.modifiedAt), desc(media.id)];
    case "added": return [desc(media.createdAt), desc(media.id)];
    case "largest": return [desc(media.size), desc(media.id)];
    case "smallest": return [asc(media.size), asc(media.id)];
    case "nameaz": return [asc(sql`lower(${media.name})`), asc(media.id)];
    case "nameza": return [desc(sql`lower(${media.name})`), desc(media.id)];
    case "resolution": return [desc(sql`${media.width} * ${media.height}`), desc(media.id)];
    case "longest": return [desc(media.durationMs), desc(media.id)];
    case "shortest": return [asc(media.durationMs), asc(media.id)];
    case "custom": return [asc(media.customOrder), desc(media.takenAt), desc(media.id)];
    case "viewed": return [desc(media.viewedAt), desc(media.id)];
    case "edited": return [desc(media.editedAt), desc(media.id)];
    case "trashed": return [desc(media.trashedAt), desc(media.id)];
    default: return [desc(media.takenAt), desc(media.id)];
  }
}

export async function buildWhere(p: URLSearchParams) {
  const scope = p.get("scope") ?? "all";
  const s = await getSettings();
  const conds: (SQL | undefined)[] = [];
  const hiddenAlbums = db.select({ id: albums.id }).from(albums).where(eq(albums.hidden, true));
  const excludeHidden = !s.showHiddenAlbums;

  if (scope === "trash") conds.push(isNotNull(media.trashedAt), eq(media.vaulted, false));
  else if (scope === "hidden") conds.push(isNull(media.trashedAt), eq(media.vaulted, true));
  else {
    conds.push(isNull(media.trashedAt), eq(media.vaulted, false));
    if (scope !== "archived") conds.push(eq(media.archived, false));
  }
  const global = !["camera", "album", "trash", "hidden"].includes(scope);
  if (global && excludeHidden) conds.push(notInArray(media.albumId, hiddenAlbums));

  switch (scope) {
    case "camera": {
      const [cam] = await db.select().from(albums).where(eq(albums.isCamera, true));
      if (!cam) return { where: sql`false`, noCamera: true };
      conds.push(eq(media.albumId, cam.id));
      break;
    }
    case "album": conds.push(eq(media.albumId, Number(p.get("album") ?? 0))); break;
    case "photos": conds.push(eq(media.kind, "image")); break;
    case "screenshots": conds.push(albumHint("screenshots")); break;
    case "screenrec": conds.push(albumHint("screenrec")); break;
    case "downloads": conds.push(albumHint("downloads")); break;
    case "videos": conds.push(eq(media.kind, "video")); break;
    case "gifs": conds.push(or(eq(media.format, "gif"), eq(media.animated, true))); break;
    case "favorites": conds.push(eq(media.favorite, true)); break;
    case "edited": conds.push(isNotNull(media.editedAt)); break;
    case "viewed": conds.push(isNotNull(media.viewedAt)); break;
    case "large": conds.push(sql`${media.size} >= 10485760`); break;
    case "archived": conds.push(eq(media.archived, true)); break;
    default: break;
  }
  const kind = p.get("kind");
  if (kind === "image" || kind === "video") conds.push(eq(media.kind, kind));
  if (p.get("fav") === "1") conds.push(eq(media.favorite, true));
  const from = p.get("from");
  const to = p.get("to");
  if (from) conds.push(sql`${media.takenAt} >= ${new Date(from)}`);
  if (to) conds.push(sql`${media.takenAt} < ${new Date(to)}`);
  const place = p.get("place");
  if (place) conds.push(eq(media.place, place));
  const ids = p.get("only");
  if (ids) conds.push(inArray(media.id, ids.split(",").map(Number).filter(Boolean)));
  const q = (p.get("q") ?? "").trim();
  if (q) {
    const toks = q.match(/"[^"]+"|\S+/g) ?? [];
    for (const t of toks) conds.push(tokenCond(t.replace(/"/g, "")));
  }
  return { where: and(...conds), noCamera: false };
}

export async function listMedia(p: URLSearchParams) {
  await purgeExpiredTrash();
  const { where, noCamera } = await buildWhere(p);
  let sort = p.get("sort") ?? "newest";
  if (p.get("scope") === "recent") sort = "added";
  if (p.get("scope") === "viewed") sort = sort === "newest" ? "viewed" : sort;
  if (p.get("scope") === "edited") sort = sort === "newest" ? "edited" : sort;
  if (p.get("scope") === "trash" && sort === "newest") sort = "trashed";
  if (p.get("ids") === "1") {
    const rows = await db.select({ id: media.id }).from(media).where(where).limit(50000);
    return { ids: rows.map((r) => r.id) };
  }
  const limit = Math.min(Number(p.get("limit") ?? 240), 500);
  const offset = Number(p.get("offset") ?? 0);
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(where);
  const rows = await db
    .select({ ...listCols, albumName: albums.name })
    .from(media)
    .leftJoin(albums, eq(albums.id, media.albumId))
    .where(where)
    .orderBy(...orderFor(sort))
    .limit(limit)
    .offset(offset);
  return { items: rows, total: n, offset, noCamera };
}
