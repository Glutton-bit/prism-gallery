"use client";
import { use, useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { MediaBrowser } from "@/components/media-browser";
import { IconBtn } from "@/components/ui";
import { AlbumMenu } from "@/components/album-tools";
import { api } from "@/lib/api";
import type { Album } from "@/lib/types";

export default function AlbumPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [album, setAlbum] = useState<Album | null>(null);
  const [menu, setMenu] = useState(false);
  const [sig, setSig] = useState(0);
  const refresh = useCallback(() => api<Album[]>("/api/albums").then((l) => setAlbum(l.find((a) => a.id === Number(id)) ?? null)).catch(() => {}), [id]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <>
      <MediaBrowser scope="album" albumId={Number(id)} inAlbum title={album?.name ?? "Album"} subtitle={album?.kind === "user" ? "Your album" : album?.path ?? "Device folder"} prefKey={`album-${id}`} back reloadSignal={sig}
        headerRight={<IconBtn label="Album options" onClick={() => setMenu(true)}><MoreHorizontal size={18} /></IconBtn>} />
      {album && <AlbumMenu album={album} open={menu} onClose={() => setMenu(false)} onChanged={() => { refresh(); setSig((x) => x + 1); }} onDeleted={() => router.replace("/albums")} />}
    </>
  );
}
