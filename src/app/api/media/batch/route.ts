import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { albums, media, vault } from "@/db/schema";
import {
  deleteRowsPermanently, findOrCreateAlbum, hintFor, getVaultKey, readVariant, removeKeysIfUnused, touchAlbum, writeVariant,
  type Variant,
} from "@/server/lib";

export const dynamic = "force-dynamic";

async function reKey(row: typeof media.$inferSelect, from: Buffer | null, to: Buffer | null) {
  const key = crypto.randomBytes(12).toString("hex");
  for (const v of ["orig", "thumb", "prev"] as Variant[]) {
    try {
      const buf = await readVariant(row.storageKey, v, from);
      await writeVariant(key, v, buf, to);
    } catch (e) {
      if (v === "orig") throw e;
    }
  }
  return key;
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const ids: number[] = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Boolean);
  const action: string = b.action;
  if (!ids.length && action !== "emptyTrash") return NextResponse.json({ error: "no ids" }, { status: 400 });
  const now = new Date();
  const rows = ids.length ? await db.select().from(media).where(inArray(media.id, ids)) : [];

  const target = async () => {
    if (b.albumId) {
      const [a] = await db.select().from(albums).where(eq(albums.id, Number(b.albumId)));
      return a;
    }
    if (b.albumName) return findOrCreateAlbum({ name: String(b.albumName), kind: "user", hint: "other" });
    return undefined;
  };

  switch (action) {
    case "favorite":
    case "unfavorite":
      await db.update(media).set({ favorite: action === "favorite" }).where(inArray(media.id, ids));
      break;
    case "archive":
    case "unarchive":
      await db.update(media).set({ archived: action === "archive" }).where(inArray(media.id, ids));
      break;
    case "view":
      await db.update(media).set({ viewedAt: now }).where(inArray(media.id, ids));
      break;
    case "setPlace":
      await db.update(media).set({ place: b.place ? String(b.place) : null }).where(inArray(media.id, ids));
      break;
    case "trash":
      await db
        .update(media)
        .set({
          trashedAt: now,
          trashAlbumId: sql`${media.albumId}`,
          trashAlbumName: sql`(select name from albums where id = ${media.albumId})`,
        })
        .where(inArray(media.id, ids));
      break;
    case "restore": {
      for (const r of rows.filter((x) => x.trashedAt)) {
        let albumId = r.albumId;
        const [a] = await db.select().from(albums).where(eq(albums.id, albumId));
        if (!a) albumId = (await findOrCreateAlbum({ name: r.trashAlbumName || "Restored", kind: hintFor(r.trashAlbumName || "") === "other" ? "user" : "device" })).id;
        await db
          .update(media)
          .set({ trashedAt: null, trashAlbumId: null, trashAlbumName: null, albumId })
          .where(eq(media.id, r.id));
        await touchAlbum(albumId);
      }
      break;
    }
    case "delete":
      await deleteRowsPermanently(rows.filter((r) => r.trashedAt).map((r) => r.id));
      break;
    case "emptyTrash": {
      const t = await db.select({ id: media.id }).from(media).where(and(isNotNull(media.trashedAt), eq(media.vaulted, false)));
      await deleteRowsPermanently(t.map((x) => x.id));
      break;
    }
    case "move": {
      const a = await target();
      if (!a) return NextResponse.json({ error: "album required" }, { status: 400 });
      await db.update(media).set({ albumId: a.id, modifiedAt: now }).where(inArray(media.id, ids));
      await touchAlbum(a.id);
      break;
    }
    case "copy": {
      const a = await target();
      if (!a) return NextResponse.json({ error: "album required" }, { status: 400 });
      for (const r of rows) {
        if (r.vaulted) continue;
        const { id: _id, ...rest } = r;
        void _id;
        await db.insert(media).values({ ...rest, albumId: a.id, createdAt: now, modifiedAt: now, trashedAt: null, favorite: false });
      }
      await touchAlbum(a.id);
      break;
    }
    case "removeFromAlbum": {
      let removed = 0;
      for (const r of rows) {
        const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(eq(media.storageKey, r.storageKey));
        if (c.n > 1) {
          await db.delete(media).where(eq(media.id, r.id));
          await db.update(albums).set({ coverMediaId: null }).where(eq(albums.coverMediaId, r.id));
          removed++;
        }
      }
      if (!removed) return NextResponse.json({ error: "These items exist only in this album. Move them to another album, or delete them." }, { status: 409 });
      return NextResponse.json({ ok: true, removed, skipped: rows.length - removed });
    }
    case "toTop": {
      const [m] = await db.select({ v: sql<number>`coalesce(min(${media.customOrder}),0)::int` }).from(media);
      let o = m.v - ids.length;
      for (const id of ids) await db.update(media).set({ customOrder: o++ }).where(eq(media.id, id));
      break;
    }
    case "hide":
    case "unhide": {
      const vk = await getVaultKey();
      const [v] = await db.select().from(vault);
      if (!v) return NextResponse.json({ error: "Set up the private folder first" }, { status: 412 });
      if (!vk) return NextResponse.json({ error: "locked" }, { status: 401 });
      for (const r of rows) {
        if (action === "hide" ? r.vaulted : !r.vaulted) continue;
        const key = await reKey(r, action === "hide" ? null : vk, action === "hide" ? vk : null);
        await db.update(media).set({ storageKey: key, vaulted: action === "hide", modifiedAt: now }).where(eq(media.id, r.id));
        await removeKeysIfUnused([r.storageKey]);
        await db.update(albums).set({ coverMediaId: null }).where(eq(albums.coverMediaId, r.id));
      }
      break;
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
