// Electron main process: window, protocol for project files, and the IPC API.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, protocol, screen, shell, session } from 'electron';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CreateProjectOptions, ProjectManifest } from '../shared/types';
import {
  createProject, createSampleProject, isOpenRoot, loadProject, readManifest, readRecents, readState,
  removeRecent, safeJoin, updateRecentStatus, writeManifest, writeState,
} from './project';
import { compile, cancelCompile, synctexEdit, synctexView } from './compile';
import { cancelGenerator, runGenerator } from './generators';
import { pdfPath, provenance, writeBundle } from './exporter';
import { refreshRegistryDirs, toolchain } from './toolchain';
import { getSettings, projectsDir, saveSettings } from './settings';
import type { AppSettings, UserTemplateInput } from '../shared/types';
import { deleteTemplate, importTemplateFile, listTemplates, saveTemplate, templatesDir } from './userTemplates';

// Settings, recent projects and templates from Quire (the app's earlier name) move over once.
(function migrateUserData() {
  try {
    const now = app.getPath('userData');
    const old = path.join(app.getPath('appData'), 'Quire');
    if (!fs.existsSync(old) || fs.existsSync(path.join(now, 'settings.json')) || fs.existsSync(path.join(now, 'recents.json'))) return;
    fs.mkdirSync(now, { recursive: true });
    for (const f of ['settings.json', 'recents.json', 'window-state.json', 'templates']) {
      const src = path.join(old, f);
      if (fs.existsSync(src)) fs.cpSync(src, path.join(now, f), { recursive: true });
    }
  } catch { /* first run without an old install */ }
})();

protocol.registerSchemesAsPrivileged([
  { scheme: 'texwriter-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

let win: BrowserWindow | null = null;
const watchers = new Map<string, fs.FSWatcher>();
const DEV_URL = process.env.TEXWRITER_DEV_URL;

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ------------------------------------------------------------------ window placement

interface WindowState { x: number; y: number; width: number; height: number; maximized: boolean }
const windowStateFile = () => path.join(app.getPath('userData'), 'window-state.json');

function readWindowState(): WindowState | null {
  try {
    const s = JSON.parse(fs.readFileSync(windowStateFile(), 'utf8')) as WindowState;
    return [s.x, s.y, s.width, s.height].every(Number.isFinite) ? s : null;
  } catch { return null; }
}

function saveWindowState(w: BrowserWindow) {
  const b = w.getNormalBounds();
  try { fs.writeFileSync(windowStateFile(), JSON.stringify({ ...b, maximized: w.isMaximized() })); } catch { /* not fatal */ }
}

/**
 * Initial bounds: the last session's if they still fit a connected display, otherwise a
 * centred window that is clearly smaller than the work area. A restored (not maximized)
 * window must never cover a whole monitor: Windows then treats it as a full-screen app
 * and an auto-hide taskbar no longer appears. Maximizing is left to the OS, which keeps
 * the taskbar edge reachable, square corners, Snap and Win+Up/Down.
 */
function initialBounds(): { bounds: Electron.Rectangle; maximized: boolean } {
  const saved = readWindowState();
  if (saved) {
    const d = screen.getDisplayMatching(saved);
    const wa = d.workArea;
    const visibleW = Math.min(saved.x + saved.width, wa.x + wa.width) - Math.max(saved.x, wa.x);
    const visibleH = Math.min(saved.y + saved.height, wa.y + wa.height) - Math.max(saved.y, wa.y);
    const coversDisplay = saved.width >= d.bounds.width && saved.height >= d.bounds.height;
    if (visibleW >= 200 && visibleH >= 120 && !coversDisplay) {
      const width = Math.min(saved.width, wa.width), height = Math.min(saved.height, wa.height);
      const x = Math.min(Math.max(saved.x, wa.x), wa.x + wa.width - width);
      const y = Math.min(Math.max(saved.y, wa.y), wa.y + wa.height - height);
      return { bounds: { x, y, width, height }, maximized: !!saved.maximized };
    }
    if (coversDisplay) return { bounds: defaultBounds(d.workArea), maximized: true };
  }
  return { bounds: defaultBounds(screen.getPrimaryDisplay().workArea), maximized: false };
}

function defaultBounds(wa: Electron.Rectangle): Electron.Rectangle {
  const width = Math.min(1440, Math.round(wa.width * 0.9));
  const height = Math.min(900, Math.round(wa.height * 0.9));
  return { x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height };
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  const { bounds, maximized } = initialBounds();
  const wa = screen.getDisplayMatching(bounds).workArea;
  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(1024, wa.width),
    minHeight: Math.min(640, wa.height),
    show: false,
    backgroundColor: '#EDEAE4',
    title: 'TeXWriter',
    titleBarStyle: 'hidden',
    // square window corners on Windows 11 (maximized windows are always square)
    roundedCorners: false,
    ...(isMac ? { trafficLightPosition: { x: 14, y: 16 } } : { titleBarOverlay: { color: '#FBFAF8', symbolColor: '#3B3833', height: 47 } }),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });
  win.once('ready-to-show', () => {
    if (maximized) win?.maximize();
    win?.show();
    win?.webContents.setZoomFactor(getSettings().uiZoom || 1);
  });
  win.on('focus', () => send('window-focus', null));
  win.webContents.on('context-menu', (_e, params) => {
    send('spell', { word: params.misspelledWord ?? '', suggestions: params.dictionarySuggestions ?? [], at: Date.now() });
  });
  let closing = false;
  win.on('close', (e) => {
    if (closing || !win) return;
    e.preventDefault();
    closing = true;
    saveWindowState(win);
    win.webContents.send('flush');
    ipcMain.once('flushed', () => win?.destroy());
    setTimeout(() => { if (win && !win.isDestroyed()) win.destroy(); }, 2500);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (DEV_URL && url.startsWith(DEV_URL)) return;
    e.preventDefault();
  });
  if (DEV_URL) win.loadURL(DEV_URL);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

/**
 * The native menu is hidden (custom title bar) but its accelerators stay live, so it only
 * carries the clipboard roles and full screen. Zoom is handled by the renderer; reload
 * (Ctrl+R) and DevTools (Ctrl+Shift+I) exist only in development builds.
 */
function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        ...(DEV_URL ? [{ role: 'reload' as const }, { role: 'toggleDevTools' as const }, { type: 'separator' as const }] : []),
        { role: 'togglefullscreen' },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function handle<T extends unknown[], R>(channel: string, fn: (...args: T) => Promise<R> | R) {
  ipcMain.handle(channel, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...(args as T)) };
    } catch (err) {
      return { ok: false, error: (err as Error).message ?? String(err) };
    }
  });
}

function assertRoot(root: string) {
  if (!isOpenRoot(root)) throw new Error('Project is not open.');
}

function registerIpc() {
  handle('toolchain', () => toolchain(true));
  handle('redetectTools', async () => { await refreshRegistryDirs(); return toolchain(true); });
  handle('getSettings', () => getSettings());
  handle('saveSettings', (patch: Partial<AppSettings>) => {
    const s2 = saveSettings(patch);
    if (patch.uiZoom && win) win.webContents.setZoomFactor(patch.uiZoom);
    if (patch.spellLanguage) try { session.defaultSession.setSpellCheckerLanguages([patch.spellLanguage]); } catch { /* unsupported */ }
    if (patch.spellcheck !== undefined) session.defaultSession.setSpellCheckerEnabled(patch.spellcheck);
    if (patch.texBinDir !== undefined || patch.pythonPath !== undefined) toolchain(true);
    return s2;
  });
  handle('replaceMisspelling', (w: string) => win?.webContents.replaceMisspelling(w));
  handle('addToDictionary', (w: string) => { session.defaultSession.addWordToSpellCheckerDictionary(w); });
  handle('editCommand', (cmd: 'cut' | 'copy' | 'paste' | 'selectAll' | 'undo' | 'redo') => { const wc = win?.webContents; if (wc) wc[cmd](); });
  handle('setZoom', (f: number) => { win?.webContents.setZoomFactor(f); saveSettings({ uiZoom: f }); });
  handle('appInfo', () => ({ version: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, userData: app.getPath('userData') }));
  handle('recents', () => readRecents());
  handle('removeRecent', (root: string) => removeRecent(root));
  handle('chooseDirectory', async (title: string) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openDirectory', 'createDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('chooseFile', async (title: string, filters: Electron.FileFilter[]) => {
    const r = await dialog.showOpenDialog(win!, { title, properties: ['openFile'], filters });
    return r.canceled ? null : r.filePaths[0];
  });
  handle('defaultProjectsDir', async () => {
    const d = projectsDir();
    await fsp.mkdir(d, { recursive: true });
    return d;
  });
  handle('createProject', (o: CreateProjectOptions) => createProject(o));
  handle('listTemplates', () => listTemplates());
  handle('saveTemplate', (t: UserTemplateInput) => saveTemplate(t));
  handle('deleteTemplate', (id: string) => deleteTemplate(id));
  handle('importTemplateFile', (abs: string, name: string) => importTemplateFile(abs, name));
  handle('openTemplatesFolder', async () => { await fsp.mkdir(templatesDir(), { recursive: true }); const err = await shell.openPath(templatesDir()); if (err) throw new Error(err); });
  handle('createSampleProject', (parent: string) => createSampleProject(parent));
  handle('openProject', (root: string) => loadProject(root));
  handle('reloadProject', (root: string) => loadProject(root));
  handle('saveManifest', (root: string, m: ProjectManifest) => { assertRoot(root); return writeManifest(root, m); });
  handle('readText', (root: string, rel: string) => { assertRoot(root); return fsp.readFile(safeJoin(root, rel), 'utf8'); });
  handle('writeText', async (root: string, rel: string, text: string) => {
    assertRoot(root);
    const abs = safeJoin(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    selfWrites.set(abs, Date.now());
    await fsp.writeFile(abs, text, 'utf8');
  });
  handle('readBinary', async (root: string, rel: string) => { assertRoot(root); return new Uint8Array(await fsp.readFile(safeJoin(root, rel))); });
  handle('importAsset', async (root: string, abs: string, destDir: string) => {
    assertRoot(root);
    const name = path.basename(abs).replace(/\s+/g, '-');
    let rel = `${destDir}/${name}`;
    let k = 2;
    while (fs.existsSync(safeJoin(root, rel))) rel = `${destDir}/${path.parse(name).name}-${k++}${path.extname(name)}`;
    await fsp.mkdir(path.dirname(safeJoin(root, rel)), { recursive: true });
    await fsp.copyFile(abs, safeJoin(root, rel));
    return rel;
  });
  handle('watchProject', (root: string) => {
    assertRoot(root);
    for (const [k, w] of watchers) { if (k !== root) { w.close(); watchers.delete(k); } }
    if (watchers.has(root)) return;
    const pending = new Map<string, NodeJS.Timeout>();
    try {
      const w = fs.watch(root, { recursive: true }, (_ev, file) => {
        if (!file) return;
        const rel = String(file).replace(/\\/g, '/');
        if (rel.startsWith('.texwriter') || rel.startsWith('.git') || rel.includes('__pycache__')) return;
        const abs = path.join(root, rel);
        const self = selfWrites.get(abs);
        if (self && Date.now() - self < 1500) return;
        clearTimeout(pending.get(rel));
        pending.set(rel, setTimeout(() => send('file-changed', rel), 250));
      });
      watchers.set(root, w);
    } catch { /* recursive watch unsupported: ignore */ }
  });
  handle('compile', async (root: string) => {
    assertRoot(root);
    const m = await readManifest(root);
    const result = await compile(root, m, (e) => send('compile-event', e));
    const state = await readState(root);
    const { log: _log, ...rest } = result;
    state.lastCompile = rest;
    await writeState(root, state);
    await updateRecentStatus(root);
    send('compile-event', { type: 'finished', result });
    return result;
  });
  handle('cancelCompile', () => cancelCompile());
  handle('synctexEdit', async (root: string, page: number, x: number, y: number) => { assertRoot(root); return synctexEdit(root, await readManifest(root), page, x, y); });
  handle('synctexView', async (root: string, file: string, line: number) => { assertRoot(root); return synctexView(root, await readManifest(root), file, line); });
  handle('runGenerator', async (root: string, id: string) => {
    assertRoot(root);
    return runGenerator(root, await readManifest(root), id, (line) => send('generator-event', { id, line }));
  });
  handle('cancelGenerator', () => cancelGenerator());
  handle('statFile', async (root: string, rel: string) => {
    assertRoot(root);
    try { const st = await fsp.stat(safeJoin(root, rel)); return { mtimeMs: st.mtimeMs, size: st.size }; } catch { return null; }
  });
  handle('exportPdf', async (root: string) => {
    assertRoot(root);
    const m = await readManifest(root);
    const src = pdfPath(root, m);
    if (!fs.existsSync(src)) throw new Error('Compile the report before exporting.');
    const r = await dialog.showSaveDialog(win!, { title: 'Export PDF', defaultPath: path.join(projectsDir(), `${m.name.replace(/[\\/:*?"<>|]/g, '-')}.pdf`), filters: [{ name: 'PDF', extensions: ['pdf'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.copyFile(src, r.filePath);
    return r.filePath;
  });
  handle('exportBundle', async (root: string) => {
    assertRoot(root);
    const m = await readManifest(root);
    const r = await dialog.showSaveDialog(win!, { title: 'Export source bundle', defaultPath: path.join(projectsDir(), `${m.name.replace(/[\\/:*?"<>|]/g, '-')}-source.zip`), filters: [{ name: 'Zip archive', extensions: ['zip'] }] });
    if (r.canceled || !r.filePath) return null;
    await writeBundle(root, m, r.filePath);
    return r.filePath;
  });
  handle('exportProvenance', async (root: string) => {
    assertRoot(root);
    const m = await readManifest(root);
    const r = await dialog.showSaveDialog(win!, { title: 'Export provenance', defaultPath: path.join(projectsDir(), `${m.name.replace(/[\\/:*?"<>|]/g, '-')}-provenance.json`), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled || !r.filePath) return null;
    await fsp.writeFile(r.filePath, JSON.stringify(await provenance(root, m), null, 2));
    return r.filePath;
  });
  handle('revealInFolder', (abs: string) => shell.showItemInFolder(abs));
  handle('openExternal', (url: string) => { if (/^https?:\/\//.test(url)) return shell.openExternal(url); });
  handle('openPath', async (abs: string) => { const err = await shell.openPath(path.normalize(abs)); if (err) throw new Error(err); });
}

const selfWrites = new Map<string, number>();

app.whenReady().then(() => {
  protocol.handle('texwriter-file', async (req) => {
    const u = new URL(req.url);
    const root = u.searchParams.get('root') ?? '';
    const rel = u.searchParams.get('path') ?? '';
    if (!isOpenRoot(root)) return new Response('forbidden', { status: 403 });
    try {
      return await net.fetch(pathToFileURL(safeJoin(root, rel)).toString());
    } catch {
      return new Response('not found', { status: 404 });
    }
  });
  if (!DEV_URL) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: texwriter-file:; font-src 'self' data:; connect-src 'self' texwriter-file:; worker-src 'self' blob:"],
        },
      });
    });
  }
  buildMenu();
  registerIpc();
  const st = getSettings();
  try { session.defaultSession.setSpellCheckerEnabled(st.spellcheck); session.defaultSession.setSpellCheckerLanguages([st.spellLanguage || 'en-US']); } catch { /* not on all platforms */ }
  void refreshRegistryDirs().then(() => toolchain(true));
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('window-all-closed', () => {
  for (const w of watchers.values()) w.close();
  if (process.platform !== 'darwin') app.quit();
});
