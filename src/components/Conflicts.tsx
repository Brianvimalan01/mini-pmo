import { useMemo } from "react";
import { keepDependencyConflict, shiftSuccessor } from "../db/actions";
import type { ProjectGraph } from "../db/types";
import { formatDate } from "../lib/dates";
import { conflicts, endpoints, type Conflict } from "../lib/dependencies";
import type { ProgressTree } from "../lib/progress";
import { Button } from "./ui";

export function useConflicts(graph: ProjectGraph, tree: ProgressTree): Conflict[] {
  return useMemo(() => conflicts(graph.dependencies, endpoints(tree, graph.milestones), tree.cal), [graph.dependencies, graph.milestones, tree]);
}

/** Knock-on warnings: shift the successor, or keep its dates. */
export function ConflictList({ items, compact }: { items: Conflict[]; compact?: boolean }) {
  if (items.length === 0) return null;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((c) => (
        <li key={c.dependency.id} className="rounded-md border border-amber/40 bg-amber-soft px-3 py-2 text-sm text-amber">
          <p>
            <strong>{c.successor.name}</strong> starts {formatDate(c.successor.start)} but depends on <strong>{c.predecessor.name}</strong>, which{" "}
            {c.predecessor.kind === "milestone" ? "is due" : "finishes"} {formatDate(c.predecessor.end)}.
            {!compact && ` Shifting moves it ${c.slipDays} day${c.slipDays === 1 ? "" : "s"} to ${formatDate(c.earliestStart)}.`}
          </p>
          <div className="mt-1.5 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => shiftSuccessor(c.successor.id, c.earliestStart)}>
              Shift to {formatDate(c.earliestStart)}
            </Button>
            <Button size="sm" onClick={() => keepDependencyConflict(c.dependency.id, c.predecessor.end)}>
              Keep dates
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
