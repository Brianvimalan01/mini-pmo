import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import type { RagStatus } from "../db/types";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- buttons

type Variant = "primary" | "secondary" | "ghost" | "danger";

const VARIANTS: Record<Variant, string> = {
  primary: "bg-accent text-accent-ink hover:opacity-90 border border-transparent",
  secondary: "bg-surface text-ink border border-line hover:bg-sunken",
  ghost: "text-muted hover:text-ink hover:bg-sunken border border-transparent",
  danger: "bg-surface text-red border border-line hover:bg-red-soft",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: "sm" | "md" }) {
  return (
    <button
      type="button"
      {...props}
      className={cx(
        "inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-7 px-2 text-xs" : "h-9 px-3 text-sm",
        VARIANTS[variant],
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------- form fields

export function Field({ label, hint, error, children, className }: { label: string; hint?: ReactNode; error?: string | null; children: ReactNode; className?: string }) {
  return (
    <label className={cx("flex flex-col gap-1 text-sm", className)}>
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {error ? <span className="text-xs text-red">{error}</span> : hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </label>
  );
}

// Full width unless the caller sets its own width.
const widthOf = (className?: string) => (/(^|\s)(w-|max-w-)/.test(className ?? "") ? "" : "w-full");

const control =
  "rounded-md border border-line bg-surface px-2.5 text-sm text-ink placeholder:text-faint focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:bg-sunken disabled:text-muted";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cx(control, widthOf(className), "h-9", className)} />;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={cx(control, "w-full py-2 leading-relaxed", className)} />;
}

export function Select({ className, children, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...props} className={cx(control, widthOf(className), "h-9 pr-7", className)}>
      {children}
    </select>
  );
}

// ---------------------------------------------------------------- surfaces

export function Card({ children, className, title, action }: { children: ReactNode; className?: string; title?: ReactNode; action?: ReactNode }) {
  return (
    <section className={cx("rounded-card border border-line bg-surface", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-sm font-semibold">{title}</p>
      <p className="max-w-md text-sm text-muted">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="no-print fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby={id} className={cx("w-full rounded-card border border-line bg-surface shadow-xl", wide ? "max-w-3xl" : "max-w-lg")}>
        <header className="flex items-center justify-between border-b border-line px-5 py-3">
          <h2 id={id} className="text-lg font-semibold">
            {title}
          </h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close">
            <CloseIcon />
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">{children}</div>
        {footer && <footer className="flex justify-end gap-2 border-t border-line px-5 py-3">{footer}</footer>}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- status

const RAG_STYLE: Record<RagStatus, string> = {
  Green: "bg-green-soft text-green",
  Amber: "bg-amber-soft text-amber",
  Red: "bg-red-soft text-red",
};

const RAG_DOT: Record<RagStatus, string> = { Green: "bg-green", Amber: "bg-amber", Red: "bg-red" };

/** RAG is always shown with its text label, never colour alone. */
export function RagBadge({ status, overridden, size = "md" }: { status: RagStatus; overridden?: boolean; size?: "sm" | "md" }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 rounded-full font-semibold", RAG_STYLE[status], size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-xs")}>
      <span className={cx("h-2 w-2 rounded-full", RAG_DOT[status])} aria-hidden />
      {status}
      {overridden && <span className="font-medium opacity-80">· overridden</span>}
    </span>
  );
}

export function Pill({ children, tone = "neutral", className }: { children: ReactNode; tone?: "neutral" | "accent" | "green" | "amber" | "red"; className?: string }) {
  const tones = {
    neutral: "bg-sunken text-muted",
    accent: "bg-accent-soft text-accent",
    green: "bg-green-soft text-green",
    amber: "bg-amber-soft text-amber",
    red: "bg-red-soft text-red",
  };
  return <span className={cx("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", tones[tone], className)}>{children}</span>;
}

export function StaleBadge() {
  return (
    <Pill tone="amber" className="whitespace-nowrap">
      Stale
    </Pill>
  );
}

export function ProgressBar({ planned, actual, className }: { planned: number; actual: number; className?: string }) {
  return (
    <div className={cx("relative h-2 w-full overflow-hidden rounded-full bg-sunken", className)} aria-hidden>
      <div className="absolute inset-y-0 left-0 rounded-full bg-accent" style={{ width: `${Math.min(100, actual)}%` }} />
      <div className="absolute inset-y-0 w-0.5 bg-ink/60" style={{ left: `calc(${Math.min(100, planned)}% - 1px)` }} title="Planned" />
    </div>
  );
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { id: T; label: ReactNode }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex gap-1 overflow-x-auto border-b border-line" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={value === t.id}
          onClick={() => onChange(t.id)}
          className={cx(
            "-mb-px border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap",
            value === t.id ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink",
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** Hover or focus to show a floating explanation (used for "show the math"). */
export function HoverCard({ children, content, className }: { children: ReactNode; content: ReactNode; className?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; up: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setPos({ x: Math.min(r.left, window.innerWidth - 400), y: r.bottom > window.innerHeight - 320 ? r.top : r.bottom, up: r.bottom > window.innerHeight - 320 });
    setOpen(true);
  };
  return (
    <span ref={ref} className={cx("cursor-help underline decoration-dotted decoration-faint underline-offset-2", className)} tabIndex={0} onMouseEnter={show} onMouseLeave={() => setOpen(false)} onFocus={show} onBlur={() => setOpen(false)}>
      {children}
      {open && pos && (
        <span
          className="fixed z-[60] block w-[380px] max-w-[calc(100vw-16px)] rounded-card border border-line bg-surface p-3 text-left text-xs font-normal text-ink no-underline shadow-xl"
          style={{ left: Math.max(8, pos.x), top: pos.up ? undefined : pos.y + 6, bottom: pos.up ? window.innerHeight - pos.y + 6 : undefined }}
        >
          {content}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------- icons

export function CloseIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function PinIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 16 16" fill="currentColor" aria-label="pinned">
      <path d="M9.8 1.5l4.7 4.7-1.4 1.4-.7-.7-2.8 2.8.2 3.1-1.4 1.4-2.8-2.8-3.5 3.5-.7-.7 3.5-3.5L2.1 7.9l1.4-1.4 3.1.2 2.8-2.8-.7-.7z" />
    </svg>
  );
}

export function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
      <path d="M8 3v10M3 8h10" />
    </svg>
  );
}

export function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden className={cx("transition-transform", open && "rotate-90")}>
      <path d="M6 3l5 5-5 5" />
    </svg>
  );
}
