/* Prism Gallery service worker: offline app shell + immutable thumbnail/preview cache (LRU-ish). */
const SHELL = "prism-shell-v1";
const THUMBS = "prism-thumbs-v1";
const MAX_THUMBS = 1500;

self.addEventListener("install", (e) => { self.skipWaiting(); });
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => ![SHELL, THUMBS].includes(k)).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

async function trim(cache) {
  const keys = await cache.keys();
  if (keys.length > MAX_THUMBS) for (const k of keys.slice(0, keys.length - MAX_THUMBS)) await cache.delete(k);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (req.headers.get("range")) return;
  // Immutable thumbnails & previews: cache-first
  if (/^\/api\/media\/\d+\/file$/.test(url.pathname) && url.searchParams.has("t") && url.searchParams.get("v") !== "orig") {
    e.respondWith((async () => {
      const cache = await caches.open(THUMBS);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) { cache.put(req, res.clone()); trim(cache); }
      return res;
    })());
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/codecs/") || /\.(png|webmanifest)$/.test(url.pathname)) {
    e.respondWith((async () => {
      const cache = await caches.open(SHELL);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) cache.put(req, res.clone());
      return res;
    })());
    return;
  }
  if (req.mode === "navigate") {
    e.respondWith((async () => {
      try {
        const res = await fetch(req);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
      } catch {
        const hit = await caches.match(req);
        return hit || new Response("Offline", { status: 503 });
      }
    })());
  }
});
