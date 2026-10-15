// The built-in templates as the Home screen and New project dialog list them.
import type { AcademicFormat, ReportType } from './types';

export interface TemplateInfo {
  type: ReportType;
  title: string;
  /** short label for project lists */
  short: string;
  text: string;
  /** thumbnail sketch: bar heights (≤2 = text line, larger = a box) */
  bars: number[];
}

export const TEMPLATES: TemplateInfo[] = [
  { type: 'documentation', title: 'Model documentation', short: 'Model documentation', text: 'Purpose, data, methodology, performance, limitations, monitoring plan', bars: [1, 1, 8, 1, 1] },
  { type: 'monitoring', title: 'Ongoing monitoring report', short: 'Monitoring report', text: 'Metrics against thresholds, population changes, breaches and actions', bars: [10, 1, 1] },
  { type: 'academic', title: 'Academic paper', short: 'Academic paper', text: 'IEEE, ACM, Elsevier, Springer LNCS, APS, AMS, APA 7 or a plain article', bars: [6, 1, 1, 1, 1] },
  { type: 'blank', title: 'Blank document', short: 'LaTeX', text: 'A title and one section; bring your own structure', bars: [] },
];

export interface AcademicFormatInfo {
  id: AcademicFormat;
  title: string;
  /** document class (all on CTAN; MiKTeX installs them on first use) */
  cls: string;
  text: string;
}

export const ACADEMIC_FORMATS: AcademicFormatInfo[] = [
  { id: 'ieee-conf', title: 'IEEE conference paper', cls: 'IEEEtran', text: 'Two columns, IEEE author blocks, IEEEkeywords, IEEEtran references' },
  { id: 'ieee-journal', title: 'IEEE journal article (Transactions)', cls: 'IEEEtran', text: 'Two columns, membership and footnote author notes, running heads' },
  { id: 'acm', title: 'ACM conference paper (sigconf)', cls: 'acmart', text: 'ACM rights block, CCS concepts, keywords, ACM-Reference-Format' },
  { id: 'elsevier', title: 'Elsevier journal (preprint)', cls: 'elsarticle', text: 'Front matter with affiliations and keywords, numbered references' },
  { id: 'springer-lncs', title: 'Springer LNCS proceedings', cls: 'llncs', text: 'Institutes, ORCID, keywords in the abstract, splncs04 references' },
  { id: 'aps', title: 'APS Physical Review (REVTeX)', cls: 'revtex4-2', text: 'Two-column reprint layout, superscript affiliations, apsrev references' },
  { id: 'ams', title: 'AMS journal article', cls: 'amsart', text: 'Address, MSC subject classes, theorem environments, amsplain references' },
  { id: 'apa7', title: 'APA 7 manuscript', cls: 'apa7', text: 'Title page, running head, abstract and keywords, apacite author–year references' },
  { id: 'article', title: 'Plain article (no journal)', cls: 'article', text: 'Working paper or preprint; page layout set in Document setup' },
];

export function templateInfo(t: ReportType | string): TemplateInfo {
  return TEMPLATES.find((x) => x.type === t) ?? TEMPLATES[TEMPLATES.length - 1];
}

export function academicFormatInfo(f: AcademicFormat | string | undefined): AcademicFormatInfo {
  return ACADEMIC_FORMATS.find((x) => x.id === f) ?? ACADEMIC_FORMATS[ACADEMIC_FORMATS.length - 1];
}
