// Clipboard HTML (Excel, Google Sheets, Numbers, Word, web pages) → SpanGrid.
// Kept free of app state so it can be tested in a plain browser.
import { flatRows, guessHeaderRows, type GridCell, type SpanGrid } from '../../shared/latex/grid';

export const MAX_ROWS = 5000;
export const MAX_COLS = 200;

const cellText = (el: Element): string => {
  const c = el.cloneNode(true) as Element;
  c.querySelectorAll('br').forEach((b) => b.replaceWith('\n'));
  c.querySelectorAll('p, div, li').forEach((b) => b.append('\n'));
  // Excel marks hidden content with display:none
  c.querySelectorAll('[style*="display:none"], [style*="display: none"]').forEach((b) => b.remove());
  return (c.textContent ?? '').replace(/ /g, ' ').split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n');
};

/** The first <table> in clipboard HTML as a grid (null when there is none or it is too big). */
export function htmlTableToGrid(html: string): SpanGrid | null {
  if (!/<table[\s>]/i.test(html)) return null;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const table = doc.querySelector('table') as HTMLTableElement | null;
  if (!table) return null;
  // a web page or document with a table among other text pastes normally
  const len = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, '').length;
  doc.querySelectorAll('style, script, template, title, meta').forEach((e) => e.remove());
  if (len(table.textContent) < 0.9 * len(doc.body.textContent)) return null;
  const trs = Array.from(table.rows).filter((tr) => tr.closest('table') === table && (tr as HTMLElement).style.display !== 'none');
  if (!trs.length || trs.length > MAX_ROWS) return null;
  const rows: GridCell[][] = trs.map((tr) => Array.from(tr.cells).map((td) => ({
    text: cellText(td),
    colspan: Math.max(1, Math.min(MAX_COLS, Number(td.getAttribute('colspan')) || 1)),
    rowspan: Math.max(1, Number(td.getAttribute('rowspan')) || 1),
  })));
  // clamp rowspans to the table and drop rows that are fully covered from above
  rows.forEach((row, r) => row.forEach((c) => { c.rowspan = Math.min(c.rowspan, rows.length - r); }));
  let g: SpanGrid = { rows, headerRows: 0 };
  const flat = flatRows(g);
  const width = flat[0]?.length ?? 0;
  if (!width || width > MAX_COLS || (flat.length === 1 && width === 1)) return null;
  // drop trailing all-empty columns (Excel often includes one) by re-spanning from text
  const emptyCols = (() => { let k = width; while (k > 1 && flat.every((r) => !r[k - 1]?.trim())) k--; return width - k; })();
  if (emptyCols && rows.every((row) => row.every((c) => c.colspan === 1 && c.rowspan === 1))) {
    g = { rows: flat.map((r) => r.slice(0, width - emptyCols).map((text) => ({ text, colspan: 1, rowspan: 1 }))), headerRows: 0 };
  }
  // header rows: an explicit <thead> or <th> rows win; then leading rows with merged cells
  // (a group header) plus the row beneath; otherwise the plain-text guess
  const thead = table.tHead ? table.tHead.rows.length : 0;
  const thRows = (() => { let n = 0; for (const tr of trs) { if (tr.cells.length && Array.from(tr.cells).every((c) => c.tagName === 'TH')) n++; else break; } return n; })();
  let h = thead || thRows;
  if (!h) {
    let merged = 0;
    while (merged < g.rows.length - 1 && g.rows[merged].some((c) => c.colspan > 1)) merged++;
    h = merged ? Math.min(merged + 1, g.rows.length - 1) : guessHeaderRows(flatRows(g));
    // a group header is only a header if the row under it is text too
    if (merged && guessHeaderRows(flatRows(g).slice(merged)) === 0) h = guessHeaderRows(flatRows(g));
  }
  g.headerRows = Math.min(h, Math.max(0, g.rows.length - 1));
  return g;
}

