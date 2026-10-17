// Formatting toolbar for the visual editor. Items have priorities: when the window is
// narrow, the least important ones move into the "More" menu instead of wrapping.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { editorRef } from '../visual/editorRef';
import { getState, promptText, setState, toast, togglePanel, useStore, mainFile, type MenuItem } from '../store';
import { insertEquation, insertFigure, insertInlineMath, insertLink, newComment, insertMenu } from '../commands';
import { MenuList, below, type Anchor } from './Menu';
import { useOutside } from './Chrome';
import { Bucket, Down, Indent, List, Menu as MenuIcon, OList, Outdent } from './Icons';
import { CELL_FILLS, HIGHLIGHTS, TEXT_COLORS, cssColor } from '../visual/marks';
import { applyNumberFormat, columnAlignAt, currentCellFill, currentNumber, setCellFill, type FillScope, selectColumnOrRow, setCellValue, setColumnAlign, setTableBlockAttrs, tableBlockAt, currentColumns, addHeaderLevel } from '../visual/table';
import { copyTableForSpreadsheet } from '../visual/clipboard';
import { HEADING_STYLES, MAX_HEADING, headingLevel, setBlockStyle, shiftHeading } from '../visual/headings';
import { HEADER_FILLS, TABLE_SIZES, TABLE_SPACING, TABLE_STYLES } from '../../shared/latex/table';
import { NUM_KINDS, defaultFormat, describeFormat, stepDecimals, type NumKind } from '../../shared/latex/numfmt';

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

/** Opens the right-hand panel on Properties or Comments. */
function PanelMenu({ comments }: { comments: number }) {
  const [open, setOpen] = useState<Anchor | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(null));
  const items: MenuItem[] = [
    { label: 'Properties', shortcut: 'Ctrl+Alt+P', run: () => togglePanel('properties') },
    { label: comments ? `Comments (${comments} open)` : 'Comments', shortcut: 'Ctrl+Alt+C', run: () => togglePanel('comments') },
  ];
  return (
    <div ref={ref} style={{ flex: 'none' }}>
      <button className="tb tb-panel" aria-label={`Properties and comments${comments ? ` (${comments} open comments)` : ''}`} title="Properties and comments" aria-haspopup="menu" aria-expanded={!!open}
        onMouseDown={(e) => e.preventDefault()} onClick={(e) => setOpen(open ? null : below(e.currentTarget, true))}>
        <MenuIcon />{comments ? <span className="countpill">{comments}</span> : null}
      </button>
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
  const level = headingLevel(ed);
  const style = !ed ? 'p' : level ? `h${level}` : ed.isActive('paragraph') ? 'p' : 'other';
  const btn = (id: string, label: ReactNode, title: string, run: () => void, active?: boolean, aria?: string, cls = '', disabled = !ed) =>
    <button className={`tb ${cls}`} aria-label={aria ?? title} title={title} aria-pressed={active} onMouseDown={md} onClick={run} disabled={disabled} data-cmd={id}>{label}</button>;
  const items: Item[] = [
    { id: 'style', group: 'style', priority: 1, node: (
      <>
        <label className="sr-only" htmlFor="pstyle">Paragraph style</label>
        <select id="pstyle" className="field" style={{ width: 148, height: 28 }} value={style} disabled={!ed}
          onChange={(e) => { const v = e.target.value; if (v === 'p') setBlockStyle(ed!, 0); else if (v[0] === 'h') setBlockStyle(ed!, Number(v.slice(1))); }}>
          <option value="p">Body text</option>
          {HEADING_STYLES.map((h) => <option key={h.level} value={`h${h.level}`}>{h.label}</option>)}
          <option value="other" hidden disabled>—</option>
        </select>
      </>), menu: { label: 'Paragraph style', submenu: [
        { label: 'Body text', shortcut: 'Ctrl+Alt+0', checked: style === 'p', run: () => setBlockStyle(ed!, 0) },
        ...HEADING_STYLES.map((h) => ({ label: h.label, shortcut: `Ctrl+Alt+${h.level}`, checked: level === h.level, run: () => setBlockStyle(ed!, h.level) })),
      ] } },
    { id: 'promote', group: 'style', priority: 2, node: btn('promote', <Outdent />, 'Promote heading (one level up)  Alt+Shift+←', () => void shiftHeading(ed!, -1), undefined, 'Promote heading', '', !ed || level <= 1), menu: { label: 'Promote heading', shortcut: 'Alt+Shift+←', disabled: level <= 1, run: () => void shiftHeading(ed!, -1) } },
    { id: 'demote', group: 'style', priority: 2, node: btn('demote', <Indent />, 'Demote heading (one level down)  Alt+Shift+→', () => void shiftHeading(ed!, 1), undefined, 'Demote heading', '', !ed || !level || level >= MAX_HEADING), menu: { label: 'Demote heading', shortcut: 'Alt+Shift+→', disabled: !level || level >= MAX_HEADING, run: () => void shiftHeading(ed!, 1) } },
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
  const extra = insertMenu().filter((m) => m.label && ['Footnote', 'Code block', 'Callout', 'Page break', 'Table of contents', 'List of tables and figures', 'Raw LaTeX block', 'Test result…'].includes(m.label));
  return (
    <div className="toolbar-stack">
      {/* once the panel is open its own tabs take over; these come back when it is closed */}
      <OverflowBar label="Formatting" items={items} extra={extra} right={panel.open ? null : <PanelMenu comments={comments} />} />
      {/* floats over the page instead of pushing it down when the cursor enters a table */}
      {ed?.isActive('table') && <TableToolbar />}
    </div>
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

const FILL_SCOPES: { id: FillScope; label: string; title: string }[] = [
  { id: 'cells', label: 'Cells', title: 'The selected cells, or the cell at the cursor' },
  { id: 'row', label: 'Row', title: 'Whole rows of the selection' },
  { id: 'column', label: 'Column', title: 'Whole columns of the selection' },
  { id: 'table', label: 'Table', title: 'Every cell of the table' },
];

/** Cell fill: a palette, a custom colour, and whether it applies to cells, rows, columns or the table. */
function CellFill() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<FillScope>('cells');
  const [custom, setCustom] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const ed = editorRef.current;
  const cur = ed ? currentCellFill(ed) : null;
  const apply = (c: string | null) => { setOpen(false); const e = editorRef.current; if (e) setCellFill(e, c, scope); };
  const md = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="tb" aria-label="Cell fill" title="Cell fill: colour the background of table cells" aria-haspopup="dialog" aria-expanded={open} onMouseDown={md} onClick={() => { if (!open) { setScope('cells'); setCustom(''); } setOpen(!open); }}>
        <span className="fillglyph" aria-hidden="true"><Bucket size={14} /><i style={{ background: cur ? cssColor(cur) : 'transparent' }} /></span>Fill <Down size={10} />
      </button>
      {open && (
        <div className="menu swatches cellfill" role="dialog" aria-label="Cell fill" style={{ top: 32, left: 0, padding: 8 }}>
          <div className="seg" role="radiogroup" aria-label="Apply to">
            {FILL_SCOPES.map((s) => <button key={s.id} role="radio" aria-checked={scope === s.id} title={s.title} onMouseDown={md} onClick={() => setScope(s.id)}>{s.label}</button>)}
          </div>
          <div className="fillgrid">
            {CELL_FILLS.flat().map((p) => <button key={p.hex} className="swatch" title={`${p.name} (#${p.hex})`} aria-label={p.name} aria-pressed={cur?.toUpperCase() === p.hex} style={{ background: `#${p.hex}` }} onMouseDown={md} onClick={() => apply(p.hex)} />)}
          </div>
          <div className="row" style={{ gap: 4, marginTop: 8 }}>
            <input type="color" className="colorwell" aria-label="Pick a custom colour" value={`#${custom.length === 6 ? custom : (cur && /^[0-9A-F]{6}$/i.test(cur) ? cur : 'FFFFFF')}`} onChange={(e) => setCustom(e.target.value.slice(1).toUpperCase())} />
            <input className="field mono" style={{ height: 26, width: 84 }} placeholder="RRGGBB" aria-label="Custom colour (hex)" value={custom} onChange={(e) => setCustom(e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase())} onKeyDown={(e) => { if (e.key === 'Enter' && custom.length === 6) apply(custom); }} />
            <button className="btn btn-xs" disabled={custom.length !== 6} onMouseDown={md} onClick={() => apply(custom)}>Apply</button>
          </div>
          <button className="btn btn-q btn-xs" style={{ marginTop: 6 }} onMouseDown={md} onClick={() => apply(null)}>No fill</button>
        </div>
      )}
    </div>
  );
}

/** Menu entries for the cell fill (overflow menu, right-click menu). */
export function cellFillMenu(ed: import('@tiptap/react').Editor): MenuItem[] {
  const named = CELL_FILLS[0].concat(CELL_FILLS[1]);
  const sub = (scope: FillScope): MenuItem[] => [
    ...named.map((c) => ({ label: c.name, swatch: `#${c.hex}`, run: () => void setCellFill(ed, c.hex, scope) })),
    { separator: true },
    { label: 'Custom colour…', run: () => void promptText('Cell fill', 'Hex colour, e.g. FFE98A', '').then((v) => { const h = v?.trim().replace(/^#/, '').toUpperCase(); if (h && /^[0-9A-F]{6}$/.test(h)) setCellFill(ed, h, scope); else if (h) toast('Use six hex digits, e.g. FFE98A.', 'err'); }) },
    { label: 'No fill', run: () => void setCellFill(ed, null, scope) },
  ];
  return FILL_SCOPES.map((s) => ({ label: s.id === 'cells' ? 'Selected cells' : s.id === 'table' ? 'Whole table' : `Whole ${s.label.toLowerCase()}`, submenu: sub(s.id) }));
}

/** Excel's formula bar for a table cell: the full-precision value behind the formatted text. */
function ValueBox({ value, disabled }: { value: string | null; disabled: boolean }) {
  const [v, setV] = useState(value ?? '');
  const [bad, setBad] = useState(false);
  useEffect(() => { setV(value ?? ''); setBad(false); }, [value]);
  const commit = () => {
    const ed = editorRef.current;
    if (!ed || v === (value ?? '') || !v.trim()) return;
    if (!setCellValue(ed, v)) setBad(true);
  };
  return (
    <input className={`field mono tvalue ${bad ? 'bad' : ''}`} aria-label="Cell value (full precision)" title="Full-precision value of this cell. Type a number and press Enter." placeholder={disabled ? '' : 'Value'} disabled={disabled}
      value={v} onChange={(e) => { setV(e.target.value); setBad(false); }} onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); editorRef.current?.commands.focus(); } if (e.key === 'Escape') { setV(value ?? ''); editorRef.current?.commands.focus(); } }} />
  );
}

function TableToolbar() {
  const ed = editorRef.current!;
  const tb = tableBlockAt(ed);
  const c = () => ed.chain().focus();
  const md = (e: React.MouseEvent) => e.preventDefault();
  const align = columnAlignAt(ed);
  const cur = currentNumber(ed);
  const fmt = cur?.format ?? null;
  const ref = useRef<HTMLDivElement>(null);
  // the bar floats over the top of the page: if it lands on the caret, scroll the caret clear once
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const bottom = el.getBoundingClientRect().bottom;
    const top = ed.view.coordsAtPos(ed.state.selection.head).top;
    if (top < bottom + 6) el.closest('.main')?.querySelector('.doc-canvas')?.scrollBy({ top: top - bottom - 12 });
  }, []);
  const b = (id: string, label: ReactNode, run: () => void, title?: string, pressed?: boolean, disabled?: boolean) => <button className="tb" data-cmd={id} title={title ?? (typeof label === 'string' ? label : '')} aria-label={title ?? (typeof label === 'string' ? label : undefined)} aria-pressed={pressed} disabled={disabled} onMouseDown={md} onClick={run}>{label}</button>;
  const setKind = (k: NumKind | 'text') => applyNumberFormat(ed, (f) => (k === 'text' ? null : f && f.kind === k ? f : defaultFormat(k)));
  const step = (d: 1 | -1) => applyNumberFormat(ed, (f, text) => stepDecimals(f, text, d));
  const canSep = !!fmt && fmt.kind !== 'scientific';
  const items: Item[] = [
    { id: 't-label', group: 'a', priority: 0, node: <span className="lbl" style={{ padding: '0 6px' }}>Table</span> },
    { id: 'nkind', group: 'num', priority: 1, node: (
      <select className="field" aria-label="Number format" title={describeFormat(fmt)} style={{ height: 28, width: 118 }} disabled={!cur || cur.header} value={fmt?.kind ?? 'text'} onChange={(e) => setKind(e.target.value as NumKind | 'text')}>
        <option value="text">Text</option>
        {NUM_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
      </select>), menu: { label: 'Number format', submenu: [{ label: 'Text', checked: !fmt, run: () => setKind('text') }, ...NUM_KINDS.map((k) => ({ label: k.label, checked: fmt?.kind === k.kind, run: () => setKind(k.kind) }))] } },
    { id: 'dec-', group: 'num', priority: 1, node: b('dec-', <span className="decglyph">.0<small>−</small></span>, () => step(-1), 'Decrease decimal (fewer digits)', undefined, !cur || cur.header), menu: { label: 'Decrease decimal', run: () => step(-1) } },
    { id: 'dec+', group: 'num', priority: 1, node: b('dec+', <span className="decglyph">.00<small>+</small></span>, () => step(1), 'Increase decimal (more digits)', undefined, !cur || cur.header), menu: { label: 'Increase decimal', run: () => step(1) } },
    { id: 'sep', group: 'num', priority: 2, node: b('sep', ',', () => applyNumberFormat(ed, (f) => (f && f.kind !== 'scientific' ? { ...f, thousands: !fmt?.thousands } : f)), 'Thousands separator (1,234)', !!fmt?.thousands, !canSep), menu: { label: 'Thousands separator', checked: !!fmt?.thousands, disabled: !canSep, run: () => applyNumberFormat(ed, (f) => (f && f.kind !== 'scientific' ? { ...f, thousands: !fmt?.thousands } : f)) } },
    { id: 'nfmt', group: 'num', priority: 2, node: b('nfmt', 'Format…', () => setState({ dialog: 'numberFormat' }), 'Number format: decimals or significant figures, currency, negatives…', undefined, !cur || cur.header), menu: { label: 'Number format…', run: () => setState({ dialog: 'numberFormat' }) } },
    { id: 'nval', group: 'num', priority: 2, node: <ValueBox value={cur?.value ?? null} disabled={!cur || cur.header} />, menu: { label: 'Cell value…', disabled: !cur || cur.header, run: () => void promptText('Cell value', 'Full-precision value (the cell shows it in its number format)', cur?.value ?? '').then((v) => { if (v != null && !setCellValue(ed, v)) toast('Not a number.', 'err'); }) } },
    { id: 'cellfill', group: 'fill', priority: 1, node: <CellFill />, menu: { label: 'Cell fill', submenu: cellFillMenu(ed) } },
    { id: 'row-above', group: 'rows', priority: 1, node: b('row-above', '+ Row above', () => c().addRowBefore().run()), menu: { label: 'Insert row above', run: () => c().addRowBefore().run() } },
    { id: 'row-below', group: 'rows', priority: 1, node: b('row-below', '+ Row below', () => c().addRowAfter().run()), menu: { label: 'Insert row below', run: () => c().addRowAfter().run() } },
    { id: 'col-left', group: 'cols', priority: 2, node: b('col-left', '+ Col left', () => addColumn('left')), menu: { label: 'Insert column left', run: () => addColumn('left') } },
    { id: 'col-right', group: 'cols', priority: 2, node: b('col-right', '+ Col right', () => addColumn('right')), menu: { label: 'Insert column right', run: () => addColumn('right') } },
    { id: 'del-row', group: 'del', priority: 4, node: b('del-row', 'Delete row', () => c().deleteRow().run()), menu: { label: 'Delete row', run: () => c().deleteRow().run() } },
    { id: 'del-col', group: 'del', priority: 4, node: b('del-col', 'Delete column', deleteColumn), menu: { label: 'Delete column', run: deleteColumn } },
    { id: 'merge', group: 'merge', priority: 2, node: b('merge', 'Merge cells', () => c().mergeCells().run(), 'Select cells by dragging, then merge'), menu: { label: 'Merge cells', run: () => c().mergeCells().run() } },
    { id: 'split', group: 'merge', priority: 3, node: b('split', 'Split cell', () => c().splitCell().run()), menu: { label: 'Split cell', run: () => c().splitCell().run() } },
    { id: 'hlevel', group: 'hdr', priority: 3, node: b('hlevel', '+ Header level', () => addHeaderLevel(ed), 'Add a header row above the table for group labels; select the cells a label spans and Merge cells'), menu: { label: 'Add header level', run: () => addHeaderLevel(ed) } },
    { id: 'hdr', group: 'hdr', priority: 3, node: b('hdr', 'Header cells', () => c().toggleHeaderCell().run(), 'Toggle header styling for the selected cells (select a whole row for a second header level)'), menu: { label: 'Toggle header cells', run: () => c().toggleHeaderCell().run() } },
    { id: 'al', group: 'align', priority: 3, node: b('al', 'Left', () => setColumnAlign(ed, 'l'), 'Align column left', align === 'l'), menu: { label: 'Align column left', run: () => setColumnAlign(ed, 'l') } },
    { id: 'ac', group: 'align', priority: 3, node: b('ac', 'Centre', () => setColumnAlign(ed, 'c'), 'Centre column', align === 'c'), menu: { label: 'Centre column', run: () => setColumnAlign(ed, 'c') } },
    { id: 'ar', group: 'align', priority: 3, node: b('ar', 'Right', () => setColumnAlign(ed, 'r'), 'Align column right', align === 'r'), menu: { label: 'Align column right', run: () => setColumnAlign(ed, 'r') } },
    { id: 'tstyle', group: 'style', priority: 2, node: (
      <select className="field" aria-label="Table style" style={{ height: 28, width: 120 }} value={tb?.node.attrs.style ?? 'booktabs'} onChange={(e) => setTableBlockAttrs(ed, { style: e.target.value })}>
        {TABLE_STYLES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
      </select>), menu: { label: 'Table style', submenu: TABLE_STYLES.map((t) => ({ label: t.label, checked: tb?.node.attrs.style === t.id, run: () => setTableBlockAttrs(ed, { style: t.id }) })) } },
  ];
  const ta = tb?.node.attrs ?? {};
  const extra: MenuItem[] = [
    { label: 'Select column', run: () => selectColumnOrRow(ed, 'column') },
    { label: 'Select row', run: () => selectColumnOrRow(ed, 'row') },
    { separator: true },
    { label: 'Text size', submenu: TABLE_SIZES.map((s) => ({ label: s.label, checked: (ta.size || '') === s.id, run: () => setTableBlockAttrs(ed, { size: s.id }) })) },
    { label: 'Row spacing', disabled: ta.env === 'none', submenu: TABLE_SPACING.map((s) => ({ label: s.label, checked: (ta.stretch || '') === s.id, run: () => setTableBlockAttrs(ed, { stretch: s.id }) })) },
    { label: 'Header shading', submenu: HEADER_FILLS.map((s) => ({ label: s.label, checked: (ta.headerFill || '') === s.id, run: () => setTableBlockAttrs(ed, { headerFill: s.id }) })) },
    { label: 'Caption above table', checked: ta.captionPos !== 'bottom', run: () => setTableBlockAttrs(ed, { captionPos: 'top' }) },
    { label: 'Caption below table', checked: ta.captionPos === 'bottom', run: () => setTableBlockAttrs(ed, { captionPos: 'bottom' }) },
    { separator: true },
    { label: 'Copy table for Excel', run: () => void copyTableForSpreadsheet(ed).then((ok) => ok && toast('Table copied. Paste it into Excel or Google Sheets; merged headers are kept.', 'ok')) },
    { label: 'Table properties', run: () => setState({ panel: { open: true, tab: 'properties' } }) },
    { label: 'Delete table', danger: true, run: () => { const t = tableBlockAt(ed); if (t) ed.view.dispatch(ed.state.tr.delete(t.pos, t.pos + t.node.nodeSize)); } },
  ];
  void getState;
  return <div className="toolbar-float" ref={ref}><OverflowBar label="Table" items={items} extra={extra} /></div>;
}
