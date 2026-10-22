import { afterEach, describe, expect, it, vi } from "vitest";
import { listCommits, pushBackup, readBackupAt } from "./github";

/** A tiny in-memory GitHub: one branch, commits with flat trees. */
function fakeGitHub() {
  let n = 0;
  const id = (p: string) => `${p}${++n}`;
  const blobs = new Map<string, string>();
  const trees = new Map<string, Record<string, string>>(); // tree sha → path → blob sha
  const commits = new Map<string, { tree: string; parents: string[]; message: string }>();
  let head: string | null = null;
  const calls: string[] = [];

  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  const treeSha = (files: Record<string, string>) => {
    const key = JSON.stringify(Object.entries(files).sort());
    for (const [sha, t] of trees) if (JSON.stringify(Object.entries(t).sort()) === key) return sha;
    const sha = id("tree");
    trees.set(sha, files);
    return sha;
  };
  const blob = (content: string) => {
    const sha = id("blob");
    blobs.set(sha, content);
    return sha;
  };

  const fetchMock = vi.fn(async (url: string, init: RequestInit = {}) => {
    const path = url.replace("https://api.github.com/repos/me/data", "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push(`${method} ${path.split("?")[0]}`);
    if (path === "") return json({ private: true, default_branch: "main", size: 0 });
    if (path === "/git/ref/heads/main") return head ? json({ object: { sha: head } }) : json({ message: "Git Repository is empty." }, 409);
    if (path === "/contents/settings.json" && method === "PUT") {
      const t = treeSha({ "settings.json": blob(new TextDecoder().decode(Uint8Array.from(atob(body.content), (c) => c.charCodeAt(0)))) });
      head = id("commit");
      commits.set(head, { tree: t, parents: [], message: body.message });
      return json({}, 201);
    }
    let m = path.match(/^\/git\/commits\/(\w+)$/);
    if (m) return json({ tree: { sha: commits.get(m[1])!.tree } });
    m = path.match(/^\/git\/trees\/(\w+)/);
    if (m) return json({ tree: Object.entries(trees.get(m[1])!).map(([p, sha]) => ({ path: p, type: "blob", sha })) });
    if (path === "/git/trees" && method === "POST") {
      const files = { ...trees.get(body.base_tree)! };
      for (const e of body.tree) {
        if (e.sha === null) delete files[e.path];
        else files[e.path] = blob(e.content);
      }
      // Identical content keeps the same blob, as git would.
      for (const [p, sha] of Object.entries(files)) {
        const base = trees.get(body.base_tree)![p];
        if (base && blobs.get(base) === blobs.get(sha)) files[p] = base;
      }
      return json({ sha: treeSha(files) }, 201);
    }
    if (path === "/git/commits" && method === "POST") {
      const sha = id("commit");
      commits.set(sha, { tree: body.tree, parents: body.parents, message: body.message });
      return json({ sha }, 201);
    }
    if (path === "/git/refs/heads/main" && method === "PATCH") {
      head = body.sha;
      return json({});
    }
    m = path.match(/^\/git\/blobs\/(\w+)$/);
    if (m) return json({ content: btoa(String.fromCharCode(...new TextEncoder().encode(blobs.get(m[1])!))) });
    if (path.startsWith("/commits")) {
      const out = [];
      for (let c = head; c; c = commits.get(c)!.parents[0] ?? null) out.push({ sha: c, commit: { message: commits.get(c)!.message, committer: { date: "2026-10-22T00:00:00Z" } } });
      return json(out);
    }
    return json({ message: `unhandled ${method} ${path}` }, 500);
  });
  return { fetchMock, calls, getHead: () => head };
}

const cfg = { owner: "me", repo: "data", branch: "", token: "t" };

afterEach(() => vi.unstubAllGlobals());

describe("GitHub backup", () => {
  it("initialises an empty repo, commits, skips unchanged data, deletes removed projects and restores any version", async () => {
    const gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.fetchMock);

    const v1 = { "settings.json": "{}\n", "projects/A.json": '{"a":1}\n', "projects/B.json": '{"b":"ünïcode"}\n' };
    const r1 = await pushBackup(cfg, v1, "first");
    expect(r1.status).toBe("committed");
    const firstSha = gh.getHead()!;

    expect((await pushBackup(cfg, v1, "again")).status).toBe("unchanged");
    expect(gh.getHead()).toBe(firstSha);

    const v2 = { "settings.json": "{}\n", "projects/A.json": '{"a":2}\n' };
    expect((await pushBackup(cfg, v2, "second")).status).toBe("committed");

    expect(await readBackupAt(cfg, gh.getHead()!)).toEqual(v2);
    expect(await readBackupAt(cfg, firstSha)).toEqual(v1);
    const history = await listCommits(cfg);
    expect(history.map((c) => c.message)).toEqual(["second", "first", "Initialise minipmo backup"]);
  });
});
