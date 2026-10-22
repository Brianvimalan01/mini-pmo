import type { Activity, Dependency, Milestone } from "../db/types";
import type { CalendarIndex } from "./calendar";
import { addDays, diffDays, type ISODate } from "./dates";
import type { ProgressTree } from "./progress";

export interface Endpoint {
  id: string;
  name: string;
  start: ISODate;
  end: ISODate;
  kind: "main" | "sub" | "milestone";
}

/** Current dates for every activity and milestone that can be linked. */
export function endpoints(tree: ProgressTree, milestones: Milestone[]): Map<string, Endpoint> {
  const map = new Map<string, Endpoint>();
  for (const n of tree.byId.values()) {
    if ((n.kind === "main" || n.kind === "sub") && n.start && n.end) {
      map.set(n.id, { id: n.id, name: n.name, start: n.start, end: n.end, kind: n.kind });
    }
  }
  for (const m of milestones) map.set(m.id, { id: m.id, name: m.name, start: m.date, end: m.date, kind: "milestone" });
  return map;
}

/** Does adding pred → succ close a loop? */
export function createsCycle(deps: Pick<Dependency, "predecessorId" | "successorId">[], predId: string, succId: string): boolean {
  if (predId === succId) return true;
  const next = new Map<string, string[]>();
  for (const d of deps) {
    const list = next.get(d.predecessorId) ?? [];
    list.push(d.successorId);
    next.set(d.predecessorId, list);
  }
  // A loop exists if pred is already reachable from succ.
  const seen = new Set<string>();
  const stack = [succId];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === predId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(next.get(id) ?? []));
  }
  return false;
}

export type LinkCheck = { ok: true } | { ok: false; message: string };

export function canLink(
  deps: Dependency[],
  activities: Activity[],
  predId: string,
  succId: string,
): LinkCheck {
  if (predId === succId) return { ok: false, message: "An item can't depend on itself." };
  if (deps.some((d) => d.predecessorId === predId && d.successorId === succId)) {
    return { ok: false, message: "That link already exists." };
  }
  const byId = new Map(activities.map((a) => [a.id, a]));
  const p = byId.get(predId);
  const s = byId.get(succId);
  if ((p?.parentId && p.parentId === succId) || (s?.parentId && s.parentId === predId)) {
    return { ok: false, message: "A main activity and its own sub-activity can't be linked; their dates are already tied together." };
  }
  if (createsCycle(deps, predId, succId)) {
    return { ok: false, message: "That link would create a circular dependency: the successor already leads back to the predecessor." };
  }
  return { ok: true };
}

/**
 * Finish-to-start: the successor may start once the predecessor has finished.
 * A milestone finishes on its date, so a successor may start that same day.
 */
export function earliestStart(pred: Endpoint, cal: CalendarIndex): ISODate {
  return pred.kind === "milestone" ? cal.onOrAfter(pred.end) : cal.onOrAfter(addDays(pred.end, 1));
}

export interface Conflict {
  dependency: Dependency;
  predecessor: Endpoint;
  successor: Endpoint;
  earliestStart: ISODate;
  /** Calendar days the successor would need to move. */
  slipDays: number;
}

export function conflicts(deps: Dependency[], points: Map<string, Endpoint>, cal: CalendarIndex): Conflict[] {
  const out: Conflict[] = [];
  for (const d of deps) {
    const p = points.get(d.predecessorId);
    const s = points.get(d.successorId);
    if (!p || !s) continue;
    const earliest = earliestStart(p, cal);
    if (s.start >= earliest) continue;
    if (d.keptPredEnd && d.keptPredEnd === p.end) continue;
    out.push({ dependency: d, predecessor: p, successor: s, earliestStart: earliest, slipDays: diffDays(s.start, earliest) });
  }
  return out;
}

/**
 * New dates for a shifted item: it starts on `newStart` and keeps the same
 * number of working days.
 */
export function shiftKeepingDuration(start: ISODate, end: ISODate, newStart: ISODate, cal: CalendarIndex): { start: ISODate; end: ISODate } {
  const s = cal.onOrAfter(newStart);
  const wd = Math.max(1, cal.workingDaysBetween(start, end));
  return { start: s, end: cal.addWorkingDays(s, wd - 1) };
}
