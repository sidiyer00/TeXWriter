// Application settings: your name (for comments), editor, LaTeX/Python tools, shortcuts.
import { useEffect, useState } from 'react';
import { api, getState, guard, setState, toast, updateSettings, useStore } from '../store';
import { TitleBar, BackButton } from '../components/Chrome';
import { ShortcutTable } from '../components/Dialogs';
import { Check, Refresh, Warn } from '../components/Icons';
import type { ToolchainInfo } from '../../shared/types';

function Tool({ name, path, need, hint }: { name: string; path: string | null | undefined; need?: boolean; hint?: string }) {
  return (
    <div className="toolrow">
      <span className={path ? 't-pass' : need ? 't-fail' : 't-warn'} aria-hidden="true">{path ? <Check size={13} strokeWidth={2.6} /> : <Warn size={13} />}</span>
      <b style={{ fontWeight: 500, width: 92, flex: 'none' }}>{name}</b>
      {path ? <span className="mono small toolpath" title={path}>{path}</span> : <span className="small muted">{hint ?? 'Not found'}</span>}
    </div>
  );
}

function TextSetting({ label, value, onSave, placeholder, mono, browse }: { label: string; value: string; onSave: (v: string) => void; placeholder?: string; mono?: boolean; browse?: 'dir' | 'file' }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <label className="f">{label}
      <div className="row" style={{ gap: 6 }}>
        <input className={`field grow ${mono ? 'mono' : ''}`} value={v} placeholder={placeholder} onChange={(e) => setV(e.target.value)} onBlur={() => v !== value && onSave(v.trim())} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
        {browse && <button className="btn btn-sm" onClick={async (e) => {
          e.preventDefault();
          const p = browse === 'dir' ? await api.chooseDirectory(label) : await api.chooseFile(label, [{ name: 'Programs', extensions: ['exe', '*'] }]);
          if (p) { setV(p); onSave(p); }
        }}>Browse…</button>}
      </div>
    </label>
  );
}

export function SettingsScreen() {
  const settings = useStore((s) => s.settings);
  const tc = useStore((s) => s.toolchain);
  const project = useStore((s) => s.project);
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<{ version: string; electron: string; chrome: string; node: string; userData: string } | null>(null);
  useEffect(() => { void api.appInfo().then(setInfo).catch(() => {}); }, []);
  if (!settings) return null;
  const redetect = async () => {
    setBusy(true);
    const t = await guard<ToolchainInfo>(() => api.redetectTools(), 'Detection failed');
    setBusy(false);
    if (t) { setState({ toolchain: t }); toast(t.engines.pdflatex ? `Found ${t.distribution ?? 'TeX'} in ${t.texBin}` : 'No TeX distribution found yet.', t.engines.pdflatex ? 'ok' : 'err'); }
  };
  const back = () => setState({ view: getState().project ? 'editor' : 'home' });
  return (
    <>
      <TitleBar crumb="Settings" right={project ? <BackButton label="Back to document" /> : <button className="btn no-drag" onClick={back}>Done</button>} />
      <div className="body">
        <nav aria-label="Settings sections" className="settings-nav">
          {[['general', 'General'], ['editor', 'Editor'], ['tools', 'LaTeX and Python'], ['keys', 'Keyboard shortcuts'], ['about', 'About']].map(([id, l]) => (
            <button key={id} className="nav" onClick={() => document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth' })}>{l}</button>
          ))}
        </nav>
        <main className="setup-main">
          <section className="sgrp" id="set-general">
            <h2>General</h2>
            <TextSetting label="Your name (shown on comments you write)" value={settings.userName} placeholder="e.g. Sid Iyer" onSave={(v) => void updateSettings({ userName: v })} />
            <div className="small muted">Comments are stored in quire-comments.json in the project folder. Anyone you share the folder with (OneDrive, a network drive, Git) sees them, with your name on them.</div>
            <TextSetting label="Projects folder (new and sample projects; default for exports)" mono browse="dir" value={settings.projectsDir} placeholder="Leave empty for Documents\Quire" onSave={(v) => void updateSettings({ projectsDir: v })} />
            <label className="f">Interface size
              <select className="field" style={{ width: 160 }} value={settings.uiZoom} onChange={(e) => void updateSettings({ uiZoom: Number(e.target.value) })}>
                {[0.8, 0.9, 1, 1.1, 1.25, 1.5].map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
              </select>
            </label>
          </section>
          <section className="sgrp" id="set-editor">
            <h2>Editor</h2>
            <label className="chk"><input type="checkbox" checked={settings.spellcheck} onChange={(e) => void updateSettings({ spellcheck: e.target.checked })} />Check spelling as you type (body text only; never in code or LaTeX source)</label>
            <label className="f">Spelling language
              <select className="field" style={{ width: 220 }} value={settings.spellLanguage} onChange={(e) => void updateSettings({ spellLanguage: e.target.value })}>
                {[['en-US', 'English (United States)'], ['en-GB', 'English (United Kingdom)'], ['en-CA', 'English (Canada)'], ['en-AU', 'English (Australia)'], ['de-DE', 'German'], ['fr-FR', 'French'], ['es-ES', 'Spanish']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </label>
          </section>
          <section className="sgrp" id="set-tools">
            <div className="row"><h2 className="grow">LaTeX and Python</h2><button className="btn btn-sm" disabled={busy} onClick={() => void redetect()}><Refresh />{busy ? 'Detecting…' : 'Detect again'}</button></div>
            <div className="small muted">Quire searches PATH (including changes made by installers since Quire started), the MiKTeX and TeX Live install locations and the registry. It re-checks automatically when you switch back to Quire after installing something.</div>
            {tc && (
              <div className="toolbox">
                <Tool name="Distribution" path={tc.distribution ? `${tc.distribution}${tc.texBin ? ` · ${tc.texBin}` : ''}` : null} need hint="No TeX distribution found — install MiKTeX (miktex.org) or TeX Live" />
                <Tool name="pdflatex" path={tc.engines.pdflatex} need />
                <Tool name="xelatex" path={tc.engines.xelatex} hint="Optional — needed only for the XeLaTeX engine" />
                <Tool name="lualatex" path={tc.engines.lualatex} hint="Optional" />
                <Tool name="latexmk" path={tc.latexmk} hint="Optional — Quire runs the passes itself without it" />
                {tc.distribution === 'MiKTeX' && <Tool name="Perl" path={tc.perl} hint="Not found — latexmk needs Perl on MiKTeX; Quire runs pdflatex/bibtex directly instead" />}
                <Tool name="BibTeX" path={tc.bibtex} hint="Optional — needed for bibliographies" />
                <Tool name="biber" path={tc.biber} hint="Optional — needed only for biblatex" />
                <Tool name="SyncTeX" path={tc.synctex} hint="Optional — PDF ↔ source jumps fall back to built-in SyncTeX parsing" />
                <Tool name="Python" path={tc.python} hint="Needed to run test suites" />
                <Tool name="Git" path={tc.git} hint="Optional — records the commit of each test run" />
              </div>
            )}
            <TextSetting label="TeX programs folder (leave empty to auto-detect)" mono browse="dir" value={settings.texBinDir} placeholder="e.g. C:\Users\you\AppData\Local\Programs\MiKTeX\miktex\bin\x64" onSave={(v) => void updateSettings({ texBinDir: v })} />
            <TextSetting label="Python interpreter (leave empty to auto-detect)" mono browse="file" value={settings.pythonPath} placeholder="e.g. C:\Python312\python.exe" onSave={(v) => void updateSettings({ pythonPath: v })} />
            <label className="chk"><input type="checkbox" checked={settings.autoInstallPackages} onChange={(e) => void updateSettings({ autoInstallPackages: e.target.checked })} />MiKTeX: install missing LaTeX packages automatically while compiling</label>
          </section>
          <section className="sgrp" id="set-keys">
            <div><h2>Keyboard shortcuts</h2><div className="small muted">Shortcuts follow Word and VS Code conventions and cannot be changed. Press F1 anywhere to see this list.</div></div>
            <ShortcutTable />
          </section>
          <section className="sgrp" id="set-about" style={{ borderBottom: 0 }}>
            <h2>About</h2>
            {info && <dl className="kv"><dt>Quire</dt><dd>{info.version}</dd><dt>Electron</dt><dd>{info.electron}</dd><dt>Chromium</dt><dd>{info.chrome}</dd><dt>Node</dt><dd>{info.node}</dd><dt>Settings</dt><dd className="mono small">{info.userData}</dd></dl>}
          </section>
        </main>
      </div>
    </>
  );
}
