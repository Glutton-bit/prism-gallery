# Prism Gallery — liquid-glass gallery (installable PWA)

> **Important – what this is and isn't.** The build environment for this project has no Android SDK / JDK / Gradle and
> runs a Next.js + PostgreSQL stack, so a native **APK could not be produced or tested**. Instead this is a complete,
> working gallery delivered as an installable **Progressive Web App** (Chrome on Android → ⋮ → *Install app*), with an
> offline app shell + thumbnail cache. Anything that genuinely requires native Android is listed under *Limits*.

## Run
```
npm install
npx drizzle-kit push      # creates tables (needs DATABASE_URL in .env)
npm run build && npm start
```
Open the URL on the phone in Chrome → **Install app**. Media is stored in `.data/media` (override with `GALLERY_DATA_DIR`).

## Getting photos in
Home → ＋ → *Choose a folder* → pick `DCIM` (or `Camera`). Folder identity comes from the real path
(`DCIM/Camera` ⇒ Camera folder, `Pictures/Screenshots`, `WhatsApp/Media/WhatsApp Images`, `Telegram`, `Bluetooth`, `Download` …).
Each sub-folder becomes an album. Settings → Gallery → *Camera folder* lets you choose a different folder.

## Implemented
- **Home = Camera folder only** (enforced server-side by album identity, not by filename). Empty-state with *Select Camera folder*.
- **Albums**: every discovered folder + user albums, create/rename/delete (items go to Trash), covers, hide/unhide, pin (persisted, drag-reorderable), custom order, multi-select, 6 layouts, spacing, move/copy/add/remove.
- **Sorting** (photo / video / album sets) remembered per section and per album.
- **Selection**: tap, long-press, select all / invert / none, group select, **hold ~2 s (configurable) then drag** to select / deselect, auto-scroll.
- **Viewer**: pinch, double-tap, pan, swipe, drag-down to close, info/EXIF, favourite, share, delete, rotate (+save), convert to JPEG/PNG, slideshow, open-with / wallpaper through the share sheet, **Xiaomi-style HD preview** (a preview is generated at import for large/odd files; double-tap offers *Preview HD* only when a higher-resolution original exists).
- **AVIF**: browser decoder first; otherwise a **bundled libavif/dav1d WebAssembly decoder** (`/public/codecs/avif_dec.wasm`) for thumbnails, previews, zoom, HD view, editing and JPEG/PNG conversion.
- **Video player**: right-side swipe volume, left-side swipe brightness, centre double-tap pause/resume, horizontal drag seek with time readout, hold = 2× (configurable), speeds 0.25–2×, scrub bar, skip, fullscreen, rotate lock, PiP, SRT/VTT subtitles, audio-track menu (when the engine exposes tracks), lock, per-video resume, info.
- **Photo editor**: crop (aspect presets), rotate, flip, straighten, perspective, 14 adjustments, 18 filters with intensity, draw / marker / shapes / blur brush, text, stickers, frames, blur, background blur (elliptical focus), red-eye, before/after, undo/redo/reset, export format/quality/resolution, save as copy or replace.
- **Video editor**: trim with draggable handles + fine nudges, split, cut, crop/zoom/pan, aspect, rotate, brightness/contrast/saturation, filters, timed text, music, volume/mute, speed, extract frame, export (real-time re-encode to WebM, saved as a copy).
- **Private folder**: PIN or password, scrypt-derived key wraps a random master key, **AES-256-GCM** encrypted files + thumbnails, auto-lock, brute-force back-off, hidden from albums/search/categories/thumbnails, restore, optional hidden entry.
- **Trash**: restore (single/multi/all), permanent delete with confirmation, empty, deletion date, original album, days remaining, configurable retention (default 30 days), automatic expiry, photo/video filters.
- **Google-Photos-style**: favourites, memories, recently added/viewed/edited, archive, calendar, timeline, offline map, places, duplicates (SHA-1) and similar photos (perceptual hash) with keep/remove review, screenshots / videos / GIF / large-file / download categories, search by name, date, month, year, album, place, format, size, resolution, fav, video, screenshot.
- Settings pages for every area; every control is wired (theme, accent, glass opacity, animation level, grid, thumbnail quality, low-memory mode, gestures, editor defaults, retention, auto-lock …).
- Performance: paged API (120 items/page, 60 in low-memory mode), lazy `<img>`, `content-visibility`, small WebP thumbnails, immutable service-worker cache, optional glass-blur removal.

## Limits (be aware)
- **No APK** (see top). A PWA cannot scan MediaStore/SAF, delete or edit files in place on the phone, set system wallpaper or system brightness, use BiometricPrompt, or run Media3. Video brightness is in-app dimming; wallpaper goes through the share sheet; biometric unlock is *not* offered.
- **HEIC/HEIF** cannot be decoded by Chrome; such files are stored and can be shared but have no thumbnail/preview.
- **People/face grouping** and cloud backup/AI are **not implemented**. The map is an offline world grid (no tiles).
- Video export is real-time WebM re-encoding on the device; keep the screen on. Large vault videos are decrypted in server memory when played.
- Multiple audio-track switching depends on the browser exposing `audioTracks`.
- Not tested on a physical Redmi 9C / Android 10 (none available here); API behaviour was smoke-tested against the running server.
