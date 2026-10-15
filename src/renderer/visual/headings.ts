// Heading levels in the visual editor: \section down to \subparagraph, promote and demote.
import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';

export const MAX_HEADING = 5;

export const HEADING_STYLES = [
  { level: 1, label: 'Section', cmd: 'section' },
  { level: 2, label: 'Subsection', cmd: 'subsection' },
  { level: 3, label: 'Subsubsection', cmd: 'subsubsection' },
  { level: 4, label: 'Paragraph heading', cmd: 'paragraph' },
  { level: 5, label: 'Subparagraph heading', cmd: 'subparagraph' },
] as const;

/** The heading holding the cursor, if any. */
export function headingAt(ed: Editor): { pos: number; node: PMNode } | null {
  const $from = ed.state.selection.$from;
  for (let d = $from.depth; d > 0; d--) {
    const node = $from.node(d);
    if (node.type.name === 'heading') return { pos: $from.before(d), node };
  }
  return null;
}

export function headingLevel(ed: Editor | null | undefined): number {
  if (!ed) return 0;
  return (headingAt(ed)?.node.attrs.level as number | undefined) ?? 0;
}

/**
 * Body text (0) or heading level 1–5. An existing heading keeps its label and star; its
 * LaTeX command follows the new level (\chapter, which shares level 1, is kept at level 1).
 */
export function setBlockStyle(ed: Editor, level: number) {
  if (level === 0) { ed.chain().focus().setParagraph().run(); return; }
  const lvl = Math.min(MAX_HEADING, Math.max(1, level));
  const h = headingAt(ed);
  if (h) {
    if (h.node.attrs.level === lvl) return;
    ed.view.dispatch(ed.state.tr.setNodeMarkup(h.pos, undefined, { ...h.node.attrs, level: lvl, cmd: null }));
    ed.commands.focus();
    return;
  }
  ed.chain().focus().setNode('heading', { level: lvl }).run();
}

/** Promote (-1, towards \section) or demote (+1) the heading at the cursor. */
export function shiftHeading(ed: Editor, delta: -1 | 1): boolean {
  const lvl = headingLevel(ed);
  if (!lvl) return false;
  const next = lvl + delta;
  if (next < 1 || next > MAX_HEADING) return false;
  setBlockStyle(ed, next);
  return true;
}
