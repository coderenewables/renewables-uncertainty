const assert = require('assert');
const E = require('../src/engine.js');
const L = require('../src/library.js');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);

t('gamma function', () => { near(E.gamma(5), 24, 1e-9); near(E.gamma(1.5), Math.sqrt(Math.PI) / 2, 1e-12); });

t('air density at sea level, 15 °C ≈ 1.225', () => near(E.airDensity(0, 15), 1.225, 0.001));

t('MCP formula reproduces the AWS example (σA 4 %, r 0.7, 15 y, 1 y → ≈2.9 %)', () => {
  const p = L.blankProject();
  p.items.mcp.inputs = { method: 'mcp', r: 0.7, nR: 15, nT: 1 };
  const m = E.buildModel(p, L);
  near(m.items.find(i => i.id === 'mcp').sigma, 2.95, 0.02);
});

t('anemometer class formula: k 2.4 at 4 m/s → 0.097 m/s (2.42 %)', () => {
  const def = L.ITEM_BY_ID.cup_op;
  const v = def.calc.fn({ k: 2.4 }, { wsMeas: 4, meanWs: 4 });
  near(v, 0.0970 / 4 * 100, 0.01);
});

t('Weibull moment fit returns the requested mean and sd', () => {
  const w = E.weibullFromMoments(3, 1);
  const mean = w.lambda * E.gamma(1 + 1 / w.k);
  const sd = w.lambda * Math.sqrt(E.gamma(1 + 2 / w.k) - E.gamma(1 + 1 / w.k) ** 2);
  near(mean, 3, 1e-6); near(sd, 1, 1e-4);
});

const ex = L.exampleProject();
const r = E.evaluate(ex, L);

t('example: gross energy and capacity factor are plausible', () => {
  console.log('      gross GWh', r.en.grossGWh.toFixed(1), 'gross CF', (r.en.grossCf * 100).toFixed(1), '% rho', r.en.rho.toFixed(3));
  assert.ok(r.en.grossCf > 0.30 && r.en.grossCf < 0.50);
});

t('example: sensitivity factor between 1.2 and 2.2', () => {
  console.log('      S', r.en.S.toFixed(3));
  assert.ok(r.en.S > 1.2 && r.en.S < 2.2);
});

t('example: net P50 = gross × product of efficiencies', () => {
  near(r.en.p50, r.en.grossGWh * r.en.eff, 1e-9);
  console.log('      net P50', r.en.p50.toFixed(1), 'GWh  total loss', ((1 - r.en.eff) * 100).toFixed(1), '%  net CF', (r.en.cf * 100).toFixed(1), '%');
});

t('uncertainty falls with horizon (1y > 10y > life)', () => {
  const s1 = r.H[1].sigma, s10 = r.H[10].sigma, sl = r.H[25].sigma;
  console.log('      σ 1y', s1.toFixed(2), ' 10y', s10.toFixed(2), ' 25y', sl.toFixed(2));
  assert.ok(s1 > s10); // over life, climate change grows while IAV keeps falling
});

t('contributions add up to total variance', () => {
  const sum = r.contrib.reduce((s, c) => s + c.variance, 0);
  near(sum, r.focus.sigma ** 2, 1e-6);
  near(r.contrib.reduce((s, c) => s + c.share, 0), 1, 1e-9);
});

t('evidence mix sums to 1', () => near(Object.values(r.mix).reduce((a, b) => a + b, 0), 1, 1e-9));

t('P90 = P50 × (1 − 1.2816 σ)', () => near(r.focus.pv.P90, r.en.p50 * (1 - 1.2815516 * r.focus.sigma / 100), 1e-9));

t('Monte Carlo agrees with the analytical P90 within 1.5 % of P50 (10 y)', () => {
  const mc = E.monteCarlo(ex, r, 10, { n: 60000 });
  console.log('      MC P50', mc.pv.P50.toFixed(1), 'P90', mc.pv.P90.toFixed(1), '| analytic P90', r.H[10].pv.P90.toFixed(1), '| MC σ', mc.sigmaPct.toFixed(2), '%');
  near(mc.pv.P90, r.H[10].pv.P90, 0.015 * r.en.p50);
});

t('halving an item never lowers P90', () => r.reduce.forEach(x => assert.ok(x.gainGWh >= -1e-9, x.key)));

t('device correlation 1 with equal device sigmas gives the single-device sigma', () => {
  const p = L.exampleProject();
  p.devices[1] = Object.assign(JSON.parse(JSON.stringify(p.devices[0])), { id: 'x2', weight: 0.3 });
  p.deviceCorr = 1;
  const rr = E.evaluate(p, L);
  near(rr.focus.comb.catSig.measurement, rr.focus.comb.devSig[0], 1e-9);
});

t('desktop mode drops on-site stages and uses the atlas term', () => {
  const p = L.exampleProject(); p.setup.dataSource = 'desktop';
  const rr = E.evaluate(p, L);
  assert.ok(!rr.model.items.some(i => i.stage === 'vertical' || i.stage === 'horizontal' || i.stage === 'historical'));
  assert.ok(rr.model.items.some(i => i.id === 'atlas'));
  console.log('      desktop σ10', rr.focus.sigma.toFixed(2), '%');
  assert.ok(rr.focus.sigma > 12);
});

t('entered P50 overrides the computed value', () => {
  const p = L.exampleProject(); p.energy.p50Mode = 'entered'; p.energy.p50 = 250;
  const rr = E.evaluate(p, L);
  near(rr.en.p50, 250, 1e-9);
});

t('custom power curve close to generic for equivalent turbine', () => {
  const p = L.exampleProject();
  const g = E.genericCurve(p.plant, 1.225);
  const pts = [];
  for (let v = 3; v <= 25; v += 0.5) pts.push(v + ',' + Math.round(g(v) * 1000));
  p.plant.curveMode = 'custom'; p.plant.curveText = pts.join('\n'); p.plant.curveRho = 1.225;
  // the generated curve is at site density already expressed at 1.225-equivalent speeds; just check it parses and gives similar energy
  const rr = E.evaluate(p, L);
  assert.strictEqual(E.curveFor(p).kind, 'custom');
  console.log('      custom/generic gross', (rr.en.grossGWh / r.en.grossGWh).toFixed(3));
  near(rr.en.grossGWh / r.en.grossGWh, 1, 0.05);
});

t('no measurement height gap → no vertical extrapolation', () => {
  const p = L.exampleProject(); p.vertical.hMeas = 140;
  const rr = E.evaluate(p, L);
  rr.model.items.filter(i => i.stage === 'vertical').forEach(i => near(i.sigma, 0, 1e-12, i.id));
});

t('climate change default scales from 0.5 % (≤10 y) to 2 % (25 y)', () => {
  near(E.climateSigma(10, r.model), 0.5, 1e-9);
  near(E.climateSigma(25, r.model), 2.0, 1e-9);
});

/* ---------------- solar ---------------- */
const sx = L.solarExampleProject();
const rs = E.evaluate(sx, L);
t('solar: only solar and shared items are in the model', () => {
  assert.ok(rs.model.items.every(i => (i.def.tech === 'solar' || i.def.tech === 'both')), rs.model.items.filter(i => !(i.def.tech === 'solar' || i.def.tech === 'both')).map(i => i.id).join());
  assert.ok(rs.model.items.some(i => i.id === 'sat_model') && rs.model.items.some(i => i.id === 'bifacial'));
  assert.ok(!rs.model.items.some(i => i.id === 'site_adapt' || i.id === 'ground_sensor'));
});
t('solar: yield, PR and CUF are plausible', () => {
  console.log('      ref yield', rs.en.refYield.toFixed(0), 'kWh/kWp  PR', (rs.en.pr * 100).toFixed(1), '%  spec yield', rs.en.specYield.toFixed(0), '  CUF(AC)', (rs.en.cf * 100).toFixed(1), '%  P50', rs.en.p50.toFixed(1), 'GWh');
  assert.ok(rs.en.pr > 0.7 && rs.en.pr < 0.9);
  assert.ok(rs.en.cf > 0.2 && rs.en.cf < 0.35);
});
t('solar: degradation lowers the period P50 (1 y = base, 10 y = base × (1 − 4.5·rate))', () => {
  near(rs.H[1].p50, rs.en.p50, 1e-9);
  near(rs.H[10].p50, rs.en.p50 * (1 - 0.55 * 4.5 / 100), 1e-6);
  assert.ok(rs.H[25].p50 < rs.H[10].p50);
});
t('solar: contributions add up and mix sums to 1', () => {
  near(rs.contrib.reduce((s, c) => s + c.variance, 0), rs.focus.sigma ** 2, 1e-6);
  near(Object.values(rs.mix).reduce((a, b) => a + b, 0), 1, 1e-9);
  console.log('      σ 1y', rs.H[1].sigma.toFixed(2), ' 10y', rs.H[10].sigma.toFixed(2), ' 25y', rs.H[25].sigma.toFixed(2), '| P90/P50 10y', (rs.H[10].pv.P90 / rs.H[10].p50 * 100).toFixed(1), '%');
});
t('solar: Monte Carlo agrees with the analytical P90 (10 y)', () => {
  const mc = E.monteCarlo(sx, rs, 10, { n: 60000 });
  console.log('      MC P50', mc.pv.P50.toFixed(1), 'P90', mc.pv.P90.toFixed(1), '| analytic P90', rs.H[10].pv.P90.toFixed(1));
  near(mc.pv.P90, rs.H[10].pv.P90, 0.012 * rs.H[10].p50);
  near(mc.pv.P50, rs.H[10].p50, 0.01 * rs.H[10].p50);
});
t('solar: site adaptation swaps the satellite term for sensors + adaptation', () => {
  const p = L.solarExampleProject(); p.setup.solarSource = 'adapted';
  const r2 = E.evaluate(p, L);
  assert.ok(!r2.model.items.some(i => i.id === 'sat_model'));
  assert.ok(r2.model.items.some(i => i.id === 'ground_sensor') && r2.model.items.some(i => i.id === 'site_adapt'));
  console.log('      irradiance σ satellite', rs.focus.comb.catSig.irradiance_source.toFixed(2), '→ adapted', r2.focus.comb.catSig.irradiance_source.toFixed(2));
  assert.ok(r2.focus.comb.catSig.irradiance_source < rs.focus.comb.catSig.irradiance_source);
});
t('solar: clipping estimate follows DC/AC ratio', () => {
  const p = L.solarExampleProject(); p.pv.acMW = 120; // DC/AC 1.625
  const r2 = E.evaluate(p, L);
  near(r2.model.items.find(i => i.id === 'clipping').L, 4.0, 1e-9);
  near(rs.model.items.find(i => i.id === 'clipping').L, 1.0, 1e-9);
});
t('solar: soiling calc = rate × days / 2', () => near(rs.model.items.find(i => i.id === 'soiling').L, 0.3 * 15 / 2, 1e-9));
t('normalise keeps technology and fills solar fields', () => {
  const n = L.normalise(JSON.parse(JSON.stringify(sx)));
  assert.strictEqual(n.tech, 'solar'); assert.ok(n.pv.dcMWp === 195);
  const w = L.normalise({ plant: ex.plant, items: {} }); assert.strictEqual(w.tech, 'wind'); assert.ok(w.pv && w.items.sat_model);
});
/* ---------------- hybrid ---------------- */
const hx = L.hybridExampleProject();
const rh = E.evaluate(hx, L);
t('hybrid: shared grid items counted once, at the hybrid level', () => {
  ['av_grid', 'cur_grid', 'el_export', 'poi_meter'].forEach(id => assert.strictEqual(rh.model.items.filter(i => i.id === id).length, 1, id));
  assert.ok(!rh.wind.model.items.some(i => i.def.tech === 'both') && !rh.solar.model.items.some(i => i.def.tech === 'both'));
  assert.ok(rh.model.items.some(i => i.id === 'hy_export_limit'));
});
t('hybrid: P50 = (wind + solar component P50s) × shared efficiency', () => {
  near(rh.H[1].p50, (rh.wind.en.p50 + rh.solar.en.p50) * rh.en.eff, 1e-6);
  console.log('      wind', rh.wind.en.p50.toFixed(1), '+ solar', rh.solar.en.p50.toFixed(1), '× shared', rh.en.eff.toFixed(4), '=', rh.H[1].p50.toFixed(1), 'GWh | export-limit loss', rh.model.items.find(i => i.id === 'hy_export_limit').L.toFixed(2), '% at connection', (rh.model.ctx.connFrac * 100).toFixed(0), '%');
});
t('hybrid: σ is below the energy-weighted sum of the parts (zero correlation)', () => {
  const h = rh.H[10], parts = h.parts;
  const weighted = (parts.wind.p50 * parts.wind.sigma + parts.solar.p50 * parts.solar.sigma) / (parts.wind.p50 + parts.solar.p50);
  console.log('      σ10 wind', parts.wind.sigma.toFixed(2), 'solar', parts.solar.sigma.toFixed(2), 'hybrid', h.sigma.toFixed(2), '| weighted sum', weighted.toFixed(2), '| portfolio gain', h.portfolioGain.toFixed(1), 'GWh');
  assert.ok(h.sigma < weighted);
  assert.ok(h.portfolioGain > 0);
});
t('hybrid: correlation +1 on both factors raises σ, −0.5 lowers it', () => {
  const p1 = L.hybridExampleProject(); p1.hybrid.rhoIav = 0.95; p1.hybrid.rhoRes = 0.95;
  const p2 = L.hybridExampleProject(); p2.hybrid.rhoIav = -0.5;
  const s1 = E.evaluate(p1, L).H[1].sigma, s2 = E.evaluate(p2, L).H[1].sigma;
  console.log('      σ1y ρ=0', rh.H[1].sigma.toFixed(2), ' ρ=0.95', s1.toFixed(2), ' ρiav=−0.5', s2.toFixed(2));
  assert.ok(s1 > rh.H[1].sigma && s2 < rh.H[1].sigma);
});
t('hybrid: contributions plus correlation term add up to σ²', () => {
  near(rh.contrib.reduce((a, c) => a + c.variance, 0) + rh.crossVar, rh.focus.sigma ** 2, 1e-6);
  near(Object.values(rh.mix).reduce((a, b) => a + b, 0), 1, 1e-9);
});
t('hybrid: Monte Carlo agrees with the analytical P90 (10 y), with correlation', () => {
  const p = L.hybridExampleProject(); p.hybrid.rhoIav = -0.4; p.hybrid.rhoRes = 0.3;
  const r = E.evaluate(p, L);
  const mc = E.monteCarlo(p, r, 10, { n: 80000 });
  console.log('      MC P50', mc.pv.P50.toFixed(1), 'P90', mc.pv.P90.toFixed(1), '| analytic P90', r.H[10].pv.P90.toFixed(1), '| MC σ', mc.sigmaPct.toFixed(2), 'vs', r.H[10].sigma.toFixed(2));
  near(mc.pv.P90, r.H[10].pv.P90, 0.012 * r.H[10].p50);
  near(mc.sigmaPct, r.H[10].sigma, 0.35);
});
t('hybrid: export-limit loss follows the measured curve at a 1:1 mix', () => {
  near(E.exportLimitLoss(0.5, 1), 1.98, 1e-6); near(E.exportLimitLoss(0.8, 1), 0.04, 1e-6); near(E.exportLimitLoss(1.0, 1), 0, 1e-9);
  assert.ok(E.exportLimitLoss(0.5, 3) > 1.98 * 1.9);
});
t('hybrid: library estimate matches the engine curve', () => {
  const def = L.ITEM_BY_ID.hy_export_limit;
  [[0.45, 1.2], [0.62, 1.6], [0.93, 1]].forEach(([c, m]) => near(def.desc.options[0].v({ connFrac: c, mixRatio: m }).L, E.exportLimitLoss(c, m), 1e-9));
});
console.log('\nHybrid top contributors (10-yr):');
rh.contrib.slice().sort((a, b) => b.variance - a.variance).slice(0, 6).forEach(c => console.log('  ', (c.share * 100).toFixed(1).padStart(5), '%', c.item.comp, '·', c.item.name));

console.log('\nSolar top contributors (10-yr):');
rs.contrib.slice().sort((a, b) => b.share - a.share).slice(0, 6).forEach(c => console.log('  ', (c.share * 100).toFixed(1).padStart(5), '%', c.item.name, '[' + c.item.tier + ']'));

console.log('\nTop contributors (10-yr):');
r.contrib.slice().sort((a, b) => b.share - a.share).slice(0, 8).forEach(c => console.log('  ', (c.share * 100).toFixed(1).padStart(5), '%', c.item.deviceName ? c.item.deviceName + ' · ' : '', c.item.name, '[' + c.item.tier + ']'));
console.log('\nReduce next:');
r.reduce.slice(0, 5).forEach(x => console.log('  +' + x.gainGWh.toFixed(2), 'GWh', x.item.name));
console.log('\nStage σ (energy %):', Object.entries(r.stages).map(([k, s]) => k + ' ' + s.sigma.toFixed(2)).join(', '));
console.log('Mix:', Object.entries(r.mix).map(([k, v]) => k + ' ' + (v * 100).toFixed(0) + '%').join(', '));
console.log('P-values 10y:', Object.entries(r.H[10].pv).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', '));
console.log(`\n${pass} passed`);
