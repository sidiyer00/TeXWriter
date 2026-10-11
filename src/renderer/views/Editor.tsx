// Document editor: visual, split and LaTeX modes around the shared source of truth.
import { useEffect } from 'react';
import { VisualEditor } from '../visual/VisualEditor';
import { SourceEditor } from '../components/SourceEditor';
import { Navigator } from '../components/Navigator';
import { Properties } from '../components/Properties';
import { CommentsPanel } from '../components/CommentsPanel';
import { FormatToolbar } from '../components/Toolbar';
import { FindBar } from '../components/FindBar';
import { CompileButton, ExportMenu, RunTestsButton, StatusBar, TitleBar } from '../components/Chrome';
import { api, closeTab, getState, guard, mainFile, openContextMenu, openFile, resolveExternal, restoreBlock, setState, unlinkBlock, useStore } from '../store';
import { Gear, Panel, X } from '../components/Icons';

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

function SourcePane() {
  const project = useStore((s) => s.project)!;
  const file = useStore((s) => s.sourceFile) || mainFile();
  const renders = useStore((s) => s.renders);
  const sourceLine = useStore((s) => s.sourceLine);
  const openTabs = useStore((s) => s.openTabs);
  const files = useStore((s) => s.files);
  const tabs = [mainFile(), ...openTabs.filter((p) => p !== mainFile())];
  if (!tabs.includes(file)) tabs.push(file);
  const loaded = !!files[file];
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
        <div className="ftabs-scroll" role="tablist" aria-label="Open files">
          {tabs.map((p) => {
            const f = files[p];
            const dirty = f && f.text !== f.saved;
            const main = p === mainFile();
            return (
              <div key={p} role="tab" aria-selected={p === file} className="ftab" title={p.startsWith('generated/') ? `${p} (generated, read-only)` : p}
                onMouseDown={(e) => { if (e.button === 1 && !main) { e.preventDefault(); closeTab(p); } }}
                onClick={async () => { await guard(() => openFile(p)); setState({ sourceFile: p }); }}
                onContextMenu={(e) => { e.preventDefault(); openContextMenu(e, [
                  { label: 'Close', disabled: main, run: () => closeTab(p) },
                  { label: 'Close other tabs', run: () => { for (const t of getState().openTabs) if (t !== p) closeTab(t); } },
                  { separator: true },
                  { label: 'Copy path', run: () => void navigator.clipboard.writeText(p) },
                  { label: 'Show in folder', run: () => void api.revealInFolder(`${project.root}/${p}`) },
                ]); }}>
                <span className="ftab-name">{p.split('/').pop()}</span>
                {dirty && <span className="dot" style={{ background: 'var(--warn)' }} aria-label="unsaved" />}
                {!main && <button className="ftab-x" aria-label={`Close ${p}`} onClick={(e) => { e.stopPropagation(); closeTab(p); }}><X size={10} /></button>}
              </div>
            );
          })}
          <button className="ftab ftab-add" title="Open a file  Ctrl+O" aria-label="Open a file" onClick={() => setState({ quickOpen: true })}>+</button>
        </div>
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

function RightPanel() {
  const panel = useStore((s) => s.panel);
  const open = useStore((s) => s.comments.filter((t) => t.file === mainFile() && !t.resolved).length);
  if (!panel.open) return null;
  return (
    <aside className="panel-right" aria-label={panel.tab === 'comments' ? 'Comments' : 'Properties'}>
      <div className="tabs" role="tablist">
        <button className="tab" role="tab" aria-selected={panel.tab === 'properties'} onClick={() => setState({ panel: { open: true, tab: 'properties' } })}>Properties</button>
        <button className="tab" role="tab" aria-selected={panel.tab === 'comments'} onClick={() => setState({ panel: { open: true, tab: 'comments' } })}>Comments{open ? <span className="countpill">{open}</span> : null}</button>
        <button className="btn btn-q ib btn-sm" style={{ marginLeft: 'auto' }} aria-label="Close panel" title="Close panel" onClick={() => setState({ panel: { ...panel, open: false } })}><X /></button>
      </div>
      {panel.tab === 'comments' ? <CommentsPanel /> : <Properties />}
    </aside>
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
      <TitleBar center={<ModeSwitch />} right={<><RunTestsButton /><CompileButton /><ExportMenu /><button className="btn btn-q no-drag" onClick={() => setState({ view: 'setup' })} title="Document setup" aria-label="Document setup"><Gear /><span className="tlabel">Setup</span></button></>} />
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
          {mode !== 'source' && <FindBar />}
          {mode === 'visual' && <VisualEditor />}
          {mode === 'split' && (
            <div className="split">
              <section className="pane" aria-label="Visual editor"><VisualEditor /></section>
              <SourcePane />
            </div>
          )}
          {mode === 'source' && <div className="split"><SourcePane /></div>}
        </section>
        {mode !== 'source' && <RightPanel />}
      </div>
      <StatusBar>
        {sourceLine && mode !== 'visual' && <span className="sb">Ln {sourceLine}</span>}
        <span className="sb">{project.manifest.engine}</span>
      </StatusBar>
    </>
  );
}
