import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useApp } from "../components/AppContext";
import { Button, EmptyState, Pill, StaleBadge, cx } from "../components/ui";
import { setSubStatus, updateActivity, updateRaid } from "../db/actions";
import { RAID_CLOSED, RAID_SINGULAR, type Activity } from "../db/types";
import { useAllGraphs, useSettings } from "../hooks/data";
import { diffDays, formatDate, todayISO } from "../lib/dates";
import { isStale } from "../lib/metrics";
import { isOpen } from "../lib/rag";

interface Task {
  key: string;
  kind: "sub" | "milestone" | "raid";
  label: string;
  title: string;
  projectId: string;
  projectName: string;
  owner: string;
  due: string;
  updatedAt: number;
  activity?: Activity;
  raidId?: string;
  raidDone?: string;
  milestoneId?: string;
  status: string;
}

export function MyTasksPage() {
  const graphs = useAllGraphs();
  const settings = useSettings();
  const [mineOnly, setMineOnly] = useState(false);
  const [horizon, setHorizon] = useState<"14" | "30" | "all">("30");
  const today = todayISO();

  if (!graphs) return null;

  const tasks: Task[] = [];
  for (const g of graphs) {
    if (g.project.status === "Closed") continue;
    const base = { projectId: g.project.id, projectName: g.project.name };
    for (const a of g.activities) {
      if (a.level !== "sub" || a.kanbanStatus === "Done") continue;
      tasks.push({ ...base, key: a.id, kind: "sub", label: "Task", title: a.name, owner: a.owner, due: a.end, updatedAt: a.updatedAt, activity: a, status: a.kanbanStatus });
    }
    for (const m of g.milestones) {
      if (m.signoff === "Approved") continue;
      tasks.push({ ...base, key: m.id, kind: "milestone", label: "Milestone", title: m.name, owner: m.owner, due: m.date, updatedAt: m.updatedAt, milestoneId: m.id, status: m.signoff });
    }
    for (const r of g.raid) {
      if (!isOpen(r)) continue;
      tasks.push({ ...base, key: r.id, kind: "raid", label: RAID_SINGULAR[r.type], title: r.title, owner: r.owner, due: r.due, updatedAt: r.updatedAt, raidId: r.id, raidDone: RAID_CLOSED[r.type][0], status: r.status });
    }
  }

  const me = settings.myName.trim().toLowerCase();
  const shown = tasks
    .filter((t) => !mineOnly || t.owner.trim().toLowerCase() === me)
    .filter((t) => horizon === "all" || t.due <= addDaysSafe(today, Number(horizon)))
    .sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
  const overdue = shown.filter((t) => t.due < today);
  const upcoming = shown.filter((t) => t.due >= today);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <h1 className="text-lg font-semibold">My Tasks</h1>
      <p className="text-sm text-muted">Everything due across your projects, overdue first.</p>
      <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} />
          Only items owned by {settings.myName}
        </label>
        <div className="flex rounded-md border border-line p-0.5 text-xs" role="group" aria-label="Due within">
          {(["14", "30", "all"] as const).map((h) => (
            <button key={h} type="button" onClick={() => setHorizon(h)} className={cx("rounded px-2.5 py-1 font-medium", horizon === h ? "bg-accent-soft text-accent" : "text-muted")}>
              {h === "all" ? "All" : `Next ${h} days`}
            </button>
          ))}
        </div>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="Nothing due" body="Sub-activities, milestones and RAID items with owners and due dates show up here once you add them to a project." />
        </div>
      ) : (
        <>
          <Group title={`Overdue (${overdue.length})`} tasks={overdue} today={today} tone="red" />
          <Group title={`Coming up (${upcoming.length})`} tasks={upcoming} today={today} />
        </>
      )}
    </div>
  );
}

function addDaysSafe(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function Group({ title, tasks, today, tone }: { title: string; tasks: Task[]; today: string; tone?: "red" }) {
  if (tasks.length === 0) return null;
  return (
    <section className="mt-6">
      <h2 className={cx("mb-2 text-xs font-semibold tracking-wide uppercase", tone === "red" ? "text-red" : "text-muted")}>{title}</h2>
      <ul className="divide-y divide-line rounded-card border border-line bg-surface">
        {tasks.map((t) => (
          <TaskRow key={t.key} t={t} today={today} />
        ))}
      </ul>
    </section>
  );
}

function TaskRow({ t, today }: { t: Task; today: string }) {
  const { openPanel, notify } = useApp();
  const late = diffDays(t.due, today);
  const [pct, setPct] = useState(t.activity?.actualPct ?? 0);
  useEffect(() => setPct(t.activity?.actualPct ?? 0), [t.activity?.actualPct]);
  const commitPct = async () => {
    const a = t.activity;
    if (!a || pct === a.actualPct) return;
    // A blocked task stays blocked; a To Do task with progress is now In Progress.
    if (a.kanbanStatus === "To Do" && pct > 0) await setSubStatus(a.id, "In Progress", { pct });
    else await updateActivity(a.id, { actualPct: pct });
  };

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Pill className="shrink-0">{t.label}</Pill>
          {t.kind === "raid" ? (
            <Link to={`/p/${t.projectId}/raid`} className="truncate text-sm font-medium hover:text-accent">
              {t.title}
            </Link>
          ) : (
            <button type="button" className="truncate text-left text-sm font-medium hover:text-accent" onClick={() => openPanel(t.key)}>
              {t.title}
            </button>
          )}
          {isStale(t.updatedAt) && <StaleBadge />}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          <Link to={`/p/${t.projectId}`} className="hover:underline">
            {t.projectName}
          </Link>{" "}
          · {t.owner} · <span className={late > 0 ? "font-medium text-red" : ""}>{late > 0 ? `${late} day${late === 1 ? "" : "s"} overdue` : `due ${formatDate(t.due)}`}</span> · {t.status}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {t.kind === "sub" && t.activity && (
          <>
            <input
              type="range"
              min={0}
              max={95}
              step={5}
              value={pct}
              className="w-28"
              aria-label={`Percent complete for ${t.title}`}
              onChange={(e) => setPct(Number(e.target.value))}
              onPointerUp={commitPct}
              onKeyUp={commitPct}
            />
            <span className="w-9 text-right text-xs tabular-nums">{pct}%</span>
            <Button size="sm" onClick={async () => { await setSubStatus(t.activity!.id, "Done"); notify(`Done: ${t.title}`); }}>
              Mark done
            </Button>
          </>
        )}
        {t.kind === "raid" && t.raidId && (
          <Button size="sm" onClick={async () => { await updateRaid(t.raidId!, { status: t.raidDone! }); notify(`${t.raidDone}: ${t.title}`); }}>
            Mark {t.raidDone?.toLowerCase()}
          </Button>
        )}
        {t.kind === "milestone" && (
          <Button size="sm" onClick={() => openPanel(t.key)}>
            Update sign-off
          </Button>
        )}
      </div>
    </li>
  );
}
