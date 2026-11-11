  /* WattOdds — energy yield uncertainty, source to meter.
     Copyright 2026 Nithish Seenivasagam (coderenewables.com)
     SPDX-License-Identifier: Apache-2.0 */
  /* ======================= Results rail =======================
     The results that stay on screen in both views: P50 to P99, the odds curve, the bridge from
     gross to net, what drives the uncertainty, checks on the inputs and, with a battery, the
     hourly simulation. It is redrawn on every change to the project; numbers that moved are
     marked with how far they moved, and a pinned baseline shows the difference from an earlier
     state of the same project. */
  const RR_BASE_KEY = 'wattodds:baseline:v1';
  const rr = { open: new Set(), all: false, prev: {}, prevHz: null, chg: {}, base: null, baseSnaps: {}, sheet: false };
  (() => { try { const o = JSON.parse(localStorage.getItem(RR_BASE_KEY) || 'null'); if (o && o.state && o.id) rr.base = o; } catch (e) { /* storage unavailable */ } })();
  const saveBase = () => { try { if (rr.base) localStorage.setItem(RR_BASE_KEY, JSON.stringify(rr.base)); else localStorage.removeItem(RR_BASE_KEY); } catch (e) { /* ignore */ } };
  const reduceMotion = () => !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const ncdf = z => { const t = 1 / (1 + 0.2316419 * Math.abs(z)), d = 0.3989423 * Math.exp(-z * z / 2); const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274)))); return z > 0 ? 1 - p : p; };

  /* the numbers a baseline is compared on */
  function rrSnap(r) {
    const f = r.focus, b = E.lossBridge(r, r.focusN);
    const groups = {}, items = {};
    b.groups.forEach(g => { groups[g.id] = g.lost; });
    b.steps.forEach(s => { items[s.key] = s.lost; });
    return { p50: f.p50, p90: f.pv.P90, p99: f.pv.P99, sigma: f.sigma, ratio: f.p50 > 0 ? f.pv.P90 / f.p50 * 100 : 0, gross: b.gross, net: b.net, lossPct: b.lossPct, groups, items, bridge: b };
  }
  /* the baseline at the period on screen (it is re-evaluated when the period changes) */
  function rrBase() {
    if (!rr.base || rr.base.id !== state.meta.id) return null;
    const hz = String(state.view.horizon == null ? 10 : state.view.horizon) + '|' + lifeN();
    if (!rr.baseSnaps[hz]) {
      try { const s = clone(rr.base.state); s.view = Object.assign({}, s.view, { horizon: state.view.horizon }); s.horizon = Object.assign({}, s.horizon, { life: state.horizon.life }); rr.baseSnaps[hz] = rrSnap(E.evaluate(s, Lb)); }
      catch (e) { return null; }
    }
    return rr.baseSnaps[hz];
  }
  function pinBase() { rr.base = { id: state.meta.id, at: new Date().toISOString(), state: clone(state) }; rr.baseSnaps = {}; saveBase(); renderSide(); }
  function clearBase() { rr.base = null; rr.baseSnaps = {}; saveBase(); renderSide(); }
  function revertBase() {
    if (!rr.base || rr.base.id !== state.meta.id) return;
    const view = state.view; state = clone(rr.base.state); state.view = view;
    mc = null; touch(); recompute(); renderStage(true); updateChrome();
  }

  /* difference from the baseline as a small tag; up is good unless stated */
  function rrDelta(cur, base, d, opts) {
    if (base == null || !isFinite(base) || !isFinite(cur)) return '';
    const o = opts || {}, diff = cur - base;
    if (Math.abs(diff) < 0.5 * Math.pow(10, -d)) return o.same ? `<span class="rr-d same" title="Same as the baseline">no change</span>` : '';
    const good = (diff > 0) === (o.goodUp !== false);
    return `<span class="rr-d ${good ? 'good' : 'bad'}" title="Against the baseline">${diff > 0 ? '+' : '−'}${fx(Math.abs(diff), d)}${o.unit || ''}</span>`;
  }
  /* a number that is tracked between redraws: data-n key, data-v value, data-d decimals */
  const rrNum = (key, v, d, opts) => { const o = opts || {}; return `<span class="rr-n" data-n="${key}" data-v="${isFinite(v) ? v : ''}" data-d="${d}" data-pre="${esc(o.pre || '')}" data-good="${o.goodUp === false ? 'down' : 'up'}">${esc(o.pre || '')}${fx(v, d)}</span>`; };

  /* after a redraw: count numbers up or down from their last value and tag the change */
  function rrAnimate(root) {
    const hz = String(state.view.horizon) + '|' + ptech() + '|' + state.meta.id, same = rr.prevHz === hz, now = Date.now(), quiet = reduceMotion();
    $$('[data-n]', root).forEach(el => {
      const k = el.dataset.n, v = parseFloat(el.dataset.v), d = +el.dataset.d || 0, p = rr.prev[k];
      if (!isFinite(v)) return;
      if (same && p != null && isFinite(p) && Math.abs(v - p) >= 0.5 * Math.pow(10, -d)) {
        rr.chg[k] = { diff: v - p, t: now };
        if (!quiet) {
          const pre = el.dataset.pre || '', t0 = performance.now(), dur = 320;
          const step = t => { const u = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - u, 3); if (!el.isConnected) return; el.textContent = pre + fx(p + (v - p) * e, d); if (u < 1) requestAnimationFrame(step); };
          el.textContent = pre + fx(p, d); requestAnimationFrame(step);
        }
      }
      rr.prev[k] = v;
      const c = rr.chg[k];
      if (c && now - c.t < 2600 && el.parentElement) {
        const good = (c.diff > 0) === (el.dataset.good !== 'down');
        const tag = document.createElement('span');
        tag.className = 'rr-chg ' + (good ? 'good' : 'bad'); tag.setAttribute('aria-hidden', 'true');
        tag.style.animationDelay = (-(now - c.t)) + 'ms';
        tag.textContent = (c.diff > 0 ? '▲ ' : '▼ ') + fx(Math.abs(c.diff), d);
        el.insertAdjacentElement('afterend', tag);
      } else if (c) delete rr.chg[k];
    });
    rr.prevHz = hz;
    // bars and markers glide from where they were
    if (!quiet) $$('[data-ak]', root).forEach(el => {
      const k = 'ak:' + el.dataset.ak, cur = el.getAttribute('style') || '', was = rr.prev[k];
      if (same && was != null && was !== cur) { el.setAttribute('style', was); void el.offsetWidth; el.setAttribute('style', cur); }
      rr.prev[k] = cur;
    }); else $$('[data-ak]', root).forEach(el => { rr.prev['ak:' + el.dataset.ak] = el.getAttribute('style') || ''; });
  }

  /* ---------- the odds curve ---------- */
  function rrCurve(base) {
    const f = result.focus, p50 = f.p50, sd = Math.max(1e-9, p50 * f.sigma / 100);
    const W = 340, H = 138, m = { l: 6, r: 6, t: 22, b: 20 };
    let lo = p50 - 3.4 * sd, hi = p50 + 3.4 * sd, bsd = 0;
    if (base) { bsd = Math.max(1e-9, base.p50 * base.sigma / 100); lo = Math.min(lo, base.p50 - 3.4 * bsd); hi = Math.max(hi, base.p50 + 3.4 * bsd); }
    lo = Math.max(0, lo);
    const x = v => m.l + (v - lo) / (hi - lo) * (W - m.l - m.r);
    const peak = base ? Math.max(1, sd / bsd) : 1;         // tallest curve fills the plot
    const y = h => H - m.b - h / peak * (H - m.t - m.b);
    const path = (mu, s, scale, from, to) => { let d = ''; const a = from == null ? lo : from, b = to == null ? hi : to, n = 72; for (let i = 0; i <= n; i++) { const v = a + (b - a) * i / n, z = (v - mu) / s; d += (i ? 'L' : 'M') + x(v).toFixed(1) + ' ' + y(scale * Math.exp(-z * z / 2)).toFixed(1); } return d; };
    const pv = f.pv, y0 = (H - m.b).toFixed(1);
    const tail = path(p50, sd, 1, lo, pv.P90) + `L${x(pv.P90).toFixed(1)} ${y0}L${x(lo).toFixed(1)} ${y0}Z`;
    const body = path(p50, sd, 1, pv.P90, hi) + `L${x(hi).toFixed(1)} ${y0}L${x(pv.P90).toFixed(1)} ${y0}Z`;
    const marks = [['P99', pv.P99], ['P90', pv.P90], ['P75', pv.P75], ['P50', pv.P50]];
    let lastX = -99;
    const mk = marks.map(([n, v]) => {
      const xx = x(v), z = (v - p50) / sd, yy = y(Math.exp(-z * z / 2));
      const show = xx - lastX > 26; if (show) lastX = xx;
      return `<g class="mk ${n.toLowerCase()}" data-ak="mk-${n}" style="transform:translateX(${xx.toFixed(1)}px)"><line x1="0" x2="0" y1="${(yy - 4).toFixed(1)}" y2="${y0}"/>${show ? `<text y="${Math.max(9, yy - 9).toFixed(1)}" text-anchor="middle">${n}</text>` : ''}</g>`;
    }).join('');
    const ghost = base ? `<path class="ghost" d="${path(base.p50, bsd, sd / bsd)}"/>` : '';
    const t0 = fx(lo, 0), t1 = fx(hi, 0);
    return `<svg class="rr-curve" viewBox="0 0 ${W} ${H}" role="img" aria-label="Range of outcomes, ${esc(hzLabel())} average: P50 ${fx(p50, 1)}, P90 ${fx(pv.P90, 1)} GWh per year">
      <path class="tail" d="${tail}"/><path class="body" d="${body}"/>${ghost}<path class="ln" d="${path(p50, sd, 1)}"/>
      <line class="ax" x1="${m.l}" x2="${W - m.r}" y1="${y0}" y2="${y0}"/>${mk}
      <text class="tk" x="${m.l}" y="${H - 5}">${t0}</text><text class="tk" x="${W - m.r}" y="${H - 5}" text-anchor="end">${t1} GWh/yr</text>
      <line class="cur" id="rrCur" x1="0" x2="0" y1="${m.t - 6}" y2="${y0}"/>
      <rect class="hit" x="${m.l}" y="0" width="${W - m.l - m.r}" height="${H - m.b}" data-odds="1" data-lo="${lo}" data-hi="${hi}" data-p50="${p50}" data-sd="${sd}" data-w="${W}" data-ml="${m.l}" data-mr="${m.r}"/>
    </svg>`;
  }
  function rrLevels(base) {
    const f = result.focus, pv = f.pv;
    return `<div class="rr-lv" role="table" aria-label="Exceedance levels">${E.PLEVELS.map(p => `<div class="${p === 'P90' ? 'key' : ''}" role="row"><span class="l" role="rowheader">${p}</span><span class="v" role="cell">${rrNum('lv-' + p, pv[p], 1)}</span><span class="s" role="cell">${p === 'P50' ? 'GWh/yr' : fx(pv[p] / f.p50 * 100, 1) + ' %'}</span>${base && p !== 'P50' && p !== 'P90' ? '' : ''}</div>`).join('')}</div>`;
  }

  /* ---------- gross to net ---------- */
  const COMP_TAG = { wind: 'W', solar: 'S', hybrid: '' };
  function rrBridge(b, base) {
    const visible = b.groups.filter(g => Math.abs(g.lost) > 1e-9 || g.steps.some(s => !s.excluded && s.L !== 0));
    const runs = [b.gross, b.net]; b.steps.forEach(s => { runs.push(s.before, s.after); });
    const top = Math.max(...runs), bot = Math.min(...runs), span = Math.max(1e-9, top - bot);
    const lo = Math.max(0, bot - span * 0.3), hi = top + span * 0.02;
    const X = v => Math.max(0, Math.min(100, (v - lo) / (hi - lo) * 100));
    const seg = (a, c, cls, key) => { const l = Math.min(X(a), X(c)), w = Math.max(0.8, Math.abs(X(a) - X(c))); return `<i class="${cls}" data-ak="${key}" style="left:${l.toFixed(2)}%;width:${w.toFixed(2)}%"></i>`; };
    const full = (v, cls, key, split) => {
      if (split && split.length > 1) { let acc = 0; const tot = split.reduce((a, s) => a + s.gross, 0) || 1; return split.map((s, i) => { const l = acc; acc += X(v) * s.gross / tot; return `<i class="${cls} ${s.comp}" data-ak="${key}-${i}" style="left:${l.toFixed(2)}%;width:${Math.max(0.8, acc - l - (i < split.length - 1 ? 0.6 : 0)).toFixed(2)}%" data-tip="${esc(s.name)}: ${fx(s.gross, 1)} GWh/yr"></i>`; }).join(''); }
      return `<i class="${cls}" data-ak="${key}" style="left:0;width:${Math.max(0.8, X(v)).toFixed(2)}%"></i>`;
    };
    const val = (lost, L) => `<span class="bv">${lost < 0 ? '+' : '−'}${fx(Math.abs(lost), Math.abs(lost) < 10 ? 2 : 1)}<small>${fx(Math.abs(L), Math.abs(L) < 10 ? 2 : 1)} %</small></span>`;
    const HEAD = { wind: 'Wind plant', solar: 'Solar plant', hybrid: 'Shared connection' };
    let lastComp = null;
    const rows = visible.map(g => {
      const open = rr.all || rr.open.has(g.id), gain = g.lost < 0;
      let head = '';
      if (g.comp && g.comp !== lastComp) {   // a hybrid: one block per plant, then the shared connection
        lastComp = g.comp;
        const mine = visible.filter(x => x.comp === g.comp), a = mine[0].streamBefore, z = mine[mine.length - 1].streamAfter;
        head = `<div class="br-head ${g.comp}"><span>${HEAD[g.comp]}</span><span>${fx(a, 1)} → ${fx(z, 1)}</span></div>`;
      }
      const tag = '';
      const d = base && base.groups[g.id] != null ? rrDelta(-g.lost, -base.groups[g.id], 1) : '';
      const items = open ? g.steps.map(s => `<button class="br-row it${s.excluded ? ' off' : ''}" data-item="${esc(s.key)}" title="Open ${esc(s.name)}">
          <span class="bn">${esc(s.name)}</span><span class="bt">${s.excluded ? '' : seg(s.before, s.after, s.lost < 0 ? 'gain' : 'loss', 'bi-' + s.key)}</span>${s.excluded ? '<span class="bv"><small>excluded</small></span>' : val(s.lost, s.L)}</button>`).join('') : '';
      return `${head}<div class="br-g${open ? ' open' : ''}"><button class="br-row grp" data-brg="${esc(g.id)}" aria-expanded="${open}">
          <span class="bn">${tag}${esc(g.name)}${d}</span><span class="bt">${seg(g.before, g.after, gain ? 'gain' : 'loss', 'bg-' + g.id)}</span>${val(g.lost, g.L)}</button>${items}</div>`;
    }).join('');
    const srcNote = b.sources.length > 1 ? `<small>${b.sources.map(s => `${s.comp} ${fx(s.gross, 0)}`).join(' + ')}</small>` : '';
    return `<div class="rr-bridge">
      <div class="br-row end"><span class="bn">Gross${srcNote}</span><span class="bt">${full(b.gross, 'tot', 'b-gross', b.sources)}</span><span class="bv tot">${rrNum('gross', b.gross, 1)}</span></div>
      ${rows}
      <div class="br-row end net"><span class="bn">Net at the meter${base ? rrDelta(b.net, base.net, 1) : ''}</span><span class="bt">${full(b.net, 'tot net', 'b-net')}</span><span class="bv tot">${rrNum('net', b.net, 1)}</span></div>
    </div>
    <p class="rr-foot">GWh/yr, ${esc(hzLabel())} average. Total loss <b>${rrNum('lossp', b.lossPct, 1)} %</b>; losses alone carry ±${fx(b.lossSigma, 2)} %. The bars start at ${fx(lo, 0)} GWh/yr so small losses stay visible.${b.implied ? ' Gross is worked back from your P50 and the losses set here.' : ''}</p>`;
  }

  /* ---------- what drives the uncertainty ---------- */
  function partOf(it) { const p = Plant.place(it); return p ? p.comp : null; }
  function rrDrivers() {
    const list = result.contrib.filter(c => c.variance > 0).sort((a, b) => b.variance - a.variance).slice(0, 6);
    if (!list.length) return '<p class="rr-foot">No uncertainty set yet.</p>';
    const max = list[0].share || 1;
    const gain = {}; result.reduce.forEach(x => { gain[x.key] = x.gainGWh; });
    return `<div class="rr-drv">${list.map(c => {
      const it = c.item, t = TIER[it.tier] || TIER.generic, part = partOf(it);
      const where = (it.comp && it.comp !== 'hybrid' ? COMP_LABEL[it.comp] + ' · ' : '') + (part && Plant.COMPONENTS[part] ? pvName(part) : stageName(it.stage)) + (it.deviceName ? ' · ' + it.deviceName : '');
      const g = gain[c.key];
      return `<button class="dv-row" data-item="${esc(c.key)}" title="Open ${esc(it.name)}">
        <span class="dn">${esc(it.name)}<small>${esc(where)}${g > 0.05 ? ` · halve it: +${fx(g, 1)} GWh/yr at P90` : ''}</small></span>
        <span class="db"><i class="${t.cls}" data-ak="dv-${esc(c.key)}" style="width:${Math.max(2, c.share / max * 100).toFixed(1)}%"></i></span>
        <span class="dp">${fx(c.share * 100, 0)} %</span></button>`;
    }).join('')}</div>`;
  }

  /* ---------- checks ---------- */
  function rrChecks() {
    const list = E.sanity(state, result);
    if (!list.length) return '';
    return `<section class="rr-sec"><h4>Check these inputs</h4><div class="rr-checks">${list.map(c => `<button class="ck ${c.level}" ${c.part ? `data-part="${esc(c.part)}"` : 'disabled'}><span class="ci" aria-hidden="true">${c.level === 'warn' ? '!' : 'i'}</span><span>${esc(c.text)}</span></button>`).join('')}</div></section>`;
  }

  /* ---------- battery: the hourly simulation, kept up to date ---------- */
  let firmTimer = 0;
  function firmSchedule() {
    clearTimeout(firmTimer);
    if (!hasBess()) return;
    if (firm.res && firm.key === firmKey() && firm.central) return;
    firmTimer = setTimeout(firmAuto, 320);
  }
  async function firmAuto() {
    if (!hasBess() || firm.running) { if (firm.running) firmTimer = setTimeout(firmAuto, 400); return; }
    const key = firmKey();
    firm.running = true; firm.auto = true;
    try {
      const prep = Firm.prepare(state, result, E, Lb);
      firm.warn = prep.warn;
      const year = firmYear();
      firm.central = Firm.central(prep, year); firm.centralKey = key;
      firmRefresh();
      await new Promise(r => setTimeout(r, 0));
      const res = await Firm.run(prep, { n: +state.supply.samples || 400, year }, () => new Promise(r => setTimeout(r, 0)));
      firm.res = res; firm.drivers = null; firm.key = key; firm.progress = '';
    } catch (e) { firm.progress = 'The simulation could not run: ' + (e && e.message || e); }
    finally { firm.running = false; firm.auto = false; firmRefresh(); if (hasBess() && firmKey() !== key) firmSchedule(); }
  }
  /* redraw what shows the simulation without touching inputs */
  function firmRefresh() {
    $$('[data-live^="firm"]').forEach(el => { const k = el.dataset.live.split('|')[0]; if (LIVE[k]) el.innerHTML = LIVE[k](); });
    renderRail(); renderSide();
    if (pvMode()) pvRefresh();
  }
  function rrStorage() {
    if (!hasBess()) return '';
    const c = firm.central && firm.centralKey === firmKey() ? firm.central : null, r = firm.res, fresh = r && firm.key === firmKey();
    const b = state.bess, dur = (+b.energyMWh || 0) / Math.max(0.01, +b.powerMW || 0);
    let body = '<p class="rr-foot">Simulating the plant and battery hour by hour…</p>';
    if (c) {
      const g = c.res.gen / 1000, cur = c.res.curtailed / 1000, rt = Math.max(0, c.res.charged - c.res.discharged) / 1000, aux = c.res.auxE / 1000, del = c.res.delivered / 1000;
      const top = Math.max(g, del), lo = Math.max(0, del - (top - del) * 0.5 - 1e-6), X = v => Math.max(0, Math.min(100, (v - lo) / (top * 1.02 - lo) * 100));
      let run = g;
      const step = (name, lost, key) => { const a = run; run -= lost; return lost > 0.005 ? `<div class="br-row"><span class="bn">${name}</span><span class="bt"><i class="store" data-ak="st-${key}" style="left:${X(run).toFixed(2)}%;width:${Math.max(0.8, X(a) - X(run)).toFixed(2)}%"></i></span><span class="bv">−${fx(lost, lost < 10 ? 2 : 1)}<small>${fx(lost / g * 100, 2)} %</small></span></div>` : ''; };
      const dfr = [['Peak hours', 0], ['Off-peak', 1], ['All hours', 2]].filter(([, i]) => c.res.annual[i] && c.res.annual[i].dfr != null).map(([n, i]) => `<div class="dfr"><span>${n}</span><span class="db"><i data-ak="dfr-${i}" style="width:${(c.res.annual[i].dfr * 100).toFixed(1)}%"></i></span><b>${rrNum('dfr' + i, c.res.annual[i].dfr * 100, 0)} %</b></div>`).join('');
      body = `<div class="rr-bridge">
          <div class="br-row end"><span class="bn">Generation</span><span class="bt"><i class="tot" data-ak="st-gen" style="left:0;width:${X(g).toFixed(2)}%"></i></span><span class="bv tot">${rrNum('stgen', g, 1)}</span></div>
          ${step('Curtailed at the export limit', cur, 'cur')}${step('Battery round trip', rt, 'rt')}${step('Battery auxiliary', aux, 'aux')}
          <div class="br-row end net"><span class="bn">Delivered</span><span class="bt"><i class="tot net" data-ak="st-del" style="left:0;width:${X(del).toFixed(2)}%"></i></span><span class="bv tot">${rrNum('stdel', del, 1)}</span></div>
        </div>
        <h5>Demand met, central year</h5><div class="rr-dfr">${dfr}</div>
        <div class="rr-meet${fresh ? '' : ' stale'}"><span class="mv">${r ? rrNum('pmeet', r.pMeet * 100, 0) + ' %' : '–'}</span><span class="ml">chance of meeting every supply rule in year ${c.y ? firmYear() : ''}${r ? `<small>${fresh ? r.n.toLocaleString('en') + ' simulated years' : 'updating…'}${r && state.supply.tariff > 0 && fresh ? ' · penalty P90 ' + money(r.penalty.p90) : ''}</small>` : '<small>simulating…</small>'}</span></div>`;
    }
    return `<section class="rr-sec"><header><h4>With the battery</h4><span class="rr-meta">${fx(+b.powerMW, 0)} MW · ${fx(+b.energyMWh, 0)} MWh · ${fx(dur, 1)} h</span></header>${body}
      <div class="rr-acts"><button class="btn small" data-part="bess">Battery</button><button class="btn small" data-part="buyer">Supply contract</button></div></section>`;
  }

  /* ---------- the rail ---------- */
  function railHtml() {
    const r = result, f = r.focus, pv = f.pv, p50 = f.p50;
    const base = rrBase(), b = E.lossBridge(r, r.focusN);
    const ratio = p50 > 0 ? pv.P90 / p50 * 100 : 0;
    const baseBar = base
      ? `<div class="rr-base on"><span>Against the baseline pinned ${esc(new Date(rr.base.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }))}</span><span class="grow"></span><button class="btn small ghost" data-act="rrrevert" title="Put the baseline inputs back">Revert</button><button class="btn small ghost" data-act="rrclear">Clear</button></div>`
      : `<div class="rr-base"><span>Pin these results, then change inputs to see the difference.</span><span class="grow"></span><button class="btn small" data-act="rrpin">Pin baseline</button></div>`;
    return `<div class="rr" id="rr">
      <div class="rr-top"><h3>Results</h3><span class="rr-meta">live · ${esc(hzLabel())} average</span><span class="grow"></span><button class="btn small ghost rr-close" data-act="rrsheet" aria-label="Close results">Close</button></div>
      ${hzButtons()}
      <div class="rr-kpis">
        <div class="kpi key"><span class="l">P90</span><span class="v">${rrNum('p90', pv.P90, 1)}<small>GWh/yr</small></span><span class="s">${base ? rrDelta(pv.P90, base.p90, 1, { same: true }) : 'exceeded 9 years in 10'}</span></div>
        <div class="kpi"><span class="l">P50${hasSolar() && r.focusN > 1 ? ', ' + esc(hzLabel()) : ''}</span><span class="v">${rrNum('p50', p50, 1)}<small>GWh/yr</small></span><span class="s">CUF ${fx(r.focusN === 1 || !hasSolar() ? r.en.cf * 100 : p50 * 1000 / (r.model.ctx.capacityMW * 8760) * 100, 1)} %${base ? ' ' + rrDelta(p50, base.p50, 1) : ''}</span></div>
        <div class="kpi"><span class="l">P90 / P50</span><span class="v">${rrNum('ratio', ratio, 1)}<small>%</small></span><span class="s">${base ? rrDelta(ratio, base.ratio, 1, { unit: ' pts', same: true }) : 'how far P90 sits below P50'}</span></div>
        <div class="kpi"><span class="l">Uncertainty σ</span><span class="v">${rrNum('sigma', f.sigma, 2, { pre: '±', goodUp: false })}<small>%</small></span><span class="s">${base ? rrDelta(f.sigma, base.sigma, 2, { goodUp: false, unit: ' pts', same: true }) : 'one standard deviation'}</span></div>
      </div>
      ${baseBar}
      <section class="rr-sec"><header><h4>Range of outcomes</h4><span class="rr-meta">${base ? 'dashed: baseline' : 'hover for the odds'}</span></header>${rrCurve(base)}${rrLevels(base)}</section>
      <section class="rr-sec"><header><h4>Gross to net</h4><button class="btn small ghost" data-act="rrall" aria-pressed="${rr.all}">${rr.all ? 'Groups' : 'Every loss'}</button></header>${rrBridge(b, base)}</section>
      ${rrStorage()}
      <section class="rr-sec"><header><h4>What drives the uncertainty</h4><span class="rr-meta">share of variance</span></header>${rrDrivers()}
        <div class="rr-ev">${mixBar(r.mix)}${legend()}${r.none.length ? `<p class="rr-foot">${r.none.length} item${r.none.length > 1 ? 's' : ''} excluded.</p>` : ''}</div></section>
      ${rrChecks()}
      <div class="rr-acts end"><button class="btn primary" data-stage="results">Full report</button><button class="btn" data-act="export">Export</button></div>
      <p class="rr-foot">P-values assume a normal distribution of the combined uncertainty. The full report adds a Monte Carlo check, the loss table and the register.</p>
    </div>`;
  }

  /* open an item where it lives: its plant part in the plant view, its stage in the step view */
  function openItem(key) {
    const it = itemMap()[key]; if (!it) return;
    closeSheet();
    if (pvMode()) {
      const pl = Plant.place(it);
      if (pl) {
        if (isHybrid()) { const fm = farmOf(pl.comp); if (fm) pv.view = fm; else if (!pvOrder().includes(pl.comp)) pv.view = 'site'; }
        pv.sel = pl.comp; pv.open = new Set([pl.group]); pv.hot = pl.group; savePv(); renderPlant(true);
        const card = document.getElementById('it-' + key), ins = $('#pvInsp');
        if (card && ins) { const fixed = getComputedStyle(ins).overflowY !== 'visible' && ins.scrollHeight > ins.clientHeight + 4; if (fixed) ins.scrollTop += card.getBoundingClientRect().top - ins.getBoundingClientRect().top - 60; else card.scrollIntoView({ block: 'center' }); card.classList.add('flash'); }
        return;
      }
    }
    const sid = isHybrid() ? it.stage : it.def.stage;
    if (pvMode()) { pv.mode = 'steps'; savePv(); $$('.vt button').forEach(bn => bn.setAttribute('aria-pressed', String(bn.dataset.val === 'steps'))); }
    go(chainOf().includes(it.stage) ? it.stage : sid);
    const card = document.getElementById('it-' + key);
    if (card) { card.scrollIntoView({ block: 'center' }); card.classList.add('flash'); }
  }
  function openPart(id) {
    closeSheet();
    if (id === 'buyer' && !pvMode()) { go('supply'); return; }
    if (id === 'bess' && !pvMode()) { go('bess'); return; }
    if (!pvMode()) { pv.mode = 'plant'; $$('.vt button').forEach(bn => bn.setAttribute('aria-pressed', String(bn.dataset.val === 'plant'))); }
    if (isHybrid()) { const fm = farmOf(id); if (fm) pv.view = fm; else if (id === 'bess' || id === 'buyer' || id === 'link') pv.view = 'site'; }
    pv.sel = id; pv.open.clear(); pv.hot = null; savePv();
    recompute(); renderStage(true); updateChrome();
    const ins = $('#pvInsp'); if (ins) ins.scrollTop = 0;
  }
  function closeSheet() { if (rr.sheet) { rr.sheet = false; document.body.classList.remove('rr-open'); } }
  function toggleSheet() { rr.sheet = !rr.sheet; document.body.classList.toggle('rr-open', rr.sheet); }

  /* rail buttons; returns true when the click was handled */
  function rrClick(e) {
    const it = e.target.closest('[data-item]');
    if (it) { e.preventDefault(); openItem(it.dataset.item); return true; }
    const g = e.target.closest('[data-brg]');
    if (g) { const id = g.dataset.brg; if (rr.open.has(id)) rr.open.delete(id); else rr.open.add(id); renderSide(); return true; }
    const p = e.target.closest('[data-part]');
    if (p) { e.preventDefault(); openPart(p.dataset.part); return true; }
    const a = e.target.closest('[data-act]');
    if (!a) return false;
    switch (a.dataset.act) {
      case 'rrpin': pinBase(); return true;
      case 'rrclear': clearBase(); return true;
      case 'rrrevert': revertBase(); return true;
      case 'rrall': rr.all = !rr.all; renderSide(); return true;
      case 'rrsheet': toggleSheet(); return true;
      default: return false;
    }
  }
  /* hover on the odds curve: energy at the pointer and how often it is exceeded */
  function rrPointer(e) {
    const h = e.target.closest && e.target.closest('[data-odds]');
    if (!h) { const c = $('#rrCur'); if (c) c.classList.remove('on'); return false; }
    const d = h.dataset, rect = h.ownerSVGElement.getBoundingClientRect(), W = +d.w, ml = +d.ml, mr = +d.mr;
    const sx = Math.max(ml, Math.min(W - mr, (e.clientX - rect.left) / rect.width * W));
    const v = +d.lo + (sx - ml) / (W - ml - mr) * (+d.hi - +d.lo), pex = 1 - ncdf((v - +d.p50) / +d.sd);
    const c = $('#rrCur'); if (c) { c.setAttribute('x1', sx); c.setAttribute('x2', sx); c.classList.add('on'); }
    showTip(`<b>${fx(v, 1)} GWh/yr</b> or more in ${pex > 0.995 ? 'over 99' : pex < 0.005 ? 'under 1' : fx(pex * 100, 0)} % of ${result.focusN === 1 ? 'years' : esc(hzLabel()) + ' periods'}`, e.clientX, e.clientY);
    return true;
  }

  /* ---------- loss table for the full report ---------- */
  function lossTable() {
    const b = E.lossBridge(result, result.focusN);
    const rows = b.groups.map(g => `<tr class="grp"><td class="txt">${g.comp && g.comp !== 'hybrid' ? esc(COMP_LABEL[g.comp]) + ' · ' : ''}${esc(g.name)}</td><td></td><td>${fx(g.L, 2)}</td><td></td><td>${g.lost < 0 ? '+' : '−'}${fx(Math.abs(g.lost), 2)}</td><td>${fx(g.after, 1)}</td></tr>` +
      g.steps.map(s => `<tr${s.excluded ? ' class="off"' : ''}><td class="txt sub">${esc(s.name)}</td><td class="txt">${esc(TIER[s.tier] ? TIER[s.tier].label : '')}</td><td>${s.excluded ? '–' : fx(s.L, 2)}${s.rate != null && !s.excluded ? `<br><span class="computed">${fx(s.rate, 2)} %/yr</span>` : ''}</td><td>${s.excluded ? '–' : '±' + fx(s.s, 2)}${s.iav > 0 ? `<br><span class="computed">yearly ±${fx(s.iav, 1)}</span>` : ''}</td><td>${s.excluded ? '–' : (s.lost < 0 ? '+' : '−') + fx(Math.abs(s.lost), 2)}</td><td>${fx(s.after, 1)}</td></tr>`).join('')).join('');
    const src = b.sources.map(s => `<tr class="hl"><td class="txt">${esc(s.name)}</td><td></td><td></td><td></td><td></td><td>${fx(s.gross, 1)}</td></tr>`).join('');
    return `<div class="tblwrap" style="max-height:560px"><table class="t loss"><thead><tr><th>Loss</th><th>Evidence</th><th>Loss, %</th><th>σ, pts</th><th>GWh/yr</th><th>GWh/yr left</th></tr></thead><tbody>${src}${rows}
      <tr class="hl"><td class="txt">Net at the meter, ${esc(hzLabel())} average</td><td></td><td>${fx(b.lossPct, 2)}</td><td>±${fx(b.lossSigma, 2)}</td><td>−${fx(b.gross - b.net, 2)}</td><td>${fx(b.net, 1)}</td></tr></tbody></table></div>
      <p class="formula">Each loss is a share of the energy left after the ones above it: net = gross × Π(1 − loss). The order changes each step's GWh, not the total. ±${fx(b.lossSigma, 2)} % is the uncertainty from losses alone, as if the gross energy were known exactly.${b.implied ? ' Gross is worked back from the P50 you entered.' : ''}</p>`;
  }
  function lossCsv() {
    const b = E.lossBridge(result, result.focusN), q = s => '"' + String(s).replace(/"/g, '""') + '"';
    const lines = [['Plant', 'Group', 'Loss', 'Evidence', 'Loss %', 'Sigma pts', 'Yearly variability pts', 'GWh/yr lost', 'GWh/yr left'].join(',')];
    b.sources.forEach(s => lines.push([q(s.comp || ''), q(s.name), '', '', '', '', '', '', s.gross.toFixed(3)].join(',')));
    b.steps.forEach(s => lines.push([q(s.comp || ''), q(s.groupName), q(s.name), q(TIER[s.tier] ? TIER[s.tier].label : ''), s.L.toFixed(3), s.s.toFixed(3), s.iav.toFixed(3), s.lost.toFixed(3), s.after.toFixed(3)].join(',')));
    lines.push(['', q('Net at the meter'), '', '', b.lossPct.toFixed(3), b.lossSigma.toFixed(3), '', (b.gross - b.net).toFixed(3), b.net.toFixed(3)].join(','));
    offerFile(slug(state.meta.name) + '.losses.csv', new Blob([lines.join('\r\n')], { type: 'text/csv' }));
  }
  LIVE.firmres = () => (firm.res ? `${firm.key !== firmKey() ? '<p class="warn">Inputs changed since this run. It is being simulated again.</p>' : ''}${firmResults()}` : '<p class="note">Simulating the plant and battery…</p>');
  LIVE.firmctl = () => { const busy = firm.running && !firm.auto; return `<button class="btn primary" data-act="firmrun" ${busy ? 'disabled' : ''}>${busy ? 'Running…' : firm.res ? 'Run again' : 'Run simulation'}</button>
          <button class="btn" data-act="firmdrivers" ${busy || !firm.res ? 'disabled' : ''}>Find what drives the risk</button>`; };
