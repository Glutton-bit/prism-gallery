"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, KeyRound, Lock, LockOpen, Plus, ShieldCheck } from "lucide-react";
import { MediaBrowser } from "@/components/media-browser";
import { vaultStatus, type VaultStatus } from "@/components/actions";
import { useDialogs, useSettings } from "@/components/providers";
import { Btn, IconBtn, Segmented, Spinner } from "@/components/ui";
import { batch, post } from "@/lib/api";
import { isMediaName, uploadOne } from "@/lib/imaging";

export default function VaultPage() {
  const d = useDialogs();
  const { s } = useSettings();
  const router = useRouter();
  const [st, setSt] = useState<VaultStatus | null>(null);
  const [authType, setAuthType] = useState<"pin" | "password">("pin");
  const [secret, setSecret] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [sig, setSig] = useState(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const refresh = useCallback(() => vaultStatus().then(setSt).catch(() => {}), []);
  useEffect(() => { refresh(); }, [refresh]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!st) return;
    setBusy(true);
    try {
      if (!st.configured) {
        if (secret !== again) throw new Error("Entries do not match");
        await post("/api/vault", { action: "setup", authType, secret });
      } else await post("/api/vault", { action: "unlock", authType: st.authType, secret });
      setSecret(""); setAgain("");
      await refresh();
    } catch (err) { d.toast((err as Error).message); }
    setBusy(false);
  };
  const lock = async () => { await post("/api/vault", { action: "lock" }); await refresh(); };
  const addFiles = async (files: File[]) => {
    const list = files.filter((f) => isMediaName(f.name));
    if (!list.length) return;
    d.toast(`Adding ${list.length} file${list.length > 1 ? "s" : ""}…`);
    const ids: number[] = [];
    for (const f of list) { try { ids.push((await uploadOne(f, s, { albumName: "Private imports" })).id); } catch { /* skip */ } }
    if (ids.length) { try { await batch("hide", ids); } catch (e) { d.toast((e as Error).message); } }
    setSig((x) => x + 1);
  };

  if (!st) return <div className="grid min-h-dvh place-items-center muted"><Spinner /></div>;

  if (!st.unlocked) {
    const setup = !st.configured;
    const type = setup ? authType : st.authType;
    return (
      <div className="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-6 pb-24 anim-fade">
        <div className="glass-strong rounded-[32px] p-6 text-center">
          <div className="accent-bg mx-auto mb-4 grid h-16 w-16 place-items-center rounded-3xl">{setup ? <ShieldCheck size={30} /> : <Lock size={30} />}</div>
          <h1 className="text-2xl font-bold">{setup ? "Create private folder" : "Private folder"}</h1>
          <p className="muted mt-1.5 text-sm">{setup ? "The Private folder isn’t available in this version yet. Secure encryption hasn’t been built, so nothing you hide here would be protected." : `Enter your ${type === "pin" ? "PIN" : "password"} to unlock.`}</p>
          <form onSubmit={submit} className="mt-5 space-y-3 text-left">
            {setup && <Segmented value={authType} onChange={setAuthType} options={[{ v: "pin", label: "PIN" }, { v: "password", label: "Password" }]} />}
            <input autoFocus type="password" inputMode={type === "pin" ? "numeric" : "text"} placeholder={type === "pin" ? "PIN (4–8 digits)" : "Password (6+ characters)"} value={secret} onChange={(e) => setSecret(e.target.value)} />
            {setup && <input type="password" inputMode={type === "pin" ? "numeric" : "text"} placeholder="Repeat" value={again} onChange={(e) => setAgain(e.target.value)} />}
            <Btn kind="accent" type="submit" className="w-full" disabled={busy || !secret || setup}>{busy ? "Please wait…" : setup ? "Not available yet" : "Unlock"}</Btn>
          </form>
          <button disabled className="muted mt-4 flex w-full items-center justify-center gap-2 text-xs opacity-70"><Fingerprint size={14} />Biometric unlock isn’t available yet</button>
        </div>
        <button className="muted mt-5 text-sm" onClick={() => router.back()}>Back</button>
      </div>
    );
  }

  return (
    <>
      <MediaBrowser scope="hidden" mode="vault" title="Private" subtitle="Private" prefKey="vault" back canImport={false} reloadSignal={sig} onLocked={refresh}
        headerRight={<><IconBtn label="Add files" onClick={() => fileRef.current?.click()}><Plus size={18} /></IconBtn><IconBtn label="Lock now" onClick={lock}><LockOpen size={18} /></IconBtn></>} />
      <input ref={fileRef} type="file" multiple accept="image/*,video/*,.avif,.heic" hidden onChange={(e) => { const l = Array.from(e.target.files ?? []); e.target.value = ""; addFiles(l); }} />
      <div className="muted pointer-events-none fixed bottom-24 left-0 right-0 z-10 flex justify-center text-[11px]"><span className="flex items-center gap-1"><KeyRound size={11} />Auto-locks after {s.autoLock ? `${s.autoLock} min idle` : "you close the app"}</span></div>
    </>
  );
}
