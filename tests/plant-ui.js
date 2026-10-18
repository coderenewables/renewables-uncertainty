// Browser checks for the plant view: drawing, badges, pop-out categories, inspector inputs,
// live updates, hybrid drill-down, battery and firm supply, phone chain and bottom sheet.
const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = process.argv[2];
const body = fs.readFileSync(path.join(__dirname, '../dist/wind-energy-uncertainty.html'), 'utf8');
const page = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const file = path.join(OUT, 'plant-harness.html'); fs.writeFileSync(file, page);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = []; let checks = 0;
  const ok = (cond, msg) => { checks++; if (!cond) errors.push(msg); };
  async function run(name, vp, scheme, fn) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await p.goto('file://' + file); await p.waitForTimeout(400);
    const overflow = async where => { const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth); ok(ow <= 0, `${name}: horizontal overflow ${ow}px at ${where}`); };
    await fn(p, overflow);
    await ctx.close();
  }
  const p90 = p => p.$eval('.pv-tot .bb-fig:nth-child(2) .v', e => e.textContent);
  const loadExample = async (p, t) => { await p.click('button[data-act="projects"]'); await p.waitForTimeout(80); await p.click(`button[data-act="example"][data-tech="${t}"]`); await p.waitForTimeout(60); await p.click('button[data-act="replaceyes"]'); await p.waitForTimeout(120); await p.click('button[data-act="close"]'); await p.waitForTimeout(300); };

  await run('wind-desktop', { width: 1440, height: 900 }, 'light', async (p, overflow) => {
    ok(await p.$('.pv-canvas.wide'), 'wind: wide drawing missing');
    ok(!(await p.isVisible('.rail')), 'wind: step rail visible in plant view');
    const ids = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(ids.length === 8 && ids.includes('w.turbines') && ids.includes('grid'), 'wind: badges ' + ids.join(','));
    // badges must not overlap each other
    const ov = await p.$$eval('.pv-badge', bs => { const r = bs.map(b => b.getBoundingClientRect()); let n = 0; for (let i = 0; i < r.length; i++) for (let j = i + 1; j < r.length; j++) if (r[i].left < r[j].right - 1 && r[j].left < r[i].right - 1 && r[i].top < r[j].bottom - 1 && r[j].top < r[i].bottom - 1) n++; return n; });
    ok(ov === 0, 'wind: overlapping badges ' + ov);
    await overflow('wind start');
    for (const id of ids) {
      await p.click(`.pv-badge[data-pc="${id}"]`); await p.waitForTimeout(150);
      const nb = await p.$$eval('.pv-bub', b => b.length), ng = await p.$$eval('#pvInsp .pv-grp', g => g.length);
      ok(nb === ng && ng > 0, `wind: ${id} has ${nb} bubbles and ${ng} categories`);
      const inside = await p.$$eval('.pv-bub', (bs) => { const c = document.querySelector('#pvCanvas').getBoundingClientRect(); return bs.every(b => { const r = b.querySelector('.b-c').getBoundingClientRect(); return r.left >= c.left - 1 && r.right <= c.right + 1 && r.top >= c.top - 1 && r.bottom <= c.bottom + 1; }); });
      ok(inside, `wind: ${id} bubbles leave the drawing`);
      await overflow('wind ' + id);
    }
    // a category opens with its item cards; typing updates totals and keeps focus
    await p.click('.pv-badge[data-pc="w.turbines"]'); await p.waitForTimeout(150);
    if (!(await p.$('.pv-bub'))) await p.click('.pv-badge[data-pc="w.turbines"]');
    await p.click('.pv-bub[data-pg="wakes"]'); await p.waitForTimeout(200);
    const cards = await p.$$eval('#pvg-wakes .item', e => e.length);
    ok(cards === 4, 'wind: wakes category shows ' + cards + ' cards');
    const before = await p90(p), badgeBefore = await p.textContent('.pv-badge[data-pc="w.turbines"] .bm');
    await p.fill('input[data-path="items.wake_int.inputs.f"]', '45'); await p.waitForTimeout(250);
    const after = await p90(p), badgeAfter = await p.textContent('.pv-badge[data-pc="w.turbines"] .bm');
    ok(before !== after, 'wind: P90 did not update after a category input');
    ok(badgeBefore !== badgeAfter, 'wind: turbine badge did not update');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.dataset.path === 'items.wake_int.inputs.f'), 'wind: input lost focus during a live update');
    ok(await p.$$eval('.pv-bub', bs => bs.every(b => b.classList.contains('still'))), 'wind: bubbles re-animated on a live update');
    // a mode change re-renders and keeps the category open
    await p.click('button[data-mode="items.wake_int"][data-val="entered"]'); await p.waitForTimeout(150);
    ok(await p.$('#pvg-wakes .pv-gb:not([hidden])'), 'wind: category closed after a mode change');
    // devices: add a lidar from the set-up
    await p.click('.pv-badge[data-pc="w.meas"]'); await p.waitForTimeout(150);
    const g0 = await p.$$eval('#pvInsp .pv-grp', g => g.length);
    await p.click('#pvInsp details[data-sk="w.meas"] summary'); await p.waitForTimeout(80);
    await p.click('#pvInsp button[data-act="adddev"][data-type="lidar"]'); await p.waitForTimeout(200);
    ok((await p.$$eval('#pvInsp .pv-grp', g => g.length)) === g0 + 1, 'wind: adding a lidar did not add a category');
    ok(await p.$('#pvInsp details[data-sk="w.meas"][open]'), 'wind: set-up panel closed after adding a device');
    // period buttons, keyboard selection, Escape
    await p.click('.pv-hz button[data-hz="1"]'); await p.waitForTimeout(150);
    ok(/1-yr/.test(await p.textContent('.pv-tot')), 'wind: period did not switch');
    await p.keyboard.press('Escape'); await p.waitForTimeout(120);
    ok(!(await p.$('.pv-bub')), 'wind: Escape did not close the part');
    await p.focus('.pv-badge[data-pc="w.lt"]'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    ok((await p.$$eval('.pv-bub', b => b.length)) > 0, 'wind: keyboard Enter did not open the part');
    ok(await p.evaluate(() => document.activeElement && document.activeElement.dataset.pc === 'w.lt'), 'wind: focus lost after keyboard selection');
    await p.screenshot({ path: path.join(OUT, 'pv-wind.png') });
    // desktop wind atlas mode
    await p.click('.pv-badge[data-pc="w.meas"]'); await p.waitForTimeout(120);
    await p.click('#pvInsp details[data-sk="w.meas"] summary').catch(() => {});
    if (!(await p.isVisible('button[data-set="setup.dataSource"][data-val="desktop"]'))) await p.click('#pvInsp details[data-sk="w.meas"] summary');
    await p.click('button[data-set="setup.dataSource"][data-val="desktop"]'); await p.waitForTimeout(200);
    ok(/in the wind atlas/.test(await p.textContent('.pv-badge[data-pc="w.lt"]')), 'wind: long-term part not marked as in the atlas');
    // switch views both ways
    await p.click('button[data-act="mode"][data-val="steps"]'); await p.waitForTimeout(150);
    ok(await p.isVisible('.rail'), 'steps: rail not visible');
    await p.click('.stage-btn[data-stage="losses"]'); await p.waitForTimeout(100);
    await p.click('button[data-act="mode"][data-val="plant"]'); await p.waitForTimeout(150);
    ok(await p.$('.pv-canvas'), 'plant view did not come back');
    // open full results from the plant summary
    await p.keyboard.press('Escape'); await p.waitForTimeout(80);
    await p.click('#pvInsp button[data-stage="results"]'); await p.waitForTimeout(200);
    ok(await p.isVisible('.rail') && /P-values/.test(await p.textContent('#sheet')), 'full results did not open');
  });

  await run('solar-desktop', { width: 1280, height: 860 }, 'dark', async (p, overflow) => {
    await p.click('.pv-pick button[data-set="tech"][data-val="solar"]'); await p.waitForTimeout(250);
    const ids = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(ids.length === 7 && ids.includes('s.array'), 'solar: badges ' + ids.join(','));
    await p.click('.pv-badge[data-pc="s.array"]'); await p.waitForTimeout(150);
    await p.click('.pv-bub[data-pg="temp"]'); await p.waitForTimeout(150);
    const before = await p90(p);
    await p.click('button[data-mode="items.temperature"][data-val="entered"]'); await p.waitForTimeout(100);
    await p.fill('input[data-path="items.temperature.entered.s"]', '4'); await p.waitForTimeout(250);
    ok(before !== await p90(p), 'solar: temperature input did not change P90');
    await p.click('#pvInsp details[data-sk="s.array"] summary'); await p.waitForTimeout(80);
    await p.click('button[data-set="pv.mount"][data-val="fixed"]'); await p.waitForTimeout(200);
    ok(await p.$('#pvInsp details[data-sk="s.array"][open]'), 'solar: set-up closed after a change');
    await overflow('solar');
    await p.screenshot({ path: path.join(OUT, 'pv-solar.png') });
  });

  await run('hybrid-desktop', { width: 1440, height: 900 }, 'light', async (p, overflow) => {
    await p.click('.pv-pick button[data-set="tech"][data-val="hybrid"]'); await p.waitForTimeout(250);
    let ids = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(ids.join(',') === 'link,w,s,grid' || (ids.length === 4 && ids.includes('w') && ids.includes('link')), 'hybrid: site badges ' + ids.join(','));
    await p.click('.pv-badge[data-pc="link"]'); await p.waitForTimeout(150);
    const before = await p90(p);
    await p.fill('input[data-path="hybrid.rhoIav"]', '-0.6'); await p.dispatchEvent('input[data-path="hybrid.rhoIav"]', 'change'); await p.waitForTimeout(250);
    ok(before !== await p90(p), 'hybrid: correlation did not change P90');
    ok(/of total/.test(await p.textContent('.pv-badge[data-pc="link"]')), 'hybrid: link badge did not show its share');
    await p.click('.pv-badge[data-pc="w"]'); await p.waitForTimeout(250);
    ids = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(ids.length === 8 && ids.includes('w.turbines') && ids.includes('grid'), 'hybrid: wind farm badges ' + ids.join(','));
    ok(/Wind farm/.test(await p.textContent('.pv-crumbs')), 'hybrid: no breadcrumb in the wind farm');
    ok(/of wind energy/.test(await p.textContent('#pvInsp')), 'hybrid: wind farm summary not relative to wind energy');
    await p.click('.pv-badge[data-pc="w.turbines"]'); await p.waitForTimeout(150);
    await p.click('.pv-bub[data-pg="perf"]'); await p.waitForTimeout(150);
    ok((await p.$$eval('#pvg-perf .item', e => e.length)) === 4, 'hybrid: power curve category cards');
    await p.click('.pv-badge[data-pc="grid"]'); await p.waitForTimeout(150);
    ok((await p.$$eval('.pv-bub', b => b.length)) === 5, 'hybrid: shared connection should have 5 categories');
    await p.click('.pv-crumbs button[data-act="pvview"]'); await p.waitForTimeout(200);
    await p.click('.pv-badge[data-pc="s"]'); await p.waitForTimeout(250);
    ids = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(ids.length === 7 && ids.includes('s.array'), 'hybrid: solar farm badges ' + ids.join(','));
    await overflow('hybrid');
    await p.screenshot({ path: path.join(OUT, 'pv-hybrid.png') });
  });

  await run('storage-desktop', { width: 1440, height: 900 }, 'light', async (p, overflow) => {
    await loadExample(p, 'bess');
    const ids = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(ids.includes('bess') && ids.includes('buyer'), 'storage: badges ' + ids.join(','));
    await p.click('.pv-badge[data-pc="bess"]'); await p.waitForTimeout(150);
    ok((await p.$$eval('.pv-bub', b => b.length)) === 4, 'storage: battery categories');
    await p.click('.pv-bub[data-pg="cap"]'); await p.waitForTimeout(150);
    ok((await p.$$eval('#pvg-cap .item', e => e.length)) === 2, 'storage: capacity cards');
    await p.click('.pv-badge[data-pc="buyer"]'); await p.waitForTimeout(150);
    await p.click('#pvInsp button[data-act="firmrun"]');
    await p.waitForFunction(() => /chance of meeting every rule/.test(document.querySelector('#pvInsp').textContent) && !document.querySelector('#pvInsp button[data-act="firmrun"]').disabled, null, { timeout: 30000 });
    ok(/chance to meet/.test(await p.textContent('.pv-badge[data-pc="buyer"]')), 'storage: buyer badge did not show the result');
    await p.fill('#pvInsp input[data-path="supply.contractMW"]', '45'); await p.waitForTimeout(250);
    ok(/old run/.test(await p.textContent('.pv-badge[data-pc="buyer"]')), 'storage: stale run not flagged');
    // turning the battery off removes both parts
    await p.click('.pv-chip[data-set="bess.enabled"]'); await p.waitForTimeout(200);
    const ids2 = await p.$$eval('.pv-badge', bs => bs.map(b => b.dataset.pc));
    ok(!ids2.includes('bess') && !ids2.includes('buyer'), 'storage: battery parts still drawn after switching off');
    await overflow('storage');
  });

  await run('tablet', { width: 820, height: 1180 }, 'light', async (p, overflow) => {
    ok(await p.$('.pv-canvas.wide'), 'tablet: expected the drawing');
    await p.click('.pv-badge[data-pc="w.horiz"]'); await p.waitForTimeout(150);
    await p.click('.pv-bub[data-pg="approp"]'); await p.waitForTimeout(250);
    ok(await p.isVisible('#pvg-approp .item'), 'tablet: category cards not visible');
    await overflow('tablet');
    await p.screenshot({ path: path.join(OUT, 'pv-tablet.png') });
  });

  for (const [nm, scheme] of [['phone-light', 'light'], ['phone-dark', 'dark']]) await run(nm, { width: 390, height: 844 }, scheme, async (p, overflow) => {
    ok(await p.$('.pv-canvas.narrow'), nm + ': expected the chain layout');
    ok((await p.$$eval('.pv-node', n => n.length)) === 8, nm + ': chain nodes');
    await overflow('chain');
    await p.click('.pv-node[data-pc="w.turbines"]'); await p.waitForTimeout(200);
    ok((await p.$$eval('.pv-bub.inl', b => b.length)) === 5, nm + ': inline bubbles');
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#pvInsp')).position === 'fixed'), nm + ': inspector is not a bottom sheet');
    await p.click('.pv-bub[data-pg="wakes"]'); await p.waitForTimeout(250);
    ok(await p.isVisible('#pvg-wakes .item'), nm + ': category cards not visible in the sheet');
    await p.fill('input[data-path="items.wake_int.inputs.f"]', '35'); await p.waitForTimeout(200);
    await overflow('sheet');
    await p.screenshot({ path: path.join(OUT, `pv-${nm}.png`) });
    await p.click('#pvInsp button[data-act="pvclose"]'); await p.waitForTimeout(150);
    ok(await p.evaluate(() => getComputedStyle(document.querySelector('#pvInsp')).position !== 'fixed'), nm + ': sheet did not close');
    await p.click('.pv-pick button[data-set="tech"][data-val="hybrid"]'); await p.waitForTimeout(250);
    await p.click('.pv-node[data-pc="w"]'); await p.waitForTimeout(200);
    ok((await p.$$eval('.pv-node', n => n.length)) === 8 && await p.$('.pv-crumbs'), nm + ': hybrid drill-down on the phone');
    await overflow('hybrid chain');
    await loadExample(p, 'bess');
    await p.click('.pv-node[data-pc="buyer"]'); await p.waitForTimeout(150);
    await overflow('buyer sheet');
  });

  await browser.close();
  console.log(errors.length ? `ISSUES (${errors.length} of ${checks} checks):\n` + errors.join('\n') : `plant view: ${checks} checks passed, no errors, no overflow`);
})();
