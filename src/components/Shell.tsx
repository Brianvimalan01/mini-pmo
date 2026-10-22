import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
import { db } from "../db/db";
import { useSettings } from "../hooks/data";
import { isBackupConfigured, runBackup } from "../hooks/useBackground";
import { formatDateTime, relativeTime } from "../lib/dates";
import { useApp } from "./AppContext";
import { cx } from "./ui";

type Theme = "system" | "light" | "dark";
const THEME_KEY = "minipmo-theme";

function readTheme(): Theme {
  try {
    const t = localStorage.getItem(THEME_KEY);
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
}

function useTheme(): [Theme, (t: Theme) => void] {
  const [theme, setTheme] = useState<Theme>(readTheme);
  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => document.documentElement.classList.toggle("dark", theme === "dark" || (theme === "system" && media.matches));
    apply();
    media.addEventListener("change", apply);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* private mode */
    }
    return () => media.removeEventListener("change", apply);
  }, [theme]);
  return [theme, setTheme];
}

const NAV = [
  { to: "/", label: "Portfolio", end: true },
  { to: "/tasks", label: "My Tasks" },
  { to: "/reports", label: "Reports" },
  { to: "/settings", label: "Settings" },
];

export function Shell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  useEffect(() => setMenuOpen(false), [location.pathname]);

  return (
    <div className="flex h-full flex-col md:flex-row">
      <div className="no-print flex items-center justify-between border-b border-line bg-surface px-4 py-2 md:hidden">
        <Brand />
        <button type="button" className="rounded px-2 py-1 text-sm text-muted hover:bg-sunken" onClick={() => setMenuOpen((o) => !o)} aria-expanded={menuOpen}>
          Menu
        </button>
      </div>
      <aside
        className={cx(
          "no-print flex-col border-r border-line bg-surface md:flex md:w-60 md:shrink-0",
          menuOpen ? "flex border-b" : "hidden",
        )}
      >
        <div className="hidden px-5 pt-5 pb-4 md:block">
          <Brand />
        </div>
        <Sidebar />
      </aside>
      <main className="min-w-0 flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}

function Brand() {
  return (
    <Link to="/" className="flex items-center gap-2 text-base font-semibold tracking-tight">
      <img src="./favicon.svg" alt="" width={22} height={22} />
      minipmo
    </Link>
  );
}

function Sidebar() {
  const projects = useLiveQuery(() => db.projects.toArray(), []) ?? [];
  const [theme, setTheme] = useTheme();
  const active = projects.filter((p) => p.status !== "Closed").sort((a, b) => a.name.localeCompare(b.name));

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="flex flex-col gap-0.5 px-3">
        {NAV.map((n) => (
          <NavLink
            key={n.to}
            to={n.to}
            end={n.end}
            className={({ isActive }) => cx("rounded-md px-3 py-1.5 text-sm font-medium", isActive ? "bg-accent-soft text-accent" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            {n.label}
          </NavLink>
        ))}
      </nav>

      <div className="mt-6 flex items-center justify-between px-6 text-xs font-semibold tracking-wide text-faint uppercase">
        Projects
        <Link to="/new" className="rounded px-1.5 text-base leading-none font-normal text-muted hover:bg-sunken hover:text-ink" title="New project" aria-label="New project">
          +
        </Link>
      </div>
      <nav className="mt-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-3">
        {active.map((p) => (
          <NavLink
            key={p.id}
            to={`/p/${p.id}`}
            className={({ isActive }) => cx("truncate rounded-md px-3 py-1.5 text-sm", isActive ? "bg-sunken font-medium text-ink" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            {p.name}
          </NavLink>
        ))}
        {active.length === 0 && <p className="px-3 py-1 text-xs text-faint">No projects yet</p>}
      </nav>

      <div className="mt-auto flex flex-col gap-3 border-t border-line p-4">
        <BackupStatus />
        <div className="flex items-center gap-1 text-xs" role="group" aria-label="Theme">
          {(["system", "light", "dark"] as Theme[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTheme(t)}
              className={cx("rounded px-2 py-1 capitalize", theme === t ? "bg-sunken font-medium text-ink" : "text-muted hover:text-ink")}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function BackupStatus() {
  const s = useSettings();
  const { notify } = useApp();
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  if (!isBackupConfigured(s)) {
    return (
      <Link to="/settings" className="rounded-md bg-amber-soft px-3 py-2 text-xs text-amber">
        Backup not set up. Connect GitHub in Settings.
      </Link>
    );
  }
  const old = !s.lastBackupAt || Date.now() - s.lastBackupAt > 24 * 3600_000;
  const pending = s.lastChangeAt > (s.lastBackupAt ?? 0);
  return (
    <div className={cx("rounded-md px-3 py-2 text-xs", s.lastBackupError || old ? "bg-amber-soft text-amber" : "bg-sunken text-muted")}>
      <div title={s.lastBackupAt ? formatDateTime(s.lastBackupAt) : undefined}>
        Last backup: <span className="font-medium">{s.lastBackupAt ? relativeTime(s.lastBackupAt) : "never"}</span>
        {old && s.lastBackupAt ? " (over 24 h)" : ""}
      </div>
      {s.lastBackupError && <div className="mt-1 line-clamp-2">Failed: {s.lastBackupError}</div>}
      {!s.lastBackupError && pending && <div className="mt-0.5 opacity-80">Changes waiting{navigator.onLine ? "" : " (offline)"}</div>}
      <button
        type="button"
        disabled={busy}
        className="mt-1.5 font-medium text-accent hover:underline disabled:opacity-50"
        onClick={async () => {
          setBusy(true);
          try {
            await runBackup("Manual backup");
            notify("Backed up to GitHub");
          } catch (e) {
            notify(e instanceof Error ? e.message : "Backup failed", "error");
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Backing up…" : "Back up now"}
      </button>
    </div>
  );
}
