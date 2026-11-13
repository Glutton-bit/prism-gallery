"use client";
import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { MediaBrowser } from "@/components/media-browser";

const EXAMPLES = ["fav", "video", "screenshot", "avif", "png", ">5mb", "2025", "march", "album:whatsapp", "4k", "gif", ">8mp"];

function Inner() {
  const q = useSearchParams().get("q") ?? "";
  return (
    <MediaBrowser key={q} scope="all" title="Search" prefKey="search" back autoSearch initialQ={q} canImport={false}
      banner={<div className="no-scrollbar flex gap-2 overflow-x-auto px-3 pb-2">{EXAMPLES.map((e) => <Link key={e} href={`/search?q=${encodeURIComponent(e)}`} replace className="glass press shrink-0 rounded-full px-3 py-1.5 text-xs font-medium">{e}</Link>)}</div>} />
  );
}
export default function SearchPage() { return <Suspense><Inner /></Suspense>; }
