// Editable tables: TipTap's table schema wrapped in a `tableBlock` that carries the
// LaTeX-level settings (caption, label, style, column alignment, spacing, header shading).
// Body cells can carry an Excel-style number format (see shared/latex/numfmt.ts).
import { Extension, Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps, type Editor } from '@tiptap/react';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { CellSelection, selectedRect } from '@tiptap/pm/tables';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import type { Node as PMNode, ResolvedPos } from '@tiptap/pm/model';
import { useId, useState } from 'react';
import { cssColor } from './marks';
import { RichInline } from './nodes';
import { cellNumber, inlinePlain, numberNodes } from '../../shared/latex/table';
import { decodeFormat, encodeFormat, parseNumberText, type NumFormat } from '../../shared/latex/numfmt';
import type { JNode } from '../../shared/latex/model';
import { rememberTableStyle } from './clipboard';

const cellAttrs = {
  background: {
    default: null,
    parseHTML: (el: HTMLElement) => el.dataset.bg ?? null,
    renderHTML: (a: Record<string, any>) => (a.background ? { 'data-bg': a.background, style: `background:${cssColor(a.background)}` } : {}),
  },
  align: {
    default: null,
    parseHTML: (el: HTMLElement) => el.dataset.align ?? null,
    renderHTML: (a: Record<string, any>) => (a.align ? { 'data-align': a.align, style: `text-align:${({ l: 'left', c: 'center', r: 'right' } as Record<string, string>)[a.align] ?? 'left'}` } : {}),
  },
  /** number format (numfmt encoding), e.g. "num,d2,sep" */
  format: {
    default: null,
    parseHTML: (el: HTMLElement) => el.dataset.fmt ?? null,
    renderHTML: (a: Record<string, any>) => (a.format ? { 'data-fmt': a.format } : {}),
  },
  /** full-precision value behind a formatted number */
  value: {
    default: null,
    parseHTML: (el: HTMLElement) => el.dataset.value ?? null,
    renderHTML: (a: Record<string, any>) => (a.value != null ? { 'data-value': a.value } : {}),
  },
};

export const QTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
export const QTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
/** Tables only live inside a tableBlock (pasted tables get wrapped automatically). */
export const QTable = Table.extend({ group: 'qtable' }).configure({ resizable: false, allowTableNodeSelection: true });
export const QTableRow = TableRow;

const WRAP_RE = /^p\{([^}]*)\}$/;

function TableBlockView(props: ReactNodeViewProps) {
  const a = props.node.attrs;
  const [editing, setEditing] = useState(false);
  const ds = (props.decorations ?? []) as unknown as { spec?: { num?: string } }[];
  const num = ds.find((d) => d.spec?.num)?.spec?.num;
  const cols: string[] = String(a.cols || '').split(/\s+/).filter(Boolean);
  const caption = a.env === 'none' ? null : (
    <div className="tcap" contentEditable={false}>
      <b>Table {num ?? ''}</b>
      {editing
        ? <input className="tcap-input" autoFocus aria-label="Table caption (LaTeX)" value={a.caption} onChange={(e) => props.updateAttributes({ caption: e.target.value })} onBlur={() => setEditing(false)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); setEditing(false); } }} />
        : <span className="tcap-text" role="button" tabIndex={0} title="Click to edit the caption" onClick={() => setEditing(true)} onKeyDown={(e) => { if (e.key === 'Enter') setEditing(true); }}>{a.caption ? <RichInline latex={a.caption} /> : <i className="muted">Add a caption…</i>}</span>}
    </div>
  );
  // column alignment and fixed widths from the LaTeX column spec (cells can still override alignment)
  const id = `tb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const css = cols.map((c, i) => {
    const sel = `#${id} tr > *:nth-child(${i + 1})`;
    if (/^[cr]$/.test(c)) return `${sel}{text-align:${c === 'c' ? 'center' : 'right'}}`;
    const w = WRAP_RE.exec(c);
    return w && /^\d*\.?\d+(cm|mm|in|pt|em)$/.test(w[1].trim()) ? `${sel}{width:${w[1].trim()};min-width:${w[1].trim()}}` : '';
  }).join('');
  const fill = String(a.headerFill || '');
  const style: Record<string, string> = {};
  if (fill) style['--thfill'] = cssColor(fill);
  if (a.stretch) style['--tstretch'] = String(a.stretch);
  return (
    <NodeViewWrapper className={`tblock tstyle-${a.style} ${a.size ? `tsize-${a.size}` : ''} ${fill ? 'thfill' : ''}`} data-cols={cols.join(' ')} id={id} style={style}>
      {css && <style>{css}</style>}
      {a.captionPos !== 'bottom' && caption}
      <div className="tscroll"><NodeViewContent /></div>
      {a.captionPos === 'bottom' && caption}
    </NodeViewWrapper>
  );
}

export const TableBlock = Node.create({
  name: 'tableBlock',
  group: 'block',
  content: 'table',
  isolating: true,
  defining: true,
  addAttributes() {
    const r = (d: unknown) => ({ default: d, rendered: false });
    return { caption: r(''), label: r(''), placement: r('htbp'), env: r('table'), style: r('booktabs'), cols: r(''), captionPos: r('top'), size: r(''), headerFill: r(''), stretch: r(''), breakable: r(null) };
  },
  parseHTML() { return [{ tag: 'div[data-qtype="tableBlock"]', getAttrs: (el) => { try { return JSON.parse((el as HTMLElement).dataset.qattrs ?? '{}'); } catch { return {}; } } }]; },
  renderHTML({ node }) {
    const a: Record<string, unknown> = { ...node.attrs };
    delete a.src; delete a.sig; delete a.gap;
    return ['div', { 'data-qtype': 'tableBlock', 'data-qattrs': JSON.stringify(a) }, 0];
  },
  addNodeView() { return ReactNodeViewRenderer(TableBlockView); },
  addProseMirrorPlugins() { return [numberCellPlugin]; },
});

// ----------------------------------------------------------------------------- number cells

/** The table cell (body or header) around a position. */
export function cellAround($pos: ResolvedPos): { pos: number; node: PMNode } | null {
  for (let d = $pos.depth; d > 0; d--) {
    const n = $pos.node(d);
    if (n.type.name === 'tableCell' || n.type.name === 'tableHeader') return { pos: $pos.before(d), node: n };
  }
  return null;
}

const cellInline = (node: PMNode): JNode[] => ((node.toJSON() as JNode).content?.[0]?.content ?? []);

/** Replace a cell's attributes and its single paragraph's inline content. */
function rewriteCell(tr: Transaction, pos: number, attrs: Record<string, unknown>, content: JNode[] | null) {
  const node = tr.doc.nodeAt(pos);
  if (!node) return;
  tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
  if (content) {
    const para = tr.doc.type.schema.nodeFromJSON({ type: 'paragraph', ...(content.length ? { content } : {}) });
    const cur = tr.doc.nodeAt(pos)!;
    tr.replaceWith(pos + 1, pos + cur.nodeSize - 1, para);
  }
}

/**
 * When the cursor leaves a number-formatted cell, show what was typed in the cell's format
 * (Excel's behaviour on Enter): "1234.5" becomes "$1,234.50". Text stays as typed.
 */
const numberCellKey = new PluginKey('texwriterNumberCells');
const numberCellPlugin = new Plugin({
  key: numberCellKey,
  appendTransaction(trs, oldState, newState) {
    if (!trs.some((t) => t.selectionSet || t.docChanged) || trs.some((t) => t.getMeta(numberCellKey))) return null;
    const before = cellAround(oldState.selection.$head);
    if (!before || before.node.type.name !== 'tableCell' || !before.node.attrs.format) return null;
    let pos = before.pos;
    for (const t of trs) {
      const m = t.mapping.mapResult(pos, 1);
      if (m.deleted) return null;
      pos = m.pos;
    }
    const now = cellAround(newState.selection.$head);
    if (now && now.pos === pos) return null; // still editing that cell
    const node = newState.doc.nodeAt(pos);
    if (!node || node.type.name !== 'tableCell' || !node.attrs.format) return null;
    const content = cellInline(node);
    const n = cellNumber(node.attrs, content);
    if (!n) return null;
    const want = numberNodes(n.value, n.format);
    if (n.value === node.attrs.value && inlinePlain(content) === inlinePlain(want)) return null;
    const tr = newState.tr.setMeta(numberCellKey, true);
    rewriteCell(tr, pos, { value: n.value }, want);
    return tr;
  },
});

export type FillScope = 'cells' | 'row' | 'column' | 'table';

/**
 * Fill table cells with a background colour (hex RRGGBB or an xcolor name; null clears it),
 * written as \cellcolor. `cells` is the cell selection or the cell at the cursor; `row`,
 * `column` and `table` widen it to the whole rows, columns or table it touches. Header
 * cells are included. Returns the number of cells changed.
 */
export function setCellFill(ed: Editor, color: string | null, scope: FillScope = 'cells'): number {
  const { state } = ed;
  const bg = color ? color.replace(/^#/, '') : null;
  let rect: ReturnType<typeof selectedRect>;
  try { rect = selectedRect(state); } catch { return 0; }
  const { map } = rect;
  const area = scope === 'table' ? { left: 0, right: map.width, top: 0, bottom: map.height }
    : scope === 'row' ? { left: 0, right: map.width, top: rect.top, bottom: rect.bottom }
    : scope === 'column' ? { left: rect.left, right: rect.right, top: 0, bottom: map.height }
    : { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  const tr = state.tr;
  let n = 0;
  for (const rel of new Set(map.cellsInRect(area))) {
    const pos = rect.tableStart + rel;
    const node = state.doc.nodeAt(pos);
    if (!node || (node.attrs.background ?? null) === bg) continue;
    tr.setNodeMarkup(pos, undefined, { ...node.attrs, background: bg });
    n++;
  }
  if (n) ed.view.dispatch(tr);
  ed.commands.focus();
  return n;
}

/** Background of the cell at the cursor (or the first selected cell). */
export function currentCellFill(ed: Editor): string | null {
  const sel = ed.state.selection;
  const c = sel instanceof CellSelection ? { node: sel.$anchorCell.nodeAfter } : cellAround(sel.$head);
  return (c?.node?.attrs.background as string | null) ?? null;
}

/** Body cells (not headers) the format commands act on: the cell selection, or the cell at the cursor. */
function targetCells(state: EditorState, scope: 'selection' | 'column'): { pos: number; node: PMNode }[] {
  const out: { pos: number; node: PMNode }[] = [];
  const sel = state.selection;
  if (scope === 'column') {
    try {
      const rect = selectedRect(state);
      const seen = new Set<number>();
      for (const rel of rect.map.cellsInRect({ left: rect.left, right: rect.right, top: 0, bottom: rect.map.height })) {
        if (seen.has(rel)) continue;
        seen.add(rel);
        const pos = rect.tableStart + rel;
        const node = state.doc.nodeAt(pos);
        if (node?.type.name === 'tableCell') out.push({ pos, node });
      }
    } catch { /* not in a table */ }
    return out;
  }
  if (sel instanceof CellSelection) {
    sel.forEachCell((node, pos) => { if (node.type.name === 'tableCell') out.push({ pos, node }); });
    return out;
  }
  const c = cellAround(sel.$head);
  return c && c.node.type.name === 'tableCell' ? [c] : [];
}

/** The format and value of the cell at the cursor (for the toolbar and the dialog). */
export function currentNumber(ed: Editor): { format: NumFormat | null; value: string | null; text: string; header: boolean } | null {
  const c = cellAround(ed.state.selection.$head);
  if (!c) return null;
  const content = cellInline(c.node);
  const format = decodeFormat(c.node.attrs.format);
  const n = cellNumber(c.node.attrs, content);
  const text = inlinePlain(content);
  return { format, value: n?.value ?? (format ? null : parseNumberText(text)), text, header: c.node.type.name === 'tableHeader' };
}

/**
 * Apply a number format to the target cells. `next` receives each cell's current format and
 * text and returns the new format (null = plain text). Values are kept at full precision;
 * going back to text shows the full value, like Excel's General format.
 */
export function applyNumberFormat(ed: Editor, next: (cur: NumFormat | null, text: string) => NumFormat | null, scope: 'selection' | 'column' = 'selection'): number {
  const cells = targetCells(ed.state, scope).sort((a, b) => b.pos - a.pos); // back to front: positions stay valid
  if (!cells.length) return 0;
  const caretCell = ed.state.selection instanceof CellSelection ? null : cellAround(ed.state.selection.$head);
  const tr = ed.state.tr.setMeta(numberCellKey, true);
  for (const { pos, node } of cells) {
    const content = cellInline(node);
    const text = inlinePlain(content);
    const cur = decodeFormat(node.attrs.format);
    const value = cur ? cellNumber(node.attrs, content)?.value ?? null : parseNumberText(text);
    const f = next(cur, text);
    if (!f) {
      if (cur) rewriteCell(tr, pos, { format: null, value: null }, value != null ? [{ type: 'text', text: value }] : null);
      continue;
    }
    if (value == null) { rewriteCell(tr, pos, { format: encodeFormat(f), value: null }, null); continue; }
    rewriteCell(tr, pos, { format: encodeFormat(f), value }, numberNodes(value, f));
  }
  if (caretCell) caretToCellEnd(tr, tr.mapping.map(caretCell.pos));
  ed.view.dispatch(tr);
  ed.view.focus();
  return cells.length;
}

/**
 * Replacing a cell's text would otherwise map a caret inside it to the next cell; keep it
 * at the end of the cell's text so the toolbar keeps describing the cell just formatted.
 */
function caretToCellEnd(tr: Transaction, cellPos: number) {
  const cell = tr.doc.nodeAt(cellPos);
  const para = cell?.firstChild;
  if (!cell || !para?.isTextblock) return;
  tr.setSelection(TextSelection.create(tr.doc, cellPos + 1 + para.nodeSize - 1));
}

/** Set the full-precision value of the cell at the cursor (the toolbar's value box). */
export function setCellValue(ed: Editor, input: string): boolean {
  const c = cellAround(ed.state.selection.$head);
  if (!c || c.node.type.name !== 'tableCell') return false;
  const f = decodeFormat(c.node.attrs.format);
  const v = parseNumberText(input, false);
  if (v == null) return false;
  const tr = ed.state.tr.setMeta(numberCellKey, true);
  rewriteCell(tr, c.pos, { value: f ? v : null }, f ? numberNodes(v, f) : [{ type: 'text', text: v }]);
  caretToCellEnd(tr, c.pos);
  ed.view.dispatch(tr);
  return true;
}

/** Select whole columns / rows of the current cell selection. */
export function selectColumnOrRow(ed: Editor, what: 'column' | 'row') {
  const { state } = ed;
  const sel = state.selection;
  const anchor = sel instanceof CellSelection ? sel.$anchorCell : (() => { const c = cellAround(sel.$head); return c ? state.doc.resolve(c.pos) : null; })();
  const head = sel instanceof CellSelection ? sel.$headCell : anchor;
  if (!anchor || !head) return;
  ed.view.dispatch(state.tr.setSelection(what === 'column' ? CellSelection.colSelection(anchor, head) : CellSelection.rowSelection(anchor, head)));
  ed.view.focus();
}

// ----------------------------------------------------------------------------- helpers

/** Position and node of the tableBlock around the selection, if any. */
export function tableBlockAt(ed: Editor): { pos: number; node: import('@tiptap/pm/model').Node } | null {
  const { $from } = ed.state.selection;
  for (let d = $from.depth; d > 0; d--) {
    const n = $from.node(d);
    if (n.type.name === 'tableBlock') return { pos: $from.before(d), node: n };
  }
  return null;
}

export function setTableBlockAttrs(ed: Editor, patch: Record<string, unknown>) {
  const tb = tableBlockAt(ed);
  if (!tb) return;
  if (typeof patch.style === 'string') rememberTableStyle(patch.style);
  ed.view.dispatch(ed.state.tr.setNodeMarkup(tb.pos, undefined, { ...tb.node.attrs, ...patch }));
}

/** Column index range of the current cell selection. */
export function currentColumns(ed: Editor): [number, number] | null {
  try { const r = selectedRect(ed.state); return [r.left, r.right]; } catch { return null; }
}

export function setColumnAlign(ed: Editor, align: 'l' | 'c' | 'r') {
  const tb = tableBlockAt(ed);
  const cols = currentColumns(ed);
  if (!tb || !cols) return;
  const table = tb.node.firstChild!;
  let width = 0;
  table.firstChild?.forEach((c) => { width += Number(c.attrs.colspan ?? 1); });
  const spec: string[] = String(tb.node.attrs.cols || '').split(/\s+/).filter(Boolean);
  while (spec.length < width) spec.push('l');
  for (let c = cols[0]; c < cols[1]; c++) spec[c] = align;
  ed.view.dispatch(ed.state.tr.setNodeMarkup(tb.pos, undefined, { ...tb.node.attrs, cols: spec.slice(0, width).join(' ') }));
}

export function columnAlignAt(ed: Editor): string | null {
  const tb = tableBlockAt(ed);
  const cols = currentColumns(ed);
  if (!tb || !cols) return null;
  return String(tb.node.attrs.cols || '').split(/\s+/)[cols[0]] ?? 'l';
}

/** Keep the tableBlock's column spec in step with the actual number of columns. */
export function syncColumnCount(ed: Editor) {
  const tb = tableBlockAt(ed);
  if (!tb) return;
  const table = tb.node.firstChild!;
  let width = 0;
  table.firstChild?.forEach((c) => { width += Number(c.attrs.colspan ?? 1); });
  const spec: string[] = String(tb.node.attrs.cols || '').split(/\s+/).filter(Boolean);
  if (spec.length === width) return;
  while (spec.length < width) spec.push('r');
  ed.view.dispatch(ed.state.tr.setNodeMarkup(tb.pos, undefined, { ...tb.node.attrs, cols: spec.slice(0, width).join(' ') }));
}

/**
 * Add a header level: a new header row above the current top row, ready for group labels.
 * Select the cells a label should span and Merge cells; the LaTeX gets \\multicolumn and a
 * partial rule (\\cmidrule or \\cline) under it.
 */
export function addHeaderLevel(ed: Editor) {
  const tb = tableBlockAt(ed);
  if (!tb) return;
  // first cell of the table: tableBlock > table > row > cell > paragraph
  const cellPos = tb.pos + 3;
  const first = ed.state.doc.nodeAt(cellPos);
  if (!first) return;
  const tr = ed.state.tr.setSelection(TextSelection.create(ed.state.doc, cellPos + 2));
  ed.view.dispatch(tr);
  if (first.type.name === 'tableHeader') ed.chain().focus().addRowBefore().run();
  else {
    // no header yet: add a row and make it the header
    ed.chain().focus().addRowBefore().run();
    const pos = tableBlockAt(ed);
    if (pos) {
      ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, pos.pos + 5)));
      selectColumnOrRow(ed, 'row');
      ed.chain().focus().toggleHeaderCell().run();
    }
  }
  const after = tableBlockAt(ed);
  if (after) ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, after.pos + 5)));
}

/** Delete the selected columns, keeping the tableBlock's column spec in step. */
export function deleteColumns(ed: Editor) {
  const cols = currentColumns(ed);
  const tb = tableBlockAt(ed);
  const spec: string[] = String(tb?.node.attrs.cols || '').split(/\s+/).filter(Boolean);
  ed.chain().focus().deleteColumn().run();
  if (cols && tableBlockAt(ed)) { spec.splice(cols[0], cols[1] - cols[0]); setTableBlockAttrs(ed, { cols: spec.join(' ') }); }
}

/** Delete the whole table block around the selection. */
export function deleteTable(ed: Editor) {
  const t = tableBlockAt(ed);
  if (t) ed.view.dispatch(ed.state.tr.delete(t.pos, t.pos + t.node.nodeSize));
}

/**
 * Backspace / Delete on whole selected rows or columns removes them, as in a spreadsheet;
 * on all cells it removes the table. Partial cell selections keep clearing cell contents.
 */
export const TableDeleteKeys = Extension.create({
  name: 'tableDeleteKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    const run = () => {
      const ed = this.editor as unknown as Editor;
      const sel = ed.state.selection;
      if (!(sel instanceof CellSelection)) return false;
      const rows = sel.isRowSelection(), cols = sel.isColSelection();
      if (rows && cols) deleteTable(ed);
      else if (rows) ed.chain().focus().deleteRow().run();
      else if (cols) deleteColumns(ed);
      else return false;
      return true;
    };
    return { Backspace: run, Delete: run, 'Mod-Backspace': run, 'Mod-Delete': run };
  },
});
