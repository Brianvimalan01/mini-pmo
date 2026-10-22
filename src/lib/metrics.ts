// Project-level numbers shared by the overview, dashboard and report.

import type { ProgressSnapshot, ProjectGraph, RagThresholds } from "../db/types";
import { addDays, type ISODate } from "./dates";
import { baselinePlannedAt, buildTree, curveDates, flatten, plannedAt, round1, type ProgressNode, type ProgressTree } from "./progress";
import { calculateRag, type RagResult } from "./rag";

export interface ProjectMetrics {
  tree: ProgressTree;
  plannedPct: number;
  actualPct: number;
  variance: number;
  rag: RagResult;
  baselinePlannedPct: number | null;
}

export function projectMetrics(graph: ProjectGraph, today: ISODate, thresholds: RagThresholds): ProjectMetrics {
  const tree = buildTree(graph, today);
  const variance = tree.root.actualPct - tree.root.plannedPct;
  return {
    tree,
    plannedPct: tree.root.plannedPct,
    actualPct: tree.root.actualPct,
    variance,
    rag: calculateRag(graph, variance, today, thresholds),
    baselinePlannedPct: graph.baseline ? baselinePlannedAt(tree.root, graph.baseline, today, tree.cal) : null,
  };
}

export interface CurvePoint {
  date: ISODate;
  planned: number;
  actual: number | null;
  baseline: number | null;
}

/**
 * S-curve for the project (phaseId null) or one phase. Planned and baseline
 * come from the plan; actual comes from stored daily snapshots, with today's
 * live value as the last point, so past points never move.
 */
export function sCurve(
  graph: ProjectGraph,
  tree: ProgressTree,
  snapshots: ProgressSnapshot[],
  today: ISODate,
  phaseId: string | null = null,
): CurvePoint[] {
  const node: ProgressNode | undefined = phaseId ? tree.byId.get(phaseId) : tree.root;
  if (!node) return [];
  const own = snapshots.filter((s) => s.phaseId === phaseId).sort((a, b) => (a.date < b.date ? -1 : 1));
  // The plan can run outside the project's own dates; draw all of it.
  let start = node.start ?? graph.project.start;
  let end = node.end ?? graph.project.end;
  for (const n of flatten(node)) {
    if (n.start && n.start < start) start = n.start;
    if (n.end && n.end > end) end = n.end;
  }
  if (graph.baseline) {
    for (const item of Object.values(graph.baseline.items)) if (item.end > end) end = item.end;
  }
  const dates = curveDates(start, end, [today, ...own.map((s) => s.date)]);

  const actualByDate = new Map(own.map((s) => [s.date, s.actualPct]));
  actualByDate.set(today, node.actualPct);

  let lastActual: number | null = null;
  return dates.map((date) => {
    let actual: number | null = null;
    if (date <= today) {
      // Between snapshots the actual line holds its last known value.
      if (actualByDate.has(date)) lastActual = actualByDate.get(date)!;
      actual = lastActual ?? (date < (own[0]?.date ?? today) ? null : 0);
    }
    return {
      date,
      planned: round1(plannedAt(node, date, tree.cal)),
      actual: actual === null ? null : round1(actual),
      baseline: graph.baseline ? round1(baselinePlannedAt(node, graph.baseline, date, tree.cal)) : null,
    };
  });
}

/** Snapshot rows for today: one for the project and one per phase. */
export function snapshotRows(graph: ProjectGraph, tree: ProgressTree, today: ISODate): ProgressSnapshot[] {
  const pid = graph.project.id;
  const rows: ProgressSnapshot[] = [
    { id: `${pid}|project|${today}`, projectId: pid, phaseId: null, date: today, plannedPct: round1(tree.root.plannedPct), actualPct: round1(tree.root.actualPct) },
  ];
  for (const ph of tree.root.children) {
    rows.push({ id: `${pid}|${ph.id}|${today}`, projectId: pid, phaseId: ph.id, date: today, plannedPct: round1(ph.plannedPct), actualPct: round1(ph.actualPct) });
  }
  return rows;
}

/** Items not touched for 7 days are stale (PRD 11). */
export function isStale(updatedAt: number, now = Date.now()): boolean {
  return now - updatedAt > 7 * 86_400_000;
}

export function nextMilestone(graph: ProjectGraph, today: ISODate) {
  return [...graph.milestones]
    .filter((m) => m.signoff !== "Approved")
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .find((m) => m.date >= addDays(today, -365));
}
