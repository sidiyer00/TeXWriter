// TipTap schema for the visual editor. Mirrors src/shared/latex/model.ts.
import { Extension, Node, mergeAttributes, nodeInputRule } from '@tiptap/core';
import { NodeViewContent, NodeViewWrapper, ReactNodeViewRenderer, type ReactNodeViewProps } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Heading from '@tiptap/extension-heading';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { createLowlight, common } from 'lowlight';
import Placeholder from '@tiptap/extension-placeholder';
import { NodeSelection, Plugin, PluginKey, TextSelection } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import katex from 'katex';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { TableView } from '../../shared/generate';
import { numberDocument, refDisplay, shortAuthor } from '../../shared/latex/refs';
import type { JNode } from '../../shared/latex/model';
import { getState, useStore, gotoSource, mainFile, mainBlockLines, api, setState, openTab, runGenerator, showBlock, unlinkBlock } from '../store';
import { Refresh, Link } from '../components/Icons';
import { loadPdfCached, renderPage } from '../pdf';
import { parseInline } from '../../shared/latex/inline';
import { TextColor, TeXWriterHighlight } from './marks';
import { TableBlock, QTable, QTableRow, QTableHeader, QTableCell } from './table';
import { SpreadsheetClipboard } from './clipboard';
import { Find } from './find';
import { isMod } from '../keys';
import { Comments } from './comments';
import { followCite, followLabel, followUrl } from './navigate';

const META_TYPES = ['paragraph', 'heading', 'bulletList', 'orderedList', 'mathBlock', 'generatedBlock', 'figureBlock', 'calloutBlock', 'codeBlock', 'pageBreak', 'rawBlock', 'tableBlock'];

export const BlockMeta = Extension.create({
  name: 'blockMeta',
  addGlobalAttributes() {
    return [{
      types: META_TYPES,
      attributes: {
        src: { default: null, rendered: false, keepOnSplit: false },
        sig: { default: null, rendered: false, keepOnSplit: false },
        gap: { default: '\n\n', rendered: false, keepOnSplit: false },
      },
    }];
  },
});

// ---------------------------------------------------------------- numbering

export const numberingKey = new PluginKey<DecorationSet>('texwriter-numbering');
export const syncKey = new PluginKey<number | null>('texwriter-sync');

function numberDecorations(doc: any): DecorationSet {
  const json = doc.toJSON() as JNode;
  const { numbers } = numberDocument(json, getState().project?.manifest.blocks ?? {});
  const decos: Decoration[] = [];
  let pos = 0;
  doc.forEach((node: any, offset: number, index: number) => {
    pos = offset;
    const num = numbers.get(index);
    if (node.type.name === 'heading') {
      const attrs: Record<string, string> = {};
      if (num) attrs['data-num'] = num;
      if (node.attrs.label) attrs['data-label'] = node.attrs.label;
      decos.push(Decoration.node(pos, pos + node.nodeSize, attrs));
    } else if (num) {
      decos.push(Decoration.node(pos, pos + node.nodeSize, { 'data-num': num }, { num }));
    }
  });
  return DecorationSet.create(doc, decos);
}

export const Numbering = Extension.create({
  name: 'numbering',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: numberingKey,
        state: {
          init: (_, s) => numberDecorations(s.doc),
          apply: (tr, old) => (tr.docChanged || tr.getMeta(numberingKey) ? numberDecorations(tr.doc) : old.map(tr.mapping, tr.doc)),
        },
        props: { decorations: (s) => numberingKey.getState(s) },
      }),
      new Plugin({
        key: syncKey,
        state: {
          init: () => null,
          apply: (tr, old) => { const m = tr.getMeta(syncKey); return m !== undefined ? m : old; },
        },
        props: {
          decorations: (s) => {
            const idx = syncKey.getState(s);
            if (idx === null || idx === undefined || idx >= s.doc.childCount) return null;
            let pos = 0;
            for (let i = 0; i < idx; i++) pos += s.doc.child(i).nodeSize;
            const n = s.doc.child(idx);
            return DecorationSet.create(s.doc, [Decoration.node(pos, pos + n.nodeSize, { class: 'sync-target' })]);
          },
        },
      }),
    ];
  },
});

function numFrom(props: ReactNodeViewProps): string | undefined {
  const ds = (props.decorations ?? []) as unknown as { spec?: { num?: string } }[];
  return ds.find((d) => d.spec?.num)?.spec?.num;
}

function topIndex(props: ReactNodeViewProps): number {
  const pos = typeof props.getPos === 'function' ? props.getPos() : undefined;
  if (pos === undefined) return -1;
  return props.editor.state.doc.resolve(pos).index(0);
}

function jumpToBlockSource(props: ReactNodeViewProps) {
  const idx = topIndex(props);
  const lines = mainBlockLines();
  const l = lines[idx];
  gotoSource(mainFile(), l ? l[0] : 1);
}

// ---------------------------------------------------------------- generic atom helper

function atom(name: string, opts: { inline?: boolean; attrs: Record<string, unknown>; view: (p: ReactNodeViewProps) => ReactElement; group?: string; inputRule?: RegExp; inputAttrs?: (m: RegExpMatchArray) => Record<string, unknown> }) {
  const tag = opts.inline ? 'span' : 'div';
  return Node.create({
    name,
    group: opts.group ?? (opts.inline ? 'inline' : 'block'),
    inline: !!opts.inline,
    atom: true,
    selectable: true,
    draggable: !opts.inline,
    addAttributes() {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(opts.attrs)) out[k] = { default: v, rendered: false };
      return out;
    },
    parseHTML() {
      return [{
        tag: `${tag}[data-qtype="${name}"]`,
        getAttrs: (el) => { try { return JSON.parse((el as HTMLElement).dataset.qattrs ?? '{}'); } catch { return {}; } },
      }];
    },
    renderHTML({ node }) {
      const a: Record<string, unknown> = { ...node.attrs };
      delete a.src; delete a.sig; delete a.gap;
      return [tag, mergeAttributes({ 'data-qtype': name, 'data-qattrs': JSON.stringify(a) })];
    },
    // Inline chips hold no inputs, so ProseMirror handles all their events. Without this
    // a drag that starts on (or contains) a chip became a native DOM drag and dropped the
    // chip's rendered text ("Table 5.3") instead of the \autoref node.
    addNodeView() { return ReactNodeViewRenderer(opts.view, opts.inline ? { as: 'span', className: 'inline-atom', stopEvent: () => false } : {}); },
    addInputRules() {
      if (!opts.inputRule) return [];
      return [nodeInputRule({ find: opts.inputRule, type: this.type, getAttributes: opts.inputAttrs })];
    },
  });
}

// ---------------------------------------------------------------- KaTeX

const KATEX_MACROS = { '\\RR': '\\mathbb{R}', '\\E': '\\mathbb{E}', '\\Prob': '\\mathbb{P}' };
export function texToHtml(latex: string, display: boolean): { html: string; error?: string } {
  try {
    return { html: katex.renderToString(latex, { displayMode: display, throwOnError: true, strict: 'ignore', macros: { ...KATEX_MACROS }, trust: false }) };
  } catch (e) {
    return { html: katex.renderToString(latex, { displayMode: display, throwOnError: false, strict: 'ignore', macros: { ...KATEX_MACROS } }), error: (e as Error).message };
  }
}

function MathBlockView(props: ReactNodeViewProps) {
  const a = props.node.attrs;
  const env: string = a.env;
  const body = /^align|^gather|^multline/.test(env) ? `\\begin{aligned}${a.latex}\\end{aligned}` : a.latex;
  const r = texToHtml(body || '\\square', true);
  const num = numFrom(props);
  return (
    <NodeViewWrapper className={`eq ${r.error ? 'has-err' : ''}`} data-drag-handle="" title={r.error ? `KaTeX preview: ${r.error}` : 'Click to edit, double-click for the large editor'}
      onDoubleClick={() => { const pos = typeof props.getPos === 'function' ? props.getPos() : undefined; if (pos !== undefined) setState({ equationModal: { pos, inline: false } }); }}>
      <div className="grow" dangerouslySetInnerHTML={{ __html: r.html }} />
      <span className="eqnum">{num ? `(${num})` : ''}</span>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------- figures & assets

/** `version` changes when the file is rewritten (a regenerated figure), so the preview reloads. */
export function AssetPreview({ path, maxWidth, version }: { path: string; maxWidth?: number; version?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const r = getState().project?.root ?? '';
  const isPdf = /\.pdf$/i.test(path);
  const files = useStore((s) => s.project?.files);
  const known = !!files?.some((f) => f.path === path) || !!version;
  useEffect(() => {
    if (!isPdf || !ref.current) return;
    let cancelled = false;
    loadPdfCached(`${r}|${path}|${version ?? ''}`, () => api.readBinary(r, path))
      .then(async (doc) => { if (cancelled || !ref.current) return; const page = await doc.getPage(1); const w = page.getViewport({ scale: 1 }).width; await renderPage(doc, 1, ref.current, Math.min(1.6, (maxWidth ?? 560) / w)); })
      .catch((e) => !cancelled && setErr(String(e?.message ?? e)));
    return () => { cancelled = true; };
  }, [path, r, isPdf, maxWidth, version]);
  if (!path) return <div className="placeholder-box">No file chosen</div>;
  if (err || (!known && !isPdf && !/\.(png|jpe?g|gif|svg)$/i.test(path))) return <div className="placeholder-box">{err ? `Cannot preview ${path}` : `${path} — preview after compile`}</div>;
  if (isPdf) return <div className="figbox"><canvas ref={ref} /></div>;
  return <div className="figbox"><img src={`${api.fileUrl(r, path)}${version ? `&v=${encodeURIComponent(version)}` : ''}`} alt="" onError={() => setErr('missing')} style={{ maxWidth: maxWidth ?? 560 }} /></div>;
}

function captionText(latex: string): string {
  try { return parseInline(latex).map((n) => (n.type === 'text' ? n.text : n.type === 'inlineMath' ? n.attrs?.latex : n.type === 'crossRef' ? '??' : '')).join(''); } catch { return latex; }
}

/** Read-only rendering of inline LaTeX (captions, generated summaries). */
export function RichInline({ latex }: { latex: string }) {
  const labels = useStore((s) => s.labels);
  let nodes: JNode[];
  try { nodes = parseInline(latex); } catch { return <>{latex}</>; }
  return (
    <>
      {nodes.map((n, i) => {
        if (n.type === 'text') {
          let el: React.ReactNode = n.text;
          for (const m of n.marks ?? []) el = m.type === 'bold' ? <b>{el}</b> : m.type === 'italic' ? <i>{el}</i> : <code>{el}</code>;
          return <span key={i}>{el}</span>;
        }
        if (n.type === 'inlineMath') return <span key={i} dangerouslySetInnerHTML={{ __html: texToHtml(n.attrs?.latex ?? '', false).html }} />;
        if (n.type === 'crossRef') return <span key={i} className="chip-ref">{refDisplay(n.attrs?.cmd, labels.get(n.attrs?.key))}</span>;
        if (n.type === 'citation') return <span key={i} className="chip-cite">[{n.attrs?.keys}]</span>;
        if (n.type === 'inlineRaw') return <span key={i} className="chip-raw">{n.attrs?.latex}</span>;
        return null;
      })}
    </>
  );
}

function FigureBlockView(props: ReactNodeViewProps) {
  const a = props.node.attrs;
  const num = numFrom(props);
  return (
    <NodeViewWrapper className="blk" style={{ margin: '0 0 18px', padding: '8px 0' }} data-drag-handle="">
      <AssetPreview path={a.path} />
      <div className="cap" style={{ textAlign: 'center' }}><b>Figure {num ?? ''}</b><RichInline latex={a.caption} /></div>
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------- generated content

function ago(iso?: string) {
  if (!iso) return '';
  const d = (Date.now() - new Date(iso).getTime()) / 1000;
  if (d < 90) return 'just now';
  if (d < 3600) return `${Math.round(d / 60)} min ago`;
  if (d < 86400) return `${Math.round(d / 3600)} h ago`;
  return new Date(iso).toLocaleDateString();
}

export function TablePreview({ view }: { view: TableView }) {
  const numeric = view.columns.map((_, j) => view.rows.every((r) => /^[-+−(]?[$€£¥]?[\d,.]+%?\)?$|^—?$|^$/.test(r.cells[j] ?? '')));
  const multi = !!view.headers && view.headers.length > 1;
  return (
    <table className={`dtable ${view.style}`}>
      {multi
        ? <thead>{view.headers!.map((row, i) => <tr key={i}>{row.map((c, j) => <th key={j} colSpan={c.colspan} rowSpan={c.rowspan} className={c.colspan > 1 ? 'grp' : 'l'} scope={c.colspan > 1 ? 'colgroup' : 'col'}>{c.text}</th>)}</tr>)}</thead>
        : view.columns.some(Boolean) && <thead><tr>{view.columns.map((c, j) => <th key={j} className={numeric[j] ? 'n' : 'l'} scope="col">{c}</th>)}</tr></thead>}
      <tbody>
        {view.rows.map((r, i) => (
          <tr key={i} className={`${r.highlight ? 'hl' : ''} ${r.total ? 'total' : ''}`}>
            {r.cells.map((c, j) => <td key={j} className={numeric[j] ? 'n' : 'l'}>{c}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GeneratedBlockView(props: ReactNodeViewProps) {
  const id: string = props.node.attrs.id;
  const cfg = useStore((s) => s.project?.manifest.blocks[id]);
  const render = useStore((s) => s.renders[id]);
  const gen = useStore((s) => s.generating);
  const num = numFrom(props);
  if (!cfg) {
    return (
      <NodeViewWrapper className="blk blk-gen missing" data-drag-handle="">
        <span className="blk-tag">Unknown generated block “{id}”</span>
        <div className="small" style={{ fontFamily: 'var(--ui)' }}>No entry for this id in texwriter.json. <button className="btn btn-xs" onClick={() => jumpToBlockSource(props)}>View source</button></div>
      </NodeViewWrapper>
    );
  }
  const st = render?.status ?? 'pending';
  const running = gen?.id === id;
  const from = cfg.script ?? cfg.output ?? 'no source';
  const tag = running ? `Running ${cfg.script}…`
    : st === 'fresh' ? `Generated · ${from} · ${ago(cfg.lastRun?.at ?? cfg.refreshedAt)}`
    : st === 'pending' ? `Not generated yet · ${from}`
    : st === 'failed' ? `Last run failed · ${cfg.script}`
    : st === 'conflict' ? 'Edited in source · not linked'
    : st === 'edited' ? 'Generated file edited outside TeXWriter'
    : `Can't build · ${render?.message ?? ''}`;
  const view = render?.view;
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const run = (e: React.MouseEvent) => { stop(e); void runGenerator(id); };
  const props_ = (e: React.MouseEvent) => { stop(e); showBlock(id); };
  const placeholder = (what: string) => (
    <div className="placeholder-box">
      {running ? <span className="mono small">{gen?.log[gen.log.length - 1] ?? 'Starting…'}</span>
        : st === 'pending' ? <>{cfg.script ? <>Run <span className="mono">{cfg.script}</span> to {what}.</> : <>Waiting for <span className="mono">{cfg.output}</span>.</>}</>
        : render?.message}
      {cfg.script && !running && st !== 'conflict' && <div style={{ marginTop: 8 }}><button className="btn btn-sm btn-pri" onClick={run} disabled={!!gen}><Refresh />Run {cfg.script.split('/').pop()}</button></div>}
    </div>
  );
  return (
    <NodeViewWrapper className={`blk blk-gen ${st}`} data-drag-handle="">
      <span className="blk-tag"><Link size={11} />{tag}</span>
      <div className="blk-actions" contentEditable={false}>
        {cfg.script && <button className="tb" disabled={!!gen} onClick={run}><Refresh />{running ? 'Running…' : 'Run'}</button>}
        {cfg.script && <button className="tb" onClick={(e) => { stop(e); void openTab(cfg.script!); }}>Edit script</button>}
        {!cfg.script && cfg.output && cfg.kind === 'table' && <button className="tb" onClick={(e) => { stop(e); void openTab(cfg.output!); }}>Open data</button>}
        <button className="tb" onClick={props_}>Properties</button>
        <button className="tb" onClick={(e) => { stop(e); jumpToBlockSource(props); }}>View source</button>
      </div>
      {st === 'failed' && cfg.lastRun && <div className="gen-error small" onClick={props_} role="button" tabIndex={0}>{cfg.lastRun.error} <u>Show output</u></div>}
      {cfg.kind === 'table' && (
        <>
          <div className="cap"><b>Table {num ?? ''}</b><RichInline latex={cfg.caption ?? ''} /></div>
          {view?.kind === 'table'
            ? (view.latex ? <pre className="rawsrc">{view.latex.split('\n').slice(0, 14).join('\n')}</pre> : <div style={{ overflowX: 'auto' }}><TablePreview view={view} /></div>)
            : placeholder('fill this table')}
          {view?.kind === 'table' && cfg.sourceLine && <div className="srcline">Source: {view.sourceLine}.</div>}
        </>
      )}
      {cfg.kind === 'figure' && (
        <>
          {view?.kind === 'figure' ? <AssetPreview path={view.path} version={cfg.lastRun?.at ?? cfg.refreshedAt} /> : placeholder('draw this figure')}
          <div className="cap" style={{ textAlign: 'center' }}><b>Figure {num ?? ''}</b><RichInline latex={cfg.caption ?? ''} /></div>
        </>
      )}
      {cfg.kind === 'summary' && <div className="placeholder-box">{render?.message} <button className="btn btn-xs" onClick={(e) => { stop(e); void unlinkBlock(id); }}>Convert to static LaTeX</button></div>}
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------- raw / misc

function RawBlockView(props: ReactNodeViewProps) {
  const a = props.node.attrs;
  const latex: string = a.latex ?? '';
  const label: string = a.label || 'LaTeX';
  const one = latex.trim();
  const friendly: Record<string, string> = {
    '\\tableofcontents': 'Table of contents — generated when the PDF is compiled',
    '\\maketitle': 'Title block — from \\title, \\author and \\date in the preamble',
    '\\appendix': 'Appendices start here — following sections are lettered',
    '\\listoftables': 'List of tables', '\\listoffigures': 'List of figures',
  };
  if (friendly[one] || /^\\bibliography(style)?\{/.test(one) || /^\\printbibliography/.test(one)) {
    const text = friendly[one] ?? (/style/.test(one) ? `Bibliography style: ${/\{([^}]*)\}/.exec(one)?.[1]}` : 'Bibliography — references cited in the text are listed here');
    return <NodeViewWrapper className="blk blk-raw friendly" data-drag-handle="">{text}</NodeViewWrapper>;
  }
  const comment = label === 'Comment';
  const lines = latex.split('\n');
  return (
    <NodeViewWrapper className={`blk blk-raw ${comment ? 'comment' : ''} ${lines.length <= 2 ? 'compact' : ''}`} data-drag-handle="">
      <span className="blk-tag">{comment ? 'Comment · not printed' : `${label} · shown as source, edit in LaTeX`}</span>
      <div className="blk-actions" contentEditable={false}>
        <button className="tb" onClick={(e) => { e.stopPropagation(); jumpToBlockSource(props); }}>Edit in source</button>
      </div>
      <pre className="rawsrc">{lines.slice(0, 8).join('\n')}{lines.length > 8 ? `\n… ${lines.length - 8} more lines` : ''}</pre>
    </NodeViewWrapper>
  );
}

function PageBreakView(props: ReactNodeViewProps) {
  return <NodeViewWrapper className="pagebreak" data-drag-handle=""><span>Page break · \{props.node.attrs.cmd}</span></NodeViewWrapper>;
}

function InlineMathView(props: ReactNodeViewProps) {
  const r = texToHtml(props.node.attrs.latex || '\\square', false);
  return <NodeViewWrapper as="span" className="chip-math" title={r.error ?? props.node.attrs.latex} dangerouslySetInnerHTML={{ __html: r.html }}
    onDoubleClick={() => { const pos = typeof props.getPos === 'function' ? props.getPos() : undefined; if (pos !== undefined) setState({ equationModal: { pos, inline: true } }); }} />;
}

function CitationView(props: ReactNodeViewProps) {
  const bib = useStore((s) => s.bib);
  const keys: string[] = String(props.node.attrs.keys ?? '').split(',').map((k) => k.trim()).filter(Boolean);
  const cmd: string = props.node.attrs.cmd;
  const missing = keys.filter((k) => !bib.some((b) => b.key === k));
  if (missing.length) return <NodeViewWrapper as="span" className="chip-bad" title="Not found in the bibliography">{keys.join(', ')} ?</NodeViewWrapper>;
  const ents = keys.map((k) => bib.find((b) => b.key === k)!);
  const txt = ents.map((e) => `${shortAuthor(e.author, e.corporate) || e.key}${cmd.startsWith('citet') || cmd === 'textcite' ? ` (${e.year ?? 'n.d.'})` : ` ${e.year ?? ''}`}`).join('; ');
  return <NodeViewWrapper as="span" className="chip-cite" title={`${ents.map((e) => e.title).join('\n')}\nCtrl+click to open the source`}>{cmd.startsWith('citet') || cmd === 'textcite' ? txt : `[${txt.trim()}]`}</NodeViewWrapper>;
}

function CrossRefView(props: ReactNodeViewProps) {
  const labels = useStore((s) => s.labels);
  const key: string = props.node.attrs.key;
  const info = labels.get(key);
  if (!info) return <NodeViewWrapper as="span" className="chip-bad" title="No label with this name">{key} ?</NodeViewWrapper>;
  return <NodeViewWrapper as="span" className="chip-ref" title={`\\${props.node.attrs.cmd}{${key}} — Ctrl+click to go there`}>{refDisplay(props.node.attrs.cmd, info)}</NodeViewWrapper>;
}

function FootnoteView(props: ReactNodeViewProps) {
  return <NodeViewWrapper as="span" className="chip-fn" title={captionText(props.node.attrs.latex)}>[fn]</NodeViewWrapper>;
}

function InlineRawView(props: ReactNodeViewProps) {
  const l: string = props.node.attrs.latex;
  // simple display substitutions for common text macros
  const map: Record<string, string> = { '\\LaTeX{}': 'LaTeX', '\\LaTeX': 'LaTeX', '\\TeX{}': 'TeX', '\\today': new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }), '\\,': ' ', '\\-': '' };
  if (map[l] !== undefined) return <NodeViewWrapper as="span" title={l}>{map[l]}</NodeViewWrapper>;
  return <NodeViewWrapper as="span" className="chip-raw" title="LaTeX shown as source">{l}</NodeViewWrapper>;
}

function CalloutView(props: ReactNodeViewProps) {
  return (
    <NodeViewWrapper className="callout">
      <input className="ctitle" aria-label="Callout title" value={props.node.attrs.title} contentEditable={false}
        onChange={(e) => props.updateAttributes({ title: e.target.value })} />
      <NodeViewContent />
    </NodeViewWrapper>
  );
}

// ---------------------------------------------------------------- node definitions

export const MathBlock = atom('mathBlock', { attrs: { env: 'equation', latex: '', label: '' }, view: MathBlockView });
export const GeneratedBlock = atom('generatedBlock', { attrs: { id: '', inner: '' }, view: GeneratedBlockView });
export const FigureBlock = atom('figureBlock', { attrs: { path: '', width: '0.8\\linewidth', caption: '', label: '', placement: 'htbp', env: 'figure' }, view: FigureBlockView });
export const RawBlock = atom('rawBlock', { attrs: { latex: '', label: 'LaTeX' }, view: RawBlockView });
export const PageBreak = atom('pageBreak', { attrs: { cmd: 'clearpage' }, view: PageBreakView });
export const InlineMath = atom('inlineMath', { inline: true, attrs: { latex: '', delim: 'dollar' }, view: InlineMathView, inputRule: /(?:^|\s)\$([^$\s][^$]*)\$$/, inputAttrs: (m) => ({ latex: m[1] }) });
export const Citation = atom('citation', { inline: true, attrs: { cmd: 'citep', keys: '', opts: '' }, view: CitationView });
export const CrossRef = atom('crossRef', { inline: true, attrs: { cmd: 'autoref', key: '' }, view: CrossRefView });
export const Footnote = atom('footnote', { inline: true, attrs: { latex: '' }, view: FootnoteView });
export const InlineRaw = atom('inlineRaw', { inline: true, attrs: { latex: '' }, view: InlineRawView });

export const CalloutBlock = Node.create({
  name: 'calloutBlock',
  group: 'block',
  content: 'paragraph+',
  defining: true,
  addAttributes() { return { title: { default: 'Note', rendered: false }, env: { default: 'texwritercallout', rendered: false } }; },
  parseHTML() { return [{ tag: 'div[data-qtype="calloutBlock"]', getAttrs: (el) => ({ title: (el as HTMLElement).dataset.title ?? 'Note', env: (el as HTMLElement).dataset.env ?? 'texwritercallout' }) }]; },
  renderHTML({ node }) { return ['div', { 'data-qtype': 'calloutBlock', 'data-title': node.attrs.title, 'data-env': node.attrs.env }, 0]; },
  addNodeView() { return ReactNodeViewRenderer(CalloutView); },
});

const QHeading = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      cmd: { default: null, rendered: false, keepOnSplit: false },
      star: { default: false, rendered: false, keepOnSplit: false },
      label: { default: '', rendered: false, keepOnSplit: false },
    };
  },
}).configure({ levels: [1, 2, 3] });

const lowlight = createLowlight(common);
lowlight.registerAlias({ python: ['Python', 'py'], r: ['R'], sql: ['SQL'], cpp: ['C++', 'cpp'], java: ['Java'], bash: ['Bash', 'sh'], latex: ['TeX', 'LaTeX'] });

const QCodeBlock = CodeBlockLowlight.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      env: { default: 'lstlisting', rendered: false },
      opts: { default: '', rendered: false },
    };
  },
  renderHTML({ node }) {
    return ['pre', { 'data-language': node.attrs.language || null, spellcheck: 'false' }, ['code', { class: node.attrs.language ? `language-${String(node.attrs.language).toLowerCase()}` : null, spellcheck: 'false' }, 0]];
  },
}).configure({ lowlight, defaultLanguage: null });

const PROTECTED = new Set(['rawBlock', 'generatedBlock', 'mathBlock', 'figureBlock', 'pageBreak']);

/** Ctrl+click follows cross-references, citations and links. */
export const FollowLinks = Extension.create({
  name: 'followLinks',
  addProseMirrorPlugins() {
    return [new Plugin({
      props: {
        handleClickOn: (_view, _pos, node, _nodePos, event) => {
          if (!isMod(event)) return false;
          if (node.type.name === 'crossRef') { void followLabel(node.attrs.key); return true; }
          if (node.type.name === 'citation') { void followCite(String(node.attrs.keys).split(',')[0].trim()); return true; }
          if (node.type.name === 'inlineRaw') {
            const m = /\\(?:url|href)\{([^}]+)\}/.exec(node.attrs.latex);
            if (m) { followUrl(m[1]); return true; }
          }
          return false;
        },
        handleClick: (view, pos, event) => {
          if (!isMod(event)) return false;
          const $p = view.state.doc.resolve(pos);
          const link = $p.marks().find((m) => m.type.name === 'link') ?? view.state.doc.nodeAt(pos)?.marks.find((m) => m.type.name === 'link');
          if (link) { followUrl(link.attrs.href); return true; }
          return false;
        },
      },
    })];
  },
});

/**
 * Typing while a block atom (raw LaTeX, generated table, equation…) is selected would
 * replace it. Word-processor users expect the text to go next to it instead.
 */
export const ProtectAtoms = Extension.create({
  name: 'protectAtoms',
  addProseMirrorPlugins() {
    const after = (view: any, text: string | null) => {
      const sel = view.state.selection;
      if (!(sel instanceof NodeSelection) || !PROTECTED.has(sel.node.type.name)) return false;
      const pos = sel.to;
      const para = view.state.schema.nodes.paragraph.create(null, text ? view.state.schema.text(text) : null);
      const tr = view.state.tr.insert(pos, para);
      tr.setSelection(TextSelection.create(tr.doc, pos + 1 + (text?.length ?? 0)));
      view.dispatch(tr.scrollIntoView());
      return true;
    };
    return [new Plugin({
      props: {
        handleTextInput: (view, _from, _to, text) => after(view, text),
        handleKeyDown: (view, e) => (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && !e.shiftKey ? after(view, null) : false),
      },
    })];
  },
});

/** App-level shortcuts win over editor defaults (Mod-Enter would insert a hard break). */
const AppKeys = Extension.create({
  name: 'appKeys',
  priority: 1000,
  addKeyboardShortcuts() {
    return { 'Mod-Enter': () => true, 'Mod-s': () => true, 'Mod-1': () => true, 'Mod-2': () => true, 'Mod-3': () => true, 'Mod-\\': () => true };
  },
});

export function extensions() {
  return [
    AppKeys,
    SpreadsheetClipboard,
    ProtectAtoms,
    StarterKit.configure({ heading: false, codeBlock: false, blockquote: false, horizontalRule: false, strike: false, link: { openOnClick: false, autolink: true, linkOnPaste: true, HTMLAttributes: { rel: null, target: null, class: 'qlink' } } }),
    QHeading,
    QCodeBlock,
    TextColor, TeXWriterHighlight,
    TableBlock, QTable, QTableRow, QTableHeader, QTableCell,
    BlockMeta,
    Numbering,
    Find,
    Comments,
    FollowLinks,
    MathBlock, GeneratedBlock, FigureBlock, RawBlock, PageBreak, CalloutBlock,
    InlineMath, Citation, CrossRef, Footnote, InlineRaw,
    Placeholder.configure({ placeholder: 'Write here, or use Insert for tables, equations and test results…' }),
  ];
}

