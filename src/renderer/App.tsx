import { useEffect } from 'react';
import { api, compileNow, getState, loadToolchain, runTests, saveAll, setState, useStore, allDiagnostics, gotoSource } from './store';
import { flushVisual } from './visual/VisualEditor';
import { Home } from './views/Home';
import { EditorScreen } from './views/Editor';
import { TestsScreen } from './views/Tests';
import { ReviewScreen } from './views/Review';
import { SetupScreen } from './views/Setup';
import { Toast } from './components/Chrome';

export function App() {
  const view = useStore((s) => s.view);
  const project = useStore((s) => s.project);

  useEffect(() => { void loadToolchain(); }, []);
  useEffect(() => api.onFlush(async () => { flushVisual(); await saveAll(); }), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      const s = getState();
      if (!s.project) return;
      if (mod && e.key === 'Enter') { e.preventDefault(); void compileNow(); }
      else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveAll(); }
      else if (mod && e.shiftKey && e.key.toLowerCase() === 't') { e.preventDefault(); void runTests(); }
      else if (mod && !e.shiftKey && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        setState({ view: 'editor', mode: e.key === '1' ? 'visual' : e.key === '2' ? 'split' : 'source' });
      } else if (mod && e.key === '\\') { e.preventDefault(); setState({ navOpen: !s.navOpen }); }
      else if (e.key === 'F8') {
        e.preventDefault();
        const ds = allDiagnostics().filter((d) => d.line);
        if (!ds.length) return;
        const cur = ds.findIndex((d) => d.id === s.reviewIssue);
        const next = ds[(cur + (e.shiftKey ? ds.length - 1 : 1)) % ds.length];
        setState({ reviewIssue: next.id });
        gotoSource(next.file, next.line);
      }
    };
    window.addEventListener('keydown', onKey);
    const beforeUnload = () => { void saveAll(); };
    window.addEventListener('beforeunload', beforeUnload);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('beforeunload', beforeUnload); };
  }, []);

  return (
    <div className="app">
      {!project || view === 'home' ? <Home /> : view === 'tests' ? <TestsScreen /> : view === 'review' ? <ReviewScreen /> : view === 'setup' ? <SetupScreen /> : <EditorScreen />}
      <Toast />
    </div>
  );
}
