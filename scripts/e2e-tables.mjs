// End-to-end check for spreadsheet tables and templates: paste from Excel, change the
// style, copy back out for Excel, a table linked to a CSV file that follows edits to the
// file, save-as-template and new projects from academic and user templates, each compiled.
//   npm run build && npm run e2e:tables        (on Linux CI wrap with xvfb-run)
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import electronPath from 'electron';

const out = path.resolve('e2e-shots');
fs.mkdirSync(out, { recursive: true });
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'quire-e2e-tables-'));
const app = await electron.launch({
  executablePath: electronPath,
  args: ['.', '--no-sandbox', `--user-data-dir=${path.join(home, 'userdata')}`],
  env: { ...process.env, HOME: home, XDG_DOCUMENTS_DIR: path.join(home, 'Documents'), QUIRE_SAMPLE_PACE: '0.01' },
});
await app.evaluate(({ app }, d) => app.setPath('documents', d), path.join(home, 'Documents'));
const win = await app.firstWindow();
const errors = [];
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
win.on('pageerror', (e) => errors.push(String(e)));
await win.setViewportSize({ width: 1440, height: 900 });
const shot = async (name) => { await win.waitForTimeout(400); await win.screenshot({ path: path.join(out, `${name}.png`) }); console.log('shot', name); };
const step = async (name, fn) => { try { await fn(); console.log('ok', name); } catch (e) { console.error(`STEP FAILED: ${name}:`, e.message); await shot(`fail-${name}`); await app.close(); process.exit(1); } };
const expect = (cond, msg) => { if (!cond) throw new Error(msg); };
const projects = () => path.join(home, 'Documents', 'Quire');
let proj = '';
const tex = (rel = 'report.tex') => fs.readFileSync(path.join(proj, rel), 'utf8');
const menu = async (top, item) => {
  await win.getByRole('menubar').getByRole('menuitem', { name: top }).click();
  await win.locator('.menu .mitem', { hasText: item }).first().click();
};
const compile = async () => {
  await win.keyboard.press('Control+Enter');
  await win.waitForFunction(() => !document.body.innerText.includes('Compiling ·'), null, { timeout: 180000 });
  await win.waitForTimeout(800);
  const log = fs.readFileSync(path.join(proj, '.quire', 'build', `${path.basename(JSON.parse(tex('quire.json')).mainFile, '.tex')}.log`), 'utf8');
  const errs = log.split('\n').filter((l) => l.startsWith('!'));
  expect(!errs.length, `LaTeX errors: ${errs.slice(0, 3).join(' | ')}`);
  expect(fs.existsSync(path.join(proj, '.quire', 'build', `${path.basename(JSON.parse(tex('quire.json')).mainFile, '.tex')}.pdf`)), 'no PDF');
};

// Excel 365's clipboard for B2:E5 with "Observed" merged over two columns and "Result" over two rows
const EXCEL_HTML = `<html><head><meta name=Generator content="Microsoft Excel 15"></head><body><table border=0>
<!--StartFragment--><tr><td>Segment</td><td colspan=2>Observed</td><td rowspan=2>Result</td></tr>
<tr><td></td><td>N</td><td>DR</td></tr>
<tr><td>Retail &amp; SME</td><td align=right>1,204</td><td align=right>1.2%</td><td>Pass</td></tr>
<tr><td>Corporate</td><td align=right>455</td><td align=right>7.7%</td><td>Fail</td></tr><!--EndFragment--></table></body></html>`;
const EXCEL_TSV = 'Segment\tObserved\t\tResult\n\tN\tDR\t\nRetail & SME\t1,204\t1.2%\tPass\nCorporate\t455\t7.7%\tFail\n';
const paste = (sel, html, text) => win.evaluate(([sel, html, text]) => {
  const dt = new DataTransfer();
  if (html) dt.setData('text/html', html);
  dt.setData('text/plain', text);
  document.querySelector(sel).dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
}, [sel, html, text]);

await step('open-sample', async () => {
  await win.getByRole('button', { name: 'Open sample project' }).first().click();
  await win.locator('.ProseMirror').waitFor({ timeout: 15000 });
  proj = path.join(projects(), fs.readdirSync(projects())[0]);
});

await step('paste-excel', async () => {
  const p = win.locator('.ProseMirror > p').nth(1);
  await p.click();
  await win.keyboard.press('End');
  const before = await win.locator('.tblock').count();
  await paste('.ProseMirror', EXCEL_HTML, EXCEL_TSV);
  await win.waitForTimeout(1500);
  expect(await win.locator('.tblock').count() === before + 1, 'pasted table not inserted');
  const t = tex();
  expect(t.includes('\\multicolumn{2}{c}{\\textbf{Observed}}'), 'merged group header missing');
  expect(t.includes('\\cmidrule(lr){2-3}'), 'partial rule under group header missing');
  expect(t.includes('\\multirow{2}{*}{\\textbf{Result}}'), 'vertical merge missing');
  expect(t.includes('Retail \\& SME & 1,204 & 1.2\\% & Pass'), 'body row wrong');
  await shot('20-paste-excel');
});

await step('style-dropdown', async () => {
  await win.getByRole('combobox', { name: 'Table style' }).selectOption('grid');
  await win.waitForTimeout(1200);
  expect(tex().includes('\\begin{tabular}{|l|r|r|l|}'), 'grid style not applied');
  await win.getByRole('combobox', { name: 'Table style' }).selectOption('minimal');
  await win.waitForTimeout(1200);
  expect(tex().includes('\\cline{2-3}'), 'minimal style lost the multi-level rule');
  await shot('21-style-minimal');
});

await step('copy-for-excel', async () => {
  await win.locator('.tblock td', { hasText: 'Corporate' }).last().click();
  await win.getByRole('button', { name: /^More/ }).last().click();
  await win.locator('.menu .mitem', { hasText: 'Copy table for Excel' }).click();
  await win.waitForTimeout(500);
  const [txt, html] = await app.evaluate(({ clipboard }) => [clipboard.readText(), clipboard.readHTML()]);
  expect(txt.startsWith('Segment\tObserved\t\tResult\n'), `TSV header wrong: ${JSON.stringify(txt.slice(0, 60))}`);
  expect(txt.includes('Corporate\t455\t7.7%\tFail'), 'TSV body wrong');
  expect(html.includes('<th colspan="2">Observed</th>') && html.includes('rowspan="2"'), 'HTML merges missing');
  // Ctrl+C on a cell selection gives tab-separated text too
  const a = win.locator('.tblock td', { hasText: 'Retail' }).last();
  const b = win.locator('.tblock td', { hasText: 'Fail' }).last();
  await a.click();
  await win.keyboard.down('Shift');
  await b.click();
  await win.keyboard.up('Shift');
  await win.keyboard.press('Control+c');
  await win.waitForTimeout(300);
  const t2 = await app.evaluate(({ clipboard }) => clipboard.readText());
  expect(t2.includes('Retail & SME\t1,204\t1.2%\tPass') && t2.includes('Corporate\t455\t7.7%\tFail'), `cell copy not TSV: ${JSON.stringify(t2)}`);
});

await step('paste-csv-text', async () => {
  await win.locator('.ProseMirror > p').nth(2).click();
  await win.keyboard.press('End');
  const before = await win.locator('.tblock').count();
  await paste('.ProseMirror', '', 'x,y\n1,2\n3,4\n');
  await win.waitForTimeout(1000);
  expect(await win.locator('.tblock').count() === before + 1, 'CSV text not converted');
  // prose with commas stays prose
  await win.locator('.ProseMirror > p').nth(2).click();
  await win.keyboard.press('End');
  await paste('.ProseMirror', '', 'However, this is a sentence, not a table.');
  await win.waitForTimeout(800);
  expect(await win.locator('.tblock').count() === before + 1, 'prose was turned into a table');
});

await step('real-clipboard', async () => {
  // through the OS clipboard: Ctrl+V converts, Ctrl+Shift+V pastes plain text
  await app.evaluate(({ clipboard }, [html, text]) => clipboard.write({ html, text }), [EXCEL_HTML, EXCEL_TSV]);
  await win.locator('.ProseMirror > p').nth(4).click();
  await win.keyboard.press('End');
  let before = await win.locator('.tblock').count();
  await win.keyboard.press('Control+Shift+v');
  await win.waitForTimeout(800);
  expect(await win.locator('.tblock').count() === before, 'Ctrl+Shift+V made a table');
  await win.keyboard.press('Control+z');
  await win.locator('.ProseMirror > p').nth(4).click();
  await win.keyboard.press('End');
  await win.keyboard.press('Control+v');
  await win.waitForTimeout(800);
  expect(await win.locator('.tblock').count() === before + 1, 'Ctrl+V did not make a table');
  // tab-separated cells pasted inside a table fill cells from the cursor
  const t = win.locator('.tblock').filter({ hasText: 'Corporate' }).last();
  await t.locator('td', { hasText: 'Corporate' }).click();
  await win.keyboard.press('Home');
  await app.evaluate(({ clipboard }) => clipboard.write({ text: 'Large corp\t999\n' }));
  await win.keyboard.press('Control+v');
  await win.waitForTimeout(800);
  const rows = await win.locator('.tblock tr').allInnerTexts();
  expect(rows.some((r) => /^Large corp\s+999\s+7\.7%\s+Fail$/.test(r.trim())), `cells not filled from the cursor: ${JSON.stringify(rows.filter((r) => r.includes('Large')))}`);
  await win.keyboard.press('Control+z');
  await win.keyboard.press('Control+z');
});

await step('header-level', async () => {
  await win.locator('.tblock td', { hasText: /^3$/ }).last().click();
  const direct = win.getByRole('button', { name: /Add a header row above the table/ });
  if (await direct.isVisible()) await direct.click();
  else { await win.getByRole('button', { name: /^More/ }).last().click(); await win.locator('.menu .mitem', { hasText: 'Add header level' }).click(); }
  await win.waitForTimeout(1200);
  const rows = await win.locator('.tblock').last().locator('tr').count();
  expect(rows === 4, `expected 4 rows after adding a header level, got ${rows}`);
});

await step('linked-csv', async () => {
  await win.locator('.ProseMirror > p').nth(3).click();
  await menu('Insert', 'Table from data file');
  await win.locator('.dialog select').first().selectOption('data/grades_2025.csv');
  await win.locator('.dt-preview table').waitFor();
  await win.locator('.dialog select').nth(2).selectOption('striped');
  await shot('22-data-table-dialog');
  await win.getByRole('button', { name: 'Insert table', exact: true }).click();
  await win.waitForTimeout(1500);
  const t = tex();
  const m = /% quire:generated id=(tab_grades_2025)\n\\input\{generated\/tab_grades_2025\.tex\}\n% quire:end/.exec(t);
  expect(m, 'linked \\input block missing from report.tex');
  const g = tex('generated/tab_grades_2025.tex');
  expect(g.includes('\\rowcolors{2}') && g.includes('1204'), 'generated table wrong');
  const cfg = JSON.parse(tex('quire.json')).blocks.tab_grades_2025;
  expect(cfg.dataFile === 'data/grades_2025.csv', 'manifest entry missing');
  // edit the CSV outside the app: the table follows
  fs.writeFileSync(path.join(proj, 'data/grades_2025.csv'), fs.readFileSync(path.join(proj, 'data/grades_2025.csv'), 'utf8').replace('1204', '9999'));
  await win.waitForFunction(() => document.body.innerText.includes('9999'), null, { timeout: 10000 });
  expect(tex('generated/tab_grades_2025.tex').includes('9999'), 'generated file did not follow the CSV');
  await win.locator('.blk-gen', { hasText: '9999' }).scrollIntoViewIfNeeded();
  await shot('23-linked-csv');
});

await step('compile-sample', async () => { await compile(); });

await step('source-paste', async () => {
  await win.getByRole('button', { name: 'LaTeX' }).click();
  await win.locator('.cm-content').click();
  await win.keyboard.press('Control+End');
  await win.keyboard.press('ArrowUp');
  await paste('.cm-content', '', 'a\tb\n1\t2\n');
  await win.waitForTimeout(800);
  expect(/\\begin\{tabular\}\{rr\}/.test(await win.locator('.cm-content').innerText()), 'source paste not converted');
  await win.keyboard.press('Control+z');
  await win.getByRole('button', { name: 'Visual' }).click();
});

await step('save-template', async () => {
  await menu('File', 'Save as template');
  await win.locator('.dialog input').first().fill('Bank validation layout');
  await shot('24-save-template');
  await win.getByRole('button', { name: 'Save template' }).click();
  await win.waitForTimeout(800);
  const dir = path.join(home, 'userdata', 'templates');
  const t = JSON.parse(fs.readFileSync(path.join(dir, 'bank-validation-layout.json'), 'utf8'));
  expect(t.layout && t.style && t.files['report.tex'] && t.files['preamble.tex'], 'template incomplete');
  expect(!t.files['report.tex'].includes('quire:generated') && t.files['report.tex'].includes('[Write this section.]'), 'layout not reduced to structure');
});

await step('setup-style', async () => {
  await win.getByRole('button', { name: 'Document setup' }).click();
  await win.getByRole('button', { name: 'Save as style…' }).click();
  await win.locator('.dialog input').first().fill('Compact A4');
  await win.getByRole('button', { name: 'OK' }).click();
  await win.locator('.pcard', { hasText: 'Compact A4' }).waitFor();
  await shot('25-setup-styles');
  await win.getByRole('button', { name: 'Cancel' }).click();
});

const newProject = async (pick, title, close = true) => {
  if (close) await menu('File', 'Close project');
  await win.getByRole('heading', { name: 'Start from a template' }).waitFor();
  await pick();
  await win.locator('.dialog input').first().fill(title);
  await win.getByRole('button', { name: 'Create project' }).click();
  await win.locator('.ProseMirror').waitFor({ timeout: 15000 });
  proj = path.join(projects(), title.replace(/\s+/g, '-'));
};

for (const [type, title] of [['Journal article', 'Journal Paper'], ['Conference paper', 'Conf Paper'], ['Thesis or dissertation', 'My Thesis'], ['APA 7 paper', 'APA Study'], ['Working paper', 'Working Paper'], ['Research proposal', 'Proposal'], ['Technical report', 'Tech Report']]) {
  await step(`template-${type}`, async () => {
    await newProject(() => win.locator('button.tpl', { hasText: type }).click(), title);
    await compile();
    if (type === 'Conference paper') { expect(tex().includes('{article}') && tex().includes('twocolumn') && tex().includes('[10pt'), 'conference class options'); await shot('26-conference'); }
    if (type === 'Thesis or dissertation') expect(tex().includes('{report}') && tex().includes('\\chapter{Introduction}'), 'thesis class');
  });
}

await step('user-template-project', async () => {
  await newProject(async () => {
    await shot('27-home-templates');
    await win.locator('.tpl', { hasText: 'Bank validation layout' }).locator('button').first().click();
  }, 'From My Template');
  const t = tex();
  expect(t.includes('\\title{From My Template}'), 'title not personalised');
  expect(t.includes('\\section{Executive summary}'), 'layout sections missing');
  await compile();
});

await step('import-tex-template', async () => {
  const dir = path.join(home, 'journal');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'journal.cls'), '\\NeedsTeXFormat{LaTeX2e}\\ProvidesClass{journal}\\LoadClass[twocolumn]{article}\n');
  fs.writeFileSync(path.join(dir, 'main.tex'), '\\documentclass{journal}\n\\title{Sample}\n\\author{Someone}\n\\begin{document}\n\\maketitle\n\\section{Intro}\nText.\n\\end{document}\n');
  await menu('File', 'Close project');
  await app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] }); }, path.join(dir, 'main.tex'));
  await win.getByRole('button', { name: 'Import .tex template…' }).click();
  await win.locator('.dialog input').first().fill('Journal X');
  await win.getByRole('button', { name: 'OK' }).click();
  await win.locator('.tpl', { hasText: 'Journal X' }).waitFor();
  await newProject(() => win.locator('.tpl', { hasText: 'Journal X' }).locator('button').first().click(), 'Journal Article', false);
  expect(fs.existsSync(path.join(proj, 'journal.cls')), 'class file not copied');
  expect(tex('main.tex').startsWith('\\documentclass{journal}') && tex('main.tex').includes('\\title{Journal Article}'), 'imported main not personalised or class options changed');
  await compile();
});

console.log('console errors:', errors.length);
for (const e of errors.slice(0, 10)) console.log('  ', e);
await app.close();
if (errors.length) process.exit(1);
