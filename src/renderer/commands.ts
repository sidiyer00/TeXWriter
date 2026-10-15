// Application commands: one place for menu labels, shortcuts and actions. The menu bar,
// context menus and the (read-only) Keyboard shortcuts page are all built from here.
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import {
  api, closeProject, compileNow, getState, guard, openContextMenu, runAllGenerators, saveAll, setState, toast, togglePanel, allDiagnostics, gotoSource, promptText, type MenuItem,
} from './store';
import { editorRef } from './visual/editorRef';
import { sourceViewRef } from './components/SourceEditor';
import { anchorFor } from './visual/comments';
import { followCite, followLabel, followUrl } from './visual/navigate';
import { undo, redo, selectAll } from '@codemirror/commands';
import { openSearchPanel } from '@codemirror/search';

export interface Shortcut { keys: string; action: string; where?: string }

/** Every keyboard shortcut, grouped for the Shortcuts page. Not user-editable by design. */
export const SHORTCUTS: { group: string; items: Shortcut[] }[] = [
  { group: 'General', items: [
    { keys: 'Ctrl+S', action: 'Save all files (autosave is also on)' },
    { keys: 'Ctrl+O', action: 'Open a file in the project' },
    { keys: 'Ctrl+Enter', action: 'Compile the PDF' },
    { keys: 'Ctrl+Shift+G', action: 'Run the scripts of all generated tables and figures' },
    { keys: 'Ctrl+,', action: 'Settings' },
    { keys: 'F1', action: 'Keyboard shortcuts' },
    { keys: 'F8 / Shift+F8', action: 'Next / previous compile issue' },
    { keys: 'Ctrl+= / Ctrl+- / Ctrl+0', action: 'Zoom in / out / reset' },
  ] },
  { group: 'View', items: [
    { keys: 'Ctrl+1 / 2 / 3', action: 'Visual / Split / LaTeX mode' },
    { keys: 'Ctrl+\\', action: 'Show or hide the navigator' },
    { keys: 'Ctrl+Alt+P', action: 'Show or hide the properties panel' },
    { keys: 'Ctrl+Alt+C', action: 'Show the comments panel' },
  ] },
  { group: 'Editing', items: [
    { keys: 'Ctrl+Z / Ctrl+Y', action: 'Undo / redo' },
    { keys: 'Ctrl+X / C / V', action: 'Cut / copy / paste' },
    { keys: 'Ctrl+A', action: 'Select all' },
    { keys: 'Ctrl+F', action: 'Find (shows all matches)' },
    { keys: 'Ctrl+H', action: 'Find and replace (Replace all included)' },
    { keys: 'F3 / Shift+F3', action: 'Next / previous match' },
    { keys: 'Ctrl+click', action: 'Follow a cross-reference, citation or link' },
    { keys: 'F12', action: 'Go to the definition under the cursor' },
    { keys: 'Right-click', action: 'Context menu (spelling, formatting, table and comment actions)' },
  ] },
  { group: 'Formatting (visual editor)', items: [
    { keys: 'Ctrl+B / I / U', action: 'Bold / italic / underline' },
    { keys: 'Ctrl+E', action: 'Monospace' },
    { keys: 'Ctrl+Shift+H', action: 'Highlight' },
    { keys: 'Ctrl+Alt+0', action: 'Body text' },
    { keys: 'Ctrl+Alt+1 / 2 / 3', action: 'Section / subsection / subsubsection' },
    { keys: 'Ctrl+Shift+8', action: 'Bulleted list' },
    { keys: 'Ctrl+Shift+7', action: 'Numbered list' },
    { keys: 'Tab / Shift+Tab', action: 'Indent / outdent list item; next / previous table cell' },
    { keys: 'Shift+Enter', action: 'Line break' },
  ] },
  { group: 'Insert', items: [
    { keys: 'Ctrl+M', action: 'Inline math (or type $x$)' },
    { keys: 'Ctrl+Shift+M', action: 'Display equation' },
    { keys: 'Ctrl+Alt+T', action: 'Table…' },
    { keys: 'Ctrl+Alt+F', action: 'Footnote' },
    { keys: 'Ctrl+Shift+K', action: 'Citation' },
    { keys: 'Ctrl+Shift+R', action: 'Cross-reference' },
    { keys: 'Ctrl+K', action: 'Link' },
    { keys: 'Ctrl+Alt+M', action: 'New comment on the selection' },
  ] },
  { group: 'Equations', items: [
    { keys: '\\ then type', action: 'Suggestions for LaTeX commands (\\su → \\sum)' },
    { keys: 'Tab / Enter', action: 'Accept a suggestion; Tab moves between placeholders' },
    { keys: 'Double-click equation', action: 'Open the large equation editor' },
    { keys: 'Esc', action: 'Close the equation editor' },
  ] },
  { group: 'LaTeX source', items: [
    { keys: 'Ctrl+/', action: 'Comment or uncomment lines' },
    { keys: 'Ctrl+G', action: 'Go to line' },
    { keys: 'Ctrl+Space', action: 'Show completions' },
    { keys: 'Alt+↑ / Alt+↓', action: 'Move line up / down' },
    { keys: 'Shift+Alt+↓', action: 'Duplicate line' },
    { keys: 'Ctrl+]', action: 'Indent line' },
  ] },
  { group: 'PDF', items: [
    { keys: 'Double-click', action: 'Jump to the source of that line (SyncTeX)' },
    { keys: 'Click a link', action: 'Follow internal references and web links' },
  ] },
];

// ------------------------------------------------------------------ actions

export function focusTarget(): 'visual' | 'source' {
  const ae = document.activeElement;
  if (ae && sourceViewRef.current?.dom.contains(ae)) return 'source';
  return editorRef.lastFocus;
}

export function doUndo() {
  if (focusTarget() === 'source' && sourceViewRef.current) { undo(sourceViewRef.current); return; }
  editorRef.current?.chain().focus().undo().run();
}
export function doRedo() {
  if (focusTarget() === 'source' && sourceViewRef.current) { redo(sourceViewRef.current); return; }
  editorRef.current?.chain().focus().redo().run();
}
export function doSelectAll() {
  if (focusTarget() === 'source' && sourceViewRef.current) { selectAll(sourceViewRef.current); return; }
  editorRef.current?.chain().focus().selectAll().run();
}

export function openFind(replace: boolean) {
  const s = getState();
  if (s.view !== 'editor') return;
  if (s.mode === 'source' || focusTarget() === 'source') {
    if (sourceViewRef.current) openSearchPanel(sourceViewRef.current);
    return;
  }
  setState({ find: { replace, nonce: Date.now() } });
}

/** Start a comment on the current visual selection. */
export function newComment() {
  const ed = editorRef.current;
  const s = getState();
  if (!ed || s.view !== 'editor' || s.mode === 'source') { toast('Select text in the visual editor to comment on it.'); return; }
  const { from, to, empty } = ed.state.selection;
  if (empty) { toast('Select the text you want to comment on first.'); return; }
  const a = anchorFor(ed.state.doc, from, to);
  if (!a.quote.trim()) { toast('Comments attach to text; select some words.'); return; }
  setState({ draftComment: { ...a, from, to }, panel: { open: true, tab: 'comments' } });
}

/**
 * Insert a block (table, figure, code…) the way a word processor does: in an empty
 * paragraph it takes its place; inside a paragraph it goes after it rather than
 * splitting the sentence in two. The caret lands in the new block.
 */
export function insertBlock(ed: Editor, node: Record<string, unknown>) {
  const { $from } = ed.state.selection;
  const para = $from.parent;
  let pos: number | null = null;
  if ($from.depth >= 1 && para.isTextblock && para.content.size > 0) {
    pos = $from.parentOffset === 0 ? $from.before($from.depth) : $from.after($from.depth);
    // inside lists, callouts etc. insert after the outermost block
    if ($from.depth > 1) pos = $from.parentOffset === 0 ? $from.before(1) : $from.after(1);
  }
  if (pos === null) { ed.chain().focus().insertContent(node).run(); return; }
  ed.chain().focus().insertContentAt(pos, node).run();
  const n = ed.state.doc.nodeAt(pos);
  try {
    const sel = n?.isAtom ? NodeSelection.create(ed.state.doc, pos) : TextSelection.near(ed.state.doc.resolve(pos + 1));
    ed.view.dispatch(ed.state.tr.setSelection(sel).scrollIntoView());
  } catch { /* keep default selection */ }
}

export function insertInlineMath() {
  const ed = editorRef.current;
  if (!ed) return;
  const { from, to, empty } = ed.state.selection;
  const latex = empty ? 'x' : ed.state.doc.textBetween(from, to);
  ed.chain().focus().insertContent({ type: 'inlineMath', attrs: { latex, delim: 'dollar' } }).run();
  const pos = ed.state.selection.from - 1;
  if (ed.state.doc.nodeAt(pos)?.type.name === 'inlineMath') {
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
    setState({ equationModal: { pos, inline: true } });
  }
}

export function insertEquation() {
  const ed = editorRef.current;
  if (!ed) return;
  const labels = getState().labels;
  let k = 1;
  while (labels.has(`eq:new-${k}`)) k++;
  ed.chain().focus().insertContent({ type: 'mathBlock', attrs: { env: 'equation', latex: '', label: `eq:new-${k}` } }).run();
  // the inserted atom sits just before the cursor
  const $p = ed.state.selection.$from;
  let pos = -1;
  ed.state.doc.nodesBetween(Math.max(0, $p.pos - 2), $p.pos, (n, p) => { if (n.type.name === 'mathBlock') pos = p; });
  if (pos >= 0) setState({ equationModal: { pos, inline: false } });
}

export async function insertLink() {
  const ed = editorRef.current;
  if (!ed) return;
  const prev = ed.getAttributes('link').href as string | undefined;
  const url = await promptText(prev ? 'Edit link' : 'Insert link', 'Web address (leave empty to remove the link)', prev ?? 'https://');
  if (url === null) return;
  if (!url) { ed.chain().focus().unsetLink().run(); return; }
  const { empty } = ed.state.selection;
  if (empty) ed.chain().focus().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
  else ed.chain().focus().setLink({ href: url }).run();
}

/** Follow whatever is selected or under the cursor in the visual editor (F12). */
export function followAtCursor() {
  const ed = editorRef.current;
  if (!ed) return;
  const sel = ed.state.selection;
  const node = sel instanceof NodeSelection ? sel.node : ed.state.doc.nodeAt(sel.from) ?? ed.state.doc.nodeAt(Math.max(0, sel.from - 1));
  if (node?.type.name === 'crossRef') return void followLabel(node.attrs.key);
  if (node?.type.name === 'citation') return void followCite(String(node.attrs.keys).split(',')[0]);
  const link = ed.getAttributes('link').href as string | undefined;
  if (link) return followUrl(link);
  toast('Place the cursor on a reference, citation or link.');
}

export function nextIssue(dir: 1 | -1) {
  const s = getState();
  const ds = allDiagnostics().filter((d) => d.line);
  if (!ds.length) { toast('No issues with a source location.'); return; }
  const cur = ds.findIndex((d) => d.id === s.reviewIssue);
  const next = ds[(cur + (dir === 1 ? 1 : ds.length - 1)) % ds.length];
  setState({ reviewIssue: next.id });
  gotoSource(next.file, next.line);
}

let zoom = 1;
export function setZoom(f: number) { zoom = Math.min(2, Math.max(0.6, Math.round(f * 10) / 10)); void api.setZoom(zoom); }
export function initZoom(f: number) { zoom = f || 1; }
export function zoomBy(d: number) { setZoom(zoom + d); }

export const fileMenu = (): MenuItem[] => {
  const p = !!getState().project;
  return [
    { label: 'New project…', run: () => { closeProject(); setState({ view: 'home' }); setTimeout(() => document.querySelector<HTMLButtonElement>('[data-new-project]')?.click(), 50); } },
    { label: 'Open project folder…', run: async () => { const d = await api.chooseDirectory('Open a TeXWriter project or a folder of LaTeX files'); if (d) { const { openProject } = await import('./store'); await openProject(d); } } },
    { label: 'Open file in project…', shortcut: 'Ctrl+O', disabled: !p, run: () => setState({ quickOpen: true }) },
    { separator: true },
    { label: 'Save', shortcut: 'Ctrl+S', disabled: !p, run: () => void saveAll() },
    { label: 'Export PDF…', disabled: !p, run: () => void exportKind('pdf') },
    { label: 'Export source bundle…', disabled: !p, run: () => void exportKind('zip') },
    { label: 'Export provenance…', disabled: !p, run: () => void exportKind('prov') },
    { separator: true },
    { label: 'Document setup', disabled: !p, run: () => setState({ view: 'setup' }) },
    { label: 'Save as template…', disabled: !p, run: () => setState({ dialog: 'saveTemplate' }) },
    { label: 'Settings', shortcut: 'Ctrl+,', run: () => setState({ view: 'settings' }) },
    { separator: true },
    { label: 'Close project', disabled: !p, run: () => closeProject() },
    { label: 'Exit', run: () => window.close() },
  ];
};

export async function exportKind(kind: 'pdf' | 'zip' | 'prov') {
  const p = getState().project;
  if (!p) return;
  const fn = kind === 'pdf' ? api.exportPdf : kind === 'zip' ? api.exportBundle : api.exportProvenance;
  const out = await guard(() => fn(p.root), 'Export failed');
  if (out) toast(`Saved ${out}`, 'ok', { label: 'Show in folder', run: () => void api.revealInFolder(out) });
}

export const editMenu = (): MenuItem[] => [
  { label: 'Undo', shortcut: 'Ctrl+Z', run: doUndo },
  { label: 'Redo', shortcut: 'Ctrl+Y', run: doRedo },
  { separator: true },
  { label: 'Cut', shortcut: 'Ctrl+X', run: () => void api.editCommand('cut') },
  { label: 'Copy', shortcut: 'Ctrl+C', run: () => void api.editCommand('copy') },
  { label: 'Paste', shortcut: 'Ctrl+V', run: () => void api.editCommand('paste') },
  { label: 'Select all', shortcut: 'Ctrl+A', run: doSelectAll },
  { separator: true },
  { label: 'Find', shortcut: 'Ctrl+F', run: () => openFind(false) },
  { label: 'Find and replace', shortcut: 'Ctrl+H', run: () => openFind(true) },
  { separator: true },
  { label: 'New comment', shortcut: 'Ctrl+Alt+M', run: newComment },
  { label: 'Go to definition', shortcut: 'F12', run: followAtCursor },
];

export const viewMenu = (): MenuItem[] => {
  const s = getState();
  return [
    { label: 'Visual', shortcut: 'Ctrl+1', checked: s.mode === 'visual', run: () => setState({ view: 'editor', mode: 'visual' }) },
    { label: 'Split', shortcut: 'Ctrl+2', checked: s.mode === 'split', run: () => setState({ view: 'editor', mode: 'split' }) },
    { label: 'LaTeX', shortcut: 'Ctrl+3', checked: s.mode === 'source', run: () => setState({ view: 'editor', mode: 'source' }) },
    { separator: true },
    { label: 'Navigator', shortcut: 'Ctrl+\\', checked: s.navOpen, run: () => setState({ navOpen: !s.navOpen }) },
    { label: 'Properties panel', shortcut: 'Ctrl+Alt+P', checked: s.panel.open && s.panel.tab === 'properties', run: () => togglePanel('properties') },
    { label: 'Comments', shortcut: 'Ctrl+Alt+C', checked: s.panel.open && s.panel.tab === 'comments', run: () => togglePanel('comments') },
    { separator: true },
    { label: 'Generated tables and figures', disabled: !s.project, run: () => setState({ navOpen: true, navTab: 'generated' }) },
    { label: 'PDF review', disabled: !s.project, run: () => setState({ view: 'review' }) },
    { separator: true },
    { label: 'Zoom in', shortcut: 'Ctrl+=', run: () => zoomBy(0.1) },
    { label: 'Zoom out', shortcut: 'Ctrl+-', run: () => zoomBy(-0.1) },
    { label: 'Reset zoom', shortcut: 'Ctrl+0', run: () => setZoom(1) },
  ];
};

export const runMenu = (): MenuItem[] => {
  const p = !!getState().project;
  return [
    { label: 'Compile', shortcut: 'Ctrl+Enter', disabled: !p, run: () => void compileNow() },
    { label: 'Run all scripts', shortcut: 'Ctrl+Shift+G', disabled: !p, run: () => void runAllGenerators() },
    { separator: true },
    { label: 'Next issue', shortcut: 'F8', disabled: !p, run: () => nextIssue(1) },
    { label: 'Previous issue', shortcut: 'Shift+F8', disabled: !p, run: () => nextIssue(-1) },
  ];
};

export const helpMenu = (): MenuItem[] => [
  { label: 'Keyboard shortcuts', shortcut: 'F1', run: () => setState({ dialog: 'shortcuts' }) },
  { label: 'Check LaTeX and Python tools', run: () => setState({ view: 'settings' }) },
  { separator: true },
  { label: 'About TeXWriter', run: () => setState({ dialog: 'about' }) },
];

export { openContextMenu };

export async function insertFigure() {
  const ed = editorRef.current;
  const p = getState().project;
  if (!ed || !p) return;
  const f = await api.chooseFile('Insert a figure', [{ name: 'Figures', extensions: ['png', 'jpg', 'jpeg', 'pdf'] }]);
  if (!f) return;
  const rel = await guard(() => api.importAsset(p.root, f, 'figures'));
  if (!rel) return;
  const labels = getState().labels;
  let k = 1;
  while (labels.has(`fig:new-${k}`)) k++;
  insertBlock(ed, { type: 'figureBlock', attrs: { path: rel, caption: 'Caption.', label: `fig:new-${k}`, width: '0.8\\linewidth', placement: 'htbp', env: 'figure' } });
  const pr = await api.reloadProject(p.root);
  setState((s) => ({ project: s.project ? { ...s.project, files: pr.files } : s.project }));
}

export const insertMenu = (): MenuItem[] => {
  const ed = () => editorRef.current;
  const ok = !!editorRef.current && getState().view === 'editor' && getState().mode !== 'source';
  return [
    { label: 'Equation', shortcut: 'Ctrl+Shift+M', disabled: !ok, run: insertEquation },
    { label: 'Inline math', shortcut: 'Ctrl+M', disabled: !ok, run: insertInlineMath },
    { label: 'Table…', shortcut: 'Ctrl+Alt+T', disabled: !ok, run: () => setState({ dialog: 'insertTable' }) },
    { label: 'Generated table…', disabled: !ok, run: () => setState({ dialog: 'generated', generatedInit: { kind: 'table', mode: 'new' } }) },
    { label: 'Generated figure…', disabled: !ok, run: () => setState({ dialog: 'generated', generatedInit: { kind: 'figure', mode: 'new' } }) },
    { label: 'Table from data file (CSV)…', disabled: !ok, run: () => setState({ dialog: 'generated', generatedInit: { kind: 'table', mode: 'file' } }) },
    { label: 'Figure…', disabled: !ok, run: () => void insertFigure() },
    { separator: true },
    { label: 'Citation…', shortcut: 'Ctrl+Shift+K', disabled: !ok, run: () => setState({ picker: 'cite' }) },
    { label: 'Cross-reference…', shortcut: 'Ctrl+Shift+R', disabled: !ok, run: () => setState({ picker: 'ref' }) },
    { label: 'Footnote', shortcut: 'Ctrl+Alt+F', disabled: !ok, run: () => ed()?.chain().focus().insertContent({ type: 'footnote', attrs: { latex: 'Footnote text.' } }).run() },
    { label: 'Link…', shortcut: 'Ctrl+K', disabled: !ok, run: () => void insertLink() },
    { label: 'Comment', shortcut: 'Ctrl+Alt+M', disabled: !ok, run: newComment },
    { separator: true },
    { label: 'Code block', disabled: !ok, run: () => { const e = ed(); if (e) insertBlock(e, { type: 'codeBlock', attrs: { language: 'Python' }, content: [{ type: 'text', text: '# code' }] }); } },
    { label: 'Callout', disabled: !ok, run: () => { const e = ed(); if (e) insertBlock(e, { type: 'calloutBlock', attrs: { title: 'Finding F-0X · Severity: Medium' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Describe the finding.' }] }] }); } },
    { label: 'Page break', disabled: !ok, run: () => { const e = ed(); if (e) insertBlock(e, { type: 'pageBreak', attrs: { cmd: 'clearpage' } }); } },
    { label: 'Raw LaTeX block', disabled: !ok, run: () => { const e = ed(); if (e) insertBlock(e, { type: 'rawBlock', attrs: { label: 'LaTeX', latex: '% your LaTeX here' } }); } },
  ];
};
