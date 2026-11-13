import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { and, eq, inArray, isNotNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { albums, media, settings } from "@/db/schema";
import { defaultSettings, type Settings } from "@/lib/defaults";

const scrypt = promisify(crypto.scrypt) as (p: string, s: Buffer, l: number) => Promise<Buffer>;

export const DATA_DIR = process.env.GALLERY_DATA_DIR ?? path.join(/*turbopackIgnore: true*/ process.cwd(), ".data", "media");
export type Variant = "orig" | "thumb" | "prev";

export async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}
export const filePath = (key: string, v: Variant) => path.join(DATA_DIR, `${key}.${v}`);

/* ---------- crypto ---------- */
export function encryptBuf(key: Buffer, buf: Buffer) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(buf), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]);
}
export function decryptBuf(key: Buffer, buf: Buffer) {
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const d = crypto.createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(buf.subarray(28)), d.final()]);
}
export async function deriveKey(secret: string, salt: Buffer) {
  return scrypt(secret, salt, 32);
}

/* ---------- vault sessions (in memory, never persisted) ---------- */
type Sess = { key: Buffer; exp: number };
const g = globalThis as unknown as { __vaultSessions?: Map<string, Sess>; __lastPurge?: number };
const sessions: Map<string, Sess> = (g.__vaultSessions ??= new Map());

export async function getVaultKey(): Promise<Buffer | null> {
  const c = await cookies();
  const t = c.get("vs")?.value;
  if (!t) return null;
  const s = sessions.get(t);
  if (!s || s.exp < Date.now()) {
    sessions.delete(t);
    return null;
  }
  const mins = (await getSettings()).autoLock;
  s.exp = Date.now() + (mins > 0 ? mins * 60_000 : 12 * 3600_000);
  return s.key;
}
export async function openVaultSession(key: Buffer) {
  const token = crypto.randomBytes(24).toString("hex");
  const mins = (await getSettings()).autoLock;
  sessions.set(token, { key, exp: Date.now() + (mins > 0 ? mins * 60_000 : 12 * 3600_000) });
  const c = await cookies();
  c.set("vs", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 12 * 3600 });
}
export async function closeVaultSession() {
  const c = await cookies();
  const t = c.get("vs")?.value;
  if (t) sessions.delete(t);
  c.delete("vs");
}

/* ---------- settings ---------- */
export async function getSettings(): Promise<Settings> {
  const rows = await db.select().from(settings).where(eq(settings.key, "app"));
  const v = (rows[0]?.value ?? {}) as Partial<Settings>;
  return { ...defaultSettings, ...v };
}
export async function saveSettings(patch: Partial<Settings>) {
  const cur = await getSettings();
  const next = { ...cur, ...patch };
  await db
    .insert(settings)
    .values({ key: "app", value: next })
    .onConflictDoUpdate({ target: settings.key, set: { value: next } });
  return next;
}

/* ---------- files ---------- */
export async function writeVariant(key: string, v: Variant, buf: Buffer, vaultKey?: Buffer | null) {
  await ensureDir();
  await fs.writeFile(filePath(key, v), vaultKey ? encryptBuf(vaultKey, buf) : buf);
}
export async function readVariant(key: string, v: Variant, vaultKey?: Buffer | null) {
  const raw = await fs.readFile(filePath(key, v));
  return vaultKey ? decryptBuf(vaultKey, raw) : raw;
}
export async function removeKeysIfUnused(keys: string[]) {
  for (const key of new Set(keys)) {
    const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(media).where(eq(media.storageKey, key));
    if (r.n === 0) {
      for (const v of ["orig", "thumb", "prev"] as Variant[]) await fs.unlink(filePath(key, v)).catch(() => {});
    }
  }
}
export async function deleteRowsPermanently(ids: number[]) {
  if (!ids.length) return;
  const rows = await db.select({ id: media.id, key: media.storageKey }).from(media).where(inArray(media.id, ids));
  await db.delete(media).where(inArray(media.id, ids));
  await db.update(albums).set({ coverMediaId: null }).where(inArray(albums.coverMediaId, ids));
  await removeKeysIfUnused(rows.map((r) => r.key));
}
export async function purgeExpiredTrash(force = false) {
  const now = Date.now();
  if (!force && g.__lastPurge && now - g.__lastPurge < 60_000) return 0;
  g.__lastPurge = now;
  const days = (await getSettings()).trashDays;
  const cutoff = new Date(now - days * 86400_000);
  const rows = await db
    .select({ id: media.id })
    .from(media)
    .where(and(isNotNull(media.trashedAt), lt(media.trashedAt, cutoff)));
  await deleteRowsPermanently(rows.map((r) => r.id));
  return rows.length;
}

/* ---------- albums ---------- */
export function hintFor(name: string, p?: string | null): string {
  const s = `${p ?? ""}/${name}`.toLowerCase();
  if (/dcim\/camera|^\/?camera$|\/camera$/.test(s) || /dcim\/(100andro|100media)/.test(s)) return "camera";
  if (/screen ?recorder|screenrecord|screen recordings?/.test(s)) return "screenrec";
  if (/screenshot/.test(s)) return "screenshots";
  if (/whatsapp.*video/.test(s)) return "wa-video";
  if (/whatsapp/.test(s)) return "wa-images";
  if (/telegram/.test(s)) return "telegram";
  if (/bluetooth/.test(s)) return "bluetooth";
  if (/download/.test(s)) return "downloads";
  return "other";
}

export async function findOrCreateAlbum(opts: { name: string; path?: string | null; hint?: string; kind?: "device" | "user" }) {
  const name = opts.name.trim() || "Imported";
  const existing = await db.select().from(albums).where(sql`lower(${albums.name}) = ${name.toLowerCase()}`);
  const match = existing.find((a) => !opts.path || !a.path || a.path === opts.path) ?? existing[0];
  if (match) return match;
  const hint = opts.hint ?? hintFor(name, opts.path);
  const [cam] = await db.select().from(albums).where(eq(albums.isCamera, true));
  const [row] = await db
    .insert(albums)
    .values({
      name,
      path: opts.path ?? null,
      hint,
      kind: opts.kind ?? "device",
      isCamera: hint === "camera" && !cam && !!opts.path,
    })
    .returning();
  return row;
}
export async function touchAlbum(id: number) {
  await db.update(albums).set({ modifiedAt: new Date() }).where(eq(albums.id, id));
}
