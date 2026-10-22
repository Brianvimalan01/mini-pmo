import { useState } from "react";
import { useNavigate } from "react-router";
import { useApp } from "../components/AppContext";
import { CalendarEditor } from "../components/CalendarEditor";
import { Button, Field, Input, Textarea, cx } from "../components/ui";
import { createProject, isCodeTaken, sanitizeCode } from "../db/actions";
import { CALENDAR_PRESETS, cloneCalendar, type WorkCalendar } from "../lib/calendar";
import { addDays, isValidISO, todayISO } from "../lib/dates";
import { applyTemplate, TEMPLATES, type DraftMilestone, type DraftPhase } from "../lib/templates";

interface Details {
  name: string;
  code: string;
  sponsor: string;
  description: string;
  start: string;
  end: string;
  calendar: WorkCalendar;
  templateId: string;
}

export function NewProjectPage() {
  const navigate = useNavigate();
  const { notify } = useApp();
  const [step, setStep] = useState<1 | 2>(1);
  const [d, setD] = useState<Details>({
    name: "",
    code: "",
    sponsor: "",
    description: "",
    start: todayISO(),
    end: addDays(todayISO(), 90),
    calendar: cloneCalendar(CALENDAR_PRESETS.malaysia.calendar),
    templateId: "implementation",
  });
  const [codeTouched, setCodeTouched] = useState(false);
  const [phases, setPhases] = useState<DraftPhase[]>([]);
  const [milestones, setMilestones] = useState<DraftMilestone[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<Details>) => setD((x) => ({ ...x, ...patch }));

  const validate = async (): Promise<string | null> => {
    if (!d.name.trim()) return "Give the project a name.";
    if (!sanitizeCode(d.code)) return "Give the project a short code (letters, numbers, dashes).";
    if (!isValidISO(d.start) || !isValidISO(d.end)) return "Set a start and end date.";
    if (d.end < d.start) return "The end date is before the start date.";
    if (await isCodeTaken(d.code)) return `Code ${sanitizeCode(d.code)} is already used by another project.`;
    return null;
  };

  const draftFromTemplate = () => {
    const t = TEMPLATES.find((x) => x.id === d.templateId) ?? TEMPLATES[0];
    return applyTemplate(t, d.start, d.end, d.calendar);
  };

  const create = async (plan: { phases: DraftPhase[]; milestones: DraftMilestone[] }) => {
    const problem = await validate();
    if (problem) {
      setError(problem);
      setStep(1);
      return;
    }
    setSaving(true);
    try {
      const id = await createProject({
        ...d,
        phases: plan.phases
          .filter((p) => p.name.trim())
          .map((p) => ({ ...p, mains: p.mains.filter((m) => m.name.trim() && m.start && m.end && m.end >= m.start) })),
        milestones: plan.milestones.filter((m) => m.name.trim() && isValidISO(m.date)),
      });
      notify(`Created ${d.name.trim()}`);
      navigate(`/p/${id}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-8">
      <h1 className="text-lg font-semibold">New project</h1>
      <ol className="mt-3 flex gap-4 text-sm">
        {["Details", "Phases, activities and milestones"].map((label, i) => (
          <li key={label} className={cx("flex items-center gap-2", step === i + 1 ? "font-medium text-ink" : "text-muted")}>
            <span className={cx("flex h-5 w-5 items-center justify-center rounded-full text-xs", step === i + 1 ? "bg-accent text-accent-ink" : "bg-sunken")}>{i + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error && <p className="mt-4 rounded-md bg-red-soft px-3 py-2 text-sm text-red">{error}</p>}

      {step === 1 && (
        <div className="mt-5 flex flex-col gap-5 rounded-card border border-line bg-surface p-5">
          <div className="grid gap-4 sm:grid-cols-[1fr_10rem]">
            <Field label="Project name">
              <Input
                autoFocus
                value={d.name}
                onChange={(e) => {
                  const name = e.target.value;
                  set({ name, ...(codeTouched ? {} : { code: suggestCode(name) }) });
                }}
                placeholder="CRM rollout"
              />
            </Field>
            <Field label="Code" hint="Used as the backup file name">
              <Input
                value={d.code}
                onChange={(e) => {
                  setCodeTouched(true);
                  set({ code: e.target.value.toUpperCase() });
                }}
                placeholder="CRM"
              />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Sponsor">
              <Input value={d.sponsor} onChange={(e) => set({ sponsor: e.target.value })} placeholder="Name or role" />
            </Field>
            <Field label="Start date">
              <Input type="date" value={d.start} onChange={(e) => set({ start: e.target.value })} />
            </Field>
            <Field label="End date">
              <Input type="date" value={d.end} onChange={(e) => set({ end: e.target.value })} />
            </Field>
          </div>
          <Field label="Description">
            <Textarea rows={2} value={d.description} onChange={(e) => set({ description: e.target.value })} placeholder="What this project delivers and why" />
          </Field>
          <CalendarEditor value={d.calendar} onChange={(calendar) => set({ calendar })} />
          <div>
            <p className="mb-1 text-xs font-medium text-muted">Template</p>
            <div className="grid gap-2 sm:grid-cols-3">
              {TEMPLATES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => set({ templateId: t.id })}
                  className={cx("rounded-card border p-3 text-left", d.templateId === t.id ? "border-accent bg-accent-soft" : "border-line hover:bg-sunken")}
                >
                  <span className="block text-sm font-medium">{t.label}</span>
                  <span className="block text-xs text-muted">{t.description}</span>
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => navigate(-1)}>
              Cancel
            </Button>
            <Button disabled={saving} onClick={() => create(draftFromTemplate())} title="Create with the template as it is; add detail later on the timeline">
              Skip step 2 and create
            </Button>
            <Button
              variant="primary"
              onClick={async () => {
                const problem = await validate();
                setError(problem);
                if (problem) return;
                const draft = draftFromTemplate();
                setPhases(draft.phases);
                setMilestones(draft.milestones);
                setStep(2);
              }}
            >
              Next: phases
            </Button>
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="mt-5 flex flex-col gap-5 rounded-card border border-line bg-surface p-5">
          <p className="text-sm text-muted">
            Build the plan as phases and main activities. Dates were spread across the project by the template; adjust what you know now. Sub-activities come later, on the Board.
          </p>
          <PhaseEditor phases={phases} onChange={setPhases} defaultStart={d.start} defaultEnd={d.end} />
          <MilestoneEditor milestones={milestones} onChange={setMilestones} defaultDate={d.end} />
          <div className="flex justify-between gap-2 border-t border-line pt-4">
            <Button variant="ghost" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary" disabled={saving} onClick={() => create({ phases, milestones })}>
              Create project
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function suggestCode(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "";
  if (words.length === 1) return sanitizeCode(words[0].slice(0, 6));
  return sanitizeCode(words.map((w) => w[0]).join("").slice(0, 6));
}

function PhaseEditor({ phases, onChange, defaultStart, defaultEnd }: { phases: DraftPhase[]; onChange: (p: DraftPhase[]) => void; defaultStart: string; defaultEnd: string }) {
  const update = (i: number, p: DraftPhase) => onChange(phases.map((x, j) => (j === i ? p : x)));
  return (
    <div className="flex flex-col gap-3">
      {phases.map((p, i) => (
        <div key={i} className="rounded-card border border-line">
          <div className="flex items-center gap-2 border-b border-line bg-sunken px-3 py-2">
            <Input value={p.name} onChange={(e) => update(i, { ...p, name: e.target.value })} className="h-8 font-medium" aria-label="Phase name" />
            <Button size="sm" variant="ghost" onClick={() => onChange(phases.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
          <div className="flex flex-col gap-1.5 p-3">
            {p.mains.map((m, k) => (
              <div key={k} className="grid grid-cols-[1fr_9rem_9rem_auto] items-center gap-2">
                <Input value={m.name} onChange={(e) => update(i, { ...p, mains: p.mains.map((x, j) => (j === k ? { ...x, name: e.target.value } : x)) })} className="h-8" aria-label="Main activity" />
                <Input type="date" value={m.start} onChange={(e) => update(i, { ...p, mains: p.mains.map((x, j) => (j === k ? { ...x, start: e.target.value } : x)) })} className="h-8" aria-label="Start" />
                <Input type="date" value={m.end} onChange={(e) => update(i, { ...p, mains: p.mains.map((x, j) => (j === k ? { ...x, end: e.target.value } : x)) })} className="h-8" aria-label="End" />
                <button type="button" className="px-1 text-xs text-muted hover:text-red" onClick={() => update(i, { ...p, mains: p.mains.filter((_, j) => j !== k) })} aria-label="Remove main activity">
                  ✕
                </button>
              </div>
            ))}
            <button
              type="button"
              className="self-start text-xs font-medium text-accent hover:underline"
              onClick={() => {
                const last = p.mains[p.mains.length - 1];
                update(i, { ...p, mains: [...p.mains, { name: "", start: last?.start ?? defaultStart, end: last?.end ?? defaultEnd }] });
              }}
            >
              + Main activity
            </button>
          </div>
        </div>
      ))}
      <Button className="self-start" onClick={() => onChange([...phases, { name: `Phase ${phases.length + 1}`, mains: [{ name: "", start: defaultStart, end: defaultEnd }] }])}>
        + Phase
      </Button>
    </div>
  );
}

function MilestoneEditor({ milestones, onChange, defaultDate }: { milestones: DraftMilestone[]; onChange: (m: DraftMilestone[]) => void; defaultDate: string }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-medium text-muted">Milestones</p>
      <div className="flex flex-col gap-1.5">
        {milestones.map((m, i) => (
          <div key={i} className="grid grid-cols-[1fr_9rem_auto] items-center gap-2">
            <Input value={m.name} onChange={(e) => onChange(milestones.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} className="h-8" aria-label="Milestone" />
            <Input type="date" value={m.date} onChange={(e) => onChange(milestones.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)))} className="h-8" aria-label="Date" />
            <button type="button" className="px-1 text-xs text-muted hover:text-red" onClick={() => onChange(milestones.filter((_, j) => j !== i))} aria-label="Remove milestone">
              ✕
            </button>
          </div>
        ))}
        <button type="button" className="self-start text-xs font-medium text-accent hover:underline" onClick={() => onChange([...milestones, { name: "", date: defaultDate }])}>
          + Milestone
        </button>
      </div>
    </div>
  );
}
