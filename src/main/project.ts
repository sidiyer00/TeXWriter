// Project folders: create, open, manifest, recents, file listing and safe paths.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { CreateProjectOptions, OpenProject, ProjectFile, ProjectManifest, ProjectState, RecentProject } from '../shared/types';
import { DEFAULT_THEME } from '../shared/latex/theme';
import { STARTER_BIB, defaultManifest, journalPreamble, preambleOptionsFor, preambleTex, reportTex } from './templates';
import { pendingTex } from '../shared/generate';
import { readTemplate } from './userTemplates';
import { applyThemeToClass, applyThemeToPreamble, findThemeBlock } from '../shared/latex/theme';
import { personalize } from '../shared/latex/skeleton';

export const MANIFEST = 'texwriter.json';
export const STATE_DIR = '.texwriter';
/** File names used by Quire, the app's earlier name; renamed when such a project is opened. */
const LEGACY: [string, string][] = [['quire.json', MANIFEST], ['.quire', STATE_DIR], ['quire-comments.json', 'texwriter-comments.json']];
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
  const m = raw as ProjectManifest & { tests?: { python?: string } };
  m.blocks ??= {};
  m.theme = { ...DEFAULT_THEME, ...(m.theme ?? {}), margins: { ...DEFAULT_THEME.margins, ...(m.theme?.margins ?? {}) } };
  const g: Partial<ProjectManifest['generators']> = m.generators ?? {};
  m.generators = { runBeforeCompile: g.runBeforeCompile ?? false, timeoutSec: g.timeoutSec ?? 300, python: g.python ?? m.tests?.python };
  m.engine ??= 'pdflatex';
  m.mainFile ??= 'report.tex';
  // blocks from earlier versions: tables linked to a data file, or to a test run's output
  for (const b of Object.values(m.blocks)) {
    if (!b.output && b.dataFile) b.output = b.dataFile;
    if (!b.output && b.source && b.run) b.output = `runs/${b.run}/${b.source}`;
  }
  return m;
}

const manifestWrites = new Map<string, Promise<void>>();
let tmpSeq = 0;

/** Write texwriter.json atomically; overlapping saves for one project run one after another. */
export function writeManifest(root: string, m: ProjectManifest): Promise<void> {
  const text = JSON.stringify(m, null, 2) + '\n';
  const prev = manifestWrites.get(root) ?? Promise.resolve();
  const next = prev.catch(() => undefined).then(async () => {
    // the temporary file lives in .texwriter/, which the file watcher ignores
    await fsp.mkdir(path.join(root, STATE_DIR), { recursive: true });
    const tmp = path.join(root, STATE_DIR, `manifest-${process.pid}-${++tmpSeq}.tmp`);
    await fsp.writeFile(tmp, text, 'utf8');
    await fsp.rename(tmp, path.join(root, MANIFEST));
  });
  manifestWrites.set(root, next);
  return next;
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
  for (const [from, to] of LEGACY) {
    if ((await exists(path.join(root, from))) && !(await exists(path.join(root, to)))) await fsp.rename(path.join(root, from), path.join(root, to)).catch(() => undefined);
  }
  if (!(await exists(path.join(root, MANIFEST)))) await adoptFolder(root);
  const manifest = await readManifest(root);
  openRoots.add(root);
  const [state, files] = await Promise.all([readState(root), listFiles(root)]);
  await touchRecent(root, manifest, state);
  return { root, manifest, state, files };
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
  if (!main) throw new Error('This folder has no texwriter.json and no LaTeX file with \\documentclass. Choose a project folder or create a new project.');
  const m = defaultManifest(path.basename(root), 'blank', 'pdflatex');
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
  const m = defaultManifest(o.name, type, o.engine, { owner: o.owner, academicFormat: tpl ? undefined : o.academicFormat });
  if (tpl?.style && tpl.theme) m.theme = { ...m.theme, ...tpl.theme, margins: { ...m.theme.margins, ...tpl.theme.margins }, headerLeft: o.name };
  if (tpl?.engine) m.engine = tpl.engine;
  if (tpl?.layout && tpl.files && tpl.mainFile && tpl.files[tpl.mainFile]) {
    // a saved layout: its files as they were, with the new title and author
    for (const [rel, text] of Object.entries(tpl.files)) {
      const abs = safeJoin(root, rel);
      await fsp.mkdir(path.dirname(abs), { recursive: true });
      let out = text;
      // Document setup values are applied only where the template carries a style or a
      // TeXWriter-managed preamble block; an imported journal class keeps its own options
      if (rel === tpl.mainFile) out = personalize(text, { title: o.name, author: o.owner });
      if (rel === tpl.mainFile && tpl.style) out = applyThemeToClass(out, m.theme);
      else if (rel === 'preamble.tex' && findThemeBlock(text)) out = applyThemeToPreamble(text, m.theme);
      await fsp.writeFile(abs, out, 'utf8');
    }
    m.mainFile = tpl.mainFile;
    if (!tpl.files['references.bib'] && /\\bibliography\{references\}/.test(tpl.files[tpl.mainFile])) await fsp.writeFile(path.join(root, 'references.bib'), STARTER_BIB, 'utf8');
  } else {
    const fmt = m.academicFormat;
    await fsp.writeFile(path.join(root, 'report.tex'), applyThemeToClass(reportTex(type, o.name, o.owner, fmt), m.theme), 'utf8');
    await fsp.writeFile(path.join(root, 'preamble.tex'), m.theme.classLayout && fmt ? journalPreamble(fmt, m.theme) : preambleTex(m.theme, preambleOptionsFor(type, fmt)), 'utf8');
    await fsp.writeFile(path.join(root, 'references.bib'), STARTER_BIB, 'utf8');
  }
  await fsp.writeFile(path.join(root, '.gitignore'), GITIGNORE, 'utf8');
  await writeManifest(root, m);
  return loadProject(root);
}

const GITIGNORE = '.texwriter/\n__pycache__/\n';

/** The blocks of the sample project: two from scripts, one from a file another program writes. */
const SAMPLE_BLOCKS = [
  { id: 'tab_coefficients', kind: 'table' as const, script: 'scripts/fit_model.py', output: 'outputs/coefficients.csv', caption: 'Estimated coefficients of the linear model.', label: 'tab:coefficients', tableStyle: 'booktabs', numberFormat: 'num,d3' },
  { id: 'fig_fit', kind: 'figure' as const, script: 'scripts/plot_fit.py', output: 'outputs/fit.pdf', caption: 'Fitted against observed values on the holdout sample.', label: 'fig:fit', width: '0.7\\linewidth' },
  { id: 'tab_holdout', kind: 'table' as const, output: 'data/holdout_metrics.csv', caption: 'Error metrics by sample, as written by the scoring job.', label: 'tab:holdout', tableStyle: 'booktabs' },
];

/** A short model document whose tables and figure are generated by scripts in the project. */
export async function createSampleProject(parentDir: string): Promise<OpenProject> {
  const res = path.join(resourcesDir(), 'sample');
  let folder = 'TeXWriter-Example';
  let k = 2;
  while (await exists(path.join(parentDir, folder))) folder = `TeXWriter-Example-${k++}`;
  const root = path.join(parentDir, folder);
  await fsp.mkdir(path.join(root, 'generated'), { recursive: true });
  await fsp.mkdir(path.join(root, 'outputs'), { recursive: true });
  const m = defaultManifest('Example: generated tables and figures', 'documentation', 'pdflatex', { owner: 'TeXWriter' });
  for (const b of SAMPLE_BLOCKS) {
    m.blocks[b.id] = { ...b };
    await fsp.writeFile(path.join(root, 'generated', `${b.id}.tex`), pendingTex(b), 'utf8');
  }
  for (const f of ['report.tex', 'references.bib']) await fsp.copyFile(path.join(res, f), path.join(root, f));
  await fsp.cp(path.join(res, 'scripts'), path.join(root, 'scripts'), { recursive: true });
  await fsp.cp(path.join(res, 'data'), path.join(root, 'data'), { recursive: true });
  await fsp.writeFile(path.join(root, 'preamble.tex'), preambleTex(m.theme), 'utf8');
  await fsp.writeFile(path.join(root, '.gitignore'), GITIGNORE, 'utf8');
  await writeManifest(root, m);
  return loadProject(root);
}

// --------------------------------------------------------------------------- recents

function recentsPath() { return path.join(app.getPath('userData'), 'recents.json'); }

export async function readRecents(): Promise<RecentProject[]> {
  try {
    const list = JSON.parse(await fsp.readFile(recentsPath(), 'utf8')) as RecentProject[];
    const alive: RecentProject[] = [];
    for (const r of list) if ((await exists(path.join(r.root, MANIFEST))) || (await exists(path.join(r.root, 'quire.json')))) alive.push(r);
    return alive.sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
  } catch { return []; }
}

async function saveRecents(list: RecentProject[]) {
  await fsp.mkdir(path.dirname(recentsPath()), { recursive: true });
  await fsp.writeFile(recentsPath(), JSON.stringify(list.slice(0, 30), null, 2), 'utf8');
}

export async function touchRecent(root: string, m: ProjectManifest, s: ProjectState) {
  const list = (await readRecents()).filter((r) => path.resolve(r.root) !== path.resolve(root));
  list.unshift({
    root,
    name: m.name,
    reportType: m.reportType,
    lastOpened: new Date().toISOString(),
    lastCompile: s.lastCompile ? { at: s.lastCompile.startedAt, ok: s.lastCompile.ok, issues: s.lastCompile.diagnostics.length } : null,
  });
  await saveRecents(list);
}

export async function updateRecentStatus(root: string) {
  const list = await readRecents();
  const r = list.find((x) => path.resolve(x.root) === path.resolve(root));
  if (!r) return;
  const s = await readState(root);
  r.lastCompile = s.lastCompile ? { at: s.lastCompile.startedAt, ok: s.lastCompile.ok, issues: s.lastCompile.diagnostics.length } : null;
  await saveRecents(list);
}

export async function removeRecent(root: string) {
  await saveRecents((await readRecents()).filter((r) => path.resolve(r.root) !== path.resolve(root)));
}
