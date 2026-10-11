# Quire — model report studio

A Windows desktop app for writing model documentation and validation reports. You
edit in a word-processor view, switch to the LaTeX whenever you need exact control,
pull test-suite results into the report as linked tables, figures and sentences, and
compile a reproducible PDF.

![Editor](docs/screenshots/04-editor-generated.png)

## Install and run

### Option A — installer
Run `Quire-Setup-0.1.0.exe`. The build is unsigned, so Windows SmartScreen may warn
you; choose **More info → Run anyway**.

### Option B — from source
Requires Node.js 20 or newer.

```powershell
cd Latex_Editor\quire
npm install          # downloads Electron (~100 MB) the first time
npm run dev          # development build with hot reload
npm run dist         # build release\Quire-Setup-0.1.0.exe
```

### Prerequisites for compiling and tests
| Tool | Needed for | Notes |
|---|---|---|
| **MiKTeX** or **TeX Live** | Compiling PDFs | pdfLaTeX is the default engine. MiKTeX's `latexmk` needs Perl; without it Quire runs pdflatex → bibtex → pdflatex itself. |
| **Python 3.9+** | Running the sample test suite | Standard library only. Quire finds `python` on PATH; you can set a specific interpreter in Document setup → Compiler and tests. |
| Git (optional) | Recording the commit on each run | |

The Home screen's "This computer" panel shows what Quire found; **Settings → LaTeX and Python**
(Ctrl+,) lists every tool with its path, lets you point at a specific TeX bin folder or Python,
and has **Detect again**. Quire also re-checks on its own when you switch back to it after
installing MiKTeX (it reads the updated PATH from the registry, plus the usual MiKTeX/TeX Live
install folders), so a fresh install is picked up without restarting.

## The workflow

1. **Open the sample** (Home → Open sample project). This creates
   `Documents\Quire\CORP-PD-v4.2-Validation` with a full validation report and a Python suite.
2. **Run tests** (Ctrl+Shift+T). Each run goes into `runs\<n>\` with `results.json`,
   output CSVs and figures, and a log. The first run fills the report's generated tables.
3. **Review results** in Test runs. You can filter, group, compare runs, look at a test's
   history, and insert a result as a table, a figure or a linked summary sentence.
4. **Edit** in Visual, Split or LaTeX mode (Ctrl+1/2/3). In Split view, the selected
   element and its source lines highlight each other.
5. **Compile** (Ctrl+Enter). Diagnostics link to the source line, are marked on the PDF
   page, and offer one-click fixes where possible: closest label or citation key, shrink a
   wide table, refresh stale content.
6. **Export** a PDF, a source bundle (.zip with sources, the runs used and
   PROVENANCE.json), or the provenance manifest on its own.

## How the visual editor stays faithful to the LaTeX

- **The `.tex` file is the single source of truth.** The visual editor parses the document body into
  blocks: headings, paragraphs, lists, equations, figures, callouts, code, generated
  content. Anything it can't represent exactly becomes a *LaTeX block*, shown as source and
  kept byte-for-byte.
- **Untouched blocks keep their original bytes.** Each block remembers its original source and
  canonical form. Only blocks you edit are re-serialized, so a visual edit never reformats the rest of the file.
- **Inline content follows the same rule.** Unknown commands (`\SI{..}`, `\textcolor{..}`) become inline LaTeX chips; citations and
  `\ref`/`\autoref` become chips that resolve against the bibliography and labels.
- **Generated content** is delimited in the source:
  ```latex
  % quire:generated id=tab_calib_grade
  \input{generated/tab_calib_grade.tex}
  % quire:end
  ```
  `quire.json` records which run, output file and tests each block came from. If someone
  edits that region by hand, Quire reports a sync conflict. You can then keep the edit (it
  becomes static LaTeX) or restore the generated version.
- **Document setup rewrites only two things:** the block between `% quire:theme begin/end` in
  `preamble.tex`, and the size and paper options of `\documentclass`.

## Connecting your own test suite

Set the test command in **Document setup → Compiler and tests**, e.g.

```
{python} validation/run_suite.py --out "{runDir}"
```

The command must write `results.json` into `{runDir}` (also exposed as `QUIRE_RUN_DIR`):

```json
{ "suite": "validation_suite_v4", "dataSnapshot": "2026-06-30",
  "tests": [ { "id": "calib.jeffreys.grade_7", "name": "Jeffreys test — Grade 7",
               "category": "Calibration", "status": "failed", "metric": "p-value",
               "value": 0.0088, "threshold": ">= 0.05", "notes": "35 defaults / 455",
               "outputs": ["outputs/calibration_by_grade.csv"],
               "details": { "obligors": 455, "defaults": 35 } } ] }
```

`validation/quire_report.py` (copied into every project that includes the sample suite)
writes this file for you. Print `QUIRE_PROGRESS <done>/<total> <label>` lines to drive
the progress bar. A JUnit XML file (`{runDir}/junit.xml`, e.g. from
`pytest --junitxml`) also works, but only for pass/fail status.

## Editing

- **Formatting**: bold, italic, underline (Ctrl+U), monospace, text colour and highlight
  (`\textcolor`, `\quirehl` via soul), links (`\href`). The toolbar hides its least-used buttons
  in **More** when the window is narrow instead of wrapping.
- **Find and replace** (Ctrl+F / Ctrl+H): all matches highlighted, match case / whole word /
  regex, Replace and Replace all (one undo step). In the LaTeX pane Ctrl+F uses CodeMirror's search.
- **Follow references**: Ctrl+click (or F12) a cross-reference to jump to its target, a citation
  to open its URL/DOI (or its BibTeX entry), a link to open it in the browser. Works in the
  LaTeX pane on `\ref`, `\cite`, `\input`, `\includegraphics` and `\url`, and on links in the PDF.
- **Tables**: Insert → Table (Ctrl+Alt+T) gives an editable table: rows/columns, merge and split
  cells, header rows (several header rows with merged cells print as multi-level headers with
  `\cmidrule`), cell colours (`\cellcolor`), column alignment, and five styles (booktabs, grid,
  minimal, striped, plain). Existing `tabular` environments open in the same editor when Quire
  can represent them; anything else stays an editable LaTeX block.
- **Equations**: the properties panel and the large editor (double-click an equation, or
  Maximize) suggest LaTeX commands as you type (`\su` → `\sum_{}^{}`), with a symbol palette.
- **Comments**: select text, Ctrl+Alt+M or right-click → New comment. Threads support replies,
  edits, resolve/reopen. They live in `quire-comments.json` in the project folder, so anyone
  opening the same folder with Quire sees them; anchors survive edits made in either view.
- **Files**: the Files tab in the navigator shows the whole project; click a `.tex`, `.sty`, `.cls`,
  `.bib` or script to open it in its own tab (Ctrl+O to search). Only the main file is open by default.
- **Right-click** menus everywhere (spelling suggestions, formatting, table operations, follow
  reference, show in source; file tree; source tabs). The **properties panel** opens itself for
  equations, tables, figures and references and closes again when you leave them; pin it with
  Ctrl+Alt+P.

## Keyboard

Press **F1** (or Settings → Keyboard shortcuts) for the full list. Shortcuts are fixed. The main ones:

| Shortcut | Action |
|---|---|
| Ctrl+1 / 2 / 3 | Visual / Split / LaTeX |
| Ctrl+Enter | Compile |
| Ctrl+Shift+T | Run tests |
| Ctrl+S | Save now (autosave is on) |
| Ctrl+F / Ctrl+H | Find / find and replace |
| Ctrl+B / I / U | Bold / italic / underline |
| Ctrl+M / Ctrl+Shift+M | Inline math / display equation |
| Ctrl+Alt+T | Insert table |
| Ctrl+Alt+M | New comment |
| Ctrl+click, F12 | Follow reference, citation or link |
| Ctrl+O | Open a file in the project |
| F8 / Shift+F8 | Next / previous issue |
| Ctrl+\ | Collapse navigator |
| Double-click PDF | Jump to source (SyncTeX) |

## Project layout

```
quire/
  src/shared/        pure TypeScript: LaTeX block parser/serializer, log parser,
                     results schema, table/summary rendering, theme → preamble
  src/main/          Electron main: projects, compile (latexmk + fallback), runs, export
  src/renderer/      React UI: TipTap visual editor, CodeMirror source, pdf.js review
  resources/sample/  sample report + stdlib Python validation suite
  tests/             unit tests (npm test)
  scripts/e2e.mjs    end-to-end run through the whole workflow (Playwright + Electron)
```

`npm test` runs the unit tests. `npm run build && npm run e2e` drives the app through
the full workflow: sample → run → insert → split edit → compile → setup → round-trip
edits. It writes screenshots to `e2e-shots/`.

## Known limits (v0.2)

- Hand-written tables using `tabularx`, `longtable`, `p{}` widths with nested environments, or
  multi-column page layouts stay LaTeX blocks (still editable in source).
- Comments are shared through the project folder (last writer wins if two people edit the same
  comment file at the same moment); there is no live co-editing.
- The in-editor equation preview uses KaTeX. A few LaTeX-only macros show a preview error
  but still compile.
- Package installs are left to MiKTeX/TeX Live. When a theme font is missing, Quire falls back to
  Computer Modern and lists the missing package as a notice.
- No PDF/A output yet; the provenance manifest records SHA-256 hashes of every source behind the PDF.
