import fs from "node:fs/promises";
import { NextResponse } from "next/server";
import { DATA_DIR } from "@/server/lib";

export const dynamic = "force-dynamic";

export async function GET() {
  let thumbs = 0, previews = 0, originals = 0;
  try {
    for (const f of await fs.readdir(DATA_DIR)) {
      const st = await fs.stat(`${DATA_DIR}/${f}`).catch(() => null);
      if (!st) continue;
      if (f.endsWith(".thumb")) thumbs += st.size;
      else if (f.endsWith(".prev")) previews += st.size;
      else originals += st.size;
    }
  } catch { /* empty dir */ }
  return NextResponse.json({ thumbs, previews, originals });
}
