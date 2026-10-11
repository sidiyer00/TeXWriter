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
import { cancelRun, listRuns, loadRun, runTests } from './runs';
import { pdfPath, provenance, writeBundle } from './exporter';
import { refreshRegistryDirs, toolchain } from './toolchain';
import { getSettings, projectsDir, saveSettings } from './settings';
import type { AppSettings } from '../shared/types';

protocol.registerSchemesAsPrivileged([
  { scheme: 'quire-file', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: false } },
]);

let win: BrowserWindow | null = null;
const watchers = new Map<string, fs.FSWatcher>();
const DEV_URL = process.env.QUIRE_DEV_URL;

function send(channel: string, payload: unknown) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

function createWindow() {
  const isMac = process.platform === 'darwin';
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#EDEAE4',
    title: 'Quire',
    titleBarStyle: 'hidden',
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
    win?.show();
    win?.webContents.setZoomFactor(getSettings().uiZoom || 1);
  });
  installTaskbarFix(win);
  win.on('focus', () => send('window-focus', null));
  win.webContents.on('context-menu', (_e, params) => {
    send('spell', { word: params.misspelledWord ?? '', suggestions: params.dictionarySuggestions ?? [], at: Date.now() });
  });
  let closing = false;
  win.on('close', (e) => {
    if (closing || !win) return;
    e.preventDefault();
    closing = true;
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
 * A window with a hidden title bar that is maximized covers the whole monitor when the
 * taskbar is set to auto-hide, and Windows then treats the app as full screen and never
 * reveals the taskbar. Keep a 1-px strip free on the taskbar's edge instead.
 */
function installTaskbarFix(w: BrowserWindow) {
  if (process.platform !== 'win32') return;
  let restore: Electron.Rectangle | null = null;
  let pseudo = false;
  let lastNormal = w.getBounds();
  w.on('resize', () => { if (!w.isMaximized() && !pseudo) lastNormal = w.getBounds(); });
  w.on('move', () => { if (!w.isMaximized() && !pseudo) lastNormal = w.getBounds(); });
  w.on('maximize', () => {
    const d = screen.getDisplayMatching(w.getBounds());
    const autoHide = d.workArea.height === d.bounds.height && d.workArea.width === d.bounds.width;
    if (!autoHide) return;
    if (pseudo && restore) {
      // second maximize request while pseudo-maximized acts as "restore"
      pseudo = false;
      w.unmaximize();
      w.setBounds(restore);
      return;
    }
    restore = lastNormal;
    pseudo = true;
    w.unmaximize();
    const wa = d.workArea;
    w.setBounds({ x: wa.x, y: wa.y, width: wa.width, height: wa.height - 1 });
  });
  w.on('will-resize', () => { pseudo = false; });
  w.on('will-move', () => { pseudo = false; });
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'toggleDevTools' }, { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' },
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
        if (rel.startsWith('.quire') || rel.startsWith('.git') || rel.startsWith('runs/') || rel.includes('__pycache__')) return;
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
  handle('runTests', async (root: string) => {
    assertRoot(root);
    const meta = await runTests(root, await readManifest(root), (e) => send('run-event', e));
    await updateRecentStatus(root);
    return meta;
  });
  handle('cancelRun', () => cancelRun());
  handle('loadRun', (root: string, n: number) => { assertRoot(root); return loadRun(root, n); });
  handle('listRuns', (root: string) => { assertRoot(root); return listRuns(root); });
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
  protocol.handle('quire-file', async (req) => {
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
          'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: quire-file:; font-src 'self' data:; connect-src 'self' quire-file:; worker-src 'self' blob:"],
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
