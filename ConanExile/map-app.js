/* Shared viewer for the Conan Exiles Korean maps (Leaflet 1.9).
 * The page defines DATA (records, groups, labels, icons, defaultTypes) and CONFIG
 * (tiles, bounds, minZoom, maxZoom, maxNativeZoom, attribution, coord).
 * Built by tools/build_map.py; this file is hand-written and shared by every map page. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const R = DATA.records;
  const DEFAULTS = DATA.defaultTypes || DATA.groups[0].types;
  const selected = new Set(DEFAULTS);
  const counts = {};
  const bounds = L.latLngBounds(CONFIG.bounds);

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

  // --- markers: created lazily, only the ones inside the (padded) viewport live in the DOM
  const iconCache = {};
  function iconFor(type) {
    let icon = iconCache[type];
    if (!icon) {
      const src = DATA.icons[type];
      icon = src ? L.icon({ iconUrl: src, iconSize: [25, 25], iconAnchor: [12, 12] })
                 : L.divIcon({ html: '◆', className: 'fallback-marker', iconSize: [16, 16] });
      iconCache[type] = icon;
    }
    return icon;
  }
  const markers = new Array(R.length);
  function markerFor(i) {
    let m = markers[i];
    if (!m) {
      const r = R[i];
      m = L.marker(r.ll, { icon: iconFor(r.type), title: r.ko + ' / ' + r.en, keyboard: false });
      m.on('click', () => show(i));
      markers[i] = m;
    }
    return m;
  }
  R.forEach(r => {
    counts[r.layer] = (counts[r.layer] || 0) + 1;
    r.ll = L.latLng(r.lat, r.lng);
    r.search = (r.ko + ' ' + r.en + ' ' + plain(r.info)).toLowerCase();
  });

  const onMap = new Set();
  function refreshMarkers() {
    const view = map.getBounds().pad(0.25);
    const want = new Set();
    for (let i = 0; i < R.length; i++) {
      const r = R[i];
      if (selected.has(r.layer) && view.contains(r.ll)) want.add(i);
    }
    for (const i of onMap) if (!want.has(i)) { map.removeLayer(markers[i]); onMap.delete(i); }
    for (const i of want) if (!onMap.has(i)) { markerFor(i).addTo(map); onMap.add(i); }
  }
  map.on('moveend', refreshMarkers);

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
    let n = 0;
    for (const r of R) if (selected.has(r.layer)) n++;
    $('status').textContent = '표시 중 ' + n.toLocaleString() + ' / 전체 ' + R.length.toLocaleString() + '개';
    refreshMarkers();
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

  // --- in-game coordinate badge
  const C = CONFIG.coord;
  map.on('mousemove', e => {
    const x = C.xScale * e.latlng.lng + C.xOffset, y = C.yScale * e.latlng.lat + C.yOffset;
    $('badge').textContent = '지도 좌표 X: ' + x.toFixed(0) + ' · Y: ' + y.toFixed(0);
  });

  // --- image lightbox for photos inside descriptions
  document.querySelectorAll('#info,#original').forEach(el => el.addEventListener('click', e => {
    const a = e.target.closest('a');
    if (a && a.querySelector('img')) { e.preventDefault(); $('largeImage').src = a.href; $('imageDialog').showModal(); }
  }));
  $('imageClose').onclick = () => $('imageDialog').close();

  // --- go
  fitFullMap(false);
  update();
  // Small hook for console debugging and the performance checks in tools/.
  window.conanMap = { map, selected, update, onMap, defaults: DEFAULTS };
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { map.invalidateSize(); if ($('detail').hidden) fitFullMap(false); }, 150);
  });
})();
