// App-wide settings (per user, not per project): stored in userData/settings.json.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { app } from 'electron';
import type { AppSettings } from '../shared/types';

const DEFAULTS = (): AppSettings => ({
  userName: (() => { try { return os.userInfo().username; } catch { return 'Author'; } })(),
  projectsDir: '',
  texBinDir: '',
  pythonPath: '',
  autoInstallPackages: true,
  spellcheck: true,
  spellLanguage: 'en-US',
  uiZoom: 1,
});

let cached: AppSettings | null = null;
const file = () => path.join(app.getPath('userData'), 'settings.json');

export function getSettings(): AppSettings {
  if (cached) return cached;
  try { cached = { ...DEFAULTS(), ...JSON.parse(fs.readFileSync(file(), 'utf8')) }; } catch { cached = DEFAULTS(); }
  return cached!;
}

/** Where new/sample projects are created and exports default to (Settings → Projects folder). */
export function projectsDir(): string {
  return getSettings().projectsDir || path.join(app.getPath('documents'), 'TeXWriter');
}

export function saveSettings(patch: Partial<AppSettings>): AppSettings {
  cached = { ...getSettings(), ...patch };
  fs.mkdirSync(path.dirname(file()), { recursive: true });
  fs.writeFileSync(file(), JSON.stringify(cached, null, 2));
  return cached;
}
