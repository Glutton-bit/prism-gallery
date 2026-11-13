import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { albums } from "@/db/schema";

export async function POST(req: NextRequest) {
  const b = await req.json();
  if (Array.isArray(b.pinned)) for (let i = 0; i < b.pinned.length; i++) await db.update(albums).set({ pinOrder: i + 1 }).where(eq(albums.id, Number(b.pinned[i])));
  if (Array.isArray(b.order)) for (let i = 0; i < b.order.length; i++) await db.update(albums).set({ sortOrder: i + 1 }).where(eq(albums.id, Number(b.order[i])));
  return NextResponse.json({ ok: true });
}
