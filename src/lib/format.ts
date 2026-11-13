export function fmtSize(b: number) {
  if (!b) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(Math.floor(Math.log(b) / Math.log(1024)), u.length - 1);
  return `${(b / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
}
export function fmtDur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}
export function fmtClock(sec: number) {
  if (!isFinite(sec)) return "0:00";
  return fmtDur(sec * 1000);
}
export const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
export const fmtDateTime = (d: string | Date) =>
  new Date(d).toLocaleString("en", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" });

export function groupLabel(iso: string, mode: string) {
  const d = new Date(iso);
  if (mode === "year") return String(d.getFullYear());
  if (mode === "month") return d.toLocaleDateString("en", { month: "long", year: "numeric" });
  const now = new Date();
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  const y = new Date(now.getTime() - 86400000);
  if (same(d, now)) return "Today";
  if (same(d, y)) return "Yesterday";
  return d.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric", ...(d.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}) });
}
export function daysLeft(trashedAt: string, retention: number) {
  const left = new Date(trashedAt).getTime() + retention * 86400000 - Date.now();
  return Math.max(0, Math.ceil(left / 86400000));
}
export const dedupeName = (name: string) => name.replace(/(\.[^.]+)$/, "_edit$1");
