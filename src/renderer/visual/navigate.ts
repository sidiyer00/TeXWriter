// Following references: labels, citations and links (Ctrl+click, context menu, F12).
import { NodeSelection } from '@tiptap/pm/state';
import { api, getState, gotoSource, mainFile, openFile, toast, manifest } from '../store';
import { editorRef } from './editorRef';
import { scrollToBlock } from './VisualEditor';

function nodeHasLabel(n: import('@tiptap/pm/model').Node, key: string): boolean {
  const a = n.attrs ?? {};
  if (a.label === key) return true;
  if (n.type.name === 'generatedBlock') return manifest().blocks[a.id]?.label === key;
  if (n.type.name === 'rawBlock') return String(a.latex ?? '').includes(`\\label{${key}}`);
  return false;
}

function lineOfLabel(text: string, key: string): number | null {
  const i = text.indexOf(`\\label{${key}}`);
  return i < 0 ? null : text.slice(0, i).split('\n').length;
}

/** Jump to the element that defines \label{key}. */
export async function followLabel(key: string) {
  const s = getState();
  const ed = editorRef.current;
  if (ed && s.mode !== 'source') {
    let idx = -1;
    let pos = 0;
    ed.state.doc.forEach((n, off, i) => { if (idx < 0 && nodeHasLabel(n, key)) { idx = i; pos = off; } });
    if (idx >= 0) {
      const n = ed.state.doc.child(idx);
      if (n.isAtom) ed.view.dispatch(ed.state.tr.setSelection(NodeSelection.create(ed.state.doc, pos)));
      scrollToBlock(idx);
      return;
    }
  }
  const main = s.files[mainFile()]?.text ?? '';
  const l = lineOfLabel(main, key);
  if (l) { gotoSource(mainFile(), l); return; }
  for (const f of s.project?.files ?? []) {
    if (f.kind !== 'tex' || f.path === mainFile()) continue;
    const t = await openFile(f.path).catch(() => '');
    const ln = lineOfLabel(t, key);
    if (ln) { gotoSource(f.path, ln); return; }
  }
  toast(`No \\label{${key}} found in the project.`, 'err');
}

/** Open a citation's URL/DOI, or its BibTeX entry. */
export async function followCite(key: string, preferSource = false) {
  const s = getState();
  const entry = s.bib.find((b) => b.key === key);
  if (!preferSource && entry?.url) { void api.openExternal(entry.url); return; }
  if (!preferSource && entry?.doi) { void api.openExternal(`https://doi.org/${entry.doi.replace(/^https?:\/\/(dx\.)?doi\.org\//, '')}`); return; }
  for (const f of s.project?.files ?? []) {
    if (!f.path.endsWith('.bib')) continue;
    const t = await openFile(f.path).catch(() => '');
    const i = t.search(new RegExp(`@\\w+\\s*\\{\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*,`));
    if (i >= 0) { gotoSource(f.path, t.slice(0, i).split('\n').length); return; }
  }
  toast(`No bibliography entry “${key}”.`, 'err');
}

export function followUrl(url: string) {
  if (/^https?:\/\//i.test(url)) void api.openExternal(url);
  else if (/^www\./i.test(url)) void api.openExternal(`https://${url}`);
  else toast(`Not a web address: ${url}`, 'err');
}

/** Follow whatever reference sits at a source-text offset (used by the LaTeX editor). */
export async function followInSource(line: string, col: number, file: string) {
  const around = (re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(line))) if (col >= m.index && col <= m.index + m[0].length) return m;
    return null;
  };
  let m = around(/\\(?:ref|eqref|autoref|cref|Cref|pageref|nameref)\*?\{([^}]+)\}/g);
  if (m) return followLabel(m[1].trim());
  m = around(/\\(?:cite[a-z]*|parencite|textcite|autocite)\*?(?:\[[^\]]*\]){0,2}\{([^}]+)\}/g);
  if (m) {
    // the key under the cursor
    const keysStart = m.index + m[0].indexOf('{', m[0].lastIndexOf(']') + 1) + 1;
    let k = m[1].split(',').map((x) => x.trim())[0];
    let p = keysStart;
    for (const part of m[1].split(',')) { if (col >= p && col <= p + part.length) { k = part.trim(); break; } p += part.length + 1; }
    return followCite(k);
  }
  m = around(/\\(?:url|href)\{([^}]+)\}/g);
  if (m) return followUrl(m[1]);
  m = around(/\\(?:input|include|includegraphics|subfile)(?:\[[^\]]*\])?\{([^}]+)\}/g);
  if (m) {
    const name = m[1].trim();
    const files = getState().project?.files ?? [];
    const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/') + 1) : '';
    const cand = [name, `${name}.tex`, `${dir}${name}`, `${dir}${name}.tex`, `${name}.pdf`, `${name}.png`];
    const hit = files.find((f) => cand.includes(f.path));
    if (hit && (hit.kind === 'tex' || hit.kind === 'bib' || hit.kind === 'text' || hit.kind === 'code')) return gotoSource(hit.path, 1);
    if (hit) return void api.revealInFolder(`${getState().project!.root}/${hit.path}`);
    toast(`${name} is not in the project.`, 'err');
    return;
  }
  m = around(/\\label\{([^}]+)\}/g);
  if (m) toast(`This defines “${m[1]}”. References to it: ${(getState().files[mainFile()]?.text.match(new RegExp(`\\\\[a-zA-Z]*ref\\{${m[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\}`, 'g')) ?? []).length}`);
}
