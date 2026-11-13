import { NextRequest, NextResponse } from "next/server";
import { eq, getTableColumns } from "drizzle-orm";
import { db } from "@/db";
import { albums, media } from "@/db/schema";

export const dynamic = "force-dynamic";
const { storageKey: _k, sha1: _s, phash: _p, ...cols } = getTableColumns(media);
void _k; void _s; void _p;

export async function GET(_r: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db
    .select({ ...cols, albumName: albums.name })
    .from(media)
    .leftJoin(albums, eq(albums.id, media.albumId))
    .where(eq(media.id, Number(id)));
  if (!row) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(row);
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const b = await req.json();
  const set: Record<string, unknown> = {};
  if (typeof b.name === "string" && b.name.trim()) set.name = b.name.trim().slice(0, 255);
  if (typeof b.favorite === "boolean") set.favorite = b.favorite;
  if (typeof b.place === "string") set.place = b.place || null;
  if (!Object.keys(set).length) return NextResponse.json({ ok: true });
  set.modifiedAt = new Date();
  await db.update(media).set(set).where(eq(media.id, Number(id)));
  return NextResponse.json({ ok: true });
}
