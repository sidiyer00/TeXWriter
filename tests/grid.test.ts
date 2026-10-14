import { describe, expect, it } from 'vitest';
import { gridFromText, gridToTableBlock, gridToTsv, gridToHtml, guessHeaderRows, looksTabular, tableNodeToExportGrid, textRows, isNumeric } from '../src/shared/latex/grid';
import { parseTableBlock, serializeTableBlock } from '../src/shared/latex/table';
import { detectDelimiter, parseRows } from '../src/shared/csv';
import { defaultFormat } from '../src/shared/latex/numfmt';

describe('delimited text', () => {
  it('detects delimiters', () => {
    expect(detectDelimiter('a\tb\n1\t2')).toBe('\t');
    expect(detectDelimiter('a;b;c\n1,5;2;3')).toBe(';');
    expect(detectDelimiter('a,b\n"x;y",2')).toBe(',');
  });
  it('keeps quotes inside fields that do not start with one', () => {
    expect(parseRows('a,5" pipe\n')).toEqual([['a', '5" pipe']]);
  });
  it('recognises spreadsheet pastes but not prose or indented code', () => {
    expect(looksTabular('Grade\tPD\nA\t0.1%\nB\t0.4%\n')).toBe(true);
    expect(looksTabular('x,y\n1,2\n3,4')).toBe(true);
    expect(looksTabular('Hello, world. This is a sentence.')).toBe(false);
    expect(looksTabular('First, we did this.\nThen, that and, also, more.')).toBe(false);
    expect(looksTabular('def f():\n\treturn 1\n\tpass')).toBe(false);
  });
  it('numbers', () => {
    for (const s of ['12', '-3.5', '1,234.50', '12.5%', '$1,200', '(45)', '1e-4', '−2.1']) expect(isNumeric(s)).toBe(true);
    for (const s of ['A', 'Grade 7', '', '2019--2025', 'n/a']) expect(isNumeric(s)).toBe(false);
  });
});

describe('header detection and merging', () => {
  it('single header row', () => {
    expect(guessHeaderRows(textRows('Grade\tN\nA\t10\nB\t20'))).toBe(1);
    expect(guessHeaderRows(textRows('1\t2\n3\t4'))).toBe(0);
  });
  it('Excel merged group header (label then blanks)', () => {
    const g = gridFromText('\tObserved\t\tResult\nGrade\tN\tDR\t\nA\t412\t0.1%\tPass\n');
    expect(g.headerRows).toBe(2);
    expect(g.rows[0].map((c) => [c.text, c.colspan, c.rowspan])).toEqual([['', 1, 1], ['Observed', 2, 1], ['Result', 1, 2]]);
    expect(g.rows[1].map((c) => c.text)).toEqual(['Grade', 'N', 'DR']);
  });
  it('pandas-style repeated labels and a stub column', () => {
    const g = gridFromText('Grade,Observed,Observed,Predicted\n,N,DR,PD\nA,1,2,3\n');
    expect(g.headerRows).toBe(2);
    expect(g.rows[0].map((c) => [c.text, c.colspan, c.rowspan])).toEqual([['Grade', 1, 2], ['Observed', 2, 1], ['Predicted', 1, 1]]);
  });
});

describe('grid → LaTeX', () => {
  const g = gridFromText('Segment\tDiscrimination\t\tCalibration\t\n\tAUC\tGini\tObs\tExp\nRetail\t0.81\t0.62\t1.2%\t1.1%\nSME & Corp\t0.77\t0.54\t2.0%\t2.2%\n');
  it('builds a multi-level booktabs table that parses back', () => {
    const node = gridToTableBlock(g, { style: 'booktabs', caption: 'Results.', label: 'tab:r' });
    const tex = serializeTableBlock(node);
    expect(tex).toContain('\\multicolumn{2}{c}{\\textbf{Discrimination}}');
    expect(tex).toContain('\\cmidrule(lr){2-3} \\cmidrule(lr){4-5}');
    expect(tex).toContain('\\multirow{2}{*}{\\textbf{Segment}}');
    expect(tex).toContain('SME \\& Corp');
    expect(tex).toContain('\\begin{tabular}{lrrrr}');
    const back = parseTableBlock(tex)!;
    expect(back).toBeTruthy();
    expect(serializeTableBlock(back)).toBe(tex);
  });
  it('every style serializes and keeps the header levels', () => {
    for (const style of ['booktabs', 'striped', 'lines', 'minimal', 'boxed', 'grid', 'plain'] as const) {
      const tex = serializeTableBlock(gridToTableBlock(g, { style }));
      expect(parseTableBlock(tex), style).toBeTruthy();
    }
    expect(serializeTableBlock(gridToTableBlock(g, { style: 'minimal' }))).toContain('\\cline{2-3} \\cline{4-5}');
    // grid/lines: no full \hline through the Segment cell merged over both header rows
    for (const style of ['grid', 'lines'] as const) {
      const tex = serializeTableBlock(gridToTableBlock(g, { style }));
      const lines = tex.split('\n');
      const i = lines.findIndex((l) => l.includes('{Segment}'));
      expect(lines[i + 1].trim(), style).toBe('\\cline{2-5}');
      expect(parseTableBlock(tex)!.attrs!.style).toBe(style);
      expect(serializeTableBlock(parseTableBlock(tex)!)).toBe(tex);
    }
  });
  it('applies a number format to numeric body cells', () => {
    const t = gridToTableBlock(gridFromText('a\tb\nx\t1234.5678\n'), { format: { ...defaultFormat('number'), digits: 1, thousands: true } });
    expect(serializeTableBlock(t)).toContain('\\qnum[num,d1,sep]{1234.5678}{1,234.6}');
  });
  it('round-trips to TSV and HTML for spreadsheets', () => {
    const node = gridToTableBlock(g);
    const out = tableNodeToExportGrid(node);
    const tsv = gridToTsv(out);
    expect(tsv.split('\n')[0]).toBe('Segment\tDiscrimination\t\tCalibration\t');
    expect(tsv).toContain('SME & Corp\t0.77');
    const html = gridToHtml(out);
    expect(html).toContain('<th colspan="2">Discrimination</th>');
    expect(html).toContain('<th rowspan="2">Segment</th>');
    expect(html).toContain('SME &amp; Corp');
  });
});
