// File → Save as template: keep this project's layout (class, preamble, structure) and/or
// its Document setup style for new projects.
import { useState } from 'react';
import { api, getState, guard, saveAll, setState, toast, useStore } from '../store';
import { Dialog } from './Chrome';
import { flushVisual } from '../visual/VisualEditor';
import { skeletonize, stripGenerated } from '../../shared/latex/skeleton';

const close = () => setState({ dialog: null });
const MAX_FILE = 400_000;

export function SaveTemplateDialog() {
  const open = useStore((s) => s.dialog === 'saveTemplate');
  return open && getState().project ? <SaveTemplateBody /> : null;
}

function SaveTemplateBody() {
  const project = useStore((s) => s.project)!;
  const m = project.manifest;
  const [name, setName] = useState(`${m.name} template`);
  const [description, setDescription] = useState('');
  const [layout, setLayout] = useState(true);
  const [structureOnly, setStructureOnly] = useState(true);
  const [style, setStyle] = useState(true);
  const [withBib, setWithBib] = useState(false);
  const [busy, setBusy] = useState(false);
  const texFiles = project.files.filter((f) => (f.kind === 'tex' || (withBib && f.kind === 'bib')) && !f.generated && !f.path.startsWith('runs/') && f.size <= MAX_FILE);

  const save = async () => {
    setBusy(true);
    try {
      flushVisual();
      await saveAll();
      let files: Record<string, string> | undefined;
      if (layout) {
        files = {};
        for (const f of texFiles) {
          let text = getState().files[f.path]?.text ?? await api.readText(project.root, f.path);
          if (f.path === m.mainFile) text = structureOnly ? skeletonize(text) : stripGenerated(text);
          files[f.path] = text;
        }
      }
      const t = await guard(() => api.saveTemplate({
        name: name.trim(), description: description.trim(), layout, style, baseType: m.reportType,
        files, mainFile: layout ? m.mainFile : undefined, theme: style ? m.theme : undefined, engine: m.engine,
      }), 'Could not save the template');
      if (t) { close(); toast(`Saved template “${t.name}”. Find it under Your templates on the Home screen.`, 'ok'); }
    } finally { setBusy(false); }
  };

  return (
    <Dialog title="Save as template" onClose={close} footer={<>
      <button className="btn" onClick={close}>Cancel</button>
      <button className="btn btn-pri" disabled={busy || !name.trim() || (!layout && !style)} onClick={() => void save()}>{busy ? 'Saving…' : 'Save template'}</button>
    </>}>
      <label className="f">Name<input className="field" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label className="f">Description <span className="small muted">(optional)</span><input className="field" value={description} placeholder="e.g. Department model documentation, 2026 format" onChange={(e) => setDescription(e.target.value)} /></label>
      <label className="chk"><input type="checkbox" checked={layout} onChange={(e) => setLayout(e.target.checked)} /><span><b style={{ fontWeight: 600 }}>Layout</b> <span className="small muted">— document class, preamble, front matter and section structure ({texFiles.length} file{texFiles.length === 1 ? '' : 's'})</span></span></label>
      {layout && (
        <div className="col" style={{ gap: 4, paddingLeft: 24 }} role="radiogroup" aria-label="Content">
          <label className="chk"><input type="radio" name="tpl-content" checked={structureOnly} onChange={() => setStructureOnly(true)} />Structure only: headings, title and abstract, with placeholder text</label>
          <label className="chk"><input type="radio" name="tpl-content" checked={!structureOnly} onChange={() => setStructureOnly(false)} />Keep all text (boilerplate, standard wording)</label>
          <label className="chk"><input type="checkbox" checked={withBib} onChange={(e) => setWithBib(e.target.checked)} />Include the bibliography (.bib)</label>
        </div>
      )}
      <label className="chk"><input type="checkbox" checked={style} onChange={(e) => setStyle(e.target.checked)} /><span><b style={{ fontWeight: 600 }}>Style</b> <span className="small muted">— Document setup: paper, margins, fonts, spacing, colours, running heads</span></span></label>
      <div className="small muted">Generated tables and figures, scripts and data files are not included. Templates are saved for your user account and listed on the Home screen.</div>
    </Dialog>
  );
}
