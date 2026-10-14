// Templates the user saved: one JSON file each in <userData>/templates. Copy a file to a
// colleague's templates folder (Home → Your templates → Open folder) to share it.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { app } from 'electron';
import type { UserTemplate, UserTemplateInput } from '../shared/types';

/** Files kept with a template imported from a .tex file. */
const TEXT_EXT = /\.(tex|sty|cls|bib|bst|cfg|def|clo)$/i;
const MAX_BYTES = 2_000_000;

export function templatesDir(): string {
  return path.join(app.getPath('userData'), 'templates');
}

const fileFor = (id: string) => {
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(id)) throw new Error(`Bad template id: ${id}`);
  return path.join(templatesDir(), `${id}.json`);
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'template';
}

function size(t: UserTemplateInput): number {
  return Object.values(t.files ?? {}).reduce((n, s) => n + s.length, 0);
}

export async function listTemplates(): Promise<UserTemplate[]> {
  let names: string[];
  try { names = await fsp.readdir(templatesDir()); } catch { return []; }
  const out: UserTemplate[] = [];
  for (const n of names.filter((x) => x.endsWith('.json'))) {
    try {
      const t = JSON.parse(await fsp.readFile(path.join(templatesDir(), n), 'utf8')) as UserTemplate;
      if (t && t.id && t.name) out.push(t);
    } catch { /* skip unreadable files */ }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export async function readTemplate(id: string): Promise<UserTemplate> {
  try { return JSON.parse(await fsp.readFile(fileFor(id), 'utf8')) as UserTemplate; } catch { throw new Error('That template no longer exists.'); }
}

export async function saveTemplate(input: UserTemplateInput): Promise<UserTemplate> {
  if (!input.name.trim()) throw new Error('Give the template a name.');
  if (!input.layout && !input.style) throw new Error('A template needs a layout, a style, or both.');
  if (size(input) > MAX_BYTES) throw new Error('The template is larger than 2 MB. Leave out large files (data, long chapters) and try again.');
  for (const rel of Object.keys(input.files ?? {})) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new Error(`Bad file path in template: ${rel}`);
  }
  await fsp.mkdir(templatesDir(), { recursive: true });
  let id = input.id;
  if (!id) {
    const base = slug(input.name);
    id = base;
    let k = 2;
    while (fs.existsSync(fileFor(id))) id = `${base}-${k++}`;
  }
  const t: UserTemplate = { ...input, id, name: input.name.trim(), createdAt: new Date().toISOString() };
  const tmp = fileFor(id) + '.tmp';
  await fsp.writeFile(tmp, JSON.stringify(t, null, 2), 'utf8');
  await fsp.rename(tmp, fileFor(id));
  return t;
}

export async function deleteTemplate(id: string): Promise<void> {
  await fsp.rm(fileFor(id), { force: true });
}

/** A .tex file from a journal or university, plus the class, style and bib files beside it. */
export async function importTemplateFile(absPath: string, name: string): Promise<UserTemplate> {
  const main = await fsp.readFile(absPath, 'utf8');
  if (!/\\documentclass/.test(main)) throw new Error('That file has no \\documentclass, so it is not a complete document.');
  if (!/\\begin\{document\}/.test(main)) throw new Error('That file has no \\begin{document}.');
  const dir = path.dirname(absPath);
  const mainFile = path.basename(absPath);
  const files: Record<string, string> = { [mainFile]: main };
  let total = main.length;
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || e.name === mainFile || !TEXT_EXT.test(e.name)) continue;
    const st = await fsp.stat(path.join(dir, e.name));
    if (total + st.size > MAX_BYTES) continue;
    // other complete documents in the folder are not part of this template
    const text = await fsp.readFile(path.join(dir, e.name), 'utf8');
    if (/\.tex$/i.test(e.name) && /\\documentclass/.test(text)) continue;
    files[e.name] = text;
    total += st.size;
  }
  return saveTemplate({ name: name || path.basename(absPath, '.tex'), description: `Imported from ${mainFile}`, layout: true, style: false, baseType: 'blank', files, mainFile });
}
