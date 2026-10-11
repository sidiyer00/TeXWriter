// Number formats for table cells, Excel style: a cell keeps its full-precision value and a
// format, and the text you see (in the editor and in the PDF) is derived from both. So
// going from 4 decimals to 1 and back to 4 never loses digits.
//
// LaTeX form:  \qnum[<format>]{<value>}{<shown>}
// \qnum prints only <shown> (see SUPPORT_MACROS), so the PDF needs no extra packages and
// the source stays readable; <value> and <format> survive every round trip.
//
// All arithmetic is on decimal strings (no binary floating point): 1.005 rounds to 1.01,
// as in Excel, and 0.1 + formatting never shows 0.30000000000000004.

export type NumKind = 'integer' | 'number' | 'percent' | 'currency' | 'scientific';
export type Negative = 'minus' | 'parens' | 'red' | 'redparens';
export type CurrencySymbol = 'USD' | 'EUR' | 'GBP' | 'JPY';

export interface NumFormat {
  kind: NumKind;
  /** decimal places, or significant figures when `sig` is set (ignored for integers) */
  digits: number;
  sig: boolean;
  /** group thousands: 1,234,567 */
  thousands: boolean;
  negative: Negative;
  symbol: CurrencySymbol;
}

export const NUM_KINDS: { kind: NumKind; label: string; example: string }[] = [
  { kind: 'integer', label: 'Integer', example: '1,235' },
  { kind: 'number', label: 'Number', example: '1234.57' },
  { kind: 'percent', label: 'Percentage', example: '12.35%' },
  { kind: 'currency', label: 'Currency', example: '$1,234.57' },
  { kind: 'scientific', label: 'Scientific', example: '1.23 × 10³' },
];

export const CURRENCIES: { id: CurrencySymbol; sign: string; latex: string; label: string }[] = [
  { id: 'USD', sign: '$', latex: '\\$', label: '$ Dollar' },
  { id: 'EUR', sign: '€', latex: '\\texteuro{}', label: '€ Euro' },
  { id: 'GBP', sign: '£', latex: '\\pounds{}', label: '£ Pound' },
  { id: 'JPY', sign: '¥', latex: '\\textyen{}', label: '¥ Yen' },
];

export const NEGATIVES: { id: Negative; label: string }[] = [
  { id: 'minus', label: '−1,234.10' },
  { id: 'parens', label: '(1,234.10)' },
  { id: 'red', label: '−1,234.10 in red' },
  { id: 'redparens', label: '(1,234.10) in red' },
];

/** Colour used for red negatives (Excel's dark red). */
export const NEGATIVE_RED = 'C00000';
export const MAX_DIGITS = 15;

export function defaultFormat(kind: NumKind): NumFormat {
  const base: NumFormat = { kind, digits: 2, sig: false, thousands: false, negative: 'minus', symbol: 'USD' };
  if (kind === 'integer') return { ...base, digits: 0, thousands: true };
  if (kind === 'currency') return { ...base, thousands: true };
  return base;
}

// ------------------------------------------------------------------ format <-> string

const KIND_CODE: Record<NumKind, string> = { integer: 'int', number: 'num', percent: 'pct', currency: 'cur', scientific: 'sci' };
const CODE_KIND = Object.fromEntries(Object.entries(KIND_CODE).map(([k, v]) => [v, k])) as Record<string, NumKind>;

/** Compact, readable form used in the LaTeX source, e.g. `cur,d2,sep,neg=parens,sym=EUR`. */
export function encodeFormat(f: NumFormat): string {
  const t = [KIND_CODE[f.kind]];
  if (f.kind !== 'integer') t.push(`${f.sig ? 's' : 'd'}${f.digits}`);
  if (f.thousands) t.push('sep');
  if (f.negative !== 'minus') t.push(`neg=${f.negative}`);
  if (f.kind === 'currency' && f.symbol !== 'USD') t.push(`sym=${f.symbol}`);
  return t.join(',');
}

export function decodeFormat(s: string | null | undefined): NumFormat | null {
  if (!s) return null;
  const parts = s.split(',').map((x) => x.trim()).filter(Boolean);
  const kind = CODE_KIND[parts[0] ?? ''];
  if (!kind) return null;
  const f: NumFormat = { ...defaultFormat(kind), thousands: false };
  for (const p of parts.slice(1)) {
    let m: RegExpExecArray | null;
    if ((m = /^([ds])(\d{1,2})$/.exec(p))) { f.sig = m[1] === 's'; f.digits = Math.min(MAX_DIGITS, Number(m[2])); }
    else if (p === 'sep') f.thousands = true;
    else if ((m = /^neg=(minus|parens|red|redparens)$/.exec(p))) f.negative = m[1] as Negative;
    else if ((m = /^sym=(USD|EUR|GBP|JPY)$/.exec(p))) f.symbol = m[1] as CurrencySymbol;
    else return null;
  }
  if (kind === 'integer') { f.digits = 0; f.sig = false; }
  if (f.sig && f.digits < 1) f.digits = 1;
  return f;
}

/** Short human description: "Number · 2 decimals", "Percentage · 3 sig. figs". */
export function describeFormat(f: NumFormat | null): string {
  if (!f) return 'Text';
  const name = NUM_KINDS.find((k) => k.kind === f.kind)!.label;
  if (f.kind === 'integer') return name;
  return `${name} · ${f.digits} ${f.sig ? (f.digits === 1 ? 'sig. fig' : 'sig. figs') : f.digits === 1 ? 'decimal' : 'decimals'}`;
}

// ------------------------------------------------------------------ exact decimals

/** value = (neg ? -1 : 1) × 0.d₁d₂d₃… × 10^point, digits without leading zeros ('' for 0). */
interface Dec { neg: boolean; digits: string; point: number }

function parseDec(s: string): Dec | null {
  const m = /^([+-])?(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(s.trim());
  if (!m || (!m[2] && !m[3])) return null;
  const int = m[2] ?? '';
  const frac = m[3] ?? '';
  let digits = int + frac;
  let point = int.length + Number(m[4] ?? 0);
  const lead = digits.length - digits.replace(/^0+/, '').length;
  digits = digits.slice(lead);
  point -= lead;
  digits = digits.replace(/0+$/, '');
  if (!digits) return { neg: false, digits: '', point: 0 };
  return { neg: m[1] === '-', digits, point };
}

/** Canonical plain decimal string ("-0.00123", "1230", "0"). */
function plain(d: Dec): string {
  if (!d.digits) return '0';
  let int: string, frac: string;
  if (d.point <= 0) { int = '0'; frac = '0'.repeat(-d.point) + d.digits; }
  else if (d.point >= d.digits.length) { int = d.digits + '0'.repeat(d.point - d.digits.length); frac = ''; }
  else { int = d.digits.slice(0, d.point); frac = d.digits.slice(d.point); }
  return (d.neg ? '-' : '') + int + (frac ? '.' + frac : '');
}

/** Round half away from zero to `places` decimal places (places may be negative). */
function roundDec(d: Dec, places: number): Dec {
  if (!d.digits) return d;
  const keep = d.point + places; // number of significant digits that survive
  if (keep >= d.digits.length) return d;
  if (keep < 0) return { neg: false, digits: '', point: 0 };
  const up = d.digits.charCodeAt(keep) - 48 >= 5;
  let kept = d.digits.slice(0, keep);
  let point = d.point;
  if (up) {
    const arr = kept.split('').map(Number);
    let i = arr.length - 1;
    while (i >= 0 && arr[i] === 9) { arr[i] = 0; i--; }
    if (i >= 0) arr[i]++;
    else { arr.unshift(1); point++; }
    kept = arr.join('');
  }
  kept = kept.replace(/0+$/, '');
  return kept ? { neg: d.neg, digits: kept, point } : { neg: false, digits: '', point: 0 };
}

/** Fixed-point rendering with exactly `places` decimals (places ≥ 0): integer and fraction strings. */
function fixed(d: Dec, places: number): { int: string; frac: string } {
  const p = plain({ ...d, neg: false });
  const [int, frac = ''] = p.split('.');
  return { int, frac: places > 0 ? (frac + '0'.repeat(places)).slice(0, places) : '' };
}

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };

// ------------------------------------------------------------------ formatting

export interface Formatted {
  /** what the editor shows (Unicode minus, × 10ⁿ) */
  text: string;
  /** what goes into the PDF; engine-independent LaTeX */
  latex: string;
  /** show in red (red negative styles) */
  red: boolean;
}

/** Format a canonical decimal string. Returns null if `value` is not a number. */
export function formatValue(value: string, f: NumFormat): Formatted | null {
  let d = parseDec(value);
  if (!d) return null;
  if (f.kind === 'percent' && d.digits) d = { ...d, point: d.point + 2 };
  let body: string, latexBody: string;
  if (f.kind === 'scientific') {
    let exp = d.digits ? d.point - 1 : 0;
    const places = f.sig ? Math.max(0, f.digits - 1) : f.digits;
    let m = roundDec({ ...d, point: 1 }, places); // mantissa in [1, 10)
    if (m.digits && m.point > 1) { exp += m.point - 1; m = { ...m, point: 1 }; }
    if (!m.digits) exp = 0;
    d = { ...d, neg: m.neg && !!m.digits };
    const x = fixed(m, places);
    const mant = x.int + (places > 0 ? '.' + x.frac : '');
    body = `${mant} × 10${String(exp).split('').map((c) => SUP[c]).join('')}`;
    latexBody = `${mant}\\times10^{${exp}}`;
  } else {
    let places: number;
    let r: Dec;
    if (f.kind === 'integer') { places = 0; r = roundDec(d, 0); }
    else if (f.sig) {
      const sig = Math.max(1, f.digits);
      places = d.digits ? sig - d.point : sig - 1; // zero to 3 s.f. reads "0.00"
      r = roundDec(d, places);
      if (r.digits && r.point > d.point) places = sig - r.point; // carry: 9.99 → 10.0
      places = Math.max(0, places);
    } else { places = f.digits; r = roundDec(d, places); }
    d = r;
    const x = fixed(r, places);
    const num = (f.thousands ? group(x.int) : x.int) + (places > 0 ? '.' + x.frac : '');
    const cur = CURRENCIES.find((c) => c.id === f.symbol)!;
    const pre = f.kind === 'currency' ? cur.sign : '';
    const preTex = f.kind === 'currency' ? cur.latex : '';
    const post = f.kind === 'percent' ? '%' : '';
    const postTex = f.kind === 'percent' ? '\\%' : '';
    body = pre + num + post;
    latexBody = preTex + num + postTex;
  }
  const neg = d.neg && !!d.digits;
  const parens = neg && (f.negative === 'parens' || f.negative === 'redparens');
  const red = neg && (f.negative === 'red' || f.negative === 'redparens');
  const sci = f.kind === 'scientific';
  let text = body, latex: string;
  if (parens) { text = `(${body})`; latex = sci ? `\\ensuremath{(${latexBody})}` : `(${latexBody})`; }
  else if (neg) { text = `−${body}`; latex = sci ? `\\ensuremath{-${latexBody}}` : `\\ensuremath{-}${latexBody}`; }
  else latex = sci ? `\\ensuremath{${latexBody}}` : latexBody;
  if (red) latex = `\\textcolor[HTML]{${NEGATIVE_RED}}{${latex}}`;
  return { text, latex, red };
}

// ------------------------------------------------------------------ parsing typed text

const FROM_SUP: Record<string, string> = Object.fromEntries(Object.entries(SUP).map(([k, v]) => [v, k]));

/**
 * Read a number the way a person types or reads it: "1,234.5", "(1,234.50)", "−12.5%",
 * "$1,234", "€ 3.2", "1.23 × 10⁻⁴", "1.2e-3", "1.2x10^-3". Returns the canonical decimal
 * string, or null if the text is not a number. A trailing % divides by 100; with
 * `percentEntry` (typing into a percentage cell) so does a bare number, as in Excel.
 */
export function parseNumberText(text: string, percentEntry = false): string | null {
  let s = text.replace(/[\s   ]/g, '');
  if (!s) return null;
  let neg = false;
  const paren = /^\((.*)\)$/.exec(s);
  if (paren) { neg = true; s = paren[1]; }
  s = s.replace(/^[−–-]/, () => { neg = !neg; return ''; });
  s = s.replace(/^(?:[$€£¥]|US\$|USD|EUR|GBP|JPY)/i, '');
  s = s.replace(/^[−–-]/, () => { neg = !neg; return ''; }); // $-5
  let pct = false;
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1); }
  let exp = 0;
  const sci = /^(.*?)(?:[×xX*]10(?:\^?\{?([−–+-]?\d+)\}?|([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+))|[eE]([+-]?\d+))$/.exec(s);
  if (sci) {
    s = sci[1];
    const e = sci[2] ?? (sci[3] ? sci[3].split('').map((c) => FROM_SUP[c]).join('') : sci[4]);
    exp = Number(String(e).replace(/[−–]/, '-'));
    if (!Number.isFinite(exp)) return null;
  }
  if (/,/.test(s)) {
    // thousands separators must be in groups of three: 1,234,567.8
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, '');
  }
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null;
  const d = parseDec(s);
  if (!d) return null;
  const shift = exp - (pct || percentEntry ? 2 : 0);
  return plain({ ...d, neg: neg && !!d.digits, point: d.digits ? d.point + shift : 0 });
}

/** Number of decimals as written ("12.340" → 3), for Excel's increase/decrease decimal. */
function writtenDecimals(text: string): number {
  const m = /\.(\d+)/.exec(text.replace(/[×xX*]10.*$|[eE][+-]?\d+$/, ''));
  return m ? m[1].length : 0;
}

/**
 * Excel's "Increase decimal" / "Decrease decimal" for a cell: starts from the current
 * format, or from how a plain number is written when the cell has none.
 */
export function stepDecimals(f: NumFormat | null, text: string, delta: 1 | -1): NumFormat {
  if (!f) {
    const cur = writtenDecimals(text);
    return { ...defaultFormat('number'), digits: Math.max(0, Math.min(MAX_DIGITS, cur + delta)) };
  }
  if (f.kind === 'integer') return delta > 0 ? { ...f, kind: 'number', digits: 1 } : f;
  const min = f.sig ? 1 : 0;
  return { ...f, digits: Math.max(min, Math.min(MAX_DIGITS, f.digits + delta)) };
}

/** Convert between decimals and significant figures, keeping the visible precision roughly the same. */
export function withPrecisionMode(f: NumFormat, sig: boolean, sample?: string): NumFormat {
  if (f.sig === sig) return f;
  const d = sample ? parseDec(sample) : null;
  const intDigits = d && d.digits ? Math.max(1, d.point + (f.kind === 'percent' ? 2 : 0)) : 1;
  const digits = sig ? Math.max(1, f.digits + intDigits) : Math.max(0, f.digits - intDigits);
  return { ...f, sig, digits: Math.min(MAX_DIGITS, digits) };
}
