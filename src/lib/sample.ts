// A sample project to explore before building a real one (PRD: onboarding).
// Dates are relative to today so it always looks mid-flight.

import {
  addDependency,
  addSubActivity,
  blankRaid,
  createProject,
  loadGraph,
  moveActivity,
  saveRaid,
  setBaseline,
  setSubStatus,
  updateActivity,
} from "../db/actions";
import { db, getSettings } from "../db/db";
import type { ProgressSnapshot, RaidItem } from "../db/types";
import { CALENDAR_PRESETS, calendarIndex, cloneCalendar } from "./calendar";
import { addDays, todayISO, toDay } from "./dates";
import { buildTree, plannedAt, round1 } from "./progress";
import { applyTemplate, TEMPLATES } from "./templates";

export async function createSampleProject(): Promise<string> {
  const settings = await getSettings();
  const me = settings.myName;
  const today = todayISO();
  const start = addDays(today, -70);
  const end = addDays(today, 110);
  const calendar = cloneCalendar(CALENDAR_PRESETS.malaysia.calendar);
  const cal = calendarIndex(calendar);
  const template = TEMPLATES.find((t) => t.id === "implementation")!;
  const draft = applyTemplate(template, start, end, calendar);

  let code = "SAMPLE";
  for (let i = 2; await db.projects.where({ code }).first(); i++) code = `SAMPLE-${i}`;

  const projectId = await createProject({
    name: "Sample: CRM rollout",
    code,
    sponsor: "Head of Sales Ops",
    description: "Example project to explore minipmo. Delete it whenever you like.",
    start,
    end,
    calendar,
    phases: draft.phases,
    milestones: draft.milestones,
    isSample: true,
  });

  // Break each main activity into two or three sub-activities.
  const owners = [me, "Aisha", "Daniel", "Mei Ling", me];
  const phaseOrder = new Map((await db.phases.where({ projectId }).toArray()).map((p) => [p.id, p.order]));
  const mains = (await db.activities.where({ projectId }).toArray())
    .filter((a) => a.level === "main")
    .sort((a, b) => phaseOrder.get(a.phaseId)! - phaseOrder.get(b.phaseId)! || a.order - b.order);
  const subIds: string[] = [];
  let n = 0;
  for (const main of mains) {
    const total = Math.max(2, cal.workingDaysBetween(main.start, main.end));
    const parts = total >= 9 ? 3 : 2;
    let cursor = main.start;
    for (let i = 0; i < parts; i++) {
      const days = i === parts - 1 ? total - Math.floor(total / parts) * (parts - 1) : Math.floor(total / parts);
      const subEnd = cal.addWorkingDays(cursor, Math.max(1, days) - 1);
      const names = ["Prepare", "Execute", "Review"];
      const id = await addSubActivity(main.id, {
        name: `${names[i]}: ${main.name.toLowerCase()}`,
        start: cursor,
        end: subEnd,
        owner: owners[n++ % owners.length],
      });
      subIds.push(id);
      cursor = cal.addWorkingDays(subEnd, 1);
    }
  }

  await setBaseline(projectId, "Plan agreed at kick-off");

  // Progress: finished work is done, current work lags plan a little.
  const subs = await db.activities.where({ projectId }).filter((a) => a.level === "sub").toArray();
  let blocked = false;
  for (const s of subs) {
    if (s.end < today) await setSubStatus(s.id, "Done");
    else if (s.start > today && s.start <= addDays(today, 10)) await setSubStatus(s.id, "In Progress", { pct: 10 });
    else if (s.start <= today) {
      const planned = (cal.countDays(toDay(s.start), toDay(today) - 1) / Math.max(1, cal.workingDaysBetween(s.start, s.end))) * 100;
      if (!blocked && planned > 20) {
        blocked = true;
        await updateActivity(s.id, { actualPct: Math.round(planned / 3) });
        await setSubStatus(s.id, "Blocked", { reason: "Waiting for API credentials from the vendor" });
      } else {
        await setSubStatus(s.id, "In Progress", { pct: Math.max(5, planned - 25) });
      }
    }
  }

  // One slip after the baseline so variance shows.
  const late = mains.find((m) => m.start > today);
  if (late) {
    const graph = await loadGraph(projectId);
    const node = graph && buildTree(graph, today).byId.get(late.id);
    if (node?.start && node.end) await moveActivity(late.id, addDays(node.start, 7), addDays(node.end, 7));
  }

  // Past milestones are signed off; the next one is awaiting sign-off.
  const milestones = (await db.milestones.where({ projectId }).toArray()).sort((a, b) => (a.date < b.date ? -1 : 1));
  for (const m of milestones) {
    if (m.date < addDays(today, -3)) await db.milestones.update(m.id, { signoff: "Approved" });
  }
  const next = milestones.find((m) => m.date >= addDays(today, -3));
  if (next) await db.milestones.update(next.id, { signoff: "Submitted" });

  // Dependencies between consecutive main activities in the first phases.
  for (let i = 0; i < Math.min(4, mains.length - 1); i++) {
    await addDependency(projectId, mains[i].id, mains[i + 1].id);
  }

  const raid = (type: RaidItem["type"], p: Partial<RaidItem>) => saveRaid({ ...blankRaid(projectId, type, me), ...p });
  await raid("R", { title: "Key user availability during UAT", owner: "Aisha", likelihood: 4, impact: 4, mitigation: "Book testers now; agree backfill with line managers", due: addDays(today, 14) });
  await raid("R", { title: "Data quality in legacy CRM", owner: "Daniel", likelihood: 3, impact: 4, mitigation: "Run profiling and cleansing sprint", due: addDays(today, 21), status: "Mitigating" });
  await raid("R", { title: "Vendor release slips", owner: me, likelihood: 2, impact: 3, mitigation: "Weekly vendor check-in", due: addDays(today, 30) });
  await raid("I", { title: "Integration sandbox unavailable", owner: "Mei Ling", severity: "High", description: "Vendor sandbox down since Monday", due: addDays(today, 3) });
  await raid("A", { title: "Confirm training venue", owner: me, due: addDays(today, -2) });
  await raid("A", { title: "Send cutover plan to sponsor", owner: me, due: addDays(today, 10) });
  await raid("D", { title: "Phase migration by region?", owner: me, status: "Pending", due: addDays(today, 5), rationale: "Reduces cutover risk but adds two weeks" });
  await raid("D", { title: "Use vendor's standard sales pipeline", owner: me, status: "Decided", decidedBy: "Steering committee", decisionDate: addDays(today, -30), due: addDays(today, -30), rationale: "Avoids customisation cost" });

  // Weekly history so the S-curve has a shape.
  const graph = await loadGraph(projectId);
  if (graph) {
    const tree = buildTree(graph, today);
    const rows: ProgressSnapshot[] = [];
    for (let d = start; d < today; d = addDays(d, 7)) {
      const planned = plannedAt(tree.root, d, tree.cal);
      const lag = 1 - 0.12 * ((toDay(d) - toDay(start)) / Math.max(1, toDay(today) - toDay(start)));
      rows.push({ id: `${projectId}|project|${d}`, projectId, phaseId: null, date: d, plannedPct: round1(planned), actualPct: round1(planned * lag) });
    }
    await db.snapshots.bulkPut(rows);
  }
  return projectId;
}
