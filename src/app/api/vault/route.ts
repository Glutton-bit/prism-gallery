import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { eq, and, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { media, vault } from "@/db/schema";
import { closeVaultSession, decryptBuf, deriveKey, encryptBuf, getVaultKey, openVaultSession } from "@/server/lib";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { __vaultFails?: { n: number; until: number } };
const fails = (g.__vaultFails ??= { n: 0, until: 0 });

async function unwrap(secret: string) {
  const [v] = await db.select().from(vault);
  if (!v) return null;
  const kek = await deriveKey(secret, Buffer.from(v.salt, "hex"));
  try {
    return decryptBuf(kek, Buffer.from(v.wrappedKey, "hex"));
  } catch {
    return null;
  }
}
async function wrap(master: Buffer, secret: string, authType: string) {
  const salt = crypto.randomBytes(16);
  const kek = await deriveKey(secret, salt);
  const values = { id: 1, authType, salt: salt.toString("hex"), wrappedKey: encryptBuf(kek, master).toString("hex") };
  await db.insert(vault).values(values).onConflictDoUpdate({ target: vault.id, set: values });
}

export async function GET() {
  const [v] = await db.select().from(vault);
  const [c] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(media)
    .where(and(eq(media.vaulted, true), isNull(media.trashedAt)));
  const unlocked = !!(await getVaultKey());
  return NextResponse.json({ configured: !!v, authType: v?.authType ?? null, unlocked, count: unlocked ? c.n : null });
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const secret = String(b.secret ?? "");
  const authType = b.authType === "password" ? "password" : "pin";
  const [v] = await db.select().from(vault);
  const validNew = () => (authType === "pin" ? /^\d{4,8}$/.test(secret) : secret.length >= 6);
  switch (b.action) {
    case "setup": {
      if (v) return NextResponse.json({ error: "Already configured" }, { status: 409 });
      if (!validNew()) return NextResponse.json({ error: authType === "pin" ? "PIN must be 4–8 digits" : "Password needs 6+ characters" }, { status: 400 });
      const master = crypto.randomBytes(32);
      await wrap(master, secret, authType);
      await openVaultSession(master);
      return NextResponse.json({ ok: true });
    }
    case "unlock": {
      if (Date.now() < fails.until) return NextResponse.json({ error: `Too many attempts. Try again in ${Math.ceil((fails.until - Date.now()) / 1000)}s` }, { status: 429 });
      const master = await unwrap(secret);
      if (!master) {
        fails.n++;
        if (fails.n >= 5) { fails.until = Date.now() + 30_000 * Math.min(fails.n - 4, 10); }
        return NextResponse.json({ error: "Incorrect " + (v?.authType === "password" ? "password" : "PIN") }, { status: 403 });
      }
      fails.n = 0;
      await openVaultSession(master);
      return NextResponse.json({ ok: true });
    }
    case "lock":
      await closeVaultSession();
      return NextResponse.json({ ok: true });
    case "change": {
      const master = await unwrap(String(b.old ?? ""));
      if (!master) return NextResponse.json({ error: "Current credential is incorrect" }, { status: 403 });
      if (!validNew()) return NextResponse.json({ error: authType === "pin" ? "PIN must be 4–8 digits" : "Password needs 6+ characters" }, { status: 400 });
      await wrap(master, secret, authType);
      await openVaultSession(master);
      return NextResponse.json({ ok: true });
    }
    case "remove": {
      const master = await unwrap(secret);
      if (!master) return NextResponse.json({ error: "Incorrect credential" }, { status: 403 });
      const [c] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(eq(media.vaulted, true));
      if (c.n > 0) return NextResponse.json({ error: "Restore all private files first" }, { status: 409 });
      await db.delete(vault);
      await closeVaultSession();
      return NextResponse.json({ ok: true });
    }
    default:
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }
}
