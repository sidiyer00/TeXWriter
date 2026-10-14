// Insert → Table from data file: convert a CSV/TSV in the project into a LaTeX table.
// Linked (the default) writes generated/<id>.tex and \input's it between quire:generated
// markers; the table is rewritten whenever the file changes. "Editable copy" converts once
// into an ordinary table you edit in the document.
import { useEffect, useMemo, useState } from 'react';
import { api, createGeneratedBlock, getState, guard, setState, toast, uniqueBlockId, useStore } from '../store';
import { Dialog } from './Chrome';
import { editorRef } from '../visual/editorRef';
import { insertBlock } from '../commands';
import { flushVisual } from '../visual/VisualEditor';
import { TablePreview } from '../visual/nodes';
import { preferredTableStyle } from '../visual/clipboard';
import { renderDataTable } from '../../shared/generate';
import { gridToTableBlock, guessHeaderRows, spanRows, textRows } from '../../shared/latex/grid';
import { TABLE_SIZES, TABLE_STYLES, type TableStyle } from '../../shared/latex/table';
import { decodeFormat, encodeFormat, defaultFormat, type NumKind } from '../../shared/latex/numfmt';
import type { GeneratedBlockConfig } from '../../shared/types';

const DATA_EXT = /\.(csv|tsv|txt)$/i;
const close = () => setState({ dialog: null, dataTableFile: null });

/** Number-format choices for converted tables: as written, or Excel-style kinds with decimals. */
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

export function DataTableDialog() {
  const open = useStore((s) => s.dialog === 'dataTable');
  return open ? <DataTableBody /> : null;
}

function DataTableBody() {
  const project = useStore((s) => s.project)!;
  const initial = useStore((s) => s.dataTableFile);
  const files = project.files.filter((f) => DATA_EXT.test(f.path) && !f.path.startsWith('runs/'));
  const [file, setFile] = useState<string>(initial ?? files[0]?.path ?? '');
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [headerRows, setHeaderRows] = useState<number | undefined>(undefined);
  const [style, setStyle] = useState<TableStyle>(preferredTableStyle());
  const [numberFormat, setNumberFormat] = useState<string | undefined>(undefined);
  const [size, setSize] = useState('');
  const [caption, setCaption] = useState('');
  const [label, setLabel] = useState('');
  const [linked, setLinked] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!file) return;
    setText(null); setError('');
    const base = file.split('/').pop()!.replace(DATA_EXT, '');
    setCaption(base.replace(/[_-]+/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) + '.');
    setLabel(`tab:${base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`);
    void api.readText(project.root, file).then(setText).catch((e) => setError(String(e?.message ?? e)));
  }, [file]);

  const cfg: GeneratedBlockConfig = {
    id: 'preview', kind: 'table', run: 0, followLatest: false, testIds: [], dataFile: file,
    headerRows, tableStyle: style, numberFormat, size, caption: caption.replace(/([%&#])/g, (m, c, i, s) => (s[i - 1] === '\\' ? m : `\\${c}`)), label, sourceLine: false,
  };
  const detected = useMemo(() => (text ? guessHeaderRows(textRows(text)) : 0), [text]);
  const rendered = useMemo(() => {
    if (!text) return null;
    try { return renderDataTable(cfg, text); } catch (e) { return { error: (e as Error).message }; }
  }, [text, headerRows, style, numberFormat, size, caption, label, file]);

  const importFile = async () => {
    const abs = await api.chooseFile('Choose a data file', [{ name: 'Data', extensions: ['csv', 'tsv', 'txt'] }]);
    if (!abs) return;
    const rel = await guard(() => api.importAsset(project.root, abs, 'data'), 'Could not copy the file');
    if (!rel) return;
    const pr = await api.reloadProject(project.root);
    setState((s) => ({ project: s.project ? { ...s.project, files: pr.files } : s.project }));
    setFile(rel);
  };

  const insert = async () => {
    if (!text || !rendered || 'error' in rendered) return;
    const ed = editorRef.current;
    setBusy(true);
    try {
      if (linked) {
        flushVisual();
        const id = uniqueBlockId(`tab_${file.split('/').pop()!.replace(DATA_EXT, '')}`);
        const after = getState().selection?.index ?? null;
        await createGeneratedBlock({ ...cfg, id }, after);
        toast(`Linked to ${file}: generated/${id}.tex is rewritten whenever the file changes.`, 'ok');
      } else if (ed) {
        const rows = textRows(text);
        const g = spanRows(rows, headerRows ?? guessHeaderRows(rows));
        insertBlock(ed, gridToTableBlock(g, { style, caption: cfg.caption, label, size, format: decodeFormat(numberFormat) }) as unknown as Record<string, unknown>);
      }
      close();
    } finally { setBusy(false); }
  };

  const ok = !!rendered && !('error' in rendered);
  return (
    <Dialog title="Table from data file" wide onClose={close} footer={<>
      <span className="small muted grow">{linked ? 'Inserted as \\input{generated/…tex}; edits go in the data file or the table’s properties.' : 'Converted once into an editable table.'}</span>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-pri" disabled={!ok || busy} onClick={() => void insert()}>{busy ? 'Inserting…' : 'Insert table'}</button>
    </>}>
      <div className="row" style={{ gap: 8, alignItems: 'flex-end' }}>
        <label className="f grow">Data file
          <select className="field mono" value={file} onChange={(e) => setFile(e.target.value)}>
            {!files.some((f) => f.path === file) && file && <option value={file}>{file}</option>}
            {files.length === 0 && !file && <option value="">No CSV or TSV files in this project</option>}
            {files.map((f) => <option key={f.path} value={f.path}>{f.path}</option>)}
          </select>
        </label>
        <button className="btn" onClick={() => void importFile()}>Import file…</button>
      </div>
      <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="f" style={{ width: 150 }}>Header rows
          <select className="field" value={headerRows ?? 'auto'} onChange={(e) => setHeaderRows(e.target.value === 'auto' ? undefined : Number(e.target.value))}>
            <option value="auto">Detect ({detected})</option>
            {[0, 1, 2, 3, 4].map((n) => <option key={n} value={n}>{n}{n > 1 ? ' (multi-level)' : ''}</option>)}
          </select>
        </label>
        <label className="f" style={{ width: 170 }}>Style
          <select className="field" value={style} onChange={(e) => setStyle(e.target.value as TableStyle)}>{TABLE_STYLES.map((t) => <option key={t.id} value={t.id} title={t.hint}>{t.label}</option>)}</select>
        </label>
        <label className="f" style={{ width: 120 }}>Text size
          <select className="field" value={size} onChange={(e) => setSize(e.target.value)}>{TABLE_SIZES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        </label>
        <NumberChoice value={numberFormat} onChange={setNumberFormat} />
      </div>
      <div className="row" style={{ gap: 12 }}>
        <label className="f grow">Caption<input className="field" value={caption} onChange={(e) => setCaption(e.target.value)} /></label>
        <label className="f" style={{ width: 220 }}>Label<input className="field mono" value={label} onChange={(e) => setLabel(e.target.value.trim())} /></label>
      </div>
      <div className="col" style={{ gap: 4 }} role="radiogroup" aria-label="How to insert">
        <label className="chk"><input type="radio" name="dt-mode" checked={linked} onChange={() => setLinked(true)} /><span><b style={{ fontWeight: 600 }}>Linked to the file</b> <span className="small muted">— updates when the CSV changes (recommended for data that is re-exported)</span></span></label>
        <label className="chk"><input type="radio" name="dt-mode" checked={!linked} onChange={() => setLinked(false)} /><span><b style={{ fontWeight: 600 }}>Editable copy</b> <span className="small muted">— convert once and edit the cells in the document</span></span></label>
      </div>
      <div className="lbl">Preview</div>
      <div className="dt-preview">
        {error && <div className="small t-fail">{error}</div>}
        {!error && !text && file && <div className="small muted">Reading {file}…</div>}
        {rendered && 'error' in rendered && <div className="small t-fail">{rendered.error}</div>}
        {rendered && !('error' in rendered) && rendered.view.kind === 'table' && (
          <TablePreview view={{ ...rendered.view, rows: rendered.view.rows.slice(0, 12) }} />
        )}
        {rendered && !('error' in rendered) && rendered.view.kind === 'table' && rendered.view.rows.length > 12 && <div className="small muted">… {rendered.view.rows.length - 12} more rows</div>}
      </div>
      {ok && <details><summary className="small">LaTeX</summary><pre className="logbox" style={{ maxHeight: 200, margin: 0 }}>{(rendered as { tex: string }).tex}</pre></details>}
    </Dialog>
  );
}
