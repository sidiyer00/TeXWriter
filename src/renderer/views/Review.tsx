// PDF review: compiled preview, page navigation, linked diagnostics and export.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Diagnostic, SyncTexForward } from '../../shared/types';
import { allDiagnostics, api, compileNow, gotoSource, guard, mainFile, refreshBlock, renderAllBlocks, replaceKey, restoreBlock, setState, toast, updateBlockConfig, useStore, getState } from '../store';
import { BackButton, CompileButton, TitleBar } from '../components/Chrome';
import { Check, Download, Left, Right, Warn, X } from '../components/Icons';
import { loadPdf, pageLinks, renderPage, type PDFDocumentProxy, type PdfLink } from '../pdf';

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2];

function Thumb({ doc, n, active, badge, onClick }: { doc: PDFDocumentProxy; n: number; active: boolean; badge?: { count: number; err: boolean }; onClick: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [drawn, setDrawn] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting && !drawn) { setDrawn(true); void renderPage(doc, n, el, 0.13); } }, { rootMargin: '200px' });
    io.observe(el);
    return () => io.disconnect();
  }, [doc, n, drawn]);
  return (
    <button className={`thumb ${active ? 'active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined} aria-label={`Page ${n}${badge ? `, ${badge.count} issues` : ''}`}>
      <canvas ref={ref} width={80} height={104} style={{ width: 62, height: 80 }} />
      <span>{n}</span>
      {badge && <span className={`badge ${badge.err ? 'e' : ''}`}>{badge.count}</span>}
    </button>
  );
}

interface Mark { diag: Diagnostic; num: number; pos?: SyncTexForward }

function Page({ doc, n, scale, marks, onSelectMark, onDblClick, flash, onGoto }: { doc: PDFDocumentProxy; n: number; scale: number; marks: Mark[]; onSelectMark: (d: Diagnostic) => void; onDblClick: (n: number, x: number, y: number) => void; flash?: { y: number; nonce: number } | null; onGoto: (page: number, y?: number) => void }) {
  const [links, setLinks] = useState<PdfLink[]>([]);
  const ref = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [visible, setVisible] = useState(n <= 2);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void doc.getPage(n).then((p) => { const vp = p.getViewport({ scale }); setSize({ w: vp.width, h: vp.height }); });
  }, [doc, n, scale]);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const io = new IntersectionObserver((es) => { if (es[0].isIntersecting) setVisible(true); }, { rootMargin: '800px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => { if (visible && ref.current) void renderPage(doc, n, ref.current, scale); }, [doc, n, scale, visible]);
  useEffect(() => { if (visible) void pageLinks(doc, n, scale).then(setLinks).catch(() => setLinks([])); }, [doc, n, scale, visible]);
  return (
    <div ref={wrap} className="pdf-page" data-page={n} style={size ? { width: size.w, height: size.h } : { width: 612 * scale, height: 792 * scale }}
      onDoubleClick={(e) => { const r = (e.currentTarget as HTMLDivElement).getBoundingClientRect(); onDblClick(n, (e.clientX - r.left) / scale, (e.clientY - r.top) / scale); }}
      title="Double-click to jump to the source">
      <canvas ref={ref} />
      {links.map((l, i) => (
        <a key={i} className="pdf-link" href={l.url ?? '#'} style={{ left: l.rect[0], top: l.rect[1], width: l.rect[2], height: l.rect[3] }}
          title={l.url ? `${l.url} — click to open in your browser` : `Go to page ${l.page}`} aria-label={l.url ? `Link to ${l.url}` : `Go to page ${l.page}`}
          onDoubleClick={(e) => e.stopPropagation()}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (l.url) void api.openExternal(l.url); else if (l.page) onGoto(l.page, l.y); }} />
      ))}
      {marks.map((m) => (
        <button key={m.diag.id} className={`pdf-mark ${m.diag.severity === 'error' ? 'e' : ''}`} style={{ left: m.pos ? Math.min((m.pos.x + (m.pos.width ?? 0)) * scale + 6, (size?.w ?? 600) - 24) : (size?.w ?? 600) - 28, top: m.pos ? Math.max(4, (m.pos.y - (m.pos.height ?? 10)) * scale - 4) : 8 + (m.num - 1) * 24 }}
          onClick={(e) => { e.stopPropagation(); onSelectMark(m.diag); }} aria-label={`Issue ${m.num}: ${m.diag.message}`} title={m.diag.message}>{m.num}</button>
      ))}
      {flash && <div key={flash.nonce} className="pdf-hl" style={{ left: 40 * scale, right: 40 * scale, top: Math.max(0, flash.y * scale - 22 * scale), height: 28 * scale }} />}
    </div>
  );
}

function IssueActions({ d }: { d: Diagnostic }) {
  const project = useStore((s) => s.project)!;
  const blocks = project.manifest.blocks;
  const genFile = d.file?.startsWith('generated/') ? d.file.replace(/^generated\//, '').replace(/\.tex$/, '') : null;
  const acts: { label: string; pri?: boolean; run: () => void }[] = [];
  if (d.kind === 'undefined-reference' && d.key && d.suggestion) acts.push({ label: `Use ${d.suggestion}`, pri: true, run: () => replaceKey('ref', d.key!, d.suggestion!) });
  if (d.kind === 'undefined-citation' && d.key && d.suggestion) acts.push({ label: `Replace with ${d.suggestion}`, pri: true, run: () => replaceKey('cite', d.key!, d.suggestion!) });
  if (d.kind === 'undefined-citation' && d.key) acts.push({ label: 'Add entry…', run: async () => {
    const bib = project.files.find((f) => f.kind === 'bib')?.path ?? 'references.bib';
    const cur = await api.readText(project.root, bib).catch(() => '');
    await api.writeText(project.root, bib, `${cur.replace(/\s*$/, '')}\n\n@misc{${d.key},\n  author = {},\n  title  = {},\n  year   = {}\n}\n`);
    gotoSource(bib, cur.split('\n').length + 2);
  } });
  if (d.kind === 'overfull' && genFile && blocks[genFile]) acts.push({ label: 'Shrink table to text width', pri: true, run: () => void updateBlockConfig(genFile, { fitWidth: true }).then(() => toast('Table set to fit the text width. Recompile to check.', 'ok')) });
  if (d.kind === 'stale-block' && d.blockId) acts.push({ label: 'Refresh from latest run', pri: true, run: () => void refreshBlock(d.blockId!).then(() => renderAllBlocks()) });
  if (d.kind === 'block-conflict' && d.blockId) acts.push({ label: 'Restore generated', run: () => void restoreBlock(d.blockId!) });
  if (d.kind === 'missing-file' && d.key && /\.(sty|cls)$/.test(d.key)) acts.push({ label: 'How to install', run: () => toast(`Install the package that provides ${d.key} with the MiKTeX Console (Packages) or tlmgr install, then recompile.`) });
  if (d.line) acts.push({ label: 'Go to source', run: () => gotoSource(d.file ?? mainFile(), d.line) });
  if (!acts.length) return null;
  return <div className="row wrap" style={{ gap: 6 }}>{acts.map((a) => <button key={a.label} className={`btn btn-sm ${a.pri ? 'btn-pri' : ''}`} onClick={(e) => { e.stopPropagation(); a.run(); }}>{a.label}</button>)}</div>;
}

export function ReviewScreen() {
  const project = useStore((s) => s.project)!;
  const lastCompile = useStore((s) => s.lastCompile);
  const pdfVersion = useStore((s) => s.pdfVersion);
  const compiling = useStore((s) => s.compiling);
  const pdfJump = useStore((s) => s.pdfJump);
  const selIssue = useStore((s) => s.reviewIssue);
  useStore((s) => s.renders);
  useStore((s) => s.labels);
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [tab, setTab] = useState<'issues' | 'log' | 'export'>('issues');
  const [marks, setMarks] = useState<Mark[]>([]);
  const [flash, setFlash] = useState<{ page: number; y: number; nonce: number } | null>(null);
  const [log, setLog] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const diags = allDiagnostics();
  const numbered = diags.map((d, i) => ({ d, num: i + 1 }));

  useEffect(() => {
    let cancelled = false;
    setErr(null);
    const rel = `.quire/build/${project.manifest.mainFile.replace(/\.tex$/, '.pdf')}`;
    api.readBinary(project.root, rel).then(loadPdf).then((d) => { if (!cancelled) setDoc(d); }).catch(() => { if (!cancelled) { setDoc(null); setErr('No PDF yet'); } });
    return () => { cancelled = true; };
  }, [pdfVersion, project.root]);

  useEffect(() => { void api.readText(project.root, `.quire/build/${project.manifest.mainFile.replace(/\.tex$/, '.log')}`).then(setLog).catch(() => setLog(lastCompile?.log ?? '')); }, [pdfVersion, lastCompile]);

  // locate diagnostics on pages via SyncTeX
  useEffect(() => {
    if (!doc) return;
    let cancelled = false;
    void (async () => {
      const out: Mark[] = [];
      for (const { d, num } of numbered) {
        if (!d.page && !d.line) continue;
        let pos: SyncTexForward | null = null;
        if (d.line) pos = await api.synctexView(project.root, d.file ?? mainFile(), d.line).catch(() => null);
        if (pos || d.page) out.push({ diag: d, num, pos: pos ?? undefined });
      }
      if (!cancelled) setMarks(out);
    })();
    return () => { cancelled = true; };
  }, [doc, diags.length]);

  const pageOf = (m: Mark) => m.pos?.page ?? m.diag.page ?? 0;

  const scrollToPage = useCallback((n: number, y?: number) => {
    const el = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
    if (!el || !scroller.current) return;
    scroller.current.scrollTo({ top: el.offsetTop - 24 + (y ? Math.max(0, y * zoom - 160) : 0), behavior: 'smooth' });
    setPage(n);
  }, [zoom]);

  useEffect(() => { if (pdfJump && doc) { setTimeout(() => scrollToPage(pdfJump.page, pdfJump.y), 60); if (pdfJump.y) setFlash({ page: pdfJump.page, y: pdfJump.y, nonce: pdfJump.nonce }); } }, [pdfJump?.nonce, doc]);

  const onScroll = () => {
    const sc = scroller.current;
    if (!sc) return;
    const pages = [...sc.querySelectorAll<HTMLElement>('[data-page]')];
    const mid = sc.scrollTop + sc.clientHeight / 3;
    const cur = pages.find((p) => p.offsetTop + p.offsetHeight > mid);
    if (cur) setPage(Number(cur.dataset.page));
  };

  const selectIssue = (d: Diagnostic) => {
    setState({ reviewIssue: d.id });
    const m = marks.find((x) => x.diag.id === d.id);
    const p = m ? pageOf(m) : d.page;
    if (p) { scrollToPage(p, m?.pos?.y); if (m?.pos) setFlash({ page: p, y: m.pos.y, nonce: Date.now() }); }
  };

  const onDbl = async (n: number, x: number, y: number) => {
    const r = await guard(() => api.synctexEdit(project.root, n, x, y));
    if (r) gotoSource(r.file, r.line);
    else toast('SyncTeX could not map this point to the source. Is synctex installed?', 'err');
  };

  const errs = diags.filter((d) => d.severity === 'error').length;
  const pages = doc?.numPages ?? 0;
  const badgeFor = (n: number) => {
    const ms = marks.filter((m) => pageOf(m) === n);
    return ms.length ? { count: ms.length, err: ms.some((m) => m.diag.severity === 'error') } : undefined;
  };
  const exp = async (kind: 'pdf' | 'zip' | 'prov') => {
    const fn = kind === 'pdf' ? api.exportPdf : kind === 'zip' ? api.exportBundle : api.exportProvenance;
    const out = await guard(() => fn(project.root), 'Export failed');
    if (out) toast(`Saved ${out}`, 'ok', { label: 'Show in folder', run: () => void api.revealInFolder(out) });
  };

  return (
    <>
      <TitleBar crumb="PDF" center={<BackButton label="Back to editor" />} right={<>
        {lastCompile && !compiling && (lastCompile.ok
          ? <span className={`st ${diags.length ? 'warn' : 'pass'} no-drag`}>{diags.length ? <Warn /> : <Check />}{diags.length ? `Compiled · ${diags.length} issue${diags.length > 1 ? 's' : ''}` : 'Compiled cleanly'}</span>
          : <span className="st fail no-drag"><X />Compile failed</span>)}
        <CompileButton />
        <button className="btn no-drag" disabled={!doc} onClick={() => void exp('pdf')}><Download />Export PDF</button>
      </>} />
      <div className="body">
        <nav className="thumbs" aria-label="Pages">
          {doc && Array.from({ length: pages }, (_, i) => i + 1).map((n) => <Thumb key={`${pdfVersion}-${n}`} doc={doc} n={n} active={n === page} badge={badgeFor(n)} onClick={() => scrollToPage(n)} />)}
        </nav>
        <section className="main" aria-label="PDF preview">
          <div className="toolbar" role="toolbar" aria-label="Viewer">
            <button className="btn btn-q ib" aria-label="Previous page" disabled={page <= 1} onClick={() => scrollToPage(page - 1)}><Left /></button>
            <label className="row small">Page <input className="field" aria-label="Page number" value={page} style={{ width: 48, textAlign: 'center', height: 28 }} onChange={(e) => { const n = Number(e.target.value); if (n >= 1 && n <= pages) scrollToPage(n); }} /> of {pages || '—'}</label>
            <button className="btn btn-q ib" aria-label="Next page" disabled={page >= pages} onClick={() => scrollToPage(page + 1)}><Right /></button>
            <span className="vsep" />
            <button className="btn btn-q ib" aria-label="Zoom out" onClick={() => setZoom(ZOOMS[Math.max(0, ZOOMS.indexOf(zoom) - 1)] ?? zoom)}>−</button>
            <select className="field" aria-label="Zoom" style={{ width: 84, height: 28 }} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>{ZOOMS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}</select>
            <button className="btn btn-q ib" aria-label="Zoom in" onClick={() => setZoom(ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + 1)] ?? zoom)}>+</button>
            <span className="spacer" />
            <span className="small muted">Double-click the page to jump to its source</span>
            <button className="btn btn-sm" onClick={() => void onDbl(page, 100, 120)}>Edit page {page}</button>
          </div>
          <div className="pdf-wrap" ref={scroller} onScroll={onScroll}>
            {compiling && !doc && <div className="empty" style={{ maxWidth: 480, margin: '40px auto', background: '#fff' }}><h3>Compiling…</h3><div className="progress indet"><div /></div></div>}
            {!doc && !compiling && (
              <div className="empty" style={{ maxWidth: 520, margin: '40px auto', background: '#fff' }}>
                <h3>{lastCompile && !lastCompile.ok ? 'The last compile did not produce a PDF' : 'No PDF yet'}</h3>
                <div className="small muted">{lastCompile && !lastCompile.ok ? 'Fix the errors listed on the right, then compile again.' : 'Compile the report to preview it here.'}</div>
                <button className="btn btn-pri" onClick={() => void compileNow()}>Compile now</button>
                {err && false}
              </div>
            )}
            {doc && (
              <div className="pdf-pages">
                {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                  <Page key={`${pdfVersion}-${n}`} doc={doc} n={n} scale={zoom} marks={marks.filter((m) => pageOf(m) === n)} onSelectMark={selectIssue} onDblClick={onDbl} flash={flash && flash.page === n ? flash : null} onGoto={(p, y) => { scrollToPage(p, y); if (y) setFlash({ page: p, y, nonce: Date.now() }); }} />
                ))}
              </div>
            )}
          </div>
        </section>
        <aside className="panel-right" style={{ width: 360 }} aria-label="Compile diagnostics">
          <div className="tabs" role="tablist">
            <button className="tab" role="tab" aria-selected={tab === 'issues'} onClick={() => setTab('issues')}>Issues <span className={errs ? 't-fail' : diags.length ? 't-warn' : ''}>{diags.length}</span></button>
            <button className="tab" role="tab" aria-selected={tab === 'log'} onClick={() => setTab('log')}>Compile log</button>
            <button className="tab" role="tab" aria-selected={tab === 'export'} onClick={() => setTab('export')}>Export</button>
          </div>
          <div className="scroll" style={{ flex: 1 }}>
            {tab === 'issues' && (
              <>
                <div className="sec" style={{ background: '#fff' }}>
                  {lastCompile ? (
                    <>
                      <div className="row">{lastCompile.ok ? <Check size={14} strokeWidth={2.6} style={{ color: 'var(--pass)' }} /> : <X size={14} strokeWidth={2.6} style={{ color: 'var(--fail)' }} />}<b style={{ fontWeight: 600 }}>{lastCompile.ok ? `PDF built · ${lastCompile.pages ?? '?'} pages` : 'Compile failed'}</b><span className="spacer" /><span className="small muted">{new Date(lastCompile.startedAt).toLocaleTimeString()}</span></div>
                      <div className="small muted">{lastCompile.passes.length ? `${[...new Set(lastCompile.passes)].join(' → ')} · ` : ''}{(lastCompile.durationMs / 1000).toFixed(1)} s · {errs} errors · {diags.filter((d) => d.severity === 'warning').length} warnings · {diags.filter((d) => d.severity === 'notice').length} notices{lastCompile.usedFallback ? ' · without latexmk' : ''}</div>
                      {!lastCompile.ok && lastCompile.pdfPath && <div className="small" style={{ padding: '7px 9px', borderRadius: 6, background: '#F8F6F2', color: 'var(--muted)' }}>Showing the last PDF that was produced.</div>}
                    </>
                  ) : <div className="small muted">Not compiled yet. Press Compile (Ctrl+Enter).</div>}
                </div>
                {numbered.length === 0 && lastCompile && <div className="sec"><div className="row t-pass"><Check />No issues. Ready to export.</div></div>}
                {numbered.map(({ d, num }) => (
                  <div key={d.id} className={`issue ${selIssue === d.id ? 'sel' : ''} ${d.severity === 'error' ? 'e' : ''}`} onClick={() => selectIssue(d)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') selectIssue(d); }}>
                    <div className="row"><span className={`badge ${d.severity === 'error' ? 'e' : d.severity === 'notice' ? 'n' : ''}`}>{num}</span><b style={{ fontWeight: 600 }}>{d.message}</b><span className="spacer" />{(d.page || marks.find((m) => m.diag.id === d.id)?.pos?.page) && <span className="small muted">p. {marks.find((m) => m.diag.id === d.id)?.pos?.page ?? d.page}</span>}</div>
                    {d.detail && <div className="small mono" style={{ color: 'var(--ink-2)', overflowWrap: 'anywhere' }}>{d.detail}</div>}
                    {d.suggestion && <div className="small">Closest match: <span className="mono">{d.suggestion}</span></div>}
                    {d.file && <div className="small mono muted">{d.file}{d.line ? `:${d.line}` : ''}</div>}
                    <IssueActions d={d} />
                  </div>
                ))}
              </>
            )}
            {tab === 'log' && <div className="sec"><pre className="logbox" style={{ maxHeight: 'none', margin: 0 }}>{(log || lastCompile?.log || 'No log.').slice(-60000)}</pre></div>}
            {tab === 'export' && (
              <div className="sec">
                <div className="lbl">Export</div>
                {diags.some((d) => d.kind === 'undefined-reference' || d.kind === 'undefined-citation') && <div className="small t-warn">Unresolved references will print as “??” unless fixed.</div>}
                {diags.some((d) => d.kind === 'stale-block') && <div className="small t-warn">Some generated content is from an older run.</div>}
                <button className="btn btn-pri" disabled={!doc} onClick={() => void exp('pdf')}><Download />Export PDF{pages ? ` · ${pages} pages` : ''}</button>
                <button className="btn" onClick={() => void exp('zip')}>Source bundle (.zip)</button>
                <div className="small muted">Report sources, bibliography, figures, generated tables, the runs they came from, the PDF and a PROVENANCE.json manifest.</div>
                <button className="btn" onClick={() => void exp('prov')}>Provenance (.json)</button>
                <div className="small muted">Test runs, commits and SHA-256 hashes of every source behind the PDF.</div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </>
  );
}

void getState;
