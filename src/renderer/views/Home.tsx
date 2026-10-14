import { useEffect, useState } from 'react';
import type { Engine, RecentProject, ReportType, UserTemplate } from '../../shared/types';
import { TEMPLATES, TEMPLATE_GROUPS, templateInfo, type TemplateInfo } from '../../shared/templateCatalog';
import { api, guard, openProject, setState, useStore, getState, runTests, promptText, toast } from '../store';
import { Dialog, TitleBar } from '../components/Chrome';
import { Folder, Search, Warn } from '../components/Icons';

const TYPE_LABEL = Object.fromEntries(TEMPLATES.map((t) => [t.type, t.short])) as Record<ReportType, string>;

type Start = { type: ReportType; userId?: undefined } | { userId: string; type?: undefined };

function Thumb({ t }: { t: TemplateInfo }) {
  return t.type === 'blank'
    ? <span className="tpl-thumb" style={{ background: 'var(--chrome)', border: '1px dashed #B9B1A5', display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted-2)' }}>.tex</span>
    : <span className={`tpl-thumb ${t.type === 'conference' ? 'two' : ''}`} aria-hidden="true"><span />{t.bars.map((h, i) => <span key={i} style={h > 2 ? { height: h, background: 'transparent', border: '1px solid #B9B1A5' } : undefined} />)}</span>;
}

function ago(iso?: string) {
  if (!iso) return '—';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 90) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return `${Math.round(d / 86400)} days ago`;
}

function status(r: RecentProject): { cls: string; text: string } {
  if (r.lastCompile && !r.lastCompile.ok) return { cls: 'fail', text: 'Compile failed' };
  if (r.lastRun?.counts.failed) return { cls: 'warn', text: 'Needs review' };
  if (!r.lastCompile) return { cls: 'run', text: 'Draft' };
  if (r.lastCompile.issues) return { cls: 'warn', text: `${r.lastCompile.issues} issue${r.lastCompile.issues > 1 ? 's' : ''}` };
  return { cls: 'pass', text: 'Ready to export' };
}

function nextAction(r: RecentProject): { title: string; detail: string; label: string; go: () => void } {
  const open = async (view: 'editor' | 'tests' | 'review', after?: () => void) => { await openProject(r.root); if (getState().project) { setState({ view }); after?.(); } };
  if (!r.lastRun && templateInfo(r.reportType).group === 'Model risk') return { title: 'Next: run the test suite', detail: 'Generated tables, figures and summaries fill in from the first run.', label: 'Open and run tests', go: () => void open('tests', () => void runTests()) };
  if (r.lastRun?.counts.failed) return { title: `Next: review ${r.lastRun.counts.failed} failing test${r.lastRun.counts.failed > 1 ? 's' : ''} from run #${r.lastRun.number}`, detail: 'Decide whether each failure becomes a finding before you compile.', label: 'Review failures', go: () => void open('tests') };
  if (!r.lastCompile) return { title: 'Next: compile the report', detail: 'Build the PDF and check references, citations and layout.', label: 'Open report', go: () => void open('editor') };
  if (r.lastCompile.issues) return { title: `Next: resolve ${r.lastCompile.issues} compile issue${r.lastCompile.issues > 1 ? 's' : ''}`, detail: 'Each issue links to its source line and suggests a fix.', label: 'Review PDF', go: () => void open('review') };
  return { title: 'Next: export the final PDF', detail: 'The last compile was clean.', label: 'Open PDF review', go: () => void open('review') };
}

function Stepper({ r }: { r: RecentProject }) {
  const run = r.lastRun;
  const steps = [
    { name: 'Template', text: TYPE_LABEL[r.reportType], c: 'var(--pass)', t: 't-pass' },
    { name: 'Test', text: run ? (run.counts.failed ? `${run.counts.failed} failed in #${run.number}` : `#${run.number} passed`) : 'Not run', c: run ? (run.counts.failed ? 'var(--warn)' : 'var(--pass)') : '#D9D4CB', t: run ? (run.counts.failed ? 't-warn' : 't-pass') : 'muted' },
    { name: 'Edit', text: 'In progress', c: 'var(--accent)', t: 't-run' },
    { name: 'Compile', text: r.lastCompile ? (r.lastCompile.ok ? (r.lastCompile.issues ? `${r.lastCompile.issues} issue${r.lastCompile.issues > 1 ? 's' : ''}` : 'Clean') : 'Failed') : 'Not yet', c: r.lastCompile ? (r.lastCompile.ok ? (r.lastCompile.issues ? 'var(--warn)' : 'var(--pass)') : 'var(--fail)') : '#D9D4CB', t: r.lastCompile ? (r.lastCompile.ok ? (r.lastCompile.issues ? 't-warn' : 't-pass') : 't-fail') : 'muted' },
    { name: 'Export', text: r.lastCompile?.ok && !r.lastCompile.issues ? 'Ready' : 'Not yet', c: '#D9D4CB', t: 'muted' },
  ];
  return (
    <ol className="stepper" aria-label="Report workflow">
      {steps.map((s) => <li key={s.name}><div className="bar" style={{ background: s.c }} /><span style={{ fontWeight: 500 }}>{s.name}</span><span className={`small ${s.t}`}>{s.text}</span></li>)}
    </ol>
  );
}

function NewProjectDialog({ start, userTemplates, onClose }: { start: Start; userTemplates: UserTemplate[]; onClose: () => void }) {
  const [choice, setChoice] = useState<string>(start.userId ? `user:${start.userId}` : `type:${start.type}`);
  const user = choice.startsWith('user:') ? userTemplates.find((u) => `user:${u.id}` === choice) ?? null : null;
  const reportType: ReportType = user ? user.baseType : (choice.slice(5) as ReportType);
  const info = templateInfo(reportType);
  const [name, setName] = useState(() => (start.type === 'blank' ? 'Untitled report' : `${start.userId ? userTemplates.find((u) => u.id === start.userId)?.name ?? 'Report' : templateInfo(start.type!).title} ${new Date().getFullYear()}`));
  const [parent, setParent] = useState('');
  const [modelId, setModelId] = useState('');
  const [owner, setOwner] = useState('');
  const [engine, setEngine] = useState<Engine>(user?.engine ?? 'pdflatex');
  const [suite, setSuite] = useState(user ? false : info.suite);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void api.defaultProjectsDir().then(setParent); }, []);
  useEffect(() => { setSuite(user ? false : info.suite); if (user?.engine) setEngine(user.engine); }, [choice]);
  const folder = name.trim().replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '-') || 'report';
  const create = async () => {
    setBusy(true);
    const p = await guard(() => api.createProject({ parentDir: parent, folderName: folder, name: name.trim(), reportType, modelId: modelId.trim() || undefined, owner: owner.trim() || undefined, includeSampleSuite: suite, engine, templateId: user?.id }), 'Could not create project');
    setBusy(false);
    if (p) { onClose(); await openProject(p.root); }
  };
  return (
    <Dialog title="New project" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-pri" disabled={busy || !name.trim() || !parent} onClick={create}>{busy ? 'Creating…' : 'Create project'}</button></>}>
      <label className="f">Title<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="f">Template<select className="field" value={choice} onChange={(e) => setChoice(e.target.value)}>
        {TEMPLATE_GROUPS.map((g) => <optgroup key={g} label={g}>{TEMPLATES.filter((t) => t.group === g).map((t) => <option key={t.type} value={`type:${t.type}`}>{t.title}</option>)}</optgroup>)}
        {userTemplates.length > 0 && <optgroup label="Your templates">{userTemplates.map((u) => <option key={u.id} value={`user:${u.id}`}>{u.name}</option>)}</optgroup>}
      </select></label>
      <div className="small muted" style={{ marginTop: -6 }}>{user ? (user.description || templateKinds(user)) : info.text}</div>
      <div className="row" style={{ gap: 12 }}>
        <label className="f grow">{info.group === 'Model risk' ? 'Owner' : 'Author'}<input className="field" value={owner} onChange={(e) => setOwner(e.target.value)} /></label>
        {info.group === 'Model risk' && <label className="f grow">Model ID<input className="field mono" value={modelId} placeholder="e.g. MRM-0417" onChange={(e) => setModelId(e.target.value)} /></label>}
      </div>
      <label className="f">LaTeX engine<select className="field" value={engine} onChange={(e) => setEngine(e.target.value as Engine)}><option value="pdflatex">pdfLaTeX (fastest, most compatible)</option><option value="lualatex">LuaLaTeX (system fonts, Unicode)</option><option value="xelatex">XeLaTeX</option></select></label>
      <div className="f">Location
        <div className="row"><input className="field mono" readOnly value={`${parent}${parent ? (api.platform === 'win32' ? '\\' : '/') : ''}${folder}`} /><button className="btn" onClick={async () => { const d = await api.chooseDirectory('Choose where to create the project'); if (d) setParent(d); }}>Change…</button></div>
      </div>
      <label className="chk"><input type="checkbox" checked={suite} onChange={(e) => setSuite(e.target.checked)} />Include the sample Python validation suite (stdlib only) as a starting point</label>
    </Dialog>
  );
}

function templateKinds(u: UserTemplate): string {
  return u.layout && u.style ? 'Layout and style' : u.layout ? 'Layout' : 'Style';
}

function UserTemplates({ list, onUse, onChange }: { list: UserTemplate[]; onUse: (id: string) => void; onChange: () => void }) {
  const importTex = async () => {
    const f = await api.chooseFile('Choose the main .tex file of a template (class and style files next to it are included)', [{ name: 'LaTeX', extensions: ['tex'] }]);
    if (!f) return;
    const base = f.split(/[\\/]/).pop()!.replace(/\.tex$/i, '');
    const name = await promptText('Import template', 'Template name', base);
    if (!name) return;
    const t = await guard(() => api.importTemplateFile(f, name), 'Could not import the template');
    if (t) { toast(`Saved “${t.name}” with ${Object.keys(t.files ?? {}).length} file${Object.keys(t.files ?? {}).length === 1 ? '' : 's'}.`, 'ok'); onChange(); }
  };
  const del = async (u: UserTemplate) => {
    if (!window.confirm(`Delete the template “${u.name}”? Projects made from it are not affected.`)) return;
    await guard(() => api.deleteTemplate(u.id), 'Could not delete the template');
    onChange();
  };
  return (
    <section className="col" style={{ gap: 10 }} aria-labelledby="utpl">
      <h2 id="utpl" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Your templates</h2>
      {list.length === 0 && <div className="small muted">Save any project as a template (File → Save as template), save a page style from Document setup, or import a journal’s .tex template.</div>}
      {list.map((u) => (
        <div key={u.id} className="tpl" style={{ cursor: 'default' }}>
          <button className="row grow" style={{ gap: 10, background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => onUse(u.id)}>
            <span className="tpl-thumb" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', fontFamily: 'var(--mono)', fontSize: 10, color: 'var(--muted-2)' }}>{u.layout ? '.tex' : 'Aa'}</span>
            <span className="col" style={{ gap: 2, minWidth: 0 }}><span style={{ fontWeight: 600 }}>{u.name}</span><span className="small muted ellipsis">{templateKinds(u)}{u.description ? ` · ${u.description}` : ''}</span></span>
          </button>
          <button className="btn btn-q btn-xs" aria-label={`Delete template ${u.name}`} title="Delete template" onClick={() => void del(u)}>✕</button>
        </div>
      ))}
      <div className="row wrap" style={{ gap: 6 }}>
        <button className="btn btn-sm" onClick={() => void importTex()}>Import .tex template…</button>
        <button className="btn btn-q btn-sm" onClick={() => void api.openTemplatesFolder()}>Open folder</button>
      </div>
    </section>
  );
}

function Toolchain() {
  const tc = useStore((s) => s.toolchain);
  if (!tc) return null;
  const items = [
    { k: 'LaTeX', ok: !!(tc.engines.pdflatex || tc.engines.lualatex), v: tc.latexmk ? 'latexmk' : tc.engines.pdflatex ? 'pdflatex (no latexmk)' : 'Not found' },
    { k: 'Python', ok: !!tc.python, v: tc.python ? 'Found' : 'Not found' },
    { k: 'SyncTeX', ok: !!tc.synctex, v: tc.synctex ? 'PDF ↔ source jumps' : 'Not found' },
    { k: 'Git', ok: !!tc.git, v: tc.git ? 'Commits recorded' : 'Optional' },
  ];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 10px', fontSize: 12, color: 'var(--muted)' }}>
      {items.map((i) => <div key={i.k} className="row" title={i.v}><span className="dot" style={{ background: i.ok ? 'var(--pass)' : i.k === 'Git' ? '#B9B1A5' : 'var(--fail)' }} />{i.k} · {i.v}</div>)}
      {!(tc.engines.pdflatex || tc.engines.lualatex) && <div className="small" style={{ color: 'var(--fail-ink)' }}>Install MiKTeX or TeX Live to compile PDFs.</div>}
    </div>
  );
}

export function Home() {
  const [recents, setRecents] = useState<RecentProject[] | null>(null);
  const [newType, setNewType] = useState<Start | null>(null);
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>([]);
  const loadTemplates = () => void api.listTemplates().then(setUserTemplates).catch(() => setUserTemplates([]));
  useEffect(loadTemplates, []);
  const [filter, setFilter] = useState<'all' | ReportType>('all');
  const [q, setQ] = useState('');
  const project = useStore((s) => s.project);
  useEffect(() => { void api.recents().then(setRecents); }, [project]);
  const openFolder = async () => {
    const d = await api.chooseDirectory('Open a Quire project or a folder of LaTeX files');
    if (d) await openProject(d);
  };
  const sample = async () => {
    const parent = await api.defaultProjectsDir();
    const p = await guard(() => api.createSampleProject(parent), 'Could not create the sample');
    if (p) await openProject(p.root);
  };
  const shown = (recents ?? []).filter((r) => (filter === 'all' || r.reportType === filter) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || (r.modelId ?? '').toLowerCase().includes(q.toLowerCase())));
  const top = recents?.[0];
  return (
    <>
      <TitleBar center={
        <label className="no-drag row" style={{ width: '100%', maxWidth: 440, height: 32, padding: '0 10px', border: '1px solid var(--rule)', borderRadius: 7, background: '#fff', color: 'var(--muted-3)' }}>
          <Search /><input aria-label="Search projects" placeholder="Search projects by name or model ID" value={q} onChange={(e) => setQ(e.target.value)} style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--ink)' }} />
        </label>
      } right={<><button className="btn no-drag" onClick={openFolder}><Folder />Open folder…</button><button className="btn btn-pri no-drag" onClick={() => setNewType({ type: 'validation' })}>New project</button></>} />
      <div className="body">
        <nav aria-label="Workspace" style={{ width: 232, padding: '16px 12px', display: 'flex', flexDirection: 'column', gap: 2, borderRight: '1px solid var(--rule)', background: 'var(--panel)' }}>
          <button className="nav active" aria-current="page">Home</button>
          <button className="nav" onClick={openFolder}>Open project…</button>
          <button className="nav" onClick={sample}>Open sample project</button>
          <div style={{ height: 1, background: 'var(--rule)', margin: '12px 4px' }} />
          <div className="lbl" style={{ padding: '4px 10px 8px' }}>This computer</div>
          <Toolchain />
          <div style={{ marginTop: 'auto', padding: 10, fontSize: 12, color: 'var(--muted-3)' }}>Quire 0.1 · <button className="btn btn-q btn-xs" onClick={() => void api.toolchain().then((tc) => setState({ toolchain: tc }))}>Re-check tools</button></div>
        </nav>
        <main className="home-main">
          <div className="home-grid">
            <div style={{ flex: '999 1 600px', minWidth: 0, display: 'flex', flexDirection: 'column', gap: 28 }}>
              {recents && recents.length === 0 && (
                <section className="empty" style={{ background: '#fff', padding: 28 }}>
                  <h3 style={{ fontSize: 18 }}>Start your first report</h3>
                  <div className="muted" style={{ maxWidth: 560 }}>Open the sample validation project to see the whole loop — a Python test suite, generated tables, and a compiled PDF — or start from a template.</div>
                  <div className="row" style={{ marginTop: 6 }}><button className="btn btn-pri" onClick={sample}>Open sample project</button><button className="btn" onClick={() => setNewType({ type: 'validation' })}>New from template</button></div>
                </section>
              )}
              {top && (() => {
                const st = status(top);
                const na = nextAction(top);
                return (
                  <section aria-labelledby="cont" className="col" style={{ gap: 12 }}>
                    <div className="row" style={{ alignItems: 'baseline', gap: 12 }}><h1 id="cont" style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Continue</h1><span className="muted">Last opened {ago(top.lastOpened)}</span></div>
                    <div className="card">
                      <div className="row wrap" style={{ padding: '18px 20px', gap: 16, alignItems: 'flex-start', borderBottom: '1px solid var(--rule-2)' }}>
                        <div className="grow" style={{ flex: '1 1 360px' }}>
                          <div className="row" style={{ marginBottom: 4 }}><span className={`st ${st.cls}`}>{st.cls === 'warn' && <Warn />}{st.text}</span><span className="small muted">{TYPE_LABEL[top.reportType]}</span></div>
                          <h2 style={{ margin: '0 0 4px', fontSize: 18, fontWeight: 600 }}>{top.name}</h2>
                          <div className="muted">{top.modelId && <><span className="mono small">{top.modelId}</span> · </>}<span className="mono small">{top.root}</span></div>
                        </div>
                        <button className="btn" onClick={() => void openProject(top.root)}>Open report</button>
                      </div>
                      <Stepper r={top} />
                      <dl style={{ margin: 0, padding: '16px 20px', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '16px 20px' }}>
                        <div><dt className="lbl" style={{ marginBottom: 4 }}>Latest test run</dt><dd style={{ margin: 0 }}>{top.lastRun ? <><b style={{ fontWeight: 600 }}>#{top.lastRun.number}</b> · {top.lastRun.counts.passed} / {top.lastRun.counts.total} passed<div className={`small ${top.lastRun.counts.failed ? 't-fail' : 'muted'}`}>{top.lastRun.counts.failed} failed · {top.lastRun.counts.warning} warnings</div></> : <span className="muted">None yet</span>}</dd></div>
                        <div><dt className="lbl" style={{ marginBottom: 4 }}>Last compile</dt><dd style={{ margin: 0 }}>{top.lastCompile ? <><b style={{ fontWeight: 600 }}>{new Date(top.lastCompile.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</b><div className={`small ${top.lastCompile.ok ? (top.lastCompile.issues ? 't-warn' : 't-pass') : 't-fail'}`}>{top.lastCompile.ok ? `Succeeded · ${top.lastCompile.issues} issue${top.lastCompile.issues === 1 ? '' : 's'}` : 'Failed'}</div></> : <span className="muted">Not compiled</span>}</dd></div>
                      </dl>
                      <div className="row wrap" style={{ padding: '14px 20px', background: 'var(--accent-bg)', borderTop: '1px solid #D7E0F1', gap: 12 }}>
                        <div className="grow" style={{ flex: '1 1 360px' }}><div style={{ fontWeight: 600, color: 'var(--accent-ink)' }}>{na.title}</div><div style={{ color: '#3B4F78', fontSize: 12.5 }}>{na.detail}</div></div>
                        <button className="btn btn-pri" onClick={na.go}>{na.label}</button>
                      </div>
                    </div>
                  </section>
                );
              })()}
              {recents && recents.length > 0 && (
                <section aria-labelledby="recent" className="col" style={{ gap: 12 }}>
                  <div className="row wrap" style={{ gap: 12 }}>
                    <h2 id="recent" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Recent projects</h2>
                    <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
                      {(['all', 'validation', 'monitoring', 'documentation'] as const).map((f) => <button key={f} className="btn btn-q" aria-pressed={filter === f} style={filter === f ? { background: '#E8E4DC' } : undefined} onClick={() => setFilter(f)}>{f === 'all' ? 'All' : TYPE_LABEL[f]}</button>)}
                    </div>
                  </div>
                  <div className="card" style={{ overflowX: 'auto' }}>
                    <table className="ptable">
                      <thead><tr><th scope="col" style={{ paddingLeft: 16 }}>Project</th><th scope="col">Report type</th><th scope="col">Status</th><th scope="col">Latest run</th><th scope="col">Last compile</th><th scope="col" style={{ textAlign: 'right', paddingRight: 16 }}>Opened</th></tr></thead>
                      <tbody>
                        {shown.map((r) => {
                          const st = status(r);
                          return (
                            <tr key={r.root} className="p" onClick={() => void openProject(r.root)} tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') void openProject(r.root); }}>
                              <td style={{ paddingLeft: 16 }}><div style={{ fontWeight: 500 }}>{r.name}</div><div className="mono" style={{ fontSize: 11.5, color: 'var(--muted-3)' }}>{r.modelId ?? r.root}</div></td>
                              <td>{TYPE_LABEL[r.reportType]}</td>
                              <td><span className={`st ${st.cls}`}>{st.text}</span></td>
                              <td>{r.lastRun ? <>#{r.lastRun.number} · {r.lastRun.counts.failed ? <span className="t-fail">{r.lastRun.counts.failed} failed</span> : 'all passed'}</> : '—'}</td>
                              <td>{r.lastCompile ? new Date(r.lastCompile.at).toLocaleDateString() : '—'}</td>
                              <td style={{ textAlign: 'right', paddingRight: 16, color: 'var(--muted-3)' }}>{ago(r.lastOpened)}</td>
                            </tr>
                          );
                        })}
                        {shown.length === 0 && <tr><td colSpan={6} className="muted" style={{ padding: 16 }}>No projects match.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </div>
            <aside style={{ flex: '1 1 300px', maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 28 }}>
              <section className="col" style={{ gap: 10 }} aria-labelledby="tpl">
                <h2 id="tpl" style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Start from a template</h2>
                {TEMPLATE_GROUPS.map((g) => (
                  <div key={g} className="col" style={{ gap: 8 }}>
                    <div className="lbl">{g}</div>
                    {TEMPLATES.filter((t) => t.group === g).map((t) => (
                      <button key={t.type} className="tpl" onClick={() => setNewType({ type: t.type })}>
                        <Thumb t={t} />
                        <span className="col" style={{ gap: 2 }}><span style={{ fontWeight: 600 }}>{t.title}</span><span className="small muted">{t.text}</span></span>
                      </button>
                    ))}
                  </div>
                ))}
              </section>
              <UserTemplates list={userTemplates} onUse={(id) => setNewType({ userId: id })} onChange={loadTemplates} />
              <section className="col" style={{ gap: 10 }}>
                <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>Sample project</h2>
                <div className="empty">
                  <div style={{ fontWeight: 500 }}>CORP-PD v4.2 Annual Validation</div>
                  <div className="small muted">A complete validation report wired to a stdlib-only Python suite: discrimination, calibration, stability, data quality and backtesting tests, with generated tables and a reliability diagram.</div>
                  <button className="btn" onClick={sample} style={{ marginTop: 4 }}>Create a copy in your projects folder</button>
                </div>
              </section>
            </aside>
          </div>
        </main>
      </div>
      {newType && <NewProjectDialog start={newType} userTemplates={userTemplates} onClose={() => setNewType(null)} />}
    </>
  );
}
