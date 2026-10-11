// Test runs: execute the configured suite into runs/<n>/ and read results back.
import { spawn, ChildProcess, execFile } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { ProjectManifest, RunEvent, RunMeta, RunRecord, RunResults } from '../shared/types';
import { countResults, normalizeResults, parseJUnit } from '../shared/results';
import { childEnv, toolchain } from './toolchain';

const RUNS = 'runs';
let current: ChildProcess | null = null;
let cancelled = false;

export async function listRuns(root: string): Promise<RunMeta[]> {
  const dir = path.join(root, RUNS);
  let names: string[] = [];
  try { names = await fsp.readdir(dir); } catch { return []; }
  const metas: RunMeta[] = [];
  for (const n of names) {
    if (!/^\d+$/.test(n)) continue;
    try {
      const m = JSON.parse(await fsp.readFile(path.join(dir, n, 'run.json'), 'utf8')) as RunMeta;
      if (m.status === 'running' && !current) m.status = 'did-not-finish';
      metas.push(m);
    } catch { /* incomplete */ }
  }
  return metas.sort((a, b) => b.number - a.number);
}

export async function loadRun(root: string, n: number): Promise<RunRecord> {
  const dir = path.join(root, RUNS, String(n));
  const meta = JSON.parse(await fsp.readFile(path.join(dir, 'run.json'), 'utf8')) as RunMeta;
  let results: RunResults | null = null;
  try { results = normalizeResults(JSON.parse(await fsp.readFile(path.join(dir, 'results.json'), 'utf8'))); } catch { results = null; }
  return { meta, results };
}

async function walkOutputs(dir: string, base: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string) {
    let es: fs.Dirent[] = [];
    try { es = await fsp.readdir(d, { withFileTypes: true }); } catch { return; }
    for (const e of es) {
      const abs = path.join(d, e.name);
      if (e.isDirectory()) await walk(abs);
      else out.push(path.relative(base, abs).replace(/\\/g, '/'));
    }
  }
  await walk(dir);
  return out.sort();
}

function gitCommit(root: string): Promise<string | null> {
  const git = toolchain().git;
  if (!git) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(git, ['rev-parse', '--short', 'HEAD'], { cwd: root, timeout: 5000 }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
  });
}

function quote(p: string) { return /\s/.test(p) ? `"${p}"` : p; }

export function resolveCommand(m: ProjectManifest, runDir: string): string {
  const py = m.tests.python || toolchain().python || (process.platform === 'win32' ? 'python' : 'python3');
  return m.tests.command.replace(/\{python\}/g, quote(py)).replace(/\{runDir\}/g, runDir);
}

export async function runTests(root: string, m: ProjectManifest, emit: (e: RunEvent) => void): Promise<RunMeta> {
  if (current) throw new Error('A test run is already in progress.');
  if (!m.tests.command.trim()) throw new Error('No test command is configured. Set one in Project settings → Tests.');
  const existing = await listRuns(root);
  const number = (existing[0]?.number ?? 0) + 1;
  const runDir = path.join(root, RUNS, String(number));
  await fsp.mkdir(path.join(runDir, 'outputs'), { recursive: true });
  const command = resolveCommand(m, runDir);
  const startedAt = new Date();
  const meta: RunMeta = {
    number, suite: m.tests.suiteName || 'tests', status: 'running', startedAt: startedAt.toISOString(), command,
    gitCommit: await gitCommit(root), counts: { passed: 0, failed: 0, warning: 0, skipped: 0, total: 0 }, outputs: [],
  };
  await fsp.writeFile(path.join(runDir, 'run.json'), JSON.stringify(meta, null, 2));
  const logStream = fs.createWriteStream(path.join(runDir, 'log.txt'));
  cancelled = false;

  const exitCode: number | null = await new Promise((resolve) => {
    const child = spawn(command, {
      cwd: m.tests.cwd ? path.resolve(root, m.tests.cwd) : root,
      shell: true,
      env: childEnv({ QUIRE_RUN_DIR: runDir, QUIRE_RUN_NUMBER: String(number), QUIRE_PROJECT: root }),
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    current = child;
    const onData = (buf: Buffer) => {
      const text = buf.toString('utf8');
      logStream.write(text);
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        const pm = /^QUIRE_PROGRESS (\d+)\/(\d+)\s*(.*)$/.exec(line.trim());
        if (pm) emit({ type: 'progress', done: Number(pm[1]), total: Number(pm[2]), label: pm[3] });
        else emit({ type: 'log', line });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => { logStream.write(`\n[quire] failed to start: ${err.message}\n`); resolve(null); });
    child.on('close', (code) => resolve(code));
  });
  current = null;
  logStream.end();

  const finishedAt = new Date();
  meta.finishedAt = finishedAt.toISOString();
  meta.durationMs = finishedAt.getTime() - startedAt.getTime();
  meta.exitCode = exitCode;
  let results: RunResults | null = null;
  try {
    results = normalizeResults(JSON.parse(await fsp.readFile(path.join(runDir, 'results.json'), 'utf8')));
  } catch (e) {
    const junit = path.join(runDir, 'junit.xml');
    if (fs.existsSync(junit)) {
      results = parseJUnit(await fsp.readFile(junit, 'utf8'), meta.suite);
      await fsp.writeFile(path.join(runDir, 'results.json'), JSON.stringify(results, null, 2));
    } else if (!cancelled) {
      meta.error = fs.existsSync(path.join(runDir, 'results.json'))
        ? `results.json is invalid: ${(e as Error).message}`
        : `The suite exited${exitCode === null ? ' before starting' : ` with code ${exitCode}`} without writing results.json or junit.xml. Check the run log.`;
    }
  }
  if (cancelled) meta.status = 'cancelled';
  else meta.status = results ? 'completed' : 'did-not-finish';
  if (results) {
    meta.suite = results.suite || meta.suite;
    meta.dataSnapshot = results.dataSnapshot;
    meta.counts = countResults(results);
  }
  meta.outputs = await walkOutputs(path.join(runDir, 'outputs'), runDir);
  await fsp.writeFile(path.join(runDir, 'run.json'), JSON.stringify(meta, null, 2));
  emit({ type: 'finished', meta });
  return meta;
}

export function cancelRun() {
  if (!current) return;
  cancelled = true;
  killTree(current);
}

export function killTree(child: ChildProcess) {
  if (!child.pid) return;
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
  else {
    try { process.kill(-child.pid, 'SIGTERM'); } catch { child.kill('SIGTERM'); }
  }
}
