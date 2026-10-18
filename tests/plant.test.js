const assert = require('assert');
const E = require('../src/engine.js');
const L = require('../src/library.js');
const P = require('../src/plant.js');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);

t('every non-device item in the library has exactly one place', () => {
  L.ITEMS.filter(d => !d.device).forEach(d => assert.ok(P.PLACE[d.id], 'no place for ' + d.id));
  const seen = {};
  Object.values(P.COMPONENTS).forEach(c => c.groups.forEach(([, , ids]) => ids.forEach(id => { assert.ok(!seen[id], 'placed twice: ' + id); seen[id] = 1; })));
});

const cases = [
  ['wind example', () => L.exampleProject()],
  ['solar example', () => L.solarExampleProject()],
  ['hybrid example', () => L.hybridExampleProject()],
  ['storage example', () => L.bessExampleProject()],
  ['blank wind', () => L.blankProject('wind')],
  ['blank solar', () => L.blankProject('solar')],
];
cases.forEach(([name, mk]) => {
  t(`${name}: parts add up to the plant total and every model item is placed`, () => {
    const p = mk();
    [1, 10, 'life'].forEach(h => {
      p.view.horizon = h;
      const r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
      assert.strictEqual(s.unplaced.length, 0, 'unplaced: ' + s.unplaced.map(i => i.id).join(','));
      near(s.sumVar, r.focus.sigma ** 2, 1e-6 * Math.max(1, r.focus.sigma ** 2), 'variance sum at ' + h);
      const placed = Object.values(s.comps).reduce((a, c) => a + c.items.filter(x => x.it.domain !== 'bess').length, 0);
      assert.strictEqual(placed, r.model.items.length);
      Object.values(s.comps).forEach(c => {
        const gs = c.groups.reduce((a, g) => a + g.var, 0);
        near(gs, c.var, 1e-9, c.id + ' groups');
      });
    });
  });
});

t('wind: two masts become two categories in Masts and lidars, ordered as in the project', () => {
  const p = L.exampleProject();
  if (p.devices.length < 2) p.devices.push(L.newDevice('lidar', { name: 'Lidar A', weight: 0.5, height: 120 }));
  const r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  const g = s.comps['w.meas'].groups.filter(x => x.id.startsWith('dev:'));
  assert.deepStrictEqual(g.map(x => x.id), p.devices.map(d => 'dev:' + d.id));
  assert.ok(g.every(x => x.items.length >= 4));
});

t('wind desktop mode: long-term and extrapolation parts are marked as covered by the atlas', () => {
  const p = L.exampleProject(); p.setup.dataSource = 'desktop';
  const r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  ['w.lt', 'w.vert', 'w.horiz'].forEach(id => assert.strictEqual(s.comps[id].status, 'atlas'));
  assert.ok(s.comps['w.meas'].groups.some(g => g.id === 'atlas'));
});

t('wind: each part σ equals the root of its variance, and shares add to 100 %', () => {
  const p = L.exampleProject(); const r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  const sh = Object.values(s.comps).reduce((a, c) => a + c.share, 0);
  near(sh, 1, 1e-9);
  const rss = Math.sqrt(Object.values(s.comps).reduce((a, c) => a + c.sigma ** 2, 0));
  near(rss, r.focus.sigma, 1e-9);
  assert.ok(s.sumOfSigmas > r.focus.sigma, 'a straight sum is larger than the combined total');
});

t('hybrid: farm shares plus shared items plus the correlation term add to 100 %', () => {
  const p = L.hybridExampleProject(); p.hybrid.rhoIav = -0.4;
  const r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  const sh = s.farms.wind.share + s.farms.solar.share + s.comps.grid.share + s.cross.share;
  near(sh, 1, 1e-9);
  assert.ok(s.cross.var < 0, 'negative correlation lowers the total');
  near(s.farms.wind.sigmaOwn, r.focus.comb.cw.sigma, 1e-9);
  // a wind part's σ relative to wind energy is its hybrid σ divided by the wind energy share
  const tb = s.comps['w.turbines'];
  near(tb.sigmaOwn * r.focus.comb.aw, tb.sigma, 1e-9);
});

t('storage: battery categories carry the six battery items, outside the P-value total', () => {
  const p = L.bessExampleProject(); const r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  const b = s.comps.bess;
  assert.strictEqual(b.items.length, 6);
  assert.deepStrictEqual(b.groups.map(g => g.id), ['cap', 'eff', 'out', 'disp']);
  assert.strictEqual(b.var, 0);
  assert.ok(s.comps.buyer);
  assert.deepStrictEqual(P.orderFor(p).slice(-2), ['bess', 'buyer']);
  assert.deepStrictEqual(P.orderFor(p, 'wind').includes('bess'), false);
});

t('solar: losses at the chosen period, degradation grows with the period', () => {
  const p = L.solarExampleProject();
  p.view.horizon = 1; let r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  const d1 = s.comps['s.array'].groups.find(g => g.id === 'degr').loss;
  p.view.horizon = 'life'; r = E.evaluate(p, L); s = P.summarise(p, r, E, L);
  const dl = s.comps['s.array'].groups.find(g => g.id === 'degr').loss;
  near(d1, 0, 1e-9); assert.ok(dl > 3);
});

t('excluding an item drops its part and is counted', () => {
  const p = L.exampleProject(); let r = E.evaluate(p, L), s = P.summarise(p, r, E, L);
  const before = s.comps['w.turbines'].var;
  p.items.wake_int.mode = 'none'; r = E.evaluate(p, L); s = P.summarise(p, r, E, L);
  assert.ok(s.comps['w.turbines'].var < before);
  assert.strictEqual(s.comps['w.turbines'].excluded, 1);
});

console.log(`\n${pass} passed`);
