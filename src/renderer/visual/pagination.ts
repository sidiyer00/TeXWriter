// A4 pages in the visual editor. The document stays one ProseMirror view; widget
// decorations between blocks (or between the lines of a long paragraph) draw the end of
// one sheet — its footnotes and page number — the gap, and the top of the next sheet.
//
// Each pass hides the widgets, measures the natural layout, decides where the pages
// break, then sizes each widget's filler so every sheet is exactly one A4 page tall.
import { Extension } from '@tiptap/core';
import type { Editor } from '@tiptap/react';
import { Plugin, PluginKey, NodeSelection, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet, type EditorView } from '@tiptap/pm/view';
import type { Node as PMNode } from '@tiptap/pm/model';
import { parseInline } from '../../shared/latex/inline';
import { texToHtml } from './nodes';

/** A4 at 96 dpi, in CSS pixels. Keep in step with `.page` in styles.css. */
export const PAGE_W = 794;
export const PAGE_H = 1123;
const PAD_TOP = 56;
const PAD_BOTTOM = 72;
const GAP = 24;

export const pageKey = new PluginKey<DecorationSet>('pages');

interface Fn { index: number; pos: number; latex: string; y: number }
interface Brk { pos: number; inline: boolean; indent: number }
interface Plan { breaks: Brk[]; pageFns: Fn[][]; headH: number; head: string }

const views = new WeakMap<EditorView, Paginator>();

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** Display HTML for a footnote's LaTeX text. */
function fnHtml(latex: string): string {
  if (!latex.trim()) return '<span class="pg-fn-empty">Empty footnote — click to write it</span>';
  try {
    return parseInline(latex).map((n) => {
      if (n.type === 'text') {
        let h = esc(n.text ?? '');
        for (const m of n.marks ?? []) h = m.type === 'bold' ? `<b>${h}</b>` : m.type === 'italic' ? `<i>${h}</i>` : m.type === 'code' ? `<code>${h}</code>` : h;
        return h;
      }
      if (n.type === 'inlineMath') return texToHtml(n.attrs?.latex ?? '', false).html;
      if (n.type === 'citation') return `<span class="chip-cite">[${esc(n.attrs?.keys ?? '')}]</span>`;
      if (n.type === 'crossRef') return `<span class="chip-ref">${esc(n.attrs?.key ?? '')}</span>`;
      if (n.type === 'inlineRaw') return `<span class="chip-raw">${esc(n.attrs?.latex ?? '')}</span>`;
      return '';
    }).join('');
  } catch { return esc(latex); }
}

function footnotes(doc: PMNode): { pos: number; latex: string }[] {
  const out: { pos: number; latex: string }[] = [];
  doc.descendants((n, pos) => { if (n.type.name === 'footnote') out.push({ pos, latex: n.attrs.latex ?? '' }); });
  return out;
}

/** Footnote number (0-based) of the footnote node at `pos`. */
export function footnoteIndexAt(doc: PMNode, pos: number): number {
  return footnotes(doc).findIndex((f) => f.pos === pos);
}

function fillFns(el: HTMLElement, fns: Fn[]) {
  el.innerHTML = fns.map((f) => `<span class="pg-fn" data-fn="${f.index}"><sup title="Go to the reference">${f.index + 1}</sup><span class="pg-fn-text" title="Click to edit">${fnHtml(f.latex)}</span></span>`).join('');
  el.classList.toggle('has', fns.length > 0);
}

class Paginator {
  private timer = 0;
  private sig = '';
  private plan: Plan | null = null;
  private ro: ResizeObserver;
  private tail: HTMLElement | null = null;
  private editing = false;
  private pendingEdit: number | null = null;
  private dead = false;

  constructor(private view: EditorView) {
    views.set(view, this);
    this.ro = new ResizeObserver(() => this.schedule(120));
    this.ro.observe(view.dom);
    void document.fonts?.ready.then(() => this.schedule(0));
    this.schedule(60);
  }

  update(view: EditorView, prev: { doc: PMNode }) {
    this.view = view;
    if (!view.state.doc.eq(prev.doc)) this.schedule(this.pendingEdit !== null ? 0 : 220);
  }

  destroy() {
    this.dead = true;
    window.clearTimeout(this.timer);
    this.ro.disconnect();
    this.tail?.remove();
    const a = this.article();
    if (a) a.style.minHeight = '';
  }

  schedule(ms: number) {
    window.clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.pass(), ms);
  }

  private article(): HTMLElement | null { return this.view.dom.closest('.page'); }

  /** Open the footnote editor for footnote `index` once its page is drawn. */
  requestEdit(index: number) {
    this.pendingEdit = index;
    this.schedule(0);
  }

  pass() {
    if (this.dead || this.view.isDestroyed) return;
    if (this.editing) return;
    if (this.view.composing) { this.schedule(300); return; }
    const article = this.article();
    if (!article || !article.isConnected) return;
    const canvas = article.parentElement;
    const scroll = canvas?.scrollTop ?? 0;
    this.view.dom.classList.add('pg-measure');
    let plan: Plan;
    try { plan = this.measure(article); } finally {
      this.view.dom.classList.remove('pg-measure');
      if (canvas) canvas.scrollTop = scroll;
    }
    const sig = JSON.stringify(plan);
    if (sig !== this.sig) {
      this.sig = sig;
      this.plan = plan;
      this.view.dispatch(this.view.state.tr.setMeta(pageKey, this.decorations(plan)).setMeta('addToHistory', false));
    }
    this.fit(article);
    if (this.pendingEdit !== null) {
      const i = this.pendingEdit;
      this.pendingEdit = null;
      const el = this.fnElement(i);
      if (el) { el.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); this.edit(el, i, true); }
    }
  }

  // ------------------------------------------------------------ measuring

  private measure(article: HTMLElement): Plan {
    const view = this.view;
    const doc = view.state.doc;
    const aRect = article.getBoundingClientRect();
    const z = aRect.width / PAGE_W || 1;
    const edTop = view.dom.getBoundingClientRect().top;
    const y = (clientY: number) => (clientY - edTop) / z;
    const headEl = article.querySelector<HTMLElement>('.page-head');
    const headBottom = headEl ? (headEl.getBoundingClientRect().bottom - aRect.top) / z + parseFloat(getComputedStyle(headEl).marginBottom || '0') : PAD_TOP;
    const headH = Math.round(headBottom);
    const firstTop = (edTop - aRect.top) / z;
    const cap0 = PAGE_H - PAD_BOTTOM - firstTop;
    const capN = PAGE_H - PAD_BOTTOM - headH;

    // footnotes, at the natural height of their reference mark
    const fns: Fn[] = footnotes(doc).map((f, index) => {
      const dom = view.nodeDOM(f.pos) as HTMLElement | null;
      const r = dom?.getBoundingClientRect?.();
      return { index, pos: f.pos, latex: f.latex, y: r ? y(r.top + r.height / 2) : 0 };
    });
    const measurer = document.createElement('div');
    measurer.className = 'pg-fns';
    measurer.style.cssText = `position:absolute;visibility:hidden;left:0;top:0;width:${PAGE_W}px`;
    article.appendChild(measurer);
    const fnCache = new Map<string, number>();
    const fnHeight = (from: number, to: number) => {
      const list = fns.filter((f) => f.y >= from && f.y < to);
      if (!list.length) return 0;
      const key = list.map((f) => `${f.index}:${f.latex}`).join('\u0001');
      let h = fnCache.get(key);
      if (h === undefined) { fillFns(measurer, list); h = measurer.getBoundingClientRect().height / z; fnCache.set(key, h); }
      return h;
    };

    // the units pages may break between: top-level blocks, list items within lists
    interface Unit { pos: number; dom: HTMLElement; node: PMNode; top: number; bottom: number; kind: 'para' | 'heading' | 'break' | 'block' }
    const units: Unit[] = [];
    const add = (node: PMNode, pos: number) => {
      const dom = view.nodeDOM(pos) as HTMLElement | null;
      if (!dom || !(dom instanceof HTMLElement)) return;
      // React node views wrap the visible block, whose margins collapse through the wrapper
      const box = dom.classList.contains('react-renderer') && dom.firstElementChild instanceof HTMLElement ? dom.firstElementChild : dom;
      const r = box.getBoundingClientRect();
      const mb = parseFloat(getComputedStyle(box).marginBottom || '0') || 0;
      const t = node.type.name;
      units.push({ pos, dom, node, top: y(r.top), bottom: y(r.bottom) + mb, kind: t === 'paragraph' ? 'para' : t === 'heading' ? 'heading' : t === 'pageBreak' ? 'break' : 'block' });
    };
    doc.forEach((node, pos) => {
      if ((node.type.name === 'bulletList' || node.type.name === 'orderedList') && node.childCount > 1) {
        node.forEach((li, off) => add(li, pos + 1 + off));
      } else add(node, pos);
    });

    const breaks: Brk[] = [];
    const starts: number[] = [0];
    let pageStart = 0;
    let first = 0; // index of the first unit on the current page
    const cap = () => (breaks.length ? capN : cap0);
    const fits = (end: number) => end - pageStart + fnHeight(pageStart, end) <= cap() + 0.5;
    const indentOf = (el: HTMLElement) => {
      const p = el.getBoundingClientRect();
      return (p.left - aRect.left) / z + (parseFloat(getComputedStyle(el).paddingLeft || '0') || 0);
    };
    const newPage = (pos: number, top: number, inline: boolean, parent: HTMLElement, at: number) => {
      breaks.push({ pos, inline, indent: Math.round(indentOf(parent)) });
      pageStart = top;
      starts.push(top);
      first = at;
    };

    for (let i = 0; i < units.length; i++) {
      const u = units[i];
      if (u.kind === 'break') {
        if (i + 1 < units.length) { const n = units[i + 1]; newPage(n.pos, n.top, false, n.dom.parentElement!, i + 1); }
        continue;
      }
      if (fits(u.bottom)) continue;
      // a long paragraph flows over: split it between lines
      if (u.kind === 'para') {
        const lines = lineBoxes(u.dom).map((l) => ({ clientTop: l.top, top: y(l.top), bottom: y(l.bottom) }));
        let from = 0;
        let split = true;
        while (split && !fits(u.bottom)) {
          split = false;
          const rest = lines.length - from;
          if (rest < 2) break;
          const minKeep = rest >= 4 ? 2 : 1;
          let keep = 0;
          for (let m = rest - minKeep; m >= minKeep; m--) {
            if (fits(lines[from + m - 1].bottom)) { keep = m; break; }
          }
          // nothing fits on this page: move the whole paragraph instead (unless it already starts the page)
          if (!keep) break;
          const line = lines[from + keep];
          const pos = lineStart(view, u.pos, u.node, line.clientTop);
          if (pos === null) break;
          newPage(pos, line.top, true, u.dom, i);
          from += keep;
          split = true;
        }
        if (fits(u.bottom) || i === first) continue;
        if (from > 0) continue; // already split; the rest overflows a full page
      }
      if (i === first) continue; // taller than a page: let it overflow
      // keep a heading with the text that follows it
      let at = i;
      if (units[i - 1]?.kind === 'heading' && i - 1 > first) at = i - 1;
      const v = units[at];
      newPage(v.pos, v.top, false, v.dom.parentElement!, at);
      if (at !== i) { i = at; continue; }
      if (!fits(u.bottom) && u.kind === 'para') i--; // re-run the split on the new page
    }
    measurer.remove();

    const pageFns: Fn[][] = starts.map((s, k) => fns.filter((f) => f.y >= s && (k + 1 >= starts.length || f.y < starts[k + 1])).map((f) => ({ ...f, pos: 0, y: 0 })));
    return { breaks, pageFns, headH, head: headEl?.innerHTML ?? '' };
  }

  // ------------------------------------------------------------ drawing

  private decorations(plan: Plan): DecorationSet {
    const doc = this.view.state.doc;
    const decos = plan.breaks.map((b, k) => {
      const fns = plan.pageFns[k] ?? [];
      const key = `pg${k}|${b.inline ? 'i' : 'b'}|${b.indent}|${plan.headH}|${plan.head}|${fns.map((f) => `${f.index}:${f.latex}`).join('\u0001')}`;
      return Decoration.widget(b.pos, () => this.gap(k, b, fns, plan), { side: -1, key, ignoreSelection: true, stopEvent: () => true });
    });
    return DecorationSet.create(doc, decos);
  }

  private gap(k: number, b: Brk, fns: Fn[], plan: Plan): HTMLElement {
    const tag = b.inline ? 'span' : 'div';
    const el = document.createElement(tag);
    el.className = 'pg-gap';
    el.contentEditable = 'false';
    el.dataset.page = String(k);
    el.style.marginLeft = `${-b.indent}px`;
    el.style.width = `${PAGE_W}px`;
    const part = (cls: string) => { const p = document.createElement('span'); p.className = cls; el.appendChild(p); return p; };
    part('pg-fill');
    const fnEl = part('pg-fns');
    fillFns(fnEl, fns);
    part('pg-foot').textContent = String(k + 1);
    part('pg-sep');
    const head = part('pg-head');
    head.style.height = `${plan.headH}px`;
    const inner = document.createElement('span');
    inner.className = 'page-head';
    inner.innerHTML = plan.head;
    head.appendChild(inner);
    this.wire(el);
    return el;
  }

  /** Footnote clicks: the number jumps to the reference, the text opens the editor. */
  private wire(el: HTMLElement) {
    el.addEventListener('mousedown', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('textarea')) return;
      const fn = t.closest<HTMLElement>('.pg-fn');
      e.preventDefault();
      if (!fn) return;
      const i = Number(fn.dataset.fn);
      if (t.closest('sup')) { this.select(i); return; }
      if (t.closest('.pg-fn-text')) this.edit(fn, i, false);
    });
  }

  private fnElement(i: number): HTMLElement | null {
    return this.view.dom.querySelector<HTMLElement>(`.pg-fn[data-fn="${i}"]`) ?? this.tail?.querySelector<HTMLElement>(`.pg-fn[data-fn="${i}"]`) ?? null;
  }

  private select(i: number) {
    const f = footnotes(this.view.state.doc)[i];
    if (!f) return;
    const { state } = this.view;
    this.view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, f.pos)).scrollIntoView());
    this.view.focus();
  }

  private edit(fnEl: HTMLElement, i: number, isNew: boolean) {
    const f = footnotes(this.view.state.doc)[i];
    const text = fnEl.querySelector<HTMLElement>('.pg-fn-text');
    if (!f || !text) return;
    this.editing = true;
    const ta = document.createElement('textarea');
    ta.className = 'pg-fn-input';
    ta.value = f.latex;
    ta.placeholder = 'Footnote text (LaTeX)';
    ta.rows = 1;
    ta.setAttribute('aria-label', `Footnote ${i + 1}`);
    text.replaceWith(ta);
    const grow = () => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight}px`; this.fitSoon(); };
    grow();
    ta.focus();
    if (isNew || f.latex === 'Footnote text.') ta.select(); else ta.setSelectionRange(ta.value.length, ta.value.length);
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.editing = false;
      const value = ta.value.trim();
      ta.replaceWith(text);
      const doc = this.view.state.doc;
      const cur = footnotes(doc)[i];
      if (cur && save && value !== cur.latex) {
        const tr = this.view.state.tr;
        if (value) tr.setNodeMarkup(cur.pos, undefined, { ...doc.nodeAt(cur.pos)!.attrs, latex: value });
        else tr.delete(cur.pos, cur.pos + 1);
        this.view.dispatch(tr);
      } else if (cur && !cur.latex && !save) {
        this.view.dispatch(this.view.state.tr.delete(cur.pos, cur.pos + 1)); // abandoned new footnote
      } else this.schedule(0);
      return cur;
    };
    ta.addEventListener('input', grow);
    ta.addEventListener('blur', () => finish(true));
    ta.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); finish(false); this.caretAfter(i); }
      else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); finish(true); this.caretAfter(i); }
    });
  }

  private caretAfter(i: number) {
    const f = footnotes(this.view.state.doc)[i];
    const { state } = this.view;
    if (f) {
      const sel = TextSelection.near(state.doc.resolve(f.pos + 1));
      this.view.dispatch(state.tr.setSelection(sel).scrollIntoView());
    }
    this.view.focus();
  }

  private fitRaf = 0;
  private fitSoon() {
    cancelAnimationFrame(this.fitRaf);
    this.fitRaf = requestAnimationFrame(() => { const a = this.article(); if (a) this.fit(a); });
  }

  /** Size each page's filler so the sheets line up at A4 intervals. */
  private fit(article: HTMLElement) {
    const plan = this.plan;
    if (!plan) return;
    const aRect = article.getBoundingClientRect();
    const z = aRect.width / PAGE_W || 1;
    const gaps = Array.from(this.view.dom.querySelectorAll<HTMLElement>('.pg-gap')).sort((a, b) => Number(a.dataset.page) - Number(b.dataset.page));
    const reads = gaps.map((g) => {
      const fill = g.querySelector<HTMLElement>('.pg-fill')!;
      const fnEl = g.querySelector<HTMLElement>('.pg-fns')!;
      return { fill, old: fill.getBoundingClientRect().height / z, top: (g.getBoundingClientRect().top - aRect.top) / z, fnH: fnEl.getBoundingClientRect().height / z };
    });
    let delta = 0;
    let pageTop = 0;
    const writes: [HTMLElement, number][] = [];
    for (const r of reads) {
      const top = r.top + delta;
      const want = Math.max(0, Math.round((pageTop + PAGE_H - PAD_BOTTOM - r.fnH - top) * 100) / 100);
      delta += want - r.old;
      writes.push([r.fill, want]);
      pageTop = top + want + r.fnH + PAD_BOTTOM + GAP;
    }
    for (const [el, h] of writes) el.style.height = `${h}px`;
    article.style.minHeight = `${pageTop + PAGE_H}px`;

    // the last sheet's footnotes and number sit at the bottom of the article
    if (!this.tail || !this.tail.isConnected) {
      this.tail?.remove();
      this.tail = document.createElement('div');
      this.tail.className = 'pg-tail';
      this.tail.contentEditable = 'false';
      this.tail.innerHTML = '<span class="pg-fns"></span><span class="pg-foot"></span>';
      this.wire(this.tail);
      article.appendChild(this.tail);
    }
    const last = plan.pageFns[plan.breaks.length] ?? [];
    const tailFns = this.tail.querySelector<HTMLElement>('.pg-fns')!;
    const sig = last.map((f) => `${f.index}:${f.latex}`).join('\u0001');
    if (tailFns.dataset.sig !== sig && !tailFns.querySelector('textarea')) { fillFns(tailFns, last); tailFns.dataset.sig = sig; }
    this.tail.querySelector('.pg-foot')!.textContent = String(plan.breaks.length + 1);
  }
}

/** Line boxes of a paragraph, in client coordinates. */
function lineBoxes(el: HTMLElement): { top: number; bottom: number }[] {
  const range = document.createRange();
  range.selectNodeContents(el);
  const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0).sort((a, b) => a.top - b.top);
  const lines: { top: number; bottom: number }[] = [];
  for (const r of rects) {
    const mid = (r.top + r.bottom) / 2;
    const l = lines.find((x) => mid >= x.top && mid <= x.bottom);
    if (l) { l.top = Math.min(l.top, r.top); l.bottom = Math.max(l.bottom, r.bottom); }
    else lines.push({ top: r.top, bottom: r.bottom });
  }
  // text boxes are shorter than the line box; grow them to the line height
  const lh = parseFloat(getComputedStyle(el).lineHeight) * (el.getBoundingClientRect().height / (el.offsetHeight || 1) || 1);
  for (const l of lines) {
    const mid = (l.top + l.bottom) / 2;
    if (lh && l.bottom - l.top < lh) { l.top = mid - lh / 2; l.bottom = mid + lh / 2; }
  }
  return lines;
}

/**
 * Document position where the line whose box starts at `top` (client y) begins, inside the
 * paragraph at `pos`. Binary search on coordsAtPos, which unlike posAtCoords also works for
 * lines scrolled out of view.
 */
function lineStart(view: EditorView, pos: number, node: PMNode, top: number): number | null {
  let lo = pos + 1, hi = pos + node.nodeSize - 1;
  const below = (p: number) => { const c = view.coordsAtPos(p, 1); return (c.top + c.bottom) / 2 >= top; };
  if (!below(hi - 1)) return null;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (below(m)) hi = m; else lo = m + 1;
  }
  return lo > pos + 1 && lo < pos + node.nodeSize - 1 ? lo : null;
}

/** Insert an empty footnote at the caret and open its editor at the foot of the page. */
export function insertFootnote(ed: Editor) {
  ed.chain().focus().insertContent({ type: 'footnote', attrs: { latex: '' } }).run();
  const { state } = ed.view;
  const pos = state.selection.from - 1;
  if (state.doc.nodeAt(pos)?.type.name !== 'footnote') return;
  views.get(ed.view)?.requestEdit(footnoteIndexAt(state.doc, pos));
}

/** Open the editor of the footnote node at `pos`. */
export function editFootnoteAt(view: EditorView, pos: number) {
  const i = footnoteIndexAt(view.state.doc, pos);
  if (i >= 0) views.get(view)?.requestEdit(i);
}

export const Pagination = Extension.create({
  name: 'pagination',
  addProseMirrorPlugins() {
    return [new Plugin<DecorationSet>({
      key: pageKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, set) {
          const next = tr.getMeta(pageKey) as DecorationSet | undefined;
          if (next) return next;
          return tr.docChanged ? set.map(tr.mapping, tr.doc) : set;
        },
      },
      props: { decorations: (s) => pageKey.getState(s) },
      view: (view) => new Paginator(view),
    })];
  },
});

