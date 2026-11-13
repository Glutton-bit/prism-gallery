"use client";
import { MediaBrowser } from "@/components/media-browser";

export default function TrashPage() {
  return <MediaBrowser scope="trash" mode="trash" title="Trash" prefKey="trash" back canImport={false} />;
}
