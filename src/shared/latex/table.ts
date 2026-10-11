// LaTeX tables <-> editable table nodes (TipTap table schema inside a `tableBlock`).
//
// Supported: table/tabular with l/c/r/p{..} columns, booktabs or \hline rules,
// \multicolumn (merged columns), \multirow (merged rows), \cellcolor / \rowcolor,
// header rows (bold), multi-level headers (\cmidrule under merged header cells),
// \rowcolors stripes, caption above or below, label, font-size command.
// Anything else stays a raw LaTeX block.
import type { JNode } from './model';
import { CommentInInline, parseInline, serializeInline } from './inline';
import { findEnvEnd, matchGroup, readArgs } from './scan';

export type TableStyle = 'booktabs' | 'grid' | 'minimal' | 'striped' | 'plain';
export const TABLE_STYLES: { id: TableStyle; label: string; hint: string }[] = [
  { id: 'booktabs', label: 'Booktabs', hint: 'Top, header and bottom rules — the standard for reports' },
  { id: 'grid', label: 'Grid', hint: 'Every cell boxed' },
  { id: 'minimal', label: 'Minimal', hint: 'Single rule under the header' },
  { id: 'striped', label: 'Striped', hint: 'Booktabs with shaded alternate rows' },
  { id: 'plain', label: 'Plain', hint: 'No rules' },
];

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

function parseColSpec(spec: string): { cols: string[]; grid: boolean } | null {
  const cols: string[] = [];
  let grid = false;
  let i = 0;
  while (i < spec.length) {
    const ch = spec[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '|') { grid = true; i++; continue; }
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
      for (let k = 0; k < Number(a.arg); k++) cols.push(...inner.cols);
      grid = grid || inner.grid;
      i = b.end; continue;
    }
    return null; // @{}, >{}, X, S … → keep as raw LaTeX
  }
  return cols.length ? { cols, grid } : null;
}

const RULE_RE = /^\s*(\\(?:toprule|midrule|bottomrule|hline|addlinespace|specialrule)(?:\[[^\]]*\])?(?:\{[^}]*\}){0,3}|\\(?:cline|cmidrule)(?:\([^)]*\))?\{[^}]*\})\s*/;

interface ParsedCell { colspan: number; rowspan: number; background: string | null; align: string | null; content: JNode[]; empty: boolean }

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
  const content = cellInline(s);
  return { colspan, rowspan, background, align, content, empty: s === '' };
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
function parseTabularBody(body: string, ncols: number): { rows: JNode[]; headerRows: number; striped: boolean; ruleKinds: Set<string> } | null {
  if (/(^|[^\\])%/.test(body)) return null;
  const segments = splitTop(body, '\\\\');
  const rows: JNode[] = [];
  let headerRows = -1;
  const ruleKinds = new Set<string>();
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
      out.push({ type: 'tableCell', attrs: { colspan: pc.colspan, rowspan: pc.rowspan, background: pc.background, align: pc.align }, content: [para(pc.content)] });
      if (pc.rowspan > 1) for (let k = 0; k < pc.colspan; k++) covered[col + k] = pc.rowspan - 1;
      col += pc.colspan;
      ci++;
    }
    if (ci < cells.length && cells.slice(ci).some((c) => c.trim() !== '')) return null; // too many cells
    if (col !== ncols) return null;
    rows.push({ type: 'tableRow', content: out });
    rowsSeen++;
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
  for (let k = 0; k < headerRows && k < rows.length; k++) {
    rows[k].content = (rows[k].content ?? []).map((c) => ({ ...c, type: 'tableHeader', content: [para(stripBold(c.content?.[0]?.content ?? []))] }));
  }
  return { rows, headerRows, striped: false, ruleKinds };
}

/** Try to parse `\begin{table}…\end{table}` or a bare `\begin{tabular}…\end{tabular}`. */
export function parseTableBlock(src: string): JNode | null {
  let s = src.trim();
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
  let caption = '', label = '', captionPos: 'top' | 'bottom' = 'top', size = '', striped = false;
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
    if (part === 'before') before = t; else after = t;
    return t.trim() === '';
  };
  if (!take('before') || !take('after')) return null;
  let parsed: ReturnType<typeof parseTabularBody>;
  try { parsed = parseTabularBody(body, spec.cols.length); } catch (e) { if (e instanceof CommentInInline) return null; throw e; }
  if (!parsed) return null;
  const k = parsed.ruleKinds;
  const style: TableStyle = spec.grid ? 'grid'
    : striped ? 'striped'
    : k.has('toprule') || k.has('bottomrule') || k.has('midrule') ? 'booktabs'
    : k.has('hline') ? 'minimal' : 'plain';
  return {
    type: 'tableBlock',
    attrs: { caption, label, placement, env, style, cols: spec.cols.join(' '), captionPos, size },
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
  const bar = style === 'grid';
  const spec = bar ? `|${cols.join('|')}|` : cols.join('');
  const at = (r: number, c: number) => placed.find((p) => p.r === r && p.c === c);
  const lines: string[] = [];
  const top = style === 'booktabs' || style === 'striped' ? '\\toprule' : bar ? '\\hline' : '';
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
        if (cs > 1) parts.push(`\\multicolumn{${cs}}{${bar ? (c === 0 ? '|c|' : 'c|') : 'c'}}{${bg}}`);
        else parts.push(bg);
        c += cs;
        continue;
      }
      const cell = p.cell;
      const cs = Math.max(1, Number(cell.attrs?.colspan ?? 1));
      const rs = Math.max(1, Number(cell.attrs?.rowspan ?? 1));
      const isHead = cell.type === 'tableHeader';
      let txt = cellText(cell);
      if (isHead && txt) txt = `\\textbf{${txt}}`;
      if (rs > 1) txt = `\\multirow{${rs}}{*}{${txt}}`;
      txt = colorPrefix(cell.attrs?.background) + txt;
      const align: string | null = cell.attrs?.align || (cs > 1 ? 'c' : null);
      const colAlign = /^[lcr]$/.test(cols[c]) ? cols[c] : 'l';
      if (cs > 1 || (align && align !== colAlign)) {
        const al = align || colAlign;
        const s2 = bar ? (c === 0 ? `|${al}|` : `${al}|`) : al;
        txt = `\\multicolumn{${cs}}{${s2}}{${txt}}`;
      }
      parts.push(txt);
      c += cs;
    }
    lines.push(`    ${parts.join(' & ')} \\\\`);
    // rules after this row
    if (r < headerRows - 1 && (style === 'booktabs' || style === 'striped')) {
      const cm = placed.filter((q) => q.r === r && Number(q.cell.attrs?.colspan ?? 1) > 1).map((q) => `\\cmidrule(lr){${q.c + 1}-${q.c + Number(q.cell.attrs?.colspan)}}`);
      if (cm.length) lines.push(`    ${cm.join(' ')}`);
    }
    if (r === headerRows - 1 && r < rows.length - 1) {
      if (style === 'booktabs' || style === 'striped') lines.push('    \\midrule');
      else if (style === 'minimal') lines.push('    \\hline');
    }
    if (bar) lines.push('    \\hline');
  }
  if (style === 'booktabs' || style === 'striped') lines.push('    \\bottomrule');
  const tabular = [`  \\begin{tabular}{${spec}}`, ...lines, '  \\end{tabular}'];
  const env: string = a.env || 'table';
  if (env === 'none') {
    return [...(style === 'striped' ? ['\\rowcolors{2}{black!4}{}'] : []), ...tabular.map((l) => l.slice(2))].join('\n');
  }
  const out = [`\\begin{${env}}${a.placement ? `[${a.placement}]` : ''}`, '  \\centering'];
  if (a.size) out.push(`  \\${a.size}`);
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
  return { type: 'tableBlock', attrs: { caption: 'Caption.', label, placement: 'htbp', env: 'table', style, cols: ['l', ...Array(cols - 1).fill('r')].join(' '), captionPos: 'top', size: '' }, content: [{ type: 'table', content: body }] };
}
