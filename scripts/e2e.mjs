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
  await win.getByRole('button', { name: /^Setup$/ }).click();
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
await step('home-again', async () => {
  await win.getByRole('button', { name: 'Quire home' }).click();
  await shot('09-home');
});
fs.writeFileSync(path.join(out, 'console-errors.txt'), errors.join('\n'));
console.log(`console errors: ${errors.length}`);
await app.close();
