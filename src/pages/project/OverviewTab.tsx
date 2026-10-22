import { useLiveQuery } from "dexie-react-hooks";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { PctWithMath } from "../../components/Breakdown";
import { ConflictList, useConflicts } from "../../components/Conflicts";
import { BaselineModal, MilestoneModal, OverrideModal, ProjectEditModal } from "../../components/ProjectModals";
import { SCurveChart } from "../../components/SCurveChart";
import { Button, Card, Pill, RagBadge, StaleBadge, cx } from "../../components/ui";
import { db } from "../../db/db";
import { RAID_SINGULAR, type Milestone, type RagStatus, type RaidItem } from "../../db/types";
import { formatDate, formatShort, todayISO } from "../../lib/dates";
import { isStale, sCurve } from "../../lib/metrics";
import { fmtPct, fmtVariance } from "../../lib/progress";
import { isOpen, milestoneOverdueDays, riskScore } from "../../lib/rag";
import { useProject } from "../ProjectLayout";

export function OverviewTab() {
  const { graph, metrics, snapshots } = useProject();
  const { project } = graph;
  const today = todayISO();
  const [modal, setModal] = useState<null | "override" | "baseline" | "edit" | "milestone">(null);
  const [editing, setEditing] = useState<Milestone | null>(null);
  const curve = useMemo(() => sCurve(graph, metrics.tree, snapshots, today), [graph, metrics.tree, snapshots, today]);
  const conflicts = useConflicts(graph, metrics.tree);
  const history = useLiveQuery(() => db.ragHistory.where({ projectId: project.id }).toArray(), [project.id]) ?? [];
  const { rag } = metrics;

  const topRaid = topRaidItems(graph.raid);
  const milestones = [...graph.milestones].sort((a, b) => (a.date < b.date ? -1 : 1));
  const upcoming = milestones.filter((m) => m.signoff !== "Approved").slice(0, 6);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-6 sm:px-8">
      {project.isSample && (
        <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">
          This is a sample project with made-up data. Explore every tab, then delete it from Edit project.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setModal("override")}>Override RAG</Button>
        <Button onClick={() => setModal("baseline")}>{graph.baseline ? "Re-baseline" : "Set baseline"}</Button>
        <Button onClick={() => setModal("edit")}>Edit project</Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Status" className="lg:col-span-1">
          <div className="flex items-center gap-3">
            <RagBadge status={rag.status} overridden={rag.overridden} />
            {rag.overridden && <span className="text-xs text-muted">Rules say {rag.calculated}</span>}
          </div>
          {rag.overridden && <p className="mt-3 text-sm">{rag.overrideReason}</p>}
          <ul className={cx("mt-3 flex flex-col gap-1 text-sm", rag.overridden && "text-muted")}>
            {rag.reasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
          <RagHistory entries={history.sort((a, b) => (a.week < b.week ? -1 : 1)).slice(-10)} />
        </Card>

        <Card title="Progress" className="lg:col-span-1">
          <div className="flex items-center gap-5">
            <Dial planned={metrics.plannedPct} actual={metrics.actualPct} />
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-sm">
              <dt className="text-muted">Actual</dt>
              <dd className="font-semibold tabular-nums">
                <PctWithMath node={metrics.tree.root} field="actualPct" />
              </dd>
              <dt className="text-muted">Planned</dt>
              <dd className="tabular-nums">
                <PctWithMath node={metrics.tree.root} field="plannedPct" />
              </dd>
              {metrics.baselinePlannedPct !== null && (
                <>
                  <dt className="text-muted">Baseline</dt>
                  <dd className="tabular-nums">{fmtPct(metrics.baselinePlannedPct)}</dd>
                </>
              )}
              <dt className="text-muted">Variance</dt>
              <dd className={metrics.variance < -0.05 ? "text-amber" : ""}>{fmtVariance(metrics.variance)}</dd>
            </dl>
          </div>
          <div className="mt-4 flex flex-col gap-2">
            {metrics.tree.root.children.map((p) => (
              <div key={p.id} className="grid grid-cols-[1fr_auto] items-center gap-x-3 text-xs">
                <span className="truncate">{p.name}</span>
                <span className="text-muted tabular-nums">
                  <PctWithMath node={p} field="actualPct" /> / {fmtPct(p.plannedPct)}
                </span>
                <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-sunken">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${p.actualPct}%` }} />
                </div>
              </div>
            ))}
          </div>
        </Card>

        <Card title="S-curve" className="lg:col-span-1" action={<Link to="timeline" className="text-xs text-accent hover:underline">Timeline →</Link>}>
          <SCurveChart points={curve} today={today} height={200} compact />
        </Card>
      </div>

      {conflicts.length > 0 && (
        <Card title={`Dependency warnings (${conflicts.length})`}>
          <ConflictList items={conflicts} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Upcoming milestones"
          action={
            <Button size="sm" variant="ghost" onClick={() => { setEditing(null); setModal("milestone"); }}>
              + Milestone
            </Button>
          }
        >
          {upcoming.length === 0 ? (
            <p className="text-sm text-muted">No open milestones. Milestones are key gates with a date, an owner and a sign-off.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.map((m) => {
                const overdue = milestoneOverdueDays(m, today);
                return (
                  <li key={m.id}>
                    <button type="button" className="flex w-full items-center gap-3 py-2 text-left text-sm hover:bg-sunken" onClick={() => { setEditing(m); setModal("milestone"); }}>
                      <span className="text-accent" aria-hidden>◆</span>
                      <span className="min-w-0 flex-1 truncate">{m.name}</span>
                      {isStale(m.updatedAt) && <StaleBadge />}
                      {overdue > 0 && <Pill tone={overdue > 7 ? "red" : "amber"}>Overdue {overdue}d</Pill>}
                      <Pill tone={m.signoff === "Rejected" ? "red" : m.signoff === "Submitted" ? "accent" : "neutral"}>{m.signoff}</Pill>
                      <span className="w-24 text-right text-xs text-muted tabular-nums">{formatDate(m.date)}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {milestones.length > upcoming.length && (
            <p className="mt-2 text-xs text-muted">{milestones.length - upcoming.length} more approved or later on the timeline.</p>
          )}
        </Card>

        <Card title="Top RAID items" action={<Link to="raid" className="text-xs text-accent hover:underline">RAID log →</Link>}>
          {topRaid.length === 0 ? (
            <p className="text-sm text-muted">Nothing open. Log risks, actions, issues and decisions on the RAID tab.</p>
          ) : (
            <ul className="divide-y divide-line">
              {topRaid.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-2 text-sm">
                  <Pill tone={r.type === "I" ? "red" : r.type === "R" ? "amber" : "neutral"} className="w-16 justify-center">
                    {RAID_SINGULAR[r.type]}
                  </Pill>
                  <span className="min-w-0 flex-1 truncate">{r.title}</span>
                  {isStale(r.updatedAt) && <StaleBadge />}
                  <span className="text-xs text-muted">{r.type === "R" ? `Score ${riskScore(r)}` : r.type === "I" ? r.severity : r.status}</span>
                  <span className="w-20 truncate text-right text-xs text-muted">{r.owner}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {project.description && (
        <Card title="About">
          <p className="text-sm whitespace-pre-wrap text-muted">{project.description}</p>
          <p className="mt-2 text-xs text-faint">
            {formatDate(project.start)} – {formatDate(project.end)}
            {project.sponsor && ` · Sponsor: ${project.sponsor}`}
            {graph.baseline && ` · Baseline set ${formatDate(new Date(graph.baseline.setAt).toISOString().slice(0, 10))}`}
          </p>
        </Card>
      )}

      <OverrideModal open={modal === "override"} onClose={() => setModal(null)} projectId={project.id} rag={rag} />
      <BaselineModal open={modal === "baseline"} onClose={() => setModal(null)} projectId={project.id} hasBaseline={!!graph.baseline} />
      <ProjectEditModal open={modal === "edit"} onClose={() => setModal(null)} project={project} />
      <MilestoneModal open={modal === "milestone"} onClose={() => setModal(null)} projectId={project.id} milestone={editing} />
    </div>
  );
}

function topRaidItems(items: RaidItem[]): RaidItem[] {
  const rank = (r: RaidItem) => {
    if (r.type === "I") return { Critical: 100, High: 60, Medium: 30, Low: 10 }[r.severity];
    if (r.type === "R") return riskScore(r) * 3;
    return 20;
  };
  return items.filter(isOpen).sort((a, b) => rank(b) - rank(a) || (a.due < b.due ? -1 : 1)).slice(0, 5);
}

function Dial({ planned, actual }: { planned: number; actual: number }) {
  const r = 38;
  const c = 2 * Math.PI * r;
  const plannedAngle = (planned / 100) * 360 - 90;
  const px = 50 + r * Math.cos((plannedAngle * Math.PI) / 180);
  const py = 50 + r * Math.sin((plannedAngle * Math.PI) / 180);
  return (
    <svg viewBox="0 0 100 100" width="104" height="104" role="img" aria-label={`${actual.toFixed(1)}% actual, ${planned.toFixed(1)}% planned`}>
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--sunken)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke="var(--accent)" strokeWidth="9" strokeDasharray={`${(actual / 100) * c} ${c}`} transform="rotate(-90 50 50)" strokeLinecap="round" />
      <circle cx={px} cy={py} r="3.5" fill="var(--ink)" stroke="var(--surface)" strokeWidth="1.5" />
      <text x="50" y="50" textAnchor="middle" dy="2" fontSize="17" fontWeight="600" fill="var(--ink)">
        {Math.round(actual)}%
      </text>
      <text x="50" y="64" textAnchor="middle" fontSize="8" fill="var(--muted)">
        plan {Math.round(planned)}%
      </text>
    </svg>
  );
}

function RagHistory({ entries }: { entries: { week: string; status: RagStatus; reason: string; overridden: boolean }[] }) {
  if (entries.length < 2) return null;
  const color: Record<RagStatus, string> = { Green: "bg-green", Amber: "bg-amber", Red: "bg-red" };
  return (
    <div className="mt-4">
      <p className="mb-1 text-xs text-muted">Week by week</p>
      <div className="flex gap-1">
        {entries.map((e) => (
          <div key={e.week} className="flex flex-col items-center gap-0.5" title={`${formatDate(e.week)}: ${e.status}${e.overridden ? " (overridden)" : ""} · ${e.reason}`}>
            <span className={cx("flex h-5 w-7 items-center justify-center rounded text-[10px] font-bold text-surface", color[e.status])}>{e.status[0]}</span>
            <span className="text-[10px] text-faint">{formatShort(e.week)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
