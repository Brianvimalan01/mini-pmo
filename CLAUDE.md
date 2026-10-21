# minipmo — guide for Claude Code

Static browser app with no backend. Read `README.md` and `docs/PRD.md` before
changing behaviour; the PRD's decisions log holds the agreed choices.

## Rules
- No server, no database, no accounts. Data lives in IndexedDB and is backed
  up to a separate private `minipmo-data` repo, never to this one.
- This repository is public. Never commit project data, GitHub tokens, `.env`
  files or exported JSON backups.
- Main activity and phase dates and % are always derived from sub-activities,
  never stored or typed.

## Git
Claude handles git for this repo; the owner does not run git commands.
- Commit as `Brianvimalan Francis <74669352+Brianvimalan01@users.noreply.github.com>`
  (set in the repo's local git config).
- Work on `main`. `git pull --rebase` before starting, commit each logical
  change with a short imperative message, then `git push`.
- Remote is `origin` over HTTPS; the login is saved in the macOS Keychain.

## Update loop
1. `git pull --rebase`.
2. Change code, add or update tests.
3. Checks must pass (to be defined when the app is scaffolded).
4. Commit, push to `main`.
