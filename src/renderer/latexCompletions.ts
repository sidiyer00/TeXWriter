// LaTeX autocompletion for CodeMirror: math (equation editor) and full documents
// (source editor: commands, environments, \ref / \cite keys, files).
import { autocompletion, snippetCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { getState } from './store';

const s = (label: string, template: string, detail: string, boost = 0): Completion => snippetCompletion(template, { label, detail, type: 'function', boost });
const k = (label: string, detail: string, boost = 0): Completion => ({ label, detail, type: 'keyword', boost });

/** Math-mode commands. Templates use ${name} placeholders (Tab moves between them). */
export const MATH: Completion[] = [
  s('\\sum', '\\sum_{${i=1}}^{${n}}', 'summation Σ', 10), s('\\prod', '\\prod_{${i=1}}^{${n}}', 'product Π', 5),
  s('\\int', '\\int_{${a}}^{${b}}', 'integral ∫', 5), s('\\iint', '\\iint_{${D}}', 'double integral'), s('\\oint', '\\oint', 'contour integral'),
  s('\\lim', '\\lim_{${x \\to \\infty}}', 'limit', 5), s('\\frac', '\\frac{${numerator}}{${denominator}}', 'fraction a/b', 10),
  s('\\dfrac', '\\dfrac{${numerator}}{${denominator}}', 'display fraction'), s('\\tfrac', '\\tfrac{${a}}{${b}}', 'text fraction'),
  s('\\sqrt', '\\sqrt{${x}}', 'square root √', 8), s('\\sqrt[n]', '\\sqrt[${n}]{${x}}', 'n-th root'),
  s('\\binom', '\\binom{${n}}{${k}}', 'binomial coefficient'), s('\\left(', '\\left( ${} \\right)', 'auto-sized parentheses', 5),
  s('\\left[', '\\left[ ${} \\right]', 'auto-sized brackets'), s('\\left\\{', '\\left\\{ ${} \\right\\}', 'auto-sized braces'), s('\\left|', '\\left| ${} \\right|', 'absolute value'),
  s('\\bar', '\\bar{${x}}', 'bar accent x̄', 6), s('\\hat', '\\hat{${x}}', 'hat x̂', 6), s('\\tilde', '\\tilde{${x}}', 'tilde x̃'), s('\\vec', '\\vec{${x}}', 'vector'),
  s('\\dot', '\\dot{${x}}', 'dot'), s('\\overline', '\\overline{${x}}', 'overline'), s('\\underbrace', '\\underbrace{${x}}_{${label}}', 'underbrace'),
  s('\\mathrm', '\\mathrm{${text}}', 'upright text', 6), s('\\mathbf', '\\mathbf{${x}}', 'bold'), s('\\mathbb', '\\mathbb{${R}}', 'blackboard ℝ', 5),
  s('\\mathcal', '\\mathcal{${L}}', 'calligraphic'), s('\\text', '\\text{${text}}', 'text in math', 6), s('\\operatorname', '\\operatorname{${name}}', 'operator name'),
  s('\\begin{aligned}', '\\begin{aligned}\n  ${a} &= ${b} \\\\\n  &= ${c}\n\\end{aligned}', 'aligned block'),
  s('\\begin{cases}', '\\begin{cases}\n  ${x} & \\text{if } ${c} \\\\\n  ${y} & \\text{otherwise}\n\\end{cases}', 'piecewise'),
  s('\\begin{pmatrix}', '\\begin{pmatrix}\n  ${a} & ${b} \\\\\n  ${c} & ${d}\n\\end{pmatrix}', 'matrix ( )'),
  s('\\begin{bmatrix}', '\\begin{bmatrix}\n  ${a} & ${b} \\\\\n  ${c} & ${d}\n\\end{bmatrix}', 'matrix [ ]'),
  s('\\Pr', '\\Pr\\left( ${A} \\right)', 'probability'), s('\\mathbb{E}', '\\mathbb{E}\\left[ ${X} \\right]', 'expectation'),
  s('\\operatorname{Var}', '\\operatorname{Var}\\left( ${X} \\right)', 'variance'), s('\\operatorname{Cov}', '\\operatorname{Cov}\\left( ${X}, ${Y} \\right)', 'covariance'),
  s('\\log', '\\log\\left( ${x} \\right)', 'logarithm', 3), s('\\ln', '\\ln\\left( ${x} \\right)', 'natural log', 3), s('\\exp', '\\exp\\left( ${x} \\right)', 'exponential', 3),
  s('\\max', '\\max_{${x}}', 'maximum'), s('\\min', '\\min_{${x}}', 'minimum'), s('\\arg\\max', '\\arg\\max_{${x}}', 'argmax'), s('\\arg\\min', '\\arg\\min_{${x}}', 'argmin'),
  s('\\partial', '\\frac{\\partial ${f}}{\\partial ${x}}', 'partial derivative'), s('\\mathrm{d}', '\\frac{\\mathrm{d} ${f}}{\\mathrm{d} ${x}}', 'derivative'),
  ...['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Phi', 'Psi', 'Omega'].map((g) => k(`\\${g}`, 'Greek letter')),
  ...[['leq', '≤'], ['geq', '≥'], ['neq', '≠'], ['approx', '≈'], ['equiv', '≡'], ['sim', '∼'], ['propto', '∝'], ['ll', '≪'], ['gg', '≫'], ['in', '∈'], ['notin', '∉'], ['subset', '⊂'], ['subseteq', '⊆'], ['cup', '∪'], ['cap', '∩'], ['times', '×'], ['cdot', '·'], ['pm', '±'], ['mp', '∓'], ['div', '÷'], ['infty', '∞'], ['to', '→'], ['rightarrow', '→'], ['Rightarrow', '⇒'], ['leftarrow', '←'], ['Leftrightarrow', '⇔'], ['mapsto', '↦'], ['forall', '∀'], ['exists', '∃'], ['nabla', '∇'], ['ldots', '…'], ['cdots', '⋯'], ['quad', 'space'], ['qquad', 'wide space'], ['perp', '⊥'], ['mid', '∣'], ['otimes', '⊗'], ['circ', '∘'], ['top', 'transpose ⊤']].map(([c, d]) => k(`\\${c}`, d)),
];

const TEXT: Completion[] = [
  s('\\section', '\\section{${title}}\\label{sec:${label}}', 'section', 10), s('\\subsection', '\\subsection{${title}}\\label{sec:${label}}', 'subsection', 9),
  s('\\subsubsection', '\\subsubsection{${title}}', 'subsubsection'), s('\\paragraph', '\\paragraph{${title}}', 'run-in heading'),
  s('\\textbf', '\\textbf{${text}}', 'bold', 6), s('\\textit', '\\textit{${text}}', 'italic', 6), s('\\emph', '\\emph{${text}}', 'emphasis', 6),
  s('\\underline', '\\underline{${text}}', 'underline'), s('\\texttt', '\\texttt{${text}}', 'monospace'), s('\\textcolor', '\\textcolor[HTML]{${1E4290}}{${text}}', 'coloured text'),
  s('\\footnote', '\\footnote{${text}}', 'footnote', 5), s('\\label', '\\label{${key}}', 'label', 8), s('\\ref', '\\ref{${key}}', 'reference number', 8),
  s('\\autoref', '\\autoref{${key}}', 'reference with name', 9), s('\\eqref', '\\eqref{${key}}', 'equation reference', 7), s('\\pageref', '\\pageref{${key}}', 'page reference'),
  s('\\cite', '\\cite{${key}}', 'citation', 7), s('\\citep', '\\citep{${key}}', 'citation (parenthetical)', 8), s('\\citet', '\\citet{${key}}', 'citation (textual)', 8),
  s('\\includegraphics', '\\includegraphics[width=${0.8}\\linewidth]{${file}}', 'image', 6), s('\\input', '\\input{${file}}', 'include .tex'), s('\\url', '\\url{${https://}}', 'URL'),
  s('\\href', '\\href{${https://}}{${text}}', 'hyperlink'), s('\\caption', '\\caption{${text}}', 'caption', 6), s('\\item', '\\item ${}', 'list item', 7),
  k('\\centering', 'centre contents'), k('\\clearpage', 'page break'), k('\\newpage', 'page break'), k('\\tableofcontents', 'contents'), k('\\maketitle', 'title block'),
  k('\\appendix', 'start appendices'), k('\\noindent', 'no indent'), k('\\medskip', 'vertical space'), k('\\bigskip', 'vertical space'), k('\\small', 'font size'), k('\\footnotesize', 'font size'),
  k('\\toprule', 'booktabs rule'), k('\\midrule', 'booktabs rule'), k('\\bottomrule', 'booktabs rule'), k('\\hline', 'table rule'),
  s('\\multicolumn', '\\multicolumn{${2}}{${c}}{${text}}', 'merge columns'), s('\\multirow', '\\multirow{${2}}{*}{${text}}', 'merge rows'), s('\\cellcolor', '\\cellcolor[HTML]{${F3ECE6}}', 'cell colour'),
  s('\\usepackage', '\\usepackage{${package}}', 'load package', 5), s('\\newcommand', '\\newcommand{\\${name}}[${1}]{${definition}}', 'define macro'),
];

const ENVS: [string, string, string][] = [
  ['equation', '\\begin{equation}\\label{eq:${label}}\n  ${}\n\\end{equation}', 'numbered equation'],
  ['equation*', '\\begin{equation*}\n  ${}\n\\end{equation*}', 'unnumbered equation'],
  ['align', '\\begin{align}\n  ${a} &= ${b} \\\\\n  ${c} &= ${d}\n\\end{align}', 'aligned equations'],
  ['itemize', '\\begin{itemize}\n  \\item ${}\n\\end{itemize}', 'bulleted list'],
  ['enumerate', '\\begin{enumerate}\n  \\item ${}\n\\end{enumerate}', 'numbered list'],
  ['figure', '\\begin{figure}[htbp]\n  \\centering\n  \\includegraphics[width=0.8\\linewidth]{${file}}\n  \\caption{${caption}}\n  \\label{fig:${label}}\n\\end{figure}', 'figure'],
  ['table', '\\begin{table}[htbp]\n  \\centering\n  \\caption{${caption}}\n  \\label{tab:${label}}\n  \\begin{tabular}{lrr}\n    \\toprule\n    ${A} & ${B} & ${C} \\\\\n    \\midrule\n     &  &  \\\\\n    \\bottomrule\n  \\end{tabular}\n\\end{table}', 'booktabs table'],
  ['tabular', '\\begin{tabular}{${lrr}}\n  ${} \\\\\n\\end{tabular}', 'tabular'],
  ['lstlisting', '\\begin{lstlisting}[language=${Python}]\n${}\n\\end{lstlisting}', 'code listing'],
  ['quirecallout', '\\begin{quirecallout}{${Finding F-01 · Severity: Medium}}\n${}\n\\end{quirecallout}', 'callout box'],
  ['abstract', '\\begin{abstract}\n${}\n\\end{abstract}', 'abstract'],
  ['center', '\\begin{center}\n${}\n\\end{center}', 'centred block'],
  ['minipage', '\\begin{minipage}{${0.48}\\linewidth}\n${}\n\\end{minipage}', 'minipage'],
];

function labelOptions(): Completion[] {
  return [...getState().labels.values()].map((l) => ({ label: l.label, detail: `${l.kind} ${l.number}`, info: l.title || undefined, type: 'variable' }));
}
function citeOptions(): Completion[] {
  return getState().bib.map((b) => ({ label: b.key, detail: `${b.author?.split(' and ')[0] ?? ''} ${b.year ?? ''}`.trim(), info: b.title, type: 'constant' }));
}
function fileOptions(kinds: string[], stripTex: boolean): Completion[] {
  return (getState().project?.files ?? []).filter((f) => kinds.includes(f.kind)).map((f) => ({ label: stripTex ? f.path.replace(/\.tex$/, '') : f.path, type: 'text' }));
}

/** Completion source for whole LaTeX documents. */
export function latexDocumentCompletions(ctx: CompletionContext): CompletionResult | null {
  // argument completions: \ref{…}, \cite{…}, \input{…}, \begin{…}
  const arg = ctx.matchBefore(/\\([a-zA-Z]+)\*?(?:\[[^\]]*\])*\{([^}]*)$/);
  if (arg) {
    const cmd = /^\\([a-zA-Z]+)/.exec(arg.text)![1];
    const inner = arg.text.slice(arg.text.lastIndexOf('{') + 1);
    const lastComma = inner.lastIndexOf(',');
    const from = arg.to - (inner.length - (lastComma + 1));
    if (/ref$/i.test(cmd)) return { from, options: labelOptions(), validFor: /^[^},]*$/ };
    if (/^(cite|citep|citet|citealp|parencite|textcite|autocite)$/.test(cmd)) return { from, options: citeOptions(), validFor: /^[^},]*$/ };
    if (cmd === 'input' || cmd === 'include') return { from, options: fileOptions(['tex'], true) };
    if (cmd === 'includegraphics') return { from, options: fileOptions(['image', 'pdf'], false) };
    if (cmd === 'begin') {
      return {
        from: arg.from,
        options: ENVS.map(([name, tpl, detail]) => snippetCompletion(tpl, { label: `\\begin{${name}}`, detail, type: 'class' })),
        filter: false,
      };
    }
    return null;
  }
  const word = ctx.matchBefore(/\\[a-zA-Z]*$/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const envOpts = ENVS.map(([name, tpl, detail]) => snippetCompletion(tpl, { label: `\\begin{${name}}`, detail, type: 'class' }));
  return { from: word.from, options: [...TEXT, ...envOpts, ...MATH], validFor: /^\\[a-zA-Z]*$/ };
}

export function latexMathCompletions(ctx: CompletionContext): CompletionResult | null {
  const word = ctx.matchBefore(/\\[a-zA-Z]*$/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  return { from: word.from, options: MATH, validFor: /^\\[a-zA-Z]*$/ };
}

export const mathAutocomplete = () => autocompletion({ override: [latexMathCompletions], activateOnTyping: true, icons: false, maxRenderedOptions: 60 });
export const documentAutocomplete = () => autocompletion({ override: [latexDocumentCompletions], activateOnTyping: true, icons: false, maxRenderedOptions: 80 });
