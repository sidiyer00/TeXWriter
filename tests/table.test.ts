import { describe, expect, it } from 'vitest';
import { parseTableBlock, serializeTableBlock, newTable } from '../src/shared/latex/table';
import { parseDocument, toDocJson, serializeDocument } from '../src/shared/latex/blocks';

const T1 = String.raw`\begin{table}[htbp]
  \centering
  \caption{Calibration by grade.}
  \label{tab:cal}
  \begin{tabular}{lrrr}
    \toprule
    & \multicolumn{2}{c}{\textbf{Observed}} & \\
    \cmidrule(lr){2-3}
    \textbf{Grade} & \textbf{N} & \textbf{DR} & \textbf{Result} \\
    \midrule
    \multirow{2}{*}{IG} & 412 & 0.0\% & Pass \\
     & 688 & \cellcolor[HTML]{F3ECE6}0.15\% & Pass \\
    \rowcolor{yellow} 7 & 455 & 7.69\% & \textcolor[HTML]{9C2E1A}{Fail} \\
    \bottomrule
  \end{tabular}
\end{table}`;

describe('tables', () => {
  const n = parseTableBlock(T1)!;
  it('parses merged cells, headers, colours', () => {
    expect(n).toBeTruthy();
    expect(n.attrs).toMatchObject({ caption: 'Calibration by grade.', label: 'tab:cal', style: 'booktabs', cols: 'l r r r' });
    const rows = n.content![0].content!;
    expect(rows.length).toBe(5);
    expect(rows[0].content![1]).toMatchObject({ type: 'tableHeader', attrs: { colspan: 2 } });
    expect(rows[2].content![0]).toMatchObject({ type: 'tableCell', attrs: { rowspan: 2 } });
    expect(rows[3].content!.length).toBe(3); // first column covered by multirow
    expect(rows[3].content![1].attrs!.background).toBe('F3ECE6');
    expect(rows[4].content![0].attrs!.background).toBe('yellow');
  });
  it('serializes back to equivalent LaTeX and is stable', () => {
    const out = serializeTableBlock(n);
    expect(out).toContain('\\multicolumn{2}{c}{\\textbf{Observed}}');
    expect(out).toContain('\\cmidrule(lr){2-3}');
    expect(out).toContain('\\multirow{2}{*}{IG}');
    expect(out).toContain('\\cellcolor[HTML]{F3ECE6}0.15\\%');
    const again = serializeTableBlock(parseTableBlock(out)!);
    expect(again).toBe(out);
  });
  it('cell fills on header, body and whole rows survive a round trip', () => {
    const t = newTable(3, 3, 'booktabs', 'tab:fill');
    const rows = t.content![0].content!;
    rows[0].content![1].attrs!.background = 'BCD1F2'; // header cell
    for (const c of rows[1].content!) c.attrs!.background = 'FFE98A'; // whole row
    rows[2].content![2].attrs!.background = 'E3F2E6';
    const out = serializeTableBlock(t);
    expect(out).toContain('\\cellcolor[HTML]{BCD1F2}\\textbf{');
    expect(out.match(/\\cellcolor\[HTML\]\{FFE98A\}/g)!.length).toBe(3);
    const back = parseTableBlock(out)!.content![0].content!;
    expect(back[0].content![1].attrs!.background).toBe('BCD1F2');
    expect(back[1].content!.map((c) => c.attrs!.background)).toEqual(['FFE98A', 'FFE98A', 'FFE98A']);
    expect(back[2].content![2].attrs!.background).toBe('E3F2E6');
    expect(serializeTableBlock(parseTableBlock(out)!)).toBe(out);
  });
  it('grid and new tables', () => {
    const g = parseTableBlock('\\begin{tabular}{|l|c|}\n\\hline\na & b \\\\\n\\hline\n\\end{tabular}')!;
    expect(g.attrs!.style).toBe('grid');
    expect(serializeTableBlock(g)).toContain('{|l|c|}');
    const t = newTable(3, 4, 'striped', 'tab:new');
    const s = serializeTableBlock(t);
    expect(s).toContain('\\rowcolors{2}{black!4}{}');
    expect(parseTableBlock(s)!.attrs!.style).toBe('striped');
  });
  it('number-formatted cells keep full precision through round trips', () => {
    const src = String.raw`\begin{tabular}{lr}
    \textbf{Grade} & \textbf{PD} \\
    \hline
    A & \qnum[pct,d2]{0.0012345}{0.12\%} \\
    B & \qnum[cur,d0,sep,neg=parens]{-1234.5}{(\$1,235)} \\
    C & \qnum[sci,d1]{0.000123}{\ensuremath{1.2\times10^{-4}}} \\
\end{tabular}`;
    const t = parseTableBlock(src)!;
    expect(t).toBeTruthy();
    const body = t.content![0].content!;
    const a = body[1].content![1];
    expect(a.attrs).toMatchObject({ format: 'pct,d2', value: '0.0012345' });
    expect(a.content![0].content).toEqual([{ type: 'text', text: '0.12%' }]);
    expect(body[2].content![1].content![0].content![0].text).toBe('($1,235)');
    const out = serializeTableBlock(t);
    expect(out).toContain(String.raw`\qnum[pct,d2]{0.0012345}{0.12\%}`);
    expect(out).toContain(String.raw`\qnum[cur,d0,sep,neg=parens]{-1234.5}{(\$1,235)}`);
    expect(serializeTableBlock(parseTableBlock(out)!)).toBe(out);
    // more decimals later: the stored value supplies them
    a.attrs!.format = 'pct,d4';
    a.content![0].content = [{ type: 'text', text: '0.1235%' }];
    expect(serializeTableBlock(t)).toContain(String.raw`\qnum[pct,d4]{0.0012345}{0.1235\%}`);
    // a typed number replaces the value; text in a number cell stays text
    a.content![0].content = [{ type: 'text', text: '7.5' }];
    expect(serializeTableBlock(t)).toContain(String.raw`\qnum[pct,d4]{0.075}{7.5000\%}`);
    a.content![0].content = [{ type: 'text', text: 'n/a' }];
    expect(serializeTableBlock(t)).toMatch(/A & n\/a \\\\/);
  });
  it('hand-edited shown text in the source wins', () => {
    const t = parseTableBlock('\\begin{tabular}{r}\n\\qnum[num,d1]{2.25}{9.9} \\\\\n\\end{tabular}')!;
    const cell = t.content![0].content![0].content![0];
    expect(cell.content![0].content).toEqual([{ type: 'text', text: '9.9' }]);
    expect(serializeTableBlock(t)).toContain('\\qnum[num,d1]{9.9}{9.9}');
  });
  it('styles, header shading and row spacing round-trip', () => {
    for (const style of ['booktabs', 'striped', 'lines', 'minimal', 'boxed', 'grid', 'plain'] as const) {
      const t = newTable(3, 3, style, 'tab:x');
      t.attrs = { ...t.attrs, headerFill: 'E5ECF8', stretch: '1.3', size: 'footnotesize' };
      const s = serializeTableBlock(t);
      const back = parseTableBlock(s)!;
      expect(back.attrs, style).toMatchObject({ style, headerFill: 'E5ECF8', stretch: '1.3', size: 'footnotesize' });
      expect(serializeTableBlock(back), style).toBe(s);
    }
    const boxed = serializeTableBlock(newTable(2, 3, 'boxed', 'tab:b'));
    expect(boxed).toContain('\\begin{tabular}{|lrr|}');
    expect(boxed).not.toContain('\\rowcolor'); // no fill requested → none emitted
  });
  it('falls back to raw for unsupported tables', () => {
    expect(parseTableBlock('\\begin{table}\\begin{tabular}{@{}l@{}}a\\end{tabular}\\end{table}')).toBeNull();
    const doc = parseDocument(`\\documentclass{article}\n\\begin{document}\n${T1}\n\n\\begin{table}\\begin{tabular}{S}1\\end{tabular}\\end{table}\n\\end{document}\n`);
    expect(doc.blocks.map((b) => b.node.type)).toEqual(['tableBlock', 'rawBlock']);
    const tex = serializeDocument(doc.prefix, toDocJson(doc), doc.suffix, doc.leading).tex;
    expect(tex).toContain(T1);
  });
});
