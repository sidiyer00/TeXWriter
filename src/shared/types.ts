// Types shared by the main process, preload bridge and renderer.

export type ReportType = 'validation' | 'documentation' | 'monitoring' | 'performance' | 'blank';
export type Engine = 'pdflatex' | 'lualatex' | 'xelatex';
export type TestStatus = 'passed' | 'failed' | 'warning' | 'skipped';

export interface ThemeSettings {
  preset: 'classic' | 'editorial' | 'compact' | 'custom';
  paper: 'letter' | 'a4';
  landscape: boolean;
  fontSize: 10 | 11 | 12;
  margins: { top: string; bottom: string; inner: string; outer: string };
  twoSide: boolean;
  bodyFont: 'lmodern' | 'pagella' | 'termes' | 'libertinus' | 'sourceserif';
  headingFont: 'body' | 'sans';
  lineSpread: number;
  parSkip: boolean;
  textColor: string;
  linkColor: string;
  tableShade: string;
  calloutFill: string;
  printLinksBlack: boolean;
  headerLeft: string;
  headerRight: string;
}

export type BlockKind = 'table' | 'summary' | 'figure';

export interface GeneratedBlockConfig {
  id: string;
  kind: BlockKind;
  /** run number the block was last rendered from */
  run: number;
  /** follow the newest run (true) or stay pinned to `run` */
  followLatest: boolean;
  /** path relative to the run directory, e.g. outputs/calibration_by_grade.csv */
  source?: string;
  /** tests whose values feed the block */
  testIds: string[];
  caption?: string;
  label?: string;
  // table options
  columns?: string[];
  columnLabels?: Record<string, string>;
  hiddenColumns?: string[];
  decimals?: number;
  percentColumns?: string[];
  highlight?: { column: string; equals: string } | null;
  totalRow?: boolean;
  sourceLine?: boolean;
  fitWidth?: boolean;
  style?: 'booktabs' | 'grid' | 'minimal';
  // summary options
  template?: string;
  // figure options
  width?: string;
  refreshedAt?: string;
  /** hash of the rendered .tex, used to detect hand edits */
  renderedHash?: string;
}

export interface TestsConfig {
  /** shell command; {python} and {runDir} are substituted */
  command: string;
  python?: string;
  cwd?: string;
  suiteName?: string;
}

export interface ProjectManifest {
  version: 1;
  name: string;
  reportType: ReportType;
  modelId?: string;
  owner?: string;
  dueDate?: string;
  mainFile: string;
  engine: Engine;
  tests: TestsConfig;
  blocks: Record<string, GeneratedBlockConfig>;
  refreshBeforeCompile: boolean;
  theme: ThemeSettings;
}

export interface TestResult {
  id: string;
  name: string;
  category: string;
  status: TestStatus;
  metric?: string;
  value?: number | string | null;
  threshold?: string;
  notes?: string;
  outputs?: string[];
  details?: Record<string, number | string>;
  finishedAt?: string;
  /** history of the value in previous runs, filled in by compare() */
}

export interface RunResults {
  suite: string;
  dataSnapshot?: string;
  tests: TestResult[];
}

export interface RunCounts { passed: number; failed: number; warning: number; skipped: number; total: number }

export interface RunMeta {
  number: number;
  suite: string;
  status: 'completed' | 'did-not-finish' | 'cancelled' | 'running';
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  exitCode?: number | null;
  command: string;
  gitCommit?: string | null;
  dataSnapshot?: string;
  counts: RunCounts;
  error?: string;
  outputs: string[];
}

export interface RunRecord { meta: RunMeta; results: RunResults | null }

export type DiagnosticSeverity = 'error' | 'warning' | 'notice';
export type DiagnosticKind =
  | 'error'
  | 'undefined-reference'
  | 'undefined-citation'
  | 'overfull'
  | 'underfull'
  | 'missing-file'
  | 'stale-block'
  | 'block-conflict'
  | 'other';

export interface Diagnostic {
  id: string;
  severity: DiagnosticSeverity;
  kind: DiagnosticKind;
  message: string;
  detail?: string;
  file?: string;
  line?: number;
  page?: number;
  key?: string;
  suggestion?: string;
  blockId?: string;
}

export interface CompileResult {
  ok: boolean;
  pdfPath: string | null;
  pages: number | null;
  durationMs: number;
  startedAt: string;
  diagnostics: Diagnostic[];
  log: string;
  passes: string[];
  texHash: string;
  usedFallback: boolean;
}

export interface ProjectState {
  lastCompile?: Omit<CompileResult, 'log'> | null;
}

export interface ProjectFile { path: string; size: number; kind: 'tex' | 'bib' | 'image' | 'pdf' | 'data' | 'other'; generated: boolean }

export interface OpenProject {
  root: string;
  manifest: ProjectManifest;
  state: ProjectState;
  files: ProjectFile[];
  runs: RunMeta[];
}

export interface RecentProject {
  root: string;
  name: string;
  reportType: ReportType;
  modelId?: string;
  lastOpened: string;
  lastRun?: { number: number; counts: RunCounts } | null;
  lastCompile?: { at: string; ok: boolean; issues: number } | null;
}

export interface CreateProjectOptions {
  parentDir: string;
  folderName: string;
  name: string;
  reportType: ReportType;
  modelId?: string;
  owner?: string;
  includeSampleSuite: boolean;
  engine: Engine;
}

export interface ToolchainInfo {
  latexmk: string | null;
  engines: Partial<Record<Engine, string | null>>;
  bibtex: string | null;
  biber: string | null;
  synctex: string | null;
  python: string | null;
  git: string | null;
}

export interface SyncTexLocation { file: string; line: number; column?: number }
export interface SyncTexForward { page: number; x: number; y: number; width?: number; height?: number }

export type RunEvent =
  | { type: 'progress'; done: number; total: number; label: string }
  | { type: 'log'; line: string }
  | { type: 'finished'; meta: RunMeta };

export type CompileEvent =
  | { type: 'pass'; name: string }
  | { type: 'log'; line: string }
  | { type: 'finished'; result: CompileResult };

/** Preload API exposed to the renderer as window.quire */
export interface QuireApi {
  platform: string;
  toolchain(): Promise<ToolchainInfo>;
  recents(): Promise<RecentProject[]>;
  removeRecent(root: string): Promise<void>;
  chooseDirectory(title: string): Promise<string | null>;
  chooseFile(title: string, filters: { name: string; extensions: string[] }[]): Promise<string | null>;
  defaultProjectsDir(): Promise<string>;
  createProject(opts: CreateProjectOptions): Promise<OpenProject>;
  createSampleProject(parentDir: string): Promise<OpenProject>;
  openProject(root: string): Promise<OpenProject>;
  reloadProject(root: string): Promise<OpenProject>;
  saveManifest(root: string, manifest: ProjectManifest): Promise<void>;
  readText(root: string, rel: string): Promise<string>;
  writeText(root: string, rel: string, text: string): Promise<void>;
  readBinary(root: string, rel: string): Promise<Uint8Array>;
  importAsset(root: string, absPath: string, destDir: string): Promise<string>;
  fileUrl(root: string, rel: string): string;
  watchProject(root: string): Promise<void>;
  onFileChanged(cb: (rel: string) => void): () => void;
  compile(root: string): Promise<CompileResult>;
  cancelCompile(): Promise<void>;
  onCompileEvent(cb: (e: CompileEvent) => void): () => void;
  synctexEdit(root: string, page: number, x: number, y: number): Promise<SyncTexLocation | null>;
  synctexView(root: string, file: string, line: number): Promise<SyncTexForward | null>;
  runTests(root: string): Promise<RunMeta>;
  cancelRun(): Promise<void>;
  onRunEvent(cb: (e: RunEvent) => void): () => void;
  loadRun(root: string, n: number): Promise<RunRecord>;
  listRuns(root: string): Promise<RunMeta[]>;
  exportPdf(root: string): Promise<string | null>;
  exportBundle(root: string): Promise<string | null>;
  exportProvenance(root: string): Promise<string | null>;
  revealInFolder(absPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Main asks the renderer to save before the window closes. */
  onFlush(cb: () => Promise<void> | void): () => void;
}
