import {
  RAG_ORDER,
  RAID_CLOSED,
  type Milestone,
  type ProjectGraph,
  type RagStatus,
  type RagThresholds,
  type RaidItem,
} from "../db/types";
import { diffDays, type ISODate } from "./dates";
import { round1 } from "./progress";

export interface RagResult {
  /** Status after any override. */
  status: RagStatus;
  /** Status from the rules alone. */
  calculated: RagStatus;
  overridden: boolean;
  overrideReason: string | null;
  /** Why the rules gave `calculated`, worst first. */
  reasons: string[];
}

export function isOpen(item: RaidItem): boolean {
  return !RAID_CLOSED[item.type].includes(item.status);
}

export function riskScore(item: RaidItem): number {
  return item.likelihood * item.impact;
}

export function milestoneOverdueDays(m: Milestone, today: ISODate): number {
  if (m.signoff === "Approved") return 0;
  return Math.max(0, diffDays(m.date, today));
}

function worse(a: RagStatus, b: RagStatus): RagStatus {
  return RAG_ORDER[b] > RAG_ORDER[a] ? b : a;
}

/** PRD RAG rules: any one rule triggers the worse status. */
export function calculateRag(
  graph: ProjectGraph,
  variance: number,
  today: ISODate,
  t: RagThresholds,
): RagResult {
  let status: RagStatus = "Green";
  const red: string[] = [];
  const amber: string[] = [];
  const v = round1(variance);

  if (v < -t.redVariance) red.push(`Schedule ${Math.abs(v).toFixed(1)}% behind plan (Red beyond −${t.redVariance}%)`);
  else if (v < -t.amberVariance) amber.push(`Schedule ${Math.abs(v).toFixed(1)}% behind plan (Amber beyond −${t.amberVariance}%)`);

  for (const m of graph.milestones) {
    const days = milestoneOverdueDays(m, today);
    if (days <= 0) continue;
    const text = `Milestone "${m.name}" overdue by ${days} day${days === 1 ? "" : "s"}`;
    if (days > t.milestoneRedDays) red.push(text);
    else amber.push(text);
  }

  for (const r of graph.raid) {
    if (!isOpen(r)) continue;
    if (r.type === "R" && riskScore(r) >= t.riskScore) amber.push(`Open risk "${r.title}" scored ${riskScore(r)}`);
    if (r.type === "I" && r.severity === "Critical") red.push(`Open critical issue "${r.title}"`);
  }

  if (amber.length) status = worse(status, "Amber");
  if (red.length) status = worse(status, "Red");
  const reasons = [...red, ...amber];
  if (reasons.length === 0) reasons.push(v >= 0 ? "On or ahead of plan, no overdue milestones or high risks" : `Within tolerance (${v.toFixed(1)}%), no overdue milestones or high risks`);

  const o = graph.project.ragOverride;
  return {
    status: o ? o.status : status,
    calculated: status,
    overridden: !!o,
    overrideReason: o?.reason ?? null,
    reasons,
  };
}

export function ragSummary(r: RagResult): string {
  return r.overridden ? `${r.overrideReason} (overridden; rules say ${r.calculated})` : r.reasons[0];
}
