import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { media } from "@/db/schema";
import { writeVariant } from "@/server/lib";

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const id = Number((await ctx.params).id);
  const [row] = await db.select().from(media).where(eq(media.id, id));
  if (!row || row.vaulted) return NextResponse.json({ error: "not found" }, { status: 404 });
  await writeVariant(row.storageKey, "thumb", Buffer.from(await req.arrayBuffer()));
  await db.update(media).set({ modifiedAt: new Date() }).where(eq(media.id, id));
  return NextResponse.json({ ok: true });
}
