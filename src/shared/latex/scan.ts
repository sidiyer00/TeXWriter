// Low-level scanning helpers for LaTeX source. Everything here is pure and
// position-based so that the block parser can keep exact source ranges.

/** Index just past the group that opens at `open` (s[open] must be `{` or `[`), or -1. */
export function matchGroup(s: string, open: number): number {
  const o = s[open];
  const c = o === '{' ? '}' : o === '[' ? ']' : '';
  if (!c) return -1;
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\') { i++; continue; }
    if (ch === '%' ) {
      // comments inside groups: skip to end of line
      const nl = s.indexOf('\n', i);
      if (nl < 0) return -1;
      i = nl;
      continue;
    }
    if (o === '{') {
      if (ch === '{') depth++;
      else if (ch === '}') { depth--; if (depth === 0) return i + 1; }
    } else {
      // square brackets: braces nest inside, brackets close at depth 0 of braces
      if (ch === '{') { const e = matchGroup(s, i); if (e < 0) return -1; i = e - 1; continue; }
      if (ch === '[') depth++;
      else if (ch === ']') { depth--; if (depth === 0) return i + 1; }
    }
  }
  return -1;
}

/** Skip spaces and tabs (not newlines). */
export function skipInlineWs(s: string, i: number): number {
  while (i < s.length && (s[i] === ' ' || s[i] === '\t')) i++;
  return i;
}

/** Skip whitespace including at most one newline (LaTeX "argument whitespace"). */
export function skipArgWs(s: string, i: number): number {
  let j = skipInlineWs(s, i);
  if (s[j] === '\r') j++;
  if (s[j] === '\n') { j++; j = skipInlineWs(s, j); }
  return j;
}

export interface CommandToken {
  name: string;
  star: boolean;
  start: number;
  /** index after the name (and star) */
  nameEnd: number;
}

/** Read `\name` or `\name*` at i (s[i] === '\\'). Returns null for control symbols. */
export function readCommand(s: string, i: number): CommandToken | null {
  if (s[i] !== '\\') return null;
  let j = i + 1;
  while (j < s.length && /[a-zA-Z@]/.test(s[j])) j++;
  if (j === i + 1) return null;
  let star = false;
  if (s[j] === '*') { star = true; j++; }
  return { name: s.slice(i + 1, star ? j - 1 : j), star, start: i, nameEnd: j };
}

/** Read optional [..] groups then a required {..} group after `pos`. */
export function readArgs(s: string, pos: number, maxOpt = 2): { opts: string[]; optRaw: string; arg: string | null; end: number } {
  const opts: string[] = [];
  let i = pos;
  const optStart = pos;
  for (let k = 0; k < maxOpt; k++) {
    const j = skipInlineWs(s, i);
    if (s[j] !== '[') break;
    const e = matchGroup(s, j);
    if (e < 0) break;
    opts.push(s.slice(j + 1, e - 1));
    i = e;
  }
  const optRaw = s.slice(optStart, i);
  const j = skipInlineWs(s, i);
  if (s[j] !== '{') return { opts, optRaw, arg: null, end: i };
  const e = matchGroup(s, j);
  if (e < 0) return { opts, optRaw, arg: null, end: i };
  return { opts, optRaw, arg: s.slice(j + 1, e - 1), end: e };
}

/**
 * Find the `\end{env}` that closes a `\begin{env}` whose name ends at `from`.
 * Returns the index just past `\end{env}` or -1.
 */
export function findEnvEnd(s: string, env: string, from: number): number {
  const esc = env.replace(/[*]/g, '\\*');
  const re = new RegExp(`\\\\(begin|end)\\{${esc}\\}`, 'g');
  re.lastIndex = from;
  let depth = 1;
  let m: RegExpExecArray | null;
  // verbatim-like environments cannot nest and must not be scanned for comments
  while ((m = re.exec(s))) {
    if (m[1] === 'begin') depth++;
    else { depth--; if (depth === 0) return m.index + m[0].length; }
  }
  return -1;
}

/** Find the first unescaped `%` in a line, or -1. */
export function commentIndex(line: string): number {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '\\') { i++; continue; }
    if (line[i] === '%') return i;
  }
  return -1;
}

export function lineStart(s: string, i: number): number {
  const p = s.lastIndexOf('\n', i - 1);
  return p < 0 ? 0 : p + 1;
}

export function lineEnd(s: string, i: number): number {
  const p = s.indexOf('\n', i);
  return p < 0 ? s.length : p;
}

/** 1-based line number of offset i. */
export function lineOf(s: string, i: number): number {
  let n = 1;
  for (let k = 0; k < i && k < s.length; k++) if (s.charCodeAt(k) === 10) n++;
  return n;
}

/** Simple, fast 32-bit FNV-1a hash as hex. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
