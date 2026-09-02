/* Army Builder — faction picker, per-unit upgrades (command/equipment/armour/
   options/mounts/magic items), points totals, category legality, save/export.
   Special-rule chips link to the online rulebook. */

const armyState = {
  factionId: null,
  cap: null,
  roster: [],   // see newLine() for shape
  expanded: {}, // roster index -> bool (config panel open)
};

const TYPE_GROUP = {
  'forest-spite': 'forest-spites', 'knightly-virtue': 'knightly-virtues',
  'elven-honour': 'elven-honours', 'gift-of-chaos': 'gifts-of-chaos',
  'chaos-mutation': 'chaos-mutations', 'chaotic-trait': 'chaotic-traits',
};

const currentUnits = () => (App.data.faction && App.data.faction.units) || [];
const unitById = id => currentUnits().find(u => u.id === id);

async function factionMeta(id) {
  if (!App.data.factionsIndex) {
    App.data.factionsIndex = await loadJSON('factions-index');
  }
  return (App.data.factionsIndex.factions || []).find(f => f.id === id) || { id };
}

async function loadFaction(id) {
  const key = `faction:${id}`;
  if (!App.data[key]) {
    const meta = await factionMeta(id);
    const uses = meta.uses;
    let res = await fetch(`data/factions/${id}.json`);
    if (!res.ok && uses) {
      res = await fetch(`data/factions/${uses}.json`);
    }
    if (!res.ok) throw new Error(`Could not load faction "${id}" (${res.status})`);
    const data = await res.json();
    if (uses) data.uses = data.uses || uses;
    App.data[key] = data;
  }
  App.data.faction = App.data[key];
  buildItemIndex();
  return App.data.faction;
}

// name -> {points, onePerArmy} across general + current faction + special groups.
function buildItemIndex() {
  const idx = {};
  const groups = (App.data.magicItems && App.data.magicItems.groups) || {};
  // Index every group (general + current faction + uses prioritized) so an
  // item's points/onePerArmy resolve even when a unit draws from another
  // faction's list via its itemSources (e.g. Cythranai using all elf lists).
  // Campaign factions (Cythranai, Sontrailles) also index their `uses` group
  // (Wood Elf / Bretonnia items) since magic-items.json is keyed by OWB id.
  const uses = App.data.faction && App.data.faction.uses;
  const rest = Object.keys(groups).filter(g => g !== 'general' && g !== armyState.factionId && g !== uses);
  const order = ['general', armyState.factionId];
  if (uses) order.push(uses);
  [...order, ...rest].forEach(g => (groups[g] || []).forEach(it => {
    if (!(it.name in idx)) idx[it.name] = { points: it.points, onePerArmy: it.onePerArmy };
  }));
  App.data.itemIndex = idx;
}

function newLine(u) {
  const line = {
    id: u.id, count: u.perModel != null ? u.minSize : 1,
    mount: (u.mounts || []).find(m => m.default)?.name || null,
    command: [], equipment: [], armor: [], options: [], items: [],
  };
  ['equipment', 'armor'].forEach(k => (u[k] || []).forEach(o => { if (o.default) line[k].push(o.name); }));
  return line;
}

/* ---------- points ---------- */

function optList(u, key) { return u[key] || []; }
function findOpt(u, key, name) { return optList(u, key).find(o => o.name === name); }

function lineCost(line) {
  const u = unitById(line.id);
  if (!u) return 0;
  const models = u.perModel != null ? Math.max(line.count, u.minSize) : Math.max(1, line.count);
  let cost = u.perModel != null
    ? u.points + Math.max(0, models - u.minSize) * u.perModel
    : u.points * models;

  // mount (once)
  if (line.mount) { const m = (u.mounts || []).find(x => x.name === line.mount); if (m) cost += m.points; }
  // upgrades
  ['command', 'equipment', 'armor', 'options'].forEach(key => {
    line[key].forEach(name => {
      const o = findOpt(u, key, name);
      if (o) cost += o.perModel ? o.points * models : o.points;
    });
  });
  // magic items (once)
  line.items.forEach(n => { cost += (App.data.itemIndex[n]?.points) || 0; });
  return cost;
}

const categoryTotals = () => {
  const t = {}; App.data.rules.categories.forEach(c => (t[c.key] = 0));
  armyState.roster.forEach(l => { const u = unitById(l.id); if (u) t[u.category] += lineCost(l); });
  return t;
};
const grandTotal = () => armyState.roster.reduce((s, l) => s + lineCost(l), 0);
const hasHomebrew = () => armyState.roster.some(l => unitById(l.id)?.type === 'homebrew');

/* ---------- render ---------- */

async function renderArmy() {
  App.data.rules = await loadJSON('army-rules');
  const index = await loadJSON('factions-index');
  App.data.magicItems = await loadJSON('magic-items');
  App.data.rulesIndex = await loadJSON('rules-index');
  if (armyState.cap == null) armyState.cap = App.data.rules.defaultPoints;
  App.data.factionsIndex = index;
  if (armyState.factionId == null) {
    const ids = index.factions.map(f => f.id);
    armyState.factionId = ids.includes('cythranai') ? 'cythranai'
      : (ids.includes('wood-elf-realms') ? 'wood-elf-realms' : index.factions[0]?.id);
  }
  await loadFaction(armyState.factionId);

  document.getElementById('view').innerHTML = `
    <section class="pillar army">
      <div class="pillar-head"><h1>⚔️ Army Builder</h1>
        <p class="muted">Pick an army, add units, then <strong>Configure</strong> each for upgrades &amp; magic items.</p></div>
      <div class="army-controls">
        <label>Army <select id="faction-select">
          ${index.factions.map(f => `<option value="${f.id}" ${f.id === armyState.factionId ? 'selected' : ''}>${esc(f.label)}</option>`).join('')}
        </select></label>
        <label>Points <select id="cap-select">
          ${App.data.rules.pointsPresets.map(p => `<option value="${p}" ${p === armyState.cap ? 'selected' : ''}>${p}</option>`).join('')}
          <option value="custom">Custom…</option>
        </select></label>
        <input id="cap-custom" type="number" min="0" step="50" value="${esc(armyState.cap)}">
        <div class="spacer"></div>
        <button id="btn-save">Save</button><button id="btn-load">Load</button>
        <button id="btn-export-txt">Export .txt</button><button id="btn-export-json">Export .json</button>
        <button id="btn-clear" class="danger">Clear</button>
      </div>
      <div id="army-summary"></div>
      <div class="army-cols">
        <div class="catalog"><h2>Catalog</h2><div id="catalog-list"></div></div>
        <div class="roster"><h2>Your list</h2><div id="roster-list"></div></div>
      </div>
    </section>`;

  buildCatalog(); drawRoster(); wireArmyControls(index);
}

function wireArmyControls(index) {
  const faction = document.getElementById('faction-select');
  faction.addEventListener('change', async () => {
    if (armyState.roster.length && !confirm('Switching army will clear your current list. Continue?')) {
      faction.value = armyState.factionId; return;
    }
    armyState.factionId = faction.value; armyState.roster = []; armyState.expanded = {};
    await loadFaction(armyState.factionId); buildCatalog(); drawRoster();
  });
  const sel = document.getElementById('cap-select'), custom = document.getElementById('cap-custom');
  sel.addEventListener('change', () => {
    if (sel.value === 'custom') { custom.focus(); return; }
    armyState.cap = Number(sel.value); custom.value = armyState.cap; drawSummary();
  });
  custom.addEventListener('input', () => {
    armyState.cap = Math.max(0, Number(custom.value) || 0);
    sel.value = App.data.rules.pointsPresets.includes(armyState.cap) ? String(armyState.cap) : 'custom';
    drawSummary();
  });
  document.getElementById('btn-clear').onclick = () => { if (confirm('Clear the whole list?')) { armyState.roster = []; armyState.expanded = {}; drawRoster(); } };
  document.getElementById('btn-save').onclick = saveList;
  document.getElementById('btn-load').onclick = loadListPrompt;
  document.getElementById('btn-export-txt').onclick = exportTxt;
  document.getElementById('btn-export-json').onclick = exportJson;
}

function buildCatalog() {
  const wrap = document.getElementById('catalog-list');
  wrap.innerHTML = '';
  App.data.rules.categories.forEach(cat => {
    const group = currentUnits().filter(u => u.category === cat.key);
    if (!group.length) return;
    const box = el(`<div class="cat-group"><h3>${esc(cat.label)}</h3></div>`);
    group.forEach(u => {
      const price = u.perModel != null ? `${u.points} pts (${u.perModel}/model)` : `${u.points} pts`;
      const row = el(`<button class="cat-item ${u.type === 'homebrew' ? 'homebrew' : ''}" title="${esc(u.notes || '')}">
        <span class="ci-name">${esc(u.name)}${u.type === 'homebrew' ? ' <span class="mini-tag hb">homebrew</span>' : ''}</span>
        <span class="ci-price">${esc(price)}</span></button>`);
      row.onclick = () => addUnit(u.id);
      box.appendChild(row);
    });
    wrap.appendChild(box);
  });
}

function addUnit(id) {
  armyState.roster.push(newLine(unitById(id)));
  drawRoster();
}

/* ---------- roster + configurator ---------- */

function drawRoster() {
  const wrap = document.getElementById('roster-list');
  if (!armyState.roster.length) { wrap.innerHTML = `<p class="muted">Empty. Click units in the catalog to add them.</p>`; drawSummary(); return; }
  wrap.innerHTML = '';
  armyState.roster.forEach((line, i) => {
    const u = unitById(line.id); if (!u) return;
    const unitWord = (u.perModel != null ? 'model' : 'unit') + (line.count === 1 ? '' : 's');
    const min = u.perModel != null ? u.minSize : 1;
    const open = !!armyState.expanded[i];
    const hasConfig = (u.mounts || u.command || u.equipment || u.armor || u.options || u.magicAllowances || u.specialRules || []).length !== undefined
      && ((u.mounts || []).length || (u.command || []).length || (u.equipment || []).length || (u.armor || []).length || (u.options || []).length || (u.magicAllowances || []).length || (u.specialRules || []).length);
    const row = el(`<div class="roster-row-wrap ${u.type === 'homebrew' ? 'homebrew' : ''}">
      <div class="roster-row">
        <div class="rr-main"><span class="rr-name">${esc(u.name)}</span><span class="rr-cat">${esc(u.category)}</span></div>
        <div class="rr-count"><button class="step" data-act="dec">−</button>
          <span class="rr-num">${line.count} <small>${unitWord}</small></span>
          <button class="step" data-act="inc">+</button></div>
        <span class="rr-cost">${lineCost(line)} pts</span>
        ${hasConfig ? `<button class="rr-cfg ${open ? 'on' : ''}" data-act="cfg">Configure ${open ? '▴' : '▾'}</button>` : '<span class="rr-cfg-none"></span>'}
        <button class="rr-del" title="Remove">✕</button>
      </div>
      <div class="rr-config" ${open ? '' : 'hidden'}></div>
    </div>`);
    row.querySelector('[data-act="dec"]').onclick = () => { line.count -= 1; if (line.count < min) { armyState.roster.splice(i, 1); delete armyState.expanded[i]; } drawRoster(); };
    row.querySelector('[data-act="inc"]').onclick = () => { line.count += 1; drawRoster(); };
    row.querySelector('.rr-del').onclick = () => { armyState.roster.splice(i, 1); delete armyState.expanded[i]; drawRoster(); };
    const cfgBtn = row.querySelector('[data-act="cfg"]');
    if (cfgBtn) cfgBtn.onclick = () => { armyState.expanded[i] = !open; drawRoster(); };
    if (open && hasConfig) row.querySelector('.rr-config').appendChild(buildConfig(u, line, i));
    wrap.appendChild(row);
  });
  drawSummary();
}

function toggleIn(arr, name) { const i = arr.indexOf(name); if (i >= 0) arr.splice(i, 1); else arr.push(name); }

function buildConfig(u, line, idx) {
  const frag = document.createDocumentFragment();

  // Mounts (single-select)
  if ((u.mounts || []).length) {
    const sec = el(`<div class="cfg-sec"><h4>Mount</h4><div class="cfg-opts"></div></div>`);
    const box = sec.querySelector('.cfg-opts');
    u.mounts.forEach(m => {
      const id = `mnt-${idx}-${m.name}`;
      const o = el(`<label class="cfg-opt"><input type="radio" name="mnt-${idx}" ${line.mount === m.name ? 'checked' : ''}>
        <span>${esc(m.name)}${m.points ? ` <em>+${m.points}</em>` : ''}</span></label>`);
      o.querySelector('input').onchange = () => { line.mount = m.name; drawRoster(); };
      box.appendChild(o);
    });
    frag.appendChild(sec);
  }

  // Command / Equipment / Armour / Options (multi-select)
  [['command', 'Command'], ['equipment', 'Weapons'], ['armor', 'Armour'], ['options', 'Options']].forEach(([key, label]) => {
    if (!(u[key] || []).length) return;
    const sec = el(`<div class="cfg-sec"><h4>${label}</h4><div class="cfg-opts"></div></div>`);
    const box = sec.querySelector('.cfg-opts');
    u[key].forEach(o => {
      const checked = line[key].includes(o.name);
      const per = o.perModel ? '/model' : '';
      const lab = el(`<label class="cfg-opt"><input type="checkbox" ${checked ? 'checked' : ''}>
        <span>${esc(o.name)}${o.points ? ` <em>+${o.points}${per}</em>` : ''}</span></label>`);
      lab.querySelector('input').onchange = () => { toggleIn(line[key], o.name); drawRoster(); };
      box.appendChild(lab);
    });
    frag.appendChild(sec);
  });

  // Magic items (characters etc.)
  (u.magicAllowances || []).forEach(al => frag.appendChild(buildItemPicker(u, line, al)));

  // Special rules -> inline text (homebrew) + rulebook reference (official)
  if ((u.specialRules || []).length) {
    const sec = el(`<div class="cfg-sec rules"><h4>Special rules</h4><div class="rule-list"></div></div>`);
    const box = sec.querySelector('.rule-list');
    u.specialRules.forEach(r => box.appendChild(ruleEntry(r)));
    frag.appendChild(sec);
  }
  return frag;
}

function buildItemPicker(u, line, allowance) {
  const groups = App.data.magicItems.groups;
  // A unit may widen its magic-item pool via itemSources (list of faction
  // group keys). Defaults to general + the army's own faction.
  const uses = (App.data.faction && App.data.faction.uses) || null;
  const src = new Set(u.itemSources || ['general', armyState.factionId, uses].filter(Boolean));
  allowance.types.forEach(t => { if (TYPE_GROUP[t]) src.add(TYPE_GROUP[t]); });
  const seen = new Set(); const items = [];
  src.forEach(g => (groups[g] || []).forEach(it => {
    if (allowance.types.includes(it.type) && !seen.has(it.name)) { seen.add(it.name); items.push(it); }
  }));
  items.sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name));

  const spent = line.items.reduce((s, n) => s + (App.data.itemIndex[n]?.points || 0), 0);
  const cap = allowance.maxPoints;
  const sec = el(`<div class="cfg-sec items"><h4>${esc(allowance.label)}
    <span class="muted">${cap != null ? `${spent} / ${cap} pts` : `${spent} pts`}</span></h4>
    <div class="cfg-opts item-opts"></div></div>`);
  const box = sec.querySelector('.item-opts');
  items.forEach(it => {
    const checked = line.items.includes(it.name);
    const usedElsewhere = it.onePerArmy && !checked && armyState.roster.some(l => l !== line && l.items.includes(it.name));
    const wouldExceed = cap != null && !checked && spent + it.points > cap;
    const disabled = usedElsewhere || wouldExceed;
    const lab = el(`<label class="cfg-opt item ${disabled ? 'disabled' : ''}" title="${usedElsewhere ? 'Already taken (one per army)' : ''}">
      <input type="checkbox" ${checked ? 'checked' : ''} ${disabled ? 'disabled' : ''}>
      <span>${esc(it.name)} <em>+${it.points}</em>${it.onePerArmy ? ' <span class="mini-tag">1/army</span>' : ''}</span></label>`);
    lab.querySelector('input').onchange = () => { toggleIn(line.items, it.name); drawRoster(); };
    box.appendChild(lab);
  });
  return sec;
}

function lookupRule(name) {
  const rules = (App.data.rulesIndex && App.data.rulesIndex.rules) || {};
  const key = (name || '').toLowerCase();
  if (rules[key]) return rules[key];
  const stripped = key.replace(/\s*\([^)]*\)\s*$/, '').trim();
  return (stripped && rules[stripped]) || {};
}

function ruleEntry(name) {
  const info = lookupRule(name);
  const desc = info.desc ? `<p class="re-desc">${esc(info.desc)}</p>` : '';
  const hbTag = info.homebrew ? ` <span class="mini-tag hb">homebrew</span>` : '';
  const ref = info.url
    ? `<a class="re-ref" href="${esc(info.url)}" target="_blank" rel="noopener" title="Open in the online rulebook">📜 ${esc(info.page || 'Rulebook')} ↗</a>`
    : '';
  return el(`<div class="rule-entry${info.homebrew ? ' hb' : ''}">
      <div class="re-head"><span class="re-name">${esc(name)}</span>${hbTag}${ref}</div>
      ${desc}</div>`);
}

/* ---------- summary ---------- */

function drawSummary() {
  const box = document.getElementById('army-summary'); if (!box) return;
  const cap = armyState.cap || 0, totals = categoryTotals(), total = grandTotal(), overCap = cap > 0 && total > cap;
  const rows = App.data.rules.categories.map(c => {
    const pts = totals[c.key] || 0, pct = cap ? Math.round((pts / cap) * 100) : 0, problems = [];
    if (c.minPercent != null && cap && pts < (c.minPercent / 100) * cap) problems.push(`needs ≥${c.minPercent}%`);
    if (c.maxPercent != null && cap && pts > (c.maxPercent / 100) * cap) problems.push(`over ${c.maxPercent}% cap`);
    const ok = !problems.length;
    const limit = [c.minPercent != null ? `min ${c.minPercent}%` : null, c.maxPercent != null ? `max ${c.maxPercent}%` : null].filter(Boolean).join(' · ') || 'no limit';
    return `<tr class="${ok ? '' : 'bad'}"><td>${esc(c.label)}</td><td class="num">${pts}</td><td class="num">${pct}%</td><td class="muted">${limit}</td><td>${ok ? '<span class="ok">✓ legal</span>' : `<span class="fail">✕ ${problems.join(', ')}</span>`}</td></tr>`;
  }).join('');
  const legal = !overCap && App.data.rules.categories.every(c => {
    const pts = totals[c.key] || 0;
    if (c.minPercent != null && cap && pts < (c.minPercent / 100) * cap) return false;
    if (c.maxPercent != null && cap && pts > (c.maxPercent / 100) * cap) return false;
    return true;
  });
  box.innerHTML = `<div class="summary-head ${legal ? 'legal' : 'illegal'}">
      <div class="big-total"><span class="${overCap ? 'fail' : ''}">${total}</span> / ${cap || '—'} pts</div>
      <div class="verdict">${legal ? '✓ List is legal' : '✕ Not legal yet'}</div>
      ${hasHomebrew() ? '<div class="pending-warn">Contains homebrew units.</div>' : ''}</div>
    <table class="summary-table"><thead><tr><th>Category</th><th class="num">Pts</th><th class="num">%</th><th>Limit</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------- save / load / export ---------- */

const savedLists = () => { try { return JSON.parse(localStorage.getItem('wh-lists') || '{}'); } catch { return {}; } };
function saveList() {
  const name = prompt('Save list as:'); if (!name) return;
  const all = savedLists(); all[name] = { factionId: armyState.factionId, cap: armyState.cap, roster: armyState.roster };
  localStorage.setItem('wh-lists', JSON.stringify(all)); alert(`Saved "${name}".`);
}
async function loadListPrompt() {
  const all = savedLists(), names = Object.keys(all);
  if (!names.length) { alert('No saved lists yet.'); return; }
  const name = prompt(`Load which list?\n\n${names.join('\n')}`); if (!name || !all[name]) return;
  armyState.factionId = all[name].factionId || armyState.factionId;
  armyState.cap = all[name].cap; armyState.roster = all[name].roster; armyState.expanded = {};
  await renderArmy();
}
function listAsText() {
  const totals = categoryTotals(), lines = [`${App.data.faction.label} — ${grandTotal()} / ${armyState.cap} pts`, ''];
  App.data.rules.categories.forEach(c => {
    const inCat = armyState.roster.filter(l => unitById(l.id)?.category === c.key);
    if (!inCat.length) return;
    lines.push(`== ${c.label} (${totals[c.key]} pts) ==`);
    inCat.forEach(l => {
      const u = unitById(l.id), size = u.perModel != null ? `${l.count} models` : `x${l.count}`;
      lines.push(`  ${u.name} — ${size} — ${lineCost(l)} pts${u.type === 'homebrew' ? '  [homebrew]' : ''}`);
      const ups = [l.mount && l.mount !== 'On foot' ? l.mount : null, ...l.command, ...l.equipment.filter(e => e !== 'Hand weapon'), ...l.armor, ...l.options, ...l.items].filter(Boolean);
      if (ups.length) lines.push(`      + ${ups.join(', ')}`);
    });
    lines.push('');
  });
  return lines.join('\n');
}
function download(fn, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type })), a = document.createElement('a');
  a.href = url; a.download = fn; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
function exportTxt() { download('army-list.txt', listAsText(), 'text/plain'); }
function exportJson() { download('army-list.json', JSON.stringify({ factionId: armyState.factionId, cap: armyState.cap, roster: armyState.roster }, null, 2), 'application/json'); }
