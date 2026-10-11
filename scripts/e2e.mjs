// End-to-end smoke test: drives the built app with Playwright's Electron support
// through the full workflow and writes screenshots to ./e2e-shots.
//   npm run build && npm run e2e        (on Linux CI wrap with xvfb-run)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const out = path.resolve('e2e-shots');
fs.mkdirSync(out, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-e2e-'));
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--no-sandbox', `--user-data-dir=${path.join(home, 'userdata')}`],
  env: { ...process.env, HOME: home, XDG_DOCUMENTS_DIR: path.join(home, 'Documents'), QUIRE_SAMPLE_PACE: '0.01' },
});
// HOME/XDG only redirect Documents on Linux; on Windows force it so runs never touch the real folder.
await app.evaluate(({ app }, d) => app.setPath('documents', d), path.join(home, 'Documents'));
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(String(e)));
await win.setViewportSize({ width: 1440, height: 900 });
const shot = async (name) => { await win.waitForTimeout(500); await win.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name); };
const step = async (name, fn) => { try { await fn(); } catch (e) { console.error(`STEP FAILED: ${name}:`, e.message); await shot(`fail-${name}`); throw e; } };

await step('home', async () => { await win.getByRole('button', { name: 'Open sample project' }).first().waitFor(); await shot('01-home-empty'); });
await step('open-sample', async () => {
  await win.getByRole('button', { name: 'Open sample project' }).first().click();
  await win.locator('.ProseMirror').waitFor({ timeout: 15000 });
  await shot('02-editor-pending');
});
await step('run-tests', async () => {
  await win.getByRole('button', { name: /^Run tests/ }).click();
  await win.waitForFunction(() => !document.body.innerText.includes('Running '), null, { timeout: 120000 });
  await win.waitForTimeout(800);
  await win.getByRole('button', { name: 'View results' }).click().catch(() => {});
  await win.getByText('Run #1').first().waitFor({ timeout: 10000 });
  await win.getByText('Jeffreys test — Grade 7').first().click();
  await shot('03-tests');
});
await step('insert-summary', async () => {
  await win.locator('.opt', { hasText: 'Summary' }).click();
  await win.getByRole('button', { name: /^Insert summary$/ }).click();
  await win.waitForTimeout(600);
});
await step('editor-generated', async () => {
  await win.getByRole('button', { name: /Back to report/ }).click();
  await win.locator('.blk-gen').first().waitFor();
  await win.locator('.blk-gen').nth(1).scrollIntoViewIfNeeded();
  await win.locator('.blk-gen').nth(1).click({ position: { x: 30, y: 30 } });
  await shot('04-editor-generated');
});
await step('split', async () => {
  await win.getByRole('button', { name: 'Split' }).click();
  await win.locator('.eq').nth(1).scrollIntoViewIfNeeded();
  await win.locator('.eq').nth(1).click();
  await shot('05-split-equation');
});
await step('compile', async () => {
  await win.keyboard.press('Control+Enter');
  await win.waitForFunction(() => !document.body.innerText.includes('Compiling ·'), null, { timeout: 180000 });
  await win.waitForTimeout(1000);
  await win.getByRole('button', { name: /Compiled|Compile failed|Not compiled/ }).first().click();
  await win.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(2500);
  await shot('06-review');
});
await step('setup', async () => {
  await win.getByRole('button', { name: /Back to editor/ }).click();
  await win.getByRole('button', { name: 'Document setup' }).click();
  await shot('07-setup');
});
await step('source', async () => {
  await win.getByRole('button', { name: 'Cancel' }).click();
  await win.getByRole('button', { name: 'LaTeX' }).click();
  await shot('08-source');
});
await step('round-trip-edits', async () => {
  const root = await win.evaluate(() => window.quire && document.querySelector('.crumbs') ? null : null);
  void root;
  await win.getByRole('button', { name: 'Visual' }).click();
  const p = win.locator('.ProseMirror p').first();
  await p.click();
  await win.keyboard.press('End');
  await win.keyboard.type(' Visual edit marker 123.');
  await win.waitForTimeout(2500);
  const qdir = [path.join(home, 'Documents', 'Quire'), path.join(home, 'Quire')].find((d) => fs.existsSync(d));
  const projDir = path.join(qdir, fs.readdirSync(qdir)[0]);
  const tex = fs.readFileSync(path.join(projDir, 'report.tex'), 'utf8');
  if (!tex.includes('Visual edit marker 123.')) throw new Error('visual edit not saved to report.tex');
  if (!tex.includes('\\begin{equation}\\label{eq:hosmer-lemeshow}')) throw new Error('equation lost');
  await win.getByRole('button', { name: 'LaTeX' }).click();
  await win.locator('.cm-content').click();
  await win.keyboard.press('Control+End');
  await win.keyboard.type('\n% source edit marker');
  await win.waitForTimeout(2000);
  const tex2 = fs.readFileSync(path.join(projDir, 'report.tex'), 'utf8');
  if (!tex2.includes('% source edit marker')) throw new Error('source edit not saved');
  // second run makes generated blocks stale until refreshed
  await win.getByRole('button', { name: 'Visual' }).click();
  await win.getByRole('button', { name: /^Run tests/ }).click();
  await win.waitForFunction(() => !document.body.innerText.includes('Running '), null, { timeout: 120000 });
  await win.waitForTimeout(1500);
  const stale = await win.locator('.blk-gen.stale').count();
  console.log('stale blocks after run 2:', stale);
  if (stale < 1) throw new Error('expected stale blocks');
  await win.locator('.blk-gen.stale').first().scrollIntoViewIfNeeded();
  await shot('10-stale');
});
const projDirOf = () => { const qdir = [path.join(home, 'Documents', 'Quire'), path.join(home, 'Quire')].find((d) => fs.existsSync(d)); return path.join(qdir, fs.readdirSync(qdir)[0]); };
const texNow = () => fs.readFileSync(path.join(projDirOf(), 'report.tex'), 'utf8');
const selectWord = async (loc) => { await loc.dblclick(); await win.waitForTimeout(150); };

await step('toolbar-overflow', async () => {
  await win.getByRole('button', { name: 'Visual' }).click();
  await win.setViewportSize({ width: 980, height: 800 });
  await win.waitForTimeout(600);
  const h = await win.locator('.toolbar').first().evaluate((el) => el.getBoundingClientRect().height);
  if (h > 48) throw new Error(`toolbar wraps (${h}px)`);
  await win.getByRole('button', { name: /^More/ }).first().waitFor();
  await shot('11-toolbar-narrow');
  await win.getByRole('button', { name: /^More/ }).first().click();
  await shot('12-more-menu');
  await win.keyboard.press('Escape');
  await win.setViewportSize({ width: 1440, height: 900 });
  await win.waitForTimeout(400);
});
await step('underline-colour', async () => {
  const p = win.locator('.ProseMirror > p').nth(2);
  await p.scrollIntoViewIfNeeded();
  await p.dblclick({ position: { x: 60, y: 10 } });
  await win.waitForTimeout(300); // ProseMirror reads the DOM selection on selectionchange
  console.log('focus/sel', await win.evaluate(() => document.activeElement.className + ' | ' + window.getSelection().toString()));
  await win.keyboard.press('Control+u');
  await win.waitForTimeout(200);
  console.log('u after ctrl+u', await win.locator('.ProseMirror u').count());
  await win.evaluate(() => { const w = window; w.__log = []; let last = w.__quireState().files['report.tex']?.version; w.__iv = setInterval(() => { const f = w.__quireState().files['report.tex']; if (f.version !== last) { w.__log.push(f.origin + ':' + f.version + ':' + document.querySelectorAll('.ProseMirror u').length); last = f.version; } }, 10); });
  await win.keyboard.press('Control+Shift+h');
  await win.waitForTimeout(1500);
  console.log('version log', await win.evaluate(() => { clearInterval(window.__iv); return window.__log.join(' '); }));
  if (!(await win.locator('.ProseMirror u').count())) throw new Error('no <u> after Ctrl+U');
  const t = texNow();
  if (!/\\underline\{/.test(t)) throw new Error('\\underline not written');
  if (!/\\quirehl\{FFF176\}/.test(t)) throw new Error('\\quirehl not written');
});
await step('find-replace', async () => {
  await win.locator('.ProseMirror > p').first().click();
  await win.keyboard.press('Control+h');
  await win.getByRole('searchbox').or(win.getByLabel('Find', { exact: true })).first().fill('calibration');
  await win.waitForTimeout(300);
  const status = await win.locator('.findbar [aria-live]').innerText();
  if (!/of \d+/.test(status)) throw new Error(`find status: ${status}`);
  const n = Number(/of (\d+)/.exec(status)[1]);
  const hl = await win.locator('.find-match').count();
  if (hl < 1) throw new Error('no find highlights');
  await shot('13-find');
  await win.getByLabel('Replace with').fill('calibrationX');
  await win.getByRole('button', { name: 'Replace all' }).click();
  await win.waitForTimeout(1500);
  const cnt = (texNow().match(/calibrationX/g) ?? []).length;
  console.log('find matches', n, 'replaced', cnt);
  if (cnt !== n) throw new Error(`replace all: ${n} matches but ${cnt} replaced`);
  await win.getByRole('button', { name: 'Close find (Esc)' }).click();
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1500);
  if (texNow().includes('calibrationX')) throw new Error('undo of replace all failed');
});
await step('table', async () => {
  const last = win.locator('.ProseMirror > p').nth(3);
  await last.click();
  await win.keyboard.press('End');
  await win.keyboard.press('Control+Alt+t');
  await win.getByRole('button', { name: /^Insert \d+ × \d+ table$/ }).click();
  await win.locator('.tblock').first().waitFor();
  await win.waitForTimeout(900);
  if (!(await win.locator('.panel-right').count())) throw new Error('properties panel did not auto-open for table');
  await win.keyboard.type('Grade');
  await win.keyboard.press('Tab');
  await win.keyboard.type('PD');
  await win.getByRole('toolbar', { name: 'Table' }).waitFor();
  await shot('14-table');
  await win.waitForTimeout(1500);
  const t = texNow();
  if (!/\\begin\{tabular\}\{l r r\}|\\begin\{tabular\}\{lrr\}/.test(t) && !/\\begin\{tabular\}/.test(t)) throw new Error('table not serialized');
  if (!t.includes('Grade')) throw new Error('cell text not serialized');
  // leave the table: panel closes again
  await win.locator('.ProseMirror > p').first().click();
  await win.waitForTimeout(900);
  if (await win.locator('.panel-right').count()) throw new Error('panel stayed open after leaving the table');
});
await step('comments', async () => {
  const p = win.locator('.ProseMirror > p').nth(1);
  await p.scrollIntoViewIfNeeded();
  await p.click({ clickCount: 3 });
  await win.keyboard.press('Control+Alt+m');
  await win.getByPlaceholder(/Add a comment/).fill('Please cite the source for this.');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(1200);
  if (!(await win.locator('.ProseMirror .cmt').count())) throw new Error('no comment highlight');
  const f = path.join(projDirOf(), 'quire-comments.json');
  if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes('Please cite')) throw new Error('comment not saved');
  await win.locator('.thread').first().click();
  await win.getByRole('button', { name: 'Reply…' }).click();
  await win.getByPlaceholder('Reply…').fill('Added Tasche (2013).');
  await win.keyboard.press('Control+Enter');
  await win.waitForTimeout(500);
  await shot('15-comments');
  await win.getByRole('button', { name: 'Resolve thread' }).click();
  await win.waitForTimeout(600);
  if (!fs.readFileSync(f, 'utf8').includes('"resolved": true')) throw new Error('resolve not saved');
});
await step('context-menu', async () => {
  const p = win.locator('.ProseMirror > p').nth(2);
  await p.click({ button: 'right' });
  await win.locator('.ctx-root .menu').waitFor();
  await shot('16-context-menu');
  await win.keyboard.press('Escape');
});
await step('ctrl-click-ref', async () => {
  const ref = win.locator('.chip-ref').first();
  await ref.scrollIntoViewIfNeeded();
  const before = await win.evaluate(() => document.querySelector('.doc-canvas').scrollTop);
  await ref.click({ modifiers: ['Control'] });
  await win.waitForTimeout(900);
  const after = await win.evaluate(() => document.querySelector('.doc-canvas').scrollTop);
  console.log('scroll before/after ctrl+click', before, after);
  if (Math.abs(after - before) < 20 && !(await win.locator('.sync-target').count())) throw new Error('ctrl+click did not navigate');
});
await step('drag-ref', async () => {
  // Playwright cannot start a native drag under xvfb, so dispatch the DnD events ProseMirror handles.
  const refs0 = (texNow().match(/\\(auto|eq)?ref\{/g) ?? []).length;
  const para = win.locator('.ProseMirror > p', { has: win.locator('.chip-ref') }).first();
  await para.scrollIntoViewIfNeeded();
  const pb = await para.boundingBox();
  const chip = para.locator('.chip-ref').first();
  const cb = await chip.boundingBox();
  await win.mouse.click(pb.x + 1, pb.y + 8);
  await win.keyboard.down('Shift');
  await win.mouse.click(cb.x + cb.width + 2, cb.y + cb.height / 2);
  await win.keyboard.up('Shift');
  await win.waitForTimeout(400);
  console.log('drag selection', await win.evaluate(() => window.getSelection().toString().length));
  const idx = await win.evaluate(() => {
    const chipEl = document.querySelector('.ProseMirror > p .chip-ref');
    const ps = [...document.querySelectorAll('.ProseMirror > p')];
    const tgt = ps.find((p) => !p.querySelector('.chip-ref') && p.textContent.length > 40 && !p.querySelector('.chip-cite') && p !== chipEl.closest('p'));
    if (!tgt) return -1;
    tgt.scrollIntoView({ block: 'center' });
    const cr = chipEl.getBoundingClientRect(); const tr = tgt.getBoundingClientRect();
    const dt = new DataTransfer();
    const ev = (type, el, x, y) => el.dispatchEvent(new DragEvent(type, { bubbles: true, cancelable: true, dataTransfer: dt, clientX: x, clientY: y }));
    ev('dragstart', chipEl, cr.left + 2, cr.top + cr.height / 2);
    ev('dragover', tgt, tr.left + 30, tr.top + 8);
    ev('drop', tgt, tr.left + 30, tr.top + 8);
    ev('dragend', chipEl, 0, 0);
    return ps.indexOf(tgt);
  });
  await win.waitForTimeout(1500);
  const moved = idx < 0 ? 0 : await win.evaluate((i) => document.querySelectorAll('.ProseMirror > p')[i].querySelectorAll('.chip-ref').length, idx);
  const refs1 = (texNow().match(/\\(auto|eq)?ref\{/g) ?? []).length;
  console.log('refs before/after drag', refs0, refs1, 'chips in drop target', moved);
  if (refs1 < refs0 || moved < 1) throw new Error('cross-references lost in drag-and-drop');
  await shot('16b-after-drag');
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(800);
});
await step('equation-autocomplete', async () => {
  const eq = win.locator('.eq').first();
  await eq.scrollIntoViewIfNeeded();
  await win.waitForTimeout(900);
  await eq.dblclick();
  await win.locator('.eqmodal').waitFor();
  await win.locator('.eqmodal .cm-content').click();
  await win.keyboard.press('Control+End');
  await win.keyboard.type(' + \\su');
  await win.locator('.cm-tooltip-autocomplete').waitFor({ timeout: 3000 });
  const txt = await win.locator('.cm-tooltip-autocomplete').innerText();
  if (!txt.includes('\\sum')) throw new Error(`no \\sum suggestion: ${txt.slice(0, 200)}`);
  await shot('17-equation-modal');
  await win.getByRole('button', { name: 'Discard changes' }).click();
});
await step('python-highlight', async () => {
  const n = await win.locator('.ProseMirror pre .hljs-keyword').count();
  if (!n) throw new Error('no Python syntax colouring');
  const sc = await win.locator('.ProseMirror pre').first().getAttribute('spellcheck');
  if (sc !== 'false') throw new Error('spellcheck still on in code');
});
await step('files-tab', async () => {
  await win.getByRole('tab', { name: 'Files' }).click();
  await win.getByRole('treeitem', { name: /preamble\.tex/ }).click();
  await win.waitForTimeout(600);
  if (!(await win.getByRole('tab', { name: /preamble\.tex/ }).count())) throw new Error('preamble.tex tab not opened');
  const tabs = await win.locator('.ftabs-scroll [role=tab]').count();
  if (tabs !== 2) throw new Error(`expected 2 source tabs, got ${tabs}`);
  await shot('18-files-tab');
  await win.getByRole('button', { name: 'Close preamble.tex' }).click();
  await win.getByRole('button', { name: 'Visual' }).click();
});
await step('settings', async () => {
  await win.keyboard.press('Control+,');
  await win.getByText('Keyboard shortcuts').first().waitFor();
  await shot('19-settings');
  await win.getByRole('button', { name: /Back to document/ }).click();
});
await step('home-again', async () => {
  await win.getByRole('button', { name: 'Quire home' }).click();
  await shot('09-home');
});
fs.writeFileSync(path.join(out, 'console-errors.txt'), errors.join('\n'));
console.log(`console errors: ${errors.length}`);
await app.close();
