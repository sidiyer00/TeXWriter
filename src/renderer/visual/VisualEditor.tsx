// The word-processor view of the main .tex file, kept in sync with the source.
import { useEffect, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import { extensions, numberingKey, syncKey } from './nodes';
import { Pagination } from './pagination';
import { editorRef } from './editorRef';
import { getState, mainFile, parsedMain, setFileText, setFlushHook, setState, subscribe, useStore } from '../store';
import { commentsKey } from './comments';
import { setZoom } from '../commands';
import { visualContextMenu } from './contextMenu';
import { serializeDocument, toDocJson, parseDocument } from '../../shared/latex/blocks';
import { lineOf } from '../../shared/latex/scan';
import type { JNode } from '../../shared/latex/model';

/** Source line range for each top-level node of the editor's current doc. */
export function editorBlockLines(): ([number, number] | null)[] {
  const ed = editorRef.current;
  if (!ed) return [];
  const p = parsedMain();
  const { tex, ranges } = serializeDocument(p.prefix, ed.getJSON() as JNode, p.suffix, p.leading);
  return ranges.map((r) => (r ? [lineOf(tex, r[0]), lineOf(tex, Math.max(r[0], r[1] - 1))] : null));
}

/** Write any pending visual edit to the store immediately. */
export let flushVisual: () => void = () => {};

export function scrollToBlock(index: number, highlight = true) {
  const ed = editorRef.current;
  if (!ed || index < 0 || index >= ed.state.doc.childCount) return;
  let pos = 0;
  for (let i = 0; i < index; i++) pos += ed.state.doc.child(i).nodeSize;
  const dom = ed.view.nodeDOM(pos) as HTMLElement | null;
  dom?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  if (highlight) ed.view.dispatch(ed.state.tr.setMeta(syncKey, index));
}

/**
 * ProseMirror starts with a NodeSelection when the document begins with an atom
 * (\\maketitle, a generated table…). Focusing the editor would then scroll to and
 * select that atom, so start in the first text block instead.
 */
function placeCaretAtFirstText(ed: import('@tiptap/react').Editor) {
  let target = -1;
  ed.state.doc.descendants((n, pos) => {
    if (target >= 0) return false;
    if (n.isTextblock) { target = pos + 1; return false; }
    return true;
  });
  if (target < 0) return;
  ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, target)).setMeta('addToHistory', false));
}

export function VisualEditor() {
  const project = useStore((s) => s.project);
  const hasDoc = useStore(() => parsedMain().hasDocument);
  const lastSerialized = useRef<string>('');
  const reloadTimer = useRef<number>(0);
  const updateTimer = useRef<number>(0);
  const pending = useRef<(() => void) | null>(null);

  const editor = useEditor({
    extensions: [...extensions(), Pagination],
    content: toDocJson(parsedMain()) as any,
    // keep the caret clear of the floating table toolbar when typing near the top
    editorProps: { attributes: { spellcheck: 'true', 'aria-label': 'Report body' }, scrollMargin: { top: 56, bottom: 24, left: 5, right: 5 }, scrollThreshold: { top: 56, bottom: 24, left: 0, right: 0 } },
    onUpdate: ({ editor: ed }) => {
      window.clearTimeout(updateTimer.current);
      pending.current = () => {
        pending.current = null;
        const p = parsedMain();
        if (!p.hasDocument) return;
        const { tex } = serializeDocument(p.prefix, ed.getJSON() as JNode, p.suffix, p.leading);
        lastSerialized.current = tex;
        setFileText(mainFile(), tex, 'visual');
        if (!ed.isDestroyed) reportSelection();
      };
      updateTimer.current = window.setTimeout(() => pending.current?.(), 180);
    },
    onSelectionUpdate: () => reportSelection(),
    onCreate: ({ editor: ed }) => placeCaretAtFirstText(ed),
    onFocus: () => { editorRef.lastFocus = 'visual'; },
  }, [project?.root]);

  function reportSelection() {
    const ed = editorRef.current;
    if (!ed) return;
    const { selection, doc } = ed.state;
    const $from = selection.$from;
    let index: number;
    let pos: number;
    if (selection instanceof NodeSelection && $from.depth === 0) {
      index = $from.index(0);
      pos = selection.from;
    } else {
      index = $from.index(0);
      pos = $from.depth >= 1 ? $from.before(1) : selection.from;
    }
    if (index >= doc.childCount) { setState({ selection: null, syncLines: null }); return; }
    const node = doc.child(index);
    let inline: { type: string; attrs: Record<string, any>; pos: number } | null = null;
    if (selection instanceof NodeSelection && selection.node.isInline) inline = { type: selection.node.type.name, attrs: { ...selection.node.attrs }, pos: selection.from };
    const lines = editorBlockLines()[index] ?? null;
    const next = { index, pos, type: node.type.name, attrs: { ...node.attrs }, inline };
    setState({ selection: next, syncLines: lines });
  }

  useEffect(() => {
    editorRef.current = editor;
    setState((s) => ({ editorTick: s.editorTick + 1 }));
    flushVisual = () => { window.clearTimeout(updateTimer.current); pending.current?.(); };
    setFlushHook(flushVisual);
    return () => {
      window.clearTimeout(updateTimer.current);
      pending.current?.();
      if (editorRef.current === editor) editorRef.current = null;
    };
  }, [editor]);

  // reload from source when the text changes elsewhere
  useEffect(() => {
    let lastVersion = getState().files[mainFile()]?.version ?? 0;
    let lastBlocks = getState().project?.manifest.blocks;
    return subscribe(() => {
      const s = getState();
      const f = s.files[mainFile()];
      const ed = editorRef.current;
      if (s.project?.manifest.blocks !== lastBlocks) {
        lastBlocks = s.project?.manifest.blocks;
        ed?.view.dispatch(ed.state.tr.setMeta(numberingKey, true));
      }
      if (!f || !ed || f.version === lastVersion) return;
      lastVersion = f.version;
      if (f.origin === 'visual' || f.text === lastSerialized.current) return;
      window.clearTimeout(reloadTimer.current);
      reloadTimer.current = window.setTimeout(() => {
        const cur = getState().files[mainFile()]?.text ?? '';
        const p = parseDocument(cur);
        if (!p.hasDocument) return;
        const sel = ed.state.selection.from;
        lastSerialized.current = cur;
        ed.commands.setContent(toDocJson(p) as any, { emitUpdate: false });
        const max = ed.state.doc.content.size;
        try {
          const $p = ed.state.doc.resolve(Math.min(sel, Math.max(0, max - 1)));
          const s2 = TextSelection.findFrom($p, 1, true) ?? TextSelection.findFrom($p, -1, true);
          if (s2) ed.view.dispatch(ed.state.tr.setSelection(s2).setMeta('addToHistory', false));
        } catch { /* ignore */ }
      }, f.origin === 'source' ? 300 : 0);
    });
  }, [editor]);

  // comment highlights follow the comment list, the active thread and the draft
  useEffect(() => {
    let last = '';
    return subscribe(() => {
      const s = getState();
      const sig = `${s.comments.length}|${s.comments.map((t) => `${t.id}${t.resolved ? 1 : 0}`).join()}|${s.activeComment}|${s.draftComment?.from}-${s.draftComment?.to}`;
      if (sig === last) return;
      last = sig;
      const ed = editorRef.current;
      if (ed && !ed.isDestroyed) ed.view.dispatch(ed.state.tr.setMeta(commentsKey, true));
    });
  }, [editor]);

  // highlight the block under the source cursor
  const syncIndex = useStore((s) => s.syncIndex);
  useEffect(() => { if (syncIndex !== null) scrollToBlock(syncIndex); }, [syncIndex]);

  // "Show" on a generated block (Generated tab, error toasts): select it so its properties open
  const focus = useStore((s) => s.focusBlock);
  useEffect(() => {
    const ed = editorRef.current;
    if (!focus || !ed) return;
    let pos = -1;
    ed.state.doc.forEach((n, offset) => { if (pos < 0 && n.type.name === 'generatedBlock' && n.attrs.id === focus.id) pos = offset; });
    if (pos < 0) return;
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
    (ed.view.nodeDOM(pos) as HTMLElement | null)?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [focus?.nonce]);

  // Ctrl+wheel (and trackpad pinch, which arrives as Ctrl+wheel) zooms the page only,
  // keeping the point under the pointer where it is
  const zoom = useStore((s) => s.sheetZoom);
  const canvas = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const old = getState().sheetZoom;
      const d = Math.max(-50, Math.min(50, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY));
      setZoom(old * Math.exp(-d / 400));
      const next = getState().sheetZoom;
      if (next === old) return;
      const r = el.getBoundingClientRect();
      const x = el.scrollLeft + e.clientX - r.left, y = el.scrollTop + e.clientY - r.top;
      requestAnimationFrame(() => el.scrollBy({ left: x * (next / old - 1), top: y * (next / old - 1) }));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [hasDoc]);

  const theme = useStore((s) => s.project?.manifest.theme);
  if (!hasDoc) {
    return (
      <div className="doc-canvas">
        <div className="page" style={{ minHeight: 200 }}>
          <div className="empty">
            <h3>Visual editing is paused</h3>
            <div className="small muted">The main file has no <span className="mono">\begin{'{document}'}</span> … <span className="mono">\end{'{document}'}</span> pair, so TeXWriter cannot tell the body from the preamble. Fix it in the LaTeX view and the visual editor comes back.</div>
            <button className="btn btn-sm" onClick={() => setState({ mode: 'source' })}>Open LaTeX source</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className="doc-canvas" ref={canvas} onMouseDown={(e) => { if (e.target === e.currentTarget) editor?.commands.focus('end'); }}
      onContextMenu={(e) => {
        if (!editor || !(e.target as HTMLElement).closest('.ProseMirror')) return;
        if ((e.target as HTMLElement).closest('input, textarea, select, .blk-actions')) return;
        visualContextMenu(editor, e.nativeEvent);
      }}>
      <article className="page" style={zoom !== 1 ? { zoom } : undefined}>
        <div className="page-head" aria-hidden="true"><span>{theme?.headerLeft || project?.manifest.name}</span><span>{theme?.headerRight}</span></div>
        <EditorContent editor={editor} />
      </article>
    </div>
  );
}
