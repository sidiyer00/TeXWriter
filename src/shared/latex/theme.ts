// Document setup → managed LaTeX. Only the text between the theme markers in
// preamble.tex and the \documentclass options are ever rewritten.
import type { ThemeSettings } from '../types';

export const THEME_BEGIN = '% texwriter:theme begin';
export const THEME_END = '% texwriter:theme end';
/** Markers written by Quire, the app's earlier name; recognised and replaced on the next save. */
const LEGACY_BEGIN = '% quire:theme begin';
const LEGACY_END = '% quire:theme end';

/** Start and end offsets of the managed block (current or legacy markers), or null. */
export function findThemeBlock(preamble: string): { begin: number; end: number } | null {
  for (const [b, e] of [[THEME_BEGIN, THEME_END], [LEGACY_BEGIN, LEGACY_END]]) {
    const i = preamble.indexOf(b);
    const j = i >= 0 ? preamble.indexOf(e, i) : -1;
    if (i >= 0 && j > i) return { begin: i, end: j + e.length };
  }
  return null;
}

export const DEFAULT_THEME: ThemeSettings = {
  preset: 'classic',
  paper: 'letter',
  landscape: false,
  fontSize: 11,
  margins: { top: '1in', bottom: '1in', inner: '1in', outer: '1in' },
  twoSide: false,
  bodyFont: 'pagella',
  headingFont: 'body',
  lineSpread: 1.05,
  parSkip: true,
  textColor: '1A1917',
  linkColor: '1E4290',
  tableShade: 'F3ECE6',
  calloutFill: 'F8F6F2',
  printLinksBlack: false,
  headerLeft: '',
  headerRight: 'Internal — Restricted',
};

export const PRESETS: Record<'classic' | 'editorial' | 'compact', Partial<ThemeSettings>> = {
  classic: { preset: 'classic', fontSize: 11, bodyFont: 'pagella', headingFont: 'body', lineSpread: 1.05, margins: { top: '1in', bottom: '1in', inner: '1in', outer: '1in' }, parSkip: true },
  editorial: { preset: 'editorial', fontSize: 11, bodyFont: 'libertinus', headingFont: 'sans', lineSpread: 1.1, margins: { top: '1in', bottom: '1.1in', inner: '1.25in', outer: '1.25in' }, parSkip: true },
  compact: { preset: 'compact', fontSize: 10, bodyFont: 'termes', headingFont: 'body', lineSpread: 1.0, margins: { top: '0.75in', bottom: '0.8in', inner: '0.8in', outer: '0.8in' }, parSkip: false },
};

export const FONT_LABELS: Record<ThemeSettings['bodyFont'], string> = {
  lmodern: 'Latin Modern',
  pagella: 'TeX Gyre Pagella',
  termes: 'TeX Gyre Termes',
  libertinus: 'Libertinus Serif',
  sourceserif: 'Source Serif Pro',
};

const FONT_PKG: Record<ThemeSettings['bodyFont'], string> = {
  lmodern: 'lmodern',
  pagella: 'tgpagella',
  termes: 'tgtermes',
  libertinus: 'libertinus',
  sourceserif: 'sourceserifpro',
};

/** Load a package if the TeX installation has it; otherwise note it in the log. */
const optional = (pkg: string, opts = '') => `\\IfFileExists{${pkg}.sty}{\\usepackage${opts ? `[${opts}]` : ''}{${pkg}}}{\\typeout{TeXWriter: package ${pkg} is not installed}}`;

const hex = (s: string) => s.replace(/^#/, '').toUpperCase().padEnd(6, '0').slice(0, 6);
const tex = (s: string) => s.replace(/([%&#_$])/g, '\\$1');

/** Version of the support macros below; bump when they change so projects are migrated. */
export const SUPPORT_VERSION = 'texwriter-support-v7';

/** Macros the visual editor emits (highlights, merged table cells). Safe to load twice. */
/**
 * Macros for features the visual editor emits. Definitions with #-parameters stay out of
 * \IfFileExists branches: older LaTeX kernels store the branch with \def, where a single
 * # is an error ("Illegal parameter number in definition of \reserved@a").
 */
export const SUPPORT_MACROS = [
  `% ${SUPPORT_VERSION}: macros used by the visual editor`,
  '\\IfFileExists{soul.sty}{\\usepackage{soul}\\def\\texwritersoulok{}}{}',
  '\\IfFileExists{multirow.sty}{\\usepackage{multirow}}{}',
  '\\usepackage{colortbl}',
  '\\ifx\\texwritersoulok\\undefined',
  '  \\providecommand{\\texwriterhl}[2]{\\colorbox[HTML]{#1}{#2}}',
  '\\else',
  '  \\providecommand{\\texwriterhl}[2]{{\\definecolor{texwriterhlc}{HTML}{#1}\\sethlcolor{texwriterhlc}\\hl{#2}}}',
  '\\fi',
  '\\providecommand{\\quirehl}{\\texwriterhl}% highlights in documents written with Quire',
  '\\ifx\\multirow\\undefined\\providecommand{\\multirow}[3]{#3}\\fi',
  '\\ifx\\rowcolors\\undefined\\providecommand{\\rowcolors}[3]{}\\fi',
  '% \\qnum[format]{value}{shown}: number-formatted table cell; prints only the shown text',
  '\\providecommand{\\qnum}[3][]{#3}',
  '% \\texwriterindent{N}: body text indented N steps of 2em (Tab in the visual editor)',
  '\\providecommand{\\texwriterindent}[1]{\\leavevmode\\hangindent=#1\\dimexpr2em\\relax\\hangafter=0\\relax\\ignorespaces}',
  '% \\texwriterlistoftablesandfigures: one section listing tables, then figures ("Table 2.1. Caption ..... 5")',
  '\\makeatletter',
  '\\providecommand{\\texwriterlistoftablesandfigures}{\\begingroup',
  '  \\@ifundefined{chapter}{\\section*}{\\chapter*}{List of Tables and Figures}%',
  '  \\@ifundefined{@dottedtocline}{}{\\def\\l@table{\\@dottedtocline{1}{0em}{2.3em}}\\let\\l@figure\\l@table}%',
  '  \\def\\numberline##1{\\texwriterfloatname~##1.\\enskip}%',
  '  \\def\\texwriterfloatname{\\tablename}\\@starttoc{lot}\\par\\bigskip',
  '  \\def\\texwriterfloatname{\\figurename}\\@starttoc{lof}\\par\\endgroup}',
  '\\makeatother',
];

export function themeBlock(t: ThemeSettings): string {
  // a journal or publisher class sets page, fonts and headers itself: only the editor's macros
  if (t.classLayout) {
    return [`${THEME_BEGIN} — managed by TeXWriter; the document class controls the layout`, ...SUPPORT_MACROS, THEME_END].join('\n');
  }
  const m = t.margins;
  const side = t.twoSide ? `inner=${m.inner},outer=${m.outer}` : `left=${m.inner},right=${m.outer}`;
  const L = [
    `${THEME_BEGIN} — managed by Document setup; edits between these markers are replaced`,
    `\\usepackage[${t.paper}paper,${t.landscape ? 'landscape,' : ''}top=${m.top},bottom=${m.bottom},${side},headheight=14pt]{geometry}`,
    optional(FONT_PKG[t.bodyFont]),
    t.headingFont === 'sans' ? `${optional('helvet', 'scaled=0.92')}\\IfFileExists{sectsty.sty}{\\usepackage{sectsty}\\allsectionsfont{\\sffamily}}{}` : '',
    `\\linespread{${t.lineSpread}}`,
    t.parSkip ? optional('parskip') : '',
    `\\definecolor{texwritertext}{HTML}{${hex(t.textColor)}}`,
    `\\definecolor{texwriterlink}{HTML}{${hex(t.printLinksBlack ? t.textColor : t.linkColor)}}`,
    `\\definecolor{texwritershade}{HTML}{${hex(t.tableShade)}}`,
    `\\definecolor{texwritercalloutfill}{HTML}{${hex(t.calloutFill)}}`,
    '\\color{texwritertext}',
    '\\hypersetup{colorlinks=true,linkcolor=texwriterlink,citecolor=texwriterlink,urlcolor=texwriterlink}',
    '% Heading 4 and 5 (\\paragraph, \\subparagraph): numbered, on a line of their own like the editor shows them',
    '\\setcounter{secnumdepth}{5}',
    '\\makeatletter',
    `\\renewcommand\\paragraph{\\@startsection{paragraph}{4}{\\z@}{3.25ex \\@plus1ex \\@minus.2ex}{.6ex \\@plus.2ex}{\\normalfont\\normalsize\\bfseries${t.headingFont === 'sans' ? '\\sffamily' : ''}}}`,
    `\\renewcommand\\subparagraph{\\@startsection{subparagraph}{5}{\\z@}{3.25ex \\@plus1ex \\@minus.2ex}{.6ex \\@plus.2ex}{\\normalfont\\normalsize\\bfseries\\itshape${t.headingFont === 'sans' ? '\\sffamily' : ''}}}`,
    '\\makeatother',
    '\\def\\paragraphautorefname{Section}\\def\\subparagraphautorefname{Section}',
    `\\newcommand{\\texwriterheadleft}{${tex(t.headerLeft)}}`,
    `\\newcommand{\\texwriterheadright}{${tex(t.headerRight)}}`,
    '% names used by preambles written by Quire (the app\'s earlier name)',
    '\\colorlet{quiretext}{texwritertext}\\colorlet{quirelink}{texwriterlink}\\colorlet{quireshade}{texwritershade}\\colorlet{quirecalloutfill}{texwritercalloutfill}',
    '\\providecommand{\\quireheadleft}{\\texwriterheadleft}\\providecommand{\\quireheadright}{\\texwriterheadright}',
    ...SUPPORT_MACROS,
    THEME_END,
  ];
  return L.filter(Boolean).join('\n');
}

/** Replace (or insert) the managed block in preamble text. */
export function applyThemeToPreamble(preamble: string, t: ThemeSettings): string {
  const block = themeBlock(t);
  const found = findThemeBlock(preamble);
  if (found) {
    const lineStart = preamble.lastIndexOf('\n', found.begin) + 1;
    return preamble.slice(0, lineStart) + block + preamble.slice(found.end);
  }
  // insert after the last \usepackage line, before user definitions
  const lines = preamble.split('\n');
  let at = -1;
  lines.forEach((l, i) => { if (/^\s*\\usepackage/.test(l)) at = i; });
  lines.splice(at + 1, 0, '', block, '');
  return lines.join('\n');
}

/** Rewrite \documentclass options for font size / sidedness. */
export function applyThemeToClass(texMain: string, t: ThemeSettings): string {
  if (t.classLayout) return texMain;
  return texMain.replace(/\\documentclass(\[[^\]]*\])?\{([^}]+)\}/, (_m, opts: string | undefined, cls: string) => {
    const keep = (opts ? opts.slice(1, -1).split(',') : []).map((s) => s.trim()).filter((s) => s && !/^(10|11|12)pt$/.test(s) && !/^(one|two)side$/.test(s) && !/^(letter|a4)paper$/.test(s));
    const all = [`${t.fontSize}pt`, t.twoSide ? 'twoside' : 'oneside', `${t.paper}paper`, ...keep];
    return `\\documentclass[${all.join(',')}]{${cls}}`;
  });
}

/** Read theme values back out of an existing managed block (best effort). */
export function readThemeFromPreamble(preamble: string, base: ThemeSettings): ThemeSettings {
  const found = findThemeBlock(preamble);
  if (!found) return base;
  const block = preamble.slice(found.begin, found.end);
  const t: ThemeSettings = { ...base, margins: { ...base.margins } };
  const g = /\\usepackage\[([^\]]*)\]\{geometry\}/.exec(block);
  if (g) {
    for (const kv of g[1].split(',')) {
      const [k, v] = kv.split('=').map((x) => x.trim());
      if (k === 'top' || k === 'bottom') t.margins[k] = v;
      if (k === 'inner' || k === 'left') t.margins.inner = v;
      if (k === 'outer' || k === 'right') t.margins.outer = v;
      if (k === 'a4paper') t.paper = 'a4';
      if (k === 'letterpaper') t.paper = 'letter';
      if (k === 'landscape') t.landscape = true;
    }
  }
  return t;
}
