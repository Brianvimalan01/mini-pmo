import { fromDay, toDay, weekdayOfDay, type ISODate } from "./dates";

export interface Holiday {
  date: ISODate;
  name: string;
}

export interface WorkCalendar {
  /** Weekdays that are worked, 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  holidays: Holiday[];
  preset?: string;
}

/**
 * Fast working-day arithmetic for one calendar. Counting uses whole weeks
 * plus a binary search over holidays, so S-curves over long projects stay
 * cheap.
 */
export interface CalendarIndex {
  isWorkingDay(iso: ISODate): boolean;
  /** Working days in [start, end], both inclusive. 0 if end < start. */
  workingDaysBetween(start: ISODate, end: ISODate): number;
  /** Same as workingDaysBetween but on day numbers. */
  countDays(startDay: number, endDay: number): number;
  /** First working day on or after the date. */
  onOrAfter(iso: ISODate): ISODate;
  /** The date `n` working days after `iso` (n may be negative). */
  addWorkingDays(iso: ISODate, n: number): ISODate;
}

const cache = new WeakMap<WorkCalendar, CalendarIndex>();

export function calendarIndex(cal: WorkCalendar): CalendarIndex {
  const hit = cache.get(cal);
  if (hit) return hit;
  const idx = buildIndex(cal);
  cache.set(cal, idx);
  return idx;
}

function buildIndex(cal: WorkCalendar): CalendarIndex {
  const working = new Set(cal.workingDays.length ? cal.workingDays : [1, 2, 3, 4, 5]);
  const perWeek = working.size;
  // Only holidays on a working weekday change a count.
  const holidayDays = [...new Set(cal.holidays.map((h) => toDay(h.date)))]
    .filter((d) => working.has(weekdayOfDay(d)))
    .sort((a, b) => a - b);
  const holidaySet = new Set(holidayDays);

  const isWd = (day: number) => working.has(weekdayOfDay(day)) && !holidaySet.has(day);

  // Number of holiday days <= day.
  const holidaysUpTo = (day: number) => {
    let lo = 0;
    let hi = holidayDays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (holidayDays[mid] <= day) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  const countDays = (a: number, b: number) => {
    if (b < a) return 0;
    const total = b - a + 1;
    const weeks = Math.floor(total / 7);
    let count = weeks * perWeek;
    for (let d = a + weeks * 7; d <= b; d++) if (working.has(weekdayOfDay(d))) count++;
    return count - (holidaysUpTo(b) - holidaysUpTo(a - 1));
  };

  return {
    isWorkingDay: (iso) => isWd(toDay(iso)),
    countDays,
    workingDaysBetween: (start, end) => countDays(toDay(start), toDay(end)),
    onOrAfter: (iso) => {
      let d = toDay(iso);
      for (let i = 0; i < 3660 && !isWd(d); i++) d++;
      return fromDay(d);
    },
    addWorkingDays: (iso, n) => {
      let d = toDay(iso);
      const step = n >= 0 ? 1 : -1;
      let left = Math.abs(n);
      let guard = 0;
      while (left > 0 && guard++ < 36600) {
        d += step;
        if (isWd(d)) left--;
      }
      return fromDay(d);
    },
  };
}

export const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Presets are a starting point. Several Malaysian dates depend on the moon
// sighting and are confirmed late, so check them in project setup.
export const CALENDAR_PRESETS: Record<string, { label: string; calendar: WorkCalendar }> = {
  none: {
    label: "Mon–Fri, no holidays",
    calendar: { workingDays: [1, 2, 3, 4, 5], holidays: [], preset: "none" },
  },
  malaysia: {
    label: "Malaysia (federal)",
    calendar: {
      preset: "malaysia",
      workingDays: [1, 2, 3, 4, 5],
      holidays: [
        { date: "2026-01-01", name: "New Year's Day" },
        { date: "2026-02-01", name: "Thaipusam" },
        { date: "2026-02-17", name: "Chinese New Year" },
        { date: "2026-02-18", name: "Chinese New Year (day 2)" },
        { date: "2026-03-21", name: "Hari Raya Aidilfitri" },
        { date: "2026-03-22", name: "Hari Raya Aidilfitri (day 2)" },
        { date: "2026-03-23", name: "Hari Raya Aidilfitri (replacement)" },
        { date: "2026-05-01", name: "Labour Day" },
        { date: "2026-05-27", name: "Hari Raya Haji" },
        { date: "2026-05-31", name: "Wesak Day" },
        { date: "2026-06-01", name: "Agong's Birthday" },
        { date: "2026-06-17", name: "Awal Muharram" },
        { date: "2026-08-25", name: "Maulidur Rasul" },
        { date: "2026-08-31", name: "Merdeka Day" },
        { date: "2026-09-16", name: "Malaysia Day" },
        { date: "2026-11-08", name: "Deepavali" },
        { date: "2026-11-09", name: "Deepavali (replacement)" },
        { date: "2026-12-25", name: "Christmas Day" },
        { date: "2027-01-01", name: "New Year's Day" },
        { date: "2027-02-06", name: "Chinese New Year" },
        { date: "2027-02-07", name: "Chinese New Year (day 2)" },
        { date: "2027-02-08", name: "Chinese New Year (replacement)" },
        { date: "2027-03-10", name: "Hari Raya Aidilfitri" },
        { date: "2027-03-11", name: "Hari Raya Aidilfitri (day 2)" },
        { date: "2027-05-01", name: "Labour Day" },
        { date: "2027-05-17", name: "Hari Raya Haji" },
        { date: "2027-05-20", name: "Wesak Day" },
        { date: "2027-06-06", name: "Awal Muharram" },
        { date: "2027-06-07", name: "Agong's Birthday" },
        { date: "2027-08-15", name: "Maulidur Rasul" },
        { date: "2027-08-31", name: "Merdeka Day" },
        { date: "2027-09-16", name: "Malaysia Day" },
        { date: "2027-10-28", name: "Deepavali" },
        { date: "2027-12-25", name: "Christmas Day" },
      ],
    },
  },
  nsw: {
    label: "New South Wales, Australia",
    calendar: {
      preset: "nsw",
      workingDays: [1, 2, 3, 4, 5],
      holidays: [
        { date: "2026-01-01", name: "New Year's Day" },
        { date: "2026-01-26", name: "Australia Day" },
        { date: "2026-04-03", name: "Good Friday" },
        { date: "2026-04-04", name: "Easter Saturday" },
        { date: "2026-04-05", name: "Easter Sunday" },
        { date: "2026-04-06", name: "Easter Monday" },
        { date: "2026-04-25", name: "Anzac Day" },
        { date: "2026-06-08", name: "King's Birthday" },
        { date: "2026-10-05", name: "Labour Day" },
        { date: "2026-12-25", name: "Christmas Day" },
        { date: "2026-12-26", name: "Boxing Day" },
        { date: "2026-12-28", name: "Boxing Day (additional)" },
        { date: "2027-01-01", name: "New Year's Day" },
        { date: "2027-01-26", name: "Australia Day" },
        { date: "2027-03-26", name: "Good Friday" },
        { date: "2027-03-27", name: "Easter Saturday" },
        { date: "2027-03-28", name: "Easter Sunday" },
        { date: "2027-03-29", name: "Easter Monday" },
        { date: "2027-04-26", name: "Anzac Day (additional)" },
        { date: "2027-06-14", name: "King's Birthday" },
        { date: "2027-10-04", name: "Labour Day" },
        { date: "2027-12-27", name: "Christmas Day (additional)" },
        { date: "2027-12-28", name: "Boxing Day (additional)" },
      ],
    },
  },
};

export function cloneCalendar(cal: WorkCalendar): WorkCalendar {
  return { workingDays: [...cal.workingDays], holidays: cal.holidays.map((h) => ({ ...h })), preset: cal.preset };
}
