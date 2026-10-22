// Minimal GitHub REST client for the backup repo. Each backup is one commit
// built with the Git Data API, so several project files change together.

import type { BackupFiles } from "./backup";

export interface RepoConfig {
  owner: string;
  repo: string;
  branch: string;
  token: string;
}

export class GitHubError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function gh<T>(cfg: RepoConfig, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.repo}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${cfg.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
    },
  });
  if (!res.ok) {
    let message = res.statusText;
    try {
      message = (await res.json()).message ?? message;
    } catch {
      /* not JSON */
    }
    throw new GitHubError(res.status, explain(res.status, message));
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

function explain(status: number, message: string): string {
  if (status === 401) return "GitHub rejected the token (expired or mistyped).";
  if (status === 403) return `GitHub refused access: ${message}. Check the token has Contents read and write on this repo.`;
  if (status === 404) return "Repo not found. Check the owner and repo name, and that the token can see it.";
  return `GitHub error ${status}: ${message}`;
}

export interface RepoInfo {
  private: boolean;
  defaultBranch: string;
  empty: boolean;
}

export async function repoInfo(cfg: RepoConfig): Promise<RepoInfo> {
  const repo = await gh<{ private: boolean; default_branch: string; size: number }>(cfg, "");
  let empty = false;
  try {
    await gh(cfg, `/git/ref/heads/${encodeURIComponent(cfg.branch || repo.default_branch)}`);
  } catch (e) {
    if (e instanceof GitHubError && (e.status === 404 || e.status === 409)) empty = true;
    else throw e;
  }
  return { private: repo.private, defaultBranch: repo.default_branch, empty };
}

async function resolveBranch(cfg: RepoConfig): Promise<string> {
  if (cfg.branch) return cfg.branch;
  const repo = await gh<{ default_branch: string }>(cfg, "");
  return repo.default_branch;
}

function utf8ToBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function base64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ""));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

interface TreeEntry {
  path: string;
  type: string;
  sha: string;
}

export type BackupResult = { status: "committed"; sha: string } | { status: "unchanged" };

/**
 * Commit the files. Project files that no longer exist locally are deleted
 * so the repo mirrors the browser.
 */
export async function pushBackup(cfg: RepoConfig, files: BackupFiles, message: string): Promise<BackupResult> {
  const branch = await resolveBranch(cfg);
  let headSha: string;
  try {
    headSha = (await gh<{ object: { sha: string } }>(cfg, `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  } catch (e) {
    if (!(e instanceof GitHubError && (e.status === 404 || e.status === 409))) throw e;
    // Empty repo: the Git Data API needs one commit first.
    await gh(cfg, `/contents/settings.json`, {
      method: "PUT",
      body: JSON.stringify({ message: "Initialise minipmo backup", content: utf8ToBase64(files["settings.json"] ?? "{}\n"), branch }),
    });
    headSha = (await gh<{ object: { sha: string } }>(cfg, `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha;
  }

  const head = await gh<{ tree: { sha: string } }>(cfg, `/git/commits/${headSha}`);
  const existing = await gh<{ tree: TreeEntry[] }>(cfg, `/git/trees/${head.tree.sha}?recursive=1`);

  const entries: { path: string; mode: string; type: string; content?: string; sha?: null }[] = Object.entries(files).map(
    ([path, content]) => ({ path, mode: "100644", type: "blob", content }),
  );
  for (const e of existing.tree) {
    if (e.type === "blob" && e.path.startsWith("projects/") && e.path.endsWith(".json") && !(e.path in files)) {
      entries.push({ path: e.path, mode: "100644", type: "blob", sha: null });
    }
  }

  const tree = await gh<{ sha: string }>(cfg, "/git/trees", {
    method: "POST",
    body: JSON.stringify({ base_tree: head.tree.sha, tree: entries }),
  });
  if (tree.sha === head.tree.sha) return { status: "unchanged" };

  const commit = await gh<{ sha: string }>(cfg, "/git/commits", {
    method: "POST",
    body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] }),
  });
  await gh(cfg, `/git/refs/heads/${encodeURIComponent(branch)}`, {
    method: "PATCH",
    body: JSON.stringify({ sha: commit.sha }),
  });
  return { status: "committed", sha: commit.sha };
}

export interface CommitSummary {
  sha: string;
  message: string;
  date: string;
}

export async function listCommits(cfg: RepoConfig, perPage = 50): Promise<CommitSummary[]> {
  const branch = await resolveBranch(cfg);
  const rows = await gh<{ sha: string; commit: { message: string; committer: { date: string } } }[]>(
    cfg,
    `/commits?sha=${encodeURIComponent(branch)}&per_page=${perPage}`,
  );
  return rows.map((r) => ({ sha: r.sha, message: r.commit.message, date: r.commit.committer.date }));
}

/** Read settings.json and every project file as they were at a commit. */
export async function readBackupAt(cfg: RepoConfig, commitSha: string): Promise<BackupFiles> {
  const commit = await gh<{ tree: { sha: string } }>(cfg, `/git/commits/${commitSha}`);
  const tree = await gh<{ tree: TreeEntry[] }>(cfg, `/git/trees/${commit.tree.sha}?recursive=1`);
  const wanted = tree.tree.filter(
    (e) => e.type === "blob" && (e.path === "settings.json" || /^projects\/[^/]+\.json$/.test(e.path)),
  );
  const files: BackupFiles = {};
  await Promise.all(
    wanted.map(async (e) => {
      const blob = await gh<{ content: string }>(cfg, `/git/blobs/${e.sha}`);
      files[e.path] = base64ToUtf8(blob.content);
    }),
  );
  return files;
}
