// Pasted and dropped images become figures. The image is written into the project's
// figures/ folder first, so the document never points outside the project.
import type { EditorView } from '@tiptap/pm/view';
import { TextSelection } from '@tiptap/pm/state';
import { api, getState, guard, setState, toast } from '../store';
import { insertBlockNode } from './clipboard';

/** Formats LaTeX's \includegraphics takes as they are; anything else is converted to PNG. */
const KEEP: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'application/pdf': 'pdf' };

export function isFigureFile(f: File): boolean {
  return f.type.startsWith('image/') || f.type === 'application/pdf';
}

/** Image files on a clipboard or drop, but not the picture Word or a browser adds next to copied text. */
export function figureFiles(dt: DataTransfer | null, allowWithText: boolean): File[] {
  if (!dt) return [];
  const files = Array.from(dt.files ?? []).filter(isFigureFile);
  if (!files.length) return [];
  if (!allowWithText && (dt.getData('text/plain') ?? '').trim()) return [];
  return files;
}

async function toPng(file: File): Promise<Uint8Array> {
  const bmp = await createImageBitmap(file);
  const c = document.createElement('canvas');
  c.width = bmp.width;
  c.height = bmp.height;
  c.getContext('2d')!.drawImage(bmp, 0, 0);
  const blob = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/png'));
  if (!blob) throw new Error('Could not convert the image to PNG.');
  return new Uint8Array(await blob.arrayBuffer());
}

function stamp() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** File name for a pasted file: its own name when it has a real one, else pasted-<time>. */
function fileName(f: File, ext: string): string {
  const stem = f.name.replace(/\.[^.]+$/, '');
  const generic = !stem || /^(image|blob|clipboard|untitled)$/i.test(stem);
  return `${generic ? `pasted-${stamp()}` : stem}.${ext}`;
}

/** Write the file into figures/ and return its project-relative path. */
async function saveFigureFile(root: string, f: File): Promise<string | undefined> {
  const keep = KEEP[f.type];
  return guard(async () => {
    const bytes = keep ? new Uint8Array(await f.arrayBuffer()) : await toPng(f);
    return api.writeAsset(root, 'figures', fileName(f, keep ?? 'png'), bytes);
  }, 'Could not save the image');
}

function freeLabel(stem: string, taken: Set<string>): string {
  const base = `fig:${stem.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'figure'}`;
  let l = base;
  for (let k = 2; taken.has(l); k++) l = `${base}-${k}`;
  taken.add(l);
  return l;
}

/**
 * Save the files into the project and insert one figure block each at the cursor (or at
 * `at`, a document position from a drop).
 */
export async function insertFigureFiles(view: EditorView, files: File[], at?: number) {
  const p = getState().project;
  if (!p || !files.length) return;
  const taken = new Set(getState().labels.keys());
  const saved: string[] = [];
  for (const f of files) {
    const rel = await saveFigureFile(p.root, f);
    if (rel) saved.push(rel);
  }
  if (!saved.length || view.isDestroyed) return;
  // the preview needs the new files in the project list
  const pr = await api.reloadProject(p.root);
  setState((s) => ({ project: s.project ? { ...s.project, files: pr.files } : s.project }));
  if (at !== undefined) {
    const $p = view.state.doc.resolve(Math.max(0, Math.min(at, view.state.doc.content.size)));
    const sel = TextSelection.findFrom($p, 1, true) ?? TextSelection.findFrom($p, -1, true);
    if (sel) view.dispatch(view.state.tr.setSelection(sel));
  }
  for (const rel of saved) {
    const stem = rel.split('/').pop()!.replace(/\.[^.]+$/, '');
    const pos = insertBlockNode(view, { type: 'figureBlock', attrs: { path: rel, caption: 'Caption.', label: freeLabel(stem, taken), width: '0.8\\linewidth', placement: 'htbp', env: 'figure' } });
    // the next figure goes after this one
    const after = pos + (view.state.doc.nodeAt(pos)?.nodeSize ?? 0);
    const sel = TextSelection.findFrom(view.state.doc.resolve(Math.min(after, view.state.doc.content.size)), 1, true);
    if (sel) view.dispatch(view.state.tr.setSelection(sel));
  }
  view.focus();
  toast(saved.length === 1 ? `Image saved as ${saved[0]} and inserted as a figure.` : `${saved.length} images saved in figures/ and inserted as figures.`, 'ok');
}
