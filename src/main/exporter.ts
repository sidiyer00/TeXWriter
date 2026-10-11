// Export the compiled PDF, a reproducible source bundle and a provenance manifest.
import { app } from 'electron';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import type { ProjectManifest } from '../shared/types';
import { BUILD_DIR, MANIFEST, listFiles, readState } from './project';
import { listRuns } from './runs';
import { toolchain } from './toolchain';

export function pdfPath(root: string, m: ProjectManifest) {
  return path.join(root, BUILD_DIR, m.mainFile.replace(/\.tex$/, '.pdf'));
}

async function sha256(file: string) {
  const h = crypto.createHash('sha256');
  h.update(await fsp.readFile(file));
  return h.digest('hex');
}

/** Runs referenced by generated blocks, plus the latest completed run. */
async function referencedRuns(root: string, m: ProjectManifest): Promise<number[]> {
  const runs = await listRuns(root);
  const set = new Set<number>(Object.values(m.blocks).map((b) => b.run).filter((n) => n > 0));
  const latest = runs.find((r) => r.status === 'completed');
  if (latest) set.add(latest.number);
  return [...set].sort((a, b) => a - b);
}

export async function provenance(root: string, m: ProjectManifest) {
  const files = await listFiles(root);
  const state = await readState(root);
  const runs = await listRuns(root);
  const used = await referencedRuns(root, m);
  const tc = toolchain();
  const pdf = pdfPath(root, m);
  return {
    generator: `Quire ${app.getVersion()}`,
    exportedAt: new Date().toISOString(),
    project: { name: m.name, modelId: m.modelId, reportType: m.reportType, mainFile: m.mainFile, engine: m.engine },
    pdf: fs.existsSync(pdf) ? { file: path.basename(pdf), sha256: await sha256(pdf), pages: state.lastCompile?.pages ?? null, compiledAt: state.lastCompile?.startedAt ?? null } : null,
    lastCompile: state.lastCompile ? { ok: state.lastCompile.ok, diagnostics: state.lastCompile.diagnostics.map((d) => ({ severity: d.severity, kind: d.kind, message: d.message, file: d.file, line: d.line })) } : null,
    generatedBlocks: Object.values(m.blocks).map((b) => ({ id: b.id, kind: b.kind, run: b.run, source: b.source, tests: b.testIds, label: b.label, refreshedAt: b.refreshedAt, renderedHash: b.renderedHash })),
    runs: runs.filter((r) => used.includes(r.number)).map((r) => ({ number: r.number, suite: r.suite, status: r.status, startedAt: r.startedAt, gitCommit: r.gitCommit, dataSnapshot: r.dataSnapshot, counts: r.counts, command: r.command })),
    sources: await Promise.all(files.filter((f) => f.kind === 'tex' || f.kind === 'bib' || f.generated || f.path.startsWith('figures/')).map(async (f) => ({ path: f.path, sha256: await sha256(path.join(root, f.path)) }))),
    toolchain: { latexmk: !!tc.latexmk, engine: tc.engines[m.engine] ? path.basename(tc.engines[m.engine]!) : null, python: tc.python ? path.basename(tc.python) : null },
  };
}

export async function writeBundle(root: string, m: ProjectManifest, dest: string) {
  const zip = new AdmZip();
  const files = await listFiles(root);
  for (const f of files) {
    const dir = path.posix.dirname(f.path);
    zip.addLocalFile(path.join(root, f.path), dir === '.' ? '' : dir);
  }
  zip.addLocalFile(path.join(root, MANIFEST));
  for (const n of await referencedRuns(root, m)) {
    const rd = path.join(root, 'runs', String(n));
    if (fs.existsSync(rd)) zip.addLocalFolder(rd, `runs/${n}`);
  }
  const pdf = pdfPath(root, m);
  if (fs.existsSync(pdf)) zip.addLocalFile(pdf, 'build');
  zip.addFile('PROVENANCE.json', Buffer.from(JSON.stringify(await provenance(root, m), null, 2)));
  await new Promise<void>((resolve, reject) => zip.writeZip(dest, (err) => (err ? reject(err) : resolve())));
}
