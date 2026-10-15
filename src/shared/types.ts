// Types shared by the main process, preload bridge and renderer.

export type ReportType = 'documentation' | 'monitoring' | 'academic' | 'blank';

/** Journal/publisher formats for academic papers; each uses the publisher's own class. */
export type AcademicFormat = 'ieee-conf' | 'ieee-journal' | 'acm' | 'elsevier' | 'springer-lncs' | 'aps' | 'ams' | 'apa7' | 'article';

/**
 * A template the user saved (File → Save as template, Document setup → Save style, or a
 * .tex file imported from a journal/university). Lives in <userData>/templates/<id>.json.
 */
export interface UserTemplate {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  /** carries document structure: the class, preamble and body (`files`) */
  layout: boolean;
  /** carries Document setup values (page, fonts, colours) */
  style: boolean;
  /** built-in sections to start from when the template has no layout */
  baseType: ReportType;
  /** project-relative text files (.tex, .sty, .cls, .bib, .bst); `mainFile` is one of them */
  files?: Record<string, string>;
  mainFile?: string;
  theme?: ThemeSettings;
  engine?: Engine;
}

export type UserTemplateInput = Omit<UserTemplate, 'id' | 'createdAt'> & { id?: string };
export type Engine = 'pdflatex' | 'lualatex' | 'xelatex';

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
  /** a journal/publisher class owns the layout: Document setup manages only the editor's macros */
  classLayout?: boolean;
}

export type BlockKind = 'table' | 'figure';

/** One execution of a generated block's script. */
export interface GeneratorRun {
  at: string;
  ok: boolean;
  exitCode: number | null;
  durationMs: number;
  command: string;
  /** stdout and stderr (truncated), plus TeXWriter's own messages */
  log: string;
  error?: string;
}

/**
 * A generated table or figure: LaTeX that TeXWriter writes to generated/<id>.tex from an
 * output file (CSV/TSV/.tex for tables; PDF/PNG/JPG for figures). The output file either
 * comes from a script paired with the block, or is a file you or another program update
 * (a model's output). The document holds `\input{generated/<id>.tex}` between markers.
 */
export interface GeneratedBlockConfig {
  id: string;
  /** 'summary' only appears in projects made by earlier versions (no longer generated) */
  kind: BlockKind | 'summary';
  /** project-relative script that writes `output`; unset = the output is updated outside TeXWriter */
  script?: string;
  /** command line; default from the script's extension. {python}, {script}, {output} are filled in */
  command?: string;
  /** project-relative file the block is built from */
  output?: string;
  caption?: string;
  label?: string;
  // table options
  /** header rows at the top of the output (undefined = detect); merged labels become multi-level headers */
  headerRows?: number;
  /** booktabs, striped, lines, minimal, boxed, grid, plain */
  tableStyle?: string;
  /** number format for numeric body cells (numfmt encoding, e.g. "num,d2,sep"); unset = as written */
  numberFormat?: string;
  /** \small, \footnotesize, … */
  size?: string;
  columns?: string[];
  columnLabels?: Record<string, string>;
  hiddenColumns?: string[];
  fitWidth?: boolean;
  /** print the output file name under the table/figure */
  sourceLine?: boolean;
  // figure options
  width?: string;
  lastRun?: GeneratorRun;
  refreshedAt?: string;
  /** hash of the rendered .tex, used to detect hand edits */
  renderedHash?: string;
  // fields written by earlier versions (test runs); read only to migrate
  run?: number;
  source?: string;
  dataFile?: string;
  template?: string;
}

export interface GeneratorSettings {
  /** Python interpreter; empty = auto-detected */
  python?: string;
  /** run every script before each compile (otherwise outputs are only re-read) */
  runBeforeCompile: boolean;
  /** stop a script after this many seconds */
  timeoutSec: number;
}

export interface ProjectManifest {
  version: 1;
  name: string;
  reportType: ReportType;
  academicFormat?: AcademicFormat;
  owner?: string;
  mainFile: string;
  engine: Engine;
  generators: GeneratorSettings;
  blocks: Record<string, GeneratedBlockConfig>;
  theme: ThemeSettings;
}

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

export interface ProjectFile { path: string; size: number; kind: 'tex' | 'bib' | 'image' | 'pdf' | 'data' | 'code' | 'text' | 'other'; generated: boolean }

export interface OpenProject {
  root: string;
  manifest: ProjectManifest;
  state: ProjectState;
  files: ProjectFile[];
}

export interface RecentProject {
  root: string;
  name: string;
  reportType: ReportType;
  lastOpened: string;
  lastCompile?: { at: string; ok: boolean; issues: number } | null;
}

export interface CreateProjectOptions {
  parentDir: string;
  folderName: string;
  name: string;
  reportType: ReportType;
  academicFormat?: AcademicFormat;
  owner?: string;
  engine: Engine;
  /** start from a saved user template instead of the built-in sections */
  templateId?: string;
}

export interface ToolchainInfo {
  latexmk: string | null;
  engines: Partial<Record<Engine, string | null>>;
  bibtex: string | null;
  biber: string | null;
  synctex: string | null;
  python: string | null;
  git: string | null;
  perl: string | null;
  /** folder holding pdflatex */
  texBin: string | null;
  distribution: 'MiKTeX' | 'TeX Live' | 'TeX' | null;
}

export interface AppSettings {
  /** shown on comments you write */
  userName: string;
  /** where new and sample projects go and exports default to; empty = Documents/TeXWriter */
  projectsDir: string;
  /** override: folder containing pdflatex/latexmk */
  texBinDir: string;
  /** override: python interpreter */
  pythonPath: string;
  /** MiKTeX: install missing packages during compile without asking */
  autoInstallPackages: boolean;
  spellcheck: boolean;
  spellLanguage: string;
  uiZoom: number;
}

export interface CommentMessage { id: string; author: string; at: string; text: string; editedAt?: string }
export interface CommentAnchor { quote: string; prefix: string; suffix: string }
export interface CommentThread {
  id: string;
  file: string;
  anchor: CommentAnchor;
  createdAt: string;
  author: string;
  resolved: boolean;
  resolvedBy?: string;
  resolvedAt?: string;
  messages: CommentMessage[];
}
export interface CommentsFile { version: 1; threads: CommentThread[] }

export interface SpellInfo { word: string; suggestions: string[]; at: number }

export interface SyncTexLocation { file: string; line: number; column?: number }
export interface SyncTexForward { page: number; x: number; y: number; width?: number; height?: number }

/** Output of a generated block's script while it runs. */
export interface GeneratorEvent { id: string; line: string }

export type CompileEvent =
  | { type: 'pass'; name: string }
  | { type: 'log'; line: string }
  | { type: 'finished'; result: CompileResult };

/** Preload API exposed to the renderer as window.texwriter */
export interface TeXWriterApi {
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
  /** run the script paired with a generated block; resolves when it exits */
  runGenerator(root: string, id: string): Promise<GeneratorRun>;
  cancelGenerator(): Promise<void>;
  onGeneratorEvent(cb: (e: GeneratorEvent) => void): () => void;
  statFile(root: string, rel: string): Promise<{ mtimeMs: number; size: number } | null>;
  exportPdf(root: string): Promise<string | null>;
  exportBundle(root: string): Promise<string | null>;
  exportProvenance(root: string): Promise<string | null>;
  revealInFolder(absPath: string): Promise<void>;
  openExternal(url: string): Promise<void>;
  openPath(absPath: string): Promise<void>;
  getSettings(): Promise<AppSettings>;
  saveSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
  redetectTools(): Promise<ToolchainInfo>;
  onWindowFocus(cb: () => void): () => void;
  onSpell(cb: (s: SpellInfo) => void): () => void;
  replaceMisspelling(word: string): Promise<void>;
  addToDictionary(word: string): Promise<void>;
  editCommand(cmd: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo'): Promise<void>;
  setZoom(factor: number): Promise<void>;
  appInfo(): Promise<{ version: string; electron: string; chrome: string; node: string; userData: string }>;
  listTemplates(): Promise<UserTemplate[]>;
  saveTemplate(t: UserTemplateInput): Promise<UserTemplate>;
  deleteTemplate(id: string): Promise<void>;
  /** a .tex file plus the class/style/bib files next to it, as a layout template */
  importTemplateFile(absPath: string, name: string): Promise<UserTemplate>;
  openTemplatesFolder(): Promise<void>;
  /** Main asks the renderer to save before the window closes. */
  onFlush(cb: () => Promise<void> | void): () => void;
}
