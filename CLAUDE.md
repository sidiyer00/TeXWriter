# CLAUDE.md — Quire

Desktop app (Windows-first) for writing model documentation / validation reports: a Word-like
visual editor over LaTeX, linked to Python test-suite runs, with reproducible PDF builds.
Owner: Sid (quant credit-risk; wants concise, high-signal answers). Current state and open
items: see `HANDOFF.md`.

## Commands

```bash
npm install
npm run dev          # Vite + Electron with reload
npm run typecheck    # tsc --noEmit (noUnusedLocals is on)
npm test             # vitest: tests/*.test.ts (parser round-trip, log parser, tables)
npm run build        # typecheck + esbuild main/preload + vite renderer
npm run e2e          # Playwright _electron drives the BUILT app; screenshots -> e2e-shots/
npm run dist         # Windows NSIS installer -> release/Quire-Setup-<ver>.exe
```
On Linux: `xvfb-run -a npm run e2e`; building the Windows installer needs wine
(`WINEDEBUG=-all npx electron-builder --win nsis --x64`). Run `npm run build` before `e2e`.

## Architecture

- `src/main/` Electron main. `main.ts` (window, IPC `handle(...)`, taskbar-autohide fix,
  spellcheck), `toolchain.ts` (TeX/Python/Perl/Git discovery: PATH + Windows registry PATH +
  MiKTeX registry keys + known install dirs + user overrides), `compile.ts` (latexmk, or manual
  pdflatex→bibtex→pdflatex when latexmk is missing or MiKTeX lacks Perl; MiKTeX
  `--enable-installer`), `runs.ts` (test runs → `runs/<n>/`), `project.ts`, `exporter.ts`,
  `settings.ts` (userData/settings.json), `preload.ts` (exposes `window.quire`).
- `src/shared/` pure TS, unit-testable, no DOM/Electron:
  `latex/blocks.ts` block parser/serializer (**LaTeX is the single source of truth**),
  `latex/inline.ts` inline marks/atoms, `latex/table.ts` tabular ⇄ table JSON, `latex/theme.ts`
  managed preamble block + `SUPPORT_MACROS`, `latex/refs.ts` numbering/labels/bib,
  `latex/log.ts` compile-log diagnostics, `types.ts` (incl. the `QuireApi` IPC contract).
- `src/renderer/` React 19. `store.ts` = tiny global store (`getState/setState/useStore`,
  `useSyncExternalStore`) + most app actions. `commands.ts` = menus, actions and the `SHORTCUTS`
  list (single source for menu bar, context menus, F1 page). `visual/` = TipTap 3 editor
  (nodes, marks, tables, find, comments, follow-links, context menu). `components/`,
  `views/` (Home, Editor, Tests, Review/PDF, Setup, Settings).

### Round-trip model (read before touching the editor)
`parseDocument(tex)` splits the body into blocks; each keeps its original `src` and a `sig`.
On serialize, an unchanged block re-emits its `src` byte-for-byte, so editing one paragraph
only changes those lines. Constructs the editor can't model become `rawBlock` /
`inlineRaw` (shown as source, preserved exactly). Generated content lives in
`generated/*.tex`, included via `% quire:generated id=…` markers and managed in `quire.json`.
Never "normalize" untouched LaTeX.

### Adding an IPC method
`types.ts` (`QuireApi`) → `preload.ts` (`call('name', …)`) → `main.ts` (`handle('name', …)`).

## Gotchas learned the hard way

- `useStore` selectors must return stable references. `s.x ?? []` creates a new array per
  render → React error #185 (infinite loop, blank window). Hoist a constant `EMPTY`.
- `commands.ts` exports consts used by `Menu.tsx`; reference them lazily (`() => fileMenu()`),
  otherwise circular imports hit TDZ errors at module load.
- LaTeX: no `#`-parameter macro definitions inside `\IfFileExists{…}{…}` branches (older
  kernels `\def` the branch → "Illegal parameter number in definition of \reserved@a").
  Use `\ifx\foo\undefined … \fi` at top level (see `SUPPORT_MACROS`). Bump
  `SUPPORT_VERSION` when changing them; `migrateSupportMacros()` rewrites old preambles.
- Inline atom NodeViews use `stopEvent: () => false`; otherwise dragging a selection that
  contains a cross-ref becomes a native DOM drag and the `\autoref` turns into plain text.
- Global shortcuts are a capture-phase `keydown` in `App.tsx`. Keep the "in a form field →
  don't intercept" guard (Ctrl+Enter in a comment box used to trigger a compile).
- The properties panel auto-opens/closes on rich selections, deferred until mouse-up
  (`autoPanel` in `store.ts`) so the page doesn't shift between the clicks of a double-click.
- Find bar: subscribe to editor transactions *before* dispatching the query, or the
  match count is stale.
- pdf.js must be the legacy build (Electron's Chromium lacks newer built-ins).
- `window.prompt` doesn't exist in Electron → `promptText()` dialog.
- Don't `preventDefault` on `contextmenu` in editable areas; Electron's `context-menu` event
  carries spelling suggestions (forwarded as `spell`, merged by `ContextMenu`).
- e2e: Playwright can't start native HTML5 drags under xvfb; the drag test dispatches
  `DragEvent`s. After a click/dblclick, wait ~300 ms before keyboard commands (ProseMirror
  reads the DOM selection on `selectionchange`). `window.__quireState()` exposes store state.

## Conventions

- TypeScript strict, no unused locals; keep shared/ free of DOM/Electron imports.
- New user-facing shortcut → add to `SHORTCUTS` in `commands.ts` (shortcuts are fixed by design,
  not user-editable) and wire it in `App.tsx` / the TipTap extension.
- Add a unit test for any parser/serializer change; extend `scripts/e2e.mjs` for UI features.
- Commit attribution lines per the user's Claude Code settings.
