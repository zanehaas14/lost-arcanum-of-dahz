/* Lore Codex — wiki list + article. Respects GM visibility. */

const codexState = { q: '', cat: 'All' };

const CODEX_GENERIC_TITLES = new Set(['law', 'culture', 'military', 'nobility']);
const CODEX_ALIASES = {
  'cult-of-khul-anar': ['Cult of Khul Anar', 'Khul Anar'],
  'cythranai': ['Cythranai'],
  'athel-cythrel': ['Athel Cythrel'],
  'gareth': ['Gareth', 'Tyhîr'],
  'teimanear': ['Teimanëar'],
  'yar-laithir': ["Yár'laithîr"],
  'felmoren': ['Felmorën', 'Felmorë'],
  'tirkinthil': ['Tirkinthil'],
  'taeriour': ['Taeriour'],
  'daedilae': ['Daedilae'],
  'laiwynne': ['Laiwynne'],
  'emreith': ['Emreith'],
  'ginriol': ['Ginriol'],
  'feanin': ['Fëanin'],
  'the-twin-spirits': ['Twin Spirits'],
  'sontrailles': ['Marches of Sontrailles'],
  'caerwynne': ['Caerwynne'],
  'fealana': ['Fëalana'],
  'lothaqshynin': ['Lothaqshynin'],
  'vhailor-sarthai': ['Vhailor Sarthai', 'Silent Sovereign'],
  'templars-of-morngal': ['Templars of Morngal', 'Spirit Eyes', 'Morngal'],
  'temple-of-kurnous-and-isha': ['Temple of Kurnous and Isha'],
  'death-cults-of-ereth-khial': ['Ereth Khial', 'Pale Mistress'],
};

function visibleEntries(lore) {
  return lore.entries.filter(e => App.gm || e.visibility !== 'gm');
}

function codexEntryIdFromHash() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  return decodeURIComponent(parts.slice(1).join('/')).trim();
}

function excerpt(body, n = 180) {
  const t = String(body ?? '').replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return cut.replace(/\s+\S*$/, '') + '…';
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function autolinkHtml(html, entries, selfId) {
  const phrases = [];
  const seen = new Set();
  for (const e of entries) {
    if (!e || e.id === selfId) continue;
    const names = [e.title, ...(CODEX_ALIASES[e.id] || [])];
    for (const name of names) {
      const n = String(name || '').trim();
      if (!n) continue;
      if (CODEX_GENERIC_TITLES.has(n.toLowerCase())) continue;
      const key = n.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      phrases.push({ name: n, id: e.id });
    }
  }
  phrases.sort((a, b) => b.name.length - a.name.length || a.name.localeCompare(b.name));
  if (!phrases.length) return html;

  const byLower = new Map(phrases.map(p => [p.name.toLowerCase(), p.id]));
  const re = new RegExp(
    '(?<![A-Za-z0-9])(?:' + phrases.map(p => escapeRe(p.name)).join('|') + ')(?![A-Za-z0-9])',
    'gi'
  );

  let out = '';
  let i = 0;
  let inAnchor = 0;
  while (i < html.length) {
    if (html[i] === '<') {
      const end = html.indexOf('>', i);
      const tag = end === -1 ? html.slice(i) : html.slice(i, end + 1);
      const tm = tag.match(/^<\/?\s*([a-zA-Z]+)/);
      const tname = tm ? tm[1].toLowerCase() : '';
      if (tname === 'a') {
        if (/^<\s*a\b/i.test(tag)) inAnchor++;
        else if (/^<\s*\/\s*a\b/i.test(tag)) inAnchor = Math.max(0, inAnchor - 1);
      }
      out += tag;
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const next = html.indexOf('<', i);
    const text = next === -1 ? html.slice(i) : html.slice(i, next);
    if (inAnchor) out += text;
    else {
      out += text.replace(re, m => {
        const id = byLower.get(m.toLowerCase());
        if (!id) return m;
        return `<a class="wiki-link" href="#/codex/${encodeURIComponent(id)}">${m}</a>`;
      });
    }
    i = next === -1 ? html.length : next;
  }
  return out;
}

async function renderCodex() {
  const lore = await loadJSON('lore');
  const entryId = codexEntryIdFromHash();
  if (entryId) {
    renderCodexArticle(lore, entryId);
    return;
  }
  renderCodexList(lore);
}

function renderCodexList(lore) {
  const view = document.getElementById('view');
  const cats = ['All', ...(lore.categories || [])];

  view.innerHTML = `
    <section class="pillar">
      <div class="pillar-head">
        <h1>📜 Lore Codex</h1>
        <p class="muted">Homebrew canon. ${App.gm
          ? '<strong class="gm-flag">GM view — private entries shown.</strong>'
          : 'Player view — GM-only entries hidden.'}</p>
      </div>
      <div class="toolbar">
        <input id="codex-search" type="search" placeholder="Search lore…" value="${esc(codexState.q)}">
        <div id="codex-cats" class="chips"></div>
      </div>
      <div id="codex-list" class="codex-list"></div>
    </section>`;

  const catsEl = document.getElementById('codex-cats');
  cats.forEach(c => {
    const chip = el(`<button class="chip ${c === codexState.cat ? 'active' : ''}">${esc(c)}</button>`);
    chip.onclick = () => { codexState.cat = c; drawCodexList(lore); paintCats(cats); };
    catsEl.appendChild(chip);
  });

  const search = document.getElementById('codex-search');
  search.addEventListener('input', () => { codexState.q = search.value; drawCodexList(lore); });

  drawCodexList(lore);
}

function paintCats(cats) {
  document.querySelectorAll('#codex-cats .chip').forEach((chip, i) => {
    chip.classList.toggle('active', cats[i] === codexState.cat);
  });
}

function drawCodexList(lore) {
  const list = document.getElementById('codex-list');
  const q = codexState.q.trim().toLowerCase();
  const entries = visibleEntries(lore).filter(e => {
    if (codexState.cat !== 'All' && e.category !== codexState.cat) return false;
    if (!q) return true;
    const hay = `${e.title} ${e.body} ${(e.tags || []).join(' ')}`.toLowerCase();
    return hay.includes(q);
  });

  if (!entries.length) {
    list.innerHTML = `<p class="muted">No entries match. Add lore in <code>data/lore.json</code>.</p>`;
    return;
  }

  list.innerHTML = '';
  entries.forEach(e => {
    const row = el(`
      <a class="card codex-row ${e.visibility === 'gm' ? 'gm' : ''}" href="#/codex/${encodeURIComponent(e.id)}">
        <div class="entry-top">
          <span class="tag">${esc(e.category)}</span>
          ${e.visibility === 'gm' ? '<span class="tag gm-tag">GM-only</span>' : ''}
        </div>
        <h3>${esc(e.title)}</h3>
        <p class="excerpt">${esc(excerpt(e.body))}</p>
      </a>`);
    list.appendChild(row);
  });
}

function renderCodexArticle(lore, entryId) {
  const view = document.getElementById('view');
  const vis = visibleEntries(lore);
  const entry = vis.find(e => e.id === entryId);

  if (!entry) {
    view.innerHTML = `
      <section class="pillar">
        <article class="card codex-article">
          <a class="codex-back" href="#/codex">← Back to Codex</a>
          <h1>Entry not found</h1>
          <p class="muted">No Codex page matches this link.</p>
        </article>
      </section>`;
    return;
  }

  const img = entry.image
    ? `<img class="entry-image" src="assets/${esc(entry.image)}" alt="${esc(entry.title)}">`
    : '';
  const bodyHtml = autolinkHtml(paragraphs(entry.body), vis, entry.id);
  const tags = (entry.tags || []).length
    ? `<div class="tags">${entry.tags.map(t => `<span class="mini-tag">#${esc(t)}</span>`).join('')}</div>`
    : '';

  view.innerHTML = `
    <section class="pillar">
      <article class="card entry codex-article ${entry.visibility === 'gm' ? 'gm' : ''}">
        <a class="codex-back" href="#/codex">← Back to Codex</a>
        <div class="entry-top">
          <span class="tag">${esc(entry.category)}</span>
          ${entry.visibility === 'gm' ? '<span class="tag gm-tag">GM-only</span>' : ''}
        </div>
        <h1>${esc(entry.title)}</h1>
        ${img}
        <div class="entry-body">${bodyHtml}</div>
        ${tags}
      </article>
    </section>`;
}
