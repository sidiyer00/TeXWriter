import { describe, expect, it } from 'vitest';
import { parseDocument, serializeDocument, toDocJson, blockLines } from '../src/shared/latex/blocks';
import { parseInline, serializeInline } from '../src/shared/latex/inline';

const SAMPLE = String.raw`\documentclass[11pt]{article}
\input{preamble}
\begin{document}

\section{Calibration}\label{sec:calibration}
Calibration was assessed at the rating-grade level by comparing the long-run average
predicted PD with observed one-year default rates\footnote{Defaults use the 90-DPD definition.}
(see Section~\ref{sec:obs-window}). Following \citet{tasche2013}, each grade was tested at the 5\% level.

\begin{equation}\label{eq:hl}
  \mathrm{HL} = \sum_{g=1}^{G} \frac{(O_g - N_g\bar{p}_g)^2}{N_g\bar{p}_g(1-\bar{p}_g)}
\end{equation}

% quire:generated id=tab_calib
\input{generated/tab_calib.tex}
% quire:end

\begin{itemize}
  \item First \textbf{bold} item
  \item Second item with $x^2$
\end{itemize}

\begin{tikzpicture}
  \draw (0,0) -- (1,1);
\end{tikzpicture}

\begin{figure}[t]
  \centering
  \includegraphics[width=0.8\linewidth]{figures/roc.pdf}
  \caption{ROC curve.}
  \label{fig:roc}
\end{figure}

\clearpage
\tableofcontents

\begin{quirecallout}{Finding F-02 · Medium}
Grade 7 under-predicts defaults.
\end{quirecallout}

\begin{lstlisting}[language=Python]
def pd(x):
    return 1 / (1 + exp(-x))
\end{lstlisting}

A paragraph with a % comment inside
that must stay raw.

\end{document}
`;

describe('block parser', () => {
  const p = parseDocument(SAMPLE);
  const types = p.blocks.map((b) => b.node.type);

  it('recognises block types', () => {
    expect(p.hasDocument).toBe(true);
    expect(types).toEqual([
      'heading', 'paragraph', 'mathBlock', 'generatedBlock', 'bulletList', 'rawBlock', 'figureBlock',
      'pageBreak', 'rawBlock', 'calloutBlock', 'codeBlock', 'rawBlock',
    ]);
  });

  it('round-trips untouched documents byte for byte', () => {
    const doc = toDocJson(p);
    const out = serializeDocument(p.prefix, doc, p.suffix, p.leading);
    expect(out.tex).toBe(SAMPLE);
  });

  it('extracts heading labels, math and figures', () => {
    const h = p.blocks[0].node;
    expect(h.attrs).toMatchObject({ level: 1, cmd: 'section', label: 'sec:calibration' });
    const m = p.blocks[2].node;
    expect(m.attrs?.label).toBe('eq:hl');
    expect(m.attrs?.latex).toContain('\\sum_{g=1}^{G}');
    const f = p.blocks[6].node;
    expect(f.attrs).toMatchObject({ path: 'figures/roc.pdf', width: '0.8\\linewidth', label: 'fig:roc', caption: 'ROC curve.' });
  });

  it('re-serializes edited blocks canonically, leaving others intact', () => {
    const doc = JSON.parse(JSON.stringify(toDocJson(p)));
    doc.content[0].content = [{ type: 'text', text: 'Calibration & Accuracy' }];
    doc.content[2].attrs.latex = 'a = b';
    const out = serializeDocument(p.prefix, doc, p.suffix, p.leading).tex;
    expect(out).toContain('\\section{Calibration \\& Accuracy}\\label{sec:calibration}');
    expect(out).toContain('\\begin{equation}\\label{eq:hl}\n  a = b\n\\end{equation}');
    expect(out).toContain('\\begin{tikzpicture}\n  \\draw (0,0) -- (1,1);\n\\end{tikzpicture}');
    // reparse is stable
    const p2 = parseDocument(out);
    expect(p2.blocks.map((b) => b.node.type)).toEqual(types);
  });

  it('maps blocks to source lines', () => {
    const lines = blockLines(SAMPLE, p);
    expect(lines[0]).toEqual([5, 5]);
    expect(lines[2]).toEqual([10, 12]);
  });

  it('handles a missing document environment', () => {
    expect(parseDocument('hello').hasDocument).toBe(false);
  });
});

describe('inline parser', () => {
  it('parses marks, refs, cites, math and escapes', () => {
    const n = parseInline(String.raw`A \textbf{bold \textit{both}} 5\% see Table~\ref{tab:a} and \citep[p.~4]{k1, k2} with $x_i$.`);
    const s = serializeInline(n);
    expect(s).toBe(String.raw`A \textbf{bold }\textbf{\textit{both}} 5\% see Table~\ref{tab:a} and \citep[p.~4]{k1,k2} with $x_i$.`);
    expect(n.find((x) => x.type === 'citation')?.attrs).toMatchObject({ cmd: 'citep', keys: 'k1,k2', opts: '[p.~4]' });
  });

  it('keeps unknown commands verbatim', () => {
    const src = String.raw`Use \SI{3}{\percent} and \textcolor{red}{x}.`;
    expect(serializeInline(parseInline(src))).toBe(src);
  });

  it('escapes special characters', () => {
    expect(serializeInline([{ type: 'text', text: 'a_b & c% {d} ~ \\' }])).toBe(String.raw`a\_b \& c\% \{d\} \textasciitilde{} \textbackslash{}`);
  });
});
