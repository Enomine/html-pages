/* Shared viewer for the Conan Exiles Korean maps (Leaflet 1.9).
 * The page defines DATA (records, groups, labels, icons, defaultTypes) and CONFIG
 * (tiles, bounds, minZoom, maxZoom, maxNativeZoom, attribution, coord).
 * Built by tools/build_map.py; this file is hand-written and shared by every map page.
 *
 * Markers are not DOM elements: all selected records are painted on one canvas
 * (IconCanvas below), so zooming with 4,000+ markers costs one redraw, not
 * thousands of style updates. Hover and click use a hit test on the painted points. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const R = DATA.records;
  const DEFAULTS = DATA.defaultTypes || DATA.groups[0].types;
  const selected = new Set(DEFAULTS);
  const counts = {};
  const bounds = L.latLngBounds(CONFIG.bounds);
  const ICON = 25, HALF = ICON / 2, HIT = 13;

  // CRS.Simple shifted so the map's north-west corner is pixel (0,0) at every zoom.
  // That is exactly how tools/build_map.py cuts the tiles: zoom 0 == 1px per map unit.
  const crs = L.extend({}, L.CRS.Simple, {
    transformation: new L.Transformation(1, -bounds.getWest(), -1, bounds.getNorth()),
  });

  const map = L.map('map', {
    crs,
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    zoomSnap: 0.25,
    zoomDelta: 1,
    maxBounds: bounds.pad(0.5),
    maxBoundsViscosity: 0.5,
  });

  L.tileLayer(CONFIG.tiles, {
    minZoom: CONFIG.minZoom,
    maxZoom: CONFIG.maxZoom,
    minNativeZoom: 0,
    maxNativeZoom: CONFIG.maxNativeZoom,
    bounds,
    noWrap: true,
    tileSize: 256,
    keepBuffer: 3,
    attribution: CONFIG.attribution,
  }).addTo(map);
  map.attributionControl.setPrefix('');

  function fitFullMap(animate) {
    map.setMinZoom(CONFIG.minZoom);
    const z = map.getBoundsZoom(bounds, false, L.point(24, 24));
    map.setMinZoom(z);  // never zoom out past the whole map
    map.fitBounds(bounds, { padding: [24, 24], animate: !!animate });
  }

  // --- text helpers (template content is inert: <img> inside never loads)
  const label = t => DATA.labels[t] || (t.endsWith('_named') ? '이름 있는 ' + (DATA.labels[t.slice(0, -6)] || t) : t);
  const tpl = document.createElement('template');
  function plain(s) { tpl.innerHTML = s || ''; return tpl.content.textContent || ''; }

  R.forEach((r, i) => {
    r.idx = i;
    counts[r.layer] = (counts[r.layer] || 0) + 1;
    r.ll = L.latLng(r.lat, r.lng);
    r.search = (r.ko + ' ' + r.en + ' ' + plain(r.info)).toLowerCase();
  });

  // --- icon images (one <img> per type, drawn onto the canvas)
  const iconImages = {};
  let redrawPending = false;
  function iconImage(type) {
    let img = iconImages[type];
    if (img === undefined) {
      const src = DATA.icons[type];
      if (!src) { img = null; }
      else {
        img = new Image();
        img.decoding = 'async';
        img.onload = () => { if (canvas) canvas.redraw(); };
        img.src = src;
      }
      iconImages[type] = img;
    }
    return img;
  }

  // --- IconCanvas: a Leaflet renderer that paints records as icons on one canvas.
  // L.Renderer already handles container placement and the CSS zoom animation;
  // we only size the canvas and paint.
  const IconCanvas = L.Renderer.extend({
    options: { padding: 0.1, pane: 'markerPane' },
    setItems(items) { this._items = items; this.redraw(); },
    redraw() {
      if (redrawPending || !this._map) return;
      redrawPending = true;
      L.Util.requestAnimFrame(() => { redrawPending = false; this._draw(); });
    },
    hitTest(layerPoint) {
      const items = this._items || [];
      for (let k = items.length - 1; k >= 0; k--) {   // topmost (drawn last) first
        const r = items[k];
        if (r.drawn && Math.abs(r.px - layerPoint.x) <= HIT && Math.abs(r.py - layerPoint.y) <= HIT) return r;
      }
      return null;
    },
    _initContainer() {
      this._container = document.createElement('canvas');
      this._container.style.pointerEvents = 'none';
      this._ctx = this._container.getContext('2d');
    },
    _destroyContainer() {
      L.DomUtil.remove(this._container);
      delete this._container;
      delete this._ctx;
    },
    _update() {
      if (this._map._animatingZoom && this._bounds) return;
      L.Renderer.prototype._update.call(this);
      const b = this._bounds, c = this._container, size = b.getSize();
      const m = Math.min(3, Math.max(1, window.devicePixelRatio || 1));
      L.DomUtil.setPosition(c, b.min);
      c.width = Math.round(m * size.x);
      c.height = Math.round(m * size.y);
      c.style.width = size.x + 'px';
      c.style.height = size.y + 'px';
      this._ctx.setTransform(m, 0, 0, m, -b.min.x * m, -b.min.y * m);
      this._draw();
    },
    _draw() {
      const ctx = this._ctx, b = this._bounds;
      if (!ctx || !b) return;
      const size = b.getSize();
      ctx.clearRect(b.min.x, b.min.y, size.x, size.y);
      const minX = b.min.x - ICON, minY = b.min.y - ICON, maxX = b.max.x + ICON, maxY = b.max.y + ICON;
      const items = this._items || [];
      for (let k = 0; k < items.length; k++) {
        const r = items[k];
        const p = this._map.latLngToLayerPoint(r.ll);
        r.px = p.x; r.py = p.y;
        r.drawn = p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY;
        if (!r.drawn) continue;
        const img = iconImage(r.type);
        if (img && img.complete && img.naturalWidth) {
          ctx.drawImage(img, p.x - HALF, p.y - HALF, ICON, ICON);
        } else {
          ctx.fillStyle = '#ffe0a1';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y - 7); ctx.lineTo(p.x + 7, p.y); ctx.lineTo(p.x, p.y + 7); ctx.lineTo(p.x - 7, p.y);
          ctx.closePath();
          ctx.fill();
        }
      }
    },
  });
  let canvas = null;
  let visible = [];

  // --- hover tooltip + click, driven by map events and the canvas hit test
  const style = document.createElement('style');
  style.textContent = '.marker-tip{position:absolute;z-index:1001;background:#17232dee;color:#eaf1f6;font-size:12px;' +
    'padding:4px 8px;border-radius:5px;pointer-events:none;white-space:nowrap;border:1px solid #536473}' +
    '.leaflet-container.has-hit{cursor:pointer}';
  document.head.append(style);
  const tip = L.DomUtil.create('div', 'marker-tip', map.getContainer());
  tip.hidden = true;
  let hovered = null;
  function setHover(r, containerPoint) {
    hovered = r;
    if (r) {
      tip.textContent = r.ko + ' / ' + r.en;
      tip.style.left = (containerPoint.x + 14) + 'px';
      tip.style.top = (containerPoint.y + 14) + 'px';
      tip.hidden = false;
      L.DomUtil.addClass(map.getContainer(), 'has-hit');
    } else {
      tip.hidden = true;
      L.DomUtil.removeClass(map.getContainer(), 'has-hit');
    }
  }
  map.on('click', e => { const r = canvas && canvas.hitTest(e.layerPoint); if (r) show(r.idx); });
  map.on('mouseout zoomstart dragstart', () => setHover(null));

  // --- filter sidebar
  const known = new Set(DATA.groups.flatMap(g => g.types));
  const extra = Object.keys(counts).filter(t => !known.has(t));
  if (extra.length) DATA.groups.push({ name: '추가 분류', types: extra });
  for (const [index, g] of DATA.groups.entries()) {
    const d = document.createElement('details');
    d.open = index === 0;
    const summary = document.createElement('summary');
    summary.textContent = g.name + ' ';
    const count = document.createElement('span');
    count.textContent = g.types.reduce((n, t) => n + (counts[t] || 0), 0).toLocaleString() + '개';
    summary.append(count);
    d.append(summary);
    const controls = document.createElement('div');
    controls.className = 'group-tools';
    for (const [text, on] of [['전체 선택', true], ['전체 해제', false]]) {
      const b = document.createElement('button');
      b.textContent = text;
      b.onclick = () => { g.types.forEach(t => on ? selected.add(t) : selected.delete(t)); update(); };
      controls.append(b);
    }
    d.append(controls);
    for (const t of g.types) {
      if (!counts[t]) continue;
      const row = document.createElement('label');
      row.className = 'filter';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.dataset.type = t;
      input.checked = selected.has(t);
      input.onchange = () => { input.checked ? selected.add(t) : selected.delete(t); update(); };
      row.append(input);
      const r = R.find(r => r.layer === t);
      if (r && DATA.icons[r.type]) {
        const img = document.createElement('img');
        img.src = DATA.icons[r.type];
        img.alt = '';
        row.append(img);
      }
      row.append(document.createTextNode(label(t)));
      const n = document.createElement('small');
      n.textContent = counts[t].toLocaleString();
      row.append(n);
      d.append(row);
    }
    $('filters').append(d);
  }

  function update() {
    document.querySelectorAll('[data-type]').forEach(el => { el.checked = selected.has(el.dataset.type); });
    visible = R.filter(r => selected.has(r.layer));
    visible.sort((a, b) => b.lat - a.lat);  // southern markers paint over northern ones, like DOM markers did
    $('status').textContent = '표시 중 ' + visible.length.toLocaleString() + ' / 전체 ' + R.length.toLocaleString() + '개';
    if (canvas) canvas.setItems(visible);
  }

  // --- detail panel
  let current = null, highlight = null;
  function show(i) {
    current = R[i];
    $('name').textContent = current.ko;
    $('ename').textContent = current.en;
    $('info').innerHTML = current.info || '원본에 추가 설명이 없습니다.';
    $('original').innerHTML = current.original || '원본에 추가 설명이 없습니다.';
    $('coords').textContent = current.coords || '기록된 이동 좌표가 없습니다.';
    $('copy').textContent = '좌표 복사';
    $('copy').disabled = !current.coords;
    $('detail').hidden = false;
    if (highlight) map.removeLayer(highlight);
    highlight = L.circleMarker(current.ll, { radius: 19, color: '#ffe0a1', weight: 3, fill: false }).addTo(map);
  }

  // --- search
  function results() {
    const q = $('search').value.trim().toLowerCase();
    $('results').hidden = !q;
    $('filters').hidden = !!q;
    if (!q) { update(); return; }
    const found = [];
    R.forEach((r, i) => { if (r.search.includes(q)) found.push(i); });
    $('status').textContent = '전체 분류 검색 결과 ' + found.length.toLocaleString() + '개' + (found.length > 100 ? ' · 처음 100개 표시' : '');
    $('results').replaceChildren();
    for (const i of found.slice(0, 100)) {
      const r = R[i], b = document.createElement('button');
      b.className = 'result';
      b.textContent = r.ko;
      const small = document.createElement('small');
      small.textContent = r.en + ' · ' + label(r.layer);
      b.append(small);
      b.onclick = () => { selected.add(r.layer); update(); map.setView(r.ll, 3); show(i); };
      $('results').append(b);
    }
  }
  let timer;
  $('search').oninput = () => { clearTimeout(timer); timer = setTimeout(results, 160); };

  // --- buttons
  $('all').onclick = () => { Object.keys(counts).forEach(t => selected.add(t)); update(); };
  $('none').onclick = () => { selected.clear(); update(); };
  $('default').onclick = () => { selected.clear(); DEFAULTS.forEach(t => selected.add(t)); update(); };
  $('home').onclick = () => fitFullMap(true);
  $('close').onclick = () => { $('detail').hidden = true; if (highlight) { map.removeLayer(highlight); highlight = null; } };
  $('copy').onclick = async () => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(current.coords);
      } else {
        const t = document.createElement('textarea');
        t.value = current.coords;
        t.style.position = 'fixed';
        t.style.opacity = '0';
        document.body.append(t);
        t.select();
        if (!document.execCommand('copy')) throw Error();
        t.remove();
      }
      $('copy').textContent = '복사했습니다';
    } catch (e) {
      $('copy').textContent = '좌표를 선택해 복사하세요';
    }
  };

  // --- in-game coordinate badge + hover
  const C = CONFIG.coord;
  map.on('mousemove', e => {
    const x = C.xScale * e.latlng.lng + C.xOffset, y = C.yScale * e.latlng.lat + C.yOffset;
    $('badge').textContent = '지도 좌표 X: ' + x.toFixed(0) + ' · Y: ' + y.toFixed(0);
    const r = canvas && !map._animatingZoom ? canvas.hitTest(e.layerPoint) : null;
    if (r !== hovered || r) setHover(r, e.containerPoint);
  });

  // --- image lightbox for photos inside descriptions
  document.querySelectorAll('#info,#original').forEach(el => el.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a && a.querySelector('img')) { e.preventDefault(); $('largeImage').src = a.href; $('imageDialog').showModal(); }
  }));
  $('imageClose').onclick = () => $('imageDialog').close();

  // --- go
  fitFullMap(false);
  canvas = new IconCanvas().addTo(map);
  update();
  // Small hook for console debugging and the performance checks in tools/.
  window.conanMap = { map, selected, update, canvas, defaults: DEFAULTS, visibleCount: () => visible.length };
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { map.invalidateSize(); if ($('detail').hidden) fitFullMap(false); }, 150);
  });
})();
