import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { listMedia } from "@/server/query";
import { findOrCreateAlbum, getVaultKey, removeKeysIfUnused, touchAlbum, writeVariant } from "@/server/lib";
import { getUploadMeta } from "@/server/upload-meta";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("scope") === "hidden" && !(await getVaultKey()))
    return NextResponse.json({ error: "locked" }, { status: 401 });
  return NextResponse.json(await listMedia(req.nextUrl.searchParams));
}

export async function POST(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file required" }, { status: 400 });
  const m = getUploadMeta(form.get("meta"));
  const buf = Buffer.from(await file.arrayBuffer());
  const thumb = form.get("thumb") as File | null;
  const prev = form.get("preview") as File | null;

  let albumId = m.albumId;
  if (!albumId) {
    const a = await findOrCreateAlbum({ name: m.albumName || "Imported", path: m.albumPath, hint: m.hint });
    albumId = a.id;
  }
  const key = crypto.randomBytes(12).toString("hex");
  await writeVariant(key, "orig", buf);
  if (thumb) await writeVariant(key, "thumb", Buffer.from(await thumb.arrayBuffer()));
  if (prev) await writeVariant(key, "prev", Buffer.from(await prev.arrayBuffer()));
  const sha1 = crypto.createHash("sha1").update(buf).digest("hex");
  const now = new Date();
  const values = {
    albumId,
    name: m.name,
    mime: m.mime,
    format: m.format,
    kind: m.kind,
    size: buf.length,
    width: m.width,
    height: m.height,
    previewWidth: m.previewWidth,
    previewHeight: m.previewHeight,
    durationMs: m.durationMs,
    animated: m.animated,
    storageKey: key,
    hasPreview: !!prev,
    sha1,
    phash: m.phash,
    takenAt: m.takenAt ? new Date(m.takenAt) : now,
    modifiedAt: now,
    lat: m.lat,
    lng: m.lng,
    place: m.place,
    camera: m.camera,
    exif: m.exif,
    sourcePath: m.sourcePath,
  };
  if (m.replaceId) {
    const [old] = await db.select().from(media).where(eq(media.id, m.replaceId));
    if (old) {
      const [row] = await db
        .update(media)
        .set({ ...values, albumId: old.albumId, takenAt: old.takenAt, editedAt: now })
        .where(eq(media.id, old.id))
        .returning({ id: media.id });
      await removeKeysIfUnused([old.storageKey]);
      return NextResponse.json({ id: row.id });
    }
  }
  const [row] = await db
    .insert(media)
    .values({ ...values, editedAt: m.edited ? now : null })
    .returning({ id: media.id });
  await touchAlbum(albumId);
  return NextResponse.json({ id: row.id, albumId });
}
