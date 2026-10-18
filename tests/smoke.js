const { chromium } = require('/opt/npm-tools/node_modules/playwright');
const fs = require('fs'), path = require('path');
const OUT = process.argv[2];
const body = fs.readFileSync(path.join(__dirname, '../dist/wind-energy-uncertainty.html'), 'utf8');
const page = `<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light}body{margin:0;font:14px system-ui}img{max-width:100%}[hidden]{display:none!important}</style></head><body>${body}</body></html>`;
const file = path.join(OUT, 'harness.html'); fs.writeFileSync(file, page);
(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const errors = [];
  async function run(name, vp, scheme, fn) {
    const ctx = await browser.newContext({ viewport: vp, colorScheme: scheme, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    p.on('pageerror', e => errors.push(name + ': ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/fonts|ERR_|net::/.test(m.text())) errors.push(name + ' console: ' + m.text()); });
    await p.goto('file://' + file);
    await p.waitForTimeout(300);
    await p.click('button[data-act="mode"][data-val="steps"]'); await p.waitForTimeout(100);
    if (!(await p.$('.stage-btn'))) errors.push(name + ': step-by-step view did not open');
    await fn(p);
    await ctx.close();
  }
  const stages = ['project','measurement','historical','vertical','horizontal','future','conversion','losses','poi','results'];
  await run('desktop', { width: 1440, height: 900 }, 'light', async p => {
    for (const s of stages) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(80);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) errors.push('desktop overflow on ' + s + ': ' + ow + 'px');
    }
    await p.click('button[data-act="mc"]'); await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, 'd-results.png'), fullPage: true });
    await p.click('.stage-btn[data-stage="measurement"]'); await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(OUT, 'd-measurement.png'), fullPage: false });
    // typing updates live values
    const before = await p.textContent('.side .big');
    await p.fill('input[data-path="devices.0.items.cup_cal.inputs.calExp"]', '3');
    await p.waitForTimeout(150);
    const after = await p.textContent('.side .big');
    if (before === after) errors.push('live update did not change P90');
    // add a lidar, switch a mode, switch to desktop data
    await p.click('button[data-act="adddev"][data-type="lidar"]'); await p.waitForTimeout(80);
    await p.click('button[data-mode="items.dir_meas"][data-val="entered"]'); await p.waitForTimeout(80);
    await p.click('.stage-btn[data-stage="project"]'); await p.waitForTimeout(80);
    await p.click('button[data-set="setup.dataSource"][data-val="desktop"]'); await p.waitForTimeout(80);
    for (const s of stages) { await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(40); }
    await p.click('button[data-act="projects"]'); await p.waitForTimeout(100);
    await p.screenshot({ path: path.join(OUT, 'd-projects.png') });
    await p.click('button[data-act="close"]');
    await p.click('.stage-btn[data-stage="conversion"]'); await p.waitForTimeout(60);
    await p.click('.stage-btn[data-stage="project"]');
    await p.click('button[data-set="plant.curveMode"][data-val="custom"]'); await p.waitForTimeout(60);
    await p.fill('#curveTa', '3,50\n4,200\n5,450\n6,800\n7,1300\n8,1900\n9,2600\n10,3100\n11,3300\n25,3300');
    await p.waitForTimeout(150);
    const kind = await p.evaluate(() => document.querySelector('#curveTa').closest('.panel').textContent.includes('Curve in use'));
  });
  const solarStages = ['project','irradiance','solar_lt','poa','pvconv','losses','poi','results'];
  await run('solar-desktop', { width: 1440, height: 900 }, 'light', async p => {
    await p.click('button[data-set="tech"][data-val="solar"]'); await p.waitForTimeout(100);
    for (const s of solarStages) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(60);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) errors.push('solar desktop overflow on ' + s + ': ' + ow + 'px');
    }
    // load the solar example through the projects panel
    await p.click('button[data-act="projects"]'); await p.waitForTimeout(80);
    await p.click('button[data-act="example"][data-tech="solar"]'); await p.waitForTimeout(60);
    await p.click('button[data-act="replaceyes"]'); await p.waitForTimeout(100);
    await p.click('button[data-act="close"]');
    const name = await p.textContent('#projName');
    if (!/solar/i.test(name)) errors.push('solar example did not load: ' + name);
    await p.click('.stage-btn[data-stage="pvconv"]'); await p.waitForTimeout(80);
    await p.screenshot({ path: path.join(OUT, 's-pvconv.png'), fullPage: false });
    const before = await p.textContent('.side .big');
    await p.click('button[data-mode="items.temperature"][data-val="entered"]'); await p.waitForTimeout(60);
    await p.fill('input[data-path="items.temperature.entered.s"]', '4'); await p.waitForTimeout(150);
    const after = await p.textContent('.side .big');
    if (before === after) errors.push('solar live update did not change P90');
    await p.click('.stage-btn[data-stage="project"]'); await p.waitForTimeout(60);
    await p.click('button[data-set="setup.solarSource"][data-val="adapted"]'); await p.waitForTimeout(60);
    await p.click('.stage-btn[data-stage="irradiance"]'); await p.waitForTimeout(60);
    const hasAdapt = await p.$('#it-site_adapt');
    if (!hasAdapt) errors.push('site adaptation card missing');
    await p.click('.stage-btn[data-stage="results"]'); await p.waitForTimeout(60);
    await p.click('button[data-act="mc"]'); await p.waitForTimeout(1500);
    await p.screenshot({ path: path.join(OUT, 's-results.png'), fullPage: true });
    for (const s of solarStages) { await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(40); }
  });
  await run('solar-phone', { width: 390, height: 844 }, 'dark', async p => {
    await p.click('button[data-set="tech"][data-val="solar"]'); await p.waitForTimeout(100);
    for (const s of solarStages) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(60);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) {
        const who = await p.evaluate(() => { const W = window.innerWidth; let worst = null; document.querySelectorAll('#sheet *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > W + 1 && !el.closest('.tblwrap') && (!worst || r.right > worst.r)) worst = { r: r.right, d: el.tagName + '.' + el.className + ' ' + (el.textContent || '').slice(0, 40) }; }); return worst; });
        errors.push('solar phone overflow on ' + s + ': ' + ow + 'px ' + JSON.stringify(who));
      }
    }
    await p.click('.stage-btn[data-stage="project"]'); await p.waitForTimeout(60);
    await p.screenshot({ path: path.join(OUT, 's-p-project.png') });
  });
  const hybStages = ['project','measurement','historical','vertical','horizontal','future','conversion','losses','irradiance','solar_lt','poa','pvconv','pvlosses','hybrid','poi','results'];
  await run('hybrid-desktop', { width: 1440, height: 900 }, 'light', async p => {
    await p.click('button[data-set="tech"][data-val="hybrid"]'); await p.waitForTimeout(150);
    const name = await p.textContent('#projName');
    if (!/hybrid/i.test(name)) errors.push('hybrid example did not load: ' + name);
    for (const s of hybStages) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(60);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) errors.push('hybrid desktop overflow on ' + s + ': ' + ow + 'px');
      const cards = await p.$$eval('#sheet .item', els => els.length);
      if (['losses','pvlosses','hybrid','pvconv','irradiance'].includes(s) && cards === 0) errors.push('no item cards on hybrid stage ' + s);
    }
    // shared items must not appear in component loss stages
    await p.click('.stage-btn[data-stage="losses"]'); await p.waitForTimeout(60);
    if (await p.$('#it-av_grid')) errors.push('grid availability shown under wind losses in hybrid');
    await p.click('.stage-btn[data-stage="pvlosses"]'); await p.waitForTimeout(60);
    if (await p.$('#it-cur_grid')) errors.push('grid curtailment shown under solar losses in hybrid');
    await p.click('.stage-btn[data-stage="hybrid"]'); await p.waitForTimeout(60);
    if (!(await p.$('#it-hy_export_limit')) || !(await p.$('#it-av_grid'))) errors.push('shared items missing from Shared connection');
    const before = await p.textContent('.side .big');
    await p.fill('input[data-path="hybrid.rhoIav"]', '0.8'); await p.waitForTimeout(150);
    const after = await p.textContent('.side .big');
    if (before === after) errors.push('hybrid correlation did not change P90');
    await p.screenshot({ path: path.join(OUT, 'h-hybrid.png'), fullPage: false });
    await p.click('.stage-btn[data-stage="pvconv"]'); await p.waitForTimeout(60);
    await p.click('button[data-mode="items.temperature"][data-val="entered"]'); await p.waitForTimeout(60);
    await p.fill('input[data-path="items.temperature.entered.s"]', '3'); await p.waitForTimeout(120);
    const after2 = await p.textContent('.side .big');
    if (after2 === after) errors.push('hybrid solar item did not change P90');
    await p.click('.stage-btn[data-stage="results"]'); await p.waitForTimeout(80);
    await p.click('button[data-act="mc"]'); await p.waitForTimeout(2500);
    await p.screenshot({ path: path.join(OUT, 'h-results.png'), fullPage: true });
    await p.click('.stage-btn[data-stage="project"]'); await p.waitForTimeout(60);
    await p.fill('input[data-path="hybrid.gridMW"]', '120'); await p.waitForTimeout(120);
    await p.click('.stage-btn[data-stage="measurement"]'); await p.waitForTimeout(60);
    await p.click('button[data-act="adddev"][data-type="lidar"]'); await p.waitForTimeout(80);
  });
  await run('hybrid-phone', { width: 390, height: 844 }, 'dark', async p => {
    await p.click('button[data-set="tech"][data-val="hybrid"]'); await p.waitForTimeout(150);
    for (const s of hybStages) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(50);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) {
        const who = await p.evaluate(() => { const W = window.innerWidth; let worst = null; document.querySelectorAll('#sheet *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > W + 1 && !el.closest('.tblwrap') && (!worst || r.right > worst.r)) worst = { r: r.right, d: el.tagName + '.' + el.className + ' ' + (el.textContent || '').slice(0, 40) }; }); return worst; });
        errors.push('hybrid phone overflow on ' + s + ': ' + ow + 'px ' + JSON.stringify(who));
      }
    }
    await p.click('.stage-btn[data-stage="hybrid"]'); await p.waitForTimeout(60);
    await p.screenshot({ path: path.join(OUT, 'h-p-hybrid.png') });
  });
  const csvPath = path.join(OUT, 'profile.csv');
  { const rows = ['wind_MW,solar_MW']; for (let i = 0; i < 8760; i++) { const h = i % 24; rows.push(`${(40 + 30 * Math.sin(i / 50)).toFixed(2)},${h >= 7 && h <= 17 ? (120 * Math.sin(Math.PI * (h - 6.5) / 11)).toFixed(2) : 0}`); } fs.writeFileSync(csvPath, rows.join('\n')); }
  await run('bess-desktop', { width: 1440, height: 900 }, 'light', async p => {
    await p.click('button[data-act="projects"]'); await p.waitForTimeout(80);
    await p.click('button[data-act="example"][data-tech="bess"]'); await p.waitForTimeout(60);
    await p.click('button[data-act="replaceyes"]'); await p.waitForTimeout(150);
    await p.click('button[data-act="close"]');
    if (!(await p.$('.stage-btn[data-stage="supply"]'))) errors.push('storage stages missing from the rail');
    await p.click('.stage-btn[data-stage="bess"]'); await p.waitForTimeout(80);
    const cards = await p.$$eval('#sheet .item', els => els.length);
    if (cards !== 6) errors.push('expected 6 battery items, got ' + cards);
    await p.click('.stage-btn[data-stage="supply"]'); await p.waitForTimeout(80);
    await p.click('button[data-act="firmrun"]');
    await p.waitForFunction(() => !document.querySelector('button[data-act="firmrun"]').disabled && document.querySelector('.tile.key'), null, { timeout: 30000 });
    const pm = await p.textContent('.tile.key .val');
    if (!/\d/.test(pm)) errors.push('no probability shown: ' + pm);
    await p.click('button[data-act="firmdrivers"]');
    await p.waitForFunction(() => /What drives the risk/.test(document.querySelector('#sheet').textContent) && !document.querySelector('button[data-act="firmrun"]').disabled, null, { timeout: 60000 });
    await p.screenshot({ path: path.join(OUT, 'b-supply.png'), fullPage: true });
    const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (ow > 0) errors.push('bess desktop overflow on supply: ' + ow + 'px');
    // change preset and toggle a peak hour, then upload a profile and rerun
    await p.click('button[data-set="supply.preset"][data-val="seci26"]'); await p.waitForTimeout(80);
    if (!/Inputs changed/.test(await p.textContent('#sheet'))) errors.push('stale warning missing after preset change');
    await p.click('button[data-act="peakhr"][data-h="19"]'); await p.waitForTimeout(60);
    await p.setInputFiles('#profFile', csvPath); await p.waitForTimeout(300);
    if (!/Uploaded: /.test(await p.textContent('#sheet'))) errors.push('profile upload not shown');
    await p.click('button[data-act="firmrun"]');
    await p.waitForFunction(() => !document.querySelector('button[data-act="firmrun"]').disabled && !/Inputs changed/.test(document.querySelector('#sheet').textContent), null, { timeout: 30000 });
    await p.click('.stage-btn[data-stage="results"]'); await p.waitForTimeout(80);
    if (!/Firm supply/.test(await p.textContent('#sheet'))) errors.push('firm summary missing on results');
    // switching storage off removes the stages
    await p.click('.stage-btn[data-stage="project"]'); await p.waitForTimeout(60);
    await p.click('button[data-set="bess.enabled"][data-val="false"]'); await p.waitForTimeout(80);
    if (await p.$('.stage-btn[data-stage="supply"]')) errors.push('storage stages still shown after switching off');
  });
  await run('bess-phone', { width: 390, height: 844 }, 'dark', async p => {
    await p.click('button[data-act="projects"]'); await p.waitForTimeout(80);
    await p.click('button[data-act="example"][data-tech="bess"]'); await p.waitForTimeout(60);
    await p.click('button[data-act="replaceyes"]'); await p.waitForTimeout(150);
    await p.click('button[data-act="close"]');
    for (const s of ['bess', 'supply']) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(60);
      if (s === 'supply') { await p.click('button[data-act="firmrun"]'); await p.waitForFunction(() => document.querySelector('.tile.key'), null, { timeout: 30000 }); await p.waitForTimeout(100); }
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) {
        const who = await p.evaluate(() => { const W = window.innerWidth; let worst = null; document.querySelectorAll('#sheet *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > W + 1 && !el.closest('.tblwrap') && !el.closest('[style*="overflow-x"]') && (!worst || r.right > worst.r)) worst = { r: r.right, d: el.tagName + '.' + el.className + ' ' + (el.textContent || '').slice(0, 40) }; }); return worst; });
        errors.push('bess phone overflow on ' + s + ': ' + ow + 'px ' + JSON.stringify(who));
      }
    }
    await p.screenshot({ path: path.join(OUT, 'b-p-supply.png'), fullPage: false });
  });
  await run('phone', { width: 390, height: 844 }, 'light', async p => {
    for (const s of stages) {
      await p.click(`.stage-btn[data-stage="${s}"]`); await p.waitForTimeout(60);
      const ow = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (ow > 0) {
        const who = await p.evaluate(() => { const W = window.innerWidth; let worst = null; document.querySelectorAll('#sheet *').forEach(el => { const r = el.getBoundingClientRect(); if (r.right > W + 1 && !el.closest('.tblwrap') && (!worst || r.right > worst.r)) worst = { r: r.right, d: el.tagName + '.' + el.className + ' ' + (el.textContent || '').slice(0, 40) }; }); return worst; });
        errors.push('phone overflow on ' + s + ': ' + ow + 'px ' + JSON.stringify(who));
      }
    }
    await p.click('.stage-btn[data-stage="measurement"]'); await p.waitForTimeout(80);
    await p.screenshot({ path: path.join(OUT, 'p-measurement.png') });
    await p.click('.stage-btn[data-stage="results"]'); await p.waitForTimeout(80);
    await p.screenshot({ path: path.join(OUT, 'p-results.png') });
  });
  await run('dark', { width: 1280, height: 860 }, 'dark', async p => {
    await p.click('.stage-btn[data-stage="conversion"]'); await p.waitForTimeout(80);
    await p.screenshot({ path: path.join(OUT, 'k-conversion.png') });
  });
  await browser.close();
  console.log(errors.length ? 'ISSUES:\n' + errors.join('\n') : 'no errors, no overflow');
})();
