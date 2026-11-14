  /* WattOdds — energy yield uncertainty, source to meter.
     Copyright 2026 Nithish Seenivasagam (coderenewables.com)
     SPDX-License-Identifier: Apache-2.0 */
  /* ======================= Import from a report =======================
     The dialog for ReportImport (src/reportimport.js): copy a prompt, paste the JSON an AI chat
     returned, review every row, then apply the ticked rows in one step. No network call is made.
     Everything that comes from the pasted JSON is untrusted: it reaches the page only through esc(). */
  const RI = ReportImport;
  const ri = { step: 'start', scope: null, show: false, text: '', result: null, dec: { rows: {}, basics: {} }, plan: null, open: null, status: '', forId: null, undoAt: null, prevBase: null, done: null, busy: false, down: false, pending: false, stale: false };
  const RI_TECH = { wind: 'Wind', solar: 'Solar PV', hybrid: 'Hybrid (wind + solar)' };
  const RI_SCOPE = { hybrid: 'Wind and solar', wind: 'Wind plant only', solar: 'Solar plant only' };
  const RI_OF = { wind_speed: 'of wind speed', irradiance: 'of irradiance', energy: 'of energy', loss_points: 'points', relative_to_loss: 'of the loss', unknown: '(share of what: not stated)' };
  const RI_LEVEL = { standard: 'one standard deviation', k2: 'k = 2', p90: 'P50 to P90', unknown: 'level not stated' };
  const RI_AS = { loss: 'loss', efficiency: 'efficiency', gain: 'gain', unknown: '(loss or efficiency: not stated)' };
  const RI_STATE = { ready: 'Ready', check: 'Check', error: 'Cannot import', unmapped: 'Not mapped' };
  const riScopes = () => (isHybrid() ? ['hybrid', 'wind', 'solar'] : [ptech()]);
  const riEntryHtml = () => `<p class="side-note ri-entry">Have an energy yield report? <button class="btn small" data-act="riopen">Import from a report</button></p>`;
  const riStatus = s => { ri.status = s; setOvStatus(s); };
  const riFocus = () => { const h = $('#ovTitle'); if (h) h.focus(); };
  const riPlan = () => { ri.plan = RI.planApply(ri.result, ri.dec, state, Lb, E); };
  const riDec = n => (ri.dec.rows[n] = ri.dec.rows[n] || {});
  function riReset() { ri.step = 'start'; ri.result = null; ri.plan = null; ri.dec = { rows: {}, basics: {} }; ri.open = null; ri.status = ''; }
  /* redraw and give focus back. Replacing the table blurs the focused input, which can fire a second
     change event while the first is still being handled; ri.busy drops that second one. */
  function riRender(focusId) {
    ri.pending = false;                        /* any render shows the latest state */
    ri.stale = false;
    if (ri.busy) return;
    const act = document.activeElement;
    const want = focusId || (act && act.id && act !== document.body ? act.id : null);
    ri.busy = true;
    try { renderOverlay({}); } finally { ri.busy = false; }
    const el = want ? document.getElementById(want) : null;
    if (el) el.focus({ preventScroll: true });
  }
  function riOpen() {
    if (ri.forId !== state.meta.id || (ri.result && ri.result.tech !== ptech())) { riReset(); ri.text = ''; ri.done = null; ri.undoAt = null; ri.prevBase = null; ri.forId = state.meta.id; }
    if (riScopes().indexOf(ri.scope) < 0) ri.scope = ptech();
    if (ri.step === 'review') riPlan();
    overlay = { kind: 'report' };
    renderOverlay({}); riFocus();
  }

  /* ---------- text helpers (plain text out; callers escape) ---------- */
  function riStated(row) {
    const v = row.value === null ? '?' : String(row.value), u = row.unit === 'fraction' ? ' (fraction)' : row.unit ? ' ' + row.unit : '';
    if (row.quantity === 'loss') return `${v}${u} ${RI_AS[row.stated_as]}`;
    if (row.quantity === 'uncertainty') return `${v}${u} ${RI_OF[row.percent_of]}, ${RI_LEVEL[row.level]}${row.period_years ? ', ' + row.period_years + '-year' : ''}`;
    return `${v}${u}`;
  }
  const riUnit = (def, field) => (def.time === 'horizon' ? '%/yr' : field === 's' ? 'pts' : '%');
  const riWhat = (def, field) => (field === 'v' ? 'Standard uncertainty, share of ' + (def.domain === 'ws' ? 'wind speed' : def.domain === 'res' ? 'irradiance' : 'energy') : field === 'L' ? (def.time === 'horizon' ? 'Rate' : def.id === 'bifacial' ? 'Loss (negative for a gain)' : 'Loss') : 'Uncertainty of the loss');
  function riNow(r) {
    const cur = r.key ? itemMap()[r.key] : null;
    if (!cur) return 'Not in use';
    if (cur.mode === 'none') return 'Excluded';
    const x = r.field === 'L' ? cur.L : cur.sigma;
    return `${r.field === 's' ? '± ' : ''}${fx(x, 2)} ${riUnit(r.def, r.field)} · ${TIER[cur.tier].label}`;
  }
  function riItemOptions(sel) {
    const groups = [];
    Lb.ITEMS.filter(d => RI.validFor(d, ptech())).forEach(d => {
      const pl = RI.plantOf(d);
      const label = (isHybrid() ? COMP_LABEL[pl === 'shared' ? 'hybrid' : pl] + ': ' : '') + (d.device ? (d.device === 'lidar' ? 'Lidar' : 'Mast') : stageName(isHybrid() ? E.hybridStageOf(d) : d.stage));
      let g = groups.find(x => x[0] === label);
      if (!g) { g = [label, []]; groups.push(g); }
      g[1].push(d);
    });
    return `<option value="">Not mapped</option>${groups.map(([label, defs]) => `<optgroup label="${esc(label)}">${defs.map(d => `<option value="${esc(d.id)}"${d.id === sel ? ' selected' : ''}>${esc(d.name)}</option>`).join('')}</optgroup>`).join('')}`;
  }

  /* ---------- the three steps ---------- */
  function riStartHtml() {
    const errs = ri.result && !ri.result.ok ? ri.result.errors : [];
    const prompt = ri.show ? RI.buildPrompt(ri.scope, Lb, state) : '';
    const nIds = RI.promptIds(ri.scope, Lb, state).length;
    return `<p>An AI chat can read a consultant’s energy yield report and fill in the values for you. This page sends nothing anywhere: you copy a prompt, run it in the AI chat you are allowed to use, and paste the reply back here. You check every value before it is used.</p>
      <section class="stack" style="gap:8px"><h4>1. Copy the prompt</h4>
        ${isHybrid() ? `<div class="field"><span class="lab">Which report is it?</span><div class="seg" role="group" aria-label="Which report is it?">${riScopes().map(s => `<button data-act="riscope" data-val="${s}" aria-pressed="${ri.scope === s}">${RI_SCOPE[s]}</button>`).join('')}</div></div>` : ''}
        <p class="side-note">Written for the open project (${esc(RI_TECH[ptech()])}). It lists the ${nIds} items this tool can take from a ${esc(ri.scope)} report${ptech() !== 'solar' && ri.scope !== 'solar' && state.devices.length ? ', and the names of your masts and lidars' : ''}. Nothing else from your project is in it.</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-act="ricopy">Copy prompt</button><button class="btn" data-act="rishow" aria-expanded="${ri.show}">${ri.show ? 'Hide prompt' : 'Show prompt'}</button></div>
        ${ri.show ? `<textarea class="ta mono" id="riPrompt" readonly rows="10" aria-label="Prompt to copy">${esc(prompt)}</textarea>` : ''}
      </section>
      <section class="stack" style="gap:8px"><h4>2. Run it with your report</h4>
        <p>Open the AI chat you are allowed to use, attach the report (PDF), paste the prompt and send it. Check your organisation’s rules before you upload a confidential report.</p>
      </section>
      <section class="stack" style="gap:8px"><h4>3. Paste the reply</h4>
        <div class="field"><label for="riText">Reply from the AI (JSON)</label><textarea class="ta mono" id="riText" data-ri="text" spellcheck="false" autocomplete="off" placeholder="{ &quot;schema&quot;: &quot;wattodds.report-import/1&quot;, … }">${esc(ri.text)}</textarea></div>
        ${errs.length ? `<div class="warn" role="alert" id="riErr">${errs.map(e => `<p>${esc(e.message)}</p>`).join('')}</div>` : ''}
        <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center"><button class="btn primary" data-act="richeck">Check the values</button><label class="btn" for="riFile">Load a .json file</label><input id="riFile" type="file" accept=".json,.txt,application/json,text/plain" data-act="rifile" class="sr"></div>
      </section>`;
  }
  function riRowHtml(row, r) {
    const n = row.n, d = ri.dec.rows[n] || {};
    const unmapped = r.errors.some(e => /^R_(UNMAPPED|ID_)/.test(e.code));
    const usable = !r.errors.length && r.value !== null;
    const st = !usable ? (unmapped ? 'unmapped' : 'error') : (r.check || row.check || r.dupOf !== null) ? 'check' : 'ready';
    const pick = unmapped || ri.open === n || Object.prototype.hasOwnProperty.call(d, 'id');
    const devs = r.def && r.def.device ? state.devices.map((dv, i) => (dv.type === r.def.device ? `<option value="${i}"${r.device === i ? ' selected' : ''}>${i + 1} · ${esc(dv.name || '')}</option>` : '')).join('') : '';
    const msgs = [...r.errors.map(e => ['err', e.message]), ...row.warnings.map(e => ['', e.message]), ...r.warnings.map(e => ['', e.message])];
    if (r.edited) msgs.push(['', 'Value changed by you.']);
    return `<tr class="${usable ? '' : 'ri-off'}">
      <td class="ri-use"><input type="checkbox" id="ri-use-${n}" data-ri="use" data-n="${n}"${r.accept ? ' checked' : ''}${usable ? '' : ' disabled'} aria-label="Import row ${n}: ${esc(row.label)}"></td>
      <td data-th="In the report"><b>${esc(row.label)}</b><span class="ri-q mono">${esc(riStated(row))}</span><span class="ri-q">${row.page ? 'p. ' + row.page : 'no page'}${row.quote ? ' · “' + esc(row.quote) + '”' : ''}</span>${row.notes ? `<span class="ri-q">Note: ${esc(row.notes)}</span>` : ''}${row.reason ? `<span class="ri-q">Not placed: ${esc(row.reason)}</span>` : ''}</td>
      <td data-th="Item in WattOdds">${pick
        ? `<div class="inp"><select id="ri-id-${n}" data-ri="id" data-n="${n}" aria-label="Item for row ${n}">${riItemOptions(r.id)}</select></div>`
        : `${esc(r.def.name)}${isHybrid() ? ` <span class="tag save">${COMP_LABEL[r.plant === 'shared' ? 'hybrid' : r.plant]}</span>` : ''} <button class="btn small ghost" id="ri-map-${n}" data-act="rimap" data-n="${n}" aria-label="Change the item for row ${n}">Change</button>`}
        ${devs ? `<div class="inp" style="margin-top:6px"><select id="ri-dev-${n}" data-ri="device" data-n="${n}" aria-label="Mast or lidar for row ${n}">${r.device === null ? '<option value="" selected>Choose a device</option>' : ''}${devs}</select></div>` : ''}
        ${r.covers.length ? `<label class="ri-q"><input type="checkbox" id="ri-cov-${n}" data-ri="covers" data-n="${n}"${d.covers === false ? '' : ' checked'}> Also set to Exclude, because this figure already includes them: ${esc(r.covers.map(c => c.name).join(', '))}</label>` : ''}</td>
      <td data-th="Now in the project">${r.def && r.field ? esc(riNow(r)) : '–'}</td>
      <td data-th="Will be set to">${r.def && r.field ? `<div class="inp ri-val"><input type="number" inputmode="decimal" step="any" id="ri-v-${n}" data-ri="value" data-n="${n}" value="${r.value === null ? '' : r.value}" aria-label="Value to import for row ${n}"><span class="unit">${riUnit(r.def, r.field)}</span></div><span class="ri-q">${esc(riWhat(r.def, r.field))}</span>` : '–'}</td>
      <td data-th="Notes"><span class="tag save">${RI_STATE[st]}</span> <span class="tag save">AI confidence: ${esc(row.confidence)}</span>${msgs.map(([c, m]) => `<p class="ri-m ${c}">${esc(m)}</p>`).join('')}</td></tr>`;
  }
  function riBasicHtml(b, p) {
    const show = v => (typeof v === 'boolean' ? (v ? 'yes' : 'no') : v === null || v === undefined ? '–' : String(v));
    return `<tr class="${p.errors.length ? 'ri-off' : ''}">
      <td class="ri-use"><input type="checkbox" id="ri-b-${b.key}" data-ri="basic" data-key="${b.key}"${p.accept ? ' checked' : ''}${p.errors.length || p.value === null ? ' disabled' : ''} aria-label="Import ${esc(b.label)}"></td>
      <td data-th="Project value"><b>${esc(b.label)}</b></td>
      <td data-th="In the report"><span class="mono">${esc(show(b.value))} ${esc(b.unit)}</span><span class="ri-q">${b.page ? 'p. ' + b.page : 'no page'}${b.quote ? ' · “' + esc(b.quote) + '”' : ''}</span></td>
      <td data-th="Now in the project"><span class="mono">${esc(show(b.current))} ${esc(b.unit)}</span></td>
      <td data-th="Notes">${[...p.errors.map(e => ['err', e.message]), ...b.warnings.map(e => ['', e.message])].map(([c, m]) => `<p class="ri-m ${c}">${esc(m)}</p>`).join('') || (b.value === b.current ? '<span class="ri-q">Same as now.</span>' : '')}</td></tr>`;
  }
  function riReviewHtml() {
    const res = ri.result, plan = ri.plan, rep = res.report;
    const nTick = plan.rows.filter(r => r.accept).length + plan.basics.filter(b => b.accept).length;
    const cnt = { ready: 0, check: 0, off: 0 };
    plan.rows.forEach((r, i) => { const usable = !r.errors.length && r.value !== null; cnt[!usable ? 'off' : (r.check || res.rows[i].check || r.dupOf !== null) ? 'check' : 'ready']++; });
    const notes = res.warnings.map(w => w.message);
    if (state.meta.example) notes.push('The open project holds example values. Rows you do not import keep the example values.');
    if (rr.base && rr.base.id === state.meta.id) notes.push('Importing replaces your pinned baseline with the project as it is now, so that you can undo the import. Undo import puts your baseline back.');
    return `<p><b>${esc(rep.title || 'Untitled report')}</b>${rep.author ? ' · ' + esc(rep.author) : ''}${rep.date ? ' · ' + esc(rep.date) : ''}</p>
      <p class="side-note">${cnt.ready} ready, ${cnt.check} to check, ${cnt.off} that cannot be imported as they are. Compare each row with the page it quotes. Ticked rows are imported; everything else in the project stays as it is.</p>
      ${notes.map(m => `<p class="note">${esc(m)}</p>`).join('')}
      ${res.basics.length ? `<h4>Project values</h4><div class="tblwrap"><table class="t ri-t"><thead><tr><th scope="col">Use</th><th scope="col">Project value</th><th scope="col">In the report</th><th scope="col">Now in the project</th><th scope="col">Notes</th></tr></thead><tbody>${res.basics.map((b, i) => riBasicHtml(b, plan.basics[i])).join('')}</tbody></table></div>` : ''}
      ${res.rows.length ? `<h4>Uncertainties and losses</h4><div class="tblwrap"><table class="t ri-t"><thead><tr><th scope="col">Use</th><th scope="col">In the report</th><th scope="col">Item in WattOdds</th><th scope="col">Now in the project</th><th scope="col">Will be set to</th><th scope="col">Notes</th></tr></thead><tbody>${res.rows.map((row, i) => riRowHtml(row, plan.rows[i])).join('')}</tbody></table></div>` : ''}
      ${plan.errors.filter(e => e.code !== 'P_NOTHING').length ? `<div class="warn" role="alert">${plan.errors.filter(e => e.code !== 'P_NOTHING').map(e => `<p>${esc(e.message)}</p>`).join('')}</div>` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <button class="btn" data-act="riback">Back</button><button class="btn" data-act="riall">Tick all that are ready</button><button class="btn" data-act="rinone">Untick all</button><span style="flex:1"></span>
        <button class="btn primary" id="riApply" data-act="riapply"${plan.ok ? '' : ' disabled'}>Import ${nTick} value${nTick === 1 ? '' : 's'}</button></div>`;
  }
  function riDoneHtml() {
    const d = ri.done || { values: 0, items: 0, excluded: 0, basics: 0, title: '' };
    const can = rr.base && rr.base.at === ri.undoAt && rr.base.id === state.meta.id;
    return `<p><b>Imported.</b> ${d.values} value${d.values === 1 ? '' : 's'} on ${d.items} item${d.items === 1 ? '' : 's'}${d.excluded ? `, ${d.excluded} item${d.excluded === 1 ? '' : 's'} set to Exclude because the report figures include them` : ''}${d.basics ? `, ${d.basics} project value${d.basics === 1 ? '' : 's'}` : ''}, from “${esc(d.title || 'Untitled report')}”.</p>
      <p class="note">Each imported item is now a site value (Enter value), and its card shows the page and the quoted text. The results panel compares with the project before the import. Undo import puts every input back as it was before the import, including changes you made since.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn"${can ? '' : ' disabled'} data-act="riundo">Undo import</button><button class="btn" data-act="rinew">Import another report</button><button class="btn primary" data-act="close">Done</button></div>`;
  }
  function riHtml() {
    const review = ri.step === 'review' && ri.result && ri.result.ok && ri.plan;
    const body = review ? riReviewHtml() : ri.step === 'done' ? riDoneHtml() : riStartHtml();
    return `<div class="sheet-panel${review ? ' wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="ovTitle">
      <header><h3 id="ovTitle" tabindex="-1">Import from a report</h3><button class="btn small ghost" data-act="close" aria-label="Close">Close</button></header>
      ${body}
      <p class="status" id="ovStatus" role="status">${esc(ri.status)}</p></div>`;
  }

  /* ---------- actions ---------- */
  function riCopy() {
    const text = RI.buildPrompt(ri.scope, Lb, state);
    const ok = () => riStatus('Prompt copied. Paste it into your AI chat and attach the report.');
    const manual = () => { ri.show = true; ri.status = 'Copying is blocked in this browser. The prompt is selected: press Ctrl+C (Cmd+C on a Mac).'; renderOverlay({}); const ta = $('#riPrompt'); if (ta) { ta.focus(); ta.select(); } };
    try { if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(ok, manual); else manual(); } catch (e) { manual(); }
  }
  function riCheck() {
    ri.result = RI.validateImport(ri.text, state, Lb, E);
    ri.forId = state.meta.id; ri.dec = { rows: {}, basics: {} }; ri.open = null; ri.status = '';
    if (!ri.result.ok) { ri.step = 'start'; riRender('riText'); return; }
    ri.step = 'review'; riPlan(); renderOverlay({}); riFocus();
  }
  function riFile(file) {
    if (!file) return;
    if (file.size > 1000000) { riStatus('That file is too large (the limit is 1 MB).'); return; }
    const fr = new FileReader();
    fr.onload = () => { ri.text = String(fr.result || ''); riCheck(); };
    fr.onerror = () => riStatus('The file could not be read.');
    fr.readAsText(file);
  }
  /* a ticked row unticks any other row that sets the same value */
  function riTick(n, on) {
    riDec(n).accept = on;
    riPlan();
    const me = ri.plan.rows.find(r => r.n === n);
    if (on && me && me.accept) {
      ri.plan.rows.forEach(r => { if (r.n !== n && r.accept && r.path === me.path && r.field === me.field) riDec(r.n).accept = false; });
      riPlan();
    }
  }
  function riApply() {
    if (!ri.result || !ri.result.ok || ri.forId !== state.meta.id) return;
    riPlan();                                  // against the project as it is now
    if (!ri.plan.ok) { renderOverlay({}); return; }
    const out = RI.applyImport(state, ri.plan);
    if (!out.ok) { riStatus(out.error.message); return; }
    const at = new Date().toISOString();
    /* a second import keeps the baseline from before the first, so that Undo goes back that far */
    if (!(rr.base && ri.undoAt && rr.base.at === ri.undoAt)) ri.prevBase = rr.base ? clone(rr.base) : null;
    rr.base = { id: state.meta.id, at, state: clone(state) }; rr.baseSnaps = {}; saveBase();   // the project before the import: Undo and the results panel compare with it
    ri.done = Object.assign({ title: ri.result.report.title }, ri.plan.summary);
    state = out.project;                       // one assignment: every ticked row or none
    mc = null; ri.undoAt = at; ri.text = ''; riReset(); ri.step = 'done';
    touch(); recompute(); renderStage(true); updateChrome();
    renderOverlay({}); riFocus();
  }
  function riUndo() {
    if (!rr.base || rr.base.at !== ri.undoAt || rr.base.id !== state.meta.id) { riStatus('This import can no longer be undone here: the baseline was changed.'); return; }
    revertBase();
    rr.base = ri.prevBase; ri.prevBase = null; rr.baseSnaps = {}; saveBase(); renderSide();
    ri.undoAt = null; ri.done = null; riReset(); ri.status = 'Import undone. The project is as it was before the import.';
    renderOverlay({}); riFocus();
  }

  /* ---------- events; each returns true when it handled the event ---------- */
  function riClick(e) {
    const t = e.target.closest('button[data-act]');
    if (!t) return false;
    const act = t.dataset.act;
    if (act === 'riopen') { riOpen(); return true; }
    if (!overlay || overlay.kind !== 'report') return false;
    if (act === 'ricopy') { riCopy(); return true; }
    if (act === 'rishow') { ri.show = !ri.show; renderOverlay({}); return true; }
    if (act === 'riscope') { if (riScopes().indexOf(t.dataset.val) >= 0) ri.scope = t.dataset.val; renderOverlay({}); return true; }
    if (act === 'richeck') { riCheck(); return true; }
    if (act === 'riback') { ri.step = 'start'; ri.status = ''; renderOverlay({}); riFocus(); return true; }
    if (act === 'rimap') { ri.open = +t.dataset.n; riRender('ri-id-' + t.dataset.n); return true; }
    if (act === 'riall' || act === 'rinone') {
      const on = act === 'riall';
      ri.plan.rows.forEach((r, i) => {
        if (r.errors.length || r.value === null) return;
        if (!on) riDec(r.n).accept = false;
        else if (!r.check && !ri.result.rows[i].check && r.dupOf === null) riDec(r.n).accept = true;
      });
      ri.plan.basics.forEach((b, i) => {
        if (b.errors.length || b.value === null) return;
        if (!on) ri.dec.basics[b.key] = { accept: false };
        else if (!ri.result.basics[i].check) ri.dec.basics[b.key] = { accept: true };
      });
      riPlan(); renderOverlay({}); return true;
    }
    if (act === 'riapply') {
      if (ri.stale) { riRender('riApply'); setTimeout(() => { if (overlay && overlay.kind === 'report' && ri.step === 'review' && $('#riApply')) riStatus('The table now shows your last change. Check it, then import.'); }, 50); return true; }
      riApply(); return true;
    }
    if (act === 'riundo') { riUndo(); return true; }
    if (act === 'rinew') { riReset(); ri.text = ''; ri.done = null; renderOverlay({}); riFocus(); return true; }
    return false;
  }
  function riInput(e) {
    const el = e.target;
    if (!el.dataset || !el.dataset.ri) return false;
    if (el.dataset.ri === 'text') ri.text = el.value;
    return true;                               // nothing in this dialog writes to the project while you type
  }
  function riChange(e) {
    const el = e.target;
    if (el.matches && el.matches('input[type=file][data-act=rifile]')) { riFile(el.files && el.files[0]); el.value = ''; return true; }
    if (!el.dataset || !el.dataset.ri) return false;
    if (ri.busy) return true;
    const kind = el.dataset.ri, n = +el.dataset.n;
    if (kind === 'text') { ri.text = el.value; return true; }
    if (!ri.result || !ri.result.ok || !ri.plan) return true;
    if (kind === 'use') riTick(n, el.checked);
    else if (kind === 'covers') { riDec(n).covers = el.checked; riPlan(); }
    else if (kind === 'basic') { ri.dec.basics[el.dataset.key] = { accept: el.checked }; riPlan(); }
    else if (kind === 'id') { const d = riDec(n); d.id = el.value || null; delete d.device; delete d.value; ri.open = n; riTick(n, !!el.value); }
    else if (kind === 'device') { if (el.value !== '') { riDec(n).device = +el.value; riTick(n, true); } }
    else if (kind === 'value') {
      const v = parseFloat(el.value); if (isFinite(v)) riDec(n).value = v; else delete riDec(n).value; riTick(n, isFinite(v) ? true : !!riDec(n).accept);
      ri.stale = true;
      setTimeout(riFlush, 0); return true;
    }
    riRender();
    return true;
  }
  /* the table is redrawn after a value edit: not while a pointer is held (the click would be lost), not while a drop-down is open */
  function riFlush() {
    if (!(overlay && overlay.kind === 'report' && ri.step === 'review')) { ri.pending = false; return; }
    if (ri.down) { ri.pending = true; return; }
    const a = document.activeElement;
    if (a && a.tagName === 'SELECT' && a.closest('#overlay')) {   // the table is rendered when the drop-down loses focus
      a.addEventListener('focusout', () => setTimeout(riFlush, 0), { once: true });
      ri.pending = false;
      return;
    }
    ri.pending = false; riRender();
  }
  /* the pointer state for riFlush; the timeout lets the click that follows pointer up arrive first */
  function riUp() { ri.down = false; if (ri.pending) setTimeout(() => { if (ri.pending) riFlush(); }, 0); }
  document.addEventListener('pointerdown', e => { if (!(e.target && e.target.closest && e.target.closest('select'))) ri.down = true; }, true);
  ['pointerup', 'pointercancel'].forEach(t => document.addEventListener(t, riUp, true));
  window.addEventListener('blur', riUp);
  /* a drop-down list or a right-click menu takes the release, so the release is also taken from these */
  ['contextmenu', 'dragstart'].forEach(t => document.addEventListener(t, riUp, true));
  document.addEventListener('keydown', e => { if (!e.repeat && ['Shift', 'Control', 'Alt', 'Meta', 'CapsLock'].indexOf(e.key) < 0) riUp(); }, true);
  document.addEventListener('pointermove', e => { if (ri.down && (e.buttons & 1) === 0) riUp(); }, true);
