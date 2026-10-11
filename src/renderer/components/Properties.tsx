// Right panel: settings for whatever is selected in the visual editor.
import { useEffect, useMemo, useRef, useState } from 'react';
import { MathInput, type MathInputHandle } from './MathInput';
import { TABLE_STYLES } from '../../shared/latex/table';
import { editorRef } from '../visual/editorRef';
import { texToHtml } from '../visual/nodes';
import { allDiagnostics, api, getRun, gotoSource, guard, mainBlockLines, mainFile, refreshBlock, restoreBlock, setState, unlinkBlock, updateBlockConfig, useStore, latestRun } from '../store';
import { StatusPill, Refresh } from './Icons';
import { parseCsv } from '../../shared/csv';
import { editorBlockLines } from '../visual/VisualEditor';
import { FONT_LABELS } from '../../shared/latex/theme';

function setAttrs(pos: number, patch: Record<string, unknown>) {
  const ed = editorRef.current;
  if (!ed) return;
  const node = ed.state.doc.nodeAt(pos);
  if (!node) return;
  ed.view.dispatch(ed.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...patch }));
}

function Debounced({ value, onCommit, multiline, mono, rows = 3, label, placeholder }: { value: string; onCommit: (v: string) => void; multiline?: boolean; mono?: boolean; rows?: number; label: string; placeholder?: string }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  useEffect(() => { if (v === value) return; const t = setTimeout(() => onCommit(v), 350); return () => clearTimeout(t); }, [v]);
  const cls = `field ${mono ? 'mono' : ''}`;
  return (
    <label className="f">{label}
      {multiline
        ? <textarea className={cls} rows={rows} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} spellCheck={!mono} />
        : <input className={cls} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onCommit(v)} spellCheck={!mono} />}
    </label>
  );
}

const SYMBOLS: [string, string, string][] = [
  ['a⁄b', '\\frac{a}{b}', 'Fraction'], ['∑', '\\sum_{i=1}^{n}', 'Sum'], ['xᵢ', '_{i}', 'Subscript'], ['x²', '^{2}', 'Superscript'],
  ['x̄', '\\bar{x}', 'Bar'], ['√', '\\sqrt{x}', 'Square root'], ['∫', '\\int_{a}^{b}', 'Integral'], ['≤', '\\le', 'Less or equal'],
  ['≈', '\\approx', 'Approximately'], ['α', '\\alpha', 'alpha'], ['β', '\\beta', 'beta'], ['σ', '\\sigma', 'sigma'], ['ℙ', '\\mathbb{P}', 'Probability'], ['E', '\\mathbb{E}', 'Expectation'],
];

function MaxButton({ pos, inline }: { pos: number; inline: boolean }) {
  return (
    <button className="btn btn-q btn-xs" title="Open the large equation editor (or double-click the equation)" aria-label="Maximize equation editor"
      onClick={() => setState({ equationModal: { pos, inline } })}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>Maximize
    </button>
  );
}

function useLiveLatex(pos: number, value: string) {
  const [latex, setLatex] = useState<string>(value ?? '');
  const last = useRef(value);
  useEffect(() => { if (value !== last.current) { last.current = value; setLatex(value ?? ''); } }, [value, pos]);
  useEffect(() => { if (latex === last.current) return; const t = setTimeout(() => { last.current = latex; setAttrs(pos, { latex }); }, 250); return () => clearTimeout(t); }, [latex]);
  return [latex, setLatex] as const;
}

function EquationPanel({ pos, attrs }: { pos: number; attrs: Record<string, any> }) {
  const [latex, setLatex] = useLiveLatex(pos, attrs.latex);
  const handle = useRef<MathInputHandle | null>(null);
  const env: string = attrs.env;
  const multi = /^align|^gather|^multline/.test(env);
  const r = texToHtml(multi ? `\\begin{aligned}${latex}\\end{aligned}` : latex || '\\square', true);
  const numbered = !env.endsWith('*') && env !== 'displaymath';
  return (
    <>
      <div className="sec">
        <div className="lbl">Preview</div>
        <div className="katex-preview" dangerouslySetInnerHTML={{ __html: r.html }} />
        {r.error && <div className="small t-fail">Preview: {r.error.replace(/^KaTeX parse error: /, '')}. LaTeX may still compile it.</div>}
      </div>
      <div className="sec">
        <div className="row"><span className="lbl grow">LaTeX</span><MaxButton pos={pos} inline={false} /></div>
        <div role="toolbar" aria-label="Insert math" className="row wrap" style={{ gap: 4 }}>
          {SYMBOLS.map(([g, sym, n]) => <button key={n} className="sym" aria-label={n} title={`${n}: ${sym}`} onClick={() => handle.current?.insert(sym)}>{g}</button>)}
        </div>
        <MathInput key={pos} value={latex} onChange={setLatex} minHeight={110} handleRef={handle} />
        <div className="small muted">Type \ for suggestions (\su → \sum). Drag the corner to resize. Edits write to the source as you type.</div>
      </div>
      <div className="sec">
        <label className="chk"><input type="checkbox" checked={numbered} onChange={(e) => {
          const base = env.replace(/\*$/, '');
          setAttrs(pos, { env: e.target.checked ? (base === 'displaymath' ? 'equation' : base) : (base === 'displaymath' ? 'displaymath' : `${base}*`) });
        }} />Numbered</label>
        <label className="f">Environment<select className="field" value={env.replace(/\*$/, '')} onChange={(e) => setAttrs(pos, { env: e.target.value + (numbered ? '' : '*') })}>
          <option value="equation">equation</option><option value="align">align (multi-line, use &amp; and \\)</option><option value="gather">gather</option>
        </select></label>
        {numbered && <Debounced label="Label" mono value={attrs.label ?? ''} onCommit={(v) => setAttrs(pos, { label: v.trim() })} placeholder="eq:name" />}
        {numbered && <RefCount label={attrs.label} />}
      </div>
    </>
  );
}

function InlineMathPanel({ pos, attrs }: { pos: number; attrs: Record<string, any> }) {
  const [latex, setLatex] = useLiveLatex(pos, attrs.latex);
  const r = texToHtml(latex || '\\square', false);
  return (
    <div className="sec">
      <div className="row"><span className="lbl grow">Inline math</span><MaxButton pos={pos} inline /></div>
      <div className="katex-preview" dangerouslySetInnerHTML={{ __html: r.html }} />
      <MathInput key={pos} value={latex} onChange={setLatex} minHeight={56} />
      <div className="small muted">Type \ for suggestions.</div>
    </div>
  );
}

function TablePanel({ pos, attrs }: { pos: number; attrs: Record<string, any> }) {
  const cols: string[] = String(attrs.cols || '').split(/\s+/).filter(Boolean);
  const set = (p: Record<string, unknown>) => setAttrs(pos, p);
  const floating = attrs.env !== 'none';
  return (
    <>
      <div className="sec">
        <div className="lbl">Style</div>
        <div className="col" style={{ gap: 4 }}>
          {TABLE_STYLES.map((t) => (
            <label key={t.id} className="chk" title={t.hint}><input type="radio" name="tstyle" checked={(attrs.style ?? 'booktabs') === t.id} onChange={() => set({ style: t.id })} /><span><b style={{ fontWeight: 500 }}>{t.label}</b> <span className="small muted">— {t.hint}</span></span></label>
          ))}
        </div>
        <label className="chk"><input type="checkbox" checked={attrs.size === 'small'} onChange={(e) => set({ size: e.target.checked ? 'small' : '' })} />Smaller font</label>
      </div>
      <div className="sec">
        <div className="lbl">Columns</div>
        <div className="row wrap" style={{ gap: 4 }}>
          {cols.map((c, i) => (
            <select key={i} className="field" aria-label={`Column ${i + 1} alignment`} style={{ width: 64, height: 28 }} value={/^[lcr]$/.test(c) ? c : 'l'}
              onChange={(e) => { const n = [...cols]; n[i] = e.target.value; set({ cols: n.join(' ') }); }}>
              <option value="l">{i + 1}: L</option><option value="c">{i + 1}: C</option><option value="r">{i + 1}: R</option>
            </select>
          ))}
        </div>
        <div className="small muted">Merge cells by dragging across them, then Merge cells in the table toolbar or right-click menu. Header rows above the first rule print as the table head; merged header cells get a partial rule underneath (multi-level headers).</div>
      </div>
      <div className="sec">
        <div className="lbl">Caption and label</div>
        <label className="chk"><input type="checkbox" checked={floating} onChange={(e) => set({ env: e.target.checked ? 'table' : 'none' })} />Numbered table with caption (float)</label>
        {floating && <>
          <Debounced label="Caption" multiline value={attrs.caption ?? ''} onCommit={(v) => set({ caption: v })} />
          <Debounced label="Label" mono value={attrs.label ?? ''} onCommit={(v) => set({ label: v.trim() })} placeholder="tab:name" />
          <RefCount label={attrs.label} />
          <label className="f">Caption position<select className="field" value={attrs.captionPos === 'bottom' ? 'bottom' : 'top'} onChange={(e) => set({ captionPos: e.target.value })}><option value="top">Above the table</option><option value="bottom">Below the table</option></select></label>
          <label className="f">Placement<select className="field" value={attrs.placement ?? 'htbp'} onChange={(e) => set({ placement: e.target.value })}><option value="htbp">Best fit (htbp)</option><option value="t">Top of page</option><option value="H">Here (needs float)</option><option value="">Default</option></select></label>
          <label className="chk"><input type="checkbox" checked={attrs.env === 'table*'} onChange={(e) => set({ env: e.target.checked ? 'table*' : 'table' })} />Span both columns (two-column layouts)</label>
        </>}
      </div>
    </>
  );
}

function GeneratedPanel({ id }: { id: string }) {
  const cfg = useStore((s) => s.project?.manifest.blocks[id]);
  const render = useStore((s) => s.renders[id]);
  const runCache = useStore((s) => s.runCache);
  const [header, setHeader] = useState<string[]>([]);
  const latest = latestRun();
  useEffect(() => {
    if (!cfg || cfg.kind !== 'table' || !cfg.run || !cfg.source) return;
    void api.readText(useStoreRoot(), `runs/${cfg.run}/${cfg.source}`).then((t) => setHeader(parseCsv(t).header)).catch(() => setHeader([]));
    void getRun(cfg.run);
  }, [cfg?.run, cfg?.source]);
  if (!cfg) return <div className="sec"><div className="muted">This generated block has no entry in quire.json.</div></div>;
  const rec = cfg.run ? runCache[cfg.run] : null;
  const st = render?.status ?? 'pending';
  const shown = cfg.columns?.length ? cfg.columns : header;
  const u = (p: Parameters<typeof updateBlockConfig>[1]) => void updateBlockConfig(id, p);
  return (
    <>
      <div className="sec">
        <div className="row"><div className="grow"><div className="lbl">Generated {cfg.kind}</div><div style={{ fontWeight: 600, fontSize: 14 }}>{cfg.label || id}</div></div>
          {st === 'fresh' ? <StatusPill status="passed" label="Up to date" /> : st === 'stale' ? <StatusPill status="warning" label="Stale" /> : st === 'pending' ? <StatusPill status="skipped" label="Pending" /> : <StatusPill status="failed" label={st === 'missing' ? 'Missing' : 'Edited'} />}
        </div>
        {render?.message && st !== 'fresh' && <div className="small t-warn">{render.message}</div>}
      </div>
      {(st === 'conflict' || st === 'edited') && (
        <div className="sec" style={{ background: '#FCF1EE' }}>
          <b style={{ color: '#82260F' }}>Hand edits detected</b>
          <div className="small">{render?.message} Keep your edit as static LaTeX, or restore the generated version.</div>
          <div className="row wrap"><button className="btn btn-sm" onClick={() => void unlinkBlock(id)}>Keep edit (unlink)</button><button className="btn btn-sm btn-pri" onClick={() => void restoreBlock(id)}>Restore generated</button></div>
        </div>
      )}
      <div className="sec">
        <div className="lbl">Data source</div>
        <dl className="kv">
          <dt>Run</dt><dd>{cfg.run ? <button className="btn btn-q btn-xs" onClick={() => setState({ view: 'tests', selectedRun: cfg.run, selectedTest: cfg.testIds[0] ?? null })}>#{cfg.run}</button> : 'none yet'}{rec ? ` · ${rec.meta.suite}` : ''}</dd>
          {rec && <><dt>Executed</dt><dd>{new Date(rec.meta.startedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</dd></>}
          {cfg.source && <><dt>Output</dt><dd className="mono" style={{ fontSize: 11.5 }}>{cfg.source}</dd></>}
          {cfg.testIds.length > 0 && <><dt>Tests</dt><dd>{cfg.testIds.length} linked{rec?.results ? ` · ${rec.results.tests.filter((t) => cfg.testIds.includes(t.id) && t.status === 'failed').length} failed` : ''}</dd></>}
        </dl>
        <div className="row wrap">
          <button className="btn btn-sm" disabled={!latest} onClick={() => void refreshBlock(id)}><Refresh />Refresh from #{latest?.number ?? '—'}</button>
          <button className="btn btn-sm" onClick={() => { const l = mainBlockLines(); const idx = editorBlockLines().findIndex(Boolean); void idx; gotoSource(`generated/${id}.tex`, 1); void l; }}>View LaTeX</button>
        </div>
        <label className="chk"><input type="checkbox" checked={cfg.followLatest} onChange={(e) => u({ followLatest: e.target.checked })} />Follow the latest run (refresh before compile)</label>
      </div>
      {cfg.kind === 'table' && (
        <>
          <div className="sec">
            <div className="row" style={{ justifyContent: 'space-between' }}><span className="lbl">Columns</span><span className="small muted">{shown.filter((c) => !(cfg.hiddenColumns ?? []).includes(c)).length} of {header.length || shown.length}</span></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 8px' }}>
              {(header.length ? header : shown).map((c) => (
                <label key={c} className="chk"><input type="checkbox" checked={!(cfg.hiddenColumns ?? []).includes(c) && (!cfg.columns?.length || cfg.columns.includes(c))}
                  onChange={(e) => {
                    const hidden = new Set(cfg.hiddenColumns ?? []);
                    if (e.target.checked) hidden.delete(c); else hidden.add(c);
                    const cols = cfg.columns?.length && !cfg.columns.includes(c) && e.target.checked ? [...cfg.columns, c] : cfg.columns;
                    u({ hiddenColumns: [...hidden], columns: cols });
                  }} />{c}</label>
              ))}
            </div>
          </div>
          <div className="sec">
            <div className="lbl">Format</div>
            <div className="seg" role="group" aria-label="Table style" style={{ alignSelf: 'flex-start' }}>
              {(['booktabs', 'grid', 'minimal'] as const).map((s) => <button key={s} aria-pressed={(cfg.style ?? 'booktabs') === s} onClick={() => u({ style: s })}>{s[0].toUpperCase() + s.slice(1)}</button>)}
            </div>
            <label className="f">Decimals<select className="field" value={cfg.decimals ?? 2} onChange={(e) => u({ decimals: Number(e.target.value) })}>{[0, 1, 2, 3, 4].map((d) => <option key={d} value={d}>{d}</option>)}</select></label>
            <label className="f">Show as percent
              <select className="field" multiple size={Math.min(5, header.length || 3)} value={cfg.percentColumns ?? []} onChange={(e) => u({ percentColumns: [...e.target.selectedOptions].map((o) => o.value) })}>
                {header.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            </label>
            <div className="row" style={{ gap: 6 }}>
              <label className="f grow">Shade rows where<select className="field" value={cfg.highlight?.column ?? ''} onChange={(e) => u({ highlight: e.target.value ? { column: e.target.value, equals: cfg.highlight?.equals ?? 'Fail' } : null })}><option value="">— none —</option>{header.map((h) => <option key={h}>{h}</option>)}</select></label>
              {cfg.highlight && <Debounced label="equals" value={cfg.highlight.equals} onCommit={(v) => u({ highlight: { column: cfg.highlight!.column, equals: v } })} />}
            </div>
            <label className="chk"><input type="checkbox" checked={cfg.totalRow !== false} onChange={(e) => u({ totalRow: e.target.checked })} />Include total row</label>
            <label className="chk"><input type="checkbox" checked={cfg.sourceLine !== false} onChange={(e) => u({ sourceLine: e.target.checked })} />Print source line under table</label>
            <label className="chk"><input type="checkbox" checked={!!cfg.fitWidth} onChange={(e) => u({ fitWidth: e.target.checked })} />Shrink to text width</label>
          </div>
        </>
      )}
      {cfg.kind === 'summary' && (
        <div className="sec">
          <Debounced label="Wording (LaTeX, with {{test.id.value}} placeholders)" multiline rows={6} mono value={cfg.template ?? ''} onCommit={(v) => u({ template: v })} />
          <div className="small muted">Fields: value, status, threshold, metric, notes, details.KEY. Values update from each run; the wording stays yours.</div>
        </div>
      )}
      {cfg.kind === 'figure' && (
        <div className="sec">
          <Debounced label="Width" mono value={cfg.width ?? '0.85\\linewidth'} onCommit={(v) => u({ width: v })} />
        </div>
      )}
      {cfg.kind !== 'summary' && (
        <div className="sec">
          <div className="lbl">Caption and label</div>
          <Debounced label="Caption" multiline value={cfg.caption ?? ''} onCommit={(v) => u({ caption: v })} />
          <Debounced label="Label" mono value={cfg.label ?? ''} onCommit={(v) => u({ label: v.trim() })} />
          <RefCount label={cfg.label} />
        </div>
      )}
      <div className="sec">
        <div className="lbl">Ownership</div>
        <div className="small muted">Values come from the run. To change numbers by hand, convert to static LaTeX; it then stops updating.</div>
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => void unlinkBlock(id)}>Convert to static LaTeX…</button>
      </div>
    </>
  );
}

let rootCache = '';
function useStoreRoot() { return rootCache; }

function RefCount({ label }: { label?: string }) {
  const text = useStore((s) => s.files[mainFile()]?.text ?? '');
  const n = useMemo(() => (label ? (text.match(new RegExp(`\\\\(?:ref|eqref|autoref|cref|Cref)\\{${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g')) ?? []).length : 0), [text, label]);
  if (!label) return null;
  return <div className="small muted">Referenced {n}× in the text</div>;
}

function InlinePanel({ inline }: { inline: { type: string; attrs: Record<string, any>; pos: number } }) {
  const bib = useStore((s) => s.bib);
  const labels = useStore((s) => s.labels);
  const a = inline.attrs;
  const set = (p: Record<string, unknown>) => setAttrs(inline.pos, p);
  if (inline.type === 'citation') {
    const keys = String(a.keys).split(',').map((k) => k.trim()).filter(Boolean);
    return (
      <div className="sec">
        <div className="lbl">Citation</div>
        <label className="f">Style<select className="field" value={a.cmd} onChange={(e) => set({ cmd: e.target.value })}>
          <option value="citep">Parenthetical — [Tasche 2013]</option><option value="citet">Textual — Tasche (2013)</option><option value="cite">Plain \cite</option>
        </select></label>
        <Debounced label="Keys (comma separated)" mono value={a.keys} onCommit={(v) => set({ keys: v.replace(/\s+/g, '') })} />
        <Debounced label="Page or note (optional)" mono value={(/^\[([^\]]*)\]$/.exec(a.opts ?? '')?.[1]) ?? ''} onCommit={(v) => set({ opts: v ? `[${v}]` : '' })} placeholder="p.~4" />
        {keys.map((k) => { const b = bib.find((x) => x.key === k); return <div key={k} className="small" style={{ color: b ? 'var(--muted)' : 'var(--warn-ink)' }}><span className="mono">{k}</span> — {b ? b.title : 'not in bibliography'}</div>; })}
      </div>
    );
  }
  if (inline.type === 'crossRef') {
    return (
      <div className="sec">
        <div className="lbl">Cross-reference</div>
        <label className="f">Target<select className="field mono" value={a.key} onChange={(e) => set({ key: e.target.value })}>
          {!labels.has(a.key) && <option value={a.key}>{a.key} (missing)</option>}
          {[...labels.values()].map((l) => <option key={l.label} value={l.label}>{l.label}</option>)}
        </select></label>
        <label className="f">Form<select className="field" value={a.cmd} onChange={(e) => set({ cmd: e.target.value })}>
          <option value="autoref">Name and number — Table 5.3</option><option value="ref">Number only — 5.3</option><option value="eqref">Equation — (5.2)</option><option value="pageref">Page number</option>
        </select></label>
      </div>
    );
  }
  if (inline.type === 'footnote') return <div className="sec"><div className="lbl">Footnote</div><Debounced label="Text (LaTeX)" multiline rows={4} value={a.latex} onCommit={(v) => set({ latex: v })} /></div>;
  if (inline.type === 'inlineMath') return <InlineMathPanel pos={inline.pos} attrs={a} />;
  return <div className="sec"><div className="lbl">LaTeX command</div><Debounced label="Source" mono value={a.latex} onCommit={(v) => set({ latex: v })} /><div className="small muted">Shown as source because the visual editor does not model this command.</div></div>;
}

function DocumentPanel() {
  const project = useStore((s) => s.project)!;
  const text = useStore((s) => s.files[mainFile()]?.text ?? '');
  const labels = useStore((s) => s.labels);
  const lastCompile = useStore((s) => s.lastCompile);
  const words = useMemo(() => text.replace(/\\[a-zA-Z]+|[{}%$]/g, ' ').split(/\s+/).filter((w) => /[a-zA-Z]/.test(w)).length, [text]);
  const t = project.manifest.theme;
  const diag = allDiagnostics();
  return (
    <>
      <div className="sec"><div className="lbl">Document</div>
        <dl className="kv"><dt>Main file</dt><dd className="mono">{project.manifest.mainFile}</dd><dt>Engine</dt><dd>{project.manifest.engine}</dd><dt>Words</dt><dd>~{words.toLocaleString()}</dd><dt>Labels</dt><dd>{labels.size}</dd><dt>Pages</dt><dd>{lastCompile?.pages ?? '—'}</dd><dt>Issues</dt><dd>{diag.length}</dd></dl>
      </div>
      <div className="sec"><div className="lbl">Page and type</div>
        <div className="small">{t.paper === 'a4' ? 'A4' : 'US Letter'} · {t.fontSize} pt {FONT_LABELS[t.bodyFont]} · margins {t.margins.top} / {t.margins.inner}</div>
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => setState({ view: 'setup' })}>Document setup…</button>
      </div>
      <div className="sec"><div className="lbl">Tips</div>
        <div className="small muted">Select an equation, table, citation or reference to edit its settings here. Type <span className="mono">$x$</span> for inline math. Anything the visual editor cannot represent stays as LaTeX you can edit in the source view (Ctrl+2).</div>
      </div>
    </>
  );
}

export function Properties() {
  const sel = useStore((s) => s.selection);
  const project = useStore((s) => s.project);
  rootCache = project?.root ?? '';
  const titleFor: Record<string, string> = { heading: 'Heading', paragraph: 'Paragraph', mathBlock: 'Equation', generatedBlock: 'Generated content', figureBlock: 'Figure', rawBlock: 'LaTeX block', tableBlock: 'Table', calloutBlock: 'Callout', codeBlock: 'Code block', bulletList: 'List', orderedList: 'Numbered list', pageBreak: 'Page break' };
  let body: React.ReactNode;
  if (!sel) body = <DocumentPanel />;
  else if (sel.inline) body = <InlinePanel inline={sel.inline} />;
  else {
    const a = sel.attrs;
    switch (sel.type) {
      case 'mathBlock': body = <EquationPanel pos={sel.pos} attrs={a} />; break;
      case 'generatedBlock': body = <GeneratedPanel id={a.id} />; break;
      case 'tableBlock': body = <TablePanel pos={sel.pos} attrs={a} />; break;
      case 'heading':
        body = (
          <div className="sec">
            <label className="f">Level<select className="field" value={a.level} onChange={(e) => setAttrs(sel.pos, { level: Number(e.target.value), cmd: null })}><option value={1}>Section</option><option value={2}>Subsection</option><option value={3}>Subsubsection</option></select></label>
            <label className="chk"><input type="checkbox" checked={!a.star} onChange={(e) => setAttrs(sel.pos, { star: !e.target.checked })} />Numbered</label>
            <Debounced label="Label" mono value={a.label ?? ''} onCommit={(v) => setAttrs(sel.pos, { label: v.trim() })} placeholder="sec:name" />
            <RefCount label={a.label} />
          </div>
        );
        break;
      case 'figureBlock':
        body = (
          <div className="sec">
            <div className="row"><Debounced label="File" mono value={a.path} onCommit={(v) => setAttrs(sel.pos, { path: v })} /></div>
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={async () => {
              const f = await api.chooseFile('Choose a figure', [{ name: 'Figures', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }]);
              if (!f || !project) return;
              const rel = await guard(() => api.importAsset(project.root, f, 'figures'));
              if (rel) setAttrs(sel.pos, { path: rel });
            }}>Choose file…</button>
            <Debounced label="Caption" multiline value={a.caption} onCommit={(v) => setAttrs(sel.pos, { caption: v })} />
            <Debounced label="Label" mono value={a.label} onCommit={(v) => setAttrs(sel.pos, { label: v.trim() })} />
            <Debounced label="Width" mono value={a.width} onCommit={(v) => setAttrs(sel.pos, { width: v })} />
            <label className="f">Placement<select className="field" value={a.placement} onChange={(e) => setAttrs(sel.pos, { placement: e.target.value })}><option value="htbp">Best fit (htbp)</option><option value="t">Top of page</option><option value="H">Here (needs float)</option><option value="">Default</option></select></label>
          </div>
        );
        break;
      case 'rawBlock':
        body = (
          <div className="sec">
            <div className="small muted">The visual editor shows this LaTeX as source and keeps it exactly as written.</div>
            <Debounced label="LaTeX" multiline rows={12} mono value={a.latex} onCommit={(v) => setAttrs(sel.pos, { latex: v })} />
            <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={() => { const l = editorBlockLines()[sel.index]; gotoSource(mainFile(), l?.[0] ?? 1); }}>Open in source</button>
          </div>
        );
        break;
      case 'calloutBlock':
        body = <div className="sec"><Debounced label="Title" value={a.title} onCommit={(v) => setAttrs(sel.pos, { title: v })} /><div className="small muted">Prints as a shaded box using the callout colour from Document setup.</div></div>;
        break;
      case 'codeBlock':
        body = <div className="sec"><label className="f">Language<select className="field" value={a.language ?? ''} onChange={(e) => setAttrs(sel.pos, { language: e.target.value })}>{['', 'Python', 'R', 'SQL', 'C++', 'Java', 'bash'].map((l) => <option key={l} value={l}>{l || 'Plain text'}</option>)}</select></label><div className="small muted">Printed with listings: line numbers, monospace, wrapped lines.</div></div>;
        break;
      default:
        body = <DocumentPanel />;
    }
  }
  return (
    <div className="col" style={{ gap: 0, flex: 1, minHeight: 0 }} aria-label="Selection properties">
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--rule-2)' }}>
        <div className="lbl">{sel ? (sel.inline ? 'Inline element' : 'Selection') : 'Nothing selected'}</div>
        <div style={{ fontWeight: 600, fontSize: 14 }}>{sel ? (sel.inline ? ({ citation: 'Citation', crossRef: 'Cross-reference', footnote: 'Footnote', inlineMath: 'Inline math', inlineRaw: 'LaTeX command' } as Record<string, string>)[sel.inline.type] : titleFor[sel.type] ?? sel.type) : 'Document'}</div>
        {sel && !sel.inline && <button className="btn btn-q btn-xs" style={{ marginTop: 4, paddingLeft: 0 }} onClick={() => { const l = editorBlockLines()[sel.index]; if (l) gotoSource(mainFile(), l[0]); }}>Source: lines {(() => { const l = editorBlockLines()[sel.index]; return l ? `${l[0]}–${l[1]}` : '—'; })()}</button>}
      </div>
      <div className="scroll" style={{ flex: 1 }}>{body}</div>
    </div>
  );
}

void mainBlockLines;
