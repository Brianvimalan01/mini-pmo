import { useState } from "react";
import { RaidModal } from "../../components/RaidModal";
import { Button, Input, Pill, Select, StaleBadge, Tabs, cx } from "../../components/ui";
import { blankRaid, updateRaid } from "../../db/actions";
import { RAID_LABELS, RAID_SINGULAR, RAID_STATUSES, type RaidItem, type RaidType } from "../../db/types";
import { useSettings } from "../../hooks/data";
import { formatDate, relativeTime, todayISO } from "../../lib/dates";
import { isStale } from "../../lib/metrics";
import { isOpen, riskScore } from "../../lib/rag";
import { useProject } from "../ProjectLayout";

const TYPES: RaidType[] = ["R", "A", "I", "D"];

export function RaidTab() {
  const { graph } = useProject();
  const settings = useSettings();
  const [type, setType] = useState<RaidType>("R");
  const [show, setShow] = useState<"open" | "closed" | "all">("open");
  const [q, setQ] = useState("");
  const [cell, setCell] = useState<{ l: number; i: number } | null>(null);
  const [editing, setEditing] = useState<RaidItem | null>(null);
  const today = todayISO();

  const names = new Map<string, string>([...graph.activities.map((a) => [a.id, a.name] as const), ...graph.milestones.map((m) => [m.id, m.name] as const)]);
  const ofType = graph.raid.filter((r) => r.type === type);
  const rows = ofType
    .filter((r) => (show === "all" ? true : show === "open" ? isOpen(r) : !isOpen(r)))
    .filter((r) => !q || `${r.title} ${r.owner} ${r.description}`.toLowerCase().includes(q.toLowerCase()))
    .filter((r) => !cell || (r.likelihood === cell.l && r.impact === cell.i))
    .sort((a, b) => (type === "R" ? riskScore(b) - riskScore(a) : 0) || (a.due < b.due ? -1 : 1));

  return (
    <div className="mx-auto max-w-7xl px-4 py-4 sm:px-8">
      <Tabs
        tabs={TYPES.map((t) => ({ id: t, label: `${RAID_LABELS[t]} (${graph.raid.filter((r) => r.type === t && isOpen(r)).length})` }))}
        value={type}
        onChange={(t) => {
          setType(t);
          setCell(null);
        }}
      />
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Select value={show} onChange={(e) => setShow(e.target.value as typeof show)} className="h-8 w-auto text-xs" aria-label="Show">
          <option value="open">Open</option>
          <option value="closed">Closed</option>
          <option value="all">All</option>
        </Select>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search title or owner" className="h-8 w-56 text-xs" />
        {cell && (
          <Button size="sm" variant="ghost" onClick={() => setCell(null)}>
            Likelihood {cell.l} × impact {cell.i} ✕
          </Button>
        )}
        <Button size="sm" variant="primary" className="ml-auto" onClick={() => setEditing(blankRaid(graph.project.id, type, settings.myName))}>
          + {RAID_SINGULAR[type]}
        </Button>
      </div>

      <div className={cx("mt-4 grid gap-4", type === "R" && "lg:grid-cols-[1fr_260px]")}>
        <div className="overflow-x-auto rounded-card border border-line bg-surface">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted">
              {ofType.length === 0 ? `No ${RAID_LABELS[type].toLowerCase()} yet. Every item needs an owner and a due date.` : "Nothing matches these filters."}
            </p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="px-3 py-2 font-medium">Title</th>
                  {type === "R" && <th className="px-3 py-2 font-medium">Score</th>}
                  {type === "I" && <th className="px-3 py-2 font-medium">Severity</th>}
                  {type === "D" && <th className="px-3 py-2 font-medium">Decided by</th>}
                  <th className="px-3 py-2 font-medium">Owner</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2 font-medium">Linked to</th>
                  <th className="px-3 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const overdue = isOpen(r) && r.due < today;
                  return (
                    <tr key={r.id} className="cursor-pointer border-b border-line/60 last:border-0 hover:bg-sunken" onClick={() => setEditing(r)}>
                      <td className="max-w-80 px-3 py-2">
                        <p className="truncate font-medium">{r.title}</p>
                        {(r.mitigation || r.description) && <p className="truncate text-xs text-muted">{type === "R" ? r.mitigation : r.description}</p>}
                      </td>
                      {type === "R" && (
                        <td className="px-3 py-2">
                          <Pill tone={riskScore(r) >= settings.ragThresholds.riskScore ? "red" : riskScore(r) >= 8 ? "amber" : "neutral"}>{riskScore(r)}</Pill>
                        </td>
                      )}
                      {type === "I" && (
                        <td className="px-3 py-2">
                          <Pill tone={r.severity === "Critical" ? "red" : r.severity === "High" ? "amber" : "neutral"}>{r.severity}</Pill>
                        </td>
                      )}
                      {type === "D" && <td className="px-3 py-2 text-muted">{r.decidedBy || "—"}</td>}
                      <td className="px-3 py-2">{r.owner}</td>
                      <td className={cx("px-3 py-2 whitespace-nowrap tabular-nums", overdue && "font-medium text-red")}>
                        {formatDate(r.due)}
                        {overdue && " · overdue"}
                      </td>
                      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                        <Select value={r.status} onChange={(e) => updateRaid(r.id, { status: e.target.value })} className="h-7 w-auto text-xs" aria-label="Status">
                          {RAID_STATUSES[r.type].map((s) => (
                            <option key={s}>{s}</option>
                          ))}
                        </Select>
                      </td>
                      <td className="max-w-40 truncate px-3 py-2 text-muted">{r.linkedId ? names.get(r.linkedId) ?? "—" : "—"}</td>
                      <td className="px-3 py-2 text-xs whitespace-nowrap text-muted">
                        {isOpen(r) && isStale(r.updatedAt) ? <StaleBadge /> : relativeTime(r.updatedAt)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {type === "R" && <HeatMap risks={ofType.filter(isOpen)} selected={cell} onSelect={setCell} threshold={settings.ragThresholds.riskScore} />}
      </div>

      <RaidModal item={editing} graph={graph} onClose={() => setEditing(null)} />
    </div>
  );
}

function HeatMap({ risks, selected, onSelect, threshold }: { risks: RaidItem[]; selected: { l: number; i: number } | null; onSelect: (c: { l: number; i: number } | null) => void; threshold: number }) {
  const count = (l: number, i: number) => risks.filter((r) => r.likelihood === l && r.impact === i).length;
  return (
    <div className="rounded-card border border-line bg-surface p-4">
      <p className="mb-2 text-sm font-semibold">Open risks heat map</p>
      <div className="flex gap-2">
        <div className="flex items-center text-[10px] text-muted [writing-mode:vertical-rl] rotate-180">Likelihood →</div>
        <div className="flex-1">
          <div className="grid grid-cols-5 gap-1">
            {[5, 4, 3, 2, 1].flatMap((l) =>
              [1, 2, 3, 4, 5].map((i) => {
                const score = l * i;
                const n = count(l, i);
                const tone = score >= threshold ? "bg-red-soft text-red" : score >= 8 ? "bg-amber-soft text-amber" : "bg-green-soft text-green";
                const isSel = selected?.l === l && selected?.i === i;
                return (
                  <button
                    key={`${l}-${i}`}
                    type="button"
                    className={cx("flex aspect-square items-center justify-center rounded text-xs font-semibold", tone, isSel && "ring-2 ring-accent", n === 0 && "opacity-50")}
                    title={`Likelihood ${l} × impact ${i} = ${score}: ${n} risk${n === 1 ? "" : "s"}`}
                    onClick={() => onSelect(isSel || n === 0 ? null : { l, i })}
                  >
                    {n || ""}
                  </button>
                );
              }),
            )}
          </div>
          <p className="mt-1 text-center text-[10px] text-muted">Impact →</p>
        </div>
      </div>
    </div>
  );
}
