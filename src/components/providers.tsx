"use client";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Plus, Check } from "lucide-react";
import { defaultSettings, type Settings } from "@/lib/defaults";
import { api, post, thumbUrl } from "@/lib/api";
import type { Album } from "@/lib/types";
import { Btn, Sheet } from "./ui";

type SettingsCtx = { s: Settings; ready: boolean; update: (p: Partial<Settings>) => void };
const SettingsContext = createContext<SettingsCtx>({ s: defaultSettings, ready: false, update: () => {} });
export const useSettings = () => useContext(SettingsContext);

export type PickResult = { albumId?: number; albumName?: string } | null;
type ToastOpts = { action?: { label: string; onClick: () => void }; ms?: number };
type Dialogs = {
  toast: (msg: string, o?: ToastOpts) => void;
  confirm: (o: { title: string; message?: string; confirmText?: string; danger?: boolean }) => Promise<boolean>;
  prompt: (o: { title: string; message?: string; value?: string; placeholder?: string; confirmText?: string; type?: "text" | "password" | "number" }) => Promise<string | null>;
  pickAlbum: (o?: { title?: string; excludeId?: number; userOnly?: boolean }) => Promise<PickResult>;
};
const DialogContext = createContext<Dialogs | null>(null);
export const useDialogs = () => useContext(DialogContext)!;

const ChromeContext = createContext<{ hideNav: boolean; setHideNav: (v: boolean) => void }>({ hideNav: false, setHideNav: () => {} });
export const useChrome = () => useContext(ChromeContext);

type Active =
  | { kind: "confirm"; o: Parameters<Dialogs["confirm"]>[0]; res: (v: boolean) => void }
  | { kind: "prompt"; o: Parameters<Dialogs["prompt"]>[0]; res: (v: string | null) => void }
  | { kind: "album"; o: NonNullable<Parameters<Dialogs["pickAlbum"]>[0]>; res: (v: PickResult) => void };

export function Providers({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Settings>(defaultSettings);
  const [ready, setReady] = useState(false);
  const [hideNav, setHideNav] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; action?: ToastOpts["action"] }[]>([]);
  const [active, setActive] = useState<Active | null>(null);
  const saveT = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<Partial<Settings>>({});

  const apply = useCallback((v: Settings) => {
    const h = document.documentElement;
    const dark = v.theme === "dark" || (v.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
    h.classList.toggle("dark", dark);
    h.style.setProperty("--accent", v.accent);
    h.style.setProperty("--glass-a", String(v.glass / 100));
    h.dataset.lowmem = v.lowMemory ? "1" : "0";
    h.dataset.anim = v.animations;
    h.style.setProperty("--cue-scale", String(v.subtitleSize / 100));
    h.style.setProperty("--cue-color", v.subtitleColor);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", v.accent);
  }, []);

  useEffect(() => {
    let cached: Partial<Settings> = {};
    try { cached = JSON.parse(localStorage.getItem("prism-settings") || "{}"); } catch { /* ignore */ }
    api<Settings>("/api/settings")
      .then((v) => { setS(v); apply(v); localStorage.setItem("prism-settings", JSON.stringify(v)); })
      .catch(() => { const v = { ...defaultSettings, ...cached }; setS(v); apply(v); })
      .finally(() => setReady(true));
    if ("serviceWorker" in navigator && location.protocol !== "file:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  }, [apply]);

  useEffect(() => {
    if (s.theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const f = () => apply(s);
    mq.addEventListener("change", f);
    return () => mq.removeEventListener("change", f);
  }, [s, apply]);

  const update = useCallback((p: Partial<Settings>) => {
    setS((prev) => {
      const next = { ...prev, ...p };
      apply(next);
      localStorage.setItem("prism-settings", JSON.stringify(next));
      return next;
    });
    pending.current = { ...pending.current, ...p };
    if (saveT.current) clearTimeout(saveT.current);
    saveT.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      api("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {});
    }, 350);
  }, [apply]);

  const dialogs = useMemo<Dialogs>(() => ({
    toast: (msg, o) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-2), { id, msg, action: o?.action }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), o?.ms ?? 3200);
    },
    confirm: (o) => new Promise((res) => setActive({ kind: "confirm", o, res })),
    prompt: (o) => new Promise((res) => setActive({ kind: "prompt", o, res })),
    pickAlbum: (o = {}) => new Promise((res) => setActive({ kind: "album", o, res })),
  }), []);

  const close = () => setActive(null);

  return (
    <SettingsContext.Provider value={{ s, ready, update }}>
      <ChromeContext.Provider value={{ hideNav, setHideNav }}>
        <DialogContext.Provider value={dialogs}>
          {children}
          <div className="pointer-events-none fixed inset-x-0 top-0 z-[120] flex flex-col items-center gap-2 px-4 safe-top">
            {toasts.map((t) => (
              <div key={t.id} className="glass-strong anim-pop pointer-events-auto flex max-w-sm items-center gap-3 rounded-full px-4 py-2.5 text-sm font-medium">
                <span>{t.msg}</span>
                {t.action && <button className="accent-text font-semibold" onClick={t.action.onClick}>{t.action.label}</button>}
              </div>
            ))}
          </div>
          {active?.kind === "confirm" && (
            <Sheet open onClose={() => { active.res(false); close(); }} title={active.o.title} z={110}>
              {active.o.message && <p className="muted mb-4 px-1 text-sm leading-relaxed">{active.o.message}</p>}
              <div className="flex gap-2">
                <Btn className="flex-1" onClick={() => { active.res(false); close(); }}>Cancel</Btn>
                <Btn className="flex-1" kind={active.o.danger ? "danger" : "accent"} onClick={() => { active.res(true); close(); }}>{active.o.confirmText ?? "Confirm"}</Btn>
              </div>
            </Sheet>
          )}
          {active?.kind === "prompt" && <PromptSheet a={active} close={close} />}
          {active?.kind === "album" && <AlbumPicker a={active} close={close} />}
        </DialogContext.Provider>
      </ChromeContext.Provider>
    </SettingsContext.Provider>
  );
}

function PromptSheet({ a, close }: { a: Extract<Active, { kind: "prompt" }>; close: () => void }) {
  const [v, setV] = useState(a.o.value ?? "");
  const done = (x: string | null) => { a.res(x); close(); };
  return (
    <Sheet open onClose={() => done(null)} title={a.o.title} z={110}>
      {a.o.message && <p className="muted mb-3 px-1 text-sm">{a.o.message}</p>}
      <form onSubmit={(e) => { e.preventDefault(); done(v); }}>
        <input autoFocus type={a.o.type ?? "text"} inputMode={a.o.type === "number" ? "numeric" : undefined} value={v} placeholder={a.o.placeholder} onChange={(e) => setV(e.target.value)} />
        <div className="mt-4 flex gap-2">
          <Btn className="flex-1" onClick={() => done(null)}>Cancel</Btn>
          <Btn className="flex-1" kind="accent" type="submit">{a.o.confirmText ?? "OK"}</Btn>
        </div>
      </form>
    </Sheet>
  );
}

function AlbumPicker({ a, close }: { a: Extract<Active, { kind: "album" }>; close: () => void }) {
  const [albums, setAlbums] = useState<Album[] | null>(null);
  const [name, setName] = useState("");
  useEffect(() => { api<Album[]>("/api/albums").then(setAlbums).catch(() => setAlbums([])); }, []);
  const done = (r: PickResult) => { a.res(r); close(); };
  const list = (albums ?? []).filter((x) => x.id !== a.o.excludeId && (!a.o.userOnly || x.kind === "user"));
  return (
    <Sheet open onClose={() => done(null)} title={a.o.title ?? "Choose album"} z={110} tall>
      <form className="mb-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) done({ albumName: name.trim() }); }}>
        <input type="text" placeholder="New album name" value={name} onChange={(e) => setName(e.target.value)} />
        <Btn kind="accent" type="submit" disabled={!name.trim()}><Plus size={16} />Create</Btn>
      </form>
      <div className="space-y-1.5">
        {list.map((al) => (
          <button key={al.id} onClick={() => done({ albumId: al.id })} className="card press flex w-full items-center gap-3 rounded-2xl p-2 text-left">
            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-black/10">
              {al.coverId && <img src={thumbUrl({ id: al.coverId, modifiedAt: new Date(al.coverV * 1000).toISOString(), vaulted: false })} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1"><div className="truncate font-medium">{al.name}</div><div className="muted text-xs">{al.count} items</div></div>
            <Check size={16} className="opacity-0" />
          </button>
        ))}
        {albums && !list.length && <p className="muted p-4 text-center text-sm">No albums yet — create one above.</p>}
      </div>
    </Sheet>
  );
}

export { post };
