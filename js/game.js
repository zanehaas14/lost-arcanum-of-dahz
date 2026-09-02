/* Game Mode — import a list, roll the mission & table setup, generate spells.
   Reuses saved lists from the Army Builder; resolves points independently so it
   never disturbs the builder's in-progress list. */

const gameState = {
  army: null,                               // { factionId, label, cap, roster, faction }
  pools: { official: true, custom: true },
  mission: null, deployment: null, firstTurn: null, d6: null,
  magic: { takeSignature: true, casters: {}, manual: { lore: null, level: 2, spells: null, takeSignature: true } },
};

/* ----- independent points resolver (mirrors army.js, no shared mutable state) ----- */
function gItemIndex(factionId) {
  const idx = {}, groups = (App.data.magicItems && App.data.magicItems.groups) || {};
  const faction = (gameState.army && gameState.army.faction)
    || App.data[`faction:${factionId}`] || {};
  const uses = faction.uses;
  new Set(['general', factionId, uses, ...Object.values(TYPE_GROUP)].filter(Boolean)).forEach(g =>
    (groups[g] || []).forEach(it => { if (!(it.name in idx)) idx[it.name] = it.points; }));
  return idx;
}
function gLineCost(u, line, items) {
  if (!u) return 0;
  const models = u.perModel != null ? Math.max(line.count, u.minSize) : Math.max(1, line.count || 1);
  let c = u.perModel != null ? u.points + Math.max(0, models - u.minSize) * u.perModel : u.points * models;
  if (line.mount) { const m = (u.mounts || []).find(x => x.name === line.mount); if (m) c += m.points; }
  ['command', 'equipment', 'armor', 'options'].forEach(k => (line[k] || []).forEach(n => {
    const o = (u[k] || []).find(x => x.name === n); if (o) c += o.perModel ? o.points * models : o.points;
  }));
  (line.items || []).forEach(n => c += items[n] || 0);
  return c;
}
const roll = n => Math.floor(Math.random() * n) + 1;

/* ---------- render ---------- */
async function renderGame() {
  App.data.missions = await loadJSON('missions');
  App.data.lores = await loadJSON('lores');
  App.data.magicItems = App.data.magicItems || await loadJSON('magic-items');
  if (gameState.magic.manual.lore == null) {
    const keys = Object.keys(App.data.lores.lores);
    if (keys.length) gameState.magic.manual.lore = keys[0];
  }

  document.getElementById('view').innerHTML = `
    <section class="pillar game">
      <div class="pillar-head"><h1>🎲 Game Mode</h1>
        <p class="muted">Import a list, roll your mission and table setup, and generate spells for the battle.</p></div>
      <div class="game-grid">
        <div class="card game-card" id="g-army"></div>
        <div class="card game-card" id="g-mission"></div>
        <div class="card game-card" id="g-magic"></div>
      </div>
      <input type="file" id="g-file" accept="application/json" hidden>
    </section>`;

  drawArmyCard(); drawMissionCard(); drawMagicCard();
  document.getElementById('g-file').addEventListener('change', onFileChosen);
}

/* ---------- army import ---------- */
function drawArmyCard() {
  const box = document.getElementById('g-army');
  const saved = savedLists(); const names = Object.keys(saved);
  const a = gameState.army;
  box.innerHTML = `<h2>🛡️ Army</h2>
    <div class="g-import">
      <select id="g-saved"><option value="">— saved lists —</option>
        ${names.map(n => `<option ${a && a._name === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
      <button id="g-loadfile">Load .json…</button>
    </div>
    <div id="g-army-body">${a ? '' : '<p class="muted">Pick a saved list or load an exported .json file.</p>'}</div>`;
  document.getElementById('g-saved').onchange = e => { if (e.target.value) loadArmyFromSaved(e.target.value); };
  document.getElementById('g-loadfile').onclick = () => document.getElementById('g-file').click();
  if (a) drawArmyBody();
}

async function loadArmyFromSaved(name) {
  const saved = savedLists()[name]; if (!saved) return;
  await setArmy({ ...saved, _name: name });
}
function onFileChosen(e) {
  const file = e.target.files[0]; if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try { const data = JSON.parse(reader.result); await setArmy({ ...data, _name: file.name }); }
    catch { alert('That file is not a valid list .json.'); }
  };
  reader.readAsText(file);
}
async function setArmy(data) {
  if (!data.factionId || !Array.isArray(data.roster)) { alert('List is missing a faction or units.'); return; }
  const key = `faction:${data.factionId}`;
  if (!App.data[key]) {
    if (!App.data.factionsIndex) {
      App.data.factionsIndex = await loadJSON('factions-index');
    }
    const meta = (App.data.factionsIndex.factions || []).find(f => f.id === data.factionId) || {};
    const uses = meta.uses;
    let r = await fetch(`data/factions/${data.factionId}.json`);
    if (!r.ok && uses) {
      r = await fetch(`data/factions/${uses}.json`);
    }
    if (!r.ok) { alert(`Unknown army "${data.factionId}".`); return; }
    const faction = await r.json();
    if (uses) faction.uses = faction.uses || uses;
    App.data[key] = faction;
  }
  gameState.army = { ...data, faction: App.data[key] };
  gameState.magic.casters = {};
  drawArmyCard();
  drawMagicCard();
}

function drawArmyBody() {
  const a = gameState.army, units = a.faction.units;
  const byId = id => units.find(u => u.id === id);
  const items = gItemIndex(a.factionId);
  const cats = App.data.rules ? App.data.rules.categories.map(c => c.key) : ['Characters', 'Core', 'Special', 'Rare'];
  let total = 0;
  const groups = cats.map(cat => {
    const rows = a.roster.filter(l => byId(l.id)?.category === cat).map(l => {
      const u = byId(l.id), cost = gLineCost(u, l, items); total += cost;
      const size = u.perModel != null ? `${l.count} models` : (l.count > 1 ? `x${l.count}` : '');
      const ups = [l.mount && l.mount !== 'On foot' ? l.mount : null, ...(l.command || []), ...(l.equipment || []).filter(x => x !== 'Hand weapon'), ...(l.armor || []), ...(l.options || []), ...(l.items || [])].filter(Boolean);
      return `<div class="g-unit"><span class="g-uname">${esc(u.name)} <small>${esc(size)}</small></span><span class="g-ucost">${cost}</span>
        ${ups.length ? `<div class="g-ups">${esc(ups.join(', '))}</div>` : ''}</div>`;
    }).join('');
    return rows ? `<div class="g-cat"><h4>${esc(cat)}</h4>${rows}</div>` : '';
  }).join('');
  document.getElementById('g-army-body').innerHTML = `
    <div class="g-army-head"><strong>${esc(a.faction.label)}</strong>
      <span class="muted">${total}${a.cap ? ` / ${a.cap}` : ''} pts</span></div>${groups}`;
}

/* ---------- mission & table setup ---------- */
function drawMissionCard() {
  const box = document.getElementById('g-mission'), m = App.data.missions;
  box.innerHTML = `<h2>🗺️ Mission &amp; setup</h2>
    <div class="g-pools">
      <label><input type="checkbox" id="pool-official" ${gameState.pools.official ? 'checked' : ''}> Official (pitched-battle D6)</label>
      <label><input type="checkbox" id="pool-custom" ${gameState.pools.custom ? 'checked' : ''}> Custom</label>
    </div>
    <div class="g-pick">
      <label>Pick mission <select id="g-pick-mission">${pickMissionOptions()}</select></label>
    </div>
    <div class="g-rollers">
      <button id="roll-game">🎲 Roll this game</button>
      <button id="roll-first">Reroll first turn</button>
    </div>
    <div id="g-mission-out" class="g-out"></div>
    <div class="g-notes muted">
      <p><strong>Terrain:</strong> ${esc(m.objectives?.terrainPieces || '')}</p>
      <p><strong>Objectives:</strong> ${esc(m.objectives?.objectiveMarkers || '')}</p>
    </div>`;
  document.getElementById('pool-official').onchange = e => { gameState.pools.official = e.target.checked; refreshPickMission(); };
  document.getElementById('pool-custom').onchange = e => { gameState.pools.custom = e.target.checked; refreshPickMission(); };
  document.getElementById('g-pick-mission').onchange = e => { if (e.target.value) pickMission(e.target.value); };
  document.getElementById('roll-game').onclick = rollThisGame;
  document.getElementById('roll-first').onclick = rollFirstTurn;
  drawMissionOut();
}
function officialPool() { return gameState.pools.official ? (App.data.missions.official || []) : []; }
function customPool() { return gameState.pools.custom ? (App.data.missions.custom || []) : []; }
function pickMissionOptions() {
  const items = ['<option value="">— pick a scenario —</option>'];
  officialPool().forEach((mn, i) => {
    const lab = mn.d6 ? `D6 ${mn.d6} — ${mn.name}` : mn.name;
    items.push(`<option value="official:${i}">${esc(lab)}</option>`);
  });
  customPool().forEach((mn, i) => {
    items.push(`<option value="custom:${i}">${esc(mn.name)}</option>`);
  });
  return items.join('');
}
function refreshPickMission() {
  const sel = document.getElementById('g-pick-mission');
  if (sel) sel.innerHTML = pickMissionOptions();
}
function fallbackDeployment() {
  const d = App.data.missions.deployments || [];
  return d[0] || 'Pitched Battle long-edge A&B';
}
function applyMission(mn, d6) {
  gameState.mission = mn;
  gameState.d6 = d6 || null;
  gameState.deployment = (mn && mn.deployment) || fallbackDeployment();
}
function pickMission(key) {
  const [pool, idx] = key.split(':');
  const list = pool === 'official' ? officialPool() : customPool();
  const mn = list[Number(idx)];
  if (!mn) return;
  applyMission(mn, null);
  drawMissionOut();
}
function pickOfficialByD6(off, d6) {
  return off.find(x => x.d6 === d6) || off[d6 - 1] || off[0];
}
function rollThisGame() {
  const off = officialPool(), cus = customPool();
  if (!off.length && !cus.length) { alert('Enable at least one mission pool.'); return; }
  let mn = null, d6 = null;
  const useOfficial = off.length && (!cus.length || Math.random() < 0.5);
  if (useOfficial) {
    d6 = roll(6);
    mn = pickOfficialByD6(off, d6);
  } else {
    mn = cus[Math.floor(Math.random() * cus.length)];
  }
  applyMission(mn, d6);
  rollFirstTurn();
}
function rollFirstTurn() {
  let p1 = roll(6), p2 = roll(6);
  while (p1 === p2) { p1 = roll(6); p2 = roll(6); }
  gameState.firstTurn = { p1, p2, winner: p1 > p2 ? 'Player 1' : 'Player 2' };
  drawMissionOut();
}
function drawMissionOut() {
  const out = document.getElementById('g-mission-out'); if (!out) return;
  const parts = [];
  if (gameState.d6) {
    parts.push(`<div class="g-result"><span class="g-rlabel">D6</span><span class="g-rval">${gameState.d6}</span></div>`);
  }
  if (gameState.mission) {
    const mn = gameState.mission;
    parts.push(`<div class="g-result"><span class="g-rlabel">Mission</span>
      <span class="g-rval">${mn.url ? `<a href="${esc(mn.url)}" target="_blank" rel="noopener">${esc(mn.name)}</a>` : esc(mn.name)}</span>
      ${mn.notes ? `<div class="muted">${esc(mn.notes)}</div>` : ''}</div>`);
  }
  if (gameState.deployment) parts.push(`<div class="g-result"><span class="g-rlabel">Deployment</span><span class="g-rval">${esc(gameState.deployment)}</span></div>`);
  if (gameState.firstTurn) { const f = gameState.firstTurn;
    const note = (gameState.mission && gameState.mission.firstTurn) ? `<div class="muted">${esc(gameState.mission.firstTurn)}</div>` : '';
    parts.push(`<div class="g-result"><span class="g-rlabel">First turn</span><span class="g-rval">${esc(f.winner)} (${f.p1} vs ${f.p2})</span>${note}</div>`); }
  out.innerHTML = parts.join('') || '<p class="muted">Roll to begin.</p>';
}

/* ---------- magic generation ---------- */
const WE_SPELLWEAVER_LORES = ['battle-magic', 'elementalism', 'high-magic', 'illusion'];
const FALLBACK_LORES = {
  spellweaver: WE_SPELLWEAVER_LORES,
  spellsinger: WE_SPELLWEAVER_LORES,
  'treeman-ancient': ['battle-magic', 'elementalism'],
  branchwraith: ['battle-magic', 'elementalism', 'illusion'],
  shadowdancer: ['battle-magic', 'illusion'],
  'hb-daedilae': WE_SPELLWEAVER_LORES,
  'hb-high-priestess': WE_SPELLWEAVER_LORES,
};
const FALLBACK_LEVEL = {
  spellweaver: 3, spellsinger: 1, 'treeman-ancient': 2,
  branchwraith: 1, shadowdancer: 1,
  'hb-daedilae': 3, 'hb-high-priestess': 2,
};
const ATHEL_IDS = new Set(['spellweaver', 'spellsinger', 'treeman-ancient', 'branchwraith', 'hb-daedilae', 'hb-high-priestess']);
const LV_WIZARD = /Level\s+(\d+)\s+Wizard/i;

function loreCatalog() { return (App.data.lores && App.data.lores.lores) || {}; }
function armyUnit(id) {
  const units = (gameState.army && gameState.army.faction && gameState.army.faction.units) || [];
  return units.find(u => u.id === id);
}
function optionNames(unit, line) {
  const names = [...(line.options || [])];
  (unit.options || []).forEach(o => { if (o.default && !names.includes(o.name)) names.push(o.name); });
  return names;
}
function isOptionalWizard(unit) {
  const wiz = (unit.options || []).filter(o => /wizard/i.test(o.name));
  return wiz.length > 0 && wiz.every(o => !o.default);
}
function isCaster(unit, line) {
  if (!unit) return false;
  const id = unit.id || '';
  if (id === 'hb-daedilae' || id === 'hb-high-priestess') return true;
  if (/wizard/i.test(unit.notes || '') || /\bcaster\b/i.test(unit.notes || '')) return true;
  const selected = line.options || [];
  if (isOptionalWizard(unit)) return selected.some(n => /wizard/i.test(n));
  if ((unit.options || []).some(o => /wizard/i.test(o.name))) return true;
  if ((unit.specialRules || []).some(r => /lore of /i.test(r))) return true;
  if (Array.isArray(unit.lores) && unit.lores.length) return true;
  if (/wizard/i.test(unit.name || '')) return true;
  if (selected.some(n => /wizard/i.test(n))) return true;
  return false;
}
function parseWizardLevel(unit, line) {
  const selected = line.options || [];
  let n = null;
  selected.forEach(name => { const m = name.match(LV_WIZARD); if (m) n = Math.max(n || 0, Number(m[1])); });
  if (n) return n;
  (unit.options || []).forEach(o => {
    if (!o.default) return;
    const m = o.name.match(LV_WIZARD); if (m) n = Math.max(n || 0, Number(m[1]));
  });
  if (n) return n;
  if (unit.wizardLevel) return unit.wizardLevel;
  return FALLBACK_LEVEL[unit.id] || 1;
}
function casterLores(unit) {
  const catalog = loreCatalog();
  const raw = (Array.isArray(unit.lores) && unit.lores.length) ? unit.lores : (FALLBACK_LORES[unit.id] || []);
  return raw.filter(k => catalog[k]);
}
function hasAthelLoren(unit) {
  if (!unit) return false;
  if ((unit.specialRules || []).some(r => /lore of athel loren/i.test(r))) return true;
  return ATHEL_IDS.has(unit.id);
}
function athelSignatures() {
  const lore = loreCatalog()['lore-of-athel-loren'];
  return lore ? (lore.spells || []).filter(s => s.index === 'signature') : [];
}
function listCasters() {
  const a = gameState.army;
  if (!a || !Array.isArray(a.roster)) return [];
  const out = [];
  a.roster.forEach((line, idx) => {
    const unit = armyUnit(line.id);
    if (isCaster(unit, line)) out.push({ idx, line, unit });
  });
  return out;
}
function ensureCasterState(idx, unit, line) {
  const lores = casterLores(unit);
  const level = parseWizardLevel(unit, line);
  const prev = gameState.magic.casters[idx];
  if (prev && prev._id === unit.id) {
    if (!lores.includes(prev.lore)) prev.lore = lores[0] || prev.lore;
    if (prev.level == null) prev.level = level;
    if (prev.takeSignature == null) prev.takeSignature = true;
    if (prev.takeAthel == null) prev.takeAthel = '';
    return prev;
  }
  const st = { _id: unit.id, lore: lores[0] || null, level, takeSignature: true, takeAthel: '', spells: null };
  gameState.magic.casters[idx] = st;
  return st;
}

function pickUnique(pool, n) {
  const bag = [...pool], out = [];
  const want = Math.min(n, bag.length);
  for (let i = 0; i < want; i++) out.push(bag.splice(Math.floor(Math.random() * bag.length), 1)[0]);
  return out;
}
function markSig(s) { return Object.assign({}, s, { signature: true }); }

/* Know N spells. Numbered lore: draw N unique numbered, optionally replace one
   with the lore signature. All-signature lore: draw N unique signatures (capped).
   Never adds a free extra spell on top of N. */
function generateSpells(loreKey, n, takeSignature) {
  const lore = loreCatalog()[loreKey];
  if (!lore || !n || n < 1) return [];
  const numbered = (lore.spells || []).filter(s => s.index !== 'signature');
  const signatures = (lore.spells || []).filter(s => s.index === 'signature');
  if (!numbered.length) return pickUnique(signatures, n).map(markSig);
  const pick = pickUnique(numbered, n);
  if (takeSignature && signatures[0] && pick.length) {
    pick[Math.floor(Math.random() * pick.length)] = markSig(signatures[0]);
  }
  pick.sort((a, b) => {
    const as = a.signature || a.index === 'signature', bs = b.signature || b.index === 'signature';
    if (as && !bs) return -1; if (!as && bs) return 1;
    return Number(a.index) - Number(b.index);
  });
  return pick;
}
function applyAthelSwap(spells, takeAthel) {
  if (!takeAthel || !spells || !spells.length) return spells;
  const al = athelSignatures().find(s => s.name === takeAthel);
  if (!al) return spells;
  const next = spells.slice();
  const i = Math.floor(Math.random() * next.length);
  next[i] = Object.assign(markSig(al), { athel: true });
  return next;
}

function loreOptionsHtml(keys, selected) {
  const catalog = loreCatalog();
  return keys.map(k => {
    const lab = catalog[k] ? catalog[k].label : k;
    return `<option value="${esc(k)}" ${k === selected ? 'selected' : ''}>${esc(lab)}</option>`;
  }).join('');
}
function levelOptionsHtml(selected) {
  return [1, 2, 3, 4, 5, 6].map(n => `<option ${n === selected ? 'selected' : ''}>${n}</option>`).join('');
}
function spellLink(s) {
  const isSig = s.signature || s.index === 'signature';
  const idx = isSig ? 'S' : String(s.index);
  const tag = isSig ? '<span class="g-sig">signature</span>' : '';
  return `<a class="spell" href="${esc(s.url || '#')}" target="_blank" rel="noopener"><span class="s-idx">${esc(idx)}</span> ${esc(s.name)}</a>${tag}`;
}
function spellsListHtml(spells) {
  if (!spells || !spells.length) return '';
  return `<div class="spell-list generated">${spells.map(spellLink).join('')}</div>`;
}

function ensureMagicCss() {
  if (document.getElementById('g-magic-css')) return;
  const s = document.createElement('style');
  s.id = 'g-magic-css';
  s.textContent = '.g-caster{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-bottom:10px;background:var(--bg-2)}.g-caster-head{display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px}.g-caster-name{color:var(--gold-2);font-size:15px}.g-caster-lvl{color:var(--muted);font-size:12px}.g-sig{color:var(--amber);font-size:11px;margin-left:4px}.g-check{font-size:13px}.g-caster .g-magic-ctl{margin-bottom:8px}';
  document.head.appendChild(s);
}

function drawMagicCard() {
  ensureMagicCss();
  const box = document.getElementById('g-magic'); if (!box) return;
  const casters = listCasters();
  if (gameState.army && casters.length) {
    box.innerHTML = `<h2>✧ Magic</h2><div id="g-casters"></div>`;
    const wrap = document.getElementById('g-casters');
    casters.forEach(c => wrap.appendChild(drawCasterRow(c)));
    return;
  }
  if (gameState.army && !casters.length) {
    box.innerHTML = `<h2>✧ Magic</h2><p class="muted">No wizards on this list.</p>`;
    return;
  }
  const catalog = loreCatalog();
  const keys = Object.keys(catalog);
  const man = gameState.magic.manual;
  box.innerHTML = `<h2>✧ Magic</h2>
    <p class="muted">Import a list to restrict lores per caster. Full catalog until then.</p>
    <div class="g-magic-ctl">
      <label>Lore <select id="mg-lore">${loreOptionsHtml(keys, man.lore)}</select></label>
      <label>Spells <select id="mg-level">${levelOptionsHtml(man.level)}</select></label>
      <label class="g-check"><input type="checkbox" id="mg-sig" ${man.takeSignature ? 'checked' : ''}> Take signature</label>
      <button id="mg-gen">Generate</button>
      <button id="mg-all" class="ghost">Show full lore</button>
    </div>
    <div id="mg-out" class="g-out"></div>`;
  document.getElementById('mg-lore').onchange = e => { man.lore = e.target.value; man.spells = null; drawManualOut(); };
  document.getElementById('mg-level').onchange = e => { man.level = Number(e.target.value); };
  document.getElementById('mg-sig').onchange = e => { man.takeSignature = e.target.checked; };
  document.getElementById('mg-gen').onclick = () => {
    man.spells = generateSpells(man.lore, man.level, man.takeSignature);
    drawManualOut();
  };
  document.getElementById('mg-all').onclick = () => { man.spells = 'all'; drawManualOut(); };
  drawManualOut();
}
function drawManualOut() {
  const out = document.getElementById('mg-out'); if (!out) return;
  const man = gameState.magic.manual, lore = loreCatalog()[man.lore], g = man.spells;
  if (!g) { out.innerHTML = '<p class="muted">Pick a lore and generate, or show the full list.</p>'; return; }
  if (g === 'all') { out.innerHTML = `<div class="spell-list">${(lore.spells || []).map(spellLink).join('')}</div>`; return; }
  out.innerHTML = spellsListHtml(g);
}

function drawCasterRow(entry) {
  const { idx, line, unit } = entry;
  const st = ensureCasterState(idx, unit, line);
  const lores = casterLores(unit);
  const athel = hasAthelLoren(unit) && st.lore !== 'lore-of-athel-loren';
  const alSpells = athel ? athelSignatures() : [];
  const numberedLore = (() => {
    const lore = loreCatalog()[st.lore];
    return lore && (lore.spells || []).some(s => s.index !== 'signature');
  })();
  const row = document.createElement('div');
  row.className = 'g-caster';
  row.innerHTML = `
    <div class="g-caster-head">
      <span class="g-caster-name">${esc(unit.name)}</span>
      <span class="g-caster-lvl">Level ${st.level}</span>
    </div>
    <div class="g-magic-ctl">
      <label>Lore <select data-act="lore">${loreOptionsHtml(lores, st.lore)}</select></label>
      <label>Spells <select data-act="level">${levelOptionsHtml(st.level)}</select></label>
      ${numberedLore ? `<label class="g-check"><input type="checkbox" data-act="sig" ${st.takeSignature ? 'checked' : ''}> Take signature</label>` : ''}
      ${athel ? `<label>Swap one for Athel Loren <select data-act="athel">
        <option value="">— off —</option>
        ${alSpells.map(s => `<option value="${esc(s.name)}" ${st.takeAthel === s.name ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
      </select></label>` : ''}
      <button data-act="gen">Generate</button>
    </div>
    <div class="g-out" data-act="out">${spellsListHtml(st.spells) || '<p class="muted">Generate this caster\'s spells.</p>'}</div>`;
  row.querySelector('[data-act="lore"]').onchange = e => { st.lore = e.target.value; st.spells = null; drawMagicCard(); };
  row.querySelector('[data-act="level"]').onchange = e => { st.level = Number(e.target.value); };
  const sig = row.querySelector('[data-act="sig"]');
  if (sig) sig.onchange = e => { st.takeSignature = e.target.checked; };
  const al = row.querySelector('[data-act="athel"]');
  if (al) al.onchange = e => { st.takeAthel = e.target.value; };
  row.querySelector('[data-act="gen"]').onclick = () => {
    const useSig = numberedLore && st.takeSignature;
    st.spells = generateSpells(st.lore, st.level, useSig);
    if (athel && st.takeAthel) st.spells = applyAthelSwap(st.spells, st.takeAthel);
    row.querySelector('[data-act="out"]').innerHTML = spellsListHtml(st.spells);
  };
  return row;
}
