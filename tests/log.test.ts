import { describe, expect, it } from 'vitest';
import { parseLatexLog, pagesFromLog, closest } from '../src/shared/latex/log';
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
Output written on .texwriter/build/report.pdf (38 pages, 412345 bytes).
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

describe('theme', () => {
  it('replaces only the managed block and class options', () => {
    const pre = '\\usepackage{xcolor}\n% texwriter:theme begin\nold\n% texwriter:theme end\n\\newcommand{\\mine}{x}\n';
    const out = applyThemeToPreamble(pre, { ...DEFAULT_THEME, paper: 'a4' });
    expect(out).toContain('a4paper');
    expect(out).toContain('\\newcommand{\\mine}{x}');
    expect(out).not.toContain('\nold\n');
    expect(applyThemeToClass('\\documentclass[11pt,draft]{article}', { ...DEFAULT_THEME, fontSize: 12 })).toBe('\\documentclass[12pt,oneside,letterpaper,draft]{article}');
  });
  it('upgrades a block written by Quire and leaves journal classes alone', () => {
    const pre = '\\usepackage{xcolor}\n% quire:theme begin\nold\n% quire:theme end\n\\fancyhead[L]{\\quireheadleft}\n';
    const out = applyThemeToPreamble(pre, DEFAULT_THEME);
    expect(out).toContain('% texwriter:theme begin');
    expect(out).not.toContain('quire:theme');
    expect(out).toContain('\\providecommand{\\quireheadleft}{\\texwriterheadleft}');
    expect(out).toContain('\\fancyhead[L]{\\quireheadleft}');
    const journal = { ...DEFAULT_THEME, classLayout: true };
    expect(applyThemeToClass('\\documentclass[conference]{IEEEtran}', journal)).toBe('\\documentclass[conference]{IEEEtran}');
    expect(applyThemeToPreamble(pre, journal)).not.toContain('geometry');
  });
});
