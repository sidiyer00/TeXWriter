// CodeMirror 6 editor for LaTeX/BibTeX sources, synchronized with the store.
import { useEffect, useRef } from 'react';
import { Annotation, EditorState, StateEffect, StateField, RangeSetBuilder, Compartment } from '@codemirror/state';
import { EditorView, Decoration, DecorationSet, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment, selectAll } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
import { StreamLanguage, syntaxHighlighting, HighlightStyle, bracketMatching, type StreamParser } from '@codemirror/language';
import { closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { stex } from '@codemirror/legacy-modes/mode/stex';
import { python } from '@codemirror/legacy-modes/mode/python';
import { r as rMode } from '@codemirror/legacy-modes/mode/r';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { javascript, json } from '@codemirror/legacy-modes/mode/javascript';
import { tags as t } from '@lezer/highlight';
import { allDiagnostics, api, getState, mainBlockLines, mainFile, openContextMenu, setFileText, setState, toast, useStore } from '../store';
import { htmlTableToGrid, preferredTableStyle, textToGrid } from '../visual/clipboard';
import { gridToTableBlock } from '../../shared/latex/grid';
import { serializeTableBlock } from '../../shared/latex/table';
import { editorRef } from '../visual/editorRef';
import { documentAutocomplete } from '../latexCompletions';
import { followInSource } from '../visual/navigate';
import { isMod } from '../keys';

/** Pick a syntax mode from the file extension; LaTeX-family files get completions too. */
function languageFor(file: string): { parser: StreamParser<unknown> | null; latex: boolean } {
  const ext = file.toLowerCase().split('.').pop() ?? '';
  const m: Record<string, StreamParser<any>> = { py: python, r: rMode, sql: standardSQL, yml: yaml, yaml, toml, sh: shell, bash: shell, js: javascript, ts: javascript, json };
  if (['tex', 'sty', 'cls', 'def', 'cfg', 'ltx', 'dtx', 'bib', 'bbx', 'cbx', 'bst'].includes(ext)) return { parser: stex as StreamParser<unknown>, latex: ext !== 'bib' && ext !== 'bst' };
  return { parser: m[ext] ?? null, latex: false };
}

export function sourceContextMenu(v: EditorView, e: { clientX: number; clientY: number }, file: string) {
  const sel = v.state.selection.main;
  const head = sel.head;
  const line = v.state.doc.lineAt(head);
  const ro = v.state.readOnly;
  openContextMenu(e, [
    { label: 'Cut', shortcut: 'Ctrl+X', disabled: sel.empty || ro, run: () => { v.focus(); void api.editCommand('cut'); } },
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: sel.empty, run: () => { v.focus(); void api.editCommand('copy'); } },
    { label: 'Paste', shortcut: 'Ctrl+V', disabled: ro, run: () => { v.focus(); void api.editCommand('paste'); } },
    { label: 'Select all', shortcut: 'Ctrl+A', run: () => { v.focus(); selectAll(v); } },
    { separator: true },
    { label: 'Go to definition / follow', shortcut: 'F12 · Ctrl+click', run: () => void followInSource(line.text, head - line.from, file) },
    { label: 'Toggle comment', shortcut: 'Ctrl+/', disabled: ro, run: () => { v.focus(); toggleComment(v); } },
    { label: 'Find and replace', shortcut: 'Ctrl+F', run: () => { v.focus(); openSearchPanel(v); } },
    { separator: true },
    { label: 'Show in folder', run: () => { const r = getState().project?.root; if (r) void api.revealInFolder(`${r}/${file}`); } },
  ]);
}

const hl = HighlightStyle.define([
  { tag: t.keyword, color: '#244C9D' },
  { tag: t.tagName, color: '#244C9D' },
  { tag: t.atom, color: '#8A3B12' },
  { tag: t.bracket, color: '#5C5850' },
  { tag: t.comment, color: '#6B675F', fontStyle: 'italic' },
  { tag: t.string, color: '#2F5D46' },
  { tag: t.number, color: '#2F5D46' },
  { tag: t.variableName, color: '#8A3B12' },
  { tag: t.special(t.string), color: '#2F5D46' },
]);

const externalAnno = Annotation.define<boolean>();
const setLines = StateEffect.define<{ sync: [number, number] | null; gen: number[]; diag: { line: number; err: boolean }[] }>();
const linesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLines)) continue;
      const b = new RangeSetBuilder<Decoration>();
      const doc = tr.state.doc;
      const marks = new Map<number, string>();
      for (const l of e.value.gen) marks.set(l, 'cm-gen-line');
      for (const d of e.value.diag) marks.set(d.line, d.err ? 'cm-diag-line' : 'cm-diag-warn');
      if (e.value.sync) for (let l = e.value.sync[0]; l <= e.value.sync[1]; l++) marks.set(l, 'cm-sync-line');
      for (const l of [...marks.keys()].sort((a, c) => a - c)) {
        if (l < 1 || l > doc.lines) continue;
        const line = doc.line(l);
        b.add(line.from, line.from, Decoration.line({ class: marks.get(l)! }));
      }
      deco = b.finish();
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const sourceViewRef: { current: EditorView | null } = { current: null };

function generatedLines(text: string): number[] {
  const out: number[] = [];
  const lines = text.split('\n');
  let inGen = false;
  lines.forEach((l, i) => {
    if (/^\s*%\s*texwriter:generated\b/.test(l)) inGen = true;
    if (inGen) out.push(i + 1);
    if (/^\s*%\s*texwriter:end\b/.test(l)) inGen = false;
  });
  return out;
}

export function SourceEditor({ file }: { file: string }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const ro = useRef(new Compartment());
  const readOnly = file.startsWith('generated/');
  const fileState = useStore((s) => s.files[file]);

  useEffect(() => {
    if (!host.current) return;
    const initial = getState().files[file]?.text ?? '';
    const lang = languageFor(file);
    const v = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          lineNumbers(), highlightActiveLineGutter(), highlightActiveLine(), drawSelection(), history(), bracketMatching(), highlightSelectionMatches(),
          ...(lang.parser ? [StreamLanguage.define(lang.parser)] : []), syntaxHighlighting(hl), EditorView.lineWrapping,
          ...(lang.latex ? [documentAutocomplete()] : []), closeBrackets(),
          keymap.of([
            { key: 'Mod-Enter', run: () => true, preventDefault: false }, { key: 'Mod-s', run: () => true },
            { key: 'F12', run: (v) => { const l = v.state.doc.lineAt(v.state.selection.main.head); void followInSource(l.text, v.state.selection.main.head - l.from, file); return true; } },
            { key: 'Mod-h', run: (v) => { openSearchPanel(v); return true; } },
            ...closeBracketsKeymap, ...completionKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap, ...searchKeymap,
          ]),
          ro.current.of(EditorState.readOnly.of(readOnly)),
          linesField,
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(externalAnno))) {
              setFileText(file, u.state.doc.toString(), 'source');
            }
            if (u.selectionSet && u.transactions.some((tr) => tr.isUserEvent('select'))) {
              const line = u.state.doc.lineAt(u.state.selection.main.head).number;
              setState({ sourceLine: line });
              if (file === mainFile()) {
                const idx = mainBlockLines().findIndex(([a, b]) => line >= a && line <= b);
                setState({ syncIndex: idx >= 0 ? idx : null });
              }
            }
          }),
          EditorView.domEventHandlers({
            focus: () => { editorRef.lastFocus = 'source'; },
            mousedown: (e, v) => {
              if (!isMod(e) || e.button !== 0) return false;
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              if (pos === null) return false;
              const l = v.state.doc.lineAt(pos);
              e.preventDefault();
              void followInSource(l.text, pos - l.from, file);
              return true;
            },
            // spreadsheet ranges (Excel/Sheets HTML or tab-separated text) paste as a tabular
            paste: (e, v) => {
              if (!lang.latex || readOnly || !e.clipboardData) return false;
              const html = e.clipboardData.getData('text/html');
              const text = e.clipboardData.getData('text/plain');
              const g = (html && htmlTableToGrid(html)) || (text.includes('\t') ? textToGrid(text) : null);
              if (!g) return false;
              e.preventDefault();
              const latex = serializeTableBlock(gridToTableBlock(g, { style: preferredTableStyle() }));
              const sel = v.state.selection.main;
              v.dispatch({ changes: { from: sel.from, to: sel.to, insert: latex }, selection: { anchor: sel.from + latex.length }, userEvent: 'input.paste', scrollIntoView: true });
              toast('Pasted spreadsheet cells as a LaTeX table.', 'ok', {
                label: 'Paste as text',
                run: () => { if (v.state.sliceDoc(sel.from, sel.from + latex.length) === latex) v.dispatch({ changes: { from: sel.from, to: sel.from + latex.length, insert: text }, userEvent: 'input.paste' }); },
              });
              return true;
            },
            contextmenu: (e, v) => {
              const pos = v.posAtCoords({ x: e.clientX, y: e.clientY });
              const sel = v.state.selection.main;
              if (pos !== null && (sel.empty || pos < sel.from || pos > sel.to)) v.dispatch({ selection: { anchor: pos } });
              sourceContextMenu(v, e, file);
              return false;
            },
          }),
          EditorView.contentAttributes.of({ 'aria-label': `${file} source`, spellcheck: 'false' }),
        ],
      }),
    });
    view.current = v;
    sourceViewRef.current = v;
    return () => { v.destroy(); if (sourceViewRef.current === v) sourceViewRef.current = null; view.current = null; };
  }, [file]);

  // external text → editor (minimal diff keeps cursor and history sane)
  useEffect(() => {
    const v = view.current;
    if (!v || !fileState) return;
    const cur = v.state.doc.toString();
    if (cur === fileState.text) return;
    if (fileState.origin === 'source') return;
    const next = fileState.text;
    let a = 0;
    while (a < cur.length && a < next.length && cur[a] === next[a]) a++;
    let b = 0;
    while (b < cur.length - a && b < next.length - a && cur[cur.length - 1 - b] === next[next.length - 1 - b]) b++;
    v.dispatch({ changes: { from: a, to: cur.length - b, insert: next.slice(a, next.length - b) }, annotations: externalAnno.of(true) });
  }, [fileState?.version]);

  // decorations: sync range, generated regions, diagnostics
  const syncLines = useStore((s) => s.syncLines);
  const lastCompile = useStore((s) => s.lastCompile);
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const diag = allDiagnostics().filter((d) => d.line && (d.file ?? mainFile()).replace(/^\.\//, '') === file).map((d) => ({ line: d.line!, err: d.severity === 'error' }));
    v.dispatch({ effects: setLines.of({ sync: file === mainFile() ? syncLines : null, gen: generatedLines(v.state.doc.toString()), diag }) });
    if (syncLines && file === mainFile() && editorRef.lastFocus === 'visual') {
      const line = v.state.doc.line(Math.min(syncLines[0], v.state.doc.lines));
      v.dispatch({ effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    }
  }, [syncLines, lastCompile, file, fileState?.version]);

  // jumps from diagnostics / PDF
  const jump = useStore((s) => s.jump);
  useEffect(() => {
    const v = view.current;
    if (!v || !jump || jump.file !== file) return;
    const line = v.state.doc.line(Math.max(1, Math.min(jump.line, v.state.doc.lines)));
    v.dispatch({ selection: { anchor: line.from }, effects: EditorView.scrollIntoView(line.from, { y: 'center' }) });
    v.focus();
    if (file === mainFile()) {
      const idx = mainBlockLines().findIndex(([a, b]) => jump.line >= a && jump.line <= b);
      if (idx >= 0) setState({ syncIndex: idx });
    }
  }, [jump?.nonce, file]);


  return <div className="cm-host" ref={host} />;
}

