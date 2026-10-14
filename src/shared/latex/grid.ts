// Spreadsheet data <-> editable tables.
//
// A SpanGrid is a table as a spreadsheet sees it: rows of cells, each with a colspan and
// rowspan (only the top-left cell of a merged range is listed, as in HTML). It comes from
// pasted Excel/Sheets HTML, from tab/comma-separated text, or from a CSV file, and turns
// into a `tableBlock` node, so pasted data, CSV files and hand-made tables share one
// serializer and all its styles. Header rows with merged cells become multi-level headers.
import type { JNode } from './model';
import { detectDelimiter, parseRows, type Delimiter } from '../csv';
import { inlinePlain, cellNumber, type TableStyle } from './table';
import { encodeFormat, formatValue, parseNumberText, type NumFormat } from './numfmt';

export interface GridCell { text: string; colspan: number; rowspan: number }
export interface SpanGrid { rows: GridCell[][]; headerRows: number }

const NUM_RE = /^[(−-]?\s*[$€£¥]?\s*[-+−]?(\d{1,3}(,\d{3})+|\d+)?(\.\d+)?\s*%?\)?$|^[-+]?\d*\.?\d+e[-+]?\d+$/i;

/** Number-like cell text: 12, -3.5, 1,234.50, 12.5%, $1,200, (45), 1e-4. */
export function isNumeric(t: string): boolean {
  const s = t.trim();
  return s !== '' && /\d/.test(s) && NUM_RE.test(s);
}

const isBlank = (t: string) => t.trim() === '' || t.trim() === ' ';

// ------------------------------------------------------------------ text → grid

/** Rows of plain strings from tab/comma/semicolon text; pads ragged rows and trims empty edges. */
export function textRows(text: string, delim?: Delimiter): string[][] {
  const d = delim ?? detectDelimiter(text);
  const rows = parseRows(text, d).map((r) => r.map((c) => c.replace(/ /g, ' ').trim()));
  return squareUp(rows);
}

function squareUp(rows: string[][]): string[][] {
  const w = Math.max(0, ...rows.map((r) => r.length));
  const out = rows.map((r) => [...r, ...Array(w - r.length).fill('')]);
  // drop trailing columns that are empty in every row (Excel selections often include one)
  let keep = w;
  while (keep > 1 && out.every((r) => isBlank(r[keep - 1]))) keep--;
  return out.map((r) => r.slice(0, keep));
}

/**
 * Does pasted plain text look like a table? Tab-separated text (Excel, Sheets, Numbers) with
 * at least two cells counts. Comma/semicolon text must be at least 2×2 with the same number
 * of fields on every line, so a sentence with a comma is never taken for a table.
 */
export function looksTabular(text: string): boolean {
  const t = text.replace(/\r/g, '').replace(/\n+$/, '');
  if (!t.trim() || t.length > 2_000_000) return false;
  const lines = t.split('\n').filter((l) => l.trim());
  if (t.includes('\t')) {
    // tab-indented code has one value per line; spreadsheet rows mostly have several
    const rows = textRows(t, '\t');
    const multi = rows.filter((r) => r.filter((c) => !isBlank(c)).length >= 2).length;
    return rows[0].length >= 2 && multi >= Math.max(1, Math.ceil(rows.length / 2));
  }
  if (lines.length < 2) return false;
  const d = detectDelimiter(t);
  const rows = parseRows(t, d);
  if (rows.length < 2) return false;
  const w = rows[0].length;
  if (w < 2 || !rows.every((r) => r.length === w)) return false;
  // prose guard: table cells are short
  return rows.every((r) => r.every((c) => c.length <= 200));
}

/**
 * How many leading rows are headers. The first row is a header when it is all text and the
 * rows below are not; further rows join it while the row above has gaps or repeated labels
 * (a spanning group label, as Excel and pandas write multi-level headers).
 */
export function guessHeaderRows(rows: string[][]): number {
  if (rows.length < 2) return 0;
  const texty = (r: string[]) => r.some((c) => !isBlank(c)) && r.every((c) => isBlank(c) || !isNumeric(c));
  if (!texty(rows[0])) return 0;
  const grouped = (r: string[]) => r.some((c, j) => j > 0 && ((isBlank(c) && !isBlank(r[j - 1])) || (!isBlank(c) && c === r[j - 1])))
    || (isBlank(r[0]) && r.some((c) => !isBlank(c)));
  let h = 1;
  while (h < Math.min(4, rows.length - 1) && texty(rows[h]) && grouped(rows[h - 1])) h++;
  // an all-text table: just the first row
  if (h >= rows.length) h = 1;
  return h;
}

/**
 * Merge header cells: in every header row but the last, a label followed by blank cells or
 * by copies of itself spans those columns; a header label with only blanks beneath it spans
 * down to the last header row. Body cells are never merged.
 */
export function spanRows(rows: string[][], headerRows: number): SpanGrid {
  const h = Math.max(0, Math.min(headerRows, rows.length));
  const w = rows[0]?.length ?? 0;
  const taken: boolean[][] = rows.map(() => Array(w).fill(false));
  const out: GridCell[][] = rows.map(() => []);
  for (let r = 0; r < rows.length; r++) {
    for (let c = 0; c < w; c++) {
      if (taken[r][c]) continue;
      const text = rows[r][c] ?? '';
      let cs = 1;
      let rs = 1;
      if (r < h && !isBlank(text)) {
        if (r < h - 1) {
          while (c + cs < w && !taken[r][c + cs] && (isBlank(rows[r][c + cs]) || rows[r][c + cs] === text)
            // a blank only joins the span when the column below has its own label
            && (rows[r][c + cs] === text || !isBlank(rows[r + 1]?.[c + cs] ?? ''))) cs++;
        }
        if (cs === 1) {
          while (r + rs < h && isBlank(rows[r + rs][c]) && !taken[r + rs][c]) rs++;
        }
      }
      for (let dr = 0; dr < rs; dr++) for (let dc = 0; dc < cs; dc++) taken[r + dr][c + dc] = true;
      out[r].push({ text, colspan: cs, rowspan: rs });
    }
  }
  return { rows: out, headerRows: h };
}

/** Delimited text → grid with detected header rows and merged header cells. */
export function gridFromText(text: string, opts: { delim?: Delimiter; headerRows?: number } = {}): SpanGrid {
  const rows = textRows(text, opts.delim);
  return spanRows(rows, opts.headerRows ?? guessHeaderRows(rows));
}

/** Expand merged cells back into a rectangular array of strings ('' under a merge). */
export function flatRows(g: SpanGrid): string[][] {
  const out: string[][] = [];
  g.rows.forEach((row, r) => {
    out[r] ??= [];
    let c = 0;
    for (const cell of row) {
      while (out[r][c] !== undefined) c++;
      for (let dr = 0; dr < cell.rowspan; dr++) {
        out[r + dr] ??= [];
        for (let dc = 0; dc < cell.colspan; dc++) out[r + dr][c + dc] = dr === 0 && dc === 0 ? cell.text : '';
      }
      c += cell.colspan;
    }
  });
  const w = Math.max(0, ...out.map((r) => r.length));
  return out.map((r) => Array.from({ length: w }, (_, i) => r[i] ?? ''));
}

/** Keep and reorder columns of a rectangular grid by index. */
export function pickColumns(rows: string[][], idx: number[]): string[][] {
  return rows.map((r) => idx.map((i) => r[i] ?? ''));
}

// ------------------------------------------------------------------ grid → table node

export interface GridTableOptions {
  style?: TableStyle;
  caption?: string;
  label?: string;
  placement?: string;
  size?: string;
  headerFill?: string;
  /** apply this number format to numeric body cells (the full value is kept) */
  format?: NumFormat | null;
  /** caption text is LaTeX (true) or plain text to escape (false) */
  captionIsLatex?: boolean;
}

/** Column spec: right-align columns whose body cells are all numbers, left otherwise. */
export function columnAlign(g: SpanGrid): string[] {
  const flat = flatRows(g);
  const w = flat[0]?.length ?? 0;
  const body = flat.slice(g.headerRows);
  return Array.from({ length: w }, (_, c) => {
    const vals = body.map((r) => r[c]).filter((v) => !isBlank(v));
    return vals.length && vals.every(isNumeric) ? 'r' : 'l';
  });
}

export function gridToTableBlock(g: SpanGrid, o: GridTableOptions = {}): JNode {
  const cols = columnAlign(g);
  const rows: JNode[] = g.rows.map((row, r) => ({
    type: 'tableRow',
    content: row.map((cell) => {
      const head = r < g.headerRows;
      const attrs: Record<string, unknown> = { colspan: cell.colspan, rowspan: cell.rowspan, background: null, align: null };
      let content: JNode[] = cell.text ? [{ type: 'text', text: cell.text }] : [];
      if (!head && o.format && isNumeric(cell.text)) {
        const v = parseNumberText(cell.text);
        const shown = v != null ? formatValue(v, o.format) : null;
        if (v != null && shown) {
          attrs.format = encodeFormat(o.format);
          attrs.value = v;
          content = [{ type: 'text', text: shown.text }];
        }
      }
      // merged header cells over several columns read best centred
      if (head && cell.colspan > 1) attrs.align = 'c';
      return { type: head ? 'tableHeader' : 'tableCell', attrs, content: [content.length ? { type: 'paragraph', content } : { type: 'paragraph' }] };
    }),
  }));
  const caption = o.caption ?? '';
  return {
    type: 'tableBlock',
    attrs: {
      caption, label: o.label ?? '', placement: o.placement ?? 'htbp', env: 'table', style: o.style ?? 'booktabs',
      cols: cols.join(' '), captionPos: 'top', size: o.size ?? '', headerFill: o.headerFill ?? '', stretch: '',
    },
    content: [{ type: 'table', content: rows }],
  };
}

// ------------------------------------------------------------------ table node → spreadsheet

/** The grid behind a `table` (or `tableBlock`) node, with each cell's visible text. */
export function tableNodeToGrid(node: JNode): SpanGrid {
  const table = node.type === 'tableBlock' ? (node.content ?? []).find((n) => n.type === 'table') : node;
  const rows = (table?.content ?? []).filter((r) => r.type === 'tableRow');
  let headerRows = 0;
  for (const r of rows) { if ((r.content ?? []).length && (r.content ?? []).every((c) => c.type === 'tableHeader')) headerRows++; else break; }
  return {
    headerRows,
    rows: rows.map((r) => (r.content ?? []).map((c) => ({
      text: (c.content ?? []).map((p) => inlinePlain(p.content).replace(/\u0000/g, '')).filter(Boolean).join('\n'),
      colspan: Math.max(1, Number(c.attrs?.colspan ?? 1)),
      rowspan: Math.max(1, Number(c.attrs?.rowspan ?? 1)),
    }))),
  };
}

/** Value Excel should receive for a cell: the full-precision number for formatted cells. */
export function cellExportText(c: JNode): string {
  const n = c.type === 'tableCell' ? cellNumber(c.attrs, c.content?.[0]?.content) : null;
  if (n) {
    // keep what the reader sees for currency/percent so Excel recognises the type
    const f = formatValue(n.value, n.format);
    return f ? f.text.replace(/−/g, '-') : n.value;
  }
  return (c.content ?? []).map((p) => inlinePlain(p.content).replace(/\u0000/g, '')).filter(Boolean).join('\n');
}

const tsvField = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

/** Tab-separated text, the format every spreadsheet reads from the clipboard. */
export function gridToTsv(g: SpanGrid): string {
  return flatRows(g).map((r) => r.map(tsvField).join('\t')).join('\n') + '\n';
}

const htmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** An HTML table with merges intact: Excel, Word and Sheets keep the merged header cells. */
export function gridToHtml(g: SpanGrid): string {
  const tr = (row: GridCell[], head: boolean) => `<tr>${row.map((c) => {
    const tag = head ? 'th' : 'td';
    const span = `${c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}`;
    const num = !head && isNumeric(c.text) ? ' style="mso-number-format:General;text-align:right"' : '';
    return `<${tag}${span}${num}>${htmlEsc(c.text).replace(/\n/g, '<br style="mso-data-placement:same-cell">')}</${tag}>`;
  }).join('')}</tr>`;
  const head = g.rows.slice(0, g.headerRows).map((r) => tr(r, true)).join('');
  const body = g.rows.slice(g.headerRows).map((r) => tr(r, false)).join('');
  return `<table>${head ? `<thead>${head}</thead>` : ''}<tbody>${body}</tbody></table>`;
}

/** Grid of export texts for a table node (formatted numbers as displayed). */
export function tableNodeToExportGrid(node: JNode): SpanGrid {
  const g = tableNodeToGrid(node);
  const table = node.type === 'tableBlock' ? (node.content ?? []).find((n) => n.type === 'table') : node;
  const rows = (table?.content ?? []).filter((r) => r.type === 'tableRow');
  g.rows.forEach((row, r) => row.forEach((cell, c) => { cell.text = cellExportText(rows[r].content![c]); }));
  return g;
}
