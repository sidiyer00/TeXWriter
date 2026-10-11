// Title bar, export menu, status bar and small shared widgets.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, allDiagnostics, cancelCompile, closeProject, compileNow, dirtyFiles, guard, mainText, runTests, setState, toast, useStore, latestRun } from '../store';
import { Back, Check, Down, Play, Redo, Undo, Warn, X } from './Icons';
import { editorRef } from '../visual/editorRef';
import { sourceViewRef } from './SourceEditor';
import { undo, redo } from '@codemirror/commands';
import { hash } from '../../shared/latex/scan';
import { MenuBar } from './Menu';

export function useOutside(ref: React.RefObject<HTMLElement | null>, onOut: () => void) {
  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onOut(); };
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onOut(); };
    document.addEventListener('mousedown', h);
    document.addEventListener('keydown', k);
    return () => { document.removeEventListener('mousedown', h); document.removeEventListener('keydown', k); };
  }, [ref, onOut]);
}

export function ExportMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useOutside(ref, () => setOpen(false));
  const project = useStore((s) => s.project);
  const lastCompile = useStore((s) => s.lastCompile);
  const go = async (kind: 'pdf' | 'zip' | 'prov') => {
    setOpen(false);
    if (!project) return;
    const fn = kind === 'pdf' ? api.exportPdf : kind === 'zip' ? api.exportBundle : api.exportProvenance;
    const out = await guard(() => fn(project.root), 'Export failed');
    if (out) toast(`Saved ${out}`, 'ok', { label: 'Show in folder', run: () => void api.revealInFolder(out) });
  };
  return (
    <div ref={ref} style={{ position: 'relative' }} className="no-drag">
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>Export <Down /></button>
      {open && (
        <div className="menu" role="menu" style={{ right: 0, top: 34 }}>
          <button role="menuitem" onClick={() => go('pdf')} disabled={!lastCompile?.pdfPath}>
            <span className="grow"><b style={{ fontWeight: 500 }}>PDF</b><div className="small muted">{lastCompile?.pdfPath ? `${lastCompile.pages ?? '?'} pages, compiled ${new Date(lastCompile.startedAt).toLocaleTimeString()}` : 'Compile first'}</div></span>
          </button>
          <button role="menuitem" onClick={() => go('zip')}>
            <span className="grow"><b style={{ fontWeight: 500 }}>Source bundle (.zip)</b><div className="small muted">.tex, .bib, figures, generated tables, referenced runs</div></span>
          </button>
          <button role="menuitem" onClick={() => go('prov')}>
            <span className="grow"><b style={{ fontWeight: 500 }}>Provenance (.json)</b><div className="small muted">Runs, commits and file hashes behind the PDF</div></span>
          </button>
        </div>
      )}
    </div>
  );
}

export function CompileButton() {
  const compiling = useStore((s) => s.compiling);
  const [, tick] = useState(0);
  useEffect(() => { if (!compiling) return; const t = setInterval(() => tick((x) => x + 1), 500); return () => clearInterval(t); }, [compiling]);
  if (compiling) {
    const secs = ((Date.now() - compiling.startedAt) / 1000).toFixed(0);
    return (
      <div className="row no-drag" role="status" aria-live="polite">
        <button className="btn btn-pri" disabled aria-busy="true" style={{ minWidth: 168 }}>Compiling · {compiling.passes[compiling.passes.length - 1] ?? 'preparing'} · {secs}s</button>
        <button className="btn btn-q btn-sm" onClick={cancelCompile}>Cancel</button>
      </div>
    );
  }
  return <button className="btn btn-pri no-drag" onClick={() => void compileNow()} title="Compile (Ctrl+Enter)">Compile <span className="k">Ctrl+↵</span></button>;
}

export function SaveState() {
  const files = useStore((s) => s.files);
  void files;
  const dirty = dirtyFiles();
  return (
    <span className="savestate" aria-live="polite">
      <span className="dot" style={{ background: dirty.length ? 'var(--warn)' : 'var(--pass)' }} />
      {dirty.length ? `Saving ${dirty.length} file${dirty.length > 1 ? 's' : ''}…` : 'All changes saved'}
    </span>
  );
}

export function UndoRedo() {
  const act = (dir: 'undo' | 'redo') => {
    if (editorRef.lastFocus === 'source' && sourceViewRef.current) {
      (dir === 'undo' ? undo : redo)(sourceViewRef.current);
      sourceViewRef.current.focus();
    } else if (editorRef.current) {
      const c = editorRef.current.chain().focus();
      (dir === 'undo' ? c.undo() : c.redo()).run();
    }
  };
  return (
    <div className="row no-drag undoredo" style={{ gap: 2 }}>
      <button className="btn btn-q ib" aria-label="Undo (Ctrl+Z)" title="Undo  Ctrl+Z" onClick={() => act('undo')}><Undo /></button>
      <button className="btn btn-q ib" aria-label="Redo (Ctrl+Y)" title="Redo  Ctrl+Y" onClick={() => act('redo')}><Redo /></button>
    </div>
  );
}

export function TitleBar({ crumb, center, right }: { crumb?: ReactNode; center?: ReactNode; right?: ReactNode }) {
  const project = useStore((s) => s.project);
  const mac = api.platform === 'darwin';
  return (
    <header className={`titlebar ${mac ? 'mac' : ''}`}>
      <button className="logo no-drag" aria-label="Quire home" onClick={() => closeProject()}>Q</button>
      <MenuBar />
      <nav className="crumbs" aria-label="Breadcrumb">
        {project ? (
          <>
            <button onClick={() => closeProject()}>Projects</button><span className="sep">/</span>
            <button onClick={() => setState({ view: 'editor' })} className="cur" style={{ color: crumb ? 'var(--muted-2)' : 'var(--ink)', fontWeight: crumb ? 400 : 600 }}>{project.manifest.name}</button>
            {crumb && <><span className="sep">/</span><span className="cur">{crumb}</span></>}
          </>
        ) : <span className="cur" style={{ fontWeight: 600 }}>Quire</span>}
      </nav>
      {project && <SaveState />}
      {project && <UndoRedo />}
      <div className="center">{center}</div>
      {right}
    </header>
  );
}

export function BackButton({ label = 'Back to report' }: { label?: string }) {
  return <button className="btn btn-q no-drag" style={{ color: 'var(--accent-hover)' }} onClick={() => setState({ view: 'editor' })}><Back />{label}</button>;
}

export function RunTestsButton() {
  const running = useStore((s) => s.running);
  const project = useStore((s) => s.project);
  if (!project?.manifest.tests.command) return <button className="btn no-drag" onClick={() => setState({ view: 'setup' })} title="No test command configured">Set up tests</button>;
  return <button className="btn no-drag" disabled={!!running} onClick={() => void runTests()} title="Run test suite (Ctrl+Shift+T)" aria-label={running ? undefined : 'Run tests'}><Play /><span className={running ? '' : 'tlabel'}>{running ? `Running ${running.done}/${running.total || '…'}` : 'Run tests'}</span></button>;
}

export function StatusBar({ children }: { children?: ReactNode }) {
  const lastCompile = useStore((s) => s.lastCompile);
  const compiling = useStore((s) => s.compiling);
  useStore((s) => s.renders);
  useStore((s) => s.labels);
  const files = useStore((s) => s.files);
  void files;
  const diags = allDiagnostics();
  const errs = diags.filter((d) => d.severity === 'error').length;
  const refs = diags.filter((d) => d.kind === 'undefined-reference' || d.kind === 'undefined-citation').length;
  const warns = diags.filter((d) => d.severity === 'warning').length - refs;
  const stale = diags.filter((d) => d.kind === 'stale-block').length;
  const changed = lastCompile && lastCompile.texHash !== hash(mainText());
  const latest = latestRun();
  return (
    <footer className="statusbar">
      {compiling ? <span className="sb t-run">Compiling…</span>
        : lastCompile ? (
          <button className="sb" onClick={() => setState({ view: 'review' })}>
            {lastCompile.ok ? <Check size={12} strokeWidth={2.6} style={{ color: 'var(--pass)' }} /> : <X size={12} strokeWidth={2.6} style={{ color: 'var(--fail)' }} />}
            {lastCompile.ok ? `Compiled ${new Date(lastCompile.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · ${lastCompile.pages ?? '?'} pages` : 'Compile failed'}
            {changed ? ' · edited since' : ''}
          </button>
        ) : <span className="sb muted">Not compiled yet</span>}
      {errs > 0 && <button className="sb t-fail" onClick={() => setState({ view: 'review' })}>{errs} error{errs > 1 ? 's' : ''}</button>}
      {refs > 0 && <button className="sb t-warn" onClick={() => setState({ view: 'review' })}><Warn size={12} />{refs} unresolved reference{refs > 1 ? 's' : ''}</button>}
      {warns > 0 && <button className="sb t-warn" onClick={() => setState({ view: 'review' })}>{warns} warning{warns > 1 ? 's' : ''}</button>}
      {stale > 0 && <button className="sb t-warn" onClick={() => setState({ view: 'review' })}>{stale} stale block{stale > 1 ? 's' : ''}</button>}
      <span className="spacer" />
      {children}
      {latest && <button className="sb" onClick={() => setState({ view: 'tests', selectedRun: latest.number })}>Run #{latest.number} · {latest.counts.failed} failed</button>}
    </footer>
  );
}

export function Toast() {
  const t = useStore((s) => s.toast);
  if (!t) return null;
  return (
    <div className={`toast ${t.kind === 'err' ? 'err' : ''}`} role="status" aria-live="polite">
      <span>{t.text}</span>
      {t.action && <button className="btn btn-sm btn-dark" onClick={() => { t.action!.run(); setState({ toast: null }); }}>{t.action.label}</button>}
      <button className="btn btn-q btn-sm ib" aria-label="Dismiss" onClick={() => setState({ toast: null })}><X /></button>
    </div>
  );
}

export function Dialog({ title, children, footer, onClose, wide }: { title: string; children: ReactNode; footer: ReactNode; onClose: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    ref.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus();
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={`dialog ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="dialog-head"><h2>{title}</h2></div>
        <div className="dialog-body">{children}</div>
        <div className="dialog-foot">{footer}</div>
      </div>
    </div>
  );
}
