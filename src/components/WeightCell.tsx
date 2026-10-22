import { useState } from "react";
import { setWeight } from "../db/actions";
import { maxPinnable, type ProgressNode } from "../lib/progress";
import { PinIcon, cx } from "./ui";

/**
 * Click to edit a weight. A typed weight is pinned and the unpinned weights
 * in the same group rebalance; clearing the field unpins it.
 */
export function WeightCell({ node, siblings, className }: { node: ProgressNode; siblings: ProgressNode[]; className?: string }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const kind = node.kind === "phase" ? "phase" : "activity";
  const max = maxPinnable(
    siblings.map((s) => ({ duration: s.duration, pinned: s.pinned ? s.weight : null })),
    siblings.findIndex((s) => s.id === node.id),
  );

  const commit = async () => {
    setEditing(false);
    const t = text.trim();
    if (t === "") {
      if (node.pinned) await setWeight(kind, node.id, null);
      return;
    }
    const v = Number(t.replace("%", ""));
    if (!Number.isFinite(v)) return;
    await setWeight(kind, node.id, Math.min(max, Math.max(0, v)));
  };

  if (editing) {
    return (
      <input
        autoFocus
        className={cx("h-6 w-14 rounded border border-accent bg-surface px-1 text-right text-xs tabular-nums focus:outline-none", className)}
        value={text}
        placeholder="auto"
        title={`0–${max.toFixed(1)}%. Leave empty to follow duration.`}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEditing(false);
        }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      className={cx("inline-flex h-6 items-center justify-end gap-0.5 rounded px-1 text-xs tabular-nums hover:bg-sunken", node.pinned ? "text-accent" : "text-muted", className)}
      title={node.pinned ? "Edited weight (pinned). Click to change; clear to follow duration." : "Weight by duration. Click to edit."}
      onClick={(e) => {
        e.stopPropagation();
        setText(node.pinned ? node.weight.toFixed(1) : "");
        setEditing(true);
      }}
    >
      {node.pinned && <PinIcon />}
      {node.weight.toFixed(1)}%
    </button>
  );
}
