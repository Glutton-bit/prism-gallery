import { NextRequest, NextResponse } from "next/server";
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { albums, media } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const b = await req.json();
  const set: Partial<typeof albums.$inferInsert> = { modifiedAt: new Date() };
  if (typeof b.name === "string") {
    const name = b.name.trim();
    if (!name) return NextResponse.json({ error: "Name required" }, { status: 400 });
    const dup = await db.select().from(albums).where(and(sql`lower(${albums.name}) = ${name.toLowerCase()}`, ne(albums.id, id)));
    if (dup.length) return NextResponse.json({ error: "An album with that name already exists" }, { status: 409 });
    set.name = name;
  }
  if (typeof b.pinned === "boolean") {
    set.pinned = b.pinned;
    if (b.pinned) {
      const [m] = await db.select({ v: sql<number>`coalesce(max(${albums.pinOrder}),0)::int` }).from(albums);
      set.pinOrder = m.v + 1;
    }
  }
  if (typeof b.hidden === "boolean") set.hidden = b.hidden;
  if (b.coverMediaId !== undefined) set.coverMediaId = b.coverMediaId ? Number(b.coverMediaId) : null;
  if (b.isCamera === true) {
    await db.update(albums).set({ isCamera: false });
    set.isCamera = true;
    set.hint = "camera";
  }
  await db.update(albums).set(set).where(eq(albums.id, id));
  return NextResponse.json({ ok: true });
}

export async function DELETE(_r: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const [a] = await db.select().from(albums).where(eq(albums.id, id));
  if (!a) return NextResponse.json({ ok: true });
  // Items go to Trash (restorable); original album name is remembered.
  await db
    .update(media)
    .set({ trashedAt: new Date(), trashAlbumId: id, trashAlbumName: a.name })
    .where(and(eq(media.albumId, id), isNull(media.trashedAt), eq(media.vaulted, false)));
  const left = await db.select({ id: media.id }).from(media).where(and(eq(media.albumId, id), eq(media.vaulted, true)));
  if (!left.length) await db.delete(albums).where(eq(albums.id, id));
  return NextResponse.json({ ok: true });
}
