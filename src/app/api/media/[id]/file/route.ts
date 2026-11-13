import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { filePath, getVaultKey, readVariant, type Variant } from "@/server/lib";

export const dynamic = "force-dynamic";

function sniff(buf: Buffer, fallback: string) {
  if (buf[0] === 0xff && buf[1] === 0xd8) return "image/jpeg";
  if (buf[0] === 0x89 && buf[1] === 0x50) return "image/png";
  if (buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return fallback;
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db.select().from(media).where(eq(media.id, Number(id)));
  if (!row) return new NextResponse("Not found", { status: 404 });
  let vk: Buffer | null = null;
  if (row.vaulted) {
    vk = await getVaultKey();
    if (!vk) return new NextResponse("Locked", { status: 401 });
  }
  const q = req.nextUrl.searchParams.get("v") ?? "orig";
  let v: Variant = q === "thumb" ? "thumb" : q === "prev" ? "prev" : "orig";
  if (v === "prev" && !row.hasPreview) v = "orig";
  if (v !== "orig") {
    try { await fs.access(filePath(row.storageKey, v)); } catch { v = "orig"; }
  }
  const cache = row.vaulted
    ? "no-store"
    : req.nextUrl.searchParams.has("t")
      ? "private, max-age=31536000, immutable"
      : "private, max-age=30";
  const range = req.headers.get("range");
  try {
    if (vk) {
      const buf = await readVariant(row.storageKey, v, vk);
      const type = v === "orig" ? row.mime : sniff(buf, "image/jpeg");
      return rangeBuf(buf, type, range, cache);
    }
    const p = filePath(row.storageKey, v);
    const st = await fs.stat(p);
    let type = v === "orig" ? row.mime : "image/jpeg";
    if (v !== "orig") {
      const fh = await fs.open(p, "r");
      const head = Buffer.alloc(12);
      await fh.read(head, 0, 12, 0);
      await fh.close();
      type = sniff(head, type);
    }
    let start = 0;
    let end = st.size - 1;
    let status = 200;
    const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache };
    const m = range?.match(/bytes=(\d*)-(\d*)/);
    if (m && (m[1] || m[2])) {
      if (m[1]) { start = parseInt(m[1]); if (m[2]) end = Math.min(parseInt(m[2]), end); }
      else { start = Math.max(0, st.size - parseInt(m[2])); }
      if (start > end) return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${st.size}` } });
      status = 206;
      headers["Content-Range"] = `bytes ${start}-${end}/${st.size}`;
    }
    headers["Content-Length"] = String(end - start + 1);
    const stream = Readable.toWeb(createReadStream(p, { start, end })) as unknown as ReadableStream;
    return new NextResponse(stream, { status, headers });
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }
}

function rangeBuf(buf: Buffer, type: string, range: string | null, cache: string) {
  const headers: Record<string, string> = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": cache };
  const m = range?.match(/bytes=(\d*)-(\d*)/);
  let start = 0;
  let end = buf.length - 1;
  let status = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = parseInt(m[1]); if (m[2]) end = Math.min(parseInt(m[2]), end); }
    else start = Math.max(0, buf.length - parseInt(m[2]));
    status = 206;
    headers["Content-Range"] = `bytes ${start}-${end}/${buf.length}`;
  }
  const slice = buf.subarray(start, end + 1);
  headers["Content-Length"] = String(slice.length);
  return new NextResponse(new Uint8Array(slice), { status, headers });
}
