// Backup files (PRD 14): one JSON per project plus settings.json. The token
// is never written to a backup file.

import { withoutChangeTracking } from "../db/actions";
import { db, getSettings, PROJECT_TABLES, updateSettings } from "../db/db";
import type { Project, Settings } from "../db/types";

export const BACKUP_VERSION = 1;

export interface ProjectFile {
  version: number;
  exportedAt: string;
  project: Project;
  phases: unknown[];
  activities: unknown[];
  milestones: unknown[];
  dependencies: unknown[];
  baselines: unknown[];
  raid: unknown[];
  snapshots: unknown[];
  ragHistory: unknown[];
  reports: unknown[];
}

export interface SettingsFile {
  version: number;
  myName: string;
  autoBackup: boolean;
  ragThresholds: Settings["ragThresholds"];
}

export interface BackupFiles {
  /** path → JSON text */
  [path: string]: string;
}

const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function projectPath(code: string): string {
  return `projects/${code}.json`;
}

/** Serialise everything. Rows are sorted so unchanged data gives identical files. */
export async function buildBackupFiles(): Promise<BackupFiles> {
  const settings = await getSettings();
  const files: BackupFiles = {};
  const settingsFile: SettingsFile = {
    version: BACKUP_VERSION,
    myName: settings.myName,
    autoBackup: settings.autoBackup,
    ragThresholds: settings.ragThresholds,
  };
  files["settings.json"] = JSON.stringify(settingsFile, null, 2) + "\n";

  const projects = (await db.projects.toArray()).sort(byId);
  for (const project of projects) {
    const file = { version: BACKUP_VERSION, project } as Record<string, unknown>;
    for (const t of PROJECT_TABLES) {
      file[t] = (await db.table(t).where({ projectId: project.id }).toArray()).sort(byId);
    }
    files[projectPath(project.code)] = JSON.stringify(file, null, 2) + "\n";
  }
  return files;
}

export function parseBackupFiles(files: BackupFiles): { settings: SettingsFile | null; projects: ProjectFile[] } {
  let settings: SettingsFile | null = null;
  const projects: ProjectFile[] = [];
  for (const [path, text] of Object.entries(files)) {
    const data = JSON.parse(text);
    if (path === "settings.json") settings = data as SettingsFile;
    else if (/^projects\/[^/]+\.json$/.test(path)) {
      if (!data?.project?.id) throw new Error(`${path} is not a minipmo project file.`);
      projects.push(data as ProjectFile);
    }
  }
  return { settings, projects };
}

/** Replace all local data with the backup. GitHub connection settings are kept. */
export async function restoreFiles(files: BackupFiles): Promise<{ projects: number }> {
  const { settings, projects } = parseBackupFiles(files);
  await withoutChangeTracking(async () => {
    await db.transaction("rw", [db.projects, ...PROJECT_TABLES.map((t) => db.table(t))], async () => {
      await db.projects.clear();
      for (const t of PROJECT_TABLES) await db.table(t).clear();
      for (const p of projects) {
        await db.projects.add(p.project);
        for (const t of PROJECT_TABLES) {
          const rows = (p as unknown as Record<string, unknown[]>)[t] ?? [];
          if (rows.length) await db.table(t).bulkAdd(rows);
        }
      }
    });
    if (settings) {
      await updateSettings({ myName: settings.myName, autoBackup: settings.autoBackup, ragThresholds: settings.ragThresholds });
    }
  });
  return { projects: projects.length };
}

/** One file for the manual download fallback. */
export async function buildDownload(): Promise<string> {
  const files = await buildBackupFiles();
  return JSON.stringify({ minipmoBackup: BACKUP_VERSION, exportedAt: new Date().toISOString(), files }, null, 2);
}

export function parseDownload(text: string): BackupFiles {
  const data = JSON.parse(text);
  if (!data || typeof data.files !== "object") throw new Error("This file isn't a minipmo backup.");
  return data.files as BackupFiles;
}
