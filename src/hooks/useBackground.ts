// Background jobs that run while the app is open: GitHub auto-backup and the
// daily progress / RAG history recorder.

import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useRef } from "react";
import { loadAllGraphs } from "../db/actions";
import { db, getSettings, updateSettings } from "../db/db";
import type { RagHistoryEntry, Settings } from "../db/types";
import { buildBackupFiles } from "../lib/backup";
import { todayISO, weekStart } from "../lib/dates";
import { pushBackup } from "../lib/github";
import { projectMetrics, snapshotRows } from "../lib/metrics";
import { ragSummary } from "../lib/rag";

export const AUTO_BACKUP_DELAY_MS = 2 * 60_000;

export function isBackupConfigured(s: Pick<Settings, "githubOwner" | "githubRepo" | "githubToken">): boolean {
  return !!(s.githubOwner.trim() && s.githubRepo.trim() && s.githubToken.trim());
}

let running: Promise<void> | null = null;

/** Back up now. Concurrent calls share one run. */
export function runBackup(message: string): Promise<void> {
  if (running) return running;
  running = (async () => {
    const s = await getSettings();
    if (!isBackupConfigured(s)) throw new Error("Connect a GitHub repo in Settings first.");
    const startedAt = Date.now();
    try {
      const files = await buildBackupFiles();
      await pushBackup(
        { owner: s.githubOwner.trim(), repo: s.githubRepo.trim(), branch: s.githubBranch.trim(), token: s.githubToken.trim() },
        files,
        message,
      );
      await updateSettings({ lastBackupAt: startedAt, lastBackupError: null });
    } catch (e) {
      await updateSettings({ lastBackupError: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  })().finally(() => {
    running = null;
  });
  return running;
}

export function useAutoBackup() {
  const settings = useLiveQuery(() => getSettings(), []);
  const dailyChecked = useRef(false);

  // Daily snapshot the first time the app opens each day.
  useEffect(() => {
    if (!settings || dailyChecked.current) return;
    dailyChecked.current = true;
    const today = todayISO();
    if (!isBackupConfigured(settings) || !settings.autoBackup || settings.lastDailySnapshot === today) return;
    if (!navigator.onLine) return;
    runBackup(`Daily snapshot ${today}`)
      .then(() => updateSettings({ lastDailySnapshot: today }))
      .catch(() => {});
  }, [settings]);

  // Debounced backup after changes; resumes when the browser comes back online.
  const lastChangeAt = settings?.lastChangeAt ?? 0;
  const lastBackupAt = settings?.lastBackupAt ?? 0;
  const enabled = !!settings && settings.autoBackup && isBackupConfigured(settings);
  useEffect(() => {
    if (!enabled || lastChangeAt <= lastBackupAt) return;
    const go = () => {
      if (navigator.onLine) runBackup("Auto-backup").catch(() => {});
    };
    const wait = Math.max(0, lastChangeAt + AUTO_BACKUP_DELAY_MS - Date.now());
    const timer = setTimeout(go, wait);
    window.addEventListener("online", go);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", go);
    };
  }, [enabled, lastChangeAt, lastBackupAt]);
}

/**
 * Store today's progress per project and phase, and this week's RAG. Stored
 * history is what keeps past S-curve points from moving.
 */
export function useProgressRecorder() {
  const graphs = useLiveQuery(() => loadAllGraphs(), []);
  useEffect(() => {
    if (!graphs) return;
    const timer = setTimeout(async () => {
      const settings = await getSettings();
      const today = todayISO();
      const week = weekStart(today);
      for (const g of graphs) {
        if (g.project.status === "Closed") continue;
        const m = projectMetrics(g, today, settings.ragThresholds);
        const rows = snapshotRows(g, m.tree, today);
        const existing = await db.snapshots.bulkGet(rows.map((r) => r.id));
        const changed = rows.filter(
          (r, i) => !existing[i] || existing[i]!.actualPct !== r.actualPct || existing[i]!.plannedPct !== r.plannedPct,
        );
        if (changed.length) await db.snapshots.bulkPut(changed);

        const entry: RagHistoryEntry = {
          id: `${g.project.id}|${week}`,
          projectId: g.project.id,
          week,
          status: m.rag.status,
          reason: ragSummary(m.rag),
          overridden: m.rag.overridden,
        };
        const prev = await db.ragHistory.get(entry.id);
        if (!prev || prev.status !== entry.status || prev.reason !== entry.reason || prev.overridden !== entry.overridden) {
          await db.ragHistory.put(entry);
        }
      }
    }, 1500);
    return () => clearTimeout(timer);
  }, [graphs]);
}

