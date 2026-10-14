// The built-in templates as the Home screen and New project dialog list them.
import type { ReportType } from './types';

export type TemplateGroup = 'Model risk' | 'Academic' | 'General';

export interface TemplateInfo {
  type: ReportType;
  title: string;
  /** short label for project lists */
  short: string;
  group: TemplateGroup;
  text: string;
  /** thumbnail sketch: bar heights (≤2 = text line, larger = a box) */
  bars: number[];
  /** offer the sample Python validation suite by default */
  suite: boolean;
}

export const TEMPLATES: TemplateInfo[] = [
  { type: 'validation', title: 'Validation report', short: 'Validation', group: 'Model risk', text: 'Scope, testing, findings, sign-off · 7 sections', bars: [1, 1, 8, 1], suite: true },
  { type: 'documentation', title: 'Model documentation', short: 'Model documentation', group: 'Model risk', text: 'Purpose, data, methodology, limitations · 8 sections', bars: [1, 1, 1, 1, 1], suite: true },
  { type: 'monitoring', title: 'Ongoing monitoring', short: 'Monitoring', group: 'Model risk', text: 'KPI results against thresholds · 3 sections', bars: [10, 1, 1], suite: true },
  { type: 'performance', title: 'Performance review', short: 'Performance review', group: 'Model risk', text: 'Discrimination, calibration, backtesting · 6 sections', bars: [1, 14, 1], suite: true },
  { type: 'article', title: 'Journal article', short: 'Journal article', group: 'Academic', text: 'Abstract, IMRaD sections, author–year citations', bars: [6, 1, 1, 1, 1], suite: false },
  { type: 'conference', title: 'Conference paper', short: 'Conference paper', group: 'Academic', text: 'Two columns, 10 pt, numbered references (IEEE/ACM-like)', bars: [1, 1, 5, 1, 1], suite: false },
  { type: 'working', title: 'Working paper', short: 'Working paper', group: 'Academic', text: 'Economics/finance: abstract, JEL codes, robustness, appendix', bars: [6, 1, 1, 9, 1], suite: false },
  { type: 'thesis', title: 'Thesis or dissertation', short: 'Thesis', group: 'Academic', text: 'Title page, front matter, chapters, appendices · 12 pt, one-and-a-half spacing', bars: [12, 1, 1, 1], suite: false },
  { type: 'apa', title: 'APA 7 paper', short: 'APA paper', group: 'Academic', text: 'Double-spaced, 12 pt, Method / Results / Discussion', bars: [1, 1, 1, 1, 1, 1], suite: false },
  { type: 'proposal', title: 'Research proposal', short: 'Proposal', group: 'Academic', text: 'Aims, significance, approach, timeline, budget', bars: [1, 7, 1, 1], suite: false },
  { type: 'techreport', title: 'Technical report', short: 'Technical report', group: 'General', text: 'Executive summary, contents, recommendations, appendix', bars: [1, 1, 1, 6], suite: false },
  { type: 'blank', title: 'Blank LaTeX project', short: 'LaTeX', group: 'General', text: 'Bring your own class and preamble', bars: [], suite: false },
];

export const TEMPLATE_GROUPS: TemplateGroup[] = ['Model risk', 'Academic', 'General'];

export function templateInfo(t: ReportType): TemplateInfo {
  return TEMPLATES.find((x) => x.type === t) ?? TEMPLATES[TEMPLATES.length - 1];
}
