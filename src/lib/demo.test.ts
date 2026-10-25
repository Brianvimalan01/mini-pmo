import { beforeEach, expect, it } from "vitest";
import { loadAllGraphs } from "../db/actions";
import { db, PROJECT_TABLES } from "../db/db";
import { addDemoProjects } from "./demo";
import { buildTree } from "./progress";

beforeEach(async () => {
  await db.projects.clear();
  for (const t of PROJECT_TABLES) await db.table(t).clear();
});

it("adds both demo projects once, with a full plan and RAID log", async () => {
  expect(await addDemoProjects()).toBe(2);
  expect(await addDemoProjects()).toBe(0);

  const graphs = await loadAllGraphs();
  expect(graphs.map((g) => g.project.name).sort()).toEqual(["Asset Management - Gov-Link- Corporation", "ERP Dev - Gov Sector"]);
  for (const g of graphs) {
    expect(g.baseline).not.toBeNull();
    expect(g.milestones.length).toBeGreaterThan(5);
    expect(new Set(g.raid.map((r) => r.type))).toEqual(new Set(["R", "I", "D", "A"]));
    const ids = new Set([...g.activities.map((a) => a.id), ...g.milestones.map((m) => m.id)]);
    for (const r of g.raid) if (r.linkedId) expect(ids.has(r.linkedId)).toBe(true);
    const tree = buildTree(g, g.project.end);
    expect(tree.root.start).toBe(g.project.start);
    expect(tree.root.plannedPct).toBeCloseTo(100, 0);
  }
});
