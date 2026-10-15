import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument, toDocJson } from '../src/shared/latex/blocks';
import { numberDocument } from '../src/shared/latex/refs';
import type { JNode } from '../src/shared/latex/model';

const DOC = String.raw`\documentclass{article}
\begin{document}

\section{Intro}

\subsection{Scope}

\subsubsection{Data}

\paragraph{Sample}\label{par:sample}

\subparagraph{Filters}

\paragraph{Inline} runs into its paragraph.

\end{document}
`;

const headings = (doc: JNode) => (doc.content ?? []).filter((n) => n.type === 'heading');

describe('five heading levels', () => {
  it('parses \\paragraph and \\subparagraph on their own line as levels 4 and 5', () => {
    const doc = toDocJson(parseDocument(DOC));
    expect(headings(doc).map((h) => [h.attrs?.level, h.attrs?.cmd])).toEqual([
      [1, 'section'], [2, 'subsection'], [3, 'subsubsection'], [4, 'paragraph'], [5, 'subparagraph'],
    ]);
    // a run-in \paragraph with text after it is not a heading; it is kept verbatim
    expect(doc.content?.some((n) => n.type === 'rawBlock' && n.attrs?.latex?.startsWith('\\paragraph{Inline} runs'))).toBe(true);
  });

  it('round-trips byte for byte', () => {
    const p = parseDocument(DOC);
    expect(serializeDocument(p.prefix, toDocJson(p), p.suffix, p.leading).tex).toBe(DOC);
  });

  it('writes the command for the new level after a promote or demote, keeping the label', () => {
    const p = parseDocument(DOC);
    const doc = toDocJson(p);
    const par = headings(doc)[3];
    // the editor drops cmd on a level change; a stale cmd must not win either
    par.attrs = { ...par.attrs, level: 3, src: null, sig: null };
    const sec = headings(doc)[0];
    sec.attrs = { ...sec.attrs, level: 2, cmd: null, src: null, sig: null };
    const tex = serializeDocument(p.prefix, doc, p.suffix, p.leading).tex;
    expect(tex).toContain('\\subsubsection{Sample}\\label{par:sample}');
    expect(tex).toContain('\\subsection{Intro}');
    expect(tex).not.toContain('\\paragraph{Sample}');
  });

  it('numbers levels 1–3 and leaves paragraph headings unnumbered, referring to the enclosing section', () => {
    const { outline, labels } = numberDocument(toDocJson(parseDocument(DOC)));
    expect(outline.map((o) => o.number)).toEqual(['1', '1.1', '1.1.1', '', '']);
    expect(labels.get('par:sample')?.number).toBe('1.1.1');
  });
});
