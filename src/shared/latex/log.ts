// Parse a LaTeX .log (or latexmk output) into actionable diagnostics.
import type { Diagnostic } from '../types';

let ROOT = '';
function norm(f: string): string {
  let p = f.replace(/\\/g, '/').replace(/^\.\//, '');
  const r = ROOT.replace(/\\/g, '/').replace(/\/$/, '');
  if (r && p.toLowerCase().startsWith(r.toLowerCase() + '/')) p = p.slice(r.length + 1);
  return p;
}

/**
 * Track which file is "current" by following the `(file` / `)` nesting LaTeX prints.
 * Returns a function mapping a log offset to the innermost .tex file open there.
 */
function fileTracker(log: string, mainFile: string) {
  const marks: { at: number; file: string | null }[] = [];
  const stack: string[] = [];
  const re = /\((\.{0,2}[\/\\]?[^\s()"]+?\.(?:tex|sty|cls|cfg|def|clo|fd|aux|bbl|toc|lof|lot|out|ldf|dict))|\)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) {
    if (m[0] === ')') stack.pop();
    else stack.push(norm(m[1]));
    const top = [...stack].reverse().find((f) => f.endsWith('.tex')) ?? null;
    marks.push({ at: m.index, file: top });
  }
  return (offset: number): string => {
    let lo = 0, hi = marks.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (marks[mid].at <= offset) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return (ans >= 0 ? marks[ans].file : null) ?? mainFile;
  };
}

/** LaTeX hard-wraps log lines at max_print_line (79); join them back. */
export function unwrapLog(log: string, width = 79): string {
  const lines = log.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let cur = '';
  for (const l of lines) {
    cur += l;
    if (l.length !== width) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.join('\n');
}

export function parseLatexLog(log: string, mainFile = 'report.tex', root = ''): Diagnostic[] {
  const text = unwrapLog(log);
  ROOT = root;
  const out: Diagnostic[] = [];
  const seen = new Set<string>();
  const fileAt = fileTracker(text, mainFile);
  const add = (d: Omit<Diagnostic, 'id'>) => {
    const k = `${d.kind}|${d.key ?? ''}|${d.file ?? ''}|${d.line ?? ''}|${d.message}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push({ id: `d${out.length + 1}`, ...d });
  };

  // file:line: error   (from -file-line-error)
  const fle = /^([^\s:][^:\n]*\.(?:tex|sty|cls|bbl)):(\d+): (.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = fle.exec(text))) {
    const msg = m[3].trim();
    if (/^==> Fatal error occurred|^Emergency stop/.test(msg) && out.some((d) => d.severity === 'error')) continue;
    // context lines: "l.426 \pdgrade" follows
    const ctx = /\nl\.\d+ ([^\n]*)/.exec(text.slice(m.index, m.index + 600));
    const missing = /File `([^']+)' not found/.exec(msg);
    add({
      severity: 'error',
      kind: missing ? 'missing-file' : 'error',
      message: msg.replace(/^LaTeX Error: /, ''),
      detail: ctx ? ctx[1].trim() : undefined,
      file: norm(m[1]),
      line: Number(m[2]),
      key: missing ? missing[1] : /Undefined control sequence/.test(msg) && ctx ? (/(\\[a-zA-Z@]+)\s*$/.exec(ctx[1].trim())?.[1] ?? undefined) : undefined,
    });
  }

  // classic "! Error" without file-line-error
  const bang = /^! (.+)$/gm;
  while ((m = bang.exec(text))) {
    if (out.some((d) => d.severity === 'error')) break;
    const ctx = /\nl\.(\d+) ([^\n]*)/.exec(text.slice(m.index, m.index + 600));
    add({ severity: 'error', kind: 'error', message: m[1].replace(/^LaTeX Error: /, ''), detail: ctx?.[2]?.trim(), file: fileAt(m.index), line: ctx ? Number(ctx[1]) : undefined });
  }

  // warnings continue on lines that start with "(package)" or spaces
  const joined = text.replace(/\n\((?:natbib|hyperref|[a-z]+)\)\s+/g, ' ').replace(/\n(?=on input line)/g, ' ');
  for (const mm of text.matchAll(/TeXWriter: package (\S+) is not installed/g)) {
    add({ severity: 'notice', kind: 'missing-file', message: `Package ${mm[1]} is not installed`, detail: 'TeXWriter used the default font or layout instead. Install it with the MiKTeX Console (Packages) or tlmgr, then recompile.', key: `${mm[1]}.sty` });
  }

  const refRe = /(?:LaTeX|Package \w+) Warning: Reference `([^']+)' on page (\d+)\s+undefined on input line (\d+)/g;
  while ((m = refRe.exec(joined))) {
    add({ severity: 'warning', kind: 'undefined-reference', message: `Undefined reference “${m[1]}”`, key: m[1], page: Number(m[2]), line: Number(m[3]), file: fileAt(Math.min(m.index, text.length - 1)) });
  }
  const citeRe = /(?:LaTeX|Package \w+) Warning: Citation [`']([^']+)' on page (\d+)\s+undefined on input line (\d+)/g;
  while ((m = citeRe.exec(joined))) {
    add({ severity: 'warning', kind: 'undefined-citation', message: `Undefined citation “${m[1]}”`, key: m[1], page: Number(m[2]), line: Number(m[3]), file: fileAt(Math.min(m.index, text.length - 1)) });
  }
  const bibRe = /Warning--I didn't find a database entry for "([^"]+)"/g;
  while ((m = bibRe.exec(joined))) {
    if (out.some((d) => d.kind === 'undefined-citation' && d.key === m![1])) continue;
    add({ severity: 'warning', kind: 'undefined-citation', message: `Undefined citation “${m[1]}”`, key: m[1] });
  }

  const boxRe = /(Overfull|Underfull) \\([hv])box \(([\d.]+)pt too (wide|high)\) (?:in paragraph|in alignment|detected) at lines? (\d+)(?:--(\d+))?/g;
  while ((m = boxRe.exec(joined))) {
    const over = m[1] === 'Overfull';
    const amount = Number(m[3]);
    if (!over) continue; // underfull boxes are noise for report authors
    if (amount < 1) continue;
    const file = fileAt(Math.min(m.index, text.length - 1));
    const inAlign = /in alignment/.test(m[0]);
    add({ severity: 'warning', kind: 'overfull', message: inAlign ? `Table wider than text by ${amount} pt` : `Line too wide by ${amount} pt`, file, line: Number(m[5]), detail: m[0] });
  }

  // pages on overfull warnings: LaTeX prints [N] when a page ships; approximate by last [n] before offset
  const pageMarks: { at: number; page: number }[] = [];
  const pr = /\[(\d+)(?:[\s\]{])/g;
  while ((m = pr.exec(text))) pageMarks.push({ at: m.index, page: Number(m[1]) + 1 });
  for (const d of out) {
    if (d.kind === 'overfull' && d.page === undefined && d.detail) {
      const at = text.indexOf(d.detail.slice(0, 40));
      const pm = [...pageMarks].reverse().find((p) => p.at < at);
      d.page = pm ? pm.page : 1;
    }
  }

  const other = /LaTeX Warning: (?!Reference|Citation|There were undefined|Label\(s\) may have changed)([^\n]+)/g;
  while ((m = other.exec(joined))) {
    const msg = m[1].trim();
    if (/Empty `thebibliography'|Unused global option|float specifier changed/.test(msg)) continue;
    add({ severity: 'notice', kind: 'other', message: msg, file: fileAt(Math.min(m.index, text.length - 1)), line: Number(/input line (\d+)/.exec(msg)?.[1]) || undefined });
  }
  return out;
}

/** Count pages from "Output written on x.pdf (38 pages" */
export function pagesFromLog(log: string): number | null {
  const m = /Output written on [^\n(]+\((\d+) pages?/.exec(log.replace(/\n/g, ''));
  return m ? Number(m[1]) : null;
}

export function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function closest(key: string, candidates: string[]): string | undefined {
  let best: string | undefined;
  let bd = Infinity;
  for (const c of candidates) {
    const d = levenshtein(key.toLowerCase(), c.toLowerCase());
    if (d < bd) { bd = d; best = c; }
  }
  return best !== undefined && bd <= Math.max(3, Math.ceil(key.length * 0.4)) ? best : undefined;
}
