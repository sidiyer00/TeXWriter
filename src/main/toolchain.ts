// Locate TeX, Python and Git executables without spawning a shell.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { ToolchainInfo } from '../shared/types';

const isWin = process.platform === 'win32';

function extraDirs(): string[] {
  const dirs: string[] = [];
  if (isWin) {
    const la = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    dirs.push(path.join(la, 'Programs', 'MiKTeX', 'miktex', 'bin', 'x64'));
    dirs.push(path.join(pf, 'MiKTeX', 'miktex', 'bin', 'x64'));
    for (const root of ['C:\\texlive', path.join(os.homedir(), 'texlive')]) {
      try {
        for (const y of fs.readdirSync(root).filter((d) => /^\d{4}$/.test(d)).sort().reverse()) {
          dirs.push(path.join(root, y, 'bin', 'windows'), path.join(root, y, 'bin', 'win32'), path.join(root, y, 'bin', 'win64'));
        }
      } catch { /* not installed */ }
    }
    dirs.push(path.join(la, 'Programs', 'Python'));
    try {
      const pyRoot = path.join(la, 'Programs', 'Python');
      for (const d of fs.readdirSync(pyRoot)) dirs.push(path.join(pyRoot, d));
    } catch { /* none */ }
    dirs.push(path.join(pf, 'Git', 'cmd'));
    dirs.push('C:\\Strawberry\\perl\\bin');
  } else {
    dirs.push('/Library/TeX/texbin', '/usr/local/texlive/2025/bin/x86_64-linux', '/usr/local/bin', '/opt/homebrew/bin');
  }
  return dirs;
}

let cache: ToolchainInfo | null = null;

export function findExecutable(name: string): string | null {
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  const dirs = [...(process.env.PATH ?? '').split(path.delimiter), ...extraDirs()].filter(Boolean);
  const hits: string[] = [];
  for (const d of dirs) {
    for (const e of exts) {
      const p = path.join(d, name + e);
      try {
        const st = fs.statSync(p);
        if (st.isFile() || (isWin && st.size === 0)) hits.push(p);
      } catch { /* missing */ }
    }
  }
  // Windows Store "python.exe" stubs live in WindowsApps and only open the Store
  const real = hits.filter((h) => !/WindowsApps/i.test(h));
  return real[0] ?? null;
}

export function toolchain(refresh = false): ToolchainInfo {
  if (cache && !refresh) return cache;
  const python = isWin ? findExecutable('python') ?? findExecutable('py') : findExecutable('python3') ?? findExecutable('python');
  cache = {
    latexmk: findExecutable('latexmk'),
    engines: { pdflatex: findExecutable('pdflatex'), lualatex: findExecutable('lualatex'), xelatex: findExecutable('xelatex') },
    bibtex: findExecutable('bibtex'),
    biber: findExecutable('biber'),
    synctex: findExecutable('synctex'),
    python,
    git: findExecutable('git'),
  };
  return cache;
}

/** Augmented environment so child processes find TeX even when PATH lacks it. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const tc = toolchain();
  const dirs = new Set<string>();
  for (const p of [tc.latexmk, tc.engines.pdflatex, tc.engines.lualatex, tc.python, tc.git]) if (p) dirs.add(path.dirname(p));
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const cur = process.env[key] ?? '';
  return { ...process.env, [key]: [...dirs, cur].join(path.delimiter), PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...extra };
}
