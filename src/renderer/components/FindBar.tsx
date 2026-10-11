// Find / replace bar for the visual editor (Ctrl+F, Ctrl+H).
import { useEffect, useRef, useState } from 'react';
import { editorRef } from '../visual/editorRef';
import { findKey, replaceAll, replaceCurrent, setQuery, step, type FindQuery } from '../visual/find';
import { setState, toast, useStore } from '../store';
import { Down, X } from './Icons';

export function FindBar() {
  const find = useStore((s) => s.find);
  const [q, setQ] = useState<FindQuery>({ text: '', caseSensitive: false, wholeWord: false, regex: false });
  const [repl, setRepl] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [, force] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!find) return;
    setShowReplace((r) => r || find.replace);
    const ed = editorRef.current;
    if (ed) {
      const { from, to, empty } = ed.state.selection;
      const sel = empty ? '' : ed.state.doc.textBetween(from, to, ' ');
      if (sel && sel.length < 120 && !sel.includes('\n')) setQ((x) => ({ ...x, text: sel }));
    }
    setTimeout(() => { input.current?.focus(); input.current?.select(); }, 0);
  }, [find?.nonce]);

  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !find) return;
    const f = () => force((x) => x + 1);
    ed.on('transaction', f);
    setQuery(ed.state, ed.view.dispatch, q.text ? q : null);
    f();
    return () => { ed.off('transaction', f); };
  }, [q, !!find, editorRef.current]);

  useEffect(() => () => { const ed = editorRef.current; if (ed && !ed.isDestroyed) setQuery(ed.state, ed.view.dispatch, null); }, []);

  if (!find) return null;
  const ed = editorRef.current;
  const st = ed ? findKey.getState(ed.state) : null;
  const n = st?.matches.length ?? 0;
  const scroll = (pos: number) => { const dom = ed?.view.domAtPos(pos); (dom?.node as HTMLElement)?.parentElement?.scrollIntoView({ block: 'center' }); };
  const go = (dir: 1 | -1) => { if (ed) step(ed.state, ed.view.dispatch, dir, scroll); };
  const close = () => { if (ed) setQuery(ed.state, ed.view.dispatch, null); setState({ find: null }); ed?.commands.focus(); };
  const tog = (k: keyof FindQuery) => setQ((x) => ({ ...x, [k]: !x[k] }));
  return (
    <div className="findbar" role="search" aria-label="Find and replace"
      onKeyDown={(e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); }
        if (e.key === 'F3') { e.preventDefault(); go(e.shiftKey ? -1 : 1); }
      }}>
      <button className="btn btn-q btn-sm ib" aria-label={showReplace ? 'Hide replace' : 'Show replace'} aria-expanded={showReplace} onClick={() => setShowReplace(!showReplace)}><Down style={{ transform: showReplace ? 'none' : 'rotate(-90deg)' }} /></button>
      <div className="col" style={{ gap: 4 }}>
        <div className="row" style={{ gap: 4 }}>
          <input ref={input} className="field" style={{ width: 240, height: 28 }} aria-label="Find" placeholder="Find" value={q.text}
            onChange={(e) => setQ({ ...q, text: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); go(e.shiftKey ? -1 : 1); } }} />
          <button className="tb" aria-pressed={q.caseSensitive} title="Match case" aria-label="Match case" onClick={() => tog('caseSensitive')}>Aa</button>
          <button className="tb" aria-pressed={q.wholeWord} title="Whole word" aria-label="Whole word" onClick={() => tog('wholeWord')} style={{ textDecoration: 'underline' }}>ab</button>
          <button className="tb" aria-pressed={q.regex} title="Regular expression" aria-label="Regular expression" onClick={() => tog('regex')} style={{ fontFamily: 'var(--mono)' }}>.*</button>
          <span className="small muted" style={{ minWidth: 86, textAlign: 'center' }} aria-live="polite">{q.text ? (n ? `${(st?.current ?? 0) + 1} of ${n}` : 'No results') : ''}</span>
          <button className="btn btn-q btn-sm" disabled={!n} onClick={() => go(-1)} title="Previous (Shift+Enter)">Previous</button>
          <button className="btn btn-q btn-sm" disabled={!n} onClick={() => go(1)} title="Next (Enter)">Next</button>
        </div>
        {showReplace && (
          <div className="row" style={{ gap: 4 }}>
            <input className="field" style={{ width: 240, height: 28 }} aria-label="Replace with" placeholder="Replace with" value={repl} onChange={(e) => setRepl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ed) { e.preventDefault(); replaceCurrent(ed.state, ed.view.dispatch, repl); } }} />
            <button className="btn btn-sm" disabled={!n} onClick={() => ed && replaceCurrent(ed.state, ed.view.dispatch, repl)}>Replace</button>
            <button className="btn btn-sm" disabled={!n} onClick={() => { if (!ed) return; const k = replaceAll(ed.state, ed.view.dispatch, repl); toast(`Replaced ${k} occurrence${k === 1 ? '' : 's'}.`, 'ok'); }}>Replace all</button>
            {q.regex && <span className="small muted">Use $1, $2 for groups</span>}
          </div>
        )}
      </div>
      <span className="spacer" />
      <button className="btn btn-q btn-sm ib" aria-label="Close find (Esc)" onClick={close}><X /></button>
    </div>
  );
}
