import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import {
  deleteMilestone,
  deleteProject,
  isCodeTaken,
  sanitizeCode,
  saveMilestone,
  setBaseline,
  setRagOverride,
  clearRagOverride,
  updateProject,
} from "../db/actions";
import { newId } from "../db/db";
import { SIGNOFF_STATUSES, type Milestone, type Project, type ProjectStatus, type RagStatus } from "../db/types";
import { useSettings } from "../hooks/data";
import { cloneCalendar } from "../lib/calendar";
import { formatDate, isValidISO, todayISO } from "../lib/dates";
import type { RagResult } from "../lib/rag";
import { useApp } from "./AppContext";
import { CalendarEditor } from "./CalendarEditor";
import { Button, Field, Input, Modal, Select, Textarea, cx } from "./ui";

export function OverrideModal({ open, onClose, projectId, rag }: { open: boolean; onClose: () => void; projectId: string; rag: RagResult }) {
  const [status, setStatus] = useState<RagStatus>(rag.status);
  const [reason, setReason] = useState(rag.overrideReason ?? "");
  useEffect(() => {
    if (open) {
      setStatus(rag.status);
      setReason(rag.overrideReason ?? "");
    }
  }, [open, rag.status, rag.overrideReason]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Override RAG"
      footer={
        <>
          {rag.overridden && (
            <Button
              variant="ghost"
              className="mr-auto"
              onClick={async () => {
                await clearRagOverride(projectId);
                onClose();
              }}
            >
              Remove override
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={async () => {
              await setRagOverride(projectId, status, reason);
              onClose();
            }}
          >
            Save override
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        The rules say <strong className="text-ink">{rag.calculated}</strong>: {rag.reasons[0]}. An override shows as "overridden" everywhere, with your reason.
      </p>
      <div className="flex flex-col gap-4">
        <div className="flex gap-2" role="radiogroup" aria-label="Status">
          {(["Green", "Amber", "Red"] as RagStatus[]).map((s) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={status === s}
              onClick={() => setStatus(s)}
              className={cx("flex-1 rounded-md border py-2 text-sm font-semibold", status === s ? (s === "Green" ? "border-green bg-green-soft text-green" : s === "Amber" ? "border-amber bg-amber-soft text-amber" : "border-red bg-red-soft text-red") : "border-line text-muted")}
            >
              {s}
            </button>
          ))}
        </div>
        <Field label="Reason (required)">
          <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why the calculated status doesn't reflect reality" />
        </Field>
      </div>
    </Modal>
  );
}

export function BaselineModal({ open, onClose, projectId, hasBaseline }: { open: boolean; onClose: () => void; projectId: string; hasBaseline: boolean }) {
  const [reason, setReason] = useState("");
  const { notify } = useApp();
  useEffect(() => {
    if (open) setReason(hasBaseline ? "" : "Plan agreed");
  }, [open, hasBaseline]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={hasBaseline ? "Re-baseline" : "Set baseline"}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={hasBaseline && !reason.trim()}
            onClick={async () => {
              await setBaseline(projectId, reason);
              notify(hasBaseline ? "Re-baselined" : "Baseline set");
              onClose();
            }}
          >
            {hasBaseline ? "Replace baseline" : "Set baseline"}
          </Button>
        </>
      }
    >
      <p className="mb-4 text-sm text-muted">
        Freezes today's dates, weightages and planned % so variance (days and %) shows for every activity. {hasBaseline && "This replaces the current baseline, so a reason is required."}
      </p>
      <Field label={hasBaseline ? "Reason (required)" : "Note"}>
        <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
    </Modal>
  );
}

export function ProjectEditModal({ open, onClose, project }: { open: boolean; onClose: () => void; project: Project }) {
  const [p, setP] = useState(project);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { notify } = useApp();
  useEffect(() => {
    if (open) {
      setP({ ...project, calendar: cloneCalendar(project.calendar) });
      setError(null);
    }
  }, [open, project]);

  const save = async () => {
    if (!p.name.trim()) return setError("Give the project a name.");
    if (!sanitizeCode(p.code)) return setError("Give the project a code.");
    if (!isValidISO(p.start) || !isValidISO(p.end) || p.end < p.start) return setError("Check the start and end dates.");
    if (await isCodeTaken(p.code, p.id)) return setError("That code is used by another project.");
    await updateProject(p.id, { ...p, code: sanitizeCode(p.code), name: p.name.trim() });
    onClose();
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Edit project"
      footer={
        <>
          <Button
            variant="danger"
            className="mr-auto"
            onClick={async () => {
              if (!confirm(`Delete "${project.name}" and everything in it? The last GitHub backup still has it.`)) return;
              await deleteProject(project.id);
              notify("Project deleted");
              navigate("/");
            }}
          >
            Delete project
          </Button>
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
        <div className="grid gap-4 sm:grid-cols-[1fr_10rem_10rem]">
          <Field label="Name">
            <Input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} />
          </Field>
          <Field label="Code">
            <Input value={p.code} onChange={(e) => setP({ ...p, code: e.target.value.toUpperCase() })} />
          </Field>
          <Field label="Status">
            <Select value={p.status} onChange={(e) => setP({ ...p, status: e.target.value as ProjectStatus })}>
              <option>Active</option>
              <option>On hold</option>
              <option>Closed</option>
            </Select>
          </Field>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Sponsor">
            <Input value={p.sponsor} onChange={(e) => setP({ ...p, sponsor: e.target.value })} />
          </Field>
          <Field label="Start">
            <Input type="date" value={p.start} onChange={(e) => setP({ ...p, start: e.target.value })} />
          </Field>
          <Field label="End">
            <Input type="date" value={p.end} onChange={(e) => setP({ ...p, end: e.target.value })} />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} value={p.description} onChange={(e) => setP({ ...p, description: e.target.value })} />
        </Field>
        <CalendarEditor value={p.calendar} onChange={(calendar) => setP({ ...p, calendar })} />
      </div>
    </Modal>
  );
}

export function MilestoneModal({ open, onClose, projectId, milestone }: { open: boolean; onClose: () => void; projectId: string; milestone: Milestone | null }) {
  const settings = useSettings();
  const blank = (): Milestone => ({ id: "", projectId, name: "", date: todayISO(), owner: settings.myName, signoff: "Pending", deliverables: [], updatedAt: 0 });
  const [m, setM] = useState<Milestone>(milestone ?? blank());
  useEffect(() => {
    if (open) setM(milestone ?? blank());
  }, [open, milestone]);
  const valid = m.name.trim() && m.owner.trim() && isValidISO(m.date);

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={milestone ? "Milestone" : "New milestone"}
      footer={
        <>
          {milestone && (
            <Button
              variant="danger"
              className="mr-auto"
              onClick={async () => {
                if (!confirm(`Delete milestone "${milestone.name}"?`)) return;
                await deleteMilestone(milestone.id);
                onClose();
              }}
            >
              Delete
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!valid}
            onClick={async () => {
              await saveMilestone({ ...m, id: m.id || undefined, name: m.name.trim(), owner: m.owner.trim(), deliverables: m.deliverables.filter((d) => d.name.trim()) });
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
          <Input autoFocus value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} placeholder="Go-live" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Date">
            <Input type="date" value={m.date} onChange={(e) => setM({ ...m, date: e.target.value })} />
          </Field>
          <Field label="Owner">
            <Input value={m.owner} onChange={(e) => setM({ ...m, owner: e.target.value })} />
          </Field>
          <Field label="Sign-off">
            <Select value={m.signoff} onChange={(e) => setM({ ...m, signoff: e.target.value as Milestone["signoff"] })}>
              {SIGNOFF_STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </Select>
          </Field>
        </div>
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Deliverables</p>
          <div className="flex flex-col gap-1.5">
            {m.deliverables.map((d, i) => (
              <div key={d.id} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input className="h-8" value={d.name} placeholder="Deliverable" onChange={(e) => setM({ ...m, deliverables: m.deliverables.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                <Input className="h-8" value={d.link} placeholder="Link to document (optional)" onChange={(e) => setM({ ...m, deliverables: m.deliverables.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)) })} />
                <button type="button" className="px-1 text-xs text-muted hover:text-red" onClick={() => setM({ ...m, deliverables: m.deliverables.filter((_, j) => j !== i) })} aria-label="Remove deliverable">
                  ✕
                </button>
              </div>
            ))}
            <button type="button" className="self-start text-xs font-medium text-accent hover:underline" onClick={() => setM({ ...m, deliverables: [...m.deliverables, { id: newId(), name: "", link: "" }] })}>
              + Deliverable
            </button>
          </div>
        </div>
        {milestone && <p className="text-xs text-faint">Last updated {formatDate(new Date(milestone.updatedAt).toISOString().slice(0, 10))}</p>}
      </div>
    </Modal>
  );
}
