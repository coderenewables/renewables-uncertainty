/* Plant: places every uncertainty item on a part of the plant drawing (a component) and in a
   category within it, and adds up each part's share of the energy uncertainty. No DOM.
   Shares come from Engine contributions, so the parts add up to the plant total in variance:
   σ_plant² = Σ σ_part² (+ the wind–solar correlation term in a hybrid). */
const Plant = (() => {
  'use strict';

  /* Components. plant: which farm the part belongs to; groups: [id, name, item ids]. */
  const COMPONENTS = {
    'w.meas': { plant: 'wind', name: 'Masts and lidars', nameDesk: 'Wind atlas', what: 'The instruments that measure the wind on site: calibration, mounting, data quality and how the devices combine.', whatDesk: 'A wind atlas stands in for on-site measurement, long-term correction and extrapolation.', groups: [['campaign', 'Direction and air', ['dir_meas', 'atmos']], ['atlas', 'Wind atlas', ['atlas']]] },
    'w.lt': { plant: 'wind', name: 'Long-term reference', what: 'Satellite, reanalysis or nearby station data used to turn a year or two of measurement into a long-term average.', groups: [['mcp', 'Long-term correction', ['mcp']], ['ref', 'Reference data', ['ref_consistency']], ['period', 'Measurement period', ['lt_period']], ['dist', 'Wind speed distribution', ['ws_dist']], ['synth', 'Gaps and synthesis', ['synthesis']]] },
    'w.vert': { plant: 'wind', name: 'Up to hub height', what: 'Carrying the measured wind from sensor height up to hub height with a shear model.', groups: [['model', 'Shear model', ['vert_model']], ['prop', 'Propagated error', ['vert_prop']], ['repr', 'Representativeness', ['vert_repr']]] },
    'w.horiz': { plant: 'wind', name: 'Across the site', what: 'The flow model that carries the wind from the measurement locations to each turbine.', groups: [['approp', 'Model choice', ['horiz_approp']], ['inputs', 'Model inputs', ['horiz_inputs']], ['sens', 'Model sensitivity', ['horiz_sens']]] },
    'w.future': { plant: 'wind', name: 'Future wind', what: 'How the wind in the years ahead may differ from the long-term average: year-to-year variation and climate change.', groups: [['iav', 'Year-to-year variability', ['ws_iav']], ['cc', 'Climate change', ['climate_change']]] },
    'w.turbines': { plant: 'wind', name: 'Turbines', what: 'Power curve, wakes and blockage, turbine availability, environment and turbine-level curtailment.', groups: [['perf', 'Power curve and performance', ['pc_unc', 'tp_subopt', 'tp_site_pc', 'tp_hyst']], ['wakes', 'Wakes and blockage', ['wake_int', 'wake_ext', 'wake_fut', 'blockage']], ['avail', 'Turbine availability', ['av_wtg']], ['env', 'Environment', ['env_icing', 'env_degr', 'env_ext', 'env_exposure']], ['curt', 'Turbine curtailment', ['cur_load', 'cur_env']]] },
    'w.elec': { plant: 'wind', name: 'Cables and substation', what: 'Collection losses, site consumption and balance-of-plant outages.', groups: [['losses', 'Electrical losses', ['el_eff']], ['aux', 'Site consumption', ['el_parasitic']], ['avail', 'Balance-of-plant availability', ['av_bop']]] },

    's.irr': { plant: 'solar', name: 'Irradiance data', what: 'Satellite data and on-site sensors that set the long-term solar resource.', groups: [['sat', 'Satellite model', ['sat_model']], ['sensor', 'On-site sensors', ['ground_sensor']], ['adapt', 'Site adaptation', ['site_adapt']], ['lt', 'Long-term representativeness', ['irr_lt']]] },
    's.future': { plant: 'solar', name: 'Future sunshine', what: 'How sunny the years ahead may be compared with the long-term average.', groups: [['iav', 'Year-to-year variability', ['ghi_iav']]] },
    's.model': { plant: 'solar', name: 'Sun to array', what: 'The models that carry irradiance onto the tilted array and through the energy simulation.', groups: [['poa', 'Transposition to the array', ['transposition']], ['sim', 'Energy simulation model', ['model_chain']]] },
    's.array': { plant: 'solar', name: 'PV array', what: 'Shading, soiling, optics, temperature, module rating, rear-side gain and degradation.', groups: [['shade', 'Shading', ['horizon_far', 'shading_near']], ['soil', 'Soiling', ['soiling']], ['optics', 'Optics and spectrum', ['iam', 'spectral', 'low_light']], ['temp', 'Temperature', ['temperature']], ['modules', 'Modules', ['module_rating', 'lid', 'mismatch']], ['rear', 'Rear-side gain', ['bifacial']], ['degr', 'Degradation', ['degradation']]] },
    's.inv': { plant: 'solar', name: 'Inverters', what: 'DC wiring, conversion efficiency, clipping at the inverter limit and plant availability.', groups: [['dc', 'DC wiring', ['dc_wiring']], ['eff', 'Inverter efficiency', ['inverter']], ['clip', 'Clipping', ['clipping']], ['avail', 'Plant availability', ['pv_avail']]] },
    's.sub': { plant: 'solar', name: 'Transformer and AC', what: 'AC wiring and transformer losses, and site consumption.', groups: [['ac', 'AC wiring and transformer', ['ac_loss']], ['aux', 'Site consumption', ['pv_aux']]] },

    grid: { plant: 'shared', name: 'Grid connection', nameHybrid: 'Shared connection', what: 'Export line, grid outages, curtailment and the revenue meter at the point of interconnection.', whatHybrid: 'One connection for both farms: export line, grid outages, curtailment, the export limit and the revenue meter. Counted once.', groups: [['line', 'Export line', ['el_export']], ['avail', 'Grid availability', ['av_grid']], ['curt', 'Grid curtailment', ['cur_grid', 'cur_ops']], ['limit', 'Export limit', ['hy_export_limit']], ['meter', 'Metering', ['poi_meter']]] },
    bess: { plant: 'bess', name: 'Battery', what: 'Usable capacity, how fast it fades, round-trip efficiency, outages and dispatch. These act through the hourly simulation, not the P-values.', groups: [['cap', 'Capacity and fade', ['bess_cap', 'bess_fade']], ['eff', 'Efficiency and auxiliary load', ['bess_rte', 'bess_aux']], ['out', 'Outages', ['bess_avail']], ['disp', 'Dispatch', ['bess_dispatch']]] },
    buyer: { plant: 'bess', name: 'Firm supply', what: 'The supply contract: demand profile, minimum delivery rules and the shortfall penalty, checked hour by hour.', groups: [] },

    w: { plant: 'wind', name: 'Wind farm', what: 'The wind plant from mast to substation. Open it to see its parts.', groups: [] },
    s: { plant: 'solar', name: 'Solar farm', what: 'The solar plant from irradiance data to transformer. Open it to see its parts.', groups: [] },
    link: { plant: 'shared', name: 'Wind–solar link', what: 'How wind and solar errors move together. Opposite movements cancel part of the uncertainty; matching movements add to it.', groups: [] },
  };

  const ORDER = {
    wind: ['w.meas', 'w.lt', 'w.vert', 'w.horiz', 'w.future', 'w.turbines', 'w.elec', 'grid'],
    solar: ['s.irr', 's.future', 's.model', 's.array', 's.inv', 's.sub', 'grid'],
    site: ['w', 's', 'link', 'grid'],
  };

  /* item id → [component, group] */
  const PLACE = {};
  Object.entries(COMPONENTS).forEach(([cid, c]) => c.groups.forEach(([gid, , ids]) => ids.forEach(id => { PLACE[id] = [cid, gid]; })));

  function place(it) {
    if (it.deviceId) return { comp: 'w.meas', group: 'dev:' + it.deviceId, groupName: it.deviceName || 'Device' };
    const p = PLACE[it.id];
    return p ? { comp: p[0], group: p[1] } : null;
  }
  const groupName = (cid, gid) => { const g = (COMPONENTS[cid] || { groups: [] }).groups.find(x => x[0] === gid); return g ? g[1] : gid; };
  const tiers0 = () => ({ calc: 0, site: 0, desc: 0, generic: 0 });

  /* Combined loss of a set of loss items at horizon N, as a percentage (negative for a gain). */
  function lossOf(items, N, E) {
    let eff = 1, any = false;
    items.forEach(x => { const it = x.it || x; if (it.domain !== 'loss' || it.mode === 'none') return; any = true; eff *= 1 - E.lossAt(it, N).L / 100; });
    return any ? (1 - eff) * 100 : null;
  }

  /* Order of the components for a project and drawing ('wind' | 'solar' | 'site'). */
  function orderFor(project, view) {
    const hyb = project.tech === 'hybrid';
    const v = view || (hyb ? 'site' : project.tech === 'solar' ? 'solar' : 'wind');
    const list = ORDER[v].slice();
    if (project.bess && project.bess.enabled && (v === 'site' || !hyb)) list.push('bess', 'buyer');
    return list;
  }

  function summarise(project, r, E, Lb) {
    const hyb = !!r.hybrid, N = r.focusN;
    const tot = Math.max(1e-12, r.focus.sigma ** 2);
    const fc = r.focus.comb || {};
    const share = { wind: hyb ? fc.aw : 1, solar: hyb ? fc.as : 1 };
    const varOf = {}; r.contrib.forEach(c => { varOf[c.key] = c.variance; });
    const comps = {}, unplaced = [];
    const devOrder = (project.devices || []).map(d => 'dev:' + d.id);
    const ensure = id => {
      if (!comps[id]) {
        const m = COMPONENTS[id];
        comps[id] = { id, plant: m.plant, var: 0, mix: tiers0(), groups: [], gmap: {}, items: [], status: 'ok' };
      }
      return comps[id];
    };
    const ensureGroup = (c, gid, name) => {
      if (!c.gmap[gid]) { const g = { id: gid, name: name || groupName(c.id, gid), var: 0, mix: tiers0(), items: [] }; c.gmap[gid] = g; c.groups.push(g); }
      return c.gmap[gid];
    };
    r.model.items.forEach(it => {
      const p = place(it);
      if (!p) { unplaced.push(it); return; }
      const c = ensure(p.comp), g = ensureGroup(c, p.group, p.groupName);
      const v = varOf[it.key] || 0;
      c.var += v; g.var += v;
      if (c.mix[it.tier] != null) { c.mix[it.tier] += v; g.mix[it.tier] += v; }
      const x = { it, var: v, share: v / tot };
      c.items.push(x); g.items.push(x);
    });
    // battery items are not part of the P-values; evaluate them for display
    if (project.bess && project.bess.enabled) {
      const c = ensure('bess');
      Lb.ITEMS.filter(d => d.tech === 'bess').forEach(d => {
        const p = PLACE[d.id]; if (!p) return;
        const it = Object.assign({ key: d.id, id: d.id, def: d, name: d.name, stage: 'bess', cat: d.cat, sub: d.sub, domain: 'bess', comp: 'bess' }, E.evalItem(d, (project.items || {})[d.id], {}));
        const g = ensureGroup(c, p[1]);
        const x = { it, var: 0, share: 0 }; c.items.push(x); g.items.push(x);
      });
      ensure('buyer');
    }
    // finish components
    Object.values(comps).forEach(c => {
      const m = COMPONENTS[c.id];
      const order = m.groups.map(g => g[0]);
      c.groups.sort((a, b) => {
        const ia = a.id.startsWith('dev:') ? devOrder.indexOf(a.id) - 100 : order.indexOf(a.id);
        const ib = b.id.startsWith('dev:') ? devOrder.indexOf(b.id) - 100 : order.indexOf(b.id);
        return ia - ib;
      });
      const own = c.plant === 'wind' || c.plant === 'solar' ? share[c.plant] : 1;
      const fin = o => {
        o.sigma = Math.sqrt(Math.max(0, o.var));
        o.sigmaOwn = own > 0 ? o.sigma / own : o.sigma;
        o.share = o.var / tot;
        o.loss = lossOf(o.items, N, E);
        const mv = Object.values(o.mix).reduce((a, b) => a + b, 0);
        o.mixShare = {}; Object.keys(o.mix).forEach(k => { o.mixShare[k] = mv > 0 ? o.mix[k] / mv : 0; });
        o.generic = o.mixShare.generic || 0;
        o.excluded = o.items.filter(x => x.it.mode === 'none').length;
      };
      fin(c); c.groups.forEach(g => { fin(g); g.shareInComp = c.var > 0 ? g.var / c.var : 0; });
      delete c.gmap;
    });
    // parts that have no items left (desktop wind mode replaces three of them)
    const desktop = project.tech !== 'solar' && project.setup && project.setup.dataSource === 'desktop';
    ['w.lt', 'w.vert', 'w.horiz'].forEach(id => {
      if (project.tech === 'solar') return;
      const c = ensure(id);
      if (!c.items.length) { c.status = desktop ? 'atlas' : 'empty'; c.sigma = c.sigmaOwn = c.share = 0; c.loss = null; c.mixShare = tiers0(); c.generic = 0; c.excluded = 0; }
    });
    // farm-level totals for a hybrid, and the correlation term
    const farms = {};
    if (hyb) {
      ['wind', 'solar'].forEach(pl => {
        const list = Object.values(comps).filter(c => c.plant === pl);
        const v = list.reduce((a, c) => a + c.var, 0);
        const mix = tiers0(); list.forEach(c => Object.keys(mix).forEach(k => { mix[k] += c.mix[k]; }));
        const mv = Object.values(mix).reduce((a, b) => a + b, 0);
        const mixShare = {}; Object.keys(mix).forEach(k => { mixShare[k] = mv > 0 ? mix[k] / mv : 0; });
        const ownSigma = pl === 'wind' ? fc.cw.sigma : fc.cs.sigma;
        farms[pl] = { id: pl === 'wind' ? 'w' : 's', var: v, sigma: Math.sqrt(v), sigmaOwn: ownSigma, share: v / tot, mixShare, generic: mixShare.generic, energyShare: share[pl], p50: r.focus.parts[pl].p50, items: list.reduce((a, c) => a + c.items.length, 0) };
      });
    }
    const cross = hyb ? r.crossVar : 0;
    const sumVar = Object.values(comps).reduce((a, c) => a + c.var, 0) + cross;
    return {
      hybrid: hyb, N, tot, sigma: r.focus.sigma, p50: r.focus.p50, pv: r.focus.pv,
      comps, farms, cross: { var: cross, share: cross / tot, sigma: Math.sign(cross) * Math.sqrt(Math.abs(cross)) },
      sumVar, unplaced,
      sumOfSigmas: Object.values(comps).reduce((a, c) => a + (c.sigma || 0), 0),
    };
  }

  return { COMPONENTS, ORDER, PLACE, place, groupName, orderFor, summarise, lossOf };
})();
if (typeof module !== 'undefined') module.exports = Plant;
