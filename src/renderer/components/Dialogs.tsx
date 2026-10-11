// App dialogs: prompt, citation/reference picker, insert table, quick open, shortcuts,
// about, and the large equation editor.
import { useEffect, useMemo, useRef, useState } from 'react';
import { NodeSelection } from '@tiptap/pm/state';
import { api, getState, openTab, setState, useStore } from '../store';
import { Dialog } from './Chrome';
import { SHORTCUTS, insertBlock } from '../commands';
import { editorRef } from '../visual/editorRef';
import { newTable, TABLE_STYLES, type TableStyle } from '../../shared/latex/table';
import { CURRENCIES, MAX_DIGITS, NEGATIVES, NUM_KINDS, defaultFormat, formatValue, withPrecisionMode, type NumFormat, type NumKind } from '../../shared/latex/numfmt';
import { applyNumberFormat, currentNumber } from '../visual/table';
import { shortAuthor } from '../../shared/latex/refs';
import { MathInput, type MathInputHandle } from './MathInput';
import { texToHtml } from '../visual/nodes';
import { Search } from './Icons';

/** Excel's "Format Cells → Number" for table cells. */
export function NumberFormatDialog() {
  const open = useStore((s) => s.dialog === 'numberFormat');
  return open && editorRef.current ? <NumberFormatBody /> : null;
}

function NumberFormatBody() {
  const ed = editorRef.current!;
  const cur = useMemo(() => currentNumber(ed), [ed]);
  const init = cur?.format ?? null;
  const [kind, setKind] = useState<NumKind | 'text'>(init?.kind ?? 'number');
  const [f, setF] = useState<NumFormat>(init ?? defaultFormat('number'));
  const [scope, setScope] = useState<'selection' | 'column'>('selection');
  const close = () => setState({ dialog: null });
  const sample = cur?.value ?? '1234.5678';
  const pick = (k: NumKind | 'text') => { setKind(k); if (k !== 'text') setF(init?.kind === k ? init : defaultFormat(k)); };
  const set = (p: Partial<NumFormat>) => setF((x) => ({ ...x, ...p }));
  const apply = () => { applyNumberFormat(ed, () => (kind === 'text' ? null : { ...f, kind }), scope); close(); };
  const fmtd = (v: string) => (kind === 'text' ? v : formatValue(v, { ...f, kind })?.text ?? v);
  const negSample = sample.startsWith('-') ? sample : `-${sample}`;
  const posSample = sample.replace(/^-/, '');
  const hasPrecision = kind !== 'text' && kind !== 'integer';
  return (
    <Dialog title="Number format" wide onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-pri" onClick={apply}>Apply</button></>}>
      <div className="row" style={{ gap: 20, alignItems: 'flex-start' }}>
        <div className="col" style={{ gap: 4, width: 170, flex: 'none' }} role="radiogroup" aria-label="Category">
          <span className="lbl">Category</span>
          {[{ kind: 'text' as const, label: 'Text', example: 'as typed' }, ...NUM_KINDS].map((k) => (
            <button key={k.kind} className="opt" role="radio" aria-checked={kind === k.kind} aria-pressed={kind === k.kind} onClick={() => pick(k.kind)}>
              <b style={{ fontWeight: 600 }}>{k.label}</b><span className="small muted">{k.example}</span>
            </button>
          ))}
        </div>
        <div className="col grow" style={{ gap: 12, minWidth: 0 }}>
          <div className="nf-preview" aria-live="polite">
            <span className="lbl">Preview</span>
            <div className="row" style={{ gap: 24 }}><span className="mono">{fmtd(posSample)}</span><span className="mono" style={{ color: kind !== 'text' && (f.negative === 'red' || f.negative === 'redparens') ? '#C00000' : undefined }}>{fmtd(negSample)}</span></div>
            {cur?.value && <span className="small muted">Cell value {cur.value} — the full value is kept; only the display changes.</span>}
          </div>
          {kind === 'text' && <div className="small muted">Shown exactly as typed. A number that was formatted shows its full value again (like Excel's General format).</div>}
          {hasPrecision && (
            <div className="row" style={{ gap: 12, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              <div className="seg" role="group" aria-label="Precision">
                <button aria-pressed={!f.sig} onClick={() => setF((x) => withPrecisionMode(x, false, sample))}>Decimal places</button>
                <button aria-pressed={f.sig} onClick={() => setF((x) => withPrecisionMode(x, true, sample))}>Significant figures</button>
              </div>
              <label className="f" style={{ width: 90 }}>{f.sig ? 'Figures' : 'Decimals'}
                <input className="field" type="number" min={f.sig ? 1 : 0} max={MAX_DIGITS} value={f.digits} onChange={(e) => set({ digits: Math.max(f.sig ? 1 : 0, Math.min(MAX_DIGITS, Math.round(Number(e.target.value) || 0))) })} />
              </label>
            </div>
          )}
          {kind === 'currency' && (
            <label className="f" style={{ width: 200 }}>Symbol
              <select className="field" value={f.symbol} onChange={(e) => set({ symbol: e.target.value as NumFormat['symbol'] })}>{CURRENCIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select>
            </label>
          )}
          {kind !== 'text' && kind !== 'scientific' && <label className="chk"><input type="checkbox" checked={f.thousands} onChange={(e) => set({ thousands: e.target.checked })} />Use thousands separator (1,234)</label>}
          {kind !== 'text' && (
            <div className="col" style={{ gap: 4 }} role="radiogroup" aria-label="Negative numbers">
              <span className="lbl">Negative numbers</span>
              {NEGATIVES.map((n) => <label key={n.id} className="chk"><input type="radio" name="nf-neg" checked={f.negative === n.id} onChange={() => set({ negative: n.id })} /><span className="mono" style={{ color: n.id.startsWith('red') ? '#C00000' : undefined }}>{n.label}</span></label>)}
            </div>
          )}
          <div className="col" style={{ gap: 4 }} role="radiogroup" aria-label="Apply to">
            <span className="lbl">Apply to</span>
            <label className="chk"><input type="radio" name="nf-scope" checked={scope === 'selection'} onChange={() => setScope('selection')} />Selected cells</label>
            <label className="chk"><input type="radio" name="nf-scope" checked={scope === 'column'} onChange={() => setScope('column')} />Whole column (all body rows)</label>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export function PromptDialog() {
  const p = useStore((s) => s.prompt);
  const [v, setV] = useState('');
  useEffect(() => { if (p) setV(p.value); }, [p]);
  if (!p) return null;
  return (
    <Dialog title={p.title} onClose={() => p.resolve(null)} footer={<><button className="btn" onClick={() => p.resolve(null)}>Cancel</button><button className="btn btn-pri" onClick={() => p.resolve(v)}>OK</button></>}>
      <label className="f">{p.label}<input className="field" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') p.resolve(v); }} /></label>
    </Dialog>
  );
}

function FilterList({ items, onPick, placeholder, empty }: { items: { key: string; text: string; sub?: string }[]; onPick: (k: string) => void; placeholder: string; empty: string }) {
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const shown = items.filter((i) => !q || `${i.key} ${i.text} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 200);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.querySelector('.hi')?.scrollIntoView({ block: 'nearest' }); }, [hi]);
  return (
    <div className="col" style={{ gap: 6 }}>
      <label className="row" style={{ height: 34, padding: '0 10px', border: '1px solid #D3CDC3', borderRadius: 7, color: 'var(--muted-3)' }}>
        <Search />
        <input autoFocus aria-label={placeholder} placeholder={placeholder} value={q} style={{ border: 0, outline: 'none', flex: 1, fontSize: 13, background: 'transparent', color: 'var(--ink)' }}
          onChange={(e) => { setQ(e.target.value); setHi(0); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
            if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
            if (e.key === 'Enter' && shown[hi]) onPick(shown[hi].key);
          }} />
      </label>
      <div className="pick-list" ref={list} role="listbox">
        {shown.length === 0 && <div className="small muted" style={{ padding: 10 }}>{empty}</div>}
        {shown.map((i, k) => (
          <button key={i.key} role="option" aria-selected={k === hi} className={`pick ${k === hi ? 'hi' : ''}`} onMouseEnter={() => setHi(k)} onClick={() => onPick(i.key)}>
            <span className="grow"><span>{i.text}</span>{i.sub && <div className="small muted ellipsis">{i.sub}</div>}</span>
            <span className="mono" style={{ fontSize: 11, color: 'var(--muted-3)' }}>{i.key}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export function PickerDialog() {
  const kind = useStore((s) => s.picker);
  const bib = useStore((s) => s.bib);
  const labels = useStore((s) => s.labels);
  if (!kind) return null;
  const close = () => setState({ picker: null });
  const pick = (k: string) => {
    close();
    const ed = editorRef.current;
    if (!ed) return;
    if (kind === 'cite') ed.chain().focus().insertContent({ type: 'citation', attrs: { cmd: 'citep', keys: k, opts: '' } }).run();
    else ed.chain().focus().insertContent({ type: 'crossRef', attrs: { cmd: labels.get(k)?.kind === 'equation' ? 'eqref' : 'autoref', key: k } }).run();
  };
  const items = kind === 'cite'
    ? bib.map((b) => ({ key: b.key, text: `${shortAuthor(b.author, b.corporate) || b.key} ${b.year ?? ''}`, sub: b.title }))
    : [...labels.values()].map((l) => ({ key: l.label, text: `${{ section: 'Section', equation: 'Equation', table: 'Table', figure: 'Figure', other: '' }[l.kind]} ${l.number}`, sub: l.title }));
  return (
    <Dialog title={kind === 'cite' ? 'Insert citation' : 'Insert cross-reference'} onClose={close} footer={<button className="btn" onClick={close}>Cancel</button>}>
      <FilterList items={items} onPick={pick} placeholder={kind === 'cite' ? 'Search author, title or key' : 'Search labels'} empty={kind === 'cite' ? 'No bibliography entries. Add them to references.bib.' : 'No labels yet. Give a section, table, figure or equation a label first.'} />
    </Dialog>
  );
}

export function InsertTableDialog() {
  const open = useStore((s) => s.dialog === 'insertTable');
  const [rows, setRows] = useState(4);
  const [cols, setCols] = useState(4);
  const [head, setHead] = useState(1);
  const [style, setStyle] = useState<TableStyle>('booktabs');
  const [hover, setHover] = useState<[number, number] | null>(null);
  if (!open) return null;
  const close = () => setState({ dialog: null });
  const insert = (r = rows, c = cols) => {
    const ed = editorRef.current;
    close();
    if (!ed) return;
    const labels = getState().labels;
    let k = 1;
    while (labels.has(`tab:new-${k}`)) k++;
    insertBlock(ed, newTable(r, c, style, `tab:new-${k}`, head) as unknown as Record<string, unknown>);
  };
  return (
    <Dialog title="Insert table" wide onClose={close} footer={<><button className="btn" onClick={close}>Cancel</button><button className="btn btn-pri" onClick={() => insert()}>Insert {rows} × {cols} table</button></>}>
      <div className="row" style={{ gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div className="col" style={{ gap: 6 }}>
          <span className="lbl">Size</span>
          <div className="tgrid" onMouseLeave={() => setHover(null)} role="grid" aria-label="Table size">
            {Array.from({ length: 8 }, (_, r) => (
              <div key={r} className="row" style={{ gap: 3 }}>
                {Array.from({ length: 10 }, (_, c) => {
                  const on = hover ? r <= hover[0] && c <= hover[1] : r < rows && c < cols;
                  return <button key={c} aria-label={`${r + 1} by ${c + 1}`} className={`tcell ${on ? 'on' : ''}`} onMouseEnter={() => setHover([r, c])} onClick={() => { setRows(r + 1); setCols(c + 1); }} onDoubleClick={() => insert(r + 1, c + 1)} />;
                })}
              </div>
            ))}
          </div>
          <div className="row small"><label className="f">Rows<input className="field" type="number" min={1} max={200} value={rows} onChange={(e) => setRows(Math.max(1, Number(e.target.value)))} style={{ width: 72 }} /></label>
            <label className="f">Columns<input className="field" type="number" min={1} max={30} value={cols} onChange={(e) => setCols(Math.max(1, Number(e.target.value)))} style={{ width: 72 }} /></label>
            <label className="f">Header rows<input className="field" type="number" min={0} max={4} value={head} onChange={(e) => setHead(Math.max(0, Math.min(4, Number(e.target.value))))} style={{ width: 72 }} /></label></div>
        </div>
        <div className="col grow" style={{ gap: 6, minWidth: 240 }}>
          <span className="lbl">Style</span>
          {TABLE_STYLES.map((t) => (
            <button key={t.id} className="opt" aria-pressed={style === t.id} onClick={() => setStyle(t.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <span className={`tstyle-swatch sw-${t.id}`} aria-hidden="true"><i /><i /><i /><i /></span>
              <span className="col" style={{ gap: 0 }}><b style={{ fontWeight: 600 }}>{t.label}</b><span className="small muted">{t.hint}</span></span>
            </button>
          ))}
          <div className="small muted">Merge cells, colour cells and add header levels from the Table toolbar once the table is in the document.</div>
        </div>
      </div>
    </Dialog>
  );
}

const NO_FILES: import('../../shared/types').ProjectFile[] = [];
export function QuickOpen() {
  const open = useStore((s) => s.quickOpen);
  const files = useStore((s) => s.project?.files) ?? NO_FILES;
  if (!open) return null;
  const close = () => setState({ quickOpen: false });
  const textual = files.filter((f) => ['tex', 'bib', 'code', 'text', 'data'].includes(f.kind));
  return (
    <Dialog title="Open file" onClose={close} footer={<span className="small muted grow">.tex, .sty, .cls, .bib, scripts and data files open in the LaTeX pane.</span>}>
      <FilterList items={textual.map((f) => ({ key: f.path, text: f.path.split('/').pop()!, sub: f.path }))} placeholder="Type a file name" empty="No matching files."
        onPick={(k) => { close(); void openTab(k); }} />
    </Dialog>
  );
}

export function ShortcutsDialog() {
  const open = useStore((s) => s.dialog === 'shortcuts');
  if (!open) return null;
  const close = () => setState({ dialog: null });
  return (
    <Dialog title="Keyboard shortcuts" wide onClose={close} footer={<><span className="small muted grow">Shortcuts are fixed so they work the same on every machine.</span><button className="btn btn-pri" onClick={close}>Close</button></>}>
      <ShortcutTable />
    </Dialog>
  );
}

export function ShortcutTable() {
  return (
    <div className="shortcut-grid">
      {SHORTCUTS.map((g) => (
        <section key={g.group}>
          <h3 className="lbl" style={{ margin: '0 0 6px' }}>{g.group}</h3>
          <table className="kbtable"><tbody>
            {g.items.map((it) => <tr key={it.keys + it.action}><td><span className="kbd">{it.keys}</span></td><td>{it.action}</td></tr>)}
          </tbody></table>
        </section>
      ))}
    </div>
  );
}

export function AboutDialog() {
  const open = useStore((s) => s.dialog === 'about');
  const tc = useStore((s) => s.toolchain);
  const [info, setInfo] = useState<Awaited<ReturnType<typeof api.appInfo>> | null>(null);
  useEffect(() => { if (open) void api.appInfo().then(setInfo); }, [open]);
  if (!open) return null;
  const close = () => setState({ dialog: null });
  return (
    <Dialog title="About Quire" onClose={close} footer={<button className="btn btn-pri" onClick={close}>Close</button>}>
      <div className="row" style={{ gap: 14 }}><span className="logo" style={{ width: 44, height: 44, fontSize: 26, borderRadius: 10 }}>Q</span>
        <div><div style={{ fontWeight: 600, fontSize: 15 }}>Quire {info?.version}</div><div className="small muted">Model documentation and validation report studio</div></div></div>
      <dl className="kv" style={{ gridTemplateColumns: '120px 1fr' }}>
        <dt>Electron</dt><dd>{info?.electron}</dd><dt>Chromium</dt><dd>{info?.chrome}</dd><dt>TeX</dt><dd>{tc?.distribution ?? 'not found'}{tc?.texBin ? ` · ${tc.texBin}` : ''}</dd>
        <dt>Python</dt><dd>{tc?.python ?? 'not found'}</dd><dt>Settings folder</dt><dd className="mono small">{info?.userData}</dd>
      </dl>
    </Dialog>
  );
}

const PALETTE: { group: string; items: [string, string][] }[] = [
  { group: 'Structures', items: [['a⁄b', '\\frac{a}{b}'], ['xⁿ', '^{n}'], ['xᵢ', '_{i}'], ['√', '\\sqrt{x}'], ['ⁿ√', '\\sqrt[n]{x}'], ['( )', '\\left( x \\right)'], ['[ ]', '\\left[ x \\right]'], ['| |', '\\left| x \\right|'], ['x̄', '\\bar{x}'], ['x̂', '\\hat{x}'], ['matrix', '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}'], ['cases', '\\begin{cases} a & \\text{if } x > 0 \\\\ b & \\text{otherwise} \\end{cases}'], ['text', '\\text{text}']] },
  { group: 'Operators', items: [['∑', '\\sum_{i=1}^{n}'], ['∏', '\\prod_{i=1}^{n}'], ['∫', '\\int_{a}^{b}'], ['lim', '\\lim_{x \\to \\infty}'], ['∂', '\\partial'], ['∇', '\\nabla'], ['log', '\\log'], ['exp', '\\exp'], ['max', '\\max'], ['𝔼', '\\mathbb{E}'], ['ℙ', '\\Pr'], ['Var', '\\operatorname{Var}']] },
  { group: 'Relations', items: [['=', '='], ['≠', '\\neq'], ['≤', '\\le'], ['≥', '\\ge'], ['≈', '\\approx'], ['≡', '\\equiv'], ['∼', '\\sim'], ['∝', '\\propto'], ['∈', '\\in'], ['⊂', '\\subset'], ['→', '\\to'], ['⇒', '\\Rightarrow'], ['±', '\\pm'], ['×', '\\times'], ['·', '\\cdot'], ['∞', '\\infty']] },
  { group: 'Greek', items: 'alpha beta gamma delta epsilon theta lambda mu pi rho sigma tau phi chi psi omega Gamma Delta Sigma Phi Omega'.split(' ').map((g) => [texToHtml(`\\${g}`, false).html, `\\${g}`] as [string, string]) },
];

/** The large equation editor (double-click an equation, or the expand button). */
export function EquationModal() {
  const m = useStore((s) => s.equationModal);
  const handle = useRef<MathInputHandle | null>(null);
  const [latex, setLatex] = useState('');
  const [original, setOriginal] = useState<{ latex: string; pos: number } | null>(null);
  useEffect(() => {
    const ed = editorRef.current;
    if (!m || !ed) return;
    const n = ed.state.doc.nodeAt(m.pos);
    if (!n || (n.type.name !== 'mathBlock' && n.type.name !== 'inlineMath')) { setState({ equationModal: null }); return; }
    setLatex(n.attrs.latex);
    setOriginal({ latex: n.attrs.latex, pos: m.pos });
  }, [m?.pos]);
  const apply = (v: string) => {
    const ed = editorRef.current;
    if (!ed || !m) return;
    const n = ed.state.doc.nodeAt(m.pos);
    if (!n) return;
    if (n.attrs.latex === v) return;
    const tr = ed.state.tr.setNodeMarkup(m.pos, undefined, { ...n.attrs, latex: v });
    ed.view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, m.pos)));
  };
  useEffect(() => { if (!m) return; const t = setTimeout(() => apply(latex), 200); return () => clearTimeout(t); }, [latex]);
  const preview = useMemo(() => {
    const multi = /\\\\|&/.test(latex) && !/\\begin\{/.test(latex);
    return texToHtml(multi ? `\\begin{aligned}${latex}\\end{aligned}` : latex || '\\square', !m?.inline || true);
  }, [latex, m?.inline]);
  if (!m) return null;
  const close = (keep: boolean) => {
    if (!keep && original) apply(original.latex); else apply(latex);
    setState({ equationModal: null });
    editorRef.current?.commands.focus();
  };
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) close(true); }}>
      <div className="dialog eqmodal" role="dialog" aria-modal="true" aria-label="Equation editor">
        <div className="dialog-head row"><h2 className="grow">{m.inline ? 'Inline math' : 'Equation'}</h2><span className="small muted">Type \ for suggestions · Tab to the next placeholder · Esc to close</span></div>
        <div className="dialog-body" style={{ gap: 10 }}>
          <div className="eq-preview" aria-live="polite" dangerouslySetInnerHTML={{ __html: preview.html }} />
          {preview.error && <div className="small t-fail">Preview: {preview.error.replace(/^KaTeX parse error: /, '')}. LaTeX may still compile it.</div>}
          <div className="row" style={{ alignItems: 'flex-start', gap: 12 }}>
            <div className="grow"><MathInput value={latex} onChange={setLatex} minHeight={180} fontSize={15} autoFocus handleRef={handle} onEscape={() => close(true)} /></div>
            <div className="palette" aria-label="Symbols">
              {PALETTE.map((g) => (
                <div key={g.group}>
                  <div className="lbl" style={{ margin: '4px 0' }}>{g.group}</div>
                  <div className="row wrap" style={{ gap: 3 }}>
                    {g.items.map(([glyph, tex]) => <button key={tex} className="sym" title={tex} aria-label={tex} onClick={() => handle.current?.insert(tex)} dangerouslySetInnerHTML={{ __html: glyph }} />)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <div className="dialog-foot"><button className="btn" onClick={() => close(false)}>Discard changes</button><button className="btn btn-pri" onClick={() => close(true)}>Done</button></div>
      </div>
    </div>
  );
}
