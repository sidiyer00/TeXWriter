// Block-level LaTeX <-> document model with exact source ranges.
//
// Design: LaTeX is the single source of truth. Parsing is total: anything the visual
// editor cannot represent faithfully becomes a `rawBlock` (or `inlineRaw`) that keeps
// its exact source. Every top-level block remembers its original source and its
// canonical serialization; on save, untouched blocks emit their original bytes.
import { JNode, HEADING_COMMANDS, HEADING_BY_LEVEL, MATH_ENVS, PAGEBREAK_COMMANDS, FRIENDLY_COMMANDS, INLINE_COMMANDS } from './model';
import { CommentInInline, parseInline, serializeInline, wrap } from './inline';
import { parseTableBlock, serializeTableBlock } from './table';
import { findEnvEnd, matchGroup, readArgs, readCommand, skipArgWs, skipInlineWs, lineOf } from './scan';

export interface ParsedBlock { node: JNode; from: number; to: number }

export interface ParsedDocument {
  /** everything up to and including `\begin{document}` */
  prefix: string;
  /** whitespace at the start of the body */
  leading: string;
  blocks: ParsedBlock[];
  /** `\end{document}` and anything after */
  suffix: string;
  hasDocument: boolean;
  bodyOffset: number;
}

// `quire:` markers come from projects made before the app was renamed TeXWriter
const GEN_START = /^%\s*(?:texwriter|quire):generated\b(.*)$/;
const GEN_END = /^%\s*(?:texwriter|quire):end\b/;

export function splitDocument(tex: string): { prefix: string; body: string; suffix: string; hasDocument: boolean } {
  const b = tex.search(/\\begin\{document\}/);
  const e = tex.search(/\\end\{document\}/);
  if (b < 0 || e < 0 || e < b) return { prefix: '', body: tex, suffix: '', hasDocument: false };
  const bEnd = b + '\\begin{document}'.length;
  return { prefix: tex.slice(0, bEnd), body: tex.slice(bEnd, e), suffix: tex.slice(e), hasDocument: true };
}

function isBlank(line: string) { return /^\s*$/.test(line); }

function parseKv(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of s.matchAll(/([a-zA-Z_][\w-]*)=("[^"]*"|\S+)/g)) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

/** Where does a line start a block (as opposed to continuing a paragraph)? */
function startsBlock(line: string): boolean {
  const t = line.trimStart();
  if (t.startsWith('%')) return true;
  if (t.startsWith('\\begin{')) return true;
  if (t.startsWith('\\[')) return true;
  const c = readCommand(t, 0);
  if (!c) return false;
  if (HEADING_COMMANDS[c.name] !== undefined || PAGEBREAK_COMMANDS.has(c.name)) return true;
  if (c.name === 'item' || c.name === 'end') return true;
  return !INLINE_COMMANDS.has(c.name);
}

function meta(node: JNode, src: string): JNode {
  node.attrs = { ...(node.attrs ?? {}), src, sig: canonicalBlock(node), gap: '\n\n' };
  return node;
}

function raw(src: string, label?: string): JNode {
  return { type: 'rawBlock', attrs: { latex: src, label: label ?? friendlyLabel(src) } };
}

export function friendlyLabel(src: string): string {
  const t = src.trimStart();
  if (t.startsWith('%')) return 'Comment';
  const env = /^\\begin\{([^}]+)\}/.exec(t);
  if (env) {
    const n = env[1];
    if (n === 'table' || n === 'table*') return 'Table (LaTeX)';
    if (n === 'tikzpicture') return 'TikZ drawing';
    if (n === 'figure' || n === 'figure*') return 'Figure (LaTeX)';
    if (n === 'abstract') return 'Abstract';
    if (n === 'titlepage') return 'Title page';
    return `${n} environment`;
  }
  const c = readCommand(t, 0);
  if (c && FRIENDLY_COMMANDS[c.name]) return FRIENDLY_COMMANDS[c.name];
  if (c) return `\\${c.name}`;
  return 'LaTeX';
}

function tryInline(text: string): JNode[] | null {
  try { return parseInline(text); } catch (e) { if (e instanceof CommentInInline) return null; throw e; }
}

/** Parse the content of an \item or callout into paragraph/list blocks. */
function parseFlow(s: string): JNode[] | null {
  const out: JNode[] = [];
  const parts = s.split(/\n[ \t]*\n/);
  for (const part of parts) {
    const p = part.trim();
    if (!p) continue;
    if (/^\\begin\{(itemize|enumerate)\}/.test(p)) {
      const env = /^\\begin\{(itemize|enumerate)\}/.exec(p)![1];
      const end = findEnvEnd(p, env, ('\\begin{' + env + '}').length);
      if (end !== p.length) return null;
      const list = parseList(p, env);
      if (!list) return null;
      out.push(list);
      continue;
    }
    // a paragraph possibly followed by a nested list
    const nested = p.search(/\\begin\{(itemize|enumerate)\}/);
    if (nested > 0) {
      const head = tryInline(p.slice(0, nested));
      const rest = parseFlow(p.slice(nested));
      if (!head || !rest) return null;
      out.push({ type: 'paragraph', content: head }, ...rest);
      continue;
    }
    if (/\\begin\{/.test(p)) return null;
    const inl = tryInline(p);
    if (!inl) return null;
    out.push({ type: 'paragraph', content: inl.length ? inl : undefined });
  }
  return out;
}

function parseList(src: string, env: string): JNode | null {
  const open = `\\begin{${env}}`;
  let inner = src.slice(open.length, src.length - `\\end{${env}}`.length);
  // optional [label=...] arguments make it raw
  if (/^\s*\[/.test(inner)) return null;
  // split at top-level \item
  const items: string[] = [];
  let depth = 0;
  let cur = -1;
  const re = /\\(begin|end)\{[^}]+\}|\\item\b/g;
  let m: RegExpExecArray | null;
  const pre = inner.search(/\\item\b/);
  if (pre < 0 || inner.slice(0, pre).trim() !== '') return null;
  while ((m = re.exec(inner))) {
    if (m[0].startsWith('\\begin')) depth++;
    else if (m[0].startsWith('\\end')) depth--;
    else if (depth === 0) {
      if (cur >= 0) items.push(inner.slice(cur, m.index));
      cur = m.index + m[0].length;
    }
  }
  if (cur >= 0) items.push(inner.slice(cur));
  const content: JNode[] = [];
  for (const it of items) {
    if (/^\s*\[/.test(it)) return null; // \item[custom]
    const flow = parseFlow(it);
    if (!flow) return null;
    if (!flow.length || flow[0].type !== 'paragraph') flow.unshift({ type: 'paragraph' });
    content.push({ type: 'listItem', content: flow });
  }
  inner = '';
  return { type: env === 'itemize' ? 'bulletList' : 'orderedList', content };
}

function parseFigure(src: string, env: string): JNode | null {
  const open = `\\begin{${env}}`;
  let i = open.length;
  let placement = '';
  if (src[i] === '[') { const e = matchGroup(src, i); if (e < 0) return null; placement = src.slice(i + 1, e - 1); i = e; }
  const inner = src.slice(i, src.length - `\\end{${env}}`.length);
  let rest = inner;
  let path = '', width = '', caption = '', label = '';
  const take = (re: RegExp) => { const m = re.exec(rest); if (m) rest = rest.replace(m[0], ''); return m; };
  take(/\\centering\b/);
  const g = /\\includegraphics\s*(\[[^\]]*\])?\s*\{([^}]*)\}/.exec(rest);
  if (!g) return null;
  rest = rest.replace(g[0], '');
  path = g[2];
  const wm = g[1] ? /width\s*=\s*([^,\]]+)/.exec(g[1]) : null;
  width = wm ? wm[1].trim() : '';
  if (g[1] && g[1].replace(/width\s*=\s*[^,\]]+/, '').replace(/[\[\],\s]/g, '') !== '') return null;
  const ci = rest.search(/\\caption\s*\{/);
  if (ci >= 0) {
    const open2 = rest.indexOf('{', ci);
    const e = matchGroup(rest, open2);
    if (e < 0) return null;
    caption = rest.slice(open2 + 1, e - 1);
    rest = rest.slice(0, ci) + rest.slice(e);
  }
  const lm = take(/\\label\{([^}]*)\}/);
  if (lm) label = lm[1];
  if (rest.trim() !== '') return null;
  return { type: 'figureBlock', attrs: { path, width, caption, label, placement, env } };
}

function parseMath(src: string, env: string): JNode {
  const open = `\\begin{${env}}`;
  let inner = src.slice(open.length, src.length - `\\end{${env}}`.length);
  let label = '';
  const lm = /\\label\{([^}]*)\}/.exec(inner);
  if (lm) { label = lm[1]; inner = inner.replace(lm[0], ''); }
  const lines = inner.replace(/^\s*\n/, '').replace(/\s+$/, '').split('\n');
  const ind = Math.min(...lines.filter((l) => l.trim()).map((l) => /^\s*/.exec(l)![0].length));
  const latex = lines.map((l) => l.slice(Number.isFinite(ind) ? ind : 0)).join('\n').trim();
  return { type: 'mathBlock', attrs: { env, latex, label } };
}

function parseCallout(src: string, env: string): JNode | null {
  const open = `\\begin{${env}}`;
  const a = readArgs(src, open.length, 0);
  if (a.arg === null) return null;
  const inner = src.slice(a.end, src.length - `\\end{${env}}`.length);
  const flow = parseFlow(inner);
  if (!flow || !flow.length || flow.some((n) => n.type !== 'paragraph')) return null;
  return { type: 'calloutBlock', attrs: { title: a.arg, env }, content: flow };
}

function parseCode(src: string, env: string): JNode {
  const open = `\\begin{${env}}`;
  let i = open.length;
  let language = '';
  let opts = '';
  if (src[i] === '[') {
    const e = matchGroup(src, i);
    if (e > 0) { opts = src.slice(i + 1, e - 1); i = e; }
    const lm = /language\s*=\s*([^,\]]+)/.exec(opts);
    if (lm) language = lm[1].trim();
  }
  let code = src.slice(i, src.length - `\\end{${env}}`.length);
  code = code.replace(/^[ \t]*\r?\n/, '').replace(/\r?\n[ \t]*$/, '');
  const node: JNode = { type: 'codeBlock', attrs: { language, env, opts } };
  if (code) node.content = [{ type: 'text', text: code }];
  return node;
}

/** Parse a document body into blocks. Total: never throws on malformed LaTeX. */
export function parseBody(body: string): { leading: string; blocks: ParsedBlock[] } {
  const blocks: ParsedBlock[] = [];
  let i = 0;
  const n = body.length;
  const lead = /^\s*/.exec(body)![0];
  i = lead.length;

  const push = (node: JNode, from: number, to: number) => {
    const src = body.slice(from, to);
    meta(node, src);
    blocks.push({ node, from, to });
    // gap
    let j = to;
    while (j < n && /\s/.test(body[j])) j++;
    node.attrs!.gap = body.slice(to, j);
    return j;
  };

  while (i < n) {
    const lineEndIdx = (() => { const p = body.indexOf('\n', i); return p < 0 ? n : p; })();
    const line = body.slice(i, lineEndIdx);
    const t = line.trimStart();

    // --- generated block markers / comments
    if (t.startsWith('%')) {
      const gm = GEN_START.exec(t.trimEnd());
      if (gm) {
        const endRe = /^[ \t]*%\s*(?:texwriter|quire):end\b.*$/m;
        endRe.lastIndex = 0;
        const restStart = lineEndIdx + 1;
        const tail = body.slice(restStart);
        const em = endRe.exec(tail);
        if (em) {
          const innerEnd = restStart + em.index;
          const to = restStart + em.index + em[0].length;
          const kv = parseKv(gm[1]);
          const inner = body.slice(restStart, innerEnd).replace(/\s+$/, '');
          i = push({ type: 'generatedBlock', attrs: { id: kv.id ?? '', inner } }, i, to);
          continue;
        }
      }
      // run of comment lines
      let j = i;
      while (j < n) {
        const le = body.indexOf('\n', j);
        const l = body.slice(j, le < 0 ? n : le);
        if (!l.trimStart().startsWith('%') || GEN_START.test(l.trim()) && j !== i) break;
        if (GEN_END.test(l.trim()) && j !== i) break;
        j = le < 0 ? n : le + 1;
      }
      let to = j;
      while (to > i && /\s/.test(body[to - 1])) to--;
      i = push(raw(body.slice(i, to), 'Comment'), i, to);
      continue;
    }

    // --- environments
    const envM = /^\\begin\{([^}]+)\}/.exec(t);
    if (envM) {
      const env = envM[1];
      const start = i + (line.length - t.length);
      const end = findEnvEnd(body, env, start + envM[0].length);
      if (end < 0) {
        // unterminated: rest of the chunk is raw
        let to = body.indexOf('\n\n', start);
        if (to < 0) to = n;
        i = push(raw(body.slice(i, to).replace(/\s+$/, '')), i, i + body.slice(i, to).replace(/\s+$/, '').length);
        continue;
      }
      // include anything else on the closing line (e.g. trailing comment) only if whitespace
      const src = body.slice(start, end);
      let node: JNode | null = null;
      if (MATH_ENVS.has(env)) node = parseMath(src, env);
      else if (env === 'itemize' || env === 'enumerate') node = parseList(src, env);
      else if (env === 'figure' || env === 'figure*') node = parseFigure(src, env);
      else if (env === 'texwritercallout' || env === 'quirecallout') node = parseCallout(src, env);
      else if (env === 'lstlisting' || env === 'verbatim') node = parseCode(src, env);
      else if (env === 'table' || env === 'table*' || env === 'tabular') node = parseTableBlock(src);
      if (!node) node = raw(src);
      // trailing text on the same line as \end{...}? then whole thing raw to line end
      const le = body.indexOf('\n', end);
      const after = body.slice(end, le < 0 ? n : le);
      if (after.trim() !== '') {
        const to = le < 0 ? n : le;
        i = push(raw(body.slice(i, to)), i, to);
        continue;
      }
      i = push(node, i, end);
      continue;
    }

    // --- display math \[ ... \]
    if (t.startsWith('\\[')) {
      const start = i + (line.length - t.length);
      const e = body.indexOf('\\]', start + 2);
      if (e > 0) {
        const latex = body.slice(start + 2, e).trim();
        i = push({ type: 'mathBlock', attrs: { env: 'displaymath', latex, label: '' } }, i, e + 2);
        continue;
      }
    }

    const cmd = t.startsWith('\\') ? readCommand(t, 0) : null;

    // --- headings
    if (cmd && HEADING_COMMANDS[cmd.name] !== undefined) {
      const off = i + (line.length - t.length);
      const a = readArgs(body, off + (cmd.nameEnd - cmd.start), 1);
      if (a.arg !== null && a.opts.length === 0) {
        const title = tryInline(a.arg);
        if (title) {
          let end = a.end;
          let label = '';
          const j = skipArgWs(body, end);
          const lm = /^\\label\{([^}]*)\}/.exec(body.slice(j));
          if (lm) { label = lm[1]; end = j + lm[0].length; }
          const rest = body.slice(end, (body.indexOf('\n', end) + 1 || n + 1) - 1);
          if (rest.trim() === '') {
            i = push({ type: 'heading', attrs: { level: HEADING_COMMANDS[cmd.name], cmd: cmd.name, star: cmd.star, label }, content: title.length ? title : undefined }, i, end);
            continue;
          }
        }
      }
    }

    // --- page breaks
    if (cmd && PAGEBREAK_COMMANDS.has(cmd.name) && t.slice(cmd.nameEnd).trim() === '') {
      i = push({ type: 'pageBreak', attrs: { cmd: cmd.name } }, i, lineEndIdx);
      continue;
    }

    // --- paragraph chunk (until blank line or a block-starting line)
    let j = lineEndIdx;
    while (j < n) {
      const ns = j + 1;
      if (ns >= n) { j = n; break; }
      const ne = body.indexOf('\n', ns);
      const nl = body.slice(ns, ne < 0 ? n : ne);
      if (isBlank(nl) || startsBlock(nl)) break;
      j = ne < 0 ? n : ne;
    }
    let to = j;
    while (to > i && /\s/.test(body[to - 1])) to--;
    const chunk = body.slice(i, to);
    if (cmd && !INLINE_COMMANDS.has(cmd.name)) {
      // starts with a structural command we don't model: keep raw, but only this line
      // when the command occupies the line by itself (e.g. \tableofcontents)
      const firstLineOnly = t.trim().length > 0 && (() => {
        const rest = skipInlineWs(t, cmd.nameEnd);
        return rest >= t.length || /^[\[{]/.test(t.slice(rest));
      })();
      if (firstLineOnly && lineEndIdx < to) {
        let lt = lineEndIdx;
        while (lt > i && /\s/.test(body[lt - 1])) lt--;
        i = push(raw(body.slice(i, lt)), i, lt);
        continue;
      }
      i = push(raw(chunk), i, to);
      continue;
    }
    const inl = tryInline(chunk);
    if (!inl) { i = push(raw(chunk), i, to); continue; }
    i = push({ type: 'paragraph', content: inl.length ? inl : undefined }, i, to);
  }
  return { leading: lead, blocks };
}

export function parseDocument(tex: string): ParsedDocument {
  const { prefix, body, suffix, hasDocument } = splitDocument(tex);
  if (!hasDocument) return { prefix: '', leading: '', blocks: [], suffix: '', hasDocument: false, bodyOffset: 0 };
  const { leading, blocks } = parseBody(body);
  return { prefix, leading, blocks, suffix, hasDocument, bodyOffset: prefix.length };
}

/** Editor doc JSON for a parsed document. */
export function toDocJson(p: ParsedDocument): JNode {
  const content = p.blocks.map((b) => b.node);
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph', attrs: { src: null, sig: null, gap: '\n' } }] };
}

// ---------------------------------------------------------------------------
// Serialization

function indent(s: string, pad: string) {
  return s.split('\n').map((l) => (l.trim() ? pad + l : l)).join('\n');
}

function serializeFlow(nodes: JNode[] | undefined, pad: string): string {
  const parts: string[] = [];
  for (const c of nodes ?? []) {
    if (c.type === 'paragraph') parts.push(wrap(serializeInline(c.content, true), 88, pad));
    else if (c.type === 'bulletList' || c.type === 'orderedList') parts.push(canonicalBlock(c, pad));
  }
  return parts.join('\n\n' + pad);
}

/** Canonical LaTeX for one block node (no trailing gap). */
export function canonicalBlock(node: JNode, pad = ''): string {
  const a = node.attrs ?? {};
  switch (node.type) {
    case 'paragraph':
      return wrap(serializeInline(node.content, true), 88);
    case 'heading': {
      // keep the command the source used (\chapter) unless the level was changed since
      const lvl = a.level ?? 1;
      const cmd = a.cmd && HEADING_COMMANDS[a.cmd] === lvl ? a.cmd : HEADING_BY_LEVEL[lvl] ?? 'section';
      const label = a.label ? `\\label{${a.label}}` : '';
      return `\\${cmd}${a.star ? '*' : ''}{${serializeInline(node.content)}}${label}`;
    }
    case 'bulletList':
    case 'orderedList': {
      const env = node.type === 'bulletList' ? 'itemize' : 'enumerate';
      const items = (node.content ?? []).map((it) => `${pad}  \\item ${serializeFlow(it.content, pad + '    ')}`);
      return `\\begin{${env}}\n${items.join('\n')}\n${pad}\\end{${env}}`;
    }
    case 'mathBlock': {
      const env = a.env || 'equation';
      if (env === 'displaymath') return `\\[\n${indent(a.latex ?? '', '  ')}\n\\]`;
      const label = a.label && !env.endsWith('*') ? `\\label{${a.label}}` : '';
      return `\\begin{${env}}${label}\n${indent(a.latex ?? '', '  ')}\n\\end{${env}}`;
    }
    case 'generatedBlock':
      return `% texwriter:generated id=${a.id}\n${a.inner || `\\input{generated/${a.id}.tex}`}\n% texwriter:end`;
    case 'figureBlock': {
      const env = a.env || 'figure';
      const lines = [`\\begin{${env}}${a.placement ? `[${a.placement}]` : ''}`, '  \\centering'];
      lines.push(`  \\includegraphics${a.width ? `[width=${a.width}]` : ''}{${a.path ?? ''}}`);
      if (a.caption) lines.push(`  \\caption{${a.caption}}`);
      if (a.label) lines.push(`  \\label{${a.label}}`);
      lines.push(`\\end{${env}}`);
      return lines.join('\n');
    }
    case 'calloutBlock':
      // older projects define the environment as quirecallout; keep whichever the source used
      return `\\begin{${a.env || 'texwritercallout'}}{${a.title ?? ''}}\n${serializeFlow(node.content, '')}\n\\end{${a.env || 'texwritercallout'}}`;
    case 'codeBlock': {
      const env = a.env || 'lstlisting';
      const code = (node.content ?? []).map((c) => c.text ?? '').join('');
      let opts = a.opts ?? '';
      if (env === 'lstlisting') {
        const others = opts.split(',').map((x: string) => x.trim()).filter((x: string) => x && !/^language\s*=/.test(x));
        if (a.language) others.unshift(`language=${a.language}`);
        opts = others.join(',');
      }
      return `\\begin{${env}}${opts ? `[${opts}]` : ''}\n${code}\n\\end{${env}}`;
    }
    case 'pageBreak':
      return `\\${a.cmd || 'clearpage'}`;
    case 'tableBlock':
      return serializeTableBlock(node);
    case 'rawBlock':
      return a.latex ?? '';
    default:
      return '';
  }
}

export interface SerializeResult { body: string; ranges: ([number, number] | null)[] }

/** Serialize top-level nodes to a body string, keeping original source where unchanged. */
export function serializeBody(doc: JNode, leading = '\n'): SerializeResult {
  let out = leading;
  const ranges: ([number, number] | null)[] = [];
  const nodes = doc.content ?? [];
  nodes.forEach((node, idx) => {
    const a = node.attrs ?? {};
    const canon = canonicalBlock(node);
    let text = a.src != null && a.sig === canon ? a.src : canon;
    if (!text.trim()) { ranges.push(null); return; }
    const from = out.length;
    out += text;
    ranges.push([from, out.length]);
    const last = idx === nodes.length - 1;
    let gap = typeof a.gap === 'string' && /\n/.test(a.gap) ? a.gap : last ? '\n' : '\n\n';
    const next = nodes[idx + 1];
    // two text paragraphs separated by a single newline would merge into one
    if (next && (gap.match(/\n/g) ?? []).length < 2 && node.type === 'paragraph' && next.type === 'paragraph') gap = '\n\n';
    out += gap;
  });
  return { body: out, ranges };
}

export function serializeDocument(prefix: string, doc: JNode, suffix: string, leading = '\n'): { tex: string; ranges: ([number, number] | null)[] } {
  const r = serializeBody(doc, leading);
  return { tex: prefix + r.body + suffix, ranges: r.ranges.map((x) => (x ? [x[0] + prefix.length, x[1] + prefix.length] : null)) };
}

/** 1-based inclusive line ranges for each top-level block in `tex`. */
export function blockLines(tex: string, p: ParsedDocument): [number, number][] {
  return p.blocks.map((b) => [lineOf(tex, p.bodyOffset + b.from), lineOf(tex, p.bodyOffset + Math.max(b.from, b.to - 1))]);
}
