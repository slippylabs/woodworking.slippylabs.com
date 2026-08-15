/* app.js — the page. Routing, controls, tables, exports.
 *
 * All the real work happens in the other five files; this one only decides
 * what to show. The whole configuration lives in the URL hash, so a plan you
 * have dialled in is a link you can send to someone.
 */
(function () {
  'use strict';

  const L = window.Lumber, G = window.Geom, Dw = window.Drawing,
        Opt = window.Optimizer, P = window.Plans;

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const PREFS_KEY = 'slippy-wood';
  const prefs = Object.assign(
    { metric: false, species: 'pine', bf: null, sheet: null, kerf: 0.125 },
    (() => { try { return JSON.parse(localStorage.getItem(PREFS_KEY)) || {}; } catch (e) { return {}; } })()
  );
  function savePrefs() {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (e) { /* private mode */ }
  }

  const state = { planId: null, params: {}, view: 'front', category: 'all' };

  /* ---- parameter sanitising -------------------------------------------
     Everything in the hash is untrusted. Rather than validate and reject,
     coerce each value onto the control that owns it — a range snaps to its
     own step and clamps to its own bounds, a select has to name one of its
     options — so a mangled link opens a sane plan instead of a broken one. */
  function optionValues(q) {
    return q.options.map((o) => (typeof o === 'object' ? o.value : o));
  }
  function coerce(q, raw) {
    if (raw === undefined || raw === null) return q.def;
    if (q.type === 'bool') return raw === true || raw === '1' || raw === 'true';
    if (q.type === 'select') {
      const vals = optionValues(q);
      return vals.indexOf(String(raw)) >= 0 ? String(raw) : q.def;
    }
    let n = Number(raw);
    if (!isFinite(n)) return q.def;
    n = Math.min(q.max, Math.max(q.min, n));
    n = q.min + Math.round((n - q.min) / q.step) * q.step;
    return Math.round(Math.min(q.max, Math.max(q.min, n)) * 1000) / 1000;
  }
  function cleanParams(plan, raw) {
    const out = {};
    for (const q of plan.params) out[q.key] = coerce(q, raw ? raw[q.key] : undefined);
    return out;
  }

  /* ---- routing --------------------------------------------------------- */
  function readHash() {
    const h = location.hash.replace(/^#\/?/, '');
    if (!h) return { id: null, params: {} };
    const [id, qs] = h.split('?');
    const params = {};
    if (qs) {
      for (const bit of qs.split('&')) {
        const [k, v] = bit.split('=');
        if (k) params[decodeURIComponent(k)] = decodeURIComponent(v || '');
      }
    }
    return { id: decodeURIComponent(id), params };
  }
  function writeHash(replace) {
    if (!state.planId) {
      if (location.hash) history.replaceState(null, '', location.pathname + location.search);
      return;
    }
    const qs = Object.keys(state.params)
      .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(state.params[k]))}`)
      .join('&');
    const url = `${location.pathname}${location.search}#/${state.planId}?${qs}`;
    if (replace) history.replaceState(null, '', url);
    else history.pushState(null, '', url);
  }

  /* ---- gallery --------------------------------------------------------- */
  function renderFilters() {
    $('filter-bar').innerHTML = P.CATEGORIES.map((c) =>
      `<button class="hud-tab${c.key === state.category ? ' active' : ''}" data-cat="${c.key}">${esc(c.label)}</button>`
    ).join('');
  }

  function renderGallery() {
    renderFilters();
    $('plan-grid').innerHTML = P.PLANS.map((plan) => {
      const hide = state.category !== 'all' && plan.category !== state.category ? ' hidden' : '';
      return `
      <article class="console-card${hide}" data-category="${esc(plan.category)}">
        <div class="console-card-head">
          <div class="console-name-wrap">
            <span class="console-icon">${plan.icon}</span>
            <span class="console-name">${esc(plan.title)}</span>
          </div>
          <span class="tag">${esc(plan.difficulty)}</span>
        </div>
        <p class="card-blurb">${esc(plan.blurb)}</p>
        <div class="plan-chips">
          <span class="chip">${esc(plan.time)}</span>
          <span class="chip">${esc(plan.category)}</span>
        </div>
        <a class="dl" href="#/${encodeURIComponent(plan.id)}" data-open="${esc(plan.id)}">Open Plan</a>
      </article>`;
    }).join('');
  }

  /* ---- controls -------------------------------------------------------- */
  function controlMarkup(q, value) {
    const id = 'p-' + q.key;
    if (q.type === 'bool') {
      return `<label class="tool-check" for="${id}">
        <input type="checkbox" id="${id}" data-key="${esc(q.key)}"${value ? ' checked' : ''}>
        <span>${esc(q.label)}</span></label>`;
    }
    if (q.type === 'select') {
      const opts = q.options.map((o) => {
        const v = typeof o === 'object' ? o.value : o;
        const lab = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(lab)}</option>`;
      }).join('');
      return `<div class="ctrl"><label class="ctrl-label" for="${id}">${esc(q.label)}</label>
        <select class="tool-select" id="${id}" data-key="${esc(q.key)}">${opts}</select></div>`;
    }
    return `<div class="ctrl"><label class="ctrl-label" for="${id}">${esc(q.label)}</label>
      <div class="tool-slider-row">
        <input type="range" id="${id}" data-key="${esc(q.key)}" min="${q.min}" max="${q.max}" step="${q.step}" value="${value}">
        <span class="tool-slider-value" id="v-${esc(q.key)}">${esc(labelFor(q, value))}</span>
      </div></div>`;
  }
  function labelFor(q, v) {
    if (q.unit === 'in') return L.len(Number(v), prefs.metric);
    if (q.unit === '°') return v + '°';
    return String(v) + (q.unit ? ' ' + q.unit : '');
  }

  function renderControls(plan) {
    $('ctrl-slot').innerHTML = plan.params.map((q) => controlMarkup(q, state.params[q.key])).join('');
    const sp = L.SPECIES;
    $('shop-slot').innerHTML = `
      <div class="sub-head">Costing</div>
      <div class="ctrl"><label class="ctrl-label" for="sp-sel">Species</label>
        <select class="tool-select" id="sp-sel">${Object.keys(sp).map((k) =>
          `<option value="${k}"${k === prefs.species ? ' selected' : ''}>${esc(sp[k].label)}</option>`).join('')}</select></div>
      <div class="ctrl"><label class="ctrl-label" for="bf-in">Price per board foot ($)</label>
        <input class="tool-text-input" id="bf-in" type="number" min="0" step="0.05" value="${rate().bf.toFixed(2)}"></div>
      <div class="ctrl"><label class="ctrl-label" for="kerf-sel">Saw kerf</label>
        <select class="tool-select" id="kerf-sel">
          <option value="0.09375"${prefs.kerf === 0.09375 ? ' selected' : ''}>3/32" (thin kerf)</option>
          <option value="0.125"${prefs.kerf === 0.125 ? ' selected' : ''}>1/8" (standard)</option>
          <option value="0.0625"${prefs.kerf === 0.0625 ? ' selected' : ''}>1/16" (bandsaw)</option>
        </select></div>
      <label class="tool-check" for="metric-in">
        <input type="checkbox" id="metric-in"${prefs.metric ? ' checked' : ''}>
        <span>Millimetres instead of inches</span></label>`;
  }

  function rate() {
    const sp = L.SPECIES[prefs.species] || L.SPECIES.pine;
    return { bf: prefs.bf == null ? sp.bf : prefs.bf, sheet: prefs.sheet == null ? sp.sheet : prefs.sheet };
  }

  /* ---- the plan page --------------------------------------------------- */
  let pending = 0;
  function schedule(plan) {
    if (pending) return;
    pending = requestAnimationFrame(() => { pending = 0; paint(plan); });
  }

  function paint(plan) {
    const built = plan.build(state.params);
    const errSlot = $('error-slot');

    if (built.error) {
      // The controls are the only way out of an error, so they stay put; the
      // drawing and every derived table go away rather than showing stale wood.
      errSlot.innerHTML = `<div class="plan-error"><strong>That combination will not build.</strong><br>${esc(built.error)}</div>`;
      $('dwg-col').classList.add('hidden');
      $('result-block').classList.add('hidden');
      $('dwg-slot').innerHTML = '';
      $('dwg-print').innerHTML = '';
      lastBuilt = null;
      return;
    }
    errSlot.innerHTML = '';
    $('dwg-col').classList.remove('hidden');
    $('result-block').classList.remove('hidden');

    const mult = built.multiplier || 1;
    const parts = built.parts.map((p) => Object.assign({}, p, { qty: p.qty * mult }));
    const money = L.cost(parts, prefs.species, rate());
    const pack = Opt.optimize(parts, { kerf: prefs.kerf });

    // drawings
    $('dwg-slot').innerHTML = Dw.render(built, state.view, { width: 640, metric: prefs.metric, explode: state.view === 'iso' ? 0.22 : 0 });
    $('dwg-print').innerHTML = ['front', 'side', 'top', 'iso'].map((v) =>
      `<div class="sub-head">${v === 'iso' ? 'Exploded view' : Dw.VIEWS[v].label}</div>` +
      `<div class="dwg-frame">${Dw.render(built, v, { width: 640, metric: prefs.metric, explode: v === 'iso' ? 0.22 : 0 })}</div>`
    ).join('');

    // stats
    const names = built.dimLabels || ['X', 'Y', 'Z'];
    const dims = [built.actual.x, built.actual.y, built.actual.z];
    /* A plywood-only carcass has no board feet and no boards, so those tiles
       would read "0.0" and "0" as if something had gone wrong. Say what the
       build actually consumes instead. */
    const boards = pack.groups.reduce((s, g) => s + g.boardCount, 0);
    const sheetStr = money.sheets ? `${money.sheets} sheet${money.sheets > 1 ? 's' : ''}` : '';
    const tiles = [
      ['Finished size', dims.map((d) => L.len(d, prefs.metric)).join('  ×  ')],
      money.boardFeet > 0 ? ['Board feet', money.boardFeet.toFixed(1)] : ['Sheet goods', `${money.sheets} × 4' × 8'`],
      ['Lumber cost', '$' + money.total.toFixed(0)],
      ['To buy', boards ? `${boards} board${boards > 1 ? 's' : ''}${sheetStr ? ' + ' + sheetStr : ''}` : (sheetStr || '—')],
      ['Offcut waste', boards ? pack.wastePct.toFixed(0) + '%' : '—'],
      ['Pieces to cut', String(parts.reduce((s, p) => s + p.qty, 0))],
    ];
    $('stat-slot').innerHTML = tiles.map(([lab, val]) =>
      `<div class="stat-tile"><span class="stat-value">${esc(val)}</span><span class="stat-label">${esc(lab)}</span></div>`).join('');

    // warnings
    $('warn-slot').innerHTML = (built.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');

    // cut list
    $('cut-slot').innerHTML =
      `<thead><tr><th>Qty</th><th>Part</th><th>Stock</th><th>Thickness</th><th>Width</th><th>Length</th><th>Notes</th></tr></thead><tbody>` +
      parts.map((p) => `<tr>
        <td class="num">${p.qty}</td>
        <td>${esc(p.name)}</td>
        <td class="num">${esc(L.isSheet(p.stock) ? L.SHEET[p.stock].label : p.stock)}</td>
        <td class="num">${esc(L.len(p.thick, prefs.metric))}</td>
        <td class="num">${esc(L.len(p.width, prefs.metric))}</td>
        <td class="num">${esc(L.len(p.length, prefs.metric))}</td>
        <td class="note">${esc(p.note || '')}</td></tr>`).join('') + '</tbody>';

    // shopping list, with a bar per board showing where the cuts land
    const sheetLine = money.sheets
      ? `<p class="tool-note">${pack.groups.length ? 'Plus ' : ''}${money.sheets} sheet` +
        `${money.sheets > 1 ? 's' : ''} of plywood at 4' × 8', allowing for the offcuts you cannot use.</p>`
      : '';
    $('stock-slot').innerHTML = pack.groups.map((g) => {
      const bars = g.boards.map((b) => {
        const cells = b.pieces.map((pc) =>
          `<span class="stock-piece" style="width:${((pc.length / g.boardLen) * 100).toFixed(2)}%" title="${esc(pc.name)} — ${esc(L.len(pc.length, prefs.metric))}">${esc(L.toFraction(pc.length))}</span>`).join('');
        return `<div class="stock-board">${cells}<span class="stock-waste"></span></div>`;
      }).join('');
      const feet = g.boardLen / 12;
      return `<p class="tool-note"><strong>${g.boardCount} × ${esc(g.stock)}</strong> at ${feet} ft ` +
        `(${esc(L.len(g.boardLen, prefs.metric))}) &mdash; cut as below, ${esc(L.toFraction(prefs.kerf))}" kerf allowed per cut.</p>${bars}`;
    }).join('') + sheetLine +
      (pack.tooLong.length ? `<p class="tool-note">Some ${esc(pack.tooLong.join(', '))} pieces are longer than stock is sold; you will need to join them.</p>` : '');

    // saw settings, where a plan has any
    if (built.angles && built.angles.length) {
      $('angle-block').classList.remove('hidden');
      $('angle-slot').innerHTML = '<tbody>' + built.angles.map((a) =>
        `<tr><td>${esc(a.label)}</td><td class="num">${esc(a.value)}</td></tr>`).join('') + '</tbody>';
    } else {
      $('angle-block').classList.add('hidden');
    }

    // hardware + steps
    $('hw-slot').innerHTML = '<tbody>' + (built.hardware || []).map((h) =>
      `<tr><td>${esc(h.item)}</td><td class="num">${esc(h.qty)}</td></tr>`).join('') + '</tbody>';
    $('step-slot').innerHTML = (built.steps || []).map((s) => `<li>${esc(s)}</li>`).join('');

    lastBuilt = { plan, built, parts, pack, money };
  }

  let lastBuilt = null;

  function openPlan(id, rawParams, replace) {
    const plan = P.byId(id);
    if (!plan) { showGallery(); return; }
    state.planId = id;
    state.params = cleanParams(plan, rawParams);
    state.view = 'front';
    $('gallery-panel').classList.add('hidden');
    $('plan-panel').classList.remove('hidden');
    $('page-title').textContent = plan.title.toUpperCase();
    $('page-sub').textContent = plan.blurb;
    $('plan-chips').innerHTML = [
      ['', plan.difficulty], ['', plan.time], ['hot', P.CATEGORIES.find((c) => c.key === plan.category).label],
    ].map(([cls, t]) => `<span class="chip ${cls}">${esc(t)}</span>`).join('');
    $('plan-joinery').textContent = plan.joinery;
    document.querySelectorAll('#view-bar .hud-tab').forEach((b) =>
      b.classList.toggle('active', b.dataset.view === 'front'));
    renderControls(plan);
    paint(plan);
    writeHash(replace);
    window.scrollTo(0, 0);
  }

  function showGallery(replace) {
    state.planId = null;
    $('plan-panel').classList.add('hidden');
    $('gallery-panel').classList.remove('hidden');
    $('page-title').textContent = 'WOODWORKING PLANS';
    $('page-sub').textContent = 'Pick a build, set the dimensions you actually want, and get a dimensioned ' +
      'drawing, a cut list in real fractions, a board-by-board shopping list and steps you can print and take ' +
      'to the shop.';
    renderGallery();
    writeHash(replace);
  }

  /* ---- exports --------------------------------------------------------- */
  function download(name, mime, text) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  const csvCell = (v) => `"${String(v).replace(/"/g, '""')}"`;

  function exportCsv() {
    if (!lastBuilt) return;
    const rows = [['Qty', 'Part', 'Stock', 'Thickness', 'Width', 'Length', 'Notes']];
    for (const p of lastBuilt.parts) {
      rows.push([p.qty, p.name, L.isSheet(p.stock) ? L.SHEET[p.stock].label : p.stock,
        L.toFraction(p.thick), L.toFraction(p.width), L.toFraction(p.length), p.note || '']);
    }
    rows.push([]);
    for (const g of lastBuilt.pack.groups) rows.push([g.boardCount, `${g.stock} @ ${g.boardLen / 12} ft`]);
    download(`${lastBuilt.plan.id}-cut-list.csv`, 'text/csv;charset=utf-8',
      rows.map((r) => r.map(csvCell).join(',')).join('\r\n'));
  }

  /* A downloaded SVG has no stylesheet behind it, so the classes the renderer
     emits have to travel with it. Ship it in ink-on-paper colours — the thing
     people do with a downloaded drawing is print it. */
  const SVG_STYLE = `
    text { font-family: monospace; }
    .dwg-part { fill: none; stroke: #000; stroke-width: var(--dwg-stroke, .02); stroke-linejoin: round; }
    .dwg-iso { stroke: #000; stroke-width: var(--dwg-stroke, .02); stroke-linejoin: round; }
    .dwg-iso-a { fill: #d8d8d8; } .dwg-iso-b { fill: #ececec; } .dwg-iso-c { fill: #fafafa; }
    .dwg-dim, .dwg-wit, .dwg-centre { stroke: #000; fill: none; stroke-width: var(--dwg-stroke, .02); }
    .dwg-wit { opacity: .6; }
    .dwg-arrow { fill: #000; } .dwg-text { fill: #000; } .dwg-view-label { fill: #555; }
    .dwg-hole { fill: #fff; stroke: #000; stroke-width: var(--dwg-stroke, .02); }
    .dwg-label-bg { fill: #fff; }`;

  function exportSvg() {
    if (!lastBuilt) return;
    let svg = Dw.render(lastBuilt.built, state.view,
      { width: 900, metric: prefs.metric, explode: state.view === 'iso' ? 0.22 : 0 });
    svg = svg.replace('>', ' xmlns="http://www.w3.org/2000/svg">')
      .replace(/>/, `><style>${SVG_STYLE}</style>`);
    download(`${lastBuilt.plan.id}-${state.view}.svg`, 'image/svg+xml', svg);
  }

  /* ---- wiring ---------------------------------------------------------- */
  document.addEventListener('click', (ev) => {
    const open = ev.target.closest('[data-open]');
    if (open) { ev.preventDefault(); openPlan(open.dataset.open, null, false); return; }
    const cat = ev.target.closest('[data-cat]');
    if (cat) { state.category = cat.dataset.cat; renderGallery(); return; }
    const view = ev.target.closest('#view-bar .hud-tab');
    if (view) {
      state.view = view.dataset.view;
      document.querySelectorAll('#view-bar .hud-tab').forEach((b) => b.classList.toggle('active', b === view));
      if (state.planId) paint(P.byId(state.planId));
    }
  });

  $('back-btn').addEventListener('click', () => showGallery(false));
  $('sample-btn').addEventListener('click', () => openPlan('planter-box', null, false));
  $('print-btn').addEventListener('click', () => window.print());
  $('csv-btn').addEventListener('click', exportCsv);
  $('svg-btn').addEventListener('click', exportSvg);
  $('link-btn').addEventListener('click', () => {
    const url = location.href;
    const toast = $('copy-toast');
    const flash = () => { toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 1600); };
    if (navigator.clipboard) navigator.clipboard.writeText(url).then(flash, flash);
    else flash();
  });

  $('ctrl-slot').addEventListener('input', (ev) => {
    const el = ev.target;
    const key = el.dataset.key;
    if (!key || !state.planId) return;
    const plan = P.byId(state.planId);
    const q = plan.params.find((x) => x.key === key);
    state.params[key] = el.type === 'checkbox' ? el.checked : coerce(q, el.value);
    const out = $('v-' + key);
    if (out) out.textContent = labelFor(q, state.params[key]);
    schedule(plan);
    writeHash(true);
  });

  $('shop-slot').addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.id === 'sp-sel') { prefs.species = el.value; prefs.bf = null; prefs.sheet = null; }
    else if (el.id === 'bf-in') prefs.bf = Math.max(0, Number(el.value) || 0);
    else if (el.id === 'kerf-sel') prefs.kerf = Number(el.value);
    else if (el.id === 'metric-in') prefs.metric = el.checked;
    savePrefs();
    if (!state.planId) return;
    const plan = P.byId(state.planId);
    if (el.id === 'sp-sel' || el.id === 'metric-in') renderControls(plan);
    paint(plan);
  });

  window.addEventListener('popstate', route);
  window.addEventListener('hashchange', route);
  function route() {
    const { id, params } = readHash();
    if (id && P.byId(id)) {
      if (id !== state.planId || Object.keys(params).length) openPlan(id, params, true);
    } else if (state.planId !== null || !document.body.dataset.booted) {
      showGallery(true);
    }
    document.body.dataset.booted = '1';
  }

  route();

  /* Handy for the screenshot tooling and for anyone poking at the console. */
  window.__wood = {
    state, prefs,
    open: (id, params) => openPlan(id, params, true),
    build: () => (state.planId ? P.byId(state.planId).build(state.params) : null),
    check: () => (state.planId ? G.checkAssembly(P.byId(state.planId).build(state.params)) : null),
  };
})();
