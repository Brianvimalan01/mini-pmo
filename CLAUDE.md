# minipmo — guide for Claude Code

Static React + TypeScript app (Vite, Tailwind, Dexie, Recharts, dnd-kit,
pptxgenjs) deployed to GitHub Pages by `.github/workflows/deploy.yml` on every
push to `main`. Read `README.md` and `docs/PRD.md` before changing behaviour;
the PRD's decisions log holds the agreed choices.

## Rules
- No server, no database, no accounts. Data lives in IndexedDB and is backed
  up to a separate private `minipmo-data` repo, never to this one.
- This repository and its Actions logs are public. Never commit project data,
  GitHub tokens, `.env` files or exported backups (`minipmo-backup-*.json`).
- Main activity and phase dates and % are always derived from sub-activities,
  never stored or typed. Actual % is entered on sub-activities only.
- Progress maths lives in `src/lib/progress.ts` and must stay pure; the
  timeline, board, S-curve and report all read the same numbers.
- All writes go through `src/db/actions.ts` so `updatedAt`, cascades and the
  backup change marker stay consistent.
- RAG is never shown by colour alone; always with its text label.

## Git
Claude handles git for this repo; the owner does not run git commands.
- Commit as `Brianvimalan Francis <74669352+Brianvimalan01@users.noreply.github.com>`
  (set in the repo's local git config).
- Work on `main`. `git pull --rebase` before starting, commit each logical
  change with a short imperative message, then `git push`.
- Remote is `origin` over HTTPS; the login is saved in the macOS Keychain.
- Node and npm are installed in `~/.local/bin` (no Homebrew on this Mac).

## Update loop
1. `git pull --rebase`.
2. Change code, add or update tests (`src/**/*.test.ts`).
3. `npm run verify` must pass (typecheck, tests, build).
4. Commit, push to `main`, and check the "Deploy to GitHub Pages" run.
