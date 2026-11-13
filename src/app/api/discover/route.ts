import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { albums, media } from "@/db/schema";
import { listCols } from "@/server/query";
import { getSettings, purgeExpiredTrash } from "@/server/lib";

export const dynamic = "force-dynamic";

const live = () => and(isNull(media.trashedAt), eq(media.vaulted, false), eq(media.archived, false));
const hintIn = (h: string) => sql`${media.albumId} in (select id from albums where hint = ${h})`;

function ham(a: string, b: string) {
  let d = 0;
  for (let i = 0; i < 16; i += 8) {
    let x = (parseInt(a.slice(i, i + 8), 16) ^ parseInt(b.slice(i, i + 8), 16)) >>> 0;
    while (x) { d += x & 1; x >>>= 1; }
  }
  return d;
}

export async function GET(req: NextRequest) {
  const type = req.nextUrl.searchParams.get("type") ?? "stats";
  const s = await getSettings();
  const hiddenFilter = s.showHiddenAlbums ? undefined : sql`${media.albumId} not in (select id from albums where hidden = true)`;
  const base = and(live(), hiddenFilter);

  if (type === "stats") {
    await purgeExpiredTrash();
    const [r] = await db
      .select({
        photos: sql<number>`(count(*) filter (where ${media.kind}='image'))::int`,
        videos: sql<number>`(count(*) filter (where ${media.kind}='video'))::int`,
        favorites: sql<number>`(count(*) filter (where ${media.favorite}))::int`,
        gifs: sql<number>`(count(*) filter (where ${media.format}='gif' or ${media.animated}))::int`,
        large: sql<number>`(count(*) filter (where ${media.size} >= 10485760))::int`,
        edited: sql<number>`(count(*) filter (where ${media.editedAt} is not null))::int`,
        viewed: sql<number>`(count(*) filter (where ${media.viewedAt} is not null))::int`,
        screenshots: sql<number>`(count(*) filter (where ${hintIn("screenshots")}))::int`,
        screenrec: sql<number>`(count(*) filter (where ${hintIn("screenrec")}))::int`,
        downloads: sql<number>`(count(*) filter (where ${hintIn("downloads")}))::int`,
        total: sql<number>`count(*)::int`,
        size: sql<number>`coalesce(sum(${media.size}),0)::float8`,
        located: sql<number>`(count(*) filter (where ${media.lat} is not null))::int`,
      })
      .from(media)
      .where(base);
    const [x] = await db
      .select({
        archived: sql<number>`(count(*) filter (where ${media.archived} and ${media.trashedAt} is null and ${media.vaulted}=false))::int`,
        trash: sql<number>`(count(*) filter (where ${media.trashedAt} is not null and ${media.vaulted}=false))::int`,
        trashSize: sql<number>`coalesce(sum(${media.size}) filter (where ${media.trashedAt} is not null),0)::float8`,
        vault: sql<number>`(count(*) filter (where ${media.vaulted} and ${media.trashedAt} is null))::int`,
        vaultSize: sql<number>`coalesce(sum(${media.size}) filter (where ${media.vaulted}),0)::float8`,
      })
      .from(media);
    const byAlbum = await db
      .select({ id: albums.id, name: albums.name, size: sql<number>`coalesce(sum(${media.size}),0)::float8`, count: sql<number>`count(${media.id})::int` })
      .from(albums)
      .leftJoin(media, eq(media.albumId, albums.id))
      .groupBy(albums.id)
      .orderBy(sql`sum(${media.size}) desc nulls last`)
      .limit(8);
    return NextResponse.json({ ...r, ...x, byAlbum });
  }

  if (type === "duplicates") {
    const groups = await db
      .select({ sha1: media.sha1 })
      .from(media)
      .where(and(base, sql`${media.sha1} <> ''`))
      .groupBy(media.sha1)
      .having(sql`count(*) > 1`)
      .limit(200);
    if (!groups.length) return NextResponse.json({ groups: [] });
    const rows = await db
      .select({ ...listCols, albumName: albums.name })
      .from(media)
      .leftJoin(albums, eq(albums.id, media.albumId))
      .where(and(base, inArray(media.sha1, groups.map((g) => g.sha1))));
    const map = new Map<string, typeof rows>();
    const shaOf = await db.select({ id: media.id, sha1: media.sha1 }).from(media).where(inArray(media.id, rows.map((r) => r.id)));
    const sh = new Map(shaOf.map((x) => [x.id, x.sha1]));
    for (const r of rows) {
      const k = sh.get(r.id)!;
      map.set(k, [...(map.get(k) ?? []), r]);
    }
    return NextResponse.json({ groups: [...map.values()].map((items) => items.sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt))) });
  }

  if (type === "similar") {
    const rows = await db
      .select({ id: media.id, ph: media.phash, sha: media.sha1 })
      .from(media)
      .where(and(base, eq(media.kind, "image"), sql`length(${media.phash}) = 16`))
      .limit(6000);
    const parent = rows.map((_, i) => i);
    const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    for (let i = 0; i < rows.length; i++)
      for (let j = i + 1; j < rows.length; j++)
        if (ham(rows[i].ph, rows[j].ph) <= 6) parent[find(j)] = find(i);
    const clusters = new Map<number, number[]>();
    rows.forEach((_, i) => { const r = find(i); clusters.set(r, [...(clusters.get(r) ?? []), i]); });
    const out = [...clusters.values()]
      .filter((c) => c.length > 1 && new Set(c.map((i) => rows[i].sha)).size > 1)
      .slice(0, 100);
    const ids = out.flat().map((i) => rows[i].id);
    if (!ids.length) return NextResponse.json({ groups: [] });
    const items = await db
      .select({ ...listCols, albumName: albums.name })
      .from(media)
      .leftJoin(albums, eq(albums.id, media.albumId))
      .where(inArray(media.id, ids));
    const byId = new Map(items.map((i) => [i.id, i]));
    return NextResponse.json({ groups: out.map((c) => c.map((i) => byId.get(rows[i].id)!).filter(Boolean)) });
  }

  if (type === "map") {
    const pts = await db
      .select({ id: media.id, lat: media.lat, lng: media.lng, place: media.place, v: media.modifiedAt })
      .from(media)
      .where(and(base, isNotNull(media.lat), isNotNull(media.lng)))
      .limit(8000);
    return NextResponse.json({ points: pts });
  }

  if (type === "timeline") {
    const rows = await db
      .select({
        year: sql<number>`extract(year from ${media.takenAt})::int`,
        month: sql<number>`extract(month from ${media.takenAt})::int`,
        count: sql<number>`count(*)::int`,
        coverId: sql<number>`(array_agg(${media.id} order by ${media.takenAt} desc))[1]`,
      })
      .from(media)
      .where(base)
      .groupBy(sql`1`, sql`2`)
      .orderBy(sql`1 desc`, sql`2 desc`);
    return NextResponse.json({ months: rows });
  }

  if (type === "calendar") {
    const rows = await db
      .select({
        day: sql<string>`to_char(${media.takenAt}, 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
        coverId: sql<number>`(array_agg(${media.id} order by ${media.takenAt} desc))[1]`,
      })
      .from(media)
      .where(base)
      .groupBy(sql`1`);
    return NextResponse.json({ days: rows });
  }

  if (type === "memories") {
    const rows = await db
      .select({ id: media.id, t: media.takenAt, kind: media.kind })
      .from(media)
      .where(base)
      .orderBy(sql`${media.takenAt} desc`)
      .limit(30000);
    const now = new Date();
    const out: { key: string; title: string; subtitle: string; coverId: number; count: number; from: string; to: string }[] = [];
    // On this day (+/- 3 days) in previous years
    const byYear = new Map<number, typeof rows>();
    for (const r of rows) {
      const y = r.t.getFullYear();
      if (y === now.getFullYear()) continue;
      const d = new Date(y, now.getMonth(), now.getDate());
      if (Math.abs(+r.t - +d) <= 3.5 * 86400_000) byYear.set(y, [...(byYear.get(y) ?? []), r]);
    }
    for (const [y, list] of byYear) {
      const n = now.getFullYear() - y;
      const from = new Date(y, now.getMonth(), now.getDate() - 3);
      const to = new Date(y, now.getMonth(), now.getDate() + 4);
      out.push({ key: `otd-${y}`, title: `${n} year${n > 1 ? "s" : ""} ago`, subtitle: "Around this day", coverId: (list.find((x) => x.kind === "image") ?? list[0]).id, count: list.length, from: from.toISOString(), to: to.toISOString() });
    }
    // Month highlights
    const months = new Map<string, typeof rows>();
    for (const r of rows) {
      const k = `${r.t.getFullYear()}-${r.t.getMonth()}`;
      months.set(k, [...(months.get(k) ?? []), r]);
    }
    for (const [k, list] of months) {
      if (list.length < 6) continue;
      const [y, m] = k.split("-").map(Number);
      out.push({ key: `m-${k}`, title: new Date(y, m, 1).toLocaleString("en", { month: "long", year: "numeric" }), subtitle: `${list.length} moments`, coverId: (list.find((x) => x.kind === "image") ?? list[0]).id, count: list.length, from: new Date(y, m, 1).toISOString(), to: new Date(y, m + 1, 1).toISOString() });
      if (out.length > 40) break;
    }
    return NextResponse.json({ memories: out });
  }

  if (type === "places") {
    const rows = await db
      .select({ place: media.place, count: sql<number>`count(*)::int`, coverId: sql<number>`(array_agg(${media.id} order by ${media.takenAt} desc))[1]` })
      .from(media)
      .where(and(base, isNotNull(media.place)))
      .groupBy(media.place)
      .orderBy(sql`count(*) desc`);
    return NextResponse.json({ places: rows });
  }
  return NextResponse.json({ error: "unknown type" }, { status: 400 });
}
