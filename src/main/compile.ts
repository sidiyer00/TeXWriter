// Compile with latexmk (or a direct engine/bibtex fallback) and parse diagnostics.
import { spawn, ChildProcess, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CompileEvent, CompileResult, Diagnostic, Engine, ProjectManifest, SyncTexForward, SyncTexLocation } from '../shared/types';
import { parseLatexLog, pagesFromLog } from '../shared/latex/log';
import { hash } from '../shared/latex/scan';
import { childEnv, toolchain } from './toolchain';
import { BUILD_DIR } from './project';
import { killTree } from './generators';
import { getSettings } from './settings';

let current: ChildProcess | null = null;
let cancelled = false;

function run(cmd: string, args: string[], cwd: string, emit: (e: CompileEvent) => void, env: NodeJS.ProcessEnv, timeoutMs = 240_000): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    let out = '';
    const child = spawn(cmd, args, { cwd, env, windowsHide: true, detached: process.platform !== 'win32' });
    current = child;
    const timer = setTimeout(() => { out += '\n[texwriter] compile timed out\n'; killTree(child); }, timeoutMs);
    const onData = (b: Buffer) => {
      const t = b.toString('utf8');
      out += t;
      for (const line of t.split(/\r?\n/)) {
        const m = /^Run number \d+ of rule '([^']+)'|^Latexmk: applying rule '([^']+)'|Running '([^ ']+)/.exec(line);
        if (m) emit({ type: 'pass', name: (m[1] ?? m[2] ?? m[3] ?? '').replace(/^.*[\\/]/, '') });
        if (line.trim()) emit({ type: 'log', line });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (e) => { out += `\n[texwriter] ${e.message}\n`; clearTimeout(timer); resolve({ code: null, out }); });
    child.on('close', (code) => { clearTimeout(timer); resolve({ code, out }); });
  });
}

const ENGINE_FLAG: Record<Engine, string> = { pdflatex: '-pdf', lualatex: '-lualatex', xelatex: '-xelatex' };

export async function compile(root: string, m: ProjectManifest, emit: (e: CompileEvent) => void): Promise<CompileResult> {
  if (current) throw new Error('A compile is already running.');
  const tc = toolchain(true);
  const started = Date.now();
  const startedAt = new Date().toISOString();
  const outDir = path.join(root, BUILD_DIR);
  await fsp.mkdir(outDir, { recursive: true });
  const main = m.mainFile;
  const stem = main.replace(/\.tex$/, '');
  const mainAbs = path.join(root, main);
  const texHash = hash(await fsp.readFile(mainAbs, 'utf8'));
  const env = childEnv({
    // let bibtex/biber running in the build dir find the project's .bib files
    BIBINPUTS: root + path.delimiter,
    BSTINPUTS: root + path.delimiter,
    TEXINPUTS: root + path.delimiter,
    max_print_line: '10000',
    error_line: '254',
    half_error_line: '238',
  });
  const engineExe = tc.engines[m.engine];
  const passes: string[] = [];
  const passEmit = (e: CompileEvent) => { if (e.type === 'pass') passes.push(e.name); emit(e); };
  cancelled = false;
  let out = '';
  let usedFallback = false;
  const diagnostics: Diagnostic[] = [];

  const logPath = path.join(outDir, `${stem}.log`);
  try { await fsp.rm(logPath, { force: true }); } catch { /* ignore */ }

  if (!engineExe && !tc.latexmk) {
    current = null;
    return {
      ok: false, pdfPath: null, pages: null, durationMs: 0, startedAt, log: '', passes: [], texHash, usedFallback: false,
      diagnostics: [{ id: 'tc', severity: 'error', kind: 'error', message: `${m.engine} was not found on this computer.`, detail: 'Install MiKTeX (miktex.org) or TeX Live. TeXWriter looks on PATH, in the registry and in the default install folders; if it is installed somewhere else, set the folder in Settings → Tools.' }],
    };
  }

  const miktex = tc.distribution === 'MiKTeX';
  const installFlag = miktex && getSettings().autoInstallPackages ? ['--enable-installer'] : [];
  // MiKTeX's latexmk is a Perl script; without Perl it only pops up an error, so skip it
  const canLatexmk = !!tc.latexmk && !(miktex && !tc.perl);
  if (canLatexmk) {
    passEmit({ type: 'pass', name: 'latexmk' });
    const engineOverride = installFlag.length ? [`-${m.engine === 'pdflatex' ? 'pdflatex' : m.engine}=${m.engine} ${installFlag.join(' ')} %O %S`] : [];
    const r = await run(tc.latexmk!, [ENGINE_FLAG[m.engine], ...engineOverride, '-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-outdir=${BUILD_DIR}`, main], root, passEmit, env);
    out += r.out;
    // MiKTeX ships latexmk but it needs Perl; fall back when it could not run at all
    if (!cancelled && (r.code === null || /perl/i.test(r.out) && !fs.existsSync(logPath))) usedFallback = true;
  } else usedFallback = true;

  if (usedFallback && engineExe && !cancelled) {
    out += '\n[texwriter] running the engine directly (latexmk unavailable)\n';
    const engineArgs = [...installFlag, '-interaction=nonstopmode', '-file-line-error', '-synctex=1', `-output-directory=${BUILD_DIR}`, main];
    passEmit({ type: 'pass', name: m.engine });
    out += (await run(engineExe, engineArgs, root, passEmit, env)).out;
    const aux = await fsp.readFile(path.join(outDir, `${stem}.aux`), 'utf8').catch(() => '');
    if (!cancelled && /\\bibdata\{/.test(aux) && tc.bibtex) {
      passEmit({ type: 'pass', name: 'bibtex' });
      out += (await run(tc.bibtex, [stem], outDir, passEmit, env)).out;
    } else if (!cancelled && /\\abx@aux@refcontext|biblatex/.test(aux) && tc.biber) {
      passEmit({ type: 'pass', name: 'biber' });
      out += (await run(tc.biber, [stem], outDir, passEmit, env)).out;
    }
    for (let k = 0; k < 3 && !cancelled; k++) {
      const log = await fsp.readFile(logPath, 'utf8').catch(() => '');
      if (k > 0 && !/Rerun to get|Label\(s\) may have changed|There were undefined references/.test(log)) break;
      passEmit({ type: 'pass', name: m.engine });
      out += (await run(engineExe, engineArgs, root, passEmit, env)).out;
    }
  }
  current = null;

  const log = await fsp.readFile(logPath, 'utf8').catch(() => '');
  diagnostics.push(...parseLatexLog(log || out, main, root));
  const blg = await fsp.readFile(path.join(outDir, `${stem}.blg`), 'utf8').catch(() => '');
  for (const d of parseLatexLog(blg, main, root)) if (!diagnostics.some((x) => x.kind === d.kind && x.key === d.key)) diagnostics.push({ ...d, id: `b${diagnostics.length}` });
  if (cancelled) diagnostics.unshift({ id: 'cancel', severity: 'notice', kind: 'other', message: 'Compile cancelled.' });
  if (!log && !cancelled) {
    const m2 = /(Can't exec|not recognized|command not found|No such file)[^\n]*/i.exec(out);
    diagnostics.unshift({ id: 'nolog', severity: 'error', kind: 'error', message: 'LaTeX did not produce a log file.', detail: m2 ? m2[0] : out.trim().split('\n').slice(-3).join(' ') });
  }
  const pdfPath = path.join(outDir, `${stem}.pdf`);
  const pdfExists = fs.existsSync(pdfPath) && (await fsp.stat(pdfPath)).mtimeMs >= started - 1000;
  const hasError = diagnostics.some((d) => d.severity === 'error');
  return {
    ok: pdfExists && !hasError && !cancelled,
    pdfPath: fs.existsSync(pdfPath) ? pdfPath : null,
    pages: pagesFromLog(log),
    durationMs: Date.now() - started,
    startedAt,
    diagnostics,
    log: (log || out).slice(-400_000),
    passes,
    texHash,
    usedFallback,
  };
}

export function cancelCompile() {
  if (!current) return;
  cancelled = true;
  killTree(current);
}

function synctex(args: string[], cwd: string): Promise<string | null> {
  const exe = toolchain().synctex;
  if (!exe) return Promise.resolve(null);
  return new Promise((resolve) => execFile(exe, args, { cwd, timeout: 8000, env: childEnv() }, (err, stdout) => resolve(err ? null : stdout)));
}

export async function synctexEdit(root: string, m: ProjectManifest, page: number, x: number, y: number): Promise<SyncTexLocation | null> {
  const pdf = path.join(root, BUILD_DIR, m.mainFile.replace(/\.tex$/, '.pdf'));
  const out = await synctex(['edit', '-o', `${page}:${x.toFixed(2)}:${y.toFixed(2)}:${pdf}`, '-d', path.join(root, BUILD_DIR)], root);
  if (!out) return null;
  const input = /^Input:(.+)$/m.exec(out)?.[1]?.trim();
  const line = Number(/^Line:(-?\d+)$/m.exec(out)?.[1]);
  if (!input || !(line > 0)) return null;
  let rel = path.relative(root, path.resolve(root, input)).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
  if (rel.startsWith('..')) rel = path.basename(input);
  return { file: rel, line, column: Number(/^Column:(-?\d+)$/m.exec(out)?.[1]) || undefined };
}

export async function synctexView(root: string, m: ProjectManifest, file: string, line: number): Promise<SyncTexForward | null> {
  const pdf = path.join(root, BUILD_DIR, m.mainFile.replace(/\.tex$/, '.pdf'));
  const out = await synctex(['view', '-i', `${line}:0:${path.join(root, file)}`, '-o', pdf, '-d', path.join(root, BUILD_DIR)], root);
  if (!out) return null;
  const page = Number(/^Page:(\d+)$/m.exec(out)?.[1]);
  if (!page) return null;
  return {
    page,
    x: Number(/^h:([\d.]+)$/m.exec(out)?.[1] ?? 0),
    y: Number(/^v:([\d.]+)$/m.exec(out)?.[1] ?? 0),
    width: Number(/^W:([\d.]+)$/m.exec(out)?.[1] ?? 0),
    height: Number(/^H:([\d.]+)$/m.exec(out)?.[1] ?? 0),
  };
}
