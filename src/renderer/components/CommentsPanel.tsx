// Review comments: threads with replies, edit, resolve/reopen, delete.
import { useEffect, useMemo, useRef, useState } from 'react';
import { TextSelection } from '@tiptap/pm/state';
import type { CommentThread } from '../../shared/types';
import { addThread, deleteMessage, deleteThread, editMessage, me, replyThread, resolveThread, setState, useStore, mainFile } from '../store';
import { editorRef } from '../visual/editorRef';
import { commentsKey, threadRange } from '../visual/comments';
import { Check } from './Icons';
import { isMod } from '../keys';

function when(iso: string) {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} h ago`;
  return d.toLocaleDateString([], { day: 'numeric', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

function initials(name: string) { return name.split(/\s+/).map((p) => p[0]).join('').slice(0, 2).toUpperCase(); }
function hue(name: string) { let h = 0; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }

function Avatar({ name }: { name: string }) {
  return <span className="avatar" aria-hidden="true" style={{ background: `hsl(${hue(name)} 45% 88%)`, color: `hsl(${hue(name)} 50% 28%)` }}>{initials(name)}</span>;
}

function Composer({ placeholder, onSubmit, onCancel, autoFocus, initial = '', submitLabel = 'Comment' }: { placeholder: string; onSubmit: (t: string) => void; onCancel?: () => void; autoFocus?: boolean; initial?: string; submitLabel?: string }) {
  const [t, setT] = useState(initial);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, []);
  const send = () => { if (t.trim()) { onSubmit(t.trim()); setT(''); } };
  return (
    <div className="col" style={{ gap: 6 }}>
      <textarea ref={ref} className="field" rows={3} placeholder={placeholder} value={t} onChange={(e) => setT(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && isMod(e)) { e.preventDefault(); send(); } if (e.key === 'Escape' && onCancel) { e.preventDefault(); onCancel(); } }} />
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        {onCancel && <button className="btn btn-sm btn-q" onClick={onCancel}>Cancel</button>}
        <button className="btn btn-sm btn-pri" disabled={!t.trim()} onClick={send} title="Ctrl+Enter">{submitLabel}</button>
      </div>
    </div>
  );
}

function selectThread(t: CommentThread) {
  setState({ activeComment: t.id });
  const ed = editorRef.current;
  if (!ed) return;
  ed.view.dispatch(ed.state.tr.setMeta(commentsKey, true));
  const r = threadRange(ed.state, t.id);
  if (!r) return;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, r.from, r.to)));
  const dom = ed.view.domAtPos(r.from).node as HTMLElement;
  (dom.nodeType === 3 ? dom.parentElement : dom)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function Thread({ t, active, located }: { t: CommentThread; active: boolean; located: boolean }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [replying, setReplying] = useState(false);
  const mine = (a: string) => a === me();
  return (
    <article className={`thread ${active ? 'active' : ''} ${t.resolved ? 'resolved' : ''}`} onClick={() => selectThread(t)} aria-label={`Comment by ${t.author}`}>
      <blockquote className={`tquote ${located ? '' : 'orphan'}`} title={located ? 'Commented text' : 'The commented text was changed or removed'}>
        {located ? '' : 'Text changed · '}“{t.anchor.quote.length > 140 ? `${t.anchor.quote.slice(0, 140)}…` : t.anchor.quote}”
      </blockquote>
      {t.messages.map((m, i) => (
        <div key={m.id} className="tmsg">
          <div className="row" style={{ gap: 8 }}>
            <Avatar name={m.author} />
            <div className="grow"><b style={{ fontWeight: 600 }}>{m.author}</b> <span className="small muted">{when(m.at)}{m.editedAt ? ' · edited' : ''}</span></div>
            {i === 0 && (
              <button className="btn btn-q btn-xs" title={t.resolved ? 'Reopen' : 'Resolve'} aria-label={t.resolved ? 'Reopen thread' : 'Resolve thread'} onClick={(e) => { e.stopPropagation(); resolveThread(t.id, !t.resolved); }}>
                {t.resolved ? 'Reopen' : <><Check size={12} strokeWidth={2.6} />Resolve</>}
              </button>
            )}
          </div>
          {editing === m.id
            ? <div onClick={(e) => e.stopPropagation()}><Composer placeholder="Edit comment" initial={m.text} autoFocus submitLabel="Save" onSubmit={(v) => { editMessage(t.id, m.id, v); setEditing(null); }} onCancel={() => setEditing(null)} /></div>
            : <div className="ttext">{m.text}</div>}
          {active && mine(m.author) && editing !== m.id && (
            <div className="row" style={{ gap: 2 }} onClick={(e) => e.stopPropagation()}>
              <button className="btn btn-q btn-xs" onClick={() => setEditing(m.id)}>Edit</button>
              <button className="btn btn-q btn-xs btn-danger" onClick={() => (i === 0 ? deleteThread(t.id) : deleteMessage(t.id, m.id))}>{i === 0 ? 'Delete thread' : 'Delete'}</button>
            </div>
          )}
        </div>
      ))}
      {t.resolved && t.resolvedBy && <div className="small muted">Resolved by {t.resolvedBy} {t.resolvedAt ? when(t.resolvedAt) : ''}</div>}
      {active && !t.resolved && (
        <div onClick={(e) => e.stopPropagation()}>
          {replying
            ? <Composer placeholder="Reply…" autoFocus submitLabel="Reply" onSubmit={(v) => { replyThread(t.id, v); setReplying(false); }} onCancel={() => setReplying(false)} />
            : <button className="field reply-btn" onClick={() => setReplying(true)}>Reply…</button>}
        </div>
      )}
    </article>
  );
}

export function CommentsPanel() {
  const threads = useStore((s) => s.comments);
  const active = useStore((s) => s.activeComment);
  const draft = useStore((s) => s.draftComment);
  const files = useStore((s) => s.files[mainFile()]?.version);
  const [filter, setFilter] = useState<'open' | 'resolved' | 'all'>('open');
  void files;
  const ed = editorRef.current;
  const ranges = ed ? commentsKey.getState(ed.state)?.ranges : undefined;
  const list = useMemo(() => {
    const here = threads.filter((t) => t.file === mainFile());
    const f = here.filter((t) => (filter === 'all' ? true : filter === 'open' ? !t.resolved : t.resolved));
    return f.sort((a, b) => (ranges?.get(a.id)?.from ?? 1e12) - (ranges?.get(b.id)?.from ?? 1e12) || a.createdAt.localeCompare(b.createdAt));
  }, [threads, filter, ranges]);
  const openCount = threads.filter((t) => t.file === mainFile() && !t.resolved).length;
  return (
    <div className="col" style={{ gap: 0, flex: 1, minHeight: 0 }}>
      <div className="row" style={{ padding: '10px 14px', borderBottom: '1px solid var(--rule-2)', gap: 6 }}>
        <div className="seg" role="group" aria-label="Show comments">
          {(['open', 'resolved', 'all'] as const).map((f) => <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'open' ? `Open ${openCount}` : f === 'resolved' ? 'Resolved' : 'All'}</button>)}
        </div>
      </div>
      <div className="scroll" style={{ flex: 1, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {draft && (
          <article className="thread active">
            <blockquote className="tquote">“{draft.quote.length > 140 ? `${draft.quote.slice(0, 140)}…` : draft.quote}”</blockquote>
            <div className="row" style={{ gap: 8 }}><Avatar name={me()} /><b style={{ fontWeight: 600 }}>{me()}</b></div>
            <Composer placeholder="Add a comment… (Ctrl+Enter to post)" autoFocus onSubmit={(v) => addThread({ quote: draft.quote, prefix: draft.prefix, suffix: draft.suffix }, v)} onCancel={() => setState({ draftComment: null })} />
          </article>
        )}
        {!draft && list.length === 0 && (
          <div className="empty small">
            <b>{filter === 'resolved' ? 'No resolved comments' : 'No comments yet'}</b>
            <span className="muted">Select text in the document and press Ctrl+Alt+M, or right-click → New comment. Comments are saved in texwriter-comments.json inside the project, so anyone you share the project with sees them.</span>
          </div>
        )}
        {list.map((t) => <Thread key={t.id} t={t} active={t.id === active} located={!!ranges?.has(t.id) || t.resolved} />)}
      </div>
    </div>
  );
}
