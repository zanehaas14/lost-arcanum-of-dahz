/* Lore Codex — browse/search homebrew lore. Respects GM visibility. */

const codexState = { q: '', cat: 'All' };

function visibleEntries(lore) {
  return lore.entries.filter(e => App.gm || e.visibility !== 'gm');
}

async function renderCodex() {
  const lore = await loadJSON('lore');
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
      <div id="codex-list" class="grid"></div>
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
    const img = e.image
      ? `<img class="entry-image" src="assets/${esc(e.image)}" alt="${esc(e.title)}" style="display:block;width:100%;max-height:280px;object-fit:cover;object-position:top center;margin:6px 0 12px;border-radius:8px;border:1px solid var(--line)">`
      : '';
    const card = el(`
      <article class="card entry ${e.visibility === 'gm' ? 'gm' : ''}">
        <div class="entry-top">
          <span class="tag">${esc(e.category)}</span>
          ${e.visibility === 'gm' ? '<span class="tag gm-tag">GM-only</span>' : ''}
        </div>
        <h3>${esc(e.title)}</h3>
        ${img}
        <div class="entry-body">${paragraphs(e.body)}</div>
        ${(e.tags || []).length ? `<div class="tags">${e.tags.map(t => `<span class="mini-tag">#${esc(t)}</span>`).join('')}</div>` : ''}
      </article>`);
    list.appendChild(card);
  });
}
