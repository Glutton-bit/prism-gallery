"use client";
import { Suspense, use } from "react";
import { useSearchParams } from "next/navigation";
import { MediaBrowser } from "@/components/media-browser";

const CATS: Record<string, { title: string; scope: string; kind?: "image" | "video" }> = {
  photos: { title: "All Photos", scope: "photos", kind: "image" },
  camera: { title: "Camera", scope: "camera" },
  screenshots: { title: "Screenshots", scope: "screenshots" },
  screenrec: { title: "Screen Recordings", scope: "screenrec" },
  videos: { title: "Videos", scope: "videos", kind: "video" },
  gifs: { title: "GIFs", scope: "gifs" },
  downloads: { title: "Downloads", scope: "downloads" },
  favorites: { title: "Favourites", scope: "favorites" },
  recent: { title: "Recently Added", scope: "recent" },
  edited: { title: "Recently Edited", scope: "edited" },
  viewed: { title: "Recently Viewed", scope: "viewed" },
  large: { title: "Large Files (10 MB+)", scope: "large" },
  archived: { title: "Archived", scope: "archived" },
  range: { title: "Moments", scope: "all" },
  place: { title: "Place", scope: "all" },
};

function Inner({ slug }: { slug: string }) {
  const sp = useSearchParams();
  const c = CATS[slug] ?? CATS.photos;
  const extra: Record<string, string> = {};
  for (const k of ["from", "to", "place"]) if (sp.get(k)) extra[k] = sp.get(k)!;
  const title = sp.get("title") || c.title;
  return <MediaBrowser key={slug + sp.toString()} scope={c.scope} kindFilter={c.kind} title={title} prefKey={`cat-${slug}`} back extraParams={extra} canImport={false} />;
}
export default function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  return <Suspense><Inner slug={slug} /></Suspense>;
}
