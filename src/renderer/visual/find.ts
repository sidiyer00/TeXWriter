// Find & replace for the visual editor (text inside paragraphs, headings, lists, cells…).
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';

export interface FindQuery { text: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean }
interface FindState { query: FindQuery | null; matches: { from: number; to: number }[]; current: number; deco: DecorationSet }

export const findKey = new PluginKey<FindState>('texwriter-find');

/** Text of every textblock with a map from string offsets to document positions. */
export function textIndex(doc: PMNode): { text: string; pos: number[] }[] {
  const out: { text: string; pos: number[] }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    let text = '';
    const map: number[] = [];
    node.forEach((child, off) => {
      const start = pos + 1 + off;
      if (child.isText) {
        for (let i = 0; i < child.text!.length; i++) { text += child.text![i]; map.push(start + i); }
      } else { text += '￼'; map.push(start); }
    });
    map.push(pos + 1 + node.content.size);
    out.push({ text, pos: map });
    return false;
  });
  return out;
}

export function buildRegex(q: FindQuery): RegExp | null {
  if (!q.text) return null;
  let src = q.regex ? q.text : q.text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (q.wholeWord) src = `\\b${src}\\b`;
  try { return new RegExp(src, q.caseSensitive ? 'g' : 'gi'); } catch { return null; }
}

export function findMatches(doc: PMNode, q: FindQuery | null): { from: number; to: number }[] {
  if (!q) return [];
  const re = buildRegex(q);
  if (!re) return [];
  const out: { from: number; to: number }[] = [];
  for (const blk of textIndex(doc)) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(blk.text))) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      out.push({ from: blk.pos[m.index], to: blk.pos[m.index + m[0].length - 1] + 1 });
      if (out.length > 5000) return out;
    }
  }
  return out;
}

function decorate(doc: PMNode, matches: { from: number; to: number }[], current: number) {
  return DecorationSet.create(doc, matches.map((m, i) => Decoration.inline(m.from, m.to, { class: i === current ? 'find-match find-current' : 'find-match' })));
}

export const Find = Extension.create({
  name: 'texwriterFind',
  addProseMirrorPlugins() {
    return [new Plugin<FindState>({
      key: findKey,
      state: {
        init: () => ({ query: null, matches: [], current: 0, deco: DecorationSet.empty }),
        apply(tr, prev, _old, state) {
          const meta = tr.getMeta(findKey) as Partial<FindState> | undefined;
          if (meta || (tr.docChanged && prev.query)) {
            const query = meta && 'query' in meta ? meta.query ?? null : prev.query;
            const matches = findMatches(state.doc, query);
            let current = meta?.current ?? prev.current;
            if (current >= matches.length) current = Math.max(0, matches.length - 1);
            return { query, matches, current, deco: decorate(state.doc, matches, current) };
          }
          return prev;
        },
      },
      props: { decorations: (s) => findKey.getState(s)?.deco },
    })];
  },
});

export function setQuery(state: EditorState, dispatch: (tr: Transaction) => void, query: FindQuery | null) {
  const matches = findMatches(state.doc, query);
  // start at the first match after the cursor
  const from = state.selection.from;
  let current = matches.findIndex((m) => m.from >= from);
  if (current < 0) current = 0;
  dispatch(state.tr.setMeta(findKey, { query, current }));
}

export function step(state: EditorState, dispatch: (tr: Transaction) => void, dir: 1 | -1, scroll: (pos: number) => void) {
  const st = findKey.getState(state);
  if (!st || !st.matches.length) return;
  const current = (st.current + dir + st.matches.length) % st.matches.length;
  const m = st.matches[current];
  dispatch(state.tr.setMeta(findKey, { query: st.query, current }).setSelection(TextSelection.create(state.doc, m.from, m.to)));
  scroll(m.from);
}

function expand(replacement: string, q: FindQuery, matched: string): string {
  if (!q.regex) return replacement;
  const re = buildRegex(q);
  if (!re) return replacement;
  re.lastIndex = 0;
  return matched.replace(re, replacement);
}

export function replaceCurrent(state: EditorState, dispatch: (tr: Transaction) => void, replacement: string) {
  const st = findKey.getState(state);
  if (!st?.query || !st.matches.length) return;
  const m = st.matches[st.current];
  const text = expand(replacement, st.query, state.doc.textBetween(m.from, m.to));
  const tr = state.tr.insertText(text, m.from, m.to);
  dispatch(tr.setMeta(findKey, { query: st.query, current: st.current }));
}

export function replaceAll(state: EditorState, dispatch: (tr: Transaction) => void, replacement: string): number {
  const st = findKey.getState(state);
  if (!st?.query || !st.matches.length) return 0;
  const tr = state.tr;
  for (let i = st.matches.length - 1; i >= 0; i--) {
    const m = st.matches[i];
    tr.insertText(expand(replacement, st.query, state.doc.textBetween(m.from, m.to)), m.from, m.to);
  }
  dispatch(tr.setMeta(findKey, { query: st.query, current: 0 }));
  return st.matches.length;
}
