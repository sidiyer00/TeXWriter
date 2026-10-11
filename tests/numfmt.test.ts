import { describe, expect, it } from 'vitest';
import { decodeFormat, defaultFormat, describeFormat, encodeFormat, formatValue, parseNumberText, stepDecimals, withPrecisionMode, type NumFormat } from '../src/shared/latex/numfmt';

const fmt = (kind: NumFormat['kind'], patch: Partial<NumFormat> = {}): NumFormat => ({ ...defaultFormat(kind), ...patch });
const show = (v: string, f: NumFormat) => formatValue(v, f)!.text;
const tex = (v: string, f: NumFormat) => formatValue(v, f)!.latex;

describe('number formats', () => {
  it('rounds half away from zero on exact decimals (as Excel)', () => {
    expect(show('1.005', fmt('number'))).toBe('1.01');
    expect(show('2.675', fmt('number'))).toBe('2.68');
    expect(show('-1.005', fmt('number'))).toBe('−1.01');
    expect(show('0.125', fmt('number', { digits: 2 }))).toBe('0.13');
    expect(show('9.995', fmt('number'))).toBe('10.00');
    expect(show('0.0001', fmt('number'))).toBe('0.00');
    expect(show('-0.001', fmt('number'))).toBe('0.00'); // no "−0.00"
    expect(show('1234567.891', fmt('number', { thousands: true, digits: 1 }))).toBe('1,234,567.9');
  });
  it('integers', () => {
    expect(show('1234.5', fmt('integer'))).toBe('1,235');
    expect(show('-0.4', fmt('integer'))).toBe('0');
    expect(show('999.5', fmt('integer', { thousands: false }))).toBe('1000');
  });
  it('significant figures, including carries', () => {
    const s3 = fmt('number', { sig: true, digits: 3 });
    expect(show('0.012345', s3)).toBe('0.0123');
    expect(show('123456', s3)).toBe('123000');
    expect(show('9.996', s3)).toBe('10.0');
    expect(show('99.96', s3)).toBe('100');
    expect(show('1.5', s3)).toBe('1.50');
    expect(show('0', s3)).toBe('0.00');
  });
  it('percentages multiply by 100', () => {
    expect(show('0.125', fmt('percent', { digits: 1 }))).toBe('12.5%');
    expect(tex('0.125', fmt('percent', { digits: 1 }))).toBe('12.5\\%');
    expect(show('0.0769', fmt('percent', { sig: true, digits: 2 }))).toBe('7.7%');
  });
  it('currency and negative styles', () => {
    expect(show('1234.5', fmt('currency'))).toBe('$1,234.50');
    expect(tex('1234.5', fmt('currency'))).toBe('\\$1,234.50');
    expect(show('-1234.5', fmt('currency'))).toBe('−$1,234.50');
    expect(tex('-1234.5', fmt('currency'))).toBe('\\ensuremath{-}\\$1,234.50');
    expect(show('-1234.5', fmt('currency', { negative: 'parens' }))).toBe('($1,234.50)');
    const r = formatValue('-3', fmt('number', { negative: 'redparens', digits: 0 }))!;
    expect(r).toEqual({ text: '(3)', latex: '\\textcolor[HTML]{C00000}{(3)}', red: true });
    expect(show('5', fmt('currency', { symbol: 'EUR' }))).toBe('€5.00');
    expect(tex('5', fmt('currency', { symbol: 'GBP' }))).toBe('\\pounds{}5.00');
  });
  it('scientific notation', () => {
    expect(show('0.000123456', fmt('scientific'))).toBe('1.23 × 10⁻⁴');
    expect(tex('0.000123456', fmt('scientific'))).toBe('\\ensuremath{1.23\\times10^{-4}}');
    expect(show('99999', fmt('scientific', { digits: 1 }))).toBe('1.0 × 10⁵');
    expect(show('-4500', fmt('scientific', { sig: true, digits: 2 }))).toBe('−4.5 × 10³');
    expect(show('0', fmt('scientific'))).toBe('0.00 × 10⁰');
  });
  it('parses what people type', () => {
    expect(parseNumberText('1,234.50')).toBe('1234.5');
    expect(parseNumberText('(1,234.50)')).toBe('-1234.5');
    expect(parseNumberText('−$1,234')).toBe('-1234');
    expect(parseNumberText('$-5')).toBe('-5');
    expect(parseNumberText('12.5%')).toBe('0.125');
    expect(parseNumberText('12.5', true)).toBe('0.125');
    expect(parseNumberText('1.23 × 10⁻⁴')).toBe('0.000123');
    expect(parseNumberText('1.2e-3')).toBe('0.0012');
    expect(parseNumberText('1.2x10^3')).toBe('1200');
    expect(parseNumberText('€ 3.20')).toBe('3.2');
    expect(parseNumberText('.5')).toBe('0.5');
    expect(parseNumberText('12,34')).toBeNull();
    expect(parseNumberText('Pass')).toBeNull();
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('1.2.3')).toBeNull();
  });
  it('round-trips every displayed value', () => {
    const fs = [fmt('number'), fmt('integer'), fmt('percent'), fmt('currency', { negative: 'parens' }), fmt('scientific'), fmt('number', { sig: true, digits: 4, thousands: true })];
    for (const f of fs) for (const v of ['0.1234567', '-98765.4321', '0.000045', '1500']) {
      const t = show(v, f);
      const back = parseNumberText(t)!;
      expect(show(back, f), `${encodeFormat(f)} ${v}`).toBe(t);
    }
  });
  it('encodes formats compactly and strictly', () => {
    const f = fmt('currency', { digits: 0, negative: 'parens', symbol: 'EUR' });
    expect(encodeFormat(f)).toBe('cur,d0,sep,neg=parens,sym=EUR');
    expect(decodeFormat(encodeFormat(f))).toEqual(f);
    expect(encodeFormat(fmt('number', { sig: true, digits: 3 }))).toBe('num,s3');
    expect(encodeFormat(fmt('integer'))).toBe('int,sep');
    expect(decodeFormat('num,d2,bogus')).toBeNull();
    expect(decodeFormat('xyz')).toBeNull();
    expect(describeFormat(decodeFormat('pct,s3'))).toBe('Percentage · 3 sig. figs');
  });
  it('increase / decrease decimal like Excel', () => {
    expect(stepDecimals(null, '12.34', 1)).toMatchObject({ kind: 'number', digits: 3 });
    expect(stepDecimals(null, '12', -1)).toMatchObject({ kind: 'number', digits: 0 });
    expect(stepDecimals(fmt('integer'), '', 1)).toMatchObject({ kind: 'number', digits: 1 });
    expect(stepDecimals(fmt('number', { sig: true, digits: 1 }), '', -1).digits).toBe(1);
    expect(withPrecisionMode(fmt('number', { digits: 2 }), true, '12.345')).toMatchObject({ sig: true, digits: 4 });
  });
});
