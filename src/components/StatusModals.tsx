import { useEffect, useState } from "react";
import { raiseIssueFromBlocked, setSubStatus } from "../db/actions";
import type { Activity } from "../db/types";
import { useApp } from "./AppContext";
import { Button, Field, Modal, Textarea } from "./ui";

/** Moving a card to In Progress asks for its %. */
export function PercentModal({ activity, onClose }: { activity: Activity | null; onClose: () => void }) {
  const [pct, setPct] = useState(10);
  useEffect(() => {
    if (activity) setPct(activity.actualPct > 0 && activity.actualPct < 100 ? activity.actualPct : 10);
  }, [activity]);
  if (!activity) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="How far along is it?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={async () => {
              await setSubStatus(activity.id, "In Progress", { pct });
              onClose();
            }}
          >
            Save {pct}%
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{activity.name}</p>
      <div className="flex items-center gap-3">
        <input type="range" min={0} max={99} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} className="flex-1" aria-label="Percent complete" autoFocus />
        <span className="w-12 text-right text-lg font-semibold tabular-nums">{pct}%</span>
      </div>
    </Modal>
  );
}

/** Moving a card to Blocked needs a reason, and can raise an Issue. */
export function BlockModal({ activity, onClose }: { activity: Activity | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [raise, setRaise] = useState(true);
  const { notify } = useApp();
  useEffect(() => {
    if (activity) {
      setReason(activity.blockedReason);
      setRaise(true);
    }
  }, [activity]);
  if (!activity) return null;
  return (
    <Modal
      open
      onClose={onClose}
      title="What's blocking it?"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!reason.trim()}
            onClick={async () => {
              await setSubStatus(activity.id, "Blocked", { reason });
              if (raise) {
                await raiseIssueFromBlocked(activity.id, reason.trim());
                notify("Marked blocked and raised an Issue");
              }
              onClose();
            }}
          >
            Mark blocked
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">{activity.name}</p>
      <Field label="Reason (required)">
        <Textarea autoFocus rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Waiting for…" />
      </Field>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={raise} onChange={(e) => setRaise(e.target.checked)} />
        Also raise an Issue in the RAID log
      </label>
    </Modal>
  );
}
