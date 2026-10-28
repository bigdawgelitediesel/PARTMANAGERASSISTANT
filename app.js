/* Parts Manager Assistant: jobs, quotes, received lists, click-to-install. */
(function () {
  'use strict';

  const KEY = 'pma.v1';
  const STATUSES = ['needed', 'ordered', 'received', 'installed'];
  const ALL_STATUSES = ['needed', 'ordered', 'received', 'installed', 'superseded'];
  const LABEL = { needed: 'needed', ordered: 'ordered', received: 'IN', installed: 'installed', superseded: 'superseded' };

  // ---------- store ----------
  function load() {
    let data = null;
    try { data = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { data = null; }
    if (!data || !Array.isArray(data.jobs)) {
      data = JSON.parse(JSON.stringify(window.SEED || { version: 1, jobs: [] }));
      data.seeded = Object.fromEntries((data.jobs || []).map(j => [j.id, true]));
    } else if (window.SEED) {
      // The repo's seed.js is the master list. Merge it in without losing local checkmarks.
      data.seeded = data.seeded || {};
      for (const sj of window.SEED.jobs) {
        const local = data.jobs.find(j => j.id === sj.id);
        if (!local) { data.jobs.push(JSON.parse(JSON.stringify(sj))); data.seeded[sj.id] = true; continue; }
        if (local.seedRev === sj.seedRev) continue;
        // job header from seed, but keep local notes if the user edited them
        for (const k of ['jobNumber', 'name', 'customer', 'unit', 'engine', 'ro', 'vin']) if (sj[k] != null) local[k] = sj[k];
        if (!local.notesEdited && sj.notes != null) local.notes = sj.notes;
        local.log = local.log || [];
        for (const e of (sj.log || [])) if (!local.log.some(x => x.date === e.date && x.text === e.text)) local.log.push(JSON.parse(JSON.stringify(e)));
        local.quotes = local.quotes || [];
        for (const q of (sj.quotes || [])) if (!local.quotes.some(x => x.id === q.id)) local.quotes.push(JSON.parse(JSON.stringify(q)));
        local.parts = local.parts || [];
        for (const sp of (sj.parts || [])) {
          const lp = local.parts.find(p => (sp.id && p.id === sp.id) || (p.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, '') === (sp.pn || '').toUpperCase().replace(/[^A-Z0-9]/g, ''));
          if (!lp) { local.parts.push(JSON.parse(JSON.stringify(sp))); continue; }
          // refresh everything except the user's progress fields
          for (const k of Object.keys(sp)) if (!['status', 'installedAt', 'receivedAt', 'receivedQty', 'prevStatus', 'id'].includes(k)) lp[k] = sp[k];
          if (sp.status === 'superseded') lp.status = 'superseded';
        }
        local.seedRev = sj.seedRev;
      }
    }
    for (const j of data.jobs) normalizeJob(j);
    return data;
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(DB)); } catch (e) { toast('Could not save (storage blocked?)'); }
  }
  function normalizeJob(j) {
    j.quotes = j.quotes || [];
    j.parts = j.parts || [];
    j.parts.forEach((p, i) => {
      if (!p.id) p.id = 'p' + Date.now().toString(36) + i.toString(36) + Math.random().toString(36).slice(2, 6);
      if (!p.status) p.status = 'needed';
      if (p.qty == null) p.qty = 1;
      if (p.unit === '' || p.unit === undefined) p.unit = null;
    });
  }
  let DB = load();

  // ---------- helpers ----------
  const $ = (s, el = document) => el.querySelector(s);
  const norm = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const money = n => (n == null || isNaN(n)) ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const ext = p => (p.unit == null ? null : Number(p.unit) * Number(p.qty || 0));
  const lineTotal = p => { const e = ext(p); return e == null ? null : e + Number(p.promo || 0); };
  const today = () => new Date().toISOString().slice(0, 10);

  function toast(msg) {
    let t = $('#toast');
    if (!t) { t = document.createElement('div'); t.id = 'toast'; t.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:var(--ink);color:var(--bg);padding:10px 16px;border-radius:10px;z-index:50;font-size:14px;box-shadow:0 6px 20px rgba(0,0,0,.25)'; document.body.appendChild(t); }
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._h); t._h = setTimeout(() => t.style.display = 'none', 2200);
  }

  function jobById(id) { return DB.jobs.find(j => j.id === id); }

  function summarize(job) {
    const s = { count: 0, needed: 0, ordered: 0, received: 0, installed: 0, superseded: 0, gap: 0,
      quoted$: 0, needed$: 0, received$: 0, installed$: 0, unpriced: 0 };
    for (const p of job.parts) {
      s.count++;
      s[p.status] = (s[p.status] || 0) + 1;
      if (p.source === 'gap') s.gap++;
      const t = lineTotal(p);
      if (p.source === 'quote' && p.status !== 'superseded' && t != null) s.quoted$ += t;
      if (t == null && p.status !== 'superseded' && p.source !== 'received') s.unpriced++;
      if ((p.status === 'needed' || p.status === 'ordered') && t != null) s.needed$ += t;
      if ((p.status === 'received' || p.status === 'installed') && t != null) s.received$ += t;
      if (p.status === 'installed' && t != null) s.installed$ += t;
    }
    const active = s.count - s.superseded;
    s.pct = active ? Math.round(100 * (s.received + s.installed) / active) : 0;
    return s;
  }

  // ---------- router ----------
  function route() {
    const h = location.hash || '#/';
    const m = h.match(/^#\/job\/([^/]+)/);
    renderTabs(m ? decodeURIComponent(m[1]) : null);
    if (m) renderJob(decodeURIComponent(m[1]));
    else renderHome();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ---------- tabs ----------
  function renderTabs(activeId) {
    const t = $('#tabs');
    t.innerHTML = DB.jobs.map(j => {
      const s = summarize(j);
      return `<a class="tab ${j.id === activeId ? 'active' : ''}" href="#/job/${encodeURIComponent(j.id)}">${esc(j.jobNumber || j.name)}<small>${s.pct}%</small></a>`;
    }).join('') + `<a class="tab" href="#/" id="tab-new" style="border-style:dashed">+ Job</a>`;
    $('#tab-new').addEventListener('click', e => { e.preventDefault(); openJobForm(); });
  }

  // ---------- home ----------
  function renderHome() {
    const v = $('#view');
    v.innerHTML = `
      <div class="row"><div><h1>Jobs</h1><p class="sub">Pick a job, or start a new one and paste its quotes in.</p></div><div class="spacer"></div>
      <button class="btn primary" id="new-job">New job</button></div>
      <div class="cards">
        ${DB.jobs.map(j => { const s = summarize(j); return `
          <a class="card" href="#/job/${encodeURIComponent(j.id)}">
            <div class="num">${esc(j.jobNumber || '')}</div>
            <div class="name">${esc(j.name)}</div>
            <div class="meta">${esc(j.customer || '')}${j.engine ? ' · ' + esc(j.engine) : ''}</div>
            <div class="meta">${s.received + s.installed} of ${s.count - s.superseded} in · ${s.needed + s.ordered} not in yet · ${money(s.needed$)} open</div>
            <div class="bar"><i style="width:${s.pct}%"></i></div>
          </a>`; }).join('')}
        <div class="card new" id="new-job-card">+ New job</div>
      </div>`;
    $('#new-job').onclick = openJobForm;
    $('#new-job-card').onclick = openJobForm;
  }

  // ---------- job view ----------
  const viewState = { filter: 'all', q: '' };

  function renderJob(id) {
    const job = jobById(id);
    const v = $('#view');
    if (!job) { v.innerHTML = `<div class="empty">Job not found. <a href="#/">Back to jobs</a></div>`; return; }
    const s = summarize(job);
    v.innerHTML = `
      <div class="row">
        <div>
          <h1>${esc(job.jobNumber ? job.jobNumber + ' · ' : '')}${esc(job.name)}</h1>
          <p class="sub">${esc(job.customer || '')}${job.engine ? ' · ' + esc(job.engine) : ''}${job.ro ? ' · Fullbay RO ' + esc(job.ro) : ''}</p>
        </div>
        <div class="spacer"></div>
        <button class="btn" id="b-quote">+ Add quote</button>
        <button class="btn" id="b-received">+ Add received list</button>
        <button class="btn" id="b-part">+ Add part</button>
        <button class="btn ghost" id="b-edit">Edit job</button>
        <button class="btn ghost" id="b-print" title="Print the current list">Print</button>
      </div>

      <div class="stats">
        <div class="stat"><b>${s.count - s.superseded}</b><span>Parts on job</span></div>
        <div class="stat needed"><b>${s.needed}</b><span>Needed</span></div>
        <div class="stat ordered"><b>${s.ordered}</b><span>Ordered</span></div>
        <div class="stat received"><b>${s.received}</b><span>In, not installed</span></div>
        <div class="stat installed"><b>${s.installed}</b><span>Installed</span></div>
        <div class="stat"><b>${money(s.quoted$)}</b><span>Quoted (active lines)</span></div>
        <div class="stat needed"><b>${money(s.needed$)}</b><span>Still to buy</span></div>
        <div class="stat received"><b>${money(s.received$)}</b><span>In hand (incl. installed)</span></div>
      </div>

      ${job.notes ? `<div class="section"><h3>Job notes</h3><div>${esc(job.notes)}</div></div>` : ''}
      ${(job.log && job.log.length) ? `<div class="section"><h3>Updates</h3><ul class="log">${job.log.slice().sort((a, b) => (b.date || '').localeCompare(a.date || '')).map(e => `<li><b>${esc(e.date || '')}</b> ${esc(e.text)}</li>`).join('')}</ul></div>` : ''}

      <div class="section"><h3>Quotes and lists on this job</h3>
        ${job.quotes.length ? `<ul class="quotes">${job.quotes.map(q => `<li><b>${esc(q.vendor)}</b> ${esc(q.number || '')} <span class="muted">${esc(q.date || '')}${q.note ? ' · ' + esc(q.note) : ''}</span></li>`).join('')}</ul>` : '<span class="muted">None yet. Use “Add quote”.</span>'}
      </div>

      <div class="row">
        <div class="filters" id="filters">
          ${[['all', 'All'], ['open', 'Not in yet'], ['needed', 'Needed'], ['ordered', 'Ordered'], ['received', 'In'], ['installed', 'Installed'], ['gap', 'Gap (never quoted)'], ['extra', 'Received extras'], ['superseded', 'Superseded']]
            .map(([k, l]) => `<button class="chip ${viewState.filter === k ? 'active' : ''}" data-f="${k}">${l}</button>`).join('')}
        </div>
        <input class="search" id="search" placeholder="Search part # or description" value="${esc(viewState.q)}">
      </div>

      <div class="tablewrap">
        <table>
          <thead><tr>
            <th>Part #</th><th>Description</th><th class="num">Qty</th><th class="num hide-sm">Each</th><th class="num">Ext</th><th class="hide-sm">Core</th><th>Status</th><th title="In">IN</th>
          </tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </div>
      <p class="muted" style="font-size:12.5px;margin-top:8px">Click a part number or description to edit the line. Tick the IN box when the part shows up. Click the status pill to move it along (needed → ordered → IN → installed). Ext = each × qty, with any promo credit applied. Cores are shown separately and are refundable when the old part goes back.</p>
    `;
    $('#b-quote').onclick = () => openPasteForm(job, 'quote');
    $('#b-received').onclick = () => openPasteForm(job, 'received');
    $('#b-part').onclick = () => openPartForm(job, null);
    $('#b-edit').onclick = () => openJobForm(job);
    $('#b-print').onclick = () => window.print();
    $('#filters').onclick = e => { const b = e.target.closest('.chip'); if (!b) return; viewState.filter = b.dataset.f; renderJob(id); };
    $('#search').oninput = e => { viewState.q = e.target.value; renderRows(job); };
    renderRows(job);
  }

  function filtered(job) {
    const q = norm(viewState.q);
    const f = viewState.filter;
    return job.parts.filter(p => {
      if (f === 'open' && !(p.status === 'needed' || p.status === 'ordered')) return false;
      if (f === 'gap' && p.source !== 'gap') return false;
      if (f === 'extra' && !(p.source === 'received' && !p.covers)) return false;
      if (STATUSES.concat('superseded').includes(f) && p.status !== f) return false;
      if (q && !(norm(p.pn).includes(q) || norm(p.desc).includes(q) || norm(p.note).includes(q) || norm(p.covers).includes(q) || norm(p.coveredBy).includes(q))) return false;
      return true;
    });
  }

  function renderRows(job) {
    const rows = filtered(job);
    const tb = $('#rows');
    if (!rows.length) { tb.innerHTML = `<tr><td colspan="8" class="empty">Nothing matches.</td></tr>`; return; }
    tb.innerHTML = rows.map(p => {
      const e = lineTotal(p);
      const srcTag = p.source === 'gap' ? `<span class="pill gap" style="cursor:default">gap</span>` : p.source === 'received' && !p.covers ? `<span class="src">received extra</span>` : '';
      const rel = p.covers ? `<span class="note">Covers quoted ${esc(p.covers)}</span>` : p.coveredBy ? `<span class="note">Replaced by ${esc(p.coveredBy)}</span>` : '';
      return `<tr class="part ${p.status}" data-id="${p.id}">
        <td class="pn">${esc(p.pn)}</td>
        <td class="desc">${esc(p.desc)} ${srcTag}${rel}${p.note ? `<span class="note">${esc(p.note)}</span>` : ''}</td>
        <td class="num">${esc(p.qty)}</td>
        <td class="num hide-sm">${money(p.unit)}${p.promo ? `<span class="note">promo ${money(p.promo)}</span>` : ''}</td>
        <td class="num">${money(e)}</td>
        <td class="hide-sm muted">${p.core ? money(p.core) + ' ea' : ''}</td>
        <td><button class="pill ${p.status}" data-act="cycle" title="Click to move to the next status">${LABEL[p.status] || p.status}</button></td>
        <td><span class="check ${(p.status === 'received' || p.status === 'installed') ? 'on' : ''}" data-act="in" title="Tick when the part is IN">${(p.status === 'received' || p.status === 'installed') ? '✓' : ''}</span></td>
      </tr>`;
    }).join('');
    tb.onclick = e => {
      const tr = e.target.closest('tr.part'); if (!tr) return;
      const p = job.parts.find(x => x.id === tr.dataset.id); if (!p) return;
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'cycle') {
        if (p.status === 'superseded') { p.status = 'needed'; }
        else { const i = STATUSES.indexOf(p.status); p.status = STATUSES[(i + 1) % STATUSES.length]; }
        if (p.status === 'installed') p.installedAt = today(); else delete p.installedAt;
        save(); renderJob(job.id); return;
      }
      if (act === 'in') {
        if (p.status === 'received' || p.status === 'installed') { p.status = 'needed'; delete p.receivedAt; delete p.installedAt; }
        else { p.status = 'received'; p.receivedAt = today(); }
        save(); renderJob(job.id); return;
      }
      openPartForm(job, p);
    };
  }

  // ---------- modals ----------
  function modal(html) {
    const root = $('#modal-root');
    root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
    const bg = root.firstElementChild;
    bg.addEventListener('click', e => { if (e.target === bg) closeModal(); });
    document.addEventListener('keydown', escClose);
    return bg.firstElementChild;
  }
  function escClose(e) { if (e.key === 'Escape') closeModal(); }
  function closeModal() { $('#modal-root').innerHTML = ''; document.removeEventListener('keydown', escClose); }

  function openJobForm(job) {
    const isNew = !job;
    const j = job || { jobNumber: '', name: '', customer: '', unit: '', engine: '', ro: '', notes: '' };
    const m = modal(`
      <h2>${isNew ? 'New job' : 'Edit job'}</h2>
      <p class="hint">The job number is what shows on the tab.</p>
      <div class="form">
        <div class="three">
          <label>Job number <input id="f-num" value="${esc(j.jobNumber)}" placeholder="6657"></label>
          <label>Fullbay RO <input id="f-ro" value="${esc(j.ro)}" placeholder="25166952"></label>
          <label>Engine <input id="f-eng" value="${esc(j.engine)}" placeholder="CAT C18"></label>
        </div>
        <div class="two">
          <label>Job name <input id="f-name" value="${esc(j.name)}" placeholder="CAT C18 swap"></label>
          <label>Customer <input id="f-cust" value="${esc(j.customer)}" placeholder="Simper Trucking"></label>
        </div>
        <label>Unit <input id="f-unit" value="${esc(j.unit)}" placeholder="2007 Peterbilt 379, VIN…"></label>
        <label>Notes <textarea id="f-notes" style="min-height:80px;font-family:inherit">${esc(j.notes)}</textarea></label>
      </div>
      <div class="actions">
        ${isNew ? '' : '<button class="btn danger" id="f-del">Delete job</button>'}
        <span class="spacer"></span>
        <button class="btn" id="f-cancel">Cancel</button>
        <button class="btn primary" id="f-save">${isNew ? 'Create job' : 'Save'}</button>
      </div>`);
    $('#f-cancel', m).onclick = closeModal;
    $('#f-save', m).onclick = () => {
      const num = $('#f-num', m).value.trim(), name = $('#f-name', m).value.trim();
      if (!num && !name) { toast('Give it a job number or a name'); return; }
      if (isNew) {
        let id = norm(num || name).toLowerCase() || uid();
        while (jobById(id)) id += '-' + Math.random().toString(36).slice(2, 5);
        const nj = { id, jobNumber: num, name: name || num, customer: $('#f-cust', m).value.trim(), unit: $('#f-unit', m).value.trim(), engine: $('#f-eng', m).value.trim(), ro: $('#f-ro', m).value.trim(), notes: $('#f-notes', m).value.trim(), created: today(), quotes: [], parts: [] };
        DB.jobs.push(nj); save(); closeModal(); location.hash = '#/job/' + encodeURIComponent(id);
      } else {
        const newNotes = $('#f-notes', m).value.trim(); if (newNotes !== (job.notes || '')) job.notesEdited = true;
        Object.assign(job, { jobNumber: num, name: name || num, customer: $('#f-cust', m).value.trim(), unit: $('#f-unit', m).value.trim(), engine: $('#f-eng', m).value.trim(), ro: $('#f-ro', m).value.trim(), notes: newNotes });
        save(); closeModal(); route();
      }
    };
    if (!isNew) $('#f-del', m).onclick = () => {
      if (!confirm(`Delete job ${job.jobNumber || job.name} and all its parts? This cannot be undone.`)) return;
      DB.jobs = DB.jobs.filter(x => x.id !== job.id); save(); closeModal(); location.hash = '#/';
    };
    $('#f-num', m).focus();
  }

  function openPartForm(job, part) {
    const isNew = !part;
    const p = part || { pn: '', desc: '', qty: 1, unit: null, core: null, promo: null, status: 'needed', source: 'manual', covers: '', coveredBy: '', note: '' };
    const quotedPns = job.parts.filter(x => x.source === 'quote').map(x => x.pn);
    const m = modal(`
      <h2>${isNew ? 'Add part' : esc(p.pn)}</h2>
      <p class="hint">${isNew ? 'One line. For a whole quote use “Add quote”.' : 'Edit the line, or change its status.'}</p>
      <div class="form">
        <div class="three">
          <label>Part # <input id="p-pn" value="${esc(p.pn)}"></label>
          <label>Qty <input id="p-qty" type="number" step="1" min="0" value="${esc(p.qty)}"></label>
          <label>Status <select id="p-status">${ALL_STATUSES.map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${LABEL[s]}</option>`).join('')}</select></label>
        </div>
        <label>Description <input id="p-desc" value="${esc(p.desc)}"></label>
        <div class="three">
          <label>Price each <input id="p-unit" type="number" step="0.01" value="${p.unit == null ? '' : p.unit}"></label>
          <label>Core each (refundable) <input id="p-core" type="number" step="0.01" value="${p.core == null ? '' : p.core}"></label>
          <label>Promo / credit on line <input id="p-promo" type="number" step="0.01" value="${p.promo == null ? '' : p.promo}" placeholder="-250"></label>
        </div>
        <div class="two">
          <label>Source <select id="p-src">${['quote', 'received', 'gap', 'manual'].map(s => `<option value="${s}" ${p.source === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <label>This part covers / supersedes quoted part # <input id="p-covers" list="pn-list" value="${esc(p.covers || '')}" placeholder="e.g. 20R0630"><datalist id="pn-list">${quotedPns.map(x => `<option value="${esc(x)}">`).join('')}</datalist></label>
        </div>
        <label>Note <textarea id="p-note" style="min-height:70px;font-family:inherit">${esc(p.note || '')}</textarea></label>
      </div>
      <div class="actions">
        ${isNew ? '' : '<button class="btn danger" id="p-del">Delete line</button>'}
        <span class="spacer"></span>
        <button class="btn" id="p-cancel">Cancel</button>
        <button class="btn primary" id="p-save">${isNew ? 'Add' : 'Save'}</button>
      </div>`);
    $('#p-cancel', m).onclick = closeModal;
    $('#p-save', m).onclick = () => {
      const pn = $('#p-pn', m).value.trim(); if (!pn) { toast('Part number is required'); return; }
      const numOrNull = id => { const v = $(id, m).value.trim(); return v === '' ? null : Number(v); };
      const prevCovers = p.covers;
      Object.assign(p, { pn, desc: $('#p-desc', m).value.trim(), qty: Number($('#p-qty', m).value) || 0, unit: numOrNull('#p-unit'), core: numOrNull('#p-core'), promo: numOrNull('#p-promo'), status: $('#p-status', m).value, source: $('#p-src', m).value, covers: $('#p-covers', m).value.trim(), note: $('#p-note', m).value.trim() });
      if (p.status === 'installed' && !p.installedAt) p.installedAt = today();
      if (isNew) { p.id = uid(); job.parts.push(p); }
      applyCovers(job, p, prevCovers);
      save(); closeModal(); renderJob(job.id);
    };
    if (!isNew) $('#p-del', m).onclick = () => {
      if (!confirm(`Delete ${p.pn} from this job?`)) return;
      job.parts = job.parts.filter(x => x.id !== p.id);
      // un-supersede anything this line was covering
      if (p.covers) for (const t of job.parts) if (t.coveredBy && norm(t.coveredBy).includes(norm(p.pn))) { delete t.coveredBy; if (t.status === 'superseded') t.status = 'needed'; }
      save(); closeModal(); renderJob(job.id);
    };
    $('#p-' + (isNew ? 'pn' : 'desc'), m).focus();
  }

  // When a received/manual line says it covers a quoted PN, mark that quoted line superseded.
  function applyCovers(job, p, prevCovers) {
    if (prevCovers && prevCovers !== p.covers) {
      for (const t of job.parts) if (norm(t.pn) === norm(prevCovers) && t.coveredBy && norm(t.coveredBy).includes(norm(p.pn))) { delete t.coveredBy; if (t.status === 'superseded') t.status = 'needed'; }
    }
    if (p.covers) {
      for (const t of job.parts) if (t !== p && norm(t.pn) === norm(p.covers)) {
        t.coveredBy = t.coveredBy && !norm(t.coveredBy).includes(norm(p.pn)) ? t.coveredBy + ' / ' + p.pn : (t.coveredBy || p.pn);
        t.status = 'superseded';
      }
    }
  }

  // ---------- paste parsers ----------
  // Returns [{pn, desc, qty, unit, core, promo}]
  function parsePaste(text, mode) {
    const out = [];
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    // CSV/TSV with header
    const first = lines[0] || '';
    const delim = first.includes('\t') ? '\t' : (first.split(',').length >= 3 ? ',' : null);
    if (delim && /part|pn|desc|qty/i.test(first)) {
      const hdr = first.split(delim).map(h => norm(h));
      const col = names => hdr.findIndex(h => names.some(n => h.includes(n)));
      const cPn = col(['PARTNUMBER', 'PART', 'PN']), cDesc = col(['DESC']), cQty = col(['QTY', 'QUANT']), cPrice = col(['NET', 'PRICE', 'EACH', 'UNIT', 'COST']), cCore = col(['CORE']);
      for (const l of lines.slice(1)) {
        const c = l.split(delim).map(x => x.trim().replace(/^"|"$/g, ''));
        if (!c[cPn]) continue;
        out.push({ pn: c[cPn], desc: cDesc >= 0 ? c[cDesc] : '', qty: cQty >= 0 ? Number(c[cQty]) || 1 : 1, unit: cPrice >= 0 && c[cPrice] !== '' ? Number(String(c[cPrice]).replace(/[$,]/g, '')) : null, core: cCore >= 0 && c[cCore] ? Number(String(c[cCore]).replace(/[$,]/g, '')) : null });
      }
      return out;
    }
    // Loose text. Handles Peterbilt/CDK quote prints and Fullbay parts lists.
    let last = null;
    for (const raw of lines) {
      const l = raw.replace(/\s+/g, ' ');
      // CDK quote continuation lines
      let m;
      if ((m = l.match(/^CORE EXCHANGE\s+([\d,]+\.\d{2})/i)) && last) { last.core = Number(m[1].replace(/,/g, '')); continue; }
      if ((m = l.match(/PROMO(?:TIONAL)?(?: ITEM)?\s+(-?[\d,]+\.\d{2})/i)) && last) { last.promo = Number(m[1].replace(/,/g, '')); continue; }
      if (/^CORE RETURN/i.test(l) || /^Part number\s+Replaced/i.test(l)) continue;
      if ((m = l.match(/^Part number Replaced By:\s*(\S+)/i)) && last) { last.desc += ' (replaced by ' + m[1] + ')'; continue; }
      if (/^(parts list|customer|chassis|engine|vin|purchase order|part #|total|sales tax|freight|sublet)/i.test(l)) continue;
      // Description-only continuation (CDK prints the description under the numbers line)
      if (last && !/\d/.test(l.split(' ')[0]) && !/\d+\.\d{2}/.test(l) && l.length < 40 && !last._descDone) { last.desc = (last.desc ? last.desc + ' ' : '') + l; last._descDone = true; continue; }
      const tok = l.split(' ');
      // CDK: "1 1 0 10R7155 SP 1798.50 1,798.50" -> qty qty bo PN code net amount
      if ((m = l.match(/^(-?\d+)\s+(-?\d+)\s+(\d+)\s+([A-Z0-9][A-Z0-9\-\/\.]+)\s+(.*?)\s*(-?[\d,]+\.\d{2})\s+(-?[\d,]+\.\d{2})$/i))) {
        const qty = Number(m[1]); if (qty < 0) continue; // core return lines
        last = { pn: m[4], desc: '', qty, unit: Number(m[6].replace(/,/g, '')), core: null, promo: null, _descDone: false };
        const mid = m[5].replace(/^(SP|A\d{2}|V\d{2}[A-Z]?)\b\s*/i, '').trim(); if (mid) { last.desc = mid; }
        out.push(last); continue;
      }
      // Generic: PN first, then description words, then numbers. Fullbay: "1550809 SEAL-LINER 6.00000 NON-INVENTORY 0.00000"
      const pn = tok[0];
      if (!/[0-9]/.test(pn) || pn.length < 3) continue;
      const nums = []; const words = [];
      for (const t of tok.slice(1)) { if (/^-?[\d,]*\.?\d+$/.test(t) && !/^[A-Z]/i.test(t)) nums.push(Number(t.replace(/,/g, ''))); else words.push(t); }
      let qty = 1, unit = null;
      if (mode === 'received') { qty = nums.length ? nums[0] : 1; }
      else {
        if (nums.length >= 2) { qty = Number.isInteger(nums[0]) || /\.0+$/.test(String(nums[0])) ? nums[0] : 1; unit = nums[nums.length - 2] * qty === nums[nums.length - 1] ? nums[nums.length - 2] : nums[nums.length - 1]; if (nums.length >= 3 && Math.abs(nums[nums.length - 2] * qty - nums[nums.length - 1]) < 0.01) unit = nums[nums.length - 2]; }
        else if (nums.length === 1) { if (Number.isInteger(nums[0]) && nums[0] < 200) qty = nums[0]; else unit = nums[0]; }
      }
      last = { pn, desc: words.filter(w => !/^(NON-INVENTORY|B\d{1,3}|SP)$/i.test(w)).join(' '), qty: qty || 1, unit, core: null, promo: null, _descDone: true };
      // Fullbay lines that are not parts (freight etc.) still come through; user can delete in preview
      out.push(last);
    }
    out.forEach(o => delete o._descDone);
    return out;
  }

  function openPasteForm(job, mode) {
    const isQuote = mode === 'quote';
    const m = modal(`
      <h2>${isQuote ? 'Add a vendor quote' : 'Add a received-parts list'}</h2>
      <p class="hint">${isQuote
        ? 'Paste the quote text (select all on the PDF and copy), or a CSV/TSV with columns part, description, qty, price. Preview and fix anything before adding.'
        : 'Paste the Fullbay parts list text. Part numbers that match a quoted line will be marked Received. New numbers are added as received extras; open each one afterward to say which quoted part it covers.'}</p>
      <div class="form">
        <div class="three">
          <label>${isQuote ? 'Vendor' : 'Source'} <input id="q-vendor" value="${isQuote ? '' : 'Fullbay received list'}" placeholder="${isQuote ? 'Jackson Group Peterbilt' : ''}"></label>
          <label>${isQuote ? 'Quote #' : 'RO / list #'} <input id="q-num" placeholder="${isQuote ? 'Q38373' : job.ro || ''}"></label>
          <label>Date <input id="q-date" type="date" value="${today()}"></label>
        </div>
        <label>Paste here <textarea id="q-text" placeholder="${isQuote ? '10R7155  CAMSHAFT  1  1798.50' : '1550809  SEAL-LINER  6.00000  NON-INVENTORY  0.00000'}"></textarea></label>
        <div class="row"><button class="btn" id="q-preview">Preview lines</button><span class="muted" id="q-count"></span></div>
        <div id="q-prev"></div>
      </div>
      <div class="actions">
        <button class="btn" id="q-cancel">Cancel</button>
        <button class="btn primary" id="q-add" disabled>Add to job</button>
      </div>`);
    let parsed = [];
    const renderPrev = () => {
      const pv = $('#q-prev', m);
      if (!parsed.length) { pv.innerHTML = ''; $('#q-count', m).textContent = 'No lines found.'; $('#q-add', m).disabled = true; return; }
      $('#q-count', m).textContent = parsed.length + ' lines';
      pv.innerHTML = `<div class="preview"><table><thead><tr><th>Part #</th><th>Description</th><th>Qty</th>${isQuote ? '<th>Each</th><th>Core</th><th>Promo</th>' : '<th>Matches</th>'}<th></th></tr></thead><tbody>
        ${parsed.map((r, i) => {
          const match = job.parts.find(p => norm(p.pn) === norm(r.pn));
          return `<tr data-i="${i}">
            <td><input data-k="pn" value="${esc(r.pn)}"></td>
            <td><input data-k="desc" value="${esc(r.desc)}"></td>
            <td style="width:70px"><input data-k="qty" type="number" value="${esc(r.qty)}"></td>
            ${isQuote
              ? `<td style="width:90px"><input data-k="unit" type="number" step="0.01" value="${r.unit == null ? '' : r.unit}"></td><td style="width:90px"><input data-k="core" type="number" step="0.01" value="${r.core == null ? '' : r.core}"></td><td style="width:80px"><input data-k="promo" type="number" step="0.01" value="${r.promo == null ? '' : r.promo}"></td>`
              : `<td class="muted">${match ? 'quoted ' + esc(match.pn) + (match.unit != null ? ' · ' + money(match.unit) : '') : 'new, extra'}</td>`}
            <td><button class="btn small" data-del="${i}">×</button></td>
          </tr>`; }).join('')}
      </tbody></table></div>`;
      $('#q-add', m).disabled = false;
      pv.oninput = e => { const tr = e.target.closest('tr'); const k = e.target.dataset.k; if (!tr || !k) return; const r = parsed[+tr.dataset.i]; const v = e.target.value; r[k] = (k === 'qty' || k === 'unit' || k === 'core' || k === 'promo') ? (v === '' ? null : Number(v)) : v; };
      pv.onclick = e => { const b = e.target.closest('[data-del]'); if (!b) return; parsed.splice(+b.dataset.del, 1); renderPrev(); };
    };
    $('#q-preview', m).onclick = () => { parsed = parsePaste($('#q-text', m).value, mode); renderPrev(); };
    $('#q-cancel', m).onclick = closeModal;
    $('#q-add', m).onclick = () => {
      const vendor = $('#q-vendor', m).value.trim() || (isQuote ? 'Quote' : 'Received list');
      const quote = { id: 'q' + uid(), vendor, number: $('#q-num', m).value.trim(), date: $('#q-date', m).value, note: parsed.length + ' lines' };
      job.quotes.push(quote);
      let matched = 0, added = 0;
      for (const r of parsed) {
        if (!r.pn) continue;
        const existing = job.parts.find(p => norm(p.pn) === norm(r.pn));
        if (isQuote) {
          if (existing) { existing.unit = r.unit ?? existing.unit; existing.core = r.core ?? existing.core; existing.promo = r.promo ?? existing.promo; if (!existing.desc) existing.desc = r.desc; existing.qty = r.qty || existing.qty; if (!existing.quoteId) existing.quoteId = quote.id; matched++; }
          else { job.parts.push({ id: uid(), pn: r.pn, desc: r.desc, qty: r.qty || 1, unit: r.unit, core: r.core, promo: r.promo, source: 'quote', quoteId: quote.id, status: 'needed' }); added++; }
        } else {
          if (existing) { if (existing.status === 'needed' || existing.status === 'ordered') existing.status = 'received'; existing.receivedQty = r.qty; existing.receivedAt = quote.date; matched++; }
          else { job.parts.push({ id: uid(), pn: r.pn, desc: r.desc, qty: r.qty || 1, unit: null, source: 'received', quoteId: quote.id, status: 'received', receivedAt: quote.date, note: 'Not on any quote. Open to set which quoted part it covers.' }); added++; }
        }
      }
      save(); closeModal(); renderJob(job.id);
      toast(isQuote ? `${added} lines added, ${matched} updated` : `${matched} quoted lines marked received, ${added} extras added`);
    };
  }

  // ---------- export / import ----------
  $('#btn-export').onclick = () => {
    const blob = new Blob([JSON.stringify(DB, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'parts-manager-' + today() + '.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#file-import').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const d = JSON.parse(r.result);
        if (!d || !Array.isArray(d.jobs)) throw new Error('bad');
        const mode = confirm('OK = merge into existing jobs (same job id replaces), Cancel = replace everything');
        if (mode) { for (const j of d.jobs) { const i = DB.jobs.findIndex(x => x.id === j.id); if (i >= 0) DB.jobs[i] = j; else DB.jobs.push(j); } }
        else { DB = d; }
        for (const j of DB.jobs) normalizeJob(j);
        save(); route(); toast('Imported');
      } catch (err) { toast('That file is not a Parts Manager export'); }
      e.target.value = '';
    };
    r.readAsText(f);
  };

  route();
})();
