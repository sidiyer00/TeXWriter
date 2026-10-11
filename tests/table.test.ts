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
  it('grid and new tables', () => {
    const g = parseTableBlock('\\begin{tabular}{|l|c|}\n\\hline\na & b \\\\\n\\hline\n\\end{tabular}')!;
    expect(g.attrs!.style).toBe('grid');
    expect(serializeTableBlock(g)).toContain('{|l|c|}');
    const t = newTable(3, 4, 'striped', 'tab:new');
    const s = serializeTableBlock(t);
    expect(s).toContain('\\rowcolors{2}{black!4}{}');
    expect(parseTableBlock(s)!.attrs!.style).toBe('striped');
  });
  it('falls back to raw for unsupported tables', () => {
    expect(parseTableBlock('\\begin{table}\\begin{tabular}{@{}l@{}}a\\end{tabular}\\end{table}')).toBeNull();
    const doc = parseDocument(`\\documentclass{article}\n\\begin{document}\n${T1}\n\n\\begin{table}\\begin{tabular}{S}1\\end{tabular}\\end{table}\n\\end{document}\n`);
    expect(doc.blocks.map((b) => b.node.type)).toEqual(['tableBlock', 'rawBlock']);
    const tex = serializeDocument(doc.prefix, toDocJson(doc), doc.suffix, doc.leading).tex;
    expect(tex).toContain(T1);
  });
});
