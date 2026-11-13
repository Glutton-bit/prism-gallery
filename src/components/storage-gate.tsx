"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Capacitor, registerPlugin } from "@capacitor/core";
import type { Album, Item } from "@/lib/types";

export interface StorageStatus {
  mediaGranted: boolean;
  allFilesGranted: boolean;
  sdkInt: number;
}

export interface PrismStoragePluginType {
  checkStorage(): Promise<StorageStatus>;
  requestStorage(): Promise<StorageStatus>;
  openAllFilesAccess(): Promise<StorageStatus>;
  scanMedia(): Promise<{ items: Item[]; albums: Album[] }>;
  getThumb(opts: { id: number; kind: string; sourcePath: string | null }): Promise<{ path: string | null }>;
  deleteFile(opts: { id: number; kind: string; sourcePath: string | null }): Promise<{ ok: boolean }>;
}

export const PrismStorage = registerPlugin<PrismStoragePluginType>("PrismStorage");

export function isNativeAndroid(): boolean {
  return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
}

export function StorageGate({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    if (!isNativeAndroid()) return;
    try {
      const s = await PrismStorage.checkStorage();
      setStatus(s);
    } catch {
      setStatus({ mediaGranted: true, allFilesGranted: true, sdkInt: 0 });
    }
  }, []);

  useEffect(() => {
    if (!isNativeAndroid()) {
      setStatus({ mediaGranted: true, allFilesGranted: true, sdkInt: 0 });
      return;
    }

    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
    }

    let active = true;
    (async () => {
      try {
        let s = await PrismStorage.checkStorage();
        if (!s.mediaGranted) {
          s = await PrismStorage.requestStorage();
        }
        if (active) setStatus(s);
      } catch {
        if (active) setStatus({ mediaGranted: true, allFilesGranted: true, sdkInt: 0 });
      }
    })();

    const onReturn = () => {
      if (document.visibilityState === "visible") refresh();
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("focus", refresh);

    return () => {
      active = false;
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  if (!status) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-sm opacity-70">
        Checking storage permissions...
      </div>
    );
  }

  if (!status.mediaGranted) {
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center">
        <div className="max-w-sm space-y-4">
          <h1 className="text-xl font-semibold">Storage Access Required</h1>
          <p className="text-sm opacity-75">
            Prism Gallery needs permission to view your photos and videos on this device.
          </p>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  setStatus(await PrismStorage.requestStorage());
                } finally {
                  setBusy(false);
                }
              }}
              className="rounded-xl bg-blue-500 px-4 py-3 text-sm font-semibold text-white"
            >
              Allow Photo &amp; Video Access
            </button>
            <button
              type="button"
              onClick={() => PrismStorage.openAllFilesAccess()}
              className="rounded-xl border border-white/20 px-4 py-3 text-sm"
            >
              Open App Settings
            </button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
  }
