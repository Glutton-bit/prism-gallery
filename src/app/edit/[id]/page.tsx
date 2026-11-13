"use client";
import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PhotoEditor from "@/components/photo-editor";
import VideoEditor from "@/components/video-editor";
import { api } from "@/lib/api";
import type { Item } from "@/lib/types";
import { Btn, Spinner } from "@/components/ui";

export default function EditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Item>(`/api/media/${id}`).then(setItem).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="grid min-h-dvh place-items-center p-8 text-center"><div><p className="mb-3 font-semibold">{err}</p><Btn onClick={() => router.back()}>Back</Btn></div></div>;
  if (!item) return <div className="grid min-h-dvh place-items-center muted"><Spinner size={30} /></div>;
  return item.kind === "video" ? <VideoEditor item={item} /> : <PhotoEditor item={item} />;
}
