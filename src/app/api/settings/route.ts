import { NextRequest, NextResponse } from "next/server";
import { getSettings, purgeExpiredTrash, saveSettings } from "@/server/lib";
import { defaultSettings } from "@/lib/defaults";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await getSettings());
}
export async function PUT(req: NextRequest) {
  const b = await req.json();
  const patch: Record<string, unknown> = {};
  for (const k of Object.keys(defaultSettings)) if (k in b) patch[k] = b[k];
  const next = await saveSettings(patch);
  if ("trashDays" in patch) await purgeExpiredTrash(true);
  return NextResponse.json(next);
}
