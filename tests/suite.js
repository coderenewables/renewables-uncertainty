/* Suite checks for WattOdds: a LossStack project opens in WattOdds with the same P50, and an upstream change
   is offered with Apply and followed. Usage:
     node tests/suite.js <home-page checkout> <loss-stack checkout>
   The hub is served from the home-page checkout (answered for coderenewables.com URLs, so every page shares it). */
'use strict';
const path = require('path');
const fs = require('fs');
const http = require('http');
const assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require('playwright');

const home = path.resolve(process.argv[2] || '');
const lsDir = path.resolve(process.argv[3] || '');
const root = path.resolve(__dirname, '..');
if (!fs.existsSync(path.join(home, 'suite/v1/hub.html')) || !fs.existsSync(path.join(lsDir, 'engine.js'))) {
  console.error('usage: node tests/suite.js <home-page checkout> <loss-stack checkout>');
  process.exit(2);
}
const HUB = 'https://coderenewables.com/suite/v1/hub.html';
const sleep = ms => new Promise(r => setTimeout(r, ms));
function waitUp(url) {
  return new Promise((resolve, reject) => {
    const attempt = n => http.get(url, res => { res.resume(); resolve(); }).on('error', () => {
      if (n <= 0) return reject(new Error('server did not start: ' + url));
      setTimeout(() => attempt(n - 1), 100);
    });
    attempt(50);
  });
}
async function until(fn, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch (e) { /* keep waiting */ }
    if (Date.now() - t0 > ms) throw new Error('timed out');
    await sleep(100);
  }
}

// LossStack's own engine makes the project, so the test checks WattOdds against LossStack directly.
const LS = require(path.join(lsDir, 'engine.js'));
const W = require(path.join(lsDir, 'wattodds-items.js'));
function lossProject(gross) {
  const s = LS.defaultState(W, 'wind');
  if (gross) s.wind.grossGWh = gross;
  const r = LS.compute(W, s);
  return {
    state: s,
    summary: { grossGWh: r.gross, net1GWh: r.net1, netNoStore1GWh: r.netNoStore1, netNGWh: r.netN, lossPct1: r.lossPct1, sigma1: r.sigma1, sigmaN: r.sigmaN, years: s.years, capacityMW: r.capacityMW },
    wattoddsProject: LS.toWattOdds(W, s, r),
    appliedFrom: {}
  };
}

(async () => {
  const servers = [spawn('python3', ['-m', 'http.server', '8101', '--directory', home], { stdio: 'ignore' }),
    spawn('python3', ['-m', 'http.server', '8102', '--directory', root], { stdio: 'ignore' })];
  let passed = 0, failed = 0;
  const check = async (name, fn) => {
    try { await fn(); passed++; console.log('ok   ' + name); }
    catch (e) { failed++; console.log('FAIL ' + name + ': ' + e.message); }
  };
  let browser;
  try {
    await waitUp('http://localhost:8101/suite/v1/hub.html');
    await waitUp('http://localhost:8102/dist/wind-energy-uncertainty.html');
    browser = await chromium.launch();
    const ctx = await browser.newContext({ viewport: { width: 1360, height: 900 } });
    // every suite URL is answered from the home-page checkout, so all pages share one hub
    await ctx.route(/^https:\/\/coderenewables\.com\/suite\/v1\//, route => {
      const file = path.join(home, new URL(route.request().url()).pathname);
      route.fulfill({ status: 200, contentType: file.endsWith('.js') ? 'application/javascript' : 'text/html', body: fs.readFileSync(file) });
    });
    await ctx.route(/fonts\.(googleapis|gstatic)\.com/, r => r.fulfill({ status: 200, body: '' }));

    // a LossStack stand-in creates the project and writes the lossstack section
    const ls = await ctx.newPage();
    await ls.goto('http://localhost:8101/tests/fixtures/page.html?tool=lossstack&hub=' + encodeURIComponent(HUB));
    await until(() => ls.evaluate(async () => (await CRSuite.ready).mode === 'shared'));
    const id = await ls.evaluate(async (proj) => {
      const p = await CRSuite.create({ name: 'Suite test wind', tech: 'wind' });
      await CRSuite.write('lossstack', proj);
      return p.id;
    }, lossProject());
    const lsSection = await ls.evaluate(() => CRSuite.current()).then(p => p.sections.lossstack.value);
    await ls.close();

    // WattOdds opens the project
    const wo = await ctx.newPage();
    const errors = [];
    wo.on('pageerror', e => errors.push(e.message));
    wo.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    await wo.goto(`http://localhost:8102/dist/wind-energy-uncertainty.html?project=${id}`);
    await until(() => wo.evaluate(async () => (await CRSuite.ready).mode === 'shared'));
    const wattP50 = await until(async () => {
      const p = await wo.evaluate(() => CRSuite.current());
      return p && p.sections.wattodds ? p : null;
    });

    await check('WattOdds writes its section with the LossStack year-1 P50', async () => {
      const got = wattP50.sections.wattodds.value.summary.p50GWh;
      const want = lsSection.summary.netNoStore1GWh;
      assert.ok(Math.abs(got - want) < 1e-6, `P50 ${got} vs LossStack ${want}`);
    });
    await check('the wake loss item comes across unchanged', async () => {
      const got = wattP50.sections.wattodds.value.project.items.wake_int;
      const want = lsSection.wattoddsProject.items.wake_int;
      for (const k of Object.keys(want)) assert.deepStrictEqual(got[k], want[k], 'wake_int.' + k);
    });
    await check('the project bar shows WattOdds as the current tool, with LossStack and WindNudge before it', async () => {
      const chips = await wo.$$eval('.crs-pipe li', li => li.map(x => x.textContent.trim()));
      assert.ok(chips[0].startsWith('WindNudge') && chips[1].startsWith('LossStack') && chips[2].startsWith('WattOdds'), chips.join(' | '));
      assert.strictEqual(await wo.$eval('.crs-chip[aria-current]', e => e.textContent.trim().startsWith('WattOdds')), true);
    });

    // LossStack changes gross energy: WattOdds offers the change, Apply follows it
    const ls2 = await ctx.newPage();
    await ls2.goto('http://localhost:8101/tests/fixtures/page.html?tool=lossstack&hub=' + encodeURIComponent(HUB));
    await until(() => ls2.evaluate(async () => (await CRSuite.ready).mode === 'shared'));
    await ls2.evaluate(async ({ pid, proj }) => { await CRSuite.open(pid); await CRSuite.write('lossstack', proj); }, { pid: id, proj: lossProject(500) });
    const newP50 = LS.compute(W, (() => { const s = LS.defaultState(W, 'wind'); s.wind.grossGWh = 500; return s; })()).netNoStore1;
    await check('an upstream LossStack change is offered, and Apply moves the P50', async () => {
      await wo.waitForFunction(() => /LossStack has new losses/.test((document.querySelector('.crs-notice') || {}).textContent || ''), null, { timeout: 8000 });
      await wo.click('.crs-notice button.crs-btn.primary');
      const p = await until(async () => {
        const c = await wo.evaluate(() => CRSuite.current());
        return c && Math.abs(c.sections.wattodds.value.summary.p50GWh - newP50) < 1e-6 ? c : null;
      }, 10000);
      assert.ok(p, 'P50 did not follow');
    });
    await ls2.close();

    await check('no page errors', async () => {
      assert.strictEqual(errors.length, 0, errors.join(' | '));
    });
    await wo.close();
    await ctx.close();
  } finally {
    if (browser) await browser.close();
    servers.forEach(s => s.kill());
  }
  console.log(`suite: ${passed} checks passed${failed ? `, ${failed} failed` : ''}`);
  if (failed) process.exitCode = 1;
})().catch(e => { console.error(e); process.exitCode = 1; });
