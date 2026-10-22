// Dates are stored as ISO strings ("2026-10-22") and handled as whole UTC
// day numbers, so no time zone can shift a date by one.

export type ISODate = string;

const DAY_MS = 86_400_000;

export function toDay(iso: ISODate): number {
  const [y, m, d] = iso.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

export function fromDay(day: number): ISODate {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday. */
export function weekdayOfDay(day: number): number {
  return (((day + 4) % 7) + 7) % 7; // 1970-01-01 was a Thursday
}

export function todayISO(): ISODate {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function addDays(iso: ISODate, n: number): ISODate {
  return fromDay(toDay(iso) + n);
}

export function diffDays(a: ISODate, b: ISODate): number {
  return toDay(b) - toDay(a);
}

/** Monday of the ISO week containing the date. */
export function weekStart(iso: ISODate): ISODate {
  const day = toDay(iso);
  const wd = weekdayOfDay(day);
  return fromDay(day - ((wd + 6) % 7));
}

export function minDate(a: ISODate, b: ISODate): ISODate {
  return a <= b ? a : b;
}

export function maxDate(a: ISODate, b: ISODate): ISODate {
  return a >= b ? a : b;
}

export function isValidISO(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && fromDay(toDay(iso)) === iso;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatDate(iso: ISODate | null | undefined): string {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

export function formatShort(iso: ISODate): string {
  const [, m, d] = iso.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

export function monthLabel(iso: ISODate): string {
  const [y, m] = iso.split("-").map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "never";
  const d = new Date(ms);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${formatDate(todayISOFrom(d))}, ${time}`;
}

function todayISOFrom(d: Date): ISODate {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function relativeTime(ms: number, now = Date.now()): string {
  const mins = Math.round((now - ms) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}
