import { newId } from "../db/db";
import {
  type ProgressSnapshot,
  type ProjectGraph,
  type RagThresholds,
  type ReportData,
  type ReportItemRow,
  type ReportNarrative,
  type StatusReport,
} from "../db/types";
import { addDays, formatDate, weekStart, type ISODate } from "./dates";
import { projectMetrics, sCurve } from "./metrics";
import { round1 } from "./progress";
import { isOpen, milestoneOverdueDays, riskScore } from "./rag";

const WEEK_MS = 7 * 86_400_000;

/** Numbers and lists for a weekly report, frozen at generation time. */
export function buildReportData(
  graph: ProjectGraph,
  snapshots: ProgressSnapshot[],
  today: ISODate,
  thresholds: RagThresholds,
  now = Date.now(),
): ReportData {
  const m = projectMetrics(graph, today, thresholds);
  const subs = graph.activities.filter((a) => a.level === "sub");
  const mainName = new Map(graph.activities.filter((a) => a.level === "main").map((a) => [a.id, a.name]));
  const nextWeekEnd = addDays(today, 7);

  const achievements: ReportItemRow[] = subs
    .filter((s) => s.kanbanStatus === "Done" && now - s.updatedAt <= WEEK_MS)
    .map((s) => ({ title: s.name, owner: s.owner, date: formatDate(s.end), detail: mainName.get(s.parentId ?? "") ?? "" }));

  const nextWeek: ReportItemRow[] = subs
    .filter((s) => s.kanbanStatus !== "Done" && s.start <= nextWeekEnd && s.end >= today)
    .sort((a, b) => (a.end < b.end ? -1 : 1))
    .map((s) => ({
      title: s.name,
      owner: s.owner,
      date: `due ${formatDate(s.end)}`,
      detail: s.kanbanStatus === "Blocked" ? `Blocked: ${s.blockedReason}` : `${Math.round(s.actualPct)}% done`,
    }));

  const milestones: ReportItemRow[] = graph.milestones
    .filter((ms) => ms.signoff !== "Approved" && ms.date <= addDays(today, 30))
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((ms) => {
      const overdue = milestoneOverdueDays(ms, today);
      return {
        title: ms.name,
        owner: ms.owner,
        date: formatDate(ms.date),
        detail: overdue > 0 ? `Overdue by ${overdue} days · ${ms.signoff}` : ms.signoff,
      };
    });

  const open = graph.raid.filter(isOpen);
  const risks = open
    .filter((r) => r.type === "R")
    .sort((a, b) => riskScore(b) - riskScore(a))
    .slice(0, 5)
    .map((r) => ({ title: r.title, owner: r.owner, date: formatDate(r.due), detail: `Score ${riskScore(r)} · ${r.mitigation || "no mitigation yet"}` }));
  const sevRank = { Critical: 0, High: 1, Medium: 2, Low: 3 };
  const issues = open
    .filter((r) => r.type === "I")
    .sort((a, b) => sevRank[a.severity] - sevRank[b.severity])
    .slice(0, 5)
    .map((r) => ({ title: r.title, owner: r.owner, date: formatDate(r.due), detail: `${r.severity}${r.description ? ` · ${r.description}` : ""}` }));
  const decisions = open
    .filter((r) => r.type === "D")
    .sort((a, b) => (a.due < b.due ? -1 : 1))
    .map((r) => ({ title: r.title, owner: r.owner, date: `needed by ${formatDate(r.due)}`, detail: r.rationale }));

  return {
    asOf: today,
    projectName: graph.project.name,
    projectCode: graph.project.code,
    sponsor: graph.project.sponsor,
    rag: m.rag.status,
    ragReasons: m.rag.overridden ? [`${m.rag.overrideReason} (overridden; rules say ${m.rag.calculated})`, ...m.rag.reasons] : m.rag.reasons,
    ragOverridden: m.rag.overridden,
    plannedPct: round1(m.plannedPct),
    actualPct: round1(m.actualPct),
    variance: round1(m.variance),
    baselinePlannedPct: m.baselinePlannedPct === null ? null : round1(m.baselinePlannedPct),
    phases: m.tree.root.children.map((p) => ({ name: p.name, plannedPct: round1(p.plannedPct), actualPct: round1(p.actualPct) })),
    curve: sCurve(graph, m.tree, snapshots, today),
    achievements,
    nextWeek,
    milestones,
    risks,
    issues,
    decisions,
  };
}

function bullets(rows: ReportItemRow[], fallback: string): string {
  return rows.length ? rows.map((r) => `• ${r.title}`).join("\n") : fallback;
}

export function defaultNarrative(data: ReportData, graph: ProjectGraph): ReportNarrative {
  const rag = projectRagLine(data);
  return {
    summary: rag,
    achievements: bullets(data.achievements, "• "),
    nextWeek: bullets(data.nextWeek.slice(0, 8), "• "),
    decisionsNeeded: data.decisions.length
      ? data.decisions.map((d) => `• ${d.title} (${d.date})`).join("\n")
      : graph.raid.some((r) => r.type === "D") ? "No open decisions." : "• ",
  };
}

function projectRagLine(data: ReportData): string {
  return `${data.rag}: ${data.ragReasons[0]}. Actual ${data.actualPct.toFixed(1)}% against ${data.plannedPct.toFixed(1)}% planned.`;
}

export function newReport(graph: ProjectGraph, snapshots: ProgressSnapshot[], today: ISODate, thresholds: RagThresholds): StatusReport {
  const data = buildReportData(graph, snapshots, today, thresholds);
  const now = Date.now();
  return {
    id: newId(),
    projectId: graph.project.id,
    week: weekStart(today),
    createdAt: now,
    updatedAt: now,
    finalisedAt: null,
    data,
    narrative: defaultNarrative(data, graph),
  };
}
