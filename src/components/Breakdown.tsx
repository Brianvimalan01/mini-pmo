import { fmtPct, type ProgressNode } from "../lib/progress";
import { HoverCard, PinIcon, cx } from "./ui";

/** "Show the math": hover a % to see how it rolls up from its sub-activities. */
export function PctWithMath({ node, field, className }: { node: ProgressNode; field: "plannedPct" | "actualPct"; className?: string }) {
  if (node.children.length === 0) {
    return <span className={className}>{fmtPct(node[field])}</span>;
  }
  return (
    <HoverCard className={className} content={<Breakdown node={node} field={field} />}>
      {fmtPct(node[field])}
    </HoverCard>
  );
}

function Breakdown({ node, field }: { node: ProgressNode; field: "plannedPct" | "actualPct" }) {
  const label = field === "plannedPct" ? "Planned" : "Actual";
  return (
    <span className="block">
      <span className="mb-2 block font-semibold">
        {label} {fmtPct(node[field])} = Σ (weight × {label.toLowerCase()} %)
      </span>
      <span className="block max-h-72 overflow-y-auto">
        <Rows nodes={node.children} field={field} depth={0} />
      </span>
      <span className="mt-2 block text-faint">Weights default to working-day duration. <PinIcon className="inline" /> = edited.</span>
    </span>
  );
}

function Rows({ nodes, field, depth }: { nodes: ProgressNode[]; field: "plannedPct" | "actualPct"; depth: number }) {
  return (
    <>
      {nodes.map((n) => (
        <span key={n.id} className="block">
          <span className={cx("flex items-baseline gap-2 py-0.5", depth === 0 ? "font-medium" : "text-muted")} style={{ paddingLeft: depth * 12 }}>
            <span className="min-w-0 flex-1 truncate">{n.name}</span>
            <span className="tabular-nums">
              {n.pinned && <PinIcon className="mr-0.5 inline text-accent" />}
              {n.weight.toFixed(1)}% × {fmtPct(n[field])}
            </span>
            <span className="w-12 text-right tabular-nums">{((n.weight / 100) * n[field]).toFixed(1)}</span>
          </span>
          {depth < 2 && n.children.length > 0 && <Rows nodes={n.children} field={field} depth={depth + 1} />}
        </span>
      ))}
    </>
  );
}
