import { useEffect, useState } from "react";
import { addMainActivity, addSubActivity } from "../db/actions";
import type { KanbanStatus, ProjectGraph } from "../db/types";
import { useSettings } from "../hooks/data";
import { calendarIndex } from "../lib/calendar";
import { isValidISO, maxDate, todayISO } from "../lib/dates";
import { useApp } from "./AppContext";
import { Button, Field, Input, Modal, Select } from "./ui";

export type AddTarget =
  | { kind: "main"; phaseId: string }
  | { kind: "sub"; mainId: string | null; status?: KanbanStatus };

/** Add a main activity to a phase, or a sub-activity to a main activity. */
export function AddActivityModal({ graph, target, onClose }: { graph: ProjectGraph; target: AddTarget | null; onClose: () => void }) {
  const settings = useSettings();
  const { notify } = useApp();
  const cal = calendarIndex(graph.project.calendar);
  const mains = graph.activities.filter((a) => a.level === "main");
  const phaseName = new Map(graph.phases.map((p) => [p.id, p.name]));
  const [name, setName] = useState("");
  const [mainId, setMainId] = useState("");
  const [owner, setOwner] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!target) return;
    setName("");
    setError(null);
    setOwner(settings.myName);
    const s = cal.onOrAfter(maxDate(todayISO(), graph.project.start));
    setStart(s);
    setEnd(cal.addWorkingDays(s, 4));
    if (target.kind === "sub") setMainId(target.mainId ?? "");
  }, [target]);

  if (!target) return null;

  const save = async () => {
    if (!name.trim()) return setError("Give it a name.");
    if (!isValidISO(start) || !isValidISO(end) || end < start) return setError("Check the dates: the end can't be before the start.");
    if (target.kind === "main") {
      await addMainActivity(graph.project.id, target.phaseId, name.trim(), start, end);
    } else {
      if (!mainId) return setError("Every sub-activity must be tagged to a main activity.");
      await addSubActivity(mainId, { name: name.trim(), start, end, owner, kanbanStatus: target.status });
    }
    notify(`Added ${name.trim()}`);
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={target.kind === "main" ? `New main activity in ${phaseName.get(target.phaseId) ?? "phase"}` : "New sub-activity"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={save}>
            Add
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {error && <p className="rounded-md bg-red-soft px-3 py-2 text-sm text-red">{error}</p>}
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        {target.kind === "sub" && (
          <Field label="Main activity (required)">
            <Select value={mainId} onChange={(e) => setMainId(e.target.value)}>
              <option value="">Choose…</option>
              {graph.phases
                .slice()
                .sort((a, b) => a.order - b.order)
                .map((p) => (
                  <optgroup key={p.id} label={p.name}>
                    {mains
                      .filter((m) => m.phaseId === p.id)
                      .sort((a, b) => a.order - b.order)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.name}
                        </option>
                      ))}
                  </optgroup>
                ))}
            </Select>
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Start">
            <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End">
            <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
          {target.kind === "sub" && (
            <Field label="Owner">
              <Input value={owner} onChange={(e) => setOwner(e.target.value)} />
            </Field>
          )}
        </div>
        {isValidISO(start) && isValidISO(end) && end >= start && (
          <p className="text-xs text-muted">{cal.workingDaysBetween(start, end)} working days</p>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
