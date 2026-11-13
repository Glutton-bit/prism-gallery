import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { albums, media } from "@/db/schema";
import { findOrCreateAlbum, purgeExpiredTrash } from "@/server/lib";

export const dynamic = "force-dynamic";

export async function GET() {
  await purgeExpiredTrash();
  const all = await db.select().from(albums);
  const agg = await db
    .select({
      albumId: media.albumId,
      count: sql<number>`count(*)::int`,
      videos: sql<number>`(count(*) filter (where ${media.kind} = 'video'))::int`,
      size: sql<number>`coalesce(sum(${media.size}),0)::float8`,
      last: sql<string>`max(${media.takenAt})`,
      coverId: sql<number>`(array_agg(${media.id} order by ${media.takenAt} desc))[1]`,
      coverV: sql<number>`(array_agg(extract(epoch from ${media.modifiedAt})::bigint order by ${media.takenAt} desc))[1]::float8`,
    })
    .from(media)
    .where(and(isNull(media.trashedAt), eq(media.vaulted, false), eq(media.archived, false)))
    .groupBy(media.albumId);
  const byId = new Map(agg.map((a) => [a.albumId, a]));
  const explicit = all.map((a) => a.coverMediaId).filter((x): x is number => !!x);
  const covers = explicit.length
    ? await db.select({ id: media.id, m: media.modifiedAt }).from(media).where(and(inArray(media.id, explicit), isNull(media.trashedAt), eq(media.vaulted, false)))
    : [];
  const cm = new Map(covers.map((c) => [c.id, c.m.getTime()]));
  const out = all
    .map((a) => {
      const g = byId.get(a.id);
      const useExplicit = a.coverMediaId && cm.has(a.coverMediaId);
      return {
        ...a,
        count: g?.count ?? 0,
        videoCount: g?.videos ?? 0,
        size: g?.size ?? 0,
        lastTaken: g?.last ?? null,
        coverId: useExplicit ? a.coverMediaId : (g?.coverId ?? null),
        coverV: useExplicit ? cm.get(a.coverMediaId!)! : (g?.coverV ?? 0),
      };
    })
    .filter((a) => a.kind === "user" || a.isCamera || a.count > 0);
  return NextResponse.json(out);
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const name = String(b.name ?? "").trim();
  if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const dup = await db.select().from(albums).where(sql`lower(${albums.name}) = ${name.toLowerCase()}`);
  if (dup.length) return NextResponse.json({ error: "An album with that name already exists" }, { status: 409 });
  const a = await findOrCreateAlbum({ name, kind: "user", hint: "other" });
  return NextResponse.json(a);
}
