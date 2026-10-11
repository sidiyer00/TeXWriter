// Locate TeX, Python and Git executables. Looks at PATH (including the *current*
// user/system PATH from the Windows registry, so tools installed after Quire started
// are found), the default MiKTeX / TeX Live install folders, and user overrides.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import type { ToolchainInfo } from '../shared/types';
import { getSettings } from './settings';

const isWin = process.platform === 'win32';
let registryDirs: string[] = [];

function expandWinVars(s: string): string {
  return s.replace(/%([^%]+)%/g, (_m, k: string) => process.env[k] ?? process.env[k.toUpperCase()] ?? `%${k}%`);
}

function regQuery(key: string, value?: string): Promise<string> {
  return new Promise((resolve) => {
    const args = ['query', key, ...(value ? ['/v', value] : ['/s'])];
    execFile('reg', args, { windowsHide: true, timeout: 5000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

/** Re-read PATH from the registry and find MiKTeX's install root. Windows only; cheap. */
export async function refreshRegistryDirs(): Promise<void> {
  if (!isWin) return;
  const dirs: string[] = [];
  for (const [key, v] of [['HKCU\\Environment', 'Path'], ['HKLM\\SYSTEM\\CurrentControlSet\\Control\\Session Manager\\Environment', 'Path']] as const) {
    const out = await regQuery(key, v);
    const m = /Path\s+REG_(?:EXPAND_)?SZ\s+(.*)/i.exec(out);
    if (m) dirs.push(...m[1].trim().split(';').map((d) => expandWinVars(d.trim())).filter(Boolean));
  }
  // MiKTeX records its install root under MiKTeX.org keys (per-user or machine-wide)
  for (const root of ['HKCU\\Software\\MiKTeX.org\\MiKTeX', 'HKLM\\Software\\MiKTeX.org\\MiKTeX']) {
    const out = await regQuery(root);
    for (const m of out.matchAll(/(?:UserInstall|CommonInstall|SharedSetup|Install)\s+REG_SZ\s+(.+)/gi)) {
      const p = m[1].trim();
      if (/^[A-Za-z]:\\/.test(p)) dirs.push(path.join(p, 'miktex', 'bin', 'x64'), path.join(p, 'miktex', 'bin'));
    }
  }
  registryDirs = [...new Set(dirs)];
}

function knownDirs(): string[] {
  const dirs: string[] = [];
  if (isWin) {
    const la = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    const pf = process.env.ProgramFiles ?? 'C:\\Program Files';
    const pf86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    for (const base of [path.join(la, 'Programs', 'MiKTeX'), path.join(pf, 'MiKTeX'), path.join(pf86, 'MiKTeX'), 'C:\\MiKTeX']) {
      dirs.push(path.join(base, 'miktex', 'bin', 'x64'), path.join(base, 'miktex', 'bin'));
    }
    for (const root of ['C:\\texlive', path.join(os.homedir(), 'texlive')]) {
      try {
        for (const y of fs.readdirSync(root).filter((d) => /^\d{4}$/.test(d)).sort().reverse()) {
          dirs.push(path.join(root, y, 'bin', 'windows'), path.join(root, y, 'bin', 'win64'), path.join(root, y, 'bin', 'win32'));
        }
      } catch { /* not installed */ }
    }
    for (const pyRoot of [path.join(la, 'Programs', 'Python'), pf]) {
      try { for (const d of fs.readdirSync(pyRoot)) if (/^Python\d/i.test(d)) dirs.push(path.join(pyRoot, d)); } catch { /* none */ }
    }
    dirs.push(path.join(os.homedir(), 'anaconda3'), path.join(os.homedir(), 'miniconda3'), path.join(la, 'anaconda3'));
    dirs.push(path.join(pf, 'Git', 'cmd'), 'C:\\Strawberry\\perl\\bin');
  } else {
    dirs.push('/Library/TeX/texbin', '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin');
    try { for (const y of fs.readdirSync('/usr/local/texlive').filter((d) => /^\d{4}$/.test(d)).sort().reverse()) dirs.push(`/usr/local/texlive/${y}/bin/x86_64-linux`); } catch { /* none */ }
  }
  return dirs;
}

let cache: ToolchainInfo | null = null;

function searchDirs(extraFirst: string[] = []): string[] {
  const envPath = (process.env.PATH ?? '').split(path.delimiter);
  return [...new Set([...extraFirst, ...envPath, ...registryDirs, ...knownDirs()].filter(Boolean))];
}

export function findExecutable(name: string, extraFirst: string[] = []): string | null {
  const exts = isWin ? (process.env.PATHEXT ?? '.EXE;.CMD;.BAT;.COM').split(';').map((e) => e.toLowerCase()) : [''];
  for (const d of searchDirs(extraFirst)) {
    for (const e of exts) {
      const p = path.join(d, name + e);
      try {
        const st = fs.statSync(p);
        // Windows Store "python.exe" stubs live in WindowsApps and only open the Store
        if ((st.isFile() || (isWin && st.size === 0)) && !/WindowsApps/i.test(p)) return p;
      } catch { /* missing */ }
    }
  }
  return null;
}

export function toolchain(refresh = false): ToolchainInfo {
  if (cache && !refresh) return cache;
  const s = getSettings();
  const texFirst = s.texBinDir ? [s.texBinDir] : [];
  const pdflatex = findExecutable('pdflatex', texFirst);
  const texBin = pdflatex ? path.dirname(pdflatex) : null;
  // prefer tools from the same distribution as pdflatex
  const tex = (n: string) => findExecutable(n, [...texFirst, ...(texBin ? [texBin] : [])]);
  let python: string | null = null;
  if (s.pythonPath && fs.existsSync(s.pythonPath)) python = s.pythonPath;
  else python = isWin ? findExecutable('python') ?? findExecutable('py') : findExecutable('python3') ?? findExecutable('python');
  const latexmk = tex('latexmk');
  cache = {
    latexmk,
    engines: { pdflatex, lualatex: tex('lualatex'), xelatex: tex('xelatex') },
    bibtex: tex('bibtex'),
    biber: tex('biber'),
    synctex: tex('synctex'),
    python,
    git: findExecutable('git'),
    perl: findExecutable('perl'),
    texBin,
    distribution: !texBin ? null : /miktex/i.test(texBin) ? 'MiKTeX' : /texlive|tex live/i.test(texBin) ? 'TeX Live' : fs.existsSync(path.join(texBin, isWin ? 'miktex-console.exe' : 'miktex')) ? 'MiKTeX' : 'TeX',
  };
  return cache;
}

/** Augmented environment so child processes find TeX even when PATH lacks it. */
export function childEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const tc = toolchain();
  const dirs = new Set<string>();
  for (const p of [tc.latexmk, tc.engines.pdflatex, tc.engines.lualatex, tc.python, tc.git, tc.perl]) if (p) dirs.add(path.dirname(p));
  const key = Object.keys(process.env).find((k) => k.toLowerCase() === 'path') ?? 'PATH';
  const cur = process.env[key] ?? '';
  return { ...process.env, [key]: [...dirs, cur].join(path.delimiter), PYTHONIOENCODING: 'utf-8', PYTHONUNBUFFERED: '1', ...extra };
}
