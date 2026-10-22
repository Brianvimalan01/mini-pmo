import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useApp } from "../../components/AppContext";
import { SCurveChart } from "../../components/SCurveChart";
import { Button, EmptyState, Pill, RagBadge, Textarea, cx } from "../../components/ui";
import { deleteReport, saveReport, updateReportNarrative } from "../../db/actions";
import { db } from "../../db/db";
import type { ReportItemRow, ReportNarrative, StatusReport } from "../../db/types";
import { useSettings } from "../../hooks/data";
import { formatDate, formatDateTime, todayISO, weekStart } from "../../lib/dates";
import { exportPptx } from "../../lib/pptx";
import { buildReportData, newReport } from "../../lib/report";
import { useProject } from "../ProjectLayout";

export function ProjectReportsTab() {
  const { graph, snapshots } = useProject();
  const settings = useSettings();
  const navigate = useNavigate();
  const reports = useLiveQuery(() => db.reports.where({ projectId: graph.project.id }).toArray(), [graph.project.id]);
  const thisWeek = weekStart(todayISO());

  const generate = async () => {
    const r = newReport(graph, snapshots, todayISO(), settings.ragThresholds);
    await saveReport(r);
    navigate(r.id);
  };

  if (!reports) return null;
  const sorted = [...reports].sort((a, b) => b.createdAt - a.createdAt);
  const draftThisWeek = sorted.find((r) => r.week === thisWeek && !r.finalisedAt);

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">Weekly status reports</h2>
          <p className="text-sm text-muted">One click builds the report from live data; you only write the narrative.</p>
        </div>
        {draftThisWeek ? (
          <Button variant="primary" onClick={() => navigate(draftThisWeek.id)}>
            Continue this week's draft
          </Button>
        ) : (
          <Button variant="primary" onClick={generate}>
            Generate this week's report
          </Button>
        )}
      </div>
      <div className="mt-5">
        {sorted.length === 0 ? (
          <EmptyState title="No reports yet" body="Generate this week's report: RAG and reason, progress vs plan, S-curve, achievements, next week, milestones, top risks and issues, and decisions needed." />
        ) : (
          <ReportList reports={sorted} hrefFor={(r) => r.id} />
        )}
      </div>
    </div>
  );
}

export function ReportList({ reports, hrefFor, showProject }: { reports: StatusReport[]; hrefFor: (r: StatusReport) => string; showProject?: boolean }) {
  return (
    <ul className="divide-y divide-line rounded-card border border-line bg-surface">
      {reports.map((r) => (
        <li key={r.id}>
          <Link to={hrefFor(r)} className="flex items-center gap-3 px-4 py-3 text-sm hover:bg-sunken">
            <RagBadge status={r.data.rag} overridden={r.data.ragOverridden} size="sm" />
            <span className="min-w-0 flex-1 truncate">
              {showProject && <span className="font-medium">{r.data.projectName} · </span>}
              Week of {formatDate(r.week)}
            </span>
            <span className="text-xs text-muted tabular-nums">
              {r.data.actualPct.toFixed(1)}% / {r.data.plannedPct.toFixed(1)}%
            </span>
            {r.finalisedAt ? <Pill tone="green">Final</Pill> : <Pill tone="amber">Draft</Pill>}
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function ReportView() {
  const { reportId } = useParams();
  const { graph, snapshots } = useProject();
  const settings = useSettings();
  const navigate = useNavigate();
  const { notify } = useApp();
  const report = useLiveQuery(() => (reportId ? db.reports.get(reportId) : undefined), [reportId]);
  const [narrative, setNarrative] = useState<ReportNarrative | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    if (report && !narrative) setNarrative(report.narrative);
  }, [report, narrative]);

  // Save narrative edits shortly after typing stops.
  useEffect(() => {
    if (!report || !narrative || report.finalisedAt) return;
    if (JSON.stringify(narrative) === JSON.stringify(report.narrative)) return;
    const t = setTimeout(() => updateReportNarrative(report.id, narrative), 600);
    return () => clearTimeout(t);
  }, [narrative, report]);

  if (report === undefined) return null;
  if (!report || !narrative) return <p className="p-8 text-sm text-muted">Report not found.</p>;
  const d = report.data;
  const locked = !!report.finalisedAt;
  const set = (k: keyof ReportNarrative) => (e: React.ChangeEvent<HTMLTextAreaElement>) => setNarrative({ ...narrative, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-8">
      <div className="no-print mb-4 flex flex-wrap items-center gap-2">
        <Link to=".." relative="path" className="text-sm text-muted hover:text-ink">
          ← All reports
        </Link>
        <div className="ml-auto flex flex-wrap gap-2">
          {!locked && (
            <Button
              onClick={async () => {
                await saveReport({ ...report, narrative, data: buildReportData(graph, snapshots, todayISO(), settings.ragThresholds) });
                notify("Numbers refreshed from live data");
              }}
              title="Rebuild the numbers from today's data; your narrative is kept"
            >
              Refresh numbers
            </Button>
          )}
          <Button onClick={() => window.print()}>Export PDF</Button>
          <Button
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              try {
                await exportPptx({ ...report, narrative });
              } catch (e) {
                notify(e instanceof Error ? e.message : "Export failed", "error");
              } finally {
                setExporting(false);
              }
            }}
          >
            {exporting ? "Exporting…" : "Export PowerPoint"}
          </Button>
          {locked ? (
            <Button onClick={() => saveReport({ ...report, finalisedAt: null })}>Reopen</Button>
          ) : (
            <Button variant="primary" onClick={() => saveReport({ ...report, narrative, finalisedAt: Date.now() })}>
              Finalise
            </Button>
          )}
          <Button
            variant="danger"
            onClick={async () => {
              if (!confirm("Delete this report?")) return;
              await deleteReport(report.id);
              navigate("..", { relative: "path" });
            }}
          >
            Delete
          </Button>
        </div>
      </div>

      <article className="print-sheet flex flex-col gap-6 rounded-card border border-line bg-surface p-6 sm:p-8">
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-4">
          <div>
            <p className="text-xs text-muted">Weekly status report · {d.projectCode}</p>
            <h1 className="text-lg font-semibold">{d.projectName}</h1>
            <p className="text-sm text-muted">
              Week of {formatDate(report.week)} · data as of {formatDate(d.asOf)}
              {d.sponsor && ` · Sponsor: ${d.sponsor}`}
            </p>
          </div>
          <div className="text-right">
            <RagBadge status={d.rag} overridden={d.ragOverridden} />
            <p className="mt-1 text-xs text-muted">{locked ? `Finalised ${formatDateTime(report.finalisedAt)}` : "Draft"}</p>
          </div>
        </header>

        <Section title="Summary">
          <Narrative value={narrative.summary} onChange={set("summary")} locked={locked} rows={3} />
          <ul className="mt-2 text-xs text-muted">
            {d.ragReasons.map((r) => (
              <li key={r}>• {r}</li>
            ))}
          </ul>
        </Section>

        <Section title="Progress vs plan">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Actual" value={`${d.actualPct.toFixed(1)}%`} />
            <Stat label="Planned" value={`${d.plannedPct.toFixed(1)}%`} />
            <Stat label="Variance" value={`${d.variance > 0 ? "+" : ""}${d.variance.toFixed(1)}%`} tone={d.variance < 0 ? "text-amber" : undefined} />
            {d.baselinePlannedPct !== null && <Stat label="Baseline planned" value={`${d.baselinePlannedPct.toFixed(1)}%`} />}
          </div>
          <div className="mt-4 print-break">
            <SCurveChart points={d.curve} today={d.asOf} height={240} />
          </div>
          {d.phases.length > 0 && (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1.5 font-medium">Phase</th>
                  <th className="py-1.5 text-right font-medium">Planned</th>
                  <th className="py-1.5 text-right font-medium">Actual</th>
                </tr>
              </thead>
              <tbody>
                {d.phases.map((p) => (
                  <tr key={p.name} className="border-b border-line/60 last:border-0">
                    <td className="py-1.5">{p.name}</td>
                    <td className="py-1.5 text-right tabular-nums">{p.plannedPct.toFixed(1)}%</td>
                    <td className="py-1.5 text-right tabular-nums">{p.actualPct.toFixed(1)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="Achievements this week">
            <Narrative value={narrative.achievements} onChange={set("achievements")} locked={locked} rows={6} />
          </Section>
          <Section title="Next week">
            <Narrative value={narrative.nextWeek} onChange={set("nextWeek")} locked={locked} rows={6} />
          </Section>
        </div>

        <Section title="Milestones due (next 30 days)">
          <Rows rows={d.milestones} empty="None due." />
        </Section>
        <div className="grid gap-6 sm:grid-cols-2">
          <Section title="Top risks">
            <Rows rows={d.risks} empty="No open risks." />
          </Section>
          <Section title="Top issues">
            <Rows rows={d.issues} empty="No open issues." />
          </Section>
        </div>
        <Section title="Decisions needed">
          <Narrative value={narrative.decisionsNeeded} onChange={set("decisionsNeeded")} locked={locked} rows={3} />
        </Section>
      </article>
      {!locked && <p className="no-print mt-2 text-xs text-muted">Narrative fields save as you type. Numbers stay locked to the data captured when the report was generated.</p>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="print-break">
      <h2 className="mb-2 text-xs font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-md bg-sunken px-3 py-2">
      <p className={cx("text-lg font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  );
}

function Narrative({ value, onChange, locked, rows }: { value: string; onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void; locked: boolean; rows: number }) {
  if (locked) return <p className="text-sm whitespace-pre-wrap">{value || "—"}</p>;
  return (
    <>
      <Textarea value={value} onChange={onChange} rows={rows} className="no-print" />
      <p className="hidden text-sm whitespace-pre-wrap print:block">{value}</p>
    </>
  );
}

function Rows({ rows, empty }: { rows: ReportItemRow[]; empty: string }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <ul className="divide-y divide-line/60 text-sm">
      {rows.map((r, i) => (
        <li key={i} className="py-1.5">
          <div className="flex gap-2">
            <span className="min-w-0 flex-1 font-medium">{r.title}</span>
            <span className="text-xs whitespace-nowrap text-muted">{r.date}</span>
          </div>
          <p className="text-xs text-muted">
            {r.owner}
            {r.detail && ` · ${r.detail}`}
          </p>
        </li>
      ))}
    </ul>
  );
}
