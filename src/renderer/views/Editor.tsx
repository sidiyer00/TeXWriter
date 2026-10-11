// Document editor: visual, split and LaTeX modes around the shared source of truth.
import { useEffect, useRef, useState } from 'react';
import { VisualEditor } from '../visual/VisualEditor';
import { editorRef } from '../visual/editorRef';
import { SourceEditor } from '../components/SourceEditor';
import { Navigator, parsedIndexForEditor } from '../components/Navigator';
import { Properties } from '../components/Properties';
import { CompileButton, ExportMenu, RunTestsButton, StatusBar, TitleBar, useOutside } from '../components/Chrome';
import { api, getState, guard, mainFile, openFile, resolveExternal, restoreBlock, setState, unlinkBlock, useStore } from '../store';
import { Gear, List, OList, Panel } from '../components/Icons';

function ModeSwitch() {
  const mode = useStore((s) => s.mode);
  return (
    <div className="seg no-drag" role="group" aria-label="Editor mode">
      {([['visual', 'Visual', '1'], ['split', 'Split', '2'], ['source', 'LaTeX', '3']] as const).map(([m, l, k]) => (
        <button key={m} aria-pressed={mode === m} title={`Ctrl+${k}`} onClick={() => setState({ mode: m })}>{l}</button>
      ))}
    </div>
  );
}

function Picker({ label, items, onPick, empty }: { label: string; items: { key: string; text: string; sub?: string }[]; onPick: (k: string) => void; empty: string }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [hi, setHi] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const shown = items.filter((i) => !q || `${i.key} ${i.text} ${i.sub ?? ''}`.toLowerCase().includes(q.toLowerCase())).slice(0, 60);
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="tb" aria-haspopup="listbox" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(!open); setQ(''); setHi(0); }}>{label}</button>
      {open && (
        <div className="menu" style={{ top: 32, left: 0, width: 320 }}>
          <input className="field" autoFocus placeholder={`Search ${label.toLowerCase()}…`} value={q} onChange={(e) => { setQ(e.target.value); setHi(0); }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, shown.length - 1)); }
              if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
              if (e.key === 'Enter' && shown[hi]) { onPick(shown[hi].key); setOpen(false); }
            }} style={{ marginBottom: 4 }} />
          {shown.length === 0 && <div className="small muted" style={{ padding: 8 }}>{empty}</div>}
          {shown.map((i, k) => (
            <button key={i.key} className={k === hi ? 'hi' : ''} onClick={() => { onPick(i.key); setOpen(false); }}>
              <span className="grow"><span>{i.text}</span>{i.sub && <div className="small muted" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{i.sub}</div>}</span>
              <span className="mono" style={{ fontSize: 10.5, color: 'var(--muted-3)' }}>{i.key}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function MoreMenu({ items }: { items: { label: string; run: () => void }[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button className="tb" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => e.preventDefault()} onClick={() => setOpen(!open)}>More ▾</button>
      {open && <div className="menu" role="menu" style={{ top: 32, left: 0 }}>{items.map((i) => <button key={i.label} role="menuitem" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); i.run(); }}>{i.label}</button>)}</div>}
    </div>
  );
}

function FormatToolbar() {
  const sel = useStore((s) => s.selection);
  const bib = useStore((s) => s.bib);
  const labels = useStore((s) => s.labels);
  const project = useStore((s) => s.project)!;
  const [, force] = useState(0);
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const f = () => force((x) => x + 1);
    ed.on('transaction', f);
    return () => { ed.off('transaction', f); };
  }, [editorRef.current]);
  const ed = editorRef.current;
  const chain = () => ed!.chain().focus();
  const style = !ed ? 'p' : ed.isActive('heading', { level: 1 }) ? 'h1' : ed.isActive('heading', { level: 2 }) ? 'h2' : ed.isActive('heading', { level: 3 }) ? 'h3' : ed.isActive('codeBlock') ? 'code' : 'p';
  const nextLabel = (prefix: string) => { let k = 1; while (labels.has(`${prefix}:new-${k}`)) k++; return `${prefix}:new-${k}`; };
  const insert = (node: Record<string, unknown>) => { if (!ed) return; chain().insertContent(node).run(); };
  const md = (e: React.MouseEvent) => e.preventDefault();
  return (
    <div className="toolbar" role="toolbar" aria-label="Formatting">
      <label className="sr-only" htmlFor="pstyle">Paragraph style</label>
      <select id="pstyle" className="field" style={{ width: 124, height: 28 }} value={style} disabled={!ed}
        onChange={(e) => {
          const v = e.target.value;
          if (v === 'p') chain().setParagraph().run();
          else if (v === 'code') chain().setCodeBlock({ language: 'Python' }).run();
          else chain().setHeading({ level: Number(v[1]) as 1 | 2 | 3 }).run();
        }}>
        <option value="p">Body text</option><option value="h1">Section</option><option value="h2">Subsection</option><option value="h3">Subsubsection</option><option value="code">Code</option>
      </select>
      <span className="vsep" />
      <button className="tb" aria-label="Bold (Ctrl+B)" title="Bold  Ctrl+B" aria-pressed={!!ed?.isActive('bold')} onMouseDown={md} onClick={() => chain().toggleBold().run()} style={{ fontWeight: 700 }}>B</button>
      <button className="tb" aria-label="Italic (Ctrl+I)" title="Italic  Ctrl+I" aria-pressed={!!ed?.isActive('italic')} onMouseDown={md} onClick={() => chain().toggleItalic().run()} style={{ fontStyle: 'italic', fontFamily: 'var(--serif)', fontSize: 14 }}>I</button>
      <button className="tb" aria-label="Inline code (Ctrl+E)" title="Monospace  Ctrl+E" aria-pressed={!!ed?.isActive('code')} onMouseDown={md} onClick={() => chain().toggleCode().run()} style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{'{ }'}</button>
      <button className="tb" aria-label="Bulleted list" aria-pressed={!!ed?.isActive('bulletList')} onMouseDown={md} onClick={() => chain().toggleBulletList().run()}><List /></button>
      <button className="tb" aria-label="Numbered list" aria-pressed={!!ed?.isActive('orderedList')} onMouseDown={md} onClick={() => chain().toggleOrderedList().run()}><OList /></button>
      <span className="vsep" />
      <Picker label="Cite" empty="No entries in the bibliography." items={bib.map((b) => ({ key: b.key, text: `${b.author?.split(' and ')[0] ?? b.key} ${b.year ?? ''}`, sub: b.title }))} onPick={(k) => insert({ type: 'citation', attrs: { cmd: 'citep', keys: k, opts: '' } })} />
      <Picker label="Cross-ref" empty="No labels yet. Give a section, table or equation a label first." items={[...labels.values()].map((l) => ({ key: l.label, text: `${{ section: 'Section', equation: 'Equation', table: 'Table', figure: 'Figure', other: '' }[l.kind]} ${l.number}`, sub: l.title }))} onPick={(k) => insert({ type: 'crossRef', attrs: { cmd: labels.get(k)?.kind === 'equation' ? 'eqref' : 'autoref', key: k } })} />
      <span className="vsep" />
      <button className="tb" onMouseDown={md} onClick={() => insert({ type: 'mathBlock', attrs: { env: 'equation', latex: 'y = \\beta_0 + \\beta_1 x', label: nextLabel('eq') } })}>Equation</button>
      <button className="tb" onMouseDown={md} onClick={() => insert({ type: 'inlineMath', attrs: { latex: 'x', delim: 'dollar' } })} title="Inline math (or type $x$)">Math</button>
      <button className="tb" onMouseDown={md} onClick={async () => {
        const f = await api.chooseFile('Insert a figure', [{ name: 'Figures', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }]);
        if (!f) return;
        const rel = await guard(() => api.importAsset(project.root, f, 'figures'));
        if (rel) insert({ type: 'figureBlock', attrs: { path: rel, caption: 'Caption.', label: nextLabel('fig'), width: '0.8\\linewidth', placement: 'htbp', env: 'figure' } });
      }}>Figure</button>
      <button className="tb" onMouseDown={md} title="Static table (LaTeX)" onClick={() => insert({ type: 'rawBlock', attrs: { label: 'Table (LaTeX)', latex: `\\begin{table}[htbp]\n  \\centering\n  \\caption{Caption.}\n  \\label{${nextLabel('tab')}}\n  \\begin{tabular}{lrr}\n    \\toprule\n    Item & Value & Threshold \\\\\n    \\midrule\n    Example & 0.00 & 0.00 \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}` } })}>Table</button>
      <MoreMenu items={[
        { label: 'Footnote', run: () => insert({ type: 'footnote', attrs: { latex: 'Footnote text.' } }) },
        { label: 'Code block', run: () => insert({ type: 'codeBlock', attrs: { language: 'Python' }, content: [{ type: 'text', text: '# code' }] }) },
        { label: 'Callout (finding, note)', run: () => insert({ type: 'calloutBlock', attrs: { title: 'Finding F-0X · Severity: Medium' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Describe the finding.' }] }] }) },
        { label: 'Page break', run: () => insert({ type: 'pageBreak', attrs: { cmd: 'clearpage' } }) },
        { label: 'Raw LaTeX block', run: () => insert({ type: 'rawBlock', attrs: { label: 'LaTeX', latex: '% your LaTeX here' } }) },
        { label: 'Appendix marker', run: () => insert({ type: 'rawBlock', attrs: { label: 'Appendices start here', latex: '\\appendix' } }) },
      ]} />
      <span className="spacer" />
      <button className="btn btn-sm" style={{ borderStyle: 'dashed', borderColor: 'var(--faint)' }} onClick={() => setState({ view: 'tests', insertAfter: sel ? parsedIndexForEditor(sel.index) : null })}>Test result…</button>
    </div>
  );
}

function SourcePane() {
  const project = useStore((s) => s.project)!;
  const file = useStore((s) => s.sourceFile) || mainFile();
  const renders = useStore((s) => s.renders);
  const sourceLine = useStore((s) => s.sourceLine);
  const files = project.files.filter((f) => f.kind === 'tex' || f.kind === 'bib');
  const ordered = [mainFile(), ...files.map((f) => f.path).filter((p) => p !== mainFile() && !p.startsWith('generated/')), ...files.map((f) => f.path).filter((p) => p.startsWith('generated/'))];
  const loaded = useStore((s) => !!s.files[file]);
  useEffect(() => { if (!loaded) void guard(() => openFile(file)); }, [file, loaded]);
  const conflicts = Object.entries(renders).filter(([, r]) => r.status === 'conflict' || r.status === 'edited');
  const showInPdf = async () => {
    const line = sourceLine ?? 1;
    const r = await guard(() => api.synctexView(project.root, file, line));
    if (r) setState({ view: 'review', pdfJump: { page: r.page, y: r.y, nonce: Date.now() } });
    else setState({ view: 'review' });
  };
  return (
    <section className="pane" aria-label="LaTeX source">
      <div className="ftabs">
        {ordered.slice(0, 12).map((p) => {
          const dirty = (() => { const f = getState().files[p]; return f && f.text !== f.saved; })();
          return (
            <button key={p} className="ftab" aria-current={p === file ? 'page' : undefined} title={p.startsWith('generated/') ? 'Generated: read-only' : p}
              onClick={async () => { await guard(() => openFile(p)); setState({ sourceFile: p }); }}>
              {p}{dirty && <span className="dot" style={{ background: 'var(--warn)' }} aria-label="unsaved" />}
            </button>
          );
        })}
        <span className="spacer" />
        <div className="row" style={{ padding: '0 12px', whiteSpace: 'nowrap' }}>
          <button className="btn btn-q btn-sm" onClick={showInPdf} title="Jump to this line in the PDF (SyncTeX)">Show in PDF</button>
        </div>
      </div>
      {file.startsWith('generated/') && <div className="banner info" style={{ margin: '8px 10px 0' }}><span className="small">Generated from a test run and rewritten on refresh. Change it through the block's properties, or convert the block to static LaTeX.</span></div>}
      {loaded ? <SourceEditor key={file} file={file} /> : <div className="cm-host" />}
      {conflicts.map(([id, r]) => (
        <div key={id} className="banner err" role="alert">
          <div className="grow" style={{ flex: '1 1 300px' }}>
            <b>Sync conflict · {project.manifest.blocks[id]?.label || id}</b>
            <div className="small">{r.message} It is linked to run #{project.manifest.blocks[id]?.run}. Choose which version to keep.</div>
          </div>
          <button className="btn btn-sm" onClick={() => void unlinkBlock(id)}>Keep source edit (unlink)</button>
          <button className="btn btn-sm btn-pri" onClick={() => void restoreBlock(id)}>Restore generated</button>
        </div>
      ))}
    </section>
  );
}

export function EditorScreen() {
  const mode = useStore((s) => s.mode);
  const navOpen = useStore((s) => s.navOpen);
  const ext = useStore((s) => s.externalChange);
  const sourceLine = useStore((s) => s.sourceLine);
  const project = useStore((s) => s.project)!;
  return (
    <>
      <TitleBar center={<ModeSwitch />} right={<><RunTestsButton /><CompileButton /><ExportMenu /><button className="btn btn-q no-drag" onClick={() => setState({ view: 'setup' })} title="Document setup"><Gear />Setup</button></>} />
      <div className="body">
        {navOpen ? <Navigator /> : (
          <nav aria-label="Navigator (collapsed)" style={{ width: 44, display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '8px 0', background: 'var(--panel)', borderRight: '1px solid var(--rule)' }}>
            <button className="btn btn-q ib" aria-label="Expand navigator (Ctrl+\)" title="Expand  Ctrl+\" onClick={() => setState({ navOpen: true })}><Panel /></button>
          </nav>
        )}
        <section className="main" aria-label="Document">
          {ext && (
            <div className="banner warnb" role="alert">
              <div className="grow"><b>{ext} changed on disk</b><div className="small">Another program edited the file while you had unsaved changes here.</div></div>
              <button className="btn btn-sm" onClick={() => void resolveExternal('disk')}>Load disk version</button>
              <button className="btn btn-sm btn-pri" onClick={() => void resolveExternal('mine')}>Keep mine</button>
            </div>
          )}
          {mode !== 'source' && <FormatToolbar />}
          {mode === 'visual' && <VisualEditor />}
          {mode === 'split' && (
            <div className="split">
              <section className="pane" aria-label="Visual editor"><VisualEditor /></section>
              <SourcePane />
            </div>
          )}
          {mode === 'source' && <div className="split"><SourcePane /></div>}
        </section>
        {mode !== 'source' && <Properties />}
      </div>
      <StatusBar>
        {sourceLine && mode !== 'visual' && <span className="sb">Ln {sourceLine}</span>}
        <span className="sb">{project.manifest.engine}</span>
      </StatusBar>
    </>
  );
}
