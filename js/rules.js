/* Rules glossary — searchable index of special rules, each linking to the
   online rulebook (tow.whfb.app) with its book/page citation. */

const rulesState = { q: '' };
const RULES_CAP = 300; // max rows rendered at once

async function renderRules() {
  const data = await loadJSON('rules-index');
  const view = document.getElementById('view');
  view.innerHTML = `
    <section class="pillar">
      <div class="pillar-head"><h1>📜 Rules</h1>
        <p class="muted">Search a special rule and open it in the online rulebook. Text lives on
          <a href="https://tow.whfb.app" target="_blank" rel="noopener">tow.whfb.app</a>; this is an index, not a copy.</p></div>
      <div class="toolbar"><input id="rules-search" type="search" placeholder="Search rules… (e.g. Hatred, Killing Blow)" value="${esc(rulesState.q)}"></div>
      <div id="rules-count" class="muted"></div>
      <div id="rules-list" class="rules-grid"></div>
    </section>`;
  const search = document.getElementById('rules-search');
  search.addEventListener('input', () => { rulesState.q = search.value; drawRules(data); });
  search.focus();
  drawRules(data);
}

function drawRules(data) {
  const list = document.getElementById('rules-list');
  const count = document.getElementById('rules-count');
  const q = rulesState.q.trim().toLowerCase();
  const all = Object.entries(data.rules || {});
  const matched = q ? all.filter(([name]) => name.includes(q)) : all;
  matched.sort((a, b) => a[0].localeCompare(b[0]));

  count.textContent = `${matched.length} rule${matched.length === 1 ? '' : 's'}${matched.length > RULES_CAP ? ` — showing first ${RULES_CAP}, keep typing to narrow` : ''}`;
  list.innerHTML = '';
  matched.slice(0, RULES_CAP).forEach(([name, info]) => {
    const title = name.replace(/\b\w/g, c => c.toUpperCase());
    const tag = info.homebrew ? ` <span class="mini-tag hb">homebrew</span>` : '';
    const desc = info.desc ? `<span class="rr-desc">${esc(info.desc)}</span>` : '';
    const inner = `<span class="rr-title">${esc(title)}${tag}</span>
             <span class="rr-page">${esc(info.page || '')}</span>${desc}`;
    const row = info.url
      ? el(`<a class="rule-row" href="${esc(info.url)}" target="_blank" rel="noopener">${inner}</a>`)
      : el(`<div class="rule-row no-link${info.homebrew ? ' hb' : ''}">${inner}</div>`);
    list.appendChild(row);
  });
  if (!matched.length) list.innerHTML = `<p class="muted">No rule matches “${esc(rulesState.q)}”.</p>`;
}
