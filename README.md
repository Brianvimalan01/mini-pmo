# minipmo

A personal PMO tool: create a project in under 10 minutes and see, at any
point, where it stands, what is at risk and what needs a decision.

- **Plan:** Phase → Main activity → Sub-activity. The timeline (Gantt) and the
  Kanban board are two views of the same records.
- **Progress:** duration-based weightage you can edit (pinned weights, the rest
  rebalance), planned % from working days, actual % rolled up to the project.
  Hover any % to see the math.
- **Control:** S-curve, rule-based RAG with justified override, baseline,
  finish-to-start dependencies with knock-on warnings, milestones and a RAID log.
- **Report:** portfolio dashboard, My Tasks, and a one-click weekly status
  report exported to PDF or PowerPoint.

No server and no logins. Data lives in the browser (IndexedDB) and is backed
up as JSON to a **separate private** GitHub repo (Settings → GitHub backup).

Requirements and decisions: [docs/PRD.md](docs/PRD.md).

## Where your data lives

| Data | Where |
|---|---|
| Projects, activities, RAID, reports, settings | IndexedDB in the browser you use. Backed up to your private data repo 2 minutes after changes, plus a daily snapshot. |
| GitHub token | Only in this browser. Never written to a backup file. |
| This repo | App code only. Never project data. |

Restore from any backup commit in Settings → Restore, or download/upload a
single JSON file as a fallback.

## Develop

Requires Node 22 (`.nvmrc`).

```sh
npm install
npm run dev      # http://localhost:5173
npm run verify   # typecheck + tests + build
```

Pushing to `main` runs `.github/workflows/deploy.yml`, which tests, builds
and publishes the app to GitHub Pages.

## Layout

| Path | What |
|---|---|
| `src/lib/` | Pure logic: calendar, weightage and roll-up, RAG, dependencies, S-curve, report, backup and GitHub client |
| `src/db/` | Dexie schema, types and every write (`actions.ts`) |
| `src/pages/` | Portfolio, My Tasks, Reports, Settings, new-project wizard and the project tabs |
| `src/components/` | Shared UI, the activity side panel, modals and charts |
