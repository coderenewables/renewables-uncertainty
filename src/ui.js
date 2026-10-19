/* WattOdds — energy yield uncertainty, source to meter.
   Copyright 2026 Nithish Seenivasagam (coderenewables.com)
   SPDX-License-Identifier: Apache-2.0 */
/* Interface. Vanilla JS: state → evaluate → render. Inputs update state and live values in place
   so focus is never lost; structural changes re-render the current stage. */
(() => {
  'use strict';
  const E = Engine, Lb = Library;
  const LS_KEY = 'weu:current:v1';
  const XLSX_URL = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  let state = null, result = null, stage = 'project';
  let mc = null, mcKey = '', mcRunning = false;
  const caps = { db: null, uid: null, dl: null, ready: false };
  let cloud = { list: [], status: '', unsub: null, savedStamp: null };
  let overlay = null;

  /* ---------- small helpers ---------- */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fx = (x, d = 1) => (typeof x === 'number' && isFinite(x) ? x.toFixed(d) : '–');
  const pct = (x, d = 2) => fx(x, d) + ' %';
  const clone = o => JSON.parse(JSON.stringify(o));
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
  const setPath = (o, p, v) => { const k = p.split('.'); let a = o; for (let i = 0; i < k.length - 1; i++) { if (a[k[i]] == null || typeof a[k[i]] !== 'object') a[k[i]] = {}; a = a[k[i]]; } a[k[k.length - 1]] = v; };
  const slug = s => String(s || 'wind-project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'wind-project';
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  const TIER = {
    calc: { label: 'Calculated', cls: 'ev-calc', long: 'Calculated by the tool from your site inputs' },
    site: { label: 'Site value', cls: 'ev-site', long: 'A value you entered from your own analysis or a report' },
    desc: { label: 'Site description', cls: 'ev-desc', long: 'Estimated from how you described the site' },
    generic: { label: 'Generic default', cls: 'ev-generic', long: 'A literature or framework value, not specific to your site' },
    none: { label: 'Excluded', cls: 'ev-none', long: 'Left out of the total' },
  };
  const TIER_ORDER = ['calc', 'site', 'desc', 'generic'];
  const MODE_LABEL = { calc: 'Calculate', desc: 'Describe', entered: 'Enter value', default: 'Generic', none: 'Exclude' };
  let comp = null; // in a hybrid project: the component whose stage is being drawn ('wind' | 'solar'), or null
  const ptech = () => (state && (state.tech === 'solar' || state.tech === 'hybrid') ? state.tech : 'wind');
  const isHybrid = () => ptech() === 'hybrid';
  const tech = () => (isHybrid() ? (comp || 'hybrid') : ptech());
  const hasBess = () => !!(state && state.bess && state.bess.enabled);
  const chainOf = () => Lb.CHAINS[ptech()].concat(hasBess() ? ['bess', 'supply'] : []);
  const ONSITE_ONLY = ['historical', 'vertical', 'horizontal'];
  const isSolar = () => tech() === 'solar';
  const hasSolar = () => ptech() !== 'wind';
  const resWord = () => (isSolar() ? 'irradiance' : 'wind speed');
  const C = () => (isHybrid() && comp ? result[comp] : result);
  const CR = k => (isHybrid() && (k === 'wind' || k === 'solar') ? result[k] : C());
  const compKey = () => comp || '';
  const enPath = () => (isHybrid() && comp === 'solar' ? 'energyPv' : 'energy');
  const compOfStage = id => (isHybrid() ? Lb.COMPONENT_OF_STAGE[id] || null : null);
  const COMP_LABEL = { wind: 'Wind', solar: 'Solar', hybrid: 'Shared' };
  const TERRAIN = [['flat', 'Flat'], ['simple', 'Simple'], ['moderate', 'Moderate'], ['complex', 'Complex'], ['vcomplex', 'Very complex']];
  const stageDef = id => Lb.STAGES.find(s => s.id === id);
  const stageName = id => { const s = stageDef(id); return s ? (isHybrid() && s.nameHybrid ? s.nameHybrid : s.name) : id; };
  const hzLabel = () => (state.view.horizon === 1 ? '1-yr' : state.view.horizon === 'life' ? lifeN() + '-yr' : '10-yr');
  const lifeN = () => Math.max(1, Math.round(+state.horizon.life || 25));

  /* ---------- state persistence ---------- */
  function loadLocal() {
    try { const s = localStorage.getItem(LS_KEY); if (s) { const o = JSON.parse(s); if (o && o.state) return o; } } catch (e) { /* storage unavailable */ }
    return null;
  }
  let saveTimer = 0;
  function saveLocal() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { try { localStorage.setItem(LS_KEY, JSON.stringify({ state, stage })); } catch (e) { /* ignore */ } }, 500);
  }
  function touch() { state.meta.updated = new Date().toISOString(); saveLocal(); updateSaveTag(); }

  /* ---------- evaluation and scheduling ---------- */
  function recompute() { result = E.evaluate(state, Lb); }
  let raf = 0;
  function scheduleLive() { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; recompute(); updateLive(); }); }
  function rerender() { recompute(); renderStage(pvMode()); updateChrome(); }

  /* ---------- shell ---------- */
  // WattOdds mark: a dot plot of outcomes; the one dot beyond the line (1 in 11) is the tail below P90
  const BRAND_MARK = '<svg class="brand-mark" width="32" height="32" viewBox="0 0 64 64" aria-hidden="true"><circle cx="10" cy="50" r="5" fill="var(--accent)" fill-opacity="0.32"/><circle cx="21" cy="50" r="5" fill="var(--accent)"/><circle cx="21" cy="39" r="5" fill="var(--accent)"/><circle cx="32" cy="50" r="5" fill="var(--accent)"/><circle cx="32" cy="39" r="5" fill="var(--accent)"/><circle cx="32" cy="28" r="5" fill="var(--accent)"/><circle cx="32" cy="17" r="5" fill="var(--accent)"/><circle cx="43" cy="50" r="5" fill="var(--accent)"/><circle cx="43" cy="39" r="5" fill="var(--accent)"/><circle cx="43" cy="28" r="5" fill="var(--accent)"/><circle cx="54" cy="50" r="5" fill="var(--accent)"/><path d="M15.5,10 V58" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" fill="none"/></svg>';

  function renderShell() {
    document.getElementById('app').innerHTML = `
      <header class="top"><div class="top-in">
        <div class="brand">${BRAND_MARK}<div><div class="brand-name">Watt<span class="odds">Odds</span></div><div class="brand-sub">energy yield uncertainty · source to meter</div></div></div>
        <div class="proj"><span class="proj-name" id="projName"></span><span id="projTags"></span></div>
        <div class="actions">
          <div class="vt" role="group" aria-label="View"><button data-act="mode" data-val="plant" aria-pressed="${pvMode()}" aria-label="Plant view" title="Plant view"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 13h12M5 13V6M5 6l-3-2M5 6l3-2M5 6v-3M11 13V9h3v4" fill="none" stroke="currentColor" stroke-width="1.4"/></svg><span class="bt">Plant view</span></button><button data-act="mode" data-val="steps" aria-pressed="${!pvMode()}" aria-label="Step by step" title="Step by step"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 3h9M4 8h9M4 13h9" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="1.8" cy="3" r="1" fill="currentColor"/><circle cx="1.8" cy="8" r="1" fill="currentColor"/><circle cx="1.8" cy="13" r="1" fill="currentColor"/></svg><span class="bt">Step by step</span></button></div>
          <button class="btn" data-act="projects" aria-label="Projects"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h4l1.5 1.5H14v8H2z" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="bt">Projects</span></button>
          <button class="btn" data-act="export" aria-label="Export"><svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M3 13h10" fill="none" stroke="currentColor" stroke-width="1.5"/></svg><span class="bt">Export</span></button>
        </div>
      </div></header>
      <div class="frame">
        <nav class="rail" aria-label="Uncertainty chain"><ul class="chain" id="chain"></ul><div class="rail-foot" id="railFoot"></div></nav>
        <main class="sheet" id="sheet" tabindex="-1"></main>
        <aside class="side" id="side" aria-label="Live result"></aside>
      </div>
      <div class="bottombar" id="bottombar"></div>`;
  }

  function renderRail() {
    const r = result;
    const li = id => {
      const s = stageDef(id);
      let sig = '';
      if (id === 'bess') sig = fx(+state.bess.energyMWh / Math.max(0.01, +state.bess.powerMW), 1) + ' h';
      else if (id === 'supply') sig = firm.res && firm.key === firmKey() ? fx(firm.res.pMeet * 100, 0) + '%' : '–';
      else if (chainOf().includes(id)) {
        if (ptech() !== 'solar' && state.setup.dataSource === 'desktop' && ONSITE_ONLY.includes(id)) sig = 'in atlas';
        else sig = r.stages[id] ? fx(r.stages[id].sigma, 1) + '%' : '0.0%';
      } else if (id === 'results') sig = fx(r.focus.pv.P90 / r.focus.p50 * 100, 1) + '%';
      else if (id === 'project') sig = fx(r.en.p50, 0) + ' GWh';
      return `<li><button class="stage-btn" data-stage="${id}" ${stage === id ? 'aria-current="step"' : ''}><span class="node"><i></i></span><span class="stage-label">${esc(stageName(id))}</span><span class="stage-sig" id="sig-${id}">${sig}</span></button></li>`;
    };
    const base = Lb.CHAINS[ptech()];
    const chainHtml = (isHybrid()
      ? `<li class="grp">Wind · mast to meter</li>${base.filter(id => compOfStage(id) === 'wind').map(li).join('')}<li class="grp">Solar · sun to meter</li>${base.filter(id => compOfStage(id) === 'solar').map(li).join('')}<li class="grp">Shared · connection</li>${['hybrid', 'poi'].map(li).join('')}`
      : `<li class="grp">Chain · ${ptech() === 'solar' ? 'sun' : 'mast'} to meter</li>${base.map(li).join('')}`)
      + (hasBess() ? `<li class="grp">Storage · firm supply</li>${['bess', 'supply'].map(li).join('')}` : '');
    $('#chain').innerHTML = `<li class="grp">Set-up</li>${li('project')}${chainHtml}<li class="grp">Outcome</li>${li('results')}`;
    $('#railFoot').innerHTML = `Values beside each stage are its share of the energy uncertainty (σ, ${hzLabel()}). Results shows P90 as a share of P50.`;
  }

  function hzButtons() {
    const h = state.view.horizon;
    return `<div class="hz" role="group" aria-label="Evaluation period">
      <button data-hz="1" aria-pressed="${h === 1}">1 year</button>
      <button data-hz="10" aria-pressed="${h === 10 || h == null}">10 years</button>
      <button data-hz="life" aria-pressed="${h === 'life'}">${lifeN()} years</button></div>`;
  }

  function mixBar(mix, tall) {
    const parts = TIER_ORDER.filter(t => mix[t] > 0.0005).map(t => `<span class="${TIER[t].cls}" style="flex:${mix[t]}" data-tip="${esc(TIER[t].label)}: ${fx(mix[t] * 100, 0)} % of variance"></span>`).join('');
    return `<div class="mixbar" style="${tall ? 'height:14px' : ''}" role="img" aria-label="${TIER_ORDER.map(t => TIER[t].label + ' ' + fx(mix[t] * 100, 0) + '%').join(', ')}">${parts}</div>`;
  }
  function legend() {
    return `<div class="legend">${TIER_ORDER.map(t => `<span><i class="${TIER[t].cls}"></i>${TIER[t].label}</span>`).join('')}</div>`;
  }

  function renderSide() {
    const r = result, pv = r.focus.pv, p50 = r.focus.p50;
    $('#side').innerHTML = `<div class="res-card">
      ${hzButtons()}
      <div class="hero"><span class="lbl">P90, ${hzLabel()} average</span>
        <span class="big">${fx(pv.P90, 1)} <small>GWh/yr</small></span>
        <span class="sub"><span class="ratio">${fx(pv.P90 / p50 * 100, 1)} %</span> of P50 · σ ${fx(r.focus.sigma, 2)} %</span></div>
      <dl class="kv">
        <dt>${hasSolar() ? 'P50 year 1' : 'P50 net at POI'}</dt><dd>${fx(r.en.p50, 1)}</dd>
        ${hasSolar() && r.focusN > 1 ? `<dt>P50, ${hzLabel()} average</dt><dd>${fx(p50, 1)}</dd>` : ''}
        <dt>P75</dt><dd>${fx(pv.P75, 1)}</dd>
        <dt>P95</dt><dd>${fx(pv.P95, 1)}</dd>
        <dt>P99</dt><dd>${fx(pv.P99, 1)}</dd>
        <dt>Net CUF (P50)${isHybrid() ? ', on connection' : ''}</dt><dd>${fx(r.en.cf * 100, 1)} %</dd>
        ${isHybrid() ? `<dt>Portfolio gain at P90</dt><dd>+${fx(r.focus.portfolioGain, 1)}</dd>` : ''}
      </dl>
      <div class="stack" style="gap:8px"><h4>Evidence behind the total</h4>${mixBar(r.mix)}${legend()}
        ${r.none.length ? `<p class="side-note">${r.none.length} item${r.none.length > 1 ? 's' : ''} excluded.</p>` : ''}</div>
      <button class="btn" data-stage="results">Open results</button>
      <p class="side-note">GWh/yr. P-values assume a normal distribution of the combined uncertainty; Results also runs a Monte Carlo check.</p>
    </div>`;
    $('#bottombar').innerHTML = `
      <div class="bb-fig"><span class="l">P50${hasSolar() && r.focusN > 1 ? ' ' + hzLabel() : ''}</span><span class="v">${fx(p50, 1)}</span></div>
      <div class="bb-fig"><span class="l">P90 ${hzLabel()}</span><span class="v">${fx(pv.P90, 1)}</span></div>
      <div class="bb-fig"><span class="l">P90/P50</span><span class="v ratio">${fx(pv.P90 / p50 * 100, 1)} %</span></div>
      <span class="grow"></span>
      ${stage === 'results' ? '' : '<button class="btn small" data-stage="results">Results</button>'}`;
  }

  function updateSaveTag() {
    const n = $('#projName'); if (!n) return;
    n.textContent = state.meta.name || 'Untitled project';
    const saved = cloud.savedStamp && cloud.savedStamp === state.meta.updated;
    $('#projTags').innerHTML = (state.meta.example ? '<span class="tag">Example values</span> ' : '') +
      (caps.db && caps.uid ? `<span class="tag save">${saved ? 'Saved' : 'Not saved to projects'}</span>` : '');
  }

  function updateChrome() { renderRail(); renderSide(); updateSaveTag(); }

  /* ---------- live updates (no re-render) ---------- */
  function bessItems() {
    return Lb.ITEMS.filter(d => d.tech === 'bess').map(d => Object.assign({ key: d.id, id: d.id, def: d, name: d.name, stage: 'bess', cat: d.cat, sub: d.sub, domain: 'bess', comp: 'bess' }, E.evalItem(d, (state.items || {})[d.id], {})));
  }
  function itemMap() { const m = {}; result.model.items.forEach(i => { m[i.key] = i; }); if (hasBess()) bessItems().forEach(i => { m[i.key] = i; }); return m; }
  function valueText(it) {
    const S = it && it._S != null ? it._S : (C().en.S || 1);
    if (!it) return { v: '–', d: '' };
    if (it.mode === 'none') return { v: 'Excluded', d: '' };
    if (it.domain === 'ws' || it.domain === 'res') return { v: pct(it.sigma), d: (it.domain === 'res' ? 'irradiance' : 'wind speed') + ' · ≈ ' + pct(S * it.sigma) + ' energy' };
    if (it.domain === 'en') return { v: pct(it.sigma), d: 'energy' };
    if (it.domain === 'bess') { const u = it.def.bunit || { L: '%', s: '%' }; return { v: `${fx(it.L, it.L !== 0 && Math.abs(it.L) < 10 ? 1 : 0)} ${u.L}`, d: `σ ${fx(it.sigma, 1)} ${u.s} · used in the hourly simulation` }; }
    if (it.time === 'horizon') { const la = E.lossAt(it, result.focusN); return { v: `${fx(it.L, 2)} %/yr`, d: `σ ${fx(it.sigma, 2)} %/yr · ${hzLabel()}: ${fx(la.L, 1)} % ± ${fx(la.s, 1)}` }; }
    const eta = Math.max(0.05, 1 - it.L / 100);
    return { v: it.L < 0 ? `${fx(-it.L, 1)} % gain` : `${fx(it.L, 1)} % loss`, d: `σ ${fx(it.sigma, 2)} pts · ≈ ${pct(it.sigma / eta)} energy${it.iav > 0 ? ' · yearly ±' + fx(it.iav, 1) : ''}` };
  }
  function optPreview(def, st, i, ctx) {
    const r = E.evalItem(def, Object.assign({}, st, { mode: 'desc', choice: i }), ctx);
    if (def.domain === 'bess') return `${fx(r.L, 1)} ± ${fx(r.sigma, 1)}`;
    if (def.domain === 'loss') return def.time === 'horizon' ? `${fx(r.L, 2)} ± ${fx(r.sigma, 2)} %/yr` : r.L < 0 ? `+${fx(-r.L, 1)} % ± ${fx(r.sigma, 1)}` : `${fx(r.L, 1)} % ± ${fx(r.sigma, 1)}`;
    return pct(r.sigma);
  }
  function ctxFor(path) {
    const ctx = C().model.ctx;
    const m = /^devices\.(\d+)\./.exec(path);
    if (m) { const dv = state.devices[+m[1]]; return Object.assign({}, ctx, { device: dv, wsMeas: ctx.wsAt(dv.height) }); }
    return ctx;
  }

  function updateLive() {
    if (pvMode()) { pvSummarise(); comp = pvComp(); } else comp = compOfStage(stage);
    const map = itemMap();
    $$('[data-live]').forEach(el => {
      const [kind, ...rest] = el.dataset.live.split('|');
      const key = rest.join('|');
      if (kind === 'v') el.textContent = valueText(map[key]).v;
      else if (kind === 'd') el.textContent = valueText(map[key]).d;
      else if (kind === 't') { const it = map[key]; const t = TIER[it ? it.tier : 'generic']; el.innerHTML = `<i class="${t.cls}"></i>${t.label}`; }
      else if (kind === 'o') {
        const [path, i] = key.split('#');
        const st = getPath(state, path); const id = path.split('.').pop();
        el.textContent = optPreview(Lb.ITEM_BY_ID[id], st, +i, ctxFor(path));
      } else if (LIVE[kind]) el.innerHTML = LIVE[kind](key);
    });
    renderRail(); renderSide();
    if (pvMode()) pvRefresh();
    else if (stage === 'results') { renderStage(true); }
  }

  /* live fragments by name */
  const LIVE = {
    stagestat: id => stageStat(id),
    devsig: i => { const c = C().focus.comb; return c.devSig[+i] != null ? pct(c.devSig[+i]) + ' wind speed' : '–'; },
    meassig: () => { const c = C().focus.comb; return `<b>${pct(c.catSig.measurement || 0)}</b> combined wind speed uncertainty · ≈ ${pct((c.catSig.measurement || 0) * C().en.S)} energy`; },
    rho: k => fx(CR(k).en.rho, 3) + ' kg/m³',
    vz: () => vzText(),
    nmeas: () => String(C().model.ctx.nMeasLocations),
    energy: () => energyKv(),
    sens: () => fx(C().en.S, 2),
    p50: k => fx(CR(k).en.p50, 1) + ' GWh/yr',
    computedP50: k => fx(CR(k).en.netComputed, 1) + ' GWh/yr',
    conn: () => connText(),
    hybsum: () => hybridSummary(),
    iavtable: () => iavTable(),
    lossgroup: k => { const [st, g] = k.split(':'); return lossGroupStat(g, st); },
    losstotal: () => lossTotal(),
    poisum: () => poiSummary(),
    curve: () => curveChart(),
    dcac: () => fx((+state.pv.dcMWp || 0) / Math.max(0.01, +state.pv.acMW || 0), 2),
    refyield: k => fx(CR(k).en.refYield, 0) + ' kWh/m²',
    prkv: () => prKv(),
    wsmeas: i => { const dv = state.devices[+i]; return dv ? fx(C().model.ctx.wsAt(dv.height), 2) + ' m/s' : '–'; },
  };

  /* ---------- form helpers ---------- */
  let fid = 0;
  const nid = () => 'f' + (++fid);
  function numField(o) {
    const id = nid(), v = getPath(state, o.path);
    return `<div class="field"><label for="${id}">${esc(o.label)}</label>
      <div class="inp"><input id="${id}" type="number" inputmode="decimal" step="${o.step || 'any'}" ${o.min != null ? `min="${o.min}"` : ''} ${o.max != null ? `max="${o.max}"` : ''} data-path="${o.path}" value="${esc(v ?? '')}" ${o.rerender ? 'data-rerender="1"' : ''}>${o.unit ? `<span class="unit">${esc(o.unit)}</span>` : ''}</div>
      ${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`;
  }
  function selField(o) {
    const id = nid(), v = String(getPath(state, o.path) ?? '');
    return `<div class="field"><label for="${id}">${esc(o.label)}</label><div class="inp"><select id="${id}" data-path="${o.path}">${o.options.map(([k, l]) => `<option value="${esc(k)}" ${String(k) === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></div>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`;
  }
  function txtField(o) {
    const id = nid(), v = getPath(state, o.path);
    return `<div class="field"><label for="${id}">${esc(o.label)}</label><input class="txt" id="${id}" type="text" data-path="${o.path}" data-kind="text" value="${esc(v ?? '')}">${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`;
  }
  function segField(o) {
    const v = String(getPath(state, o.path));
    return `<div class="field"><span class="lab">${esc(o.label)}</span><div class="seg" role="group" aria-label="${esc(o.label)}">${o.options.map(([k, l]) => `<button data-set="${o.path}" data-val="${esc(k)}" data-type="${o.type || 'str'}" aria-pressed="${String(k) === v}">${esc(l)}</button>`).join('')}</div>${o.hint ? `<span class="hint">${o.hint}</span>` : ''}</div>`;
  }

  /* ---------- item card ---------- */
  function sourcesHtml(ids) {
    return `<div class="srcs">${(ids || []).map(k => { const s = Lb.SOURCES[k]; if (!s) return ''; return s.u ? `<a href="${esc(s.u)}" target="_blank" rel="noopener">${esc(s.t)}</a>` : `<span>${esc(s.t)}</span>`; }).join('')}</div>`;
  }
  function itemCard(def, path, key) {
    const st = getPath(state, path) || Lb.itemState(def);
    if (!getPath(state, path)) setPath(state, path, st);
    const it = itemMap()[key];
    const modes = ['calc', 'desc', 'entered', 'default', 'none'].filter(m => (m === 'calc' ? !!def.calc : m === 'desc' ? !!def.desc : true));
    const mode = st.mode;
    const vt = valueText(it);
    const tier = TIER[it ? it.tier : 'generic'];
    let body = '';
    if (mode === 'calc' && def.calc) {
      const fields = def.calc.fields.map(f => f.type === 'select'
        ? selField({ path: `${path}.inputs.${f.key}`, label: f.label, options: f.options })
        : numField({ path: `${path}.inputs.${f.key}`, label: f.label, unit: f.unit, step: f.step }));
      body = `${fields.length ? `<div class="grid2">${fields.join('')}</div>` : ''}<p class="formula">${esc(def.calc.note || '')}</p>`;
      if (def.stage === 'vertical') body += `<p class="hint" style="font-size:.78rem;color:var(--ink-3)">Uses the heights and shear set above.</p>`;
    } else if (mode === 'desc' && def.desc) {
      const fields = (def.desc.fields || []).map(f => selField({ path: `${path}.inputs.${f.key}`, label: f.label, options: f.options }));
      const ctx = ctxFor(path);
      const opts = def.desc.options;
      const name = 'r' + nid();
      body = `${fields.length ? `<div class="grid2">${fields.join('')}</div>` : ''}
        ${opts.length > 1 ? `<div class="opts" role="radiogroup" aria-label="${esc(def.name)}">${opts.map((o, i) => `
          <label class="opt ${+st.choice === i ? 'sel' : ''}"><input type="radio" name="${name}" data-choice="${path}" value="${i}" ${+st.choice === i ? 'checked' : ''}><span>${esc(o.label)}</span><span class="ov" data-live="o|${path}#${i}">${optPreview(def, st, i, ctx)}</span></label>`).join('')}</div>`
          : `<p class="computed">${esc(opts[0].label)}: <b data-live="v|${key}">${vt.v}</b></p>`}`;
    } else if (mode === 'entered') {
      if (def.domain === 'bess') {
        const u = def.bunit || {}, lb = def.labels || {};
        body = `<div class="grid2">${numField({ path: `${path}.entered.L`, label: lb.L || 'Value', unit: u.L, step: 0.1 })}${numField({ path: `${path}.entered.s`, label: lb.s || 'Uncertainty (σ)', unit: u.s, step: 0.1 })}</div>`;
      } else if (def.domain === 'loss') {
        const hz = def.time === 'horizon';
        body = `<div class="grid2">${numField({ path: `${path}.entered.L`, label: hz ? 'Rate' : def.id === 'bifacial' ? 'Loss (negative for a gain)' : 'Loss', unit: hz ? '%/yr' : '%', step: hz ? 0.05 : 0.1 })}${numField({ path: `${path}.entered.s`, label: hz ? 'Uncertainty of the rate (σ)' : 'Uncertainty of the loss (σ)', unit: hz ? '%/yr' : 'pts', step: 0.05 })}${def.hasIav ? numField({ path: `${path}.entered.iav`, label: 'Year-to-year variability', unit: 'pts', step: 0.05 }) : ''}</div>`;
      } else {
        const lab = (def.entered && def.entered.label) || (def.domain === 'ws' ? 'Standard uncertainty (σ) as a share of wind speed' : def.domain === 'res' ? 'Standard uncertainty (σ) as a share of irradiation' : 'Standard uncertainty (σ) as a share of energy');
        body = `<div class="grid2">${numField({ path: `${path}.entered.v`, label: lab, unit: '%', step: 0.05 })}</div><p class="formula">Enter one standard deviation (k = 1). Divide a 95 % (k = 2) figure by 2.</p>`;
      }
    } else if (mode === 'default') {
      body = `<p class="computed">Generic value: <b data-live="v|${key}">${vt.v}</b>. ${esc(def.info && def.info.values || '')}</p>`;
    } else {
      body = `<p class="note">Excluded from the total. Keep this only if the item really does not apply to your project.</p>`;
    }
    const info = def.info || {};
    return `<section class="item ${mode === 'none' ? 'off' : ''}" id="it-${esc(key)}">
      <div class="item-head">
        <div class="item-title"><h3>${esc(def.name)}</h3><code>${esc(def.cat)} / ${esc(def.sub)}</code></div>
        <div class="item-val"><span class="v" data-live="v|${key}">${vt.v}</span><span class="d" data-live="d|${key}">${vt.d}</span><span class="ev" data-live="t|${key}"><i class="${tier.cls}"></i>${tier.label}</span></div>
      </div>
      <div class="modes" role="group" aria-label="How to set this item">${modes.map(m => `<button data-mode="${path}" data-key="${esc(key)}" data-val="${m}" aria-pressed="${mode === m}">${MODE_LABEL[m]}</button>`).join('')}</div>
      ${body}
      ${def.note ? `<p class="formula">${esc(def.note)}</p>` : ''}
      <details class="about"><summary>What this is and how to reduce it</summary><div class="about-body">
        ${info.what ? `<p><b>What it is.</b> ${esc(info.what)}</p>` : ''}
        ${info.drives ? `<p><b>What drives it.</b> ${esc(info.drives)}</p>` : ''}
        ${info.reduce ? `<p><b>How to reduce it.</b> ${esc(info.reduce)}</p>` : ''}
        ${info.values ? `<p><b>Where the numbers come from.</b> ${esc(info.values)}</p>` : ''}
        ${sourcesHtml(def.src)}
      </div></details>
    </section>`;
  }
  const stageItems = stageId => (stageId === 'bess' ? Lb.ITEMS.filter(d => d.tech === 'bess') : Lb.ITEMS.filter(d => !d.device && d.tech !== 'bess' && (isHybrid() ? E.hybridStageOf(d) === stageId : d.stage === stageId && E.forTech(d, tech()))));
  const ctxOfDef = d => (d.tech === 'bess' ? {} : isHybrid() ? (d.tech === 'both' || d.tech === 'hybrid' ? result.model.ctx : result[d.tech === 'solar' ? 'solar' : 'wind'].model.ctx) : result.model.ctx);
  const cardsFor = (stageId, filter) => stageItems(stageId).filter(d => (!filter || filter(d)) && (!d.when || d.when(ctxOfDef(d)))).map(d => itemCard(d, `items.${d.id}`, d.id)).join('');

  /* ---------- stage header ---------- */
  function stageStat(id) {
    const s = result.stages[id];
    const tot = result.focus.sigma ** 2;
    if (!s) return `<span>No uncertainty in this stage yet.</span>`;
    const mix = {}; TIER_ORDER.forEach(t => { mix[t] = s.variance > 0 ? s.tiers[t] / s.variance : 0; });
    return `<div class="stage-stat"><div><b>${pct(s.sigma)}</b> <span>energy uncertainty (σ, ${hzLabel()})</span></div><div><b>${fx(tot > 0 ? s.variance / tot * 100 : 0, 0)} %</b> <span>of the total variance</span></div></div>
      <div style="max-width:420px;display:grid;gap:6px">${mixBar(mix)}</div>`;
  }
  function stageHead(id) {
    const s = stageDef(id);
    const n = chainOf().indexOf(id);
    const ref = isSolar() ? (s.ref ? `<span>IEA PVPS Task 13 basis · ${esc(s.ref)}</span>` : '') : (s.iec ? `<span>IEC 61400-15-2 · ${esc(s.iec)}</span>` : '');
    const eyebrow = n >= 0 ? `<span>Stage ${n + 1} of ${chainOf().length}</span>${ref}` : (id === 'project' ? `<span>Set-up · ${{ wind: 'wind', solar: 'solar PV', hybrid: 'hybrid wind + solar' }[ptech()]}</span>` : '<span>Outcome</span>');
    const blurb = (isHybrid() && !comp && s.blurbHybrid) || (isHybrid() && comp === 'wind' && s.blurbHybrid) || (isSolar() && s.blurbSolar) || s.blurb;
    return `<div class="stage-head"><div class="eyebrow">${eyebrow}</div><h2>${esc(stageName(id))}</h2><p class="stage-blurb">${esc(blurb)}</p>${n >= 0 && id !== 'bess' && id !== 'supply' ? `<div data-live="stagestat|${id}">${stageStat(id)}</div>` : ''}</div>`;
  }
  function stageNav(id) {
    const order = ['project', ...chainOf(), 'results'];
    const i = order.indexOf(id), prev = order[i - 1], next = order[i + 1];
    return `<div class="footer-nav">${prev ? `<button class="btn" data-stage="${prev}">← ${esc(stageName(prev))}</button>` : '<span></span>'}${next ? `<button class="btn primary" data-stage="${next}">${esc(stageName(next))} →</button>` : ''}</div>`;
  }

  /* ---------- stages ---------- */
  function techPanel() {
    return `<section class="panel"><header><h3>Technology</h3></header>
      ${segField({ path: 'tech', label: 'What are you assessing?', options: [['wind', 'Wind'], ['solar', 'Solar PV'], ['hybrid', 'Hybrid (wind + solar)']], hint: isHybrid() ? 'A wind plant and a solar plant behind one grid connection. Each keeps its own chain; grid items are shared.' : 'Pick Hybrid to combine a wind and a solar plant behind one connection.' })}</section>`;
  }
  const exampleWarn = () => (state.meta.example ? `<p class="warn">These are example values for a fictional project so you can see the tool working. Replace them with your own, or start a new project from Projects.</p>` : '');
  const projectPanel = () => `<section class="panel"><header><h3>Project</h3></header><div class="grid2">
        ${txtField({ path: 'meta.name', label: 'Project name' })}${txtField({ path: 'meta.site', label: 'Site or notes' })}</div></section>`;
  const storagePanel = () => `<section class="panel"><header><h3>Battery storage and firm supply</h3></header>
      ${segField({ path: 'bess.enabled', label: 'Add a battery and check a supply obligation?', type: 'bool', options: [['false', 'No'], ['true', 'Yes']], hint: hasBess() ? 'Two stages are added: Battery storage and Firm supply. They run an hourly simulation of the plant and battery against a demand profile.' : 'Adds an hourly simulation of plant and battery against a demand profile such as an FDRE or round-the-clock contract.' })}</section>`;
  const evalPanel = hint => `${storagePanel()}<section class="panel"><header><h3>Evaluation period</h3></header><div class="grid2">
        ${numField({ path: 'horizon.life', label: 'Project lifetime for the long-period P-values', unit: 'years', step: 1, min: 1, rerender: true, hint })}</div></section>`;
  const partHead = (t, sub) => `<div class="group-head" style="padding-top:14px"><h3 style="font-size:1.25rem">${esc(t)}</h3>${sub ? `<span class="computed">${sub}</span>` : ''}</div>`;

  function solarPanels() {
    const pv = state.pv, dcac = (+pv.dcMWp || 0) / Math.max(0.01, +pv.acMW || 0), k = compKey(), ep = enPath(), hyb = isHybrid();
    return `<section class="panel"><header><h3>Irradiance data available</h3></header>
        ${segField({ path: 'setup.solarSource', label: 'Irradiance data', options: [['satellite', 'Satellite data only'], ['adapted', 'Satellite, site-adapted with on-site sensors'], ['ground', 'On-site measurement only']], hint: state.setup.solarSource === 'satellite' ? 'The satellite model error is assessed directly. On-site sensors and site adaptation usually reduce it a lot.' : state.setup.solarSource === 'adapted' ? 'The satellite term is replaced by your sensors\' uncertainty plus the error of the site adaptation.' : 'Your sensors define the resource; the length of the record sets the long-term term.' })}
      </section>
      <section class="panel"><header><h3>Solar plant</h3><span class="computed">DC/AC ratio <b data-live="dcac|">${fx(dcac, 2)}</b></span></header><div class="grid2">
        ${numField({ path: 'pv.dcMWp', label: 'DC capacity', unit: 'MWp', step: 0.1 })}
        ${numField({ path: 'pv.acMW', label: 'AC capacity (inverter or export limit)', unit: 'MW', step: 0.1, hint: hyb ? 'Counts towards the combined capacity behind the connection.' : 'CUF is reported on this AC capacity.' })}
      </div>
      ${segField({ path: 'pv.mount', label: 'Mounting', options: [['fixed', 'Fixed tilt'], ['tracker', 'Single-axis tracker'], ['ew', 'East-west']] })}
      ${segField({ path: 'pv.bifacial', label: 'Modules', type: 'bool', options: [['false', 'Monofacial'], ['true', 'Bifacial']] })}
      </section>
      <section class="panel"><header><h3>Irradiance</h3><span class="computed">Array irradiation <b data-live="refyield|${k}">${fx(C().en.refYield, 0)} kWh/m²</b></span></header><div class="grid2">
        ${numField({ path: 'pv.ghi', label: 'Long-term annual GHI', unit: 'kWh/m²', step: 1, hint: 'From your irradiance dataset or site-adapted series.' })}
        ${numField({ path: 'pv.poaRatio', label: 'Plane-of-array to GHI ratio', step: 0.01, hint: 'From your simulation. Typical: fixed tilt about 1.05–1.15, single-axis tracker about 1.15–1.30 at low latitudes.' })}
      </div></section>
      <section class="panel"><header><h3>${hyb ? 'Solar P50, year 1, before shared grid losses' : 'Net P50, year 1'}</h3><span class="computed">In use: <b data-live="p50|${k}">${fx(C().en.p50, 1)} GWh/yr</b></span></header>
        ${segField({ path: ep + '.p50Mode', label: 'Where the P50 comes from', options: [['computed', 'Estimated by this tool'], ['entered', 'From my energy yield report']] })}
        ${getPath(state, ep + '.p50Mode') === 'entered' ? `<div class="grid2">${numField({ path: ep + '.p50', label: hyb ? 'Solar P50, year 1, before export line, grid availability and curtailment' : 'Net P50 at the POI, year 1', unit: 'GWh/yr', step: 0.1 })}</div><p class="note">Tool estimate for comparison: <b data-live="computedP50|${k}">${fx(C().en.netComputed, 1)} GWh/yr</b>.</p>` : `<p class="note">Irradiation on the array × DC capacity × the product of the losses you set (the performance ratio).${hyb ? ' Shared grid losses are applied once, to the combined output, under Shared connection.' : ' Use your simulation\'s year-1 P50 if you have one: the uncertainty percentages stay the same, the GWh values follow your P50.'}</p>`}
      </section>`;
  }
  function windPanels() {
    const desk = state.setup.dataSource === 'desktop', k = compKey(), hyb = isHybrid();
    return `<section class="panel"><header><h3>Wind data available</h3></header>
        ${segField({ path: 'setup.dataSource', label: 'Wind data', options: [['onsite', 'On-site mast or lidar'], ['desktop', 'Desktop only (wind atlas)']], hint: desk ? 'Desktop mode replaces measurement, long-term and extrapolation stages with one wind-atlas uncertainty.' : 'Measurement, long-term correction and extrapolation are each assessed.' })}
        ${segField({ path: 'setup.terrain', label: 'Terrain around the turbines', options: TERRAIN, hint: 'Used by the flow model and lidar estimates when you describe the site rather than enter values.' })}
      </section>
      <section class="panel"><header><h3>Wind plant</h3></header><div class="grid2">
        ${numField({ path: 'plant.nTurbines', label: 'Number of turbines', step: 1, min: 1 })}
        ${numField({ path: 'plant.ratedMW', label: 'Rated power per turbine', unit: 'MW', step: 0.1 })}
        ${numField({ path: 'plant.rotorD', label: 'Rotor diameter', unit: 'm', step: 1 })}
        ${numField({ path: 'plant.hubH', label: 'Hub height', unit: 'm', step: 1, rerender: true })}
        ${numField({ path: 'plant.cutIn', label: 'Cut-in wind speed', unit: 'm/s', step: 0.5 })}
        ${numField({ path: 'plant.cutOut', label: 'Cut-out wind speed', unit: 'm/s', step: 0.5 })}
      </div>
      ${segField({ path: 'plant.curveMode', label: 'Power curve', options: [['generic', 'Generic, from rotor and rating'], ['custom', 'Paste manufacturer curve']] })}
      ${state.plant.curveMode === 'custom' ? `<div class="grid2"><div class="field" style="grid-column:1/-1"><label for="curveTa">Wind speed (m/s) and power (kW), one pair per line</label><textarea class="ta mono" id="curveTa" data-path="plant.curveText" data-kind="text" placeholder="3, 40&#10;4, 180&#10;5, 420&#10;…">${esc(state.plant.curveText)}</textarea><span class="hint">Needs at least four rows. ${C().en.curveKind === 'custom' ? 'Curve in use.' : 'Not enough rows yet: the generic curve is used.'}</span></div>${numField({ path: 'plant.curveRho', label: 'Air density the curve refers to', unit: 'kg/m³', step: 0.005 })}</div>` : ''}
      </section>
      <section class="panel"><header><h3>Air density at hub height</h3><span class="computed">In use: <b data-live="rho|${k}">${fx(C().en.rho, 3)} kg/m³</b></span></header>
        ${segField({ path: 'site.rhoMode', label: 'How to set it', options: [['calc', 'From elevation and temperature'], ['entered', 'Enter a value']] })}
        <div class="grid2">${state.site.rhoMode === 'entered' ? numField({ path: 'site.rho', label: 'Air density', unit: 'kg/m³', step: 0.005 }) : numField({ path: 'site.elevation', label: 'Hub elevation above sea level', unit: 'm', step: 10 }) + numField({ path: 'site.tempC', label: 'Annual mean temperature at hub height', unit: '°C', step: 0.5 })}</div>
      </section>
      <section class="panel"><header><h3>Long-term wind climate at hub height</h3></header><div class="grid2">
        ${numField({ path: 'climate.meanWs', label: 'Mean wind speed', unit: 'm/s', step: 0.05, hint: 'Long-term corrected, averaged over the turbine positions.' })}
        ${numField({ path: 'climate.k', label: 'Weibull shape factor k', step: 0.05, hint: 'Typically 1.8–2.4. Higher values mean a narrower distribution.' })}
      </div></section>
      <section class="panel"><header><h3>${hyb ? 'Wind P50 before shared grid losses' : 'Net P50'}</h3><span class="computed">In use: <b data-live="p50|${k}">${fx(C().en.p50, 1)} GWh/yr</b></span></header>
        ${segField({ path: 'energy.p50Mode', label: 'Where the P50 comes from', options: [['computed', 'Estimated by this tool'], ['entered', 'From my energy yield report']] })}
        ${state.energy.p50Mode === 'entered' ? `<div class="grid2">${numField({ path: 'energy.p50', label: hyb ? 'Wind P50 before export line, grid availability and curtailment' : 'Net P50 at the POI', unit: 'GWh/yr', step: 0.1 })}</div><p class="note">The tool still uses the power curve and wind climate to convert wind speed uncertainty into energy. Tool estimate for comparison: <b data-live="computedP50|${k}">${fx(C().en.netComputed, 1)} GWh/yr</b>.</p>` : `<p class="note">Gross energy from the power curve and Weibull distribution, less the plant losses you set.${hyb ? ' Shared grid losses are applied once, to the combined output, under Shared connection.' : ' Use your consultant\'s P50 if you have one: the uncertainty percentages stay the same, the GWh values follow your P50.'}</p>`}
      </section>`;
  }
  function withComp(c, fn) { const prev = comp; comp = c; try { return fn(); } finally { comp = prev; } }
  function connText() {
    const ctx = result.model.ctx;
    return `Combined ${fx(ctx.windMW + ctx.solarAC, 1)} MW (wind ${fx(ctx.windMW, 1)} + solar ${fx(ctx.solarAC, 1)} MWac) behind <b>${fx(ctx.gridMW, 1)} MW</b>: the connection is ${fx(ctx.connFrac * 100, 0)} % of combined capacity. Solar is ${fx(ctx.mixRatio * 100, 0)} % of wind capacity.`;
  }
  function stageProjectHybrid() {
    return `${stageHead('project')}<div class="stack">
      ${exampleWarn()}${techPanel()}${projectPanel()}
      ${partHead('Wind plant', 'P50 ' + fx(result.wind.en.p50, 1) + ' GWh/yr')}
      ${withComp('wind', windPanels)}
      ${partHead('Solar plant', 'P50 year 1 ' + fx(result.solar.en.p50, 1) + ' GWh/yr')}
      ${withComp('solar', solarPanels)}
      ${partHead('Grid connection')}
      <section class="panel"><header><h3>Shared connection</h3></header><div class="grid2">
        ${numField({ path: 'hybrid.gridMW', label: 'Export capacity at the point of interconnection', unit: 'MW', step: 1, min: 0, hint: '0 means the connection equals the combined capacity. CUF is reported on this capacity.' })}</div>
        <p class="computed" data-live="conn|">${connText()}</p>
        <p class="note">India's National Wind-Solar Hybrid Policy counts a plant as hybrid when the smaller resource is at least 25 % of the larger one's rated capacity. ${sourcesHtml(['hybpolicy'])}</p></section>
      ${evalPanel('Solar year 1 excludes degradation; 10-year and lifetime values include the average degradation over the period.')}
      </div>${stageNav('project')}`;
  }
  function stageProjectSolar() {
    return `${stageHead('project')}<div class="stack">${exampleWarn()}${techPanel()}${projectPanel()}${solarPanels()}
      ${evalPanel('Year 1 excludes degradation; 10-year and lifetime values include the average degradation over the period.')}
      </div>${stageNav('project')}`;
  }
  function stageProject() {
    if (isHybrid()) return stageProjectHybrid();
    if (isSolar()) return stageProjectSolar();
    return `${stageHead('project')}<div class="stack">${exampleWarn()}${techPanel()}${projectPanel()}${windPanels()}
      ${evalPanel('Results show 1-year, 10-year and lifetime averages.')}
      </div>${stageNav('project')}`;
  }

  function stageMeasurement() {
    const desk = state.setup.dataSource === 'desktop';
    if (desk) {
      return `${stageHead('measurement')}<div class="stack">
        <p class="warn">Desktop mode: wind atlases have been found on average about 8.5 % too high against masts. Treat a desktop P50 as indicative, and the uncertainty below as a floor.</p>
        ${cardsFor('measurement')}</div>${stageNav('measurement')}`;
    }
    const devs = state.devices.map((dv, i) => {
      const defs = Lb.ITEMS.filter(d => d.device === dv.type);
      return `<section class="device"><div class="dev-head">
          <span class="dev-type">${dv.type === 'lidar' ? 'Lidar' : 'Mast'}</span>
          <div style="flex:1;min-width:160px">${txtField({ path: `devices.${i}.name`, label: 'Name' })}</div>
          <div style="width:150px">${numField({ path: `devices.${i}.height`, label: dv.type === 'lidar' ? 'Highest height used' : 'Top anemometer height', unit: 'm', step: 1 })}</div>
          <div style="width:150px">${numField({ path: `devices.${i}.weight`, label: 'Share of turbines it represents', step: 0.05, min: 0, rerender: true })}</div>
          <div class="computed" style="min-width:150px">σ <b data-live="devsig|${i}">${LIVE.devsig(i)}</b><br><span style="font-size:.74rem">mean speed at sensor <span data-live="wsmeas|${i}">${LIVE.wsmeas(i)}</span></span></div>
          <button class="btn small danger" data-act="rmdev" data-i="${i}" ${state.devices.length < 2 ? 'disabled' : ''}>Remove</button>
        </div><div class="dev-body">${defs.map(d => itemCard(d, `devices.${i}.items.${d.id}`, `${dv.id}:${d.id}`)).join('')}</div></section>`;
    }).join('');
    return `${stageHead('measurement')}<div class="stack">
      ${devs}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="adddev" data-type="mast">+ Add mast</button><button class="btn" data-act="adddev" data-type="lidar">+ Add lidar</button></div>
      <section class="panel"><header><h3>Combining the devices</h3><span class="computed" data-live="meassig|">${LIVE.meassig()}</span></header>
        ${state.devices.length > 1 ? `<div class="grid2">${numField({ path: 'deviceCorr', label: 'Correlation between device errors', step: 0.05, min: 0, max: 1, hint: '0 = fully independent, 1 = errors move together. A lidar verified against the same mast shares part of its error: 0.5–0.7 is a reasonable range.' })}</div>` : '<p class="note">With one device, its uncertainty is the measurement uncertainty. Add a second device to see how independent measurements reduce it.</p>'}
        <p class="formula">σ = √(Σᵢ Σⱼ wᵢ wⱼ ρᵢⱼ σᵢ σⱼ), w = shares normalised to 1</p>
      </section>
      <h4>Applies to the whole campaign</h4>
      ${cardsFor('measurement')}
      </div>${stageNav('measurement')}`;
  }

  function desktopNote(id) {
    return `${stageHead(id)}<p class="note">In desktop mode this stage is part of the wind atlas uncertainty under Measurement. Switch the wind data to on-site in Project to assess it separately.</p>${stageNav(id)}`;
  }

  function stageHistorical() {
    if (state.setup.dataSource === 'desktop') return desktopNote('historical');
    return `${stageHead('historical')}<div class="stack">${cardsFor('historical')}</div>${stageNav('historical')}`;
  }

  function vzText() {
    const v = state.vertical, hub = +state.plant.hubH;
    const hm = +v.hMeas || hub;
    if (hm >= hub) return 'No vertical extrapolation: the measurement is at or above hub height.';
    return `Extrapolating ${fx(hub - hm, 0)} m, from ${fx(hm, 0)} m to ${fx(hub, 0)} m (ln ratio ${fx(Math.log(hub / hm), 3)}).`;
  }
  function stageVertical() {
    if (state.setup.dataSource === 'desktop') return desktopNote('vertical');
    return `${stageHead('vertical')}<div class="stack">
      <section class="panel"><header><h3>Heights and shear</h3></header><div class="grid2">
        ${numField({ path: 'vertical.hMeas', label: 'Height of the measurement carried to hub height', unit: 'm', step: 1 })}
        ${numField({ path: 'vertical.hLow', label: 'Lower height used for the shear exponent', unit: 'm', step: 1 })}
        ${numField({ path: 'vertical.alpha', label: 'Measured shear exponent α', step: 0.01 })}
      </div>
      ${segField({ path: 'vertical.shear', label: 'How predictable is the shear?', options: [['simple', 'Simple: open, flat'], ['moderate', 'Moderate'], ['complex', 'Complex: forest, ridges, stable nights']] })}
      <p class="computed" data-live="vz|">${vzText()}</p></section>
      ${cardsFor('vertical')}</div>${stageNav('vertical')}`;
  }

  function stageHorizontal() {
    if (state.setup.dataSource === 'desktop') return desktopNote('horizontal');
    const t = TERRAIN.find(x => x[0] === state.setup.terrain);
    return `${stageHead('horizontal')}<div class="stack">
      <p class="note">Terrain is set to <b>${esc(t ? t[1] : state.setup.terrain)}</b> in Project. Measurement locations with a share above zero: <b data-live="nmeas|">${LIVE.nmeas()}</b>.</p>
      ${cardsFor('horizontal')}</div>${stageNav('horizontal')}`;
  }

  function iavTable() {
    const it = itemMap()[isSolar() ? 'ghi_iav' : 'ws_iav'], S = C().en.S;
    if (!it || it.mode === 'none') return '<p class="note">Year-to-year variability is excluded.</p>';
    if (isSolar()) {
      const deg = itemMap().degradation;
      const rows = [1, 10, lifeN()].map(N => `<tr><td>${N}-year average</td><td>${pct(it.sigma / Math.sqrt(N))}</td><td>${pct(S * it.sigma / Math.sqrt(N))}</td><td>${deg && deg.mode !== 'none' ? fx(E.lossAt(deg, N).L, 1) + ' % ± ' + fx(E.lossAt(deg, N).s, 1) : '–'}</td></tr>`).join('');
      return `<div class="tblwrap"><table class="t"><thead><tr><th>Period</th><th>Variability, irradiation</th><th>Variability, energy</th><th>Average degradation</th></tr></thead><tbody>${rows}</tbody></table></div>`;
    }
    const rows = [1, 10, lifeN()].map(N => `<tr><td>${N}-year average</td><td>${pct(it.sigma / Math.sqrt(N))}</td><td>${pct(S * it.sigma / Math.sqrt(N))}</td><td>${pct(E.climateSigma(N, C().model))}</td></tr>`).join('');
    return `<div class="tblwrap"><table class="t"><thead><tr><th>Period</th><th>Variability, wind speed</th><th>Variability, energy</th><th>Climate change, wind speed</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function stageFuture() {
    return `${stageHead('future')}<div class="stack">${cardsFor('future')}
      <section class="panel"><header><h3>How the period changes these terms</h3></header><div data-live="iavtable|">${iavTable()}</div>
      <p class="formula">Year-to-year variability falls with the square root of the number of years. Climate change grows with the length of the period.</p></section>
      </div>${stageNav('future')}`;
  }

  function curveChart() {
    const ctx = C().model.ctx, fn = ctx.curve.fn, pr = Math.max(0.1, +state.plant.ratedMW || 1);
    const W = 640, H = 230, m = { l: 44, r: 16, t: 14, b: 32 };
    const vmax = Math.max(26, (+state.plant.cutOut || 25) + 1);
    const ymax = pr * 1.1;
    const x = v => m.l + v / vmax * (W - m.l - m.r), y = p => H - m.b - p / ymax * (H - m.t - m.b);
    let d = '';
    for (let v = 0; v <= vmax; v += 0.1) d += (d ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(fn(v)).toFixed(1);
    const xt = [0, 5, 10, 15, 20, 25].filter(v => v <= vmax);
    const yt = [0, pr / 2, pr];
    const mw = ctx.meanWs;
    return `<svg class="chart" id="pcChart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Power curve, rated ${fx(pr, 2)} MW">
      ${yt.map(p => `<line class="gr" x1="${m.l}" x2="${W - m.r}" y1="${y(p)}" y2="${y(p)}"/><text x="${m.l - 6}" y="${y(p) + 4}" text-anchor="end">${fx(p, p < 10 ? 1 : 0)}</text>`).join('')}
      <line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${y(0)}" y2="${y(0)}"/>
      ${xt.map(v => `<text x="${x(v)}" y="${H - m.b + 18}" text-anchor="middle">${v}</text>`).join('')}
      <text x="${W - m.r}" y="${H - 4}" text-anchor="end">wind speed, m/s</text>
      <text x="${m.l - 6}" y="${m.t - 2}" text-anchor="end">MW</text>
      <path class="ln" d="${d}"/>
      <line class="mk" x1="${x(mw)}" x2="${x(mw)}" y1="${m.t}" y2="${y(0)}"/><text class="mk-t" x="${x(mw) + 6}" y="${m.t + 10}">mean ${fx(mw, 2)} m/s</text>
      <circle class="dot" id="pcDot" r="5" cx="-20" cy="-20"/>
      <rect class="hit" x="${m.l}" y="${m.t}" width="${W - m.l - m.r}" height="${H - m.t - m.b}" data-curve="1" data-vmax="${vmax}" data-ml="${m.l}" data-mr="${m.r}" data-w="${W}"/>
    </svg>`;
  }
  function energyKv() {
    const en = C().en, ctx = C().model.ctx;
    return `<dl class="kv">
      <dt>Air density</dt><dd>${fx(en.rho, 3)} kg/m³</dd>
      <dt>Mean power per turbine</dt><dd>${fx(en.meanPowerMW, 3)} MW</dd>
      <dt>Gross energy (${ctx.nTurbines} turbines)</dt><dd>${fx(en.grossGWh, 1)} GWh/yr</dd>
      <dt>Gross capacity factor</dt><dd>${fx(en.grossCf * 100, 1)} %</dd>
      <dt>Sensitivity, calculated</dt><dd>${fx(en.sCalc, 2)}</dd>
      <dt>Sensitivity in use</dt><dd><b>${fx(en.S, 2)}</b></dd></dl>`;
  }
  function stageConversion() {
    return `${stageHead('conversion')}<div class="stack">
      <section class="panel"><header><h3>Power curve and wind climate</h3><span class="computed">${C().en.curveKind === 'custom' ? 'Manufacturer curve' : 'Generic curve'}</span></header>
        <div data-live="curve|">${curveChart()}</div>
        <div data-live="energy|">${energyKv()}</div></section>
      <section class="panel"><header><h3>Wind-speed-to-energy sensitivity</h3><span class="computed">S = <b data-live="sens|">${fx(C().en.S, 2)}</b></span></header>
        <p>A 1 % change in wind speed changes energy by about S %. The tool finds S by nudging the mean wind speed up and down by 1 % through your power curve and Weibull distribution. Low-wind sites typically sit near 2, high-wind sites near 1.5, because output flattens at rated power.</p>
        ${segField({ path: 'energy.sensMode', label: 'Sensitivity factor', options: [['computed', 'Calculate from the power curve'], ['entered', 'Enter from my report']] })}
        ${state.energy.sensMode === 'entered' ? `<div class="grid2">${numField({ path: 'energy.sens', label: 'Sensitivity factor', step: 0.01 })}</div>` : ''}
        <p class="formula">S = (ΔE/E) ÷ (ΔU/U). The Monte Carlo uses the full non-linear response, not just S.</p></section>
      ${cardsFor('conversion')}</div>${stageNav('conversion')}`;
  }

  function lossGroupStat(g, stageId) {
    const N = result.focusN;
    const items = result.model.items.filter(i => (i.domain === 'loss' || i.domain === 'en') && i.cat === g && (!stageId || i.stage === stageId));
    let eff = 1, v = 0, hasLoss = false;
    items.forEach(i => {
      if (i.domain === 'en') { v += i.sigma ** 2; return; }
      hasLoss = true;
      const la = E.lossAt(i, N); eff *= 1 - la.L / 100; const eta = Math.max(0.05, 1 - la.L / 100); v += (la.s / eta) ** 2;
    });
    const L = (1 - eff) * 100;
    return `${hasLoss ? `<b>${L < 0 ? fx(-L, 1) + ' % gain' : fx(L, 1) + ' % loss'}</b> · ` : ''}σ ≈ ${pct(Math.sqrt(v))} energy${items.some(i => i.time === 'horizon') ? ` (${hzLabel()})` : ''}`;
  }
  function groupedCards(stageId) {
    const groups = (Lb.GROUPS[isHybrid() ? 'hybrid' : tech()] || {})[stageId] || [];
    return groups.map(g => `<div class="group-head"><h4>${esc(g.name)}</h4><span class="computed" data-live="lossgroup|${stageId}:${g.id}">${lossGroupStat(g.id, stageId)}</span></div>
      ${cardsFor(stageId, d => d.cat === g.id)}`).join('');
  }
  function prKv() {
    const en = C().en, ctx = C().model.ctx;
    return `<dl class="kv"><dt>Irradiation on the array</dt><dd>${fx(en.refYield, 0)} kWh/m²</dd><dt>Reference energy (DC capacity × irradiation)</dt><dd>${fx(en.grossGWh, 1)} GWh/yr</dd><dt>Performance ratio, all losses</dt><dd>${fx(en.pr * 100, 1)} %</dd><dt>Specific yield, year 1</dt><dd>${fx(en.specYield, 0)} kWh/kWp</dd><dt>DC/AC ratio</dt><dd>${fx(ctx.dcac, 2)}</dd><dt>Net CUF (AC), year 1</dt><dd>${fx(en.cf * 100, 1)} %</dd></dl>`;
  }
  function lossTotal() {
    const en = C().en;
    if (isSolar()) return prKv();
    return `<dl class="kv"><dt>Gross energy</dt><dd>${fx(en.grossGWh, 1)} GWh/yr</dd><dt>Total loss</dt><dd>${fx((1 - en.eff) * 100, 1)} %</dd><dt>Plant efficiency</dt><dd>${fx(en.eff * 100, 1)} %</dd><dt>Net energy, tool estimate</dt><dd>${fx(en.netComputed, 1)} GWh/yr</dd></dl>`;
  }
  function stageLosses() {
    const groups = groupedCards('losses');
    return `${stageHead('losses')}<div class="stack">
      <section class="panel"><header><h3>Losses at a glance</h3></header><div data-live="losstotal|">${lossTotal()}</div>
        <p class="note">Each loss is a central value with its own uncertainty (σ in percentage points). Losses multiply: efficiency = Π(1 − loss).${isSolar() ? ' Degradation is a yearly rate: year 1 excludes it, longer periods include the average.' : ''} ${state.energy.p50Mode === 'entered' ? 'Your entered P50 is used for the results; the losses here still set the loss uncertainties.' : ''}</p></section>
      ${groups}</div>${stageNav('losses')}`;
  }

  function poiSummary() {
    const r = result, p50 = r.en.p50;
    const rows = [1, 10, r.model.ctx.life].map(N => `<tr${N === r.focusN ? ' class="hl"' : ''}><td>${N}-year average</td><td>${fx(r.H[N].sigma, 2)} %</td><td>${fx(r.H[N].pv.P90, 1)}</td><td>${fx(r.H[N].pv.P90 / r.H[N].p50 * 100, 1)} %</td></tr>`).join('');
    return `<dl class="kv"><dt>Net P50 at the POI${isSolar() ? ', year 1' : ''}</dt><dd>${fx(p50, 1)} GWh/yr</dd><dt>Installed capacity</dt><dd>${fx(r.model.ctx.capacityMW, 1)} MW</dd><dt>Net CUF at P50${isSolar() ? ' (AC, year 1)' : ''}</dt><dd>${fx(r.en.cf * 100, 1)} %</dd></dl>
      <div class="tblwrap"><table class="t"><thead><tr><th>Period</th><th>σ total</th><th>P90, GWh/yr</th><th>P90/P50</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function stagePoi() {
    return `${stageHead('poi')}<div class="stack">
      <section class="panel"><header><h3>Energy delivered at the POI</h3></header><div data-live="poisum|">${poiSummary()}</div></section>
      ${cardsFor('poi')}
      <p class="note">Metering uncertainty affects what you are paid for rather than what the plant produces. It is included so the P-values describe metered energy.</p>
      </div>${stageNav('poi')}`;
  }

  /* ---------- solar stages ---------- */
  function stageIrradiance() {
    const src = { satellite: 'satellite data only', adapted: 'satellite data, site-adapted with on-site sensors', ground: 'on-site measurement only' }[state.setup.solarSource] || '';
    return `${stageHead('irradiance')}<div class="stack">
      <p class="note">Irradiance data: <b>${esc(src)}</b>. Change this in Project. Long-term annual GHI in use: <b>${fx(+state.pv.ghi, 0)} kWh/m²</b>.</p>
      ${cardsFor('irradiance')}
      ${state.setup.solarSource === 'satellite' ? '<p class="note">On-site Class A sensors measured for 12 months or more usually cut this stage roughly in half. Switch the irradiance data to site-adapted in Project to see the effect.</p>' : ''}
      </div>${stageNav('irradiance')}`;
  }
  function stageSolarLt() {
    return `${stageHead('solar_lt')}<div class="stack">${cardsFor('solar_lt')}
      <section class="panel"><header><h3>How the period changes these terms</h3></header><div data-live="iavtable|">${iavTable()}</div>
      <p class="formula">Year-to-year variability falls with the square root of the number of years. Degradation (Plant losses) grows with the length of the period.</p></section>
      </div>${stageNav('solar_lt')}`;
  }
  function stagePoa() {
    const mount = { fixed: 'fixed tilt', tracker: 'single-axis tracker', ew: 'east-west' }[state.pv.mount] || state.pv.mount;
    return `${stageHead('poa')}<div class="stack">
      <p class="note">Mounting: <b>${esc(mount)}</b>, ${state.pv.bifacial ? 'bifacial' : 'monofacial'} modules. Plane-of-array to GHI ratio <b>${fx(+state.pv.poaRatio, 2)}</b>. Change these in Project.</p>
      ${cardsFor('poa')}</div>${stageNav('poa')}`;
  }
  function stagePvconv() {
    return `${stageHead('pvconv')}<div class="stack">
      <section class="panel"><header><h3>Performance at a glance</h3></header><div data-live="prkv|">${prKv()}</div></section>
      <section class="panel"><header><h3>Irradiance-to-energy sensitivity</h3><span class="computed">S = <b data-live="sens|">${fx(C().en.S, 2)}</b></span></header>
        <p>PV output is close to proportional to irradiation, so a 1 % irradiance error moves energy by about 1 %. Clipping at high DC/AC ratios and hotter modules in sunnier years make it slightly lower.</p>
        ${segField({ path: enPath() + '.sensMode', label: 'Sensitivity factor', options: [['computed', 'Use 1.0'], ['entered', 'Enter from my simulation']] })}
        ${getPath(state, enPath() + '.sensMode') === 'entered' ? `<div class="grid2">${numField({ path: enPath() + '.sens', label: 'Sensitivity factor', step: 0.01 })}</div>` : ''}</section>
      ${groupedCards('pvconv')}</div>${stageNav('pvconv')}`;
  }

  /* ---------- hybrid stages ---------- */
  function stagePvlosses() {
    return `${stageHead('pvlosses')}<div class="stack">
      <section class="panel"><header><h3>Solar plant at a glance</h3></header><div data-live="prkv|">${prKv()}</div>
        <p class="note">Degradation is a yearly rate: year 1 excludes it, longer periods include the average. Export line, grid availability and curtailment are shared with the wind plant and sit under Shared connection.</p></section>
      ${groupedCards('pvlosses')}</div>${stageNav('pvlosses')}`;
  }
  function hybridSummary() {
    const r = result, h = r.focus, w = h.parts.wind, so = h.parts.solar;
    const rows = [['Wind', w.p50, h.comb.aw, w.sigma], ['Solar', so.p50, h.comb.as, so.sigma]].map(([n, p, a, sg]) => `<tr><td>${n}</td><td>${fx(p, 1)}</td><td>${fx(a * 100, 0)} %</td><td>${fx(sg, 2)} %</td><td>${fx(p * Math.max(0, 1 - E.Z.P90 * sg / 100), 1)}</td></tr>`).join('');
    return `<div class="tblwrap"><table class="t"><thead><tr><th>${hzLabel()} average</th><th>P50, GWh/yr</th><th>Share of energy</th><th>σ on its own</th><th>P90 on its own</th></tr></thead><tbody>${rows}
      <tr class="hl"><td>Hybrid</td><td>${fx(h.p50, 1)}</td><td>100 %</td><td>${fx(h.sigma, 2)} %</td><td>${fx(h.pv.P90, 1)}</td></tr></tbody></table></div>
      <p>Adding the two P90s gives <b>${fx(h.sumP90, 1)} GWh/yr</b>, which assumes wind and solar always have bad years together. Treated as one plant, the P90 is <b>${fx(h.pv.P90, 1)} GWh/yr</b>: <b>${h.portfolioGain >= 0 ? '+' : ''}${fx(h.portfolioGain, 1)} GWh/yr</b> (${fx(h.portfolioGain / h.p50 * 100, 1)} % of P50). Each part's σ above includes the shared grid items.</p>
      <p class="formula">σ² = a_w² σ_w² + a_s² σ_s² + 2 a_w a_s (ρ_yearly σ_w,yearly σ_s,yearly + ρ_assessment σ_w,resource σ_s,resource) + shared items². Correlation term at ${hzLabel()}: ${r.crossVar >= 0 ? '+' : ''}${fx(r.crossVar, 2)} %².</p>`;
  }
  function stageHybrid() {
    return `${stageHead('hybrid')}<div class="stack">
      <section class="panel"><header><h3>Wind and solar together</h3><span class="computed">${hzLabel()}</span></header><div data-live="hybsum|">${hybridSummary()}</div></section>
      <section class="panel"><header><h3>How wind and solar errors relate</h3></header><div class="grid2">
        ${numField({ path: 'hybrid.rhoIav', label: 'Correlation of year-to-year resource variation', step: 0.05, min: -0.95, max: 0.95, hint: 'Do windy years also tend to be sunny (+) or cloudy (−)? Across the globe this is close to zero on average but strongly positive or negative in some regions. Estimate it from ERA5 or MERRA-2 annual anomalies at your site.' })}
        ${numField({ path: 'hybrid.rhoRes', label: 'Correlation between the two resource assessments', step: 0.05, min: -0.95, max: 0.95, hint: 'Usually close to 0: different instruments, models and data. Raise it if both assessments lean on the same reference dataset or consultant method.' })}
      </div><div class="srcs">${sourcesHtml(['iavcorr', 'e3'])}</div></section>
      <section class="panel"><header><h3>Grid connection</h3></header><p class="computed" data-live="conn|">${connText()}</p><p class="note">Set the export capacity in Project.</p></section>
      ${groupedCards('hybrid')}</div>${stageNav('hybrid')}`;
  }

  /* ---------- storage and firm supply ---------- */
  const firm = { key: '', res: null, central: null, drivers: null, running: false, progress: '', prep: null, warn: '' };
  const firmYear = () => (state.supply.year === 'life' ? lifeN() : Math.max(1, +state.supply.year || 1));
  function firmKey() { const o = clone(state); delete o.view; delete o.mc; delete o.meta; return JSON.stringify(o); }
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const WIN_LABEL = { peak: 'Peak hours', off: 'Off-peak hours', all: 'All hours' };
  function money(x) {
    const cur = state.supply.currency || 'INR';
    if (!isFinite(x)) return '–';
    if (cur === 'INR') return x >= 1e7 ? `₹${fx(x / 1e7, 2)} crore` : `₹${fx(x / 1e5, 2)} lakh`;
    const sym = { USD: '$', EUR: '€' }[cur] || '';
    return `${sym}${fx(x / 1e6, 2)} million${sym ? '' : ' ' + cur}`;
  }

  function stageBess() {
    const b = state.bess, dur = (+b.energyMWh || 0) / Math.max(0.01, +b.powerMW || 0);
    return `${stageHead('bess')}<div class="stack">
      <section class="panel"><header><h3>Battery</h3><span class="computed">Duration <b>${fx(dur, 1)} h</b></span></header><div class="grid2">
        ${numField({ path: 'bess.powerMW', label: 'Power rating at the POI', unit: 'MW', step: 1, min: 0, rerender: true })}
        ${numField({ path: 'bess.energyMWh', label: 'Usable energy at the start', unit: 'MWh', step: 1, min: 0, rerender: true })}
        ${isHybrid() ? '' : numField({ path: 'bess.gridMW', label: 'Export capacity at the POI', unit: 'MW', step: 1, min: 0, hint: '0 means the plant capacity.' })}
      </div>
      ${segField({ path: 'bess.augment', label: 'Augmentation', type: 'bool', options: [['false', 'None'], ['true', 'Top up to keep a minimum capacity']] })}
      ${state.bess.augment ? `<div class="grid2">${numField({ path: 'bess.augTarget', label: 'Capacity kept at or above', unit: '% of start', step: 1, min: 0, max: 100 })}</div>` : ''}
      <p class="note">The battery charges only from the plant and discharges through the same export limit. Each simulated year draws its capacity, fade, efficiency, outages and dispatch shortfall from the items below.</p></section>
      ${cardsFor('bess')}</div>${stageNav('bess')}`;
  }

  function peakGrid() {
    const set = new Set((state.supply.peakHours || []).map(Number));
    return `<div class="field"><span class="lab">Peak hours (tap to change)</span><div class="hours" role="group" aria-label="Peak hours">${Array.from({ length: 24 }, (_, h) => `<button data-act="peakhr" data-h="${h}" aria-pressed="${set.has(h)}" aria-label="${h}:00 to ${h + 1}:00">${String(h).padStart(2, '0')}</button>`).join('')}</div>
      <span class="hint">${set.size} peak hours a day. Hours start at the label, so 21 means 21:00–22:00.</span></div>`;
  }
  function rulesTable() {
    const rules = Firm.rulesFor(state.supply);
    return `<div class="tblwrap"><table class="t"><thead><tr><th>Rule</th><th>Basis</th><th>Minimum DFR</th></tr></thead><tbody>${rules.map(r => `<tr><td class="txt">${esc(WIN_LABEL[r.window])}</td><td>${r.basis === 'monthly' ? 'each month' : 'over the year'}</td><td><div class="inp" style="max-width:130px;margin-left:auto"><input type="number" step="1" min="0" max="100" data-path="supply.targets.${r.id}" value="${r.target}" aria-label="${esc(r.label)} minimum DFR"><span class="unit">%</span></div>${r.relax ? `<div class="computed" style="margin-top:4px">${r.relax.allow} of Jul–Sep may fall to <input type="number" step="1" min="0" max="100" data-path="supply.targets.${r.id}_relax" value="${r.relax.target}" style="width:54px" aria-label="Relaxed minimum"> %</div>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
  }
  function profileStatus() {
    const pr = state.supply.profile || {};
    if (pr.kind !== 'upload') return '';
    return `<p class="computed">Uploaded: <b>${esc(pr.name || 'profile')}</b>, ${pr.rows || 8760} hours${pr.wind ? ', wind' : ''}${pr.solar ? ', solar' : ''}. <button class="btn small ghost" data-act="clearprofile">Remove</button></p>`;
  }
  function stageSupply() {
    const sp = state.supply, preset = Firm.PRESETS[sp.preset] || Firm.PRESETS.fdre4, key = firmKey();
    const stale = firm.res && firm.key !== key;
    const prof = sp.profile || {};
    return `${stageHead('supply')}<div class="stack">
      <section class="panel"><header><h3>Supply obligation</h3></header>
        ${segField({ path: 'supply.preset', label: 'Rule set', options: Object.entries(Firm.PRESETS).map(([k, v]) => [k, v.label]), hint: esc(preset.note) })}
        <div class="grid2">
          ${numField({ path: 'supply.contractMW', label: 'Contracted capacity (demand in peak hours)', unit: 'MW', step: 1, min: 0 })}
          ${numField({ path: 'supply.offFrac', label: 'Off-peak demand as a share of contracted capacity', step: 0.05, min: 0, max: 1.5, hint: '1 = flat round-the-clock demand; 0 = peak hours only.' })}
          ${numField({ path: 'supply.reserve', label: 'Battery energy held back for peak hours', step: 0.05, min: 0, max: 1, hint: 'Share of usable energy the battery keeps outside peak hours.' })}
        </div>
        ${peakGrid()}
        ${rulesTable()}
        <p class="formula">DFR for a window = mean over its hours of min(supplied ÷ demand, 1), per SECI FDRE-IV. ${sourcesHtml(['fdre4', 'fdre4a2', 'seci26'])}</p>
        ${segField({ path: 'supply.allowExcess', label: 'Energy beyond the demand', type: 'bool', options: [['true', 'Sell it (within the export limit)'], ['false', 'Curtail it']] })}
      </section>
      <section class="panel"><header><h3>Shortfall penalty</h3></header><div class="grid2">
        ${numField({ path: 'supply.tariff', label: 'Tariff', unit: (sp.currency || 'INR') + '/kWh', step: 0.01, min: 0 })}
        ${numField({ path: 'supply.penaltyMult', label: 'Penalty multiple of the tariff', step: 0.1, min: 0, hint: 'SECI FDRE-IV uses 1.5 × tariff on the shortfall energy.' })}
        ${selField({ path: 'supply.currency', label: 'Currency', options: [['INR', 'Indian rupee'], ['USD', 'US dollar'], ['EUR', 'Euro'], ['other', 'Other']] })}
      </div></section>
      <section class="panel"><header><h3>Hourly profiles</h3><span class="computed">${prof.kind === 'upload' ? 'Uploaded' : 'Generated'}</span></header>
        <p class="note">${prof.kind === 'upload' ? 'Your hourly profile sets the shape within the year.' : 'No hourly profile uploaded. The tool generates one from your plant and an illustrative seasonal pattern. Shape matters for firm supply, so upload a simulated 8760-hour profile when you have one.'} Profiles are scaled to the P50s in the chain${isHybrid() ? ' (after shared grid losses, before the export limit, which the simulation applies hour by hour)' : ''}.</p>
        ${profileStatus()}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><label class="btn" for="profFile">Upload hourly profile (CSV)</label><input id="profFile" class="sr" type="file" accept=".csv,.txt,text/csv,text/plain" data-act="profile">
          <span class="hint" style="font-size:.78rem;color:var(--ink-3)">One row per hour for a year; last two columns ${ptech() === 'hybrid' ? 'wind MW, solar MW' : ptech() === 'solar' ? '(or one column) solar MW' : '(or one column) wind MW'}. A header row is fine.</span></div>
        ${prof.kind === 'upload' ? segField({ path: 'supply.profileScale', label: 'Scale the uploaded profile', type: 'bool', options: [['true', 'To the P50s in the chain'], ['false', 'Use as is (MW)']] }) : `
          ${segField({ path: 'supply.season', label: 'Seasonal pattern for the generated profile', options: [['monsoon', 'Monsoon: wind peak Jun–Aug, cloudy Jul–Aug'], ['flat', 'No seasonality']] })}
          <div class="grid2">${numField({ path: 'supply.latitude', label: 'Latitude', unit: '°', step: 0.5 })}${ptech() !== 'solar' ? numField({ path: 'supply.windPeakHour', label: 'Hour of the daily wind peak', step: 1, min: 0, max: 23 }) : ''}</div>`}
        ${firm.warn ? `<p class="warn">${esc(firm.warn)}</p>` : ''}
      </section>
      <section class="panel"><header><h3>Run the simulation</h3></header>
        <div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
          ${segField({ path: 'supply.year', label: 'Operating year', options: [['1', 'Year 1'], ['10', 'Year 10'], ['life', 'Year ' + lifeN()]] })}
          <div style="width:170px">${selField({ path: 'supply.samples', label: 'Simulated years', options: [['200', '200'], ['400', '400'], ['1000', '1,000'], ['2000', '2,000']] })}</div>
          <button class="btn primary" data-act="firmrun" ${firm.running ? 'disabled' : ''}>${firm.running ? 'Running…' : firm.res ? 'Run again' : 'Run simulation'}</button>
          <button class="btn" data-act="firmdrivers" ${firm.running || !firm.res ? 'disabled' : ''}>Find what drives the risk</button>
        </div>
        <p class="status" id="firmStatus">${esc(firm.progress)}</p>
        <p class="formula">Each simulated year draws wind and solar energy from the uncertainty chain (one-year horizon${isHybrid() ? ', with the wind–solar correlations' : ''}), reshuffles days within each month, and draws battery capacity, fade, efficiency, outages and dispatch shortfall. Dispatch is hourly and rule-based.</p>
      </section>
      ${firm.res ? `${stale ? '<p class="warn">Inputs changed since this run. Run again to update.</p>' : ''}${firmResults()}` : ''}
      </div>${stageNav('supply')}`;
  }

  function firmResults() {
    const r = firm.res, c = firm.central;
    const rules = Firm.rulesFor(state.supply);
    const tiles = `<div class="tiles">
      <div class="tile key"><span class="lbl">Chance of meeting every rule, year ${r.year}</span><span class="val">${fx(r.pMeet * 100, 0)} <small>%</small></span><span class="sub">${r.n.toLocaleString('en')} simulated years</span></div>
      <div class="tile"><span class="lbl">Months below target, average</span><span class="val">${fx(r.failedMonths, 1)}</span><span class="sub">per year</span></div>
      <div class="tile"><span class="lbl">Shortfall energy, P50 / P90</span><span class="val">${fx(r.shortfall.p50 / 1000, 2)} <small>/ ${fx(r.shortfall.p90 / 1000, 2)} GWh</small></span><span class="sub">below the minimum DFR</span></div>
      <div class="tile"><span class="lbl">Penalty, P50 / P90</span><span class="val" style="font-size:1.35rem">${state.supply.tariff > 0 ? `${money(r.penalty.p50)}<br><small>/ ${money(r.penalty.p90)}</small>` : '<small>Set a tariff</small>'}</span><span class="sub">${fx(state.supply.penaltyMult, 1)} × tariff on shortfall</span></div>
    </div>`;
    const ruleRows = r.perRule.map((x, i) => { const wi = { peak: 0, off: 1, all: 2 }[x.window]; const d = r.dfr[wi]; return `<tr><td class="txt">${esc(WIN_LABEL[x.window])}, ${x.basis === 'monthly' ? 'each month' : 'annual'} ≥ ${fx(x.target, 0)} %</td><td>${fx(x.pMet * 100, 0)} %</td><td>${x.basis === 'monthly' ? fx(x.failedMonths, 2) : '–'}</td><td>${d.p50 != null ? fx(d.p50 * 100, 1) + ' %' : '–'}</td><td>${d.p10 != null ? fx(d.p10 * 100, 1) + ' %' : '–'}</td></tr>`; }).join('');
    const energy = `<dl class="kv">
      <dt>Delivered energy with storage, P50</dt><dd>${fx(r.delivered.p50 / 1000, 1)} GWh/yr</dd>
      <dt>Delivered energy with storage, P90</dt><dd>${fx(r.delivered.p90 / 1000, 1)} GWh/yr</dd>
      <dt>Supplied against demand, P50</dt><dd>${fx(r.served.p50 / 1000, 1)} GWh/yr</dd>
      <dt>Sold beyond demand, P50</dt><dd>${fx(r.excess.p50 / 1000, 1)} GWh/yr</dd>
      <dt>Curtailed (export limit or full battery), P50</dt><dd>${fx(r.curtailed.p50 / 1000, 1)} GWh/yr</dd>
      <dt>Battery cycles a year</dt><dd>${fx(r.cycles.mean, 0)}</dd></dl>`;
    const drv = firm.drivers ? `<section class="panel"><header><h3>What drives the risk</h3><span class="computed">each group held at its central value, ${firm.drivers.n} years</span></header>
      <div class="tblwrap"><table class="t"><thead><tr><th>Held fixed</th><th>Chance of meeting</th><th>Change</th><th>Shortfall P90</th><th>Change</th></tr></thead><tbody>
      <tr class="hl"><td class="txt">Nothing (all uncertainties)</td><td>${fx(firm.drivers.base.pMeet * 100, 0)} %</td><td>–</td><td>${fx(firm.drivers.base.shortfall.p90 / 1000, 2)} GWh</td><td>–</td></tr>
      ${firm.drivers.groups.map(g => `<tr><td class="txt">${esc(g.label)}</td><td>${fx(g.pMeet * 100, 0)} %</td><td>${g.dP >= 0 ? '+' : ''}${fx(g.dP * 100, 0)} pts</td><td>${fx(g.sf90 / 1000, 2)} GWh</td><td>${g.dSf90 >= 0 ? '+' : ''}${fx(g.dSf90 / 1000, 2)}</td></tr>`).join('')}
      </tbody></table></div><p class="formula">The largest reductions in shortfall show where better information or design buys the most.</p></section>` : '';
    return `${tiles}
      <section class="panel"><header><h3>Rules</h3><span class="computed">DFR shown as the yearly value: P50 and P10</span></header><div class="tblwrap"><table class="t"><thead><tr><th>Rule</th><th>Met</th><th>Months below, average</th><th>DFR P50</th><th>DFR P10</th></tr></thead><tbody>${ruleRows}</tbody></table></div></section>
      <section class="panel"><header><h3>Monthly DFR</h3><span class="computed">P50 bars, P10 marks, minimum lines</span></header>${monthChart(r, rules)}</section>
      <section class="panel"><header><h3>An average day, central case</h3><span class="computed">year ${r.year}, MW</span></header>${dayChart(c)}</section>
      <section class="panel"><header><h3>Energy</h3></header>${energy}</section>
      ${drv}`;
  }

  function monthChart(r, rules) {
    const wins = [...new Set(rules.filter(x => x.basis === 'monthly').map(x => x.window))];
    if (!wins.length) wins.push('all');
    const series = wins.slice(0, 2);
    const W = 640, H = 250, m = { l: 40, r: 78, t: 16, b: 42 };
    const vals = []; series.forEach(w => { const wi = { peak: 0, off: 1, all: 2 }[w]; r.monthly[wi].forEach(x => { if (x.p10 != null) vals.push(x.p10); }); });
    const ymin = Math.max(0, Math.min(0.6, Math.floor((Math.min(...vals, 0.7) - 0.05) * 10) / 10));
    const y = v => H - m.b - (v - ymin) / (1 - ymin) * (H - m.t - m.b);
    const gw = (W - m.l - m.r) / 12, bw = Math.min(18, (gw - 8) / series.length);
    const ticks = []; for (let v = ymin; v <= 1.0001; v += 0.1) ticks.push(v);
    let marks = '';
    series.forEach((w, si) => {
      const wi = { peak: 0, off: 1, all: 2 }[w];
      r.monthly[wi].forEach((x, mi) => {
        if (x.p50 == null) return;
        const x0 = m.l + mi * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2 + si * (bw + 2);
        const top = y(Math.max(ymin, x.p50)), base = y(ymin);
        marks += `<path class="bar s${si + 1}" d="M${x0},${base} V${top + 4} q0,-4 4,-4 h${bw - 8} q4,0 4,4 V${base} Z" data-tip="${MONTHS[mi]} · ${esc(WIN_LABEL[w])}: P50 ${fx(x.p50 * 100, 1)} %, P10 ${fx(x.p10 * 100, 1)} %"/>`;
        if (x.p10 != null) marks += `<line class="p10" x1="${x0 + 2}" x2="${x0 + bw - 2}" y1="${y(Math.max(ymin, x.p10))}" y2="${y(Math.max(ymin, x.p10))}"/>`;
      });
    });
    const tl = rules.filter(x => x.basis === 'monthly' && series.includes(x.window)).map(x => `<line class="mk" x1="${m.l}" x2="${W - m.r}" y1="${y(x.target / 100)}" y2="${y(x.target / 100)}"/><text class="mk-t" x="${W - m.r + 6}" y="${y(x.target / 100) + 4}" text-anchor="start">${fx(x.target, 0)} %${series.length > 1 ? ' ' + { peak: 'peak', off: 'off', all: 'all' }[x.window] : ' min'}</text>`).join('');
    const legend = series.length > 1 ? `<div class="legend">${series.map((w, i) => `<span><i class="sw s${i + 1}"></i>${esc(WIN_LABEL[w])}</span>`).join('')}<span><i class="sw p10k"></i>P10</span></div>` : `<div class="legend"><span><i class="sw s1"></i>${esc(WIN_LABEL[series[0]])} P50</span><span><i class="sw p10k"></i>P10</span></div>`;
    return `<div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly DFR, P50 and P10">
      ${ticks.map(v => `<line class="gr" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${fx(v * 100, 0)}</text>`).join('')}
      ${marks}${tl}
      ${MONTHS.map((mo, i) => `<text x="${m.l + i * gw + gw / 2}" y="${H - m.b + 16}" text-anchor="middle">${mo}</text>`).join('')}
      <text x="${m.l - 6}" y="${m.t - 4}" text-anchor="end">%</text></svg></div>${legend}`;
  }

  function dayChart(c) {
    if (!c) return '';
    const tr = c.res.trace, W = 640, H = 230, m = { l: 44, r: 14, t: 14, b: 32 };
    const ser = [['Generation', tr.gen, 's1'], ['Demand', tr.dem, 's2'], ['Supplied', tr.srv, 's3']];
    const ymax = Math.max(1, ...tr.gen, ...tr.dem) * 1.1;
    const x = h => m.l + h / 23 * (W - m.l - m.r), y = v => H - m.b - v / ymax * (H - m.t - m.b);
    const step = ymax > 200 ? 100 : ymax > 80 ? 40 : ymax > 40 ? 20 : 10;
    const ticks = []; for (let v = 0; v <= ymax; v += step) ticks.push(v);
    const lines = ser.map(([n, a, cls]) => `<path class="ln ${cls}" d="${Array.from(a).map((v, h) => (h ? 'L' : 'M') + x(h).toFixed(1) + ' ' + y(v).toFixed(1)).join('')}"/>`).join('');
    const hits = Array.from({ length: 24 }, (_, h) => `<rect class="hit" x="${(x(h) - (W - m.l - m.r) / 46).toFixed(1)}" y="${m.t}" width="${((W - m.l - m.r) / 23).toFixed(1)}" height="${H - m.t - m.b}" data-tip="${String(h).padStart(2, '0')}:00 · generation ${fx(tr.gen[h], 1)} MW · demand ${fx(tr.dem[h], 1)} · supplied ${fx(tr.srv[h], 1)} · battery out ${fx(tr.dis[h], 1)}, in ${fx(tr.ch[h], 1)} · stored ${fx(tr.soc[h], 0)} MWh"/>`).join('');
    return `<div style="overflow-x:auto"><svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Average day: generation, demand and supply">
      ${ticks.map(v => `<line class="gr" x1="${m.l}" x2="${W - m.r}" y1="${y(v)}" y2="${y(v)}"/><text x="${m.l - 6}" y="${y(v) + 4}" text-anchor="end">${fx(v, 0)}</text>`).join('')}
      ${[0, 6, 12, 18, 23].map(h => `<text x="${x(h)}" y="${H - m.b + 18}" text-anchor="middle">${String(h).padStart(2, '0')}:00</text>`).join('')}
      ${lines}${hits}</svg></div>
      <div class="legend">${ser.map(([n, , cls]) => `<span><i class="sw ${cls}"></i>${n}</span>`).join('')}</div>
      <p class="formula">Year-${firm.res ? firm.res.year : 1} central case: no resource error, the base weather year, nominal battery. Supplied can sit above generation when the battery discharges.</p>`;
  }

  async function runFirm(withDrivers) {
    if (firm.running) return;
    firm.running = true; firm.progress = 'Preparing hourly profiles…';
    if (pvMode() || stage === 'supply') renderStage(true);
    await new Promise(r => setTimeout(r, 20));
    try {
      recompute();
      const prep = Firm.prepare(state, result, E, Lb);
      firm.warn = prep.warn;
      const n = +state.supply.samples || 400, year = firmYear();
      const tick = async (d, t) => { firm.progress = withDrivers ? `Testing group ${d} of ${t}…` : `Simulated ${d} of ${t} years…`; const el = $('#firmStatus'); if (el) el.textContent = firm.progress; await new Promise(r => setTimeout(r, 0)); };
      if (withDrivers) firm.drivers = await Firm.drivers(prep, { n: Math.min(n, 400), year }, tick);
      else {
        firm.res = await Firm.run(prep, { n, year }, tick);
        firm.central = Firm.central(prep, year);
        firm.drivers = null;
        firm.key = firmKey();
      }
      firm.progress = withDrivers ? 'Done.' : `Done: ${n.toLocaleString('en')} years simulated.`;
    } catch (e) {
      firm.progress = 'The simulation could not run: ' + (e && e.message || e);
    } finally {
      firm.running = false;
      if (pvMode() || stage === 'supply' || stage === 'results') renderStage(true);
      renderRail();
    }
  }
  function firmSummary() {
    if (!hasBess()) return '';
    if (!firm.res) return `<section class="panel"><header><h3>Firm supply</h3></header><p class="note">The battery and supply obligation have not been simulated yet. <button class="btn small" data-stage="supply">Open Firm supply</button></p></section>`;
    const r = firm.res, stale = firm.key !== firmKey();
    return `<section class="panel"><header><h3>Firm supply</h3><span class="computed">year ${r.year}, ${r.n.toLocaleString('en')} simulated years</span></header>
      ${stale ? '<p class="warn">Inputs changed since the last run.</p>' : ''}
      <dl class="kv"><dt>Chance of meeting every rule</dt><dd>${fx(r.pMeet * 100, 0)} %</dd><dt>Shortfall P50 / P90</dt><dd>${fx(r.shortfall.p50 / 1000, 2)} / ${fx(r.shortfall.p90 / 1000, 2)} GWh</dd>${state.supply.tariff > 0 ? `<dt>Penalty P90</dt><dd>${money(r.penalty.p90)}</dd>` : ''}<dt>Delivered with storage, P50 / P90</dt><dd>${fx(r.delivered.p50 / 1000, 1)} / ${fx(r.delivered.p90 / 1000, 1)} GWh</dd></dl>
      <p class="side-note">The P-values above describe generation before storage. Delivered energy with the battery comes from the hourly simulation.</p>
      <button class="btn small" data-stage="supply">Open Firm supply</button></section>`;
  }

  function applyPreset() {
    const p = Firm.PRESETS[state.supply.preset];
    if (!p) return;
    state.supply.peakHours = p.peakHours.slice(); state.supply.offFrac = p.offFrac; state.supply.reserve = p.reserve; state.supply.targets = {};
  }
  function loadProfile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      const r = Firm.parseProfile(fr.result);
      if (r.error) { firm.warn = r.error; renderStage(true); return; }
      const pr = { kind: 'upload', name: file.name, rows: 8760 };
      if (r.single) { if (ptech() === 'solar') pr.solar = Firm.toB64(r.single); else pr.wind = Firm.toB64(r.single); }
      else { if (ptech() !== 'solar') pr.wind = Firm.toB64(r.wind); if (ptech() !== 'wind') pr.solar = Firm.toB64(r.solar); if (ptech() === 'solar' && !pr.solar) pr.solar = Firm.toB64(r.solar); }
      state.supply.profile = pr; firm.warn = ''; touch(); renderStage(true); updateChrome();
    };
    fr.onerror = () => { firm.warn = 'The file could not be read.'; renderStage(true); };
    fr.readAsText(file);
  }

  /* ---------- results ---------- */
  function stageOrderName(id) { return stageName(id); }
  function stageBars() {
    const tot = result.focus.sigma ** 2;
    const rows = chainOf().filter(id => result.stages[id] && result.stages[id].variance > 0).map(id => {
      const s = result.stages[id];
      const segs = TIER_ORDER.filter(t => s.tiers[t] > 0 && s.variance > 0).map(t => `<span class="${TIER[t].cls}" style="flex:${s.tiers[t]}" data-tip="${esc(stageOrderName(id))} · ${TIER[t].label}: ${fx(s.tiers[t] / tot * 100, 1)} % of variance"></span>`).join('');
      const share = s.variance / tot;
      return `<div class="bar-row"><div class="bl">${esc(stageOrderName(id))}<small>σ ${pct(s.sigma)}</small></div><div class="bar-track"><div style="display:flex;gap:2px;width:${Math.max(0.5, share * 100)}%">${segs}</div></div><div class="bv">${fx(share * 100, 0)} %</div></div>`;
    }).join('');
    return `<div class="bars">${rows}</div>`;
  }
  function topItems(n) {
    const list = result.contrib.filter(c => c.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, n);
    const max = list.length ? list[0].share : 1;
    return `<div class="bars">${list.map(c => {
      const it = c.item, t = TIER[it.tier];
      return `<div class="bar-row"><div class="bl">${esc(it.name)}<small>${it.comp ? COMP_LABEL[it.comp] + ' · ' : ''}${esc(stageOrderName(it.stage))}${it.deviceName ? ' · ' + esc(it.deviceName) : ''}</small></div><div class="bar-track"><span class="${t.cls}" style="width:${Math.max(0.8, c.share / max * 100)}%;border-radius:0 4px 4px 0" data-tip="${esc(it.name)} · ${t.label} · ${fx(c.share * 100, 1)} % of variance"></span></div><div class="bv">${fx(c.share * 100, 1)} %</div></div>`;
    }).join('')}</div>`;
  }
  function reduceList() {
    const list = result.reduce.filter(x => x.gainGWh > 0.0001).slice(0, 6);
    if (!list.length) return '<p class="note">Nothing left to reduce.</p>';
    return `<ol class="reduce">${list.map(x => `<li><div><b>${esc(x.item.name)}</b>${x.item.comp ? ` <span class="computed">· ${COMP_LABEL[x.item.comp]}</span>` : ''}${x.item.deviceName ? ` <span class="computed">· ${esc(x.item.deviceName)}</span>` : ''}<br><span class="computed">${TIER[x.item.tier].label}</span></div><div class="rg">+${fx(x.gainGWh, 1)} GWh/yr<br><span class="computed">+${fx(x.gainPct, 2)} % of P50</span></div><div class="ra">${esc((x.item.def.info && x.item.def.info.reduce) || '')}</div></li>`).join('')}</ol>`;
  }
  function pTable() {
    const r = result, p50 = r.en.p50, Ns = [1, 10, r.model.ctx.life];
    const head = `<tr><th>Exceedance level</th>${Ns.map(N => `<th>${N}-year</th>`).join('')}</tr>`;
    const body = E.PLEVELS.map(p => `<tr${p === 'P90' ? ' class="hl"' : ''}><td>${p}</td>${Ns.map(N => `<td>${fx(r.H[N].pv[p], 1)} <span style="color:var(--ink-3)">${fx(r.H[N].pv[p] / r.H[N].p50 * 100, 1)}%</span></td>`).join('')}</tr>`).join('');
    const sig = `<tr><td>σ total</td>${Ns.map(N => `<td>${fx(r.H[N].sigma, 2)} %</td>`).join('')}</tr>`;
    const cuf = `<tr><td>CUF at P90</td>${Ns.map(N => `<td>${fx(r.H[N].pv.P90 * 1000 / (r.model.ctx.capacityMW * 8760) * 100, 1)} %</td>`).join('')}</tr>`;
    return `<div class="tblwrap"><table class="t"><thead>${head}</thead><tbody>${body}${sig}${cuf}</tbody></table></div><p class="formula">GWh/yr and share of P50. Pxx = P50 × (1 − z·σ), z90 = 1.282, z99 = 2.326.${hasSolar() ? ' The 1-year column is year 1; longer periods include the average solar degradation, so their P50 is lower.' : ''}</p>`;
  }
  function checksHtml() {
    const out = [];
    if (isHybrid()) {
      const h = result.focus;
      out.push(`<p class="note"><b>Portfolio effect.</b> Adding separate wind and solar P90s assumes they always have bad years together, which 3E calls a structural conservative bias. Here the combined P90 is ${h.portfolioGain >= 0 ? 'higher' : 'lower'} by ${fx(Math.abs(h.portfolioGain), 1)} GWh/yr at the ${hzLabel()} level. ${sourcesHtml(['e3'])}</p>`);
      const ex = result.model.items.find(i => i.id === 'hy_export_limit');
      if (ex && result.model.ctx.connFrac < 0.95) out.push(`<p class="note"><b>Export limit.</b> The connection is ${fx(result.model.ctx.connFrac * 100, 0)} % of combined capacity, giving ${fx(ex.L, 2)} % curtailment ± ${fx(ex.sigma, 2)}. Confirm it with a joint time-series simulation of both plants (15-minute or finer). ${sourcesHtml(['grab'])}</p>`);
      if (Math.abs(result.model.ctx.rhoIav) < 0.01) out.push(`<p class="note"><b>Correlation.</b> Year-to-year wind and solar variation is assumed independent. Check ERA5 or MERRA-2 annual anomalies at the site; regional correlations can be strongly positive or negative. ${sourcesHtml(['iavcorr'])}</p>`);
      const wOut = [], sOut = [];
      windChecks(wOut, result.wind); solarChecks(sOut, result.solar); commonChecks(sOut);
      return out.join('') + wOut.join('') + sOut.join('');
    }
    if (isSolar()) solarChecks(out, result); else windChecks(out, result);
    commonChecks(out);
    return out.join('');
  }
  function windChecks(out, rr) {
    out.push(`<p class="note"><b>Track record.</b> Comparing 94 operating plants with their pre-construction estimates, Hammond & Simley (2026) found P50s about 6.6–7.4 % too high for plants commissioned from 2011, and P90s that were not conservative enough. Check your P50 against operating data from nearby plants. ${sourcesHtml(['hammond'])}</p>`);
    const wake = rr.model.items.find(i => i.id === 'wake_int');
    if (wake && wake.L > 0) out.push(`<p class="note"><b>Wakes.</b> Vaisala found operating wake losses about 21 % larger than modelled. For your ${fx(wake.L, 1)} % wake loss that would mean about ${fx(wake.L * 1.21, 1)} %. ${sourcesHtml(['vaisala'])}</p>`);
    if (state.setup.dataSource === 'desktop') out.push(`<p class="warn"><b>Desktop estimate.</b> Global Wind Atlas wind speeds were on average 8.5 % too high against 50 masts. With a sensitivity of ${fx(rr.en.S, 2)}, that is roughly ${fx(8.5 * rr.en.S, 0)} % on energy. ${sourcesHtml(['rina'])}</p>`);
  }
  function commonChecks(out) {
    if (result.none.length) out.push(`<p class="warn"><b>Excluded items.</b> ${result.none.map(i => esc(i.name) + (i.comp && i.comp !== 'hybrid' ? ' (' + COMP_LABEL[i.comp].toLowerCase() + ')' : '') + (i.deviceName ? ' (' + esc(i.deviceName) + ')' : '')).join(', ')}.</p>`);
    if (result.mix.generic > 0.25) out.push(`<p class="warn"><b>Mostly generic.</b> ${fx(result.mix.generic * 100, 0)} % of the variance rests on generic defaults. The total is a starting point, not a site assessment.</p>`);
  }
  function solarChecks(out, rr) {
    out.push(`<p class="note"><b>Where assessors disagree.</b> IEA PVPS Task 13 found the biggest differences between assessors come from the irradiance database and site adaptation, degradation assumptions, total modelling uncertainty, and soiling and shading. Check those items first. ${sourcesHtml(['t13b'])}</p>`);
    const ctx = rr.model.ctx;
    const clip = rr.model.items.find(i => i.id === 'clipping');
    if (ctx.dcac >= 1.3) out.push(`<p class="note"><b>Clipping.</b> At a DC/AC ratio of ${fx(ctx.dcac, 2)}, hourly simulations underestimate clipping, and the effect grows with the ratio. Simulate with 15-minute or finer data.${clip && clip.mode === 'calc' && (clip.def.calc && state.items.clipping.inputs.sub === 'sub') ? '' : ''} ${sourcesHtml(['sgsub'])}</p>`);
    const sat = state.items.sat_model;
    if (state.setup.solarSource === 'satellite' && sat && sat.mode === 'desc' && +sat.choice === 2) out.push(`<p class="warn"><b>Free irradiance database.</b> Public databases can be off by several percent at a given site. Compare with a commercial dataset before relying on the P50. ${sourcesHtml(['t13'])}</p>`);
  }
  function mcHtml() {
    const key = JSON.stringify([state, state.view]);
    const stale = mc && mcKey !== key;
    const n = +state.mc.n || 50000;
    let body = '';
    if (mc) {
      const r = result, Ns = [1, 10, r.model.ctx.life];
      body = `${stale ? '<p class="warn">Inputs changed since this run. Run again to update.</p>' : ''}
        <div class="tblwrap"><table class="t"><thead><tr><th>P90, GWh/yr</th>${Ns.map(N => `<th>${N}-year</th>`).join('')}</tr></thead><tbody>
          <tr><td>Analytical (normal)</td>${Ns.map(N => `<td>${fx(r.H[N].pv.P90, 1)}</td>`).join('')}</tr>
          <tr><td>Monte Carlo</td>${Ns.map(N => `<td>${mc[N] ? fx(mc[N].pv.P90, 1) : '–'}</td>`).join('')}</tr>
          <tr><td>Monte Carlo P50</td>${Ns.map(N => `<td>${mc[N] ? fx(mc[N].pv.P50, 1) : '–'}</td>`).join('')}</tr>
          <tr><td>Monte Carlo P99</td>${Ns.map(N => `<td>${mc[N] ? fx(mc[N].pv.P99, 1) : '–'}</td>`).join('')}</tr>
        </tbody></table></div>
        ${mc[result.focusN] ? histChart(mc[result.focusN]) : ''}
        <p class="formula">${(mc[10] || mc[1]).n.toLocaleString('en')} samples. ${isHybrid() ? 'Wind and solar sampled together with the correlations you set, non-linear wind-to-energy response, solar degradation over the period, shared grid losses,' : isSolar() ? 'Linear irradiance-to-energy response, degradation over the period,' : 'Non-linear wind-to-energy response from the power curve,'} skewed (Weibull) availability losses, normal elsewhere. Differences from the analytical values show how much those effects matter for this project.</p>`;
    }
    return `<div class="stack" style="gap:10px"><div style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
      <div style="width:180px">${selField({ path: 'mc.n', label: 'Samples', options: [['20000', '20,000'], ['50000', '50,000'], ['100000', '100,000'], ['250000', '250,000']] })}</div>
      <button class="btn primary" data-act="mc" ${mcRunning ? 'disabled' : ''}>${mcRunning ? 'Running…' : mc ? 'Run again' : 'Run Monte Carlo'}</button></div>${body}</div>`;
  }
  function histChart(m) {
    const W = 640, H = 220, mg = { l: 16, r: 16, t: 26, b: 34 };
    const { lo, bw, bins } = m.hist, B = bins.length, maxc = Math.max(...bins) || 1;
    const x = v => mg.l + (v - lo) / (bw * B) * (W - mg.l - mg.r);
    const bwp = (W - mg.l - mg.r) / B;
    const yh = c => c / maxc * (H - mg.t - mg.b);
    const cols = bins.map((c, i) => { const h = yh(c); const x0 = mg.l + i * bwp + 1, w = Math.max(1, bwp - 2); return `<rect class="col" x="${x0.toFixed(1)}" y="${(H - mg.b - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, w / 2)}" data-tip="${fx(lo + i * bw, 1)}–${fx(lo + (i + 1) * bw, 1)} GWh/yr · ${fx(c / m.n * 100, 1)} % of samples"/>`; }).join('');
    const p90 = x(m.pv.P90), p50 = x(m.pv.P50);
    const ticks = [m.hist.lo, m.pv.P90, m.pv.P50, m.hist.hi];
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Distribution of net energy, ${m.N}-year average">
      <line class="ax" x1="${mg.l}" x2="${W - mg.r}" y1="${H - mg.b}" y2="${H - mg.b}"/>${cols}
      <line class="mk" x1="${p90}" x2="${p90}" y1="${mg.t - 8}" y2="${H - mg.b}"/><text class="mk-t" x="${p90 - 6}" y="${mg.t - 12}" text-anchor="end">P90 ${fx(m.pv.P90, 1)}</text>
      <line class="mk2" x1="${p50}" x2="${p50}" y1="${mg.t - 8}" y2="${H - mg.b}"/><text class="mk2-t" x="${p50 + 6}" y="${mg.t - 12}">P50 ${fx(m.pv.P50, 1)}</text>
      ${[ticks[0], ticks[3]].map((v, i) => `<text x="${x(v)}" y="${H - mg.b + 18}" text-anchor="${i ? 'end' : 'start'}">${fx(v, 0)}</text>`).join('')}
      <text x="${W / 2}" y="${H - 4}" text-anchor="middle">net energy, GWh/yr (${m.N}-year average)</text></svg>`;
  }
  function corrPanel() {
    const SC = [['irradiance_source', 'Irradiance data'], ['long_term_irradiance', 'Long-term'], ['plane_of_array', 'Plane of array']];
    const WC = [['measurement', 'Measurement'], ['historical_wind_resource', 'Long-term'], ['vertical_extrapolation', 'Vertical'], ['horizontal_extrapolation', 'Horizontal']];
    const grid = (cats, prefix) => { const pairs = []; for (let i = 0; i < cats.length; i++) for (let j = i + 1; j < cats.length; j++) pairs.push([cats[i], cats[j]]); return `<div class="grid2">${pairs.map(([a, b]) => numField({ path: `catCorr.${a[0]}|${b[0]}`, label: `${prefix}${a[1]} ↔ ${b[1]}`, step: 0.05, min: -0.9, max: 0.95 })).join('')}</div>`; };
    if (isHybrid()) return `<h4>Wind</h4>${grid(WC, '')}<h4>Solar</h4>${grid(SC, '')}<p class="formula">Correlation between categories within each plant. Correlation between wind and solar is set under Shared connection.</p>`;
    return `${grid(isSolar() ? SC : WC, '')}
      <p class="formula">Correlation between ${resWord()} categories. 0 treats them as independent, the most common practice. Positive values increase the total.</p>`;
  }
  function registerTable() {
    const S = result.en.S || 1;
    const contrib = {}; result.contrib.forEach(c => { contrib[c.key] = c; });
    const order = chainOf();
    const rows = result.model.items.slice().sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage)).map(it => {
      const c = contrib[it.key];
      const la = E.lossAt(it, result.focusN);
      const val = it.domain === 'ws' ? pct(it.sigma) + ' ws' : it.domain === 'res' ? pct(it.sigma) + ' irr' : it.domain === 'en' ? pct(it.sigma) + ' en' : it.time === 'horizon' ? `${fx(it.L, 2)} ± ${fx(it.sigma, 2)} %/yr` : `${fx(it.L, 1)} % ± ${fx(it.sigma, 2)}`;
      const ens = E.isRes(it.domain) ? (it._S != null ? it._S : S) * it.sigma : it.domain === 'en' ? it.sigma : la.s / Math.max(0.05, 1 - la.L / 100);
      return `<tr><td class="txt">${esc(it.name)}${it.deviceName ? `<br><span class="computed">${esc(it.deviceName)}</span>` : ''}</td>${isHybrid() ? `<td>${COMP_LABEL[it.comp] || ''}</td>` : ''}<td>${esc(stageOrderName(it.stage))}</td><td>${esc(it.cat)}<br>${esc(it.sub)}</td><td>${esc(E.IEC_BASIS[it.mode])}</td><td>${TIER[it.tier].label}</td><td>${val}</td><td>${pct(ens)}</td><td>${c ? fx(c.share * 100, 1) + ' %' : '–'}</td></tr>`;
    }).join('');
    return `<div class="tblwrap" style="max-height:520px"><table class="t"><thead><tr><th>Item</th>${isHybrid() ? '<th>Plant</th>' : ''}<th>Stage</th><th>${hasSolar() ? 'Category / subcategory' : 'IEC category / subcategory'}</th><th>Basis</th><th>Evidence</th><th>Value</th><th>Energy σ</th><th>Share (${hzLabel()})</th></tr></thead><tbody>${rows}</tbody></table></div>`;
  }
  function stageResults() {
    const r = result, pv = r.focus.pv, p50 = r.focus.p50;
    const mixText = TIER_ORDER.filter(t => r.mix[t] > 0.005).map(t => `${fx(r.mix[t] * 100, 0)} % ${TIER[t].label.toLowerCase()}`).join(', ');
    const allSrc = Object.keys(Lb.SOURCES).filter(k => k !== 'judge');
    return `${stageHead('results')}<div class="stack" style="gap:22px">
      <div style="max-width:420px">${hzButtons()}</div>
      <div class="tiles">
        <div class="tile"><span class="lbl">Net P50 at the POI${hasSolar() ? ', year 1' : ''}</span><span class="val">${fx(r.en.p50, 1)} <small>GWh/yr</small></span><span class="sub">CUF ${fx(r.en.cf * 100, 1)} % · ${r.en.p50Source === 'entered' ? 'from your report' : 'tool estimate'}${hasSolar() && r.focusN > 1 ? ` · ${hzLabel()} avg ${fx(p50, 1)}` : ''}</span></div>
        <div class="tile key"><span class="lbl">P90, ${hzLabel()} average</span><span class="val">${fx(pv.P90, 1)} <small>GWh/yr</small></span><span class="sub">${fx(pv.P90 / p50 * 100, 1)} % of P50</span></div>
        <div class="tile"><span class="lbl">Total uncertainty (σ)</span><span class="val">${fx(r.focus.sigma, 2)} <small>%</small></span><span class="sub">${isHybrid() ? `wind ${fx(r.focus.parts.wind.sigma, 2)} %, solar ${fx(r.focus.parts.solar.sigma, 2)} % on their own` : `${resWord()} part ${fx(r.focus.comb.wsSigma, 2)} % × S ${fx(r.en.S, 2)}`}</span></div>
        <div class="tile"><span class="lbl">P99, ${hzLabel()} average</span><span class="val">${fx(pv.P99, 1)} <small>GWh/yr</small></span><span class="sub">${fx(pv.P99 / p50 * 100, 1)} % of P50</span></div>
      </div>
      <section class="panel"><header><h3>P-values</h3></header>${pTable()}</section>
      ${isHybrid() ? `<section class="panel"><header><h3>Wind and solar together</h3><span class="computed">${hzLabel()}</span></header>${hybridSummary()}</section>` : ''}
      ${firmSummary()}
      <section class="panel"><header><h3>Where the uncertainty comes from</h3><span class="computed">share of total variance, ${hzLabel()}</span></header>${stageBars()}${legend()}</section>
      <section class="panel"><header><h3>Largest single items</h3></header>${topItems(10)}</section>
      <section class="panel"><header><h3>What the total rests on</h3></header>${mixBar(r.mix, true)}${legend()}<p>${mixText ? 'Of the variance: ' + mixText + '.' : ''} ${r.none.length ? r.none.length + ' item' + (r.none.length > 1 ? 's are' : ' is') + ' excluded.' : 'No items are excluded.'}</p></section>
      <section class="panel"><header><h3>Improve these first</h3><span class="computed">P90 gain if the item's uncertainty were halved</span></header>${reduceList()}</section>
      <section class="panel"><header><h3>Reality checks</h3></header><div class="checks">${checksHtml()}</div></section>
      <section class="panel"><header><h3>Monte Carlo check</h3></header><div id="mcBox">${mcHtml()}</div></section>
      <section class="panel"><header><h3>Uncertainty register</h3><span class="computed">${r.model.items.length} items</span></header>${registerTable()}</section>
      <section class="panel"><header><h3>Method settings</h3></header>${corrPanel()}
        <p class="note">${isHybrid() ? 'Each plant is combined on its own first, as below. The two are then added by energy share with the wind–solar correlations, and the shared grid items are added once. ' : ''}${isSolar() ? 'Irradiance' : 'Wind speed'} uncertainties combine as root-sum-square within each category, then across categories with the correlations above, then convert to energy with the sensitivity factor. Energy and loss uncertainties add in quadrature. Year-to-year terms divide by √N.${isSolar() ? ' Degradation uncertainty grows with the period. Categories follow the IEA PVPS Task 13 structure.' : ' Categories follow IEC 61400-15-2.'}</p></section>
      <section class="panel"><header><h3>Sources</h3></header>${sourcesHtml(allSrc)}<p class="side-note">${esc(Lb.SOURCES.judge.t)}</p></section>
      </div>${stageNav('results')}`;
  }

  const STAGE_RENDER = { project: stageProject, measurement: stageMeasurement, historical: stageHistorical, vertical: stageVertical, horizontal: stageHorizontal, future: stageFuture, conversion: stageConversion, losses: stageLosses, poi: stagePoi, results: stageResults, irradiance: stageIrradiance, solar_lt: stageSolarLt, poa: stagePoa, pvconv: stagePvconv, pvlosses: stagePvlosses, hybrid: stageHybrid, bess: stageBess, supply: stageSupply };

  function renderStage(keepScroll) {
    if (pvMode()) { renderPlant(keepScroll); return; }
    document.body.classList.remove('pv-on');
    const sheet = $('#sheet');
    const y = window.scrollY;
    const active = document.activeElement && document.activeElement.id && sheet.contains(document.activeElement) ? document.activeElement.id : null;
    { const ae = document.activeElement; if (ae && sheet.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) ae.blur(); }
    fid = 0;
    if (!['project', 'results', ...chainOf()].includes(stage)) stage = 'project';
    comp = compOfStage(stage);
    sheet.innerHTML = STAGE_RENDER[stage]();
    if (keepScroll) { window.scrollTo(0, y); if (active) { const el = document.getElementById(active); if (el) el.focus({ preventScroll: true }); } }
  }

  function go(id) {
    if (!STAGE_RENDER[id]) return;
    if (!['project', 'results', ...chainOf()].includes(id)) id = 'project';
    stage = id; saveLocal();
    recompute(); renderStage(); updateChrome();
    window.scrollTo(0, 0);
    const cur = $('.stage-btn[aria-current="step"]'), rail = $('.rail');
    if (cur && rail && rail.scrollWidth > rail.clientWidth) { const cr = cur.getBoundingClientRect(), rr = rail.getBoundingClientRect(); rail.scrollLeft += cr.left - rr.left - rr.width / 2 + cr.width / 2; }
    try { history.replaceState(null, '', '#' + id); } catch (e) { /* ignore */ }
  }

/*@@PLANTVIEW@@*/

  /* ---------- events ---------- */
  function onInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.path) return;
    if (!pvMode() && el.closest('#sheet') && (stage === 'results') && el.tagName === 'INPUT' && e.type === 'input') return; // results inputs apply on change
    if (el.dataset.kind === 'text') {
      setPath(state, el.dataset.path, el.value);
      if (el.dataset.path === 'meta.name') { state.meta.example = false; updateSaveTag(); }
      touch();
      if (el.dataset.path === 'plant.curveText') scheduleLive();
      return;
    }
    if (el.tagName === 'SELECT') return;
    const v = parseFloat(el.value);
    if (!isFinite(v)) return;
    setPath(state, el.dataset.path, v);
    if (state.meta.example && !el.dataset.path.startsWith('view')) { /* keep the example flag until a new project is started */ }
    touch(); scheduleLive();
  }
  function onChange(e) {
    const el = e.target;
    if (el.matches('input[type=radio][data-choice]')) {
      setPath(state, el.dataset.choice + '.choice', +el.value);
      touch(); recompute(); renderStage(true); updateChrome(); return;
    }
    if (el.matches('input[type=file][data-act=import]')) { importFile(el.files && el.files[0]); el.value = ''; return; }
    if (el.matches('input[type=file][data-act=profile]')) { loadProfile(el.files && el.files[0]); el.value = ''; return; }
    if (!el.dataset || !el.dataset.path) return;
    if (el.tagName === 'SELECT') {
      const v = el.value;
      setPath(state, el.dataset.path, (el.dataset.path === 'mc.n' || el.dataset.path === 'supply.samples') ? +v : v);
      touch(); recompute(); renderStage(true); updateChrome(); return;
    }
    if (el.tagName === 'INPUT' && el.type === 'number' && (el.dataset.rerender || (!pvMode() && stage === 'results'))) {
      const v = parseFloat(el.value);
      if (isFinite(v)) setPath(state, el.dataset.path, v);
      touch(); recompute(); renderStage(true); updateChrome();
    }
  }
  function onClick(e) {
    if (pvMode() && e.target.closest && e.target.closest('#sheet')) {
      const pc = e.target.closest('[data-pc]');
      if (pc) { e.preventDefault(); pvSelect(pc.dataset.pc); return; }
      const pg = e.target.closest('[data-pg]');
      if (pg) { e.preventDefault(); pvGroup(pg.dataset.pg, !!pg.dataset.bub); return; }
    }
    const t = e.target.closest('button, [data-stage]');
    if (!t) return;
    if (t.dataset.stage) { e.preventDefault(); closeOverlay(); if (pvMode()) { pv.mode = 'steps'; savePv(); $$('.vt button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === 'steps'))); } go(t.dataset.stage); return; }
    if (t.dataset.hz) {
      state.view.horizon = t.dataset.hz === 'life' ? 'life' : +t.dataset.hz; saveLocal();
      recompute(); renderStage(true); updateChrome(); return;
    }
    if (t.dataset.set) {
      const v = t.dataset.type === 'num' ? +t.dataset.val : t.dataset.type === 'bool' ? t.dataset.val === 'true' : t.dataset.val;
      setPath(state, t.dataset.set, v);
      if (t.dataset.set === 'supply.preset') applyPreset();
      touch();
      if (t.dataset.set === 'tech') {
        pv.view = null; pv.sel = null; pv.open.clear(); savePv();
        if (state.meta.example) { const view = state.view; state = v === 'solar' ? Lb.solarExampleProject() : v === 'hybrid' ? Lb.hybridExampleProject() : Lb.exampleProject(); state.meta.id = uid(); state.view = view; touch(); }
        mc = null; recompute(); renderStage(); updateChrome(); return;
      }
      recompute(); renderStage(true); updateChrome(); return;
    }
    if (t.dataset.mode) {
      const st = getPath(state, t.dataset.mode);
      if (t.dataset.val === 'entered' && st.mode !== 'entered') {
        const cur = itemMap()[t.dataset.key];
        if (cur && cur.mode !== 'none') st.entered = cur.domain === 'loss' ? { L: +cur.L.toFixed(2), s: +cur.sigma.toFixed(2), iav: +cur.iav.toFixed(2) } : { v: +cur.sigma.toFixed(2) };
      }
      st.mode = t.dataset.val; touch(); recompute(); renderStage(true); updateChrome(); return;
    }
    const act = t.dataset.act;
    if (!act) return;
    if (act === 'mode') { setMode(t.dataset.val); return; }
    if (act === 'pvview') { pv.view = t.dataset.val; pv.sel = null; pv.hot = null; pv.open.clear(); savePv(); renderPlant(); pvScrollTop(); return; }
    if (act === 'pvclose') { pv.sel = null; pv.hot = null; pv.open.clear(); pv.full = false; savePv(); renderPlant(true); return; }
    if (act === 'pvsheet') { pv.full = !pv.full; const r = $('.pv'); if (r) r.classList.toggle('full', pv.full); t.textContent = pv.full ? 'Less' : 'More'; return; }
    if (act === 'adddev') { state.devices.push(Lb.newDevice(t.dataset.type, { name: (t.dataset.type === 'lidar' ? 'Lidar ' : 'Mast ') + (state.devices.filter(d => d.type === t.dataset.type).length + 1), weight: 0.5, height: t.dataset.type === 'lidar' ? +state.plant.hubH || 140 : 100 })); touch(); rerender(); return; }
    if (act === 'rmdev') { if (state.devices.length > 1) { state.devices.splice(+t.dataset.i, 1); touch(); rerender(); } return; }
    if (act === 'mc') { runMC(); return; }
    if (act === 'firmrun') { runFirm(false); return; }
    if (act === 'firmdrivers') { runFirm(true); return; }
    if (act === 'peakhr') { const h = +t.dataset.h, set = new Set((state.supply.peakHours || []).map(Number)); if (set.has(h)) set.delete(h); else set.add(h); state.supply.peakHours = [...set].sort((a, b) => a - b); touch(); renderStage(true); updateChrome(); return; }
    if (act === 'clearprofile') { state.supply.profile = { kind: 'generated' }; firm.warn = ''; touch(); renderStage(true); updateChrome(); return; }
    if (act === 'projects') { openOverlay('projects'); return; }
    if (act === 'export') { openOverlay('export'); return; }
    if (act === 'close') { closeOverlay(); return; }
    if (act === 'save') { saveCloud(); return; }
    if (act === 'open') { openCloud(t.dataset.id); return; }
    if (act === 'del') { renderOverlay({ confirmDel: t.dataset.id }); return; }
    if (act === 'delyes') { deleteCloud(t.dataset.id); return; }
    if (act === 'cancel') { renderOverlay({}); return; }
    if (act === 'new' || act === 'example') { renderOverlay({ confirmReplace: act + '-' + (t.dataset.tech || 'wind') }); return; }
    if (act === 'replaceyes') { replaceProject(t.dataset.kind); return; }
    if (act === 'xlsx') { exportXlsx(); return; }
    if (act === 'json') { exportJson(); return; }
  }

  /* tooltips and the power curve crosshair */
  let tipEl = null;
  function showTip(html, x, y) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'tip'; tipEl.setAttribute('role', 'tooltip'); document.body.appendChild(tipEl); }
    tipEl.innerHTML = html; tipEl.hidden = false;
    const r = tipEl.getBoundingClientRect();
    let left = x + 14, top = y + 14;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 14;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 14;
    tipEl.style.left = Math.max(8, left) + 'px'; tipEl.style.top = Math.max(8, top) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.hidden = true; const d = $('#pcDot'); if (d) d.classList.remove('on'); }
  function onPointer(e) {
    const c = e.target.closest && e.target.closest('[data-curve]');
    if (c) {
      const svg = c.ownerSVGElement, rect = svg.getBoundingClientRect();
      const W = +c.dataset.w, ml = +c.dataset.ml, mr = +c.dataset.mr, vmax = +c.dataset.vmax;
      const sx = (e.clientX - rect.left) / rect.width * W;
      const v = Math.max(0, Math.min(vmax, (sx - ml) / (W - ml - mr) * vmax));
      const vr = Math.round(v * 2) / 2;
      const p = C().model.ctx.curve.fn(vr);
      const ymax = Math.max(0.1, +state.plant.ratedMW || 1) * 1.1, H = 230, mt = 14, mb = 32;
      const dot = $('#pcDot');
      if (dot) { dot.classList.add('on'); dot.setAttribute('cx', ml + vr / vmax * (W - ml - mr)); dot.setAttribute('cy', H - mb - p / ymax * (H - mt - mb)); }
      showTip(`<b>${fx(vr, 1)} m/s</b> · ${fx(p, 2)} MW`, e.clientX, e.clientY);
      return;
    }
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (t) showTip(esc(t.dataset.tip), e.clientX, e.clientY); else hideTip();
  }

  /* ---------- Monte Carlo ---------- */
  function runMC() {
    if (mcRunning) return;
    mcRunning = true; const box = $('#mcBox'); if (box) box.innerHTML = mcHtml();
    setTimeout(() => {
      try {
        recompute();
        const n = +state.mc.n || 50000;
        const out = {};
        [1, 10, result.model.ctx.life].forEach(N => { out[N] = E.monteCarlo(state, result, N, { n }); });
        mc = out; mcKey = JSON.stringify([state, state.view]);
      } finally { mcRunning = false; if (stage === 'results') renderStage(true); }
    }, 30);
  }

  /* ---------- projects, saving, export ---------- */
  function openOverlay(kind) { overlay = { kind }; renderOverlay({}); }
  function closeOverlay() { const o = $('#overlay'); if (o) o.remove(); overlay = null; }
  function renderOverlay(opts) {
    if (!overlay) return;
    let o = $('#overlay');
    if (!o) { o = document.createElement('div'); o.id = 'overlay'; o.className = 'overlay'; o.addEventListener('click', ev => { if (ev.target === o) closeOverlay(); }); document.body.appendChild(o); }
    const cloudOk = caps.db && caps.uid;
    const list = cloud.list.map(p => {
      const confirm = opts.confirmDel === p.id;
      return `<div class="prow"><div style="min-width:0"><div class="pn">${esc(p.name || 'Untitled')}${p.id === state.meta.id ? ' <span class="tag save">open</span>' : ''}</div><div class="pd">${esc(p.updated ? new Date(p.updated).toLocaleString() : '')}</div></div>
        <div class="pa">${confirm ? `<span class="status">Delete permanently?</span><button class="btn small danger" data-act="delyes" data-id="${esc(p.id)}">Delete</button><button class="btn small" data-act="cancel">Keep</button>` : `<button class="btn small" data-act="open" data-id="${esc(p.id)}">Open</button><button class="btn small ghost danger" data-act="del" data-id="${esc(p.id)}">Delete</button>`}</div></div>`;
    }).join('');
    const replace = opts.confirmReplace ? `<div class="warn">This replaces the project in the editor. ${cloudOk ? 'Save it first if you want to keep it in your projects.' : 'Export it first if you want to keep it.'} <div style="margin-top:8px;display:flex;gap:8px"><button class="btn small primary" data-act="replaceyes" data-kind="${opts.confirmReplace}">${{ 'new-wind': 'Start new wind project', 'new-solar': 'Start new solar project', 'new-hybrid': 'Start new hybrid project', 'example-wind': 'Load wind example', 'example-solar': 'Load solar example', 'example-hybrid': 'Load hybrid example', 'example-bess': 'Load storage example' }[opts.confirmReplace] || 'Replace'}</button><button class="btn small" data-act="cancel">Cancel</button></div></div>` : '';
    const exportSec = `<section class="stack" style="gap:8px"><h4>Export</h4>${caps.dl ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" data-act="xlsx">Excel workbook (.xlsx)</button><button class="btn" data-act="json">Project file (.json)</button></div><p class="side-note">The workbook holds the P-values, the full uncertainty register with its category labels and losses, the inputs, and the sources.</p>` : '<p class="note">Downloads are not available in this view. Open the page in claude.ai to export.</p>'}</section>`;
    const projSec = `<section class="stack" style="gap:8px"><h4>My projects</h4>
        ${cloudOk ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><button class="btn primary" data-act="save">Save “${esc(state.meta.name || 'Untitled')}”</button><span class="status" id="cloudStatus">${esc(cloud.status)}</span></div>
          <div class="plist">${list || '<p class="side-note">No saved projects yet. Saved projects are private to you and open on any device.</p>'}</div>`
        : `<p class="note">${caps.ready ? 'Saving to your projects needs you to be signed in to claude.ai.' : 'Connecting…'} Your current project is kept in this browser automatically, and you can export it as a project file.</p>`}
      </section>
      <section class="stack" style="gap:8px"><h4>Start or import</h4><div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" data-act="new" data-tech="wind">New wind project</button><button class="btn" data-act="new" data-tech="solar">New solar project</button><button class="btn" data-act="new" data-tech="hybrid">New hybrid project</button>
        <button class="btn" data-act="example" data-tech="wind">Wind example</button><button class="btn" data-act="example" data-tech="solar">Solar example</button><button class="btn" data-act="example" data-tech="hybrid">Hybrid example</button><button class="btn" data-act="example" data-tech="bess">Hybrid with storage example</button>
        <label class="btn" for="importFile">Import project file</label><input id="importFile" type="file" accept=".json,application/json" data-act="import" class="sr"></div>${replace}</section>`;
    o.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="ovTitle">
      <header><h3 id="ovTitle">${overlay.kind === 'export' ? 'Export' : 'Projects'}</h3><button class="btn small ghost" data-act="close" aria-label="Close">Close</button></header>
      ${overlay.kind === 'export' ? exportSec + projSec : projSec + exportSec}
      <p class="status" id="ovStatus">${esc(opts.status || '')}</p>
      <p class="side-note">WattOdds is open source under the <a href="https://www.apache.org/licenses/LICENSE-2.0" target="_blank" rel="noopener">Apache License 2.0</a>. <a href="https://github.com/coderenewables/renewables-uncertainty" target="_blank" rel="noopener">Source code on GitHub</a>.</p></div>`;
  }
  function setOvStatus(s) { const el = $('#ovStatus'); if (el) el.textContent = s; }

  function replaceProject(kind) {
    const [what, t] = String(kind || 'new-wind').split('-');
    state = what === 'new' ? Lb.blankProject(t) : t === 'solar' ? Lb.solarExampleProject() : t === 'hybrid' ? Lb.hybridExampleProject() : t === 'bess' ? Lb.bessExampleProject() : Lb.exampleProject();
    firm.res = null; firm.drivers = null; firm.central = null;
    pv.view = null; pv.sel = null; pv.open.clear(); savePv();
    state.meta.id = uid();
    mc = null; cloud.savedStamp = null; touch(); stage = 'project';
    recompute(); renderStage(); updateChrome(); renderOverlay({ status: what === 'new' ? `New ${t} project started with generic defaults.` : `${{ wind: 'Wind', solar: 'Solar', hybrid: 'Hybrid', bess: 'Storage' }[t] || 'Wind'} example loaded.` });
  }

  async function initCaps() {
    const c = window.claude;
    if (!c || typeof c.use !== 'function') { caps.ready = true; return; }
    try {
      const [db, user, dl] = await Promise.all([c.use('db'), c.use('user'), c.use('downloads')]);
      caps.dl = dl || null;
      if (db && user) {
        const id = await user.id();
        if (id) {
          caps.db = db; caps.uid = id;
          try {
            cloud.unsub = db.collection('data/users/' + id).onSnapshot(snap => {
              cloud.list = snap.docs.filter(d => d.exists && d.data() && d.data().kind === 'wind-project').map(d => { const b = d.data(); return { id: d.id, name: b.name, updated: b.updated }; }).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
              const mine = cloud.list.find(p => p.id === state.meta.id);
              if (mine && mine.updated === state.meta.updated) cloud.savedStamp = state.meta.updated;
              updateSaveTag(); if (overlay) renderOverlay({});
            }, () => { cloud.status = 'Saved projects could not be loaded.'; if (overlay) renderOverlay({}); });
          } catch (e) { /* listing failed */ }
        }
      }
    } catch (e) { /* capabilities unavailable */ }
    caps.ready = true; updateSaveTag(); if (overlay) renderOverlay({});
  }

  async function saveCloud() {
    if (!caps.db || !caps.uid) return;
    const st = $('#cloudStatus'); if (st) st.textContent = 'Saving…';
    try {
      if (!state.meta.id || !/^[A-Za-z0-9_\-.~:@+]+$/.test(state.meta.id)) state.meta.id = uid();
      const stamp = new Date().toISOString(); state.meta.updated = stamp;
      await caps.db.collection('data/users/' + caps.uid).doc(state.meta.id).set({ kind: 'wind-project', name: state.meta.name || 'Untitled', updated: stamp, project: clone(state) });
      cloud.savedStamp = stamp; cloud.status = 'Saved ' + new Date(stamp).toLocaleTimeString();
      saveLocal();
    } catch (e) {
      cloud.status = e && e.code === 'quota_exceeded' ? 'Storage is full. Delete an old project and try again.' : 'Could not save. Your work is still kept in this browser.';
    }
    updateSaveTag(); renderOverlay({});
  }
  async function openCloud(id) {
    if (!caps.db) return;
    setOvStatus('Opening…');
    try {
      const snap = await caps.db.collection('data/users/' + caps.uid).doc(id).get();
      if (!snap.exists) { setOvStatus('That project is no longer there.'); return; }
      state = Lb.normalise(snap.data().project); state.meta.id = id;
      cloud.savedStamp = state.meta.updated; mc = null; stage = 'project'; saveLocal(); pv.view = null; pv.sel = null; pv.open.clear();
      recompute(); renderStage(); updateChrome(); closeOverlay();
    } catch (e) { setOvStatus('Could not open the project.'); }
  }
  async function deleteCloud(id) {
    try { await caps.db.collection('data/users/' + caps.uid).doc(id).delete(); renderOverlay({ status: 'Project deleted.' }); }
    catch (e) { renderOverlay({ status: 'Could not delete the project.' }); }
  }

  function importFile(file) {
    if (!file) return;
    const fr = new FileReader();
    fr.onload = () => {
      try {
        const o = JSON.parse(fr.result);
        if (!o || !o.plant || !o.items) throw new Error('not a project');
        state = Lb.normalise(o); if (!state.meta.id) state.meta.id = uid();
        mc = null; cloud.savedStamp = null; stage = 'project'; touch(); pv.view = null; pv.sel = null; pv.open.clear();
        recompute(); renderStage(); updateChrome(); renderOverlay({ status: `Imported “${state.meta.name}”.` });
      } catch (e) { renderOverlay({ status: 'That file is not a project file from this tool.' }); }
    };
    fr.onerror = () => renderOverlay({ status: 'The file could not be read.' });
    fr.readAsText(file);
  }

  async function offerFile(filename, data) {
    if (!caps.dl) { setOvStatus('Downloads are not available in this view.'); return; }
    try { await caps.dl.save({ filename, data }); setOvStatus('Saved ' + filename + '.'); }
    catch (e) { setOvStatus(e && e.code === 'declined' ? 'Download cancelled.' : e && e.code === 'rate_limited' ? 'A download prompt is already open.' : 'The file could not be saved here.'); }
  }
  function exportJson() { offerFile(slug(state.meta.name) + '.uncertainty.json', JSON.stringify(state, null, 2)); }

  function loadScript(src) {
    return new Promise((res, rej) => { if (window.XLSX) return res(); const s = document.createElement('script'); s.src = src; s.onload = () => res(); s.onerror = () => rej(new Error('load')); document.head.appendChild(s); });
  }
  async function exportXlsx() {
    setOvStatus('Preparing the workbook…');
    try { await loadScript(XLSX_URL); } catch (e) { setOvStatus('The spreadsheet library could not load. Check your connection and try again.'); return; }
    recompute();
    const X = window.XLSX, r = result, p50 = r.en.p50, Ns = [1, 10, r.model.ctx.life], S = r.en.S;
    const contrib = {}; r.contrib.forEach(c => { contrib[c.key] = c; });
    const wb = X.utils.book_new();
    const sum = [
      ['WattOdds — energy yield uncertainty results'], ['Project', state.meta.name], ['Site / notes', state.meta.site], ['Exported', new Date().toISOString()],
      ['Example values', state.meta.example ? 'yes' : 'no'], [],
      ['Technology', { wind: 'Wind', solar: 'Solar PV', hybrid: 'Hybrid wind + solar' }[ptech()]],
      ...(isHybrid() ? [['Net P50 at POI, year 1 (GWh/yr)', +p50.toFixed(3)], ['Wind P50 before shared losses (GWh/yr)', +r.wind.en.p50.toFixed(3)], ['Solar P50 year 1 before shared losses (GWh/yr)', +r.solar.en.p50.toFixed(3)], ['Shared grid efficiency', +r.en.eff.toFixed(5)], ['Connection capacity (MW)', r.model.ctx.gridMW], ['Connection as share of combined capacity', +r.model.ctx.connFrac.toFixed(4)], ['Wind–solar year-to-year correlation', r.model.ctx.rhoIav], ['Wind–solar assessment correlation', r.model.ctx.rhoRes], ['Sum of separate P90s, ' + hzLabel() + ' (GWh/yr)', +r.focus.sumP90.toFixed(3)], ['Portfolio gain at P90, ' + hzLabel() + ' (GWh/yr)', +r.focus.portfolioGain.toFixed(3)], []]
        : [[isSolar() ? 'Net P50 at POI, year 1 (GWh/yr)' : 'Net P50 at POI (GWh/yr)', +p50.toFixed(3)], ['P50 source', r.en.p50Source], [isSolar() ? 'Reference energy, DC capacity × array irradiation (GWh/yr)' : 'Gross energy (GWh/yr)', +r.en.grossGWh.toFixed(3)], [isSolar() ? 'Irradiance-to-energy sensitivity' : 'Wind-speed-to-energy sensitivity', +S.toFixed(4)], [isSolar() ? 'AC capacity (MW)' : 'Capacity (MW)', r.model.ctx.capacityMW], []]),
      ['Exceedance level', ...Ns.map(N => N + '-year (GWh/yr)'), ...Ns.map(N => N + '-year (% of that period P50)')],
      ...E.PLEVELS.map(p => [p, ...Ns.map(N => +r.H[N].pv[p].toFixed(3)), ...Ns.map(N => +(r.H[N].pv[p] / r.H[N].p50 * 100).toFixed(2))]),
      ['σ total (%)', ...Ns.map(N => +r.H[N].sigma.toFixed(3))],
      [], ['Evidence mix (' + hzLabel() + ', share of variance)'], ...TIER_ORDER.map(t => [TIER[t].label, +(r.mix[t] * 100).toFixed(1)]),
    ];
    if (mc) { sum.push([], ['Monte Carlo P90 (GWh/yr)', ...Ns.map(N => mc[N] ? +mc[N].pv.P90.toFixed(3) : '')]); }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(sum), 'Summary');
    const reg = [['Plant', 'Stage', 'Item', 'Device', 'Category', 'Subcategory', 'Basis', 'Evidence', 'Domain', 'Loss (%, or %/yr for degradation)', 'σ (%, pts for losses, %/yr for degradation)', 'Yearly variability (pts)', 'Energy σ ' + hzLabel() + ' (%)', 'Share of variance ' + hzLabel() + ' (%)', 'Sources']];
    r.model.items.forEach(it => {
      const la = E.lossAt(it, r.focusN);
      const ens = E.isRes(it.domain) ? (it._S != null ? it._S : S) * it.sigma : it.domain === 'en' ? it.sigma : la.s / Math.max(0.05, 1 - la.L / 100);
      reg.push([COMP_LABEL[it.comp] || (isSolar() ? 'Solar' : 'Wind'), stageOrderName(it.stage), it.name, it.deviceName || '', it.cat, it.sub, E.IEC_BASIS[it.mode], TIER[it.tier].label, it.domain === 'ws' ? 'wind speed' : it.domain === 'res' ? 'irradiance' : it.domain === 'en' ? 'energy' : 'loss', it.domain === 'loss' ? +it.L.toFixed(3) : '', +it.sigma.toFixed(4), it.iav ? +it.iav.toFixed(3) : '', +ens.toFixed(4), contrib[it.key] ? +(contrib[it.key].share * 100).toFixed(2) : '', (it.def.src || []).map(k => Lb.SOURCES[k] && Lb.SOURCES[k].t).filter(Boolean).join('; ')]);
    });
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(reg), 'Register');
    // the plant view's breakdown: each part and category, its energy σ and share of the total
    {
      const sm = Plant.summarise(state, r, E, Lb), hyb = isHybrid();
      const farmLabel = c => ({ wind: 'Wind', solar: 'Solar', shared: hyb ? 'Shared' : '', bess: 'Battery' }[c.plant] || '');
      const ownNote = hyb ? ' (wind and solar parts relative to their own farm)' : '';
      const rows = [['Plant parts — ' + hzLabel() + ' average'], ['Total σ (%)', +sm.sigma.toFixed(3)], ['Sum of the parts added straight (%)', +sm.sumOfSigmas.toFixed(3)], []];
      if (hyb) rows.push(['Wind farm on its own, σ (%)', +sm.farms.wind.sigmaOwn.toFixed(3), 'share of total (%)', +(sm.farms.wind.share * 100).toFixed(2)], ['Solar farm on its own, σ (%)', +sm.farms.solar.sigmaOwn.toFixed(3), 'share of total (%)', +(sm.farms.solar.share * 100).toFixed(2)], ['Wind–solar correlation term, share of total (%)', +(sm.cross.share * 100).toFixed(2)], []);
      rows.push(['Farm', 'Part', 'Category', 'Items', 'Energy σ' + ownNote + ' (%)', 'Share of total variance (%)', 'Combined loss (%)', 'Generic defaults, share of the part (%)']);
      const ids = hyb ? [...Plant.ORDER.wind, ...Plant.ORDER.solar.filter(x => x !== 'grid')] : Plant.ORDER[ptech()];
      ids.forEach(id => {
        const c = sm.comps[id]; if (!c) return;
        const nm = id === 'w.meas' && isDesk() ? Plant.COMPONENTS[id].nameDesk : hyb && Plant.COMPONENTS[id].nameHybrid ? Plant.COMPONENTS[id].nameHybrid : Plant.COMPONENTS[id].name;
        rows.push([farmLabel(c), nm, c.status === 'atlas' ? '(in the wind atlas)' : '(all categories)', c.items.length, +(c.sigmaOwn || 0).toFixed(3), +((c.share || 0) * 100).toFixed(2), c.loss != null ? +c.loss.toFixed(2) : '', +((c.generic || 0) * 100).toFixed(0)]);
        c.groups.forEach(g => rows.push([farmLabel(c), nm, g.name, g.items.length, +g.sigmaOwn.toFixed(3), +(g.share * 100).toFixed(2), g.loss != null ? +g.loss.toFixed(2) : '', +((g.generic || 0) * 100).toFixed(0)]));
      });
      rows.push([], ['Parts combine as the square root of the sum of their squares, so the straight sum is larger than the total. Shares of the total variance add up to 100 %' + (hyb ? ' together with the wind–solar correlation term.' : '.')]);
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Plant parts');
    }
    const solarInp = rs => [['Irradiance data', state.setup.solarSource], ['DC capacity (MWp)', state.pv.dcMWp], ['AC capacity (MW)', state.pv.acMW], ['DC/AC ratio', +rs.model.ctx.dcac.toFixed(3)], ['Mounting', state.pv.mount], ['Bifacial', state.pv.bifacial ? 'yes' : 'no'], ['Annual GHI (kWh/m²)', state.pv.ghi], ['POA/GHI ratio', state.pv.poaRatio], ['Performance ratio (all losses)', +rs.en.pr.toFixed(4)], ['Specific yield year 1 (kWh/kWp)', +rs.en.specYield.toFixed(1)], ['Lifetime (years)', lifeN()]];
    const windInp = rw => [['Data source', state.setup.dataSource], ['Terrain', state.setup.terrain], ['Turbines', state.plant.nTurbines], ['Rated power (MW)', state.plant.ratedMW], ['Rotor diameter (m)', state.plant.rotorD], ['Hub height (m)', state.plant.hubH], ['Power curve', rw.en.curveKind], ['Air density (kg/m³)', +rw.en.rho.toFixed(4)], ['Mean wind speed at hub (m/s)', state.climate.meanWs], ['Weibull k', state.climate.k], ['Lifetime (years)', lifeN()], ['Measurement height carried to hub (m)', state.vertical.hMeas], ['Lower shear height (m)', state.vertical.hLow], ['Shear exponent', state.vertical.alpha], ['Device correlation', state.deviceCorr]];
    const inp = isHybrid() ? [['Input', 'Value'], ...windInp(r.wind).map(x => ['Wind: ' + x[0], x[1]]), ...solarInp(r.solar).map(x => ['Solar: ' + x[0], x[1]]), ['Connection capacity (MW)', r.model.ctx.gridMW], ['Wind–solar year-to-year correlation', r.model.ctx.rhoIav], ['Wind–solar assessment correlation', r.model.ctx.rhoRes]]
      : [['Input', 'Value'], ...(isSolar() ? solarInp(r) : windInp(r))];
    if (ptech() !== 'solar') state.devices.forEach(d => inp.push(['Device: ' + d.name, `${d.type}, ${d.height} m, share ${d.weight}`]));
    Object.entries(state.catCorr || {}).forEach(([k, v]) => inp.push(['Correlation ' + k, v]));
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(inp), 'Inputs');
    if (hasBess()) {
      const sp = state.supply, b = state.bess, fr = firm.res;
      const rows = [['Battery storage and firm supply'], ['Power (MW)', b.powerMW], ['Usable energy at start (MWh)', b.energyMWh], ['Augmentation', b.augment ? 'keep ≥ ' + b.augTarget + ' %' : 'none'],
        ...bessItems().map(i => [i.name, `${i.L} ${(i.def.bunit || {}).L || ''} ± ${i.sigma} ${(i.def.bunit || {}).s || ''}`, TIER[i.tier].label]),
        [], ['Rule set', (Firm.PRESETS[sp.preset] || {}).label], ['Contracted capacity (MW)', sp.contractMW], ['Off-peak demand share', sp.offFrac], ['Peak hours', (sp.peakHours || []).join(', ')], ['Battery reserve for peak', sp.reserve],
        ...Firm.rulesFor(sp).map(r => ['Rule: ' + WIN_LABEL[r.window] + ', ' + r.basis, '≥ ' + r.target + ' %' + (r.relax ? `, ${r.relax.allow} of Jul–Sep ≥ ${r.relax.target} %` : '')]),
        ['Tariff', sp.tariff + ' ' + (sp.currency || '') + '/kWh'], ['Penalty multiple', sp.penaltyMult], ['Hourly profile', (sp.profile || {}).kind === 'upload' ? 'uploaded: ' + (sp.profile.name || '') : 'generated (' + sp.season + ')'], []];
      if (fr) {
        rows.push(['Results', 'year ' + fr.year + ', ' + fr.n + ' simulated years' + (firm.key !== firmKey() ? ' (inputs changed since the run)' : '')], ['Chance of meeting every rule', +fr.pMeet.toFixed(4)], ['Months below target, average', +fr.failedMonths.toFixed(3)],
          ['Shortfall P50 (MWh)', +fr.shortfall.p50.toFixed(1)], ['Shortfall P90 (MWh)', +fr.shortfall.p90.toFixed(1)], ['Penalty P50', +fr.penalty.p50.toFixed(0)], ['Penalty P90', +fr.penalty.p90.toFixed(0)],
          ['Delivered P50 (MWh)', +fr.delivered.p50.toFixed(1)], ['Delivered P90 (MWh)', +fr.delivered.p90.toFixed(1)], ['Curtailed P50 (MWh)', +fr.curtailed.p50.toFixed(1)], ['Cycles a year', +fr.cycles.mean.toFixed(1)], [],
          ['Rule', 'Chance met', 'Months below, average'], ...fr.perRule.map(x => [WIN_LABEL[x.window] + ', ' + x.basis + ' ≥ ' + x.target + ' %', +x.pMet.toFixed(4), +x.failedMonths.toFixed(3)]), [],
          ['Month', 'Peak DFR P50', 'Peak DFR P10', 'Off-peak DFR P50', 'Off-peak DFR P10', 'All-hours DFR P50', 'All-hours DFR P10'],
          ...MONTHS.map((mo, i) => [mo, ...[0, 1, 2].flatMap(w => [fr.monthly[w][i].p50 != null ? +fr.monthly[w][i].p50.toFixed(4) : '', fr.monthly[w][i].p10 != null ? +fr.monthly[w][i].p10.toFixed(4) : ''])]));
        if (firm.drivers) { rows.push([], ['Held fixed', 'Chance met', 'Shortfall P90 (MWh)']); firm.drivers.groups.forEach(g => rows.push([g.label, +g.pMeet.toFixed(4), +g.sf90.toFixed(1)])); }
      } else rows.push(['Results', 'not run yet']);
      X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet(rows), 'Firm supply');
    }
    X.utils.book_append_sheet(wb, X.utils.aoa_to_sheet([['Key', 'Source', 'Link'], ...Object.entries(Lb.SOURCES).map(([k, s]) => [k, s.t, s.u])]), 'Sources');
    const buf = X.write(wb, { bookType: 'xlsx', type: 'array' });
    offerFile(slug(state.meta.name) + '-uncertainty.xlsx', new Blob([buf]));
  }

  /* ---------- boot ---------- */
  function start(hot) {
    const saved = (hot && hot.state) ? hot : loadLocal();
    state = saved && saved.state ? Lb.normalise(saved.state) : Lb.exampleProject();
    if (!state.meta.id) state.meta.id = uid();
    const h = (location.hash || '').slice(1);
    stage = STAGE_RENDER[h] ? h : (saved && STAGE_RENDER[saved.stage] ? saved.stage : 'project');
    renderShell(); recompute(); renderStage(); updateChrome();
    document.addEventListener('input', onInput);
    document.addEventListener('change', onChange);
    document.addEventListener('click', onClick);
    document.addEventListener('pointermove', onPointer);
    document.addEventListener('pointerleave', hideTip);
    document.addEventListener('keydown', e => { if (e.key !== 'Escape') return; if (overlay) { closeOverlay(); return; } if (pvMode() && pv.sel) { pv.sel = null; pv.hot = null; pv.open.clear(); pv.full = false; savePv(); renderPlant(true); } });
    try { window.claude && window.claude.hot && window.claude.hot.snapshot(() => ({ state, stage })); } catch (e) { /* ignore */ }
    initCaps();
  }
  const hot = window.claude && window.claude.hot;
  if (hot && hot.ready) hot.ready(start); else start((hot && hot.data) || {});
})();
