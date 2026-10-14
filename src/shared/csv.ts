// Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines/quotes).
// Also reads tab- and semicolon-separated text (Excel's clipboard is tab-separated).

export interface Table { header: string[]; rows: string[][] }

export type Delimiter = ',' | '\t' | ';';

/** Split delimited text into rows of fields. Blank lines are dropped. */
export function parseRows(text: string, delim: Delimiter = ','): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else q = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') { q = true; continue; }
    if (c === delim) { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

/** Guess the delimiter from the first few lines: tabs win, then whichever of , ; is more consistent. */
export function detectDelimiter(text: string): Delimiter {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim()).slice(0, 10);
  if (lines.some((l) => l.includes('\t'))) return '\t';
  const score = (d: string) => {
    const counts = lines.map((l) => l.split(d).length - 1);
    return counts.length && counts.every((c) => c > 0 && c === counts[0]) ? counts[0] + 100 : Math.min(...counts, 0) + counts.reduce((a, b) => a + b, 0) / 1000;
  };
  return score(';') > score(',') ? ';' : ',';
}

export function parseCsv(text: string, delim: Delimiter = ','): Table {
  const [header = [], ...body] = parseRows(text, delim);
  return { header: header.map((h) => h.trim()), rows: body };
}
