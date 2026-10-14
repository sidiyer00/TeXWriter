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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'texwriter-e2e-'));
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--no-sandbox', `--user-data-dir=${path.join(home, 'userdata')}`],
  env: { ...process.env, HOME: home, XDG_DOCUMENTS_DIR: path.join(home, 'Documents'), TEXWRITER_SAMPLE_PACE: '0.01' },
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
  await win.waitForTimeout(1500);
  // two blocks wait for their scripts; the one built from a data file is there at once
  const pending = await win.locator('.blk-gen.pending').count();
  const fresh = await win.locator('.blk-gen.fresh').count();
  if (pending !== 2 || fresh !== 1) throw new Error(`expected 2 pending + 1 fresh generated blocks, got ${pending} + ${fresh}`);
  await shot('02-editor-pending');
});
const projDir = () => { const qdir = [path.join(home, 'Documents', 'TeXWriter'), path.join(home, 'TeXWriter')].find((d) => fs.existsSync(d)); return path.join(qdir, fs.readdirSync(qdir)[0]); };
const projDirOf = projDir;
const waitIdle = () => win.waitForFunction(() => !window.__texwriterState().generating, null, { timeout: 120000 });
await step('run-all', async () => {
  await win.getByRole('button', { name: 'Run all' }).first().click();
  await win.waitForTimeout(300);
  await waitIdle();
  await win.waitForTimeout(800);
  const fresh = await win.locator('.blk-gen.fresh').count();
  if (fresh !== 3) throw new Error(`after Run all: ${fresh} fresh blocks, ${await win.locator('.blk-gen.failed').count()} failed`);
  const tab = fs.readFileSync(path.join(projDir(), 'generated', 'tab_coefficients.tex'), 'utf8');
  if (!/\\qnum\[num,d3\]\{[-\d.]+\}\{0\.7\d\d\}/.test(tab)) throw new Error('coefficient table not generated with 3 decimals');
  if (!fs.existsSync(path.join(projDir(), 'outputs', 'fit.pdf'))) throw new Error('figure not written');
  await win.locator('.blk-gen.fresh canvas').first().waitFor({ timeout: 10000 });
  await win.locator('.blk-gen').nth(1).scrollIntoViewIfNeeded();
  await shot('03-generated');
});
await step('generated-tab', async () => {
  await win.getByRole('tab', { name: 'Generated' }).click();
  const n = await win.locator('.gen-item').count();
  if (n !== 3) throw new Error(`Generated tab lists ${n} items`);
  await shot('04-generated-tab');
});
await step('new-generated-table', async () => {
  await win.locator('.ProseMirror > p').nth(2).click();
  await win.keyboard.press('End');
  await win.getByRole('button', { name: '+ Table' }).click();
  const dlg = win.getByRole('dialog', { name: 'New generated table' });
  await dlg.getByLabel(/^Label/).fill('tab:groups');
  await dlg.getByLabel('Caption').fill('Summary statistics by group.');
  await shot('05-new-generated-dialog');
  await dlg.getByRole('button', { name: 'Insert and run' }).click();
  await win.waitForTimeout(500);
  await waitIdle();
  await win.waitForTimeout(800);
  const s = fs.readFileSync(path.join(projDir(), 'scripts', 'tab_groups.py'), 'utf8');
  if (!s.includes('TEXWRITER_OUTPUT')) throw new Error('starter script not written');
  const g = fs.readFileSync(path.join(projDir(), 'generated', 'tab_groups.tex'), 'utf8');
  if (!g.includes('\\label{tab:groups}') || !g.includes('Std. dev.')) throw new Error('new generated table not built');
  if (!fs.readFileSync(path.join(projDir(), 'report.tex'), 'utf8').includes('\\input{generated/tab_groups.tex}')) throw new Error('block not inserted in the document');
  await win.locator('.blk-gen', { hasText: 'Summary statistics by group' }).scrollIntoViewIfNeeded();
  await shot('06-new-generated');
});
await step('new-generated-figure', async () => {
  await win.getByRole('button', { name: '+ Figure' }).click();
  const dlg = win.getByRole('dialog', { name: 'New generated figure' });
  await dlg.getByLabel(/^Label/).fill('fig:curve');
  await dlg.getByLabel('Caption').fill('A damped sine.');
  await dlg.getByRole('button', { name: 'Insert and run' }).click();
  await win.waitForTimeout(500);
  await waitIdle();
  if (!fs.existsSync(path.join(projDir(), 'outputs', 'fig_curve.pdf'))) throw new Error('starter figure script did not write a PDF');
});
await step('failing-script', async () => {
  const f = path.join(projDir(), 'scripts', 'tab_groups.py');
  const ok = fs.readFileSync(f, 'utf8');
  fs.writeFileSync(f, ok.replace('random.seed(1)', 'random.seed(1)\nraise ValueError("bad input data")'));
  await win.locator('.gen-item', { hasText: 'tab:groups' }).getByRole('button', { name: /^Run / }).click();
  await win.waitForTimeout(300);
  await waitIdle();
  await win.locator('.blk-gen.failed').waitFor({ timeout: 5000 });
  await win.locator('.gen-item', { hasText: 'tab:groups' }).locator('button').first().click();
  await win.locator('.panel-right').waitFor();
  const log = await win.locator('.panel-right .gen-log').innerText();
  if (!log.includes('ValueError: bad input data')) throw new Error(`log does not show the Python error: ${log.slice(0, 200)}`);
  await shot('07-failed-run');
  fs.writeFileSync(f, ok);
  await win.locator('.panel-right').getByRole('button', { name: 'Run script' }).click();
  await win.waitForTimeout(300);
  await waitIdle();
  await win.waitForTimeout(500);
  if (await win.locator('.blk-gen.failed').count()) throw new Error('block still failed after fixing the script');
  await win.getByRole('button', { name: 'Close panel' }).click();
});
await step('model-output-file', async () => {
  // the table without a script follows its file
  const f = path.join(projDir(), 'data', 'holdout_metrics.csv');
  fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('1.037', '9.876'));
  await win.waitForFunction(() => document.body.innerText.includes('9.876'), null, { timeout: 10000 });
  if (!fs.readFileSync(path.join(projDir(), 'generated', 'tab_holdout.tex'), 'utf8').includes('9.876')) throw new Error('generated file did not follow the data file');
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
  const log = fs.readFileSync(path.join(projDir(), '.texwriter', 'build', 'report.log'), 'utf8');
  const errs = log.split('\n').filter((l) => l.startsWith('!'));
  if (errs.length) throw new Error(`LaTeX errors: ${errs.slice(0, 3).join(' | ')}`);
  await win.getByRole('button', { name: /Compiled|Compile failed|Not compiled/ }).first().click();
  await win.locator('.pdf-page canvas').first().waitFor({ timeout: 20000 }).catch(() => {});
  await win.waitForTimeout(2500);
  await shot('06-review');
});
await step('setup', async () => {
  await win.getByRole('button', { name: /Back to editor/ }).click();
  await win.getByRole('button', { name: 'Document setup' }).click();
  await win.getByRole('heading', { name: 'Generated content' }).waitFor();
  await shot('07-setup');
});
await step('source', async () => {
  await win.getByRole('button', { name: 'Cancel' }).click();
  await win.getByRole('button', { name: 'LaTeX' }).click();
  await shot('08-source');
});
await step('round-trip-edits', async () => {
  await win.getByRole('button', { name: 'Visual' }).click();
  const p = win.locator('.ProseMirror p').first();
  await p.click();
  await win.keyboard.press('End');
  await win.keyboard.type(' Visual edit marker 123.');
  await win.waitForTimeout(2500);
  const projDir = projDirOf();
  const tex = fs.readFileSync(path.join(projDir, 'report.tex'), 'utf8');
  if (!tex.includes('Visual edit marker 123.')) throw new Error('visual edit not saved to report.tex');
  if (!tex.includes('\\begin{equation}\\label{eq:model}')) throw new Error('equation lost');
  await win.getByRole('button', { name: 'LaTeX' }).click();
  await win.locator('.cm-content').click();
  await win.keyboard.press('Control+End');
  await win.keyboard.type('\n% source edit marker');
  await win.waitForTimeout(2000);
  const tex2 = fs.readFileSync(path.join(projDir, 'report.tex'), 'utf8');
  if (!tex2.includes('% source edit marker')) throw new Error('source edit not saved');
  await win.getByRole('button', { name: 'Visual' }).click();
});
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
await step('menubar', async () => {
  await win.getByRole('menubar').getByRole('menuitem', { name: 'Insert' }).click();
  const m = win.locator('.menu').first();
  await m.waitFor();
  const ok = await m.evaluate((el) => { const tb = document.querySelector('.titlebar').getBoundingClientRect(); const last = [...el.querySelectorAll('.mitem')].pop().getBoundingClientRect(); const hit = document.elementFromPoint(last.left + 20, last.top + last.height / 2); return last.top > tb.bottom && el.contains(hit); });
  if (!ok) throw new Error('menu bar dropdown clipped by the title bar');
  await shot('12b-insert-menu');
  await win.keyboard.press('Escape');
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
  await win.evaluate(() => { const w = window; w.__log = []; let last = w.__texwriterState().files['report.tex']?.version; w.__iv = setInterval(() => { const f = w.__texwriterState().files['report.tex']; if (f.version !== last) { w.__log.push(f.origin + ':' + f.version + ':' + document.querySelectorAll('.ProseMirror u').length); last = f.version; } }, 10); });
  await win.keyboard.press('Control+Shift+h');
  await win.waitForTimeout(1500);
  console.log('version log', await win.evaluate(() => { clearInterval(window.__iv); return window.__log.join(' '); }));
  if (!(await win.locator('.ProseMirror u').count())) throw new Error('no <u> after Ctrl+U');
  const t = texNow();
  if (!/\\underline\{/.test(t)) throw new Error('\\underline not written');
  if (!/\\texwriterhl\{FFF176\}/.test(t)) throw new Error('\\texwriterhl not written');
});
await step('find-replace', async () => {
  await win.locator('.ProseMirror > p').first().click();
  await win.keyboard.press('Control+h');
  await win.getByRole('searchbox').or(win.getByLabel('Find', { exact: true })).first().fill('holdout');
  await win.waitForTimeout(300);
  const status = await win.locator('.findbar [aria-live]').innerText();
  if (!/of \d+/.test(status)) throw new Error(`find status: ${status}`);
  const n = Number(/of (\d+)/.exec(status)[1]);
  const hl = await win.locator('.find-match').count();
  if (hl < 1) throw new Error('no find highlights');
  await shot('13-find');
  await win.getByLabel('Replace with').fill('holdoutX');
  await win.getByRole('button', { name: 'Replace all' }).click();
  await win.waitForTimeout(1500);
  const cnt = (texNow().match(/holdoutX/g) ?? []).length;
  console.log('find matches', n, 'replaced', cnt);
  if (cnt !== n) throw new Error(`replace all: ${n} matches but ${cnt} replaced`);
  await win.getByRole('button', { name: 'Close find (Esc)' }).click();
  await win.keyboard.press('Control+z');
  await win.waitForTimeout(1500);
  if (texNow().includes('holdoutX')) throw new Error('undo of replace all failed');
});
await step('table', async () => {
  const last = win.locator('.ProseMirror > p').nth(3);
  await last.click();
  await win.keyboard.press('End');
  await win.keyboard.press('Control+Alt+t');
  await win.getByRole('button', { name: /^Insert \d+ × \d+ table$/ }).click();
  await win.locator('.tblock').first().waitFor();
  await win.waitForTimeout(900);
  if (await win.locator('.panel-right').count()) throw new Error('properties panel opened by itself for a table');
  await win.keyboard.type('Grade');
  await win.keyboard.press('Tab');
  await win.keyboard.type('PD');
  await win.getByRole('toolbar', { name: 'Table' }).waitFor();
  await shot('14-table');
  await win.waitForTimeout(1500);
  const t = texNow();
  if (!/\\begin\{tabular\}\{l r r\}|\\begin\{tabular\}\{lrr\}/.test(t) && !/\\begin\{tabular\}/.test(t)) throw new Error('table not serialized');
  if (!t.includes('Grade')) throw new Error('cell text not serialized');
  // the panel opens only from its button; while open, the toolbar buttons give way to its tabs
  const fmt = win.getByRole('toolbar', { name: 'Formatting' });
  await fmt.getByRole('button', { name: 'Properties' }).click();
  await win.locator('.panel-right').waitFor();
  if (await fmt.getByRole('button', { name: /^(Properties|Comments)/ }).count()) throw new Error('toolbar panel buttons still shown while panel open');
  await win.getByRole('button', { name: 'Close panel' }).click();
  await fmt.getByRole('button', { name: 'Properties' }).waitFor();
  if (await win.locator('.panel-right').count()) throw new Error('panel did not close');
});
await step('table-numbers', async () => {
  const tbar = win.getByRole('toolbar', { name: 'Table' });
  const cell = win.locator('.tblock td').nth(1); // first body row, second column
  const cellText = async () => (await cell.innerText()).trim();
  // entering a table must not move the page: the table toolbar floats
  await win.locator('.ProseMirror > p').first().click();
  await win.waitForTimeout(300);
  if (await tbar.count()) throw new Error('table toolbar shown outside a table');
  await cell.scrollIntoViewIfNeeded();
  const y0 = (await cell.boundingBox()).y;
  await cell.click();
  await tbar.waitFor();
  await win.waitForTimeout(300);
  const y1 = (await cell.boundingBox()).y;
  if (Math.abs(y1 - y0) > 1) throw new Error(`document moved when the table toolbar appeared (${y0} → ${y1})`);
  // Excel-style formats keep the full value
  await win.keyboard.type('0.12345');
  await tbar.getByRole('combobox', { name: 'Number format' }).selectOption('percent');
  if ((await cellText()) !== '12.35%') throw new Error(`percentage: ${await cellText()}`);
  await tbar.getByRole('button', { name: /^Increase decimal/ }).click();
  if ((await cellText()) !== '12.345%') throw new Error(`increase decimal: ${await cellText()}`);
  await tbar.getByRole('button', { name: /^Decrease decimal/ }).click();
  await tbar.getByRole('button', { name: /^Decrease decimal/ }).click();
  if ((await cellText()) !== '12.3%') throw new Error(`decrease decimal: ${await cellText()}`);
  const v = await tbar.getByRole('textbox', { name: /Cell value/ }).inputValue();
  if (v !== '0.12345') throw new Error(`value box shows ${v}`);
  await win.waitForTimeout(1200);
  if (!texNow().includes('\\qnum[pct,d1]{0.12345}{12.3\\%}')) throw new Error('number format not serialized');
  // a number typed into a formatted cell takes the format when the cursor leaves it
  await cell.click();
  await win.waitForTimeout(300);
  await win.keyboard.press('End');
  await win.keyboard.press('Shift+Home');
  await win.keyboard.type('7.5');
  await win.keyboard.press('Tab');
  await win.waitForTimeout(300);
  if ((await cellText()) !== '7.5%') throw new Error(`typed entry not formatted: ${await cellText()}`);
  // the full dialog: currency, negatives in parentheses
  await cell.click();
  await win.waitForTimeout(300);
  await tbar.getByRole('button', { name: /^Number format: decimals/ }).click();
  const dlg = win.getByRole('dialog', { name: 'Number format' });
  await dlg.getByRole('radio', { name: /^Currency/ }).click();
  await dlg.getByRole('radio', { name: /^\(1,234\.10\)$/ }).check();
  await shot('14b-number-format');
  await dlg.getByRole('button', { name: 'Apply' }).click();
  if ((await cellText()) !== '$0.08') throw new Error(`currency: ${await cellText()}`);
  await shot('14c-table-numbers');
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
  const f = path.join(projDirOf(), 'texwriter-comments.json');
  if (!fs.existsSync(f) || !fs.readFileSync(f, 'utf8').includes('Please cite')) throw new Error('comment not saved');
  await win.locator('.thread').first().click();
  await win.getByRole('button', { name: 'Reply…' }).click();
  await win.getByPlaceholder('Reply…').fill('Added a reference.');
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
  await win.locator('.menu.ctx').waitFor();
  const colour = win.locator('.menu.ctx').getByRole('menuitem', { name: 'Text colour' });
  await colour.hover();
  await win.waitForTimeout(300);
  if ((await win.locator('.menu.ctx').count()) !== 1) throw new Error('submenu opened on hover');
  await colour.click();
  const subm = win.locator('.menu.ctx').nth(1);
  await subm.waitFor();
  const vis = await subm.evaluate((el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 12); return r.right <= innerWidth && r.bottom <= innerHeight && !!hit && el.contains(hit); });
  if (!vis) throw new Error('context submenu clipped or hidden');
  await shot('16-context-menu');
  await win.keyboard.press('Escape');
  await win.keyboard.press('Escape');
});
await step('ctrl-click-ref', async () => {
  if (await win.locator('.panel-right').count()) await win.getByRole('button', { name: 'Close panel' }).click();
  const ref = win.locator('.chip-ref').first();
  await ref.scrollIntoViewIfNeeded();
  const before = await win.evaluate(() => document.querySelector('.doc-canvas').scrollTop);
  await ref.click({ modifiers: ['Control'] });
  await win.waitForTimeout(900);
  const after = await win.evaluate(() => document.querySelector('.doc-canvas').scrollTop);
  console.log('scroll before/after ctrl+click', before, after);
  if (Math.abs(after - before) < 20 && !(await win.locator('.sync-target').count())) throw new Error('ctrl+click did not navigate');
  if (await win.locator('.panel-right').count()) throw new Error('ctrl+click on a cross-ref opened the side panel');
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
await step('system-shortcuts', async () => {
  // the Windows key belongs to the OS: Win+S (search), Win+Shift+S (snipping), Win+1…
  const prevented = (init) => win.evaluate((i) => { const ev = new KeyboardEvent('keydown', { ...i, bubbles: true, cancelable: true }); window.dispatchEvent(ev); return ev.defaultPrevented; }, init);
  for (const k of [{ key: 's', metaKey: true }, { key: 'S', metaKey: true, shiftKey: true }, { key: '1', metaKey: true }, { key: 'F1', metaKey: true }]) {
    if (await prevented(k)) throw new Error(`TeXWriter intercepted ${JSON.stringify(k)}`);
  }
  if (!(await prevented({ key: 's', ctrlKey: true }))) throw new Error('Ctrl+S not handled');
});
await step('home-again', async () => {
  await win.getByRole('button', { name: 'TeXWriter home' }).click();
  await shot('09-home');
});
fs.writeFileSync(path.join(out, 'console-errors.txt'), errors.join('\n'));
console.log(`console errors: ${errors.length}`);
await app.close();
