import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { AddActivityModal, type AddTarget } from "../../components/AddActivityModal";
import { useApp } from "../../components/AppContext";
import { PctWithMath } from "../../components/Breakdown";
import { ConflictList, useConflicts } from "../../components/Conflicts";
import { MilestoneModal } from "../../components/ProjectModals";
import { Button, ChevronIcon, Field, Input, Modal, PlusIcon, cx } from "../../components/ui";
import { WeightCell } from "../../components/WeightCell";
import { addPhase, deletePhase, movePhase, moveActivity, resetWeights, updateActivity, updatePhase } from "../../db/actions";
import type { Milestone, Phase } from "../../db/types";
import { addDays, formatDate, formatShort, fromDay, monthLabel, todayISO, toDay, weekdayOfDay, weekStart } from "../../lib/dates";
import { slipDays, type ProgressNode } from "../../lib/progress";
import { useProject } from "../ProjectLayout";

type Zoom = "week" | "month" | "quarter";
const PX: Record<Zoom, number> = { week: 30, month: 10, quarter: 3.5 };
const LEFT = 340;
const ROW = 34;
const HEADER = 46;

type Row =
  | { type: "milestones"; key: string }
  | { type: "phase"; key: string; node: ProgressNode; siblings: ProgressNode[] }
  | { type: "main"; key: string; node: ProgressNode; siblings: ProgressNode[]; phaseIndex: number }
  | { type: "sub"; key: string; node: ProgressNode; siblings: ProgressNode[]; phaseIndex: number };

interface DragState {
  id: string;
  mode: "move" | "start" | "end";
  originX: number;
  delta: number;
  moved: boolean;
}

export const PHASE_COLORS = ["#4f46e5", "#0891b2", "#059669", "#d97706", "#db2777", "#7c3aed", "#0d9488", "#dc2626"];

function loadCollapsed(projectId: string): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(`minipmo-collapsed-${projectId}`) ?? "[]"));
  } catch {
    return new Set();
  }
}

export function TimelineTab() {
  const { graph, metrics } = useProject();
  const { openPanel } = useApp();
  const tree = metrics.tree;
  const today = todayISO();
  const [zoom, setZoom] = useState<Zoom>(() => (localStorage.getItem("minipmo-zoom") as Zoom) || "month");
  const [showBaseline, setShowBaseline] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(graph.project.id));
  const [drag, setDrag] = useState<DragState | null>(null);
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const [phaseEdit, setPhaseEdit] = useState<Phase | null>(null);
  const [milestone, setMilestone] = useState<{ open: boolean; m: Milestone | null }>({ open: false, m: null });
  const conflicts = useConflicts(graph, tree);
  const scroller = useRef<HTMLDivElement>(null);
  const px = PX[zoom];

  useEffect(() => {
    try {
      localStorage.setItem(`minipmo-collapsed-${graph.project.id}`, JSON.stringify([...collapsed]));
      localStorage.setItem("minipmo-zoom", zoom);
    } catch {
      /* private mode */
    }
  }, [collapsed, zoom, graph.project.id]);

  const toggle = (id: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  // ------------------------------------------------------------ rows
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    if (graph.milestones.length) out.push({ type: "milestones", key: "milestones" });
    const phases = tree.root.children;
    phases.forEach((ph, phaseIndex) => {
      out.push({ type: "phase", key: ph.id, node: ph, siblings: phases });
      if (collapsed.has(ph.id)) return;
      for (const main of ph.children) {
        out.push({ type: "main", key: main.id, node: main, siblings: ph.children, phaseIndex });
        if (collapsed.has(main.id)) continue;
        for (const sub of main.children) out.push({ type: "sub", key: sub.id, node: sub, siblings: main.children, phaseIndex });
      }
    });
    return out;
  }, [tree, graph.milestones.length, collapsed]);

  // ------------------------------------------------------------ range
  const range = useMemo(() => {
    let lo = graph.project.start;
    let hi = graph.project.end;
    const see = (s?: string | null, e?: string | null) => {
      if (s && s < lo) lo = s;
      if (e && e > hi) hi = e;
    };
    for (const n of tree.byId.values()) see(n.start, n.end);
    for (const m of graph.milestones) see(m.date, m.date);
    if (graph.baseline) for (const b of Object.values(graph.baseline.items)) see(b.start, b.end);
    see(today, today);
    const start = weekStart(addDays(lo, -7));
    const end = addDays(hi, 21);
    return { start, startDay: toDay(start), days: toDay(end) - toDay(start) + 1 };
  }, [tree, graph.project, graph.milestones, graph.baseline, today]);

  const xOf = (iso: string) => (toDay(iso) - range.startDay) * px;
  const width = range.days * px;

  // Scroll so today is in view on first render and on zoom change.
  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollLeft = Math.max(0, xOf(today) - (el.clientWidth - LEFT) / 3);
  }, [zoom]);

  // ------------------------------------------------------------ drag
  const datesFor = (node: ProgressNode): { start: string; end: string } | null => {
    if (!node.start || !node.end) return null;
    if (!drag || drag.id !== node.id) return { start: node.start, end: node.end };
    const d = drag.delta;
    if (drag.mode === "move") return { start: addDays(node.start, d), end: addDays(node.end, d) };
    if (drag.mode === "start") return { start: addDays(node.start, Math.min(d, toDay(node.end) - toDay(node.start))), end: node.end };
    return { start: node.start, end: addDays(node.end, Math.max(d, toDay(node.start) - toDay(node.end))) };
  };

  const startDrag = (e: ReactPointerEvent, node: ProgressNode, mode: DragState["mode"]) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    setDrag({ id: node.id, mode, originX: e.clientX, delta: 0, moved: false });
  };
  const onDragMove = (e: ReactPointerEvent) => {
    if (!drag) return;
    const delta = Math.round((e.clientX - drag.originX) / px);
    if (delta !== drag.delta || (!drag.moved && Math.abs(e.clientX - drag.originX) > 3)) setDrag({ ...drag, delta, moved: drag.moved || Math.abs(e.clientX - drag.originX) > 3 });
  };
  const endDrag = async (node: ProgressNode) => {
    if (!drag) return;
    const d = drag;
    const next = datesFor(node);
    setDrag(null);
    if (!d.moved || d.delta === 0) {
      if (!d.moved) openPanel(node.id);
      return;
    }
    if (!next) return;
    if (d.mode === "move") await moveActivity(node.id, next.start, next.end);
    else await updateActivity(node.id, next);
  };

  // ------------------------------------------------------------ dependency arrows
  const rowIndex = new Map<string, number>();
  rows.forEach((r, i) => {
    if (r.type === "milestones") graph.milestones.forEach((m) => rowIndex.set(m.id, i));
    else rowIndex.set(r.node.id, i);
  });
  const conflictIds = new Set(conflicts.map((c) => c.dependency.id));
  const pointDates = new Map<string, { start: string; end: string; milestone: boolean }>();
  for (const n of tree.byId.values()) if (n.start && n.end && (n.kind === "main" || n.kind === "sub")) pointDates.set(n.id, { start: n.start, end: n.end, milestone: false });
  for (const m of graph.milestones) pointDates.set(m.id, { start: m.date, end: m.date, milestone: true });

  const height = rows.length * ROW;

  return (
    <div className="flex h-full flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 sm:px-8">
        <div className="flex rounded-md border border-line p-0.5" role="group" aria-label="Zoom">
          {(["week", "month", "quarter"] as Zoom[]).map((z) => (
            <button key={z} type="button" onClick={() => setZoom(z)} className={cx("rounded px-2.5 py-1 text-xs font-medium capitalize", zoom === z ? "bg-accent-soft text-accent" : "text-muted hover:text-ink")}>
              {z}
            </button>
          ))}
        </div>
        <Button size="sm" onClick={() => setCollapsed(new Set(tree.root.children.flatMap((p) => [p.id, ...p.children.map((c) => c.id)])))}>
          Collapse all
        </Button>
        <Button size="sm" onClick={() => setCollapsed(new Set())}>
          Expand all
        </Button>
        {graph.baseline && (
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input type="checkbox" checked={showBaseline} onChange={(e) => setShowBaseline(e.target.checked)} /> Baseline bars
          </label>
        )}
        <div className="ml-auto flex flex-wrap gap-2">
          <Button size="sm" onClick={() => resetWeights({ phasesOf: graph.project.id })} title="Phase weights back to working-day duration">
            Reset phase weights
          </Button>
          <Button size="sm" onClick={() => setMilestone({ open: true, m: null })}>
            + Milestone
          </Button>
          <Button
            size="sm"
            variant="primary"
            onClick={async () => {
              const name = prompt("Phase name", `Phase ${graph.phases.length + 1}`);
              if (name?.trim()) await addPhase(graph.project.id, name.trim());
            }}
          >
            + Phase
          </Button>
        </div>
      </div>

      {conflicts.length > 0 && (
        <div className="no-print border-b border-line px-4 py-3 sm:px-8">
          <ConflictList items={conflicts} compact />
        </div>
      )}

      {rows.length === 0 ? (
        <div className="p-8 text-center text-sm text-muted">
          <p className="font-medium text-ink">No phases yet</p>
          <p className="mt-1">Build the plan as phases and main activities here. Sub-activities added on the Board will slot in underneath.</p>
          <Button
            className="mt-3"
            variant="primary"
            onClick={async () => {
              const name = prompt("Phase name", "Phase 1");
              if (name?.trim()) await addPhase(graph.project.id, name.trim());
            }}
          >
            + Add the first phase
          </Button>
        </div>
      ) : (
        <div ref={scroller} className="relative min-h-0 flex-1 overflow-auto" style={{ maxHeight: "calc(100vh - 150px)" }} onPointerMove={onDragMove}>
          <div style={{ width: LEFT + width }} className="relative">
            {/* Header */}
            <div className="sticky top-0 z-20 flex border-b border-line bg-surface" style={{ height: HEADER }}>
              <div className="sticky left-0 z-10 flex shrink-0 items-end border-r border-line bg-surface px-3 pb-1.5 text-xs font-medium text-muted" style={{ width: LEFT }}>
                <span className="flex-1">Activity</span>
                <span className="w-16 text-right">Weight</span>
                <span className="w-14 text-right">Actual</span>
              </div>
              <TimeHeader startDay={range.startDay} days={range.days} px={px} zoom={zoom} />
            </div>

            {/* Body background: weekends/holidays (week zoom) + month lines */}
            <div className="pointer-events-none absolute" style={{ left: LEFT, top: HEADER, width, height }}>
              <GridBackground startDay={range.startDay} days={range.days} px={px} zoom={zoom} isWorking={tree.cal.isWorkingDay} />
            </div>

            {rows.map((r) => (
              <div key={r.key} className="group relative flex border-b border-line/60" style={{ height: ROW }}>
                <LeftCell
                  row={r}
                  collapsed={collapsed}
                  toggle={toggle}
                  onOpen={(id) => openPanel(id)}
                  onPhase={(p) => setPhaseEdit(p)}
                  onAdd={setAddTarget}
                />
                <div className="relative shrink-0" style={{ width }}>
                  {r.type === "milestones" ? (
                    graph.milestones.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        className="absolute top-1/2 z-[2] -translate-x-1/2 -translate-y-1/2"
                        style={{ left: xOf(m.date) + px / 2 }}
                        onClick={() => setMilestone({ open: true, m })}
                        title={`${m.name} · ${formatDate(m.date)} · ${m.signoff}`}
                      >
                        <span
                          className={cx(
                            "block h-3.5 w-3.5 rotate-45 border-2",
                            m.signoff === "Approved" ? "border-green bg-green" : m.date < today ? "border-red bg-red-soft" : "border-accent bg-surface",
                          )}
                        />
                        {zoom !== "quarter" && <span className="absolute top-1/2 left-4 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted">{m.name}</span>}
                      </button>
                    ))
                  ) : (
                    <Bar
                      row={r}
                      dates={datesFor(r.node)}
                      baseline={showBaseline && graph.baseline ? graph.baseline.items[r.node.id] ?? null : null}
                      slip={slipDays(r.node, graph.baseline)}
                      xOf={xOf}
                      px={px}
                      dragging={drag?.id === r.node.id}
                      onPointerDown={startDrag}
                      onPointerUp={() => endDrag(r.node)}
                    />
                  )}
                </div>
              </div>
            ))}

            {/* Overlay: today line and dependency arrows */}
            <svg className="pointer-events-none absolute z-[3]" style={{ left: LEFT, top: HEADER }} width={width} height={height}>
              <defs>
                <marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--faint)" />
                </marker>
                <marker id="arrow-bad" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                  <path d="M0,0 L8,4 L0,8 z" fill="var(--red)" />
                </marker>
              </defs>
              <line x1={xOf(today)} x2={xOf(today)} y1={0} y2={height} stroke="var(--red)" strokeWidth="1.5" strokeDasharray="4 3" />
              {graph.dependencies.map((d) => {
                const a = pointDates.get(d.predecessorId);
                const b = pointDates.get(d.successorId);
                const ra = rowIndex.get(d.predecessorId);
                const rb = rowIndex.get(d.successorId);
                if (!a || !b || ra === undefined || rb === undefined) return null;
                const x1 = xOf(a.end) + (a.milestone ? px / 2 : px);
                const y1 = ra * ROW + ROW / 2;
                const x2 = xOf(b.start) + (b.milestone ? px / 2 - 6 : 0);
                const y2 = rb * ROW + ROW / 2;
                const bad = conflictIds.has(d.id);
                const path = x2 - 8 >= x1 + 8
                  ? `M${x1},${y1} H${x1 + 8} V${y2} H${x2}`
                  : `M${x1},${y1} h8 V${(y1 + y2) / 2} H${x2 - 10} V${y2} H${x2}`;
                return <path key={d.id} d={path} fill="none" stroke={bad ? "var(--red)" : "var(--faint)"} strokeWidth={bad ? 1.6 : 1.2} markerEnd={`url(#${bad ? "arrow-bad" : "arrow"})`} />;
              })}
            </svg>
          </div>
        </div>
      )}

      <AddActivityModal graph={graph} target={addTarget} onClose={() => setAddTarget(null)} />
      <MilestoneModal open={milestone.open} onClose={() => setMilestone({ open: false, m: null })} projectId={graph.project.id} milestone={milestone.m} />
      <PhaseModal phase={phaseEdit} onClose={() => setPhaseEdit(null)} count={graph.phases.length} />
    </div>
  );
}

function LeftCell({
  row,
  collapsed,
  toggle,
  onOpen,
  onPhase,
  onAdd,
}: {
  row: Row;
  collapsed: Set<string>;
  toggle: (id: string) => void;
  onOpen: (id: string) => void;
  onPhase: (p: Phase) => void;
  onAdd: (t: AddTarget) => void;
}) {
  const base = "sticky left-0 z-10 flex shrink-0 items-center gap-1 border-r border-line bg-surface pr-2 text-sm group-hover:bg-sunken";
  if (row.type === "milestones") {
    return (
      <div className={cx(base, "pl-3 text-xs font-semibold tracking-wide text-muted uppercase")} style={{ width: LEFT }}>
        Milestones
      </div>
    );
  }
  const n = row.node;
  const hasChildren = n.children.length > 0;
  const indent = row.type === "phase" ? 4 : row.type === "main" ? 18 : 40;
  return (
    <div className={base} style={{ width: LEFT, paddingLeft: indent }}>
      {row.type !== "sub" ? (
        <button type="button" className={cx("flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted hover:bg-line", !hasChildren && "invisible")} onClick={() => toggle(n.id)} aria-label={collapsed.has(n.id) ? "Expand" : "Collapse"}>
          <ChevronIcon open={!collapsed.has(n.id)} />
        </button>
      ) : (
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: PHASE_COLORS[row.phaseIndex % PHASE_COLORS.length] }} aria-hidden />
      )}
      <button
        type="button"
        className={cx("min-w-0 flex-1 truncate text-left hover:text-accent", row.type === "phase" ? "font-semibold" : row.type === "main" ? "font-medium" : "text-muted")}
        onClick={() => (row.type === "phase" ? onPhase(n.phase!) : onOpen(n.id))}
        title={n.name}
      >
        {n.name}
      </button>
      {row.type !== "sub" && (
        <button
          type="button"
          className="invisible flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted group-hover:visible hover:bg-line hover:text-ink"
          title={row.type === "phase" ? "Add main activity" : "Add sub-activity"}
          aria-label={row.type === "phase" ? "Add main activity" : "Add sub-activity"}
          onClick={() => onAdd(row.type === "phase" ? { kind: "main", phaseId: n.id } : { kind: "sub", mainId: n.id })}
        >
          <PlusIcon />
        </button>
      )}
      <WeightCell node={n} siblings={row.siblings} className="w-16" />
      <span className="w-14 text-right text-xs tabular-nums">
        <PctWithMath node={n} field="actualPct" />
      </span>
    </div>
  );
}

function Bar({
  row,
  dates,
  baseline,
  slip,
  xOf,
  px,
  dragging,
  onPointerDown,
  onPointerUp,
}: {
  row: Exclude<Row, { type: "milestones" }>;
  dates: { start: string; end: string } | null;
  baseline: { start: string; end: string } | null;
  slip: number | null;
  xOf: (iso: string) => number;
  px: number;
  dragging: boolean;
  onPointerDown: (e: ReactPointerEvent, n: ProgressNode, mode: DragState["mode"]) => void;
  onPointerUp: () => void;
}) {
  const n = row.node;
  if (!dates) return null;
  const left = xOf(dates.start);
  const w = Math.max(px, xOf(dates.end) - left + px);
  const color = row.type === "phase" ? "var(--ink)" : PHASE_COLORS[(row.phaseIndex ?? 0) % PHASE_COLORS.length];
  const status = n.activity?.kanbanStatus;
  const draggable = row.type === "sub" || row.type === "main";
  const resizable = row.type === "sub" || (row.type === "main" && n.children.length === 0);
  const label = `${n.name}: ${formatDate(dates.start)} – ${formatDate(dates.end)} · planned ${n.plannedPct.toFixed(1)}%, actual ${n.actualPct.toFixed(1)}%${slip ? ` · ${slip > 0 ? "+" : ""}${slip} days vs baseline` : ""}`;

  return (
    <>
      {baseline && (
        <div className="absolute rounded-sm bg-faint/50" style={{ left: xOf(baseline.start), width: Math.max(px, xOf(baseline.end) - xOf(baseline.start) + px), top: ROW - 9, height: 4 }} title={`Baseline ${formatDate(baseline.start)} – ${formatDate(baseline.end)}`} />
      )}
      {row.type === "phase" ? (
        <div className="absolute rounded-sm" style={{ left, width: w, top: 11, height: 8, background: "var(--line-strong)" }} title={label}>
          <div className="h-full rounded-sm" style={{ width: `${n.actualPct}%`, background: color }} />
        </div>
      ) : (
        <div
          role="button"
          tabIndex={0}
          aria-label={label}
          title={label}
          className={cx(
            "absolute z-[2] overflow-hidden rounded-[5px] border select-none",
            draggable && "cursor-grab active:cursor-grabbing",
            dragging && "opacity-80 ring-2 ring-accent",
            status === "Blocked" && "ring-2 ring-red",
          )}
          style={{
            left,
            width: w,
            top: row.type === "main" ? 6 : 8,
            height: row.type === "main" ? 18 : 14,
            borderColor: color,
            background: `color-mix(in srgb, ${color} ${row.type === "main" ? 22 : 14}%, var(--surface))`,
          }}
          onPointerDown={(e) => draggable && onPointerDown(e, n, "move")}
          onPointerUp={onPointerUp}
        >
          {/* Actual progress shading inside the planned bar */}
          <div className="h-full" style={{ width: `${n.actualPct}%`, background: color, opacity: 0.75 }} />
          {resizable && (
            <>
              <span className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, n, "start")} onPointerUp={onPointerUp} />
              <span className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" onPointerDown={(e) => onPointerDown(e, n, "end")} onPointerUp={onPointerUp} />
            </>
          )}
        </div>
      )}
      {slip !== null && slip > 0 && row.type !== "phase" && (
        <span className="absolute text-[10px] font-medium text-amber" style={{ left: left + w + 4, top: 9 }}>
          +{slip}d
        </span>
      )}
    </>
  );
}

function TimeHeader({ startDay, days, px, zoom }: { startDay: number; days: number; px: number; zoom: Zoom }) {
  const months: { label: string; x: number; w: number }[] = [];
  const ticks: { label: string; x: number }[] = [];
  let monthStart = 0;
  for (let i = 0; i <= days; i++) {
    const iso = fromDay(startDay + i);
    const first = i === days || (i > 0 && iso.endsWith("-01"));
    if (first) {
      months.push({ label: monthLabel(fromDay(startDay + monthStart)), x: monthStart * px, w: (i - monthStart) * px });
      monthStart = i;
    }
    if (i < days) {
      if (zoom === "week") ticks.push({ label: iso.slice(8).replace(/^0/, ""), x: i * px });
      else if (zoom === "month" && weekdayOfDay(startDay + i) === 1) ticks.push({ label: formatShort(iso), x: i * px });
    }
  }
  return (
    <div className="relative shrink-0 text-[11px] text-muted" style={{ width: days * px }}>
      <div className="absolute inset-x-0 top-0 h-6">
        {months.map((m) => (
          <div key={m.x} className="absolute top-0 h-full truncate border-l border-line px-1.5 pt-1 font-medium text-ink" style={{ left: m.x, width: m.w }}>
            {m.w > 40 ? m.label : ""}
          </div>
        ))}
      </div>
      <div className="absolute inset-x-0 bottom-0 h-5">
        {ticks.map((t) => (
          <div key={t.x} className="absolute bottom-0 h-full border-l border-line/70 pl-1" style={{ left: t.x, width: zoom === "week" ? px : 7 * px }}>
            {t.label}
          </div>
        ))}
      </div>
    </div>
  );
}

function GridBackground({ startDay, days, px, zoom, isWorking }: { startDay: number; days: number; px: number; zoom: Zoom; isWorking: (iso: string) => boolean }) {
  const cells: { x: number; off: boolean; line: boolean }[] = [];
  for (let i = 0; i < days; i++) {
    const iso = fromDay(startDay + i);
    const off = zoom !== "quarter" && !isWorking(iso);
    const line = iso.endsWith("-01") || (zoom === "month" && weekdayOfDay(startDay + i) === 1);
    if (off || line) cells.push({ x: i * px, off, line });
  }
  return (
    <>
      {cells.map((c) => (
        <div key={c.x} className={cx("absolute inset-y-0", c.off && "bg-sunken/70", c.line && "border-l border-line/70")} style={{ left: c.x, width: c.off ? px : 0 }} />
      ))}
    </>
  );
}

function PhaseModal({ phase, onClose, count }: { phase: Phase | null; onClose: () => void; count: number }) {
  const [name, setName] = useState("");
  useEffect(() => setName(phase?.name ?? ""), [phase]);
  if (!phase) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="Phase"
      footer={
        <>
          <Button
            variant="danger"
            className="mr-auto"
            onClick={async () => {
              if (!confirm(`Delete phase "${phase.name}" with all its activities?`)) return;
              await deletePhase(phase.id);
              onClose();
            }}
          >
            Delete phase
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!name.trim()}
            onClick={async () => {
              await updatePhase(phase.id, { name: name.trim() });
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={phase.order === 0} onClick={() => movePhase(phase.projectId, phase.id, -1)}>
            Move up
          </Button>
          <Button size="sm" disabled={phase.order >= count - 1} onClick={() => movePhase(phase.projectId, phase.id, 1)}>
            Move down
          </Button>
          <Button size="sm" onClick={() => resetWeights({ mainsOf: phase.id })}>
            Reset main activity weights to duration
          </Button>
        </div>
        <p className="text-xs text-muted">Set this phase's weight from the Weight column on the timeline.</p>
      </div>
    </Modal>
  );
}

