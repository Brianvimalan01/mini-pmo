import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useApp } from "../components/AppContext";
import { Button, EmptyState, ProgressBar, RagBadge, Select } from "../components/ui";
import { RAG_ORDER, type ProjectGraph, type RagStatus } from "../db/types";
import { useAllGraphs, useSettings } from "../hooks/data";
import { formatDate, todayISO } from "../lib/dates";
import { nextMilestone, projectMetrics, type ProjectMetrics } from "../lib/metrics";
import { fmtPct, fmtVariance } from "../lib/progress";
import { isOpen, riskScore } from "../lib/rag";
import { createSampleProject } from "../lib/sample";

type Sort = "variance" | "end" | "name" | "rag";

export function PortfolioPage() {
  const graphs = useAllGraphs();
  const settings = useSettings();
  const [rag, setRag] = useState<"all" | RagStatus>("all");
  const [sponsor, setSponsor] = useState("all");
  const [status, setStatus] = useState("open");
  const [sort, setSort] = useState<Sort>("variance");
  const navigate = useNavigate();
  const { notify } = useApp();
  const today = todayISO();

  const rows = useMemo(
    () => (graphs ?? []).map((g) => ({ g, m: projectMetrics(g, today, settings.ragThresholds) })),
    [graphs, today, settings.ragThresholds],
  );
  const sponsors = [...new Set(rows.map((r) => r.g.project.sponsor).filter(Boolean))].sort();

  const shown = rows
    .filter((r) => (status === "open" ? r.g.project.status !== "Closed" : status === "all" || r.g.project.status === status))
    .filter((r) => rag === "all" || r.m.rag.status === rag)
    .filter((r) => sponsor === "all" || r.g.project.sponsor === sponsor)
    .sort((a, b) => {
      if (sort === "variance") return a.m.variance - b.m.variance;
      if (sort === "end") return a.g.project.end < b.g.project.end ? -1 : 1;
      if (sort === "rag") return RAG_ORDER[b.m.rag.status] - RAG_ORDER[a.m.rag.status];
      return a.g.project.name.localeCompare(b.g.project.name);
    });

  const counts = { Green: 0, Amber: 0, Red: 0 } as Record<RagStatus, number>;
  rows.filter((r) => r.g.project.status !== "Closed").forEach((r) => counts[r.m.rag.status]++);

  if (graphs === undefined) return null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">Portfolio</h1>
          <p className="text-sm text-muted">
            {rows.length === 0
              ? "All your projects, on one screen."
              : `${counts.Red} Red · ${counts.Amber} Amber · ${counts.Green} Green across open projects`}
          </p>
        </div>
        <Button variant="primary" onClick={() => navigate("/new")}>
          + New project
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No projects yet"
            body="Create your first project in under 10 minutes with a template, or explore a sample project that's already mid-flight."
            action={
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => navigate("/new")}>
                  Create a project
                </Button>
                <Button
                  onClick={async () => {
                    const id = await createSampleProject();
                    notify("Sample project created");
                    navigate(`/p/${id}`);
                  }}
                >
                  Explore a sample
                </Button>
              </div>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap gap-2">
            <Select value={status} onChange={(e) => setStatus(e.target.value)} className="w-auto" aria-label="Project status">
              <option value="open">Open projects</option>
              <option value="Active">Active</option>
              <option value="On hold">On hold</option>
              <option value="Closed">Closed</option>
              <option value="all">All projects</option>
            </Select>
            <Select value={rag} onChange={(e) => setRag(e.target.value as typeof rag)} className="w-auto" aria-label="RAG">
              <option value="all">Any RAG</option>
              <option value="Red">Red</option>
              <option value="Amber">Amber</option>
              <option value="Green">Green</option>
            </Select>
            <Select value={sponsor} onChange={(e) => setSponsor(e.target.value)} className="w-auto" aria-label="Sponsor">
              <option value="all">Any sponsor</option>
              {sponsors.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
            <Select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className="w-auto" aria-label="Sort">
              <option value="variance">Sort: most behind first</option>
              <option value="rag">Sort: worst RAG first</option>
              <option value="end">Sort: end date</option>
              <option value="name">Sort: name</option>
            </Select>
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map(({ g, m }) => (
              <ProjectCard key={g.project.id} g={g} m={m} today={today} />
            ))}
          </div>
          {shown.length === 0 && <p className="mt-6 text-sm text-muted">No projects match these filters.</p>}
        </>
      )}
    </div>
  );
}

function ProjectCard({ g, m, today }: { g: ProjectGraph; m: ProjectMetrics; today: string }) {
  const ms = nextMilestone(g, today);
  const topRisk = g.raid.filter((r) => r.type === "R" && isOpen(r)).sort((a, b) => riskScore(b) - riskScore(a))[0];
  return (
    <Link to={`/p/${g.project.id}`} className="group flex flex-col gap-3 rounded-card border border-line bg-surface p-4 hover:border-line-strong">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold group-hover:text-accent">{g.project.name}</p>
          <p className="truncate text-xs text-muted">
            {g.project.code}
            {g.project.sponsor && ` · ${g.project.sponsor}`}
            {g.project.status !== "Active" && ` · ${g.project.status}`}
          </p>
        </div>
        <RagBadge status={m.rag.status} overridden={m.rag.overridden} size="sm" />
      </div>
      <div>
        <div className="flex items-baseline justify-between text-xs">
          <span>
            <span className="text-lg font-semibold tabular-nums">{fmtPct(m.actualPct)}</span>
            <span className="text-muted"> actual vs {fmtPct(m.plannedPct)} planned</span>
          </span>
        </div>
        <ProgressBar planned={m.plannedPct} actual={m.actualPct} className="mt-1.5" />
        <p className={m.variance < -0.05 ? "mt-1 text-xs text-amber" : "mt-1 text-xs text-muted"}>{fmtVariance(m.variance)}</p>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        <dt className="text-muted">Next milestone</dt>
        <dd className="truncate">{ms ? `${ms.name} · ${formatDate(ms.date)}` : "—"}</dd>
        <dt className="text-muted">Top risk</dt>
        <dd className="truncate">{topRisk ? `${topRisk.title} (${riskScore(topRisk)})` : "—"}</dd>
        <dt className="text-muted">Ends</dt>
        <dd>{formatDate(g.project.end)}</dd>
      </dl>
    </Link>
  );
}
