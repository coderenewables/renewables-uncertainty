// Browser checks for "Import from a report" (review findings F8, F12, N9, N10, R-E, S3, T3, U5 and U6): a click right after editing a value
// is not lost, Tab moves on, "Tick all that are ready" respects rows you ticked and values without evidence,
// and Undo import puts back the baseline you had pinned (or none).
// Usage: node tests/import-ui.js <outdir>   (set CHROME=/path/to/chrome to use an installed browser)
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path'), os = require('os');
const OUT = process.argv[2] || os.tmpdir();
const body = fs.readFileSync(path.join(__dirname, '../dist/wind-energy-uncertainty.html'), 'utf8');
const page = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const file = path.join(OUT, 'import-harness.html'); fs.writeFileSync(file, page);
const WIND = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/report-import-wind.json'), 'utf8'));
const BASE_KEY = 'wattodds:baseline:v1';

(async () => {
  const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
  const errors = []; let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) errors.push(msg); if (process.env.TRACE) console.log(checks, cond ? 'ok' : 'FAIL', msg); };
  const ctx = await browser.newContext({ viewport: { width: 1300, height: 900 } });
  const p = await ctx.newPage();
  p.setDefaultTimeout(4000);   // optional buttons that are not on screen are skipped quickly
  p.on('pageerror', e => errors.push('page error: ' + e.message));
  p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::/.test(m.text())) errors.push('console: ' + m.text()); });
  await p.goto('file://' + file); await p.waitForTimeout(400);
  await p.click('button[data-act="mode"][data-val="steps"]').catch(() => {}); await p.waitForTimeout(150);

  const wait = ms => p.waitForTimeout(ms || 150);
  const btn = async () => (await p.textContent('#riApply')).trim();
  const checked = sel => p.$eval(sel, e => e.checked);
  const active = () => p.evaluate(() => (document.activeElement ? document.activeElement.id || document.activeElement.tagName : ''));
  const baseAt = () => p.evaluate(k => { try { const o = JSON.parse(localStorage.getItem(k) || 'null'); return o && o.at ? o.at : null; } catch (e) { return 'unreadable'; } }, BASE_KEY);
  async function openAndCheck(text) {
    if (!(await p.$('#overlay .sheet-panel'))) { await p.click('button[data-act="projects"]'); await wait(80); await p.click('#overlay button[data-act="riopen"]'); await wait(80); }
    if (!(await p.$('#riText'))) { await p.click('button[data-act="riback"]').catch(() => {}); await p.click('button[data-act="rinew"]').catch(() => {}); await wait(80); }
    await p.fill('#riText', text); await p.click('button[data-act="richeck"]'); await wait(250);
  }
  const close = async () => { await p.click('#overlay button[data-act="close"]'); await wait(100); };

  // F8: a click right after editing a value is not lost
  await openAndCheck(JSON.stringify(WIND));
  ok(await btn() === 'Import 20 values', 'start: ' + await btn());
  ok(await checked('#ri-use-9'), 'row 9 starts ticked');
  await p.fill('#ri-v-2', '2.3');
  await p.click('#ri-use-9'); await wait();
  ok(!(await checked('#ri-use-9')), 'F8: the click on row 9 right after editing row 2 was lost');
  ok(await btn() === 'Import 19 values', 'F8: after edit and untick the button reads ' + await btn());
  ok(await p.$eval('#ri-v-2', e => e.value) === '2.3', 'F8: the edited value was not kept');
  // F8: Tab after an edit moves on to the next control instead of returning to the field
  await p.fill('#ri-v-3', '1.1'); await p.press('#ri-v-3', 'Tab'); await wait();
  ok(await active() === 'ri-use-4', 'F8: after Tab the focus is on ' + await active() + ', not the next row');

  // N10: a click on a drop-down right after editing a value keeps the drop-down (the table is not redrawn under it)
  await p.fill('#ri-v-4', '1.2');
  await p.$eval('#overlay select[data-ri="id"]', e => { e.dataset.mark = 'n10'; });
  await p.click('#overlay select[data-ri="id"]'); await wait(200);
  ok(await p.evaluate(() => { const a = document.activeElement; return !!a && a.tagName === 'SELECT' && a.dataset.mark === 'n10' && a.isConnected; }), 'N10: the drop-down was redrawn after a value edit, so the click on it was lost');
  ok(await p.$eval('#ri-v-4', e => e.value) === '1.2', 'N10: the edited value was not kept');
  await p.keyboard.press('Escape').catch(() => {}); await wait(100);

  // R-E: a value edit made while a drop-down is then opened is shown once the drop-down loses focus
  await openAndCheck(JSON.stringify(WIND));
  await p.fill('#ri-v-2', '-99');
  await p.click('#overlay select[data-ri="id"]'); await wait(150);
  await p.click('#ovTitle'); await wait(250);
  ok(!(await checked('#ri-use-2')), 'R-E: after the drop-down lost focus, row 2 (now out of range) is still shown ticked');
  ok(/outside the range/.test(await p.$eval('#ri-v-2', e => e.closest('tr').textContent)), 'R-E: the range message for row 2 is not shown');

  // S3: a click held for a moment (as a real mouse click is) right after editing a value is not lost
  await openAndCheck(JSON.stringify(WIND));
  await p.fill('#ri-v-2', '2.4');
  await p.click('#ri-use-9', { delay: 120 }); await wait(200);
  ok(!(await checked('#ri-use-9')), 'S3: a 120 ms click on row 9 right after editing row 2 was lost');
  ok(await btn() === 'Import 19 values', 'S3: after edit and a 120 ms untick the button reads ' + await btn());
  ok(await p.$eval('#ri-v-2', e => e.value) === '2.4', 'S3: the edited value was not kept');
  // ...and the same after an edit followed by a drop-down
  await p.fill('#ri-v-3', '1.3');
  await p.click('#overlay select[data-ri="id"]', { delay: 120 }); await wait(150);
  await p.click('#ri-use-8', { delay: 120 }); await wait(200);
  ok(!(await checked('#ri-use-8')), 'S3: a 120 ms click on row 8 after an edit and a drop-down was lost');
  ok(await p.$eval('#ri-v-3', e => e.value) === '1.3', 'S3: the value edited before the drop-down was not kept');
  // a held click on a button still works after an edit
  await p.fill('#ri-v-4', '1.4');
  await p.click('button[data-act="rinone"]', { delay: 120 }); await wait(200);
  ok(await p.$$eval('input[data-ri="use"]:checked, input[data-ri="basic"]:checked', l => l.length) === 0, 'S3: a 120 ms click on "Untick all" after an edit was lost');

  // T3: a press whose release never reaches the page (a drop-down's list, a right-click menu) does not leave the table stale
  const press = sel => p.$eval(sel, e => e.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true, button: 0, buttons: 1 })));
  async function staleCheck(name, before) {
    await openAndCheck(JSON.stringify(WIND));
    await p.click('#ri-use-3'); await wait();
    ok(await btn() === 'Import 19 values', 'T3 ' + name + ': start ' + await btn());
    await before();
    await p.focus('#ri-v-3'); await p.fill('#ri-v-3', '0.7'); await p.press('#ri-v-3', 'Tab'); await wait(250);
    ok(await checked('#ri-use-3'), 'T3 ' + name + ': the table still shows row 3 unticked after its value was edited');
    ok(await btn() === 'Import 20 values', 'T3 ' + name + ': the button reads ' + await btn() + ' while 20 values would be imported');
  }
  await staleCheck('drop-down', async () => { await press('#overlay select[data-ri="id"]'); });
  await staleCheck('right-click', async () => { await press('#ri-v-5'); await p.$eval('#ri-v-5', e => e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))); });
  await staleCheck('release outside the page', async () => { await press('#ri-v-5'); await p.$eval('#ri-v-5', e => e.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, buttons: 0 }))); });
  await staleCheck('keyboard after a lost release', async () => { await press('#ri-v-5'); });

  // U5: Import never applies a table you have not seen: right after an edit, the first click shows the table as it now is
  await openAndCheck(JSON.stringify(WIND));
  await p.click('#ri-use-3'); await wait();
  ok(await btn() === 'Import 19 values', 'U5: start ' + await btn());
  await p.fill('#ri-v-3', '0.7');
  await p.click('#riApply', { delay: 60 }); await wait(400);
  ok(!(await p.$('button[data-act="riundo"]')), 'U5: Import applied a table that was not on screen');
  ok(await p.$('#riApply') && await btn() === 'Import 20 values', 'U5: after the first click the button does not show the 20 values');
  ok(await checked('#ri-use-3'), 'U5: after the first click row 3 is not shown ticked');
  ok((await p.textContent('#ovStatus')).trim() === 'The table now shows your last change. Check it, then import.', 'U5: status is "' + (await p.textContent('#ovStatus')).trim() + '"');
  await p.click('#riApply'); await wait(500);
  ok(!!(await p.$('button[data-act="riundo"]')), 'U5: the second click did not import');
  await p.click('button[data-act="riundo"]'); await wait(400);
  await close();

  // U6: Shift pressed while the mouse is held on a tick box, right after an edit, does not lose the click
  await openAndCheck(JSON.stringify(WIND));
  await p.fill('#ri-v-2', '2.5');
  await p.$eval('#ri-use-9', e => e.scrollIntoView({ block: 'center' })); await wait(80);
  const bb = await (await p.$('#ri-use-9')).boundingBox();
  await p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await p.mouse.down(); await wait(40);
  await p.keyboard.down('Shift'); await wait(40); await p.keyboard.up('Shift'); await wait(40);
  await p.mouse.up(); await wait(250);
  ok(!(await checked('#ri-use-9')), 'U6: the click on row 9 was lost when Shift was pressed during it');
  ok(await btn() === 'Import 19 values', 'U6: the button reads ' + await btn());

  // F12: "Tick all that are ready" keeps rows you ticked and leaves project values without evidence alone
  const extra = JSON.parse(JSON.stringify(WIND));
  extra.items.push({ id: 'blockage', device: null, covers: [], label: 'Blockage', quantity: 'loss', value: 2, unit: '%', percent_of: null, level: null, stated_as: 'loss', period_years: null, evidence: { page: 44, quote: 'Blockage 2.0%' }, confidence: 'low', notes: null });
  extra.project.hub_height_m = { value: 140, page: null, quote: '' };
  await openAndCheck(JSON.stringify(extra));
  ok(!(await checked('#ri-use-12')), 'F12: the low-confidence row starts ticked');
  ok(!(await checked('#ri-b-hub_height_m')), 'F12: the project value without evidence starts ticked');
  await p.click('#ri-use-12'); await wait();
  ok(await checked('#ri-use-12'), 'F12: could not tick the low-confidence row');
  await p.click('#ri-use-1'); await wait();
  ok(!(await checked('#ri-use-1')), 'F12: could not untick row 1');
  await p.click('button[data-act="riall"]'); await wait();
  ok(await checked('#ri-use-12'), 'F12: "Tick all that are ready" unticked a row you had ticked');
  ok(await checked('#ri-use-1'), 'F12: "Tick all that are ready" did not tick a ready row');
  ok(!(await checked('#ri-b-hub_height_m')), 'F12: "Tick all that are ready" ticked a project value without evidence');
  await p.click('button[data-act="rinone"]'); await wait();
  ok(await p.$$eval('input[data-ri="use"]:checked, input[data-ri="basic"]:checked', l => l.length) === 0, 'F12: "Untick all" left rows ticked');
  await close();

  // F12: Undo import puts back the baseline you had pinned
  await p.click('button[data-act="rrpin"]'); await wait(200);
  const pinned = await baseAt();
  ok(!!pinned && pinned !== 'unreadable', 'could not pin a baseline');
  await openAndCheck(JSON.stringify(WIND));
  await p.click('#riApply'); await wait(500);
  ok(await baseAt() !== pinned, 'the import should compare with the project before the import');
  await p.click('button[data-act="riundo"]'); await wait(400);
  ok(await baseAt() === pinned, 'F12: after Undo import the baseline is ' + await baseAt() + ', not the one pinned at ' + pinned);
  await close();
  // ...and with no baseline before the import, Undo leaves none
  await p.click('button[data-act="rrclear"]'); await wait(200);
  ok(await baseAt() === null, 'could not clear the baseline');
  await openAndCheck(JSON.stringify(WIND));
  await p.click('#riApply'); await wait(500);
  await p.click('button[data-act="riundo"]'); await wait(400);
  ok(await baseAt() === null, 'F12: after Undo import with no baseline before, a baseline is left: ' + await baseAt());
  await close();

  // N9: two imports in a row, then Undo import: the baseline you pinned comes back, not the first import's
  await p.click('button[data-act="rrpin"]'); await wait(200);
  const pin2 = await baseAt();
  await openAndCheck(JSON.stringify(WIND)); await p.click('#riApply'); await wait(500);
  await p.click('button[data-act="rinew"]').catch(() => {}); await wait(100);
  await openAndCheck(JSON.stringify(WIND)); await p.click('#riApply'); await wait(500);
  await p.click('button[data-act="riundo"]'); await wait(400);
  ok(await baseAt() === pin2, 'N9: after two imports and Undo the baseline is ' + await baseAt() + ', not the one pinned at ' + pin2);
  await close();

  await browser.close();
  if (errors.length) { console.log('FAIL\n  ' + errors.join('\n  ')); process.exitCode = 1; }
  else console.log(`${checks} checks passed`);
})().catch(e => { console.log('FAIL', e.message); process.exit(1); });   // exit: the browser is still open
