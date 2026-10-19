/* WattOdds — energy yield uncertainty, source to meter.
   Copyright 2026 Nithish Seenivasagam (coderenewables.com)
   SPDX-License-Identifier: Apache-2.0 */
/* Calculation core. Pure functions, no DOM.
   Units: wind speed m/s, power MW, energy GWh/yr, uncertainties in percent (1.5 = 1.5 %). */
const Engine = (() => {
  'use strict';

  const Z = { P50: 0, P75: 0.6744898, P90: 1.2815516, P95: 1.6448536, P99: 2.3263479 };
  const PLEVELS = ['P50', 'P75', 'P90', 'P95', 'P99'];

  /* ---------- maths helpers ---------- */
  const LANCZOS = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
  function gamma(x) {
    if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gamma(1 - x));
    x -= 1;
    let a = LANCZOS[0];
    const t = x + 7.5;
    for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
    return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const num = (x, d = 0) => (typeof x === 'number' && isFinite(x) ? x : (x === '' || x == null ? d : (isFinite(+x) ? +x : d)));

  function cholesky(M) {
    const n = M.length, L = M.map(() => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = 0; j <= i; j++) {
        let s = M[i][j];
        for (let k = 0; k < j; k++) s -= L[i][k] * L[j][k];
        if (i === j) { if (s <= 1e-12) return null; L[i][j] = Math.sqrt(s); }
        else L[i][j] = s / L[j][j];
      }
    }
    return L;
  }

  /* Seeded RNG (mulberry32) with Box–Muller normals */
  function rng(seed) {
    let a = seed >>> 0, spare = null;
    const u = () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const n = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let x, y, r;
      do { x = 2 * u() - 1; y = 2 * u() - 1; r = x * x + y * y; } while (r === 0 || r >= 1);
      const f = Math.sqrt(-2 * Math.log(r) / r);
      spare = y * f; return x * f;
    };
    return { u, n };
  }

  /* Weibull shape/scale from mean and standard deviation (method of moments) */
  function weibullFromMoments(mean, sd) {
    if (!(mean > 0) || !(sd > 0)) return null;
    const cv2 = (sd / mean) ** 2;
    const f = b => gamma(1 + 2 / b) / gamma(1 + 1 / b) ** 2 - 1 - cv2;
    let lo = 0.25, hi = 40;
    if (f(hi) > 0) return { k: hi, lambda: mean / gamma(1 + 1 / hi) };
    for (let i = 0; i < 80; i++) { const m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
    const k = 0.5 * (lo + hi);
    return { k, lambda: mean / gamma(1 + 1 / k) };
  }

  /* ---------- air density, power curve, energy ---------- */
  function airDensity(elevation, tempC) {
    const p = 101325 * Math.pow(1 - 2.25577e-5 * num(elevation), 5.25588);
    return p / (287.05 * (num(tempC, 15) + 273.15));
  }

  function genericCurve(plant, rho) {
    const D = num(plant.rotorD, 150), Pr = num(plant.ratedMW, 3), cp = 0.46, m = 8;
    const area = Math.PI * D * D / 4;
    const cutIn = num(plant.cutIn, 3), cutOut = num(plant.cutOut, 25);
    return v => {
      if (v < cutIn || v > cutOut) return 0;
      const pa = 0.5 * rho * area * cp * v * v * v / 1e6;
      if (pa <= 0) return 0;
      return Math.pow(Math.pow(pa, -m) + Math.pow(Pr, -m), -1 / m);
    };
  }

  function parseCurve(text) {
    const pts = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const parts = line.trim().split(/[\s,;\t]+/).map(Number);
      if (parts.length >= 2 && isFinite(parts[0]) && isFinite(parts[1])) pts.push([parts[0], parts[1]]);
    });
    pts.sort((a, b) => a[0] - b[0]);
    return pts;
  }

  function customCurve(pts, rhoRef, rho) {
    const ratio = Math.cbrt(rho / (num(rhoRef, 1.225) || 1.225));
    return v => {
      const ve = v * ratio;
      if (!pts.length || ve < pts[0][0] || ve > pts[pts.length - 1][0]) return 0;
      for (let i = 1; i < pts.length; i++) {
        if (ve <= pts[i][0]) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          return (y0 + (y1 - y0) * (ve - x0) / ((x1 - x0) || 1)) / 1000;
        }
      }
      return pts[pts.length - 1][1] / 1000;
    };
  }

  function curveFor(project) {
    const rho = project.site.rhoMode === 'entered' ? num(project.site.rho, 1.225) : airDensity(project.site.elevation, project.site.tempC);
    const pl = project.plant;
    if (pl.curveMode === 'custom') {
      const pts = parseCurve(pl.curveText);
      if (pts.length >= 4) return { fn: customCurve(pts, pl.curveRho, rho), rho, kind: 'custom', points: pts.length };
    }
    return { fn: genericCurve(pl, rho), rho, kind: 'generic', points: 0 };
  }

  /* Mean power (MW) of one turbine for a Weibull climate with the mean wind speed scaled by `scale` */
  function meanPower(curve, meanWs, k, scale = 1) {
    const A = meanWs * scale / gamma(1 + 1 / k);
    const dv = 0.05, vmax = 40;
    let s = 0;
    for (let v = dv / 2; v < vmax; v += dv) {
      const x = v / A;
      const f = (k / A) * Math.pow(x, k - 1) * Math.exp(-Math.pow(x, k));
      s += f * curve(v) * dv;
    }
    return s;
  }

  /* ---------- technology helpers ---------- */
  const techOf = project => (project && (project.tech === 'solar' || project.tech === 'hybrid') ? project.tech : 'wind');
  const forTech = (def, tech) => (tech === 'hybrid' ? (def.tech === 'both' || def.tech === 'hybrid') : ((def.tech || 'wind') === tech || def.tech === 'both'));
  /* where an item sits in a hybrid project's chain */
  function hybridStageOf(def) {
    const t = def.tech || 'wind';
    if (t === 'both') return def.stage === 'poi' ? 'poi' : 'hybrid';
    if (t === 'hybrid') return 'hybrid';
    if (t === 'solar' && def.stage === 'losses') return 'pvlosses';
    return def.stage;
  }
  const isRes = d => d === 'ws' || d === 'res';

  /* ---------- context shared by item calculations ---------- */
  function buildContext(project, lib) {
    const tech = techOf(project);
    const life = Math.max(1, Math.round(num(project.horizon && project.horizon.life, 25)));
    const iavId = tech === 'solar' ? 'ghi_iav' : 'ws_iav';
    const iavDefault = lib && lib.ITEM_BY_ID && lib.ITEM_BY_ID[iavId] ? lib.ITEM_BY_ID[iavId].def.v : (tech === 'solar' ? 2.5 : 4.0);
    const sigmaA = (() => { const s = (project.items || {})[iavId]; return s && s.mode === 'entered' ? Math.max(0, num(s.entered && s.entered.v, iavDefault)) : iavDefault; })();
    if (tech === 'solar') {
      const pv = project.pv || {};
      const dc = Math.max(0.01, num(pv.dcMWp, 1)), ac = Math.max(0.01, num(pv.acMW, 1));
      return {
        tech, life, sigmaA, desktop: false,
        solarSource: (project.setup && project.setup.solarSource) || 'satellite',
        dc, ac, dcac: dc / ac, mount: pv.mount || 'fixed', bifacial: !!pv.bifacial,
        ghi: Math.max(1, num(pv.ghi, 1800)), poaRatio: Math.max(0.5, num(pv.poaRatio, 1.1)),
        capacityMW: ac, nMeasLocations: 1, curve: null,
      };
    }
    const c = curveFor(project);
    const cl = project.climate, pl = project.plant, vt = project.vertical || {};
    const meanWs = num(cl.meanWs, 7), k = clamp(num(cl.k, 2), 1.1, 4);
    const hub = num(pl.hubH, 120);
    const alpha = num(vt.alpha, 0.2);
    const ctx = {
      tech, life, sigmaA,
      desktop: project.setup.dataSource === 'desktop',
      terrain: project.setup.terrain || 'moderate',
      hub, meanWs, k, alpha,
      rho: c.rho,
      nTurbines: Math.max(1, Math.round(num(pl.nTurbines, 1))),
      capacityMW: Math.max(0.1, num(pl.nTurbines, 1) * num(pl.ratedMW, 3)),
      vertical: vt,
      horizontal: project.horizontal || {},
      nMeasLocations: Math.max(1, (project.devices || []).filter(d => num(d.weight, 0) > 0).length),
    };
    ctx.wsAt = h => meanWs * Math.pow(Math.max(1, num(h, hub)) / hub, alpha);
    ctx.curve = c;
    return ctx;
  }

  /* ---------- evaluate one item from its definition and state ---------- */
  function evalItem(def, st, ctx) {
    const mode = st && st.mode ? st.mode : def.defaultMode;
    const inputs = (st && st.inputs) || {};
    let out = { sigma: 0, L: 0, iav: 0 };
    const asOut = v => (typeof v === 'object' && v !== null) ? { sigma: num(v.s ?? v.sigma, 0), L: num(v.L, 0), iav: num(v.iav, 0) } : { sigma: num(v, 0), L: 0, iav: 0 };
    try {
      if (mode === 'none') out = { sigma: 0, L: 0, iav: 0 };
      else if (mode === 'calc' && def.calc) out = asOut(def.calc.fn(fieldValues(def.calc.fields, inputs), ctx));
      else if (mode === 'desc' && def.desc) {
        const opts = def.desc.options;
        const i = clamp(Math.round(num(st && st.choice, def.desc.def || 0)), 0, opts.length - 1);
        const o = opts[i];
        out = asOut(typeof o.v === 'function' ? o.v(ctx, fieldValues(def.desc.fields || [], inputs)) : o.v);
      } else if (mode === 'entered') {
        const e = (st && st.entered) || {};
        if (def.domain === 'loss') out = { sigma: num(e.s, 0), L: num(e.L, 0), iav: num(e.iav, 0) };
        else out = { sigma: num(e.v, 0), L: 0, iav: 0 };
      } else {
        const d = def.def.v;
        out = asOut(typeof d === 'function' ? d(ctx) : d);
      }
    } catch (err) { out = { sigma: 0, L: 0, iav: 0, error: String(err && err.message || err) }; }
    out.sigma = Math.max(0, num(out.sigma, 0));
    out.iav = Math.max(0, num(out.iav, 0));
    out.L = clamp(num(out.L, 0), -30, 95);
    out.mode = mode;
    out.tier = TIER_OF_MODE[mode] || 'generic';
    return out;
  }
  function fieldValues(fields, inputs) {
    const o = {};
    (fields || []).forEach(f => { o[f.key] = f.type === 'select' ? (inputs[f.key] ?? f.def) : num(inputs[f.key], f.def); });
    return o;
  }
  const TIER_OF_MODE = { calc: 'calc', entered: 'site', desc: 'desc', default: 'generic', none: 'none' };
  const IEC_BASIS = { calc: 'other_calculation', entered: 'project_specific_assumption', desc: 'project_specific_assumption', default: 'generic assumption', none: 'not_considered' };

  /* ---------- build the uncertainty model (item level) ---------- */
  function buildModel(project, lib) {
    const ctx = buildContext(project, lib);
    const tech = ctx.tech;
    const items = [];
    const push = (def, st, extra) => {
      if (def.when && !def.when(ctx)) return;
      const r = evalItem(def, st, ctx);
      items.push(Object.assign({ key: def.id, id: def.id, def, name: def.name, stage: def.stage, cat: def.cat, sub: def.sub, domain: def.domain, time: def.time || 'static', dist: def.dist || 'normal', reducible: def.reducible !== false }, r, extra || {}));
    };
    const devices = [];
    if (tech === 'wind' && !ctx.desktop) {
      (project.devices || []).forEach(dv => {
        const w = Math.max(0, num(dv.weight, 0));
        const dctx = Object.assign({}, ctx, { device: dv, wsMeas: ctx.wsAt(dv.height) });
        const dItems = [];
        lib.items.filter(d => d.device === dv.type).forEach(def => {
          const r = evalItem(def, (dv.items || {})[def.id], dctx);
          const it = Object.assign({ key: dv.id + ':' + def.id, id: def.id, def, name: def.name, stage: def.stage, cat: def.cat, sub: def.sub, domain: 'ws', time: 'static', dist: 'normal', reducible: def.reducible !== false, deviceId: dv.id, deviceName: dv.name || (dv.type === 'lidar' ? 'Lidar' : 'Mast') }, r);
          items.push(it); dItems.push(it);
        });
        devices.push({ id: dv.id, name: dv.name, type: dv.type, w, items: dItems });
      });
    }
    lib.items.filter(d => !d.device && forTech(d, tech) && !(project._component && d.tech === 'both')).forEach(def => push(def, (project.items || {})[def.id]));
    const wsum = devices.reduce((s, d) => s + d.w, 0);
    devices.forEach(d => { d.wn = wsum > 0 ? d.w / wsum : 0; });
    return { ctx, tech, items, devices, deviceCorr: clamp(num(project.deviceCorr, 0.5), 0, 1) };
  }

  /* ---------- energy ---------- */
  function energy(project, model) {
    const ctx = model.ctx, pe = project.energy || {};
    let eff = 1;
    model.items.filter(i => i.domain === 'loss' && i.time !== 'horizon').forEach(i => { eff *= (1 - i.L / 100); });
    const entered = pe.p50Mode === 'entered' && num(pe.p50, 0) > 0;
    const sEntered = pe.sensMode === 'entered' && num(pe.sens, 0) > 0;
    if (model.tech === 'solar') {
      const refYield = ctx.ghi * ctx.poaRatio;                 // kWh/m² on the array ≈ reference yield, kWh/kWp
      const grossGWh = ctx.dc * refYield / 1000;              // MWp × kWh/kWp → GWh
      const netComputed = grossGWh * eff;
      const p50 = entered ? num(pe.p50, 0) : netComputed;
      const S = sEntered ? num(pe.sens, 0) : 1.0;
      return {
        tech: 'solar', grossGWh, netComputed, eff, p50, p50Source: entered ? 'entered' : 'computed',
        cf: p50 * 1000 / (ctx.ac * 8760), grossCf: grossGWh * 1000 / (ctx.ac * 8760),
        refYield, specYield: p50 * 1000 / ctx.dc, pr: eff,
        S, sCalc: 1.0, sSource: sEntered ? 'entered' : 'computed', table: null, linearTable: true,
      };
    }
    const curve = ctx.curve.fn;
    const p1 = meanPower(curve, ctx.meanWs, ctx.k, 1);
    const grossGWh = p1 * 8760 * ctx.nTurbines / 1000;
    const netComputed = grossGWh * eff;
    const p50 = entered ? num(pe.p50, 0) : netComputed;
    const d = 0.01;
    const up = meanPower(curve, ctx.meanWs, ctx.k, 1 + d), dn = meanPower(curve, ctx.meanWs, ctx.k, 1 - d);
    const sCalc = p1 > 0 ? (up - dn) / (2 * d * p1) : 1.8;
    const S = sEntered ? num(pe.sens, 0) : sCalc;
    const table = [];
    for (let w = 0.5; w <= 1.5001; w += 0.02) table.push([w, p1 > 0 ? meanPower(curve, ctx.meanWs, ctx.k, w) / p1 : w]);
    return {
      tech: 'wind', grossGWh, netComputed, eff, p50, p50Source: entered ? 'entered' : 'computed',
      cf: ctx.capacityMW > 0 ? p50 * 1000 / (ctx.capacityMW * 8760) : 0,
      grossCf: ctx.capacityMW > 0 ? grossGWh * 1000 / (ctx.capacityMW * 8760) : 0,
      S, sCalc, sSource: sEntered ? 'entered' : 'computed', table, linearTable: sEntered,
      rho: ctx.rho, curveKind: ctx.curve.kind, meanPowerMW: p1,
    };
  }

  /* ---------- analytical combination ---------- */
  const RES_STATIC = ['measurement', 'historical_wind_resource', 'vertical_extrapolation', 'horizontal_extrapolation', 'virtual_data',
    'irradiance_source', 'long_term_irradiance', 'plane_of_array'];
  const WS_STATIC = RES_STATIC;

  function climateSigma(N, model) {
    const it = model.items.find(i => i.id === 'climate_change');
    if (!it || it.mode === 'none') return 0;
    if (it.mode !== 'default') return it.sigma;
    // literature default: 0.5 % up to 10 years, rising linearly to 2 % at 25 years (capped at 2.5 %)
    const base = it.sigma;
    if (N <= 10) return base;
    return Math.min(base * 5, base * (1 + 3 * (N - 10) / 15));
  }

  /* loss over an N-year average for items whose loss grows each year (degradation): L is the yearly rate */
  function lossAt(it, N) {
    if (it.time !== 'horizon') return { L: it.L, s: it.sigma };
    const f = Math.max(0, (N - 1) / 2);
    return { L: it.L * f, s: it.sigma * f };
  }
  function p50Factor(model, N) {
    let f = 1;
    model.items.forEach(i => { if (i.domain === 'loss' && i.time === 'horizon') f *= 1 - lossAt(i, N).L / 100; });
    return f;
  }

  function corrMatrix(project, cats) {
    const R = cats.map((a, i) => cats.map((b, j) => (i === j ? 1 : 0)));
    const cc = project.catCorr || {};
    cats.forEach((a, i) => cats.forEach((b, j) => {
      if (i < j) {
        const v = clamp(num(cc[a + '|' + b] ?? cc[b + '|' + a], 0), -0.9, 0.95);
        R[i][j] = R[j][i] = v;
      }
    }));
    return R;
  }

  /* Total relative energy uncertainty (%) at horizon N, with optional per-item scale factors */
  function combine(project, model, en, N, scale) {
    const sc = k => (scale && scale[k] != null ? scale[k] : 1);
    const items = model.items;
    const devSig = model.devices.map(d => Math.sqrt(d.items.reduce((s, i) => s + (i.sigma * sc(i.key)) ** 2, 0)));
    let measDev2 = 0;
    model.devices.forEach((d, i) => model.devices.forEach((e, j) => {
      measDev2 += d.wn * e.wn * (i === j ? 1 : model.deviceCorr) * devSig[i] * devSig[j];
    }));
    const catSig = {};
    RES_STATIC.forEach(c => {
      let v = c === 'measurement' ? measDev2 : 0;
      items.filter(i => isRes(i.domain) && i.cat === c && !i.deviceId && i.time === 'static').forEach(i => { v += (i.sigma * sc(i.key)) ** 2; });
      catSig[c] = Math.sqrt(v);
    });
    const cats = RES_STATIC.filter(c => catSig[c] > 0);
    const R = corrMatrix(project, cats);
    let wsStatic2 = 0;
    cats.forEach((a, i) => cats.forEach((b, j) => { wsStatic2 += R[i][j] * catSig[a] * catSig[b]; }));
    wsStatic2 = Math.max(0, wsStatic2);
    let iav2 = 0;
    items.filter(i => isRes(i.domain) && i.time === 'annual').forEach(i => { iav2 += (i.sigma * sc(i.key)) ** 2 / N; });
    const cc = climateSigma(N, model) * (items.find(i => i.id === 'climate_change') ? sc('climate_change') : 1);
    const ws2 = wsStatic2 + iav2 + cc * cc;
    const S = en.S;
    let e2 = S * S * ws2;
    const terms = { wsStatic2, iav2, cc2: cc * cc, en2: 0, loss2: 0, lossIav2: 0 };
    items.forEach(i => {
      if (i.domain === 'en') { const v = (i.sigma * sc(i.key)) ** 2; e2 += v; terms.en2 += v; }
      if (i.domain === 'loss') {
        const la = lossAt(i, N);
        const eta = Math.max(0.05, 1 - la.L / 100);
        const s = la.s * sc(i.key) / eta, a = i.time === 'horizon' ? 0 : i.iav * sc(i.key) / eta;
        e2 += s * s + a * a / N; terms.loss2 += s * s; terms.lossIav2 += a * a / N;
      }
    });
    return { sigma: Math.sqrt(e2), wsSigma: Math.sqrt(ws2), wsStatic: Math.sqrt(wsStatic2), catSig, devSig, cats, R, terms, S, cc, iavN: Math.sqrt(iav2) };
  }

  function pvalues(p50, sigma) {
    const o = {};
    PLEVELS.forEach(p => { o[p] = p50 * Math.max(0, 1 - Z[p] * sigma / 100); });
    return o;
  }

  /* Variance contributions per item at horizon N (sum = sigma^2) */
  function contributions(project, model, en, N, comb) {
    const S2 = en.S * en.S;
    const out = [];
    const { catSig, cats, R, devSig } = comb;
    const wsStatic2 = comb.terms.wsStatic2;
    const catShare = {};
    cats.forEach((a, i) => {
      let s = 0; cats.forEach((b, j) => { s += R[i][j] * catSig[a] * catSig[b]; });
      catShare[a] = wsStatic2 > 0 ? s / wsStatic2 : 0;
    });
    let measDev2 = 0;
    model.devices.forEach((d, i) => model.devices.forEach((e, j) => { measDev2 += d.wn * e.wn * (i === j ? 1 : model.deviceCorr) * devSig[i] * devSig[j]; }));
    const devShare = model.devices.map((d, i) => {
      if (measDev2 <= 0) return 0;
      let s = 0; model.devices.forEach((e, j) => { s += d.wn * e.wn * (i === j ? 1 : model.deviceCorr) * devSig[i] * devSig[j]; });
      return s / measDev2;
    });
    model.items.forEach(it => {
      let v = 0;
      if (isRes(it.domain) && it.time === 'static' && cats.includes(it.cat)) {
        const cv = catShare[it.cat] * wsStatic2;
        const c2 = catSig[it.cat] ** 2;
        if (c2 > 0) {
          if (it.deviceId) {
            const di = model.devices.findIndex(d => d.id === it.deviceId);
            const ds = devSig[di] ** 2;
            v = ds > 0 ? cv * (measDev2 / c2) * devShare[di] * (it.sigma ** 2 / ds) : 0;
          } else v = cv * (it.sigma ** 2 / c2);
        }
        v *= S2;
      } else if (isRes(it.domain) && it.time === 'annual') v = S2 * it.sigma ** 2 / N;
      else if (it.id === 'climate_change') v = S2 * comb.terms.cc2;
      else if (it.domain === 'en') v = it.sigma ** 2;
      else if (it.domain === 'loss') {
        const la = lossAt(it, N); const eta = Math.max(0.05, 1 - la.L / 100);
        v = (la.s / eta) ** 2 + (it.time === 'horizon' ? 0 : (it.iav / eta) ** 2 / N);
      }
      out.push({ key: it.key, item: it, variance: v });
    });
    const tot = comb.sigma ** 2;
    out.forEach(o => { o.share = tot > 0 ? o.variance / tot : 0; });
    return out;
  }

  function horizonList(model) { return [1, 10, model.ctx.life]; }

  /* ---------- full analytical evaluation ---------- */
  function evaluate(project, lib) {
    if (project.tech === 'hybrid') return evaluateHybrid(project, lib);
    const model = buildModel(project, lib);
    const en = energy(project, model);
    const H = {};
    horizonList(model).forEach(N => {
      const c = combine(project, model, en, N);
      const p50 = en.p50 * p50Factor(model, N);
      H[N] = { N, comb: c, sigma: c.sigma, p50, pv: pvalues(p50, c.sigma) };
    });
    const v = project.view || {};
    const focusN = v.horizon === 1 ? 1 : v.horizon === 'life' ? model.ctx.life : 10;
    const focus = H[focusN];
    const contrib = contributions(project, model, en, focusN, focus.comb);
    const mix = { calc: 0, site: 0, desc: 0, generic: 0 };
    contrib.forEach(c => { if (mix[c.item.tier] != null) mix[c.item.tier] += c.share; });
    const none = model.items.filter(i => i.mode === 'none');
    const stages = {};
    contrib.forEach(c => { const s = c.item.stage; stages[s] = stages[s] || { variance: 0, tiers: { calc: 0, site: 0, desc: 0, generic: 0 }, items: 0 }; stages[s].variance += c.variance; if (stages[s].tiers[c.item.tier] != null) stages[s].tiers[c.item.tier] += c.variance; stages[s].items++; });
    Object.values(stages).forEach(s => { s.sigma = Math.sqrt(s.variance); });
    const base90 = focus.pv.P90;
    const reduce = [];
    model.items.forEach(it => {
      if (!it.reducible || it.mode === 'none' || (it.sigma <= 0 && it.iav <= 0)) return;
      const c = combine(project, model, en, focusN, { [it.key]: 0.5 });
      const p90 = focus.p50 * Math.max(0, 1 - Z.P90 * c.sigma / 100);
      reduce.push({ key: it.key, item: it, gainGWh: p90 - base90, gainPct: focus.p50 > 0 ? (p90 - base90) / focus.p50 * 100 : 0, newSigma: c.sigma });
    });
    reduce.sort((a, b) => b.gainGWh - a.gainGWh);
    return { model, en, H, focusN, focus, contrib, mix, none, stages, reduce, tech: model.tech };
  }

  /* ---------- Monte Carlo ---------- */
  function interp(table, w) {
    if (w <= table[0][0]) { const [x0, y0] = table[0], [x1, y1] = table[1]; return Math.max(0, y0 + (y1 - y0) * (w - x0) / (x1 - x0)); }
    const n = table.length;
    if (w >= table[n - 1][0]) { const [x0, y0] = table[n - 2], [x1, y1] = table[n - 1]; return y1 + (y1 - y0) * (w - x1) / (x1 - x0); }
    const i = Math.min(n - 2, Math.floor((w - table[0][0]) / (table[1][0] - table[0][0])));
    const [x0, y0] = table[i], [x1, y1] = table[i + 1];
    return y0 + (y1 - y0) * (w - x0) / (x1 - x0);
  }

  /* loss and energy-item sampler: returns a function giving Π(sampled efficiency / mean efficiency) × Π(1 + energy error) */
  function itemSampler(items, N) {
    const enItems = items.filter(i => i.domain === 'en' && i.sigma > 0).map(i => i.sigma / 100);
    const losses = items.filter(i => i.domain === 'loss' && (i.sigma > 0 || i.iav > 0)).map(i => {
      const la = lossAt(i, N);
      const mean = la.L / 100, sd = la.s / 100, eta = 1 - mean;
      const wb = i.dist === 'weibull' && mean > 0 && sd > 0 ? weibullFromMoments(mean, sd) : null;
      return { mean, sd, eta: Math.max(0.05, eta), wb, iav: i.time === 'horizon' ? 0 : i.iav / 100 / Math.sqrt(N) };
    }).filter(l => l.sd > 0 || l.iav > 0);
    return R => {
      let e = 1;
      for (let i = 0; i < enItems.length; i++) e *= 1 + enItems[i] * R.n();
      for (let i = 0; i < losses.length; i++) {
        const l = losses[i];
        let loss;
        if (l.wb) { const u = Math.max(1e-12, R.u()); loss = l.wb.lambda * Math.pow(-Math.log(u), 1 / l.wb.k); }
        else loss = l.mean + l.sd * R.n();
        if (l.iav > 0) loss += l.iav * R.n();
        e *= clamp(1 - loss, 0, 1.4) / l.eta;
      }
      return e;
    };
  }
  /* one technology: relative energy for given standard normals of the static resource term and the year-to-year term */
  function techSampler(project, model, en, N) {
    const comb = combine(project, model, en, N);
    const sStatic = Math.sqrt(comb.terms.wsStatic2) / 100, sIav = Math.sqrt(comb.terms.iav2) / 100, sCc = Math.sqrt(comb.terms.cc2) / 100;
    const items = itemSampler(model.items, N);
    const linear = en.linearTable || !en.table, S = en.S;
    return (R, zRes, zIav) => {
      const eps = sStatic * zRes + sIav * zIav + sCc * R.n();
      const e = linear ? Math.max(0, 1 + S * eps) : interp(en.table, 1 + eps);
      return e * items(R);
    };
  }
  function summarise(out, n, N, base) {
    out.sort();
    const q = p => out[clamp(Math.floor(p * (n - 1)), 0, n - 1)];
    let mean = 0; for (let i = 0; i < n; i++) mean += out[i]; mean /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (out[i] - mean) ** 2; v /= (n - 1);
    const pv = { P50: q(0.5), P75: q(0.25), P90: q(0.10), P95: q(0.05), P99: q(0.01) };
    const lo = q(0.001), hi = q(0.999), B = 40, bins = new Array(B).fill(0), bw = (hi - lo) / B || 1;
    for (let i = 0; i < n; i++) { const b = Math.floor((out[i] - lo) / bw); if (b >= 0 && b < B) bins[b]++; }
    return { n, N, base, pv, mean, sd: Math.sqrt(v), sigmaPct: base > 0 ? Math.sqrt(v) / base * 100 : 0, hist: { lo, hi, bw, bins } };
  }

  function monteCarlo(project, result, N, opts = {}) {
    const n = Math.max(1000, Math.min(400000, Math.round(num(opts.n, 50000))));
    const R = rng(num(opts.seed, 20261016));
    if (result.hybrid) return monteCarloHybrid(result, N, n, R);
    const { model, en } = result;
    const base = en.p50 * p50Factor(model, N);
    const f = techSampler(project, model, en, N);
    const out = new Float64Array(n);
    for (let s = 0; s < n; s++) out[s] = base * f(R, R.n(), R.n());
    return summarise(out, n, N, base);
  }

  function monteCarloHybrid(result, N, n, R) {
    const h = result.hyb, ctx = result.model.ctx;
    const fw = techSampler(h.pw, h.rw.model, h.rw.en, N), fs = techSampler(h.ps, h.rs.model, h.rs.en, N);
    const shared = itemSampler(h.shared, N);
    const Ew = h.rw.en.p50 * p50Factor(h.rw.model, N), Es = h.rs.en.p50 * p50Factor(h.rs.model, N);
    const effSh = h.effSh, base = (Ew + Es) * effSh;
    const ri = ctx.rhoIav, rr = ctx.rhoRes, ci = Math.sqrt(1 - ri * ri), cr = Math.sqrt(1 - rr * rr);
    const out = new Float64Array(n);
    for (let s = 0; s < n; s++) {
      const zr1 = R.n(), zr2 = rr * zr1 + cr * R.n();
      const zi1 = R.n(), zi2 = ri * zi1 + ci * R.n();
      out[s] = (Ew * fw(R, zr1, zi1) + Es * fs(R, zr2, zi2)) * effSh * shared(R);
    }
    return summarise(out, n, N, base);
  }

  /* ---------- hybrid: wind + solar behind one connection ---------- */
  const EXPORT_PTS = [[0.3, 14], [0.4, 6.67], [0.5, 1.98], [0.6, 0.63], [0.7, 0.18], [0.8, 0.04], [0.9, 0.005]];
  /* curtailment at a shared export limit, % of annual energy, from connection size as a share of combined capacity
     (measured 1:1 PV–wind plant, 5-second data); adjusted upward when the mix is far from 1:1 */
  function exportLimitLoss(connFrac, mixRatio) {
    const c = num(connFrac, 1);
    if (c >= 0.95) return 0;
    let L;
    if (c <= EXPORT_PTS[0][0]) L = EXPORT_PTS[0][1] * Math.pow(EXPORT_PTS[0][1] / EXPORT_PTS[1][1], (EXPORT_PTS[0][0] - c) / 0.1);
    else {
      let i = 0; while (i < EXPORT_PTS.length - 1 && EXPORT_PTS[i + 1][0] < c) i++;
      const [x0, y0] = EXPORT_PTS[i], [x1, y1] = EXPORT_PTS[Math.min(i + 1, EXPORT_PTS.length - 1)];
      L = x1 === x0 ? y0 : Math.exp(Math.log(y0) + (Math.log(y1) - Math.log(y0)) * (c - x0) / (x1 - x0));
      if (c > 0.9) L *= (0.95 - c) / 0.05;
    }
    const mf = 1 + Math.abs(Math.log(Math.max(0.05, num(mixRatio, 1))));
    return Math.min(40, L * mf);
  }

  function evaluateHybrid(project, lib) {
    const pw = Object.assign({}, project, { tech: 'wind', _component: 'wind' });
    const ps = Object.assign({}, project, { tech: 'solar', _component: 'solar', energy: project.energyPv || { p50Mode: 'computed', p50: 0, sensMode: 'computed', sens: 1 } });
    const rw = evaluate(pw, lib), rs = evaluate(ps, lib);
    const hy = project.hybrid || {};
    const windMW = rw.model.ctx.capacityMW, solarAC = rs.model.ctx.ac;
    const gridMW = num(hy.gridMW, 0) > 0 ? num(hy.gridMW, 0) : windMW + solarAC;
    const ctx = {
      tech: 'hybrid', life: rw.model.ctx.life, windMW, solarAC, solarDC: rs.model.ctx.dc, gridMW,
      connFrac: gridMW / (windMW + solarAC), overbuild: (windMW + solarAC) / gridMW, mixRatio: solarAC / windMW,
      capacityMW: gridMW, rhoIav: clamp(num(hy.rhoIav, 0), -0.95, 0.95), rhoRes: clamp(num(hy.rhoRes, 0), -0.95, 0.95),
      nMeasLocations: 1, desktop: false,
    };
    const shared = [];
    lib.items.filter(d => !d.device && forTech(d, 'hybrid')).forEach(def => {
      if (def.when && !def.when(ctx)) return;
      const r = evalItem(def, (project.items || {})[def.id], ctx);
      shared.push(Object.assign({ key: def.id, id: def.id, def, name: def.name, stage: hybridStageOf(def), cat: def.cat, sub: def.sub, domain: def.domain, time: def.time || 'static', dist: def.dist || 'normal', reducible: def.reducible !== false, comp: 'hybrid', _S: 1 }, r));
    });
    let effSh = 1;
    shared.filter(i => i.domain === 'loss').forEach(i => { effSh *= 1 - i.L / 100; });
    const wrap = (it, comp, S) => Object.assign({}, it, { stage: comp === 'solar' && it.stage === 'losses' ? 'pvlosses' : it.stage, comp, _S: S });
    const items = [...rw.model.items.map(i => wrap(i, 'wind', rw.en.S)), ...rs.model.items.map(i => wrap(i, 'solar', rs.en.S)), ...shared];
    const byKey = {}; items.forEach(i => { byKey[i.key] = i; });

    function hcombine(N, scale) {
      const sc = k => (scale && scale[k] != null ? scale[k] : 1);
      const cw = combine(pw, rw.model, rw.en, N, scale), cs = combine(ps, rs.model, rs.en, N, scale);
      const Ew = rw.en.p50 * p50Factor(rw.model, N), Es = rs.en.p50 * p50Factor(rs.model, N);
      const T = Math.max(1e-9, Ew + Es), aw = Ew / T, as = Es / T;
      const iavW = rw.en.S * Math.sqrt(cw.terms.iav2), iavS = rs.en.S * Math.sqrt(cs.terms.iav2);
      const resW = rw.en.S * Math.sqrt(cw.terms.wsStatic2), resS = rs.en.S * Math.sqrt(cs.terms.wsStatic2);
      const cross = 2 * aw * as * (ctx.rhoIav * iavW * iavS + ctx.rhoRes * resW * resS);
      let sh2 = 0;
      shared.forEach(i => {
        if (i.domain === 'en') sh2 += (i.sigma * sc(i.key)) ** 2;
        if (i.domain === 'loss') { const eta = Math.max(0.05, 1 - i.L / 100); sh2 += (i.sigma * sc(i.key) / eta) ** 2 + (i.iav * sc(i.key) / eta) ** 2 / N; }
      });
      const v = aw * aw * cw.sigma ** 2 + as * as * cs.sigma ** 2 + cross + sh2;
      return { sigma: Math.sqrt(Math.max(0, v)), cw, cs, Ew, Es, aw, as, cross, sh2, wsSigma: null };
    }

    const H = {};
    [1, 10, ctx.life].forEach(N => {
      const c = hcombine(N);
      const p50 = (c.Ew + c.Es) * effSh;
      const pv = pvalues(p50, c.sigma);
      // sum of the components' own P90s (perfect correlation between wind and solar)
      const sw = Math.sqrt(c.cw.sigma ** 2 + c.sh2), ss = Math.sqrt(c.cs.sigma ** 2 + c.sh2);
      const sumP90 = c.Ew * effSh * Math.max(0, 1 - Z.P90 * sw / 100) + c.Es * effSh * Math.max(0, 1 - Z.P90 * ss / 100);
      H[N] = { N, comb: c, sigma: c.sigma, p50, pv, parts: { wind: { p50: c.Ew * effSh, sigma: sw }, solar: { p50: c.Es * effSh, sigma: ss } }, sumP90, portfolioGain: pv.P90 - sumP90 };
    });
    const v = project.view || {};
    const focusN = v.horizon === 1 ? 1 : v.horizon === 'life' ? ctx.life : 10;
    const focus = H[focusN], fc = focus.comb;
    // contributions: component items scaled by their energy share, shared items directly, correlation as its own line
    const contrib = [];
    contributions(pw, rw.model, rw.en, focusN, fc.cw).forEach(c => contrib.push({ key: c.key, item: byKey[c.key], variance: c.variance * fc.aw * fc.aw }));
    contributions(ps, rs.model, rs.en, focusN, fc.cs).forEach(c => contrib.push({ key: c.key, item: byKey[c.key], variance: c.variance * fc.as * fc.as }));
    shared.forEach(i => {
      let vv = 0;
      if (i.domain === 'en') vv = i.sigma ** 2;
      if (i.domain === 'loss') { const eta = Math.max(0.05, 1 - i.L / 100); vv = (i.sigma / eta) ** 2 + (i.iav / eta) ** 2 / focusN; }
      contrib.push({ key: i.key, item: i, variance: vv });
    });
    const tot = focus.sigma ** 2;
    contrib.forEach(o => { o.share = tot > 0 ? o.variance / tot : 0; });
    const pos = contrib.reduce((a, c) => a + c.variance, 0);
    const mix = { calc: 0, site: 0, desc: 0, generic: 0 };
    contrib.forEach(c => { if (mix[c.item.tier] != null) mix[c.item.tier] += pos > 0 ? c.variance / pos : 0; });
    const stages = {};
    contrib.forEach(c => { const sId = c.item.stage; stages[sId] = stages[sId] || { variance: 0, tiers: { calc: 0, site: 0, desc: 0, generic: 0 }, items: 0 }; stages[sId].variance += c.variance; if (stages[sId].tiers[c.item.tier] != null) stages[sId].tiers[c.item.tier] += c.variance; stages[sId].items++; });
    Object.values(stages).forEach(st => { st.sigma = Math.sqrt(Math.max(0, st.variance)); });
    const none = items.filter(i => i.mode === 'none');
    const base90 = focus.pv.P90;
    const reduce = [];
    items.forEach(it => {
      if (!it.reducible || it.mode === 'none' || (it.sigma <= 0 && it.iav <= 0)) return;
      const c = hcombine(focusN, { [it.key]: 0.5 });
      const p90 = focus.p50 * Math.max(0, 1 - Z.P90 * c.sigma / 100);
      reduce.push({ key: it.key, item: it, gainGWh: p90 - base90, gainPct: focus.p50 > 0 ? (p90 - base90) / focus.p50 * 100 : 0, newSigma: c.sigma });
    });
    reduce.sort((a, b) => b.gainGWh - a.gainGWh);
    const p50y1 = H[1].p50;
    const en = {
      tech: 'hybrid', p50: p50y1, eff: effSh, netComputed: (rw.en.netComputed + rs.en.netComputed) * effSh,
      p50Source: rw.en.p50Source === 'entered' || rs.en.p50Source === 'entered' ? 'entered' : 'computed',
      cf: p50y1 * 1000 / (gridMW * 8760), cfInstalled: p50y1 * 1000 / ((windMW + solarAC) * 8760),
      windShare: H[1].comb.aw, solarShare: H[1].comb.as, S: null,
    };
    return {
      hybrid: true, tech: 'hybrid', wind: rw, solar: rs,
      model: { ctx, tech: 'hybrid', items, devices: rw.model.devices, deviceCorr: rw.model.deviceCorr },
      en, H, focusN, focus, contrib, crossVar: fc.cross, mix, none, stages, reduce,
      hyb: { pw, ps, rw, rs, shared, effSh },
    };
  }

  return { Z, PLEVELS, gamma, cholesky, rng, weibullFromMoments, airDensity, genericCurve, parseCurve, customCurve, curveFor, meanPower, buildContext, evalItem, buildModel, energy, combine, pvalues, contributions, evaluate, evaluateHybrid, monteCarlo, techSampler, itemSampler, climateSigma, lossAt, p50Factor, techOf, forTech, hybridStageOf, exportLimitLoss, isRes, TIER_OF_MODE, IEC_BASIS, num, clamp };
})();
if (typeof module !== 'undefined') module.exports = Engine;
