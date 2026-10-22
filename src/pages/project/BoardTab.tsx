import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { AddActivityModal, type AddTarget } from "../../components/AddActivityModal";
import { useApp } from "../../components/AppContext";
import { BlockModal, PercentModal } from "../../components/StatusModals";
import { Button, Pill, Select, StaleBadge, cx } from "../../components/ui";
import { setSubStatus, updateActivity } from "../../db/actions";
import { KANBAN_COLUMNS, type Activity, type KanbanStatus } from "../../db/types";
import { formatShort, todayISO } from "../../lib/dates";
import { isStale } from "../../lib/metrics";
import { useProject } from "../ProjectLayout";
import { PHASE_COLORS } from "./TimelineTab";

type Group = "none" | "phase" | "main";

export function BoardTab() {
  const { graph } = useProject();
  const [phaseFilter, setPhaseFilter] = useState("all");
  const [mainFilter, setMainFilter] = useState("all");
  const [group, setGroup] = useState<Group>(() => (localStorage.getItem("minipmo-board-group") as Group) || "none");
  const [addTarget, setAddTarget] = useState<AddTarget | null>(null);
  const [askPct, setAskPct] = useState<Activity | null>(null);
  const [askBlock, setAskBlock] = useState<Activity | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }));

  useEffect(() => {
    try {
      localStorage.setItem("minipmo-board-group", group);
    } catch {
      /* private mode */
    }
  }, [group]);

  const phases = useMemo(() => [...graph.phases].sort((a, b) => a.order - b.order), [graph.phases]);
  const phaseIndex = new Map(phases.map((p, i) => [p.id, i]));
  const mains = useMemo(
    () => graph.activities.filter((a) => a.level === "main").sort((a, b) => (phaseIndex.get(a.phaseId)! - phaseIndex.get(b.phaseId)!) || a.order - b.order),
    [graph.activities, phases],
  );
  const mainById = new Map(mains.map((m) => [m.id, m]));
  const subs = graph.activities
    .filter((a) => a.level === "sub")
    .filter((a) => phaseFilter === "all" || a.phaseId === phaseFilter)
    .filter((a) => mainFilter === "all" || a.parentId === mainFilter)
    .sort((a, b) => (a.end < b.end ? -1 : a.end > b.end ? 1 : 0));

  const lanes: { key: string; label: string; items: Activity[] }[] =
    group === "none"
      ? [{ key: "all", label: "", items: subs }]
      : group === "phase"
        ? phases.filter((p) => phaseFilter === "all" || p.id === phaseFilter).map((p) => ({ key: p.id, label: p.name, items: subs.filter((s) => s.phaseId === p.id) }))
        : mains.filter((m) => (phaseFilter === "all" || m.phaseId === phaseFilter) && (mainFilter === "all" || m.id === mainFilter)).map((m) => ({ key: m.id, label: m.name, items: subs.filter((s) => s.parentId === m.id) }));

  const onDragEnd = async (e: DragEndEvent) => {
    const id = String(e.active.id);
    const target = e.over ? (String(e.over.id).split("::")[1] as KanbanStatus) : null;
    const a = graph.activities.find((x) => x.id === id);
    if (!a || !target || target === a.kanbanStatus) return;
    if (target === "In Progress") setAskPct(a);
    else if (target === "Blocked") setAskBlock(a);
    else await setSubStatus(id, target);
  };

  if (mains.length === 0) {
    return (
      <div className="p-8 text-center text-sm text-muted">
        <p className="font-medium text-ink">No main activities yet</p>
        <p className="mt-1">Every card on the board is a sub-activity tagged to a main activity. Add phases and main activities on the Timeline first.</p>
        <Link to="../timeline" className="mt-3 inline-block font-medium text-accent hover:underline">
          Go to the Timeline →
        </Link>
      </div>
    );
  }

  return (
    <div className="flex flex-col">
      <div className="no-print flex flex-wrap items-center gap-2 border-b border-line px-4 py-2 sm:px-8">
        <Select value={phaseFilter} onChange={(e) => { setPhaseFilter(e.target.value); setMainFilter("all"); }} className="h-8 w-auto text-xs" aria-label="Filter by phase">
          <option value="all">All phases</option>
          {phases.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select value={mainFilter} onChange={(e) => setMainFilter(e.target.value)} className="h-8 w-auto max-w-56 text-xs" aria-label="Filter by main activity">
          <option value="all">All main activities</option>
          {mains
            .filter((m) => phaseFilter === "all" || m.phaseId === phaseFilter)
            .map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
        </Select>
        <Select value={group} onChange={(e) => setGroup(e.target.value as Group)} className="h-8 w-auto text-xs" aria-label="Swimlanes">
          <option value="none">No swimlanes</option>
          <option value="phase">Swimlanes by phase</option>
          <option value="main">Swimlanes by main activity</option>
        </Select>
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setAddTarget({ kind: "sub", mainId: mainFilter !== "all" ? mainFilter : null })}>
          + Sub-activity
        </Button>
      </div>

      <DndContext sensors={sensors} onDragEnd={onDragEnd}>
        <div className="flex flex-col gap-6 px-4 py-4 sm:px-8">
          {lanes.map((lane) => (
            <section key={lane.key}>
              {lane.label && <h3 className="mb-2 text-sm font-semibold">{lane.label} <span className="font-normal text-muted">({lane.items.length})</span></h3>}
              <div className="grid auto-cols-[minmax(250px,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1">
                {KANBAN_COLUMNS.map((status) => (
                  <Column
                    key={status}
                    id={`${lane.key}::${status}`}
                    status={status}
                    items={lane.items.filter((s) => s.kanbanStatus === status)}
                    mainById={mainById}
                    phaseIndex={phaseIndex}
                    onAdd={() => setAddTarget({ kind: "sub", mainId: group === "main" ? lane.key : mainFilter !== "all" ? mainFilter : null, status })}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      </DndContext>

      <AddActivityModal graph={graph} target={addTarget} onClose={() => setAddTarget(null)} />
      <PercentModal activity={askPct} onClose={() => setAskPct(null)} />
      <BlockModal activity={askBlock} onClose={() => setAskBlock(null)} />
    </div>
  );
}

const COLUMN_TONE: Record<KanbanStatus, string> = {
  "To Do": "text-muted",
  "In Progress": "text-accent",
  Blocked: "text-red",
  Done: "text-green",
};

function Column({
  id,
  status,
  items,
  mainById,
  phaseIndex,
  onAdd,
}: {
  id: string;
  status: KanbanStatus;
  items: Activity[];
  mainById: Map<string, Activity>;
  phaseIndex: Map<string, number>;
  onAdd: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div ref={setNodeRef} className={cx("flex min-h-32 flex-col gap-2 rounded-card border bg-sunken/60 p-2", isOver ? "border-accent" : "border-transparent")}>
      <div className="flex items-center justify-between px-1">
        <span className={cx("text-xs font-semibold tracking-wide uppercase", COLUMN_TONE[status])}>
          {status} <span className="font-normal text-faint">{items.length}</span>
        </span>
        <button type="button" onClick={onAdd} className="rounded px-1 text-sm text-muted hover:bg-line hover:text-ink" aria-label={`Add to ${status}`} title="Quick add">
          +
        </button>
      </div>
      {items.map((a) => (
        <Card key={a.id} a={a} main={mainById.get(a.parentId ?? "")} color={PHASE_COLORS[(phaseIndex.get(a.phaseId) ?? 0) % PHASE_COLORS.length]} />
      ))}
    </div>
  );
}

function Card({ a, main, color }: { a: Activity; main: Activity | undefined; color: string }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: a.id });
  const { openPanel } = useApp();
  const [pct, setPct] = useState(a.actualPct);
  useEffect(() => setPct(a.actualPct), [a.actualPct]);
  const overdue = a.kanbanStatus !== "Done" && a.end < todayISO();
  const commitPct = () => {
    // Keeps the column (a blocked card stays blocked).
    if (pct !== a.actualPct) void updateActivity(a.id, { actualPct: pct });
  };

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ transform: transform ? `translate(${transform.x}px, ${transform.y}px)` : undefined }}
      className={cx("touch-none rounded-md border border-line bg-surface p-2.5 text-sm shadow-xs", isDragging ? "z-50 opacity-90 shadow-lg" : "hover:border-line-strong")}
      onClick={() => openPanel(a.id)}
    >
      <span className="mb-1.5 inline-flex max-w-full items-center gap-1 truncate rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: `color-mix(in srgb, ${color} 14%, transparent)`, color }}>
        {main?.name ?? "No main activity"}
      </span>
      <p className="leading-snug font-medium">{a.name}</p>
      {a.kanbanStatus === "Blocked" && (
        <p className="mt-1 rounded bg-red-soft px-1.5 py-1 text-xs text-red">
          <strong>Blocked:</strong> {a.blockedReason || "no reason given"}
        </p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        <span className={cx("tabular-nums", overdue && "font-medium text-red")}>
          {formatShort(a.start)} – {formatShort(a.end)}
          {overdue && " · overdue"}
        </span>
        <span className="truncate">{a.owner}</span>
        {isStale(a.updatedAt) && a.kanbanStatus !== "Done" && <StaleBadge />}
        <span className="ml-auto font-medium text-ink tabular-nums">{Math.round(pct)}%</span>
      </div>
      {(a.kanbanStatus === "In Progress" || a.kanbanStatus === "Blocked") && (
        <input
          type="range"
          min={0}
          max={99}
          step={5}
          value={pct}
          aria-label={`Percent complete for ${a.name}`}
          className="mt-1.5 w-full"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => setPct(Number(e.target.value))}
          onPointerUp={commitPct}
          onKeyUp={commitPct}
          onBlur={commitPct}
        />
      )}
      {a.kanbanStatus === "Done" && <Pill tone="green" className="mt-1.5">Done</Pill>}
    </div>
  );
}
