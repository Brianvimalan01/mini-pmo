import { useEffect, useState } from "react";
import { deleteRaid, raidProblems, saveRaid } from "../db/actions";
import { RAID_SINGULAR, RAID_STATUSES, SEVERITIES, type ProjectGraph, type RaidItem, type Severity } from "../db/types";
import { formatDateTime } from "../lib/dates";
import { useApp } from "./AppContext";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";

export function RaidModal({ item, graph, onClose }: { item: RaidItem | null; graph: ProjectGraph; onClose: () => void }) {
  const [r, setR] = useState<RaidItem | null>(item);
  const [error, setError] = useState<string | null>(null);
  const { notify } = useApp();
  useEffect(() => {
    setR(item);
    setError(null);
  }, [item]);
  if (!r || !item) return null;
  const isNew = !graph.raid.some((x) => x.id === r.id);
  const set = (patch: Partial<RaidItem>) => setR({ ...r, ...patch });
  const linkables = [
    ...graph.activities
      .slice()
      .sort((a, b) => (a.level === b.level ? a.name.localeCompare(b.name) : a.level === "main" ? -1 : 1))
      .map((a) => ({ id: a.id, label: `${a.level === "main" ? "Main" : "Sub"}: ${a.name}` })),
    ...graph.milestones.map((m) => ({ id: m.id, label: `Milestone: ${m.name}` })),
  ];

  const save = async () => {
    const problems = raidProblems(r);
    if (problems.length) {
      setError(`Add ${problems.join(" and ")} before saving. Every item needs an owner and a due date.`);
      return;
    }
    await saveRaid(r);
    notify(`${RAID_SINGULAR[r.type]} saved`);
    onClose();
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`${isNew ? "New" : "Edit"} ${RAID_SINGULAR[r.type].toLowerCase()}`}
      footer={
        <>
          {!isNew && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                if (!confirm(`Delete "${r.title}"?`)) return;
                await deleteRaid(r.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Save
          </Button>
        </>
      }
    >
      {error && <p className="mb-3 rounded-md bg-red-soft px-3 py-2 text-sm text-red">{error}</p>}
      <div className="flex flex-col gap-4">
        <Field label="Title">
          <Input autoFocus value={r.title} onChange={(e) => set({ title: e.target.value })} />
        </Field>
        <Field label="Description">
          <Textarea rows={2} value={r.description} onChange={(e) => set({ description: e.target.value })} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Owner (required)" error={!r.owner.trim() && error ? "Required" : null}>
            <Input value={r.owner} onChange={(e) => set({ owner: e.target.value })} />
          </Field>
          <Field label="Due date (required)" error={!r.due && error ? "Required" : null}>
            <Input type="date" value={r.due} onChange={(e) => set({ due: e.target.value })} />
          </Field>
          <Field label="Status">
            <Select value={r.status} onChange={(e) => set({ status: e.target.value })}>
              {RAID_STATUSES[r.type].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>

        {r.type === "R" && (
          <>
            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Likelihood (1–5)">
                <Select value={r.likelihood} onChange={(e) => set({ likelihood: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Impact (1–5)">
                <Select value={r.impact} onChange={(e) => set({ impact: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Score">
                <p className="flex h-9 items-center text-lg font-semibold tabular-nums">{r.likelihood * r.impact}</p>
              </Field>
            </div>
            <Field label="Mitigation">
              <Textarea rows={2} value={r.mitigation} onChange={(e) => set({ mitigation: e.target.value })} />
            </Field>
          </>
        )}

        {r.type === "I" && (
          <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
            <Field label="Severity" hint={r.severity === "Critical" ? "An open critical issue turns the project Red." : undefined}>
              <Select value={r.severity} onChange={(e) => set({ severity: e.target.value as Severity })}>
                {SEVERITIES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </Field>
            <Field label="Resolution">
              <Textarea rows={2} value={r.resolution} onChange={(e) => set({ resolution: e.target.value })} />
            </Field>
          </div>
        )}

        {r.type === "D" && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Decided by">
                <Input value={r.decidedBy} onChange={(e) => set({ decidedBy: e.target.value })} />
              </Field>
              <Field label="Decision date">
                <Input type="date" value={r.decisionDate} onChange={(e) => set({ decisionDate: e.target.value })} />
              </Field>
            </div>
            <Field label="Rationale">
              <Textarea rows={2} value={r.rationale} onChange={(e) => set({ rationale: e.target.value })} />
            </Field>
          </>
        )}

        <Field label="Linked activity or milestone">
          <Select value={r.linkedId ?? ""} onChange={(e) => set({ linkedId: e.target.value || null })}>
            <option value="">None</option>
            {linkables.map((l) => (
              <option key={l.id} value={l.id}>
                {l.label}
              </option>
            ))}
          </Select>
        </Field>
        {!isNew && <p className="text-xs text-faint">Last updated {formatDateTime(item.updatedAt)}</p>}
      </div>
    </Modal>
  );
}
