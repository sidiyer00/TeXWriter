// Minimal RFC 4180 CSV parser (quoted fields, embedded commas/newlines/quotes).

export interface Table { header: string[]; rows: string[][] }

export function parseCsv(text: string): Table {
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
    if (c === '"') { q = true; continue; }
    if (c === ',') { row.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const nonEmpty = rows.filter((r) => r.some((x) => x.trim() !== ''));
  const [header = [], ...body] = nonEmpty;
  return { header: header.map((h) => h.trim()), rows: body };
}
