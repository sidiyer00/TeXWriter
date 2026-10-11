// Inline LaTeX <-> inline document nodes.
import { JNode, Mark, CITE_COMMANDS, REF_COMMANDS } from './model';
import { matchGroup, readArgs, readCommand } from './scan';

export class CommentInInline extends Error {}

const NBSP = ' ';

const SYMBOL_ESCAPES: Record<string, string> = { '%': '%', '&': '&', '#': '#', '_': '_', '$': '$', '{': '{', '}': '}', ' ': ' ' };

const MARK_COMMANDS: Record<string, Mark['type']> = { textbf: 'bold', textit: 'italic', emph: 'italic', texttt: 'code' };

function pushText(out: JNode[], text: string, marks: Mark[]) {
  if (!text) return;
  const last = out[out.length - 1];
  const sameMarks = (a?: Mark[], b?: Mark[]) => JSON.stringify(a ?? []) === JSON.stringify(b ?? []);
  if (last && last.type === 'text' && sameMarks(last.marks, marks)) {
    last.text += text;
    return;
  }
  const n: JNode = { type: 'text', text };
  if (marks.length) n.marks = marks.map((m) => ({ ...m }));
  out.push(n);
}

function sortMarks(marks: Mark[]): Mark[] {
  const order = { bold: 0, italic: 1, code: 2 } as const;
  return [...marks].sort((a, b) => order[a.type] - order[b.type]);
}

/**
 * Parse inline LaTeX. Whitespace runs (including newlines) collapse to one space.
 * Throws CommentInInline when an unescaped `%` is found: callers keep such content raw.
 */
export function parseInline(s: string, marks: Mark[] = []): JNode[] {
  const out: JNode[] = [];
  let buf = '';
  const flush = () => { pushText(out, buf, marks); buf = ''; };
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '%') throw new CommentInInline();
    if (ch === '\n' || ch === '\r' || ch === ' ' || ch === '\t') {
      if (!buf.endsWith(' ') && !(buf === '' && out.length === 0)) buf += ' ';
      while (i < s.length && /[\s]/.test(s[i])) i++;
      continue;
    }
    if (ch === '~') { buf += NBSP; i++; continue; }
    if (ch === '$') {
      const display = s[i + 1] === '$';
      if (display) { // $$...$$ inside a paragraph: keep raw
        const e = s.indexOf('$$', i + 2);
        if (e < 0) { buf += ch; i++; continue; }
        flush();
        out.push({ type: 'inlineRaw', attrs: { latex: s.slice(i, e + 2) } });
        i = e + 2; continue;
      }
      let j = i + 1;
      while (j < s.length && !(s[j] === '$' && s[j - 1] !== '\\')) j++;
      if (j >= s.length) { buf += ch; i++; continue; }
      flush();
      out.push({ type: 'inlineMath', attrs: { latex: s.slice(i + 1, j), delim: 'dollar' } });
      i = j + 1; continue;
    }
    if (ch === '{') {
      const e = matchGroup(s, i);
      if (e < 0) { buf += ch; i++; continue; }
      flush();
      out.push({ type: 'inlineRaw', attrs: { latex: s.slice(i, e) } });
      i = e; continue;
    }
    if (ch === '}') { buf += ch; i++; continue; }
    if (ch === '\\') {
      const nx = s[i + 1];
      if (nx === '\\') {
        flush();
        // \\ or \\[len]
        let e = i + 2;
        if (s[e] === '[') { const g = matchGroup(s, e); if (g > 0) e = g; }
        if (e === i + 2) out.push({ type: 'hardBreak' });
        else out.push({ type: 'inlineRaw', attrs: { latex: s.slice(i, e) } });
        i = e;
        while (i < s.length && /[ \t]/.test(s[i])) i++;
        if (s[i] === '\n') i++;
        continue;
      }
      if (nx !== undefined && SYMBOL_ESCAPES[nx] !== undefined) { buf += SYMBOL_ESCAPES[nx]; i += 2; continue; }
      if (nx === '(') {
        const e = s.indexOf('\\)', i + 2);
        if (e > 0) {
          flush();
          out.push({ type: 'inlineMath', attrs: { latex: s.slice(i + 2, e), delim: 'paren' } });
          i = e + 2; continue;
        }
      }
      const cmd = readCommand(s, i);
      if (!cmd) {
        // control symbol like \, \; \! \- \' \"
        flush();
        out.push({ type: 'inlineRaw', attrs: { latex: s.slice(i, i + 2) } });
        i += 2; continue;
      }
      const name = cmd.name;
      if (name === 'textbackslash' || name === 'textasciitilde' || name === 'textasciicircum') {
        let e = cmd.nameEnd;
        if (s.slice(e, e + 2) === '{}') e += 2;
        buf += name === 'textbackslash' ? '\\' : name === 'textasciitilde' ? '~' : '^';
        i = e; continue;
      }
      if (name === 'ldots' || name === 'dots') {
        let e = cmd.nameEnd;
        if (s.slice(e, e + 2) === '{}') e += 2;
        buf += '…';
        i = e; continue;
      }
      if (MARK_COMMANDS[name] && !cmd.star) {
        const a = readArgs(s, cmd.nameEnd, 0);
        if (a.arg !== null) {
          flush();
          const m: Mark = { type: MARK_COMMANDS[name] };
          const inner = parseInline(a.arg, sortMarks([...marks.filter((x) => x.type !== m.type), m]));
          for (const n of inner) {
            if (n.type === 'text') pushText(out, n.text!, n.marks ?? []);
            else out.push(n);
          }
          i = a.end; continue;
        }
      }
      if (CITE_COMMANDS.has(name)) {
        const a = readArgs(s, cmd.nameEnd, 2);
        if (a.arg !== null) {
          flush();
          out.push({ type: 'citation', attrs: { cmd: name + (cmd.star ? '*' : ''), keys: a.arg.split(',').map((k) => k.trim()).filter(Boolean).join(','), opts: a.optRaw.trim() } });
          i = a.end; continue;
        }
      }
      if (REF_COMMANDS.has(name) && !cmd.star) {
        const a = readArgs(s, cmd.nameEnd, 0);
        if (a.arg !== null) {
          flush();
          out.push({ type: 'crossRef', attrs: { cmd: name, key: a.arg.trim() } });
          i = a.end; continue;
        }
      }
      if (name === 'footnote' && !cmd.star) {
        const a = readArgs(s, cmd.nameEnd, 0);
        if (a.arg !== null && a.optRaw === '') {
          flush();
          out.push({ type: 'footnote', attrs: { latex: a.arg } });
          i = a.end; continue;
        }
      }
      // Unknown or unsupported command: keep its exact source (with following groups)
      flush();
      let e = cmd.nameEnd;
      // only swallow groups that directly follow (no whitespace) to avoid eating text
      while (s[e] === '[' || s[e] === '{') {
        const g = matchGroup(s, e);
        if (g < 0) break;
        e = g;
      }
      // a command word followed by a space is terminated by that space; keep it in latex
      if (e === cmd.nameEnd && s[e] === ' ' ) {
        out.push({ type: 'inlineRaw', attrs: { latex: s.slice(i, e) + '{}' } });
        i = e; // the space itself becomes text
        continue;
      }
      out.push({ type: 'inlineRaw', attrs: { latex: s.slice(i, e) } });
      i = e; continue;
    }
    if (ch === '-' && s[i + 1] === '-' && !marks.some((m) => m.type === 'code')) {
      if (s[i + 2] === '-') { buf += '—'; i += 3; } else { buf += '–'; i += 2; }
      continue;
    }
    buf += ch;
    i++;
  }
  flush();
  // trim trailing space of the final text node
  const last = out[out.length - 1];
  if (last?.type === 'text') {
    last.text = last.text!.replace(/ +$/, '');
    if (!last.text) out.pop();
  }
  const first = out[0];
  if (first?.type === 'text') {
    first.text = first.text!.replace(/^ +/, '');
    if (!first.text) out.shift();
  }
  return out;
}

export function escapeText(t: string): string {
  let r = '';
  for (const ch of t) {
    switch (ch) {
      case '\\': r += '\\textbackslash{}'; break;
      case '{': r += '\\{'; break;
      case '}': r += '\\}'; break;
      case '%': case '&': case '#': case '_': case '$': r += '\\' + ch; break;
      case '~': r += '\\textasciitilde{}'; break;
      case '^': r += '\\textasciicircum{}'; break;
      case NBSP: r += '~'; break;
      case '…': r += '\\ldots{}'; break;
      case '–': r += '--'; break;
      case '—': r += '---'; break;
      default: r += ch;
    }
  }
  return r;
}

/** Marker used for line-break opportunities while wrapping (spaces in plain text only). */
export const BREAK = '\u0001';

const MARK_CMD: Record<Mark['type'], string> = { bold: 'textbf', italic: 'textit', code: 'texttt' };

export function serializeInline(nodes: JNode[] | undefined, breakable = false): string {
  if (!nodes) return '';
  let out = '';
  for (const n of nodes) {
    switch (n.type) {
      case 'text': {
        let t = escapeText(n.text ?? '');
        if (breakable) t = t.replace(/ /g, BREAK);
        const ms = sortMarks((n.marks ?? []).filter((m) => MARK_CMD[m.type]));
        for (let k = ms.length - 1; k >= 0; k--) t = `\\${MARK_CMD[ms[k].type]}{${t}}`;
        out += t;
        break;
      }
      case 'inlineMath':
        out += n.attrs?.delim === 'paren' ? `\\(${n.attrs?.latex ?? ''}\\)` : `$${n.attrs?.latex ?? ''}$`;
        break;
      case 'citation':
        out += `\\${n.attrs?.cmd || 'cite'}${n.attrs?.opts ?? ''}{${n.attrs?.keys ?? ''}}`;
        break;
      case 'crossRef':
        out += `\\${n.attrs?.cmd || 'ref'}{${n.attrs?.key ?? ''}}`;
        break;
      case 'footnote':
        out += `\\footnote{${n.attrs?.latex ?? ''}}`;
        break;
      case 'inlineRaw':
        out += n.attrs?.latex ?? '';
        break;
      case 'hardBreak':
        out += '\\\\\n';
        break;
      default:
        break;
    }
  }
  return out;
}

/** Greedy wrap at BREAK markers; other spaces are never broken. */
export function wrap(s: string, width = 88, indent = ''): string {
  const parts = s.split(BREAK);
  const lines: string[] = [];
  let cur = '';
  for (const p of parts) {
    if (cur === '') { cur = p; continue; }
    const lastLineLen = cur.length - (cur.lastIndexOf('\n') + 1);
    if (lastLineLen + 1 + p.length > width) {
      lines.push(cur);
      cur = indent + p;
    } else {
      cur += ' ' + p;
    }
  }
  lines.push(cur);
  return lines.join('\n');
}
