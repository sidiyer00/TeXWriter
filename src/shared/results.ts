// Test-run results: validation, JUnit import, counts and run comparison.
import type { RunCounts, RunResults, TestResult, TestStatus } from './types';

const STATUS_ALIASES: Record<string, TestStatus> = {
  pass: 'passed', passed: 'passed', ok: 'passed', success: 'passed', green: 'passed',
  fail: 'failed', failed: 'failed', failure: 'failed', error: 'failed', red: 'failed',
  warn: 'warning', warning: 'warning', amber: 'warning', yellow: 'warning',
  skip: 'skipped', skipped: 'skipped', na: 'skipped', 'n/a': 'skipped',
};

export function normalizeStatus(s: unknown): TestStatus {
  const k = String(s ?? '').trim().toLowerCase();
  return STATUS_ALIASES[k] ?? 'skipped';
}

/** Accepts the Quire results schema (lenient) and returns a normalized copy. */
export function normalizeResults(raw: unknown): RunResults {
  if (!raw || typeof raw !== 'object') throw new Error('results.json must be an object');
  const r = raw as Record<string, unknown>;
  const tests = Array.isArray(r.tests) ? r.tests : null;
  if (!tests) throw new Error('results.json needs a "tests" array');
  const out: TestResult[] = tests.map((t: any, i: number) => {
    if (!t || typeof t !== 'object') throw new Error(`tests[${i}] is not an object`);
    const id = String(t.id ?? t.name ?? `test_${i + 1}`);
    const value = typeof t.value === 'number' || typeof t.value === 'string' ? t.value : t.value == null ? null : String(t.value);
    return {
      id,
      name: String(t.name ?? id),
      category: String(t.category ?? 'Uncategorised'),
      status: normalizeStatus(t.status),
      metric: t.metric != null ? String(t.metric) : undefined,
      value,
      threshold: t.threshold != null ? String(t.threshold) : undefined,
      notes: t.notes != null ? String(t.notes) : undefined,
      outputs: Array.isArray(t.outputs) ? t.outputs.map(String) : [],
      details: t.details && typeof t.details === 'object' ? t.details : undefined,
      finishedAt: t.finishedAt ?? t.finished_at ?? undefined,
    };
  });
  return { suite: String(r.suite ?? 'suite'), dataSnapshot: r.dataSnapshot != null ? String(r.dataSnapshot) : r.data_snapshot != null ? String(r.data_snapshot) : undefined, tests: out };
}

/** Import a JUnit XML report (pytest --junitxml, testthat, etc.). Status only. */
export function parseJUnit(xml: string, suiteName = 'junit'): RunResults {
  const tests: TestResult[] = [];
  const re = /<testcase\b([^>]*?)(\/>|>([\s\S]*?)<\/testcase>)/g;
  const attr = (s: string, k: string) => new RegExp(`\\b${k}="([^"]*)"`).exec(s)?.[1];
  const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const a = m[1];
    const body = m[3] ?? '';
    const name = unesc(attr(a, 'name') ?? 'test');
    const cls = unesc(attr(a, 'classname') ?? '');
    let status: TestStatus = 'passed';
    let notes: string | undefined;
    const f = /<(failure|error)\b([^>]*)>?/.exec(body);
    if (f) { status = 'failed'; notes = unesc(attr(f[2], 'message') ?? '').slice(0, 300) || undefined; }
    else if (/<skipped\b/.test(body)) { status = 'skipped'; notes = unesc(attr(/<skipped\b([^>]*)/.exec(body)?.[1] ?? '', 'message') ?? '') || undefined; }
    const category = cls.split('.').slice(-1)[0] || 'Tests';
    tests.push({ id: cls ? `${cls}.${name}` : name, name, category, status, notes, outputs: [] });
  }
  const sm = /<testsuite\b[^>]*name="([^"]*)"/.exec(xml);
  return { suite: sm?.[1] ?? suiteName, tests };
}

export function countResults(r: RunResults | null): RunCounts {
  const c: RunCounts = { passed: 0, failed: 0, warning: 0, skipped: 0, total: 0 };
  for (const t of r?.tests ?? []) { c[t.status]++; c.total++; }
  return c;
}

export interface Delta { id: string; prev?: TestResult; delta: number | null; statusChanged: boolean }

export function compareRuns(cur: RunResults, prev: RunResults | null): Map<string, Delta> {
  const p = new Map((prev?.tests ?? []).map((t) => [t.id, t] as const));
  const out = new Map<string, Delta>();
  for (const t of cur.tests) {
    const q = p.get(t.id);
    const delta = q && typeof t.value === 'number' && typeof q.value === 'number' ? t.value - q.value : null;
    out.set(t.id, { id: t.id, prev: q, delta, statusChanged: !!q && q.status !== t.status });
  }
  return out;
}

export function formatValue(v: TestResult['value'], metric?: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (typeof v === 'string') return v;
  if (metric && /%|percent|rate|share|completeness/i.test(metric) && Math.abs(v) <= 1) return `${(v * 100).toFixed(1)}%`;
  if (Number.isInteger(v)) return v.toLocaleString('en-US');
  const a = Math.abs(v);
  return a !== 0 && a < 0.05 ? v.toFixed(3) : v.toFixed(3).replace(/0$/, '');
}

export function formatDelta(d: number | null, metric?: string): string {
  if (d === null) return '—';
  if (Math.abs(d) < 1e-12) return '0';
  const pctMetric = metric && /%|percent|rate|share|completeness/i.test(metric);
  const s = pctMetric ? `${(d * 100).toFixed(1)} pp` : Math.abs(d) < 0.05 ? d.toFixed(3) : d.toFixed(3);
  return (d > 0 ? '+' : '−') + s.replace('-', '');
}
