/* WattOdds — energy yield uncertainty, source to meter.
   Copyright 2026 Nithish Seenivasagam (coderenewables.com)
   SPDX-License-Identifier: Apache-2.0 */
/* Hourly storage and firm-supply engine. Pure functions, no DOM.
   Builds hourly wind and solar profiles (generated or uploaded), dispatches a battery against a demand
   profile, scores demand-fulfilment rules, and runs a Monte Carlo over resource, weather sequence and
   battery uncertainties. Energies in MWh, power in MW. */
const Firm = (() => {
  'use strict';
  const HRS = 8760, DAYS = 365;
  const DIM = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const MONTH_OF_DAY = (() => { const a = new Uint8Array(DAYS); let d = 0; DIM.forEach((n, m) => { for (let i = 0; i < n; i++) a[d++] = m; }); return a; })();
  const MONTH_START = (() => { const a = []; let d = 0; DIM.forEach(n => { a.push(d); d += n; }); return a; })();
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
  const num = (x, d = 0) => (typeof x === 'number' && isFinite(x) ? x : (x === '' || x == null ? d : (isFinite(+x) ? +x : d)));

  /* Illustrative seasonal patterns. "monsoon": June–August wind peak and monsoon cloud dip, as at many
     Indian sites. "flat": no seasonality. Replace with your own hourly profile when you have one. */
  const SEASONS = {
    monsoon: {
      solarClear: [0.95, 0.95, 0.93, 0.90, 0.88, 0.72, 0.58, 0.60, 0.72, 0.88, 0.93, 0.95],
      solarVar: [0.06, 0.06, 0.07, 0.08, 0.10, 0.22, 0.28, 0.28, 0.22, 0.10, 0.07, 0.06],
      wind: [0.80, 0.80, 0.85, 0.95, 1.15, 1.35, 1.40, 1.30, 1.05, 0.80, 0.75, 0.80],
    },
    flat: {
      solarClear: new Array(12).fill(0.85), solarVar: new Array(12).fill(0.12), wind: new Array(12).fill(1),
    },
  };

  function rng(seed) {
    let a = seed >>> 0, spare = null;
    const u = () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const n = () => { if (spare !== null) { const s = spare; spare = null; return s; } let x, y, r; do { x = 2 * u() - 1; y = 2 * u() - 1; r = x * x + y * y; } while (r === 0 || r >= 1); const f = Math.sqrt(-2 * Math.log(r) / r); spare = y * f; return x * f; };
    return { u, n };
  }
  function normCdf(z) { // Abramowitz–Stegun 7.1.26
    const t = 1 / (1 + 0.3275911 * Math.abs(z) / Math.SQRT2);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-z * z / 2);
    return z >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y);
  }
  const sum = a => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s; };
  function bisect(f, target, lo, hi) { // f increasing
    for (let i = 0; i < 60; i++) { const m = 0.5 * (lo + hi); if (f(m) < target) lo = m; else hi = m; }
    return 0.5 * (lo + hi);
  }

  /* ---------- generated profiles (per unit of capacity) ---------- */
  function solarShape(opts) {
    const lat = num(opts.latitude, 22) * Math.PI / 180, mount = opts.mount || 'fixed';
    const S = SEASONS[opts.season] || SEASONS.monsoon;
    const R = rng(num(opts.seed, 7));
    const x = new Float32Array(HRS);
    let ar = 0;
    for (let d = 0; d < DAYS; d++) {
      const m = MONTH_OF_DAY[d];
      ar = 0.6 * ar + Math.sqrt(1 - 0.36) * R.n();
      const day = clamp(S.solarClear[m] * (1 + S.solarVar[m] * ar), 0.12, 1.05);
      const dec = 23.45 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + d + 1) / 365);
      for (let h = 0; h < 24; h++) {
        const w = 15 * (h + 0.5 - 12) * Math.PI / 180;
        const cosz = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(w);
        if (cosz <= 0.01) continue;
        const atm = Math.exp(-0.09 / cosz);
        let inc;
        if (mount === 'tracker') inc = Math.sqrt(cosz * cosz + (Math.cos(dec) * Math.sin(w)) ** 2);
        else if (mount === 'ew') inc = 0.5 * (Math.max(0, Math.cos(10 * Math.PI / 180) * cosz + Math.sin(10 * Math.PI / 180) * Math.cos(dec) * Math.sin(w)) + Math.max(0, Math.cos(10 * Math.PI / 180) * cosz - Math.sin(10 * Math.PI / 180) * Math.cos(dec) * Math.sin(w)));
        else inc = Math.max(0, Math.cos(dec) * Math.cos(w)); // tilt = latitude, facing the equator
        const diffuse = 0.15 * cosz;
        x[d * 24 + h] = (inc * atm + diffuse) * day;
      }
    }
    return x;
  }
  /* AC output per MWac, scaled so annual energy = cf × 8760, with clipping at the inverter limit */
  function genSolar(opts, cf) {
    const x = solarShape(opts);
    const target = clamp(num(cf, 0.25), 0.02, 0.6) * HRS;
    const energy = A => { let s = 0; for (let i = 0; i < HRS; i++) s += Math.min(1, A * x[i]); return s; };
    const A = bisect(energy, target, 0.01, 50);
    const out = new Float32Array(HRS);
    for (let i = 0; i < HRS; i++) out[i] = Math.min(1, A * x[i]);
    return out;
  }
  /* Output per MW of wind capacity, from a persistent hourly wind series through the power curve */
  function genWind(opts, curvePu, cf) {
    const S = SEASONS[opts.season] || SEASONS.monsoon;
    const R = rng(num(opts.seed, 11));
    const k = clamp(num(opts.k, 2), 1.2, 4), peakHr = num(opts.windPeakHour, 20), amp = clamp(num(opts.windDiurnal, 0.12), 0, 0.5);
    const v = new Float32Array(HRS);
    let z = 0;
    for (let i = 0; i < HRS; i++) {
      z = 0.97 * z + Math.sqrt(1 - 0.97 * 0.97) * R.n();
      const u = clamp(normCdf(z), 1e-6, 1 - 1e-6);
      const vw = Math.pow(-Math.log(1 - u), 1 / k);
      const d = Math.floor(i / 24), h = i % 24;
      v[i] = vw * S.wind[MONTH_OF_DAY[d]] * (1 + amp * Math.cos(2 * Math.PI * (h - peakHr) / 24));
    }
    const target = clamp(num(cf, 0.3), 0.02, 0.75) * HRS;
    const energy = s => { let e = 0; for (let i = 0; i < HRS; i++) e += curvePu(s * v[i]); return e; };
    const s = bisect(energy, target, 0.1, 40);
    const out = new Float32Array(HRS);
    for (let i = 0; i < HRS; i++) out[i] = curvePu(s * v[i]);
    return out;
  }

  /* ---------- uploaded profiles ---------- */
  function parseProfile(text) {
    const rows = [];
    String(text || '').split(/\r?\n/).forEach(line => {
      const parts = line.trim().split(/[\s,;\t]+/).filter(Boolean);
      const nums = parts.map(Number);
      if (!nums.length || nums.some(n => !isFinite(n))) return; // header or text
      rows.push(nums);
    });
    if (rows.length === 8784) rows.splice(1416, 24); // drop 29 February
    if (rows.length < HRS) return { error: `Found ${rows.length} hourly rows; 8760 are needed (one year).` };
    const cols = Math.min(...rows.slice(0, HRS).map(r => r.length));
    const take = c => { const a = new Float32Array(HRS); for (let i = 0; i < HRS; i++) a[i] = Math.max(0, rows[i][c]); return a; };
    if (cols >= 2) return { wind: take(cols - 2), solar: take(cols - 1), cols };
    return { single: take(0), cols: 1 };
  }
  function toB64(f32) {
    const u8 = new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength);
    if (typeof Buffer !== 'undefined') return Buffer.from(u8).toString('base64');
    let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(b64) {
    let u8;
    if (typeof Buffer !== 'undefined') u8 = new Uint8Array(Buffer.from(b64, 'base64'));
    else { const s = atob(b64); u8 = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i); }
    return new Float32Array(u8.buffer, 0, Math.floor(u8.length / 4));
  }

  /* ---------- demand and rules ---------- */
  const PRESETS = {
    fdre4: {
      label: 'SECI FDRE-IV (amendment 4)', peakHours: [0, 15, 16, 21, 22, 23], offFrac: 1, reserve: 0,
      rules: [{ id: 'all', label: 'All hours, monthly', window: 'all', basis: 'monthly', months: 'all', target: 80 }],
      note: 'Monthly DFR of at least 80 % across all hours; shortfall penalised at 1.5 × tariff.',
    },
    seci26: {
      label: 'SECI FDRE 1 GW (Aug 2026)', peakHours: [0, 15, 16, 21, 22, 23], offFrac: 1, reserve: 0.6,
      rules: [
        { id: 'peak', label: 'Peak hours, monthly', window: 'peak', basis: 'monthly', months: 'all', target: 90 },
        { id: 'off', label: 'Off-peak hours, monthly', window: 'off', basis: 'monthly', months: 'all', target: 80, relax: { months: [6, 7, 8], allow: 2, target: 70 } },
        { id: 'annual', label: 'All hours, annual', window: 'all', basis: 'annual', months: 'all', target: 90 },
      ],
      note: 'Peak at least 90 %, off-peak at least 80 % (70 % allowed in two months between July and September), annual 90 %. Peak hours here follow FDRE-IV; set them to your tender.',
    },
    peak: {
      label: 'Peak supply only', peakHours: [18, 19, 20, 21], offFrac: 0, reserve: 0.9,
      rules: [{ id: 'peak', label: 'Peak hours, monthly', window: 'peak', basis: 'monthly', months: 'all', target: 90 }],
      note: 'Supply only in the peak window, at least 90 % each month.',
    },
    rtc: {
      label: 'Round the clock', peakHours: [], offFrac: 1, reserve: 0,
      rules: [{ id: 'annual', label: 'All hours, annual', window: 'all', basis: 'annual', months: 'all', target: 85 }],
      note: 'Flat demand at the contracted capacity with an annual availability target.',
    },
  };
  function rulesFor(supply) {
    const p = PRESETS[supply.preset] || PRESETS.fdre4;
    const t = supply.targets || {};
    return p.rules.map(r => Object.assign({}, r, { target: num(t[r.id], r.target), relax: r.relax && supply.relax !== false ? Object.assign({}, r.relax, { target: num(t[r.id + '_relax'], r.relax.target) }) : null }));
  }
  function buildDemand(supply) {
    const C = Math.max(0, num(supply.contractMW, 0));
    const peakSet = new Set((supply.peakHours || []).map(Number));
    const offFrac = clamp(num(supply.offFrac, 1), 0, 1.5), peakFrac = clamp(num(supply.peakFrac, 1), 0, 1.5);
    const D = new Float32Array(HRS), peak = new Uint8Array(HRS);
    for (let i = 0; i < HRS; i++) { const h = i % 24; const pk = peakSet.has(h); peak[i] = pk ? 1 : 0; D[i] = C * (pk ? peakFrac : offFrac); }
    return { D, peak, C, peakCount: peakSet.size };
  }

  /* ---------- one operating year ---------- */
  /* p: { w, s (base MW profiles), wCap, sCap, wScale, sScale, X, Pb, E, rte, aux, reserve, out (Uint8Array day outages), dayMap, D, peak, allowExcess, trace } */
  function simulateYear(p) {
    const etaC = Math.sqrt(p.rte), etaD = Math.sqrt(p.rte);
    const E = Math.max(0, p.E), Pb = Math.max(0, p.Pb), X = p.X;
    const reserveE = p.peakCount > 0 ? clamp(p.reserve, 0, 1) * E : 0;
    let soc = 0.5 * E;
    const W = 3; // windows: 0 peak, 1 off-peak, 2 all
    const ratio = new Float64Array(12 * W), cnt = new Float64Array(12 * W), dem = new Float64Array(12 * W), srv = new Float64Array(12 * W);
    let delivered = 0, served = 0, excess = 0, curtailed = 0, charged = 0, discharged = 0, gen = 0;
    const tr = p.trace ? { gen: new Float64Array(24), dem: new Float64Array(24), srv: new Float64Array(24), dis: new Float64Array(24), ch: new Float64Array(24), soc: new Float64Array(24) } : null;
    for (let d = 0; d < DAYS; d++) {
      const src = p.dayMap ? p.dayMap[d] : d, m = MONTH_OF_DAY[d];
      const bOn = !(p.out && p.out[d]);
      for (let h = 0; h < 24; h++) {
        const i = d * 24 + h, j = src * 24 + h;
        const g = (p.w ? Math.min(p.wCap, p.w[j] * p.wScale) : 0) + (p.s ? Math.min(p.sCap, p.s[j] * p.sScale) : 0);
        const dm = p.D[i], pk = p.peak[i];
        const direct = Math.min(g, dm, X);
        let surplus = g - direct, need = dm - direct, ch = 0, dis = 0;
        if (bOn && E > 0) {
          if (surplus > 0) { ch = Math.min(surplus, Pb, (E - soc) / etaC); if (ch < 0) ch = 0; soc += ch * etaC; surplus -= ch; }
          if (need > 1e-9) {
            const floor = pk ? 0 : reserveE;
            dis = Math.min(Pb, need, X - direct, Math.max(0, (soc - floor) * etaD));
            if (dis < 0) dis = 0;
            soc -= dis / etaD; need -= dis;
          }
        }
        const sv = direct + dis;
        const ex = p.allowExcess ? Math.min(surplus, Math.max(0, X - sv)) : 0;
        excess += ex; curtailed += surplus - ex; served += sv; delivered += sv + ex; charged += ch; discharged += dis; gen += g;
        if (dm > 0) {
          const r = Math.min(sv / dm, 1), wi = pk ? 0 : 1;
          ratio[m * W + wi] += r; cnt[m * W + wi]++; dem[m * W + wi] += dm; srv[m * W + wi] += Math.min(sv, dm);
          ratio[m * W + 2] += r; cnt[m * W + 2]++; dem[m * W + 2] += dm; srv[m * W + 2] += Math.min(sv, dm);
        }
        if (tr) { tr.gen[h] += g; tr.dem[h] += dm; tr.srv[h] += sv; tr.dis[h] += dis; tr.ch[h] += ch; tr.soc[h] += soc; }
      }
    }
    const auxE = p.aux * (charged + discharged);
    delivered = Math.max(0, delivered - auxE);
    const monthly = [0, 1, 2].map(wi => Array.from({ length: 12 }, (_, m) => ({ dfr: cnt[m * W + wi] > 0 ? ratio[m * W + wi] / cnt[m * W + wi] : null, demand: dem[m * W + wi], served: srv[m * W + wi], hours: cnt[m * W + wi] })));
    const annual = [0, 1, 2].map(wi => { let r = 0, c = 0, dd = 0, ss = 0; for (let m = 0; m < 12; m++) { r += ratio[m * W + wi]; c += cnt[m * W + wi]; dd += dem[m * W + wi]; ss += srv[m * W + wi]; } return { dfr: c > 0 ? r / c : null, demand: dd, served: ss }; });
    if (tr) { for (const k in tr) for (let h = 0; h < 24; h++) tr[k][h] /= DAYS; }
    return { monthly, annual, delivered, served, excess, curtailed, charged, discharged, gen, auxE, cycles: E > 0 ? discharged / E : 0, trace: tr };
  }

  const WIN = { peak: 0, off: 1, all: 2 };
  function scoreRules(res, rules) {
    let allMet = true, shortfall = 0, failedMonths = 0;
    const per = rules.map(r => {
      const wi = WIN[r.window];
      let met = true, sf = 0, failed = 0;
      if (r.basis === 'annual') {
        const a = res.annual[wi];
        if (a.dfr != null && a.dfr * 100 < r.target - 1e-9) { met = false; sf = (r.target / 100 - a.dfr) * a.demand; }
      } else {
        const mm = res.monthly[wi];
        const relaxed = [];
        mm.forEach((x, m) => {
          if (x.dfr == null) return;
          if (x.dfr * 100 >= r.target - 1e-9) return;
          if (r.relax && r.relax.months.includes(m) && x.dfr * 100 >= r.relax.target - 1e-9 && relaxed.length < r.relax.allow) { relaxed.push(m); return; }
          failed++; met = false;
          const tgt = r.relax && r.relax.months.includes(m) && relaxed.length < r.relax.allow ? r.relax.target : r.target;
          sf += Math.max(0, tgt / 100 - x.dfr) * x.demand;
        });
      }
      if (!met) allMet = false;
      shortfall += sf; failedMonths += failed;
      return { id: r.id, met, shortfall: sf, failed };
    });
    return { allMet, shortfall, failedMonths, per };
  }

  /* ---------- preparation from the project and the analytical result ---------- */
  function prepare(project, result, E, Lib) {
    const tech = project.tech === 'hybrid' ? 'hybrid' : project.tech === 'solar' ? 'solar' : 'wind';
    const b = project.bess || {}, sp = project.supply || {}, prof = sp.profile || {};
    const rw = tech === 'hybrid' ? result.wind : tech === 'wind' ? result : null;
    const rs = tech === 'hybrid' ? result.solar : tech === 'solar' ? result : null;
    const windMW = rw ? rw.model.ctx.capacityMW : 0, solarAC = rs ? rs.model.ctx.ac : 0;
    let effSh = 1, exportItem = null;
    if (tech === 'hybrid') {
      exportItem = result.model.items.find(i => i.id === 'hy_export_limit');
      effSh = result.en.eff / Math.max(0.05, 1 - (exportItem ? exportItem.L : 0) / 100);
    }
    const X = tech === 'hybrid' ? result.model.ctx.gridMW : (num(b.gridMW, 0) > 0 ? num(b.gridMW, 0) : (windMW + solarAC));
    const Ew = rw ? rw.en.p50 * 1000 * effSh : 0, Es = rs ? rs.en.p50 * 1000 * effSh : 0;   // MWh/yr, year 1, before the export limit
    // base hourly profiles in MW
    let w = null, s = null, source = 'generated', warn = '';
    const upl = prof.kind === 'upload' && (prof.wind || prof.solar) ? { wind: prof.wind ? fromB64(prof.wind) : null, solar: prof.solar ? fromB64(prof.solar) : null } : null;
    if (upl) {
      source = 'uploaded';
      const scale = sp.profileScale !== false;
      if (rw) { w = upl.wind ? new Float32Array(upl.wind) : null; if (!w) warn = 'The uploaded file has no wind column; a generated wind profile is used.'; }
      if (rs) { s = upl.solar ? new Float32Array(upl.solar) : null; if (!s) warn = 'The uploaded file has no solar column; a generated solar profile is used.'; }
      if (scale) { if (w) { const f = Ew / Math.max(1e-6, sum(w)); for (let i = 0; i < HRS; i++) w[i] *= f; } if (s) { const f = Es / Math.max(1e-6, sum(s)); for (let i = 0; i < HRS; i++) s[i] *= f; } }
    }
    const opts = { season: sp.season || 'monsoon', latitude: num(sp.latitude, 22), mount: project.pv && project.pv.mount, k: project.climate && project.climate.k, windPeakHour: num(sp.windPeakHour, 20), windDiurnal: num(sp.windDiurnal, 0.12), seed: 7 };
    if (rw && !w) {
      const fn = rw.model.ctx.curve.fn, rated = Math.max(0.01, num(project.plant && project.plant.ratedMW, 1));
      const pu = genWind(opts, v => Math.min(1, fn(v) / rated), Ew / Math.max(1e-6, windMW * HRS));
      w = new Float32Array(HRS); for (let i = 0; i < HRS; i++) w[i] = pu[i] * windMW;
      const f = Ew / Math.max(1e-6, sum(w)); for (let i = 0; i < HRS; i++) w[i] *= f;
    }
    if (rs && !s) {
      const pu = genSolar(opts, Es / Math.max(1e-6, solarAC * HRS));
      s = new Float32Array(HRS); for (let i = 0; i < HRS; i++) s[i] = pu[i] * solarAC;
      const f = Es / Math.max(1e-6, sum(s)); for (let i = 0; i < HRS; i++) s[i] *= f;
    }
    // energy samplers (single year, N = 1)
    let sampleRes;
    if (tech === 'hybrid') {
      const h = result.hyb;
      const fw = E.techSampler(h.pw, h.rw.model, h.rw.en, 1), fs = E.techSampler(h.ps, h.rs.model, h.rs.en, 1);
      const sh = E.itemSampler(h.shared.filter(i => i.id !== 'hy_export_limit'), 1);
      const ri = result.model.ctx.rhoIav, rr = result.model.ctx.rhoRes, ci = Math.sqrt(1 - ri * ri), cr = Math.sqrt(1 - rr * rr);
      sampleRes = R => { const zr1 = R.n(), zr2 = rr * zr1 + cr * R.n(), zi1 = R.n(), zi2 = ri * zi1 + ci * R.n(); const f = sh(R); return { w: fw(R, zr1, zi1) * f, s: fs(R, zr2, zi2) * f }; };
    } else {
      const f1 = E.techSampler(project, result.model, result.en, 1);
      sampleRes = R => { const f = f1(R, R.n(), R.n()); return { w: f, s: f }; };
    }
    const deg = rs ? rs.model.items.find(i => i.id === 'degradation') : null;
    const item = id => { const d = Lib.ITEM_BY_ID[id]; return E.evalItem(d, (project.items || {})[id], {}); };
    const bp = { cap: item('bess_cap'), rte: item('bess_rte'), fade: item('bess_fade'), avail: item('bess_avail'), aux: item('bess_aux'), disp: item('bess_dispatch') };
    const dem = buildDemand(sp);
    const life = Math.max(1, Math.round(num(project.horizon && project.horizon.life, 25)));
    return {
      tech, w, s, wCap: windMW, sCap: solarAC, X, Ew, Es, effSh, sampleRes, source, warn,
      degRate: deg && deg.mode !== 'none' ? deg.L : 0, degSigma: deg && deg.mode !== 'none' ? deg.sigma : 0,
      Pb: b.enabled ? Math.max(0, num(b.powerMW, 0)) : 0, Enom: b.enabled ? Math.max(0, num(b.energyMWh, 0)) : 0,
      augment: !!b.augment, augTarget: clamp(num(b.augTarget, 80), 0, 100) / 100,
      reserve: num(sp.reserve, (PRESETS[sp.preset] || PRESETS.fdre4).reserve), allowExcess: sp.allowExcess !== false,
      bp, dem, rules: rulesFor(sp), life, rteDecline: 0.15,
      tariff: Math.max(0, num(sp.tariff, 0)), penaltyMult: Math.max(0, num(sp.penaltyMult, 1.5)),
    };
  }

  function weibullDraw(R, mean, sd) {
    if (!(mean > 0)) return 0;
    if (!(sd > 0)) return mean;
    const cv2 = (sd / mean) ** 2;
    let lo = 0.25, hi = 40;
    const gam = x => Math.exp(lgamma(x));
    const f = k => gam(1 + 2 / k) / gam(1 + 1 / k) ** 2 - 1 - cv2;
    for (let i = 0; i < 50; i++) { const m = 0.5 * (lo + hi); if (f(m) > 0) lo = m; else hi = m; }
    const k = 0.5 * (lo + hi), lam = mean / gam(1 + 1 / k);
    return lam * Math.pow(-Math.log(Math.max(1e-12, R.u())), 1 / k);
  }
  function lgamma(x) { // Lanczos log-gamma
    const c = [76.18009172947146, -86.50532032941677, 24.01409824083091, -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5];
    let y = x, t = x + 5.5; t -= (x + 0.5) * Math.log(t);
    let s = 1.000000000190015; for (let j = 0; j < 6; j++) s += c[j] / ++y;
    return -t + Math.log(2.5066282746310005 * s / x);
  }

  /* parameters for one sampled year; fix = groups held at their central values */
  function drawYear(prep, R, year, fix) {
    const f = fix.resource ? { w: 1, s: 1 } : prep.sampleRes(R);
    const dr = fix.resource ? prep.degRate : Math.max(0, prep.degRate + prep.degSigma * R.n());
    const solarDeg = Math.max(0, 1 - dr / 100 * (year - 1));
    const bp = prep.bp;
    const capF = fix.battery ? 1 : Math.max(0.5, 1 + bp.cap.sigma / 100 * R.n());
    const fade = fix.battery ? bp.fade.L : Math.max(0, bp.fade.L + bp.fade.sigma * R.n());
    let soh = Math.max(0, 1 - fade / 100 * (year - 1));
    if (prep.augment) soh = Math.max(soh, prep.augTarget);
    const disp = fix.battery ? bp.disp.L : clamp(bp.disp.L + bp.disp.sigma * R.n(), 0, 60);
    const E = prep.Enom * capF * soh * (1 - disp / 100);
    const rte = clamp((fix.efficiency ? bp.rte.L : bp.rte.L + bp.rte.sigma * R.n()) - prep.rteDecline * (year - 1), 50, 99) / 100;
    const aux = Math.max(0, (fix.efficiency ? bp.aux.L : bp.aux.L + bp.aux.sigma * R.n())) / 100;
    let out = null;
    if (!fix.availability && prep.Pb > 0) {
      const u = weibullDraw(R, bp.avail.L / 100, bp.avail.sigma / 100);
      const nOut = Math.round(clamp(u, 0, 0.5) * DAYS);
      if (nOut > 0) { out = new Uint8Array(DAYS); let k = 0, guard = 0; while (k < nOut && guard++ < 5000) { const d = Math.floor(R.u() * DAYS); if (!out[d]) { out[d] = 1; k++; } } }
    }
    let dayMap = null;
    if (!fix.weather) { dayMap = new Int16Array(DAYS); for (let d = 0; d < DAYS; d++) { const m = MONTH_OF_DAY[d]; dayMap[d] = MONTH_START[m] + Math.floor(R.u() * DIM[m]); } }
    return { wScale: f.w, sScale: f.s * solarDeg, E, rte, aux, out, dayMap };
  }

  function runYear(prep, y, trace) {
    return simulateYear({ w: prep.w, s: prep.s, wCap: prep.wCap, sCap: prep.sCap, wScale: y.wScale, sScale: y.sScale, X: prep.X, Pb: prep.Pb, E: y.E, rte: y.rte, aux: y.aux, reserve: prep.reserve, out: y.out, dayMap: y.dayMap, D: prep.dem.D, peak: prep.dem.peak, peakCount: prep.dem.peakCount, allowExcess: prep.allowExcess, trace });
  }

  /* central-case year (no randomness) with an average-day trace */
  function central(prep, year) {
    const bp = prep.bp;
    let soh = Math.max(0, 1 - bp.fade.L / 100 * (year - 1)); if (prep.augment) soh = Math.max(soh, prep.augTarget);
    const y = { wScale: 1, sScale: Math.max(0, 1 - prep.degRate / 100 * (year - 1)), E: prep.Enom * soh * (1 - bp.disp.L / 100), rte: clamp(bp.rte.L - prep.rteDecline * (year - 1), 50, 99) / 100, aux: bp.aux.L / 100, out: null, dayMap: null };
    const res = runYear(prep, y, true);
    return { res, score: scoreRules(res, prep.rules), y };
  }

  const pct = (arr, p) => { if (!arr.length) return null; const a = Float64Array.from(arr).sort(); return a[clamp(Math.floor(p * (a.length - 1)), 0, a.length - 1)]; };

  /* Monte Carlo over operating years. onChunk(done, total) may return a promise (to yield to the page). */
  async function run(prep, opts, onChunk) {
    const n = clamp(Math.round(num(opts.n, 400)), 20, 5000), year = clamp(Math.round(num(opts.year, 1)), 1, 60);
    const fix = opts.fix || {};
    const R = rng(num(opts.seed, 4242));
    const met = [], shortfall = [], delivered = [], served = [], curtailed = [], excess = [], cycles = [], failed = [];
    const perMet = prep.rules.map(() => 0), perFailed = prep.rules.map(() => 0);
    const winDfr = [[], [], []], monthDfr = [0, 1, 2].map(() => Array.from({ length: 12 }, () => []));
    for (let k = 0; k < n; k++) {
      const y = drawYear(prep, R, year, fix);
      const res = runYear(prep, y, false);
      const sc = scoreRules(res, prep.rules);
      met.push(sc.allMet ? 1 : 0); shortfall.push(sc.shortfall); failed.push(sc.failedMonths);
      sc.per.forEach((x, i) => { if (x.met) perMet[i]++; perFailed[i] += x.failed; });
      delivered.push(res.delivered); served.push(res.served); curtailed.push(res.curtailed); excess.push(res.excess); cycles.push(res.cycles);
      for (let wi = 0; wi < 3; wi++) { if (res.annual[wi].dfr != null) winDfr[wi].push(res.annual[wi].dfr); res.monthly[wi].forEach((x, m) => { if (x.dfr != null) monthDfr[wi][m].push(x.dfr); }); }
      if (onChunk && (k + 1) % 40 === 0) await onChunk(k + 1, n);
    }
    const mean = a => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
    const penalty = x => x * 1000 * prep.tariff * prep.penaltyMult; // MWh → kWh × rate × multiplier
    return {
      n, year, pMeet: mean(met), perRule: prep.rules.map((r, i) => ({ id: r.id, label: r.label, target: r.target, pMet: perMet[i] / n, failedMonths: perFailed[i] / n, window: r.window, basis: r.basis })),
      failedMonths: mean(failed),
      shortfall: { mean: mean(shortfall), p50: pct(shortfall, 0.5), p90: pct(shortfall, 0.9), p99: pct(shortfall, 0.99) },
      penalty: { p50: penalty(pct(shortfall, 0.5)), p90: penalty(pct(shortfall, 0.9)), mean: penalty(mean(shortfall)) },
      delivered: { p50: pct(delivered, 0.5), p90: pct(delivered, 0.1), p99: pct(delivered, 0.01), mean: mean(delivered) },
      served: { p50: pct(served, 0.5), p90: pct(served, 0.1) },
      curtailed: { p50: pct(curtailed, 0.5) }, excess: { p50: pct(excess, 0.5) }, cycles: { mean: mean(cycles) },
      dfr: [0, 1, 2].map(wi => ({ p50: pct(winDfr[wi], 0.5), p10: pct(winDfr[wi], 0.1), n: winDfr[wi].length })),
      monthly: [0, 1, 2].map(wi => monthDfr[wi].map(a => ({ p50: pct(a, 0.5), p10: pct(a, 0.1) }))),
    };
  }

  /* what drives the risk: hold each group at its central value in turn */
  async function drivers(prep, opts, onChunk) {
    const n = clamp(Math.round(num(opts.n, 300)), 20, 2000);
    const base = await run(prep, Object.assign({}, opts, { n }), null);
    const groups = [
      ['resource', 'Energy uncertainty of wind and solar (all items)'],
      ['weather', 'Day-to-day weather sequence'],
      ['battery', 'Battery capacity, fade and dispatch'],
      ['efficiency', 'Round-trip efficiency and auxiliary load'],
      ['availability', 'Battery outages'],
    ];
    const out = [];
    for (let g = 0; g < groups.length; g++) {
      const r = await run(prep, Object.assign({}, opts, { n, fix: { [groups[g][0]]: true } }), null);
      out.push({ id: groups[g][0], label: groups[g][1], pMeet: r.pMeet, dP: r.pMeet - base.pMeet, sf90: r.shortfall.p90, dSf90: r.shortfall.p90 - base.shortfall.p90 });
      if (onChunk) await onChunk(g + 1, groups.length);
    }
    out.sort((a, b) => Math.abs(b.dSf90) - Math.abs(a.dSf90) || Math.abs(b.dP) - Math.abs(a.dP));
    return { n, base, groups: out };
  }

  return { HRS, DAYS, MONTH_OF_DAY, SEASONS, PRESETS, rulesFor, buildDemand, solarShape, genSolar, genWind, parseProfile, toB64, fromB64, simulateYear, scoreRules, prepare, drawYear, central, run, drivers, normCdf };
})();
if (typeof module !== 'undefined') module.exports = Firm;
