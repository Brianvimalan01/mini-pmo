import { useState } from "react";
import { CALENDAR_PRESETS, cloneCalendar, WEEKDAY_NAMES, type WorkCalendar } from "../lib/calendar";
import { formatDate, isValidISO } from "../lib/dates";
import { Button, Field, Input, Select, cx } from "./ui";

export function CalendarEditor({ value, onChange }: { value: WorkCalendar; onChange: (c: WorkCalendar) => void }) {
  const [date, setDate] = useState("");
  const [name, setName] = useState("");
  const [showAll, setShowAll] = useState(false);
  const holidays = [...value.holidays].sort((a, b) => (a.date < b.date ? -1 : 1));
  const shown = showAll ? holidays : holidays.slice(0, 6);

  return (
    <div className="flex flex-col gap-3">
      <Field label="Working calendar" hint="Presets are a starting point; some holiday dates depend on official announcements, so check them.">
        <Select
          value={value.preset ?? "custom"}
          onChange={(e) => {
            const p = CALENDAR_PRESETS[e.target.value];
            if (p) onChange(cloneCalendar(p.calendar));
          }}
        >
          {Object.entries(CALENDAR_PRESETS).map(([id, p]) => (
            <option key={id} value={id}>
              {p.label}
            </option>
          ))}
          {!value.preset && <option value="custom">Custom</option>}
        </Select>
      </Field>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Working days</p>
        <div className="flex flex-wrap gap-1">
          {WEEKDAY_NAMES.map((d, i) => {
            const on = value.workingDays.includes(i);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  const next = on ? value.workingDays.filter((x) => x !== i) : [...value.workingDays, i].sort();
                  if (next.length) onChange({ ...value, workingDays: next, preset: undefined });
                }}
                className={cx("h-8 w-11 rounded-md border text-xs font-medium", on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:bg-sunken")}
              >
                {d}
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <p className="mb-1 text-xs font-medium text-muted">Public holidays ({holidays.length})</p>
        <ul className="divide-y divide-line rounded-md border border-line text-sm">
          {shown.map((h) => (
            <li key={h.date + h.name} className="flex items-center gap-3 px-3 py-1.5">
              <span className="w-24 shrink-0 text-xs text-muted tabular-nums">{formatDate(h.date)}</span>
              <span className="min-w-0 flex-1 truncate">{h.name}</span>
              <button
                type="button"
                className="text-xs text-muted hover:text-red"
                onClick={() => onChange({ ...value, holidays: value.holidays.filter((x) => x !== h), preset: undefined })}
              >
                Remove
              </button>
            </li>
          ))}
          {holidays.length === 0 && <li className="px-3 py-2 text-xs text-faint">No holidays</li>}
        </ul>
        {holidays.length > 6 && (
          <button type="button" className="mt-1 text-xs text-accent hover:underline" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show fewer" : `Show all ${holidays.length}`}
          </button>
        )}
        <div className="mt-2 flex gap-2">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40" aria-label="Holiday date" />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Holiday name" aria-label="Holiday name" />
          <Button
            disabled={!isValidISO(date)}
            onClick={() => {
              onChange({ ...value, holidays: [...value.holidays, { date, name: name.trim() || "Holiday" }], preset: undefined });
              setDate("");
              setName("");
            }}
          >
            Add
          </Button>
        </div>
      </div>
    </div>
  );
}
