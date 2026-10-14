// Turning a finished document into a reusable layout, and filling a layout in for a new
// project: keep the class, preamble, front matter and headings; drop the content.
import { parseDocument, serializeDocument, toDocJson } from './blocks';
import type { JNode } from './model';
import { matchGroup } from './scan';

/** Raw blocks that are structure, not content (title, contents, appendix, bibliography…). */
const STRUCTURE = /^\\(maketitle|tableofcontents|listoffigures|listoftables|appendix|frontmatter|mainmatter|backmatter|bibliography|bibliographystyle|printbibliography|addbibresource|clearpage|cleardoublepage|newpage|onecolumn|twocolumn)\b/;
const KEEP_ENVS = /^\\begin\{(abstract|titlepage|keywords|IEEEkeywords|acknowledgements?)\}/;

const fresh = (n: JNode): JNode => ({ ...n, attrs: { ...(n.attrs ?? {}), src: null, sig: null, gap: '\n\n' } });
const placeholder = (text: string): JNode => fresh({ type: 'paragraph', content: [{ type: 'text', text }] });

/**
 * The document with its content replaced by placeholders: headings (with labels), front
 * matter, abstract/title-page environments (emptied) and bibliography commands stay;
 * paragraphs, tables, figures, equations, lists and generated blocks go. The preamble and
 * everything after \end{document} are kept byte for byte.
 */
export function skeletonize(tex: string): string {
  const p = parseDocument(tex);
  if (!p.hasDocument) return tex;
  const doc = toDocJson(p);
  const out: JNode[] = [];
  let open = false; // a heading still waiting for its placeholder
  const close = () => { if (open) out.push(placeholder('[Write this section.]')); open = false; };
  for (const n of doc.content ?? []) {
    if (n.type === 'heading') { close(); out.push(n); open = true; continue; }
    if (n.type === 'pageBreak') { close(); out.push(n); continue; }
    if (n.type === 'rawBlock') {
      const src = String(n.attrs?.latex ?? '').trim();
      if (STRUCTURE.test(src)) { close(); out.push(n); continue; }
      const env = KEEP_ENVS.exec(src);
      if (env) {
        close();
        // keep the environment and any argument on its first line; empty its content
        const first = src.split('\n')[0];
        out.push(fresh({ type: 'rawBlock', attrs: { label: 'LaTeX', latex: `${first}\n[${env[1][0].toUpperCase()}${env[1].slice(1)}.]\n\\end{${env[1]}}` } }));
        continue;
      }
    }
    // content: dropped (one placeholder per section)
  }
  close();
  if (!out.length) out.push(placeholder('[Start writing here.]'));
  return serializeDocument(p.prefix, { type: 'doc', content: out }, p.suffix, p.leading).tex;
}

const esc = (s: string) => s.replace(/([%&#_$])/g, '\\$1');

/** Replace the argument of the first \cmd{…} in the preamble (title, author…); no-op if absent. */
function replaceArg(tex: string, cmd: string, value: string): string {
  const begin = tex.indexOf('\\begin{document}');
  const head = begin < 0 ? tex : tex.slice(0, begin);
  const m = new RegExp(`\\\\${cmd}\\s*(\\[[^\\]]*\\])?\\s*\\{`).exec(head);
  if (!m) return tex;
  const open = m.index + m[0].length - 1;
  const end = matchGroup(tex, open);
  if (end < 0) return tex;
  return tex.slice(0, open + 1) + value + tex.slice(end - 1);
}

/** Put a new project's title and author into a layout's \title and \author. */
export function personalize(tex: string, o: { title: string; author?: string }): string {
  let t = replaceArg(tex, 'title', esc(o.title));
  if (o.author) t = replaceArg(t, 'author', esc(o.author));
  return t;
}

/** Drop generated-content blocks (they belong to one project's test runs and data files). */
export function stripGenerated(tex: string): string {
  const p = parseDocument(tex);
  if (!p.hasDocument) return tex;
  const doc = toDocJson(p);
  const content = (doc.content ?? []).filter((n) => n.type !== 'generatedBlock');
  if (content.length === (doc.content ?? []).length) return tex;
  return serializeDocument(p.prefix, { type: 'doc', content: content.length ? content : [placeholder('[Start writing here.]')] }, p.suffix, p.leading).tex;
}
