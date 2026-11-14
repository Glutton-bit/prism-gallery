"use client";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, Heart, ImageOff, Play, Circle } from "lucide-react";
import type { Item } from "@/lib/types";
import { thumbUrl, ensureThumb } from "@/lib/api";
import { isNativeAndroid } from "@/components/storage-gate";
import { fmtDur, groupLabel } from "@/lib/format";

type CellProps = { it: Item; idx: number; selecting: boolean; selected: boolean; badge?: string };
const Cell = memo(function Cell({ it, idx, selecting, selected, badge }: CellProps) {
  const [err, setErr] = useState(false);
  const native = isNativeAndroid();
  const [src, setSrc] = useState<string | null>(() => (native ? null : thumbUrl(it)));
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!native) return;
    const el = ref.current;
    if (!el) return;
    let alive = true;
    const io = new IntersectionObserver((es) => {
      if (!es[0].isIntersecting) return;
      io.disconnect();
      ensureThumb(it).then((u) => { if (alive && u) { setErr(false); setSrc(u); } });
    }, { rootMargin: "800px" });
    io.observe(el);
    return () => { alive = false; io.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [it.id, native]);
  return (
    <button ref={ref} data-idx={idx} aria-label={it.name} className="relative block aspect-square w-full select-none overflow-hidden bg-black/10 text-left dark:bg-white/10" style={{ WebkitTouchCallout: "none" }}>
      <div className={`h-full w-full transition-transform duration-150 ${selected ? "scale-[0.86] rounded-xl" : ""} overflow-hidden`}>
        {err || !it.width && it.kind === "image" ? (
          <div className="grid h-full w-full place-items-center muted"><ImageOff size={22} /><span className="absolute bottom-6 text-[10px] font-semibold uppercase">{it.format}</span></div>
        ) : src ? (
          <img src={src} alt="" loading="lazy" decoding="async" draggable={false} onError={() => setErr(true)} className="pointer-events-none h-full w-full object-cover" />
        ) : null}
      </div>
      {it.kind === "video" && (
        <span className="on-media pointer-events-none absolute bottom-1 right-1 flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-semibold"><Play size={9} fill="currentColor" />{fmtDur(it.durationMs)}</span>
      )}
      {it.kind === "image" && (it.animated || it.format === "gif") && <span className="on-media pointer-events-none absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold">{it.format === "gif" ? "GIF" : "ANIM"}</span>}
      {it.kind === "image" && it.format === "avif" && !it.animated && <span className="on-media pointer-events-none absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[10px] font-bold">AVIF</span>}
      {badge && <span className="on-media pointer-events-none absolute left-1 top-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold">{badge}</span>}
      {it.favorite && <Heart size={14} fill="#ff453a" className="pointer-events-none absolute bottom-1.5 left-1.5 text-[#ff453a] drop-shadow" />}
      {selecting && (
        <span className="pointer-events-none absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full">
          {selected ? <span className="accent-bg grid h-6 w-6 place-items-center rounded-full border-2 border-white shadow"><Check size={14} strokeWidth={3} /></span> : <Circle size={24} className="text-white drop-shadow" strokeWidth={2} />}
        </span>
      )}
    </button>
  );
});

type Props = {
  items: Item[];
  cols: number;
  gap: number;
  group: string; // none | day | month | year
  selecting: boolean;
  selected: Set<number>;
  dragHoldMs: number;
  onOpen: (i: number) => void;
  onToggle: (id: number) => void;
  onSetMany: (ids: number[], on: boolean) => void;
  onEnter: (id: number) => void;
  badge?: (it: Item) => string | undefined;
};

export function MediaGrid({ items, cols, gap, group, selecting, selected, dragHoldMs, onOpen, onToggle, onSetMany, onEnter, badge }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [armedHint, setArmedHint] = useState(false);
  const live = useRef({ items, selected, selecting, dragHoldMs });
  live.current = { items, selected, selecting, dragHoldMs };
  const g = useRef({ t1: 0 as unknown as ReturnType<typeof setTimeout>, t2: 0 as unknown as ReturnType<typeof setTimeout>, x: 0, y: 0, lx: 0, ly: 0, idx: -1, armed: false, long: false, mode: "select" as "select" | "deselect", last: -1, suppress: false, raf: 0, pid: -1, vy: 0 });

  const groups = useMemo(() => {
    if (group === "none") return [{ label: "", idxs: items.map((_, i) => i) }];
    const out: { label: string; idxs: number[] }[] = [];
    items.forEach((it, i) => {
      const label = groupLabel(it.takenAt, group);
      const last = out[out.length - 1];
      if (last && last.label === label) last.idxs.push(i);
      else out.push({ label, idxs: [i] });
    });
    return out;
  }, [items, group]);

  const hitIdx = useCallback((x: number, y: number) => {
    const el = document.elementFromPoint(x, y)?.closest("[data-idx]") as HTMLElement | null;
    return el ? Number(el.dataset.idx) : -1;
  }, []);
  const applyIdx = useCallback((i: number) => {
    const it = live.current.items[i];
    if (!it || g.current.last === i) return;
    g.current.last = i;
    onSetMany([it.id], g.current.mode === "select");
  }, [onSetMany]);
  const clearTimers = () => { clearTimeout(g.current.t1); clearTimeout(g.current.t2); };
  const finish = useCallback(() => {
    const s = g.current;
    clearTimers();
    cancelAnimationFrame(s.raf);
    if (s.armed || s.long) { s.suppress = true; setTimeout(() => (s.suppress = false), 80); }
    s.armed = false; s.long = false; s.idx = -1; s.last = -1; s.vy = 0;
    setArmedHint(false);
  }, []);

  const sweep = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / 10));
    for (let k = 1; k <= steps; k++) {
      const i = hitIdx(x0 + ((x1 - x0) * k) / steps, y0 + ((y1 - y0) * k) / steps);
      if (i >= 0) applyIdx(i);
    }
  }, [hitIdx, applyIdx]);

  const autoScroll = useCallback(() => {
    const s = g.current;
    if (!s.armed) return;
    const h = window.innerHeight;
    s.vy = s.ly < 110 ? -Math.min(22, (110 - s.ly) / 4 + 4) : s.ly > h - 130 ? Math.min(22, (s.ly - (h - 130)) / 4 + 4) : 0;
    if (s.vy) { window.scrollBy(0, s.vy); const i = hitIdx(s.lx, s.ly); if (i >= 0) applyIdx(i); }
    s.raf = requestAnimationFrame(autoScroll);
  }, [hitIdx, applyIdx]);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const block = (e: TouchEvent) => { if (g.current.armed) e.preventDefault(); };
    el.addEventListener("touchmove", block, { passive: false });
    const noMenu = (e: Event) => e.preventDefault();
    el.addEventListener("contextmenu", noMenu);
    return () => { el.removeEventListener("touchmove", block); el.removeEventListener("contextmenu", noMenu); clearTimers(); cancelAnimationFrame(g.current.raf); };
  }, []);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const i = hitIdx(e.clientX, e.clientY);
    if (i < 0) return;
    const s = g.current;
    clearTimers();
    s.x = s.lx = e.clientX; s.y = s.ly = e.clientY; s.idx = i; s.armed = false; s.long = false; s.last = -1;
    const it = live.current.items[i];
    const wasSel = live.current.selected.has(it.id);
    const wasSelecting = live.current.selecting;
    s.t1 = setTimeout(() => {
      s.long = true;
      if (!live.current.selecting) { onEnter(it.id); navigator.vibrate?.(18); }
    }, 380);
    s.t2 = setTimeout(() => {
      s.armed = true; s.long = true;
      s.mode = wasSelecting && wasSel ? "deselect" : "select";
      if (!live.current.selecting || s.mode === "select") { if (!live.current.selected.has(it.id)) onSetMany([it.id], true); }
      else onSetMany([it.id], false);
      s.last = i;
      navigator.vibrate?.([12, 40, 12]);
      setArmedHint(true);
      s.raf = requestAnimationFrame(autoScroll);
    }, wasSelecting ? 350 : live.current.dragHoldMs);
  };
  const move = (e: React.PointerEvent) => {
    const s = g.current;
    if (s.idx < 0) return;
    if (!s.armed) {
      if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 10) clearTimers();
      return;
    }
    sweep(s.lx, s.ly, e.clientX, e.clientY);
    s.lx = e.clientX; s.ly = e.clientY;
  };
  const click = (e: React.MouseEvent) => {
    if (g.current.suppress) return;
    const el = (e.target as HTMLElement).closest("[data-idx]") as HTMLElement | null;
    if (!el) return;
    const i = Number(el.dataset.idx);
    const it = live.current.items[i];
    if (!it) return;
    if (live.current.selecting) onToggle(it.id);
    else onOpen(i);
  };

  return (
    <div ref={root} onPointerDown={down} onPointerMove={move} onPointerUp={finish} onPointerCancel={finish} onClick={click}
      style={{ touchAction: "pan-y", userSelect: "none", WebkitUserSelect: "none" }}>
      {armedHint && <div className="on-media anim-pop fixed left-1/2 top-24 z-50 -translate-x-1/2 rounded-full px-4 py-2 text-sm font-semibold">Drag across items to select · release to finish</div>}
      {groups.map((gr, gi) => (
        <section key={gr.label + gi} className="grid-section mb-1">
          {gr.label && (
            <div className="flex items-center justify-between px-4 pb-1.5 pt-3">
              <h3 className="text-[15px] font-semibold">{gr.label}</h3>
              {selecting && (
                <button className="accent-text text-xs font-semibold" onClick={() => {
                  const ids = gr.idxs.map((i) => items[i].id);
                  onSetMany(ids, !ids.every((id) => selected.has(id)));
                }}>{gr.idxs.every((i) => selected.has(items[i].id)) ? "Deselect" : "Select"} all</button>
              )}
            </div>
          )}
          <div className="grid" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`, gap }}>
            {gr.idxs.map((i) => <Cell key={items[i].id} it={items[i]} idx={i} selecting={selecting} selected={selected.has(items[i].id)} badge={badge?.(items[i])} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
