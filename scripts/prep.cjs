const fs = require("fs");

fs.writeFileSync(
  "next.config.ts",
  [
    'import type { NextConfig } from "next";',
    "const nextConfig: NextConfig = {",
    '  output: "export",',
    "  trailingSlash: true,",
    "  images: { unoptimized: true },",
    "};",
    "export default nextConfig;",
    "",
  ].join("\n")
);

fs.writeFileSync(
  "capacitor.config.json",
  JSON.stringify(
    {
      appId: "com.prism.gallery",
      appName: "Prism Gallery",
      webDir: "out",
    },
    null,
    2
  )
);

fs.rmSync("src/app/api", { recursive: true, force: true });

if (fs.existsSync("src/app/albums/[id]/page.tsx")) {
  fs.mkdirSync("src/app/album", { recursive: true });
  fs.writeFileSync(
    "src/app/album/page.tsx",
    `"use client";
import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MoreHorizontal } from "lucide-react";
import { MediaBrowser } from "@/components/media-browser";
import { IconBtn } from "@/components/ui";
import { AlbumMenu } from "@/components/album-tools";
import { api } from "@/lib/api";
import type { Album } from "@/lib/types";

function AlbumInner() {
  const id = useSearchParams().get("id") ?? "0";
  const router = useRouter();
  const [album, setAlbum] = useState<Album | null>(null);
  const [menu, setMenu] = useState(false);
  const [sig, setSig] = useState(0);
  const refresh = useCallback(() => api<Album[]>("/api/albums").then((l) => setAlbum(l.find((a) => a.id === Number(id)) ?? null)).catch(() => {}), [id]);
  useEffect(() => { refresh(); }, [refresh]);
  return (
    <>
      <MediaBrowser scope="album" albumId={Number(id)} inAlbum title={album?.name ?? "Album"} subtitle={album?.kind === "user" ? "Your album" : album?.path ?? "Device folder"} prefKey={\`album-\${id}\`} back reloadSignal={sig}
        headerRight={<IconBtn label="Album options" onClick={() => setMenu(true)}><MoreHorizontal size={18} /></IconBtn>} />
      {album && <AlbumMenu album={album} open={menu} onClose={() => setMenu(false)} onChanged={() => { refresh(); setSig((x) => x + 1); }} onDeleted={() => router.replace("/albums")} />}
    </>
  );
}
export default function AlbumPage() { return <Suspense><AlbumInner /></Suspense>; }
`
  );
  fs.rmSync("src/app/albums/[id]", { recursive: true, force: true });
}

if (fs.existsSync("src/app/albums/page.tsx")) {
  let albumsPage = fs.readFileSync("src/app/albums/page.tsx", "utf8");
  albumsPage = albumsPage.replace("router.push(`/albums/${a.id}`)", "router.push(`/album?id=${a.id}`)");
  fs.writeFileSync("src/app/albums/page.tsx", albumsPage);
}

if (fs.existsSync("src/app/edit/[id]/page.tsx")) {
  fs.mkdirSync("src/app/edit", { recursive: true });
  fs.writeFileSync(
    "src/app/edit/page.tsx",
    `"use client";
import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import PhotoEditor from "@/components/photo-editor";
import VideoEditor from "@/components/video-editor";
import { api } from "@/lib/api";
import type { Item } from "@/lib/types";
import { Btn, Spinner } from "@/components/ui";

function EditInner() {
  const id = useSearchParams().get("id") ?? "0";
  const router = useRouter();
  const [item, setItem] = useState<Item | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api<Item>(\`/api/media/\${id}\`).then(setItem).catch((e) => setErr(e.message)); }, [id]);
  if (err) return <div className="grid min-h-dvh place-items-center p-8 text-center"><div><p className="mb-3 font-semibold">{err}</p><Btn onClick={() => router.back()}>Back</Btn></div></div>;
  if (!item) return <div className="grid min-h-dvh place-items-center muted"><Spinner size={30} /></div>;
  return item.kind === "video" ? <VideoEditor item={item} /> : <PhotoEditor item={item} />;
}
export default function EditPage() { return <Suspense><EditInner /></Suspense>; }
`
  );
  fs.rmSync("src/app/edit/[id]", { recursive: true, force: true });
}

if (fs.existsSync("src/components/viewer.tsx")) {
  let viewerFile = fs.readFileSync("src/components/viewer.tsx", "utf8");
  viewerFile = viewerFile.replace("router.push(`/edit/${it.id}`)", "router.push(`/edit?id=${it.id}`)");
  fs.writeFileSync("src/components/viewer.tsx", viewerFile);
}

if (fs.existsSync("src/app/c/[slug]/page.tsx") && !fs.existsSync("src/app/c/[slug]/client.tsx")) {
  let cSrc = fs.readFileSync("src/app/c/[slug]/page.tsx", "utf8");
  cSrc = cSrc
    .replace(/import \{ Suspense, use \} from "react";/, 'import { Suspense } from "react";')
    .replace(/export default function CategoryPage[\s\S]*?const \{ slug \} = use\(params\);/, "export default function CategoryClient({ slug }: { slug: string }) {");
  fs.writeFileSync("src/app/c/[slug]/client.tsx", cSrc);
  fs.writeFileSync(
    "src/app/c/[slug]/page.tsx",
    `import CategoryClient from "./client";
export function generateStaticParams() {
  return ["photos","camera","screenshots","screenrec","videos","gifs","downloads","favorites","recent","edited","viewed","large","archived","range","place"].map((slug) => ({ slug }));
}
export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <CategoryClient slug={slug} />;
}
`
  );
}

if (fs.existsSync("src/app/discover/[type]/page.tsx") && !fs.existsSync("src/app/discover/[type]/client.tsx")) {
  let dSrc = fs.readFileSync("src/app/discover/[type]/page.tsx", "utf8");
  dSrc = dSrc
    .replace(/import \{ use, /, "import { ")
    .replace(/export default function Discover[\s\S]*?const \{ type \} = use\(params\);/, "export default function DiscoverClient({ type }: { type: string }) {");
  fs.writeFileSync("src/app/discover/[type]/client.tsx", dSrc);
  fs.writeFileSync(
    "src/app/discover/[type]/page.tsx",
    `import DiscoverClient from "./client";
export function generateStaticParams() {
  return ["duplicates","similar","calendar","timeline","map","places"].map((type) => ({ type }));
}
export default async function DiscoverPage({ params }: { params: Promise<{ type: string }> }) {
  const { type } = await params;
  return <DiscoverClient type={type} />;
}
`
  );
}
