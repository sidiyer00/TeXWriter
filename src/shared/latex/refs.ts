// Bibliography keys, label numbering and outline for the visual editor.
import type { JNode } from './model';
import type { GeneratedBlockConfig } from '../types';

export interface BibEntry { key: string; type: string; author?: string; year?: string; title?: string; corporate?: boolean; url?: string; doi?: string }

export function parseBib(bib: string): BibEntry[] {
  const out: BibEntry[] = [];
  const re = /@(\w+)\s*\{\s*([^,\s]+)\s*,/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(bib))) {
    const type = m[1].toLowerCase();
    if (type === 'comment' || type === 'string' || type === 'preamble') continue;
    // grab the entry body up to the next @ at line start
    const next = bib.slice(m.index + m[0].length).search(/\n\s*@\w+\s*\{/);
    const body = next < 0 ? bib.slice(m.index) : bib.slice(m.index, m.index + m[0].length + next);
    const field = (f: string) => {
      const fm = new RegExp(`\\b${f}\\s*=\\s*(\\{((?:[^{}]|\\{[^{}]*\\})*)\\}|"([^"]*)"|(\\d+))`, 'i').exec(body);
      return fm ? (fm[2] ?? fm[3] ?? fm[4] ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim() : undefined;
    };
    const corporate = /\bauthor\s*=\s*\{\s*\{[^{}]*\}\s*\}/i.test(body);
    out.push({ key: m[2], type, author: field('author'), year: field('year'), title: field('title'), corporate, url: field('url'), doi: field('doi') });
  }
  return out;
}

export function shortAuthor(author?: string, corporate = false): string {
  if (!author) return '';
  if (corporate) return author.length > 28 ? author.split(/\s+/).filter((w) => /^[A-Z]/.test(w)).map((w) => w[0]).join('') : author;
  const people = author.split(/\s+and\s+/i);
  const last = (p: string) => (p.includes(',') ? p.split(',')[0] : p.trim().split(/\s+/).slice(-1)[0]).trim();
  if (people.length === 1) return last(people[0]);
  if (people.length === 2) return `${last(people[0])} & ${last(people[1])}`;
  return `${last(people[0])} et al.`;
}

export interface LabelInfo { label: string; kind: 'section' | 'equation' | 'table' | 'figure' | 'other'; number: string; title: string }
export interface OutlineItem { index: number; level: number; number: string; title: string; label?: string; children: { index: number; kind: string; text: string; label?: string; generated?: boolean }[] }

function plain(nodes?: JNode[]): string {
  return (nodes ?? []).map((n) => (n.type === 'text' ? n.text : n.type === 'inlineMath' ? `$${n.attrs?.latex}$` : '')).join('');
}

/**
 * Walk the document and number sections, equations, tables and figures the same way
 * the bundled preamble does (\numberwithin{equation|table|figure}{section}).
 */
export function numberDocument(doc: JNode, blocks: Record<string, GeneratedBlockConfig> = {}): { labels: Map<string, LabelInfo>; outline: OutlineItem[]; numbers: Map<number, string> } {
  const labels = new Map<string, LabelInfo>();
  const outline: OutlineItem[] = [];
  const numbers = new Map<number, string>();
  const sec = [0, 0, 0, 0];
  let eq = 0, tab = 0, fig = 0;
  let appendix = false;
  const secNum = () => {
    const top = appendix ? String.fromCharCode(64 + sec[1]) : String(sec[1]);
    return [top, ...sec.slice(2).filter((_, i) => i < 2)].slice(0, 1 + sec.slice(2).filter((x) => x > 0).length).join('.');
  };
  const within = () => (appendix ? String.fromCharCode(64 + Math.max(sec[1], 1)) : String(sec[1]));
  (doc.content ?? []).forEach((n, index) => {
    const a = n.attrs ?? {};
    if (n.type === 'rawBlock' && /\\appendix\b/.test(a.latex ?? '')) { appendix = true; sec[1] = 0; }
    if (n.type === 'heading') {
      const lvl = Math.min(3, Math.max(1, a.level ?? 1));
      let num = '';
      if (!a.star) {
        sec[lvl]++;
        for (let k = lvl + 1; k < sec.length; k++) sec[k] = 0;
        if (lvl === 1) { eq = 0; tab = 0; fig = 0; }
        const top = appendix ? String.fromCharCode(64 + sec[1]) : String(sec[1]);
        num = [top, ...sec.slice(2, lvl + 1)].join('.');
      }
      numbers.set(index, num);
      const title = plain(n.content);
      if (a.label) labels.set(a.label, { label: a.label, kind: 'section', number: num, title });
      if (lvl === 1 || outline.length === 0) outline.push({ index, level: lvl, number: num, title, label: a.label || undefined, children: [] });
      else outline.push({ index, level: lvl, number: num, title, label: a.label || undefined, children: [] });
      return;
    }
    const parent = outline[outline.length - 1];
    const child = (kind: string, text: string, label?: string, generated?: boolean) => parent?.children.push({ index, kind, text, label, generated });
    if (n.type === 'mathBlock' && !String(a.env).endsWith('*') && a.env !== 'displaymath') {
      eq++;
      const num = `${within()}.${eq}`;
      numbers.set(index, num);
      if (a.label) labels.set(a.label, { label: a.label, kind: 'equation', number: num, title: '' });
      child('equation', `Eq. ${num}`, a.label);
    } else if (n.type === 'figureBlock') {
      fig++;
      const num = `${within()}.${fig}`;
      numbers.set(index, num);
      if (a.label) labels.set(a.label, { label: a.label, kind: 'figure', number: num, title: a.caption ?? '' });
      child('figure', `Figure ${num}`, a.label);
    } else if (n.type === 'tableBlock' && a.env !== 'none' && a.caption) {
      tab++;
      const num = `${within()}.${tab}`;
      numbers.set(index, num);
      if (a.label) labels.set(a.label, { label: a.label, kind: 'table', number: num, title: a.caption ?? '' });
      child('table', `Table ${num}`, a.label);
    } else if (n.type === 'generatedBlock') {
      const cfg = blocks[a.id];
      if (cfg?.kind === 'table' || cfg?.kind === 'figure') {
        const isT = cfg.kind === 'table';
        const num = `${within()}.${isT ? ++tab : ++fig}`;
        numbers.set(index, num);
        if (cfg.label) labels.set(cfg.label, { label: cfg.label, kind: isT ? 'table' : 'figure', number: num, title: cfg.caption ?? '' });
        child(isT ? 'table' : 'figure', `${isT ? 'Table' : 'Figure'} ${num}`, cfg.label, true);
      } else child('summary', 'Generated summary', undefined, true);
    } else if (n.type === 'rawBlock') {
      const src: string = a.latex ?? '';
      const isTable = /\\begin\{table\*?\}/.test(src) && /\\caption/.test(src);
      const isFig = /\\begin\{figure\*?\}/.test(src) && /\\caption/.test(src);
      if (isTable || isFig) {
        const num = `${within()}.${isTable ? ++tab : ++fig}`;
        numbers.set(index, num);
        const lm = /\\label\{([^}]*)\}/.exec(src);
        if (lm) labels.set(lm[1], { label: lm[1], kind: isTable ? 'table' : 'figure', number: num, title: '' });
        child(isTable ? 'table' : 'figure', `${isTable ? 'Table' : 'Figure'} ${num}`, lm?.[1]);
      }
      // labels inside raw blocks (equations in align etc.)
      for (const m of src.matchAll(/\\label\{([^}]*)\}/g)) if (!labels.has(m[1])) labels.set(m[1], { label: m[1], kind: 'other', number: '?', title: '' });
    } else if (n.type === 'calloutBlock') {
      child('callout', a.title || 'Callout');
    }
  });
  void secNum;
  return { labels, outline, numbers };
}

export function refDisplay(cmd: string, info: LabelInfo | undefined): string {
  if (!info) return '??';
  if (cmd === 'eqref') return `(${info.number})`;
  if (cmd === 'autoref' || cmd === 'cref' || cmd === 'Cref') {
    const name = { section: 'Section', equation: 'Equation', table: 'Table', figure: 'Figure', other: '' }[info.kind];
    return name ? `${name} ${info.number}` : info.number;
  }
  if (cmd === 'nameref') return info.title || info.number;
  return info.number;
}
