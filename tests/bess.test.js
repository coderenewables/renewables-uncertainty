const assert = require('assert');
const E = require('../src/engine.js');
const L = require('../src/library.js');
const F = require('../src/bess.js');

let pass = 0;
const t = async (name, fn) => { try { await fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.stack.split('\n').slice(0, 3).join('\n      ')); process.exitCode = 1; } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);
const sum = a => a.reduce((s, x) => s + x, 0);

(async () => {
  await t('generated solar profile hits the target capacity factor and clips at 1', () => {
    const p = F.genSolar({ latitude: 22, mount: 'tracker', season: 'monsoon' }, 0.28);
    near(sum(p) / 8760, 0.28, 0.002);
    assert.ok(Math.max(...p) <= 1 + 1e-6);
    // monsoon dip: July energy below March energy
    const mon = m => { let s = 0; for (let d = 0; d < 365; d++) if (F.MONTH_OF_DAY[d] === m) for (let h = 0; h < 24; h++) s += p[d * 24 + h]; return s; };
    assert.ok(mon(6) < mon(2));
    // zero at night
    assert.ok(p[2] === 0 && p[12] > 0);
  });
  await t('generated wind profile hits the target and peaks in the monsoon months', () => {
    const curve = v => (v < 3 ? 0 : v > 25 ? 0 : Math.min(1, ((v - 3) / 7) ** 3));
    const p = F.genWind({ season: 'monsoon', k: 2 }, curve, 0.35);
    near(sum(p) / 8760, 0.35, 0.003);
    const mon = m => { let s = 0; for (let d = 0; d < 365; d++) if (F.MONTH_OF_DAY[d] === m) for (let h = 0; h < 24; h++) s += p[d * 24 + h]; return s; };
    assert.ok(mon(6) > mon(0));
  });
  await t('uploaded profile parsing: header, two columns, leap year', () => {
    const rows = ['wind,solar']; for (let i = 0; i < 8784; i++) rows.push(`${i % 24},${i % 7}`);
    const r = F.parseProfile(rows.join('\n'));
    assert.strictEqual(r.wind.length, 8760); assert.strictEqual(r.solar[3], 3 % 7);
    assert.ok(F.parseProfile('1\n2\n3').error);
  });
  await t('base64 round trip', () => {
    const a = new Float32Array([0, 1.5, 3.25, 100.125]);
    const b = F.fromB64(F.toB64(a));
    assert.deepStrictEqual(Array.from(b), Array.from(a));
  });
  await t('dispatch conserves energy: charged × RTE = discharged + change in stored energy', () => {
    const w = new Float32Array(8760), s = new Float32Array(8760), D = new Float32Array(8760), pk = new Uint8Array(8760);
    for (let i = 0; i < 8760; i++) { const h = i % 24; s[i] = h >= 7 && h <= 17 ? 80 : 0; D[i] = 30; }
    const r = F.simulateYear({ w: null, s, wCap: 0, sCap: 100, wScale: 1, sScale: 1, X: 100, Pb: 40, E: 160, rte: 0.85, aux: 0, reserve: 0, out: null, dayMap: null, D, peak: pk, peakCount: 0, allowExcess: true });
    // stored energy can change by at most the capacity between start (50 %) and end
    const balance = r.charged * 0.85 - r.discharged;
    assert.ok(Math.abs(balance) <= 160 + 1e-6, 'balance ' + balance);
    assert.ok(r.discharged > 0 && r.cycles > 300 && r.cycles < 370, 'cycles ' + r.cycles);
    near(r.gen, r.served + r.excess + r.curtailed + r.charged - 0 - r.discharged, 1e-3, 'energy flow');
  });
  await t('battery lifts night-time DFR; export limit caps delivery', () => {
    const s = new Float32Array(8760), D = new Float32Array(8760), pk = new Uint8Array(8760);
    for (let i = 0; i < 8760; i++) { const h = i % 24; s[i] = h >= 7 && h <= 17 ? 90 : 0; D[i] = 30; }
    const base = { w: null, s, wCap: 0, sCap: 100, wScale: 1, sScale: 1, X: 60, rte: 0.9, aux: 0, reserve: 0, out: null, dayMap: null, D, peak: pk, peakCount: 0, allowExcess: true };
    const no = F.simulateYear(Object.assign({}, base, { Pb: 0, E: 0 }));
    const yes = F.simulateYear(Object.assign({}, base, { Pb: 30, E: 300 }));
    assert.ok(yes.annual[2].dfr > no.annual[2].dfr + 0.2, `${no.annual[2].dfr} → ${yes.annual[2].dfr}`);
    for (let i = 0; i < 1; i++) assert.ok(no.excess + no.served <= 60 * 8760 + 1e-6);
    near(no.annual[2].dfr, 11 / 24, 1e-9, 'daylight-only supply');
  });
  await t('rule scoring: monthly target with July–September relaxation', () => {
    const mk = vals => ({ monthly: [0, 1, 2].map(() => vals.map(v => ({ dfr: v, demand: 1000, served: v * 1000, hours: 720 }))), annual: [0, 1, 2].map(() => ({ dfr: vals.reduce((a, b) => a + b) / 12, demand: 12000 })) });
    const rules = [{ id: 'off', window: 'off', basis: 'monthly', target: 80, relax: { months: [6, 7, 8], allow: 2, target: 70 } }];
    const ok = F.scoreRules(mk([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.75, 0.72, 0.9, 0.9, 0.9, 0.9]), rules);
    assert.ok(ok.allMet, 'two relaxed months should pass');
    const bad = F.scoreRules(mk([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.75, 0.72, 0.74, 0.9, 0.9, 0.9]), rules);
    assert.ok(!bad.allMet && bad.failed === undefined && bad.failedMonths === 1);
    near(bad.shortfall, (0.80 - 0.74) * 1000, 1e-9);
  });
  await t('SECI penalty formula: shortfall × 1.5 × tariff', () => {
    // FDRE-IV worked example: D = 278.628 MU, DFRa = 0.7945, DFRmin 0.8, P = 4.30 → ≈ Rs 98.84 lakh
    const sfMWh = 278.628 * 1000 * (0.8 - 0.7945);
    near(sfMWh * 1000 * 4.30 * 1.5 / 1e5, 98.84, 0.02);
  });

  /* full project runs */
  const p = L.bessExampleProject();
  const r = E.evaluate(p, L);
  const prep = F.prepare(p, r, E, L);
  await t('prepare: profiles match component P50s and use the connection limit', () => {
    near(sum(prep.w) / 1000, prep.Ew / 1000, 0.5);
    near(sum(prep.s) / 1000, prep.Es / 1000, 0.5);
    assert.strictEqual(prep.X, r.model.ctx.gridMW);
    console.log('      wind', (prep.Ew / 1000).toFixed(1), 'GWh, solar', (prep.Es / 1000).toFixed(1), 'GWh, connection', prep.X, 'MW, battery', prep.Pb, 'MW /', prep.Enom, 'MWh, contract', p.supply.contractMW, 'MW');
  });
  let central;
  await t('central year: DFR and energy flows are sensible', () => {
    central = F.central(prep, 1);
    const c = central.res;
    console.log('      central DFR all', (c.annual[2].dfr * 100).toFixed(1), '% peak', (c.annual[0].dfr * 100).toFixed(1), '% | cycles', c.cycles.toFixed(0), '| curtailed', (c.curtailed / 1000).toFixed(1), 'GWh, excess', (c.excess / 1000).toFixed(1), 'GWh | met', central.score.allMet);
    assert.ok(c.annual[2].dfr > 0.5 && c.annual[2].dfr <= 1);
  });
  let mc;
  await t('Monte Carlo: probabilities in range, P90 delivered below P50', async () => {
    mc = await F.run(prep, { n: 400, year: 1 });
    console.log('      P(meet all)', (mc.pMeet * 100).toFixed(0), '% | failed months', mc.failedMonths.toFixed(2), '| shortfall P50', (mc.shortfall.p50 / 1000).toFixed(2), 'GWh P90', (mc.shortfall.p90 / 1000).toFixed(2), '| penalty P90 ₹', (mc.penalty.p90 / 1e7).toFixed(2), 'crore | delivered P50', (mc.delivered.p50 / 1000).toFixed(1), 'P90', (mc.delivered.p90 / 1000).toFixed(1), 'GWh');
    assert.ok(mc.pMeet >= 0 && mc.pMeet <= 1);
    assert.ok(mc.delivered.p90 <= mc.delivered.p50);
    assert.ok(mc.shortfall.p90 >= mc.shortfall.p50);
  });
  await t('more storage never lowers the probability of meeting the rules (same seed)', async () => {
    const p2 = L.bessExampleProject(); p2.bess.energyMWh = 480; p2.bess.powerMW = 90;
    const prep2 = F.prepare(p2, E.evaluate(p2, L), E, L);
    const mc2 = await F.run(prep2, { n: 400, year: 1 });
    const p0 = L.bessExampleProject(); p0.bess.energyMWh = 0; p0.bess.powerMW = 0;
    const mc0 = await F.run(F.prepare(p0, E.evaluate(p0, L), E, L), { n: 400, year: 1 });
    console.log('      P(meet) no battery', (mc0.pMeet * 100).toFixed(0), '% → 240 MWh', (mc.pMeet * 100).toFixed(0), '% → 480 MWh', (mc2.pMeet * 100).toFixed(0), '%');
    assert.ok(mc2.pMeet >= mc.pMeet - 0.02 && mc.pMeet >= mc0.pMeet - 0.02);
    assert.ok(mc2.shortfall.p50 <= mc.shortfall.p50 + 1 && mc.shortfall.p50 <= mc0.shortfall.p50 + 1);
  });
  await t('year 10 is worse than year 1 without augmentation, and augmentation helps', async () => {
    const y10 = await F.run(prep, { n: 300, year: 10 });
    const pa = L.bessExampleProject(); pa.bess.augment = true; pa.bess.augTarget = 100;
    const y10a = await F.run(F.prepare(pa, E.evaluate(pa, L), E, L), { n: 300, year: 10 });
    console.log('      year-10 P(meet)', (y10.pMeet * 100).toFixed(0), '% | with augmentation', (y10a.pMeet * 100).toFixed(0), '%');
    assert.ok(y10.shortfall.p50 >= mc.shortfall.p50 - 1);
    assert.ok(y10a.shortfall.p50 <= y10.shortfall.p50 + 1);
  });
  await t('drivers: each group held fixed returns a result', async () => {
    const d = await F.drivers(prep, { n: 200, year: 1 });
    assert.strictEqual(d.groups.length, 5);
    d.groups.forEach(g => console.log('      ', g.label.padEnd(48), 'ΔP', (g.dP * 100).toFixed(0).padStart(4), '%  Δshortfall P90', (g.dSf90 / 1000).toFixed(2), 'GWh'));
  });
  await t('single-technology projects: solar + storage and wind + storage run', async () => {
    const ps = L.solarExampleProject(); ps.bess.enabled = true; ps.bess.powerMW = 50; ps.bess.energyMWh = 200; ps.supply.preset = 'peak'; ps.supply.peakHours = [18, 19, 20, 21]; ps.supply.offFrac = 0; ps.supply.contractMW = 45; ps.supply.reserve = 0.9;
    const rs = await F.run(F.prepare(ps, E.evaluate(ps, L), E, L), { n: 200, year: 1 });
    const pw = L.exampleProject(); pw.bess.enabled = true; pw.supply.contractMW = 25;
    const rw = await F.run(F.prepare(pw, E.evaluate(pw, L), E, L), { n: 200, year: 1 });
    console.log('      solar peak-only P(meet)', (rs.pMeet * 100).toFixed(0), '% | wind FDRE-IV P(meet)', (rw.pMeet * 100).toFixed(0), '%');
    assert.ok(rs.pMeet >= 0 && rw.pMeet >= 0);
  });
  await t('performance: 400 sampled years in under 3 s', async () => {
    const t0 = Date.now(); await F.run(prep, { n: 400, year: 1 }); const dt = Date.now() - t0;
    console.log('      ', dt, 'ms');
    assert.ok(dt < 3000);
  });
  console.log(`\n${pass} passed`);
})();
