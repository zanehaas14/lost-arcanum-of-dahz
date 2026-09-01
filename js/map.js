/* Map — interactive regions that link into the Codex. Placeholder until art is added. */

async function renderMap() {
  const map = await loadJSON('map');
  const view = document.getElementById('view');

  const hasImg = !!map.image;
  const stageInner = hasImg
    ? `<img src="assets/${esc(map.image)}" alt="World map" class="map-img">`
    : `<div class="map-placeholder"><p>No map image yet.</p>
         <p class="muted">Drop an image in <code>assets/</code> and set <code>"image"</code> in <code>data/map.json</code>.</p></div>`;

  view.innerHTML = `
    <section class="pillar">
      <div class="pillar-head">
        <h1>🗺️ Map</h1>
        <p class="muted">Click a region to open its Codex entry.</p>
      </div>
      <div class="map-stage" id="map-stage">
        ${stageInner}
      </div>
    </section>`;

  const stage = document.getElementById('map-stage');
  (map.regions || []).forEach(r => {
    const pin = el(`<button class="map-pin" style="left:${r.x}%;top:${r.y}%">
        <span class="pin-dot"></span><span class="pin-label">${esc(r.label)}</span>
      </button>`);
    pin.onclick = () => {
      if (r.loreId) location.hash = `#/codex/${encodeURIComponent(r.loreId)}`;
    };
    if (!r.loreId) pin.classList.add('no-link');
    stage.appendChild(pin);
  });
}
