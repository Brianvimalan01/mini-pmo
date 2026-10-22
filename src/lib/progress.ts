// Weightage, planned % and roll-up (PRD: "Progress, weightage and RAG logic").
// Everything here is pure so the timeline, board, S-curve and report all
// read the same numbers.

import type { Activity, Baseline, Phase, ProjectGraph } from "../db/types";
import { calendarIndex, type CalendarIndex } from "./calendar";
import { addDays, maxDate, minDate, toDay, type ISODate } from "./dates";

export interface WeightInput {
  /** Working days; drives the default weight. */
  duration: number;
  /** Pinned weight in %, or null. */
  pinned: number | null;
}

/**
 * Effective weights (in %, totalling 100) for one group. Pinned weights are
 * kept; the rest of the 100% is shared among unpinned items by duration.
 */
export function resolveWeights(items: WeightInput[]): number[] {
  if (items.length === 0) return [];
  const pinnedSum = items.reduce((s, i) => s + (i.pinned ?? 0), 0);
  const unpinned = items.filter((i) => i.pinned === null);

  // Every weight pinned, or pins already use up 100%: scale the pins to 100.
  if (unpinned.length === 0 || pinnedSum >= 100) {
    if (pinnedSum <= 0) return items.map(() => 100 / items.length);
    return items.map((i) => ((i.pinned ?? 0) / pinnedSum) * 100);
  }

  const remaining = 100 - pinnedSum;
  const durSum = unpinned.reduce((s, i) => s + Math.max(0, i.duration), 0);
  return items.map((i) => {
    if (i.pinned !== null) return i.pinned;
    return durSum > 0 ? (Math.max(0, i.duration) / durSum) * remaining : remaining / unpinned.length;
  });
}

/** The largest weight an item may be pinned to without pushing the group past 100%. */
export function maxPinnable(items: WeightInput[], index: number): number {
  const others = items.reduce((s, it, i) => s + (i !== index ? it.pinned ?? 0 : 0), 0);
  return Math.max(0, 100 - others);
}

/** Planned % for a span as of a date (start-of-day). */
export function plannedPct(start: ISODate, end: ISODate, asOf: ISODate, cal: CalendarIndex): number {
  if (asOf <= start) return 0;
  if (asOf > end) return 100;
  const total = cal.workingDaysBetween(start, end);
  if (total <= 0) return 100;
  const elapsed = cal.countDays(toDay(start), toDay(asOf) - 1);
  return Math.min(100, (elapsed / total) * 100);
}

export type NodeKind = "project" | "phase" | "main" | "sub";

export interface ProgressNode {
  id: string;
  kind: NodeKind;
  name: string;
  /** null when the node has nothing scheduled yet (empty phase). */
  start: ISODate | null;
  end: ISODate | null;
  duration: number;
  /** Effective weight in % within the parent group. */
  weight: number;
  pinned: boolean;
  plannedPct: number;
  actualPct: number;
  children: ProgressNode[];
  activity?: Activity;
  phase?: Phase;
}

export interface ProgressTree {
  root: ProgressNode;
  byId: Map<string, ProgressNode>;
  cal: CalendarIndex;
}

interface Span {
  start: ISODate | null;
  end: ISODate | null;
}

function spanOf(spans: Span[]): Span {
  let start: ISODate | null = null;
  let end: ISODate | null = null;
  for (const s of spans) {
    if (s.start) start = start ? minDate(start, s.start) : s.start;
    if (s.end) end = end ? maxDate(end, s.end) : s.end;
  }
  return { start, end };
}

function rollUp(children: ProgressNode[], key: "plannedPct" | "actualPct"): number {
  return children.reduce((s, c) => s + (c.weight / 100) * c[key], 0);
}

function byOrder<T extends { order: number }>(a: T, b: T) {
  return a.order - b.order;
}

/** Build the weighted Phase → Main → Sub tree for a project as of a date. */
export function buildTree(graph: ProjectGraph, asOf: ISODate): ProgressTree {
  const cal = calendarIndex(graph.project.calendar);
  const byId = new Map<string, ProgressNode>();
  const subsByMain = new Map<string, Activity[]>();
  const mainsByPhase = new Map<string, Activity[]>();
  for (const a of graph.activities) {
    if (a.level === "sub" && a.parentId) {
      const list = subsByMain.get(a.parentId) ?? [];
      list.push(a);
      subsByMain.set(a.parentId, list);
    } else if (a.level === "main") {
      const list = mainsByPhase.get(a.phaseId) ?? [];
      list.push(a);
      mainsByPhase.set(a.phaseId, list);
    }
  }

  const weigh = (nodes: ProgressNode[], pins: (number | null)[]) => {
    const w = resolveWeights(nodes.map((n, i) => ({ duration: n.duration, pinned: pins[i] })));
    nodes.forEach((n, i) => {
      n.weight = w[i];
      n.pinned = pins[i] !== null;
    });
  };

  const leaf = (a: Activity, kind: "main" | "sub"): ProgressNode => ({
    id: a.id,
    kind,
    name: a.name,
    start: a.start,
    end: a.end,
    duration: cal.workingDaysBetween(a.start, a.end),
    weight: 0,
    pinned: false,
    plannedPct: plannedPct(a.start, a.end, asOf, cal),
    actualPct: kind === "sub" ? clampPct(a.actualPct) : 0,
    children: [],
    activity: a,
  });

  const phases = [...graph.phases].sort(byOrder).map((phase): ProgressNode => {
    const mains = (mainsByPhase.get(phase.id) ?? []).sort(byOrder).map((main): ProgressNode => {
      const subs = (subsByMain.get(main.id) ?? []).sort(byOrder).map((s) => leaf(s, "sub"));
      if (subs.length === 0) return leaf(main, "main");
      weigh(subs, subs.map((s) => s.activity!.weight));
      const span = spanOf(subs);
      return {
        id: main.id,
        kind: "main",
        name: main.name,
        start: span.start,
        end: span.end,
        duration: span.start && span.end ? cal.workingDaysBetween(span.start, span.end) : 0,
        weight: 0,
        pinned: false,
        plannedPct: rollUp(subs, "plannedPct"),
        actualPct: rollUp(subs, "actualPct"),
        children: subs,
        activity: main,
      };
    });
    weigh(mains, mains.map((m) => m.activity!.weight));
    const span = spanOf(mains);
    return {
      id: phase.id,
      kind: "phase",
      name: phase.name,
      start: span.start,
      end: span.end,
      duration: span.start && span.end ? cal.workingDaysBetween(span.start, span.end) : 0,
      weight: 0,
      pinned: false,
      plannedPct: rollUp(mains, "plannedPct"),
      actualPct: rollUp(mains, "actualPct"),
      children: mains,
      phase,
    };
  });
  weigh(phases, phases.map((p) => p.phase!.weight));

  const root: ProgressNode = {
    id: graph.project.id,
    kind: "project",
    name: graph.project.name,
    start: graph.project.start,
    end: graph.project.end,
    duration: cal.workingDaysBetween(graph.project.start, graph.project.end),
    weight: 100,
    pinned: false,
    plannedPct: rollUp(phases, "plannedPct"),
    actualPct: rollUp(phases, "actualPct"),
    children: phases,
  };

  const index = (n: ProgressNode) => {
    byId.set(n.id, n);
    n.children.forEach(index);
  };
  index(root);
  return { root, byId, cal };
}

export function clampPct(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}

/** Round to one decimal place, as shown everywhere. */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

export function fmtPct(n: number): string {
  return `${round1(n).toFixed(1)}%`;
}

export function fmtVariance(n: number): string {
  const r = round1(n);
  if (r === 0) return "on plan";
  return r < 0 ? `−${Math.abs(r).toFixed(1)}% behind plan` : `+${r.toFixed(1)}% ahead of plan`;
}

/**
 * Planned % for a node as of any date, reusing the tree's weights. Used to
 * draw the planned S-curve without rebuilding the tree for every day.
 */
export function plannedAt(node: ProgressNode, asOf: ISODate, cal: CalendarIndex): number {
  if (node.children.length === 0) {
    if (!node.start || !node.end) return 0;
    return plannedPct(node.start, node.end, asOf, cal);
  }
  return node.children.reduce((s, c) => s + (c.weight / 100) * plannedAt(c, asOf, cal), 0);
}

/**
 * Baseline planned % for a node as of a date: the same formula on the
 * baseline's frozen dates and weights. Nodes added after the baseline
 * weren't in the agreed plan, so they contribute nothing.
 */
export function baselinePlannedAt(
  node: ProgressNode,
  baseline: Baseline,
  asOf: ISODate,
  cal: CalendarIndex,
): number {
  const leafPct = (id: string) => {
    const item = baseline.items[id];
    return item ? plannedPct(item.start, item.end, asOf, cal) : 0;
  };
  const walk = (n: ProgressNode): number => {
    const children = n.children.filter((c) => baseline.items[c.id]);
    if (children.length === 0) return n.kind === "project" ? 0 : leafPct(n.id);
    return children.reduce((s, c) => s + (baseline.items[c.id].weight / 100) * walk(c), 0);
  };
  return walk(node);
}

/** Snapshot of dates and effective weights for a new baseline. */
export function baselineItems(tree: ProgressTree, graph: ProjectGraph): Record<string, { start: ISODate; end: ISODate; weight: number }> {
  const items: Record<string, { start: ISODate; end: ISODate; weight: number }> = {};
  for (const node of tree.byId.values()) {
    if (node.kind === "project" || !node.start || !node.end) continue;
    items[node.id] = { start: node.start, end: node.end, weight: node.weight };
  }
  for (const m of graph.milestones) items[m.id] = { start: m.date, end: m.date, weight: 0 };
  return items;
}

/** Days between the current and baseline end (positive = later than plan). */
export function slipDays(node: ProgressNode, baseline: Baseline | null): number | null {
  const item = baseline?.items[node.id];
  if (!item || !node.end) return null;
  return toDay(node.end) - toDay(item.end);
}

/** Dates to sample a curve on: daily for short spans, otherwise weekly, always including `extra`. */
export function curveDates(start: ISODate, end: ISODate, extra: ISODate[] = []): ISODate[] {
  const span = toDay(end) - toDay(start);
  const step = span > 120 ? 7 : 1;
  const out = new Set<ISODate>();
  for (let d = start; d <= end; d = addDays(d, step)) out.add(d);
  out.add(end);
  // The curve reaches 100% the day after the last working day.
  out.add(addDays(end, 1));
  for (const e of extra) if (e >= start && e <= addDays(end, 1)) out.add(e);
  return [...out].sort();
}

/** Walk the tree depth-first. */
export function flatten(node: ProgressNode): ProgressNode[] {
  return [node, ...node.children.flatMap(flatten)];
}
