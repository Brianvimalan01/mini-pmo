import { NavLink, Outlet, useOutletContext, useParams } from "react-router";
import { RagBadge, cx } from "../components/ui";
import type { ProgressSnapshot, ProjectGraph } from "../db/types";
import { useMetrics, useProjectGraph, useSnapshots } from "../hooks/data";
import type { ProjectMetrics } from "../lib/metrics";
import { fmtPct } from "../lib/progress";

export interface ProjectContext {
  graph: ProjectGraph;
  metrics: ProjectMetrics;
  snapshots: ProgressSnapshot[];
}

export function useProject(): ProjectContext {
  return useOutletContext<ProjectContext>();
}

const TABS = [
  { to: "", label: "Overview", end: true },
  { to: "timeline", label: "Timeline" },
  { to: "board", label: "Board" },
  { to: "raid", label: "RAID" },
  { to: "reports", label: "Reports" },
];

export function ProjectLayout() {
  const { projectId } = useParams();
  const graph = useProjectGraph(projectId);
  const metrics = useMetrics(graph);
  const snapshots = useSnapshots(projectId);

  if (graph === undefined) return null;
  if (graph === null || !metrics) {
    return <p className="p-8 text-sm text-muted">This project doesn't exist any more.</p>;
  }

  return (
    <div className="flex min-h-full flex-col">
      <header className="no-print border-b border-line bg-surface px-4 pt-4 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">{graph.project.name}</h1>
          <RagBadge status={metrics.rag.status} overridden={metrics.rag.overridden} size="sm" />
          <span className="text-xs text-muted">
            {graph.project.code} · {fmtPct(metrics.actualPct)} actual vs {fmtPct(metrics.plannedPct)} planned
            {graph.project.status !== "Active" && ` · ${graph.project.status}`}
          </span>
        </div>
        <nav className="mt-3 -mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <NavLink
              key={t.to}
              to={t.to}
              end={t.end}
              className={({ isActive }) =>
                cx("border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap", isActive ? "border-accent text-ink" : "border-transparent text-muted hover:text-ink")
              }
            >
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <div className="min-w-0 flex-1">
        <Outlet context={{ graph, metrics, snapshots } satisfies ProjectContext} />
      </div>
    </div>
  );
}
