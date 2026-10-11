import { describe, expect, it } from 'vitest';
import { parseLatexLog, pagesFromLog, closest } from '../src/shared/latex/log';
import { renderTable } from '../src/shared/generate';
import { parseCsv } from '../src/shared/csv';
import { normalizeResults, parseJUnit, compareRuns } from '../src/shared/results';
import { applyThemeToPreamble, applyThemeToClass, DEFAULT_THEME } from '../src/shared/latex/theme';

const LOG = `This is pdfTeX, Version 3.141592653
(./report.tex
LaTeX2e <2023-11-01>
(./preamble.tex
./preamble.tex:19: Undefined control sequence.
l.19 \\pdgrade
              {7}
)
LaTeX Warning: Reference \`fig:psi-sector' on page 18 undefined on input line 471.

Package natbib Warning: Citation \`basel_irb_2017' on page 17 undefined on input line 410.

(./generated/tab_psi.tex
Overfull \\hbox (14.2pt too wide) in alignment at lines 12--20
) [18]
Output written on .quire/build/report.pdf (38 pages, 412345 bytes).
`;

describe('log parser', () => {
  const d = parseLatexLog(LOG, 'report.tex');
  it('finds errors with file and line', () => {
    const e = d.find((x) => x.severity === 'error')!;
    expect(e).toMatchObject({ file: 'preamble.tex', line: 19, key: '\\pdgrade' });
  });
  it('finds undefined refs and citations', () => {
    expect(d.find((x) => x.kind === 'undefined-reference')).toMatchObject({ key: 'fig:psi-sector', page: 18, line: 471 });
    expect(d.find((x) => x.kind === 'undefined-citation')).toMatchObject({ key: 'basel_irb_2017', page: 17, line: 410 });
  });
  it('attributes overfull boxes to the open file', () => {
    expect(d.find((x) => x.kind === 'overfull')).toMatchObject({ file: 'generated/tab_psi.tex', line: 12 });
  });
  it('reads page count and suggests near keys', () => {
    expect(pagesFromLog(LOG)).toBe(38);
    expect(closest('fig:psi-sector', ['fig:psi-segment', 'tab:calib'])).toBe('fig:psi-segment');
  });
  it('unwraps 79-column log lines', () => {
    const long = '/tmp/some/very/long/project/path/that/keeps/going/and/going/preamble.tex:19: Emerg';
    const wrapped = long.slice(0, 79) + '\n' + long.slice(79) + 'ency stop.\n';
    const r = parseLatexLog(wrapped, 'report.tex', '/tmp/some/very/long/project/path/that/keeps/going/and/going');
    expect(r[0]).toMatchObject({ file: 'preamble.tex', message: 'Emergency stop.' });
  });
});

describe('generated tables', () => {
  const csv = 'Grade,Obligors,Avg. PD,Jeffreys p,Result\n1,412,0.0003,0.381,Pass\n7,455,0.051,0.0088,Fail\nAll,867,0.027,,HL p = 0.25\n';
  const meta = { number: 3, suite: 'suite', status: 'completed', startedAt: '2026-10-09T14:32:00Z', command: '', counts: { passed: 0, failed: 0, warning: 0, skipped: 0, total: 0 }, outputs: [], gitCommit: 'a3f9c21' } as const;
  it('renders booktabs LaTeX with highlights, percent and source line', () => {
    const r = renderTable({ id: 't', kind: 'table', run: 3, followLatest: true, testIds: [], percentColumns: ['Avg. PD'], decimals: 2, highlight: { column: 'Result', equals: 'Fail' }, caption: 'Cal.', label: 'tab:cal' }, parseCsv(csv), meta as any);
    expect(r.tex).toContain('\\toprule');
    expect(r.tex).toContain('\\rowcolor{quireshade} \\textbf{7}');
    expect(r.tex).toContain('5.10\\%');
    expect(r.tex).toContain('0.009');
    expect(r.tex).toContain('run \\#3');
    expect(r.view.kind).toBe('table');
  });
});

describe('results', () => {
  it('normalizes lenient results and compares runs', () => {
    const a = normalizeResults({ suite: 's', tests: [{ id: 'x', status: 'FAIL', value: 0.4 }] });
    const b = normalizeResults({ suite: 's', tests: [{ id: 'x', status: 'pass', value: 0.5 }] });
    expect(a.tests[0].status).toBe('failed');
    expect(compareRuns(a, b).get('x')!.delta).toBeCloseTo(-0.1);
  });
  it('imports JUnit XML', () => {
    const r = parseJUnit('<testsuite name="pytest"><testcase classname="tests.test_cal" name="test_hl"/><testcase classname="tests.test_cal" name="test_j"><failure message="p=0.01"/></testcase><testcase classname="t" name="s"><skipped message="no data"/></testcase></testsuite>');
    expect(r.tests.map((t) => t.status)).toEqual(['passed', 'failed', 'skipped']);
    expect(r.suite).toBe('pytest');
  });
});

describe('theme', () => {
  it('replaces only the managed block and class options', () => {
    const pre = '\\usepackage{xcolor}\n% quire:theme begin\nold\n% quire:theme end\n\\newcommand{\\mine}{x}\n';
    const out = applyThemeToPreamble(pre, { ...DEFAULT_THEME, paper: 'a4' });
    expect(out).toContain('a4paper');
    expect(out).toContain('\\newcommand{\\mine}{x}');
    expect(out).not.toContain('\nold\n');
    expect(applyThemeToClass('\\documentclass[11pt,draft]{article}', { ...DEFAULT_THEME, fontSize: 12 })).toBe('\\documentclass[12pt,oneside,letterpaper,draft]{article}');
  });
});
