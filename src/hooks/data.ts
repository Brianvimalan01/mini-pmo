import { useLiveQuery } from "dexie-react-hooks";
import { useMemo } from "react";
import { loadAllGraphs, loadGraph } from "../db/actions";
import { db, getSettings } from "../db/db";
import { DEFAULT_SETTINGS, type ProjectGraph, type Settings } from "../db/types";
import { todayISO } from "../lib/dates";
import { projectMetrics, type ProjectMetrics } from "../lib/metrics";

export function useSettings(): Settings {
  return useLiveQuery(() => getSettings(), []) ?? DEFAULT_SETTINGS;
}

/** undefined while loading, null if the project doesn't exist. */
export function useProjectGraph(projectId: string | undefined): ProjectGraph | null | undefined {
  return useLiveQuery(() => (projectId ? loadGraph(projectId) : null), [projectId]);
}

export function useAllGraphs(): ProjectGraph[] | undefined {
  return useLiveQuery(() => loadAllGraphs(), []);
}

export function useSnapshots(projectId: string | undefined) {
  return useLiveQuery(() => (projectId ? db.snapshots.where({ projectId }).toArray() : []), [projectId]) ?? [];
}

export function useMetrics(graph: ProjectGraph | null | undefined): ProjectMetrics | null {
  const settings = useSettings();
  const today = todayISO();
  return useMemo(() => (graph ? projectMetrics(graph, today, settings.ragThresholds) : null), [graph, today, settings.ragThresholds]);
}
