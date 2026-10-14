// Spreadsheets ⇄ tables through the clipboard.
//
// Paste: a range copied from Excel, Google Sheets or Numbers (HTML table and/or
// tab-separated text), or plain comma/semicolon CSV text, becomes an editable table.
// Merged header cells are kept, so a multi-level header pastes as one. Inside an existing
// table, tab-separated text fills cells from the cursor like a spreadsheet paste.
// Ctrl+Shift+V always pastes plain text.
//
// Copy: copying cells or a whole table puts tab-separated text on the clipboard next to
// the HTML, so Excel receives one value per cell. "Copy table for Excel" writes a clean
// HTML table (merges intact) plus TSV.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, NodeSelection, type EditorState } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { handlePaste as tablesHandlePaste } from '@tiptap/pm/tables';
import type { Editor } from '@tiptap/react';
import { undo } from '@tiptap/pm/history';
import { flatRows, gridFromText, gridToHtml, gridToTableBlock, gridToTsv, looksTabular, tableNodeToExportGrid, type SpanGrid } from '../../shared/latex/grid';
import { htmlTableToGrid, MAX_COLS, MAX_ROWS } from './htmlTable';

export { htmlTableToGrid };
import { TABLE_STYLES, type TableStyle } from '../../shared/latex/table';
import type { JNode } from '../../shared/latex/model';
import { toast } from '../store';

/** set by "Paste as text" so the replayed paste is not turned into a table again */
let plainNext = false;

// ------------------------------------------------------------------ preferred style

const STYLE_KEY = 'texwriter.pasteTableStyle';

/** Style for pasted and converted tables: the one last picked from the table toolbar. */
export function preferredTableStyle(): TableStyle {
  try {
    const s = localStorage.getItem(STYLE_KEY) as TableStyle | null;
    if (s && TABLE_STYLES.some((t) => t.id === s)) return s;
  } catch { /* storage unavailable */ }
  return 'booktabs';
}

export function rememberTableStyle(s: string) {
  try { localStorage.setItem(STYLE_KEY, s); } catch { /* storage unavailable */ }
}

/** Plain text → grid, or null when it doesn't look like table data. */
export function textToGrid(text: string): SpanGrid | null {
  if (!looksTabular(text)) return null;
  const g = gridFromText(text);
  const w = flatRows(g)[0]?.length ?? 0;
  if (!g.rows.length || g.rows.length > MAX_ROWS || w > MAX_COLS) return null;
  return g;
}

// ------------------------------------------------------------------ insert

/** Insert a block node like Insert → Table does: replace an empty paragraph, else go after the current block. */
function insertBlockNode(view: EditorView, json: JNode): number {
  const { state } = view;
  const node = state.schema.nodeFromJSON(json);
  const { $from } = state.selection;
  let tr = state.tr;
  let pos: number;
  if (state.selection instanceof NodeSelection && $from.depth === 0) {
    pos = state.selection.to;
    tr = tr.insert(pos, node);
  } else if ($from.depth >= 1) {
    const top = $from.node(1);
    const start = $from.before(1);
    if (top.type.name === 'paragraph' && top.content.size === 0) {
      tr = tr.replaceWith(start, start + top.nodeSize, node);
      pos = start;
    } else {
      pos = $from.parentOffset === 0 && $from.depth === 1 ? start : $from.after(1);
      tr = tr.insert(pos, node);
    }
  } else {
    pos = state.selection.from;
    tr = tr.insert(pos, node);
  }
  // caret in the first cell, so the table toolbar (with its style menu) appears
  try { tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1))); } catch { /* keep */ }
  view.dispatch(tr.scrollIntoView());
  return pos;
}

function inTable(state: EditorState): boolean {
  const { $from } = state.selection;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'table') return true;
  return false;
}

/** Paste a grid as a new table block. */
export function pasteGrid(view: EditorView, g: SpanGrid, text: string) {
  const style = preferredTableStyle();
  const json = gridToTableBlock(g, { style });
  insertBlockNode(view, json);
  const w = flatRows(g)[0]?.length ?? 0;
  const label = TABLE_STYLES.find((t) => t.id === style)?.label ?? style;
  toast(`Pasted a ${g.rows.length} × ${w} table${g.headerRows > 1 ? ` with ${g.headerRows} header rows` : ''} (${label}). Pick another style from the Table toolbar.`, 'ok', {
    label: 'Paste as text',
    run: () => {
      view.focus();
      // undo the table, then paste the original text
      undo(view.state, view.dispatch);
      plainNext = true;
      view.pasteText(text);
    },
  });
}

// ------------------------------------------------------------------ copy

/** Plain text for a copied slice: a lone table (or cell selection) becomes tab-separated text. */
function sliceText(slice: Slice): string {
  const c = slice.content;
  let table: PMNode | null = null;
  if (c.childCount === 1) {
    const only = c.firstChild!;
    if (only.type.name === 'table') table = only;
    else if (only.type.name === 'tableBlock') table = only.firstChild;
  }
  // a cell selection copies bare rows
  let rows = false;
  if (!table && c.childCount > 0) { rows = true; c.forEach((n) => { if (n.type.name !== 'tableRow') rows = false; }); }
  if (rows) table = c.firstChild!.type.schema.nodes.table.create(null, c);
  if (!table) return c.textBetween(0, c.size, '\n\n');
  return gridToTsv(tableNodeToExportGrid(table.toJSON() as JNode));
}

/** Copy the table around the cursor as HTML + TSV (Excel keeps merged header cells). */
export async function copyTableForSpreadsheet(ed: Editor): Promise<boolean> {
  const { $from } = ed.state.selection;
  let node: PMNode | null = null;
  for (let d = $from.depth; d > 0; d--) if ($from.node(d).type.name === 'tableBlock') { node = $from.node(d); break; }
  if (!node && ed.state.selection instanceof NodeSelection && ed.state.selection.node.type.name === 'tableBlock') node = ed.state.selection.node;
  if (!node) return false;
  const g = tableNodeToExportGrid(node.toJSON() as JNode);
  const html = `<html><head><meta charset="utf-8"></head><body>${gridToHtml(g)}</body></html>`;
  const tsv = gridToTsv(g);
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([tsv], { type: 'text/plain' }) })]);
  } catch {
    await navigator.clipboard.writeText(tsv);
  }
  return true;
}

// ------------------------------------------------------------------ plugin

/**
 * A click followed at once by Ctrl+V can deliver the paste before ProseMirror has read the
 * caret's new position; let it process pending DOM selection changes first (a no-op when
 * there are none).
 */
function syncSelectionFromDom(view: EditorView) {
  (view as unknown as { domObserver?: { flush?: () => void } }).domObserver?.flush?.();
}

const key = new PluginKey('texwriterSpreadsheetClipboard');

export const spreadsheetClipboardPlugin = () => {
  let plainUntil = 0;
  return new Plugin({
    key,
    props: {
      handleKeyDown(_view, e) {
        if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v') plainUntil = Date.now() + 1000;
        return false;
      },
      handlePaste(view, event) {
        if (plainNext || Date.now() < plainUntil) { plainUntil = 0; plainNext = false; return false; }
        const cd = event.clipboardData;
        if (!cd) return false;
        syncSelectionFromDom(view);
        const html = cd.getData('text/html');
        const text = cd.getData('text/plain');
        // our own copies paste back exactly as they were
        if (/data-pm-slice/.test(html)) return false;
        if (inTable(view.state)) {
          // let the table plugin fit the cells from the cursor, as a spreadsheet paste does
          if (/<table[\s>]/i.test(html) || !text.includes('\t') || !looksTabular(text)) return false;
          const g = textToGrid(text);
          if (!g) return false;
          const { schema } = view.state;
          const rows = flatRows(g).map((r) => schema.nodes.tableRow.create(null, r.map((t) => schema.nodes.tableCell.create(null, schema.nodes.paragraph.create(null, t ? schema.text(t) : null)))));
          const slice = new Slice(Fragment.from(schema.nodes.table.create(null, rows)), 0, 0);
          return tablesHandlePaste(view, event, slice);
        }
        const g = (html && htmlTableToGrid(html)) || (!/<table[\s>]/i.test(html) ? textToGrid(text) : null);
        if (!g) return false;
        event.preventDefault();
        pasteGrid(view, g, text);
        return true;
      },
      clipboardTextSerializer: (slice) => sliceText(slice),
    },
  });
};


/**
 * Registered ahead of TipTap's core extensions (which define their own clipboard text
 * serializer) so copied tables reach Excel as tab-separated cells.
 */
export const SpreadsheetClipboard = Extension.create({
  name: 'spreadsheetClipboard',
  priority: 1000,
  addProseMirrorPlugins() { return [spreadsheetClipboardPlugin()]; },
});
