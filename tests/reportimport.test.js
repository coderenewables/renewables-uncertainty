const assert = require('assert');
const E = require('../src/engine.js');
const L = require('../src/library.js');
const R = require('../src/reportimport.js');
const WIND = require('./fixtures/report-import-wind.json');
const SOLAR = require('./fixtures/report-import-solar.json');

let pass = 0;
const t = (name, fn) => { try { fn(); pass++; console.log('ok  ', name); } catch (e) { console.log('FAIL', name, '\n     ', e.message); process.exitCode = 1; } };
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);
const AT = '2026-11-14T00:00:00.000Z';
const copy = o => JSON.parse(JSON.stringify(o));
const codes = list => list.map(x => x.code);
/* one entry with sensible defaults; o overrides */
const entry = o => Object.assign({ id: 'mcp', device: null, covers: [], label: 'Line', quantity: 'uncertainty', value: 2, unit: '%', percent_of: 'wind_speed', level: 'standard', stated_as: null, period_years: null, evidence: { page: 3, quote: 'Line 2%' }, confidence: 'high', notes: null }, o);
const payload = (items, extra) => Object.assign({ schema: R.SCHEMA, report: { title: 'T', author: 'A', date: '2026-01-01', technology: null }, project: {}, items, unmapped: [] }, extra);
const check = (items, project, extra) => R.validateImport(payload(items, extra), project || L.exampleProject(), L, E);
const row1 = (o, project) => { const v = check([entry(o)], project); assert.ok(v.ok, 'import refused: ' + codes(v.errors)); return v.rows[0]; };
const allCodes = r => codes(r.errors).concat(codes(r.warnings), codes(r.res.errors), codes(r.res.warnings));

/* ---------- extraction ---------- */
t('extractJson: plain object', () => assert.deepStrictEqual(R.extractJson('{"schema":"x","a":1}').value, { schema: 'x', a: 1 }));
t('extractJson: markdown code fence', () => assert.strictEqual(R.extractJson('```json\n{"schema":"x"}\n```').value.schema, 'x'));
t('extractJson: prose before and after', () => assert.strictEqual(R.extractJson('Here is the result:\n{"schema":"x","n":{"b":2}}\nLet me know if you need more.').value.n.b, 2));
t('extractJson: braces and escaped quotes inside strings', () => assert.strictEqual(R.extractJson('{"schema":"x","q":"a } b \\" { c"}').value.q, 'a } b " { c'));
t('extractJson: a stray {…} in the prose does not win', () => assert.strictEqual(R.extractJson('Use {curly} braces. {"schema":"x"}').value.schema, 'x'));
t('extractJson: cut-off JSON', () => assert.strictEqual(R.extractJson('{"schema":"x","items":[{"id":"mcp"}').code, 'E_BAD_JSON'));
t('extractJson: no JSON, empty, not a string, too large', () => {
  assert.strictEqual(R.extractJson('no json here').code, 'E_NO_JSON');
  assert.strictEqual(R.extractJson('   ').code, 'E_EMPTY');
  assert.strictEqual(R.extractJson(null).code, 'E_EMPTY');
  assert.strictEqual(R.extractJson('{"schema":"x","pad":"' + 'a'.repeat(R.LIMITS.chars) + '"}').code, 'E_TOO_LARGE');
});

/* ---------- blocking errors: never throws, always a structured result ---------- */
t('validateImport never throws on bad input', () => {
  [undefined, null, 42, '', 'x', '[]', '{', '{"schema":1}', [], {}, { schema: R.SCHEMA, items: 'no' }, { schema: R.SCHEMA, items: [null, 3, 'a', []] }].forEach(x => {
    const v = R.validateImport(x, L.exampleProject(), L, E);
    assert.strictEqual(typeof v.ok, 'boolean'); assert.ok(Array.isArray(v.errors) && Array.isArray(v.rows) && Array.isArray(v.basics));
    if (!v.ok) assert.ok(v.errors.length >= 1 && typeof v.errors[0].message === 'string');
  });
  assert.strictEqual(R.validateImport('{}', null, L, E).ok, false);
});
t('blocking errors carry the right code and message', () => {
  const ex = L.exampleProject();
  const code = x => R.validateImport(x, ex, L, E).errors[0].code;
  assert.strictEqual(code(''), 'E_EMPTY');
  assert.strictEqual(code('hello'), 'E_NO_JSON');
  assert.strictEqual(code('{"schema":'), 'E_BAD_JSON');
  assert.strictEqual(code('{"a":1}'), 'E_SCHEMA_MISSING');
  assert.strictEqual(code(JSON.stringify(ex)), 'E_PROJECT_FILE');
  assert.strictEqual(code({ schema: R.SCHEMA, items: {} }), 'E_LISTS');
  assert.strictEqual(code({ schema: R.SCHEMA, items: [], unmapped: [], project: {} }), 'E_NOTHING');
  assert.strictEqual(code(payload(Array.from({ length: 201 }, () => entry({})))), 'E_TOO_MANY');
  const v = R.validateImport({ schema: 'wattodds.report-import/2', items: [] }, ex, L, E);
  assert.strictEqual(v.errors[0].code, 'E_SCHEMA_VERSION');
  assert.strictEqual(v.errors[0].message, 'This import uses schema “wattodds.report-import/2”. This version of WattOdds reads “wattodds.report-import/1”. Copy the prompt again and rerun it.');
});
t('technology: mismatch is refused, a part report goes into a hybrid, null warns', () => {
  const solarInWind = check([entry({})], L.exampleProject(), { report: { technology: 'solar' } });
  assert.strictEqual(solarInWind.ok, false);
  assert.strictEqual(solarInWind.errors[0].message, 'This import is for a solar project, but the open project is wind. Open or start a solar project, then import again.');
  assert.strictEqual(check([entry({})], L.exampleProject(), { report: { technology: 'hybrid' } }).errors[0].code, 'E_TECH');
  const part = check([entry({})], L.hybridExampleProject(), { report: { technology: 'wind' } });
  assert.ok(part.ok); assert.deepStrictEqual(codes(part.warnings), ['G_TECH_PART']);
  assert.deepStrictEqual(codes(check([entry({})]).warnings), ['G_TECH_NULL']);
  assert.deepStrictEqual(check([entry({})], L.exampleProject(), { report: { technology: 'wind' } }).warnings, []);
});

/* ---------- ids ---------- */
t('valid ids per technology come from the library', () => {
  assert.strictEqual(R.validIds('wind', L).length, 49);
  assert.strictEqual(R.validIds('solar', L).length, 30);
  assert.strictEqual(R.validIds('hybrid', L).length, 75);
  assert.ok(!R.validIds('hybrid', L).some(id => id.startsWith('bess_')));
  assert.ok(R.validIds('wind', L).includes('poi_meter') && R.validIds('solar', L).includes('poi_meter'));
  assert.ok(!R.validIds('wind', L).includes('soiling') && !R.validIds('solar', L).includes('wake_int') && !R.validIds('wind', L).includes('hy_export_limit'));
});
t('unknown id, wrong technology, battery id, missing id', () => {
  assert.deepStrictEqual(codes(row1({ id: 'not_an_item' }).res.errors), ['R_ID_UNKNOWN']);
  assert.deepStrictEqual(codes(row1({ id: 'soiling', quantity: 'loss', stated_as: 'loss' }).res.errors), ['R_ID_TECH']);
  assert.deepStrictEqual(codes(row1({ id: 'bess_rte' }).res.errors), ['R_ID_BESS']);
  assert.deepStrictEqual(codes(row1({ id: null }).res.errors), ['R_UNMAPPED']);
  assert.strictEqual(row1({ id: 'not_an_item' }).accept, false);
});
t('prototype-pollution input changes nothing and maps to nothing', () => {
  const text = '{"schema":"wattodds.report-import/1","__proto__":{"polluted":true},"constructor":{"prototype":{"polluted":true}},"report":{"__proto__":{"polluted":true},"title":"T"},"project":{"__proto__":{"value":1},"constructor":{"value":2}},"items":[' +
    ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'prototype'].map(id => JSON.stringify(entry({ id, covers: ['__proto__', 'constructor'] }))).join(',') + ',' + JSON.stringify(entry({ id: 'mcp', covers: ['__proto__', 'constructor', 'toString'] })) + ']}';
  const p = L.exampleProject(), v = R.validateImport(text, p, L, E);
  assert.ok(v.ok);
  v.rows.slice(0, 5).forEach(r => assert.deepStrictEqual(codes(r.res.errors), ['R_ID_UNKNOWN']));
  assert.strictEqual(v.rows[5].res.covers.length, 0);
  assert.strictEqual(v.basics.length, 0);
  const plan = R.planApply(v, null, p, L, E, { at: AT }), out = R.applyImport(p, plan);
  assert.ok(out.ok);
  assert.strictEqual(({}).polluted, undefined); assert.strictEqual(Object.prototype.polluted, undefined); assert.strictEqual([].polluted, undefined);
  assert.deepStrictEqual(plan.changes.map(c => c.path), ['items.mcp', 'importLog']);
  assert.strictEqual(Object.getPrototypeOf(out.project.items), Object.prototype);
});

/* ---------- units and conversions ---------- */
t('uncertainty level: standard as is, k2 halved, p90 divided by 1.2816, unknown needs a look', () => {
  assert.strictEqual(row1({ value: 2.5 }).res.value, 2.5);
  const k2 = row1({ value: 5, level: 'k2' }); assert.strictEqual(k2.res.value, 2.5); assert.ok(allCodes(k2).includes('W_LEVEL_K2')); assert.strictEqual(k2.accept, true);
  near(row1({ value: 3.2, level: 'p90' }).res.value, 3.2 / 1.2815516, 1e-4);
  const u = row1({ level: 'unknown' }); assert.strictEqual(u.res.value, 2); assert.ok(allCodes(u).includes('W_LEVEL_UNKNOWN')); assert.strictEqual(u.accept, false);
});
t('what the percentage is a share of: allowed and refused conversions', () => {
  const ex = L.exampleProject(), S = E.evaluate(ex, L).en.S;
  const en = row1({ value: 4, percent_of: 'energy' }); near(en.res.value, 4 / S, 1e-3); assert.ok(allCodes(en).includes('W_FROM_ENERGY'));
  assert.deepStrictEqual(codes(row1({ percent_of: 'irradiance' }).res.errors), ['R_OF']);
  assert.deepStrictEqual(codes(row1({ percent_of: 'loss_points' }).res.errors), ['R_OF']);
  assert.deepStrictEqual(codes(row1({ id: 'pc_unc', percent_of: 'wind_speed' }).res.errors), ['R_OF']);
  assert.strictEqual(row1({ id: 'pc_unc', percent_of: 'wind_speed' }).res.errors[0].message, '“Power curve” is a share of energy; the report figure is a share of wind speed. Not converted.');
  assert.strictEqual(row1({ id: 'pc_unc', percent_of: 'energy', value: 2.5 }).res.value, 2.5);
  const unk = row1({ percent_of: 'unknown' }); assert.ok(allCodes(unk).includes('W_OF_UNKNOWN')); assert.strictEqual(unk.accept, false);
  const sol = L.solarExampleProject();
  assert.strictEqual(row1({ id: 'sat_model', percent_of: 'irradiance', value: 3.5 }, sol).res.value, 3.5);
  assert.strictEqual(row1({ id: 'sat_model', percent_of: 'energy', value: 3.5 }, sol).res.value, 3.5);   // solar sensitivity is 1.0
  assert.deepStrictEqual(codes(row1({ id: 'sat_model', percent_of: 'wind_speed' }, sol).res.errors), ['R_OF']);
});
t('units: fraction is read as a percentage; other units and non-numbers are refused', () => {
  const f = row1({ value: 0.025, unit: 'fraction' }); assert.strictEqual(f.res.value, 2.5); assert.ok(allCodes(f).includes('W_FRACTION'));
  assert.deepStrictEqual(codes(row1({ unit: 'm/s' }).res.errors), ['R_UNIT']);
  assert.strictEqual(row1({ unit: 'm/s' }).res.errors[0].message, 'Unit “m/s” is not supported. Supported units: %, fraction, %/yr.');
  assert.deepStrictEqual(codes(row1({ value: '2.5' }).res.errors), ['R_VALUE']);
  assert.deepStrictEqual(codes(row1({ value: null }).res.errors), ['R_VALUE']);
  assert.deepStrictEqual(codes(row1({ quantity: 'bias' }).res.errors), ['R_QUANTITY']);
  assert.deepStrictEqual(codes(row1({ unit: '%/yr' }).res.errors), ['R_RATE_ONLY']);
});
t('losses: loss, efficiency, negative number, gain, loss into an uncertainty item', () => {
  const loss = o => row1(Object.assign({ id: 'wake_int', quantity: 'loss', stated_as: 'loss', percent_of: null, level: null }, o));
  assert.strictEqual(loss({ value: 9.8 }).res.value, 9.8); assert.strictEqual(loss({ value: 9.8 }).res.field, 'L');
  const eff = loss({ value: 90.2, stated_as: 'efficiency' }); assert.strictEqual(eff.res.value, 9.8); assert.ok(allCodes(eff).includes('W_EFFICIENCY'));
  assert.strictEqual(loss({ value: 0.902, unit: 'fraction', stated_as: 'efficiency' }).res.value, 9.8);
  const neg = loss({ value: -9.8 }); assert.strictEqual(neg.res.value, 9.8); assert.ok(allCodes(neg).includes('W_NEGATIVE'));
  const unk = loss({ value: 9.8, stated_as: 'unknown' }); assert.ok(allCodes(unk).includes('W_STATED_UNKNOWN')); assert.strictEqual(unk.accept, false);
  assert.deepStrictEqual(codes(loss({ id: 'mcp' }).res.errors), ['R_LOSS_ON_UNC']);
  assert.deepStrictEqual(codes(loss({ unit: '%/yr' }).res.errors), ['R_RATE_ONLY']);
  const sol = L.solarExampleProject(), bif = o => row1(Object.assign({ id: 'bifacial', quantity: 'loss', percent_of: null, level: null }, o), sol);
  assert.strictEqual(bif({ value: 5.8, stated_as: 'gain' }).res.value, -5.8);
  assert.strictEqual(bif({ value: -5.8, stated_as: 'loss' }).res.value, -5.8);
  assert.deepStrictEqual(codes(bif({ value: 5.8, stated_as: 'loss' }).res.errors), ['R_RANGE']);
});
t('uncertainty of a loss: points, share of the loss, share of energy', () => {
  const s = o => entry(Object.assign({ id: 'wake_int', quantity: 'uncertainty', percent_of: 'loss_points' }, o));
  const L10 = entry({ id: 'wake_int', quantity: 'loss', stated_as: 'loss', value: 10 });
  assert.strictEqual(row1(s({ value: 1.6 })).res.field, 's'); assert.strictEqual(row1(s({ value: 1.6 })).res.value, 1.6);
  let v = check([L10, s({ value: 20, percent_of: 'relative_to_loss' })]);
  assert.strictEqual(v.rows[1].res.value, 2); assert.ok(allCodes(v.rows[1]).includes('W_REL_LOSS'));
  v = check([L10, s({ value: 2, percent_of: 'energy' })]);
  assert.strictEqual(v.rows[1].res.value, 1.8); assert.ok(allCodes(v.rows[1]).includes('W_ENERGY_POINTS'));
  // without a loss row in the import, the loss in use in the project is the reference (wind example: 9.2 %)
  assert.strictEqual(row1(s({ value: 20, percent_of: 'relative_to_loss' })).res.value, 1.84);
  assert.deepStrictEqual(codes(row1(s({ percent_of: 'wind_speed' })).res.errors), ['R_OF']);
});
t('module degradation takes a yearly rate only', () => {
  const sol = L.solarExampleProject(), d = o => row1(Object.assign({ id: 'degradation', quantity: 'loss', stated_as: 'loss', unit: '%/yr', value: 0.45, percent_of: null, level: null }, o), sol);
  assert.strictEqual(d({}).res.value, 0.45);
  assert.deepStrictEqual(codes(d({ unit: '%', value: 11 }).res.errors), ['R_RATE_NEEDED']);
  assert.deepStrictEqual(codes(d({ value: 4 }).res.errors), ['R_RANGE']);
  assert.strictEqual(d({ quantity: 'uncertainty', value: 0.2, level: 'standard' }).res.value, 0.2);
  assert.deepStrictEqual(codes(d({ quantity: 'uncertainty', unit: '%', value: 0.2, level: 'standard', percent_of: 'loss_points' }).res.errors), ['R_RATE_UNC']);
});
t('year-to-year variability stated for N years is scaled to one year and flagged', () => {
  const r = row1({ id: 'ws_iav', value: 1.3, period_years: 10 });
  near(r.res.value, 1.3 * Math.sqrt(10), 1e-3); assert.ok(allCodes(r).includes('W_PERIOD')); assert.strictEqual(r.accept, false);
  assert.strictEqual(row1({ id: 'ws_iav', value: 4.2, period_years: 1 }).res.value, 4.2);
  assert.strictEqual(row1({ id: 'mcp', value: 2, period_years: 10 }).res.value, 2);   // ignored for other items
});
t('ranges: outside is an error, large needs a look, zero is noted', () => {
  assert.deepStrictEqual(codes(row1({ value: 31 }).res.errors), ['R_RANGE']);
  assert.strictEqual(row1({ value: 31 }).res.errors[0].message, '31 % is outside the range the app accepts for this value (0 to 30 %).');
  assert.deepStrictEqual(codes(row1({ value: -1 }).res.errors), ['R_RANGE']);
  const big = row1({ value: 16 }); assert.ok(allCodes(big).includes('W_LARGE')); assert.strictEqual(big.accept, false);
  assert.ok(allCodes(row1({ value: 0 })).includes('W_ZERO'));
  assert.deepStrictEqual(codes(row1({ id: 'wake_int', quantity: 'loss', stated_as: 'loss', value: 61 }).res.errors), ['R_RANGE']);
  assert.deepStrictEqual(codes(row1({ id: 'wake_int', quantity: 'uncertainty', percent_of: 'loss_points', value: 31 }).res.errors), ['R_RANGE']);
});
t('evidence and confidence decide the default tick', () => {
  assert.strictEqual(row1({}).accept, true);
  assert.strictEqual(row1({ confidence: 'medium' }).accept, true);
  const low = row1({ confidence: 'low' }); assert.strictEqual(low.accept, false); assert.ok(allCodes(low).includes('W_CONF_LOW'));
  assert.ok(allCodes(row1({ confidence: 'certain' })).includes('W_CONF_MISSING'));
  const none = row1({ evidence: { page: null, quote: '' } }); assert.strictEqual(none.accept, false); assert.ok(allCodes(none).includes('W_NO_EVIDENCE'));
  const nopage = row1({ evidence: { page: null, quote: 'Line 2%' } }); assert.strictEqual(nopage.accept, true); assert.ok(allCodes(nopage).includes('W_NO_PAGE'));
  assert.ok(allCodes(row1({ evidence: { page: 2.5, quote: 'x' } })).includes('W_PAGE'));
});
t('size limits: long text is cut and flagged, not refused', () => {
  const r = row1({ label: 'x'.repeat(500), evidence: { page: 1, quote: 'q'.repeat(5000) }, notes: 'n'.repeat(5000) });
  assert.strictEqual(r.label.length, R.LIMITS.label); assert.strictEqual(r.quote.length, R.LIMITS.quote); assert.strictEqual(r.notes.length, R.LIMITS.notes);
  assert.ok(allCodes(r).includes('W_TRUNCATED'));
  assert.strictEqual(row1({ label: 'a\u0000b\n\tc  <b>d</b>' }).label, 'a b c <b>d</b>');   // control characters and line breaks become spaces; markup stays plain text
});

/* ---------- duplicates ---------- */
t('duplicates: higher confidence wins, then the first; the loser is unticked and says so', () => {
  let v = check([entry({ value: 2, confidence: 'medium' }), entry({ value: 3, confidence: 'high' })]);
  assert.deepStrictEqual(v.rows.map(r => r.accept), [false, true]);
  assert.strictEqual(v.rows[0].res.dupOf, 2); assert.ok(allCodes(v.rows[0]).includes('W_DUP_LOSER')); assert.ok(allCodes(v.rows[1]).includes('W_DUP_WINNER'));
  v = check([entry({ value: 2 }), entry({ value: 3 })]);
  assert.deepStrictEqual(v.rows.map(r => r.accept), [true, false]);
  // a loss and its uncertainty on the same item are not duplicates
  v = check([entry({ id: 'wake_int', quantity: 'loss', stated_as: 'loss', value: 9 }), entry({ id: 'wake_int', percent_of: 'loss_points', value: 1.5 })]);
  assert.deepStrictEqual(v.rows.map(r => r.accept), [true, true]);
  // ticking both is refused by the plan; ticking the loser alone uses it
  v = check([entry({ value: 2 }), entry({ value: 3 })]);
  const p = L.exampleProject();
  assert.deepStrictEqual(codes(R.planApply(v, { rows: { 2: { accept: true } } }, p, L, E, { at: AT }).errors), ['P_CONFLICT']);
  const plan = R.planApply(v, { rows: { 1: { accept: false }, 2: { accept: true } } }, p, L, E, { at: AT });
  assert.ok(plan.ok); assert.strictEqual(R.applyImport(p, plan).project.items.mcp.entered.v, 3);
});

/* ---------- devices and hybrid ---------- */
t('mast and lidar items need a device of the right type', () => {
  const ex = L.exampleProject();   // device 1 = mast, device 2 = lidar
  const r = row1({ id: 'cup_cal', device: 1 }, ex);
  assert.strictEqual(r.res.path, 'devices.0.items.cup_cal'); assert.strictEqual(r.res.device, 0);
  assert.strictEqual(row1({ id: 'cup_cal', device: null }, ex).res.device, 0);            // the only mast
  assert.strictEqual(row1({ id: 'lid_verif', device: null }, ex).res.path, 'devices.1.items.lid_verif');
  assert.deepStrictEqual(codes(row1({ id: 'cup_cal', device: 2 }, ex).res.errors), ['R_DEVICE_TYPE']);
  assert.deepStrictEqual(codes(row1({ id: 'cup_cal', device: 9 }, ex).res.errors), ['R_DEVICE_RANGE']);
  const two = L.exampleProject(); two.devices.push(L.newDevice('mast'));
  assert.deepStrictEqual(codes(row1({ id: 'cup_cal', device: null }, two).res.errors), ['R_DEVICE_PICK']);
  const none = L.blankProject('wind');
  assert.deepStrictEqual(codes(row1({ id: 'lid_verif', device: null }, none).res.errors), ['R_DEVICE_NONE']);
  // the user picks the device in the review
  const v = check([entry({ id: 'cup_cal', device: null })], two);
  const plan = R.planApply(v, { rows: { 1: { device: 2, accept: true } } }, two, L, E, { at: AT });
  assert.ok(plan.ok); assert.strictEqual(plan.changes[0].path, 'devices.2.items.cup_cal');
});
t('hybrid: wind, solar and shared items are told apart by id', () => {
  const hy = L.hybridExampleProject();
  const v = check([entry({ id: 'mcp' }), entry({ id: 'sat_model', percent_of: 'irradiance' }), entry({ id: 'cur_grid', quantity: 'loss', stated_as: 'loss', value: 2 }), entry({ id: 'hy_export_limit', quantity: 'loss', stated_as: 'loss', value: 1.1 }), entry({ id: 'cup_cal', device: 1 })], hy, { report: { technology: 'hybrid' } });
  assert.deepStrictEqual(v.rows.map(r => r.res.plant), ['wind', 'solar', 'shared', 'shared', 'wind']);
  assert.ok(allCodes(v.rows[2]).includes('W_SHARED')); assert.ok(!allCodes(v.rows[0]).includes('W_SHARED'));
  assert.deepStrictEqual(v.rows.map(r => r.res.errors.length), [0, 0, 0, 0, 0]);
  // a figure in energy terms uses the sensitivity of its own plant
  const r = E.evaluate(hy, L);
  const e = check([entry({ id: 'mcp', value: 4, percent_of: 'energy' }), entry({ id: 'sat_model', value: 4, percent_of: 'energy' })], hy);
  near(e.rows[0].res.value, 4 / r.wind.en.S, 1e-3); near(e.rows[1].res.value, 4 / r.solar.en.S, 1e-3);
  // the same shared item from the wind and the solar chapter is a duplicate, applied once
  const d = check([entry({ id: 'el_export', quantity: 'loss', stated_as: 'loss', value: 1.0 }), entry({ id: 'el_export', quantity: 'loss', stated_as: 'loss', value: 1.2 })], hy);
  assert.deepStrictEqual(d.rows.map(x => x.accept), [true, false]);
  // a report P50 is not imported into a hybrid
  const b = R.validateImport(payload([entry({})], { project: { net_p50_gwh: { value: 600, page: 2, quote: 'P50 600 GWh' }, hub_height_m: { value: 120, page: 2, quote: 'hub 120 m' }, ghi_kwh_m2: { value: 1900, page: 2, quote: 'GHI 1900' } } }), hy, L, E);
  assert.deepStrictEqual(b.basics.map(x => [x.key, x.accept]), [['hub_height_m', true], ['ghi_kwh_m2', true], ['net_p50_gwh', false]]);
  assert.deepStrictEqual(codes(b.basics[2].errors), ['B_HYBRID_P50']);
  // hybrid-only and solar ids are refused in a wind project
  assert.deepStrictEqual(codes(row1({ id: 'hy_export_limit', quantity: 'loss', stated_as: 'loss' }).res.errors), ['R_ID_TECH']);
});
t('an item that the set-up does not use is stored with a warning', () => {
  const r = row1({ id: 'atlas', value: 9 });   // the wind example measures on site
  assert.deepStrictEqual(r.res.errors, []); assert.ok(allCodes(r).includes('W_INACTIVE')); assert.strictEqual(r.accept, false);   // stored when ticked, but needs a look (review finding F2)
});

/* ---------- covers ---------- */
t('covers: the other items of the category are set to Exclude, with limits', () => {
  const p = L.exampleProject();
  const v = check([entry({ id: 'mcp', covers: ['ref_consistency', 'lt_period', 'mcp', 'nope', 'wake_int', 'cup_op'] }), entry({ id: 'lt_period', value: 0.8 })], p);
  assert.deepStrictEqual(v.rows[0].res.covers.map(c => c.id), ['ref_consistency']);
  assert.deepStrictEqual(codes(v.rows[0].res.warnings).sort(), ['W_COVERS_DEVICE', 'W_COVERS_KIND', 'W_COVERS_SET', 'W_COVERS_UNKNOWN', 'W_COVERS_UNKNOWN']);
  const out = R.applyImport(p, R.planApply(v, null, p, L, E, { at: AT })).project;
  assert.strictEqual(out.items.ref_consistency.mode, 'none'); assert.strictEqual(out.items.ref_consistency.evidence.by, 'mcp');
  assert.strictEqual(out.items.lt_period.mode, 'entered'); assert.strictEqual(out.items.lt_period.entered.v, 0.8);
  assert.strictEqual(out.items.wake_int.mode, p.items.wake_int.mode);
  // the user can keep the covered items as they are
  const keep = R.applyImport(p, R.planApply(v, { rows: { 1: { covers: false } } }, p, L, E, { at: AT })).project;
  assert.strictEqual(keep.items.ref_consistency.mode, p.items.ref_consistency.mode);
  // a loss row may stand in for other loss items; an uncertainty of a loss may not
  const l = check([entry({ id: 'el_eff', quantity: 'loss', stated_as: 'loss', value: 3, covers: ['el_parasitic', 'mcp'] }), entry({ id: 'wake_int', percent_of: 'loss_points', value: 1, covers: ['blockage'] })], p);
  assert.deepStrictEqual(l.rows[0].res.covers.map(c => c.id), ['el_parasitic']); assert.deepStrictEqual(l.rows[1].res.covers, []);
  // device items are excluded on the same device only
  const d = check([entry({ id: 'cup_cal', device: 1, covers: ['cup_op', 'lid_verif'] })], p);
  assert.deepStrictEqual(d.rows[0].res.covers.map(c => c.path), ['devices.0.items.cup_op']);
});

/* ---------- review decisions ---------- */
t('the reviewer can map an unmapped row, change a value and leave a row out', () => {
  const p = L.exampleProject();
  const v = R.validateImport(payload([entry({ id: 'mcp', value: 2.1 }), entry({ id: 'pc_unc', percent_of: 'energy', value: 2.5 })], { unmapped: [Object.assign(entry({ value: 1.1 }), { id: undefined, reason: 'unsure' })] }), p, L, E);
  assert.deepStrictEqual(codes(v.rows[2].res.errors), ['R_UNMAPPED']);
  const plan = R.planApply(v, { rows: { 1: { value: 1.9 }, 2: { accept: false }, 3: { id: 'vert_model', accept: true } } }, p, L, E, { at: AT });
  assert.ok(plan.ok);
  const out = R.applyImport(p, plan).project;
  assert.strictEqual(out.items.mcp.entered.v, 1.9); assert.strictEqual(out.items.mcp.evidence.refs[0].edited, true);
  assert.deepStrictEqual(out.items.pc_unc, p.items.pc_unc);
  assert.strictEqual(out.items.vert_model.entered.v, 1.1);
  // an edited value is still range-checked, and nothing ticked is not a plan
  assert.deepStrictEqual(codes(R.planApply(v, { rows: { 1: { value: 99 } } }, p, L, E, { at: AT }).rows[0].errors), ['R_RANGE']);
  assert.deepStrictEqual(codes(R.planApply(v, { rows: { 1: { accept: false }, 2: { accept: false } } }, p, L, E, { at: AT }).errors), ['P_NOTHING']);
});

/* ---------- apply ---------- */
t('apply is atomic: one new project, the old one untouched, and undo is the old one', () => {
  const p = L.exampleProject(), before = JSON.stringify(p);
  const v = R.validateImport(WIND, p, L, E), plan = R.planApply(v, null, p, L, E, { at: AT });
  const out = R.applyImport(p, plan);
  assert.ok(out.ok); assert.notStrictEqual(out.project, p);
  assert.strictEqual(JSON.stringify(p), before, 'the project passed in must not change');
  assert.strictEqual(JSON.stringify(plan.changes.find(c => c.path === 'items.mcp').before), JSON.stringify(p.items.mcp));
  // undo = keep the object you had before (the UI pins it as the baseline)
  near(E.evaluate(JSON.parse(before), L).H[10].pv.P90, E.evaluate(p, L).H[10].pv.P90, 1e-9);
  // a plan that is not ok, or a path that cannot be written, changes nothing
  assert.strictEqual(R.applyImport(p, { ok: false, changes: [] }).ok, false);
  const bad = { ok: true, changes: [{ path: 'items.mcp', after: { mode: 'none' } }, { path: 'items.__proto__.x', after: 1 }] };
  const res = R.applyImport(p, bad);
  assert.strictEqual(res.ok, false); assert.strictEqual(res.project, p); assert.strictEqual(JSON.stringify(p), before); assert.strictEqual(({}).x, undefined);
});
t('items the report does not state keep their state exactly', () => {
  const p = L.exampleProject();
  const out = R.applyImport(p, R.planApply(check([entry({ id: 'wake_int', quantity: 'loss', stated_as: 'loss', value: 12 })], p), null, p, L, E, { at: AT })).project;
  Object.keys(p.items).filter(id => id !== 'wake_int').forEach(id => assert.deepStrictEqual(out.items[id], p.items[id], id));
  assert.deepStrictEqual(out.devices, p.devices); assert.deepStrictEqual(out.plant, p.plant); assert.deepStrictEqual(out.energy, p.energy);
  // only the loss was stated: the uncertainty in use (1.84 points on 9.2 %) is scaled with the loss: 1.84 × 12 / 9.2 = 2.4 (review finding F9)
  assert.deepStrictEqual(out.items.wake_int.entered, { L: 12, s: 2.4, iav: 0 });
  assert.strictEqual(out.items.wake_int.mode, 'entered');
  assert.deepStrictEqual(out.items.wake_int.inputs, p.items.wake_int.inputs);
});
t('imported values are site values (Enter value mode) and carry their evidence through save and load', () => {
  const p = L.exampleProject();
  const out = R.applyImport(p, R.planApply(R.validateImport(WIND, p, L, E), null, p, L, E, { at: AT })).project;
  const model = E.buildModel(out, L);
  const mcp = model.items.find(i => i.id === 'mcp');
  assert.strictEqual(mcp.mode, 'entered'); assert.strictEqual(mcp.tier, 'site'); assert.strictEqual(mcp.sigma, 2.1);
  assert.strictEqual(E.IEC_BASIS[mcp.mode], 'project_specific_assumption');
  assert.strictEqual(model.items.find(i => i.id === 'ref_consistency').tier, 'none');
  const back = L.normalise(JSON.parse(JSON.stringify(out)));
  assert.deepStrictEqual(back.items.mcp.evidence, out.items.mcp.evidence);
  assert.deepStrictEqual(back.devices[0].items.cup_cal.evidence, out.devices[0].items.cup_cal.evidence);
  assert.deepStrictEqual(back.importLog, out.importLog);
  const e = out.items.mcp.evidence;
  assert.strictEqual(e.src, R.SCHEMA); assert.strictEqual(e.mode, 'entered'); assert.strictEqual(e.at, AT); assert.deepStrictEqual(e.applied, { v: 2.1 });
  assert.strictEqual(e.refs[0].page, 43); assert.strictEqual(e.refs[0].quote, 'Long-term wind resource 2.1%');
  assert.strictEqual(R.evidenceLine(out.items.mcp), 'Energy Yield Assessment, Kaveri Ridge Wind Farm (fictional), p. 43: “Long-term wind resource 2.1%”');
  assert.strictEqual(R.evidenceLine(out.items.ref_consistency), 'Counted inside “Long-term wind resource” (Energy Yield Assessment, Kaveri Ridge Wind Farm (fictional), p. 43)');
  // evidence follows the value: edited by hand, or set another way
  assert.strictEqual(R.evidenceState(out.items.mcp), 'current');
  const ed = copy(out.items.mcp); ed.entered.v = 2.4; assert.strictEqual(R.evidenceState(ed), 'edited'); assert.ok(R.evidenceLine(ed).endsWith(' (changed since import)'));
  const dm = copy(out.items.mcp); dm.mode = 'desc'; assert.strictEqual(R.evidenceState(dm), 'dormant'); assert.strictEqual(R.evidenceLine(dm), '');
  assert.strictEqual(R.evidenceState(p.items.mcp), 'none'); assert.strictEqual(R.evidenceLine(p.items.mcp), '');
  // older projects without evidence load as before
  assert.strictEqual(L.normalise(JSON.parse(JSON.stringify(p))).items.mcp.evidence, undefined);
});
t('the import log keeps the report and the project values, ten entries at most', () => {
  let p = L.exampleProject();
  for (let i = 0; i < 12; i++) p = R.applyImport(p, R.planApply(R.validateImport(WIND, p, L, E), null, p, L, E, { at: AT })).project;
  assert.strictEqual(p.importLog.length, 10);
  const last = p.importLog[9];
  assert.strictEqual(last.title, 'Energy Yield Assessment, Kaveri Ridge Wind Farm (fictional)'); assert.strictEqual(last.values, 11); assert.strictEqual(last.excluded, 12);
  assert.deepStrictEqual(last.basics.find(b => b.key === 'net_p50_gwh'), { key: 'net_p50_gwh', path: 'energy.p50', value: 291.4, page: 5, quote: 'Net energy P50: 291.4 GWh/yr', edited: false });
});

/* ---------- sample payloads against the real library and engine ---------- */
t('wind sample validates cleanly and applies to the wind example', () => {
  const p = L.exampleProject(), v = R.validateImport(JSON.stringify(WIND), p, L, E);
  assert.ok(v.ok); assert.deepStrictEqual(v.errors, []); assert.deepStrictEqual(v.warnings, []);
  assert.strictEqual(v.rows.length, 13);
  v.rows.slice(0, 11).forEach(r => { assert.deepStrictEqual(r.errors.concat(r.res.errors), [], 'row ' + r.n); assert.strictEqual(r.accept, true, 'row ' + r.n); assert.ok(R.validIds('wind', L).includes(r.res.id)); });
  v.rows.slice(11).forEach(r => { assert.deepStrictEqual(codes(r.res.errors), ['R_UNMAPPED']); assert.strictEqual(r.accept, false); });
  assert.deepStrictEqual(v.rows.slice(0, 11).map(r => [r.res.id, r.res.field, r.res.value]), [['cup_cal', 'v', 1.2], ['mcp', 'v', 2.1], ['vert_model', 'v', 1], ['horiz_approp', 'v', 3], ['ws_iav', 'v', 4.2], ['pc_unc', 'v', 2.5], ['wake_int', 'L', 9.8], ['wake_int', 's', 1.96], ['av_wtg', 'L', 3], ['el_eff', 'L', 2.1], ['cur_grid', 'L', 1.5]]);
  assert.ok(v.basics.every(b => b.accept && !b.errors.length)); assert.strictEqual(v.basics.length, 9);
  const plan = R.planApply(v, null, p, L, E, { at: AT });
  assert.ok(plan.ok); assert.deepStrictEqual(plan.summary, { values: 11, items: 10, excluded: 12, basics: 9 });
  const out = R.applyImport(p, plan).project, r = E.evaluate(out, L);
  near(r.en.p50, 291.4, 1e-9); assert.strictEqual(r.en.p50Source, 'entered'); near(r.en.S, 1.95, 1e-9);
  assert.strictEqual(out.energy.p50Mode, 'entered'); assert.strictEqual(out.site.rhoMode, 'entered'); assert.strictEqual(out.energy.sensMode, 'entered');
  assert.deepStrictEqual(E.sanity(out, r), []);
});
t('solar sample validates cleanly and applies to the solar example', () => {
  const p = L.solarExampleProject(), v = R.validateImport('```json\n' + JSON.stringify(SOLAR, null, 2) + '\n```', p, L, E);
  assert.ok(v.ok); assert.deepStrictEqual(v.errors, []); assert.deepStrictEqual(v.warnings, []);
  v.rows.slice(0, 12).forEach(r => { assert.deepStrictEqual(r.errors.concat(r.res.errors), [], 'row ' + r.n); assert.strictEqual(r.accept, true, 'row ' + r.n); assert.ok(R.validIds('solar', L).includes(r.res.id)); });
  assert.deepStrictEqual(v.rows.slice(0, 12).map(r => [r.res.id, r.res.field, r.res.value]), [['sat_model', 'v', 3.5], ['ghi_iav', 'v', 2.3], ['transposition', 'v', 2], ['model_chain', 'v', 2], ['bifacial', 'L', -5.8], ['soiling', 'L', 3], ['soiling', 's', 1], ['temperature', 'L', 7.4], ['inverter', 'L', 1.6], ['clipping', 'L', 1.9], ['pv_avail', 'L', 1], ['degradation', 'L', 0.45]]);
  const plan = R.planApply(v, null, p, L, E, { at: AT });
  assert.ok(plan.ok); assert.deepStrictEqual(plan.summary, { values: 12, items: 11, excluded: 0, basics: 7 });
  const out = R.applyImport(p, plan).project, r = E.evaluate(out, L);
  near(r.en.p50, 371.2, 1e-9); assert.strictEqual(out.pv.ghi, 1968);
  assert.ok(r.H[10].sigma < E.evaluate(p, L).H[10].sigma, 'a better irradiance figure lowers the uncertainty');
});

/* ---------- the engine moves the right way ---------- */
t('wind example: a lower flow-model uncertainty raises P90; a higher wake loss lowers P50', () => {
  const p = L.exampleProject(), r0 = E.evaluate(p, L);
  const cur = r0.model.items.find(i => i.id === 'horiz_approp').sigma;
  assert.ok(cur > 2.5, 'the example flow-model uncertainty is above the imported one');
  const a = R.applyImport(p, R.planApply(check([entry({ id: 'horiz_approp', value: 2.0 })], p), null, p, L, E, { at: AT })).project, ra = E.evaluate(a, L);
  assert.ok(ra.H[10].sigma < r0.H[10].sigma); assert.ok(ra.H[10].pv.P90 > r0.H[10].pv.P90); near(ra.en.p50, r0.en.p50, 1e-9);
  const b = R.applyImport(p, R.planApply(check([entry({ id: 'wake_int', quantity: 'loss', stated_as: 'loss', value: 12 })], p), null, p, L, E, { at: AT })).project, rb = E.evaluate(b, L);
  assert.ok(rb.en.p50 < r0.en.p50); near(rb.en.p50 / r0.en.p50, (1 - 0.12) / (1 - 0.092), 1e-6);
});
t('solar example: a lower satellite uncertainty raises P90; a higher soiling loss lowers P50', () => {
  const p = L.solarExampleProject(), r0 = E.evaluate(p, L);
  assert.strictEqual(r0.model.items.find(i => i.id === 'sat_model').sigma, 4.5);
  const a = R.applyImport(p, R.planApply(check([entry({ id: 'sat_model', percent_of: 'irradiance', value: 2.5 })], p), null, p, L, E, { at: AT })).project, ra = E.evaluate(a, L);
  assert.ok(ra.H[10].sigma < r0.H[10].sigma); assert.ok(ra.H[10].pv.P90 > r0.H[10].pv.P90);
  const soil0 = r0.model.items.find(i => i.id === 'soiling').L;
  const b = R.applyImport(p, R.planApply(check([entry({ id: 'soiling', quantity: 'loss', stated_as: 'loss', value: 4.5 })], p), null, p, L, E, { at: AT })).project, rb = E.evaluate(b, L);
  assert.ok(soil0 < 4.5); assert.ok(rb.en.p50 < r0.en.p50);
});

/* ---------- the prompt ---------- */
t('the prompt lists exactly the valid ids, from the library, and the schema', () => {
  const ex = L.exampleProject();
  const ids = text => text.split('\n').filter(l => /^[a-z0-9_]+ \| .* \[.*\] \| /.test(l)).map(l => l.split(' | ')[0]);
  assert.deepStrictEqual(ids(R.buildPrompt('wind', L, ex)), R.validIds('wind', L));
  assert.deepStrictEqual(ids(R.buildPrompt('solar', L, L.solarExampleProject())), R.validIds('solar', L));
  assert.deepStrictEqual(ids(R.buildPrompt('hybrid', L, L.hybridExampleProject())), R.validIds('hybrid', L));
  // a part report in a hybrid project
  assert.deepStrictEqual(ids(R.buildPrompt('solar', L, L.hybridExampleProject())), R.validIds('solar', L));
  // device items are listed only for the device types the project has
  const noLidar = L.blankProject('wind');
  assert.ok(!ids(R.buildPrompt('wind', L, noLidar)).includes('lid_verif') && ids(R.buildPrompt('wind', L, noLidar)).includes('cup_cal'));
  const text = R.buildPrompt('wind', L, ex);
  assert.ok(text.includes('"schema": "wattodds.report-import/1"')); assert.ok(text.includes('"technology": "wind"'));
  assert.ok(text.includes('1 = Mast M1 (100 m) (mast, 100 m)')); assert.ok(text.includes('2 = Lidar L1 (on site) (lidar, 140 m)'));
  assert.ok(text.includes('mcp | Long-term correction (MCP) [uncertainty, % of wind speed] | ' + L.ITEM_BY_ID.mcp.info.what));
  assert.ok(text.includes('Never calculate')); assert.ok(text.includes('Reply with the JSON object only'));
  assert.ok(!/<\/script/i.test(text));
  // the skeleton at the end of the prompt is itself a valid payload shape
  const sk = R.extractJson(text.slice(text.lastIndexOf('OUTPUT.')));
  assert.ok(sk.ok); assert.strictEqual(sk.value.schema, R.SCHEMA); assert.deepStrictEqual(Object.keys(sk.value), ['schema', 'report', 'project', 'items', 'unmapped']);
});
t('the source file can be inlined in a script block', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/reportimport.js'), 'utf8');
  assert.ok(!/<\/script/i.test(src)); assert.ok(!/\b(document|window|localStorage|fetch|XMLHttpRequest|eval|Function)\s*[.(]/.test(src));
});

/* ---------- review findings (round 1): each test names the finding it covers ---------- */
const imp = (pl, p, dec) => { const v = R.validateImport(pl, p, L, E); const plan = R.planApply(v, dec || null, p, L, E, { at: AT }); const res = R.applyImport(p, plan); return { v, plan, ok: res.ok, out: res.project }; };
const lossE = o => entry(Object.assign({ quantity: 'loss', stated_as: 'loss', percent_of: null, level: null }, o));
const itemOf = (r, id) => r.model.items.find(i => i.id === id);
const fix2 = x => +(+x).toFixed(2);

t('F1: a share of energy is converted with the sensitivity the project has after the import', () => {
  const p = L.exampleProject(), S0 = E.evaluate(p, L).en.S;
  const pl = payload([entry({ id: 'horiz_approp', value: 6, percent_of: 'energy' })], { report: { technology: 'wind' }, project: {
    mean_wind_speed_ms: { value: 8.6, page: 2, quote: 'mean wind speed 8.6 m/s' }, turbine_rated_mw: { value: 4.5, page: 2, quote: 'rated 4.5 MW' } } });
  const x = imp(pl, p);
  assert.ok(x.ok); assert.strictEqual(x.v.rows[0].accept, true);
  const r = E.evaluate(x.out, L);
  assert.ok(Math.abs(r.en.S - S0) > 0.1, 'the project values change the sensitivity');
  near(r.en.S * itemOf(r, 'horiz_approp').sigma, 6, 0.01, 'the 6 % of energy in the report is 6 % of energy after the import:');
  const msg = x.v.rows[0].res.warnings.find(w => w.code === 'W_FROM_ENERGY').message;
  assert.ok(msg.includes('S = ' + fix2(r.en.S) + ')'), msg);
  // the reviewer leaves the project values out: the sensitivity is the one before, and the figure still comes out at 6 %
  const y = imp(pl, p, { basics: { mean_wind_speed_ms: { accept: false }, turbine_rated_mw: { accept: false } } });
  const ry = E.evaluate(y.out, L);
  near(ry.en.S, S0, 1e-9); near(ry.en.S * itemOf(ry, 'horiz_approp').sigma, 6, 0.01);
});
t('F1: the loss in use after the import is the reference for a share of the loss, and the starting point of the item', () => {
  const p = L.solarExampleProject();   // DC 195 MWp; AC 120 MW makes DC/AC 1.625 and clipping 6.43 %
  const x = imp(payload([entry({ id: 'clipping', quantity: 'uncertainty', percent_of: 'relative_to_loss', value: 20 })], { report: { technology: 'solar' }, project: { ac_capacity_mw: { value: 120, page: 2, quote: 'AC capacity 120 MW' } } }), p);
  assert.ok(x.ok); assert.strictEqual(x.v.rows[0].accept, true);
  near(x.v.rows[0].res.value, 6.43 * 0.2, 1e-3);
  assert.strictEqual(x.out.items.clipping.entered.L, 6.43);
  near(x.out.items.clipping.entered.s, 1.286, 1e-3);
});

t('F2: a row on an item the set-up does not use is not ticked and excludes nothing', () => {
  const p = L.solarExampleProject(); p.setup.solarSource = 'ground';
  const r0 = E.evaluate(p, L);
  assert.ok(!itemOf(r0, 'sat_model') && itemOf(r0, 'ground_sensor'), 'set-up: ground sensors only');
  const pl = payload([entry({ id: 'sat_model', value: 3.5, percent_of: 'irradiance', covers: ['ground_sensor', 'site_adapt'] })], { report: { technology: 'solar' } });
  const x = imp(pl, p), row = x.v.rows[0];
  assert.strictEqual(row.accept, false); assert.ok(allCodes(row).includes('W_INACTIVE')); assert.deepStrictEqual(row.res.covers, []);
  // ticked by hand: the value is stored, and still nothing is excluded
  const y = imp(pl, p, { rows: { 1: { accept: true } } });
  assert.ok(y.ok); assert.strictEqual(y.out.items.sat_model.entered.v, 3.5);
  assert.deepStrictEqual(y.out.items.ground_sensor, p.items.ground_sensor); assert.deepStrictEqual(y.out.items.site_adapt, p.items.site_adapt);
  near(E.evaluate(y.out, L).H[10].sigma, r0.H[10].sigma, 1e-9);
});

t('F3: "covers" takes only items of the same category, kind, timing and plant', () => {
  const hy = L.hybridExampleProject();
  const a = imp(payload([lossE({ id: 'wake_int', value: 9.8, covers: ['soiling', 'temperature', 'av_grid', 'hy_export_limit', 'blockage'] })], { report: { technology: 'wind' } }), hy);
  assert.deepStrictEqual(a.v.rows[0].res.covers.map(c => c.id), ['blockage']);
  assert.strictEqual(codes(a.v.rows[0].res.warnings).filter(c => c === 'W_COVERS_GROUP').length, 4);
  assert.strictEqual(a.v.rows[0].res.warnings.find(w => w.code === 'W_COVERS_GROUP').message, '“Soiling” is not in the same group as this row, so it is not excluded.');
  ['soiling', 'temperature', 'av_grid', 'hy_export_limit'].forEach(id => assert.deepStrictEqual(a.out.items[id], hy.items[id], id));
  assert.strictEqual(a.out.items.blockage.mode, 'none');
  const p = L.exampleProject();
  const b = imp(payload([entry({ id: 'mcp', value: 2.1, covers: ['pc_unc', 'ws_iav', 'climate_change', 'horiz_approp', 'atmos', 'poi_meter', 'ref_consistency'] })]), p);
  assert.deepStrictEqual(b.v.rows[0].res.covers.map(c => c.id), ['ref_consistency']);
  ['pc_unc', 'ws_iav', 'climate_change', 'horiz_approp', 'atmos', 'poi_meter'].forEach(id => assert.deepStrictEqual(b.out.items[id], p.items[id], id));
  // the sample payloads still cover what they did
  assert.strictEqual(R.planApply(R.validateImport(WIND, L.exampleProject(), L, E), null, L.exampleProject(), L, E, { at: AT }).summary.excluded, 12);
});

t('F4: a part report in a hybrid sets only its own plant and the shared items', () => {
  const hy = L.hybridExampleProject();
  const v = R.validateImport(payload([lossE({ id: 'soiling', value: 2.5 }), entry({ id: 'mcp', value: 3 })], { report: { technology: 'solar' }, project: {
    hub_height_m: { value: 90, page: 1, quote: 'hub height 90 m' }, ghi_kwh_m2: { value: 1900, page: 1, quote: 'GHI 1900 kWh/m2' } } }), hy, L, E);
  assert.ok(v.ok);
  assert.strictEqual(v.rows[0].accept, true);
  assert.deepStrictEqual(codes(v.rows[1].res.errors), ['R_ID_PART']); assert.strictEqual(v.rows[1].accept, false);
  assert.strictEqual(v.rows[1].res.errors[0].message, '“Long-term correction (MCP)” is a wind item, and this is a solar report. Choose an item, or leave this row out.');
  assert.deepStrictEqual(v.basics.map(b => b.key), ['ghi_kwh_m2']);
  // the reviewer may still choose the item by hand
  const plan = R.planApply(v, { rows: { 2: { id: 'mcp', accept: true } } }, hy, L, E, { at: AT });
  assert.ok(plan.ok); assert.strictEqual(plan.rows[1].accept, true); assert.deepStrictEqual(plan.rows[1].errors, []);
  // a whole-hybrid report is not limited
  const w = R.validateImport(payload([entry({ id: 'mcp', value: 3 })], { report: { technology: 'hybrid' } }), hy, L, E);
  assert.strictEqual(w.rows[0].accept, true);
});

t('F5: a gain can be imported on any loss item, and a mix of signs needs a look', () => {
  const sol = L.solarExampleProject();
  const g = row1(lossE({ id: 'spectral', value: 0.6, stated_as: 'gain' }), sol);
  assert.deepStrictEqual(g.res.errors, []); assert.strictEqual(g.res.value, -0.6); assert.ok(allCodes(g).includes('W_GAIN'));
  assert.strictEqual(g.accept, false, 'a gain on an item that is normally a loss needs a look');
  assert.strictEqual(row1(lossE({ id: 'temperature', value: 0.8, stated_as: 'gain' }), sol).res.value, -0.8);
  // the reviewer can type a gain
  const v = check([lossE({ id: 'spectral', value: 0.6 })], sol);
  const plan = R.planApply(v, { rows: { 1: { value: -0.6, accept: true } } }, sol, L, E, { at: AT });
  assert.ok(plan.ok, codes(plan.rows[0].errors).join()); assert.strictEqual(R.applyImport(sol, plan).project.items.spectral.entered.L, -0.6);
  assert.deepStrictEqual(codes(R.planApply(v, { rows: { 1: { value: -31 } } }, sol, L, E, { at: AT }).rows[0].errors), ['R_RANGE']);
  // a loss diagram that writes losses as negative numbers: a positive figure in the same list may be a gain
  const mixed = check([lossE({ id: 'soiling', value: -2 }), lossE({ id: 'spectral', value: 0.6 })], sol);
  mixed.rows.forEach(r => { assert.ok(allCodes(r).includes('W_SIGN_MIXED'), 'row ' + r.n); assert.strictEqual(r.accept, false, 'row ' + r.n); });
  assert.deepStrictEqual(mixed.rows.map(r => r.res.value), [2, 0.6]);
  // one each way: no majority, so both are flagged with a message that fits either sign (round 2, N4)
  mixed.rows.forEach(r => assert.strictEqual(r.res.warnings.find(w => w.code === 'W_SIGN_MIXED').message, 'The report writes some losses as positive numbers and some as negative. Check whether this one is a gain.'));
  // all negative, or all positive: read as losses, nothing to flag; rates and efficiencies do not count
  check([lossE({ id: 'soiling', value: -2 }), lossE({ id: 'temperature', value: -7 }), lossE({ id: 'pv_avail', value: 99, stated_as: 'efficiency' }), lossE({ id: 'degradation', value: 0.45, unit: '%/yr' })], sol)
    .rows.forEach(r => { assert.ok(!allCodes(r).includes('W_SIGN_MIXED'), 'row ' + r.n); assert.strictEqual(r.accept, true, 'row ' + r.n); });
  // bifacial gain is unchanged
  assert.strictEqual(row1(lossE({ id: 'bifacial', value: 5.8, stated_as: 'gain' }), sol).res.value, -5.8);
  assert.strictEqual(row1(lossE({ id: 'bifacial', value: 5.8, stated_as: 'gain' }), sol).accept, true);
  // the prompt says how to read such a diagram
  assert.ok(R.buildPrompt('solar', L, sol).includes('If the report shows losses as negative numbers, a positive figure in the same list is a gain: use "stated_as": "gain".'));
});

t('F6: a loss imported into an item that was not in use gets an uncertainty that is not zero, and needs a look', () => {
  const p = L.exampleProject(); assert.strictEqual(p.items.cur_ops.mode, 'none');
  // the app's default for operational curtailment is 0 ± 0, so there is nothing to scale from: half the loss (round 2, N2)
  const v = check([lossE({ id: 'cur_ops', value: 2 })], p);
  assert.strictEqual(v.rows[0].accept, false); assert.ok(allCodes(v.rows[0]).includes('W_S_HALF'));
  assert.strictEqual(v.rows[0].res.warnings.find(w => w.code === 'W_S_HALF').message, 'The report gives no uncertainty for this loss, and there is none to scale from. Half the loss (1 points) is used; check it.');
  let out = R.applyImport(p, R.planApply(v, { rows: { 1: { accept: true } } }, p, L, E, { at: AT })).project;
  assert.deepStrictEqual(out.items.cur_ops.entered, { L: 2, s: 1, iav: 0 });
  // an item whose library default has an uncertainty: the default ratio is scaled to the report's loss (0.3 on 0.5 % → 0.6 on 1 %)
  const q = L.exampleProject(); q.items.av_bop.mode = 'none'; q.items.av_bop.entered = { L: 0, s: 0, iav: 0 };
  const w = check([lossE({ id: 'av_bop', value: 1 })], q);
  assert.strictEqual(w.rows[0].accept, false);
  assert.strictEqual(w.rows[0].res.warnings.find(x => x.code === 'W_S_SCALED').message, 'The report gives no uncertainty for this loss. The uncertainty of the app’s default (0.3 points on a loss of 0.5 %) is scaled with the loss to 0.6 points.');
  out = R.applyImport(q, R.planApply(w, { rows: { 1: { accept: true } } }, q, L, E, { at: AT })).project;
  assert.deepStrictEqual(out.items.av_bop.entered, { L: 1, s: 0.6, iav: 0 });
  // with its uncertainty in the same import: nothing to flag
  const z = check([lossE({ id: 'av_bop', value: 1 }), entry({ id: 'av_bop', percent_of: 'loss_points', value: 0.4 })], q);
  assert.deepStrictEqual(z.rows.map(r => r.accept), [true, true]);
  ['W_S_SCALED', 'W_S_HALF', 'W_S_CAP', 'W_COVERS_S'].forEach(c => assert.ok(!allCodes(z.rows[0]).includes(c), c));
  out = R.applyImport(q, R.planApply(z, null, q, L, E, { at: AT })).project;
  assert.deepStrictEqual(out.items.av_bop.entered, { L: 1, s: 0.4, iav: 0 });
  // only the uncertainty: the loss takes the library default, and the row needs a look
  const s = check([entry({ id: 'av_bop', percent_of: 'loss_points', value: 0.4 })], q);
  assert.strictEqual(s.rows[0].accept, false); assert.ok(allCodes(s.rows[0]).includes('W_NO_L'));
  assert.strictEqual(s.rows[0].res.warnings.find(x => x.code === 'W_NO_L').message, 'The report gives no loss for this item and the item was not in use. 0.5 % is used (the app’s default); check it.');
  out = R.applyImport(q, R.planApply(s, { rows: { 1: { accept: true } } }, q, L, E, { at: AT })).project;
  assert.deepStrictEqual(out.items.av_bop.entered, { L: 0.5, s: 0.4, iav: 0 });
  // a share of the loss is taken of that default loss
  assert.strictEqual(check([entry({ id: 'av_bop', percent_of: 'relative_to_loss', value: 50 })], q).rows[0].res.value, 0.25);
});

t('F7: a loss figure that covers other losses keeps the group’s ratio of uncertainty to loss', () => {
  const p = L.exampleProject(), r0 = E.evaluate(p, L), w0 = itemOf(r0, 'av_wtg'), b0 = itemOf(r0, 'av_bop');
  const pl = payload([lossE({ id: 'av_wtg', value: 96.5, stated_as: 'efficiency', covers: ['av_bop'] })]);
  const x = imp(pl, p);
  assert.strictEqual(x.v.rows[0].accept, true); assert.ok(allCodes(x.v.rows[0]).includes('W_COVERS_S'));
  assert.strictEqual(x.out.items.av_bop.mode, 'none');
  // group in use: 3.5 % + 0.5 % = 4 %, uncertainty √(1.2² + 0.3²) = 1.237; the report's 3.5 % for both scales it by 3.5 / 4
  const gL = w0.L + b0.L, k = 3.5 / gL;
  assert.strictEqual(x.out.items.av_wtg.entered.L, 3.5);
  near(x.out.items.av_wtg.entered.s, Math.hypot(w0.sigma, b0.sigma) * k, 0.006);
  near(x.out.items.av_wtg.entered.iav, Math.hypot(w0.iav, b0.iav) * k, 0.006);
  assert.strictEqual(x.v.rows[0].res.warnings.find(w => w.code === 'W_COVERS_S').message, 'The report gives no uncertainty for this loss. The uncertainty in use for this item and the items it includes (1.24 points on a loss of 4 %) is scaled with the loss to 1.08 points.');
  // the reviewer keeps the covered item: only the item's own uncertainty is scaled, and the message says so (round 2, N6)
  const k2 = imp(pl, p, { rows: { 1: { covers: false } } });
  const row = k2.plan.rows[0];
  assert.ok(!codes(row.warnings).includes('W_COVERS_S')); assert.ok(codes(row.warnings).includes('W_S_SCALED'));   // plan rows carry their messages directly
  assert.deepStrictEqual(k2.out.items.av_wtg.entered, { L: 3.5, s: fix2(w0.sigma * 3.5 / w0.L), iav: fix2(w0.iav * 3.5 / w0.L) });
  assert.deepStrictEqual(k2.out.items.av_bop, p.items.av_bop);
  // an uncertainty row for the covering item is used as it is
  const u = imp(payload([lossE({ id: 'av_wtg', value: 96.5, stated_as: 'efficiency', covers: ['av_bop'] }), entry({ id: 'av_wtg', percent_of: 'loss_points', value: 1.5 })]), p);
  assert.ok(!allCodes(u.v.rows[0]).includes('W_COVERS_S'));
  assert.strictEqual(u.out.items.av_wtg.entered.s, 1.5);
});

t('F8 and F12 are covered by the browser check tests/import-ui.js', () => {
  assert.ok(require('fs').existsSync(require('path').join(__dirname, 'import-ui.js')));
});

t('F9: a loss stated without its uncertainty scales the uncertainty in use with the loss', () => {
  const p = L.exampleProject();   // grid curtailment in use: 3 % ± 2 points, year to year 1.5
  const v = check([lossE({ id: 'cur_grid', value: 1.5 })], p);
  assert.strictEqual(v.rows[0].accept, true); assert.ok(allCodes(v.rows[0]).includes('W_S_SCALED'));
  assert.strictEqual(v.rows[0].res.warnings.find(w => w.code === 'W_S_SCALED').message, 'The report gives no uncertainty for this loss. The uncertainty in use (2 points on a loss of 3 %) is scaled with the loss to 1 points.');
  const out = R.applyImport(p, R.planApply(v, null, p, L, E, { at: AT })).project;
  assert.deepStrictEqual(out.items.cur_grid.entered, { L: 1.5, s: 1, iav: 0.75 });
  // with the uncertainty in the same import, nothing is scaled
  const w = R.applyImport(p, R.planApply(check([lossE({ id: 'cur_grid', value: 1.5 }), entry({ id: 'cur_grid', percent_of: 'loss_points', value: 0.6 })], p), null, p, L, E, { at: AT })).project;
  assert.deepStrictEqual(w.items.cur_grid.entered, { L: 1.5, s: 0.6, iav: 1.5 });
});

t('F10: a shared item from a part report needs a look', () => {
  const hy = L.hybridExampleProject();
  const part = check([lossE({ id: 'cur_grid', value: 2 })], hy, { report: { technology: 'wind' } });
  assert.strictEqual(part.rows[0].accept, false); assert.ok(allCodes(part.rows[0]).includes('W_SHARED_PART'));
  assert.strictEqual(part.rows[0].res.warnings.find(w => w.code === 'W_SHARED_PART').message, 'Shared connection item in a wind report: it applies once, to wind plus solar. Check that the figure is for the whole plant.');
  const whole = check([lossE({ id: 'cur_grid', value: 2 })], hy, { report: { technology: 'hybrid' } });
  assert.strictEqual(whole.rows[0].accept, true); assert.ok(!allCodes(whole.rows[0]).includes('W_SHARED_PART'));
});

t('F11: the last complete import wins over a skeleton or an earlier draft', () => {
  const sk = { schema: R.SCHEMA, report: {}, project: {}, items: [], unmapped: [] };
  const real = payload([entry({ value: 2.2 })]), draft = payload([entry({ value: 1.1 })]);
  assert.strictEqual(R.extractJson(JSON.stringify(sk) + '\n\nHere is the answer:\n' + JSON.stringify(real)).value.items[0].value, 2.2);
  assert.strictEqual(R.extractJson(JSON.stringify(draft) + '\nCorrected:\n' + JSON.stringify(real)).value.items[0].value, 2.2);
  assert.strictEqual(R.validateImport(JSON.stringify(sk) + '\n' + JSON.stringify(real), L.exampleProject(), L, E).rows[0].res.value, 2.2);
  // an object nested inside another one is not taken while a top-level one exists
  assert.strictEqual(R.extractJson(JSON.stringify(real) + '\n' + JSON.stringify({ note: sk })).value.items[0].value, 2.2);
  // a skeleton alone is read, then refused as empty
  assert.strictEqual(R.validateImport(JSON.stringify(sk), L.exampleProject(), L, E).errors[0].code, 'E_NOTHING');
  // another version on its own still gets the version message
  assert.strictEqual(R.validateImport(JSON.stringify(Object.assign({}, real, { schema: 'wattodds.report-import/2' })), L.exampleProject(), L, E).errors[0].code, 'E_SCHEMA_VERSION');
});

/* ---------- review findings (round 2): N1 to N11 ---------- */
t('N1: the scaled uncertainty never runs away when the loss in use is tiny', () => {
  const p = L.exampleProject(); p.items.wake_int.mode = 'entered'; p.items.wake_int.entered = { L: 0.01, s: 0.5, iav: 0 };
  // 0.01 % is too small to scale from (below 0.5 %); the stored value is the same; the app's default (8 % ± 1.6) is used: 20 % → ± 4
  const x = imp(payload([lossE({ id: 'wake_int', value: 20 })]), p, { rows: { 1: { accept: true } } });
  assert.strictEqual(x.v.rows[0].accept, false);
  assert.strictEqual(x.v.rows[0].res.warnings.find(w => w.code === 'W_S_SCALED').message, 'The report gives no uncertainty for this loss. The uncertainty of the app’s default (1.6 points on a loss of 8 %) is scaled with the loss to 4 points.');
  assert.deepStrictEqual(x.out.items.wake_int.entered, { L: 20, s: 4, iav: 0 });
  // a denormal loss in use writes nothing that is not a number
  p.items.wake_int.entered = { L: 1e-310, s: 0.5, iav: 0.2 };
  const y = imp(payload([lossE({ id: 'wake_int', value: 20 })]), p, { rows: { 1: { accept: true } } });
  ['L', 's', 'iav'].forEach(f => assert.ok(Number.isFinite(y.out.items.wake_int.entered[f]), f));
  assert.ok(Number.isFinite(E.evaluate(y.out, L).H[10].sigma));
  // a large scaled value is capped at 10 points and flagged
  const q = L.exampleProject();   // grid curtailment 3 % ± 2
  const z = imp(payload([lossE({ id: 'cur_grid', value: 30 })]), q, { rows: { 1: { accept: true } } });
  assert.strictEqual(z.v.rows[0].accept, false);
  assert.strictEqual(z.v.rows[0].res.warnings.find(w => w.code === 'W_S_CAP').message, 'That would be 20 points, which is more than 10 points, so 10 points is used; check it.');
  assert.strictEqual(z.out.items.cur_grid.entered.s, 10);
  assert.ok(z.out.items.cur_grid.entered.iav <= 10);
  // a loss in use below 0.5 % with a default below 0.5 % too: half the report's loss
  const h = imp(payload([lossE({ id: 'tp_hyst', value: 2 })]), L.exampleProject(), { rows: { 1: { accept: true } } });
  assert.ok(allCodes(h.v.rows[0]).includes('W_S_HALF')); assert.strictEqual(h.out.items.tp_hyst.entered.s, 1);
});

t('N2: a loss on an item in use at 0 % gets an uncertainty and needs a look', () => {
  const p = L.exampleProject(); assert.strictEqual(E.evaluate(p, L).model.items.find(i => i.id === 'env_icing').L, 0);
  const x = imp(payload([lossE({ id: 'env_icing', value: 3 })]), p, { rows: { 1: { accept: true } } });
  assert.strictEqual(x.v.rows[0].accept, false); assert.ok(allCodes(x.v.rows[0]).includes('W_S_HALF'));
  assert.deepStrictEqual(x.out.items.env_icing.entered, { L: 3, s: 1.5, iav: 0 });
  // exposure is in use at 0 % ± 0.2 and its default is 0.2 % ± 0.3: both below 0.5 %, so half the loss
  const y = imp(payload([lossE({ id: 'env_exposure', value: 3 })]), p, { rows: { 1: { accept: true } } });
  assert.strictEqual(y.v.rows[0].accept, false); assert.strictEqual(y.out.items.env_exposure.entered.s, 1.5);
});

t('N3: in a wind-only or solar-only project, items shared in a hybrid can be covered', () => {
  const w = imp(payload([lossE({ id: 'av_wtg', value: 96, stated_as: 'efficiency', covers: ['av_bop', 'av_grid'] }), lossE({ id: 'el_eff', value: 2.5, covers: ['el_export'] })]), L.exampleProject());
  assert.deepStrictEqual(w.v.rows[0].res.covers.map(c => c.id), ['av_bop', 'av_grid']);
  assert.deepStrictEqual(w.v.rows[1].res.covers.map(c => c.id), ['el_export']);
  ['av_bop', 'av_grid', 'el_export'].forEach(id => assert.strictEqual(w.out.items[id].mode, 'none', id));
  const s = imp(payload([lossE({ id: 'pv_avail', value: 1.5, covers: ['av_grid'] }), lossE({ id: 'ac_loss', value: 1.5, covers: ['el_export'] })], { report: { technology: 'solar' } }), L.solarExampleProject());
  assert.deepStrictEqual(s.v.rows.map(r => r.res.covers.map(c => c.id)), [['av_grid'], ['el_export']]);
  // in a hybrid, a wind item still cannot cover a shared item
  const h = imp(payload([lossE({ id: 'av_wtg', value: 96, stated_as: 'efficiency', covers: ['av_grid'] })], { report: { technology: 'hybrid' } }), L.hybridExampleProject());
  assert.deepStrictEqual(h.v.rows[0].res.covers, []); assert.ok(allCodes(h.v.rows[0]).includes('W_COVERS_GROUP'));
  // the prompt says what can and cannot go together
  assert.ok(R.buildPrompt('wind', L, L.exampleProject()).includes('Year-to-year variability and climate change are never inside one figure: give them separately.'));
});

t('N4: the losses that break the report’s sign convention are flagged and read as gains; the others are not', () => {
  const sol = L.solarExampleProject();
  // losses positive, one gain written as negative
  const v = check([lossE({ id: 'soiling', value: 2 }), lossE({ id: 'iam', value: 2.6 }), lossE({ id: 'temperature', value: 5 }), lossE({ id: 'mismatch', value: 1 }), lossE({ id: 'spectral', value: -0.5 })], sol);
  v.rows.slice(0, 4).forEach(r => { assert.ok(!allCodes(r).includes('W_SIGN_MIXED') && !allCodes(r).includes('W_SIGN_GAIN'), 'row ' + r.n); });
  assert.deepStrictEqual(v.rows.slice(0, 4).map(r => r.res.value), [2, 2.6, 5, 1]);
  const g = v.rows[4];
  assert.strictEqual(g.res.value, -0.5); assert.strictEqual(g.accept, false); assert.ok(!allCodes(g).includes('W_NEGATIVE'));
  assert.strictEqual(g.res.warnings.find(w => w.code === 'W_SIGN_GAIN').message, 'The report writes most losses as positive numbers and this one as negative, so it is read as a gain of 0.5 %. Check it.');
  // losses negative (PVsyst style), one gain written as positive
  const n = check([lossE({ id: 'soiling', value: -2 }), lossE({ id: 'iam', value: -2.6 }), lossE({ id: 'temperature', value: -5 }), lossE({ id: 'spectral', value: 0.6 })], sol);
  assert.deepStrictEqual(n.rows.map(r => r.res.value), [2, 2.6, 5, -0.6]);
  n.rows.slice(0, 3).forEach(r => assert.ok(!allCodes(r).includes('W_SIGN_GAIN') && !allCodes(r).includes('W_SIGN_MIXED'), 'row ' + r.n));
  assert.strictEqual(n.rows[3].res.warnings.find(w => w.code === 'W_SIGN_GAIN').message, 'The report writes most losses as negative numbers and this one as positive, so it is read as a gain of 0.6 %. Check it.');
  assert.strictEqual(n.rows[3].accept, false);
  // a value the reviewer typed is not second-guessed
  const e = R.planApply(v, { rows: { 5: { value: 0.5, accept: true } } }, sol, L, E, { at: AT });
  assert.strictEqual(e.rows[4].value, 0.5); assert.ok(!codes(e.rows[4].warnings).includes('W_SIGN_GAIN'));
});

t('N5: whole-plant project values from a part report in a hybrid need a look', () => {
  const hy = L.hybridExampleProject();
  const v = R.validateImport(payload([lossE({ id: 'soiling', value: 2 })], { report: { technology: 'wind' }, project: {
    grid_connection_mw: { value: 92, page: 3, quote: 'grid connection 92 MW' }, lifetime_years: { value: 25, page: 3, quote: 'lifetime 25 years' } } }), hy, L, E);
  assert.ok(v.ok);
  ['grid_connection_mw', 'lifetime_years'].forEach(k => {
    const b = v.basics.find(x => x.key === k);
    assert.ok(b, k); assert.strictEqual(b.accept, false, k); assert.strictEqual(b.check, true, k);
    assert.strictEqual(b.warnings.find(w => w.code === 'W_SHARED_BASIC').message, 'This value is for the whole plant, and this is a wind report. Check that the figure is for the whole plant.');
  });
  // a whole-hybrid report: no flag
  const w = R.validateImport(payload([], { report: { technology: 'hybrid' }, project: { grid_connection_mw: { value: 92, page: 3, quote: 'grid connection 92 MW' } } }), hy, L, E);
  assert.strictEqual(w.basics[0].accept, true);
});

t('N6: the message about the uncertainty follows the decisions', () => {
  const p = L.exampleProject();
  // with an uncertainty row that the reviewer unticks, the loss's uncertainty is scaled, and the row says so
  const v = check([lossE({ id: 'av_wtg', value: 7 }), entry({ id: 'av_wtg', percent_of: 'loss_points', value: 1.5 })], p);
  assert.ok(!allCodes(v.rows[0]).includes('W_S_SCALED'));
  const plan = R.planApply(v, { rows: { 2: { accept: false } } }, p, L, E, { at: AT });
  assert.ok(codes(plan.rows[0].warnings).includes('W_S_SCALED'));
  const out = R.applyImport(p, plan).project;
  assert.deepStrictEqual(out.items.av_wtg.entered, { L: 7, s: 2.4, iav: 2 });
});

t('N7: an item covered by two figures is counted once, and the covering item’s own uncertainty is scaled', () => {
  const p = L.exampleProject();   // wake_int 9.2 ± 1.84, wake_ext 0 ± 0.2, blockage 1.5 ± 1
  const x = imp(payload([lossE({ id: 'wake_int', value: 12, covers: ['wake_ext'] }), lossE({ id: 'blockage', value: 2, covers: ['wake_ext'] })]), p);
  assert.deepStrictEqual(x.v.rows.map(r => r.accept), [true, true]);
  // wake_ext goes into the first figure only: √(1.84² + 0.2²) × 12 / 9.2 = 2.41
  near(x.out.items.wake_int.entered.s, Math.hypot(1.84, 0.2) * 12 / 9.2, 0.006);
  // nothing left for the second: its own uncertainty is scaled, 1 × 2 / 1.5 = 1.33
  assert.strictEqual(x.out.items.blockage.entered.s, 1.33);
  assert.ok(allCodes(x.v.rows[1]).includes('W_S_SCALED') && !allCodes(x.v.rows[1]).includes('W_COVERS_S'));
  // with covers: the group in use is 9.2 + 0 + 1.5 = 10.7 %, ± √(1.84² + 0.2² + 1²); the report's 15 % scales it
  const y = imp(payload([lossE({ id: 'wake_int', value: 15, covers: ['wake_ext', 'blockage'] })]), p);
  near(y.out.items.wake_int.entered.s, Math.hypot(1.84, 0.2, 1) * 15 / 10.7, 0.006);
  // and without covers, the item's own 1.84 × 15 / 9.2 = 3
  const z = imp(payload([lossE({ id: 'wake_int', value: 15, covers: ['wake_ext', 'blockage'] })]), p, { rows: { 1: { covers: false } } });
  assert.strictEqual(z.out.items.wake_int.entered.s, 3);
});

t('N8: the prompt’s own example is never taken for the answer, and a damaged answer says so', () => {
  const prompt = R.buildPrompt('wind', L, L.exampleProject());
  const reply = payload([], { project: { hub_height_m: { value: 140, page: 2, quote: 'hub height 140 m' } } });
  const v = R.validateImport(prompt + '\n\n' + JSON.stringify(reply), L.exampleProject(), L, E);
  assert.ok(v.ok, JSON.stringify(v.errors)); assert.deepStrictEqual(v.rows, []); assert.deepStrictEqual(v.basics.map(b => b.key), ['hub_height_m']);
  // the prompt alone
  const only = R.validateImport(prompt, L.exampleProject(), L, E);
  assert.strictEqual(only.ok, false); assert.strictEqual(only.errors[0].code, 'E_SKELETON');
  assert.strictEqual(only.errors[0].message, 'This is the example from the prompt, not the AI’s answer. Paste the reply the AI gave.');
  // a trailing comma in the answer: the JSON is damaged, not missing its schema
  const good = JSON.stringify(payload([entry({})]), null, 1), bad = good.replace(/(\n\s*\])/, ',$1');
  assert.notStrictEqual(bad, good);
  assert.strictEqual(R.validateImport(bad, L.exampleProject(), L, E).errors[0].code, 'E_BAD_JSON');
});

t('N9 and N10 are covered by the browser check tests/import-ui.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'import-ui.js'), 'utf8');
  ['N9:', 'N10:'].forEach(k => assert.ok(src.includes(k), k));
});

t('N11: rates are written in %/yr in the messages', () => {
  const sol = L.solarExampleProject();   // degradation in use 0.55 %/yr ± 0.25
  const v = check([lossE({ id: 'degradation', value: 0.45, unit: '%/yr' })], sol);
  assert.strictEqual(v.rows[0].res.warnings.find(w => w.code === 'W_S_SCALED').message, 'The report gives no uncertainty for this loss. The uncertainty in use (0.25 %/yr on a loss of 0.55 %/yr) is scaled with the loss to 0.2 %/yr.');
  assert.strictEqual(R.applyImport(sol, R.planApply(v, null, sol, L, E, { at: AT })).project.items.degradation.entered.s, 0.2);
});

/* ---------- review findings (round 3): R-A to R-H ---------- */
t('R-A: the sign convention comes from the report alone: editing or ticking rows does not change how the others are read', () => {
  const sol = L.solarExampleProject();
  const v = check([lossE({ id: 'soiling', value: -2 }), lossE({ id: 'iam', value: -2.6 }), lossE({ id: 'temperature', value: -5 }), lossE({ id: 'mismatch', value: -1 }), lossE({ id: 'spectral', value: 0.3 }), lossE({ id: 'low_light', value: 0.4 })], sol);
  assert.deepStrictEqual(v.rows.map(r => r.res.value), [2, 2.6, 5, 1, -0.3, -0.4]);
  // the reviewer ticks both gains and retypes two of the losses
  const plan = R.planApply(v, { rows: { 5: { accept: true }, 6: { accept: true }, 2: { value: 2.6, accept: true }, 3: { value: 5, accept: true } } }, sol, L, E, { at: AT });
  assert.deepStrictEqual(plan.rows.map(r => r.value), [2, 2.6, 5, 1, -0.3, -0.4]);
  assert.deepStrictEqual(plan.rows.map(r => r.accept), [true, true, true, true, true, true]);
  [4, 5].forEach(i => assert.ok(codes(plan.rows[i].warnings).includes('W_SIGN_GAIN'), 'row ' + (i + 1)));
  assert.ok(!codes(plan.rows[0].warnings).includes('W_SIGN_GAIN'));
  const out = R.applyImport(sol, plan).project;
  assert.strictEqual(out.items.spectral.entered.L, -0.3); assert.strictEqual(out.items.low_light.entered.L, -0.4); assert.strictEqual(out.items.soiling.entered.L, 2);
  // a value the reviewer typed is taken as typed, and the others keep their reading
  const typed = R.planApply(v, { rows: { 5: { value: 0.3, accept: true } } }, sol, L, E, { at: AT });
  assert.strictEqual(typed.rows[4].value, 0.3); assert.strictEqual(typed.rows[5].value, -0.4);
  // choosing another item for a row does not change the vote either
  const remap = R.planApply(v, { rows: { 1: { id: 'dc_wiring' } } }, sol, L, E, { at: AT });
  assert.deepStrictEqual(remap.rows.map(r => r.value), [2, 2.6, 5, 1, -0.3, -0.4]);
});

t('R-B: a row that ends up unticked does not stop a figure that includes it from excluding it', () => {
  const p = L.exampleProject();   // el_parasitic in use 0.2 % (default 0.2 %): no uncertainty to scale from, so the row needs a look
  const pl = payload([lossE({ id: 'el_parasitic', value: 0.3 }), lossE({ id: 'el_eff', value: 2.5, covers: ['el_parasitic'] })]);
  const x = imp(pl, p);
  assert.deepStrictEqual(x.v.rows.map(r => r.accept), [false, true]);
  assert.ok(!allCodes(x.v.rows[1]).includes('W_COVERS_SET'));
  assert.deepStrictEqual(x.v.rows[1].res.covers.map(c => c.id), ['el_parasitic']);
  assert.strictEqual(x.out.items.el_parasitic.mode, 'none');
  // ticked by hand: it keeps its own value and is not excluded
  const y = imp(pl, p, { rows: { 1: { accept: true } } });
  assert.ok(codes(y.plan.rows[1].warnings).includes('W_COVERS_SET'));
  assert.strictEqual(y.out.items.el_parasitic.mode, 'entered'); assert.strictEqual(y.out.items.el_parasitic.entered.L, 0.3);
});

t('R-C: a figure that ends up unticked does not take a covered item away from a later figure', () => {
  const p = L.exampleProject();   // av_grid 1 ± 0.7, av_bop 0.5 ± 0.3, av_wtg 3.5 ± 1.2
  const x = imp(payload([lossE({ id: 'av_grid', value: 20, covers: ['av_bop'] }), lossE({ id: 'av_wtg', value: 4, covers: ['av_bop'] })]), p);
  assert.deepStrictEqual(x.v.rows.map(r => r.accept), [false, true]);   // the first is capped, so it needs a look
  // av_bop goes into the second figure: √(1.2² + 0.3²) × 4 / 4 = 1.24
  near(x.out.items.av_wtg.entered.s, Math.hypot(1.2, 0.3), 0.006);
  assert.ok(allCodes(x.v.rows[1]).includes('W_COVERS_S'));
  assert.strictEqual(x.out.items.av_bop.mode, 'none');
  assert.strictEqual(x.out.items.av_grid.mode, p.items.av_grid.mode);
});

t('R-D: an uncertainty scaled far from the loss it came from needs a look', () => {
  const p = L.exampleProject();   // grid curtailment 3 % ± 2
  const up = check([lossE({ id: 'cur_grid', value: 8 })], p);
  assert.strictEqual(up.rows[0].accept, false);
  assert.strictEqual(up.rows[0].res.warnings.find(w => w.code === 'W_S_FAR').message, 'The report’s loss is 2.67 times the one the uncertainty comes from, so the scaled uncertainty is an extrapolation; check it.');
  assert.deepStrictEqual(R.applyImport(p, R.planApply(up, { rows: { 1: { accept: true } } }, p, L, E, { at: AT })).project.items.cur_grid.entered, { L: 8, s: 5.33, iav: 4 });
  const down = check([lossE({ id: 'cur_grid', value: 1.2 })], p);
  assert.strictEqual(down.rows[0].accept, false);
  assert.strictEqual(down.rows[0].res.warnings.find(w => w.code === 'W_S_FAR').message, 'The report’s loss is 0.4 times the one the uncertainty comes from, so the scaled uncertainty is an extrapolation; check it.');
  // within a factor of 2 either way: no flag
  [1.5, 6].forEach(x => { const r = check([lossE({ id: 'cur_grid', value: x })], p).rows[0]; assert.strictEqual(r.accept, true, String(x)); assert.ok(!allCodes(r).includes('W_S_FAR'), String(x)); });
});

t('R-G: an answer whose first item kept the placeholder id is read, not refused as the prompt’s example', () => {
  const p = L.exampleProject();
  const a = R.validateImport(payload([entry({ id: 'an id from the list' }), entry({ id: 'mcp', value: 2.2 })]), p, L, E);
  assert.ok(a.ok, codes(a.errors).join()); assert.deepStrictEqual(codes(a.rows[0].res.errors), ['R_ID_UNKNOWN']); assert.strictEqual(a.rows[1].res.value, 2.2);
  const b = R.validateImport(payload([entry({ id: 'an id from the list', label: 'Flow model' })]), p, L, E);
  assert.ok(b.ok, codes(b.errors).join());
});

t('R-H: rows marked "unknown" count for the report’s sign convention, and are not changed by it', () => {
  const sol = L.solarExampleProject();
  const v = check([lossE({ id: 'iam', value: -2.6, stated_as: 'unknown' }), lossE({ id: 'temperature', value: -5, stated_as: 'unknown' }), lossE({ id: 'mismatch', value: -1, stated_as: 'unknown' }),
    lossE({ id: 'soiling', value: -2 }), lossE({ id: 'spectral', value: 0.3 }), lossE({ id: 'low_light', value: 0.4 })], sol);
  assert.deepStrictEqual(v.rows.map(r => r.res.value), [2.6, 5, 1, 2, -0.3, -0.4]);
  [4, 5].forEach(i => { assert.ok(allCodes(v.rows[i]).includes('W_SIGN_GAIN'), 'row ' + (i + 1)); assert.strictEqual(v.rows[i].accept, false); });
  [0, 1, 2].forEach(i => assert.ok(!allCodes(v.rows[i]).includes('W_SIGN_GAIN') && !allCodes(v.rows[i]).includes('W_SIGN_MIXED'), 'row ' + (i + 1)));
});

t('R-E is covered by the browser check tests/import-ui.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'import-ui.js'), 'utf8');
  assert.ok(src.includes('R-E:'));
});

/* ---------- review findings (round 4): S1 to S3 ---------- */
const signCodes = r => allCodes(r).filter(c => c === 'W_SIGN_GAIN' || c === 'W_SIGN_MIXED');
t('S1: only the PV loss diagram has a sign convention: wind, availability, curtailment and export losses are never read as gains', () => {
  // a hybrid report: wind losses written as positive numbers, the PV loss diagram as negative numbers
  const hy = L.hybridExampleProject();
  const h = check([['wake_int', 9], ['blockage', 1.5], ['av_wtg', 3], ['el_eff', 2], ['soiling', -2], ['iam', -2.6], ['temperature', -6], ['mismatch', -1], ['inverter', -1.6]].map(([id, value]) => lossE({ id, value })), hy, { report: { technology: 'hybrid' } });
  assert.deepStrictEqual(h.rows.map(r => r.res.value), [9, 1.5, 3, 2, 2, 2.6, 6, 1, 1.6]);
  h.rows.forEach(r => assert.deepStrictEqual(signCodes(r), [], 'row ' + r.n));
  // a solar report: the PV loss diagram in negative numbers, and a separate table of plant losses in positive numbers
  const sol = L.solarExampleProject();
  const s = check([['soiling', -2], ['iam', -2.6], ['temperature', -5], ['mismatch', -2], ['inverter', -1.8], ['ac_loss', -0.5], ['pv_avail', 1], ['av_grid', 0.5], ['cur_grid', 0.3], ['el_export', 1]].map(([id, value]) => lossE({ id, value })), sol, { report: { technology: 'solar' } });
  assert.deepStrictEqual(s.rows.map(r => r.res.value), [2, 2.6, 5, 2, 1.8, 0.5, 1, 0.5, 0.3, 1]);
  s.rows.forEach(r => assert.deepStrictEqual(signCodes(r), [], 'row ' + r.n));
  // a gain inside the diagram is still found, and a positive plant loss next to it is left alone
  const g = check([lossE({ id: 'soiling', value: -2 }), lossE({ id: 'iam', value: -2.6 }), lossE({ id: 'temperature', value: -5 }), lossE({ id: 'spectral', value: 0.3 }), lossE({ id: 'pv_avail', value: 1 }), lossE({ id: 'cur_grid', value: 0.3 })], sol, { report: { technology: 'solar' } });
  assert.deepStrictEqual(g.rows.map(r => r.res.value), [2, 2.6, 5, -0.3, 1, 0.3]);
  assert.deepStrictEqual(g.rows.map(r => signCodes(r).join()), ['', '', '', 'W_SIGN_GAIN', '', '']);
  // plant losses do not vote either: three positive plant losses do not outvote a diagram of two negative losses
  const v = check([lossE({ id: 'soiling', value: -2 }), lossE({ id: 'iam', value: -2.6 }), lossE({ id: 'pv_avail', value: 1 }), lossE({ id: 'av_grid', value: 0.5 }), lossE({ id: 'cur_grid', value: 0.3 })], sol, { report: { technology: 'solar' } });
  assert.deepStrictEqual(v.rows.map(r => r.res.value), [2, 2.6, 1, 0.5, 0.3]);
  v.rows.forEach(r => assert.deepStrictEqual(signCodes(r), [], 'row ' + r.n));
});

t('S2: two figures that include the same items always end in a state that matches the ticks shown', () => {
  const p = L.exampleProject();
  const applied = (pl, dec) => R.applyImport(p, R.planApply(R.validateImport(pl, p, L, E), dec, p, L, E, { at: AT })).project;
  // total availability that includes the turbines, next to a turbine availability of its own: the ticks used to go round in circles
  const pl = payload([lossE({ id: 'av_grid', value: 2, covers: ['av_wtg', 'av_bop'] }), lossE({ id: 'av_wtg', value: 7.5, covers: ['av_bop'] })]);
  const v = R.validateImport(pl, p, L, E);
  const left = v.rows.filter(r => allCodes(r).includes('W_UNSETTLED'));
  assert.strictEqual(left.length, 1);
  assert.strictEqual(left[0].accept, false);
  assert.strictEqual(left[0].res.warnings.find(w => w.code === 'W_UNSETTLED').message, 'This figure and others include the same items, and the app cannot settle which to use. This one is left out; tick it if it is the one to use.');
  assert.strictEqual(left[0].res.check, true);   // so that "Tick all that are ready" leaves it alone
  // what is applied by default is what the same ticks give when they are set by hand
  const same = pl2 => { const w = R.validateImport(pl2, p, L, E); const dec = { rows: {} }; w.rows.forEach(r => { dec.rows[r.n] = { accept: r.accept }; }); assert.deepStrictEqual(applied(pl2, null), applied(pl2, dec)); return w; };
  same(pl);
  // a sweep over figures that include each other
  const ids = ['av_grid', 'av_wtg', 'av_bop'], vals = [0.3, 2, 7.5, 20];
  let n = 0;
  ids.forEach(a => ids.forEach(b => { if (a === b) return; vals.forEach(x => vals.forEach(y => {
    same(payload([lossE({ id: a, value: x, covers: ids.filter(i => i !== a) }), lossE({ id: b, value: y, covers: ids.filter(i => i !== a && i !== b) })])); n++;
  })); }));
  assert.strictEqual(n, 96);
  // a pair that settles on its own is not flagged
  const calm = R.validateImport(payload([lossE({ id: 'av_wtg', value: 3.5, covers: ['av_bop'] }), lossE({ id: 'av_grid', value: 1 })]), p, L, E);
  calm.rows.forEach(r => assert.ok(!allCodes(r).includes('W_UNSETTLED'), 'row ' + r.n));
});

t('S3 is covered by the browser check tests/import-ui.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'import-ui.js'), 'utf8');
  assert.ok(src.includes('S3:'));
});

/* ---------- review findings (round 5): T1 to T3 ---------- */
t('T1: outside the PV loss diagram a loss with the less common sign is flagged, and its value is not changed', () => {
  const p = L.exampleProject();
  const odd = r => r.res.warnings.find(w => w.code === 'W_SIGN_ODD');
  // a wind report that writes losses as negative numbers, and one positive figure (a power-curve gain the AI called a loss)
  const a = check([lossE({ id: 'wake_int', value: -9 }), lossE({ id: 'av_wtg', value: -3 }), lossE({ id: 'el_eff', value: -2 }), lossE({ id: 'tp_site_pc', value: 0.8 })], p);
  assert.deepStrictEqual(a.rows.map(r => r.res.value), [9, 3, 2, 0.8]);
  assert.strictEqual(a.rows[3].accept, false);
  assert.strictEqual(odd(a.rows[3]).message, 'Most losses in this report are written as negative numbers and this one as positive. It is read as a loss of 0.8 %. If it is a gain, type it as a negative number.');
  a.rows.slice(0, 3).forEach(r => { assert.ok(!odd(r), 'row ' + r.n); assert.deepStrictEqual(signCodes(r), [], 'row ' + r.n); });
  // the same report written the other way round
  const b = check([lossE({ id: 'wake_int', value: 9 }), lossE({ id: 'av_wtg', value: 3 }), lossE({ id: 'el_eff', value: 2 }), lossE({ id: 'tp_site_pc', value: -0.8 })], p);
  assert.deepStrictEqual(b.rows.map(r => r.res.value), [9, 3, 2, 0.8]);
  assert.strictEqual(b.rows[3].accept, false);
  assert.strictEqual(odd(b.rows[3]).message, 'Most losses in this report are written as positive numbers and this one as negative. It is read as a loss of 0.8 %. If it is a gain, type it as a negative number.');
  // the reviewer types the gain: taken as typed, no flag
  const plan = R.planApply(b, { rows: { 4: { value: -0.8, accept: true } } }, p, L, E, { at: AT });
  assert.strictEqual(plan.rows[3].value, -0.8); assert.ok(!codes(plan.rows[3].warnings).includes('W_SIGN_ODD'));
  // one each way: both are flagged
  const tie = check([lossE({ id: 'wake_int', value: -9 }), lossE({ id: 'tp_site_pc', value: 0.8 })], p);
  tie.rows.forEach(r => { assert.ok(allCodes(r).includes('W_SIGN_MIXED'), 'row ' + r.n); assert.strictEqual(r.accept, false); });
  assert.deepStrictEqual(tie.rows.map(r => r.res.value), [9, 0.8]);
  // in a hybrid the wind losses, the solar plant losses and the shared losses are counted separately, and the diagram does not count here
  const hy = L.hybridExampleProject();
  const h = check([['wake_int', 9], ['av_wtg', 3], ['el_eff', 2], ['soiling', -2], ['iam', -2.6], ['temperature', -6]].map(([id, value]) => lossE({ id, value })), hy, { report: { technology: 'hybrid' } });
  h.rows.forEach(r => { assert.ok(!odd(r), 'row ' + r.n); assert.deepStrictEqual(signCodes(r), [], 'row ' + r.n); });
});

t('T2: the plane-of-array items are part of the PV loss diagram', () => {
  const sol = L.solarExampleProject();
  // far horizon (plane of array), soiling and IAM are negative: three losses, so the positive spectral figure is the gain
  const a = check([lossE({ id: 'horizon_far', value: -0.4 }), lossE({ id: 'soiling', value: -2 }), lossE({ id: 'iam', value: -2.6 }), lossE({ id: 'spectral', value: 0.3 })], sol, { report: { technology: 'solar' } });
  assert.deepStrictEqual(a.rows.map(r => r.res.value), [0.4, 2, 2.6, -0.3]);
  assert.deepStrictEqual(a.rows.map(r => signCodes(r).join()), ['', '', '', 'W_SIGN_GAIN']);
});

t('T3 is covered by the browser check tests/import-ui.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'import-ui.js'), 'utf8');
  assert.ok(src.includes('T3:'));
});

/* ---------- review findings (round 6): U1 to U6 ---------- */
t('U1: a gain or an odd sign in a report that gives fractions is read in percent', () => {
  const sol = L.solarExampleProject(), p = L.exampleProject();
  const a = check([lossE({ id: 'soiling', value: 0.02, unit: 'fraction' }), lossE({ id: 'temperature', value: 0.05, unit: 'fraction' }), lossE({ id: 'low_light', value: -0.003, unit: 'fraction' }), lossE({ id: 'iam', value: 0.026, unit: 'fraction' })], sol, { report: { technology: 'solar' } });
  assert.deepStrictEqual(a.rows.map(r => r.res.value), [2, 5, -0.3, 2.6]);
  assert.strictEqual(a.rows[2].res.warnings.find(w => w.code === 'W_SIGN_GAIN').message, 'The report writes most losses as positive numbers and this one as negative, so it is read as a gain of 0.3 %. Check it.');
  const b = check([lossE({ id: 'wake_int', value: 0.09, unit: 'fraction' }), lossE({ id: 'av_wtg', value: 0.03, unit: 'fraction' }), lossE({ id: 'tp_site_pc', value: -0.008, unit: 'fraction' })], p);
  assert.deepStrictEqual(b.rows.map(r => r.res.value), [9, 3, 0.8]);
  assert.strictEqual(b.rows[2].res.warnings.find(w => w.code === 'W_SIGN_ODD').message, 'Most losses in this report are written as positive numbers and this one as negative. It is read as a loss of 0.8 %. If it is a gain, type it as a negative number.');
});

t('U2: plant losses written the way the PV loss diagram is written are not flagged', () => {
  const sol = L.solarExampleProject();
  const flags = r => allCodes(r).filter(c => c === 'W_SIGN_GAIN' || c === 'W_SIGN_MIXED' || c === 'W_SIGN_ODD');
  const diagram = [['soiling', -2], ['iam', -2.6], ['temperature', -5]];
  const run = extra => check(diagram.concat(extra).map(([id, value]) => lossE({ id, value })), sol, { report: { technology: 'solar' } });
  // the diagram runs on to AC losses and auxiliaries (negative); a separate table gives plant losses as positive numbers
  [[['ac_loss', -0.6], ['pv_aux', -0.2], ['pv_avail', 1], ['av_grid', 0.5], ['el_export', 1], ['cur_grid', 0.3]],
   [['ac_loss', -0.6], ['pv_aux', -0.2], ['el_export', -1], ['pv_avail', 1], ['av_grid', 0.5], ['cur_grid', 0.3]],
   [['ac_loss', -0.6], ['pv_aux', -0.2], ['pv_avail', 1]]].forEach((extra, k) => {
    const v = run(extra);
    v.rows.forEach(r => assert.deepStrictEqual(flags(r), [], 'case ' + k + ' row ' + r.n));
    assert.deepStrictEqual(v.rows.map(r => r.res.value), diagram.concat(extra).map(x => Math.abs(x[1])), 'case ' + k);
  });
  // without a diagram to go by, the plain count applies
  const w = check([['ac_loss', -0.6], ['pv_avail', 1], ['av_grid', 0.5]].map(([id, value]) => lossE({ id, value })), sol, { report: { technology: 'solar' } });
  assert.deepStrictEqual(w.rows.map(r => flags(r).join()), ['W_SIGN_ODD', '', '']);
});

t('U3: rows that cannot be imported into this project do not count for the sign convention', () => {
  const p = L.exampleProject();
  const v = check([lossE({ id: 'wake_int', value: 9 }), lossE({ id: 'tp_site_pc', value: -0.8 }), lossE({ id: 'ac_loss', value: -1 }), lossE({ id: 'pv_avail', value: -1 }), lossE({ id: 'pv_aux', value: -1 })], p);
  assert.ok(v.rows[2].res.errors.length && v.rows[3].res.errors.length && v.rows[4].res.errors.length);
  [0, 1].forEach(i => { assert.ok(allCodes(v.rows[i]).includes('W_SIGN_MIXED'), 'row ' + (i + 1)); assert.ok(!allCodes(v.rows[i]).includes('W_SIGN_ODD'), 'row ' + (i + 1)); assert.strictEqual(v.rows[i].accept, false); });
});

t('U4: in a hybrid the sign count is taken per plant', () => {
  const hy = L.hybridExampleProject();
  const v = check([['wake_int', 9], ['av_wtg', 3], ['el_eff', 2], ['pv_avail', -1], ['ac_loss', -0.5]].map(([id, value]) => lossE({ id, value })), hy, { report: { technology: 'hybrid' } });
  v.rows.forEach(r => ['W_SIGN_ODD', 'W_SIGN_MIXED', 'W_SIGN_GAIN'].forEach(c => assert.ok(!allCodes(r).includes(c), 'row ' + r.n + ' ' + c)));
  assert.deepStrictEqual(v.rows.map(r => r.res.value), [9, 3, 2, 1, 0.5]);
});

t('U5 and U6 are covered by the browser check tests/import-ui.js', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, 'import-ui.js'), 'utf8');
  ['U5:', 'U6:'].forEach(k => assert.ok(src.includes(k), k));
});

/* ---------- review findings (round 7): V1 to V3 ---------- */
t('V1: a minority in the PV loss diagram is read as gains only when it can be gains and the losses clearly outnumber it', () => {
  const sol = L.solarExampleProject();
  const run = list => check(list.map(([id, value]) => lossE({ id, value })), sol, { report: { technology: 'solar' } });
  const sc = r => allCodes(r).filter(c => c === 'W_SIGN_GAIN' || c === 'W_SIGN_MIXED').join();
  // more gains than losses were taken from the diagram: nothing is turned round, the diagram rows all need a look
  const a = run([['temperature', -5], ['spectral', 0.3], ['low_light', 0.5], ['ac_loss', -0.6], ['pv_avail', 1]]);
  assert.deepStrictEqual(a.rows.map(r => r.res.value), [5, 0.3, 0.5, 0.6, 1]);
  assert.deepStrictEqual(a.rows.map(sc), ['W_SIGN_MIXED', 'W_SIGN_MIXED', 'W_SIGN_MIXED', '', '']);
  assert.deepStrictEqual(a.rows.slice(0, 3).map(r => r.accept), [false, false, false]);
  const b = run([['iam', 2.6], ['spectral', -0.3], ['low_light', -0.5], ['pv_avail', 1], ['av_grid', 0.5]]);
  assert.deepStrictEqual(b.rows.map(r => r.res.value), [2.6, 0.3, 0.5, 1, 0.5]);
  assert.deepStrictEqual(b.rows.map(sc), ['W_SIGN_MIXED', 'W_SIGN_MIXED', 'W_SIGN_MIXED', '', '']);
  assert.deepStrictEqual(b.rows.slice(0, 3).map(r => r.accept), [false, false, false]);
  // the odd one out is an item that cannot be a gain: not turned round
  const c = run([['soiling', -2], ['iam', -2.6], ['temperature', -5], ['mismatch', -1], ['shading_near', 1]]);
  assert.deepStrictEqual(c.rows.map(r => r.res.value), [2, 2.6, 5, 1, 1]);
  c.rows.forEach(r => { assert.strictEqual(sc(r), 'W_SIGN_MIXED', 'row ' + r.n); assert.strictEqual(r.accept, false, 'row ' + r.n); });
  // three losses against two gains is not clear enough; four against two is
  const d = run([['soiling', -2], ['iam', -2.6], ['mismatch', -1], ['spectral', 0.3], ['low_light', 0.4]]);
  assert.deepStrictEqual(d.rows.map(r => r.res.value), [2, 2.6, 1, 0.3, 0.4]);
  d.rows.forEach(r => assert.strictEqual(sc(r), 'W_SIGN_MIXED', 'row ' + r.n));
  const e = run([['soiling', -2], ['iam', -2.6], ['mismatch', -1], ['inverter', -1.6], ['spectral', 0.3], ['low_light', 0.4]]);
  assert.deepStrictEqual(e.rows.map(r => r.res.value), [2, 2.6, 1, 1.6, -0.3, -0.4]);
  assert.deepStrictEqual(e.rows.map(sc), ['', '', '', '', 'W_SIGN_GAIN', 'W_SIGN_GAIN']);
  // temperature can be a gain (a cold site)
  const f = run([['soiling', 2], ['iam', 2.6], ['mismatch', 1], ['temperature', -0.8]]);
  assert.deepStrictEqual(f.rows.map(r => r.res.value), [2, 2.6, 1, -0.8]);
});

t('V2: solar rows in a wind project, and the PV diagram in a hybrid, do not hide a wind figure with the odd sign', () => {
  const odd = r => allCodes(r).includes('W_SIGN_ODD');
  // wind project: four PV diagram ids written negative cannot be imported and must not set a convention
  const w = check([['soiling', -2], ['iam', -2.6], ['temperature', -5], ['mismatch', -1], ['wake_int', 9], ['av_wtg', 3], ['tp_site_pc', -0.8]].map(([id, value]) => lossE({ id, value })), L.exampleProject());
  assert.ok(odd(w.rows[6])); assert.strictEqual(w.rows[6].accept, false);
  // hybrid: the diagram's sign applies to the solar plant's rows only
  const h = check([['soiling', -2], ['iam', -2.6], ['temperature', -5], ['wake_int', 9], ['av_wtg', 3], ['tp_site_pc', -0.8]].map(([id, value]) => lossE({ id, value })), L.hybridExampleProject(), { report: { technology: 'hybrid' } });
  assert.ok(odd(h.rows[5])); assert.strictEqual(h.rows[5].accept, false);
});

console.log(`\n${pass} passed`);
