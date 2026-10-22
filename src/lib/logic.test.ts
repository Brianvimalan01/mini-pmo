import { describe, expect, it } from "vitest";
import type { Activity, Phase, ProjectGraph, RaidItem } from "../db/types";
import { DEFAULT_THRESHOLDS } from "../db/types";
import { calendarIndex, type WorkCalendar } from "./calendar";
import { addDays, toDay, weekStart, weekdayOfDay } from "./dates";
import { canLink, conflicts, endpoints, shiftKeepingDuration } from "./dependencies";
import { buildTree, plannedAt, plannedPct, resolveWeights, round1 } from "./progress";
import { calculateRag } from "./rag";

const monFri: WorkCalendar = { workingDays: [1, 2, 3, 4, 5], holidays: [] };

describe("dates", () => {
  it("knows weekdays and week starts", () => {
    expect(weekdayOfDay(toDay("2026-10-22"))).toBe(4); // Thursday
    expect(weekStart("2026-10-22")).toBe("2026-10-19");
    expect(weekStart("2026-10-25")).toBe("2026-10-19"); // Sunday belongs to the week before
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
});

describe("calendar", () => {
  const cal = calendarIndex({ workingDays: [1, 2, 3, 4, 5], holidays: [{ date: "2026-10-21", name: "x" }] });
  it("counts working days, skipping weekends and holidays", () => {
    expect(cal.workingDaysBetween("2026-10-19", "2026-10-25")).toBe(4);
    expect(cal.workingDaysBetween("2026-10-01", "2026-10-31")).toBe(21);
    expect(cal.workingDaysBetween("2026-10-25", "2026-10-19")).toBe(0);
  });
  it("matches a day-by-day count over long spans", () => {
    let n = 0;
    for (let d = "2026-01-03"; d <= "2027-02-11"; d = addDays(d, 1)) if (cal.isWorkingDay(d)) n++;
    expect(cal.workingDaysBetween("2026-01-03", "2027-02-11")).toBe(n);
  });
  it("adds working days", () => {
    expect(cal.addWorkingDays("2026-10-20", 1)).toBe("2026-10-22");
    expect(cal.onOrAfter("2026-10-24")).toBe("2026-10-26");
  });
});

describe("weights", () => {
  it("defaults to duration", () => {
    expect(resolveWeights([{ duration: 6, pinned: null }, { duration: 4, pinned: null }])).toEqual([60, 40]);
  });
  it("rebalances unpinned weights around a pin", () => {
    const w = resolveWeights([
      { duration: 6, pinned: 50 },
      { duration: 4, pinned: null },
      { duration: 4, pinned: null },
    ]);
    expect(w).toEqual([50, 25, 25]);
  });
  it("scales pins to 100 when everything is pinned", () => {
    expect(resolveWeights([{ duration: 1, pinned: 30 }, { duration: 1, pinned: 30 }])).toEqual([50, 50]);
  });
});

describe("planned %", () => {
  const cal = calendarIndex(monFri);
  it("is 0 before start, 100 after end, elapsed/total in between", () => {
    // Mon 19 Oct – Fri 30 Oct = 10 working days
    expect(plannedPct("2026-10-19", "2026-10-30", "2026-10-19", cal)).toBe(0);
    expect(plannedPct("2026-10-19", "2026-10-30", "2026-10-22", cal)).toBe(30);
    expect(plannedPct("2026-10-19", "2026-10-30", "2026-10-31", cal)).toBe(100);
  });
});

function act(p: Partial<Activity> & Pick<Activity, "id" | "phaseId" | "start" | "end">): Activity {
  return {
    projectId: "p",
    parentId: null,
    level: "main",
    name: p.id,
    owner: "Me",
    order: 0,
    weight: null,
    actualPct: 0,
    kanbanStatus: "To Do",
    blockedReason: "",
    notes: "",
    updatedAt: 0,
    ...p,
  };
}

function graphOf(phases: Phase[], activities: Activity[], raid: RaidItem[] = []): ProjectGraph {
  return {
    project: {
      id: "p",
      name: "P",
      code: "P",
      sponsor: "",
      description: "",
      start: "2026-01-05",
      end: "2026-12-31",
      calendar: monFri,
      status: "Active",
      ragOverride: null,
      createdAt: 0,
      updatedAt: 0,
    },
    phases,
    activities,
    milestones: [],
    dependencies: [],
    raid,
    baseline: null,
  };
}

describe("roll-up (PRD worked example)", () => {
  // Design 30% done, Build 50% at 60% planned / 45% actual, Test 20% not started.
  const phases: Phase[] = [
    { id: "design", projectId: "p", name: "Design", order: 0, weight: 30 },
    { id: "build", projectId: "p", name: "Build", order: 1, weight: 50 },
    { id: "test", projectId: "p", name: "Test", order: 2, weight: 20 },
  ];
  const activities: Activity[] = [
    act({ id: "d", phaseId: "design", start: "2026-01-05", end: "2026-01-16" }),
    act({ id: "d1", phaseId: "design", parentId: "d", level: "sub", start: "2026-01-05", end: "2026-01-16", actualPct: 100 }),
    act({ id: "b", phaseId: "build", start: "2026-01-19", end: "2026-01-30" }),
    // Build runs 19 Jan – 30 Jan (10 working days); on 27 Jan, 6 have elapsed = 60%.
    act({ id: "b1", phaseId: "build", parentId: "b", level: "sub", start: "2026-01-19", end: "2026-01-30", actualPct: 45 }),
    act({ id: "t", phaseId: "test", start: "2026-02-02", end: "2026-02-13" }),
    act({ id: "t1", phaseId: "test", parentId: "t", level: "sub", start: "2026-02-02", end: "2026-02-13" }),
  ];
  const graph = graphOf(phases, activities);
  const tree = buildTree(graph, "2026-01-27");

  it("matches the table", () => {
    expect(round1(tree.root.plannedPct)).toBe(60);
    expect(round1(tree.root.actualPct)).toBe(52.5);
  });

  it("is Amber at −7.5%", () => {
    const rag = calculateRag(graph, tree.root.actualPct - tree.root.plannedPct, "2026-01-27", DEFAULT_THRESHOLDS);
    expect(rag.status).toBe("Amber");
  });

  it("gives the same planned % from the curve helper", () => {
    expect(round1(plannedAt(tree.root, "2026-01-27", tree.cal))).toBe(60);
  });

  it("derives main activity dates from sub-activities", () => {
    const g = graphOf(phases, [
      act({ id: "m", phaseId: "design", start: "2026-03-02", end: "2026-03-03" }),
      act({ id: "s1", phaseId: "design", parentId: "m", level: "sub", start: "2026-01-05", end: "2026-01-09" }),
      act({ id: "s2", phaseId: "design", parentId: "m", level: "sub", start: "2026-01-12", end: "2026-01-14" }),
    ]);
    const node = buildTree(g, "2026-01-01").byId.get("m")!;
    expect([node.start, node.end]).toEqual(["2026-01-05", "2026-01-14"]);
    // 5 and 3 working days → 62.5% / 37.5%
    expect(node.children.map((c) => c.weight)).toEqual([62.5, 37.5]);
  });
});

describe("RAG", () => {
  const raid = (p: Partial<RaidItem>): RaidItem => ({
    id: "r",
    projectId: "p",
    type: "R",
    title: "t",
    description: "",
    owner: "Me",
    due: "2026-01-01",
    status: "Open",
    likelihood: 1,
    impact: 1,
    mitigation: "",
    severity: "Low",
    resolution: "",
    decidedBy: "",
    decisionDate: "",
    rationale: "",
    linkedId: null,
    createdAt: 0,
    updatedAt: 0,
    ...p,
  });
  it("goes Amber on a 15+ risk and Red on a critical issue", () => {
    expect(calculateRag(graphOf([], [], [raid({ likelihood: 5, impact: 3 })]), 0, "2026-01-01", DEFAULT_THRESHOLDS).status).toBe("Amber");
    expect(calculateRag(graphOf([], [], [raid({ type: "I", severity: "Critical" })]), 0, "2026-01-01", DEFAULT_THRESHOLDS).status).toBe("Red");
    expect(calculateRag(graphOf([], [], [raid({ likelihood: 5, impact: 5, status: "Closed" })]), 0, "2026-01-01", DEFAULT_THRESHOLDS).status).toBe("Green");
  });
  it("goes Red beyond −10%", () => {
    expect(calculateRag(graphOf([], []), -10.2, "2026-01-01", DEFAULT_THRESHOLDS).status).toBe("Red");
    expect(calculateRag(graphOf([], []), -4.9, "2026-01-01", DEFAULT_THRESHOLDS).status).toBe("Green");
  });
});

describe("dependencies", () => {
  const acts = [
    act({ id: "a", phaseId: "x", start: "2026-01-05", end: "2026-01-09" }),
    act({ id: "b", phaseId: "x", start: "2026-01-07", end: "2026-01-14" }),
    act({ id: "c", phaseId: "x", start: "2026-01-20", end: "2026-01-21" }),
  ];
  const dep = (id: string, p: string, s: string) => ({ id, projectId: "p", predecessorId: p, successorId: s, type: "FS" as const, keptPredEnd: null });

  it("blocks circular links", () => {
    const deps = [dep("1", "a", "b"), dep("2", "b", "c")];
    const check = canLink(deps, acts, "c", "a");
    expect(check.ok).toBe(false);
    expect(canLink(deps, acts, "a", "c").ok).toBe(true);
  });

  it("flags a successor that starts before its predecessor ends", () => {
    const g = graphOf([{ id: "x", projectId: "p", name: "X", order: 0, weight: null }], acts);
    const tree = buildTree(g, "2026-01-01");
    const found = conflicts([dep("1", "a", "b"), dep("2", "b", "c")], endpoints(tree, []), tree.cal);
    expect(found.map((c) => c.dependency.id)).toEqual(["1"]);
    expect(found[0].earliestStart).toBe("2026-01-12");
  });

  it("shifts while keeping the working-day duration", () => {
    const cal = calendarIndex(monFri);
    // 6 working days: Wed 7 → Wed 14 Jan
    expect(shiftKeepingDuration("2026-01-07", "2026-01-14", "2026-01-12", cal)).toEqual({ start: "2026-01-12", end: "2026-01-19" });
  });
});
