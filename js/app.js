/* The Lost Arcanum of Dahz — app shell: tiny hash-router, data loading, shared helpers.
   No dependencies. All views are plain functions that render into #view. */

const App = {
  data: {},           // cached JSON: lore, units, rules, map
  gm: false,          // GM mode (shows visibility:"gm" lore). Off = player-facing.
};

/* ---------- shared helpers ---------- */

// Fetch + cache a JSON file from data/. Throws with a friendly message.
async function loadJSON(name) {
  if (App.data[name]) return App.data[name];
  const res = await fetch(`data/${name}.json`);
  if (!res.ok) throw new Error(`Could not load data/${name}.json (${res.status})`);
  const json = await res.json();
  App.data[name] = json;
  return json;
}

// Escape untrusted-ish text before inserting as HTML (defensive; content is local).
function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Turn plain text with blank lines into escaped <p> paragraphs.
function paragraphs(text) {
  return String(text ?? '')
    .split(/\n\s*\n/)
    .map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

function showError(err) {
  document.getElementById('view').innerHTML =
    `<div class="card error"><h2>Something went wrong</h2><p>${esc(err.message || err)}</p>
     <p class="muted">If you opened this file directly, run a local server first — see README.</p></div>`;
}

/* ---------- GM toggle ---------- */

function initGmToggle() {
  App.gm = localStorage.getItem('wh-gm') === '1';
  const btn = document.getElementById('gm-toggle');
  if (!btn) { App.gm = false; return; } // published/player build ships no GM toggle
  const paint = () => {
    btn.setAttribute('aria-pressed', String(App.gm));
    btn.textContent = App.gm ? 'GM view: ON' : 'GM view: off';
    btn.classList.toggle('on', App.gm);
    document.body.classList.toggle('gm-on', App.gm);
  };
  btn.addEventListener('click', () => {
    App.gm = !App.gm;
    localStorage.setItem('wh-gm', App.gm ? '1' : '0');
    paint();
    router(); // re-render current view
  });
  paint();
}

/* ---------- router ---------- */

const routes = {
  codex: () => renderCodex(),
  army:  () => renderArmy(),
  rules: () => renderRules(),
  game:  () => renderGame(),
  map:   () => renderMap(),
};

function currentRoute() {
  return (location.hash.replace(/^#\/?/, '') || 'codex').split('/')[0];
}

async function router() {
  const route = currentRoute();
  document.querySelectorAll('.nav a').forEach(a => {
    a.classList.toggle('active', a.dataset.route === route);
  });
  const view = document.getElementById('view');
  view.innerHTML = '<div class="card muted">Loading…</div>';
  try {
    await (routes[route] || routes.codex)();
  } catch (err) {
    showError(err);
  }
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', () => {
  initGmToggle();
  router();
});
