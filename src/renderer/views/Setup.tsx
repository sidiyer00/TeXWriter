// Document setup: theme, page layout, typography, colour, compiler and tests.
import { useEffect, useMemo, useState } from 'react';
import type { Engine, ProjectManifest, ThemeSettings } from '../../shared/types';
import { FONT_LABELS, PRESETS, themeBlock } from '../../shared/latex/theme';
import { api, applyTheme, compileNow, guard, promptText, saveManifest, setState, toast, useStore, gotoSource } from '../store';
import type { UserTemplate } from '../../shared/types';
import { academicFormatInfo } from '../../shared/templateCatalog';
import { TitleBar } from '../components/Chrome';

const PREVIEW_FONT: Record<ThemeSettings['bodyFont'], string> = {
  lmodern: "'Latin Modern Roman', 'CMU Serif', Georgia, serif",
  pagella: "'TeX Gyre Pagella', 'Palatino Linotype', 'Book Antiqua', Palatino, serif",
  termes: "'TeX Gyre Termes', 'Times New Roman', Times, serif",
  libertinus: "'Libertinus Serif', 'Linux Libertine O', Georgia, serif",
  sourceserif: "'Source Serif 4', Georgia, serif",
};

function toIn(v: string): number {
  const m = /^([\d.]+)\s*(in|cm|mm|pt)?$/.exec(v.trim());
  if (!m) return 1;
  const n = Number(m[1]);
  return m[2] === 'cm' ? n / 2.54 : m[2] === 'mm' ? n / 25.4 : m[2] === 'pt' ? n / 72.27 : n;
}

function MiniPage({ t, side, name }: { t: ThemeSettings; side: 'verso' | 'recto'; name: string }) {
  const W = 200;
  const pw = t.paper === 'a4' ? 8.27 : 8.5, ph = t.paper === 'a4' ? 11.69 : 11;
  const [w, h] = t.landscape ? [ph, pw] : [pw, ph];
  const k = W / w;
  const inner = toIn(t.margins.inner) * k, outer = toIn(t.margins.outer) * k;
  const left = t.twoSide && side === 'verso' ? outer : inner;
  const right = t.twoSide && side === 'verso' ? inner : outer;
  const fs = (t.fontSize / 72) * k;
  const lh = fs * 1.2 * t.lineSpread;
  return (
    <div className="mini-page" aria-hidden="true" style={{ width: W, height: h * k, padding: `${toIn(t.margins.top) * k}px ${right}px ${toIn(t.margins.bottom) * k}px ${left}px`, fontFamily: PREVIEW_FONT[t.bodyFont], color: `#${t.textColor}` }}>
      <div style={{ position: 'absolute', top: toIn(t.margins.top) * k, bottom: toIn(t.margins.bottom) * k, left, right, border: '1px dashed rgba(45,91,185,.55)' }} />
      <div style={{ position: 'absolute', top: toIn(t.margins.top) * k - 9, left, right, display: 'flex', justifyContent: 'space-between', fontFamily: 'var(--ui)', fontSize: 3.6, textTransform: 'uppercase', color: '#68635B', borderBottom: '0.4px solid #CFC9BF' }}><span>{t.headerLeft || name}</span><span>{t.headerRight}</span></div>
      <div style={{ fontSize: fs * 1.25, fontWeight: 600, fontFamily: t.headingFont === 'sans' ? 'var(--ui)' : undefined, margin: `${lh * 0.3}px 0 ${lh * 0.4}px` }}>{side === 'verso' ? '5.2  Calibration' : '5.3  Stability'}</div>
      <div style={{ fontSize: fs, lineHeight: `${lh}px`, textAlign: 'justify', hyphens: 'auto' }}>
        Calibration was assessed at the rating-grade level by comparing the long-run average predicted PD with observed one-year default rates over the observation window. <span style={{ color: `#${t.linkColor}` }}>Table 5.3</span> reports grade-level results.
      </div>
      <div style={{ margin: `${t.parSkip ? lh * 0.6 : 0}px 0 0`, textIndent: t.parSkip ? 0 : fs * 1.5, fontSize: fs, lineHeight: `${lh}px` }}>Grade 7 under-predicts observed defaults; the remaining grades are within tolerance.</div>
      <div style={{ marginTop: lh * 0.6, borderTop: '0.8px solid #1A1917', borderBottom: '0.8px solid #1A1917', padding: '2px 0', display: 'flex', flexDirection: 'column', gap: 2 }}>
        {[0, 1, 2, 3, 4].map((i) => <span key={i} style={{ height: 2.4, background: i === 3 ? `#${t.tableShade}` : '#D9D4CB' }} />)}
      </div>
      <div style={{ marginTop: lh * 0.6, padding: 3, border: '0.5px solid #D9D2C6', background: `#${t.calloutFill}`, fontSize: fs * 0.85 }}>FINDING F-02 · Grade 7 recalibration</div>
      <div style={{ position: 'absolute', bottom: toIn(t.margins.bottom) * k - 10, left: 0, right: 0, textAlign: 'center', fontFamily: 'var(--ui)', fontSize: 4 }}>{side === 'verso' ? 17 : 18}</div>
    </div>
  );
}

export function SetupScreen() {
  const project = useStore((s) => s.project)!;
  const [t, setT] = useState<ThemeSettings>(project.manifest.theme);
  const tc = useStore((s) => s.toolchain);
  const [m, setM] = useState<ProjectManifest>(project.manifest);
  useEffect(() => { setT(project.manifest.theme); setM(project.manifest); }, [project.root]);
  const [styles, setStyles] = useState<UserTemplate[]>([]);
  const loadStyles = () => void api.listTemplates().then((l) => setStyles(l.filter((x) => x.style && x.theme))).catch(() => setStyles([]));
  useEffect(loadStyles, []);
  const saveStyle = async () => {
    const name = await promptText('Save style', 'Name for this style (page, fonts, spacing, colours, running heads)', `${project.manifest.name} style`);
    if (!name?.trim()) return;
    const saved = await guard(() => api.saveTemplate({ name: name.trim(), description: `${FONT_LABELS[t.bodyFont]} · ${t.fontSize} pt · ${t.paper === 'a4' ? 'A4' : 'Letter'}`, layout: false, style: true, baseType: project.manifest.reportType, theme: t }), 'Could not save the style');
    if (saved) { toast(`Saved style “${saved.name}”. It is offered here and when creating projects.`, 'ok'); loadStyles(); }
  };
  const useStyle = (u: UserTemplate) => setT((x) => ({ ...x, ...u.theme!, margins: { ...x.margins, ...u.theme!.margins }, headerLeft: x.headerLeft, preset: 'custom' }));
  const base = project.manifest.theme;
  const changed = useMemo(() => {
    const out: string[] = [];
    for (const k of Object.keys(t) as (keyof ThemeSettings)[]) if (JSON.stringify(t[k]) !== JSON.stringify(base[k])) out.push(k);
    return out;
  }, [t, base]);
  const projChanged = m.engine !== project.manifest.engine || m.name !== project.manifest.name || JSON.stringify(m.generators) !== JSON.stringify(project.manifest.generators);
  const up = (p: Partial<ThemeSettings>) => setT((x) => ({ ...x, ...p, preset: p.preset ?? 'custom' }));
  const upM = (p: Partial<ThemeSettings['margins']>) => setT((x) => ({ ...x, margins: { ...x.margins, ...p }, preset: 'custom' }));
  const apply = async () => {
    if (projChanged) await saveManifest({ ...project.manifest, ...m, theme: t, blocks: project.manifest.blocks });
    await applyTheme(t);
    setState({ view: 'editor' });
    void compileNow();
  };
  const ch = (k: keyof ThemeSettings) => changed.includes(k) ? <span className="changed">changed</span> : null;
  return (
    <>
      <TitleBar crumb="Document setup" right={<>
        <span className="savestate no-drag">{changed.length + (projChanged ? 1 : 0) ? <><span className="dot" style={{ background: 'var(--warn)' }} />{changed.length + (projChanged ? 1 : 0)} change{changed.length + (projChanged ? 1 : 0) > 1 ? 's' : ''} not applied</> : 'No changes'}</span>
        <button className="btn btn-q no-drag" onClick={() => setT({ ...base, ...PRESETS.classic, margins: { ...PRESETS.classic.margins! } })}>Reset to template</button>
        <button className="btn no-drag" onClick={() => setState({ view: 'editor' })}>Cancel</button>
        <button className="btn btn-pri no-drag" disabled={!changed.length && !projChanged} onClick={() => void apply()}>Apply and recompile</button>
      </>} />
      <div className="body">
        <nav aria-label="Setup sections" style={{ width: 212, padding: '16px 10px', display: 'flex', flexDirection: 'column', gap: 2, background: 'var(--panel)', borderRight: '1px solid var(--rule)' }}>
          {(t.classLayout ? [['theme', 'Layout'], ['compiler', 'Compiler'], ['generated', 'Generated content'], ['pre', 'Managed preamble']] : [['theme', 'Theme'], ['page', 'Page layout'], ['type', 'Typography'], ['color', 'Colour'], ['header', 'Headers and footers'], ['compiler', 'Compiler'], ['generated', 'Generated content'], ['pre', 'Generated preamble']]).map(([id, l]) => (
            <button key={id} className="nav" onClick={() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })}>{l}</button>
          ))}
        </nav>
        <main className="setup-main">
          {t.classLayout ? (
            <section className="sgrp" id="theme">
              <h2>Layout</h2>
              <div className="small">This paper uses the <b>{academicFormatInfo(project.manifest.academicFormat).cls}</b> class ({academicFormatInfo(project.manifest.academicFormat).title}). The publisher's class sets the page size, margins, fonts, columns and headings, so they are not changed here: submissions must keep the class's layout. Class options (e.g. <span className="mono">[conference]</span>, <span className="mono">[review]</span>) can be edited on the first line of {project.manifest.mainFile}.</div>
            </section>
          ) : <>
          <section className="sgrp" id="theme">
            <div className="row" style={{ justifyContent: 'space-between' }}><div><h2>Theme</h2><div className="small muted">A starting point for the settings below.</div></div><button className="btn btn-sm" onClick={() => void saveStyle()}>Save as style…</button></div>
            <div role="group" aria-label="Theme preset" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              {(['classic', 'editorial', 'compact'] as const).map((p) => (
                <button key={p} className="pcard" aria-pressed={t.preset === p} onClick={() => setT((x) => ({ ...x, ...PRESETS[p], margins: { ...PRESETS[p].margins! } }))}>
                  <span style={{ fontFamily: p === 'editorial' ? 'var(--ui)' : PREVIEW_FONT[PRESETS[p].bodyFont!], fontSize: 20, fontWeight: 600, lineHeight: 1 }}>Aa</span>
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>{{ classic: 'Regulatory classic', editorial: 'Modern editorial', compact: 'Compact appendix' }[p]}</span>
                  <span className="small muted">{{ classic: 'Pagella · 11 pt · 1 in margins', editorial: 'Libertinus · sans headings · wide margins', compact: 'Termes · 10 pt · dense' }[p]}</span>
                </button>
              ))}
            </div>
            {styles.length > 0 && (
              <div className="col" style={{ gap: 6 }}>
                <span className="lbl">Your styles</span>
                <div role="group" aria-label="Saved styles" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
                  {styles.map((u) => (
                    <button key={u.id} className="pcard" onClick={() => useStyle(u)} title={u.description}>
                      <span style={{ fontFamily: PREVIEW_FONT[u.theme!.bodyFont], fontSize: 20, fontWeight: 600, lineHeight: 1 }}>Aa</span>
                      <span style={{ fontWeight: 600, fontSize: 12.5 }}>{u.name}</span>
                      <span className="small muted">{FONT_LABELS[u.theme!.bodyFont]} · {u.theme!.fontSize} pt · {u.theme!.lineSpread.toFixed(2)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="sgrp" id="page">
            <h2>Page layout</h2>
            <div className="row wrap" style={{ gap: 18 }}>
              <div className="f">Paper size {ch('paper')}<div className="seg" role="group" aria-label="Paper size">{(['letter', 'a4'] as const).map((p) => <button key={p} aria-pressed={t.paper === p} onClick={() => up({ paper: p })}>{p === 'a4' ? 'A4' : 'Letter'}</button>)}</div></div>
              <div className="f">Orientation {ch('landscape')}<div className="seg" role="group" aria-label="Orientation"><button aria-pressed={!t.landscape} onClick={() => up({ landscape: false })}>Portrait</button><button aria-pressed={t.landscape} onClick={() => up({ landscape: true })}>Landscape</button></div></div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10, maxWidth: 420 }}>
              {(['top', 'bottom', 'inner', 'outer'] as const).map((k) => (
                <label key={k} className="f">{t.twoSide ? { top: 'Top', bottom: 'Bottom', inner: 'Inside', outer: 'Outside' }[k] : { top: 'Top', bottom: 'Bottom', inner: 'Left', outer: 'Right' }[k]} {t.margins[k] !== base.margins[k] && <span className="changed">changed</span>}
                  <input className="field mono" value={t.margins[k]} onChange={(e) => upM({ [k]: e.target.value })} /></label>
              ))}
            </div>
            <label className="chk"><input type="checkbox" checked={t.twoSide} onChange={(e) => up({ twoSide: e.target.checked })} />Two-sided (mirror inside and outside margins for binding)</label>
          </section>
          <section className="sgrp" id="type">
            <h2>Typography</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label className="f">Body font {ch('bodyFont')}<select className="field" value={t.bodyFont} onChange={(e) => up({ bodyFont: e.target.value as ThemeSettings['bodyFont'] })}>{Object.entries(FONT_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
              <div className="f">Body size {ch('fontSize')}<div className="seg" role="group" aria-label="Body size">{([10, 11, 12] as const).map((s) => <button key={s} aria-pressed={t.fontSize === s} onClick={() => up({ fontSize: s })}>{s} pt</button>)}</div></div>
              <label className="f">Headings {ch('headingFont')}<select className="field" value={t.headingFont} onChange={(e) => up({ headingFont: e.target.value as 'body' | 'sans' })}><option value="body">Same as body, bold</option><option value="sans">Helvetica-style sans</option></select></label>
              <label className="f">Line spacing {ch('lineSpread')}<select className="field" value={t.lineSpread} onChange={(e) => up({ lineSpread: Number(e.target.value) })}>{[1.0, 1.05, 1.1, 1.2, 1.3, 1.5, 1.6].map((v) => <option key={v} value={v}>{v.toFixed(2)}{v === 1.3 ? ' (≈ one and a half)' : v === 1.6 ? ' (≈ double)' : ''}</option>)}</select></label>
            </div>
            <div className="f">Paragraphs {ch('parSkip')}<div className="seg" role="group" aria-label="Paragraph separation"><button aria-pressed={!t.parSkip} onClick={() => up({ parSkip: false })}>Indent first line</button><button aria-pressed={t.parSkip} onClick={() => up({ parSkip: true })}>Space between</button></div></div>
            <div className="small muted">Fonts come from your TeX distribution (MiKTeX installs missing ones on first use).</div>
          </section>
          <section className="sgrp" id="color">
            <h2>Colour</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              {([['textColor', 'Text'], ['linkColor', 'Links and cross-references'], ['tableShade', 'Table emphasis shade'], ['calloutFill', 'Callout fill']] as const).map(([k, l]) => (
                <label key={k} className="row" style={{ gap: 10 }}>
                  <input type="color" className="sw" aria-label={`${l} colour`} value={`#${t[k]}`} onChange={(e) => up({ [k]: e.target.value.slice(1).toUpperCase() } as Partial<ThemeSettings>)} />
                  <span className="f grow">{l} {ch(k)}<input className="field mono" value={t[k]} onChange={(e) => up({ [k]: e.target.value.replace(/[^0-9a-f]/gi, '').slice(0, 6).toUpperCase() } as Partial<ThemeSettings>)} /></span>
                </label>
              ))}
            </div>
            <label className="chk"><input type="checkbox" checked={t.printLinksBlack} onChange={(e) => up({ printLinksBlack: e.target.checked })} />Print links in the text colour</label>
          </section>
          <section className="sgrp" id="header">
            <h2>Headers and footers</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
              <label className="f">Running head, left {ch('headerLeft')}<input className="field" value={t.headerLeft} onChange={(e) => up({ headerLeft: e.target.value })} /></label>
              <label className="f">Running head, right {ch('headerRight')}<input className="field" value={t.headerRight} onChange={(e) => up({ headerRight: e.target.value })} /></label>
            </div>
            <div className="small muted">Page numbers print centred in the footer.</div>
          </section>
          </>}
          <section className="sgrp" id="compiler">
            <h2>Compiler</h2>
            <label className="f">Project name<input className="field" value={m.name} onChange={(e) => setM({ ...m, name: e.target.value })} /></label>
            <label className="f">LaTeX engine<select className="field" value={m.engine} onChange={(e) => setM({ ...m, engine: e.target.value as Engine })}><option value="pdflatex">pdfLaTeX</option><option value="lualatex">LuaLaTeX</option><option value="xelatex">XeLaTeX</option></select></label>
          </section>
          <section className="sgrp" id="generated">
            <div><h2>Generated content</h2><div className="small muted">Tables and figures built by scripts in the project (Insert → Generated table / Generated figure).</div></div>
            <label className="f">Python interpreter <span className="small muted">— for .py scripts; empty uses the one TeXWriter found ({tc?.python ?? 'none found'})</span>
              <input className="field mono" value={m.generators.python ?? ''} placeholder="auto-detected" onChange={(e) => setM({ ...m, generators: { ...m.generators, python: e.target.value || undefined } })} /></label>
            <label className="f" style={{ maxWidth: 260 }}>Stop a script after (seconds)
              <input className="field" type="number" min={5} max={86400} value={m.generators.timeoutSec} onChange={(e) => setM({ ...m, generators: { ...m.generators, timeoutSec: Math.max(5, Number(e.target.value) || 300) } })} /></label>
            <label className="chk"><input type="checkbox" checked={m.generators.runBeforeCompile} onChange={(e) => setM({ ...m, generators: { ...m.generators, runBeforeCompile: e.target.checked } })} />Run every script before each compile (otherwise compiling only re-reads their outputs)</label>
            <div className="small muted">Other languages run with their usual command (Rscript, julia, node, bash…); set a block's own command in its properties if needed.</div>
          </section>
          <section className="sgrp" id="pre" style={{ borderBottom: 0 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}><h2>Generated preamble</h2><button className="btn btn-q btn-sm" onClick={() => gotoSource('preamble.tex', 1)}>Open preamble.tex</button></div>
            <pre className="logbox" style={{ maxHeight: 'none', margin: 0 }}>{themeBlock(t)}</pre>
            <div className="small muted">Only the lines between the texwriter:theme markers in preamble.tex, and the font-size and paper options of \documentclass, are rewritten. Everything else in the preamble stays exactly as written.</div>
          </section>
        </main>
        <aside className="preview-pane" aria-label="Live preview">
          <div className="row" style={{ padding: '10px 16px', borderBottom: '1px solid #D6D1C8', background: 'var(--canvas)' }}><span className="lbl">Preview</span><span className="small muted">{t.paper === 'a4' ? 'A4' : 'Letter'} · {t.fontSize} pt {FONT_LABELS[t.bodyFont]}</span></div>
          <div className="scroll" style={{ flex: 1, padding: '28px 18px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', gap: 2 }}>
            <MiniPage t={t} side="verso" name={project.manifest.name} /><MiniPage t={t} side="recto" name={project.manifest.name} />
          </div>
          <div style={{ padding: '10px 16px', borderTop: '1px solid #D6D1C8', background: 'var(--canvas)', fontSize: 12, color: 'var(--ink-2)' }}>The preview approximates layout and spacing; the compiled PDF is authoritative.</div>
        </aside>
      </div>
    </>
  );
}
