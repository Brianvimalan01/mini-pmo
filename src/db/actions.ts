// Every write to project data goes through here, so "last updated" stamps,
// cascades and the backup's change marker stay consistent.

import { calendarIndex, type WorkCalendar } from "../lib/calendar";
import { addDays, diffDays, todayISO, type ISODate } from "../lib/dates";
import { shiftKeepingDuration } from "../lib/dependencies";
import { baselineItems, buildTree } from "../lib/progress";
import { db, getSettings, newId, PROJECT_TABLES, updateSettings } from "./db";
import {
  RAID_STATUSES,
  type Activity,
  type Baseline,
  type KanbanStatus,
  type Milestone,
  type Phase,
  type Project,
  type ProjectGraph,
  type RagStatus,
  type RaidItem,
  type RaidType,
  type ReportNarrative,
  type StatusReport,
} from "./types";

// ---------------------------------------------------------------- change marker

let pending: ReturnType<typeof setTimeout> | null = null;
let suspended = 0;

/** Mark that project data changed; the backup manager watches this. */
function markChanged() {
  if (suspended > 0 || pending) return;
  pending = setTimeout(() => {
    pending = null;
    void updateSettings({ lastChangeAt: Date.now() });
  }, 50);
}

for (const name of ["projects", ...PROJECT_TABLES] as const) {
  const table = db.table(name);
  table.hook("creating", markChanged);
  table.hook("updating", markChanged);
  table.hook("deleting", markChanged);
}

/** Run writes without marking a change (used by restore). */
export async function withoutChangeTracking<T>(fn: () => Promise<T>): Promise<T> {
  suspended++;
  try {
    return await fn();
  } finally {
    suspended--;
  }
}

// ---------------------------------------------------------------- loading

export async function loadGraph(projectId: string): Promise<ProjectGraph | null> {
  const project = await db.projects.get(projectId);
  if (!project) return null;
  const [phases, activities, milestones, dependencies, raid, baselines] = await Promise.all([
    db.phases.where({ projectId }).toArray(),
    db.activities.where({ projectId }).toArray(),
    db.milestones.where({ projectId }).toArray(),
    db.dependencies.where({ projectId }).toArray(),
    db.raid.where({ projectId }).toArray(),
    db.baselines.where({ projectId }).toArray(),
  ]);
  return { project, phases, activities, milestones, dependencies, raid, baseline: baselines.find((b) => b.active) ?? null };
}

export async function loadAllGraphs(): Promise<ProjectGraph[]> {
  const [projects, phases, activities, milestones, dependencies, raid, baselines] = await Promise.all([
    db.projects.toArray(),
    db.phases.toArray(),
    db.activities.toArray(),
    db.milestones.toArray(),
    db.dependencies.toArray(),
    db.raid.toArray(),
    db.baselines.toArray(),
  ]);
  const group = <T extends { projectId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) {
      const list = m.get(r.projectId) ?? [];
      list.push(r);
      m.set(r.projectId, list);
    }
    return m;
  };
  const ph = group(phases), ac = group(activities), mi = group(milestones), de = group(dependencies), ra = group(raid), ba = group(baselines);
  return projects
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => ({
      project,
      phases: ph.get(project.id) ?? [],
      activities: ac.get(project.id) ?? [],
      milestones: mi.get(project.id) ?? [],
      dependencies: de.get(project.id) ?? [],
      raid: ra.get(project.id) ?? [],
      baseline: (ba.get(project.id) ?? []).find((b) => b.active) ?? null,
    }));
}

// ---------------------------------------------------------------- projects

export interface NewProjectInput {
  name: string;
  code: string;
  sponsor: string;
  description: string;
  start: ISODate;
  end: ISODate;
  calendar: WorkCalendar;
  phases: { name: string; mains: { name: string; start: ISODate; end: ISODate }[] }[];
  milestones: { name: string; date: ISODate }[];
  isSample?: boolean;
}

export function sanitizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

export async function isCodeTaken(code: string, exceptId?: string): Promise<boolean> {
  const hit = await db.projects.where({ code: sanitizeCode(code) }).first();
  return !!hit && hit.id !== exceptId;
}

export async function createProject(input: NewProjectInput): Promise<string> {
  const settings = await getSettings();
  const now = Date.now();
  const id = newId();
  const project: Project = {
    id,
    name: input.name.trim(),
    code: sanitizeCode(input.code),
    sponsor: input.sponsor.trim(),
    description: input.description.trim(),
    start: input.start,
    end: input.end,
    calendar: input.calendar,
    status: "Active",
    ragOverride: null,
    isSample: input.isSample,
    createdAt: now,
    updatedAt: now,
  };
  const phases: Phase[] = [];
  const activities: Activity[] = [];
  input.phases.forEach((p, pi) => {
    const phaseId = newId();
    phases.push({ id: phaseId, projectId: id, name: p.name.trim() || `Phase ${pi + 1}`, order: pi, weight: null });
    p.mains.forEach((m, mi) => {
      activities.push(blankActivity({ projectId: id, phaseId, name: m.name, start: m.start, end: m.end, order: mi, owner: settings.myName }));
    });
  });
  const milestones: Milestone[] = input.milestones.map((m) => ({
    id: newId(),
    projectId: id,
    name: m.name,
    date: m.date,
    owner: settings.myName,
    signoff: "Pending",
    deliverables: [],
    updatedAt: now,
  }));
  await db.transaction("rw", [db.projects, db.phases, db.activities, db.milestones], async () => {
    await db.projects.add(project);
    await db.phases.bulkAdd(phases);
    await db.activities.bulkAdd(activities);
    await db.milestones.bulkAdd(milestones);
  });
  return id;
}

export function blankActivity(p: Pick<Activity, "projectId" | "phaseId" | "name" | "start" | "end" | "order" | "owner"> & Partial<Activity>): Activity {
  return {
    id: newId(),
    parentId: null,
    level: "main",
    weight: null,
    actualPct: 0,
    kanbanStatus: "To Do",
    blockedReason: "",
    notes: "",
    updatedAt: Date.now(),
    ...p,
  };
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteProject(id: string): Promise<void> {
  await db.transaction("rw", [db.projects, ...PROJECT_TABLES.map((t) => db.table(t))], async () => {
    await db.projects.delete(id);
    for (const t of PROJECT_TABLES) await db.table(t).where({ projectId: id }).delete();
  });
}

export async function setRagOverride(projectId: string, status: RagStatus, reason: string): Promise<void> {
  await updateProject(projectId, { ragOverride: { status, reason: reason.trim(), at: Date.now() } });
}

export async function clearRagOverride(projectId: string): Promise<void> {
  await updateProject(projectId, { ragOverride: null });
}

// ---------------------------------------------------------------- phases

export async function addPhase(projectId: string, name: string): Promise<string> {
  const count = await db.phases.where({ projectId }).count();
  const id = newId();
  await db.phases.add({ id, projectId, name, order: count, weight: null });
  return id;
}

export async function updatePhase(id: string, patch: Partial<Phase>): Promise<void> {
  await db.phases.update(id, patch);
}

export async function deletePhase(id: string): Promise<void> {
  const acts = await db.activities.where({ phaseId: id }).toArray();
  await db.transaction("rw", [db.phases, db.activities, db.dependencies, db.raid], async () => {
    for (const a of acts) await removeActivityLinks(a.id);
    await db.activities.bulkDelete(acts.map((a) => a.id));
    await db.phases.delete(id);
  });
}

export async function movePhase(projectId: string, id: string, dir: -1 | 1): Promise<void> {
  const phases = (await db.phases.where({ projectId }).toArray()).sort((a, b) => a.order - b.order);
  const i = phases.findIndex((p) => p.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= phases.length) return;
  [phases[i], phases[j]] = [phases[j], phases[i]];
  await db.phases.bulkPut(phases.map((p, order) => ({ ...p, order })));
}

// ---------------------------------------------------------------- activities

export async function addMainActivity(projectId: string, phaseId: string, name: string, start: ISODate, end: ISODate): Promise<string> {
  const settings = await getSettings();
  const order = await db.activities.where({ phaseId }).filter((a) => a.level === "main").count();
  const a = blankActivity({ projectId, phaseId, name, start, end, order, owner: settings.myName });
  await db.activities.add(a);
  return a.id;
}

export async function addSubActivity(
  mainId: string,
  fields: { name: string; start: ISODate; end: ISODate; owner?: string; kanbanStatus?: KanbanStatus },
): Promise<string> {
  const main = await db.activities.get(mainId);
  if (!main || main.level !== "main") throw new Error("A sub-activity needs a main activity.");
  const settings = await getSettings();
  const order = await db.activities.where({ parentId: mainId }).count();
  const status = fields.kanbanStatus ?? "To Do";
  const a = blankActivity({
    projectId: main.projectId,
    phaseId: main.phaseId,
    parentId: mainId,
    level: "sub",
    name: fields.name,
    start: fields.start,
    end: fields.end,
    owner: fields.owner?.trim() || settings.myName,
    order,
    kanbanStatus: status,
    actualPct: status === "Done" ? 100 : 0,
  });
  await db.activities.add(a);
  return a.id;
}

export async function updateActivity(id: string, patch: Partial<Activity>): Promise<void> {
  const current = await db.activities.get(id);
  if (!current) return;
  const next: Partial<Activity> = { ...patch, updatedAt: Date.now() };
  // Moving a sub to another main activity also moves it to that phase.
  if (patch.parentId && patch.parentId !== current.parentId) {
    const parent = await db.activities.get(patch.parentId);
    if (parent) next.phaseId = parent.phaseId;
  }
  await db.activities.update(id, next);
}

/** Kanban move: Done sets 100%, To Do sets 0%, In Progress takes the given %. */
export async function setSubStatus(id: string, status: KanbanStatus, opts: { pct?: number; reason?: string } = {}): Promise<void> {
  const patch: Partial<Activity> = { kanbanStatus: status };
  if (status === "Done") patch.actualPct = 100;
  if (status === "To Do") patch.actualPct = 0;
  if (status === "In Progress" && opts.pct !== undefined) patch.actualPct = Math.max(0, Math.min(100, Math.round(opts.pct)));
  if (status === "Blocked") patch.blockedReason = opts.reason?.trim() ?? "";
  else patch.blockedReason = "";
  await updateActivity(id, patch);
}

/** Change an activity's dates. A main activity with subs moves its subs with it. */
export async function moveActivity(id: string, start: ISODate, end: ISODate): Promise<void> {
  const a = await db.activities.get(id);
  if (!a) return;
  const project = await db.projects.get(a.projectId);
  if (!project) return;
  const subs = a.level === "main" ? await db.activities.where({ parentId: id }).toArray() : [];
  if (subs.length === 0) {
    await updateActivity(id, { start, end: end < start ? start : end });
    return;
  }
  const cal = calendarIndex(project.calendar);
  const currentStart = subs.reduce((m, s) => (s.start < m ? s.start : m), subs[0].start);
  const delta = diffDays(currentStart, start);
  if (delta === 0) return;
  const now = Date.now();
  await db.activities.bulkPut(
    subs.map((s) => ({ ...s, ...shiftKeepingDuration(s.start, s.end, addDays(s.start, delta), cal), updatedAt: now })),
  );
}

async function removeActivityLinks(id: string) {
  await db.dependencies.filter((d) => d.predecessorId === id || d.successorId === id).delete();
  await db.raid.filter((r) => r.linkedId === id).modify({ linkedId: null });
}

export async function deleteActivity(id: string): Promise<void> {
  const subs = await db.activities.where({ parentId: id }).toArray();
  await db.transaction("rw", [db.activities, db.dependencies, db.raid], async () => {
    for (const a of [...subs.map((s) => s.id), id]) await removeActivityLinks(a);
    await db.activities.bulkDelete([...subs.map((s) => s.id), id]);
  });
}

export async function moveActivityOrder(id: string, dir: -1 | 1): Promise<void> {
  const a = await db.activities.get(id);
  if (!a) return;
  const siblings = (
    a.level === "sub"
      ? await db.activities.where({ parentId: a.parentId! }).toArray()
      : await db.activities.where({ phaseId: a.phaseId }).filter((x) => x.level === "main").toArray()
  ).sort((x, y) => x.order - y.order);
  const i = siblings.findIndex((s) => s.id === id);
  const j = i + dir;
  if (j < 0 || j >= siblings.length) return;
  [siblings[i], siblings[j]] = [siblings[j], siblings[i]];
  await db.activities.bulkPut(siblings.map((s, order) => ({ ...s, order })));
}

// ---------------------------------------------------------------- weights

/** Pin (value) or unpin (null) a weight. */
export async function setWeight(kind: "phase" | "activity", id: string, value: number | null): Promise<void> {
  const weight = value === null ? null : Math.max(0, Math.min(100, value));
  if (kind === "phase") await db.phases.update(id, { weight });
  else await db.activities.update(id, { weight });
}

/** "Reset to duration" for a group: unpin every weight in it. */
export async function resetWeights(group: { phasesOf?: string; mainsOf?: string; subsOf?: string }): Promise<void> {
  if (group.phasesOf) await db.phases.where({ projectId: group.phasesOf }).modify({ weight: null });
  if (group.mainsOf) await db.activities.where({ phaseId: group.mainsOf }).filter((a) => a.level === "main").modify({ weight: null });
  if (group.subsOf) await db.activities.where({ parentId: group.subsOf }).modify({ weight: null });
}

// ---------------------------------------------------------------- milestones

export async function saveMilestone(m: Omit<Milestone, "updatedAt" | "id"> & { id?: string }): Promise<string> {
  const id = m.id ?? newId();
  await db.milestones.put({ ...m, id, updatedAt: Date.now() });
  return id;
}

export async function deleteMilestone(id: string): Promise<void> {
  await db.transaction("rw", [db.milestones, db.dependencies, db.raid], async () => {
    await removeActivityLinks(id);
    await db.milestones.delete(id);
  });
}

// ---------------------------------------------------------------- dependencies

export async function addDependency(projectId: string, predecessorId: string, successorId: string): Promise<void> {
  await db.dependencies.add({ id: newId(), projectId, predecessorId, successorId, type: "FS", keptPredEnd: null });
}

export async function removeDependency(id: string): Promise<void> {
  await db.dependencies.delete(id);
}

export async function keepDependencyConflict(id: string, predEnd: ISODate): Promise<void> {
  await db.dependencies.update(id, { keptPredEnd: predEnd });
}

/** Resolve a slip by moving the successor to its earliest allowed start. */
export async function shiftSuccessor(successorId: string, newStart: ISODate): Promise<void> {
  const ms = await db.milestones.get(successorId);
  if (ms) {
    await db.milestones.update(successorId, { date: newStart, updatedAt: Date.now() });
    return;
  }
  const a = await db.activities.get(successorId);
  const project = a && (await db.projects.get(a.projectId));
  if (!a || !project) return;
  const subs = a.level === "main" ? await db.activities.where({ parentId: a.id }).toArray() : [];
  if (subs.length) {
    await moveActivity(a.id, newStart, newStart);
    return;
  }
  const next = shiftKeepingDuration(a.start, a.end, newStart, calendarIndex(project.calendar));
  await updateActivity(a.id, next);
}

// ---------------------------------------------------------------- baseline

export async function setBaseline(projectId: string, reason: string): Promise<void> {
  const graph = await loadGraph(projectId);
  if (!graph) return;
  const tree = buildTree(graph, todayISO());
  const baseline: Baseline = {
    id: newId(),
    projectId,
    setAt: Date.now(),
    reason: reason.trim(),
    active: true,
    items: baselineItems(tree, graph),
    plannedPct: tree.root.plannedPct,
  };
  await db.transaction("rw", [db.baselines], async () => {
    await db.baselines.where({ projectId }).modify({ active: false });
    await db.baselines.add(baseline);
  });
}

// ---------------------------------------------------------------- RAID

export function blankRaid(projectId: string, type: RaidType, owner: string): RaidItem {
  const now = Date.now();
  return {
    id: newId(),
    projectId,
    type,
    title: "",
    description: "",
    owner,
    due: addDays(todayISO(), 7),
    status: RAID_STATUSES[type][0],
    likelihood: 3,
    impact: 3,
    mitigation: "",
    severity: "Medium",
    resolution: "",
    decidedBy: "",
    decisionDate: "",
    rationale: "",
    linkedId: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function raidProblems(item: RaidItem): string[] {
  const out: string[] = [];
  if (!item.title.trim()) out.push("a title");
  if (!item.owner.trim()) out.push("an owner");
  if (!item.due) out.push("a due date");
  return out;
}

export async function saveRaid(item: RaidItem): Promise<void> {
  const problems = raidProblems(item);
  if (problems.length) throw new Error(`An item needs ${problems.join(" and ")} before it can be saved.`);
  await db.raid.put({ ...item, title: item.title.trim(), owner: item.owner.trim(), updatedAt: Date.now() });
}

export async function updateRaid(id: string, patch: Partial<RaidItem>): Promise<void> {
  await db.raid.update(id, { ...patch, updatedAt: Date.now() });
}

export async function deleteRaid(id: string): Promise<void> {
  await db.raid.delete(id);
}

/** Blocked card → Issue in one click. */
export async function raiseIssueFromBlocked(activityId: string, reason: string): Promise<void> {
  const a = await db.activities.get(activityId);
  if (!a) return;
  const settings = await getSettings();
  const item = blankRaid(a.projectId, "I", a.owner || settings.myName);
  await saveRaid({
    ...item,
    title: `Blocked: ${a.name}`,
    description: reason,
    severity: "High",
    due: addDays(todayISO(), 3),
    linkedId: a.id,
  });
}

// ---------------------------------------------------------------- reports

export async function saveReport(report: StatusReport): Promise<void> {
  await db.reports.put({ ...report, updatedAt: Date.now() });
}

export async function updateReportNarrative(id: string, narrative: ReportNarrative): Promise<void> {
  await db.reports.update(id, { narrative, updatedAt: Date.now() });
}

export async function deleteReport(id: string): Promise<void> {
  await db.reports.delete(id);
}
