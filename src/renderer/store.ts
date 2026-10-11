// Global app state + actions. A tiny external store (useSyncExternalStore) keeps
// React components, the TipTap editor and CodeMirror in step without a framework.
import { useSyncExternalStore } from 'react';
import type {
  AppSettings, CommentThread, CompileResult, Diagnostic, GeneratedBlockConfig, OpenProject, ProjectManifest, RunMeta, RunRecord, SpellInfo, ToolchainInfo, ThemeSettings,
} from '../shared/types';
import { parseDocument, toDocJson, serializeDocument, blockLines, ParsedDocument } from '../shared/latex/blocks';
import { parseBib, BibEntry, numberDocument, LabelInfo, OutlineItem } from '../shared/latex/refs';
import { parseCsv } from '../shared/csv';
import { renderTable, renderSummary, renderFigure, BlockView, blockStatus } from '../shared/generate';
import { hash } from '../shared/latex/scan';
import { closest } from '../shared/latex/log';
import type { JNode } from '../shared/latex/model';
import { applyThemeToClass, applyThemeToPreamble, SUPPORT_MACROS, SUPPORT_VERSION, THEME_BEGIN } from '../shared/latex/theme';

export const api = window.quire;

export type View = 'home' | 'editor' | 'tests' | 'review' | 'setup' | 'settings';
export type Mode = 'visual' | 'split' | 'source';
export type Origin = 'visual' | 'source' | 'disk' | 'app';

export interface FileState { text: string; saved: string; origin: Origin; version: number }

export interface Selection {
  index: number;
  pos: number;
  type: string;
  attrs: Record<string, any>;
  /** selected inline atom, if any */
  inline?: { type: string; attrs: Record<string, any>; pos: number } | null;
}

export interface BlockRender { view: BlockView | null; status: 'fresh' | 'stale' | 'pending' | 'missing' | 'conflict' | 'edited'; message?: string; texHash?: string }

export interface State {
  view: View;
  mode: Mode;
  navOpen: boolean;
  navTab: 'outline' | 'files' | 'tests' | 'refs';
  toolchain: ToolchainInfo | null;
  project: OpenProject | null;
  files: Record<string, FileState>;
  sourceFile: string;
  runs: RunMeta[];
  runCache: Record<number, RunRecord>;
  running: { done: number; total: number; label: string; startedAt: number; log: string[] } | null;
  compiling: { passes: string[]; startedAt: number } | null;
  lastCompile: CompileResult | null;
  pdfVersion: number;
  selection: Selection | null;
  sourceLine: number | null;
  /** source lines of the block selected in the visual editor */
  syncLines: [number, number] | null;
  /** top-level block index to highlight in the visual editor (from the source cursor) */
  syncIndex: number | null;
  bib: BibEntry[];
  labels: Map<string, LabelInfo>;
  outline: OutlineItem[];
  numbers: Map<number, string>;
  renders: Record<string, BlockRender>;
  externalChange: string | null;
  toast: { text: string; kind?: 'err' | 'ok'; action?: { label: string; run: () => void } } | null;
  selectedRun: number | null;
  selectedTest: string | null;
  reviewPage: number;
  reviewIssue: string | null;
  jump: { file: string; line: number; nonce: number } | null;
  /** parsed block index after which "Insert test result" puts new content */
  insertAfter: number | null;
  pdfJump: { page: number; y?: number; nonce: number } | null;
  settings: AppSettings | null;
  /** files open as tabs in the source pane (main file is always first) */
  openTabs: string[];
  /** right-hand panel: open state and active tab (opened only on request, never automatically) */
  panel: { open: boolean; tab: 'properties' | 'comments' };
  find: { replace: boolean; nonce: number } | null;
  comments: CommentThread[];
  activeComment: string | null;
  /** a new comment being written for the current selection */
  draftComment: { quote: string; prefix: string; suffix: string; from: number; to: number } | null;
  contextMenu: { x: number; y: number; items: MenuItem[] } | null;
  spell: SpellInfo | null;
  quickOpen: boolean;
  equationModal: { pos: number; inline: boolean } | null;
  dialog: 'insertTable' | 'numberFormat' | 'shortcuts' | 'about' | null;
  prompt: { title: string; label: string; value: string; resolve: (v: string | null) => void } | null;
  picker: 'cite' | 'ref' | null;
  /** bumps when the visual editor instance changes */
  editorTick: number;
}

export interface MenuItem {
  label?: string;
  shortcut?: string;
  run?: () => void;
  disabled?: boolean;
  checked?: boolean;
  separator?: boolean;
  submenu?: MenuItem[];
  danger?: boolean;
}

const initial: State = {
  view: 'home', mode: 'visual', navOpen: true, navTab: 'outline', toolchain: null, project: null, files: {}, sourceFile: '',
  runs: [], runCache: {}, running: null, compiling: null, lastCompile: null, pdfVersion: 0, selection: null, sourceLine: null, syncLines: null, syncIndex: null,
  bib: [], labels: new Map(), outline: [], numbers: new Map(), renders: {}, externalChange: null, toast: null,
  selectedRun: null, selectedTest: null, reviewPage: 1, reviewIssue: null, jump: null, pdfJump: null, insertAfter: null,
  settings: null, openTabs: [], panel: { open: false, tab: 'properties' }, find: null, comments: [], activeComment: null, draftComment: null,
  contextMenu: null, spell: null, quickOpen: false, equationModal: null, dialog: null, prompt: null, picker: null, editorTick: 0,
};

let state: State = initial;
const listeners = new Set<() => void>();

export function getState() { return state; }
export function setState(patch: Partial<State> | ((s: State) => Partial<State>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
// read-only hook for automated UI tests and debugging from DevTools
(window as unknown as { __quireState: () => State }).__quireState = () => state;

export function subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; }
export function useStore<T>(sel: (s: State) => T): T {
  return useSyncExternalStore(subscribe, () => sel(state));
}

// ------------------------------------------------------------------ helpers

export function toast(text: string, kind?: 'err' | 'ok', action?: { label: string; run: () => void }) {
  setState({ toast: { text, kind, action } });
  const t = state.toast;
  setTimeout(() => { if (state.toast === t) setState({ toast: null }); }, kind === 'err' ? 9000 : 5000);
}

export async function guard<T>(fn: () => Promise<T>, msg?: string): Promise<T | undefined> {
  try { return await fn(); } catch (e) { toast(`${msg ? msg + ': ' : ''}${(e as Error).message}`, 'err'); return undefined; }
}

export function root() { return state.project?.root ?? ''; }
export function manifest(): ProjectManifest { return state.project!.manifest; }
export function mainFile() { return state.project?.manifest.mainFile ?? 'report.tex'; }
export function mainText() { return state.files[mainFile()]?.text ?? ''; }
export function latestRun(): RunMeta | null { return state.runs.find((r) => r.status === 'completed') ?? null; }

let parsedCache: { text: string; parsed: ParsedDocument } | null = null;
export function parsedMain(): ParsedDocument {
  const t = mainText();
  if (parsedCache?.text !== t) parsedCache = { text: t, parsed: parseDocument(t) };
  return parsedCache.parsed;
}
export function mainBlockLines(): [number, number][] { return blockLines(mainText(), parsedMain()); }

export function dirtyFiles() { return Object.entries(state.files).filter(([, f]) => f.text !== f.saved).map(([k]) => k); }

// ------------------------------------------------------------------ files

const saveTimers = new Map<string, number>();
/** Set by the visual editor so pending edits are captured before saving. */
export let flushHook: () => void = () => {};
export function setFlushHook(f: () => void) { flushHook = f; }

export function setFileText(rel: string, text: string, origin: Origin) {
  if (rel === mainFile() && origin !== 'source' && origin !== 'disk') text = ensureSupportInMain(text);
  const f = state.files[rel];
  if (f && f.text === text) return;
  setState((s) => ({ files: { ...s.files, [rel]: { text, saved: f?.saved ?? '', origin, version: (f?.version ?? 0) + 1 } } }));
  window.clearTimeout(saveTimers.get(rel));
  saveTimers.set(rel, window.setTimeout(() => void saveFile(rel), 900));
  if (rel === mainFile()) scheduleDerive();
  if (rel.endsWith('.bib')) setState({ bib: parseBib(text) });
}

export async function saveFile(rel: string) {
  const f = state.files[rel];
  if (!f || f.text === f.saved || !state.project) return;
  const text = f.text;
  await guard(() => api.writeText(root(), rel, text), `Could not save ${rel}`);
  setState((s) => ({ files: { ...s.files, [rel]: { ...s.files[rel], saved: text } } }));
}

export async function saveAll() {
  flushHook();
  for (const rel of dirtyFiles()) await saveFile(rel);
}

/** Open a file in the source pane as a tab (loading it if needed). */
export async function openTab(rel: string, line?: number) {
  const text = await guard(() => openFile(rel), `Cannot open ${rel}`);
  if (text === undefined) return;
  setState((s) => ({
    openTabs: s.openTabs.includes(rel) ? s.openTabs : [...s.openTabs, rel],
    sourceFile: rel,
    view: 'editor',
    mode: s.mode === 'visual' ? 'split' : s.mode,
    jump: line ? { file: rel, line, nonce: Date.now() } : s.jump,
  }));
}

export function closeTab(rel: string) {
  if (rel === mainFile()) return;
  void saveFile(rel);
  setState((s) => {
    const tabs = s.openTabs.filter((t) => t !== rel);
    return { openTabs: tabs, sourceFile: s.sourceFile === rel ? tabs[tabs.length - 1] ?? mainFile() : s.sourceFile };
  });
}

export async function openFile(rel: string): Promise<string> {
  if (state.files[rel]) return state.files[rel].text;
  const text = await api.readText(root(), rel);
  setState((s) => ({ files: { ...s.files, [rel]: { text, saved: text, origin: 'disk', version: 1 } } }));
  if (rel.endsWith('.bib')) setState({ bib: parseBib(text) });
  return text;
}

async function onDiskChange(rel: string) {
  const f = state.files[rel];
  if (rel === 'quire.json') return;
  if (rel === COMMENTS_FILE) { void loadComments(); return; }
  if (!f) { void refreshFileList(); return; }
  let disk: string;
  try { disk = await api.readText(root(), rel); } catch { return; }
  if (disk === f.saved || disk === f.text) return;
  if (f.text !== f.saved) { setState({ externalChange: rel }); return; }
  setState((s) => ({ files: { ...s.files, [rel]: { text: disk, saved: disk, origin: 'disk', version: f.version + 1 } } }));
  if (rel === mainFile()) scheduleDerive();
  if (rel.startsWith('generated/')) void renderAllBlocks();
}

export async function resolveExternal(keep: 'mine' | 'disk') {
  const rel = state.externalChange;
  if (!rel) return;
  const disk = await api.readText(root(), rel);
  const f = state.files[rel];
  if (keep === 'disk') setState((s) => ({ files: { ...s.files, [rel]: { text: disk, saved: disk, origin: 'disk', version: f.version + 1 } }, externalChange: null }));
  else { setState({ externalChange: null }); await api.writeText(root(), rel, f.text); setState((s) => ({ files: { ...s.files, [rel]: { ...s.files[rel], saved: f.text } } })); }
  if (rel === mainFile()) scheduleDerive();
}

async function refreshFileList() {
  if (!state.project) return;
  const p = await api.reloadProject(root());
  setState((s) => ({ project: s.project ? { ...s.project, files: p.files } : s.project }));
}

// ------------------------------------------------------------------ derived document data

let deriveTimer = 0;
function scheduleDerive() {
  window.clearTimeout(deriveTimer);
  deriveTimer = window.setTimeout(derive, 120);
}
export function derive() {
  if (!state.project) return;
  const p = parsedMain();
  const { labels, outline, numbers } = numberDocument(toDocJson(p), state.project.manifest.blocks);
  setState({ labels, outline, numbers });
}

// ------------------------------------------------------------------ project lifecycle

let unsubs: (() => void)[] = [];

export async function loadToolchain() {
  const tc = await guard(() => api.redetectTools());
  if (tc) setState({ toolchain: tc });
}

export async function openProject(rootDir: string) {
  const p = await guard(() => api.openProject(rootDir), 'Could not open project');
  if (!p) return;
  unsubs.forEach((u) => u());
  unsubs = [];
  parsedCache = null;
  setState({ ...initial, toolchain: state.toolchain, settings: state.settings, project: p, runs: p.runs, view: 'editor', sourceFile: p.manifest.mainFile, openTabs: [p.manifest.mainFile], lastCompile: null, pdfVersion: 1 });
  const m = p.manifest;
  await guard(async () => {
    await openFile(m.mainFile);
    for (const f of p.files) if (f.kind === 'bib') await openFile(f.path);
  }, 'Could not read project files');
  await migrateSupportMacros();
  derive();
  await loadComments();
  await loadRunsCache();
  await renderAllBlocks();
  void api.watchProject(p.root);
  unsubs.push(api.onFileChanged((rel) => void onDiskChange(rel)));
  unsubs.push(api.onCompileEvent((e) => {
    if (e.type === 'pass') setState((s) => ({ compiling: s.compiling ? { ...s.compiling, passes: [...s.compiling.passes, e.name] } : s.compiling }));
  }));
  unsubs.push(api.onRunEvent((e) => {
    if (e.type === 'progress') setState((s) => ({ running: s.running ? { ...s.running, done: e.done, total: e.total, label: e.label } : s.running }));
    if (e.type === 'log') setState((s) => ({ running: s.running ? { ...s.running, log: [...s.running.log.slice(-200), e.line] } : s.running }));
  }));
  if (p.state.lastCompile) setState({ lastCompile: { ...p.state.lastCompile, log: '' } as CompileResult });
}

export function closeProject() {
  unsubs.forEach((u) => u());
  unsubs = [];
  void saveAll();
  setState({ ...initial, toolchain: state.toolchain, settings: state.settings, view: 'home' });
}

export async function saveManifest(m: ProjectManifest) {
  if (!state.project) return;
  setState((s) => ({ project: s.project ? { ...s.project, manifest: m } : s.project }));
  await guard(() => api.saveManifest(root(), m), 'Could not save quire.json');
}

// ------------------------------------------------------------------ runs

async function loadRunsCache() {
  const runs = await api.listRuns(root());
  setState({ runs });
  const latest = runs.find((r) => r.status === 'completed');
  const prev = runs.filter((r) => r.status === 'completed')[1];
  for (const r of [latest, prev]) if (r) await getRun(r.number);
  if (latest && state.selectedRun === null) setState({ selectedRun: latest.number });
}

export async function getRun(n: number): Promise<RunRecord | null> {
  if (state.runCache[n]) return state.runCache[n];
  const rec = await guard(() => api.loadRun(root(), n));
  if (!rec) return null;
  setState((s) => ({ runCache: { ...s.runCache, [n]: rec } }));
  return rec;
}

export async function runTests() {
  if (!state.project || state.running) return;
  setState({ running: { done: 0, total: 0, label: 'Starting…', startedAt: Date.now(), log: [] } });
  const meta = await guard(() => api.runTests(root()), 'Test run failed');
  setState({ running: null });
  await loadRunsCache();
  if (!meta) return;
  setState({ selectedRun: meta.number, selectedTest: null });
  if (meta.status === 'completed') {
    // first run: fill pending blocks immediately
    const pend = Object.values(manifest().blocks).filter((b) => b.run === 0);
    for (const b of pend) await refreshBlock(b.id, meta.number, false);
    if (pend.length) await saveManifest({ ...manifest() });
    await renderAllBlocks();
    const c = meta.counts;
    toast(`Run #${meta.number} finished: ${c.passed} passed, ${c.failed} failed, ${c.warning} warnings, ${c.skipped} skipped.`, c.failed ? 'err' : 'ok', state.view !== 'tests' ? { label: 'View results', run: () => setState({ view: 'tests' }) } : undefined);
  } else if (meta.status === 'did-not-finish') {
    toast(`Run #${meta.number} did not finish. ${meta.error ?? ''}`, 'err', { label: 'View run', run: () => setState({ view: 'tests' }) });
  }
}

export function cancelRun() { void api.cancelRun(); }

// ------------------------------------------------------------------ generated blocks

export function blockNode(id: string): JNode | undefined {
  return parsedMain().blocks.map((b) => b.node).find((n) => n.type === 'generatedBlock' && n.attrs?.id === id);
}

async function renderFor(cfg: GeneratedBlockConfig, runNo: number): Promise<{ tex: string; view: BlockView; hash: string } | { error: string }> {
  const rec = await getRun(runNo);
  if (!rec) return { error: `Run #${runNo} not found` };
  if (cfg.kind === 'summary') {
    if (!rec.results) return { error: 'Run has no results' };
    return renderSummary(cfg, rec.results, rec.meta);
  }
  if (!cfg.source) return { error: 'No source file selected' };
  const rel = `runs/${runNo}/${cfg.source}`;
  if (cfg.kind === 'figure') {
    if (!rec.meta.outputs.includes(cfg.source)) return { error: `${cfg.source} was not produced by run #${runNo}` };
    return renderFigure(cfg, rel, rec.meta);
  }
  let text: string;
  try { text = await api.readText(root(), rel); } catch { return { error: `${cfg.source} was not produced by run #${runNo}` }; }
  return renderTable(cfg, parseCsv(text), rec.meta);
}

/** Render the block from `runNo` (default: latest), write generated/<id>.tex and update the manifest entry. */
export async function refreshBlock(id: string, runNo?: number, persist = true): Promise<boolean> {
  const m = manifest();
  const cfg = m.blocks[id];
  if (!cfg) return false;
  const n = runNo ?? latestRun()?.number;
  if (!n) { toast('Run the test suite first.', 'err'); return false; }
  const r = await renderFor(cfg, n);
  if ('error' in r) {
    setState((s) => ({ renders: { ...s.renders, [id]: { ...(s.renders[id] ?? { view: null }), status: 'missing', message: r.error } } }));
    return false;
  }
  await api.writeText(root(), `generated/${id}.tex`, r.tex);
  m.blocks[id] = { ...cfg, run: n, refreshedAt: new Date().toISOString(), renderedHash: r.hash };
  if (persist) await saveManifest({ ...m });
  setState((s) => ({ renders: { ...s.renders, [id]: { view: r.view, status: 'fresh', texHash: r.hash } } }));
  return true;
}

export async function refreshStale(): Promise<number> {
  const latest = latestRun()?.number ?? null;
  let n = 0;
  for (const cfg of Object.values(manifest().blocks)) {
    if (latest && cfg.followLatest && cfg.run !== latest && cfg.run !== 0 && state.renders[cfg.id]?.status !== 'conflict' && state.renders[cfg.id]?.status !== 'edited') {
      if (await refreshBlock(cfg.id, latest, false)) n++;
    }
  }
  if (n) await saveManifest({ ...manifest() });
  return n;
}

/** Recompute views and statuses for every block (no writes). */
export async function renderAllBlocks() {
  if (!state.project) return;
  const latest = latestRun()?.number ?? null;
  const out: Record<string, BlockRender> = {};
  for (const cfg of Object.values(manifest().blocks)) {
    const node = blockNode(cfg.id);
    const expectInner = `\\input{generated/${cfg.id}.tex}`;
    if (node && (node.attrs?.inner ?? '').trim() !== expectInner) {
      out[cfg.id] = { view: null, status: 'conflict', message: 'The LaTeX between the generated markers was edited by hand.' };
      continue;
    }
    if (cfg.run === 0) { out[cfg.id] = { view: null, status: 'pending', message: 'Pending first test run' }; continue; }
    const r = await renderFor(cfg, cfg.run);
    if ('error' in r) { out[cfg.id] = { view: null, status: 'missing', message: r.error }; continue; }
    let onDisk = '';
    try { onDisk = await api.readText(root(), `generated/${cfg.id}.tex`); } catch { /* missing */ }
    if (onDisk && cfg.renderedHash && hash(onDisk) !== cfg.renderedHash && hash(onDisk) !== r.hash) {
      out[cfg.id] = { view: r.view, status: 'edited', message: `generated/${cfg.id}.tex was edited outside Quire.` };
      continue;
    }
    out[cfg.id] = { view: r.view, status: blockStatus(cfg, latest), texHash: r.hash };
  }
  setState({ renders: out });
}

export async function updateBlockConfig(id: string, patch: Partial<GeneratedBlockConfig>) {
  const m = manifest();
  m.blocks[id] = { ...m.blocks[id], ...patch };
  await saveManifest({ ...m });
  if (m.blocks[id].run > 0) await refreshBlock(id, m.blocks[id].run);
  derive();
}

/** Keep the hand-edited LaTeX and stop tracking the block. */
export async function unlinkBlock(id: string) {
  const p = parsedMain();
  const doc = toDocJson(p);
  const idx = (doc.content ?? []).findIndex((n) => n.type === 'generatedBlock' && n.attrs?.id === id);
  if (idx < 0) return;
  const node = doc.content![idx];
  let inner: string = node.attrs?.inner ?? '';
  if (inner.trim() === `\\input{generated/${id}.tex}`) {
    inner = (await api.readText(root(), `generated/${id}.tex`)).replace(/^%.*\n/, '').trim();
  }
  doc.content![idx] = { type: 'rawBlock', attrs: { latex: inner, label: 'Static copy', src: null, sig: null, gap: node.attrs?.gap ?? '\n\n' } };
  writeMainDoc(doc);
  const m = manifest();
  delete m.blocks[id];
  await saveManifest({ ...m });
  await renderAllBlocks();
  toast('Converted to static LaTeX. It no longer updates from test runs.');
}

export async function restoreBlock(id: string) {
  const p = parsedMain();
  const doc = toDocJson(p);
  const node = (doc.content ?? []).find((n) => n.type === 'generatedBlock' && n.attrs?.id === id);
  if (node) { node.attrs = { ...node.attrs, inner: `\\input{generated/${id}.tex}`, sig: null }; writeMainDoc(doc); }
  await refreshBlock(id, manifest().blocks[id]?.run || undefined);
  await renderAllBlocks();
}

export function writeMainDoc(doc: JNode) {
  const p = parsedMain();
  const { tex } = serializeDocument(p.prefix, doc, p.suffix, p.leading);
  setFileText(mainFile(), tex, 'app');
}

/** Insert a block after top-level index `after` (or at the end of the body). */
export function insertBlockAt(node: JNode, after: number | null) {
  const doc = toDocJson(parsedMain());
  const content = doc.content ?? [];
  const at = after === null || after >= content.length ? content.length : after + 1;
  content.splice(at, 0, { ...node, attrs: { ...(node.attrs ?? {}), src: null, sig: null, gap: '\n\n' } });
  doc.content = content;
  writeMainDoc(doc);
  return at;
}

export function uniqueBlockId(base: string): string {
  const ids = new Set(Object.keys(manifest().blocks));
  const slug = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 32) || 'block';
  let id = slug; let k = 2;
  while (ids.has(id)) id = `${slug}_${k++}`;
  return id;
}

export async function createGeneratedBlock(cfg: GeneratedBlockConfig, after: number | null) {
  const m = manifest();
  m.blocks[cfg.id] = cfg;
  await saveManifest({ ...m });
  const ok = await refreshBlock(cfg.id, cfg.run);
  if (!ok) return;
  const at = insertBlockAt({ type: 'generatedBlock', attrs: { id: cfg.id, inner: `\\input{generated/${cfg.id}.tex}` } }, after);
  derive();
  return at;
}

// ------------------------------------------------------------------ compile & diagnostics

export async function compileNow() {
  if (!state.project || state.compiling) return;
  setState({ compiling: { passes: [], startedAt: Date.now() } });
  if (manifest().refreshBeforeCompile) {
    const n = await refreshStale();
    if (n) await renderAllBlocks();
  }
  await saveAll();
  const result = await guard(() => api.compile(root()), 'Compile failed to start');
  setState((s) => ({ compiling: null, lastCompile: result ?? s.lastCompile, pdfVersion: s.pdfVersion + 1 }));
  if (!result) return;
  const issues = allDiagnostics();
  if (!result.ok) toast(`Compile failed: ${issues.find((d) => d.severity === 'error')?.message ?? 'see diagnostics'}`, 'err', state.view !== 'review' ? { label: 'Show issues', run: () => setState({ view: 'review' }) } : undefined);
  else if (issues.length && state.view !== 'review') toast(`Compiled ${result.pages ?? ''} pages with ${issues.length} issue${issues.length > 1 ? 's' : ''}.`, undefined, { label: 'Review', run: () => setState({ view: 'review' }) });
  else if (state.view !== 'review') toast(`Compiled ${result.pages ?? ''} pages.`, 'ok', { label: 'Open PDF', run: () => setState({ view: 'review' }) });
}

export function cancelCompile() { void api.cancelCompile(); }

export function blockDiagnostics(): Diagnostic[] {
  const out: Diagnostic[] = [];
  if (!state.project) return out;
  const latest = latestRun()?.number;
  for (const cfg of Object.values(manifest().blocks)) {
    const r = state.renders[cfg.id];
    const label = cfg.label ? `“${cfg.label}”` : cfg.id;
    if (r?.status === 'stale' && latest) out.push({ id: `stale-${cfg.id}`, severity: 'notice', kind: 'stale-block', message: `Generated ${cfg.kind} ${label} is from run #${cfg.run}`, detail: `Run #${latest} is available.`, blockId: cfg.id });
    if (r?.status === 'conflict' || r?.status === 'edited') out.push({ id: `conf-${cfg.id}`, severity: 'warning', kind: 'block-conflict', message: `Generated ${cfg.kind} ${label} was edited by hand`, detail: r.message, blockId: cfg.id });
    if (r?.status === 'missing') out.push({ id: `miss-${cfg.id}`, severity: 'warning', kind: 'missing-file', message: `Generated ${cfg.kind} ${label}: output missing`, detail: r.message, blockId: cfg.id });
  }
  return out;
}

export function allDiagnostics(): Diagnostic[] {
  const comp = (state.lastCompile?.diagnostics ?? []).map((d) => {
    if (d.kind === 'undefined-reference' && d.key) return { ...d, suggestion: closest(d.key, [...state.labels.keys()]) };
    if (d.kind === 'undefined-citation' && d.key) return { ...d, suggestion: closest(d.key, state.bib.map((b) => b.key)) };
    return d;
  });
  return [...comp, ...blockDiagnostics()];
}

/** Replace `\cmd{old}` occurrences of a key in the main file. */
export function replaceKey(kind: 'ref' | 'cite', from: string, to: string) {
  const t = mainText();
  const re = kind === 'ref'
    ? new RegExp(`(\\\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref)\\{)${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\})`, 'g')
    : new RegExp(`(\\\\(?:cite[a-z]*|parencite|textcite|autocite)\\*?(?:\\[[^\\]]*\\]){0,2}\\{[^}]*?)\\b${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
  const next = t.replace(re, kind === 'ref' ? `$1${to}$2` : `$1${to}`);
  if (next !== t) { setFileText(mainFile(), next, 'app'); toast(`Replaced ${from} with ${to}. Recompile to check.`, 'ok'); }
}

export function gotoSource(file: string | undefined, line: number | undefined) {
  if (!file || !line) return;
  const f = file.replace(/^\.\//, '');
  void (async () => {
    try { await openFile(f); } catch { toast(`Cannot open ${f}`, 'err'); return; }
    setState((s) => ({ view: 'editor', mode: s.mode === 'visual' ? 'split' : s.mode, sourceFile: f, openTabs: s.openTabs.includes(f) ? s.openTabs : [...s.openTabs, f], jump: { file: f, line, nonce: Date.now() } }));
  })();
}

// ------------------------------------------------------------------ theme

export async function applyTheme(theme: ThemeSettings) {
  const m = manifest();
  const preRel = state.project!.files.find((f) => f.path === 'preamble.tex') ? 'preamble.tex' : null;
  if (preRel) {
    const pre = await openFile(preRel);
    setFileText(preRel, applyThemeToPreamble(pre, theme), 'app');
  }
  setFileText(m.mainFile, applyThemeToClass(mainText(), theme), 'app');
  await saveManifest({ ...m, theme });
  await saveAll();
}


// ------------------------------------------------------------------ settings & support macros

export async function loadSettings() {
  const st = await guard(() => api.getSettings());
  if (st) setState({ settings: st });
}

export async function updateSettings(patch: Partial<AppSettings>) {
  const st = await guard(() => api.saveSettings(patch), 'Could not save settings');
  if (st) setState({ settings: st });
  if (patch.texBinDir !== undefined || patch.pythonPath !== undefined) await loadToolchain();
}

/** Projects created by older versions lack the macros newer editor features emit. */
async function migrateSupportMacros() {
  if (!state.project) return;
  const pre = state.project.files.find((f) => f.path === 'preamble.tex');
  if (!pre) return;
  const text = await openFile('preamble.tex');
  if (text.includes(THEME_BEGIN) && !text.includes(SUPPORT_VERSION)) {
    setFileText('preamble.tex', applyThemeToPreamble(text, manifest().theme), 'app');
    await saveFile('preamble.tex');
  }
}

/** Main file emits \quirehl / \multirow but has no Quire preamble: add a small support block. */
export function ensureSupportInMain(tex: string): string {
  if (!/\\quirehl\{|\\multirow\{|\\qnum\[/.test(tex)) return tex;
  const pre = state.project?.files.some((f) => f.path === 'preamble.tex') && /\\input\{preamble(\.tex)?\}/.test(tex);
  if (pre || tex.includes('quire:support begin') || /\\(newcommand|providecommand)\{?\\quirehl/.test(tex)) return tex;
  const at = tex.search(/\\begin\{document\}/);
  if (at < 0) return tex;
  const block = [
    '% quire:support begin — macros used by the visual editor',
    '\\usepackage{xcolor}',
    ...SUPPORT_MACROS,
    '% quire:support end',
    '',
  ].join('\n');
  return tex.slice(0, at) + block + tex.slice(at);
}

// ------------------------------------------------------------------ comments

export const COMMENTS_FILE = 'quire-comments.json';
let commentsSaveTimer = 0;

export async function loadComments() {
  if (!state.project) return;
  try {
    const raw = JSON.parse(await api.readText(root(), COMMENTS_FILE));
    setState({ comments: Array.isArray(raw?.threads) ? raw.threads : [] });
  } catch { setState({ comments: [] }); }
}

function persistComments() {
  window.clearTimeout(commentsSaveTimer);
  commentsSaveTimer = window.setTimeout(() => {
    void guard(() => api.writeText(root(), COMMENTS_FILE, JSON.stringify({ version: 1, threads: state.comments }, null, 2) + '\n'), 'Could not save comments');
  }, 300);
}

export function me(): string { return state.settings?.userName || 'Author'; }
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export function setComments(fn: (t: CommentThread[]) => CommentThread[]) {
  setState((s) => ({ comments: fn(s.comments) }));
  persistComments();
}

export function addThread(anchor: { quote: string; prefix: string; suffix: string }, text: string): string {
  const id = uid();
  const now = new Date().toISOString();
  setComments((t) => [...t, { id, file: mainFile(), anchor, createdAt: now, author: me(), resolved: false, messages: [{ id: uid(), author: me(), at: now, text }] }]);
  setState({ activeComment: id, draftComment: null });
  return id;
}

export function replyThread(id: string, text: string) {
  setComments((ts) => ts.map((t) => (t.id === id ? { ...t, resolved: false, messages: [...t.messages, { id: uid(), author: me(), at: new Date().toISOString(), text }] } : t)));
}

export function editMessage(threadId: string, msgId: string, text: string) {
  setComments((ts) => ts.map((t) => (t.id === threadId ? { ...t, messages: t.messages.map((m) => (m.id === msgId ? { ...m, text, editedAt: new Date().toISOString() } : m)) } : t)));
}

export function deleteMessage(threadId: string, msgId: string) {
  setComments((ts) => ts.flatMap((t) => {
    if (t.id !== threadId) return [t];
    const msgs = t.messages.filter((m) => m.id !== msgId);
    return msgs.length ? [{ ...t, messages: msgs }] : [];
  }));
}

export function deleteThread(id: string) { setComments((ts) => ts.filter((t) => t.id !== id)); }

export function resolveThread(id: string, resolved: boolean) {
  setComments((ts) => ts.map((t) => (t.id === id ? { ...t, resolved, resolvedBy: resolved ? me() : undefined, resolvedAt: resolved ? new Date().toISOString() : undefined } : t)));
}

/** Keep anchors current as the commented text is edited (called by the editor plugin). */
export function updateAnchorQuotes(updates: { id: string; quote: string; prefix: string; suffix: string }[]) {
  if (!updates.length) return;
  const map = new Map(updates.map((u) => [u.id, u]));
  setComments((ts) => ts.map((t) => { const u = map.get(t.id); return u && u.quote ? { ...t, anchor: { quote: u.quote, prefix: u.prefix, suffix: u.suffix } } : t; }));
}

// ------------------------------------------------------------------ panel & menus

export function togglePanel(tab?: 'properties' | 'comments') {
  setState((s) => {
    if (tab && s.panel.open && s.panel.tab !== tab) return { panel: { open: true, tab } };
    return { panel: { open: !s.panel.open, tab: tab ?? s.panel.tab } };
  });
}

/**
 * Show our context menu. The DOM event is not cancelled, so Electron still reports the
 * spell-checker's suggestions for the word under the cursor (merged in by ContextMenu).
 */
export function openContextMenu(e: { clientX: number; clientY: number }, items: MenuItem[]) {
  setState({ contextMenu: { x: e.clientX, y: e.clientY, items }, spell: null });
}

/** In-app replacement for window.prompt (which Electron does not support). */
export function promptText(title: string, label: string, value = ''): Promise<string | null> {
  return new Promise((resolve) => setState({ prompt: { title, label, value, resolve: (v) => { setState({ prompt: null }); resolve(v); } } }));
}
