import { useLiveQuery } from "dexie-react-hooks";
import { useEffect, useMemo, useState } from "react";
import {
  addDependency,
  blankRaid,
  deleteActivity,
  loadGraph,
  moveActivityOrder,
  removeDependency,
  resetWeights,
  setSubStatus,
  updateActivity,
} from "../db/actions";
import { db } from "../db/db";
import { KANBAN_COLUMNS, RAID_SINGULAR, type Activity, type KanbanStatus, type ProjectGraph, type RaidItem } from "../db/types";
import { useSettings } from "../hooks/data";
import { formatDate, formatDateTime, isValidISO, todayISO } from "../lib/dates";
import { canLink, conflicts, endpoints } from "../lib/dependencies";
import { isStale } from "../lib/metrics";
import { buildTree, fmtPct, slipDays } from "../lib/progress";
import { isOpen } from "../lib/rag";
import { useApp } from "./AppContext";
import { PctWithMath } from "./Breakdown";
import { ConflictList } from "./Conflicts";
import { MilestoneModal } from "./ProjectModals";
import { RaidModal } from "./RaidModal";
import { BlockModal } from "./StatusModals";
import { Button, CloseIcon, Field, Input, Pill, Select, StaleBadge, Textarea, cx } from "./ui";
import { WeightCell } from "./WeightCell";

/** The one right-hand panel for any main or sub-activity, on any screen. */
export function ActivityPanel() {
  const { panelId, closePanel } = useApp();
  const target = useLiveQuery(async () => {
    if (!panelId) return null;
    const activity = await db.activities.get(panelId);
    const milestone = activity ? undefined : await db.milestones.get(panelId);
    const projectId = activity?.projectId ?? milestone?.projectId;
    const graph = projectId ? await loadGraph(projectId) : null;
    return { activity, milestone, graph };
  }, [panelId]);

  useEffect(() => {
    if (!panelId) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("[role=dialog]") && closePanel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [panelId, closePanel]);

  if (!panelId || !target?.graph) return null;
  if (target.milestone) {
    return <MilestoneModal open onClose={closePanel} projectId={target.graph.project.id} milestone={target.milestone} />;
  }
  if (!target.activity) return null;
  return <Panel key={target.activity.id} activity={target.activity} graph={target.graph} onClose={closePanel} />;
}

function Panel({ activity: a, graph, onClose }: { activity: Activity; graph: ProjectGraph; onClose: () => void }) {
  const { openPanel, notify } = useApp();
  const settings = useSettings();
  const today = todayISO();
  const tree = useMemo(() => buildTree(graph, today), [graph, today]);
  const node = tree.byId.get(a.id);
  const parentNode = a.parentId ? tree.byId.get(a.parentId) : tree.byId.get(a.phaseId);
  const isSub = a.level === "sub";
  const hasSubs = !!node && node.children.length > 0;
  const [name, setName] = useState(a.name);
  const [owner, setOwner] = useState(a.owner);
  const [notes, setNotes] = useState(a.notes);
  const [blockFor, setBlockFor] = useState<Activity | null>(null);
  const [raid, setRaid] = useState<RaidItem | null>(null);
  const [linkError, setLinkError] = useState<string | null>(null);
  useEffect(() => {
    setName(a.name);
    setOwner(a.owner);
    setNotes(a.notes);
  }, [a.name, a.owner, a.notes]);

  const points = useMemo(() => endpoints(tree, graph.milestones), [tree, graph.milestones]);
  const myConflicts = conflicts(graph.dependencies, points, tree.cal).filter((c) => c.successor.id === a.id || c.predecessor.id === a.id);
  const preds = graph.dependencies.filter((d) => d.successorId === a.id);
  const succs = graph.dependencies.filter((d) => d.predecessorId === a.id);
  const linkedRaid = graph.raid.filter((r) => r.linkedId === a.id);
  const mains = graph.activities.filter((x) => x.level === "main");
  const phaseName = new Map(graph.phases.map((p) => [p.id, p.name]));
  const slip = node ? slipDays(node, graph.baseline) : null;
  const base = graph.baseline?.items[a.id];
  const linkOptions = [...points.values()].filter((p) => p.id !== a.id && p.id !== a.parentId && !(graph.activities.find((x) => x.id === p.id)?.parentId === a.id));

  const setStatus = async (status: KanbanStatus) => {
    if (status === "Blocked") setBlockFor(a);
    else await setSubStatus(a.id, status, status === "In Progress" ? { pct: a.actualPct > 0 && a.actualPct < 100 ? a.actualPct : 10 } : {});
  };

  const link = async (dir: "pred" | "succ", otherId: string) => {
    if (!otherId) return;
    const [p, s] = dir === "pred" ? [otherId, a.id] : [a.id, otherId];
    const check = canLink(graph.dependencies, graph.activities, p, s);
    if (!check.ok) {
      setLinkError(check.message);
      return;
    }
    setLinkError(null);
    await addDependency(graph.project.id, p, s);
  };

  return (
    <>
      <div className="no-print fixed inset-0 z-40 bg-black/10 sm:bg-transparent" onClick={onClose} />
      <aside className="no-print fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-line bg-surface shadow-2xl" aria-label="Activity details">
        <header className="flex items-start gap-2 border-b border-line px-5 py-3">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted">
              {isSub ? "Sub-activity" : "Main activity"} · {graph.project.name}
            </p>
            <input
              className="-ml-1 w-full rounded px-1 text-lg font-semibold hover:bg-sunken focus:bg-sunken focus:outline-none"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => name.trim() && name !== a.name && updateActivity(a.id, { name: name.trim() })}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              aria-label="Name"
            />
          </div>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted hover:bg-sunken hover:text-ink" aria-label="Close panel">
            <CloseIcon />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          <div className="flex flex-col gap-5">
            {/* Progress */}
            {node && (
              <div className="grid grid-cols-3 gap-3 rounded-card bg-sunken p-3 text-center">
                <Stat label="Planned">
                  <PctWithMath node={node} field="plannedPct" />
                </Stat>
                <Stat label="Actual">
                  <PctWithMath node={node} field="actualPct" />
                </Stat>
                <Stat label="Weight">
                  {parentNode ? <WeightCell node={node} siblings={parentNode.children} className="text-sm" /> : fmtPct(node.weight)}
                </Stat>
              </div>
            )}
            {node && parentNode && (
              <p className="-mt-3 text-xs text-muted">
                Weight within {isSub ? `"${parentNode.name}"` : `phase "${parentNode.name}"`}.{" "}
                <button type="button" className="text-accent hover:underline" onClick={() => resetWeights(isSub ? { subsOf: a.parentId! } : { mainsOf: a.phaseId })}>
                  Reset group to duration
                </button>
                {hasSubs && (
                  <>
                    {" · "}
                    <button type="button" className="text-accent hover:underline" onClick={() => resetWeights({ subsOf: a.id })}>
                      Reset sub-activity weights
                    </button>
                  </>
                )}
              </p>
            )}

            {/* Status (subs) */}
            {isSub && (
              <div className="flex flex-col gap-3">
                <div className="grid grid-cols-4 gap-1" role="radiogroup" aria-label="Status">
                  {KANBAN_COLUMNS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={a.kanbanStatus === s}
                      onClick={() => setStatus(s)}
                      className={cx(
                        "rounded-md border px-1 py-1.5 text-xs font-medium",
                        a.kanbanStatus === s ? (s === "Blocked" ? "border-red bg-red-soft text-red" : s === "Done" ? "border-green bg-green-soft text-green" : "border-accent bg-accent-soft text-accent") : "border-line text-muted hover:bg-sunken",
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
                {a.kanbanStatus === "Blocked" && (
                  <p className="rounded-md bg-red-soft px-3 py-2 text-sm text-red">
                    <strong>Blocked:</strong> {a.blockedReason}{" "}
                    <button type="button" className="underline" onClick={() => setBlockFor(a)}>
                      Edit
                    </button>
                  </p>
                )}
                <PctSlider activity={a} />
              </div>
            )}

            {/* Dates */}
            <div className="grid grid-cols-2 gap-3">
              {hasSubs ? (
                <div className="col-span-2 text-sm">
                  <p className="text-xs font-medium text-muted">Dates (from sub-activities)</p>
                  <p className="mt-1">
                    {formatDate(node?.start)} – {formatDate(node?.end)} · {node?.duration} working days
                  </p>
                </div>
              ) : (
                <>
                  <Field label="Start">
                    <Input type="date" value={a.start} onChange={(e) => isValidISO(e.target.value) && updateActivity(a.id, { start: e.target.value, end: e.target.value > a.end ? e.target.value : a.end })} />
                  </Field>
                  <Field label="End">
                    <Input type="date" value={a.end} onChange={(e) => isValidISO(e.target.value) && e.target.value >= a.start && updateActivity(a.id, { end: e.target.value })} />
                  </Field>
                  <p className="col-span-2 -mt-1 text-xs text-muted">{tree.cal.workingDaysBetween(a.start, a.end)} working days{!isSub && " · used until the first sub-activity is added"}</p>
                </>
              )}
              {base && (
                <p className="col-span-2 text-xs text-muted">
                  Baseline {formatDate(base.start)} – {formatDate(base.end)}
                  {slip !== null && slip !== 0 && <span className={slip > 0 ? "font-medium text-amber" : "text-green"}> · {slip > 0 ? `${slip} days late` : `${-slip} days early`}</span>}
                </p>
              )}
            </div>

            {/* Owner and parent */}
            <div className="grid grid-cols-2 gap-3">
              <Field label="Owner">
                <Input value={owner} onChange={(e) => setOwner(e.target.value)} onBlur={() => owner.trim() && owner !== a.owner && updateActivity(a.id, { owner: owner.trim() })} />
              </Field>
              {isSub ? (
                <Field label="Main activity">
                  <Select value={a.parentId ?? ""} onChange={(e) => e.target.value && updateActivity(a.id, { parentId: e.target.value })}>
                    {mains.map((m) => (
                      <option key={m.id} value={m.id}>
                        {phaseName.get(m.phaseId)} › {m.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              ) : (
                <Field label="Phase">
                  <p className="flex h-9 items-center text-sm">{phaseName.get(a.phaseId)}</p>
                </Field>
              )}
            </div>

            {/* Sub-activities of a main */}
            {!isSub && node && (
              <Section title={`Sub-activities (${node.children.length})`}>
                {node.children.length === 0 ? (
                  <p className="text-xs text-muted">None yet. Add them on the Board or with + on the timeline.</p>
                ) : (
                  <ul className="flex flex-col">
                    {node.children.map((c) => (
                      <li key={c.id}>
                        <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-sunken" onClick={() => openPanel(c.id)}>
                          <span className="min-w-0 flex-1 truncate">{c.name}</span>
                          <span className="text-xs text-muted tabular-nums">{c.weight.toFixed(0)}% wt</span>
                          <span className="w-12 text-right text-xs tabular-nums">{fmtPct(c.actualPct)}</span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </Section>
            )}

            {/* Dependencies */}
            <Section title="Dependencies (finish-to-start)">
              {myConflicts.length > 0 && (
                <div className="mb-2">
                  <ConflictList items={myConflicts} compact />
                </div>
              )}
              <DepList label="Waits for" deps={preds.map((d) => ({ id: d.id, other: points.get(d.predecessorId)?.name ?? "?" }))} />
              <DepList label="Then" deps={succs.map((d) => ({ id: d.id, other: points.get(d.successorId)?.name ?? "?" }))} />
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Select value="" onChange={(e) => link("pred", e.target.value)} className="h-8 text-xs" aria-label="Add predecessor">
                  <option value="">+ Waits for…</option>
                  {linkOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.kind === "milestone" ? "◆ " : ""}
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Select value="" onChange={(e) => link("succ", e.target.value)} className="h-8 text-xs" aria-label="Add successor">
                  <option value="">+ Then…</option>
                  {linkOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.kind === "milestone" ? "◆ " : ""}
                      {p.name}
                    </option>
                  ))}
                </Select>
              </div>
              {linkError && <p className="mt-1.5 rounded-md bg-red-soft px-2 py-1.5 text-xs text-red">{linkError}</p>}
            </Section>

            {/* RAID */}
            <Section
              title={`Linked RAID items (${linkedRaid.length})`}
              action={
                <Select value="" onChange={(e) => e.target.value && setRaid({ ...blankRaid(graph.project.id, e.target.value as RaidItem["type"], a.owner || settings.myName), linkedId: a.id })} className="h-7 w-auto text-xs" aria-label="Add linked RAID item">
                  <option value="">+ Add…</option>
                  <option value="R">Risk</option>
                  <option value="A">Action</option>
                  <option value="I">Issue</option>
                  <option value="D">Decision</option>
                </Select>
              }
            >
              {linkedRaid.length === 0 ? (
                <p className="text-xs text-muted">None.</p>
              ) : (
                <ul className="flex flex-col">
                  {linkedRaid.map((r) => (
                    <li key={r.id}>
                      <button type="button" className="flex w-full items-center gap-2 rounded px-1 py-1 text-left text-sm hover:bg-sunken" onClick={() => setRaid(r)}>
                        <Pill className="w-16 justify-center">{RAID_SINGULAR[r.type]}</Pill>
                        <span className="min-w-0 flex-1 truncate">{r.title}</span>
                        <span className={cx("text-xs", isOpen(r) ? "text-muted" : "text-green")}>{r.status}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Section>

            <Field label="Notes">
              <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== a.notes && updateActivity(a.id, { notes })} />
            </Field>
          </div>
        </div>

        <footer className="flex flex-wrap items-center gap-2 border-t border-line px-5 py-3">
          <span className="mr-auto flex items-center gap-2 text-xs text-muted">
            Last updated {formatDateTime(a.updatedAt)}
            {isStale(a.updatedAt) && a.kanbanStatus !== "Done" && <StaleBadge />}
          </span>
          <Button size="sm" variant="ghost" onClick={() => moveActivityOrder(a.id, -1)} title="Move up">
            ↑
          </Button>
          <Button size="sm" variant="ghost" onClick={() => moveActivityOrder(a.id, 1)} title="Move down">
            ↓
          </Button>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              const subs = graph.activities.filter((x) => x.parentId === a.id).length;
              if (!confirm(`Delete "${a.name}"${subs ? ` and its ${subs} sub-activities` : ""}?`)) return;
              await deleteActivity(a.id);
              notify("Deleted");
              onClose();
            }}
          >
            Delete
          </Button>
        </footer>
      </aside>
      <BlockModal activity={blockFor} onClose={() => setBlockFor(null)} />
      <RaidModal item={raid} graph={graph} onClose={() => setRaid(null)} />
    </>
  );
}

function Stat({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <div className="text-lg font-semibold tabular-nums">{children}</div>
    </div>
  );
}

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-1.5 flex items-center justify-between">
        <h3 className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function DepList({ label, deps }: { label: string; deps: { id: string; other: string }[] }) {
  if (deps.length === 0) return null;
  return (
    <div className="mb-1">
      <p className="text-xs text-muted">{label}</p>
      <ul>
        {deps.map((d) => (
          <li key={d.id} className="flex items-center gap-2 py-0.5 text-sm">
            <span className="min-w-0 flex-1 truncate">{d.other}</span>
            <button type="button" className="text-xs text-muted hover:text-red" onClick={() => removeDependency(d.id)}>
              Remove
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PctSlider({ activity: a }: { activity: Activity }) {
  const [pct, setPct] = useState(a.actualPct);
  useEffect(() => setPct(a.actualPct), [a.actualPct]);
  const commit = async () => {
    if (pct === a.actualPct) return;
    // Sliding to 100 completes the card; sliding up from To Do starts it.
    if (pct >= 100) await setSubStatus(a.id, "Done");
    else if (a.kanbanStatus === "To Do" || a.kanbanStatus === "Done") await setSubStatus(a.id, pct === 0 ? "To Do" : "In Progress", { pct });
    else await updateActivity(a.id, { actualPct: pct });
  };
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-muted">Actual</span>
      <input type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} className="flex-1" aria-label="Actual percent complete" />
      <span className="w-10 text-right text-sm font-semibold tabular-nums">{pct}%</span>
    </div>
  );
}
