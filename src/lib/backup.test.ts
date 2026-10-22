import { describe, expect, it } from "vitest";
import { addSubActivity, createProject, loadAllGraphs, saveRaid, blankRaid } from "../db/actions";
import { db, PROJECT_TABLES } from "../db/db";
import { buildBackupFiles, restoreFiles } from "./backup";
import { CALENDAR_PRESETS, cloneCalendar } from "./calendar";
import { addDays } from "./dates";
import { projectMetrics, sCurve } from "./metrics";
import { DEFAULT_THRESHOLDS } from "../db/types";

async function dump() {
  const out: Record<string, unknown[]> = { projects: await db.projects.orderBy("id").toArray() };
  for (const t of PROJECT_TABLES) out[t] = await db.table(t).orderBy("id").toArray();
  return out;
}

async function seed(projects: number, subsPerMain: number) {
  for (let p = 0; p < projects; p++) {
    const start = "2026-01-05";
    const id = await createProject({
      name: `Project ${p}`,
      code: `P${p}`,
      sponsor: "S",
      description: "",
      start,
      end: "2026-12-18",
      calendar: cloneCalendar(CALENDAR_PRESETS.malaysia.calendar),
      phases: [0, 1, 2, 3, 4].map((i) => ({
        name: `Phase ${i}`,
        mains: [0, 1].map((j) => ({ name: `Main ${i}.${j}`, start: addDays(start, i * 60 + j * 30), end: addDays(start, i * 60 + j * 30 + 28) })),
      })),
      milestones: [{ name: "Go-live", date: "2026-11-30" }],
    });
    const mains = await db.activities.where({ projectId: id }).toArray();
    for (const m of mains) {
      for (let k = 0; k < subsPerMain; k++) {
        await addSubActivity(m.id, { name: `Sub ${k}`, start: addDays(m.start, k * 5), end: addDays(m.start, k * 5 + 4) });
      }
    }
    await saveRaid({ ...blankRaid(id, "R", "Me"), title: "Risk", likelihood: 4, impact: 4 });
  }
}

describe("backup and restore", () => {
  it("restores every row exactly", async () => {
    await seed(2, 3);
    const before = await dump();
    const files = await buildBackupFiles();
    expect(Object.keys(files).sort()).toEqual(["projects/P0.json", "projects/P1.json", "settings.json"]);
    expect(files["settings.json"]).not.toContain("githubToken");

    await db.projects.clear();
    for (const t of PROJECT_TABLES) await db.table(t).clear();
    await restoreFiles(files);
    expect(await dump()).toEqual(before);
    // Same data → byte-identical files, so an unchanged backup makes no commit.
    expect(await buildBackupFiles()).toEqual(files);
  });
});

describe("performance", () => {
  it("computes 20 projects with 1,000 sub-activities well under a second", async () => {
    await db.projects.clear();
    for (const t of PROJECT_TABLES) await db.table(t).clear();
    await seed(20, 5); // 20 × 10 mains × 5 subs = 1,000 sub-activities
    const t0 = performance.now();
    const graphs = await loadAllGraphs();
    for (const g of graphs) {
      const m = projectMetrics(g, "2026-06-15", DEFAULT_THRESHOLDS);
      sCurve(g, m.tree, [], "2026-06-15");
    }
    const ms = performance.now() - t0;
    expect(graphs.reduce((n, g) => n + g.activities.filter((a) => a.level === "sub").length, 0)).toBe(1000);
    expect(ms).toBeLessThan(1000);
  }, 60_000);
});
