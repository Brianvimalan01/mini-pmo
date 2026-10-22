import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useApp } from "../components/AppContext";
import { Button, Card, Field, Input } from "../components/ui";
import { getSettings, updateSettings } from "../db/db";
import { DEFAULT_THRESHOLDS, type RagThresholds } from "../db/types";
import { useSettings } from "../hooks/data";
import { isBackupConfigured, runBackup } from "../hooks/useBackground";
import { buildDownload, parseDownload, restoreFiles } from "../lib/backup";
import { formatDateTime, todayISO } from "../lib/dates";
import { listCommits, readBackupAt, repoInfo, type CommitSummary, type RepoConfig } from "../lib/github";
import { createSampleProject } from "../lib/sample";

export function SettingsPage() {
  const s = useSettings();
  const { notify } = useApp();
  const navigate = useNavigate();
  const [form, setForm] = useState({ myName: "", githubOwner: "", githubRepo: "", githubBranch: "", githubToken: "" });
  const [thresholds, setThresholds] = useState<RagThresholds>(DEFAULT_THRESHOLDS);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [check, setCheck] = useState<{ ok: boolean; text: string } | null>(null);
  const [commits, setCommits] = useState<CommitSummary[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  // Fill the form once, from the stored row (not the defaults shown while loading).
  const stored = useLiveQuery(() => getSettings(), []);
  useEffect(() => {
    if (loaded || !stored) return;
    setForm({ myName: stored.myName, githubOwner: stored.githubOwner, githubRepo: stored.githubRepo, githubBranch: stored.githubBranch, githubToken: stored.githubToken });
    setThresholds(stored.ragThresholds);
    setLoaded(true);
  }, [stored, loaded]);

  const cfg = (): RepoConfig => ({ owner: form.githubOwner.trim(), repo: form.githubRepo.trim(), branch: form.githubBranch.trim(), token: form.githubToken.trim() });

  const run = async (label: string, fn: () => Promise<void>) => {
    setBusy(label);
    try {
      await fn();
    } catch (e) {
      notify(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  };

  const saveGithub = () =>
    updateSettings({
      githubOwner: form.githubOwner.trim(),
      githubRepo: form.githubRepo.trim(),
      githubBranch: form.githubBranch.trim(),
      githubToken: form.githubToken.trim(),
      lastBackupError: null,
    });

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-5 px-4 py-6 sm:px-8">
      <h1 className="text-lg font-semibold">Settings</h1>

      <Card title="You">
        <Field label="Your name" hint="New items default to this owner; My Tasks can filter to it.">
          <Input value={form.myName} onChange={(e) => setForm({ ...form, myName: e.target.value })} onBlur={() => form.myName.trim() && updateSettings({ myName: form.myName.trim() })} className="max-w-xs" />
        </Field>
      </Card>

      <Card title="GitHub backup">
        <div className="flex flex-col gap-4">
          <details className="rounded-md bg-sunken px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium">How to set this up (5 minutes)</summary>
            <ol className="mt-2 ml-4 list-decimal space-y-1 text-muted">
              <li>
                On GitHub, create a <strong>private</strong> repo, e.g. <code>minipmo-data</code>. Keep it separate from the app's code.
              </li>
              <li>
                Go to Settings → Developer settings → Fine-grained personal access tokens → Generate new token.
              </li>
              <li>
                Repository access: <em>Only select repositories</em> → your data repo. Permissions: <em>Contents: Read and write</em>. Set an expiry date.
              </li>
              <li>Paste your GitHub username, the repo name and the token below, then Test connection.</li>
            </ol>
            <p className="mt-2 text-xs text-muted">The token is stored only in this browser and never written to a backup file. Only use minipmo on your own devices.</p>
          </details>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="GitHub owner">
              <Input value={form.githubOwner} onChange={(e) => setForm({ ...form, githubOwner: e.target.value })} placeholder="your-username" />
            </Field>
            <Field label="Repo">
              <Input value={form.githubRepo} onChange={(e) => setForm({ ...form, githubRepo: e.target.value })} placeholder="minipmo-data" />
            </Field>
            <Field label="Branch" hint="Blank = default branch">
              <Input value={form.githubBranch} onChange={(e) => setForm({ ...form, githubBranch: e.target.value })} placeholder="main" />
            </Field>
          </div>
          <Field label="Fine-grained token">
            <Input type="password" autoComplete="off" value={form.githubToken} onChange={(e) => setForm({ ...form, githubToken: e.target.value })} placeholder="github_pat_…" />
          </Field>
          {check && <p className={check.ok ? "rounded-md bg-green-soft px-3 py-2 text-sm text-green" : "rounded-md bg-amber-soft px-3 py-2 text-sm text-amber"}>{check.text}</p>}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!!busy || !isBackupConfigured(form)}
              onClick={() =>
                run("test", async () => {
                  const info = await repoInfo(cfg());
                  await saveGithub();
                  setCheck(
                    info.private
                      ? { ok: true, text: `Connected. Private repo${info.empty ? " (empty; the first backup will initialise it)" : ""}, default branch ${info.defaultBranch}. Saved.` }
                      : { ok: false, text: "Connected, but this repo is PUBLIC. Your project data would be visible to anyone. Make it private on GitHub before backing up." },
                  );
                })
              }
            >
              {busy === "test" ? "Testing…" : "Test connection and save"}
            </Button>
            <Button
              disabled={!!busy || !isBackupConfigured(s)}
              onClick={() =>
                run("backup", async () => {
                  await runBackup("Manual backup");
                  notify("Backed up to GitHub");
                })
              }
            >
              {busy === "backup" ? "Backing up…" : "Back up now"}
            </Button>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={s.autoBackup} onChange={(e) => updateSettings({ autoBackup: e.target.checked })} />
            Auto-backup 2 minutes after changes, plus a daily snapshot the first time the app opens each day
          </label>
          <p className="text-xs text-muted">
            Last backup: {formatDateTime(s.lastBackupAt)}
            {s.lastDailySnapshot === todayISO() && " · today's daily snapshot done"}
            {s.lastBackupError && <span className="block text-red">Last attempt failed: {s.lastBackupError}</span>}
          </p>
        </div>
      </Card>

      <Card title="Restore">
        <div className="flex flex-col gap-4">
          <p className="text-sm text-muted">Restoring replaces every project in this browser with the chosen version. Your GitHub connection is kept.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              disabled={!!busy || !isBackupConfigured(s)}
              onClick={() =>
                run("history", async () => {
                  setCommits(await listCommits({ owner: s.githubOwner, repo: s.githubRepo, branch: s.githubBranch, token: s.githubToken }));
                })
              }
            >
              {busy === "history" ? "Loading…" : "Show backup history from GitHub"}
            </Button>
            <Button
              onClick={() =>
                run("download", async () => {
                  const text = await buildDownload();
                  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
                  const link = document.createElement("a");
                  link.href = url;
                  link.download = `minipmo-backup-${todayISO()}.json`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                })
              }
            >
              Download backup file
            </Button>
            <Button onClick={() => fileInput.current?.click()}>Restore from file…</Button>
            <input
              ref={fileInput}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (!file) return;
                void run("upload", async () => {
                  const files = parseDownload(await file.text());
                  if (!confirm("Replace all projects in this browser with this backup file?")) return;
                  const { projects } = await restoreFiles(files);
                  notify(`Restored ${projects} project${projects === 1 ? "" : "s"}`);
                  navigate("/");
                });
              }}
            />
          </div>
          {commits && (
            <ul className="max-h-80 divide-y divide-line overflow-y-auto rounded-md border border-line">
              {commits.length === 0 && <li className="px-3 py-2 text-sm text-muted">No backups yet.</li>}
              {commits.map((c) => (
                <li key={c.sha} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="w-44 shrink-0 text-xs text-muted tabular-nums">{formatDateTime(Date.parse(c.date))}</span>
                  <span className="min-w-0 flex-1 truncate">{c.message}</span>
                  <code className="text-xs text-faint">{c.sha.slice(0, 7)}</code>
                  <Button
                    size="sm"
                    disabled={!!busy}
                    onClick={() =>
                      run("restore", async () => {
                        if (!confirm(`Restore the backup from ${formatDateTime(Date.parse(c.date))}? Everything in this browser is replaced.`)) return;
                        const files = await readBackupAt({ owner: s.githubOwner, repo: s.githubRepo, branch: s.githubBranch, token: s.githubToken }, c.sha);
                        const { projects } = await restoreFiles(files);
                        notify(`Restored ${projects} project${projects === 1 ? "" : "s"} from ${c.sha.slice(0, 7)}`);
                        navigate("/");
                      })
                    }
                  >
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>

      <Card title="RAG rules">
        <p className="mb-3 text-sm text-muted">Any one rule triggers the worse status. Variance = actual % − planned %.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Amber when behind plan by more than (%)">
            <Input type="number" min={0} step={0.5} value={thresholds.amberVariance} onChange={(e) => setThresholds({ ...thresholds, amberVariance: Number(e.target.value) })} />
          </Field>
          <Field label="Red when behind plan by more than (%)">
            <Input type="number" min={0} step={0.5} value={thresholds.redVariance} onChange={(e) => setThresholds({ ...thresholds, redVariance: Number(e.target.value) })} />
          </Field>
          <Field label="Red when a milestone is overdue by more than (days)" hint="Any overdue milestone up to this is Amber">
            <Input type="number" min={0} value={thresholds.milestoneRedDays} onChange={(e) => setThresholds({ ...thresholds, milestoneRedDays: Number(e.target.value) })} />
          </Field>
          <Field label="Amber when an open risk scores at least" hint="Likelihood × impact, 1–25">
            <Input type="number" min={1} max={25} value={thresholds.riskScore} onChange={(e) => setThresholds({ ...thresholds, riskScore: Number(e.target.value) })} />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted">An open issue with severity Critical always makes a project Red.</p>
        <div className="mt-4 flex gap-2">
          <Button
            variant="primary"
            disabled={thresholds.redVariance < thresholds.amberVariance}
            onClick={async () => {
              await updateSettings({ ragThresholds: thresholds });
              notify("RAG rules saved");
            }}
          >
            Save rules
          </Button>
          <Button variant="ghost" onClick={() => setThresholds(DEFAULT_THRESHOLDS)}>
            Reset to defaults
          </Button>
        </div>
      </Card>

      <Card title="Sample project">
        <p className="mb-3 text-sm text-muted">A mid-flight project with phases, sub-activities, a baseline, dependencies and RAID items to explore.</p>
        <Button
          onClick={() =>
            run("sample", async () => {
              const id = await createSampleProject();
              navigate(`/p/${id}`);
            })
          }
        >
          Add sample project
        </Button>
      </Card>
    </div>
  );
}
