// LaTeX tables <-> editable table nodes (TipTap table schema inside a `tableBlock`).
//
// Supported: table/tabular with l/c/r/p{..} columns, booktabs or \hline rules,
// \multicolumn (merged columns), \multirow (merged rows), \cellcolor / \rowcolor,
// header rows (bold, optionally shaded), multi-level headers (\cmidrule under merged
// header cells), \rowcolors stripes, caption above or below, label, font size, row
// spacing (\arraystretch) and number-formatted cells (\qnum, see numfmt.ts).
// Anything else stays a raw LaTeX block.
import type { JNode } from './model';
import { CommentInInline, parseInline, serializeInline } from './inline';
import { findEnvEnd, matchGroup, readArgs } from './scan';
import { NEGATIVE_RED, decodeFormat, encodeFormat, formatValue, parseNumberText, type NumFormat } from './numfmt';

export type TableStyle = 'booktabs' | 'striped' | 'lines' | 'minimal' | 'boxed' | 'grid' | 'plain';
export const TABLE_STYLES: { id: TableStyle; label: string; hint: string }[] = [
  { id: 'booktabs', label: 'Booktabs', hint: 'Top, header and bottom rules — the standard for reports' },
  { id: 'striped', label: 'Striped', hint: 'Booktabs with shaded alternate rows' },
  { id: 'lines', label: 'Horizontal lines', hint: 'A rule under every row' },
  { id: 'minimal', label: 'Minimal', hint: 'Single rule under the header' },
  { id: 'boxed', label: 'Boxed', hint: 'Outer border and a rule under the header' },
  { id: 'grid', label: 'Grid', hint: 'Every cell boxed' },
  { id: 'plain', label: 'Plain', hint: 'No rules' },
];

export const TABLE_SIZES: { id: string; label: string }[] = [
  { id: '', label: 'Normal' }, { id: 'small', label: 'Small' }, { id: 'footnotesize', label: 'Footnote' }, { id: 'scriptsize', label: 'Script' },
];
export const TABLE_SPACING: { id: string; label: string }[] = [
  { id: '', label: 'Normal' }, { id: '1.15', label: 'Relaxed (1.15)' }, { id: '1.3', label: 'Open (1.3)' }, { id: '1.5', label: 'Wide (1.5)' },
];
export const HEADER_FILLS: { id: string; label: string }[] = [
  { id: '', label: 'None' }, { id: 'F2F2F2', label: 'Light grey' }, { id: 'E5ECF8', label: 'Light blue' }, { id: 'F3ECE6', label: 'Warm' }, { id: 'E6F1EA', label: 'Light green' },
];

// ------------------------------------------------------------------ number-formatted cells

/** Editor content for a formatted number: one text run, red when the format says so. */
export function numberNodes(value: string, f: NumFormat): JNode[] {
  const r = formatValue(value, f);
  if (!r) return [];
  return [{ type: 'text', text: r.text, ...(r.red ? { marks: [{ type: 'textColor', attrs: { color: NEGATIVE_RED } }] } : {}) }];
}

/** Plain text of inline content (non-text atoms make it non-numeric). */
export function inlinePlain(nodes: JNode[] | undefined): string {
  return (nodes ?? []).map((n) => (n.type === 'text' ? n.text ?? '' : '\u0000')).join('');
}

/**
 * The number a formatted cell holds right now: the stored value while the visible text
 * still matches it (full precision), otherwise whatever the user typed (null for text).
 */
export function cellNumber(attrs: Record<string, any> | undefined, content: JNode[] | undefined): { value: string; format: NumFormat } | null {
  const f = decodeFormat(attrs?.format);
  if (!f) return null;
  const text = inlinePlain(content);
  const stored = attrs?.value != null ? String(attrs.value) : null;
  if (stored != null && formatValue(stored, f)?.text === text) return { value: stored, format: f };
  const typed = parseNumberText(text, f.kind === 'percent');
  return typed != null ? { value: typed, format: f } : null;
}

export interface CellNode extends JNode { type: 'tableCell' | 'tableHeader' }

const HEXRE = /^[0-9A-Fa-f]{6}$/;

/** Split at top-level separators (not inside braces, not escaped). */
function splitTop(s: string, sep: '&' | '\\\\'): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') {
      if (sep === '\\\\' && s[i + 1] === '\\' && depth === 0) {
        out.push(s.slice(start, i));
        let j = i + 2;
        // optional [len] after \\
        const k = s.slice(j).match(/^\s*\[[^\]]*\]/);
        if (k) j += k[0].length;
        start = j;
        i = j - 1;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (sep === '&' && ch === '&' && depth === 0) { out.push(s.slice(start, i)); start = i + 1; }
  }
  out.push(s.slice(start));
  return out;
}

/** Column types, plus vertical rules: bars[i] is the rule left of column i (bars[n] = right edge). */
function parseColSpec(spec: string): { cols: string[]; bars: boolean[] } | null {
  const cols: string[] = [];
  const bars: boolean[] = [];
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '|') { bars[cols.length] = true; i++; continue; }
    if (ch === 'l' || ch === 'c' || ch === 'r') { cols.push(ch); i++; continue; }
    if (ch === 'p' || ch === 'm' || ch === 'b') {
      if (spec[i + 1] !== '{') return null;
      const e = matchGroup(spec, i + 1);
      if (e < 0) return null;
      cols.push(spec.slice(i, e));
      i = e; continue;
    }
    if (ch === '*') {
      // *{n}{spec}
      const a = readArgs(spec, i + 1, 0);
      if (a.arg === null) return null;
      const b = readArgs(spec, a.end, 0);
      if (b.arg === null) return null;
      const inner = parseColSpec(b.arg);
      if (!inner) return null;
      for (let k = 0; k < Number(a.arg); k++) {
        if (inner.bars[0]) bars[cols.length] = true;
        inner.cols.forEach((c, j) => { cols.push(c); if (inner.bars[j + 1]) bars[cols.length] = true; });
      }
      i = b.end; continue;
    }
    return null; // @{}, >{}, X, S … → keep as raw LaTeX
  }
  return cols.length ? { cols, bars: Array.from({ length: cols.length + 1 }, (_, k) => !!bars[k]) } : null;
}

const RULE_RE = /^\s*(\\(?:toprule|midrule|bottomrule|hline|addlinespace|specialrule)(?:\[[^\]]*\])?(?:\{[^}]*\}){0,3}|\\(?:cline|cmidrule)(?:\([^)]*\))?\{[^}]*\})\s*/;

interface ParsedCell { colspan: number; rowspan: number; background: string | null; align: string | null; content: JNode[]; empty: boolean; format: string | null; value: string | null }

function cellInline(src: string): JNode[] {
  const nodes = parseInline(src.trim());
  return nodes;
}

function parseCell(raw: string, rowColor: string | null): ParsedCell | null {
  let s = raw.trim();
  let colspan = 1;
  let rowspan = 1;
  let align: string | null = null;
  let background: string | null = rowColor;
  const takeColor = () => {
    const m = /^\\cellcolor(\[HTML\])?\{([^}]*)\}\s*/.exec(s);
    if (m) { background = m[1] ? m[2].toUpperCase() : m[2]; s = s.slice(m[0].length); }
  };
  takeColor();
  let m = /^\\multicolumn\s*\{(\d+)\}\s*\{([^}]*)\}\s*\{/.exec(s);
  if (m) {
    const open = m[0].length - 1;
    const e = matchGroup(s, open);
    if (e < 0 || s.slice(e).trim() !== '') return null;
    colspan = Number(m[1]);
    const a = m[2].replace(/\|/g, '').trim();
    align = /^[lcr]$/.test(a) ? a : null;
    s = s.slice(open + 1, e - 1).trim();
    takeColor();
  }
  m = /^\\multirow\s*\{(-?\d+)\}\s*(\[[^\]]*\])?\s*\{[^}]*\}\s*\{/.exec(s);
  if (m) {
    const open = m[0].length - 1;
    const e = matchGroup(s, open);
    if (e < 0 || s.slice(e).trim() !== '') return null;
    rowspan = Math.abs(Number(m[1]));
    s = s.slice(open + 1, e - 1).trim();
    takeColor();
  }
  const num = parseQnum(s);
  if (num) return { colspan, rowspan, background, align, content: num.content, empty: false, format: num.format, value: num.value };
  const content = cellInline(s);
  return { colspan, rowspan, background, align, content, empty: s === '', format: null, value: null };
}

/** `\qnum[format]{value}{shown}` filling a whole cell. */
function parseQnum(s: string): { format: string; value: string; content: JNode[] } | null {
  const q = /^\\qnum\s*\[([^\]]*)\]\s*\{/.exec(s);
  if (!q) return null;
  const o1 = q[0].length - 1;
  const e1 = matchGroup(s, o1);
  if (e1 < 0) return null;
  let o2 = e1;
  while (s[o2] === ' ') o2++;
  if (s[o2] !== '{') return null;
  const e2 = matchGroup(s, o2);
  if (e2 < 0 || s.slice(e2).trim() !== '') return null;
  const f = decodeFormat(q[1]);
  const value = parseNumberText(s.slice(o1 + 1, e1 - 1));
  if (!f || value == null) return null;
  const shown = s.slice(o2 + 1, e2 - 1).trim();
  // shown text edited by hand in the source wins over the stored value (see cellNumber)
  const content = formatValue(value, f)?.latex === shown ? numberNodes(value, f) : cellInline(shown);
  return { format: encodeFormat(f), value, content };
}

function stripBold(nodes: JNode[]): JNode[] {
  if (!nodes.length || !nodes.every((n) => n.type !== 'text' || n.marks?.some((k) => k.type === 'bold'))) return nodes;
  if (!nodes.some((n) => n.type === 'text')) return nodes;
  return nodes.map((n) => (n.type === 'text' ? { ...n, marks: (n.marks ?? []).filter((k) => k.type !== 'bold'), ...((n.marks ?? []).filter((k) => k.type !== 'bold').length ? {} : { marks: undefined }) } : n));
}

function para(content: JNode[]): JNode {
  return content.length ? { type: 'paragraph', content } : { type: 'paragraph' };
}

/** Parse the inside of a tabular environment into table rows. */
interface ParsedBody { rows: JNode[]; headerRows: number; ruleKinds: Set<string>; rulesBefore: string[][]; headerFill: string }

function parseTabularBody(body: string, ncols: number): ParsedBody | null {
  if (/(^|[^\\])%/.test(body)) return null;
  const segments = splitTop(body, '\\\\');
  const rows: JNode[] = [];
  let headerRows = -1;
  const ruleKinds = new Set<string>();
  const rulesBefore: string[][] = [[]]; // rules above row i; index rows.length = below the last row
  const rowColors: (string | null)[] = [];
  const covered: number[] = Array(ncols).fill(0); // remaining rows covered by a multirow
  let rowsSeen = 0;
  for (let si = 0; si < segments.length; si++) {
    let seg = segments[si];
    // leading rules
    for (;;) {
      const r = RULE_RE.exec(seg);
      if (!r) break;
      const kind = /\\(\w+)/.exec(r[1])![1];
      ruleKinds.add(kind);
      rulesBefore[rowsSeen].push(kind);
      if (kind === 'midrule' && headerRows < 0 && rowsSeen > 0) headerRows = rowsSeen;
      seg = seg.slice(r[0].length);
    }
    let rowColor: string | null = null;
    const rc = /^\s*\\rowcolor(\[HTML\])?\{([^}]*)\}\s*/.exec(seg);
    if (rc) { rowColor = rc[1] ? rc[2].toUpperCase() : rc[2]; seg = seg.slice(rc[0].length); }
    if (seg.trim() === '') continue;
    const cells = splitTop(seg, '&');
    const out: JNode[] = [];
    let col = 0;
    let ci = 0;
    while (col < ncols) {
      if (covered[col] > 0) {
        // the source has an (empty) placeholder cell for a multirow above
        const ph = cells[ci] !== undefined ? parseCell(cells[ci], null) : null;
        if (ph && !ph.empty && ph.content.length) return null;
        covered[col]--;
        col += ph && ph.colspan > 1 ? ph.colspan : 1;
        ci++;
        continue;
      }
      const raw = cells[ci];
      if (raw === undefined) {
        out.push({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, background: null, align: null }, content: [para([])] });
        col++; ci++;
        continue;
      }
      let pc: ParsedCell | null;
      try { pc = parseCell(raw, rowColor); } catch (e) { if (e instanceof CommentInInline) return null; throw e; }
      if (!pc) return null;
      out.push({ type: 'tableCell', attrs: { colspan: pc.colspan, rowspan: pc.rowspan, background: pc.background, align: pc.align, ...(pc.format ? { format: pc.format, value: pc.value } : {}) }, content: [para(pc.content)] });
      if (pc.rowspan > 1) for (let k = 0; k < pc.colspan; k++) covered[col + k] = pc.rowspan - 1;
      col += pc.colspan;
      ci++;
    }
    if (ci < cells.length && cells.slice(ci).some((c) => c.trim() !== '')) return null; // too many cells
    if (col !== ncols) return null;
    rows.push({ type: 'tableRow', content: out });
    rowColors.push(rowColor);
    rowsSeen++;
    rulesBefore[rowsSeen] = [];
  }
  if (!rows.length) return null;
  if (headerRows < 0) {
    // no \midrule: leading rows whose cells are all bold count as header rows
    headerRows = 0;
    for (const r of rows) {
      const cells = r.content ?? [];
      const allBold = cells.every((c) => {
        const inl = c.content?.[0]?.content ?? [];
        return inl.length === 0 || inl.every((n) => n.type === 'text' && n.marks?.some((k) => k.type === 'bold'));
      }) && cells.some((c) => (c.content?.[0]?.content ?? []).length > 0);
      if (allBold) headerRows++; else break;
    }
    if (headerRows === rows.length) headerRows = 0;
  }
  // the same \rowcolor on every header row is the table's header shading
  const fill = headerRows > 0 ? rowColors[0] : null;
  const headerFill = fill && rowColors.slice(0, headerRows).every((c) => c === fill) ? fill : '';
  for (let k = 0; k < headerRows && k < rows.length; k++) {
    rows[k].content = (rows[k].content ?? []).map((c) => ({
      ...c,
      type: 'tableHeader',
      attrs: headerFill && c.attrs?.background === headerFill ? { ...c.attrs, background: null } : c.attrs,
      content: [para(stripBold(c.content?.[0]?.content ?? []))],
    }));
  }
  return { rows, headerRows, ruleKinds, rulesBefore, headerFill };
}

/**
 * A table that may break across pages: longtable, with the header rows repeated at the top
 * of every page (\endfirsthead / \endhead). Font size and row spacing go in a size
 * environment around it so they stay local.
 */
function serializeLongtable(a: Record<string, any>, style: TableStyle, spec: string, lines: string[], headEnd: number): string {
  const cap = (a.caption ? `\\caption{${a.caption}}` : '') + (a.label ? `\\label{${a.label}}` : '');
  const bottom = a.captionPos === 'bottom';
  const out: string[] = [];
  if (style === 'striped') out.push('  \\rowcolors{2}{black!4}{}');
  out.push(`  \\begin{longtable}{${spec}}`);
  if (cap && !bottom) out.push(`    ${cap}\\\\`);
  if (headEnd > 0) {
    const head = lines.slice(0, headEnd);
    out.push(...head, '    \\endfirsthead', ...head, '    \\endhead');
  }
  out.push(...lines.slice(headEnd));
  if (cap && bottom) out.push(`    ${cap}\\\\`);
  out.push('  \\end{longtable}');
  const stretch = /^\d+(\.\d+)?$/.test(String(a.stretch ?? '')) ? `  \\renewcommand{\\arraystretch}{${a.stretch}}` : '';
  if (!a.size && !stretch && style !== 'striped') return out.map((l) => l.slice(2)).join('\n');
  const env = a.size || 'normalsize';
  return [`\\begin{${env}}`, ...(stretch ? [stretch] : []), ...out, `\\end{${env}}`].join('\n');
}

/** A caption row (`\caption{…}\label{…}\\`) at the start of `t`. */
function captionRow(t: string): { caption: string; label: string; len: number } | null {
  const m = /^\s*\\caption\s*\{/.exec(t);
  if (!m) return null;
  const e = matchGroup(t, m[0].length - 1);
  if (e < 0) return null;
  const rest = /^\s*(?:\\label\{([^}]*)\})?\s*\\\\/.exec(t.slice(e));
  if (!rest) return null;
  return { caption: t.slice(m[0].length, e - 1), label: rest[1] ?? '', len: e + rest[0].length };
}

/** `\begin{longtable}…` (optionally inside a size environment) → a breakable table block. */
function parseLongtable(src: string): JNode | null {
  let s = src.trim();
  let size = '', stretch = '';
  const wrap = /^\\begin\{(small|footnotesize|scriptsize|normalsize)\}/.exec(s);
  if (wrap) {
    if (!s.endsWith(`\\end{${wrap[1]}}`)) return null;
    if (wrap[1] !== 'normalsize') size = wrap[1];
    s = s.slice(wrap[0].length, s.length - `\\end{${wrap[1]}}`.length).trim();
    const st = /^\\renewcommand\s*\{?\\arraystretch\}?\s*\{(\d+(?:\.\d+)?)\}\s*/.exec(s);
    if (st) { stretch = st[1]; s = s.slice(st[0].length); }
  }
  const rc = /^\\rowcolors\{2\}\{[^}]*\}\{[^}]*\}\s*/.exec(s);
  const striped = !!rc;
  if (rc) s = s.slice(rc[0].length);
  if (!s.startsWith('\\begin{longtable}') || !s.endsWith('\\end{longtable}')) return null;
  let body = s.slice('\\begin{longtable}'.length, s.length - '\\end{longtable}'.length);
  if (body[0] !== '{') return null;
  const specEnd = matchGroup(body, 0);
  if (specEnd < 0) return null;
  const spec = body.slice(1, specEnd - 1);
  body = body.slice(specEnd);
  if (/\\end(last)?foot\b/.test(body)) return null;
  let caption = '', label = '', captionPos: 'top' | 'bottom' = 'top';
  const top = captionRow(body);
  if (top) { ({ caption, label } = top); body = body.slice(top.len); }
  else {
    const at = body.lastIndexOf('\\caption');
    const bot = at >= 0 ? captionRow(body.slice(at)) : null;
    if (bot && !body.slice(at + bot.len).trim()) { ({ caption, label } = bot); captionPos = 'bottom'; body = body.slice(0, at); }
  }
  // the header is written twice (first page, later pages): keep one copy
  const fh = body.indexOf('\\endfirsthead');
  if (fh >= 0) {
    const eh = body.indexOf('\\endhead', fh);
    if (eh < 0) return null;
    body = body.slice(0, fh) + body.slice(eh + '\\endhead'.length);
  } else body = body.replace(/\\endhead\b/, '');
  const n = parseTableBlock(`\\begin{table}\n${striped ? '\\rowcolors{2}{black!4}{}\n' : ''}\\begin{tabular}{${spec}}${body}\\end{tabular}\n\\end{table}`);
  if (!n) return null;
  return { ...n, attrs: { ...n.attrs, caption, label, captionPos, size, stretch, placement: 'htbp', env: 'table', breakable: true } };
}

/** Try to parse `\begin{table}…\end{table}`, a bare `\begin{tabular}…\end{tabular}`, or a longtable. */
export function parseTableBlock(src: string): JNode | null {
  let s = src.trim();
  if (/^\\begin\{(longtable|small|footnotesize|scriptsize|normalsize)\}/.test(s)) return parseLongtable(s);
  let env = 'none';
  let placement = '';
  let inner = s;
  const tm = /^\\begin\{(table\*?)\}/.exec(s);
  if (tm) {
    env = tm[1];
    if (!s.endsWith(`\\end{${env}}`)) return null;
    let i = tm[0].length;
    if (s[i] === '[') { const e = matchGroup(s, i); if (e < 0) return null; placement = s.slice(i + 1, e - 1); i = e; }
    inner = s.slice(i, s.length - `\\end{${env}}`.length);
  }
  const tb = inner.search(/\\begin\{tabular\}/);
  if (tb < 0) return null;
  const specStart = tb + '\\begin{tabular}'.length;
  if (inner[specStart] !== '{') return null;
  const specEnd = matchGroup(inner, specStart);
  if (specEnd < 0) return null;
  const spec = parseColSpec(inner.slice(specStart + 1, specEnd - 1));
  if (!spec) return null;
  const tEnd = findEnvEnd(inner, 'tabular', specStart);
  if (tEnd < 0) return null;
  const body = inner.slice(specEnd, tEnd - '\\end{tabular}'.length);
  let before = inner.slice(0, tb);
  let after = inner.slice(tEnd);
  if (env === 'none' && (before.trim() || after.trim())) return null;
  // extract caption / label / centering / size / rowcolors from the surroundings
  let caption = '', label = '', captionPos: 'top' | 'bottom' = 'top', size = '', striped = false, stretch = '';
  const take = (part: 'before' | 'after') => {
    let t = part === 'before' ? before : after;
    const cap = t.search(/\\caption\s*\{/);
    if (cap >= 0) {
      const open = t.indexOf('{', cap);
      const e = matchGroup(t, open);
      if (e < 0) return false;
      caption = t.slice(open + 1, e - 1);
      captionPos = part === 'before' ? 'top' : 'bottom';
      t = t.slice(0, cap) + t.slice(e);
    }
    const lm = /\\label\{([^}]*)\}/.exec(t);
    if (lm) { label = lm[1]; t = t.replace(lm[0], ''); }
    t = t.replace(/\\centering\b/, '');
    const sm = /\\(small|footnotesize|scriptsize|normalsize)\b/.exec(t);
    if (sm) { size = sm[1]; t = t.replace(sm[0], ''); }
    const rc = /\\rowcolors\{2\}\{[^}]*\}\{[^}]*\}/.exec(t);
    if (rc) { striped = true; t = t.replace(rc[0], ''); }
    const st = /\\renewcommand\s*\{?\\arraystretch\}?\s*\{(\d+(?:\.\d+)?)\}/.exec(t);
    if (st) { stretch = st[1]; t = t.replace(st[0], ''); }
    if (part === 'before') before = t; else after = t;
    return t.trim() === '';
  };
  if (!take('before') || !take('after')) return null;
  let parsed: ReturnType<typeof parseTabularBody>;
  try { parsed = parseTabularBody(body, spec.cols.length); } catch (e) { if (e instanceof CommentInInline) return null; throw e; }
  if (!parsed) return null;
  const k = parsed.ruleKinds;
  const n = spec.cols.length;
  const anyBar = spec.bars.some(Boolean);
  const outerOnly = n > 1 && spec.bars[0] && spec.bars[n] && spec.bars.slice(1, n).every((b) => !b);
  const everyRow = parsed.rulesBefore.every((r) => r.includes('hline') || r.includes('cline'));
  const style: TableStyle = anyBar ? (outerOnly ? 'boxed' : 'grid')
    : striped ? 'striped'
    : k.has('toprule') || k.has('bottomrule') || k.has('midrule') ? 'booktabs'
    : k.has('hline') ? (everyRow ? 'lines' : 'minimal') : 'plain';
  return {
    type: 'tableBlock',
    attrs: { caption, label, placement, env, style, cols: spec.cols.join(' '), captionPos, size, headerFill: parsed.headerFill, stretch },
    content: [{ type: 'table', content: parsed.rows }],
  };
}

// --------------------------------------------------------------------------- serialize

function cellText(c: JNode): string {
  const paras = (c.content ?? []).filter((p) => p.type === 'paragraph');
  return paras.map((p) => serializeInline(p.content)).filter(Boolean).join(' \\newline ');
}

function colorPrefix(bg: unknown): string {
  if (!bg) return '';
  const v = String(bg).replace(/^#/, '');
  return HEXRE.test(v) ? `\\cellcolor[HTML]{${v.toUpperCase()}}` : `\\cellcolor{${v}}`;
}

export function serializeTableBlock(node: JNode): string {
  const a = node.attrs ?? {};
  const style: TableStyle = a.style || 'booktabs';
  const table = (node.content ?? []).find((n) => n.type === 'table');
  const rows = table?.content ?? [];
  // grid occupancy: compute column count and positions
  const colsAttr: string[] = String(a.cols || '').split(/\s+/).filter(Boolean);
  const occ: boolean[][] = [];
  const placed: { r: number; c: number; cell: JNode }[] = [];
  rows.forEach((row, r) => {
    occ[r] ??= [];
    let c = 0;
    for (const cell of row.content ?? []) {
      while (occ[r][c]) c++;
      const cs = Math.max(1, Number(cell.attrs?.colspan ?? 1));
      const rs = Math.max(1, Number(cell.attrs?.rowspan ?? 1));
      placed.push({ r, c, cell });
      for (let dr = 0; dr < rs; dr++) { occ[r + dr] ??= []; for (let dc = 0; dc < cs; dc++) occ[r + dr][c + dc] = true; }
      c += cs;
    }
  });
  const ncols = Math.max(colsAttr.length, ...occ.map((r) => r.length), 1);
  const cols = Array.from({ length: ncols }, (_, i) => colsAttr[i] || (i === 0 ? 'l' : 'r'));
  const headerRows = (() => { let n = 0; for (const r of rows) { if ((r.content ?? []).length && (r.content ?? []).every((c) => c.type === 'tableHeader')) n++; else break; } return n; })();
  const booktabsLike = style === 'booktabs' || style === 'striped';
  // vertical rules: barAt(i) is the rule left of column i
  const barAt = (i: number) => style === 'grid' || (style === 'boxed' && (i === 0 || i === ncols));
  const spec = style === 'grid' ? `|${cols.join('|')}|` : style === 'boxed' ? `|${cols.join('')}|` : cols.join('');
  const mcSpec = (c: number, cs: number, al: string) => `${c === 0 && barAt(0) ? '|' : ''}${al}${barAt(c + cs) ? '|' : ''}`;
  const fill = String(a.headerFill || '').replace(/^#/, '');
  const fillCmd = fill ? (HEXRE.test(fill) ? `\\rowcolor[HTML]{${fill.toUpperCase()}} ` : `\\rowcolor{${fill}} `) : '';
  const at = (r: number, c: number) => placed.find((p) => p.r === r && p.c === c);
  // a rule under row r: \hline, or \cline segments that skip cells merged down into row r+1
  const fullRule = (r: number) => {
    const open = new Set<number>();
    for (const q of placed) {
      const rs = Math.max(1, Number(q.cell.attrs?.rowspan ?? 1));
      if (q.r <= r && r < q.r + rs - 1) for (let k = 0; k < Math.max(1, Number(q.cell.attrs?.colspan ?? 1)); k++) open.add(q.c + k);
    }
    if (!open.size) return '\\hline';
    const segs: string[] = [];
    for (let c = 0; c < ncols; c++) {
      if (open.has(c)) continue;
      let e = c;
      while (e + 1 < ncols && !open.has(e + 1)) e++;
      segs.push(`\\cline{${c + 1}-${e + 1}}`);
      c = e;
    }
    return segs.join(' ');
  };
  const lines: string[] = [];
  let headEnd = 0; // lines[0..headEnd) are the top rule, the header rows and their rules
  const top = booktabsLike ? '\\toprule' : style === 'grid' || style === 'boxed' || style === 'lines' ? '\\hline' : '';
  if (top) lines.push(`    ${top}`);
  for (let r = 0; r < rows.length; r++) {
    const parts: string[] = [];
    for (let c = 0; c < ncols;) {
      const p = at(r, c);
      if (!p) {
        // covered by a multirow from above (or a hole): emit a placeholder
        const owner = placed.find((q) => q.r < r && q.c <= c && c < q.c + Number(q.cell.attrs?.colspan ?? 1) && r < q.r + Number(q.cell.attrs?.rowspan ?? 1));
        const cs = owner ? Number(owner.cell.attrs?.colspan ?? 1) : 1;
        const bg = owner ? colorPrefix(owner.cell.attrs?.background) : '';
        if (cs > 1) parts.push(`\\multicolumn{${cs}}{${mcSpec(c, cs, 'c')}}{${bg}}`);
        else parts.push(bg);
        c += cs;
        continue;
      }
      const cell = p.cell;
      const cs = Math.max(1, Number(cell.attrs?.colspan ?? 1));
      const rs = Math.max(1, Number(cell.attrs?.rowspan ?? 1));
      const isHead = cell.type === 'tableHeader';
      const num = isHead ? null : cellNumber(cell.attrs, cell.content?.[0]?.content);
      let txt = num ? `\\qnum[${encodeFormat(num.format)}]{${num.value}}{${formatValue(num.value, num.format)!.latex}}` : cellText(cell);
      if (isHead && txt) txt = `\\textbf{${txt}}`;
      if (rs > 1) txt = `\\multirow{${rs}}{*}{${txt}}`;
      txt = colorPrefix(cell.attrs?.background) + txt;
      const align: string | null = cell.attrs?.align || (cs > 1 ? 'c' : null);
      const colAlign = /^[lcr]$/.test(cols[c]) ? cols[c] : 'l';
      if (cs > 1 || (align && align !== colAlign)) {
        const al = align || colAlign;
        txt = `\\multicolumn{${cs}}{${mcSpec(c, cs, al)}}{${txt}}`;
      }
      parts.push(txt);
      c += cs;
    }
    lines.push(`    ${r < headerRows ? fillCmd : ''}${parts.join(' & ')} \\\\`);
    // rules after this row
    const last = r === rows.length - 1;
    if (r < headerRows - 1 && (booktabsLike || style === 'minimal' || style === 'boxed')) {
      // multi-level headers: a partial rule under each header cell that spans columns
      const spans = placed.filter((q) => q.r === r && Number(q.cell.attrs?.colspan ?? 1) > 1 && Number(q.cell.attrs?.rowspan ?? 1) <= headerRows - 1 - r);
      const cm = spans.map((q) => booktabsLike ? `\\cmidrule(lr){${q.c + 1}-${q.c + Number(q.cell.attrs?.colspan)}}` : `\\cline{${q.c + 1}-${q.c + Number(q.cell.attrs?.colspan)}}`);
      if (cm.length) lines.push(`    ${cm.join(' ')}`);
    }
    if (style === 'grid' || style === 'lines') lines.push(`    ${fullRule(r)}`);
    else if (last) { if (booktabsLike) lines.push('    \\bottomrule'); else if (style === 'boxed') lines.push('    \\hline'); }
    else if (r === headerRows - 1) { if (booktabsLike) lines.push('    \\midrule'); else if (style === 'minimal' || style === 'boxed') lines.push('    \\hline'); }
    if (r === headerRows - 1) headEnd = lines.length;
  }
  if (a.breakable) return serializeLongtable(a, style, spec, lines, headEnd);
  const tabular = [`  \\begin{tabular}{${spec}}`, ...lines, '  \\end{tabular}'];
  const env: string = a.env || 'table';
  if (env === 'none') {
    return [...(style === 'striped' ? ['\\rowcolors{2}{black!4}{}'] : []), ...tabular.map((l) => l.slice(2))].join('\n');
  }
  const out = [`\\begin{${env}}${a.placement ? `[${a.placement}]` : ''}`, '  \\centering'];
  if (a.size) out.push(`  \\${a.size}`);
  if (/^\d+(\.\d+)?$/.test(String(a.stretch ?? ''))) out.push(`  \\renewcommand{\\arraystretch}{${a.stretch}}`);
  const cap = [a.caption ? `  \\caption{${a.caption}}` : '', a.label ? `  \\label{${a.label}}` : ''].filter(Boolean);
  if ((a.captionPos ?? 'top') === 'top') out.push(...cap);
  if (style === 'striped') out.push('  \\rowcolors{2}{black!4}{}');
  out.push(...tabular);
  if (a.captionPos === 'bottom') out.push(...cap);
  out.push(`\\end{${env}}`);
  return out.join('\n');
}

/** A fresh table for the Insert menu. */
export function newTable(rows: number, cols: number, style: TableStyle, label: string, headerRows = 1): JNode {
  const mk = (type: 'tableHeader' | 'tableCell', text: string) => ({ type, attrs: { colspan: 1, rowspan: 1, background: null, align: null }, content: [para(text ? [{ type: 'text', text }] : [])] });
  const body: JNode[] = [];
  for (let r = 0; r < rows; r++) {
    const head = r < headerRows;
    body.push({ type: 'tableRow', content: Array.from({ length: cols }, (_, c) => mk(head ? 'tableHeader' : 'tableCell', head ? (c === 0 ? 'Item' : `Column ${c}`) : '')) });
  }
  return { type: 'tableBlock', attrs: { caption: 'Caption.', label, placement: 'htbp', env: 'table', style, cols: ['l', ...Array(cols - 1).fill('r')].join(' '), captionPos: 'top', size: '', headerFill: '', stretch: '' }, content: [{ type: 'table', content: body }] };
}
