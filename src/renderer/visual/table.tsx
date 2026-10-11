// Editable tables: TipTap's table schema wrapped in a `tableBlock` that carries the
// LaTeX-level settings (caption, label, style, column alignment).
import { Node } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps, type Editor } from '@tiptap/react';
import { Table, TableRow, TableHeader, TableCell } from '@tiptap/extension-table';
import { selectedRect } from '@tiptap/pm/tables';
import { useId, useState } from 'react';
import { cssColor } from './marks';
import { RichInline } from './nodes';

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
};

export const QTableCell = TableCell.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
export const QTableHeader = TableHeader.extend({ addAttributes() { return { ...this.parent?.(), ...cellAttrs }; } });
/** Tables only live inside a tableBlock (pasted tables get wrapped automatically). */
export const QTable = Table.extend({ group: 'qtable' }).configure({ resizable: false, allowTableNodeSelection: true });
export const QTableRow = TableRow;

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
  // column alignment from the LaTeX column spec (cells can still override it)
  const id = `tb${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const css = cols.map((c, i) => (/^[cr]$/.test(c) ? `#${id} tr > *:nth-child(${i + 1}){text-align:${c === 'c' ? 'center' : 'right'}}` : '')).join('');
  return (
    <NodeViewWrapper className={`tblock tstyle-${a.style} ${a.size === 'small' ? 'tsmall' : ''}`} data-cols={cols.join(' ')} id={id}>
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
    return { caption: r(''), label: r(''), placement: r('htbp'), env: r('table'), style: r('booktabs'), cols: r(''), captionPos: r('top'), size: r('') };
  },
  parseHTML() { return [{ tag: 'div[data-qtype="tableBlock"]', getAttrs: (el) => { try { return JSON.parse((el as HTMLElement).dataset.qattrs ?? '{}'); } catch { return {}; } } }]; },
  renderHTML({ node }) {
    const a: Record<string, unknown> = { ...node.attrs };
    delete a.src; delete a.sig; delete a.gap;
    return ['div', { 'data-qtype': 'tableBlock', 'data-qattrs': JSON.stringify(a) }, 0];
  },
  addNodeView() { return ReactNodeViewRenderer(TableBlockView); },
});

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
