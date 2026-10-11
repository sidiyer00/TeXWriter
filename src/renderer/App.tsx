import { Component, useEffect, type ReactNode } from 'react';
import { api, compileNow, getState, loadSettings, loadToolchain, runTests, saveAll, setState, toast, togglePanel, useStore } from './store';
import { flushVisual } from './visual/VisualEditor';
import { editorRef } from './visual/editorRef';
import { Home } from './views/Home';
import { EditorScreen } from './views/Editor';
import { TestsScreen } from './views/Tests';
import { ReviewScreen } from './views/Review';
import { SetupScreen } from './views/Setup';
import { SettingsScreen } from './views/Settings';
import { Toast } from './components/Chrome';
import { ContextMenu } from './components/Menu';
import { AboutDialog, EquationModal, InsertTableDialog, NumberFormatDialog, PickerDialog, PromptDialog, QuickOpen, ShortcutsDialog } from './components/Dialogs';
import { followAtCursor, initZoom, insertEquation, insertInlineMath, insertLink, newComment, nextIssue, openFind, setZoom, zoomBy } from './commands';
import { findKey, step } from './visual/find';
import { isMod, isSystemCombo } from './keys';

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error) { console.error(error); }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash" role="alert">
        <h2>Something went wrong in this view</h2>
        <p className="small muted">Your files are saved. You can return to the document; if this keeps happening, copy the details below into a bug report.</p>
        <pre className="logbox">{String(this.state.error?.stack ?? this.state.error)}</pre>
        <div className="row"><button className="btn btn-pri" onClick={() => { this.setState({ error: null }); setState({ view: getState().project ? 'editor' : 'home', equationModal: null, dialog: null }); }}>Back to the document</button>
          <button className="btn" onClick={() => location.reload()}>Reload window</button></div>
      </div>
    );
  }
}

/** True when keyboard focus is in the visual editor's text (not an input in a panel). */
function inVisual(): boolean {
  const ed = editorRef.current;
  const ae = document.activeElement;
  return !!ed && !ed.isDestroyed && !!ae && ed.view.dom.contains(ae);
}

function onKey(e: KeyboardEvent) {
  if (isSystemCombo(e)) return;
  const mod = isMod(e);
  const k = e.key.toLowerCase();
  const s = getState();
  const modal = !!(s.dialog || s.prompt || s.picker || s.quickOpen || s.equationModal);
  const stop = () => { e.preventDefault(); e.stopPropagation(); };

  // available everywhere
  if (e.key === 'F1') { stop(); setState({ dialog: 'shortcuts' }); return; }
  if (mod && e.key === ',') { stop(); setState({ view: 'settings' }); return; }
  if (mod && !e.shiftKey && (e.key === '=' || e.key === '+')) { stop(); zoomBy(0.1); return; }
  if (mod && !e.shiftKey && e.key === '-') { stop(); zoomBy(-0.1); return; }
  if (mod && !e.shiftKey && e.key === '0' && !e.altKey) { stop(); setZoom(1); return; }
  if (!s.project || modal) return;
  // typing in a form field (comment box, caption, find box…): leave its keys alone
  const ae = document.activeElement as HTMLElement | null;
  const inField = !!ae && (ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT' || (ae.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes((ae as HTMLInputElement).type)));
  if (inField && !(mod && !e.shiftKey && k === 's') && e.key !== 'F8') return;

  if (mod && e.key === 'Enter') { stop(); void compileNow(); return; }
  if (mod && !e.shiftKey && k === 's') { stop(); void saveAll(); return; }
  if (mod && !e.shiftKey && !e.altKey && k === 'o') { stop(); setState({ quickOpen: true }); return; }
  if (mod && e.shiftKey && k === 't') { stop(); void runTests(); return; }
  if (mod && !e.shiftKey && !e.altKey && ['1', '2', '3'].includes(e.key)) { stop(); setState({ view: 'editor', mode: e.key === '1' ? 'visual' : e.key === '2' ? 'split' : 'source' }); return; }
  if (mod && e.key === '\\') { stop(); setState({ navOpen: !s.navOpen }); return; }
  if (mod && e.altKey && k === 'p') { stop(); togglePanel('properties'); return; }
  if (mod && e.altKey && k === 'c') { stop(); togglePanel('comments'); return; }
  if (e.key === 'F8') { stop(); nextIssue(e.shiftKey ? -1 : 1); return; }

  if (s.view !== 'editor') return;
  const visualMode = s.mode !== 'source';
  // find (the LaTeX editor handles its own Ctrl+F)
  if (mod && !e.altKey && !e.shiftKey && (k === 'f' || k === 'h') && !document.activeElement?.closest('.cm-editor')) { stop(); openFind(k === 'h'); return; }
  if (e.key === 'F3' && visualMode && s.find) {
    stop();
    const ed = editorRef.current;
    if (ed && findKey.getState(ed.state)?.matches.length) step(ed.state, ed.view.dispatch, e.shiftKey ? -1 : 1, (pos) => { (ed.view.domAtPos(pos).node as HTMLElement)?.parentElement?.scrollIntoView({ block: 'center' }); });
    return;
  }

  // visual-editor commands: only while typing in the document
  if (!inVisual()) return;
  const ed = editorRef.current!;
  const c = () => ed.chain().focus();
  if (e.key === 'F12') { stop(); followAtCursor(); return; }
  if (mod && e.altKey && ['0', '1', '2', '3'].includes(e.key)) { stop(); if (e.key === '0') c().setParagraph().run(); else c().setHeading({ level: Number(e.key) as 1 | 2 | 3 }).run(); return; }
  if (mod && e.altKey && k === 'm') { stop(); newComment(); return; }
  if (mod && e.altKey && k === 't') { stop(); setState({ dialog: 'insertTable' }); return; }
  if (mod && e.altKey && k === 'f') { stop(); c().insertContent({ type: 'footnote', attrs: { latex: 'Footnote text.' } }).run(); return; }
  if (mod && e.shiftKey && k === 'm') { stop(); insertEquation(); return; }
  if (mod && !e.shiftKey && !e.altKey && k === 'm') { stop(); insertInlineMath(); return; }
  if (mod && e.shiftKey && k === 'k') { stop(); setState({ picker: 'cite' }); return; }
  if (mod && e.shiftKey && k === 'r') { stop(); setState({ picker: 'ref' }); return; }
  if (mod && !e.shiftKey && !e.altKey && k === 'k') { stop(); void insertLink(); return; }
}

export function App() {
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);

  useEffect(() => {
    void loadToolchain();
    void loadSettings().then(() => initZoom(getState().settings?.uiZoom ?? 1));
  }, []);
  useEffect(() => api.onFlush(async () => { flushVisual(); await saveAll(); }), []);

  // installed MiKTeX/Python while Quire was open? Look again when the window regains focus.
  useEffect(() => api.onWindowFocus(() => {
    const tc = getState().toolchain;
    if (tc?.engines.pdflatex && tc.python) return;
    void api.redetectTools().then((n) => {
      const before = tc;
      setState({ toolchain: n });
      if (!before?.engines.pdflatex && n.engines.pdflatex) toast(`Found ${n.distribution ?? 'TeX'} — compiling is ready.`, 'ok');
      else if (!before?.python && n.python) toast('Found Python — test suites can run.', 'ok');
    }).catch(() => {});
  }), []);

  useEffect(() => {
    window.addEventListener('keydown', onKey, true);
    const beforeUnload = () => { void saveAll(); };
    window.addEventListener('beforeunload', beforeUnload);
    // native context menu suppression outside editable areas keeps right-click predictable
    const ctx = (e: MouseEvent) => { const t = e.target as HTMLElement; if (!t.closest('input, textarea, [contenteditable="true"], .cm-content')) e.preventDefault(); };
    window.addEventListener('contextmenu', ctx);
    return () => { window.removeEventListener('keydown', onKey, true); window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('contextmenu', ctx); };
  }, []);

  return (
    <div className="app">
      <ErrorBoundary>
        {view === 'settings' ? <SettingsScreen /> : !project || view === 'home' ? <Home /> : view === 'tests' ? <TestsScreen /> : view === 'review' ? <ReviewScreen /> : view === 'setup' ? <SetupScreen /> : <EditorScreen />}
      </ErrorBoundary>
      <ContextMenu />
      <PromptDialog />
      <PickerDialog />
      <InsertTableDialog />
      <NumberFormatDialog />
      <QuickOpen />
      <ShortcutsDialog />
      <AboutDialog />
      <EquationModal />
      <Toast />
    </div>
  );
}
