"use client";
import { useEffect, type ReactNode, type CSSProperties } from "react";
import { X } from "lucide-react";

export function Sheet({ open, onClose, title, children, tall, z = 70 }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; tall?: boolean; z?: number }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 flex items-end justify-center anim-fade" style={{ zIndex: z }}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className={`glass-strong anim-sheet relative w-full max-w-xl rounded-t-[28px] px-4 pt-3 pb-4 safe-bottom ${tall ? "h-[82dvh]" : "max-h-[86dvh]"} flex flex-col`}>
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-black/20 dark:bg-white/25" />
        {title && (
          <div className="mb-2 flex items-center justify-between px-1">
            <h2 className="text-lg font-semibold">{title}</h2>
            <button className="glass press grid h-8 w-8 place-items-center rounded-full" onClick={onClose} aria-label="Close"><X size={16} /></button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto no-scrollbar">{children}</div>
      </div>
    </div>
  );
}

export function IconBtn({ children, onClick, label, active, className = "", style, disabled }: { children: ReactNode; onClick?: () => void; label: string; active?: boolean; className?: string; style?: CSSProperties; disabled?: boolean }) {
  return (
    <button aria-label={label} title={label} disabled={disabled} onClick={onClick} style={style}
      className={`press glass grid h-10 w-10 shrink-0 place-items-center rounded-full disabled:opacity-40 ${active ? "!bg-[var(--accent)] !text-white" : ""} ${className}`}>
      {children}
    </button>
  );
}

export function Chip({ children, active, onClick, className = "" }: { children: ReactNode; active?: boolean; onClick?: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={`press shrink-0 rounded-full px-3.5 py-1.5 text-sm font-medium ${active ? "accent-bg" : "glass"} ${className}`}>{children}</button>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={checked} onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full transition-colors ${checked ? "bg-[var(--accent)]" : "bg-black/20 dark:bg-white/20"}`}>
      <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${checked ? "left-[22px]" : "left-0.5"}`} />
    </button>
  );
}

export function Slider({ value, min, max, step = 1, onChange, onCommit }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; onCommit?: () => void }) {
  const p = ((value - min) / (max - min)) * 100;
  return (
    <input type="range" min={min} max={max} step={step} value={value} style={{ "--p": `${p}%` } as CSSProperties}
      onChange={(e) => onChange(Number(e.target.value))}
      onPointerUp={onCommit} onTouchEnd={onCommit} onKeyUp={onCommit} />
  );
}

export function Segmented<T extends string | number>({ value, options, onChange }: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="card flex rounded-full p-0.5">
      {options.map((o) => (
        <button key={String(o.v)} onClick={() => onChange(o.v)} className={`flex-1 rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${o.v === value ? "accent-bg shadow" : "muted"}`}>{o.label}</button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, text, children }: { icon: ReactNode; title: string; text?: string; children?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-16 text-center anim-fade">
      <div className="glass mb-5 grid h-20 w-20 place-items-center rounded-[28px] accent-text">{icon}</div>
      <h2 className="text-xl font-semibold">{title}</h2>
      {text && <p className="muted mt-2 text-sm leading-relaxed">{text}</p>}
      <div className="mt-5 flex flex-wrap justify-center gap-2">{children}</div>
    </div>
  );
}

export function Btn({ children, onClick, kind = "glass", className = "", disabled, type }: { children: ReactNode; onClick?: () => void; kind?: "glass" | "accent" | "danger"; className?: string; disabled?: boolean; type?: "button" | "submit" }) {
  const k = kind === "accent" ? "accent-bg" : kind === "danger" ? "bg-[var(--danger)] text-white" : "glass";
  return (
    <button type={type ?? "button"} disabled={disabled} onClick={onClick} className={`press inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold disabled:opacity-50 ${k} ${className}`}>{children}</button>
  );
}

export function Spinner({ size = 22 }: { size?: number }) {
  return <span className="inline-block animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" style={{ width: size, height: size }} />;
}
