// The editor document model. It is deliberately ProseMirror-JSON compatible so the
// renderer can hand it straight to TipTap, and pure so it can be unit tested in Node.

export type MarkType = 'link' | 'bold' | 'italic' | 'underline' | 'code' | 'textColor' | 'highlight';
export interface Mark { type: MarkType; attrs?: Record<string, unknown> }

export interface JNode {
  type: string;
  attrs?: Record<string, any>;
  content?: JNode[];
  text?: string;
  marks?: Mark[];
}

/** Attributes carried by every top-level block so untouched blocks round-trip byte-for-byte. */
export interface BlockMeta {
  /** exact original source of the block (without trailing whitespace) */
  src: string | null;
  /** canonical serialization at parse time; if unchanged on save, `src` is emitted */
  sig: string | null;
  /** whitespace that followed the block in the source */
  gap: string;
}

export const BLOCK_TYPES = [
  'paragraph',
  'heading',
  'bulletList',
  'orderedList',
  'mathBlock',
  'generatedBlock',
  'figureBlock',
  'calloutBlock',
  'codeBlock',
  'pageBreak',
  'rawBlock',
  'tableBlock',
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const INLINE_COMMANDS = new Set([
  'textbf', 'textit', 'emph', 'texttt', 'textsc', 'textrm', 'textsf', 'underline', 'uline', 'textcolor', 'quirehl',
  'cite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite',
  'ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'nameref',
  'footnote', 'url', 'href', 'ldots', 'dots', 'LaTeX', 'TeX', 'today', 'S', 'P',
  'textsuperscript', 'textsubscript', 'mbox', 'hbox', 'si', 'SI', 'num', 'enquote', 'q',
]);

export const CITE_COMMANDS = new Set(['cite', 'citep', 'citet', 'citealp', 'citeauthor', 'citeyear', 'parencite', 'textcite', 'autocite']);
export const REF_COMMANDS = new Set(['ref', 'eqref', 'autoref', 'cref', 'Cref', 'pageref', 'nameref']);
export const HEADING_COMMANDS: Record<string, number> = { chapter: 1, section: 1, subsection: 2, subsubsection: 3 };
export const MATH_ENVS = new Set(['equation', 'equation*', 'align', 'align*', 'gather', 'gather*', 'multline', 'multline*', 'displaymath']);
export const PAGEBREAK_COMMANDS = new Set(['clearpage', 'newpage', 'pagebreak', 'cleardoublepage']);

export const FRIENDLY_COMMANDS: Record<string, string> = {
  tableofcontents: 'Table of contents',
  listoftables: 'List of tables',
  listoffigures: 'List of figures',
  maketitle: 'Title block',
  appendix: 'Appendices start here',
  bibliography: 'Bibliography',
  printbibliography: 'Bibliography',
  bibliographystyle: 'Bibliography style',
  input: 'Included file',
  include: 'Included file',
  titlepage: 'Title page',
};
