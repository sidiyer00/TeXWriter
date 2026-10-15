// Export the compiled PDF, a reproducible source bundle and a provenance manifest.
import { app } from 'electron';
import fsp from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import type { ProjectManifest } from '../shared/types';
import { BUILD_DIR, MANIFEST, listFiles, readState } from './project';
import { toolchain } from './toolchain';

export function pdfPath(root: string, m: ProjectManifest) {
  return path.join(root, BUILD_DIR, m.mainFile.replace(/\.tex$/, '.pdf'));
}

async function sha256(file: string) {
  const h = crypto.createHash('sha256');
  h.update(await fsp.readFile(file));
  return h.digest('hex');
}

export async function provenance(root: string, m: ProjectManifest) {
  const files = await listFiles(root);
  const state = await readState(root);
  const tc = toolchain();
  const pdf = pdfPath(root, m);
  return {
    generator: `TeXWriter ${app.getVersion()}`,
    exportedAt: new Date().toISOString(),
    project: { name: m.name, reportType: m.reportType, academicFormat: m.academicFormat, mainFile: m.mainFile, engine: m.engine },
    pdf: fs.existsSync(pdf) ? { file: path.basename(pdf), sha256: await sha256(pdf), pages: state.lastCompile?.pages ?? null, compiledAt: state.lastCompile?.startedAt ?? null } : null,
    lastCompile: state.lastCompile ? { ok: state.lastCompile.ok, diagnostics: state.lastCompile.diagnostics.map((d) => ({ severity: d.severity, kind: d.kind, message: d.message, file: d.file, line: d.line })) } : null,
    // each generated table/figure: the script that produced it, its last run and the output's hash
    generated: await Promise.all(Object.values(m.blocks).map(async (b) => ({
      id: b.id, kind: b.kind, label: b.label, script: b.script, command: b.lastRun?.command, output: b.output,
      outputSha256: b.output && fs.existsSync(path.join(root, b.output)) ? await sha256(path.join(root, b.output)) : null,
      scriptSha256: b.script && fs.existsSync(path.join(root, b.script)) ? await sha256(path.join(root, b.script)) : null,
      lastRun: b.lastRun ? { at: b.lastRun.at, ok: b.lastRun.ok, exitCode: b.lastRun.exitCode, durationMs: b.lastRun.durationMs } : null,
      refreshedAt: b.refreshedAt, renderedHash: b.renderedHash,
    }))),
    sources: await Promise.all(files.filter((f) => f.kind === 'tex' || f.kind === 'bib' || f.kind === 'code' || f.generated || f.path.startsWith('figures/') || f.path.startsWith('outputs/')).map(async (f) => ({ path: f.path, sha256: await sha256(path.join(root, f.path)) }))),
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
  const pdf = pdfPath(root, m);
  if (fs.existsSync(pdf)) zip.addLocalFile(pdf, 'build');
  zip.addFile('PROVENANCE.json', Buffer.from(JSON.stringify(await provenance(root, m), null, 2)));
  await new Promise<void>((resolve, reject) => zip.writeZip(dest, (err) => (err ? reject(err) : resolve())));
}
