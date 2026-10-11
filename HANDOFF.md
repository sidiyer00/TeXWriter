# Handoff — Quire v0.2.0 (2026-10-11)

Moving from Cowork to Claude Code. Project conventions and gotchas: `CLAUDE.md`.

## Where things are
- Repo: `C:\Users\sidiy\Documents\Projects\Latex_Editor\quire` (git, branch `master`,
  HEAD = "v0.2: …" on top of "Quire 0.1.0"). No remote configured.
- Installer: `release\Quire-Setup-0.2.0.exe`
  (sha256 `0dd88a2b7665d88db6561c783bc1a67b3b331dd5e9424e580882711740ae4273`). Old 0.1.0 installer also there.
- `node_modules/` is not in the folder: run `npm install` first.
- Git note: the folder was synced with `core.filemode=false` (Windows mount showed mode-only diffs).

## History
1. v0.1 — Electron 38 + React 19 + TS MVP: visual/split/LaTeX editing with lossless
   round-trip, Python test runs → generated tables/figures/summaries, compile with
   diagnostics + SyncTeX, PDF review, export (PDF / source zip / provenance JSON), sample project.
2. v0.2 — from Sid's feedback list (all implemented):
   toggleable right panel (Properties/Comments) with auto open/close on equations, tables,
   figures, refs · overflow toolbar ("More") + responsive title bar + menu bar · taskbar
   autohide fix · only main file open; Files tree + closable tabs incl. .sty/.cls; Ctrl+O ·
   Ctrl+click / F12 follow refs, cites (URL/DOI/bib entry), links, `\input`, PDF link
   annotations · Ctrl+U, text colour, highlight · find / replace / replace all · drag-drop of
   selections with cross-refs fixed · Word-style comments (replies, edit, resolve) in
   `quire-comments.json` · Python highlighting, no spellcheck in code · equation autocomplete
   (`\su`→`\sum`) + resizable input + Maximize modal · visual tables (styles, multi-level
   headers, merge/split, cell colour, alignment) · MiKTeX re-detection (registry PATH, focus
   re-check, Settings → Detect again) · Settings page incl. read-only shortcuts (F1) ·
   context menus · error boundary · fixed a compile-breaking support-macro bug.

## Verification status
- Passing: `npm run typecheck`, `npm test` (23), full `npm run e2e` (0 console errors) on Linux/xvfb
  with TeX Live; compile of the support macros checked with pdflatex.
- **Not yet verified on real Windows** (needs Sid's machine): taskbar autohide fix,
  MiKTeX detection/auto-install, Perl-less MiKTeX fallback, spelling suggestions in the
  context menu, installer behaviour, HiDPI scaling.

## Open items / suggested next steps
1. Smoke-test 0.2.0 on Windows against the list above; fix what breaks.
2. Decide on bundled TeX (Sid asked why tools aren't bundled; answer given):
   option A bundle **Tectonic** (~30 MB, XeTeX engine, fetches packages on first use, needs
   internet) as a fallback when no MiKTeX/TeX Live is found; option B bundle offline
   MiKTeX basic (installer ~350 MB). Not started — awaiting Sid's choice.
3. Known limits: tables using `tabularx`/`longtable`/complex `p{}` stay raw LaTeX blocks;
   soul's `\hl` can choke on some macros inside highlighted text; comments are file-based
   (last writer wins, no live co-editing); no PDF/A.
4. Nice-to-haves not done: context menus on Outline and Tests rows; code signing; auto-update
   (`build.publish` is null); bundle size (renderer JS ~2.4 MB, could code-split pdf.js/KaTeX).
