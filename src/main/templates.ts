// Report templates. Each produces report.tex; all share the Quire preamble.
import type { GeneratedBlockConfig, ProjectManifest, ReportType, ThemeSettings, Engine } from '../shared/types';
import { DEFAULT_THEME, themeBlock } from '../shared/latex/theme';
import { TEMPLATES } from '../shared/templateCatalog';

export interface PreambleOptions {
  /** natbib mode: numbered [1] or author–year (Smith, 2020) */
  cite?: 'numbers' | 'authoryear';
  /** number equations, tables and figures within sections, chapters, or straight through */
  numberWithin?: 'section' | 'chapter' | null;
}

export function preambleTex(theme: ThemeSettings, o: PreambleOptions = {}): string {
  const cite = o.cite === 'authoryear' ? '\\usepackage[authoryear,round]{natbib}' : '\\usepackage[numbers,sort&compress]{natbib}';
  const within = o.numberWithin === undefined ? 'section' : o.numberWithin;
  const numbering = within ? [`\\numberwithin{equation}{${within}}`, `\\numberwithin{table}{${within}}`, `\\numberwithin{figure}{${within}}`].join('\n') : '';
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
${cite}
\usepackage{fancyhdr}
\usepackage{hyperref}

${themeBlock(theme)}

\AtBeginDocument{\color{quiretext}}
${numbering}
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

interface Sec { title: string; label?: string; text: string; subs?: string[]; cmd?: 'chapter' | 'section' }

interface TemplateDef {
  cls?: string;
  /** class options beyond size/sides/paper (which come from the theme) */
  clsOpts?: string[];
  /** after \begin{document}, before the sections */
  front: string;
  sections: Sec[];
  /** after the sections, before the bibliography (appendices) */
  back?: string;
  bibStyle?: string;
  preamble?: PreambleOptions;
  /** Document setup values for this kind of document */
  theme?: Partial<ThemeSettings>;
}

const ABSTRACT = (text: string, keywords?: string) => `\\begin{abstract}\n${text}\n\\end{abstract}${keywords ? `\n\n\\noindent\\textbf{Keywords:} ${keywords}` : ''}`;
const REPORT_FRONT = '\\maketitle\n\n\\tableofcontents\n\n\\clearpage';
const ACADEMIC_THEME: Partial<ThemeSettings> = { headerRight: '', parSkip: false, headingFont: 'body' };

const DEFS: Record<ReportType, TemplateDef> = {
  validation: { front: REPORT_FRONT, sections: [
    { title: 'Executive summary', label: 'sec:summary', text: '[State the validation opinion, the overall rating and the findings that drive it.]' },
    { title: 'Scope and model overview', label: 'sec:scope', text: '[Describe the model, its intended use, the version validated and what was in scope.]' },
    { title: 'Data', label: 'sec:data', text: '[Summarise data sources, the observation window, exclusions and data-quality results.]' },
    { title: 'Methodology review', label: 'sec:method', text: '[Assess the conceptual soundness of the approach and key assumptions.]' },
    { title: 'Performance testing', label: 'sec:performance', text: '[Introduce the test suite and acceptance thresholds.]', subs: ['Discrimination', 'Calibration', 'Stability'] },
    { title: 'Findings and limitations', label: 'sec:findings', text: '[List findings with severity, owner and remediation date.]' },
    { title: 'Conclusion and sign-off', label: 'sec:signoff', text: '[Validator opinion and approvals.]' },
  ] },
  documentation: { front: REPORT_FRONT, sections: [
    { title: 'Purpose and intended use', label: 'sec:purpose', text: '[Business purpose, users, products and portfolios in scope.]' },
    { title: 'Model overview', label: 'sec:overview', text: '[High-level description of inputs, outputs and the modelling approach.]' },
    { title: 'Data', label: 'sec:data', text: '[Sources, lineage, sample construction and treatments.]' },
    { title: 'Methodology', label: 'sec:method', text: '[Specification, estimation and variable selection.]' },
    { title: 'Implementation', label: 'sec:impl', text: '[Production code, controls and reconciliation to the development code.]' },
    { title: 'Performance', label: 'sec:performance', text: '[Development-sample and out-of-time performance.]' },
    { title: 'Limitations and assumptions', label: 'sec:limits', text: '[Known weaknesses, compensating controls and overlays.]' },
    { title: 'Ongoing monitoring plan', label: 'sec:monitoring', text: '[Metrics, thresholds, frequency and escalation.]' },
  ] },
  monitoring: { front: REPORT_FRONT, sections: [
    { title: 'Summary', label: 'sec:summary', text: '[Overall monitoring status for the period and breaches requiring action.]' },
    { title: 'Key performance indicators', label: 'sec:kpi', text: '[KPI results against thresholds.]' },
    { title: 'Breaches and actions', label: 'sec:actions', text: '[Breaches, root causes, owners and due dates.]' },
  ] },
  performance: { front: REPORT_FRONT, sections: [
    { title: 'Summary', label: 'sec:summary', text: '[Headline results and conclusions.]' },
    { title: 'Discrimination', label: 'sec:discrimination', text: '[AUC, Gini and KS results by segment.]' },
    { title: 'Calibration', label: 'sec:calibration', text: '[Grade-level and portfolio calibration tests.]' },
    { title: 'Stability', label: 'sec:stability', text: '[Population and characteristic stability.]' },
    { title: 'Backtesting', label: 'sec:backtesting', text: '[Realised versus predicted defaults over time.]' },
    { title: 'Conclusions', label: 'sec:conclusions', text: '[Recommendations.]' },
  ] },
  article: {
    front: `\\maketitle\n\n${ABSTRACT('[State the problem, what you did, the main result and why it matters, in 150--250 words.]', 'keyword one; keyword two; keyword three.')}`,
    sections: [
      { title: 'Introduction', label: 'sec:intro', text: '[Motivate the question, state the gap in the literature and summarise your contribution.]' },
      { title: 'Background and related work', label: 'sec:background', text: '[Position the paper against prior work.]' },
      { title: 'Methods', label: 'sec:methods', text: '[Data, design and estimation in enough detail to reproduce the results.]', subs: ['Data', 'Model', 'Estimation'] },
      { title: 'Results', label: 'sec:results', text: '[Main findings, with tables and figures.]' },
      { title: 'Discussion', label: 'sec:discussion', text: '[Interpretation, limitations and implications.]' },
      { title: 'Conclusion', label: 'sec:conclusion', text: '[What was shown and what comes next.]' },
    ],
    back: '\\section*{Acknowledgements}\n[Funding and thanks.]\n\n\\section*{Data availability}\n[Where the data and code can be obtained.]',
    bibStyle: 'plainnat', preamble: { cite: 'authoryear', numberWithin: null },
    theme: { ...ACADEMIC_THEME, fontSize: 11, bodyFont: 'pagella', lineSpread: 1.1 },
  },
  conference: {
    clsOpts: ['twocolumn'],
    front: `\\maketitle\n\n${ABSTRACT('[One paragraph: problem, approach, key result.]', 'keyword one; keyword two.')}`,
    sections: [
      { title: 'Introduction', label: 'sec:intro', text: '[Problem, contributions (as a short list) and paper outline.]' },
      { title: 'Related work', label: 'sec:related', text: '[Closest prior work and how this paper differs.]' },
      { title: 'Method', label: 'sec:method', text: '[The approach.]' },
      { title: 'Experiments', label: 'sec:experiments', text: '[Datasets, baselines and metrics.]', subs: ['Setup', 'Results', 'Ablations'] },
      { title: 'Conclusion', label: 'sec:conclusion', text: '[Summary and future work.]' },
    ],
    bibStyle: 'unsrtnat', preamble: { cite: 'numbers', numberWithin: null },
    theme: { ...ACADEMIC_THEME, fontSize: 10, bodyFont: 'termes', lineSpread: 1.0, margins: { top: '0.75in', bottom: '1in', inner: '0.7in', outer: '0.7in' } },
  },
  working: {
    front: `\\maketitle\n\n${ABSTRACT('[Research question, identification strategy, data and the main estimates with magnitudes.]')}\n\n\\noindent\\textbf{JEL classification:} G21, G32. \\textbf{Keywords:} keyword one; keyword two.\n\n\\clearpage`,
    sections: [
      { title: 'Introduction', label: 'sec:intro', text: '[Question, why it matters, what you find, and the contribution relative to the literature.]' },
      { title: 'Related literature', label: 'sec:literature', text: '[Strands of literature this paper speaks to.]' },
      { title: 'Institutional background', label: 'sec:background', text: '[Setting needed to understand the identification.]' },
      { title: 'Data', label: 'sec:data', text: '[Sources, sample construction and summary statistics.]' },
      { title: 'Empirical strategy', label: 'sec:strategy', text: '[Specification and identifying assumptions.]', subs: ['Identification', 'Estimation'] },
      { title: 'Results', label: 'sec:results', text: '[Main estimates.]' },
      { title: 'Robustness', label: 'sec:robustness', text: '[Alternative specifications, samples and placebo tests.]' },
      { title: 'Conclusion', label: 'sec:conclusion', text: '[Summary and policy implications.]' },
    ],
    back: '\\appendix\n\n\\section{Additional tables and figures}\\label{app:tables}\n[Supplementary results.]',
    bibStyle: 'plainnat', preamble: { cite: 'authoryear', numberWithin: null },
    theme: { ...ACADEMIC_THEME, fontSize: 12, bodyFont: 'pagella', lineSpread: 1.3 },
  },
  thesis: {
    cls: 'report',
    front: '\\maketitle\n\n\\begin{abstract}\n[Summarise the question, approach, main findings and contribution.]\n\\end{abstract}\n\n\\chapter*{Acknowledgements}\n[Thank your supervisors, committee and funders.]\n\n\\tableofcontents\n\n\\listoffigures\n\n\\listoftables',
    sections: [
      { cmd: 'chapter', title: 'Introduction', label: 'ch:intro', text: '[Motivation and the research questions.]', subs: ['Research questions', 'Contributions', 'Outline of the thesis'] },
      { cmd: 'chapter', title: 'Literature review', label: 'ch:literature', text: '[The state of knowledge and the gap this thesis addresses.]' },
      { cmd: 'chapter', title: 'Methodology', label: 'ch:method', text: '[Design, data and methods.]' },
      { cmd: 'chapter', title: 'Results', label: 'ch:results', text: '[Findings.]' },
      { cmd: 'chapter', title: 'Discussion', label: 'ch:discussion', text: '[Interpretation, limitations and implications.]' },
      { cmd: 'chapter', title: 'Conclusion', label: 'ch:conclusion', text: '[Answers to the research questions and future work.]' },
    ],
    back: '\\appendix\n\n\\chapter{Supplementary material}\\label{app:supplementary}\n[Derivations, extra tables, questionnaires.]',
    bibStyle: 'plainnat', preamble: { cite: 'authoryear', numberWithin: 'chapter' },
    theme: { ...ACADEMIC_THEME, fontSize: 12, bodyFont: 'lmodern', lineSpread: 1.3, margins: { top: '1in', bottom: '1in', inner: '1.5in', outer: '1in' } },
  },
  apa: {
    front: `\\maketitle\n\n${ABSTRACT('[150--250 words: purpose, method, results and conclusions.]', 'keyword one, keyword two, keyword three')}\n\n\\clearpage`,
    sections: [
      { title: 'Introduction', label: 'sec:intro', text: '[The problem, the relevant literature and your hypotheses.]' },
      { title: 'Method', label: 'sec:method', text: '[Enough detail to replicate the study.]', subs: ['Participants', 'Materials', 'Procedure', 'Data analysis'] },
      { title: 'Results', label: 'sec:results', text: '[Statistics for each hypothesis, with effect sizes and confidence intervals.]' },
      { title: 'Discussion', label: 'sec:discussion', text: '[Support for the hypotheses, limitations and implications.]' },
    ],
    bibStyle: 'apalike', preamble: { cite: 'authoryear', numberWithin: null },
    theme: { ...ACADEMIC_THEME, fontSize: 12, bodyFont: 'termes', lineSpread: 1.6, margins: { top: '1in', bottom: '1in', inner: '1in', outer: '1in' } },
  },
  proposal: {
    front: '\\maketitle',
    sections: [
      { title: 'Project summary', label: 'sec:summary', text: '[One paragraph a non-specialist can follow: aim, approach and expected outcome.]' },
      { title: 'Specific aims', label: 'sec:aims', text: '[Two or three aims, each with a testable hypothesis.]' },
      { title: 'Background and significance', label: 'sec:significance', text: '[Why this matters and what is missing.]' },
      { title: 'Preliminary work', label: 'sec:preliminary', text: '[Results that show the approach is feasible.]' },
      { title: 'Research design and methods', label: 'sec:design', text: '[How each aim will be achieved.]', subs: ['Data', 'Approach', 'Analysis plan', 'Risks and alternatives'] },
      { title: 'Timeline and milestones', label: 'sec:timeline', text: '[Milestones by quarter.]' },
      { title: 'Budget and justification', label: 'sec:budget', text: '[Personnel, equipment, travel and other costs.]' },
      { title: 'Expected outcomes and impact', label: 'sec:impact', text: '[Deliverables and who benefits.]' },
    ],
    bibStyle: 'unsrtnat', preamble: { cite: 'numbers', numberWithin: null },
    theme: { ...ACADEMIC_THEME, fontSize: 11, bodyFont: 'pagella', lineSpread: 1.1, parSkip: true },
  },
  techreport: {
    front: REPORT_FRONT,
    sections: [
      { title: 'Executive summary', label: 'sec:summary', text: '[Findings and recommendations on one page.]' },
      { title: 'Introduction', label: 'sec:intro', text: '[Purpose, scope and audience.]' },
      { title: 'Background', label: 'sec:background', text: '[Context the reader needs.]' },
      { title: 'Approach', label: 'sec:approach', text: '[What was done and how.]' },
      { title: 'Results', label: 'sec:results', text: '[What was found.]' },
      { title: 'Recommendations', label: 'sec:recommendations', text: '[Actions, owners and priorities.]' },
    ],
    back: '\\appendix\n\n\\section{Supporting material}\\label{app:support}\n[Detailed tables and data.]',
    theme: { headerRight: 'Technical report' },
  },
  blank: { front: '\\maketitle', sections: [{ title: 'Introduction', label: 'sec:intro', text: 'Start writing here.' }] },
};

export const REPORT_TYPE_LABELS: Record<ReportType, string> = Object.fromEntries(TEMPLATES.map((t) => [t.type, t.title])) as Record<ReportType, string>;

/** Preamble options for a built-in template type. */
export function preambleOptionsFor(type: ReportType): PreambleOptions { return DEFS[type]?.preamble ?? {}; }

function texEsc(s: string) { return s.replace(/([%&#_$])/g, '\\$1'); }

export function reportTex(type: ReportType, name: string, owner = '', modelId = ''): string {
  const def = DEFS[type] ?? DEFS.blank;
  const body: string[] = [];
  for (const s of def.sections) {
    const sub = s.cmd === 'chapter' ? 'section' : 'subsection';
    body.push(`\\${s.cmd ?? 'section'}{${s.title}}${s.label ? `\\label{${s.label}}` : ''}\n${s.text}`);
    for (const t of s.subs ?? []) body.push(`\\${sub}{${t}}\\label{sec:${t.toLowerCase().replace(/\W+/g, '-')}}\n[${t}.]`);
  }
  const opts = ['11pt', 'oneside', 'letterpaper', ...(def.clsOpts ?? [])];
  return String.raw`\documentclass[${opts.join(',')}]{${def.cls ?? 'article'}}
\input{preamble.tex}

\title{${texEsc(name)}}
\author{${texEsc(owner || 'Author')}${modelId ? ` \\\\ \\small Model ${texEsc(modelId)}` : ''}}
\date{\today}

\begin{document}

${def.front}

${body.join('\n\n')}
${def.back ? `\n${def.back}\n` : ''}
\bibliographystyle{${def.bibStyle ?? 'plainnat'}}
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
    theme: { ...DEFAULT_THEME, ...(DEFS[type]?.theme ?? {}), preset: DEFS[type]?.theme ? 'custom' : DEFAULT_THEME.preset, headerLeft: name },
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
