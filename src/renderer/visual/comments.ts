// Comment highlights in the visual editor. Threads are anchored by the quoted text plus
// surrounding context (so they survive edits made anywhere, including in the LaTeX
// source); while the document is open, ranges are also mapped through every edit.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import type { CommentThread } from '../../shared/types';
import { getState, mainFile, setState, updateAnchorQuotes } from '../store';
import { textIndex } from './find';

interface CState { ranges: Map<string, { from: number; to: number }>; deco: DecorationSet; sig: string }
export const commentsKey = new PluginKey<CState>('quire-comments');

/** Flatten the document's text with a position map (blocks joined by newlines). */
export function flatText(doc: PMNode): { text: string; pos: number[] } {
  let text = '';
  const pos: number[] = [];
  for (const b of textIndex(doc)) {
    if (text) { text += '\n'; pos.push(b.pos[0]); }
    text += b.text;
    pos.push(...b.pos.slice(0, b.text.length));
  }
  pos.push(doc.content.size);
  return { text, pos };
}

export function anchorFor(doc: PMNode, from: number, to: number): { quote: string; prefix: string; suffix: string } {
  const { text, pos } = flatText(doc);
  let a = pos.findIndex((p) => p >= from);
  let b = pos.findIndex((p) => p >= to);
  if (a < 0) a = text.length;
  if (b < 0) b = text.length;
  return { quote: text.slice(a, b), prefix: text.slice(Math.max(0, a - 32), a), suffix: text.slice(b, b + 32) };
}

function locate(doc: PMNode, t: CommentThread, flat = flatText(doc)): { from: number; to: number } | null {
  const q = t.anchor.quote;
  if (!q) return null;
  let best: { i: number; score: number } | null = null;
  for (let i = flat.text.indexOf(q); i >= 0; i = flat.text.indexOf(q, i + 1)) {
    let score = 0;
    const pre = flat.text.slice(Math.max(0, i - t.anchor.prefix.length), i);
    const suf = flat.text.slice(i + q.length, i + q.length + t.anchor.suffix.length);
    for (let k = 1; k <= Math.min(pre.length, t.anchor.prefix.length) && pre[pre.length - k] === t.anchor.prefix[t.anchor.prefix.length - k]; k++) score++;
    for (let k = 0; k < Math.min(suf.length, t.anchor.suffix.length) && suf[k] === t.anchor.suffix[k]; k++) score++;
    if (!best || score > best.score) best = { i, score };
  }
  if (!best) return null;
  return { from: flat.pos[best.i], to: flat.pos[best.i + q.length - 1] + 1 };
}

function threadsHere(): CommentThread[] {
  const s = getState();
  return s.comments.filter((t) => t.file === mainFile() && !t.resolved);
}

function build(doc: PMNode, ranges: Map<string, { from: number; to: number }>): DecorationSet {
  const active = getState().activeComment;
  const decos: Decoration[] = [];
  for (const [id, r] of ranges) {
    if (r.to <= r.from || r.to > doc.content.size) continue;
    decos.push(Decoration.inline(r.from, r.to, { class: id === active ? 'cmt cmt-active' : 'cmt', 'data-thread': id }));
  }
  const d = getState().draftComment;
  if (d && d.to > d.from && d.to <= doc.content.size) decos.push(Decoration.inline(d.from, d.to, { class: 'cmt cmt-active cmt-draft' }));
  return DecorationSet.create(doc, decos);
}

const sigOf = () => { const s = getState(); return JSON.stringify([s.activeComment, s.draftComment?.from, s.draftComment?.to, threadsHere().map((t) => [t.id, t.anchor.quote])]); };

export const Comments = Extension.create({
  name: 'quireComments',
  addProseMirrorPlugins() {
    let pendingQuotes = new Map<string, { quote: string; prefix: string; suffix: string }>();
    let timer = 0;
    return [new Plugin<CState>({
      key: commentsKey,
      state: {
        init: (_c, state) => {
          const ranges = new Map<string, { from: number; to: number }>();
          const flat = flatText(state.doc);
          for (const t of threadsHere()) { const r = locate(state.doc, t, flat); if (r) ranges.set(t.id, r); }
          return { ranges, deco: build(state.doc, ranges), sig: sigOf() };
        },
        apply(tr, prev, _old, state) {
          const sig = sigOf();
          if (!tr.docChanged && sig === prev.sig && !tr.getMeta(commentsKey)) return prev;
          const ranges = new Map<string, { from: number; to: number }>();
          const threads = threadsHere();
          let flat: ReturnType<typeof flatText> | null = null;
          for (const t of threads) {
            const old = prev.ranges.get(t.id);
            let r: { from: number; to: number } | null = null;
            if (old && tr.docChanged) {
              const a = tr.mapping.mapResult(old.from, 1);
              const b = tr.mapping.mapResult(old.to, -1);
              if (!(a.deleted && b.deleted) && b.pos > a.pos) r = { from: a.pos, to: b.pos };
            } else if (old) r = old;
            if (!r) { flat ??= flatText(state.doc); r = locate(state.doc, t, flat); }
            if (r) {
              ranges.set(t.id, r);
              if (tr.docChanged) {
                const anc = anchorFor(state.doc, r.from, r.to);
                if (anc.quote && anc.quote !== t.anchor.quote) pendingQuotes.set(t.id, anc);
              }
            }
          }
          if (pendingQuotes.size) {
            window.clearTimeout(timer);
            timer = window.setTimeout(() => { const u = [...pendingQuotes.entries()].map(([id, a]) => ({ id, ...a })); pendingQuotes = new Map(); updateAnchorQuotes(u); }, 800);
          }
          return { ranges, deco: build(state.doc, ranges), sig };
        },
      },
      props: {
        decorations: (s) => commentsKey.getState(s)?.deco,
        handleClick: (view, pos) => {
          const st = commentsKey.getState(view.state);
          if (!st) return false;
          for (const [id, r] of st.ranges) {
            if (pos >= r.from && pos <= r.to) {
              setState({ activeComment: id, panel: { open: true, tab: 'comments' } });
              view.dispatch(view.state.tr.setMeta(commentsKey, true));
              return false;
            }
          }
          return false;
        },
      },
    })];
  },
});

/** Range of a thread in the current editor state, for scrolling/selecting. */
export function threadRange(state: import('@tiptap/pm/state').EditorState, id: string) {
  return commentsKey.getState(state)?.ranges.get(id) ?? null;
}
