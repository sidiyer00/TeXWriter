// Built-in templates. Model documentation, monitoring reports, the generic article and the
// blank document share the TeXWriter preamble, whose layout Document setup manages. Journal
// formats use the publisher's own class; their preamble only adds what the editor needs.
import type { AcademicFormat, ProjectManifest, ReportType, ThemeSettings, Engine } from '../shared/types';
import { DEFAULT_THEME, themeBlock } from '../shared/latex/theme';
import { ACADEMIC_FORMATS, academicFormatInfo } from '../shared/templateCatalog';

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
  return String.raw`% TeXWriter report preamble.
% The block between the texwriter:theme markers is managed by Document setup.
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

\AtBeginDocument{\color{texwritertext}}
${numbering}
\def\sectionautorefname{Section}
\def\subsectionautorefname{Section}
\def\subsubsectionautorefname{Section}

\lstset{basicstyle=\ttfamily\footnotesize, columns=fullflexible, keepspaces=true,
  breaklines=true, frame=lines, framerule=0.4pt, rulecolor=\color{black!25},
  numbers=left, numberstyle=\tiny\color{black!50}, xleftmargin=1.8em,
  keywordstyle=\bfseries, commentstyle=\itshape\color{black!60},
  stringstyle=\color{texwriterlink}, showstringspaces=false}

% Callouts: \begin{texwritercallout}{Finding F-01 · Severity: Medium} ... \end{texwritercallout}
\newtcolorbox{texwritercallout}[1]{colback=texwritercalloutfill, colframe=black!22,
  boxrule=0.4pt, arc=1.5pt, left=8pt, right=8pt, top=5pt, bottom=6pt,
  fonttitle=\sffamily\scriptsize\bfseries, coltitle=black!70,
  colbacktitle=texwritercalloutfill, titlerule=0pt, title={\MakeUppercase{#1}}}

\pagestyle{fancy}
\fancyhf{}
\fancyhead[L]{\sffamily\scriptsize\MakeUppercase{\texwriterheadleft}}
\fancyhead[R]{\sffamily\scriptsize\MakeUppercase{\texwriterheadright}}
\fancyfoot[C]{\sffamily\small\thepage}
\renewcommand{\headrulewidth}{0.3pt}
`;
}

interface Sec { title: string; label?: string; text: string; subs?: string[] }

const REPORT_FRONT = '\\maketitle\n\n\\tableofcontents\n\n\\texwriterlistoftablesandfigures\n\n\\clearpage';
const ACADEMIC_THEME: Partial<ThemeSettings> = { headerRight: '', parSkip: false, headingFont: 'body', fontSize: 11, bodyFont: 'pagella', lineSpread: 1.1 };

const MODEL_DOC: Sec[] = [
  { title: 'Purpose and intended use', label: 'sec:purpose', text: '[What the model is for, who uses it, the decisions it informs and where it must not be used.]' },
  { title: 'Model overview', label: 'sec:overview', text: '[Inputs, outputs and the modelling approach at a high level.]' },
  { title: 'Data', label: 'sec:data', text: '[Sources, lineage, sample construction, exclusions and data-quality checks.]' },
  { title: 'Methodology', label: 'sec:method', text: '[Specification, estimation and the alternatives considered.]', subs: ['Model specification', 'Estimation', 'Key assumptions'] },
  { title: 'Performance', label: 'sec:performance', text: '[In-sample and out-of-sample performance against the agreed criteria.]' },
  { title: 'Implementation', label: 'sec:implementation', text: '[Production code, controls and reconciliation to the development code.]' },
  { title: 'Limitations and compensating controls', label: 'sec:limitations', text: '[Known weaknesses, overlays and how they are controlled.]' },
  { title: 'Ongoing monitoring plan', label: 'sec:monitoring', text: '[Metrics, thresholds, frequency, owners and escalation.]' },
];

const MONITORING: Sec[] = [
  { title: 'Summary', label: 'sec:summary', text: '[Overall status for the period, breaches and the actions they require.]' },
  { title: 'Model and monitoring scope', label: 'sec:scope', text: '[Model, version, period covered and the metrics monitored.]' },
  { title: 'Performance metrics', label: 'sec:metrics', text: '[Each metric against its threshold, with the trend over recent periods.]' },
  { title: 'Data and population', label: 'sec:population', text: '[Changes in the input data and the population scored since the last report.]' },
  { title: 'Breaches and actions', label: 'sec:actions', text: '[Breaches, root causes, owners and due dates.]' },
  { title: 'Conclusion', label: 'sec:conclusion', text: '[Whether the model remains fit for use.]' },
];

function sections(secs: Sec[]): string {
  const out: string[] = [];
  for (const s of secs) {
    out.push(`\\section{${s.title}}${s.label ? `\\label{${s.label}}` : ''}\n${s.text}`);
    for (const t of s.subs ?? []) out.push(`\\subsection{${t}}\\label{sec:${t.toLowerCase().replace(/\W+/g, '-')}}\n[${t}.]`);
  }
  return out.join('\n\n');
}

function texEsc(s: string) { return s.replace(/([%&#_$])/g, '\\$1'); }

/** Document setup values a built-in template starts with. */
function themeFor(type: ReportType, format?: AcademicFormat): Partial<ThemeSettings> {
  if (type === 'academic') return format && format !== 'article' ? { classLayout: true, headerRight: '' } : ACADEMIC_THEME;
  if (type === 'blank') return { headerRight: '' };
  return {};
}

/** Preamble options for a built-in template. */
export function preambleOptionsFor(type: ReportType, format?: AcademicFormat): PreambleOptions {
  return type === 'academic' ? { cite: 'authoryear', numberWithin: null } : {};
}

/** report.tex for the built-in templates that use the TeXWriter preamble. */
export function reportTex(type: ReportType, name: string, owner = '', format?: AcademicFormat): string {
  if (type === 'academic' && format && format !== 'article') return journalTex(format, name, owner);
  const title = texEsc(name);
  const author = texEsc(owner || 'Author');
  let front = '\\maketitle';
  let body = 'Start writing here.';
  let back = '';
  let bib = 'plainnat';
  if (type === 'documentation') { front = REPORT_FRONT; body = sections(MODEL_DOC); back = '\\appendix\n\n\\section{Supporting material}\\label{app:support}\n[Detailed tables, data dictionaries and code listings.]'; }
  if (type === 'monitoring') { front = REPORT_FRONT; body = sections(MONITORING); }
  if (type === 'academic') {
    front = '\\maketitle\n\n\\begin{abstract}\n[State the question, what you did, the main result and why it matters.]\n\\end{abstract}\n\n\\noindent\\textbf{Keywords:} keyword one; keyword two; keyword three.';
    body = sections(ACADEMIC_BODY) ;
    back = '\\section*{Acknowledgements}\n[Funding and thanks.]';
  }
  if (type === 'blank') { body = '\\section{Introduction}\\label{sec:intro}\nStart writing here.'; }
  return String.raw`\documentclass[11pt,oneside,letterpaper]{article}
\input{preamble.tex}

\title{${title}}
\author{${author}}
\date{\today}

\begin{document}

${front}

${body}
${back ? `\n${back}\n` : ''}
\bibliographystyle{${bib}}
\bibliography{references}

\end{document}
`;
}

const ACADEMIC_BODY: Sec[] = [
  { title: 'Introduction', label: 'sec:intro', text: '[Motivate the question, state the gap and summarise the contribution. Typesetting builds on \\citet{knuth1984}.]' },
  { title: 'Related work', label: 'sec:related', text: '[Position the paper against prior work.]' },
  { title: 'Methods', label: 'sec:methods', text: '[Data, design and estimation in enough detail to reproduce the results.]' },
  { title: 'Results', label: 'sec:results', text: '[Main findings, with tables and figures.]' },
  { title: 'Discussion', label: 'sec:discussion', text: '[Interpretation, limitations and implications.]' },
  { title: 'Conclusion', label: 'sec:conclusion', text: '[What was shown and what comes next.]' },
];

/** The body sections most journal templates start from (headings are the publishers' usual ones). */
function journalSections(apa = false): string {
  const secs: Sec[] = apa
    ? [
      { title: 'Method', label: 'sec:method', text: '[Enough detail to replicate the study.]', subs: ['Participants', 'Materials', 'Procedure'] },
      { title: 'Results', label: 'sec:results', text: '[Statistics for each hypothesis, with effect sizes and confidence intervals.]' },
      { title: 'Discussion', label: 'sec:discussion', text: '[Whether the hypotheses were supported, limitations and implications.]' },
    ]
    : [
      { title: 'Introduction', label: 'sec:intro', text: '[Motivation, the problem and your contributions. Typesetting builds on \\cite{knuth1984}.]' },
      { title: 'Related Work', label: 'sec:related', text: '[Closest prior work and how this paper differs.]' },
      { title: 'Method', label: 'sec:method', text: '[The approach.]' },
      { title: 'Results', label: 'sec:results', text: '[Experiments and findings.]' },
      { title: 'Conclusion', label: 'sec:conclusion', text: '[Summary and future work.]' },
    ];
  return sections(secs);
}

const ABS = '[One paragraph: the problem, the approach, the key result and its significance.]';

/** A paper in a publisher's class, laid out as that publisher's own template. */
export function journalTex(format: AcademicFormat, name: string, owner = ''): string {
  const t = texEsc(name);
  const a = texEsc(owner || 'First Author');
  // \PassOptionsToPackage before the class: several classes load xcolor themselves, and the
  // editor's table shading needs its table option
  const pre = '\\PassOptionsToPackage{table}{xcolor}';
  switch (format) {
    case 'ieee-conf': return String.raw`${pre}
\documentclass[conference]{IEEEtran}
\input{preamble.tex}

\begin{document}

\title{${t}}

\author{\IEEEauthorblockN{${a}}
\IEEEauthorblockA{\textit{Department} \\
\textit{Organization}\\
City, Country \\
email@example.com}
\and
\IEEEauthorblockN{Second Author}
\IEEEauthorblockA{\textit{Department} \\
\textit{Organization}\\
City, Country \\
email@example.com}}

\maketitle

\begin{abstract}
${ABS}
\end{abstract}

\begin{IEEEkeywords}
keyword one, keyword two, keyword three
\end{IEEEkeywords}

${journalSections()}

\section*{Acknowledgment}
[Funding and thanks.]

\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
`;
    case 'ieee-journal': return String.raw`${pre}
\documentclass[journal]{IEEEtran}
\input{preamble.tex}

\begin{document}

\title{${t}}

\author{${a},~\IEEEmembership{Member,~IEEE,}
        and~Second~Author%
\thanks{Manuscript received Month DD, YYYY; revised Month DD, YYYY.}%
\thanks{The authors are with the Department, Organization, City, Country (e-mail: author@example.com).}}

\markboth{Journal of \LaTeX\ Class Files,~Vol.~XX, No.~X, Month~YYYY}%
{Author \MakeLowercase{\textit{et al.}}: ${t}}

\maketitle

\begin{abstract}
${ABS}
\end{abstract}

\begin{IEEEkeywords}
keyword one, keyword two, keyword three
\end{IEEEkeywords}

${journalSections()}

\section*{Acknowledgment}
[Funding and thanks.]

\bibliographystyle{IEEEtran}
\bibliography{references}

\end{document}
`;
    case 'acm': return String.raw`${pre}
\documentclass[sigconf]{acmart}
\input{preamble.tex}

% Replace with the rights and conference details from your ACM rights form.
\setcopyright{acmlicensed}
\copyrightyear{2026}
\acmYear{2026}
\acmConference[Conference '26]{Conference Name}{Month DD--DD, 2026}{City, Country}
\acmBooktitle{Proceedings of Conference Name}
\acmDOI{XXXXXXX.XXXXXXX}
\acmISBN{978-1-4503-XXXX-X/2026/MM}

\begin{document}

\title{${t}}

\author{${a}}
\affiliation{%
  \institution{Institution}
  \city{City}
  \country{Country}}
\email{author@example.com}

\author{Second Author}
\affiliation{%
  \institution{Institution}
  \city{City}
  \country{Country}}
\email{second@example.com}

\begin{abstract}
${ABS}
\end{abstract}

\begin{CCSXML}
<ccs2012>
 <concept>
  <concept_id>10010147.10010257</concept_id>
  <concept_desc>Computing methodologies~Machine learning</concept_desc>
  <concept_significance>500</concept_significance>
 </concept>
</ccs2012>
\end{CCSXML}
\ccsdesc[500]{Computing methodologies~Machine learning}

\keywords{keyword one, keyword two, keyword three}

\maketitle

${journalSections()}

\begin{acks}
[Funding and thanks.]
\end{acks}

\bibliographystyle{ACM-Reference-Format}
\bibliography{references}

\end{document}
`;
    case 'elsevier': return String.raw`${pre}
\documentclass[preprint,12pt]{elsarticle}
\input{preamble.tex}

\journal{Journal Name}

\begin{document}

\begin{frontmatter}

\title{${t}}

\author[inst1]{${a}}
\author[inst2]{Second Author}

\affiliation[inst1]{organization={Department, Organization},
            city={City},
            country={Country}}
\affiliation[inst2]{organization={Department, Organization},
            city={City},
            country={Country}}

\begin{abstract}
${ABS}
\end{abstract}

\begin{keyword}
keyword one \sep keyword two \sep keyword three
\end{keyword}

\end{frontmatter}

${journalSections()}

\section*{Acknowledgements}
[Funding and thanks.]

\bibliographystyle{elsarticle-num}
\bibliography{references}

\end{document}
`;
    case 'springer-lncs': return String.raw`${pre}
\documentclass[runningheads]{llncs}
\input{preamble.tex}

\begin{document}

\title{${t}}

\author{${a}\inst{1}\orcidID{0000-0000-0000-0000} \and
Second Author\inst{2}}

\authorrunning{F. Author et al.}

\institute{Institution, City, Country \\
\email{author@example.com} \and
Institution, City, Country \\
\email{second@example.com}}

\maketitle

\begin{abstract}
${ABS}

\keywords{Keyword one \and Keyword two \and Keyword three.}
\end{abstract}

${journalSections()}

\begin{credits}
\subsubsection{\ackname} [Funding and thanks.]

\subsubsection{\discintname}
The authors have no competing interests to declare that are relevant to the content of this article.
\end{credits}

\bibliographystyle{splncs04}
\bibliography{references}

\end{document}
`;
    case 'aps': return String.raw`${pre}
\documentclass[aps,prl,reprint,superscriptaddress]{revtex4-2}
\input{preamble.tex}

\begin{document}

\title{${t}}

\author{${a}}
\affiliation{Department, Institution, City, Country}
\author{Second Author}
\affiliation{Department, Institution, City, Country}

\date{\today}

\begin{abstract}
${ABS}
\end{abstract}

\maketitle

${journalSections()}

\begin{acknowledgments}
[Funding and thanks.]
\end{acknowledgments}

\bibliography{references}

\end{document}
`;
    case 'ams': return String.raw`${pre}
\documentclass{amsart}
\input{preamble.tex}

\newtheorem{theorem}{Theorem}[section]
\newtheorem{lemma}[theorem]{Lemma}
\theoremstyle{definition}
\newtheorem{definition}[theorem]{Definition}
\theoremstyle{remark}
\newtheorem{remark}[theorem]{Remark}

\begin{document}

\title{${t}}

\author{${a}}
\address{Department, Institution, City, Country}
\email{author@example.com}

\subjclass[2020]{Primary 00A00; Secondary 00A99}
\keywords{keyword one, keyword two}

\begin{abstract}
${ABS}
\end{abstract}

\maketitle

${journalSections()}

\bibliographystyle{amsplain}
\bibliography{references}

\end{document}
`;
    case 'apa7': return String.raw`${pre}
\documentclass[man,natbib]{apa7}
\input{preamble.tex}

\title{${t}}
\shorttitle{${t.length > 50 ? t.slice(0, 50) : t}}
\author{${a}}
\affiliation{Department, Institution}
\leftheader{${a.split(' ').pop()}}

\abstract{[150--250 words: purpose, method, results and conclusions.]}
\keywords{keyword one, keyword two, keyword three}

\authornote{
  \addORCIDlink{${a}}{0000-0000-0000-0000}

  Correspondence concerning this article should be addressed to ${a}, Department, Institution. Email: author@example.com}

\begin{document}

\maketitle

[The introduction starts here, without a heading. State the problem, review the literature and give your hypotheses \citep{knuth1984}.]

${journalSections(true)}

\bibliographystyle{apacite}
\bibliography{references}

\end{document}
`;
    default: return reportTex('academic', name, owner, 'article');
  }
}

/** preamble.tex for a journal format: the class owns the layout; add only what the editor emits. */
export function journalPreamble(format: AcademicFormat, theme: ThemeSettings): string {
  const info = academicFormatInfo(format);
  return String.raw`% TeXWriter preamble for ${info.title} (${info.cls} class).
% The class sets the page layout, fonts and headings; this file only loads what the editor's
% features use. The block between the texwriter:theme markers is managed by TeXWriter;
% everything else here is yours.
\usepackage{graphicx}
\usepackage{xcolor}
\usepackage{booktabs}
\usepackage{array}
\usepackage{amsmath}
\usepackage{listings}
\makeatletter
% some classes load their own math fonts or citation package first
\@ifpackageloaded{newtxmath}{}{\@ifpackageloaded{amssymb}{}{\usepackage{amssymb}}}
\@ifpackageloaded{natbib}{}{\@ifpackageloaded{apacite}{}{\usepackage[numbers,sort&compress]{natbib}}}
\makeatother

${themeBlock(theme)}

\lstset{basicstyle=\ttfamily\footnotesize, columns=fullflexible, keepspaces=true, breaklines=true, frame=lines}

% Callouts: \begin{texwritercallout}{Title} ... \end{texwritercallout}
\newenvironment{texwritercallout}[1]{\par\medskip\noindent\fbox\bgroup\begin{minipage}{\dimexpr\linewidth-2\fboxsep-2\fboxrule\relax}\textbf{#1}\par}{\end{minipage}\egroup\par\medskip}
`;
}

export const STARTER_BIB = `@book{knuth1984,
  author    = {Donald E. Knuth},
  title     = {The {\\TeX}book},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1984}
}

@book{lamport1994,
  author    = {Leslie Lamport},
  title     = {{\\LaTeX}: A Document Preparation System},
  edition   = {2},
  publisher = {Addison-Wesley},
  address   = {Reading, MA},
  year      = {1994}
}
`;

export function defaultManifest(name: string, type: ReportType, engine: Engine, opts: { owner?: string; academicFormat?: AcademicFormat } = {}): ProjectManifest {
  const fmt = type === 'academic' ? opts.academicFormat ?? 'article' : undefined;
  const t = themeFor(type, fmt);
  return {
    version: 1,
    name,
    reportType: type,
    ...(fmt ? { academicFormat: fmt } : {}),
    owner: opts.owner,
    mainFile: 'report.tex',
    engine,
    generators: { runBeforeCompile: false, timeoutSec: 300 },
    blocks: {},
    theme: { ...DEFAULT_THEME, ...t, preset: Object.keys(t).length ? 'custom' : DEFAULT_THEME.preset, headerLeft: name },
  };
}

export { ACADEMIC_FORMATS };
