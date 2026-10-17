// A red trash button in the page margin beside equations, tables, figures, code blocks,
// callouts, contents lists and raw LaTeX blocks. It appears while the pointer is over the
// block or the cursor (or a selection) is in it, and deletes the whole block.
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';
import { PAGE_W } from './pagination';

/** Block types that get the button; contents lists are raw blocks (\tableofcontents …). */
const DELETABLE: Record<string, string> = {
  mathBlock: 'equation', tableBlock: 'table', figureBlock: 'figure', codeBlock: 'code block',
  calloutBlock: 'callout', rawBlock: 'LaTeX block',
};

function rawName(latex: string): string {
  const l = latex.trim();
  if (l === '\\tableofcontents') return 'table of contents';
  if (/^\\(texwriterlistoftablesandfigures|listoftables|listoffigures)$/.test(l)) return 'list';
  return 'LaTeX block';
}

const TRASH = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

class BlockDeleteView {
  private btn: HTMLButtonElement;
  private hoverPos: number | null = null;
  private shownPos: number | null = null;
  private overBtn = false;
  private hideTimer = 0;
  private onMove = (e: MouseEvent) => { this.hoverPos = this.blockAt(e.target as Node); this.refresh(); };
  private onLeave = () => { window.clearTimeout(this.hideTimer); this.hideTimer = window.setTimeout(() => { this.hoverPos = null; this.refresh(); }, 250); };

  constructor(private view: EditorView) {
    const b = document.createElement('button');
    b.className = 'blk-del';
    b.type = 'button';
    b.innerHTML = TRASH;
    b.contentEditable = 'false';
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); this.remove(); });
    b.addEventListener('mouseenter', () => { this.overBtn = true; window.clearTimeout(this.hideTimer); });
    b.addEventListener('mouseleave', () => { this.overBtn = false; this.onLeave(); });
    this.btn = b;
    view.dom.addEventListener('mousemove', this.onMove);
    view.dom.addEventListener('mouseleave', this.onLeave);
  }

  update(view: EditorView) {
    this.view = view;
    // positions shift with every edit: find the hovered block again on the next move
    if (this.hoverPos !== null && !DELETABLE[view.state.doc.nodeAt(this.hoverPos)?.type.name ?? '']) this.hoverPos = null;
    this.refresh();
  }

  destroy() {
    window.clearTimeout(this.hideTimer);
    this.view.dom.removeEventListener('mousemove', this.onMove);
    this.view.dom.removeEventListener('mouseleave', this.onLeave);
    this.btn.remove();
  }

  /** Top-level block (of a deletable type) containing a DOM node. */
  private blockAt(target: Node | null): number | null {
    if (!target || !this.view.dom.contains(target)) return null;
    let el: Node | null = target;
    while (el && el.parentNode !== this.view.dom) el = el.parentNode;
    if (!el || (el as HTMLElement).classList?.contains('pg-gap')) return null;
    let pos: number;
    try { pos = this.view.posAtDOM(el, 0); } catch { return null; }
    const $p = this.view.state.doc.resolve(Math.min(pos, this.view.state.doc.content.size));
    const start = $p.depth > 0 ? $p.before(1) : pos;
    const n = this.view.state.doc.nodeAt(start);
    return n && DELETABLE[n.type.name] ? start : null;
  }

  /** Block holding the cursor or the selection, if it is deletable. */
  private selectedBlock(): number | null {
    const { selection, doc } = this.view.state;
    if (!this.view.hasFocus()) return null;
    const $f = selection.$from;
    const start = $f.depth > 0 ? $f.before(1) : selection.from;
    const n = doc.nodeAt(start);
    return n && DELETABLE[n.type.name] ? start : null;
  }

  private refresh() {
    const pos = this.hoverPos ?? (this.overBtn ? this.shownPos : null) ?? this.selectedBlock();
    const article = this.view.dom.closest<HTMLElement>('.page');
    const node = pos !== null ? this.view.state.doc.nodeAt(pos) : null;
    const dom = pos !== null ? (this.view.nodeDOM(pos) as HTMLElement | null) : null;
    if (pos === null || !node || !dom || !article || !dom.getBoundingClientRect) {
      this.shownPos = null;
      this.btn.classList.remove('show');
      return;
    }
    if (this.btn.parentElement !== article) article.appendChild(this.btn);
    const box = dom.classList.contains('react-renderer') && dom.firstElementChild ? dom.firstElementChild : dom;
    const a = article.getBoundingClientRect();
    const r = box.getBoundingClientRect();
    const z = a.width / PAGE_W || 1; // the page may be zoomed
    this.btn.style.top = `${(r.top - a.top) / z}px`;
    this.btn.style.left = `${(r.right - a.left) / z + 10}px`;
    const what = node.type.name === 'rawBlock' ? rawName(String(node.attrs.latex ?? '')) : DELETABLE[node.type.name];
    this.btn.title = `Delete this ${what}`;
    this.btn.setAttribute('aria-label', `Delete ${what}`);
    this.shownPos = pos;
    this.btn.classList.add('show');
  }

  private remove() {
    const pos = this.shownPos;
    if (pos === null) return;
    const { state } = this.view;
    const node = state.doc.nodeAt(pos);
    if (!node || !DELETABLE[node.type.name]) return;
    let tr = state.tr;
    // the document always keeps one block: an empty paragraph replaces the last one
    if (state.doc.childCount === 1) tr = tr.replaceWith(pos, pos + node.nodeSize, state.schema.nodes.paragraph.create());
    else tr = tr.delete(pos, pos + node.nodeSize);
    const $p = tr.doc.resolve(Math.min(pos, tr.doc.content.size));
    const sel = TextSelection.findFrom($p, 1, true) ?? TextSelection.findFrom($p, -1, true);
    if (sel) tr.setSelection(sel);
    this.hoverPos = null;
    this.overBtn = false;
    this.view.dispatch(tr.scrollIntoView());
    this.view.focus();
  }
}

export const BlockDelete = Extension.create({
  name: 'blockDelete',
  addProseMirrorPlugins() {
    return [new Plugin({ key: new PluginKey('blockDelete'), view: (view) => new BlockDeleteView(view) })];
  },
});
