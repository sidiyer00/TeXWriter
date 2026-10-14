// Insert → Generated table / Generated figure: add a block that TeXWriter builds from a file.
// The file comes from a script paired with the block (a new one from a runnable example, or
// one already in the project), or from somewhere else — a model's output or a data export
// that another program keeps up to date. Either way the document gets
//   % texwriter:generated id=…  \input{generated/<id>.tex}  % texwriter:end
// and the table or figure is rebuilt whenever the file changes.
import { useEffect, useMemo, useState } from 'react';
import { api, createGeneratedBlock, getState, guard, setState, uniqueBlockId, useStore } from '../store';
import { Dialog } from './Chrome';
import { editorRef } from '../visual/editorRef';
import { insertBlock } from '../commands';
import { flushVisual } from '../visual/VisualEditor';
import { AssetPreview, TablePreview } from '../visual/nodes';
import { preferredTableStyle } from '../visual/clipboard';
import { FIGURE_OUTPUTS, TABLE_OUTPUTS, defaultCommand, defaultOutput, renderGenerated, type ScriptLanguage } from '../../shared/generate';
import { gridToTableBlock, guessHeaderRows, spanRows, textRows } from '../../shared/latex/grid';
import { TABLE_SIZES, TABLE_STYLES, type TableStyle } from '../../shared/latex/table';
import { decodeFormat, encodeFormat, defaultFormat, type NumKind } from '../../shared/latex/numfmt';
import type { GeneratedBlockConfig } from '../../shared/types';

const SCRIPT_EXT = /\.(py|r|jl|js|mjs|sh|ps1|m|bat|cmd)$/i;
const close = () => setState({ dialog: null, generatedInit: null });
const extOf = (p: string) => (/\.([A-Za-z0-9]+)$/.exec(p)?.[1] ?? '').toLowerCase();

/** Number-format choices for generated tables: as written, or Excel-style kinds with decimals. */
export function NumberChoice({ value, onChange }: { value: string | undefined; onChange: (v: string | undefined) => void }) {
  const f = decodeFormat(value);
  const kind: NumKind | 'asis' = f?.kind ?? 'asis';
  const set = (k: NumKind | 'asis', digits = f?.digits ?? 2, thousands = f?.thousands ?? true) => {
    if (k === 'asis') return onChange(undefined);
    onChange(encodeFormat({ ...defaultFormat(k), digits: k === 'integer' ? 0 : digits, thousands }));
  };
  return (
    <div className="row" style={{ gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
      <label className="f">Numbers
        <select className="field" value={kind} onChange={(e) => set(e.target.value as NumKind | 'asis')}>
          <option value="asis">As written in the file</option>
          <option value="number">Number</option><option value="integer">Integer</option><option value="percent">Percentage</option><option value="currency">Currency ($)</option><option value="scientific">Scientific</option>
        </select>
      </label>
      {f && f.kind !== 'integer' && (
        <label className="f" style={{ width: 90 }}>Decimals
          <select className="field" value={f.digits} onChange={(e) => set(f.kind, Number(e.target.value))}>{[0, 1, 2, 3, 4, 5, 6].map((d) => <option key={d} value={d}>{d}</option>)}</select>
        </label>
      )}
      {f && f.kind !== 'scientific' && <label className="chk"><input type="checkbox" checked={f.thousands} onChange={(e) => set(f.kind, f.digits, e.target.checked)} />1,234</label>}
    </div>
  );
}

export const FIGURE_WIDTHS = ['0.5\\linewidth', '0.6\\linewidth', '0.7\\linewidth', '0.8\\linewidth', '0.9\\linewidth', '\\linewidth'];

export function GeneratedDialog() {
  const open = useStore((s) => s.dialog === 'generated');
  return open && getState().project ? <GeneratedBody /> : null;
}

type Mode = 'new' | 'script' | 'file';

function GeneratedBody() {
  const project = useStore((s) => s.project)!;
  const init = useStore((s) => s.generatedInit) ?? { kind: 'table' as const, mode: 'new' as const };
  const [kind, setKind] = useState<'table' | 'figure'>(init.kind);
  const [mode, setMode] = useState<Mode>(init.mode);
  const [lang, setLang] = useState<ScriptLanguage>('python');
  const [label, setLabel] = useState('');
  const [caption, setCaption] = useState('');
  const [script, setScript] = useState(init.mode === 'script' ? init.file ?? '' : '');
  const [output, setOutput] = useState(init.mode === 'file' ? init.file ?? '' : '');
  const [outputTouched, setOutputTouched] = useState(init.mode === 'file' && !!init.file);
  const [command, setCommand] = useState('');
  const [runNow, setRunNow] = useState(true);
  const [linked, setLinked] = useState(true);
  // table options
  const [headerRows, setHeaderRows] = useState<number | undefined>(undefined);
  const [style, setStyle] = useState<TableStyle>(preferredTableStyle());
  const [numberFormat, setNumberFormat] = useState<string | undefined>(undefined);
  const [size, setSize] = useState('');
  const [width, setWidth] = useState('0.8\\linewidth');
  const [text, setText] = useState<string | null>(null);
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);

  const scripts = project.files.filter((f) => SCRIPT_EXT.test(f.path));
  // files a block can be built from (LaTeX tables only from outputs/, so document sources aren't offered)
  const outputs = project.files.filter((f) => {
    const e = extOf(f.path);
    if (f.path.startsWith('generated/')) return false;
    if (kind === 'figure') return FIGURE_OUTPUTS.includes(e);
    return e === 'tex' ? f.path.startsWith('outputs/') : TABLE_OUTPUTS.includes(e);
  });

  // the label names the block: tab:sales-by-region → id tab_sales_by_region, scripts/tab_sales_by_region.py
  const base = (label || (kind === 'table' ? 'tab:new' : 'fig:new')).replace(/^(tab|fig):/, '');
  const id = useMemo(() => uniqueBlockId(`${kind === 'table' ? 'tab' : 'fig'}_${base}`), [kind, base]);
  useEffect(() => {
    if (!label) {
      const stem = (init.file ?? '').split('/').pop()?.replace(/\.[^.]+$/, '');
      setLabel(`${kind === 'table' ? 'tab' : 'fig'}:${stem ? stem.toLowerCase().replace(/[^a-z0-9]+/g, '-') : 'new'}`);
    } else if (/^(tab|fig):/.test(label)) setLabel(label.replace(/^(tab|fig):/, kind === 'table' ? 'tab:' : 'fig:'));
  }, [kind]);
  const newScript = `scripts/${id}.${lang === 'python' ? 'py' : 'R'}`;
  const effOutput = mode === 'file' ? output : outputTouched ? output : defaultOutput(id, kind);
  const effScript = mode === 'new' ? newScript : mode === 'script' ? script : undefined;

  // preview what is there already
  useEffect(() => {
    setText(null); setExists(false);
    if (!effOutput) return;
    void api.statFile(project.root, effOutput).then((st) => {
      setExists(!!st);
      if (st && kind === 'table') void api.readText(project.root, effOutput).then(setText).catch(() => setText(null));
    });
  }, [effOutput, kind]);

  const cfg: GeneratedBlockConfig = {
    id, kind, output: effOutput, ...(effScript ? { script: effScript } : {}), ...(command.trim() && mode === 'script' ? { command: command.trim() } : {}),
    caption, label, ...(kind === 'table' ? { headerRows, tableStyle: style, numberFormat, size } : { width }),
  };
  const preview = useMemo(() => {
    if (!exists || (kind === 'table' && text === null)) return null;
    try { return renderGenerated(cfg, text); } catch (e) { return { error: (e as Error).message }; }
  }, [exists, text, kind, headerRows, style, numberFormat, size, caption, label, effOutput]);

  const importFile = async (what: 'script' | 'output') => {
    const exts = what === 'script' ? ['py', 'R', 'jl', 'js', 'sh', 'ps1', 'm'] : kind === 'table' ? ['csv', 'tsv', 'txt', 'tex'] : FIGURE_OUTPUTS;
    const abs = await api.chooseFile(what === 'script' ? 'Choose a script' : 'Choose the output file', [{ name: what === 'script' ? 'Scripts' : 'Files', extensions: exts }]);
    if (!abs) return;
    const rel = await guard(() => api.importAsset(project.root, abs, what === 'script' ? 'scripts' : kind === 'table' ? 'data' : 'figures'), 'Could not copy the file');
    if (!rel) return;
    const pr = await api.reloadProject(project.root);
    setState((s) => ({ project: s.project ? { ...s.project, files: pr.files } : s.project }));
    if (what === 'script') setScript(rel); else { setOutput(rel); setOutputTouched(true); }
  };

  const ok = !!effOutput && !!label && (mode !== 'script' || !!script);
  const insert = async () => {
    setBusy(true);
    try {
      flushVisual();
      if (mode === 'file' && !linked && kind === 'table' && text !== null) {
        // convert once into an ordinary table
        const rows = textRows(text);
        const g = spanRows(rows, headerRows ?? guessHeaderRows(rows));
        const ed = editorRef.current;
        if (ed) insertBlock(ed, gridToTableBlock(g, { style, caption, label, size, format: decodeFormat(numberFormat) }) as unknown as Record<string, unknown>);
      } else {
        await createGeneratedBlock(cfg, getState().selection?.index ?? null, { starter: mode === 'new' ? lang : undefined, run: mode !== 'file' && runNow });
      }
      close();
    } finally { setBusy(false); }
  };

  const title = `New generated ${kind}`;
  return (
    <Dialog title={title} wide onClose={close} footer={<>
      <span className="small muted grow">Inserted as <span className="mono">\input{'{'}generated/{id}.tex{'}'}</span>; rebuilt whenever <span className="mono">{effOutput || 'the output'}</span> changes.</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-pri" disabled={!ok || busy} onClick={() => void insert()}>{busy ? 'Working…' : mode !== 'file' && runNow ? `Insert and run` : `Insert ${kind}`}</button>
    </>}>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <div className="seg" role="group" aria-label="Kind">
          <button aria-pressed={kind === 'table'} onClick={() => setKind('table')}>Table</button>
          <button aria-pressed={kind === 'figure'} onClick={() => setKind('figure')}>Figure</button>
        </div>
        <label className="f" style={{ width: 230 }} title="Used by \ref and \autoref">Label<input className="field mono" value={label} onChange={(e) => setLabel(e.target.value.trim())} /></label>
        <label className="f grow">Caption<input className="field" value={caption} placeholder={kind === 'table' ? 'What the table shows.' : 'What the figure shows.'} onChange={(e) => setCaption(e.target.value)} /></label>
      </div>

      <div className="col" style={{ gap: 6 }} role="radiogroup" aria-label="Where it comes from">
        <span className="lbl">Where it comes from</span>
        <label className="chk"><input type="radio" name="gen-mode" checked={mode === 'new'} onChange={() => setMode('new')} /><span><b style={{ fontWeight: 600 }}>A new script</b> <span className="small muted">— TeXWriter writes a runnable example to start from</span></span></label>
        {mode === 'new' && (
          <div className="row wrap gen-indent" style={{ gap: 12, alignItems: 'flex-end' }}>
            <div className="seg" role="group" aria-label="Language"><button aria-pressed={lang === 'python'} onClick={() => setLang('python')}>Python</button><button aria-pressed={lang === 'r'} onClick={() => setLang('r')}>R</button></div>
            <span className="small">Script <span className="mono">{newScript}</span> writes <span className="mono">{effOutput}</span></span>
          </div>
        )}
        <label className="chk"><input type="radio" name="gen-mode" checked={mode === 'script'} onChange={() => setMode('script')} /><span><b style={{ fontWeight: 600 }}>A script in the project</b> <span className="small muted">— Python, R, Julia, a shell script… anything that writes a file</span></span></label>
        {mode === 'script' && (
          <div className="col gen-indent" style={{ gap: 8 }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <label className="f grow">Script<select className="field mono" value={script} onChange={(e) => setScript(e.target.value)}>
                <option value="">Choose a script…</option>
                {scripts.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
              </select></label>
              <button className="btn" onClick={() => void importFile('script')}>Import…</button>
            </div>
            <div className="row" style={{ gap: 8 }}>
              <label className="f grow">It writes<input className="field mono" value={effOutput} onChange={(e) => { setOutput(e.target.value.trim()); setOutputTouched(true); }} /></label>
              <label className="f grow">Command <span className="small muted">(optional)</span><input className="field mono" value={command} placeholder={script ? defaultCommand(script) : '{python} "{script}"'} onChange={(e) => setCommand(e.target.value)} /></label>
            </div>
            <div className="small muted">The script runs in the project folder; <span className="mono">TEXWRITER_OUTPUT</span> holds the absolute path of the file to write. {kind === 'table' ? 'Tables: CSV/TSV (styled by TeXWriter) or a .tex tabular.' : 'Figures: PDF, PNG or JPG.'}</div>
          </div>
        )}
        <label className="chk"><input type="radio" name="gen-mode" checked={mode === 'file'} onChange={() => setMode('file')} /><span><b style={{ fontWeight: 600 }}>A file, no script</b> <span className="small muted">— a model's output or data export another program keeps up to date</span></span></label>
        {mode === 'file' && (
          <div className="col gen-indent" style={{ gap: 6 }}>
            <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
              <label className="f grow">File<select className="field mono" value={output} onChange={(e) => { setOutput(e.target.value); setOutputTouched(true); }}>
                <option value="">Choose a file…</option>
                {output && !outputs.some((f) => f.path === output) && <option value={output}>{output}</option>}
                {outputs.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
              </select></label>
              <button className="btn" onClick={() => void importFile('output')}>Import…</button>
            </div>
            {kind === 'table' && (
              <div className="row" style={{ gap: 16 }}>
                <label className="chk"><input type="radio" name="gen-link" checked={linked} onChange={() => setLinked(true)} />Linked: follows the file</label>
                <label className="chk"><input type="radio" name="gen-link" checked={!linked} onChange={() => setLinked(false)} />Editable copy: convert once</label>
              </div>
            )}
          </div>
        )}
      </div>

      {kind === 'table' ? (
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <label className="f" style={{ width: 150 }}>Header rows
            <select className="field" value={headerRows ?? 'auto'} onChange={(e) => setHeaderRows(e.target.value === 'auto' ? undefined : Number(e.target.value))}>
              <option value="auto">Detect</option>
              {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{n > 1 ? ' (multi-level)' : ''}</option>)}
            </select>
          </label>
          <label className="f" style={{ width: 160 }}>Style<select className="field" value={style} onChange={(e) => setStyle(e.target.value as TableStyle)}>{TABLE_STYLES.map((t) => <option key={t.id} value={t.id} title={t.hint}>{t.label}</option>)}</select></label>
          <label className="f" style={{ width: 110 }}>Text size<select className="field" value={size} onChange={(e) => setSize(e.target.value)}>{TABLE_SIZES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></label>
          <NumberChoice value={numberFormat} onChange={setNumberFormat} />
        </div>
      ) : (
        <label className="f" style={{ width: 200 }}>Width<select className="field mono" value={width} onChange={(e) => setWidth(e.target.value)}>{FIGURE_WIDTHS.map((w) => <option key={w} value={w}>{w}</option>)}</select></label>
      )}

      {mode !== 'file' && <label className="chk"><input type="checkbox" checked={runNow} onChange={(e) => setRunNow(e.target.checked)} />Run the script now</label>}

      {exists && (
        <>
          <div className="lbl">Preview of {effOutput}</div>
          <div className="dt-preview">
            {preview && 'error' in preview && <div className="small t-fail">{preview.error}</div>}
            {preview && !('error' in preview) && preview.view.kind === 'table' && (preview.view.latex ? <pre className="rawsrc">{preview.view.latex}</pre> : <TablePreview view={{ ...preview.view, rows: preview.view.rows.slice(0, 10) }} />)}
            {preview && !('error' in preview) && preview.view.kind === 'figure' && <AssetPreview path={effOutput} maxWidth={420} />}
          </div>
        </>
      )}
    </Dialog>
  );
}
