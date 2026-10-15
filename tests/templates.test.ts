import { describe, expect, it } from 'vitest';
import { journalPreamble, preambleOptionsFor, preambleTex, reportTex, defaultManifest } from '../src/main/templates';
import { ACADEMIC_FORMATS } from '../src/shared/templateCatalog';
import { parseDocument } from '../src/shared/latex/blocks';
import { personalize, skeletonize, stripGenerated } from '../src/shared/latex/skeleton';
import { applyThemeToClass } from '../src/shared/latex/theme';
import { defaultCommand, pendingTex, renderDataTable, renderGenerated, renderTexTable, starterScript } from '../src/shared/generate';
import { parseTableBlock } from '../src/shared/latex/table';
import type { AcademicFormat, GeneratedBlockConfig, ReportType } from '../src/shared/types';

describe('built-in templates', () => {
  const jobs: [ReportType, AcademicFormat | undefined][] = [['documentation', undefined], ['monitoring', undefined], ['blank', undefined], ...ACADEMIC_FORMATS.map((f) => ['academic', f.id] as [ReportType, AcademicFormat])];
  for (const [type, fmt] of jobs) {
    it(`${type}${fmt ? ` (${fmt})` : ''} produces a document the editor can parse`, () => {
      const m = defaultManifest('My paper', type, 'pdflatex', { academicFormat: fmt });
      const tex = applyThemeToClass(reportTex(type, 'My paper', 'A. Author', m.academicFormat), m.theme);
      const p = parseDocument(tex);
      expect(p.hasDocument).toBe(true);
      expect(p.blocks.some((b) => b.node.type === 'heading')).toBe(true);
      expect(tex).toContain('\\input{preamble.tex}');
      expect(tex).toContain('My paper');
      const pre = m.theme.classLayout ? journalPreamble(m.academicFormat!, m.theme) : preambleTex(m.theme, preambleOptionsFor(type, m.academicFormat));
      expect(pre).toContain('% texwriter:theme begin');
    });
  }
  it('journal formats use the publisher class and leave the layout to it', () => {
    const cls: Record<string, string> = { 'ieee-conf': '[conference]{IEEEtran}', 'ieee-journal': '[journal]{IEEEtran}', acm: '[sigconf]{acmart}', elsevier: '{elsarticle}', 'springer-lncs': '[runningheads]{llncs}', aps: '{revtex4-2}', ams: '{amsart}', apa7: '[man,natbib]{apa7}' };
    for (const [fmt, c] of Object.entries(cls)) {
      const m = defaultManifest('T', 'academic', 'pdflatex', { academicFormat: fmt as AcademicFormat });
      expect(m.theme.classLayout, fmt).toBe(true);
      const tex = applyThemeToClass(reportTex('academic', 'T', 'A', m.academicFormat), m.theme);
      expect(tex, fmt).toContain(c);
      expect(tex.startsWith('\\PassOptionsToPackage{table}{xcolor}'), fmt).toBe(true);
      const pre = journalPreamble(fmt as AcademicFormat, m.theme);
      expect(pre).not.toMatch(/geometry|fancyhdr|\\linespread/);
    }
    expect(reportTex('academic', 'T', 'A', 'acm')).toContain('\\bibliographystyle{ACM-Reference-Format}');
    expect(reportTex('academic', 'T', 'A', 'elsevier')).toContain('\\begin{frontmatter}');
    expect(reportTex('academic', 'T', 'A', 'ieee-conf')).toContain('\\begin{IEEEkeywords}');
    // the plain article keeps Document setup's layout
    const plain = defaultManifest('T', 'academic', 'pdflatex', { academicFormat: 'article' });
    expect(plain.theme.classLayout).toBeFalsy();
  });
});

describe('user templates', () => {
  const doc = String.raw`\documentclass[11pt]{article}
\input{preamble.tex}
\title{Old title}
\author{Old author}
\begin{document}
\maketitle

\begin{abstract}
We find that things happen.
\end{abstract}

\section{Introduction}\label{sec:intro}
Lots of text here with a table.

\begin{table}[htbp]
  \centering
  \begin{tabular}{lr}
    a & 1 \\
  \end{tabular}
\end{table}

\subsection{Background}
More text.

% texwriter:generated id=tab_x
\input{generated/tab_x.tex}
% texwriter:end

\section{Conclusion}
Done.

\bibliographystyle{plainnat}
\bibliography{references}
\end{document}
`;
  it('skeletonize keeps structure and drops content', () => {
    const s = skeletonize(doc);
    expect(s).toContain('\\maketitle');
    expect(s).toContain('\\section{Introduction}\\label{sec:intro}');
    expect(s).toContain('\\subsection{Background}');
    expect(s).toContain('\\begin{abstract}\n[Abstract.]\n\\end{abstract}');
    expect(s).toContain('\\bibliography{references}');
    expect(s).toContain('[Write this section.]');
    expect(s).not.toContain('Lots of text');
    expect(s).not.toContain('tabular');
    expect(s).not.toContain('texwriter:generated');
    expect(s.startsWith('\\documentclass[11pt]{article}\n\\input{preamble.tex}')).toBe(true);
    expect(parseDocument(s).hasDocument).toBe(true);
  });
  it('stripGenerated keeps text but drops generated blocks', () => {
    const s = stripGenerated(doc);
    expect(s).toContain('Lots of text');
    expect(s).not.toContain('texwriter:generated');
  });
  it('personalize fills in the title and author', () => {
    const s = personalize(doc, { title: 'Q3 Review & Outlook', author: 'Risk_Team' });
    expect(s).toContain('\\title{Q3 Review \\& Outlook}');
    expect(s).toContain('\\author{Risk\\_Team}');
    // journal classes put \title in the front matter; structured author blocks are left alone
    expect(personalize('\\documentclass{x}\\begin{document}\\title{in body}\\end{document}', { title: 'N' })).toContain('\\title{N}');
    const ieee = personalize('\\begin{document}\n\\title{Old}\n\\author{\\IEEEauthorblockN{Old}}', { title: 'New', author: 'Me' });
    expect(ieee).toContain('\\title{New}');
    expect(ieee).toContain('\\author{\\IEEEauthorblockN{Old}}');
    expect(personalize('% \\title{commented}\n\\title{Real}', { title: 'X' })).toBe('% \\title{commented}\n\\title{X}');
  });
});

describe('generated tables and figures', () => {
  const csv = 'Segment,Discrimination,,Calibration,\n,AUC,Gini,Obs,Exp\nRetail,0.8123,0.6246,0.012,0.011\nSME,0.7712,0.5424,0.02,0.022\n';
  const cfg: GeneratedBlockConfig = { id: 't', kind: 'table', output: 'data/r.csv', caption: 'Results.', label: 'tab:r' };
  it('renders a multi-level table that the editor can parse', () => {
    const r = renderDataTable(cfg, csv);
    expect(r.tex.split('\n')[0]).toMatch(/^% Generated by TeXWriter from data\/r\.csv/);
    expect(r.tex).toContain('\\cmidrule(lr){2-3} \\cmidrule(lr){4-5}');
    expect(r.tex).toContain('\\label{tab:r}');
    expect(parseTableBlock(r.tex.replace(/^%.*\n/, '').trim())).toBeTruthy();
    expect(r.view.kind === 'table' && r.view.headers?.length).toBe(2);
  });
  it('honours style, hidden columns, number format and source line', () => {
    const r = renderDataTable({ ...cfg, tableStyle: 'grid', hiddenColumns: ['Gini'], numberFormat: 'num,d2', sourceLine: true, fitWidth: true }, csv);
    expect(r.tex).toContain('{|l|r|r|r|}');
    expect(r.tex).not.toContain('Gini');
    expect(r.tex).toContain('& \\textbf{Discrimination} &');
    // the rule between header rows skips the Segment cell merged across both
    expect(r.tex).toContain('\\cline{2-4}');
    expect(r.tex).toContain('\\qnum[num,d2]{0.8123}{0.81}');
    expect(r.tex).toContain('\\resizebox{\\linewidth}{!}{%');
    expect(r.tex).toContain('Source: \\texttt{data/r.csv}');
  });
  it('changes when the data changes', () => {
    expect(renderDataTable(cfg, csv).hash).not.toBe(renderDataTable(cfg, csv.replace('0.8123', '0.9')).hash);
  });
  it('names the script in the header comment', () => {
    expect(renderDataTable({ ...cfg, script: 'scripts/fit.py' }, csv).tex.split('\n')[0]).toContain('(written by scripts/fit.py)');
  });
  it('embeds LaTeX tables a script writes, wrapping a bare tabular', () => {
    const bare = renderTexTable({ ...cfg, output: 'outputs/t.tex' }, '\\begin{tabular}{ll}\na & b \\\\\n\\end{tabular}\n');
    expect(bare.tex).toContain('\\begin{table}[htbp]');
    expect(bare.tex).toContain('\\caption{Results.}');
    const full = renderTexTable({ ...cfg, output: 'outputs/t.tex' }, '\\begin{table}\n\\begin{tabular}{l}x\\end{tabular}\n\\end{table}');
    expect(full.tex.match(/\\begin\{table\}/g)!.length).toBe(1);
    expect(renderGenerated({ ...cfg, output: 'outputs/t.tex' }, '\\begin{tabular}{l}x\\end{tabular}').view.kind).toBe('table');
  });
  it('figures and placeholders', () => {
    const f = renderGenerated({ id: 'f', kind: 'figure', script: 'scripts/p.py', output: 'outputs/p.pdf', caption: 'C.', label: 'fig:p', width: '0.6\\linewidth' }, null);
    expect(f.tex).toContain('\\includegraphics[width=0.6\\linewidth]{outputs/p.pdf}');
    expect(f.tex).toContain('\\label{fig:p}');
    expect(() => renderGenerated({ id: 'f', kind: 'figure', output: 'outputs/p.csv' }, null)).toThrow(/figures must be/);
    const p = pendingTex({ id: 'f', kind: 'figure', script: 'scripts/p.py', output: 'outputs/p.pdf', label: 'fig:p', caption: 'C.' });
    expect(p).toContain('\\label{fig:p}');
    expect(p).toContain('Run scripts/p.py');
  });
  it('default commands and starter scripts', () => {
    expect(defaultCommand('scripts/a.py')).toBe('{python} "{script}"');
    expect(defaultCommand('scripts/a.R')).toBe('Rscript "{script}"');
    expect(starterScript('table', 'python', 'outputs/t.csv', 'tab:t')).toContain('TEXWRITER_OUTPUT');
    expect(starterScript('figure', 'r', 'outputs/f.pdf', 'fig:f')).toContain('pdf(output');
  });
});
