// Preload bridge: exposes a typed, minimal API as window.texwriter.
import { contextBridge, ipcRenderer } from 'electron';
import type { TeXWriterApi } from '../shared/types';

async function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  const r = (await ipcRenderer.invoke(channel, ...args)) as { ok: boolean; value?: T; error?: string };
  if (!r.ok) throw new Error(r.error ?? 'Unknown error');
  return r.value as T;
}

function on<T>(channel: string, cb: (e: T) => void): () => void {
  const fn = (_: unknown, e: T) => cb(e);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: TeXWriterApi = {
  platform: process.platform,
  toolchain: () => call('toolchain'),
  recents: () => call('recents'),
  removeRecent: (root) => call('removeRecent', root),
  chooseDirectory: (title) => call('chooseDirectory', title),
  chooseFile: (title, filters) => call('chooseFile', title, filters),
  defaultProjectsDir: () => call('defaultProjectsDir'),
  createProject: (o) => call('createProject', o),
  createSampleProject: (parent) => call('createSampleProject', parent),
  openProject: (root) => call('openProject', root),
  reloadProject: (root) => call('reloadProject', root),
  saveManifest: (root, m) => call('saveManifest', root, m),
  readText: (root, rel) => call('readText', root, rel),
  writeText: (root, rel, text) => call('writeText', root, rel, text),
  readBinary: (root, rel) => call('readBinary', root, rel),
  importAsset: (root, abs, dest) => call('importAsset', root, abs, dest),
  fileUrl: (root, rel) => `texwriter-file://local/?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`,
  watchProject: (root) => call('watchProject', root),
  onFileChanged: (cb) => on('file-changed', cb),
  compile: (root) => call('compile', root),
  cancelCompile: () => call('cancelCompile'),
  onCompileEvent: (cb) => on('compile-event', cb),
  synctexEdit: (root, page, x, y) => call('synctexEdit', root, page, x, y),
  synctexView: (root, file, line) => call('synctexView', root, file, line),
  runGenerator: (root, id) => call('runGenerator', root, id),
  cancelGenerator: () => call('cancelGenerator'),
  onGeneratorEvent: (cb) => on('generator-event', cb),
  statFile: (root, rel) => call('statFile', root, rel),
  exportPdf: (root) => call('exportPdf', root),
  exportBundle: (root) => call('exportBundle', root),
  exportProvenance: (root) => call('exportProvenance', root),
  revealInFolder: (abs) => call('revealInFolder', abs),
  openExternal: (url) => call('openExternal', url),
  openPath: (abs) => call('openPath', abs),
  getSettings: () => call('getSettings'),
  saveSettings: (p) => call('saveSettings', p),
  redetectTools: () => call('redetectTools'),
  onWindowFocus: (cb) => on('window-focus', () => cb()),
  onSpell: (cb) => on('spell', cb),
  replaceMisspelling: (w) => call('replaceMisspelling', w),
  addToDictionary: (w) => call('addToDictionary', w),
  editCommand: (c) => call('editCommand', c),
  setZoom: (f) => call('setZoom', f),
  appInfo: () => call('appInfo'),
  listTemplates: () => call('listTemplates'),
  saveTemplate: (t) => call('saveTemplate', t),
  deleteTemplate: (id) => call('deleteTemplate', id),
  importTemplateFile: (abs, name) => call('importTemplateFile', abs, name),
  openTemplatesFolder: () => call('openTemplatesFolder'),
  onFlush: (cb) => on('flush', async () => { try { await cb(); } finally { ipcRenderer.send('flushed'); } }),
};

contextBridge.exposeInMainWorld('texwriter', api);
