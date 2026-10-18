  /* ======================= Plant view =======================
     A drawing of the plant. Each part carries a badge with its share of the energy uncertainty;
     selecting a part pops its categories out as bubbles, and the inspector beside the drawing
     holds the numbers and inputs. Everything reads and writes the same project state as the
     step-by-step view. */
  const PV_KEY = 'weu:plantview:v1';
  const pv = { mode: 'plant', view: null, sel: null, open: new Set(), hot: null, sum: null, scene: null, layout: '', full: false, ro: null, setupOpen: new Set(), popped: null };
  document.addEventListener('toggle', e => { const d = e.target; if (d && d.dataset && d.dataset.sk) { const k = d.dataset.sk; if (d.open) { pv.setupOpen.add(k); pv.setupOpen.delete('!' + k); } else { pv.setupOpen.delete(k); pv.setupOpen.add('!' + k); } } }, true);
  const skOpen = (key, dflt) => (pv.setupOpen.has(key) || (dflt && !pv.setupOpen.has('!' + key)) ? ' open' : '');
  (() => { try { const o = JSON.parse(localStorage.getItem(PV_KEY) || 'null'); if (o) { pv.mode = o.mode === 'steps' ? 'steps' : 'plant'; pv.view = o.view || null; pv.sel = o.sel || null; } } catch (e) { /* storage unavailable */ } })();
  function savePv() { try { localStorage.setItem(PV_KEY, JSON.stringify({ mode: pv.mode, view: pv.view, sel: pv.sel })); } catch (e) { /* ignore */ } }
  const pvMode = () => pv.mode === 'plant';
  const PC = Plant.COMPONENTS;
  const pvView = () => (isHybrid() ? (pv.view === 'wind' || pv.view === 'solar' ? pv.view : 'site') : ptech());
  const pvOrder = () => { const v = pvView(); const o = Plant.orderFor(state, v); return o; };
  const farmOf = id => (!id ? null : id === 'w' || id.startsWith('w.') ? 'wind' : id === 's' || id.startsWith('s.') ? 'solar' : null);
  const pvComp = () => (isHybrid() ? (pv.sel ? farmOf(pv.sel) : pvView() === 'site' ? null : pvView()) : null);
  const isDesk = () => ptech() !== 'solar' && state.setup.dataSource === 'desktop';
  function pvName(id) {
    const m = PC[id]; if (!m) return id;
    if (id === 'w.meas' && isDesk()) return m.nameDesk;
    if (isHybrid() && m.nameHybrid) return m.nameHybrid;
    return m.name;
  }
  const pvWhat = id => { const m = PC[id] || {}; return (id === 'w.meas' && isDesk() && m.whatDesk) || (isHybrid() && m.whatHybrid) || m.what || ''; };
  const VIEW_TITLE = { wind: 'Wind plant', solar: 'Solar PV plant', site: 'Hybrid site' };
  const pvTitle = () => (isHybrid() ? { site: 'Hybrid site', wind: 'Wind farm', solar: 'Solar farm' }[pvView()] : VIEW_TITLE[ptech()]);
  function pvNormalise() {
    if (!isHybrid()) pv.view = null; else if (!['site', 'wind', 'solar'].includes(pv.view)) pv.view = 'site';
    const ok = pvOrder();
    if (pv.sel && !ok.includes(pv.sel)) pv.sel = null;
    if (!pv.sel) pv.open.clear();
  }
  function pvSummarise() { pv.sum = Plant.summarise(state, result, E, Lb); return pv.sum; }

  /* numbers for a node: σ (relative to its own farm in a hybrid), share of the total, evidence mix */
  function pvStat(id) {
    const s = pv.sum;
    if (id === 'w' || id === 's') { const f = s.farms[id === 'w' ? 'wind' : 'solar']; return f ? { sigma: f.sigmaOwn, share: f.share, mix: f.mixShare, of: id === 'w' ? 'of wind energy' : 'of solar energy' } : null; }
    if (id === 'link') return { sigma: s.cross.sigma, share: s.cross.share, mix: null, link: true };
    const c = s.comps[id]; if (!c) return null;
    const of = isHybrid() && c.plant === 'wind' ? 'of wind energy' : isHybrid() && c.plant === 'solar' ? 'of solar energy' : isHybrid() ? 'of site energy' : 'of energy';
    return { sigma: c.sigmaOwn, share: c.share, mix: c.mixShare, of, status: c.status, loss: c.loss, excluded: c.excluded, c };
  }
  const heat = share => Math.pow(Math.min(1, Math.max(0, share) / 0.35), 0.75);
  function ring(mix, size) {
    const r = 6, Cc = 2 * Math.PI * r; let off = 0, segs = '';
    if (mix) TIER_ORDER.forEach(t => { const f = mix[t] || 0; if (f <= 0.002) return; segs += `<circle cx="9" cy="9" r="${r}" fill="none" stroke="var(--ev-${t})" stroke-width="4" stroke-dasharray="${(f * Cc).toFixed(2)} ${Cc.toFixed(2)}" stroke-dashoffset="${(-off * Cc).toFixed(2)}" transform="rotate(-90 9 9)"/>`; off += f; });
    return `<svg class="ring" width="${size || 18}" height="${size || 18}" viewBox="0 0 18 18" aria-hidden="true"><circle cx="9" cy="9" r="${r}" fill="none" stroke="var(--line)" stroke-width="4"/>${segs}</svg>`;
  }
  function pvMetric(id, short) {
    const st = pvStat(id);
    if (id === 'bess') { const b = state.bess; return `${fx(+b.powerMW, 0)} MW · ${fx(+b.energyMWh, 0)} MWh`; }
    if (id === 'buyer') return firm.res ? `${fx(firm.res.pMeet * 100, 0)} % chance to meet${firm.key !== firmKey() ? ' · old run' : ''}` : 'not simulated yet';
    if (!st) return '–';
    if (st.status === 'atlas') return 'in the wind atlas';
    if (st.status === 'empty') return 'nothing to assess';
    if (st.link) return Math.abs(st.share) < 0.0005 ? (short ? 'ρ = 0' : 'independent (ρ = 0)') : `${st.share > 0 ? '+' : '−'}${fx(Math.abs(st.share) * 100, short ? 0 : 1)} % of total`;
    return `±${fx(st.sigma, short ? 1 : 2)} % · ${fx(st.share * 100, 0)} % of total`;
  }

  /* ---------- drawing ---------- */
  const f1 = v => (+v).toFixed(1);
  const ART = {
    turbine(x, gy, hy, r, spin) {
      const bl = a => { const c = Math.cos(a), s = Math.sin(a), px = -s, py = c, w = Math.max(1.5, r * 0.055), tw = 0.7; const P = (d, k) => `${f1(x + c * d + px * k)},${f1(hy + s * d + py * k)}`; return `M${P(3, w)} L${P(r, tw)} L${P(r, -tw)} L${P(3, -w)} Z`; };
      const tw = Math.max(1.8, r * 0.06);
      return `<polygon class="kf" points="${f1(x - tw)},${gy} ${f1(x + tw)},${gy} ${f1(x + tw * 0.5)},${hy + 3} ${f1(x - tw * 0.5)},${hy + 3}"/>
        <g class="${spin ? 'spin' : ''}" style="transform-origin:${x}px ${hy}px"><path class="kf" d="${[-90, 30, 150].map(d => bl(d * Math.PI / 180)).join(' ')}"/></g>
        <circle class="kf" cx="${x}" cy="${hy}" r="${f1(Math.max(2.4, r * 0.07))}"/>`;
    },
    cup(x, y) { return `<line class="k thin" x1="${x}" y1="${y + 4}" x2="${x}" y2="${y}"/><line class="k thin" x1="${x - 3.4}" y1="${y}" x2="${x + 3.4}" y2="${y}"/><circle class="kf" cx="${x - 3.6}" cy="${y}" r="2"/><circle class="kf" cx="${x + 3.6}" cy="${y}" r="2"/>`; },
    mast(x, gy, ty) {
      const h = gy - ty, pts = [];
      for (let y = gy, i = 0; y >= ty; y -= 10, i++) pts.push(`${i % 2 ? x + 2.6 : x - 2.6},${f1(y)}`);
      const gyw = Math.min(26, h * 0.16), ya = ty + h * 0.3, ym = ty + h * 0.48;
      return `<line class="k thin dash" x1="${x}" y1="${f1(ya)}" x2="${f1(x - gyw)}" y2="${gy}"/><line class="k thin dash" x1="${x}" y1="${f1(ya)}" x2="${f1(x + gyw)}" y2="${gy}"/>
        <line class="k" x1="${x - 2.6}" y1="${gy}" x2="${x - 2.6}" y2="${f1(ty)}"/><line class="k" x1="${x + 2.6}" y1="${gy}" x2="${x + 2.6}" y2="${f1(ty)}"/>
        <polyline class="k thin" points="${pts.join(' ')}"/><line class="k" x1="${x}" y1="${f1(ty)}" x2="${x}" y2="${f1(ty - 8)}"/>
        <line class="k" x1="${x + 2.6}" y1="${f1(ty + 4)}" x2="${x + 16}" y2="${f1(ty + 4)}"/>${ART.cup(x + 16, ty)}
        <line class="k" x1="${x - 2.6}" y1="${f1(ym)}" x2="${x - 14}" y2="${f1(ym)}"/>${ART.cup(x - 14, ym - 4)}`;
    },
    lidar(x, gy, ty) {
      const b = gy - 16;
      return `<path class="k thin dash" d="M${x - 3},${b} L${x - 19},${f1(ty)} M${x + 3},${b} L${x + 19},${f1(ty)}"/>
        ${[0.3, 0.55, 0.8, 1].map(f => { const y = b - (b - ty) * f, w = 3 + 16 * f; return `<line class="k thin" x1="${f1(x - w)}" y1="${f1(y)}" x2="${f1(x + w)}" y2="${f1(y)}"/>`; }).join('')}
        <rect class="kf" x="${x - 11}" y="${b}" width="22" height="16" rx="2"/><circle class="k" cx="${x}" cy="${b + 7}" r="3"/>`;
    },
    atlas(x, gy) {
      return `<path class="kf" d="M${x - 30},${gy - 52} l20,-8 l20,8 l20,-8 v52 l-20,8 l-20,-8 l-20,8 z"/><path class="k thin" d="M${x - 10},${gy - 60} v52 M${x + 10},${gy - 52} v52"/>
        <path class="k thin" d="M${x - 24},${gy - 30} q12,-14 22,-4 t24,-6"/><circle class="kf" cx="${x + 8}" cy="${gy - 40}" r="4"/>`;
    },
    satellite(x, y) {
      const panel = x0 => `<rect class="kf" x="${x0}" y="${y - 5}" width="18" height="10" rx="1"/><line class="k thin" x1="${x0 + 6}" y1="${y - 5}" x2="${x0 + 6}" y2="${y + 5}"/><line class="k thin" x1="${x0 + 12}" y1="${y - 5}" x2="${x0 + 12}" y2="${y + 5}"/>`;
      return `${panel(x - 28)}${panel(x + 10)}<line class="k" x1="${x - 10}" y1="${y}" x2="${x - 7}" y2="${y}"/><line class="k" x1="${x + 7}" y1="${y}" x2="${x + 10}" y2="${y}"/>
        <rect class="kf" x="${x - 7}" y="${y - 7}" width="14" height="14" rx="2"/><line class="k" x1="${x}" y1="${y + 7}" x2="${x}" y2="${y + 11}"/><path class="k" d="M${x - 5},${y + 11} Q${x},${y + 17} ${x + 5},${y + 11}"/>`;
    },
    sun(x, y, r) { return `${Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4, c = Math.cos(a), s = Math.sin(a); return `<line class="k" x1="${f1(x + c * (r + 4))}" y1="${f1(y + s * (r + 4))}" x2="${f1(x + c * (r + 10))}" y2="${f1(y + s * (r + 10))}"/>`; }).join('')}<circle class="kf sunc" cx="${x}" cy="${y}" r="${r}"/>`; },
    cloud(x, y) { return `<path class="kf" d="M${x - 24},${y + 9} H${x + 22} A8,8 0 0 0 ${x + 19},${y - 5} A12,12 0 0 0 ${x - 1},${y - 12} A9,9 0 0 0 ${x - 17},${y - 2} A6,6 0 0 0 ${x - 24},${y + 9} Z"/>`; },
    station(x, gy, h) { return `<line class="k" x1="${x}" y1="${gy}" x2="${x}" y2="${gy - h}"/><line class="k" x1="${x - 12}" y1="${gy - h + 4}" x2="${x + 12}" y2="${gy - h + 4}"/><path class="kf" d="M${x - 12 - 5},${gy - h + 4} a5,5 0 0 1 10,0 z M${x + 12 - 5},${gy - h + 4} a5,5 0 0 1 10,0 z"/><line class="k thin" x1="${x - 8}" y1="${gy}" x2="${x}" y2="${gy - 18}"/><line class="k thin" x1="${x + 8}" y1="${gy}" x2="${x}" y2="${gy - 18}"/><rect class="kf" x="${x - 6}" y="${gy - 34}" width="12" height="10" rx="1"/>`; },
    panels(x0, gy, n, mount, step) {
      let s = ''; step = step || 62;
      for (let i = 0; i < n; i++) {
        const x = x0 + i * step;
        if (mount === 'tracker') s += `<line class="k" x1="${x + 21}" y1="${gy}" x2="${x + 21}" y2="${gy - 22}"/><polygon class="kf pvc" points="${x - 6},${gy - 30} ${x + 48},${gy - 30} ${x + 44},${gy - 22} ${x - 2},${gy - 22}"/><line class="k thin" x1="${x + 12}" y1="${gy - 30}" x2="${x + 14}" y2="${gy - 22}"/><line class="k thin" x1="${x + 30}" y1="${gy - 30}" x2="${x + 29}" y2="${gy - 22}"/>`;
        else if (mount === 'ew') s += `<polygon class="kf pvc" points="${x - 4},${gy - 6} ${x + 21},${gy - 24} ${x + 23},${gy - 20} ${x + 1},${gy - 3}"/><polygon class="kf pvc" points="${x + 46},${gy - 6} ${x + 21},${gy - 24} ${x + 19},${gy - 20} ${x + 41},${gy - 3}"/><line class="k thin" x1="${x}" y1="${gy}" x2="${x + 42}" y2="${gy}"/>`;
        else s += `<line class="k" x1="${x + 4}" y1="${gy - 10}" x2="${x + 4}" y2="${gy}"/><line class="k" x1="${x + 40}" y1="${gy - 10}" x2="${x + 40}" y2="${gy}"/><polygon class="kf pvc" points="${x},${gy - 10} ${x + 46},${gy - 10} ${x + 40},${gy - 34} ${x - 6},${gy - 34}"/><line class="k thin" x1="${x + 15}" y1="${gy - 10}" x2="${x + 9}" y2="${gy - 34}"/><line class="k thin" x1="${x + 31}" y1="${gy - 10}" x2="${x + 25}" y2="${gy - 34}"/><line class="k thin" x1="${x - 3}" y1="${gy - 22}" x2="${x + 43}" y2="${gy - 22}"/>`;
      }
      return s;
    },
    inverter(x, gy) { return `<rect class="kf" x="${x - 10}" y="${gy - 28}" width="20" height="28" rx="2"/><path class="k thin" d="M${x - 6},${gy - 17} q3,-6 6,0 t6,0"/><line class="k thin" x1="${x - 6}" y1="${gy - 8}" x2="${x + 6}" y2="${gy - 8}"/><line class="k thin" x1="${x - 6}" y1="${gy - 5}" x2="${x + 6}" y2="${gy - 5}"/>`; },
    substation(x, gy) {
      return `<rect class="k thin dash" x="${x - 38}" y="${gy - 46}" width="76" height="46" rx="2" fill="none"/>
        <rect class="kf" x="${x - 28}" y="${gy - 22}" width="24" height="22" rx="2"/><circle class="kf" cx="${x - 20}" cy="${gy - 30}" r="6"/><circle class="kf" cx="${x - 12}" cy="${gy - 30}" r="6"/>
        <line class="k" x1="${x + 8}" y1="${gy}" x2="${x + 8}" y2="${gy - 40}"/><line class="k" x1="${x + 28}" y1="${gy}" x2="${x + 28}" y2="${gy - 40}"/><line class="k" x1="${x + 4}" y1="${gy - 38}" x2="${x + 32}" y2="${gy - 38}"/>
        <line class="k thin" x1="${x + 13}" y1="${gy - 38}" x2="${x + 13}" y2="${gy - 32}"/><line class="k thin" x1="${x + 23}" y1="${gy - 38}" x2="${x + 23}" y2="${gy - 32}"/>`;
    },
    pylon(x, gy, h, wireTo) {
      const t = gy - h, pts = [];
      for (let i = 0, y = gy; y > t + 6; y -= 14, i++) { const f = (gy - y) / h; const hw = 14 - 11 * f; pts.push(`${f1(i % 2 ? x + hw : x - hw)},${f1(y)}`); }
      const w = wireTo ? `<path class="k thin" d="M${x + 20},${t + 12} Q${f1((x + wireTo) / 2)},${t + 30} ${wireTo},${t + 16} M${x + 15},${t + 26} Q${f1((x + wireTo) / 2)},${t + 44} ${wireTo},${t + 30}"/>` : '';
      return `${w}<line class="k" x1="${x - 14}" y1="${gy}" x2="${x - 3}" y2="${t}"/><line class="k" x1="${x + 14}" y1="${gy}" x2="${x + 3}" y2="${t}"/><polyline class="k thin" points="${pts.join(' ')}"/>
        <line class="k" x1="${x - 20}" y1="${t + 8}" x2="${x + 20}" y2="${t + 8}"/><line class="k" x1="${x - 15}" y1="${t + 22}" x2="${x + 15}" y2="${t + 22}"/>
        ${[[-20, 8], [20, 8], [-15, 22], [15, 22]].map(([dx, dy]) => `<line class="k thin" x1="${x + dx}" y1="${t + dy}" x2="${x + dx}" y2="${t + dy + 5}"/>`).join('')}`;
    },
    meter(x, y) { return `<rect class="kf" x="${x - 8}" y="${y - 10}" width="16" height="20" rx="2"/><circle class="k thin" cx="${x}" cy="${y - 3}" r="4"/><line class="k thin" x1="${x}" y1="${y - 3}" x2="${x + 3}" y2="${y - 6}"/><line class="k thin" x1="${x - 5}" y1="${y + 5}" x2="${x + 5}" y2="${y + 5}"/>`; },
    battery(x, gy) {
      const box = x0 => `<rect class="kf" x="${x0}" y="${gy - 22}" width="30" height="22" rx="1.5"/>${[6, 12, 18, 24].map(d => `<line class="k thin" x1="${x0 + d}" y1="${gy - 19}" x2="${x0 + d}" y2="${gy - 3}"/>`).join('')}`;
      return `${box(x - 32)}${box(x + 2)}<rect class="kf" x="${x - 8}" y="${gy - 36}" width="16" height="10" rx="1.5"/><rect class="k" x="${x + 8}" y="${gy - 33}" width="2.5" height="4"/><line class="k thin" x1="${x - 4}" y1="${gy - 31}" x2="${x + 4}" y2="${gy - 31}"/>`;
    },
    buyer(x, gy) {
      return `<path class="kf" d="M${x - 30},${gy} V${gy - 22} L${x - 20},${gy - 30} V${gy - 22} L${x - 10},${gy - 30} V${gy - 22} L${x},${gy - 30} V${gy - 22} H${x + 6} V${gy - 46} H${x + 13} V${gy - 22} H${x + 30} V${gy} Z"/>
        ${[-24, -14, -4, 18].map(d => `<rect class="k thin" x="${x + d}" y="${gy - 14}" width="5" height="6" fill="none"/>`).join('')}`;
    },
    hills(x0, x1, gy) { const m = (x0 + x1) / 2; return `<path class="hill" d="M${x0},${gy} C${x0 + 40},${gy - 12} ${m - 50},${gy - 22} ${m},${gy - 10} S${x1 - 40},${gy - 16} ${x1},${gy} Z"/>`; },
  };
  const DEFS = `<defs><marker id="pvArr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs>`;
  // a plate is a rectangle, a list of rectangles, or { band: path } for a highlighter stroke along an arrow
  const plateSvg = (id, p) => (p.band ? `<path class="plate band" data-plate="${id}" d="${p.band}" style="stroke-width:${p.w || 30}px"/>` : `<rect class="plate" data-plate="${id}" x="${p[0]}" y="${p[1]}" width="${p[2]}" height="${p[3]}" rx="14"/>`);
  const grp = (id, plate, inner, extra) => `<g class="pc${pv.sel === id ? ' on' : ''}${extra ? ' ' + extra : ''}" data-pc="${id}">${(Array.isArray(plate[0]) ? plate : [plate]).map(p => plateSvg(id, p)).join('')}${inner}</g>`;

  function tailParts(x, gy, a, opts) {
    // battery, grid and buyer to the right of x; returns { svg, W }
    let s = '';
    const bessOn = opts.bess;
    let xb = x, xg = x;
    if (bessOn) { xb = x + 70; s += `<path class="k thin dash" d="M${x - 20},${gy + 16} H${xb}"/>` + grp('bess', [xb - 40, gy - 46, 80, 52], ART.battery(xb, gy)); a.bess = { x: xb, y: gy - 18, row: 'bot' }; xg = xb + 84; }
    else xg = x + 84;
    const W = bessOn ? xg + 150 : xg + 70;
    s += `<path class="k thin dash" d="M${x},${gy + 16} H${xg} V${gy}"/>`;
    s += grp('grid', [xg - 50, gy - 112, 92, 120], ART.pylon(xg, gy, 96, bessOn ? xg + 96 : W) + ART.meter(xg - 34, gy - 12));
    a.grid = { x: xg, y: gy - 52, row: 'bot' };
    if (bessOn) { const xu = xg + 112; s += grp('buyer', [xu - 40, gy - 58, 80, 64], ART.buyer(xu, gy)); a.buyer = { x: xu, y: gy - 22, row: 'bot' }; }
    return { svg: s, W };
  }
  function ground(W, gy, H) { return `<rect class="gnd" x="0" y="${gy}" width="${W}" height="${H - gy}"/><line class="gl" x1="0" y1="${gy}" x2="${W}" y2="${gy}"/>`; }

  function windScene(opts) {
    const gy = 300, hy = 104, H = 344, a = {};
    const hub = Math.max(10, +state.plant.hubH || 120);
    const ty = h => Math.max(hy - 10, gy - (gy - hy) * Math.min(1.1, Math.max(0.15, (+h || hub) / hub)));
    const desk = isDesk();
    const devs = desk ? [] : state.devices.slice(0, 3);
    const dx = i => 62 + i * 52;
    let s = '';
    const xLast = desk ? 120 : dx(Math.max(0, devs.length - 1));
    const xv = xLast + 36;
    const yMeas = ty(+state.vertical.hMeas || hub);
    // long-term reference
    s += grp('w.lt', [40, 14, 96, 58], ART.satellite(86, 40) + (desk ? '' : devs.map((d, i) => `<line class="k thin sig" x1="86" y1="60" x2="${dx(i)}" y2="${f1(ty(d.height) - 10)}"/>`).join('')), desk ? 'muted' : '');
    a['w.lt'] = { x: 86, y: 40, row: 'top' };
    // hills and the hub-height guide
    s += ART.hills(xv - 10, 470, gy);
    s += `<line class="guide" x1="${desk ? 90 : dx(0) - 14}" y1="${hy}" x2="800" y2="${hy}"/>`;
    // masts and lidars, or the wind atlas
    const topMin = desk ? gy - 70 : Math.min(...devs.map(d => ty(d.height)));
    s += grp('w.meas', [desk ? 80 : dx(0) - 34, topMin - 18, desk ? 80 : (devs.length - 1) * 52 + 68, gy - topMin + 26],
      desk ? ART.atlas(120, gy) : devs.map((d, i) => (d.type === 'lidar' ? ART.lidar(dx(i), gy, ty(d.height)) : ART.mast(dx(i), gy, ty(d.height)))).join('') + (state.devices.length > 3 ? `<text class="ct" x="${dx(2) + 26}" y="${gy - 6}">+${state.devices.length - 3}</text>` : ''));
    a['w.meas'] = { x: desk ? 120 : (dx(0) + xLast) / 2, y: Math.round((gy + topMin) / 2) + 20, row: 'bot' };
    // vertical extrapolation
    const yv = Math.max(yMeas, hy + 6);
    s += grp('w.vert', { band: `M${xv},${f1(yv + 2)} L${xv},${hy}`, w: 30 }, `<line class="k thin" x1="${xv - 8}" y1="${f1(yv)}" x2="${xv + 8}" y2="${f1(yv)}"/><line class="k arrow" x1="${xv}" y1="${f1(yv)}" x2="${xv}" y2="${hy + 3}" marker-end="url(#pvArr)"/>`, desk ? 'muted' : '');
    a['w.vert'] = { x: xv, y: Math.round((hy + yv) / 2), row: 'top' };
    // horizontal extrapolation
    const x1 = xv + 22, x2 = 452;
    s += grp('w.horiz', { band: `M${x1 + 10},${hy + 18} C${x1 + 66},${hy - 40} ${x2 - 96},${hy - 40} ${x2 - 8},${hy + 14}`, w: 46 }, `<path class="k arrow" d="M${x1},${hy + 22} C${x1 + 60},${hy - 52} ${x2 - 90},${hy - 52} ${x2},${hy + 14}" marker-end="url(#pvArr)"/>
      <path class="k thin dash" d="M${x1 + 30},${hy + 30} C${x1 + 80},${hy - 14} ${x2 - 100},${hy - 14} ${x2 - 24},${hy + 26}"/>`, desk ? 'muted' : '');
    a['w.horiz'] = { x: Math.round((x1 + x2) / 2), y: hy - 30, row: 'top' };
    // future wind
    s += grp('w.future', [604, 12, 116, 60], ART.sun(634, 40, 13) + ART.cloud(678, 50));
    a['w.future'] = { x: 656, y: 40, row: 'top' };
    // turbines
    const nT = Math.max(1, Math.min(3, Math.round(+state.plant.nTurbines || 3)));
    const tx = [516, 624, 732].slice(0, nT);
    s += grp('w.turbines', [462, hy - 60, 330, gy - hy + 66], tx.map(x => ART.turbine(x, gy, hy, 52, true)).join('') + (+state.plant.nTurbines > 3 ? `<text class="ct" x="${tx[tx.length - 1] + 30}" y="${gy - 8}">×${Math.round(+state.plant.nTurbines)}</text>` : ''));
    a['w.turbines'] = { x: 624, y: Math.round((hy + gy) / 2) + 30, row: 'bot' };
    // cables and substation
    const xs = 846;
    s += grp('w.elec', [xs - 46, gy - 56, 92, 84], `<path class="k thin dash" d="${tx.map(x => `M${x},${gy} V${gy + 16}`).join(' ')} M${tx[0]},${gy + 16} H${xs - 20} V${gy}"/>` + ART.substation(xs, gy));
    a['w.elec'] = { x: xs, y: gy - 22, row: 'bot' };
    const tail = tailParts(xs + 20, gy, a, opts);
    s += tail.svg;
    const W = Math.max(1000, tail.W);
    return { W, H, gy, svg: ground(W, gy, H) + s, anchors: a };
  }

  function solarScene(opts) {
    const gy = 300, H = 344, a = {};
    const mount = state.pv.mount;
    let s = '';
    const site = state.setup.solarSource !== 'satellite';
    s += grp('s.irr', site ? [36, 12, 100, gy - 4] : [36, 12, 100, 62], ART.satellite(84, 40) + (site ? ART.station(96, gy, 70) : '') + (site ? `<line class="k thin sig" x1="84" y1="60" x2="96" y2="${gy - 76}"/>` : ''));
    a['s.irr'] = { x: 86, y: 40, row: 'top' };
    s += grp('s.future', [262, 10, 120, 64], ART.sun(296, 42, 15) + ART.cloud(342, 54));
    a['s.future'] = { x: 318, y: 42, row: 'top' };
    s += grp('s.model', { band: `M306,82 L446,${gy - 56}`, w: 44 }, `<path class="k thin dash" d="M310,78 L428,${gy - 52} M290,82 L370,${gy - 48}"/><path class="k arrow" d="M302,80 L456,${gy - 50}" marker-end="url(#pvArr)"/>`);
    a['s.model'] = { x: 380, y: 166, row: 'top' };
    const n = 4, x0 = 452, step = 62;
    s += grp('s.array', [x0 - 16, gy - 46, n * step + 4, 56], ART.panels(x0, gy, n, mount, step));
    a['s.array'] = { x: x0 + (n * step) / 2 - 10, y: gy - 22, row: 'bot' };
    const xi = x0 + n * step + 28;
    s += grp('s.inv', [xi - 18, gy - 40, 62, 46], `<path class="k thin dash" d="M${x0 + 20},${gy} V${gy + 14} H${xi} V${gy}"/>` + ART.inverter(xi, gy) + ART.inverter(xi + 26, gy));
    a['s.inv'] = { x: xi + 13, y: gy - 16, row: 'bot' };
    const xs = xi + 112;
    s += grp('s.sub', [xs - 46, gy - 56, 92, 84], `<path class="k thin dash" d="M${xi + 26},${gy} V${gy + 16} H${xs - 20} V${gy}"/>` + ART.substation(xs, gy));
    a['s.sub'] = { x: xs, y: gy - 22, row: 'bot' };
    const tail = tailParts(xs + 20, gy, a, opts);
    s += tail.svg;
    const W = Math.max(1000, tail.W);
    return { W, H, gy, svg: ground(W, gy, H) + s, anchors: a };
  }

  function siteScene(opts) {
    const gy = 300, H = 344, a = {};
    let s = '';
    s += `<g class="deco">${ART.sun(560, 40, 13)}${ART.cloud(606, 50)}</g>`;
    s += grp('w', [36, 92, 252, gy - 86], [86, 162, 238].map(x => ART.turbine(x, gy, 150, 38, true)).join(''), 'farm');
    a.w = { x: 162, y: 226, row: 'bot' };
    const x0 = 330, step = 58, n = 4;
    s += grp('s', [x0 - 16, gy - 46, n * step + 4, 56], ART.panels(x0, gy, n, state.pv.mount, step), 'farm');
    a.s = { x: x0 + (n * step) / 2 - 10, y: gy - 22, row: 'bot' };
    s += grp('link', { band: 'M206,96 C258,30 422,30 470,' + (gy - 70), w: 34 }, `<path class="k arrow" d="M196,104 C250,24 430,24 478,${gy - 58}" marker-start="url(#pvArr)" marker-end="url(#pvArr)"/><circle class="kf" cx="339" cy="61" r="9"/><path class="k thin" d="M334,61 q2.5,-5 5,0 t5,0"/>`);
    a.link = { x: 339, y: 61, row: 'top' };
    const xs = x0 + n * step + 70;
    s += `<path class="k thin dash" d="M162,${gy} V${gy + 18} H${xs - 20} V${gy} M${x0 + 20},${gy} V${gy + 12} H${xs - 26}"/>`;
    // shared substation and the grid connection belong to one part here
    const bessOn = opts.bess;
    const xb = xs + 86, xg = bessOn ? xb + 90 : xs + 96;
    const W = bessOn ? xg + 150 : Math.max(900, xg + 70);
    let gsvg = ART.substation(xs, gy) + `<path class="k thin dash" d="M${xs + 28},${gy} V${gy + 16} H${xg} V${gy}"/>` + ART.pylon(xg, gy, 96, bessOn ? xg + 96 : W) + ART.meter(xg - 34, gy - 12);
    s += grp('grid', bessOn ? [[xs - 46, gy - 56, 92, 64], [xg - 50, gy - 112, 92, 120]] : [xs - 46, gy - 112, xg - xs + 90, 120], gsvg);
    a.grid = { x: Math.round((xs + xg) / 2), y: gy - 40, row: 'bot' };
    if (bessOn) {
      s += grp('bess', [xb - 40, gy - 46, 80, 52], ART.battery(xb, gy)); a.bess = { x: xb, y: gy - 18, row: 'bot' };
      const xu = xg + 112; s += grp('buyer', [xu - 40, gy - 58, 80, 64], ART.buyer(xu, gy)); a.buyer = { x: xu, y: gy - 22, row: 'bot' };
    }
    return { W, H, gy, svg: ground(W, gy, H) + s, anchors: a };
  }
  function pvScene() {
    const v = pvView(), bess = hasBess() && !(isHybrid() && v !== 'site');
    return v === 'site' ? siteScene({ bess }) : v === 'solar' ? solarScene({ bess }) : windScene({ bess });
  }

  /* small icons for the phone chain */
  function pvIcon(id) {
    const box = (vb, inner) => `<svg class="pv-ico" viewBox="${vb}" aria-hidden="true">${inner}</svg>`;
    switch (id) {
      case 'w.meas': return isDesk() ? box('82 230 76 76', ART.atlas(120, 296)) : box('70 150 60 60', state.devices[0] && state.devices[0].type === 'lidar' ? ART.lidar(100, 206, 158) : ART.mast(100, 206, 158));
      case 'w.lt': case 's.irr': return box('54 18 64 46', ART.satellite(86, 40));
      case 'w.vert': return box('0 0 40 40', `<line class="k thin" x1="12" y1="34" x2="28" y2="34"/><line class="k arrow" x1="20" y1="34" x2="20" y2="6" marker-end="url(#pvArrI)"/>`);
      case 'w.horiz': return box('0 0 48 40', `<path class="k arrow" d="M6,30 C16,4 32,4 42,26" marker-end="url(#pvArrI)"/>`);
      case 'w.future': case 's.future': return box('612 16 90 48', ART.sun(634, 40, 13) + ART.cloud(678, 50));
      case 'w.turbines': case 'w': return box('40 30 100 100', ART.turbine(90, 128, 70, 40, false));
      case 'w.elec': case 's.sub': return box('56 50 88 56', ART.substation(100, 100));
      case 'grid': return box('50 0 100 104', ART.pylon(100, 100, 92, 0) + ART.meter(66, 88));
      case 's.model': return box('0 0 48 40', `<path class="k thin dash" d="M6,8 L36,32"/><path class="k arrow" d="M6,4 L42,30" marker-end="url(#pvArrI)"/>`);
      case 's.array': case 's': return box('0 60 110 44', ART.panels(8, 100, 2, state.pv.mount, 54));
      case 's.inv': return box('70 66 60 38', ART.inverter(86, 100) + ART.inverter(112, 100));
      case 'bess': return box('60 60 80 44', ART.battery(100, 100));
      case 'buyer': return box('62 50 76 54', ART.buyer(100, 100));
      case 'link': return box('0 0 48 40', `<path class="k arrow" d="M6,32 C12,4 36,4 42,32" marker-start="url(#pvArrI)" marker-end="url(#pvArrI)"/>`);
      default: return '';
    }
  }
  const DEFS_I = `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><marker id="pvArrI" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="currentColor"/></marker></defs></svg>`;

  /* ---------- the bar above the drawing ---------- */
  function pvBarTot() {
    const r = result, pvv = r.focus.pv, p50 = r.focus.p50;
    return `<div class="bb-fig"><span class="l">P50${hasSolar() && r.focusN > 1 ? ', ' + hzLabel() : ''}</span><span class="v">${fx(p50, 1)} <small>GWh/yr</small></span></div>
      <div class="bb-fig"><span class="l">P90, ${hzLabel()}</span><span class="v">${fx(pvv.P90, 1)}</span></div>
      <div class="bb-fig"><span class="l">P90 / P50</span><span class="v ratio">${fx(pvv.P90 / p50 * 100, 1)} %</span></div>
      <div class="bb-fig"><span class="l">Total σ</span><span class="v">±${fx(r.focus.sigma, 2)} %</span></div>`;
  }
  function pvBar() {
    const t = ptech();
    return `<div class="pv-bar">
      <div class="pv-pick"><div class="seg" role="group" aria-label="Plant type">${[['wind', 'Wind'], ['solar', 'Solar PV'], ['hybrid', 'Hybrid']].map(([k, l]) => `<button data-set="tech" data-val="${k}" aria-pressed="${t === k}">${l}</button>`).join('')}</div>
        <button class="pv-chip" data-set="bess.enabled" data-type="bool" data-val="${!hasBess()}" aria-pressed="${hasBess()}">${hasBess() ? '<span aria-hidden="true">✓</span> Battery' : '+ Battery'}</button></div>
      <div class="pv-tot" data-live="pvbar|">${pvBarTot()}</div>
      <div class="pv-hz">${hzButtons()}</div>
    </div>`;
  }

  /* ---------- badges, bubbles and leader lines ---------- */
  function badgeHtml(id, compact) {
    const st = pvStat(id) || {};
    const h = id === 'bess' || id === 'buyer' || st.link ? 0 : heat(st.share || 0);
    const muted = st.status === 'atlas' || st.status === 'empty';
    const r = id === 'bess' || id === 'buyer' ? '' : st.link ? '' : ring(st.mix);
    return `<button class="pv-badge${pv.sel === id ? ' on' : ''}${muted ? ' muted' : ''}${compact ? ' compact' : ''}" data-pc="${id}" style="--heat:${h.toFixed(3)}" aria-pressed="${pv.sel === id}" aria-label="${esc(pvName(id))}: ${esc(pvMetric(id))}">
      ${r}<span class="bt"><span class="bn">${esc(pvName(id))}</span><span class="bm">${esc(pvMetric(id, compact))}</span></span></button>`;
  }
  function bubbleList(id) {
    const c = pv.sum.comps[id];
    if (!c || !c.groups.length) return [];
    return c.groups.map(g => {
      let val, unit = '%';
      if (id === 'bess') { const x = g.items.find(y => y.it.id !== 'bess_cap' && y.it.id !== 'bess_aux') || g.items[0]; const it = x && x.it; const u = (it && it.def.bunit) || {}; val = it ? fx(it.L, Math.abs(it.L) < 10 ? 1 : 0) : '–'; unit = String(u.L || '').split(' ')[0]; }
      else val = '±' + fx(isHybrid() && (c.plant === 'wind' || c.plant === 'solar') ? g.sigmaOwn : g.sigma, 1);
      const sh = id === 'bess' ? 0.25 : g.shareInComp;
      return { id: g.id, name: g.name, val, unit, sh, off: g.items.every(x => x.it.mode === 'none'), mix: g.mixShare, items: g.items.length };
    });
  }
  function bubbleHtml(b, i, style, inline) {
    return `<button class="pv-bub${pv.hot === b.id ? ' on' : ''}${b.off ? ' off' : ''}${inline ? ' inl' : ''}${pv.popped === pv.sel ? ' still' : ''}" data-pg="${esc(b.id)}" data-bub="1" style="${style || ''}--i:${i}" aria-label="${esc(b.name)}: ${esc(b.val)} ${esc(b.unit)}${b.off ? ', excluded' : ''}">
      <span class="b-c"><b>${esc(b.val)}</b><small>${esc(b.unit)}</small></span><span class="b-l">${esc(b.name)}</span></button>`;
  }

  function pvPlace() {
    const cv = $('#pvCanvas'); if (!cv || !pv.scene) return;
    if (!cv.classList.contains('wide')) return;
    const sc = pv.scene, cw = cv.clientWidth; if (!cw) return;
    const k = cw / sc.W;
    const order = pvOrder().filter(id => sc.anchors[id]);
    const GAP = 8, LANE = 54, compact = cw < 720;
    const topEl = $('#pvTop'), botEl = $('#pvBot');
    const ae = document.activeElement, hadFocus = ae && cv.contains(ae) ? (ae.dataset.pc ? `.pv-badge[data-pc="${CSS.escape(ae.dataset.pc)}"]` : ae.dataset.pg ? `.pv-bub[data-pg="${CSS.escape(ae.dataset.pg)}"]` : null) : null;
    // render the badges once to measure them
    const rowIds = row => order.filter(id => sc.anchors[id].row === row);
    topEl.innerHTML = rowIds('top').map(id => badgeHtml(id, compact)).join('');
    botEl.innerHTML = rowIds('bot').map(id => badgeHtml(id, compact)).join('');
    const widths = {}; $$('.pv-badge', cv).forEach(b => { widths[b.dataset.pc] = Math.min(cw, b.offsetWidth); });
    const spread = items => {
      // 1-D label placement: merge overlapping neighbours into clusters centred on their wanted spots
      let cl = items.map(o => ({ items: [o], left: o.want - o.w / 2, width: o.w }));
      const fit = c => { let off = 0, sum = 0; c.items.forEach(o => { sum += o.want - o.w / 2 - off; off += o.w + GAP; }); c.width = off - GAP; c.left = Math.max(0, Math.min(cw - c.width, sum / c.items.length)); };
      cl.forEach(fit);
      for (let guard = 0; guard < 50; guard++) {
        let merged = false;
        for (let i = 0; i + 1 < cl.length; i++) if (cl[i].left + cl[i].width + GAP > cl[i + 1].left) { cl[i] = { items: cl[i].items.concat(cl[i + 1].items) }; fit(cl[i]); cl.splice(i + 1, 1); merged = true; break; }
        if (!merged) break;
      }
      let worst = 0;
      cl.forEach(c => { let x = c.left; c.items.forEach(o => { o.left = x; worst = Math.max(worst, Math.abs(x + o.w / 2 - o.want)); x += o.w + GAP; }); });
      return worst;
    };
    const lanesOf = row => {
      const items = rowIds(row).map(id => ({ id, w: widths[id] || 140, want: sc.anchors[id].x * k })).sort((p, q) => p.want - q.want);
      items.forEach(o => { o.lane = 0; });
      const worst = spread(items.map(o => Object.assign({}, o)));
      if (items.length > 1 && worst > 60) {
        // move only the badges that collide at their wanted spot to the second lane
        const end = [-1e9, -1e9];
        items.forEach(o => { const l = o.want - o.w / 2; o.lane = l >= end[0] + GAP ? 0 : l >= end[1] + GAP ? 1 : end[0] <= end[1] ? 0 : 1; end[o.lane] = Math.max(end[o.lane], l) + o.w; });
        [0, 1].forEach(l => spread(items.filter(o => o.lane === l)));
      } else spread(items);
      return items;
    };
    const top = lanesOf('top'), bot = lanesOf('bot');
    const nl = list => (list.some(o => o.lane === 1) ? 2 : list.length ? 1 : 0);
    topEl.style.height = (nl(top) * LANE + (nl(top) ? 6 : 0)) + 'px';
    botEl.style.height = (nl(bot) * LANE + (nl(bot) ? 6 : 0)) + 'px';
    const pos = (list, topRow) => { const m = {}; list.forEach(o => { m[o.id] = o; }); return b => { const o = m[b.dataset.pc]; if (!o) return; b.style.left = o.left.toFixed(0) + 'px'; b.style.top = ((topRow ? nl(list) - 1 - o.lane : o.lane) * LANE + 4) + 'px'; }; };
    $$('.pv-badge', topEl).forEach(pos(top, true)); $$('.pv-badge', botEl).forEach(pos(bot, false));
    // shading by share: a light plate behind each part and warmer line work
    $$('.pc', cv).forEach(g => { const id = g.dataset.pc, st = pvStat(id); const h = id === 'bess' || id === 'buyer' || !st || st.link ? 0 : heat(st.share || 0); g.style.setProperty('--heat', h.toFixed(3)); $$('.plate', g).forEach(p => { if (p.classList.contains('band')) p.style.strokeOpacity = (0.05 + 0.2 * h).toFixed(3); else p.style.fillOpacity = (0.03 + 0.14 * h).toFixed(3); }); });
    // positions in canvas pixels
    const svg = $('.pv-scene', cv), crr = cv.getBoundingClientRect(), sr = svg.getBoundingClientRect();
    const ox = sr.left - crr.left, oy = sr.top - crr.top, ch = cv.clientHeight;
    const toPx = an => ({ x: ox + an.x * k, y: oy + an.y * k });
    let lines = '';
    const badgeEls = {}; $$('.pv-badge', cv).forEach(b => { badgeEls[b.dataset.pc] = b; });
    order.forEach(id => {
      const b = badgeEls[id]; if (!b) return;
      const br = b.getBoundingClientRect(), an = toPx(sc.anchors[id]);
      const bx = br.left - crr.left + br.width / 2, by = sc.anchors[id].row === 'top' ? br.bottom - crr.top : br.top - crr.top;
      lines += `<path class="lead${pv.sel === id ? ' on' : ''}" d="M${f1(bx)},${f1(by)} L${f1(an.x)},${f1(an.y)}"/><circle class="lead-dot${pv.sel === id ? ' on' : ''}" cx="${f1(an.x)}" cy="${f1(an.y)}" r="3"/>`;
    });
    // bubbles around the selected part
    let bub = '';
    const sel = pv.sel && sc.anchors[pv.sel] ? pv.sel : null;
    const list = sel ? bubbleList(sel) : [];
    if (list.length) {
      const an = toPx(sc.anchors[sel]), rowTop = sc.anchors[sel].row === 'top';
      const sz = b => Math.round((compact ? 0.86 : 1) * (52 + 44 * Math.sqrt(Math.max(0, Math.min(1, b.sh)))));
      const n = list.length, R = Math.min(200, (compact ? 100 : 120) + n * 12);
      // arc away from the part's own badge, leaning towards the middle of the drawing
      const lean = Math.max(-0.5, Math.min(0.5, (cw / 2 - an.x) / cw)) * Math.PI * 0.7;
      const a0 = rowTop ? Math.PI / 2 - lean : -Math.PI / 2 + lean;
      const step = Math.min(0.62, (Math.PI * 1.25) / Math.max(1, n - 1));
      const P = list.map((b, i) => { const a = a0 + (i - (n - 1) / 2) * step; return { b, d: sz(b), x: an.x + R * Math.cos(a), y: an.y + R * Math.sin(a) }; });
      const LBL = 30, PAD = 6, sceneTop = oy, sceneBot = oy + sc.H * k;
      const yMin = p => (rowTop ? sceneTop + p.d / 2 + 4 : PAD + p.d / 2), yMax = p => (rowTop ? ch - PAD - p.d / 2 - LBL : sceneBot - p.d / 2 - LBL);
      for (let it = 0; it < 60; it++) {
        P.forEach(p => { p.x = Math.max(PAD + Math.max(p.d / 2, 56), Math.min(cw - PAD - Math.max(p.d / 2, 56), p.x)); p.y = Math.max(yMin(p), Math.min(yMax(p), p.y)); });
        let moved = false;
        for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
          const A = P[i], B = P[j], dx = B.x - A.x, dy = (B.y - A.y) * 0.8, dist = Math.hypot(dx, dy) || 0.01, need = Math.max((A.d + B.d) / 2 + 12, 118);
          if (dist < need) { const m = (need - dist) / 2, ux = dx / dist, uy = dy / dist; A.x -= ux * m; A.y -= uy * m; B.x += ux * m; B.y += uy * m; moved = true; }
        }
        P.forEach(p => { const dx = p.x - an.x, dy = p.y - an.y, dist = Math.hypot(dx, dy) || 0.01, need = p.d / 2 + 34; if (dist < need) { p.x = an.x + dx / dist * need; p.y = an.y + dy / dist * need; moved = true; } });
        if (!moved) break;
      }
      P.forEach((p, i) => {
        lines += `<path class="lead bub" d="M${f1(an.x)},${f1(an.y)} L${f1(p.x)},${f1(p.y)}"/>`;
        bub += bubbleHtml(p.b, i, `left:${p.x.toFixed(0)}px;top:${(p.y - p.d / 2).toFixed(0)}px;--d:${p.d}px;`);
      });
    }
    const ln = $('#pvLinks'); ln.setAttribute('viewBox', `0 0 ${cw} ${ch}`); ln.setAttribute('width', cw); ln.setAttribute('height', ch); ln.innerHTML = lines;
    $('#pvBub').innerHTML = bub;
    cv.classList.toggle('has-sel', !!sel);
    pv.popped = pv.sel;
    if (hadFocus) { const el = $(hadFocus, cv); if (el) el.focus({ preventScroll: true }); }
  }

  /* ---------- phone chain ---------- */
  function chainHtml() {
    const ids = pvOrder();
    return `<ol class="pv-chain">${ids.map(id => {
      const st = pvStat(id) || {};
      const h = id === 'bess' || id === 'buyer' || st.link ? 0 : heat(st.share || 0);
      const sel = pv.sel === id;
      const list = sel ? bubbleList(id) : [];
      return `<li class="${sel ? 'on' : ''}"><button class="pv-node${sel ? ' on' : ''}${st.status === 'atlas' || st.status === 'empty' ? ' muted' : ''}" data-pc="${id}" style="--heat:${h.toFixed(3)}" aria-pressed="${sel}">
          <span class="ico">${pvIcon(id)}</span><span class="nt"><span class="bn">${esc(pvName(id))}</span><span class="bm">${esc(pvMetric(id))}</span></span>${id === 'bess' || id === 'buyer' || st.link ? '' : ring(st.mix, 22)}${id === 'w' || id === 's' ? '<span class="go" aria-hidden="true">›</span>' : ''}</button>
        ${list.length ? `<div class="pv-bubrow">${list.map((b, i) => bubbleHtml(b, i, `--d:${Math.round(50 + 30 * Math.sqrt(Math.max(0, Math.min(1, b.sh))))}px;`, true)).join('')}</div>` : ''}</li>`;
    }).join('')}</ol>`;
  }

  /* ---------- canvas ---------- */
  function crumbsHtml() {
    if (!isHybrid() || pvView() === 'site') return '';
    return `<div class="pv-crumbs"><button class="btn small" data-act="pvview" data-val="site">← Hybrid site</button><span>${esc(pvTitle())}</span></div>`;
  }
  function renderCanvas() {
    const st = $('#pvStage'); if (!st) return;
    const w = st.clientWidth || 800;
    pv.layout = w >= 560 ? 'wide' : 'narrow';
    if (pv.layout === 'wide') {
      pv.scene = pvScene();
      st.innerHTML = `${crumbsHtml()}<div class="pv-canvas wide" id="pvCanvas">
          <div class="pv-row pv-rt" id="pvTop"></div>
          <svg class="pv-scene" viewBox="0 0 ${pv.scene.W} ${pv.scene.H}" role="img" aria-label="${esc(pvTitle())} drawing: select a part to see its uncertainty">${DEFS}${pv.scene.svg}</svg>
          <div class="pv-row pv-rb" id="pvBot"></div>
          <svg class="pv-links" id="pvLinks" aria-hidden="true"></svg>
          <div class="pv-bubbles" id="pvBub"></div>
        </div>${pvKey()}`;
      pvPlace();
    } else {
      pv.scene = null;
      st.innerHTML = `${crumbsHtml()}${DEFS_I}<div class="pv-canvas narrow" id="pvCanvas">${chainHtml()}</div>${pvKey()}`;
      chainDone();
    }
  }
  function pvKey() {
    return `<div class="pv-key"><span><i class="heatk"></i>Shading: share of the total uncertainty</span><span>${ring({ calc: 0.25, site: 0.25, desc: 0.25, generic: 0.25 }, 14)} Ring: evidence behind it</span>${legend()}</div>`;
  }
  function pvRefresh() {
    if (!pvMode()) return;
    if (pv.layout === 'wide') pvPlace();
    else { const cv = $('#pvCanvas'); if (cv) { cv.innerHTML = chainHtml(); chainDone(); } }
  }
  function chainDone() { pv.popped = pv.sel; }

  /* ---------- inspector ---------- */
  function shareBar(share) { return `<span class="sbar"><i style="width:${Math.max(0, Math.min(100, share * 100)).toFixed(1)}%"></i></span>`; }
  function listRows(ids) {
    return `<div class="pv-list">${ids.map(id => {
      const st = pvStat(id) || {};
      const val = id === 'bess' || id === 'buyer' ? pvMetric(id) : st.status === 'atlas' ? 'in atlas' : st.link ? pvMetric(id, true) : `±${fx(st.sigma, 2)} %`;
      const sh = id === 'bess' || id === 'buyer' || st.link || st.status === 'atlas' || st.status === 'empty' ? null : st.share;
      return `<button class="pv-lrow" data-pc="${id}"><span class="ln">${esc(pvName(id))}</span><span class="lv">${esc(val)}</span>${sh != null ? `${shareBar(sh)}<span class="ls">${fx(sh * 100, 0)} %</span>` : '<span></span><span></span>'}</button>`;
    }).join('')}</div>`;
  }
  function whyHtml() {
    const s = pv.sum, v = pvView();
    if (isHybrid() && (v === 'wind' || v === 'solar')) {
      const f = s.farms[v];
      return `<p class="note">Treated on its own, the ${v} farm is <b>±${fx(f.sigmaOwn, 2)} %</b> of its energy. In the hybrid it carries <b>${fx(f.share * 100, 0)} %</b> of the total variance, because its errors are weighted by its ${fx(f.energyShare * 100, 0)} % share of the energy. The shared connection is counted once, for both farms.</p>`;
    }
    const comps = Object.values(s.comps).filter(c => c.var > 0);
    const straight = comps.reduce((a, c) => a + c.sigma, 0);
    return `<p class="note"><b>Why the parts don't add up.</b> Added straight, the parts come to ±${fx(straight, 1)} %. Independent errors partly cancel, so they combine as the square root of the sum of squares: the plant total is <b>±${fx(s.sigma, 2)} %</b>. The shares of the total (variance) do add up to 100 %.${s.hybrid ? ` The wind–solar link adds ${s.cross.var >= 0 ? '+' : '−'}${fx(Math.abs(s.cross.share) * 100, 1)} % of the total.` : ''}</p>`;
  }
  function pvSummaryLive() {
    const s = pv.sum, v = pvView();
    const farm = isHybrid() && (v === 'wind' || v === 'solar');
    const ids = farm ? pvOrder().filter(id => farmOf(id) === v) : pvOrder();
    let head;
    if (farm) {
      const f = s.farms[v];
      head = `<div class="pv-stat"><div><b>±${fx(f.sigmaOwn, 2)} %</b><span>of ${v} energy, on its own</span></div><div><b>${fx(f.share * 100, 0)} %</b><span>of the site total</span></div><div><b>${fx(f.p50, 1)}</b><span>GWh/yr P50 (${hzLabel()})</span></div></div>${mixBar(f.mixShare)}`;
    } else head = `<div class="pv-stat"><div><b>±${fx(s.sigma, 2)} %</b><span>total uncertainty (σ, ${hzLabel()})</span></div><div><b>${fx(s.pv.P90, 1)}</b><span>GWh/yr P90 · ${fx(s.pv.P90 / s.p50 * 100, 1)} % of P50</span></div></div>${mixBar(result.mix)}`;
    return `${head}<h4>Where the uncertainty sits</h4>${listRows(ids)}${whyHtml()}`;
  }
  function inspPlant() {
    const v = pvView();
    const farm = isHybrid() && (v === 'wind' || v === 'solar');
    const blurb = v === 'site' ? 'A wind farm and a solar farm behind one grid connection. Select a farm to open its parts, or a shared part to see its categories.' : farm ? `Select a part of the ${v} farm to see its uncertainty categories.` : 'Select a part of the plant to see its uncertainty categories and give your inputs.';
    return `<div class="insp-in">
      <div class="insp-top"><span class="eyebrow"><span>${esc(state.meta.name || 'Untitled project')}</span></span><span class="grow"></span>${farm ? '<button class="btn small" data-act="pvview" data-val="site">← Site</button>' : ''}</div>
      ${exampleWarn()}<h2>${esc(pvTitle())}</h2><p class="insp-what">${blurb}</p>
      <div class="stack" data-live="pvsum|">${pvSummaryLive()}</div>
      ${isHybrid() && v === 'site' ? `<details class="pv-setup" data-sk="hybsum"${skOpen('hybsum')}><summary>Wind and solar together</summary><div class="pv-setup-in" data-live="hybsum|">${hybridSummary()}</div></details>` : ''}
      ${!farm ? `<details class="pv-setup" data-sk="project"${skOpen('project')}><summary>Project set-up <span>${esc(lifeN() + '-year life' + (hasBess() ? ' · battery' : ''))}</span></summary><div class="pv-setup-in">
        <div class="grid2">${txtField({ path: 'meta.name', label: 'Project name' })}${txtField({ path: 'meta.site', label: 'Site or notes' })}</div>
        <div class="grid2">${numField({ path: 'horizon.life', label: 'Project lifetime', unit: 'years', step: 1, min: 1, rerender: true })}</div>
        ${segField({ path: 'bess.enabled', label: 'Battery and firm supply', type: 'bool', options: [['false', 'No'], ['true', 'Yes']] })}</div></details>` : ''}
      <div class="insp-actions"><button class="btn primary" data-stage="results">Full results</button><button class="btn" data-act="mode" data-val="steps">Step-by-step view</button></div>
    </div>`;
  }
  function compStatHtml(id) {
    if (id === 'bess') { const b = state.bess, dur = (+b.energyMWh || 0) / Math.max(0.01, +b.powerMW || 0); return `<div class="pv-stat"><div><b>${fx(+b.powerMW, 0)} MW</b><span>power</span></div><div><b>${fx(+b.energyMWh, 0)} MWh</b><span>usable at the start</span></div><div><b>${fx(dur, 1)} h</b><span>duration</span></div></div><p class="side-note">Battery uncertainties are drawn in each simulated year under Firm supply. They do not change the P-values of generation.</p>`; }
    const st = pvStat(id); if (!st) return '';
    if (st.status === 'atlas') return `<p class="note">In desktop mode this part is covered by the wind atlas uncertainty under ${esc(pvName('w.meas'))}. Switch the wind data to on-site to assess it separately.</p>`;
    if (st.status === 'empty') return `<p class="note">Nothing to assess here with the current inputs.</p>`;
    const c = st.c;
    return `<div class="pv-stat"><div><b>±${fx(st.sigma, 2)} %</b><span>${st.of} (σ, ${hzLabel()})</span></div><div><b>${fx(st.share * 100, 1)} %</b><span>of the total uncertainty</span></div>${st.loss != null ? `<div><b>${st.loss < 0 ? fx(-st.loss, 1) + ' %' : fx(st.loss, 1) + ' %'}</b><span>${st.loss < 0 ? 'net gain' : 'combined loss'}</span></div>` : ''}</div>
      ${mixBar(c.mixShare)}${st.excluded ? `<p class="side-note">${st.excluded} item${st.excluded > 1 ? 's' : ''} excluded.</p>` : ''}`;
  }
  function grpStat(cid, gid) {
    const c = pv.sum.comps[cid]; if (!c) return '';
    const g = c.groups.find(x => x.id === gid); if (!g) return '';
    if (cid === 'bess') return g.items.map(x => esc(valueText(x.it).v)).join(' · ');
    if (g.items.every(x => x.it.mode === 'none')) return 'Excluded';
    const own = isHybrid() && (c.plant === 'wind' || c.plant === 'solar');
    return `±${fx(own ? g.sigmaOwn : g.sigma, 2)} %${g.loss != null ? ` · ${g.loss < 0 ? fx(-g.loss, 1) + ' % gain' : fx(g.loss, 1) + ' % loss'}` : ''} · ${fx(g.share * 100, 1)} % of total`;
  }
  function devFields(dv, i) {
    return `<div class="pv-dev"><div class="grid2">${txtField({ path: `devices.${i}.name`, label: 'Name' })}${numField({ path: `devices.${i}.height`, label: dv.type === 'lidar' ? 'Highest height used' : 'Top anemometer height', unit: 'm', step: 1 })}${numField({ path: `devices.${i}.weight`, label: 'Share of turbines it represents', step: 0.05, min: 0, rerender: true })}</div>
      <div class="pv-dev-foot"><span class="computed">${dv.type === 'lidar' ? 'Lidar' : 'Mast'} · σ <b data-live="devsig|${i}">${LIVE.devsig(i)}</b></span><button class="btn small danger" data-act="rmdev" data-i="${i}" ${state.devices.length < 2 ? 'disabled' : ''}>Remove</button></div></div>`;
  }
  function groupsHtml(id) {
    const c = pv.sum.comps[id]; if (!c || !c.groups.length) return '';
    const own = isHybrid() && (c.plant === 'wind' || c.plant === 'solar');
    return `<h4 class="pv-gh4">Uncertainty categories</h4><div class="pv-grps">${c.groups.map(g => {
      const open = pv.open.has(g.id);
      let pre = '';
      if (g.id.startsWith('dev:')) { const i = state.devices.findIndex(d => 'dev:' + d.id === g.id); if (i >= 0) pre = devFields(state.devices[i], i); }
      const cards = g.items.map(x => {
        const it = x.it;
        if (it.deviceId) { const i = state.devices.findIndex(d => d.id === it.deviceId); return i >= 0 ? itemCard(it.def, `devices.${i}.items.${it.id}`, it.key) : ''; }
        return itemCard(it.def, `items.${it.id}`, it.key);
      }).join('');
      return `<section class="pv-grp${open ? ' open' : ''}${pv.hot === g.id ? ' hot' : ''}" id="pvg-${esc(g.id.replace(':', '-'))}">
        <button class="pv-ghd" data-pg="${esc(g.id)}" aria-expanded="${open}"><span class="gn">${esc(g.name)}<small>${g.items.length} item${g.items.length > 1 ? 's' : ''}</small></span><span class="gs" data-live="pvg|${esc(id)}~${esc(g.id)}">${grpStat(id, g.id)}</span>${id === 'bess' ? '' : shareBar(own ? g.shareInComp : g.shareInComp)}<span class="chev" aria-hidden="true"></span></button>
        <div class="pv-gb" ${open ? '' : 'hidden'}>${pre}${cards}</div></section>`;
    }).join('')}</div>`;
  }

  /* set-up inputs that belong to each part */
  function setupFor(id) {
    const k = compKey(), ep = enPath(), hyb = isHybrid();
    switch (id) {
      case 'w.meas': {
        const desk = isDesk();
        return { sum: desk ? 'Desktop only (wind atlas)' : `${state.devices.length} device${state.devices.length > 1 ? 's' : ''} · ${esc(TERRAIN.find(t => t[0] === state.setup.terrain)?.[1] || '')} terrain`, open: false, body: `
          ${segField({ path: 'setup.dataSource', label: 'Wind data', options: [['onsite', 'On-site mast or lidar'], ['desktop', 'Desktop only (wind atlas)']], hint: desk ? 'Desktop mode replaces measurement, long-term and extrapolation with one wind-atlas uncertainty.' : 'Each device is a category below, with its own items.' })}
          ${desk ? '' : `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn small" data-act="adddev" data-type="mast">+ Add mast</button><button class="btn small" data-act="adddev" data-type="lidar">+ Add lidar</button></div>
          ${state.devices.length > 1 ? `<div class="grid2">${numField({ path: 'deviceCorr', label: 'Correlation between device errors', step: 0.05, min: 0, max: 1, hint: '0 = independent, 1 = errors move together. A lidar verified against the same mast: 0.5–0.7.' })}</div>` : ''}
          <p class="computed" data-live="meassig|">${LIVE.meassig()}</p>`}` };
      }
      case 'w.lt': return { sum: `${fx(+state.climate.meanWs, 2)} m/s at hub height · k ${fx(+state.climate.k, 2)}`, body: `<p class="side-note">The long-term wind climate the correction produces, averaged over the turbine positions.</p><div class="grid2">
          ${numField({ path: 'climate.meanWs', label: 'Long-term mean wind speed at hub height', unit: 'm/s', step: 0.05 })}${numField({ path: 'climate.k', label: 'Weibull shape factor k', step: 0.05, hint: 'Typically 1.8–2.4.' })}</div>` };
      case 'w.vert': return { sum: esc(vzText()), body: `<div class="grid2">
          ${numField({ path: 'vertical.hMeas', label: 'Measurement height carried to hub height', unit: 'm', step: 1 })}${numField({ path: 'vertical.hLow', label: 'Lower height for the shear exponent', unit: 'm', step: 1 })}${numField({ path: 'vertical.alpha', label: 'Measured shear exponent α', step: 0.01 })}${numField({ path: 'plant.hubH', label: 'Hub height', unit: 'm', step: 1, rerender: true })}</div>
          ${segField({ path: 'vertical.shear', label: 'How predictable is the shear?', options: [['simple', 'Simple'], ['moderate', 'Moderate'], ['complex', 'Complex']] })}<p class="computed" data-live="vz|">${vzText()}</p>` };
      case 'w.horiz': return { sum: `${esc(TERRAIN.find(t => t[0] === state.setup.terrain)?.[1] || '')} terrain · ${LIVE.nmeas()} measurement location${+LIVE.nmeas() === 1 ? '' : 's'}`, body: `${segField({ path: 'setup.terrain', label: 'Terrain around the turbines', options: TERRAIN })}<p class="note">Measurement locations with a share above zero: <b data-live="nmeas|">${LIVE.nmeas()}</b>. More masts spread over the site shorten the distance the flow model has to carry the wind.</p>` };
      case 'w.future': case 's.future': return { sum: `${lifeN()}-year life`, body: `<div class="grid2">${numField({ path: 'horizon.life', label: 'Project lifetime', unit: 'years', step: 1, min: 1, rerender: true })}</div><div data-live="iavtable|">${iavTable()}</div><p class="formula">Year-to-year variability falls with the square root of the number of years${id === 'w.future' ? '; climate change grows with the period' : ''}.</p>` };
      case 'w.turbines': {
        const pl = state.plant;
        return { sum: `${fx(+pl.nTurbines, 0)} × ${fx(+pl.ratedMW, 1)} MW · rotor ${fx(+pl.rotorD, 0)} m · hub ${fx(+pl.hubH, 0)} m`, body: `<div class="grid2">
          ${numField({ path: 'plant.nTurbines', label: 'Number of turbines', step: 1, min: 1, rerender: true })}${numField({ path: 'plant.ratedMW', label: 'Rated power per turbine', unit: 'MW', step: 0.1 })}${numField({ path: 'plant.rotorD', label: 'Rotor diameter', unit: 'm', step: 1 })}${numField({ path: 'plant.hubH', label: 'Hub height', unit: 'm', step: 1, rerender: true })}${numField({ path: 'plant.cutIn', label: 'Cut-in', unit: 'm/s', step: 0.5 })}${numField({ path: 'plant.cutOut', label: 'Cut-out', unit: 'm/s', step: 0.5 })}</div>
          ${segField({ path: 'plant.curveMode', label: 'Power curve', options: [['generic', 'Generic'], ['custom', 'Manufacturer curve']] })}
          ${pl.curveMode === 'custom' ? `<div class="field"><label for="curveTa">Wind speed (m/s), power (kW), one pair per line</label><textarea class="ta mono" id="curveTa" data-path="plant.curveText" data-kind="text" placeholder="3, 40&#10;4, 180&#10;…">${esc(pl.curveText)}</textarea></div><div class="grid2">${numField({ path: 'plant.curveRho', label: 'Air density of the curve', unit: 'kg/m³', step: 0.005 })}</div>` : ''}
          <div data-live="curve|">${curveChart()}</div>
          ${segField({ path: 'site.rhoMode', label: 'Air density at hub height', options: [['calc', 'From elevation and temperature'], ['entered', 'Enter a value']] })}
          <div class="grid2">${state.site.rhoMode === 'entered' ? numField({ path: 'site.rho', label: 'Air density', unit: 'kg/m³', step: 0.005 }) : numField({ path: 'site.elevation', label: 'Hub elevation', unit: 'm', step: 10 }) + numField({ path: 'site.tempC', label: 'Mean temperature at hub', unit: '°C', step: 0.5 })}</div>
          <p class="computed">In use: <b data-live="rho|${k}">${fx(C().en.rho, 3)} kg/m³</b> · sensitivity S <b data-live="sens|">${fx(C().en.S, 2)}</b></p>
          ${segField({ path: 'energy.p50Mode', label: 'Where the P50 comes from', options: [['computed', 'Estimated by this tool'], ['entered', 'From my energy yield report']] })}
          ${state.energy.p50Mode === 'entered' ? `<div class="grid2">${numField({ path: 'energy.p50', label: hyb ? 'Wind P50 before shared grid losses' : 'Net P50 at the POI', unit: 'GWh/yr', step: 0.1 })}</div>` : ''}
          <p class="computed">P50 in use: <b data-live="p50|${k}">${fx(C().en.p50, 1)} GWh/yr</b></p>
          ${segField({ path: 'energy.sensMode', label: 'Wind-speed-to-energy sensitivity', options: [['computed', 'From the power curve'], ['entered', 'From my report']] })}
          ${state.energy.sensMode === 'entered' ? `<div class="grid2">${numField({ path: 'energy.sens', label: 'Sensitivity factor', step: 0.01 })}</div>` : ''}` };
      }
      case 'w.elec': return { sum: `losses ${fx((1 - C().en.eff) * 100, 1)} % across the plant`, body: `<div data-live="losstotal|">${lossTotal()}</div>` };
      case 'grid': return hyb ? { sum: `${fx(result.model.ctx.gridMW, 0)} MW connection`, body: `<div class="grid2">${numField({ path: 'hybrid.gridMW', label: 'Export capacity at the point of interconnection', unit: 'MW', step: 1, min: 0, hint: '0 means the combined capacity.' })}</div><p class="computed" data-live="conn|">${connText()}</p>` }
        : { sum: `P50 at the POI ${fx(result.en.p50, 1)} GWh/yr`, body: `<div data-live="poisum|">${poiSummary()}</div>` };
      case 's.irr': return { sum: `${{ satellite: 'Satellite only', adapted: 'Satellite, site-adapted', ground: 'On-site only' }[state.setup.solarSource] || ''} · GHI ${fx(+state.pv.ghi, 0)} kWh/m²`, body: `
          ${segField({ path: 'setup.solarSource', label: 'Irradiance data', options: [['satellite', 'Satellite only'], ['adapted', 'Satellite, site-adapted'], ['ground', 'On-site only']] })}
          <div class="grid2">${numField({ path: 'pv.ghi', label: 'Long-term annual GHI', unit: 'kWh/m²', step: 1 })}</div>` };
      case 's.model': return { sum: `POA/GHI ${fx(+state.pv.poaRatio, 2)} · array ${fx(C().en.refYield, 0)} kWh/m²`, body: `<div class="grid2">${numField({ path: 'pv.poaRatio', label: 'Plane-of-array to GHI ratio', step: 0.01, hint: 'From your simulation.' })}</div>
          <p class="computed">Array irradiation <b data-live="refyield|${k}">${fx(C().en.refYield, 0)} kWh/m²</b></p>
          ${segField({ path: ep + '.sensMode', label: 'Irradiance-to-energy sensitivity', options: [['computed', 'Use 1.0'], ['entered', 'From my simulation']] })}
          ${getPath(state, ep + '.sensMode') === 'entered' ? `<div class="grid2">${numField({ path: ep + '.sens', label: 'Sensitivity factor', step: 0.01 })}</div>` : ''}` };
      case 's.array': return { sum: `${fx(+state.pv.dcMWp, 0)} MWp · ${{ fixed: 'fixed tilt', tracker: 'single-axis tracker', ew: 'east-west' }[state.pv.mount] || ''}${state.pv.bifacial ? ' · bifacial' : ''}`, body: `<div class="grid2">${numField({ path: 'pv.dcMWp', label: 'DC capacity', unit: 'MWp', step: 0.1 })}</div>
          ${segField({ path: 'pv.mount', label: 'Mounting', options: [['fixed', 'Fixed tilt'], ['tracker', 'Single-axis tracker'], ['ew', 'East-west']] })}
          ${segField({ path: 'pv.bifacial', label: 'Modules', type: 'bool', options: [['false', 'Monofacial'], ['true', 'Bifacial']] })}
          ${segField({ path: ep + '.p50Mode', label: 'Where the P50 comes from', options: [['computed', 'Estimated by this tool'], ['entered', 'From my energy yield report']] })}
          ${getPath(state, ep + '.p50Mode') === 'entered' ? `<div class="grid2">${numField({ path: ep + '.p50', label: hyb ? 'Solar P50, year 1, before shared grid losses' : 'Net P50 at the POI, year 1', unit: 'GWh/yr', step: 0.1 })}</div>` : ''}
          <p class="computed">P50 in use: <b data-live="p50|${k}">${fx(C().en.p50, 1)} GWh/yr</b></p>` };
      case 's.inv': return { sum: `${fx(+state.pv.acMW, 0)} MWac · DC/AC ${fx((+state.pv.dcMWp || 0) / Math.max(0.01, +state.pv.acMW || 0), 2)}`, body: `<div class="grid2">${numField({ path: 'pv.acMW', label: 'AC capacity (inverter or export limit)', unit: 'MW', step: 0.1 })}</div><p class="computed">DC/AC ratio <b data-live="dcac|">${LIVE.dcac()}</b></p>` };
      case 's.sub': return { sum: `performance ratio ${fx(C().en.pr * 100, 1)} %`, body: `<div data-live="prkv|">${prKv()}</div>` };
      case 'bess': {
        const b = state.bess, dur = (+b.energyMWh || 0) / Math.max(0.01, +b.powerMW || 0);
        return { sum: `${fx(+b.powerMW, 0)} MW · ${fx(+b.energyMWh, 0)} MWh · ${fx(dur, 1)} h`, open: true, body: `<div class="grid2">
          ${numField({ path: 'bess.powerMW', label: 'Power rating at the POI', unit: 'MW', step: 1, min: 0, rerender: true })}${numField({ path: 'bess.energyMWh', label: 'Usable energy at the start', unit: 'MWh', step: 1, min: 0, rerender: true })}${hyb ? '' : numField({ path: 'bess.gridMW', label: 'Export capacity at the POI', unit: 'MW', step: 1, min: 0, hint: '0 means the plant capacity.' })}</div>
          ${segField({ path: 'bess.augment', label: 'Augmentation', type: 'bool', options: [['false', 'None'], ['true', 'Keep a minimum capacity']] })}
          ${b.augment ? `<div class="grid2">${numField({ path: 'bess.augTarget', label: 'Capacity kept at or above', unit: '% of start', step: 1, min: 0, max: 100 })}</div>` : ''}` };
      }
      default: return null;
    }
  }
  function setupHtml(id) {
    const s = setupFor(id); if (!s) return '';
    return `<details class="pv-setup" data-sk="${esc(id)}"${skOpen(id, s.open)}><summary>Set-up <span>${s.sum}</span></summary><div class="pv-setup-in">${s.body}</div></details>`;
  }
  function inspBuyer() {
    const r = firm.res, stale = r && firm.key !== firmKey();
    return `<div class="stack">
      ${r ? `${stale ? '<p class="warn">Inputs changed since this run. Run again to update.</p>' : ''}<div class="pv-stat"><div><b>${fx(r.pMeet * 100, 0)} %</b><span>chance of meeting every rule, year ${r.year}</span></div><div><b>${fx(r.failedMonths, 1)}</b><span>months below target a year</span></div></div>
        <dl class="kv"><dt>Shortfall P50 / P90</dt><dd>${fx(r.shortfall.p50 / 1000, 2)} / ${fx(r.shortfall.p90 / 1000, 2)} GWh</dd>${state.supply.tariff > 0 ? `<dt>Penalty P50 / P90</dt><dd>${money(r.penalty.p50)} / ${money(r.penalty.p90)}</dd>` : ''}<dt>Delivered with storage, P50</dt><dd>${fx(r.delivered.p50 / 1000, 1)} GWh/yr</dd><dt>Curtailed, P50</dt><dd>${fx(r.curtailed.p50 / 1000, 1)} GWh/yr</dd></dl>`
        : '<p class="note">Not simulated yet. The simulation runs the plant and battery hour by hour against the demand, over hundreds of possible years.</p>'}
      <div class="grid2">${numField({ path: 'supply.contractMW', label: 'Contracted capacity', unit: 'MW', step: 1, min: 0 })}${numField({ path: 'supply.tariff', label: 'Tariff', unit: (state.supply.currency || 'INR') + '/kWh', step: 0.01, min: 0 })}</div>
      ${segField({ path: 'supply.preset', label: 'Rule set', options: Object.entries(Firm.PRESETS).map(([kk, v]) => [kk, v.label]) })}
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="firmrun" ${firm.running ? 'disabled' : ''}>${firm.running ? 'Running…' : r ? 'Run again' : 'Run simulation'}</button><button class="btn" data-stage="supply">All supply settings</button></div>
      <p class="status" id="firmStatus">${esc(firm.progress)}</p>
      <p class="side-note">Peak hours, hourly profiles, the penalty multiple and what drives the risk are under All supply settings.</p></div>`;
  }
  function inspLink() {
    return `<div class="stack"><div class="pv-stat"><div><b>${pv.sum.cross.var >= 0 ? '+' : '−'}${fx(Math.abs(pv.sum.cross.share) * 100, 1)} %</b><span>of the total variance</span></div><div><b>${result.focus.portfolioGain >= 0 ? '+' : ''}${fx(result.focus.portfolioGain, 1)}</b><span>GWh/yr portfolio gain at P90</span></div></div>
      <div class="grid2">${numField({ path: 'hybrid.rhoIav', label: 'Correlation of year-to-year resource variation', step: 0.05, min: -0.95, max: 0.95, rerender: true, hint: 'Do windy years tend to be sunny (+) or cloudy (−)? Estimate it from ERA5 or MERRA-2 annual anomalies at the site.' })}
      ${numField({ path: 'hybrid.rhoRes', label: 'Correlation between the two resource assessments', step: 0.05, min: -0.95, max: 0.95, rerender: true, hint: 'Usually close to 0. Raise it if both assessments lean on the same reference data or method.' })}</div>
      ${sourcesHtml(['iavcorr', 'e3'])}</div>`;
  }
  function inspComp(id) {
    const crumbs = isHybrid() && farmOf(id) ? `<button class="crumb" data-act="pvview" data-val="site">Site</button> › <button class="crumb" data-act="pvclose">${esc(pvTitle())}</button>` : `<button class="crumb" data-act="pvclose">${esc(pvTitle())}</button>`;
    let body;
    if (id === 'buyer') body = inspBuyer();
    else if (id === 'link') body = inspLink();
    else body = `<div data-live="pvc|${esc(id)}">${compStatHtml(id)}</div>${setupHtml(id)}${groupsHtml(id)}`;
    return `<div class="insp-in">
      <div class="insp-top"><nav class="crumbs" aria-label="Where you are">${crumbs} › <span>${esc(pvName(id))}</span></nav><span class="grow"></span>${window.innerWidth < 760 ? '<button class="btn small ghost" data-act="pvsheet" aria-label="Expand">' + (pv.full ? 'Less' : 'More') + '</button>' : ''}<button class="btn small" data-act="pvclose" aria-label="Close ${esc(pvName(id))}">Close</button></div>
      <h2>${esc(pvName(id))}</h2><p class="insp-what">${esc(pvWhat(id))}</p>
      ${body}
      ${id !== 'buyer' && id !== 'link' && id !== 'bess' ? '<p class="side-note">σ values are one standard deviation of energy. Each category shows its share of the plant total; categories inside a part combine as the root of the sum of squares.</p>' : ''}
    </div>`;
  }
  function inspectorHtml() { return pv.sel ? inspComp(pv.sel) : inspPlant(); }

  /* ---------- render ---------- */
  function renderPlant(keep) {
    const sheet = $('#sheet');
    const y = window.scrollY;
    const insp0 = $('#pvInsp'), iy = insp0 ? insp0.scrollTop : 0;
    const ae = document.activeElement;
    const focus = ae && sheet.contains(ae) ? (ae.id ? { id: ae.id } : ae.dataset && ae.dataset.pc ? { pc: ae.dataset.pc } : ae.dataset && ae.dataset.pg ? { pg: ae.dataset.pg, bub: ae.dataset.bub } : null) : null;
    // let a pending change on the focused input apply before the page is replaced
    if (ae && sheet.contains(ae) && /^(INPUT|SELECT|TEXTAREA)$/.test(ae.tagName)) ae.blur();
    fid = 0;
    pvNormalise(); pvSummarise();
    comp = pvComp();
    document.body.classList.toggle('pv-on', true);
    sheet.innerHTML = `<div class="pv${pv.sel ? ' has-sel' : ''}${pv.full ? ' full' : ''}">${pvBar()}<div class="pv-body"><div class="pv-stage" id="pvStage"></div><aside class="pv-insp" id="pvInsp" aria-label="Details">${inspectorHtml()}</aside></div></div>`;
    renderCanvas();
    if (!pv.ro && window.ResizeObserver) {
      pv.ro = new ResizeObserver(() => { if (!pvMode()) return; const st = $('#pvStage'); if (!st) return; const want = st.clientWidth >= 560 ? 'wide' : 'narrow'; if (want !== pv.layout) renderCanvas(); else if (want === 'wide') pvPlace(); });
    }
    if (pv.ro) { pv.ro.disconnect(); const st = $('#pvStage'); if (st) pv.ro.observe(st); }
    if (keep) {
      window.scrollTo(0, y);
      const ins = $('#pvInsp'); if (ins) ins.scrollTop = iy;
      if (focus) {
        const el = focus.id ? document.getElementById(focus.id) : focus.pc ? $(`#sheet [data-pc="${CSS.escape(focus.pc)}"]`) : $(`#sheet [data-pg="${CSS.escape(focus.pg)}"]${focus.bub ? '[data-bub]' : ':not([data-bub])'}`);
        if (el) el.focus({ preventScroll: true });
      }
    }
  }
  function pvSelect(id) {
    if (id === 'w' || id === 's') { pv.view = id === 'w' ? 'wind' : 'solar'; pv.sel = null; pv.hot = null; pv.open.clear(); savePv(); renderPlant(); pvScrollTop(); return; }
    pv.sel = pv.sel === id ? null : id; pv.hot = null; pv.open.clear();
    if (pv.sel === 'bess') pv.open = new Set();
    savePv(); renderPlant(true);
    const ins = $('#pvInsp'); if (ins) ins.scrollTop = 0;
    if (pv.layout === 'narrow' && pv.sel) { const n = $(`.pv-node[data-pc="${CSS.escape(pv.sel)}"]`); if (n) { const top = n.getBoundingClientRect().top + window.scrollY - (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--top-h')) || 56) - 12; window.scrollTo(0, Math.max(0, top)); } }
  }
  function pvScrollTop() { const st = $('#pvStage'); if (st && st.getBoundingClientRect().top < 0) window.scrollTo(0, 0); }
  function pvGroup(gid, fromBubble) {
    if (fromBubble) { pv.hot = gid; pv.open = new Set([gid]); }
    else { if (pv.open.has(gid)) pv.open.delete(gid); else pv.open.add(gid); pv.hot = pv.open.has(gid) ? gid : null; }
    if (fromBubble && window.innerWidth < 760) pv.full = true;
    renderPlant(true);
    const sec = document.getElementById('pvg-' + gid.replace(':', '-'));
    if (sec && pv.open.has(gid)) {
      const ins = $('#pvInsp');
      const fixed = ins && getComputedStyle(ins).position === 'fixed';
      const scrolls = ins && (fixed || ins.scrollHeight > ins.clientHeight + 4) && getComputedStyle(ins).overflowY !== 'visible';
      const head = $('.insp-top', ins), hh = head ? head.offsetHeight : 0;
      if (scrolls) ins.scrollTop += sec.getBoundingClientRect().top - ins.getBoundingClientRect().top - hh - 8;
      else { const top = sec.getBoundingClientRect().top + window.scrollY - 70; window.scrollTo(0, top); }
      const hd = $('.pv-ghd', sec); if (hd && !fromBubble) hd.focus({ preventScroll: true });
    }
  }
  function setMode(m) {
    pv.mode = m === 'steps' ? 'steps' : 'plant'; savePv();
    document.body.classList.toggle('pv-on', pvMode());
    const t = $$('.vt button'); t.forEach(b => b.setAttribute('aria-pressed', String(b.dataset.val === pv.mode)));
    recompute(); renderStage(); updateChrome(); window.scrollTo(0, 0);
  }

  LIVE.pvbar = () => pvBarTot();
  LIVE.pvsum = () => pvSummaryLive();
  LIVE.pvc = id => compStatHtml(id);
  LIVE.pvg = key => { const [cid, gid] = key.split('~'); return grpStat(cid, gid); };
