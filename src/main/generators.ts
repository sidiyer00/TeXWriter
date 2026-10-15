// Run the script paired with a generated table or figure.
//
// The script runs with the project folder as its working directory and these variables:
//   TEXWRITER_OUTPUT   absolute path of the file it should write (the block's output)
//   TEXWRITER_PROJECT  absolute path of the project folder
//   TEXWRITER_ID       the block's id
// A run succeeds when the command exits with 0 and the output file was (re)written.
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { GeneratorRun, ProjectManifest } from '../shared/types';
import { defaultCommand } from '../shared/generate';
import { childEnv, toolchain } from './toolchain';
import { safeJoin } from './project';

const MAX_LOG = 200_000;
let current: ChildProcess | null = null;
let cancelled = false;

function quote(p: string) { return /\s/.test(p) && !/^".*"$/.test(p) ? `"${p}"` : p; }

/** The command line for a block: its own, or the default for the script's language. */
export function resolveGeneratorCommand(m: ProjectManifest, script: string, output: string, command?: string): string {
  const py = m.generators?.python || toolchain().python || (process.platform === 'win32' ? 'python' : 'python3');
  return (command?.trim() || defaultCommand(script))
    .replace(/\{python\}/g, quote(py))
    .replace(/\{script\}/g, script)
    .replace(/\{output\}/g, output);
}

export async function runGenerator(root: string, m: ProjectManifest, id: string, emit: (line: string) => void): Promise<GeneratorRun> {
  if (current) throw new Error('Another script is still running.');
  const cfg = m.blocks[id];
  if (!cfg) throw new Error(`No generated block "${id}" in texwriter.json.`);
  if (!cfg.script) throw new Error('This block has no script. Choose one in its properties, or update its output file yourself.');
  if (!cfg.output) throw new Error('This block has no output file.');
  const scriptAbs = safeJoin(root, cfg.script);
  const outAbs = safeJoin(root, cfg.output);
  if (!fs.existsSync(scriptAbs)) throw new Error(`${cfg.script} does not exist.`);
  await fsp.mkdir(path.dirname(outAbs), { recursive: true });
  const before = fs.existsSync(outAbs) ? fs.statSync(outAbs).mtimeMs : 0;
  const command = resolveGeneratorCommand(m, cfg.script, cfg.output, cfg.command);
  const started = Date.now();
  let log = '';
  const add = (t: string) => { if (log.length < MAX_LOG) log += t.slice(0, MAX_LOG - log.length); };
  add(`$ ${command}\n`);
  emit(`$ ${command}`);
  cancelled = false;
  let timedOut = false;
  const timeoutMs = Math.max(5, m.generators?.timeoutSec ?? 300) * 1000;

  const exitCode: number | null = await new Promise((resolve) => {
    const child = spawn(command, {
      cwd: root,
      shell: true,
      env: childEnv({ TEXWRITER_OUTPUT: outAbs, TEXWRITER_PROJECT: root, TEXWRITER_ID: id, MPLBACKEND: 'Agg' }),
      windowsHide: true,
      detached: process.platform !== 'win32',
    });
    current = child;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, timeoutMs);
    const onData = (buf: Buffer) => {
      const text = buf.toString('utf8');
      add(text);
      for (const line of text.split(/\r?\n/)) if (line.trim()) emit(line);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (err) => { add(`\n[TeXWriter] could not start: ${err.message}\n`); clearTimeout(timer); resolve(null); });
    child.on('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  current = null;

  const after = fs.existsSync(outAbs) ? fs.statSync(outAbs).mtimeMs : 0;
  const wrote = after > 0 && after !== before;
  let error: string | undefined;
  if (cancelled) error = 'Stopped.';
  else if (timedOut) error = `Stopped after ${Math.round(timeoutMs / 1000)} s (Document setup → Generated content sets the limit).`;
  else if (exitCode !== 0) error = exitCode === null ? 'The command could not be started. Check that the interpreter is installed (Settings shows what was found).' : `The script exited with code ${exitCode}.`;
  else if (!wrote) error = `The script finished but did not write ${cfg.output}. Write to the path in the TEXWRITER_OUTPUT environment variable.`;
  if (error) add(`\n[TeXWriter] ${error}\n`);
  return { at: new Date(started).toISOString(), ok: !error, exitCode, durationMs: Date.now() - started, command, log, ...(error ? { error } : {}) };
}

export function cancelGenerator() {
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
