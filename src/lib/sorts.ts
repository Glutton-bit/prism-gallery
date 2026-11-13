export type SortOpt = { key: string; label: string };
export const PHOTO_SORTS: SortOpt[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "taken", label: "Date taken" },
  { key: "modified", label: "Recently modified" },
  { key: "added", label: "Recently added" },
  { key: "largest", label: "Largest file" },
  { key: "smallest", label: "Smallest file" },
  { key: "nameaz", label: "Name A–Z" },
  { key: "nameza", label: "Name Z–A" },
  { key: "resolution", label: "Resolution" },
  { key: "custom", label: "Custom order" },
];
export const VIDEO_SORTS: SortOpt[] = [
  { key: "newest", label: "Newest first" },
  { key: "oldest", label: "Oldest first" },
  { key: "longest", label: "Longest duration" },
  { key: "shortest", label: "Shortest duration" },
  { key: "largest", label: "Largest file" },
  { key: "smallest", label: "Smallest file" },
  { key: "nameaz", label: "Name A–Z" },
  { key: "nameza", label: "Name Z–A" },
];
export const MIXED_SORTS: SortOpt[] = [
  ...PHOTO_SORTS.filter((s) => s.key !== "custom"),
  { key: "longest", label: "Longest video" },
  { key: "shortest", label: "Shortest video" },
];
export const ALBUM_SORTS: SortOpt[] = [
  { key: "nameaz", label: "Name A–Z" },
  { key: "nameza", label: "Name Z–A" },
  { key: "created", label: "Recently created" },
  { key: "modified", label: "Recently modified" },
  { key: "most", label: "Most items" },
  { key: "fewest", label: "Fewest items" },
  { key: "pinned", label: "Pinned first" },
  { key: "custom", label: "Custom order" },
];
export const DATE_SORTS = new Set(["newest", "oldest", "taken", "modified", "added", "viewed", "edited", "trashed"]);
