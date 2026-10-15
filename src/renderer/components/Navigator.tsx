// Left panel: outline, project files, generated tables and figures, references.
import { useMemo, useState } from 'react';
import { allDiagnostics, api, cancelGenerators, deleteBlock, gotoSource, guard, mainBlockLines, mainFile, openTab, openContextMenu, runAllGenerators, runGenerator, setState, showBlock, useStore, getState } from '../store';
import type { ProjectFile } from '../../shared/types';
import { Down, Right, Doc, Folder } from './Icons';
import { Panel, Play, Search, Trash } from './Icons';
import { editorRef } from '../visual/editorRef';
import { scrollToBlock } from '../visual/VisualEditor';
import { canonicalBlock } from '../../shared/latex/blocks';
import type { JNode } from '../../shared/latex/model';
import { floatEntries, shortAuthor } from '../../shared/latex/refs';

/** Map a parsed-block index to the editor's top-level index (empty paragraphs exist only in the editor). */
export function editorIndexForParsed(i: number): number {
  const ed = editorRef.current;
  if (!ed) return i;
  let seen = -1;
  for (let k = 0; k < ed.state.doc.childCount; k++) {
    const n = ed.state.doc.child(k);
    const empty = n.type.name === 'paragraph' && !canonicalBlock(n.toJSON() as JNode).trim();
    if (!empty) seen++;
    if (seen === i) return k;
  }
  return i;
}

/** Inverse of editorIndexForParsed. */
export function parsedIndexForEditor(k: number): number {
  const ed = editorRef.current;
  if (!ed) return k;
  let seen = -1;
  for (let i = 0; i <= k && i < ed.state.doc.childCount; i++) {
    const n = ed.state.doc.child(i);
    if (!(n.type.name === 'paragraph' && !canonicalBlock(n.toJSON() as JNode).trim())) seen++;
  }
  return Math.max(seen, 0);
}

export function goToBlock(parsedIndex: number) {
  const mode = getState().mode;
  if (mode !== 'source') scrollToBlock(editorIndexForParsed(parsedIndex));
  if (mode !== 'visual') { const l = mainBlockLines()[parsedIndex]; if (l) gotoSource(mainFile(), l[0]); }
}

function insertCitation(key: string) {
  const ed = editorRef.current;
  if (!ed) return;
  ed.chain().focus().insertContent({ type: 'citation', attrs: { cmd: 'citep', keys: key, opts: '' } }).run();
}

const EDITABLE = new Set(['tex', 'bib', 'data', 'code', 'text']);

function figureNode(path: string) {
  return { type: 'figureBlock', attrs: { path, caption: 'Caption.', label: `fig:${path.split('/').pop()!.replace(/\.\w+$/, '').toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, width: '0.8\\linewidth', placement: 'htbp', env: 'figure' } };
}

interface Dir { name: string; path: string; dirs: Map<string, Dir>; files: ProjectFile[] }
function buildTree(files: ProjectFile[]): Dir {
  const root: Dir = { name: '', path: '', dirs: new Map(), files: [] };
  for (const f of files) {
    const parts = f.path.split('/');
    let d = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts.slice(0, i + 1).join('/');
      if (!d.dirs.has(parts[i])) d.dirs.set(parts[i], { name: parts[i], path: p, dirs: new Map(), files: [] });
      d = d.dirs.get(parts[i])!;
    }
    d.files.push(f);
  }
  return root;
}

function fileMenu(f: ProjectFile, root: string): import('../store').MenuItem[] {
  const img = f.kind === 'image' || f.kind === 'pdf';
  return [
    ...(EDITABLE.has(f.kind) ? [{ label: 'Open', run: () => void openTab(f.path) }] : []),
    ...(/\.(csv|tsv)$/i.test(f.path) ? [{ label: 'Insert as linked table…', run: () => setState({ dialog: 'generated', generatedInit: { kind: 'table', mode: 'file', file: f.path } }) }] : []),
    ...(f.kind === 'code' ? [
      { label: 'Generated table from this script…', run: () => setState({ dialog: 'generated', generatedInit: { kind: 'table', mode: 'script', file: f.path } }) },
      { label: 'Generated figure from this script…', run: () => setState({ dialog: 'generated', generatedInit: { kind: 'figure', mode: 'script', file: f.path } }) },
    ] : []),
    ...(img ? [{ label: 'Insert as figure', run: () => editorRef.current?.chain().focus().insertContent(figureNode(f.path)).run() }] : []),
    { label: 'Open with default app', run: () => void api.openPath(`${root}/${f.path}`) },
    { label: 'Show in folder', run: () => void api.revealInFolder(`${root}/${f.path}`) },
    { separator: true },
    { label: 'Copy relative path', run: () => void navigator.clipboard.writeText(f.path) },
  ];
}

function FilesTree() {
  const project = useStore((s) => s.project)!;
  const current = useStore((s) => s.sourceFile);
  const [closed, setClosed] = useState<Set<string>>(() => new Set(['runs', 'build', '.texwriter']));
  const [q, setQ] = useState('');
  const visible = project.files.filter((f) => !q || f.path.toLowerCase().includes(q.toLowerCase()));
  const tree = useMemo(() => buildTree(visible), [visible.map((f) => f.path).join('|')]);
  const toggle = (p: string) => setClosed((c) => { const n = new Set(c); if (n.has(p)) n.delete(p); else n.add(p); return n; });
  const open = (f: ProjectFile) => {
    if (EDITABLE.has(f.kind)) void openTab(f.path);
    else if (f.kind === 'image' || f.kind === 'pdf') editorRef.current?.chain().focus().insertContent(figureNode(f.path)).run();
    else void api.openPath(`${project.root}/${f.path}`);
  };
  const render = (d: Dir, depth: number): React.ReactNode => (
    <>
      {[...d.dirs.values()].sort((a, b) => a.name.localeCompare(b.name)).map((sub) => {
        const isClosed = !q && closed.has(sub.path);
        return (
          <div key={sub.path} role="treeitem" aria-expanded={!isClosed}>
            <button className="tree ftree" style={{ paddingLeft: 8 + depth * 14 }} onClick={() => toggle(sub.path)}>
              {isClosed ? <Right size={11} /> : <Down size={11} />}<Folder size={13} /><span className="ftree-name">{sub.name}</span>
            </button>
            {!isClosed && render(sub, depth + 1)}
          </div>
        );
      })}
      {[...d.files].sort((a, b) => a.path.localeCompare(b.path)).map((f) => (
        <button key={f.path} role="treeitem" className={`tree ftree ${f.path === current ? 'active' : ''}`} style={{ paddingLeft: 22 + depth * 14 }} title={`${f.path}${EDITABLE.has(f.kind) ? ' — click to open' : f.kind === 'image' || f.kind === 'pdf' ? ' — click to insert as a figure' : ''}`}
          onClick={() => open(f)} onContextMenu={(e) => { e.preventDefault(); openContextMenu(e, fileMenu(f, project.root)); }}>
          <Doc size={13} />
          <span className="ftree-name">{f.path.split('/').pop()}</span>
          {f.generated && <span className="gen-tag">gen</span>}
          {f.path === mainFile() && <span className="gen-tag" style={{ background: 'var(--accent-soft, #E6ECF8)' }}>main</span>}
        </button>
      ))}
    </>
  );
  return (
    <div className="col" style={{ gap: 4 }} role="tree" aria-label="Project files">
      <label className="row" style={{ height: 30, padding: '0 8px', border: '1px solid var(--rule)', borderRadius: 6, background: '#fff', color: 'var(--muted-3)', margin: '0 4px 4px' }}>
        <Search /><input aria-label="Filter files" placeholder="Filter files  (Ctrl+O to open)" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, background: 'transparent', color: 'var(--ink)', fontSize: 12.5, minWidth: 0 }} />
      </label>
      {render(tree, 0)}
      <div className="row wrap" style={{ gap: 6, padding: '8px 6px' }}>
        <button className="btn btn-sm" onClick={async () => {
          const f = await api.chooseFile('Add an image or PDF figure', [{ name: 'Figures', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }]);
          if (!f) return;
          const rel = await guard(() => api.importAsset(project.root, f, 'figures'));
          if (rel) { const p = await api.reloadProject(project.root); setState((s) => ({ project: s.project ? { ...s.project, files: p.files } : s.project })); }
        }}>Add figure…</button>
        <button className="btn btn-sm btn-q" onClick={async () => { const p = await api.reloadProject(project.root); setState((s) => ({ project: s.project ? { ...s.project, files: p.files } : s.project })); }}>Refresh</button>
      </div>
      <div className="small muted" style={{ padding: '0 8px' }}>Click a .tex, .sty, .cls, .bib or code file to open it in a tab; click an image to insert it as a figure. Right-click for more.</div>
    </div>
  );
}

/** Every generated table and figure in the project, with what it comes from and its state. */
function GeneratedList() {
  const blocks = useStore((s) => s.project?.manifest.blocks ?? {});
  const renders = useStore((s) => s.renders);
  const gen = useStore((s) => s.generating);
  const list = Object.values(blocks);
  const runnable = list.filter((b) => b.script || b.output).length;
  const add = (kind: 'table' | 'figure') => setState({ dialog: 'generated', generatedInit: { kind, mode: 'new' } });
  return (
    <div className="col" style={{ padding: '0 4px', gap: 8 }}>
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={() => add('table')}>+ Table</button>
        <button className="btn btn-sm" onClick={() => add('figure')}>+ Figure</button>
        {gen ? <button className="btn btn-sm" style={{ marginLeft: 'auto' }} onClick={() => cancelGenerators()}>Stop</button>
          : <button className="btn btn-sm btn-pri" style={{ marginLeft: 'auto' }} disabled={!runnable} onClick={() => void runAllGenerators()}><Play />Run all</button>}
      </div>
      {list.length === 0 && (
        <div className="empty small">
          <b>No generated tables or figures</b>
          <span className="muted">A generated table or figure is rebuilt from a file: one a script writes (Python, R, …) or one another program keeps up to date, such as a model's output. Add one with the buttons above; TeXWriter can write a starter script for you.</span>
        </div>
      )}
      {list.map((b) => {
        const st = gen?.id === b.id ? 'running' : renders[b.id]?.status ?? 'pending';
        const color = st === 'fresh' ? 'var(--pass)' : st === 'running' ? 'var(--accent)' : st === 'pending' ? '#B9B1A5' : 'var(--fail)';
        const text = st === 'fresh' ? (b.lastRun ? `ran ${new Date(b.lastRun.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}` : 'up to date') : st === 'running' ? 'running…' : st === 'pending' ? 'not generated' : st === 'failed' ? 'run failed' : st === 'missing' ? 'can’t build' : 'edited by hand';
        return (
          <div key={b.id} className="gen-item">
            <button className="tree" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 1, padding: '6px 8px', flex: 1, minWidth: 0 }} onClick={() => showBlock(b.id)} title="Show in the document and open its properties">
              <span className="row" style={{ gap: 6, width: '100%' }}><span className="dot" style={{ background: color }} /><span style={{ fontSize: 12.5, fontWeight: 500 }} className="ellipsis">{b.kind === 'figure' ? 'Figure' : 'Table'} {b.label || b.id}</span></span>
              <span className="mono small muted ellipsis" style={{ width: '100%' }}>{b.script ?? b.output ?? 'no source'}</span>
              <span className={`small ${st === 'failed' || st === 'missing' ? 't-fail' : 'muted'}`}>{text}</span>
            </button>
            {(b.script || b.output) && <button className="btn btn-q btn-xs" disabled={!!gen} title={b.script ? `Run ${b.script}` : `Read ${b.output} again`} aria-label={b.script ? `Run ${b.script}` : `Read ${b.output} again`} onClick={() => void runGenerator(b.id)}><Play /></button>}
            <button className="btn btn-q btn-xs gen-del" disabled={gen?.id === b.id} title={`Delete from the document${b.script ? ` (keeps ${b.script})` : ''}`} aria-label={`Delete ${b.kind} ${b.label || b.id}`} onClick={() => void deleteBlock(b.id)}><Trash /></button>
          </div>
        );
      })}
      {list.length > 0 && <div className="small muted" style={{ padding: '4px 4px 0' }}>Click one to see it in the document with its script, output and log. Ctrl+Shift+G runs them all.</div>}
    </div>
  );
}

function OutlineHead({ title, open, onToggle, count }: { title: string; open: boolean; onToggle: () => void; count?: number }) {
  return (
    <button className="outline-head" aria-expanded={open} onClick={onToggle}>
      {open ? <Down size={11} /> : <Right size={11} />}<span>{title}</span>{count !== undefined && <span className="muted">{count}</span>}
    </button>
  );
}

/** List of tables / list of figures: every numbered float with its caption, like \listoftables. */
function FloatList({ kind, title, open, onToggle }: { kind: 'table' | 'figure'; title: string; open: boolean; onToggle: () => void }) {
  const outline = useStore((s) => s.outline);
  const labels = useStore((s) => s.labels);
  const items = useMemo(() => floatEntries(outline, labels, kind), [outline, labels, kind]);
  return (
    <>
      <OutlineHead title={title} open={open} onToggle={onToggle} count={items.length} />
      {open && (items.length === 0
        ? <div className="small muted" style={{ padding: '2px 10px 6px 26px' }}>No numbered {kind}s yet.</div>
        : items.map((c) => (
          <button key={c.index} className="tree lof" title={c.caption || c.text} onClick={() => goToBlock(c.index)}>
            <span className="num">{c.num}</span>
            <span className="ellipsis" style={{ flex: 1, minWidth: 0 }}>{c.caption || <span className="muted">(no caption)</span>}</span>
            {c.generated && <span className="gen-tag" aria-label="generated">gen</span>}
          </button>
        )))}
    </>
  );
}

export function Navigator() {
  const tab = useStore((s) => s.navTab);
  const outline = useStore((s) => s.outline);
  const sel = useStore((s) => s.selection);
  const project = useStore((s) => s.project)!;
  const bib = useStore((s) => s.bib);
  const renders = useStore((s) => s.renders);
  const lastCompile = useStore((s) => s.lastCompile);
  const [q, setQ] = useState('');
  const unresolved = useMemo(() => allDiagnostics().filter((d) => d.kind === 'undefined-citation'), [lastCompile, bib]);
  const staleCount = Object.values(renders).filter((r) => r.status === 'pending' || r.status === 'failed').length;
  const genCount = Object.keys(project.manifest.blocks).length;

  const [sections, setSections] = useState({ contents: true, tables: true, figures: true });
  const toggleSection = (k: keyof typeof sections) => setSections((x) => ({ ...x, [k]: !x[k] }));

  // which outline entry holds the cursor
  const activeIdx = useMemo(() => {
    if (!sel) return -1;
    let best = -1;
    outline.forEach((o, k) => { if (o.index <= sel.index + 2) best = k; });
    return best;
  }, [sel, outline]);

  return (
    <aside className="panel-left" aria-label="Project navigator">
      <div className="tabs nav-tabs">
        <div className="nav-tabs-scroll" role="tablist" aria-label="Navigator">
          {(['outline', 'files', 'generated', 'refs'] as const).map((t) => (
            <button key={t} className="tab" role="tab" aria-selected={tab === t} onClick={() => setState({ navTab: t })}>{t === 'refs' ? 'Refs' : t[0].toUpperCase() + t.slice(1)}</button>
          ))}
        </div>
        <button className="btn btn-q ib btn-sm nav-collapse" aria-label="Collapse panel (Ctrl+\)" title="Collapse  Ctrl+\" onClick={() => setState({ navOpen: false })}><Panel /></button>
      </div>
      <div className="scroll" style={{ flex: 1, padding: '10px 8px', display: 'flex', flexDirection: 'column', gap: 1 }}>
        {tab === 'outline' && (
          <>
            <OutlineHead title="Contents" open={sections.contents} onToggle={() => toggleSection('contents')} />
            {sections.contents && (outline.length === 0 ? <div className="empty small"><b>No sections yet</b><span className="muted">Headings you add appear here.</span></div> :
              outline.map((o, k) => (
                <div key={o.index}>
                  <button className={`tree ${o.level > 1 ? 'sub' : ''} ${k === activeIdx ? 'active' : ''}`} style={o.level > 2 ? { paddingLeft: 22 + 14 * (o.level - 1) } : undefined} onClick={() => goToBlock(o.index)}>
                    {o.number && <span className="num">{o.number}</span>}<span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.title || '(untitled)'}</span>
                  </button>
                  {k === activeIdx && o.children.map((c) => (
                    <button key={c.index} className="tree leaf" onClick={() => goToBlock(c.index)}>
                      {c.generated && <span className="gen-tag" aria-label="generated">gen</span>}{c.text}
                    </button>
                  ))}
                </div>
              )))}
            <FloatList kind="table" title="List of tables" open={sections.tables} onToggle={() => toggleSection('tables')} />
            <FloatList kind="figure" title="List of figures" open={sections.figures} onToggle={() => toggleSection('figures')} />
          </>
        )}
        {tab === 'files' && <FilesTree />}
        {tab === 'generated' && <GeneratedList />}
        {tab === 'refs' && (
          <div className="col" style={{ gap: 6 }}>
            <label className="row" style={{ height: 30, padding: '0 8px', border: '1px solid var(--rule)', borderRadius: 6, background: '#fff', color: 'var(--muted-3)', margin: '0 4px' }}>
              <Search /><input aria-label="Search references" placeholder="Search references" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 'none', flex: 1, background: 'transparent', color: 'var(--ink)', fontSize: 12.5, minWidth: 0 }} />
            </label>
            {unresolved.length > 0 && <div className="small t-warn" style={{ padding: '4px 8px' }}>{unresolved.length} unresolved: {unresolved.map((d) => d.key).join(', ')}</div>}
            {bib.length === 0 && <div className="empty small"><b>No references yet</b><span className="muted">Add entries to references.bib. Citations you type before then resolve on the next compile.</span></div>}
            {bib.filter((b) => !q || `${b.key} ${b.author} ${b.title}`.toLowerCase().includes(q.toLowerCase())).map((b) => (
              <button key={b.key} className="tree" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 0, padding: '6px 8px' }} title="Insert citation at cursor" onClick={() => insertCitation(b.key)}>
                <span style={{ fontSize: 12.5 }}>{shortAuthor(b.author, b.corporate) || b.key} {b.year}</span>
                <span className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', width: '100%' }}>{b.title}</span>
                <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted-3)' }}>{b.key}</span>
              </button>
            ))}
            {project.files.filter((f) => f.kind === 'bib').map((f) => <button key={f.path} className="btn btn-sm" style={{ margin: '6px 4px', alignSelf: 'flex-start' }} onClick={() => void openTab(f.path)}>Edit {f.path}</button>)}
          </div>
        )}
      </div>
      <div style={{ padding: '10px 14px', borderTop: '1px solid var(--rule)', fontSize: 12, color: 'var(--muted-2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
        <button className="row btn-q" style={{ justifyContent: 'space-between', border: 0, background: 'none', padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }} onClick={() => setState({ navTab: 'generated' })}><span>Generated tables and figures</span><span>{genCount}{staleCount ? <> · <span className="t-warn">{staleCount} to run</span></> : ''}</span></button>
      </div>
    </aside>
  );
}
