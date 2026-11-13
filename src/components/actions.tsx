"use client";
import { useCallback, useEffect, useState } from "react";
import { api, batch, post } from "@/lib/api";
import type { Item } from "@/lib/types";
import { fmtDateTime, fmtSize, fmtDur } from "@/lib/format";
import { shareItems } from "@/lib/imaging";
import { useDialogs, useSettings } from "./providers";
import { Sheet } from "./ui";

export type Change = { type: "remove"; ids: number[] } | { type: "patch"; ids: number[]; patch: Partial<Item> } | { type: "reload" };

export type VaultStatus = { configured: boolean; authType: "pin" | "password" | null; unlocked: boolean; count: number | null };
export const vaultStatus = () => api<VaultStatus>("/api/vault");

export function useVaultGate() {
  const d = useDialogs();
  return useCallback(async (): Promise<boolean> => {
    let st = await vaultStatus();
    if (st.unlocked) return true;
    if (!st.configured) {
      const ok = await d.confirm({ title: "Create your private folder", message: "Private files are encrypted (AES-256-GCM) with a key protected by your PIN. Next, choose a 4–8 digit PIN. You can switch to a password in Settings → Privacy.", confirmText: "Continue" });
      if (!ok) return false;
      const pin = await d.prompt({ title: "Choose a PIN", message: "4–8 digits", type: "password", placeholder: "PIN" });
      if (!pin) return false;
      const again = await d.prompt({ title: "Confirm PIN", type: "password", placeholder: "Repeat PIN" });
      if (again !== pin) { d.toast("PINs did not match"); return false; }
      try { await post("/api/vault", { action: "setup", authType: "pin", secret: pin }); return true; } catch (e) { d.toast((e as Error).message); return false; }
    }
    const secret = await d.prompt({ title: "Unlock private folder", message: st.authType === "password" ? "Enter your password" : "Enter your PIN", type: "password", placeholder: st.authType === "password" ? "Password" : "PIN", confirmText: "Unlock" });
    if (!secret) return false;
    try { await post("/api/vault", { action: "unlock", authType: st.authType, secret }); st = await vaultStatus(); return st.unlocked; } catch (e) { d.toast((e as Error).message); return false; }
  }, [d]);
}

export function useActions(cfg: { albumId?: number; onChange: (c: Change) => void }) {
  const d = useDialogs();
  const gate = useVaultGate();
  const { s } = useSettings();
  const { onChange, albumId } = cfg;
  const run = useCallback(async (fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { d.toast((e as Error).message || "Something went wrong"); }
  }, [d]);
  const ids = (xs: Item[]) => xs.map((x) => x.id);

  return {
    trash: (xs: Item[]) => run(async () => {
      await batch("trash", ids(xs));
      onChange({ type: "remove", ids: ids(xs) });
      d.toast(`Moved ${xs.length} to Trash`, { action: { label: "Undo", onClick: () => run(async () => { await batch("restore", ids(xs)); onChange({ type: "reload" }); }) }, ms: 5000 });
    }),
    restore: (xs: Item[]) => run(async () => { await batch("restore", ids(xs)); onChange({ type: "remove", ids: ids(xs) }); d.toast(`Restored ${xs.length} item${xs.length > 1 ? "s" : ""}`); }),
    purge: (xs: Item[]) => run(async () => {
      const ok = await d.confirm({ title: `Permanently delete ${xs.length} item${xs.length > 1 ? "s" : ""}?`, message: "This cannot be undone. The files are erased from storage.", confirmText: "Delete forever", danger: true });
      if (!ok) return;
      await batch("delete", ids(xs));
      onChange({ type: "remove", ids: ids(xs) });
      d.toast("Deleted permanently");
    }),
    emptyTrash: (count: number) => run(async () => {
      const ok = await d.confirm({ title: "Empty Trash?", message: `${count} item${count === 1 ? "" : "s"} will be permanently deleted. This cannot be undone.`, confirmText: "Empty Trash", danger: true });
      if (!ok) return;
      await post("/api/media/batch", { action: "emptyTrash", ids: [] });
      onChange({ type: "reload" });
    }),
    favorite: (xs: Item[], on: boolean) => run(async () => { await batch(on ? "favorite" : "unfavorite", ids(xs)); onChange({ type: "patch", ids: ids(xs), patch: { favorite: on } }); }),
    archive: (xs: Item[], on: boolean) => run(async () => { await batch(on ? "archive" : "unarchive", ids(xs)); onChange({ type: "remove", ids: ids(xs) }); d.toast(on ? "Archived" : "Unarchived"); }),
    move: (xs: Item[]) => run(async () => {
      const r = await d.pickAlbum({ title: "Move to album", excludeId: albumId });
      if (!r) return;
      await batch("move", ids(xs), r);
      onChange({ type: "reload" });
      d.toast(`Moved ${xs.length} item${xs.length > 1 ? "s" : ""}`);
    }),
    copy: (xs: Item[], title = "Copy to album") => run(async () => {
      const r = await d.pickAlbum({ title, excludeId: albumId });
      if (!r) return;
      await batch("copy", ids(xs), r);
      onChange({ type: "reload" });
      d.toast(`Added ${xs.length} item${xs.length > 1 ? "s" : ""}`);
    }),
    removeFromAlbum: (xs: Item[]) => run(async () => {
      const ok = await d.confirm({ title: "Remove from album?", message: "Only the album entry is removed — the file stays in any other album that holds a copy.", confirmText: "Remove" });
      if (!ok) return;
      await batch("removeFromAlbum", ids(xs));
      onChange({ type: "remove", ids: ids(xs) });
    }),
    hide: (xs: Item[]) => run(async () => {
      if (!(await gate())) return;
      await batch("hide", ids(xs));
      onChange({ type: "remove", ids: ids(xs) });
      d.toast(`Moved ${xs.length} to the private folder (encrypted)`);
    }),
    unhide: (xs: Item[]) => run(async () => { await batch("unhide", ids(xs)); onChange({ type: "remove", ids: ids(xs) }); d.toast("Restored from private folder"); }),
    toTop: (xs: Item[]) => run(async () => { await batch("toTop", ids(xs)); onChange({ type: "reload" }); }),
    share: (xs: Item[], download = false) => run(async () => {
      d.toast(download ? "Preparing download…" : "Preparing share…");
      const r = await shareItems(xs, download);
      if (r === "downloaded") d.toast("Saved to your downloads (sharing isn't available here)");
    }),
    rename: (x: Item) => run(async () => {
      const v = await d.prompt({ title: "Rename", value: x.name, confirmText: "Rename" });
      if (!v || v === x.name) return;
      await api(`/api/media/${x.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: v }) });
      onChange({ type: "patch", ids: [x.id], patch: { name: v } });
    }),
    s,
  };
}

function Row({ k, v }: { k: string; v?: string | number | null }) {
  if (v === undefined || v === null || v === "") return null;
  return <div className="flex justify-between gap-4 border-b border-[var(--hair)] py-2.5 text-sm last:border-0"><span className="muted shrink-0">{k}</span><span className="break-all text-right font-medium">{v}</span></div>;
}

export function InfoSheet({ items, onClose }: { items: Item[] | null; onClose: () => void }) {
  const [detail, setDetail] = useState<Item | null>(null);
  useEffect(() => {
    setDetail(null);
    if (items && items.length === 1) api<Item>(`/api/media/${items[0].id}`).then(setDetail).catch(() => setDetail(items[0]));
  }, [items]);
  if (!items) return null;
  if (items.length > 1) {
    const total = items.reduce((a, b) => a + b.size, 0);
    const ts = items.map((i) => +new Date(i.takenAt));
    return (
      <Sheet open onClose={onClose} title={`${items.length} items`}>
        <Row k="Photos" v={items.filter((i) => i.kind === "image").length} />
        <Row k="Videos" v={items.filter((i) => i.kind === "video").length} />
        <Row k="Total size" v={fmtSize(total)} />
        <Row k="Oldest" v={fmtDateTime(new Date(Math.min(...ts)))} />
        <Row k="Newest" v={fmtDateTime(new Date(Math.max(...ts)))} />
      </Sheet>
    );
  }
  const it = detail ?? items[0];
  const ex = (it.exif ?? {}) as Record<string, unknown>;
  const mp = it.width && it.height ? ((it.width * it.height) / 1e6).toFixed(1) + " MP" : "";
  return (
    <Sheet open onClose={onClose} title="Details">
      <Row k="Name" v={it.name} />
      <Row k="Album" v={it.albumName ?? it.trashAlbumName} />
      <Row k="Type" v={`${it.kind === "video" ? "Video" : "Photo"} · ${it.format.toUpperCase()}${it.animated ? " (animated)" : ""}`} />
      <Row k="Resolution" v={it.width ? `${it.width} × ${it.height}${mp ? " · " + mp : ""}` : "Not decodable on this device"} />
      {it.hasPreview && it.width > it.previewWidth && <Row k="Preview / original" v={`${it.previewWidth}×${it.previewHeight} / ${it.width}×${it.height}`} />}
      <Row k="File size" v={fmtSize(it.size)} />
      {it.kind === "video" && <Row k="Duration" v={fmtDur(it.durationMs)} />}
      <Row k="Date taken" v={fmtDateTime(it.takenAt)} />
      <Row k="Added" v={fmtDateTime(it.createdAt)} />
      <Row k="Modified" v={fmtDateTime(it.modifiedAt)} />
      {it.editedAt && <Row k="Edited" v={fmtDateTime(it.editedAt)} />}
      <Row k="Camera" v={it.camera} />
      <Row k="Lens" v={ex.LensModel as string} />
      <Row k="ISO" v={ex.ISO as number} />
      <Row k="Aperture" v={ex.FNumber ? `f/${ex.FNumber}` : undefined} />
      <Row k="Exposure" v={ex.ExposureTime ? `${Number(ex.ExposureTime) < 1 ? "1/" + Math.round(1 / Number(ex.ExposureTime)) : ex.ExposureTime} s` : undefined} />
      <Row k="Focal length" v={ex.FocalLength ? `${ex.FocalLength} mm` : undefined} />
      <Row k="Location" v={it.lat != null && it.lng != null ? `${it.lat.toFixed(5)}, ${it.lng.toFixed(5)}${it.place && it.place.includes("°") === false ? " · " + it.place : ""}` : "No location metadata"} />
      <Row k="Source folder" v={it.sourcePath} />
      {it.trashedAt && <Row k="Deleted" v={fmtDateTime(it.trashedAt)} />}
      {Object.keys(ex).length > 0 && (
        <details className="card mt-3 rounded-2xl p-3 text-xs">
          <summary className="cursor-pointer font-semibold">Raw metadata</summary>
          <pre className="mt-2 whitespace-pre-wrap break-all muted">{JSON.stringify(Object.fromEntries(Object.entries(ex).filter(([, v]) => v !== undefined && v !== null)), null, 2)}</pre>
        </details>
      )}
    </Sheet>
  );
}
