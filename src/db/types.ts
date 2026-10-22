import type { WorkCalendar } from "../lib/calendar";
import type { ISODate } from "../lib/dates";

export type RagStatus = "Green" | "Amber" | "Red";
export const RAG_ORDER: Record<RagStatus, number> = { Green: 0, Amber: 1, Red: 2 };

export type ProjectStatus = "Active" | "On hold" | "Closed";

export interface RagOverride {
  status: RagStatus;
  reason: string;
  at: number;
}

export interface Project {
  id: string;
  name: string;
  /** Short unique code; also the backup file name. */
  code: string;
  sponsor: string;
  description: string;
  start: ISODate;
  end: ISODate;
  calendar: WorkCalendar;
  status: ProjectStatus;
  ragOverride: RagOverride | null;
  isSample?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Phase {
  id: string;
  projectId: string;
  name: string;
  order: number;
  /** Pinned weight in % within the project, or null to follow duration. */
  weight: number | null;
}

export type KanbanStatus = "To Do" | "In Progress" | "Blocked" | "Done";
export const KANBAN_COLUMNS: KanbanStatus[] = ["To Do", "In Progress", "Blocked", "Done"];

export interface Activity {
  id: string;
  projectId: string;
  phaseId: string;
  /** null for a main activity; the main activity's id for a sub-activity. */
  parentId: string | null;
  level: "main" | "sub";
  name: string;
  owner: string;
  /**
   * Sub-activities: their dates. Main activities: a placeholder plan that is
   * only used until the first sub-activity exists; after that the main
   * activity's dates are always derived from its subs.
   */
  start: ISODate;
  end: ISODate;
  order: number;
  /** Pinned weight in % within its group, or null to follow duration. */
  weight: number | null;
  /** Sub-activities only. Main activities are always calculated. */
  actualPct: number;
  kanbanStatus: KanbanStatus;
  blockedReason: string;
  notes: string;
  updatedAt: number;
}

export type SignoffStatus = "Pending" | "Submitted" | "Approved" | "Rejected";
export const SIGNOFF_STATUSES: SignoffStatus[] = ["Pending", "Submitted", "Approved", "Rejected"];

export interface Deliverable {
  id: string;
  name: string;
  link: string;
}

export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  date: ISODate;
  owner: string;
  signoff: SignoffStatus;
  deliverables: Deliverable[];
  updatedAt: number;
}

export interface Dependency {
  id: string;
  projectId: string;
  /** Activity or milestone id. */
  predecessorId: string;
  successorId: string;
  type: "FS";
  /**
   * When I chose "keep" on a slip warning: the predecessor's end at that
   * moment. The warning stays quiet until the predecessor moves again.
   */
  keptPredEnd: ISODate | null;
}

export interface BaselineItem {
  start: ISODate;
  end: ISODate;
  /** Effective weight in % within its group when the baseline was set. */
  weight: number;
}

export interface Baseline {
  id: string;
  projectId: string;
  setAt: number;
  reason: string;
  active: boolean;
  /** Keyed by activity, phase or milestone id. */
  items: Record<string, BaselineItem>;
  /** Project planned % on the day the baseline was set. */
  plannedPct: number;
}

export type RaidType = "R" | "A" | "I" | "D";
export const RAID_LABELS: Record<RaidType, string> = { R: "Risks", A: "Actions", I: "Issues", D: "Decisions" };
export const RAID_SINGULAR: Record<RaidType, string> = { R: "Risk", A: "Action", I: "Issue", D: "Decision" };

export const RAID_STATUSES: Record<RaidType, string[]> = {
  R: ["Open", "Mitigating", "Closed"],
  A: ["Open", "In progress", "Done"],
  I: ["Open", "In progress", "Resolved"],
  D: ["Pending", "Decided"],
};
/** Statuses that count as finished for each type. */
export const RAID_CLOSED: Record<RaidType, string[]> = {
  R: ["Closed"],
  A: ["Done"],
  I: ["Resolved"],
  D: ["Decided"],
};

export type Severity = "Low" | "Medium" | "High" | "Critical";
export const SEVERITIES: Severity[] = ["Low", "Medium", "High", "Critical"];

export interface RaidItem {
  id: string;
  projectId: string;
  type: RaidType;
  title: string;
  description: string;
  owner: string;
  due: ISODate;
  status: string;
  /** Risks: 1–5 each. */
  likelihood: number;
  impact: number;
  mitigation: string;
  /** Issues. */
  severity: Severity;
  resolution: string;
  /** Decisions. */
  decidedBy: string;
  decisionDate: ISODate | "";
  rationale: string;
  /** Activity or milestone id. */
  linkedId: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface ProgressSnapshot {
  /** `${projectId}|${phaseId or "project"}|${date}` */
  id: string;
  projectId: string;
  phaseId: string | null;
  date: ISODate;
  plannedPct: number;
  actualPct: number;
}

export interface RagHistoryEntry {
  /** `${projectId}|${weekStart}` */
  id: string;
  projectId: string;
  week: ISODate;
  status: RagStatus;
  reason: string;
  overridden: boolean;
}

export interface ReportNarrative {
  summary: string;
  achievements: string;
  nextWeek: string;
  decisionsNeeded: string;
}

export interface ReportItemRow {
  title: string;
  owner: string;
  date: string;
  detail: string;
}

export interface ReportData {
  asOf: ISODate;
  projectName: string;
  projectCode: string;
  sponsor: string;
  rag: RagStatus;
  ragReasons: string[];
  ragOverridden: boolean;
  plannedPct: number;
  actualPct: number;
  variance: number;
  baselinePlannedPct: number | null;
  phases: { name: string; plannedPct: number; actualPct: number }[];
  curve: { date: ISODate; planned: number; actual: number | null; baseline: number | null }[];
  achievements: ReportItemRow[];
  nextWeek: ReportItemRow[];
  milestones: ReportItemRow[];
  risks: ReportItemRow[];
  issues: ReportItemRow[];
  decisions: ReportItemRow[];
}

export interface StatusReport {
  id: string;
  projectId: string;
  week: ISODate;
  createdAt: number;
  updatedAt: number;
  finalisedAt: number | null;
  data: ReportData;
  narrative: ReportNarrative;
}

export interface RagThresholds {
  /** Amber when variance is worse than −amberVariance. */
  amberVariance: number;
  /** Red when variance is worse than −redVariance. */
  redVariance: number;
  /** Red when a milestone is overdue by more than this many days. */
  milestoneRedDays: number;
  /** Amber when an open risk scores at least this. */
  riskScore: number;
}

export const DEFAULT_THRESHOLDS: RagThresholds = {
  amberVariance: 5,
  redVariance: 10,
  milestoneRedDays: 7,
  riskScore: 15,
};

export interface Settings {
  id: "settings";
  myName: string;
  githubOwner: string;
  githubRepo: string;
  githubBranch: string;
  githubToken: string;
  autoBackup: boolean;
  lastBackupAt: number | null;
  lastBackupError: string | null;
  lastDailySnapshot: ISODate | null;
  /** Last time any project data changed; a backup is due when newer than lastBackupAt. */
  lastChangeAt: number;
  ragThresholds: RagThresholds;
}

export const DEFAULT_SETTINGS: Settings = {
  id: "settings",
  myName: "Me",
  githubOwner: "",
  githubRepo: "minipmo-data",
  githubBranch: "",
  githubToken: "",
  autoBackup: true,
  lastBackupAt: null,
  lastBackupError: null,
  lastDailySnapshot: null,
  lastChangeAt: 0,
  ragThresholds: DEFAULT_THRESHOLDS,
};

/** Everything that belongs to one project, as loaded for the views. */
export interface ProjectGraph {
  project: Project;
  phases: Phase[];
  activities: Activity[];
  milestones: Milestone[];
  dependencies: Dependency[];
  raid: RaidItem[];
  baseline: Baseline | null;
}
