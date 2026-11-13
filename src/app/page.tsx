"use client";
import { MediaBrowser } from "@/components/media-browser";

export default function Home() {
  return <MediaBrowser scope="camera" title="Camera" subtitle="Photos" prefKey="home" home emptyText="No camera photos yet" />;
}
