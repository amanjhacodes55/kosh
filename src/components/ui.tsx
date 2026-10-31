"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { useToasts } from "@/client/api";
import { compactINR, formatINR } from "@/lib/money";
import { formatDate } from "@/lib/dates";

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <defs>
        <linearGradient id="kosh-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#19c39a" />
          <stop offset="1" stopColor="#0b8ea0" />
        </linearGradient>
        <linearGradient id="kosh-c" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#f6d27a" />
          <stop offset="1" stopColor="#d9a441" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill="url(#kosh-g)" />
      <path d="M7 13.2 16 8l9 5.2v1.3H7z" fill="#fff" />
      <rect x="8.6" y="15.6" width="2.6" height="7" rx=".8" fill="#fff" />
      <rect x="14.7" y="15.6" width="2.6" height="7" rx=".8" fill="#fff" />
      <rect x="20.8" y="15.6" width="2.6" height="7" rx=".8" fill="#fff" />
      <rect x="7" y="23.6" width="18" height="2.2" rx="1" fill="#fff" />
      <circle cx="16" cy="11.9" r="1.7" fill="url(#kosh-c)" />
    </svg>
  );
}

/** ₹ amount; debits in red with a minus when `signed` */
export function Amount({ value, signed = false, compact = false, className = "" }: { value: number; signed?: boolean; compact?: boolean; className?: string }) {
  const text = compact ? compactINR(value) : formatINR(Math.abs(value));
  const color = signed ? (value < 0 ? "text-danger" : value > 0 ? "text-good" : "") : "";
  return <span className={`num whitespace-nowrap ${color} ${className}`}>{signed && !compact ? (value < 0 ? "− " : value > 0 ? "+ " : "") : !compact && value < 0 ? "− " : ""}{text}</span>;
}

export const D = ({ d }: { d: string }) => <span className="whitespace-nowrap">{formatDate(d)}</span>;

const TONES: Record<string, string> = {
  green: "bg-good/15 text-good",
  amber: "bg-warn/15 text-warn",
  red: "bg-danger/15 text-danger",
  blue: "bg-info/15 text-info",
  gold: "bg-gold/15 text-gold",
  grey: "bg-raise text-ink-2",
  accent: "bg-accent/15 text-accent-ink",
};

export function Badge({ tone = "grey", children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`chip ${TONES[tone]}`}>{children}</span>;
}

export function StatusBadge({ s }: { s: string }) {
  const map: Record<string, keyof typeof TONES> = {
    active: "green", verified: "green", approved: "green", disbursed: "green", settled: "grey", open: "blue", matured: "grey", closed: "grey",
    pending: "amber", applied: "blue", appraised: "accent", sanctioned: "gold", frozen: "red", dormant: "amber", rejected: "red",
    STD: "green", "SMA-0": "amber", "SMA-1": "amber", "SMA-2": "red", SUB: "red", D1: "red", D2: "red", D3: "red", LOSS: "red",
    low: "green", medium: "amber", high: "red", borrow: "amber", lend: "blue",
  };
  return <Badge tone={map[s] ?? "grey"}>{s === "STD" ? "Standard" : s === "SUB" ? "Sub-standard" : s}</Badge>;
}

export function Card({ title, actions, children, className = "", pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`card rise ${className}`}>
      {(title || actions) && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <div className="flex items-center gap-2">{actions}</div>
        </header>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, sub, tone, icon }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "good" | "warn" | "danger" | "gold"; icon?: ReactNode }) {
  const color = tone === "good" ? "text-good" : tone === "warn" ? "text-warn" : tone === "danger" ? "text-danger" : tone === "gold" ? "text-gold" : "";
  return (
    <div className="card rise relative overflow-hidden p-4">
      <div className="flex items-center justify-between text-xs font-medium text-muted">
        {label}
        {icon && <span className="text-ink-2/70">{icon}</span>}
      </div>
      <div className={`num mt-1.5 text-2xl font-semibold tracking-tight ${color}`}>{value}</div>
      {sub && <div className="mt-1 text-xs text-muted">{sub}</div>}
    </div>
  );
}

export function PageHead({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}

export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal aria-label={title}>
      <div className="absolute inset-0" style={{ background: "var(--scrim)" }} onClick={onClose} />
      <div className={`card pop relative max-h-[92dvh] w-full overflow-auto scroll-thin ${wide ? "max-w-3xl" : "max-w-lg"}`} style={{ boxShadow: "var(--shadow)" }}>
        <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-panel px-5 py-3.5">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="px-5 py-10 text-center text-sm text-muted">{children}</div>;
}

export function Loading() {
  return (
    <div className="space-y-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-20 animate-pulse rounded-2xl bg-raise" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
    </div>
  );
}

export function Toasts() {
  const list = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[60] flex w-[min(26rem,calc(100vw-2.5rem))] flex-col gap-2">
      {list.map((t) => (
        <div
          key={t.id}
          role="status"
          className={`pop pointer-events-auto rounded-xl border px-4 py-3 text-sm shadow-lg glass ${t.kind === "error" ? "border-danger/40 text-danger" : t.kind === "info" ? "border-gold/40 text-ink" : "border-accent/40 text-ink"}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { value: T; label: ReactNode }[] }) {
  return (
    <div className="inline-flex rounded-xl border border-line bg-raise p-1" role="tablist">
      {items.map((i) => (
        <button
          key={i.value}
          role="tab"
          aria-selected={value === i.value}
          className={`h-8 rounded-lg px-3 text-sm transition ${value === i.value ? "bg-panel text-ink shadow-sm" : "text-muted hover:text-ink"}`}
          onClick={() => onChange(i.value)}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}

/** Label/value pairs */
export function Facts({ items, cols = 2 }: { items: [ReactNode, ReactNode][]; cols?: 2 | 3 | 4 }) {
  const grid = cols === 4 ? "sm:grid-cols-4" : cols === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2";
  return (
    <dl className={`grid grid-cols-1 gap-x-6 gap-y-3 ${grid}`}>
      {items.map(([k, v], i) => (
        <div key={i} className="min-w-0">
          <dt className="text-xs text-muted">{k}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A horizontal bar for proportions (deposit mix, CRR held vs required) */
export function Meter({ value, max, tone = "accent" }: { value: number; max: number; tone?: "accent" | "warn" | "danger" | "gold" }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const bg = tone === "warn" ? "var(--warn)" : tone === "danger" ? "var(--danger)" : tone === "gold" ? "var(--gold)" : "linear-gradient(90deg, var(--accent), var(--accent-2))";
  return (
    <div className="h-2 overflow-hidden rounded-full bg-raise">
      <div className="h-full rounded-full transition-[width] duration-700" style={{ width: `${pct}%`, background: bg }} />
    </div>
  );
}
