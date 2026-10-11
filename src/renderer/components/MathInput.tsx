// A small CodeMirror editor for LaTeX math with inline suggestions (\su → \sum).
import { useEffect, useRef } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, placeholder as cmPlaceholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { completionKeymap, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching } from '@codemirror/language';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { tags as t } from '@lezer/highlight';
import { mathAutocomplete } from '../latexCompletions';

const hl = HighlightStyle.define([
  { tag: t.keyword, color: '#244C9D' }, { tag: t.tagName, color: '#244C9D' }, { tag: t.bracket, color: '#5C5850' },
  { tag: t.comment, color: '#6B675F', fontStyle: 'italic' }, { tag: t.number, color: '#2F5D46' }, { tag: t.atom, color: '#8A3B12' },
]);

export interface MathInputHandle { insert: (text: string) => void; focus: () => void }

export function MathInput({ value, onChange, minHeight = 96, fontSize = 13, autoFocus, handleRef, onEscape, label = 'Equation LaTeX' }: {
  value: string; onChange: (v: string) => void; minHeight?: number; fontSize?: number; autoFocus?: boolean;
  handleRef?: React.MutableRefObject<MathInputHandle | null>; onEscape?: () => void; label?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const cb = useRef(onChange);
  cb.current = onChange;
  const esc = useRef(onEscape);
  esc.current = onEscape;

  useEffect(() => {
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(), bracketMatching(), closeBrackets(), EditorView.lineWrapping,
          StreamLanguage.define(stex), syntaxHighlighting(hl), mathAutocomplete(),
          cmPlaceholder('Type LaTeX, e.g. \\frac{a}{b} — start with \\ for suggestions'),
          keymap.of([{ key: 'Escape', run: () => { esc.current?.(); return !!esc.current; } }, ...closeBracketsKeymap, ...completionKeymap, ...defaultKeymap, ...historyKeymap]),
          EditorView.updateListener.of((u) => { if (u.docChanged) cb.current(u.state.doc.toString()); }),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          EditorView.theme({ '&': { fontSize: `${fontSize}px`, minHeight: `${minHeight}px`, background: '#FDFCFA' }, '.cm-content': { fontFamily: 'var(--mono)', minHeight: `${minHeight}px`, padding: '8px 4px' }, '&.cm-focused': { outline: '2px solid var(--accent)' } }),
        ],
      }),
    });
    view.current = v;
    if (handleRef) handleRef.current = {
      insert: (text) => { const sel = v.state.selection.main; v.dispatch({ changes: { from: sel.from, to: sel.to, insert: text }, selection: { anchor: sel.from + text.length } }); v.focus(); },
      focus: () => v.focus(),
    };
    if (autoFocus) setTimeout(() => v.focus(), 0);
    return () => v.destroy();
  }, []);

  // external value changes (e.g. undo in the document)
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value && !v.hasFocus) v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
  }, [value]);

  return <div className="math-input" ref={host} style={{ border: '1px solid #D3CDC3', borderRadius: 6, overflow: 'hidden' }} />;
}
