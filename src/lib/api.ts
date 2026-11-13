import type { Item } from "./types";

export async function api<T = unknown>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  let data: unknown = null;
  try { data = await res.json(); } catch { /* no body */ }
  if (!res.ok) {
    const err = new Error((data as { error?: string } | null)?.error || `Request failed (${res.status})`) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }
  return data as T;
}
export const post = <T = unknown>(url: string, body: unknown) =>
  api<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const patch = <T = unknown>(url: string, body: unknown) =>
  api<T>(url, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
export const del = <T = unknown>(url: string) => api<T>(url, { method: "DELETE" });

const ver = (i: { modifiedAt: string }) => new Date(i.modifiedAt).getTime();
export const thumbUrl = (i: Pick<Item, "id" | "modifiedAt" | "vaulted">) => `/api/media/${i.id}/file?v=thumb&t=${ver(i)}`;
export const prevUrl = (i: Pick<Item, "id" | "modifiedAt" | "hasPreview">) => `/api/media/${i.id}/file?v=${i.hasPreview ? "prev" : "orig"}&t=${ver(i)}`;
export const origUrl = (i: Pick<Item, "id" | "modifiedAt">) => `/api/media/${i.id}/file?v=orig&t=${ver(i)}`;
export const batch = (action: string, ids: number[], extra: Record<string, unknown> = {}) =>
  post<{ ok: boolean; removed?: number }>("/api/media/batch", { action, ids, ...extra });
