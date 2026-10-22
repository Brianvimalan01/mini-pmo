import { calendarIndex, type WorkCalendar } from "./calendar";
import type { ISODate } from "./dates";

interface TemplatePhase {
  name: string;
  /** Relative share of the project's working days. */
  share: number;
  mains: string[];
  milestone?: string;
}

export interface Template {
  id: string;
  label: string;
  description: string;
  phases: TemplatePhase[];
}

export const TEMPLATES: Template[] = [
  { id: "blank", label: "Blank", description: "No phases. Add your own on the next step.", phases: [] },
  {
    id: "waterfall",
    label: "Standard Waterfall",
    description: "Initiation → Planning → Execution → Closure",
    phases: [
      { name: "Initiation", share: 10, mains: ["Business case", "Project charter", "Stakeholder mapping"], milestone: "Charter approved" },
      { name: "Planning", share: 20, mains: ["Requirements", "Schedule and budget", "Risk plan"], milestone: "Plan signed off" },
      { name: "Execution", share: 55, mains: ["Build", "Quality checks", "Status reporting"], milestone: "Delivery complete" },
      { name: "Closure", share: 15, mains: ["Handover", "Lessons learned"], milestone: "Project closed" },
    ],
  },
  {
    id: "implementation",
    label: "Implementation",
    description: "Discover → Design → Build → Test → Deploy → Hypercare",
    phases: [
      { name: "Discover", share: 10, mains: ["Current state review", "Requirements workshops"], milestone: "Requirements signed off" },
      { name: "Design", share: 15, mains: ["Solution design", "Data migration design"], milestone: "Design approved" },
      { name: "Build", share: 30, mains: ["Configuration", "Integrations", "Data migration build"] },
      { name: "Test", share: 20, mains: ["System testing", "User acceptance testing"], milestone: "UAT sign-off" },
      { name: "Deploy", share: 10, mains: ["Training", "Cutover"], milestone: "Go-live" },
      { name: "Hypercare", share: 15, mains: ["Hypercare support", "Handover to BAU"], milestone: "Project closed" },
    ],
  },
];

export interface DraftMain {
  name: string;
  start: ISODate;
  end: ISODate;
}
export interface DraftPhase {
  name: string;
  mains: DraftMain[];
}
export interface DraftMilestone {
  name: string;
  date: ISODate;
}

/** Split [start, end] into consecutive working-day blocks by share. */
function split(start: ISODate, end: ISODate, shares: number[], cal: WorkCalendar): { start: ISODate; end: ISODate }[] {
  const idx = calendarIndex(cal);
  const first = idx.onOrAfter(start);
  const total = Math.max(shares.length, idx.workingDaysBetween(first, end));
  const sum = shares.reduce((s, x) => s + x, 0) || 1;
  const out: { start: ISODate; end: ISODate }[] = [];
  let used = 0;
  let cursor = first;
  shares.forEach((share, i) => {
    const isLast = i === shares.length - 1;
    const days = isLast ? Math.max(1, total - used) : Math.max(1, Math.round((share / sum) * total));
    const blockEnd = idx.addWorkingDays(cursor, days - 1);
    out.push({ start: cursor, end: blockEnd });
    used += days;
    cursor = idx.addWorkingDays(blockEnd, 1);
  });
  return out;
}

export function applyTemplate(
  template: Template,
  start: ISODate,
  end: ISODate,
  cal: WorkCalendar,
): { phases: DraftPhase[]; milestones: DraftMilestone[] } {
  if (template.phases.length === 0) return { phases: [], milestones: [] };
  const phaseSpans = split(start, end, template.phases.map((p) => p.share), cal);
  const milestones: DraftMilestone[] = [];
  const phases = template.phases.map((p, i) => {
    const span = phaseSpans[i];
    const mainSpans = split(span.start, span.end, p.mains.map(() => 1), cal);
    if (p.milestone) milestones.push({ name: p.milestone, date: span.end });
    return { name: p.name, mains: p.mains.map((name, j) => ({ name, ...mainSpans[j] })) };
  });
  return { phases, milestones };
}
