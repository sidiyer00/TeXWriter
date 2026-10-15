import { describe, expect, it } from 'vitest';
import { parseContentsPages } from '../src/shared/latex/refs';

describe('page numbers from compiled contents files', () => {
  it('reads .toc entries with and without hyperref anchors', () => {
    const toc = String.raw`\contentsline {section}{\numberline {1}How this example works}{3}{section.1}%
\contentsline {subsection}{\numberline {1.1}Scope}{4}{subsection.1.1}%
\contentsline {section}{\numberline {A}Writing a generator script}{12}{appendix.A}%
\contentsline {section}{\numberline {2}No hyperref}{7}%
\contentsline {section}{References}{14}{section*.5}%
`;
    expect(parseContentsPages(toc)).toEqual({ '1': '3', '1.1': '4', A: '12', '2': '7' });
  });

  it('reads .lot entries whose caption is in its own group, and roman page numbers', () => {
    const lot = String.raw`\contentsline {table}{\numberline {2.1}{\ignorespaces Estimated coefficients of the linear model.}}{5}{table.2.1}%
\contentsline {table}{\numberline {3.1}{\ignorespaces Error metrics by sample.}}{iv}{table.3.1}%
`;
    expect(parseContentsPages(lot)).toEqual({ '2.1': '5', '3.1': 'iv' });
  });
});
