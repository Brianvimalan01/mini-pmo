import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatDate, formatShort } from "../lib/dates";
import type { CurvePoint } from "../lib/metrics";

/** Weighted planned vs actual (and baseline) over time, labelled directly. */
export function SCurveChart({ points, today, height = 260, compact }: { points: CurvePoint[]; today: string; height?: number; compact?: boolean }) {
  if (points.length === 0) return <p className="text-sm text-muted">Nothing scheduled yet.</p>;
  const hasBaseline = points.some((p) => p.baseline !== null);
  const last = points[points.length - 1];
  const lastActual = [...points].reverse().find((p) => p.actual !== null);
  return (
    <div className="w-full text-xs">
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={points} margin={{ top: 8, right: compact ? 12 : 72, bottom: 0, left: -18 }}>
          <CartesianGrid stroke="var(--line)" vertical={false} />
          <XAxis dataKey="date" tickFormatter={formatShort} stroke="var(--faint)" tick={{ fill: "var(--muted)", fontSize: 11 }} minTickGap={32} tickLine={false} />
          <YAxis domain={[0, 100]} ticks={[0, 25, 50, 75, 100]} tickFormatter={(v) => `${v}%`} stroke="var(--faint)" tick={{ fill: "var(--muted)", fontSize: 11 }} tickLine={false} axisLine={false} />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--line)", borderRadius: 8, fontSize: 12 }}
            labelFormatter={(d) => formatDate(String(d))}
            formatter={(v, name) => [v === null || v === undefined ? "—" : `${Number(v).toFixed(1)}%`, name]}
          />
          <ReferenceLine x={today} stroke="var(--red)" strokeDasharray="3 3" label={compact ? undefined : { value: "Today", position: "insideTopLeft", fill: "var(--red)", fontSize: 11 }} />
          {hasBaseline && <Line dataKey="baseline" name="Baseline" stroke="var(--faint)" strokeDasharray="5 4" dot={false} strokeWidth={1.5} isAnimationActive={false} />}
          <Line dataKey="planned" name="Planned" stroke="var(--muted)" dot={false} strokeWidth={2} isAnimationActive={false} />
          <Line
            dataKey="actual"
            name="Actual"
            stroke="var(--accent)"
            dot={false}
            strokeWidth={2.5}
            connectNulls={false}
            isAnimationActive={false}
            label={compact || !lastActual ? undefined : endLabelAt(points.indexOf(lastActual), "Actual", "var(--accent)")}
          />
        </LineChart>
      </ResponsiveContainer>
      <p className="mt-1 flex gap-3 text-muted">
        <Key color="var(--accent)" label="Actual" />
        <Key color="var(--muted)" label="Planned" />
        {hasBaseline && <Key color="var(--faint)" label="Baseline" dashed />}
        <span className="ml-auto">{last && `plan ends ${formatShort(last.date)}`}</span>
      </p>
    </div>
  );
}

function Key({ color, label, dashed }: { color: string; label: string; dashed?: boolean }) {
  return (
    <span className="flex items-center gap-1">
      <svg width="14" height="4" aria-hidden>
        <line x1="0" y1="2" x2="14" y2="2" stroke={color} strokeWidth="2" strokeDasharray={dashed ? "3 2" : undefined} />
      </svg>
      {label}
    </span>
  );
}

// Direct label on the latest actual point.
function endLabelAt(index: number, text: string, color: string) {
  return (props: any) => {
    if (props.index !== index || props.value === null || props.value === undefined) return <g />;
    return (
      <text x={props.x + 6} y={props.y} dy={4} fill={color} fontSize={11} fontWeight={600}>
        {text} {Number(props.value).toFixed(1)}%
      </text>
    );
  };
}
