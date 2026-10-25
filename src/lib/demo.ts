// Two fictional demo projects that show what a full set-up looks like: an
// ERP build for a government agency and an asset management system for a
// government-linked company. Dates are relative to today so both always look
// mid-flight; every name, date and number is made up.

import { addDependency, addSubActivity, blankRaid, createProject, saveMilestone, saveRaid, setBaseline, setSubStatus, setWeight } from "../db/actions";
import { db } from "../db/db";
import type { RaidItem, SignoffStatus } from "../db/types";
import { CALENDAR_PRESETS, cloneCalendar } from "./calendar";
import { addDays, todayISO, toDay, type ISODate } from "./dates";

/** Weeks from today → date. */
type W = number;
type Sub = { name: string; from: W; to: W; owner?: string; lag?: number };
type Main = { name: string; owner: string; weight?: number; subs: Sub[] };
type PhaseDef = { name: string; weight?: number; mains: Main[] };
type Ms = { name: string; at: W; owner: string };
type Raid = Partial<RaidItem> & { type: RaidItem["type"]; title: string; owner: string; at: W; link?: string };

interface DemoDef {
  name: string;
  code: string;
  sponsor: string;
  description: string;
  phases: PhaseDef[];
  milestones: Ms[];
  deps: [string, string][];
  raid: Raid[];
}

async function build(def: DemoDef): Promise<string> {
  const today = todayISO();
  const d = (w: W): ISODate => addDays(today, Math.round(w * 7));
  const subs = def.phases.flatMap((p) => p.mains.flatMap((m) => m.subs));
  const start = d(Math.min(...subs.map((s) => s.from)));
  const end = d(Math.max(...subs.map((s) => s.to)));
  const projectId = await createProject({
    name: def.name,
    code: def.code,
    sponsor: def.sponsor,
    description: def.description,
    start,
    end,
    calendar: cloneCalendar(CALENDAR_PRESETS.malaysia.calendar),
    phases: def.phases.map((p) => ({ name: p.name, mains: p.mains.map((m) => ({ name: m.name, start: d(m.subs[0].from), end: d(m.subs[m.subs.length - 1].to) })) })),
    milestones: [],
  });
  const ids = new Map<string, string>();
  const phases = (await db.phases.where({ projectId }).toArray()).sort((a, b) => a.order - b.order);
  for (const [pi, p] of def.phases.entries()) {
    if (p.weight != null) await setWeight("phase", phases[pi].id, p.weight);
    const mains = (await db.activities.where({ phaseId: phases[pi].id }).toArray()).sort((a, b) => a.order - b.order);
    for (const [mi, m] of p.mains.entries()) {
      const main = mains[mi];
      ids.set(m.name, main.id);
      await db.activities.update(main.id, { owner: m.owner });
      if (m.weight != null) await setWeight("activity", main.id, m.weight);
      for (const s of m.subs) {
        const sid = await addSubActivity(main.id, { name: s.name, start: d(s.from), end: d(s.to), owner: s.owner ?? m.owner });
        ids.set(s.name, sid);
        // Finished work is done; current work trails its plan by `lag` points.
        if (s.to < 0) await setSubStatus(sid, "Done");
        else if (s.from < 0) {
          const planned = ((toDay(today) - toDay(d(s.from))) / Math.max(1, toDay(d(s.to)) - toDay(d(s.from)))) * 100;
          await setSubStatus(sid, "In Progress", { pct: Math.max(5, planned - (s.lag ?? 5)) });
        }
      }
    }
  }
  for (const m of def.milestones) {
    const signoff: SignoffStatus = m.at < -1 ? "Approved" : m.at < 2 ? "Submitted" : "Pending";
    ids.set(m.name, await saveMilestone({ projectId, name: m.name, date: d(m.at), owner: m.owner, signoff, deliverables: [] }));
  }
  for (const [a, b] of def.deps) await addDependency(projectId, ids.get(a)!, ids.get(b)!);
  await setBaseline(projectId, "Plan agreed at kick-off");
  for (const { link, at, ...r } of def.raid) {
    const due = d(at);
    const decided = r.type === "D" && r.status === "Decided";
    await saveRaid({
      ...blankRaid(projectId, r.type, r.owner),
      ...r,
      due,
      decisionDate: decided ? due : "",
      linkedId: link ? (ids.get(link) ?? null) : null,
    });
  }
  return projectId;
}

const erp: DemoDef = {
  name: "ERP Dev - Gov Sector",
  code: "DEMO-ERP",
  sponsor: "Director of Finance (fictional agency)",
  description:
    "Demo project with fictional data. An integrated finance, HR, procurement and asset ERP for a government agency, delivered by a system integrator with a PMO consultant overseeing quality and reporting.",
  phases: [
    { name: "Phase 1: Pre-development", weight: 10, mains: [
      { name: "A. Initiation", owner: "PMO consultant", subs: [
        { name: "Mobilisation and project charter", from: -60, to: -55 },
        { name: "Requirements review", from: -55, to: -46 },
      ] },
    ] },
    { name: "Phase 2: Development", weight: 85, mains: [
      { name: "B. Solution design", owner: "SI vendor", weight: 20, subs: [
        { name: "Business process design", from: -45, to: -32 },
        { name: "Functional design sign-off", from: -32, to: -26 },
      ] },
      { name: "C. Project management office", owner: "PMO consultant", weight: 10, subs: [
        { name: "Status reporting and governance", from: -45, to: 22 },
      ] },
      { name: "D. Change management", owner: "Change lead", weight: 8, subs: [
        { name: "Stakeholder engagement", from: -40, to: 20, lag: 8 },
        { name: "Communications", from: -40, to: 20, lag: 4 },
        { name: "End-user training", from: 10, to: 19 },
      ] },
      { name: "E. Technical foundation", owner: "SI vendor", weight: 14, subs: [
        { name: "Solution and network architecture", from: -30, to: -6 },
        { name: "Environment set-up", from: -24, to: 2, owner: "Agency IT", lag: 12 },
        { name: "Integration and migration plan", from: -24, to: 1, lag: 6 },
      ] },
      { name: "F. Build and test", owner: "SI vendor", weight: 33, subs: [
        { name: "Finance module sprints", from: -26, to: 6, lag: 6 },
        { name: "Procurement module sprints", from: -26, to: 6, lag: 10 },
        { name: "HR and payroll module sprints", from: -26, to: 6, lag: 8 },
        { name: "Asset module sprints", from: -26, to: 6, lag: 4 },
        { name: "Data migration", from: -20, to: 14, lag: 6 },
        { name: "Integrations", from: -20, to: 12, lag: 9 },
        { name: "System test and UAT", from: 6, to: 16 },
      ] },
    ] },
    { name: "Phase 3: Post-development", weight: 5, mains: [
      { name: "G. Go-live and transition", owner: "SI vendor", subs: [
        { name: "Cutover and go-live", from: 16, to: 18 },
        { name: "Hypercare", from: 18, to: 24 },
      ] },
      { name: "H. Closure", owner: "PMO consultant", subs: [{ name: "Handover and closure report", from: 22, to: 26 }] },
    ] },
  ],
  milestones: [
    { name: "Project kick-off", at: -60, owner: "PMO consultant" },
    { name: "Charter approved", at: -55, owner: "Project sponsor" },
    { name: "Functional design signed off", at: -26, owner: "Agency IT" },
    { name: "Integration and migration plan signed off", at: 1, owner: "Agency IT" },
    { name: "Build complete", at: 6, owner: "SI vendor" },
    { name: "UAT sign-off", at: 16, owner: "Business owners" },
    { name: "Go-live", at: 18, owner: "Agency IT" },
    { name: "Project closure", at: 26, owner: "PMO consultant" },
  ],
  deps: [
    ["Requirements review", "Business process design"],
    ["Integration and migration plan", "Data migration"],
    ["Finance module sprints", "System test and UAT"],
    ["System test and UAT", "Cutover and go-live"],
    ["Cutover and go-live", "Hypercare"],
  ],
  raid: [
    { type: "R", title: "Key business users not released for workshops", owner: "Project sponsor", at: -40, status: "Closed", likelihood: 3, impact: 4, mitigation: "Named delegates per module agreed at the steering committee." },
    { type: "R", title: "Scope creep from requests outside the agreed requirements", owner: "PMO consultant", at: 4, status: "Mitigating", likelihood: 3, impact: 4, mitigation: "Every new request goes through change control with a cost and time estimate." },
    { type: "R", title: "Vendor team understaffed for parallel module builds", owner: "SI vendor", at: 3, likelihood: 4, impact: 4, mitigation: "Weekly resourcing review; extra developers on the procurement module.", link: "Procurement module sprints" },
    { type: "R", title: "Legacy data quality worse than expected", owner: "Agency IT", at: 8, likelihood: 4, impact: 3, mitigation: "Profile all source data now and agree cleansing rules per data set.", link: "Data migration" },
    { type: "R", title: "Finance staff busy with year-end closing during UAT", owner: "Finance lead", at: 12, likelihood: 3, impact: 4, mitigation: "Book testers early and plan UAT around the closing calendar.", link: "System test and UAT" },
    { type: "R", title: "Day-one disruption at go-live", owner: "Change lead", at: 18, likelihood: 2, impact: 4, mitigation: "Floor walkers, quick guides and a hypercare help desk.", link: "Cutover and go-live" },
    { type: "R", title: "External system owners slow to confirm interfaces", owner: "Agency IT", at: 5, likelihood: 3, impact: 3, mitigation: "Interface agreements tracked weekly with each owner.", link: "Integrations" },
    { type: "I", title: "Design sign-off took two extra review rounds", owner: "PMO consultant", at: -26, status: "Resolved", severity: "Medium", resolution: "Signed off; review checklist added for later documents." },
    { type: "I", title: "Test environment not ready", owner: "Agency IT", at: 1, severity: "High", description: "Hardware arrived late, so the vendor is testing on a shared environment.", resolution: "Temporary cloud environment until the servers are commissioned.", link: "Environment set-up" },
    { type: "I", title: "Procurement module behind after sprint 6", owner: "SI vendor", at: 2, status: "In progress", severity: "Medium", resolution: "Backlog re-planned into the next three sprints.", link: "Procurement module sprints" },
    { type: "I", title: "Migration plan sign-off overdue", owner: "Agency IT", at: 0, severity: "Medium", resolution: "Review meeting set with all data owners.", link: "Integration and migration plan" },
    { type: "D", title: "Deliver the build in two-week sprints", owner: "Agency IT", at: -30, status: "Decided", decidedBy: "Steering committee", rationale: "Users see working software early and give feedback sooner." },
    { type: "D", title: "Keep the asset module in phase 1 scope", owner: "Project sponsor", at: -44, status: "Decided", decidedBy: "Steering committee", rationale: "Needed for a complete fixed-asset register at go-live." },
    { type: "D", title: "Approve a revised baseline after the sprint re-plan", owner: "PMO consultant", at: -8, status: "Decided", decidedBy: "Project director", rationale: "Recovery plan keeps the go-live date." },
    { type: "D", title: "Phased or big-bang go-live?", owner: "Project sponsor", at: 4, status: "Pending", rationale: "Phasing lowers risk but needs temporary interfaces." },
    { type: "A", title: "Confirm UAT testers per module", owner: "Business owners", at: 2 },
    { type: "A", title: "Run the user role mapping workshop", owner: "Change lead", at: 1, status: "In progress", link: "Stakeholder engagement" },
    { type: "A", title: "Finish data mapping for all modules", owner: "SI vendor", at: 3, status: "In progress", link: "Data migration" },
    { type: "A", title: "Circulate the monthly status report", owner: "PMO consultant", at: -1, status: "Done" },
  ],
};

const assetManagement: DemoDef = {
  name: "Asset Management - Gov-Link- Corporation",
  code: "DEMO-AMS",
  sponsor: "Chief Operating Officer (fictional company)",
  description:
    "Demo project with fictional data. A unit trust and asset management system (unit registry, fund accounting, investor portal) for a government-linked company, implemented by a software vendor with a PMO consultant.",
  phases: [
    { name: "Planning", mains: [{ name: "Project planning", owner: "PMO consultant", subs: [{ name: "Project plan and charter", from: -40, to: -34 }] }] },
    { name: "Requirements and build", mains: [
      { name: "Requirements and design", owner: "Vendor", subs: [
        { name: "Business requirements", from: -38, to: -26 },
        { name: "Integration design", from: -30, to: -20 },
      ] },
      { name: "Configuration", owner: "Vendor", subs: [{ name: "Application configuration", from: -26, to: -10 }] },
    ] },
    { name: "Testing and data migration", mains: [
      { name: "Testing", owner: "Vendor", subs: [
        { name: "System integration test", from: -16, to: -6 },
        { name: "User acceptance test", from: -6, to: 3, owner: "Client", lag: 7 },
      ] },
      { name: "Data migration", owner: "Vendor", subs: [
        { name: "Trial migration", from: -14, to: -4 },
        { name: "Production migration", from: 3, to: 7 },
      ] },
    ] },
    { name: "Deployment and go-live", mains: [
      { name: "Change and training", owner: "Vendor", subs: [
        { name: "Change management", from: -30, to: 8, lag: 10 },
        { name: "Key user training", from: -3, to: 4, lag: 5 },
      ] },
      { name: "Go-live", owner: "Vendor", subs: [
        { name: "Security assessment", from: 2, to: 5, owner: "Client" },
        { name: "Go-live deployment", from: 5, to: 8 },
      ] },
    ] },
    { name: "Transition and closure", mains: [
      { name: "Transition", owner: "Vendor", subs: [{ name: "Transition to support", from: 8, to: 12 }] },
      { name: "Closure", owner: "PMO consultant", subs: [{ name: "Final acceptance and closure report", from: 10, to: 14 }] },
    ] },
  ],
  milestones: [
    { name: "Project kick-off", at: -40, owner: "PMO consultant" },
    { name: "Payment 1: project plan", at: -34, owner: "Vendor" },
    { name: "Payment 2: requirements signed off", at: -26, owner: "Vendor" },
    { name: "Payment 3: configuration complete", at: -10, owner: "Vendor" },
    { name: "Payment 4: UAT sign-off", at: 3, owner: "Vendor" },
    { name: "Release 1: production ready", at: 5, owner: "Vendor" },
    { name: "Payment 5: go-live", at: 8, owner: "Vendor" },
    { name: "Project closure (final acceptance)", at: 14, owner: "PMO consultant" },
  ],
  deps: [
    ["System integration test", "User acceptance test"],
    ["User acceptance test", "Production migration"],
    ["Security assessment", "Go-live deployment"],
    ["Go-live deployment", "Transition to support"],
  ],
  raid: [
    { type: "R", title: "Slow adoption by some user groups", owner: "Client", at: 10, likelihood: 2, impact: 3, mitigation: "Change champions in each department and short refresher sessions.", link: "Change management" },
    { type: "R", title: "Long turnaround for document reviews", owner: "PMO consultant", at: -26, status: "Closed", likelihood: 3, impact: 4, mitigation: "Agreed review windows and a sign-off tracker." },
    { type: "R", title: "Requirements miss edge-case fund scenarios", owner: "Vendor", at: -20, status: "Closed", likelihood: 3, impact: 4, mitigation: "Scenario walkthroughs with fund operations.", link: "Business requirements" },
    { type: "R", title: "Users request features beyond the product", owner: "Client", at: 4, status: "Mitigating", likelihood: 3, impact: 3, mitigation: "Change board reviews every request against the contract." },
    { type: "R", title: "Outgoing provider slow to hand over data", owner: "Client", at: 3, likelihood: 3, impact: 4, mitigation: "Escalate through the exit agreement; agree data extract dates now.", link: "Production migration" },
    { type: "R", title: "Only key users trained before go-live", owner: "Vendor", at: 6, likelihood: 3, impact: 4, mitigation: "Train-the-trainer plan and floor support in week one.", link: "Go-live deployment" },
    { type: "R", title: "Extra integrations not in the budget", owner: "Client", at: 6, likelihood: 2, impact: 3, mitigation: "Price options before approving new interfaces." },
    { type: "I", title: "Some planned interfaces dropped from scope", owner: "Client", at: -22, status: "Resolved", severity: "High", resolution: "Steering committee approved the reduced scope; payment gateway kept." },
    { type: "I", title: "Configuration started three weeks late", owner: "Vendor", at: -24, status: "Resolved", severity: "Medium", resolution: "Conditional design sign-off let configuration start.", link: "Application configuration" },
    { type: "I", title: "Open UAT defects", owner: "Vendor", at: 2, status: "In progress", severity: "High", description: "Severity 1 and 2 defects still open in unit registry.", resolution: "Defect burn-down twice a week.", link: "User acceptance test" },
    { type: "I", title: "Security assessor not appointed", owner: "Client", at: 1, severity: "Medium", resolution: "Shortlist of two assessors with the procurement team.", link: "Security assessment" },
    { type: "D", title: "Approve the baseline timeline", owner: "Client", at: -34, status: "Decided", decidedBy: "Steering committee" },
    { type: "D", title: "Allow conditional sign-off so configuration can start", owner: "Client", at: -25, status: "Decided", decidedBy: "Project director", rationale: "Avoids a further month of delay." },
    { type: "D", title: "Approve the revised timeline", owner: "Client", at: -8, status: "Decided", decidedBy: "Steering committee", rationale: "UAT extended by four weeks; go-live moved accordingly." },
    { type: "D", title: "Mobile app now or after go-live?", owner: "Client", at: 3, status: "Pending", rationale: "Investors want mobile access; adds about six weeks if done now." },
    { type: "A", title: "Share the requirements template with reviewers", owner: "Vendor", at: -37, status: "Done" },
    { type: "A", title: "Confirm contacts for every external interface", owner: "Client", at: -28, status: "Done" },
    { type: "A", title: "Complete payment gateway onboarding with the bank", owner: "Client", at: 1, status: "In progress" },
    { type: "A", title: "List open-source components and their support model", owner: "Vendor", at: 2, status: "In progress" },
    { type: "A", title: "Schedule the go-live readiness review", owner: "PMO consultant", at: 4 },
  ],
};

/** Add the demo projects that aren't here yet (matched by code). Returns how many were added. */
export async function addDemoProjects(): Promise<number> {
  let added = 0;
  for (const def of [erp, assetManagement]) {
    if (await db.projects.where({ code: def.code }).first()) continue;
    await build(def);
    added++;
  }
  return added;
}

const SEEDED_KEY = "minipmo.demoSeeded";

/** First visit with no projects at all: add the demo projects once. */
export async function seedDemoProjectsOnce(): Promise<void> {
  // The flag is set before any await so a second call (React StrictMode) can't seed twice.
  try {
    if (localStorage.getItem(SEEDED_KEY) === "1") return;
    localStorage.setItem(SEEDED_KEY, "1");
  } catch {
    return;
  }
  if ((await db.projects.count()) === 0) await addDemoProjects();
}
