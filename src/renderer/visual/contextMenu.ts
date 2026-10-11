// Right-click menu for the visual editor. Electron adds spelling suggestions for the word
// under the cursor (merged in by ContextMenu because the list starts with Cut/Copy/Paste).
import { NodeSelection, TextSelection } from '@tiptap/pm/state';
import type { Editor } from '@tiptap/react';
import { api, getState, gotoSource, mainFile, openContextMenu, setState, type MenuItem } from '../store';
import { insertLink, insertMenu, newComment, followAtCursor } from '../commands';
import { HIGHLIGHTS, TEXT_COLORS } from './marks';
import { TABLE_STYLES } from '../../shared/latex/table';
import { setColumnAlign, setTableBlockAttrs, tableBlockAt } from './table';
import { addColumn, deleteColumn } from '../components/Toolbar';
import { editorBlockLines } from './VisualEditor';
import { followCite } from './navigate';

/** Move the caret to the click unless it lands inside the current selection. */
function placeForRightClick(ed: Editor, e: MouseEvent) {
  const hit = ed.view.posAtCoords({ left: e.clientX, top: e.clientY });
  if (!hit) return;
  const { from, to } = ed.state.selection;
  if (hit.pos >= from && hit.pos <= to && !ed.state.selection.empty) return;
  const node = hit.inside >= 0 ? ed.state.doc.nodeAt(hit.inside) : null;
  if (node && node.isAtom && (node.isInline || node.isBlock)) {
    ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, hit.inside)));
    return;
  }
  try { ed.view.dispatch(ed.state.tr.setSelection(TextSelection.create(ed.state.doc, hit.pos))); } catch { /* position outside a text block */ }
}

export function visualContextMenu(ed: Editor, e: MouseEvent) {
  placeForRightClick(ed, e);
  const st = ed.state;
  const sel = st.selection;
  const node = sel instanceof NodeSelection ? sel.node : null;
  const c = () => ed.chain().focus();
  const items: MenuItem[] = [
    { label: 'Cut', shortcut: 'Ctrl+X', disabled: sel.empty, run: () => { ed.commands.focus(); void api.editCommand('cut'); } },
    { label: 'Copy', shortcut: 'Ctrl+C', disabled: sel.empty, run: () => { ed.commands.focus(); void api.editCommand('copy'); } },
    { label: 'Paste', shortcut: 'Ctrl+V', run: () => { ed.commands.focus(); void api.editCommand('paste'); } },
    { label: 'Select all', shortcut: 'Ctrl+A', run: () => c().selectAll().run() },
    { separator: true },
  ];

  // things you can follow
  if (node?.type.name === 'crossRef') items.push({ label: `Go to ${node.attrs.key}`, shortcut: 'Ctrl+click', run: followAtCursor });
  if (node?.type.name === 'citation') {
    const key = String(node.attrs.keys).split(',')[0].trim();
    const b = getState().bib.find((x) => x.key === key);
    if (b?.url || b?.doi) items.push({ label: 'Open source online', shortcut: 'Ctrl+click', run: () => void followCite(key) });
    items.push({ label: 'Show bibliography entry', run: () => void followCite(key, true) });
  }
  if (ed.isActive('link')) {
    items.push({ label: 'Open link', shortcut: 'Ctrl+click', run: followAtCursor });
    items.push({ label: 'Edit link…', shortcut: 'Ctrl+K', run: () => void insertLink() });
    items.push({ label: 'Remove link', run: () => c().extendMarkRange('link').unsetLink().run() });
  }
  if (node?.type.name === 'mathBlock' || node?.type.name === 'inlineMath') {
    items.push({ label: 'Edit equation…', shortcut: 'Double-click', run: () => setState({ equationModal: { pos: sel.from, inline: node.type.name === 'inlineMath' } }) });
  }
  if (items[items.length - 1] && !items[items.length - 1].separator) items.push({ separator: true });

  // text formatting
  const textSel = !node && !ed.isActive('codeBlock');
  if (textSel) {
    items.push(
      { label: 'Bold', shortcut: 'Ctrl+B', checked: ed.isActive('bold'), run: () => c().toggleBold().run() },
      { label: 'Italic', shortcut: 'Ctrl+I', checked: ed.isActive('italic'), run: () => c().toggleItalic().run() },
      { label: 'Underline', shortcut: 'Ctrl+U', checked: ed.isActive('underline'), run: () => c().toggleUnderline().run() },
      { label: 'Text colour', submenu: [...TEXT_COLORS.map((t) => ({ label: t.name, run: () => c().setTextColor(t.hex).run() })), { separator: true }, { label: 'Default colour', run: () => c().unsetTextColor().run() }] },
      { label: 'Highlight', submenu: [...HIGHLIGHTS.map((t) => ({ label: t.name, shortcut: t.hex === 'FFF176' ? 'Ctrl+Shift+H' : undefined, run: () => c().setHighlightColor(t.hex).run() })), { separator: true }, { label: 'No highlight', run: () => c().unsetHighlightColor().run() }] },
      { label: 'Clear formatting', disabled: sel.empty, run: () => c().unsetAllMarks().run() },
      { label: 'Paragraph style', submenu: [
        { label: 'Body text', shortcut: 'Ctrl+Alt+0', checked: ed.isActive('paragraph'), run: () => c().setParagraph().run() },
        { label: 'Section', shortcut: 'Ctrl+Alt+1', checked: ed.isActive('heading', { level: 1 }), run: () => c().setHeading({ level: 1 }).run() },
        { label: 'Subsection', shortcut: 'Ctrl+Alt+2', checked: ed.isActive('heading', { level: 2 }), run: () => c().setHeading({ level: 2 }).run() },
        { label: 'Subsubsection', shortcut: 'Ctrl+Alt+3', checked: ed.isActive('heading', { level: 3 }), run: () => c().setHeading({ level: 3 }).run() },
        { separator: true },
        { label: 'Bulleted list', shortcut: 'Ctrl+Shift+8', checked: ed.isActive('bulletList'), run: () => c().toggleBulletList().run() },
        { label: 'Numbered list', shortcut: 'Ctrl+Shift+7', checked: ed.isActive('orderedList'), run: () => c().toggleOrderedList().run() },
      ] },
      { label: 'New comment', shortcut: 'Ctrl+Alt+M', disabled: sel.empty, run: newComment },
      { separator: true },
    );
  }

  // tables
  if (ed.isActive('table')) {
    const tb = tableBlockAt(ed);
    items.push({ label: 'Table', submenu: [
      { label: 'Insert row above', run: () => c().addRowBefore().run() },
      { label: 'Insert row below', run: () => c().addRowAfter().run() },
      { label: 'Insert column left', run: () => addColumn('left') },
      { label: 'Insert column right', run: () => addColumn('right') },
      { separator: true },
      { label: 'Merge cells', disabled: !ed.can().mergeCells(), run: () => c().mergeCells().run() },
      { label: 'Split cell', disabled: !ed.can().splitCell(), run: () => c().splitCell().run() },
      { label: 'Toggle header cells', run: () => c().toggleHeaderCell().run() },
      { label: 'Align column', submenu: [
        { label: 'Left', run: () => setColumnAlign(ed, 'l') }, { label: 'Centre', run: () => setColumnAlign(ed, 'c') }, { label: 'Right', run: () => setColumnAlign(ed, 'r') },
      ] },
      { label: 'Style', submenu: TABLE_STYLES.map((t) => ({ label: t.label, checked: tb?.node.attrs.style === t.id, run: () => setTableBlockAttrs(ed, { style: t.id }) })) },
      { separator: true },
      { label: 'Delete row', run: () => c().deleteRow().run() },
      { label: 'Delete column', run: deleteColumn },
      { label: 'Delete table', danger: true, run: () => { const t = tableBlockAt(ed); if (t) ed.view.dispatch(ed.state.tr.delete(t.pos, t.pos + t.node.nodeSize)); } },
    ] });
  }

  items.push({ label: 'Insert', submenu: insertMenu() });
  items.push({ separator: true });
  items.push({ label: 'Properties', shortcut: 'Ctrl+Alt+P', run: () => setState({ panel: { open: true, tab: 'properties' } }) });
  items.push({
    label: 'Show in LaTeX source', run: () => {
      const idx = st.selection.$from.index(0);
      const l = editorBlockLines()[idx];
      gotoSource(mainFile(), l?.[0] ?? 1);
    },
  });
  openContextMenu(e, items);
}
