// Project folders: create, open, manifest, recents, file listing and safe paths.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { CreateProjectOptions, OpenProject, ProjectFile, ProjectManifest, ProjectState, RecentProject } from '../shared/types';
import { DEFAULT_THEME } from '../shared/latex/theme';
import { SAMPLE_BLOCKS, STARTER_BIB, defaultManifest, pendingTex, preambleOptionsFor, preambleTex, reportTex } from './templates';
import { readTemplate } from './userTemplates';
import { THEME_BEGIN, applyThemeToClass, applyThemeToPreamble } from '../shared/latex/theme';
import { personalize } from '../shared/latex/skeleton';
import { listRuns } from './runs';

export const MANIFEST = 'quire.json';
export const STATE_DIR = '.quire';
export const BUILD_DIR = path.join(STATE_DIR, 'build');

const openRoots = new Set<string>();

export function resourcesDir(): string {
  // packaged: <resources>/resources ; dev: <repo>/resources
  const packaged = path.join(process.resourcesPath ?? '', 'resources');
  if (app.isPackaged && fs.existsSync(packaged)) return packaged;
  return path.join(app.getAppPath(), 'resources');
}

/** Resolve a project-relative path and refuse anything that escapes the project. */
export function safeJoin(root: string, rel: string): string {
  const abs = path.resolve(root, rel);
  const r = path.resolve(root);
  if (abs !== r && !abs.startsWith(r + path.sep)) throw new Error(`Path escapes project: ${rel}`);
  return abs;
}

export function isOpenRoot(root: string): boolean {
  return openRoots.has(path.resolve(root));
}

async function exists(p: string) {
  try { await fsp.access(p); return true; } catch { return false; }
}

export async function readManifest(root: string): Promise<ProjectManifest> {
  const raw = JSON.parse(await fsp.readFile(path.join(root, MANIFEST), 'utf8'));
  const m = raw as ProjectManifest;
  m.blocks ??= {};
  m.theme = { ...DEFAULT_THEME, ...(m.theme ?? {}), margins: { ...DEFAULT_THEME.margins, ...(m.theme?.margins ?? {}) } };
  m.tests ??= { command: '' };
  m.engine ??= 'pdflatex';
  m.mainFile ??= 'report.tex';
  m.refreshBeforeCompile ??= true;
  return m;
}

export async function writeManifest(root: string, m: ProjectManifest): Promise<void> {
  const tmp = path.join(root, MANIFEST + '.tmp');
  await fsp.writeFile(tmp, JSON.stringify(m, null, 2) + '\n', 'utf8');
  await fsp.rename(tmp, path.join(root, MANIFEST));
}

export async function readState(root: string): Promise<ProjectState> {
  try { return JSON.parse(await fsp.readFile(path.join(root, STATE_DIR, 'state.json'), 'utf8')); } catch { return {}; }
}

export async function writeState(root: string, s: ProjectState): Promise<void> {
  await fsp.mkdir(path.join(root, STATE_DIR), { recursive: true });
  await fsp.writeFile(path.join(root, STATE_DIR, 'state.json'), JSON.stringify(s, null, 2), 'utf8');
}

function kindOf(p: string): ProjectFile['kind'] {
  const e = path.extname(p).toLowerCase();
  if (['.tex', '.sty', '.cls', '.ltx', '.dtx', '.def', '.cfg', '.clo', '.fd'].includes(e)) return 'tex';
  if (e === '.bib' || e === '.bst' || e === '.bbx' || e === '.cbx') return 'bib';
  if (['.png', '.jpg', '.jpeg', '.gif', '.svg', '.eps'].includes(e)) return 'image';
  if (e === '.pdf') return 'pdf';
  if (['.csv', '.json', '.tsv', '.xlsx', '.parquet'].includes(e)) return 'data';
  if (['.py', '.r', '.sql', '.jl', '.m', '.sh', '.ps1', '.ipynb'].includes(e)) return 'code';
  if (['.txt', '.md', '.yml', '.yaml', '.toml', '.ini', '.gitignore', '.latexmkrc'].includes(e) || p.endsWith('.latexmkrc')) return 'text';
  return 'other';
}

export async function listFiles(root: string): Promise<ProjectFile[]> {
  const out: ProjectFile[] = [];
  const skip = new Set([STATE_DIR, 'runs', 'node_modules', '.git', '__pycache__', '.venv', 'venv']);
  async function walk(dir: string, depth: number) {
    if (depth > 6 || out.length > 2000) return;
    let entries: fs.Dirent[];
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (e.name.startsWith('.') && e.name !== '.latexmkrc') continue;
      const abs = path.join(dir, e.name);
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (e.isDirectory()) { if (!skip.has(e.name)) await walk(abs, depth + 1); continue; }
      if (/\.(aux|log|out|toc|synctex\.gz|fls|fdb_latexmk|bbl|blg|lof|lot)$/.test(e.name)) continue;
      const st = await fsp.stat(abs);
      out.push({ path: rel, size: st.size, kind: kindOf(rel), generated: rel.startsWith('generated/') });
    }
  }
  await walk(root, 0);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export async function loadProject(root: string): Promise<OpenProject> {
  root = path.resolve(root);
  if (!(await exists(path.join(root, MANIFEST)))) await adoptFolder(root);
  const manifest = await readManifest(root);
  openRoots.add(root);
  const [state, files, runs] = await Promise.all([readState(root), listFiles(root), listRuns(root)]);
  await touchRecent(root, manifest, state, runs);
  return { root, manifest, state, files, runs };
}

/** Opening a folder of existing .tex files: write a manifest for it. */
async function adoptFolder(root: string) {
  const entries = await fsp.readdir(root).catch(() => [] as string[]);
  const texs = entries.filter((f) => f.endsWith('.tex'));
  let main = texs.find((f) => /^(main|report|paper|document)\.tex$/i.test(f));
  if (!main) {
    for (const f of texs) {
      const t = await fsp.readFile(path.join(root, f), 'utf8').catch(() => '');
      if (/\\documentclass/.test(t)) { main = f; break; }
    }
  }
  if (!main) throw new Error('This folder has no quire.json and no LaTeX file with \\documentclass. Choose a project folder or create a new project.');
  const m = defaultManifest(path.basename(root), 'blank', 'pdflatex', { withSuite: false });
  m.mainFile = main;
  await writeManifest(root, m);
}

export async function createProject(o: CreateProjectOptions): Promise<OpenProject> {
  const root = path.join(o.parentDir, o.folderName);
  if (await exists(root)) {
    const entries = await fsp.readdir(root);
    if (entries.length) throw new Error(`The folder “${o.folderName}” already exists and is not empty.`);
  }
  const tpl = o.templateId ? await readTemplate(o.templateId) : null;
  const type = tpl ? tpl.baseType : o.reportType;
  await fsp.mkdir(path.join(root, 'generated'), { recursive: true });
  await fsp.mkdir(path.join(root, 'figures'), { recursive: true });
  const m = defaultManifest(o.name, type, o.engine, { modelId: o.modelId, owner: o.owner, withSuite: o.includeSampleSuite });
  if (tpl?.style && tpl.theme) m.theme = { ...m.theme, ...tpl.theme, margins: { ...m.theme.margins, ...tpl.theme.margins }, headerLeft: o.name };
  if (tpl?.engine) m.engine = tpl.engine;
  if (tpl?.layout && tpl.files && tpl.mainFile && tpl.files[tpl.mainFile]) {
    // a saved layout: its files as they were, with the new title and author
    for (const [rel, text] of Object.entries(tpl.files)) {
      const abs = safeJoin(root, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      let out = text;
      // Document setup values are applied only where the template carries a style or a
      // Quire-managed preamble block; an imported journal class keeps its own options
      if (rel === tpl.mainFile) out = personalize(text, { title: o.name, author: o.owner });
      if (rel === tpl.mainFile && tpl.style) out = applyThemeToClass(out, m.theme);
      else if (rel === 'preamble.tex' && text.includes(THEME_BEGIN)) out = applyThemeToPreamble(text, m.theme);
      await fsp.writeFile(abs, out, 'utf8');
    }
    m.mainFile = tpl.mainFile;
    if (!tpl.files['references.bib'] && /\\bibliography\{references\}/.test(tpl.files[tpl.mainFile])) await fsp.writeFile(path.join(root, 'references.bib'), STARTER_BIB, 'utf8');
  } else {
    await fsp.writeFile(path.join(root, 'report.tex'), applyThemeToClass(reportTex(type, o.name, o.owner, o.modelId), m.theme), 'utf8');
    await fsp.writeFile(path.join(root, 'preamble.tex'), preambleTex(m.theme, preambleOptionsFor(type)), 'utf8');
    await fsp.writeFile(path.join(root, 'references.bib'), STARTER_BIB, 'utf8');
  }
  await fsp.writeFile(path.join(root, '.gitignore'), '.quire/\nruns/*/outputs/*.pdf\n__pycache__/\n', 'utf8');
  if (o.includeSampleSuite) {
    const res = resourcesDir();
    await fsp.cp(path.join(res, 'sample', 'validation'), path.join(root, 'validation'), { recursive: true });
    await fsp.cp(path.join(res, 'sample', 'data'), path.join(root, 'data'), { recursive: true });
  }
  await writeManifest(root, m);
  return loadProject(root);
}

export async function createSampleProject(parentDir: string): Promise<OpenProject> {
  const res = resourcesDir();
  let name = 'CORP-PD v4.2 Annual Validation';
  let folder = 'CORP-PD-v4.2-Validation';
  let k = 2;
  while (await exists(path.join(parentDir, folder))) folder = `CORP-PD-v4.2-Validation-${k++}`;
  const root = path.join(parentDir, folder);
  await fsp.mkdir(path.join(root, 'generated'), { recursive: true });
  await fsp.mkdir(path.join(root, 'figures'), { recursive: true });
  const m = defaultManifest(name, 'validation', 'pdflatex', { modelId: 'MRM-0417', owner: 'Model Validation', withSuite: true });
  m.tests.suiteName = 'validation_suite_v4';
  m.theme.headerLeft = 'CORP-PD v4.2 · Annual Validation Report 2026';
  m.dueDate = '2026-10-30';
  for (const b of SAMPLE_BLOCKS) {
    m.blocks[b.id] = { ...b };
    await fsp.writeFile(path.join(root, 'generated', `${b.id}.tex`), pendingTex(b), 'utf8');
  }
  await fsp.copyFile(path.join(res, 'sample', 'report.tex'), path.join(root, 'report.tex'));
  await fsp.copyFile(path.join(res, 'sample', 'references.bib'), path.join(root, 'references.bib'));
  await fsp.writeFile(path.join(root, 'preamble.tex'), preambleTex(m.theme), 'utf8');
  await fsp.cp(path.join(res, 'sample', 'validation'), path.join(root, 'validation'), { recursive: true });
  await fsp.cp(path.join(res, 'sample', 'data'), path.join(root, 'data'), { recursive: true });
  await fsp.writeFile(path.join(root, '.gitignore'), '.quire/\n__pycache__/\n', 'utf8');
  await writeManifest(root, m);
  name = m.name;
  return loadProject(root);
}

// --------------------------------------------------------------------------- recents

function recentsPath() { return path.join(app.getPath('userData'), 'recents.json'); }

export async function readRecents(): Promise<RecentProject[]> {
  try {
    const list = JSON.parse(await fsp.readFile(recentsPath(), 'utf8')) as RecentProject[];
    const alive: RecentProject[] = [];
    for (const r of list) if (await exists(path.join(r.root, MANIFEST))) alive.push(r);
    return alive.sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
  } catch { return []; }
}

async function saveRecents(list: RecentProject[]) {
  await fsp.mkdir(path.dirname(recentsPath()), { recursive: true });
  await fsp.writeFile(recentsPath(), JSON.stringify(list.slice(0, 30), null, 2), 'utf8');
}

export async function touchRecent(root: string, m: ProjectManifest, s: ProjectState, runs: Awaited<ReturnType<typeof listRuns>>) {
  const list = (await readRecents()).filter((r) => path.resolve(r.root) !== path.resolve(root));
  const last = runs.find((r) => r.status === 'completed');
  list.unshift({
    root,
    name: m.name,
    reportType: m.reportType,
    modelId: m.modelId,
    lastOpened: new Date().toISOString(),
    lastRun: last ? { number: last.number, counts: last.counts } : null,
    lastCompile: s.lastCompile ? { at: s.lastCompile.startedAt, ok: s.lastCompile.ok, issues: s.lastCompile.diagnostics.length } : null,
  });
  await saveRecents(list);
}

export async function updateRecentStatus(root: string) {
  const list = await readRecents();
  const r = list.find((x) => path.resolve(x.root) === path.resolve(root));
  if (!r) return;
  const [s, runs] = await Promise.all([readState(root), listRuns(root)]);
  const last = runs.find((x) => x.status === 'completed');
  r.lastRun = last ? { number: last.number, counts: last.counts } : null;
  r.lastCompile = s.lastCompile ? { at: s.lastCompile.startedAt, ok: s.lastCompile.ok, issues: s.lastCompile.diagnostics.length } : null;
  await saveRecents(list);
}

export async function removeRecent(root: string) {
  await saveRecents((await readRecents()).filter((r) => path.resolve(r.root) !== path.resolve(root)));
}
