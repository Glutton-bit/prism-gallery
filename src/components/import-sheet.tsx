"use client";
import { useRef, useState } from "react";
import { FileImage, FolderOpen, Sparkles } from "lucide-react";
import { generateSamples, importFiles } from "@/lib/imaging";
import { useDialogs, useSettings } from "./providers";
import { Btn, Sheet } from "./ui";

const ACCEPT = "image/*,video/*,.avif,.heic,.heif,.mkv,.3gp,.webm";

export function ImportSheet({ open, onClose, albumId, albumName, onDone, showSamples = true }: { open: boolean; onClose: () => void; albumId?: number; albumName?: string; onDone: () => void; showSamples?: boolean }) {
  const { s } = useSettings();
  const d = useDialogs();
  const files = useRef<HTMLInputElement>(null);
  const folder = useRef<HTMLInputElement>(null);
  const [prog, setProg] = useState<{ done: number; total: number } | null>(null);
  const [target, setTarget] = useState<{ albumId?: number; albumName?: string } | null>(albumId ? { albumId, albumName } : null);

  const run = async (list: File[], usePaths: boolean) => {
    if (!list.length) return;
    setProg({ done: 0, total: list.length });
    const r = await importFiles(list, s, { ...(target ?? {}), usePaths: usePaths && !target }, (done, total) => setProg({ done, total }));
    setProg(null);
    d.toast(`Imported ${r.ok} item${r.ok === 1 ? "" : "s"}${r.failed.length ? ` · ${r.failed.length} failed` : ""}${r.skipped ? ` · ${r.skipped} non-media skipped` : ""}`);
    onDone();
    onClose();
  };
  const choose = async () => {
    const r = await d.pickAlbum({ title: "Import into album" });
    if (r) setTarget(r.albumId ? { albumId: r.albumId } : { albumName: r.albumName });
    return r;
  };

  return (
    <Sheet open={open} onClose={() => !prog && onClose()} title="Import photos & videos">
      {prog ? (
        <div className="py-6 text-center">
          <div className="mb-3 text-sm font-medium">Importing {prog.done} / {prog.total}…</div>
          <div className="mx-auto h-2 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15"><div className="h-full rounded-full bg-[var(--accent)] transition-all" style={{ width: `${(prog.done / prog.total) * 100}%` }} /></div>
          <p className="muted mt-3 text-xs">Thumbnails, EXIF and AVIF decoding happen on-device. Keep the app open.</p>
        </div>
      ) : (
        <div className="space-y-3 pb-2">
          <p className="muted px-1 text-sm leading-relaxed">A browser-based app can’t scan the phone’s storage by itself — pick files or whole folders (e.g. <b>DCIM/Camera</b>) and they’re imported with folder identification from the real path.</p>
          <div className="card rounded-2xl p-3 text-sm">
            <div className="muted mb-1 text-xs font-semibold uppercase tracking-wide">Destination</div>
            {target ? (
              <div className="flex items-center justify-between"><span className="font-medium">{target.albumName ?? "Selected album"}</span>{!albumId && <button className="accent-text font-semibold" onClick={() => setTarget(null)}>Auto by folder</button>}</div>
            ) : (
              <div className="flex items-center justify-between"><span className="font-medium">Auto — use each file’s folder</span><button className="accent-text font-semibold" onClick={choose}>Choose album</button></div>
            )}
          </div>
          <input ref={files} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; run(l, false); }} />
          <input ref={folder} type="file" multiple hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; run(l, true); }}
            {...({ webkitdirectory: "", directory: "" } as Record<string, string>)} />
          <Btn kind="accent" className="w-full" onClick={() => files.current?.click()}><FileImage size={18} />Choose files</Btn>
          <Btn className="w-full" onClick={() => folder.current?.click()}><FolderOpen size={18} />Choose a folder (subfolders become albums)</Btn>
          {showSamples && (
            <Btn className="w-full" onClick={async () => { setProg({ done: 0, total: 1 }); await generateSamples(s, (done, total) => setProg({ done, total })); setProg(null); onDone(); onClose(); d.toast("Sample library created"); }}>
              <Sparkles size={18} />Generate offline sample photos
            </Btn>
          )}
        </div>
      )}
    </Sheet>
  );
}
