export type UploadMeta = {
  name: string; mime: string; format: string; kind: "image" | "video";
  width: number; height: number; previewWidth: number; previewHeight: number;
  durationMs: number; animated: boolean; takenAt: string | null;
  lat: number | null; lng: number | null; place: string | null; camera: string | null;
  exif: Record<string, unknown> | null; phash: string; sourcePath: string | null;
  albumId: number | null; albumName: string; albumPath: string | null; hint?: string;
  replaceId: number | null; edited: boolean;
};

export function getUploadMeta(raw: FormDataEntryValue | null): UploadMeta {
  let j: Partial<UploadMeta> = {};
  try { j = JSON.parse(String(raw ?? "{}")); } catch { /* ignore */ }
  const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? Math.round(v) : 0);
  const fl = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);
  return {
    name: String(j.name ?? "file").slice(0, 255),
    mime: String(j.mime ?? "application/octet-stream"),
    format: String(j.format ?? "bin").toLowerCase(),
    kind: j.kind === "video" ? "video" : "image",
    width: num(j.width), height: num(j.height),
    previewWidth: num(j.previewWidth), previewHeight: num(j.previewHeight),
    durationMs: num(j.durationMs), animated: !!j.animated,
    takenAt: j.takenAt ? String(j.takenAt) : null,
    lat: fl(j.lat), lng: fl(j.lng),
    place: j.place ? String(j.place) : null,
    camera: j.camera ? String(j.camera).slice(0, 120) : null,
    exif: j.exif && typeof j.exif === "object" ? (j.exif as Record<string, unknown>) : null,
    phash: String(j.phash ?? "").slice(0, 32),
    sourcePath: j.sourcePath ? String(j.sourcePath).slice(0, 500) : null,
    albumId: j.albumId ? Number(j.albumId) : null,
    albumName: String(j.albumName ?? ""),
    albumPath: j.albumPath ? String(j.albumPath) : null,
    hint: j.hint ? String(j.hint) : undefined,
    replaceId: j.replaceId ? Number(j.replaceId) : null,
    edited: !!j.edited,
  };
}
