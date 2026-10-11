// Formatting toolbar for the visual editor. Items have priorities: when the window is
// narrow, the least important ones move into the "More" menu instead of wrapping.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { editorRef } from '../visual/editorRef';
import { getState, setState, togglePanel, useStore, mainFile, type MenuItem } from '../store';
import { insertEquation, insertFigure, insertInlineMath, insertLink, newComment, insertMenu } from '../commands';
import { MenuList, below, type Anchor } from './Menu';
import { useOutside } from './Chrome';
import { Down, List, OList } from './Icons';
import { HIGHLIGHTS, TEXT_COLORS, cssColor } from '../visual/marks';
import { columnAlignAt, setColumnAlign, setTableBlockAttrs, tableBlockAt, currentColumns } from '../visual/table';
import { TABLE_STYLES } from '../../shared/latex/table';

interface Item { id: string; group: string; priority: number; node: ReactNode; menu?: MenuItem }

/** Lays items out in one row; anything that does not fit goes into a trailing "More" menu. */
export function OverflowBar({ items, extra, label, right }: { items: Item[]; extra?: MenuItem[]; label: string; right?: ReactNode }) {
  const bar = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [avail, setAvail] = useState(10000);
  useLayoutEffect(() => {
    const m = measure.current;
    if (!m) return;
    const next: Record<string, number> = {};
    m.querySelectorAll<HTMLElement>('[data-mid]').forEach((el) => { next[el.dataset.mid!] = el.getBoundingClientRect().width; });
    if (JSON.stringify(next) !== JSON.stringify(widths)) setWidths(next);
  });
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAvail(el.clientWidth - (rightRef.current?.offsetWidth ?? 0) - 24));
    ro.observe(el);
    if (rightRef.current) ro.observe(rightRef.current);
    return () => ro.disconnect();
  }, []);
  const GAP = 4, SEP = 9, MORE = 70;
  const order = [...items].sort((a, b) => a.priority - b.priority);
  const visible = new Set<string>();
  let used = MORE;
  let lastGroups = new Set<string>();
  for (const it of order) {
    const w = (widths[it.id] ?? 60) + GAP + (lastGroups.has(it.group) ? 0 : SEP);
    if (used + w > avail) break;
    used += w;
    visible.add(it.id);
    lastGroups = new Set([...lastGroups, it.group]);
  }
  const hidden = items.filter((i) => !visible.has(i.id) && i.menu).map((i) => i.menu!);
  const shown = items.filter((i) => visible.has(i.id));
  const moreItems = [...hidden, ...(hidden.length && extra?.length ? [{ separator: true }] : []), ...(extra ?? [])];
  return (
    <div className="toolbar" role="toolbar" aria-label={label} ref={bar}>
      <div ref={measure} aria-hidden="true" className="tb-measure">
        {items.map((i) => <span key={i.id} data-mid={i.id} className="tb-slot">{i.node}</span>)}
      </div>
      {shown.map((it, k) => (
        <span key={it.id} className="tb-slot">
          {k > 0 && shown[k - 1].group !== it.group && <span className="vsep" />}
          {it.node}
        </span>
      ))}
      {moreItems.length > 0 && <MoreMenu items={moreItems} />}
      <span className="spacer" />
      <div ref={rightRef} className="row" style={{ gap: 4, flex: 'none' }}>{right}</div>
    </div>
  );
}

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState<Anchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(null));
  return (
    <div ref={ref} style={{ flex: 'none' }}>
      <button className="tb" aria-haspopup="menu" aria-expanded={!!open} onMouseDown={(e) => e.preventDefault()} onClick={(e) => setOpen(open ? null : below(e.currentTarget))}>More <Down size={12} /></button>
      {open && <MenuList items={items} onDone={() => setOpen(null)} at={open} />}
    </div>
  );
}

function ColorButton({ kind }: { kind: 'text' | 'highlight' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState('');
  useOutside(ref, () => setOpen(false));
  const ed = editorRef.current;
  const cur = kind === 'text' ? ed?.getAttributes('textColor').color : ed?.getAttributes('highlight').color;
  const palette = kind === 'text' ? TEXT_COLORS : HIGHLIGHTS;
  const apply = (hex: string | null) => {
    setOpen(false);
    const c = ed?.chain().focus();
    if (!c) return;
    if (kind === 'text') (hex ? c.setTextColor(hex) : c.unsetTextColor()).run();
    else (hex ? c.setHighlightColor(hex) : c.unsetHighlightColor()).run();
  };
  const label = kind === 'text' ? 'Text colour' : 'Highlight';
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="tb" aria-label={label} title={label + (kind === 'highlight' ? '  Ctrl+Shift+H' : '')} aria-haspopup="dialog" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>
        {kind === 'text'
          ? <span className="colorglyph" style={{ borderBottomColor: cur ? cssColor(cur) : '#1E4290' }}>A</span>
          : <span className="colorglyph hl" style={{ background: cur ? cssColor(cur) : '#FFF176' }}>ab</span>}
        <Down size={10} />
      </button>
      {open && (
        <div className="menu swatches" role="dialog" aria-label={label} style={{ top: 32, left: 0, padding: 8 }}>
          <div className="row wrap" style={{ gap: 6, width: 176 }}>
            {palette.map((p) => <button key={p.hex} className="swatch" title={p.name} aria-label={p.name} style={{ background: `#${p.hex}` }} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(p.hex)} />)}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 8 }}>
            <input className="field mono" style={{ height: 26, width: 96 }} placeholder="RRGGBB" aria-label="Custom colour (hex)" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && custom.length === 6) apply(custom); }} />
            <button className="btn btn-xs" disabled={custom.length !== 6} onClick={() => apply(custom)}>Apply</button>
          </div>
          <button className="btn btn-q btn-xs" style={{ marginTop: 6 }} onMouseDown={(e) => e.preventDefault()} onClick={() => apply(null)}>{kind === 'text' ? 'Default colour' : 'No highlight'}</button>
        </div>
      )}
    </div>
  );
}

function useEditorTick() {
  const [, force] = useState(0);
  const tick = useStore((s) => s.editorTick);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const f = () => force((x) => x + 1);
    ed.on('transaction', f);
    f();
    return () => { ed.off('transaction', f); };
  }, [tick]);
}

export function FormatToolbar() {
  useEditorTick();
  const panel = useStore((s) => s.panel);
  const comments = useStore((s) => s.comments.filter((t) => t.file === mainFile() && !t.resolved).length);
  const ed = editorRef.current;
  const chain = () => ed!.chain().focus();
  const md = (e: React.MouseEvent) => e.preventDefault();
  const style = !ed ? 'p' : ed.isActive('heading', { level: 1 }) ? 'h1' : ed.isActive('heading', { level: 2 }) ? 'h2' : ed.isActive('heading', { level: 3 }) ? 'h3' : ed.isActive('codeBlock') ? 'code' : 'p';
  const btn = (id: string, label: ReactNode, title: string, run: () => void, active?: boolean, aria?: string, cls = '') =>
    <button className={`tb ${cls}`} aria-label={aria ?? title} title={title} aria-pressed={active} onMouseDown={md} onClick={run} disabled={!ed} data-cmd={id}>{label}</button>;
  const items: Item[] = [
    { id: 'style', group: 'style', priority: 1, node: (
      <>
        <label className="sr-only" htmlFor="pstyle">Paragraph style</label>
        <select id="pstyle" className="field" style={{ width: 128, height: 28 }} value={style} disabled={!ed}
          onChange={(e) => { const v = e.target.value; if (v === 'p') chain().setParagraph().run(); else if (v === 'code') chain().setCodeBlock({ language: 'Python' }).run(); else chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run(); }}>
          <option value="p">Body text</option><option value="h1">Section</option><option value="h2">Subsection</option><option value="h3">Subsubsection</option><option value="code">Code</option>
        </select>
      </>), menu: { label: 'Paragraph style', submenu: [
        { label: 'Body text', shortcut: 'Ctrl+Alt+0', run: () => chain().setParagraph().run() },
        { label: 'Section', shortcut: 'Ctrl+Alt+1', run: () => chain().setHeading({ level: 1 }).run() },
        { label: 'Subsection', shortcut: 'Ctrl+Alt+2', run: () => chain().setHeading({ level: 2 }).run() },
        { label: 'Subsubsection', shortcut: 'Ctrl+Alt+3', run: () => chain().setHeading({ level: 3 }).run() },
      ] } },
    { id: 'bold', group: 'fmt', priority: 1, node: btn('bold', <b>B</b>, 'Bold  Ctrl+B', () => chain().toggleBold().run(), ed?.isActive('bold'), 'Bold'), menu: { label: 'Bold', shortcut: 'Ctrl+B', run: () => chain().toggleBold().run() } },
    { id: 'italic', group: 'fmt', priority: 1, node: btn('italic', <i style={{ fontFamily: 'var(--serif)', fontSize: 14 }}>I</i>, 'Italic  Ctrl+I', () => chain().toggleItalic().run(), ed?.isActive('italic'), 'Italic'), menu: { label: 'Italic', shortcut: 'Ctrl+I', run: () => chain().toggleItalic().run() } },
    { id: 'underline', group: 'fmt', priority: 2, node: btn('underline', <u>U</u>, 'Underline  Ctrl+U', () => chain().toggleUnderline().run(), ed?.isActive('underline'), 'Underline'), menu: { label: 'Underline', shortcut: 'Ctrl+U', run: () => chain().toggleUnderline().run() } },
    { id: 'tcolor', group: 'fmt', priority: 3, node: <ColorButton kind="text" />, menu: { label: 'Text colour', submenu: [...TEXT_COLORS.map((c) => ({ label: c.name, run: () => chain().setTextColor(c.hex).run() })), { separator: true }, { label: 'Default', run: () => chain().unsetTextColor().run() }] } },
    { id: 'hl', group: 'fmt', priority: 3, node: <ColorButton kind="highlight" />, menu: { label: 'Highlight', submenu: [...HIGHLIGHTS.map((c) => ({ label: c.name, run: () => chain().setHighlightColor(c.hex).run() })), { separator: true }, { label: 'None', run: () => chain().unsetHighlightColor().run() }] } },
    { id: 'code', group: 'fmt', priority: 6, node: btn('code', <span style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{'</>'}</span>, 'Monospace  Ctrl+E', () => chain().toggleCode().run(), ed?.isActive('code'), 'Monospace'), menu: { label: 'Monospace', shortcut: 'Ctrl+E', run: () => chain().toggleCode().run() } },
    { id: 'link', group: 'fmt', priority: 7, node: btn('link', 'Link', 'Link  Ctrl+K', () => void insertLink(), ed?.isActive('link')), menu: { label: 'Link…', shortcut: 'Ctrl+K', run: () => void insertLink() } },
    { id: 'ul', group: 'list', priority: 2, node: btn('ul', <List />, 'Bulleted list  Ctrl+Shift+8', () => chain().toggleBulletList().run(), ed?.isActive('bulletList'), 'Bulleted list'), menu: { label: 'Bulleted list', shortcut: 'Ctrl+Shift+8', run: () => chain().toggleBulletList().run() } },
    { id: 'ol', group: 'list', priority: 2, node: btn('ol', <OList />, 'Numbered list  Ctrl+Shift+7', () => chain().toggleOrderedList().run(), ed?.isActive('orderedList'), 'Numbered list'), menu: { label: 'Numbered list', shortcut: 'Ctrl+Shift+7', run: () => chain().toggleOrderedList().run() } },
    { id: 'cite', group: 'ref', priority: 4, node: btn('cite', 'Cite', 'Insert citation  Ctrl+Shift+K', () => setState({ picker: 'cite' })), menu: { label: 'Citation…', shortcut: 'Ctrl+Shift+K', run: () => setState({ picker: 'cite' }) } },
    { id: 'xref', group: 'ref', priority: 4, node: btn('xref', 'Cross-ref', 'Insert cross-reference  Ctrl+Shift+R', () => setState({ picker: 'ref' })), menu: { label: 'Cross-reference…', shortcut: 'Ctrl+Shift+R', run: () => setState({ picker: 'ref' }) } },
    { id: 'eq', group: 'ins', priority: 3, node: btn('eq', 'Equation', 'Display equation  Ctrl+Shift+M', insertEquation), menu: { label: 'Equation', shortcut: 'Ctrl+Shift+M', run: insertEquation } },
    { id: 'math', group: 'ins', priority: 5, node: btn('math', 'Math', 'Inline math  Ctrl+M (or type $x$)', insertInlineMath), menu: { label: 'Inline math', shortcut: 'Ctrl+M', run: insertInlineMath } },
    { id: 'table', group: 'ins', priority: 3, node: btn('table', 'Table', 'Insert table  Ctrl+Alt+T', () => setState({ dialog: 'insertTable' })), menu: { label: 'Table…', shortcut: 'Ctrl+Alt+T', run: () => setState({ dialog: 'insertTable' }) } },
    { id: 'fig', group: 'ins', priority: 4, node: btn('fig', 'Figure', 'Insert figure', () => void insertFigure()), menu: { label: 'Figure…', run: () => void insertFigure() } },
    { id: 'cmt', group: 'ins', priority: 4, node: btn('cmt', 'Comment', 'New comment on the selection  Ctrl+Alt+M', newComment), menu: { label: 'Comment', shortcut: 'Ctrl+Alt+M', run: newComment } },
  ];
  const extra = insertMenu().filter((m) => m.label && ['Footnote', 'Code block', 'Callout', 'Page break', 'Raw LaTeX block', 'Test result…'].includes(m.label));
  return (
    <>
      {/* once the panel is open its own tabs take over; these come back when it is closed */}
      <OverflowBar label="Formatting" items={items} extra={extra} right={panel.open ? null : <>
        <button className="tb" title="Comments  Ctrl+Alt+C" onClick={() => togglePanel('comments')}>Comments{comments ? <span className="countpill">{comments}</span> : null}</button>
        <button className="tb" title="Properties panel  Ctrl+Alt+P" onClick={() => togglePanel('properties')}>Properties</button>
      </>} />
      {ed?.isActive('table') && <TableToolbar />}
    </>
  );
}

export function addColumn(side: 'left' | 'right') {
  const ed = editorRef.current;
  if (!ed) return;
  const cols = currentColumns(ed);
  const tb = tableBlockAt(ed);
  const spec: string[] = String(tb?.node.attrs.cols || '').split(/\s+/).filter(Boolean);
  (side === 'left' ? ed.chain().focus().addColumnBefore() : ed.chain().focus().addColumnAfter()).run();
  if (cols && tb) {
    const at = side === 'left' ? cols[0] : cols[1];
    spec.splice(at, 0, 'r');
    setTableBlockAttrs(ed, { cols: spec.join(' ') });
  }
}

export function deleteColumn() {
  const ed = editorRef.current;
  if (!ed) return;
  const cols = currentColumns(ed);
  const tb = tableBlockAt(ed);
  const spec: string[] = String(tb?.node.attrs.cols || '').split(/\s+/).filter(Boolean);
  ed.chain().focus().deleteColumn().run();
  if (cols && tableBlockAt(ed)) { spec.splice(cols[0], cols[1] - cols[0]); setTableBlockAttrs(ed, { cols: spec.join(' ') }); }
}

function CellColor() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const colors = ['F3ECE6', 'E6F1EA', 'F8E5E1', 'F7ECD9', 'E5ECF8', 'ECEAE6', 'FFF176', 'D7E0F1'];
  const set = (c: string | null) => { setOpen(false); editorRef.current?.chain().focus().setCellAttribute('background', c).run(); };
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="tb" aria-haspopup="dialog" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>Cell colour <Down size={10} /></button>
      {open && (
        <div className="menu swatches" style={{ top: 32, left: 0, padding: 8 }}>
          <div className="row wrap" style={{ gap: 6, width: 176 }}>{colors.map((c) => <button key={c} className="swatch" aria-label={`#${c}`} style={{ background: `#${c}` }} onMouseDown={(e) => e.preventDefault()} onClick={() => set(c)} />)}</div>
          <button className="btn btn-q btn-xs" style={{ marginTop: 6 }} onMouseDown={(e) => e.preventDefault()} onClick={() => set(null)}>No colour</button>
        </div>
      )}
    </div>
  );
}

function TableToolbar() {
  const ed = editorRef.current!;
  const tb = tableBlockAt(ed);
  const c = () => ed.chain().focus();
  const md = (e: React.MouseEvent) => e.preventDefault();
  const align = columnAlignAt(ed);
  const b = (id: string, label: string, run: () => void, title?: string, pressed?: boolean) => <button className="tb" data-cmd={id} title={title ?? label} aria-pressed={pressed} onMouseDown={md} onClick={run}>{label}</button>;
  const items: Item[] = [
    { id: 't-label', group: 'a', priority: 0, node: <span className="lbl" style={{ padding: '0 6px' }}>Table</span> },
    { id: 'row-above', group: 'rows', priority: 1, node: b('row-above', '+ Row above', () => c().addRowBefore().run()), menu: { label: 'Insert row above', run: () => c().addRowBefore().run() } },
    { id: 'row-below', group: 'rows', priority: 1, node: b('row-below', '+ Row below', () => c().addRowAfter().run()), menu: { label: 'Insert row below', run: () => c().addRowAfter().run() } },
    { id: 'col-left', group: 'cols', priority: 2, node: b('col-left', '+ Col left', () => addColumn('left')), menu: { label: 'Insert column left', run: () => addColumn('left') } },
    { id: 'col-right', group: 'cols', priority: 2, node: b('col-right', '+ Col right', () => addColumn('right')), menu: { label: 'Insert column right', run: () => addColumn('right') } },
    { id: 'del-row', group: 'del', priority: 4, node: b('del-row', 'Delete row', () => c().deleteRow().run()), menu: { label: 'Delete row', run: () => c().deleteRow().run() } },
    { id: 'del-col', group: 'del', priority: 4, node: b('del-col', 'Delete column', deleteColumn), menu: { label: 'Delete column', run: deleteColumn } },
    { id: 'merge', group: 'merge', priority: 2, node: b('merge', 'Merge cells', () => c().mergeCells().run(), 'Select cells by dragging, then merge'), menu: { label: 'Merge cells', run: () => c().mergeCells().run() } },
    { id: 'split', group: 'merge', priority: 3, node: b('split', 'Split cell', () => c().splitCell().run()), menu: { label: 'Split cell', run: () => c().splitCell().run() } },
    { id: 'hdr', group: 'hdr', priority: 3, node: b('hdr', 'Header cells', () => c().toggleHeaderCell().run(), 'Toggle header styling for the selected cells (select a whole row for a second header level)'), menu: { label: 'Toggle header cells', run: () => c().toggleHeaderCell().run() } },
    { id: 'cellcolor', group: 'hdr', priority: 3, node: <CellColor />, menu: { label: 'Clear cell colour', run: () => c().setCellAttribute('background', null).run() } },
    { id: 'al', group: 'align', priority: 3, node: b('al', 'Left', () => setColumnAlign(ed, 'l'), 'Align column left', align === 'l'), menu: { label: 'Align column left', run: () => setColumnAlign(ed, 'l') } },
    { id: 'ac', group: 'align', priority: 3, node: b('ac', 'Centre', () => setColumnAlign(ed, 'c'), 'Centre column', align === 'c'), menu: { label: 'Centre column', run: () => setColumnAlign(ed, 'c') } },
    { id: 'ar', group: 'align', priority: 3, node: b('ar', 'Right', () => setColumnAlign(ed, 'r'), 'Align column right', align === 'r'), menu: { label: 'Align column right', run: () => setColumnAlign(ed, 'r') } },
    { id: 'tstyle', group: 'style', priority: 2, node: (
      <select className="field" aria-label="Table style" style={{ height: 28, width: 120 }} value={tb?.node.attrs.style ?? 'booktabs'} onChange={(e) => setTableBlockAttrs(ed, { style: e.target.value })}>
        {TABLE_STYLES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>), menu: { label: 'Table style', submenu: TABLE_STYLES.map((t) => ({ label: t.label, checked: tb?.node.attrs.style === t.id, run: () => setTableBlockAttrs(ed, { style: t.id }) })) } },
  ];
  const extra: MenuItem[] = [
    { label: 'Caption above table', checked: tb?.node.attrs.captionPos !== 'bottom', run: () => setTableBlockAttrs(ed, { captionPos: 'top' }) },
    { label: 'Caption below table', checked: tb?.node.attrs.captionPos === 'bottom', run: () => setTableBlockAttrs(ed, { captionPos: 'bottom' }) },
    { label: 'Smaller font', checked: tb?.node.attrs.size === 'small', run: () => setTableBlockAttrs(ed, { size: tb?.node.attrs.size === 'small' ? '' : 'small' }) },
    { separator: true },
    { label: 'Table properties', run: () => setState({ panel: { open: true, tab: 'properties' } }) },
    { label: 'Delete table', danger: true, run: () => { const t = tableBlockAt(ed); if (t) ed.view.dispatch(ed.state.tr.delete(t.pos, t.pos + t.node.nodeSize)); } },
  ];
  void getState;
  return <OverflowBar label="Table" items={items} extra={extra} />;
}
