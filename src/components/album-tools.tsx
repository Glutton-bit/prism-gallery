"use client";
import { useEffect, useState } from "react";
import { Camera, EyeOff, Eye, ImageIcon, Pencil, Pin, PinOff, Trash2 } from "lucide-react";
import type { Album, MediaPage } from "@/lib/types";
import { api, del, patch, thumbUrl } from "@/lib/api";
import { useDialogs } from "./providers";
import { Btn, Sheet } from "./ui";

export function useAlbumOps(onChanged: () => void) {
  const d = useDialogs();
  const safe = async (f: () => Promise<unknown>) => { try { await f(); onChanged(); } catch (e) { d.toast((e as Error).message); } };
  return {
    rename: (a: Album) => safe(async () => { const v = await d.prompt({ title: "Rename album", value: a.name, confirmText: "Rename" }); if (v && v.trim() !== a.name) await patch(`/api/albums/${a.id}`, { name: v }); }),
    pin: (a: Album, on: boolean) => safe(() => patch(`/api/albums/${a.id}`, { pinned: on })),
    hide: (a: Album, on: boolean) => safe(() => patch(`/api/albums/${a.id}`, { hidden: on })),
    camera: (a: Album) => safe(async () => { const ok = await d.confirm({ title: `Use “${a.name}” as Camera folder?`, message: "The Home page will show only this folder.", confirmText: "Use as Camera" }); if (ok) await patch(`/api/albums/${a.id}`, { isCamera: true }); }),
    remove: async (as: Album[]) => {
      const n = as.reduce((x, a) => x + a.count, 0);
      const ok = await d.confirm({ title: as.length > 1 ? `Delete ${as.length} albums?` : `Delete “${as[0].name}”?`, message: `${n} item${n === 1 ? "" : "s"} will move to Trash (restorable for the retention period). Files are never deleted without going through Trash.`, confirmText: "Delete", danger: true });
      if (!ok) return false;
      await safe(async () => { for (const a of as) await del(`/api/albums/${a.id}`); });
      return true;
    },
  };
}

export function CoverPicker({ album, open, onClose, onChanged }: { album: Album; open: boolean; onClose: () => void; onChanged: () => void }) {
  const [items, setItems] = useState<MediaPage["items"]>([]);
  useEffect(() => { if (open) api<MediaPage>(`/api/media?scope=album&album=${album.id}&limit=90&kind=image`).then((r) => setItems(r.items)).catch(() => {}); }, [open, album.id]);
  const pick = async (id: number | null) => { await patch(`/api/albums/${album.id}`, { coverMediaId: id }); onChanged(); onClose(); };
  return (
    <Sheet open={open} onClose={onClose} title="Album cover" tall z={95}>
      <Btn className="mb-3 w-full" onClick={() => pick(null)}>Automatic (latest item)</Btn>
      <div className="grid grid-cols-4 gap-1.5">
        {items.map((i) => <button key={i.id} onClick={() => pick(i.id)} className={`aspect-square overflow-hidden rounded-xl ${album.coverMediaId === i.id ? "ring-2 ring-[var(--accent)]" : ""}`}><img src={thumbUrl(i)} alt="" className="h-full w-full object-cover" loading="lazy" /></button>)}
      </div>
      {!items.length && <p className="muted p-6 text-center text-sm">Add photos to choose a cover.</p>}
    </Sheet>
  );
}

export function AlbumMenu({ album, open, onClose, onChanged, onDeleted }: { album: Album; open: boolean; onClose: () => void; onChanged: () => void; onDeleted: () => void }) {
  const ops = useAlbumOps(onChanged);
  const [cover, setCover] = useState(false);
  const row = (icon: React.ReactNode, label: string, f: () => void, danger?: boolean) => (
    <button key={label} onClick={() => { onClose(); f(); }} className={`card press flex items-center gap-3 rounded-2xl px-4 py-3.5 text-left font-medium ${danger ? "text-[var(--danger)]" : ""}`}>{icon}{label}</button>
  );
  return (
    <>
      <Sheet open={open} onClose={onClose} title={album.name}>
        <div className="grid gap-2 pb-2">
          {row(<Pencil size={19} />, "Rename", () => ops.rename(album))}
          {row(<ImageIcon size={19} />, "Change cover", () => setCover(true))}
          {row(album.pinned ? <PinOff size={19} /> : <Pin size={19} />, album.pinned ? "Unpin from top" : "Pin to top", () => ops.pin(album, !album.pinned))}
          {row(album.hidden ? <Eye size={19} /> : <EyeOff size={19} />, album.hidden ? "Unhide album" : "Hide album", () => ops.hide(album, !album.hidden))}
          {!album.isCamera && row(<Camera size={19} />, "Use as Camera folder (Home)", () => ops.camera(album))}
          {row(<Trash2 size={19} />, "Delete album", async () => { if (await ops.remove([album])) onDeleted(); }, true)}
        </div>
      </Sheet>
      <CoverPicker album={album} open={cover} onClose={() => setCover(false)} onChanged={onChanged} />
    </>
  );
}
