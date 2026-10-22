import Dexie, { type EntityTable } from "dexie";
import {
  DEFAULT_SETTINGS,
  type Activity,
  type Baseline,
  type Dependency,
  type Milestone,
  type Phase,
  type ProgressSnapshot,
  type Project,
  type RagHistoryEntry,
  type RaidItem,
  type Settings,
  type StatusReport,
} from "./types";

export class MiniPmoDB extends Dexie {
  projects!: EntityTable<Project, "id">;
  phases!: EntityTable<Phase, "id">;
  activities!: EntityTable<Activity, "id">;
  milestones!: EntityTable<Milestone, "id">;
  dependencies!: EntityTable<Dependency, "id">;
  baselines!: EntityTable<Baseline, "id">;
  raid!: EntityTable<RaidItem, "id">;
  snapshots!: EntityTable<ProgressSnapshot, "id">;
  ragHistory!: EntityTable<RagHistoryEntry, "id">;
  reports!: EntityTable<StatusReport, "id">;
  settings!: EntityTable<Settings, "id">;

  constructor(name = "minipmo") {
    super(name);
    this.version(1).stores({
      projects: "id, code",
      phases: "id, projectId",
      activities: "id, projectId, phaseId, parentId",
      milestones: "id, projectId",
      dependencies: "id, projectId",
      baselines: "id, projectId",
      raid: "id, projectId, type",
      snapshots: "id, projectId, date",
      ragHistory: "id, projectId",
      reports: "id, projectId",
      settings: "id",
    });
  }
}

export const db = new MiniPmoDB();

/** Tables that hold project data (everything except settings). */
export const PROJECT_TABLES = [
  "phases",
  "activities",
  "milestones",
  "dependencies",
  "baselines",
  "raid",
  "snapshots",
  "ragHistory",
  "reports",
] as const;
export type ProjectTable = (typeof PROJECT_TABLES)[number];

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get("settings");
  return { ...DEFAULT_SETTINGS, ...s, ragThresholds: { ...DEFAULT_SETTINGS.ragThresholds, ...s?.ragThresholds } };
}

export async function updateSettings(patch: Partial<Settings>): Promise<void> {
  const current = await getSettings();
  await db.settings.put({ ...current, ...patch, id: "settings" });
}

export function newId(): string {
  return crypto.randomUUID();
}
