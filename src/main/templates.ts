// Report templates. Each produces report.tex; all share the Quire preamble.
import type { GeneratedBlockConfig, ProjectManifest, ReportType, ThemeSettings, Engine } from '../shared/types';
import { DEFAULT_THEME, themeBlock } from '../shared/latex/theme';

export function preambleTex(theme: ThemeSettings): string {
  return String.raw`% Quire report preamble.
% The block between the quire:theme markers is managed by Document setup.
% Everything else in this file is yours and is never rewritten.
\usepackage[T1]{fontenc}
\usepackage{amsmath,amssymb}
\usepackage{graphicx}
\usepackage[table]{xcolor}
\usepackage{booktabs}
\usepackage{array}
\usepackage{listings}
\usepackage{tcolorbox}
\usepackage[numbers,sort&compress]{natbib}
\usepackage{fancyhdr}
\usepackage{hyperref}

${themeBlock(theme)}

\AtBeginDocument{\color{quiretext}}
\numberwithin{equation}{section}
\numberwithin{table}{section}
\numberwithin{figure}{section}
\def\sectionautorefname{Section}
\def\subsectionautorefname{Section}
\def\subsubsectionautorefname{Section}

\lstset{basicstyle=\ttfamily\footnotesize, columns=fullflexible, keepspaces=true,
  breaklines=true, frame=lines, framerule=0.4pt, rulecolor=\color{black!25},
  numbers=left, numberstyle=\tiny\color{black!50}, xleftmargin=1.8em,
  keywordstyle=\bfseries, commentstyle=\itshape\color{black!60},
  stringstyle=\color{quirelink}, showstringspaces=false}

% Callouts: \begin{quirecallout}{Finding F-01 · Severity: Medium} ... \end{quirecallout}
\newtcolorbox{quirecallout}[1]{colback=quirecalloutfill, colframe=black!22,
  boxrule=0.4pt, arc=1.5pt, left=8pt, right=8pt, top=5pt, bottom=6pt,
  fonttitle=\sffamily\scriptsize\bfseries, coltitle=black!70,
  colbacktitle=quirecalloutfill, titlerule=0pt, title={\MakeUppercase{#1}}}

\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\sffamily\scriptsize\MakeUppercase{\quireheadleft}}
\fancyhead[R]{\sffamily\scriptsize\MakeUppercase{\quireheadright}}
\fancyfoot[C]{\sffamily\small\thepage}
\renewcommand{\headrulewidth}{0.3pt}
`;
}

const SECTIONS: Record<ReportType, { title: string; label?: string; text: string; subs?: string[] }[]> = {
  validation: [
    { title: 'Executive summary', label: 'sec:summary', text: '[State the validation opinion, the overall rating and the findings that drive it.]' },
    { title: 'Scope and model overview', label: 'sec:scope', text: '[Describe the model, its intended use, the version validated and what was in scope.]' },
    { title: 'Data', label: 'sec:data', text: '[Summarise data sources, the observation window, exclusions and data-quality results.]' },
    { title: 'Methodology review', label: 'sec:method', text: '[Assess the conceptual soundness of the approach and key assumptions.]' },
    { title: 'Performance testing', label: 'sec:performance', text: '[Introduce the test suite and acceptance thresholds.]', subs: ['Discrimination', 'Calibration', 'Stability'] },
    { title: 'Findings and limitations', label: 'sec:findings', text: '[List findings with severity, owner and remediation date.]' },
    { title: 'Conclusion and sign-off', label: 'sec:signoff', text: '[Validator opinion and approvals.]' },
  ],
  documentation: [
    { title: 'Purpose and intended use', label: 'sec:purpose', text: '[Business purpose, users, products and portfolios in scope.]' },
    { title: 'Model overview', label: 'sec:overview', text: '[High-level description of inputs, outputs and the modelling approach.]' },
    { title: 'Data', label: 'sec:data', text: '[Sources, lineage, sample construction and treatments.]' },
    { title: 'Methodology', label: 'sec:method', text: '[Specification, estimation and variable selection.]' },
    { title: 'Implementation', label: 'sec:impl', text: '[Production code, controls and reconciliation to the development code.]' },
    { title: 'Performance', label: 'sec:performance', text: '[Development-sample and out-of-time performance.]' },
    { title: 'Limitations and assumptions', label: 'sec:limits', text: '[Known weaknesses, compensating controls and overlays.]' },
    { title: 'Ongoing monitoring plan', label: 'sec:monitoring', text: '[Metrics, thresholds, frequency and escalation.]' },
  ],
  monitoring: [
    { title: 'Summary', label: 'sec:summary', text: '[Overall monitoring status for the period and breaches requiring action.]' },
    { title: 'Key performance indicators', label: 'sec:kpi', text: '[KPI results against thresholds.]' },
    { title: 'Breaches and actions', label: 'sec:actions', text: '[Breaches, root causes, owners and due dates.]' },
  ],
  performance: [
    { title: 'Summary', label: 'sec:summary', text: '[Headline results and conclusions.]' },
    { title: 'Discrimination', label: 'sec:discrimination', text: '[AUC, Gini and KS results by segment.]' },
    { title: 'Calibration', label: 'sec:calibration', text: '[Grade-level and portfolio calibration tests.]' },
    { title: 'Stability', label: 'sec:stability', text: '[Population and characteristic stability.]' },
    { title: 'Backtesting', label: 'sec:backtesting', text: '[Realised versus predicted defaults over time.]' },
    { title: 'Conclusions', label: 'sec:conclusions', text: '[Recommendations.]' },
  ],
  blank: [{ title: 'Introduction', label: 'sec:intro', text: 'Start writing here.' }],
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = {
  validation: 'Validation report',
  documentation: 'Model documentation',
  monitoring: 'Ongoing monitoring',
  performance: 'Performance review',
  blank: 'Blank LaTeX project',
};

function texEsc(s: string) { return s.replace(/([%&#_$])/g, '\\$1'); }

export function reportTex(type: ReportType, name: string, owner = '', modelId = ''): string {
  const secs = SECTIONS[type];
  const body: string[] = [];
  for (const s of secs) {
    body.push(`\\section{${s.title}}${s.label ? `\\label{${s.label}}` : ''}\n${s.text}`);
    for (const sub of s.subs ?? []) body.push(`\\subsection{${sub}}\\label{sec:${sub.toLowerCase().replace(/\W+/g, '-')}}\n[${sub} results.]`);
  }
  const front = type === 'blank' ? '\\maketitle' : '\\maketitle\n\n\\tableofcontents\n\n\\clearpage';
  return String.raw`\documentclass[11pt,oneside,letterpaper]{article}
\input{preamble.tex}

\title{${texEsc(name)}}
\author{${texEsc(owner || 'Author')}${modelId ? ` \\\\ \\small Model ${texEsc(modelId)}` : ''}}
\date{\today}

\begin{document}

${front}

${body.join('\n\n')}

\bibliographystyle{plainnat}
\bibliography{references}

\end{document}
`;
}

export const STARTER_BIB = `@book{bcbs_irb_2017,
  author    = {{Basel Committee on Banking Supervision}},
  title     = {Basel {III}: Finalising post-crisis reforms},
  publisher = {Bank for International Settlements},
  year      = {2017}
}
`;

export function defaultManifest(name: string, type: ReportType, engine: Engine, opts: { modelId?: string; owner?: string; withSuite: boolean }): ProjectManifest {
  return {
    version: 1,
    name,
    reportType: type,
    modelId: opts.modelId,
    owner: opts.owner,
    mainFile: 'report.tex',
    engine,
    tests: {
      command: opts.withSuite ? '{python} validation/run_suite.py --out "{runDir}"' : '',
      suiteName: opts.withSuite ? 'validation_suite' : undefined,
    },
    blocks: {},
    refreshBeforeCompile: true,
    theme: { ...DEFAULT_THEME, headerLeft: name },
  };
}

/** Generated blocks pre-wired in the sample project (rendered after the first run). */
export const SAMPLE_BLOCKS: GeneratedBlockConfig[] = [
  {
    id: 'tab_discrimination', kind: 'table', run: 0, followLatest: true,
    source: 'outputs/discrimination_summary.csv', testIds: ['disc.auc.full', 'disc.gini.full', 'disc.ks.full'],
    caption: 'Discrimination by segment, observation window 2019--2025.', label: 'tab:discrimination',
    decimals: 3, highlight: { column: 'Result', equals: 'Warning' }, style: 'booktabs', sourceLine: true, totalRow: true,
  },
  {
    id: 'tab_calib_grade', kind: 'table', run: 0, followLatest: true,
    source: 'outputs/calibration_by_grade.csv', testIds: ['calib.hl.pooled'],
    caption: 'Calibration by rating grade, observation window 2019--2025. Jeffreys test, $\\alpha = 0.05$.', label: 'tab:calib-grade',
    columns: ['Grade', 'Obligors', 'Avg. PD', 'Obs. DR', 'Defaults', 'Jeffreys p', 'Result'],
    percentColumns: ['Avg. PD', 'Obs. DR'], decimals: 2, highlight: { column: 'Result', equals: 'Fail' }, style: 'booktabs', sourceLine: true, totalRow: true,
  },
  {
    id: 'sum_calibration', kind: 'summary', run: 0, followLatest: true, testIds: ['calib.jeffreys.grade_7', 'calib.hl.pooled'],
    template: 'Portfolio-wide, {{calib.hl.pooled.details.observed}} defaults were observed against {{calib.hl.pooled.details.expected}} expected, and the Hosmer--Lemeshow test returns $p = {{calib.hl.pooled.value}}$. For Grade~7 the Jeffreys test returns $p = {{calib.jeffreys.grade_7.value}}$ ({{calib.jeffreys.grade_7.details.defaults}} defaults among {{calib.jeffreys.grade_7.details.obligors}} obligors).',
  },
  {
    id: 'fig_reliability', kind: 'figure', run: 0, followLatest: true, source: 'outputs/reliability_diagram.pdf', testIds: ['calib.hl.pooled'],
    caption: 'Reliability diagram: observed default rate against average predicted PD by grade (log scales). Bars show 95\\% Jeffreys intervals.', label: 'fig:reliability', width: '0.78\\linewidth', sourceLine: true,
  },
  {
    id: 'tab_psi_sector', kind: 'table', run: 0, followLatest: true,
    source: 'outputs/psi_by_sector.csv', testIds: ['stab.psi.score', 'stab.psi.sector.energy'],
    caption: 'Population stability index by sector, development sample versus 2025.', label: 'tab:psi-sector',
    percentColumns: ['Dev. mix', '2025 mix'], decimals: 3, highlight: { column: 'Result', equals: 'Warning' }, style: 'booktabs', sourceLine: true, totalRow: true,
  },
];

export function pendingTex(cfg: GeneratedBlockConfig): string {
  if (cfg.kind === 'summary') return '% Generated by Quire. Pending first test run.\n\\textit{[Pending first test run: this summary is filled in from the test results.]}\n';
  const env = cfg.kind === 'figure' ? 'figure' : 'table';
  return [
    '% Generated by Quire. Pending first test run.',
    `\\begin{${env}}[htbp]`,
    '  \\centering',
    cfg.caption ? `  \\caption{${cfg.caption}}` : '',
    cfg.label ? `  \\label{${cfg.label}}` : '',
    '  \\fbox{\\parbox{0.8\\linewidth}{\\centering\\small\\itshape Pending first test run}}',
    `\\end{${env}}`,
  ].filter(Boolean).join('\n') + '\n';
}
