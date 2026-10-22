// PowerPoint export (PRD 13): one slide per report section, built in the
// browser. pptxgenjs is loaded only when exporting.

import type { ReportItemRow, StatusReport } from "../db/types";
import { formatDate, formatShort } from "./dates";

const RAG_HEX = { Green: "15803D", Amber: "B45309", Red: "B91C1C" } as const;
const INK = "18181B";
const MUTED = "71717A";
const ACCENT = "4F46E5";
const FONT = "Calibri";

export async function exportPptx(report: StatusReport): Promise<void> {
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE"; // 13.33 x 7.5 in
  const d = report.data;
  const n = report.narrative;
  const title = `${d.projectName} · Week of ${formatDate(report.week)}`;

  const base = (heading: string) => {
    const s = pptx.addSlide();
    s.background = { color: "FFFFFF" };
    s.addText(heading, { x: 0.6, y: 0.4, w: 10, h: 0.6, fontFace: FONT, fontSize: 26, bold: true, color: INK });
    s.addText(title, { x: 0.6, y: 6.9, w: 9, h: 0.3, fontFace: FONT, fontSize: 10, color: MUTED });
    s.addShape(pptx.ShapeType.rect, { x: 0.6, y: 1.05, w: 1.2, h: 0.06, fill: { color: ACCENT }, line: { color: ACCENT } });
    return s;
  };

  const ragPill = (s: ReturnType<typeof base>, x: number, y: number) => {
    s.addText(d.rag.toUpperCase() + (d.ragOverridden ? " · overridden" : ""), {
      x, y, w: 2.6, h: 0.5, fontFace: FONT, fontSize: 14, bold: true, color: "FFFFFF",
      fill: { color: RAG_HEX[d.rag] }, align: "center", valign: "middle", rectRadius: 0.1, shape: pptx.ShapeType.roundRect,
    });
  };

  const table = (s: ReturnType<typeof base>, rows: ReportItemRow[], y: number, h: number, empty: string) => {
    if (rows.length === 0) {
      s.addText(empty, { x: 0.6, y, w: 12, h: 0.4, fontFace: FONT, fontSize: 14, color: MUTED });
      return;
    }
    const head = ["Item", "Owner", "Date", "Detail"].map((t) => ({ text: t, options: { bold: true, color: MUTED, fontSize: 11 } }));
    s.addTable([head, ...rows.slice(0, 10).map((r) => [r.title, r.owner, r.date, r.detail].map((t) => ({ text: t, options: { fontSize: 12, color: INK } })))], {
      x: 0.6, y, w: 12.1, h, colW: [4.4, 1.8, 1.9, 4.0], fontFace: FONT, border: { type: "solid", pt: 0.5, color: "E4E4E7" }, valign: "middle",
    });
  };

  // 1. Summary
  {
    const s = base("Status summary");
    ragPill(s, 0.6, 1.4);
    s.addText(n.summary, { x: 0.6, y: 2.1, w: 12, h: 1.3, fontFace: FONT, fontSize: 16, color: INK, valign: "top" });
    const stats: [string, string][] = [
      ["Actual", `${d.actualPct.toFixed(1)}%`],
      ["Planned", `${d.plannedPct.toFixed(1)}%`],
      ["Variance", `${d.variance > 0 ? "+" : ""}${d.variance.toFixed(1)}%`],
    ];
    if (d.baselinePlannedPct !== null) stats.push(["Baseline planned", `${d.baselinePlannedPct.toFixed(1)}%`]);
    stats.forEach(([label, value], i) => {
      s.addText(value, { x: 0.6 + i * 3.1, y: 3.7, w: 2.9, h: 0.8, fontFace: FONT, fontSize: 32, bold: true, color: INK });
      s.addText(label, { x: 0.6 + i * 3.1, y: 4.45, w: 2.9, h: 0.4, fontFace: FONT, fontSize: 12, color: MUTED });
    });
    s.addText(d.ragReasons.map((r) => `• ${r}`).join("\n"), { x: 0.6, y: 5.1, w: 12, h: 1.5, fontFace: FONT, fontSize: 12, color: MUTED, valign: "top" });
  }

  // 2. Progress vs plan
  {
    const s = base("Progress vs plan");
    const pts = d.curve;
    const series = [{ name: "Planned", labels: pts.map((p) => formatShort(p.date)), values: pts.map((p) => p.planned) }];
    // Actual only up to today; later points are left blank.
    series.push({ name: "Actual", labels: series[0].labels, values: pts.map((p) => p.actual ?? (null as unknown as number)) });
    if (pts.some((p) => p.baseline !== null)) series.push({ name: "Baseline", labels: series[0].labels, values: pts.map((p) => p.baseline ?? 0) });
    s.addChart(pptx.ChartType.line, series, {
      x: 0.6, y: 1.3, w: 7.6, h: 5.3, chartColors: [MUTED, ACCENT, "A1A1AA"], lineSize: 2, lineDataSymbol: "none",
      showLegend: true, legendPos: "b", valAxisMaxVal: 100, valAxisMinVal: 0, catAxisLabelFontSize: 9, valAxisLabelFontSize: 9,
      catAxisLabelFrequency: String(Math.max(1, Math.round(pts.length / 8))),
    });
    const head = ["Phase", "Planned", "Actual"].map((t) => ({ text: t, options: { bold: true, color: MUTED, fontSize: 11 } }));
    s.addTable([head, ...d.phases.map((p) => [p.name, `${p.plannedPct.toFixed(1)}%`, `${p.actualPct.toFixed(1)}%`].map((t) => ({ text: t, options: { fontSize: 12, color: INK } })))], {
      x: 8.5, y: 1.4, w: 4.2, colW: [2.2, 1, 1], fontFace: FONT, border: { type: "solid", pt: 0.5, color: "E4E4E7" },
    });
  }

  // 3. This week / next week
  {
    const s = base("This week and next week");
    s.addText("Achievements this week", { x: 0.6, y: 1.4, w: 5.9, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: INK });
    s.addText(n.achievements || "—", { x: 0.6, y: 1.9, w: 5.9, h: 4.7, fontFace: FONT, fontSize: 13, color: INK, valign: "top" });
    s.addText("Next week", { x: 6.9, y: 1.4, w: 5.9, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: INK });
    s.addText(n.nextWeek || "—", { x: 6.9, y: 1.9, w: 5.9, h: 4.7, fontFace: FONT, fontSize: 13, color: INK, valign: "top" });
  }

  // 4. Milestones
  table(base("Milestones due"), d.milestones, 1.4, 0.4 * (d.milestones.length + 1), "No milestones due in the next 30 days.");

  // 5. Risks and issues
  {
    const s = base("Top risks and issues");
    s.addText("Risks", { x: 0.6, y: 1.3, w: 6, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: INK });
    table(s, d.risks, 1.75, 0.38 * (Math.min(d.risks.length, 5) + 1), "No open risks.");
    s.addText("Issues", { x: 0.6, y: 4.2, w: 6, h: 0.4, fontFace: FONT, fontSize: 16, bold: true, color: INK });
    table(s, d.issues, 4.65, 0.38 * (Math.min(d.issues.length, 5) + 1), "No open issues.");
  }

  // 6. Decisions
  {
    const s = base("Decisions needed");
    s.addText(n.decisionsNeeded || "None this week.", { x: 0.6, y: 1.4, w: 12, h: 5.2, fontFace: FONT, fontSize: 16, color: INK, valign: "top" });
  }

  await pptx.writeFile({ fileName: `${d.projectCode}-status-${report.week}.pptx` });
}
