// Test runs: run the suite, review results, compare runs and insert results into the report.
import { useEffect, useMemo, useState } from 'react';
import type { GeneratedBlockConfig, RunRecord, TestResult, TestStatus } from '../../shared/types';
import { compareRuns, formatDelta, formatValue } from '../../shared/results';
import { defaultSummaryTemplate, resolveTemplate } from '../../shared/generate';
import { api, cancelRun, createGeneratedBlock, getRun, getState, insertBlockAt, latestRun, manifest, parsedMain, runTests, setState, toast, uniqueBlockId, useStore, derive } from '../store';
import { BackButton, CompileButton, ExportMenu, TitleBar } from '../components/Chrome';
import { Down, Play, Right, Search, StatusPill } from '../components/Icons';
import { parseInline } from '../../shared/latex/inline';
import { escapeText } from '../../shared/latex/inline';

const ORDER: TestStatus[] = ['failed', 'warning', 'passed', 'skipped'];

function fmtTime(iso?: string) { return iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '—'; }
function dur(ms?: number) { if (!ms && ms !== 0) return ''; const s = Math.round(ms / 1000); return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }

function usedBy(t: TestResult): GeneratedBlockConfig[] {
  const blocks = Object.values(getState().project?.manifest.blocks ?? {});
  return blocks.filter((b) => b.testIds.includes(t.id) || (b.source && (t.outputs ?? []).includes(b.source)));
}

/** Section choices for insertion: [label, parsed index to insert after]. */
function insertTargets(): { label: string; after: number }[] {
  const s = getState();
  const blocks = parsedMain().blocks;
  const out: { label: string; after: number }[] = [];
  s.outline.forEach((o, k) => {
    // end of this section = before the next heading with level <= o.level
    let end = blocks.length - 1;
    if (k + 1 < s.outline.length) end = s.outline[k + 1].index - 1;
    out.push({ label: `§${o.number || ''} ${o.title} — end of section`, after: end });
  });
  if (s.insertAfter !== null) out.unshift({ label: 'At the cursor in the report', after: s.insertAfter });
  return out;
}

function humanize(file: string) {
  const stem = file.split('/').pop()!.replace(/\.\w+$/, '').replace(/[_-]+/g, ' ');
  return stem.charAt(0).toUpperCase() + stem.slice(1);
}

function History({ id, runs }: { id: string; runs: RunRecord[] }) {
  const pts = runs.map((r) => ({ n: r.meta.number, v: r.results?.tests.find((t) => t.id === id) })).filter((p) => p.v && typeof p.v.value === 'number').reverse() as { n: number; v: TestResult }[];
  if (pts.length < 2) return <div className="small muted">History appears after two or more runs.</div>;
  const vals = pts.map((p) => p.v.value as number);
  const thr = Number(/[-+]?\d*\.?\d+(e-?\d+)?/.exec(pts[pts.length - 1].v.threshold ?? '')?.[0]);
  const all = Number.isFinite(thr) ? [...vals, thr] : vals;
  const lo = Math.min(...all), hi = Math.max(...all);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.1 || 1;
  const y = (v: number) => 76 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * 68;
  const x = (i: number) => 34 + (i * 250) / (pts.length - 1);
  const col = (s: TestStatus) => (s === 'failed' ? '#B3361F' : s === 'warning' ? '#B06A00' : '#1F1E1C');
  return (
    <svg viewBox="0 0 300 96" width="100%" height="96" role="img" aria-label={`Values by run: ${pts.map((p) => `#${p.n} ${formatValue(p.v.value, p.v.metric)}`).join(', ')}`}>
      <line x1="28" y1="8" x2="28" y2="76" stroke="#DDD8CF" /><line x1="28" y1="76" x2="292" y2="76" stroke="#DDD8CF" />
      {Number.isFinite(thr) && <><line x1="28" y1={y(thr)} x2="292" y2={y(thr)} stroke="#B3361F" strokeDasharray="3 3" /><text x="24" y={y(thr) + 3} textAnchor="end" fontSize="9" fill="#5C5850" fontFamily="IBM Plex Mono, monospace">{formatValue(thr, pts[0].v.metric)}</text></>}
      <polyline points={pts.map((p, i) => `${x(i)},${y(p.v.value as number)}`).join(' ')} fill="none" stroke="#1F1E1C" strokeWidth="1.5" />
      {pts.map((p, i) => <circle key={p.n} cx={x(i)} cy={y(p.v.value as number)} r={i === pts.length - 1 ? 4 : 3} fill={col(p.v.status)} stroke="#fff" strokeWidth="1" />)}
      {pts.map((p, i) => <text key={`t${p.n}`} x={x(i)} y="90" textAnchor="middle" fontSize="9" fill="#5C5850" fontFamily="IBM Plex Sans, sans-serif">#{p.n}</text>)}
    </svg>
  );
}

function InsertPanel({ tests, run }: { tests: TestResult[]; run: RunRecord }) {
  const outputs = [...new Set(tests.flatMap((t) => t.outputs ?? []))];
  const csvs = outputs.filter((o) => /\.csv$/i.test(o));
  const figs = outputs.filter((o) => /\.(pdf|png|jpe?g)$/i.test(o));
  const [kind, setKind] = useState<'table' | 'figure' | 'summary'>(csvs.length ? 'table' : 'summary');
  const [file, setFile] = useState('');
  const targets = useMemo(insertTargets, [tests.map((t) => t.id).join()]);
  const [target, setTarget] = useState(0);
  const [template, setTemplate] = useState('');
  useEffect(() => {
    setFile(kind === 'table' ? csvs[0] ?? '' : kind === 'figure' ? figs[0] ?? '' : '');
    setTemplate(tests.map(defaultSummaryTemplate).join(' '));
  }, [kind, tests.map((t) => t.id).join()]);
  useEffect(() => { if (kind === 'table' && !csvs.length) setKind(figs.length ? 'figure' : 'summary'); }, [tests.map((t) => t.id).join()]);
  const preview = useMemo(() => {
    if (kind !== 'summary' || !run.results) return '';
    const txt = resolveTemplate(template, run.results, { id: '', kind: 'summary', run: 0, followLatest: true, testIds: [] }).text;
    try { return parseInline(txt).map((n) => (n.type === 'text' ? n.text : n.type === 'inlineMath' ? n.attrs?.latex : '')).join(''); } catch { return txt; }
  }, [template, kind, run]);
  const go = async () => {
    const after = targets[target]?.after ?? null;
    const base = kind === 'summary' ? `sum_${tests[0].id}` : `${kind === 'table' ? 'tab' : 'fig'}_${humanize(file)}`;
    const id = uniqueBlockId(base);
    const label = kind === 'summary' ? undefined : `${kind === 'table' ? 'tab' : 'fig'}:${id.replace(/^(tab|fig)_/, '').replace(/_/g, '-')}`;
    const cfg: GeneratedBlockConfig = {
      id, kind, run: run.meta.number, followLatest: true, testIds: tests.map((t) => t.id),
      source: kind === 'summary' ? undefined : file,
      caption: kind === 'summary' ? undefined : `${escapeText(humanize(file))}.`,
      label, decimals: 3, style: 'booktabs', sourceLine: true, totalRow: true,
      highlight: kind === 'table' ? { column: 'Result', equals: 'Fail' } : null,
      template: kind === 'summary' ? template : undefined,
      width: kind === 'figure' ? '0.8\\linewidth' : undefined,
    };
    const at = await createGeneratedBlock(cfg, after);
    if (at === undefined) return;
    toast(`Inserted ${kind} “${label ?? id}” into the report.`, 'ok', { label: 'Show in report', run: () => setState({ view: 'editor', syncIndex: at }) });
    setState({ insertAfter: null });
  };
  return (
    <div className="sec">
      <span className="lbl">Insert into report</span>
      <div role="group" aria-label="Insert as" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 6 }}>
        <button className="opt" aria-pressed={kind === 'table'} disabled={!csvs.length} onClick={() => setKind('table')}><b>Table</b><span className="small muted">{csvs.length ? `${csvs.length} CSV output${csvs.length > 1 ? 's' : ''}` : 'No CSV output'}</span></button>
        <button className="opt" aria-pressed={kind === 'figure'} disabled={!figs.length} onClick={() => setKind('figure')}><b>Figure</b><span className="small muted">{figs.length ? `${figs.length} file${figs.length > 1 ? 's' : ''}` : 'No figure'}</span></button>
        <button className="opt" aria-pressed={kind === 'summary'} onClick={() => setKind('summary')}><b>Summary</b><span className="small muted">Linked sentence</span></button>
      </div>
      {kind !== 'summary' && (
        <label className="f">Output file<select className="field mono" value={file} onChange={(e) => setFile(e.target.value)}>{(kind === 'table' ? csvs : figs).map((o) => <option key={o} value={o}>{o}</option>)}</select></label>
      )}
      {kind === 'summary' && (
        <>
          <label className="f">Wording (values in {'{{…}}'} stay linked)<textarea className="field mono" rows={4} value={template} onChange={(e) => setTemplate(e.target.value)} /></label>
          <div style={{ padding: '10px 12px', border: '1px dashed #A39B8F', borderRadius: 6, background: '#fff', fontFamily: 'var(--serif)', fontSize: 13.5, lineHeight: 1.5 }}>{preview}</div>
        </>
      )}
      <label className="f">Place<select className="field" value={target} onChange={(e) => setTarget(Number(e.target.value))}>{targets.map((t, i) => <option key={i} value={i}>{t.label}</option>)}{targets.length === 0 && <option>End of document</option>}</select></label>
      <div className="small muted">Linked to run #{run.meta.number}; refreshes when a newer run is available.</div>
      <button className="btn btn-pri" onClick={() => void go()} disabled={kind !== 'summary' && !file}>Insert {kind}</button>
    </div>
  );
}

function FindingsButton({ tests }: { tests: TestResult[] }) {
  const add = () => {
    const blocks = parsedMain().blocks;
    const fi = blocks.findIndex((b) => b.node.type === 'heading' && /finding/i.test(JSON.stringify(b.node.content ?? [])));
    let after: number | null = null;
    if (fi >= 0) { after = blocks.length - 1; for (let j = fi + 1; j < blocks.length; j++) if (blocks[j].node.type === 'heading' && (blocks[j].node.attrs?.level ?? 1) <= (blocks[fi].node.attrs?.level ?? 1)) { after = j - 1; break; } }
    for (const t of tests) {
      after = insertBlockAt({ type: 'calloutBlock', attrs: { title: `Finding · ${t.name.replace(/[{}]/g, '')} · Severity: [set]` }, content: [{ type: 'paragraph', content: [{ type: 'text', text: `${t.name} ${t.status === 'failed' ? 'failed' : 'raised a warning'}: ${t.metric ?? 'value'} = ${formatValue(t.value, t.metric)} against a threshold of ${t.threshold ?? 'n/a'}. ${t.notes ?? ''} [Describe impact and remediation.]`.trim() }] }] }, after);
    }
    derive();
    toast(`Added ${tests.length} finding${tests.length > 1 ? 's' : ''} ${fi >= 0 ? 'to the Findings section' : 'at the end of the report'}.`, 'ok', { label: 'Show', run: () => setState({ view: 'editor' }) });
  };
  return <button className="btn btn-sm btn-dark" onClick={add}>Add to findings</button>;
}

export function TestsScreen() {
  const project = useStore((s) => s.project)!;
  const runs = useStore((s) => s.runs);
  const running = useStore((s) => s.running);
  const selRunNo = useStore((s) => s.selectedRun);
  const selTest = useStore((s) => s.selectedTest);
  const runCache = useStore((s) => s.runCache);
  const renders = useStore((s) => s.renders);
  void renders;
  const [statuses, setStatuses] = useState<Set<TestStatus>>(new Set());
  const [q, setQ] = useState('');
  const [groupBy, setGroupBy] = useState<'category' | 'status'>('category');
  const [onlyUsed, setOnlyUsed] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [compareNo, setCompareNo] = useState<number | null>(null);
  const [history, setHistory] = useState<RunRecord[]>([]);
  const [showLog, setShowLog] = useState(false);

  const runNo = selRunNo ?? runs[0]?.number ?? null;
  const rec = runNo ? runCache[runNo] : null;
  useEffect(() => { if (runNo) void getRun(runNo); setChecked(new Set()); }, [runNo]);
  const completed = runs.filter((r) => r.status === 'completed');
  const prevNo = compareNo ?? completed.find((r) => runNo !== null && r.number < runNo)?.number ?? null;
  useEffect(() => { if (prevNo) void getRun(prevNo); }, [prevNo]);
  useEffect(() => {
    void (async () => {
      const out: RunRecord[] = [];
      for (const r of completed.slice(0, 8)) { const x = await getRun(r.number); if (x) out.push(x); }
      setHistory(out);
    })();
  }, [runs.length]);
  const prev = prevNo ? runCache[prevNo] : null;
  const deltas = useMemo(() => (rec?.results ? compareRuns(rec.results, prev?.results ?? null) : new Map()), [rec, prev]);

  const tests = rec?.results?.tests ?? [];
  const filtered = tests.filter((t) => (statuses.size === 0 || statuses.has(t.status)) && (!q || `${t.name} ${t.id} ${t.metric ?? ''}`.toLowerCase().includes(q.toLowerCase())) && (!onlyUsed || usedBy(t).length > 0));
  const groups = new Map<string, TestResult[]>();
  for (const t of filtered) { const k = groupBy === 'category' ? t.category : t.status; if (!groups.has(k)) groups.set(k, []); groups.get(k)!.push(t); }
  const groupKeys = [...groups.keys()].sort((a, b) => (groupBy === 'status' ? ORDER.indexOf(a as TestStatus) - ORDER.indexOf(b as TestStatus) : 0));
  const counts = rec?.meta.counts;
  const prevCounts = prev?.meta.counts;
  const selected = tests.find((t) => t.id === selTest) ?? null;
  const checkedTests = tests.filter((t) => checked.has(t.id));
  const toggle = (s: TestStatus) => setStatuses((cur) => { const n = new Set(cur); if (n.has(s)) n.delete(s); else n.add(s); return n; });

  return (
    <>
      <TitleBar crumb="Test runs" center={<BackButton />} right={<><CompileButton /><ExportMenu /></>} />
      <div className="body">
        <aside className="panel-left" aria-label="Test runs">
          <div className="col" style={{ padding: 12, borderBottom: '1px solid var(--rule)' }}>
            <div className="f">Suite<div className="field mono" style={{ display: 'flex', alignItems: 'center', overflow: 'hidden', whiteSpace: 'nowrap' }} title={project.manifest.tests.command}>{project.manifest.tests.suiteName || 'tests'}</div></div>
            {project.manifest.tests.command
              ? <button className="btn btn-pri" disabled={!!running} onClick={() => void runTests()}><Play />Run suite <span className="k mono" style={{ fontSize: 11, opacity: .8 }}>Ctrl+Shift+T</span></button>
              : <button className="btn" onClick={() => setState({ view: 'setup' })}>Configure test command…</button>}
          </div>
          <div className="scroll" style={{ flex: 1, padding: 8, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {running && (
              <div className="running-card" role="status" aria-live="polite">
                <div className="row"><span className="st run st-sm">Running</span><b>#{(runs[0]?.number ?? 0) + 1}</b><span className="spacer" /><span className="small">{dur(Date.now() - running.startedAt)}</span></div>
                <div className="small" style={{ color: '#2C3D60' }}>{running.total ? `${running.done} of ${running.total}` : 'Starting'} · {running.label}</div>
                <div className={`progress ${running.total ? '' : 'indet'}`}><div style={{ width: `${running.total ? (100 * running.done) / running.total : 30}%` }} /></div>
                <div className="row"><button className="btn btn-q btn-xs" onClick={() => setShowLog(!showLog)}>{showLog ? 'Hide' : 'Show'} output</button><span className="spacer" /><button className="btn btn-q btn-xs" style={{ color: 'var(--accent-hover)' }} onClick={cancelRun}>Cancel</button></div>
                {showLog && <div className="logbox">{running.log.slice(-40).join('\n') || '…'}</div>}
              </div>
            )}
            {runs.length === 0 && !running && <div className="empty small"><b>No runs yet</b><span className="muted">Results appear here with their outputs, so report content can link to them.</span></div>}
            {runs.map((r) => (
              <button key={r.number} className={`runitem ${r.number === runNo ? 'active' : ''}`} aria-current={r.number === runNo} onClick={() => setState({ selectedRun: r.number, selectedTest: null })}>
                <span className="row"><b style={{ fontWeight: 600 }}>#{r.number}</b>{r.number === latestRun()?.number && <span className="small" style={{ color: '#3B4F78' }}>Latest</span>}{r.number === prevNo && <span className="small muted">Comparing</span>}{r.status !== 'completed' && <span className={`st st-sm ${r.status === 'cancelled' ? 'skip' : 'fail'}`}>{r.status === 'cancelled' ? 'Cancelled' : 'Did not finish'}</span>}</span>
                <span className="muted">{fmtTime(r.startedAt)} · {dur(r.durationMs)}</span>
                {r.status === 'completed' && <span className="row small" style={{ gap: 8 }}><span className="t-pass">{r.counts.passed} ✓</span><span className="t-fail">{r.counts.failed} failed</span><span className="t-warn">{r.counts.warning} warn</span><span className="t-skip">{r.counts.skipped} skip</span></span>}
              </button>
            ))}
          </div>
        </aside>

        <main className="main" style={{ background: '#fff' }}>
          {!rec ? (
            <div style={{ padding: 32 }}>
              <div className="empty" style={{ maxWidth: 560 }}>
                <h3>{project.manifest.tests.command ? 'Run the test suite' : 'Connect a test suite to fill this report'}</h3>
                <div className="small muted">{project.manifest.tests.command
                  ? <>Quire runs <span className="mono">{project.manifest.tests.command}</span>. Each run lands in <span className="mono">runs/&lt;n&gt;/</span> with its results and output files, and every table or summary you insert stays linked to the run that produced it.</>
                  : <>Point Quire at a script that writes <span className="mono">results.json</span> (or a JUnit XML file) into the run directory. Results can then populate tables, figures and summaries.</>}</div>
                <div className="row">{project.manifest.tests.command ? <button className="btn btn-pri" disabled={!!running} onClick={() => void runTests()}><Play />Run suite</button> : <button className="btn btn-pri" onClick={() => setState({ view: 'setup' })}>Configure tests…</button>}</div>
              </div>
            </div>
          ) : (
            <>
              <div className="col" style={{ flex: 'none', padding: '16px 20px 12px', borderBottom: '1px solid var(--rule)', background: 'var(--chrome)', gap: 12 }}>
                <div className="row wrap" style={{ alignItems: 'flex-start', gap: 12 }}>
                  <div className="grow" style={{ flex: '1 1 360px' }}>
                    <h1 style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>Run #{rec.meta.number} <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· {rec.meta.suite}</span></h1>
                    <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                      {rec.meta.status === 'completed' ? 'Completed' : rec.meta.status === 'cancelled' ? 'Cancelled' : 'Did not finish'} {fmtTime(rec.meta.startedAt)} · {dur(rec.meta.durationMs)}
                      {rec.meta.gitCommit && <> · commit <span className="mono small">{rec.meta.gitCommit}</span></>}
                      {rec.meta.dataSnapshot && <> · data snapshot <span className="mono small">{rec.meta.dataSnapshot}</span></>}
                    </div>
                  </div>
                  <label className="row small muted">Compare to<select className="field" style={{ width: 140 }} value={prevNo ?? ''} onChange={(e) => setCompareNo(e.target.value ? Number(e.target.value) : null)}><option value="">—</option>{completed.filter((r) => r.number !== runNo).map((r) => <option key={r.number} value={r.number}>#{r.number} · {new Date(r.startedAt).toLocaleDateString()}</option>)}</select></label>
                  <button className="btn" onClick={() => void api.revealInFolder(`${project.root}/runs/${rec.meta.number}/log.txt`)}>Run folder</button>
                </div>
                {rec.meta.status !== 'completed' && (
                  <div className="banner err" style={{ margin: 0 }}><div className="grow"><b>This run did not produce results</b><div className="small">{rec.meta.error ?? 'The run was cancelled.'}</div><div className="small mono" style={{ marginTop: 4 }}>{rec.meta.command}</div></div></div>
                )}
                {counts && rec.results && (
                  <div className="row wrap" style={{ gap: 24 }}>
                    <div className="row wrap" style={{ gap: 22 }}>
                      {([['passed', 't-pass', 'Passed'], ['failed', 't-fail', 'Failed'], ['warning', 't-warn', 'Warnings'], ['skipped', 't-skip', 'Skipped']] as const).map(([k, c, l]) => {
                        const d = prevCounts ? counts[k] - prevCounts[k] : 0;
                        return <div key={k} className="stat"><div className={`v ${c}`}>{counts[k]}</div><div className="k">{l}{prevCounts && d !== 0 && <span className={(k === 'failed' || k === 'warning') === d > 0 ? 't-fail' : 't-pass'}> {d > 0 ? '+' : '−'}{Math.abs(d)} vs #{prevNo}</span>}</div></div>;
                      })}
                    </div>
                    <div className="col grow" style={{ flex: '1 1 240px', minWidth: 200, gap: 5 }}>
                      <div role="img" aria-label={`${counts.passed} passed, ${counts.failed} failed, ${counts.warning} warnings, ${counts.skipped} skipped of ${counts.total}`} style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', gap: 2 }}>
                        <span style={{ flex: counts.passed, background: '#3D8A5C' }} /><span style={{ flex: counts.failed, background: '#B3361F' }} /><span style={{ flex: counts.warning, background: '#C98A1E' }} /><span style={{ flex: counts.skipped, background: '#A39B8F' }} />
                      </div>
                      <div className="small muted">{counts.total} tests · {tests.filter((t) => usedBy(t).length).length} feed report content</div>
                    </div>
                  </div>
                )}
                {rec.results && (
                  <div role="toolbar" aria-label="Filter results" className="row wrap" style={{ gap: 8 }}>
                    <label className="row" style={{ height: 30, padding: '0 9px', border: '1px solid #D3CDC3', borderRadius: 6, background: '#fff', width: 220, color: 'var(--muted-3)' }}><Search /><input aria-label="Search tests" placeholder="Search tests, metrics" value={q} onChange={(e) => setQ(e.target.value)} style={{ border: 0, outline: 'none', background: 'transparent', flex: 1, fontSize: 12.5, color: 'var(--ink)', minWidth: 0 }} /></label>
                    <button className="chip" aria-pressed={statuses.size === 0} onClick={() => setStatuses(new Set())}>All {tests.length}</button>
                    {ORDER.map((s) => <button key={s} className="chip" aria-pressed={statuses.has(s)} onClick={() => toggle(s)}>{{ failed: 'Failed', warning: 'Warnings', passed: 'Passed', skipped: 'Skipped' }[s]} {tests.filter((t) => t.status === s).length}</button>)}
                    <label className="row small" style={{ marginLeft: 'auto', color: 'var(--muted)' }}>Group by<select className="field" style={{ width: 120 }} value={groupBy} onChange={(e) => setGroupBy(e.target.value as never)}><option value="category">Category</option><option value="status">Status</option></select></label>
                    <label className="chk"><input type="checkbox" checked={onlyUsed} onChange={(e) => setOnlyUsed(e.target.checked)} />Used in report only</label>
                  </div>
                )}
              </div>
              <div className="scroll" style={{ flex: 1 }}>
                {rec.results && (
                  <table className="rtable">
                    <thead><tr>
                      <th scope="col" style={{ width: 36 }}><input type="checkbox" aria-label="Select all visible" checked={filtered.length > 0 && filtered.every((t) => checked.has(t.id))} onChange={(e) => setChecked(e.target.checked ? new Set(filtered.map((t) => t.id)) : new Set())} /></th>
                      <th scope="col">Test</th><th scope="col">Status</th><th scope="col" style={{ textAlign: 'right' }}>Value</th><th scope="col">Threshold</th><th scope="col" style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{prevNo ? `Δ vs #${prevNo}` : 'Δ'}</th><th scope="col">In report</th><th scope="col" style={{ paddingRight: 20 }}>Notes</th>
                    </tr></thead>
                    <tbody>
                      {groupKeys.map((g) => {
                        const ts = groups.get(g)!.sort((a, b) => ORDER.indexOf(a.status) - ORDER.indexOf(b.status));
                        const isCol = collapsed.has(g);
                        const c = (s: TestStatus) => ts.filter((t) => t.status === s).length;
                        return [
                          <tr key={`g-${g}`} className="grp"><td colSpan={8}>
                            <button className="btn btn-q btn-sm" aria-expanded={!isCol} style={{ fontWeight: 600, paddingLeft: 2 }} onClick={() => setCollapsed((cur) => { const n = new Set(cur); if (n.has(g)) n.delete(g); else n.add(g); return n; })}>{isCol ? <Right size={12} /> : <Down size={12} />}{groupBy === 'status' ? ({ failed: 'Failed', warning: 'Warnings', passed: 'Passed', skipped: 'Skipped' } as Record<string, string>)[g] : g}</button>
                            <span className="small muted">{ts.length} tests{c('failed') ? <> · <span className="t-fail">{c('failed')} failed</span></> : ''}{c('warning') ? <> · <span className="t-warn">{c('warning')} warning{c('warning') > 1 ? 's' : ''}</span></> : ''}{c('skipped') ? ` · ${c('skipped')} skipped` : ''}{!c('failed') && !c('warning') && !c('skipped') ? ' · all passed' : ''}</span>
                          </td></tr>,
                          ...(isCol ? [] : ts.map((t) => {
                            const d = deltas.get(t.id);
                            const used = usedBy(t);
                            return (
                              <tr key={t.id} className={`r ${t.id === selTest ? 'sel' : ''}`} onClick={() => setState({ selectedTest: t.id })} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setState({ selectedTest: t.id }); }}>
                                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" aria-label={`Select ${t.name}`} checked={checked.has(t.id)} onChange={(e) => setChecked((cur) => { const n = new Set(cur); if (e.target.checked) n.add(t.id); else n.delete(t.id); return n; })} /></td>
                                <td><div style={{ fontWeight: 500 }}>{t.name}</div><div className="tid">{t.id}{t.metric ? ` · ${t.metric}` : ''}</div></td>
                                <td><StatusPill status={t.status} />{d?.statusChanged && <div className="small muted" style={{ marginTop: 2 }}>was {d.prev?.status}</div>}</td>
                                <td className="num">{formatValue(t.value, t.metric)}</td>
                                <td className="mono" style={{ fontSize: 12, maxWidth: 150 }}>{t.threshold ?? '—'}</td>
                                <td className="num" style={{ color: d?.statusChanged && t.status === 'failed' ? 'var(--fail-ink)' : undefined }}>{formatDelta(d?.delta ?? null, t.metric)}</td>
                                <td>{used.length ? used.map((b) => <button key={b.id} className="btn btn-q btn-xs" style={{ color: 'var(--accent)' }} onClick={(e) => { e.stopPropagation(); const i = parsedMain().blocks.findIndex((x) => x.node.type === 'generatedBlock' && x.node.attrs?.id === b.id); setState({ view: 'editor', syncIndex: i >= 0 ? i : null }); }}>{b.label ?? b.id}</button>) : <span className="muted">—</span>}</td>
                                <td style={{ paddingRight: 20, color: 'var(--muted)', fontSize: 12, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.notes}>{t.notes ?? ''}</td>
                              </tr>
                            );
                          })),
                        ];
                      })}
                      {filtered.length === 0 && <tr><td colSpan={8} className="muted" style={{ padding: 20 }}>No tests match these filters.</td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
              {checkedTests.length > 0 && rec.results && (
                <div className="bulkbar" role="toolbar" aria-label="Selected tests">
                  <span style={{ fontWeight: 500 }}>{checkedTests.length} test{checkedTests.length > 1 ? 's' : ''} selected</span>
                  <span className="small" style={{ color: '#CFC9BF' }}>{[...new Set(checkedTests.flatMap((t) => t.outputs ?? []).filter((o) => o.endsWith('.csv')))].length} shared outputs</span>
                  <span className="spacer" />
                  {checkedTests.some((t) => t.status === 'failed' || t.status === 'warning') && <FindingsButton tests={checkedTests.filter((t) => t.status === 'failed' || t.status === 'warning')} />}
                  <button className="btn btn-sm btn-light" onClick={() => setState({ selectedTest: checkedTests[0].id })}>Insert into report…</button>
                </div>
              )}
            </>
          )}
        </main>

        <aside className="panel-right" style={{ width: 330 }} aria-label="Test detail">
          {!selected || !rec ? (
            <div className="sec"><div className="lbl">Test detail</div><div className="small muted">{rec ? 'Select a test to see its details, history and outputs, and to insert it into the report.' : 'Run the suite to see results.'}</div>
              {checkedTests.length > 0 && rec && <InsertPanel tests={checkedTests} run={rec} />}
            </div>
          ) : (
            <>
              <div className="sec">
                <div className="row"><StatusPill status={selected.status} />{selected.finishedAt && <span className="mono small muted">{new Date(selected.finishedAt).toLocaleTimeString()}</span>}</div>
                <div style={{ fontWeight: 600, fontSize: 15 }}>{selected.name}</div>
                <div className="tid">{selected.id}</div>
                {selected.notes && <div className="small">{selected.notes}</div>}
              </div>
              <div className="scroll" style={{ flex: 1 }}>
                <div className="sec">
                  <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '8px 12px', fontSize: 12.5 }}>
                    <div><dt className="small muted">{selected.metric ?? 'Value'}</dt><dd className="mono" style={{ margin: 0, fontWeight: 500, color: selected.status === 'failed' ? 'var(--fail-ink)' : undefined }}>{formatValue(selected.value, selected.metric)}</dd></div>
                    <div><dt className="small muted">Threshold</dt><dd className="mono" style={{ margin: 0 }}>{selected.threshold ?? '—'}</dd></div>
                    {Object.entries(selected.details ?? {}).slice(0, 10).map(([k, v]) => <div key={k}><dt className="small muted">{k.replace(/_/g, ' ')}</dt><dd className="mono" style={{ margin: 0 }}>{typeof v === 'number' ? formatValue(v, /rate|pd|dr|ci/i.test(k) ? 'rate' : undefined) : String(v)}</dd></div>)}
                  </dl>
                </div>
                <div className="sec"><span className="lbl">Value across runs</span><History id={selected.id} runs={history} /></div>
                <div className="sec">
                  <span className="lbl">Output files</span>
                  {(selected.outputs ?? []).length === 0 ? <div className="small muted">None recorded.</div> : (selected.outputs ?? []).map((o) => <button key={o} className="btn btn-q btn-xs mono" style={{ justifyContent: 'flex-start', color: 'var(--accent)' }} onClick={() => void api.revealInFolder(`${project.root}/runs/${rec.meta.number}/${o}`)}>{o}</button>)}
                  <div className="small muted">{usedBy(selected).length ? <>Used by {usedBy(selected).map((b) => b.label ?? b.id).join(', ')}.</> : 'Not used in the report yet.'}</div>
                </div>
                <InsertPanel tests={checkedTests.length > 1 && checked.has(selected.id) ? checkedTests : [selected]} run={rec} />
              </div>
            </>
          )}
        </aside>
      </div>
    </>
  );
}

void manifest;
