// Клёв — карта, маршрутизация, геопозиция, шторки и окна.
import { $, $$, el, esc, copyText, isDesktop, fDist, HOUR } from './util.js';
import { icon, floatSVG } from './icons.js';
import { fetchOverview } from './weather.js';
import { L } from './map.js';
import { DEPTH_LAYERS } from './depth.js';
import * as S from './store.js';
import * as V from './views.js';

const sheet = $('#sheet');
const sheetBody = $('#sheet-body');
const page = $('#page');
const toastEl = $('#toast');

let map = null;
let spotLayer = null;
const spotMarkers = new Map();
let tmpPin = null;
let meMarker = null, meCircle = null;
let me = null;          // {lat, lon, acc, t}
let watchId = null;
let wantCenter = false;
let point = null;       // текущая точка в шторке: {lat, lon, name, sub, wx, node}
let currentSpot = null;
let navCount = 0;
let installEvt = null;
let layersMode = 'scheme';
const layers = {};

// ---------- запуск ----------
async function boot() {
  $$('[data-icon]').forEach(n => { n.insertAdjacentHTML('afterbegin', icon(n.dataset.icon)); });
  V.setCtx(ctx);
  try {
    await S.load();
  } catch (e) {
    toast('Хранилище недоступно: ' + e.message, 8000);
  }
  initUI();
  try {
    initMap();
  } catch (e) {
    $('#map').innerHTML = `<div class="map-err">${icon('wifiOff')}<p>Карта не запустилась: ${esc(e.message)}</p></div>`;
  }
  window.addEventListener('hashchange', () => { navCount++; route(); });
  route();
  initGeo();
  setTimeout(sync, 1500);
  window.addEventListener('online', () => { setOffline(false); sync(); });
  window.addEventListener('offline', () => setOffline(true));
  setOffline(!navigator.onLine);
  S.onChange(() => renderSpotMarkers());
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
}

async function sync() {
  const n = await S.syncPending().catch(() => 0);
  if (n) {
    toast('Погода подгрузилась для сохранённых записей');
    if (currentSpot && sheetKind() === 'spot') refreshSpot(currentSpot);
  }
}

function setOffline(off) {
  document.body.classList.toggle('offline', off);
}

// ---------- карта ----------
function savedView() {
  try { return JSON.parse(localStorage.getItem('klev:view') || 'null'); } catch { return null; }
}
function saveView() {
  try {
    const c = map.getCenter();
    localStorage.setItem('klev:view', JSON.stringify({ lat: c.lat, lon: c.lng, z: map.getZoom(), layer: layersMode }));
  } catch {}
}

function initMap() {
  const v = savedView();
  map = L.map('map', { minZoom: 3, maxZoom: 19 })
    .setView(v ? [v.lat, v.lon] : [55.75, 37.62], v ? v.z : 9);
  L.control.zoom({ position: 'bottomright', zoomInTitle: 'Приблизить', zoomOutTitle: 'Отдалить' }).addTo(map);
  layers.scheme = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>',
  });
  layers.sat = L.layerGroup([
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 18, attribution: 'Снимки © Esri, Maxar, Earthstar Geographics',
    }),
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19, maxNativeZoom: 18,
    }),
  ]);
  setLayer(v && v.layer === 'sat' ? 'sat' : 'scheme');
  spotLayer = L.layerGroup().addTo(map);
  renderSpotMarkers();
  map.on('click', e => openPoint(e.latlng.lat, e.latlng.lng));
  map.on('moveend', saveView);
  initDepth();
}

function setLayer(mode) {
  layersMode = mode;
  const other = mode === 'sat' ? 'scheme' : 'sat';
  if (map.hasLayer(layers[other])) map.removeLayer(layers[other]);
  if (!map.hasLayer(layers[mode])) layers[mode].addTo(map);
  $('#map').classList.toggle('is-sat', mode === 'sat');
  $('#btn-layers').setAttribute('aria-label', mode === 'sat' ? 'Показать схему' : 'Показать спутник');
  $('#btn-layers .lbl').textContent = mode === 'sat' ? 'Схема' : 'Спутник';
  saveView();
}

// ---------- слой глубин ----------
const depth = { layers: [], on: false, opacity: 0.85, adjust: false };

function depthState() {
  try { return JSON.parse(localStorage.getItem('klev:depth') || '{}'); } catch { return {}; }
}
function saveDepth() {
  try {
    localStorage.setItem('klev:depth', JSON.stringify({
      on: depth.on,
      opacity: depth.opacity,
      offsets: Object.fromEntries(depth.layers.map(d => [d.def.id, d.layer.getOffset()])),
    }));
  } catch {}
}

function initDepth() {
  if (!DEPTH_LAYERS.length) { $('#btn-depth').hidden = true; return; }
  const st = depthState();
  depth.opacity = st.opacity ?? 0.85;
  depth.layers = DEPTH_LAYERS.map(def => {
    const layer = L.imageOverlay(def.url, def.bounds, { opacity: depth.opacity, attribution: def.attribution, levels: def.levels, width: def.width });
    const off = st.offsets && st.offsets[def.id];
    if (off) layer.setOffset(off.lat, off.lng);
    return { def, layer };
  });
  $('#depth-name').textContent = DEPTH_LAYERS.map(d => d.name).join(', ');
  const op = $('#depth-opacity');
  op.value = Math.round(depth.opacity * 100);
  op.oninput = () => {
    depth.opacity = op.value / 100;
    depth.layers.forEach(d => d.layer.setOpacity(depth.opacity));
    saveDepth();
  };
  $('#btn-depth').onclick = () => setDepth(!depth.on, true);
  $('#depth-close').onclick = () => setDepth(false);
  $('#depth-go').onclick = fitDepth;
  $('#depth-move').onclick = () => setAdjust(true);
  $('#depth-done').onclick = () => { setAdjust(false); toast('Положение слоя сохранено'); };
  $('#depth-reset').onclick = () => {
    depth.layers.forEach(d => d.layer.setOffset(0, 0));
    saveDepth();
    toast('Слой на исходном месте');
  };
  if (st.on) setDepth(true, false);
}

function nearestDepth() {
  const c = map.getCenter();
  return depth.layers.map(d => {
    const b = d.layer.getBounds();
    return { d, b, dist: Math.hypot((b[0][0] + b[1][0]) / 2 - c.lat, (b[0][1] + b[1][1]) / 2 - c.lng) };
  }).sort((a, b) => a.dist - b.dist)[0];
}

function depthInView() {
  const s = map.getSize();
  const nw = map.containerPointToLatLng(L.point(0, 0)), se = map.containerPointToLatLng(L.point(s.x, s.y));
  return depth.layers.some(d => {
    const [[south, west], [north, east]] = d.layer.getBounds();
    return !(south > nw.lat || north < se.lat || west > se.lng || east < nw.lng);
  });
}

function fitDepth() {
  const n = nearestDepth();
  if (n) map.fitBounds(n.b, { padding: [24, 24], maxZoom: 17 });
}

function setDepth(on, byUser) {
  depth.on = on;
  if (!on) setAdjust(false);
  depth.layers.forEach(d => {
    if (on) { d.layer.addTo(map); bindDepthDrag(d); } else map.removeLayer(d.layer);
  });
  $('#btn-depth').classList.toggle('on', on);
  $('#btn-depth').setAttribute('aria-pressed', String(on));
  $('#depth-panel').hidden = !on;
  document.body.classList.toggle('depth-on', on);
  if (on && byUser) {
    if (layersMode !== 'sat') setLayer('sat');
    if (!depthInView()) fitDepth();
  }
  saveDepth();
}

function setAdjust(on) {
  depth.adjust = on;
  $('#depth-panel').classList.toggle('adjust', on);
  depth.layers.forEach(d => { const e = d.layer.getElement(); if (e) e.classList.toggle('adjusting', on); });
  if (on) toast('Тяните слой пальцем или мышью', 2500);
  else saveDepth();
}

// В режиме «Подвинуть» слой перетаскивается, а карта под ним стоит на месте.
function bindDepthDrag(d) {
  const e = d.layer.getElement();
  if (!e || e._drag) return;
  e._drag = true;
  if (depth.adjust) e.classList.add('adjusting');
  const rel = ev => { const r = $('#map').getBoundingClientRect(); return L.point(ev.clientX - r.left, ev.clientY - r.top); };
  e.addEventListener('pointerdown', ev => {
    if (!depth.adjust) return;
    ev.stopPropagation();
    ev.preventDefault();
    const start = map.containerPointToLatLng(rel(ev));
    const off0 = d.layer.getOffset();
    try { e.setPointerCapture(ev.pointerId); } catch {}
    const move = mv => {
      const p = map.containerPointToLatLng(rel(mv));
      d.layer.setOffset(off0.lat + p.lat - start.lat, off0.lng + p.lng - start.lng);
    };
    const up = () => {
      e.removeEventListener('pointermove', move);
      e.removeEventListener('pointerup', up);
      e.removeEventListener('pointercancel', up);
      saveDepth();
    };
    e.addEventListener('pointermove', move);
    e.addEventListener('pointerup', up);
    e.addEventListener('pointercancel', up);
  });
}

function spotIcon(spot, sel) {
  const n = S.reportsOf(spot.id).length;
  return L.divIcon({
    className: 'pin' + (sel ? ' sel' : ''),
    html: floatSVG() + (n ? `<b>${n}</b>` : ''),
    iconSize: [28, 40],
    iconAnchor: [14, 38],
  });
}

function renderSpotMarkers() {
  if (!map) return;
  spotLayer.clearLayers();
  spotMarkers.clear();
  S.state.spots.forEach(s => {
    const m = L.marker([s.lat, s.lon], { icon: spotIcon(s, s.id === currentSpot), title: s.name, keyboard: true, riseOnHover: true })
      .on('click', () => go('#spot-' + s.id));
    spotLayer.addLayer(m);
    spotMarkers.set(s.id, m);
  });
}

function setTmpPin(lat, lon) {
  if (!map) return;
  const ic = L.divIcon({ className: 'tmp-pin', html: '<i></i>', iconSize: [30, 30], iconAnchor: [15, 15] });
  if (!tmpPin) tmpPin = L.marker([lat, lon], { icon: ic, interactive: false, zIndexOffset: 500 }).addTo(map);
  else tmpPin.setLatLng([lat, lon]);
}
function clearTmpPin() {
  if (tmpPin && map) { map.removeLayer(tmpPin); }
  tmpPin = null;
}

// Сдвигаем карту так, чтобы точка была видна над шторкой (или правее панели на ПК).
function focus(lat, lon, zoom) {
  if (!map) return;
  const z = zoom ?? map.getZoom();
  let dx = 0, dy = 0;
  if (isDesktop()) {
    const panel = (!sheet.hidden && sheet) || (!page.hidden && page);
    if (panel) dx = -(panel.getBoundingClientRect().right) / 2;
  } else if (!sheet.hidden) {
    dy = sheet.getBoundingClientRect().height / 2;
  }
  const p = map.project([lat, lon], z).add(L.point(dx, dy));
  map.setView(map.unproject(p, z), z, { animate: true });
}

// ---------- геопозиция ----------
function initGeo() {
  if (!('geolocation' in navigator)) return;
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then(st => {
      if (st.state === 'granted') startWatch(!savedView());
    }).catch(() => {});
  }
}

function startWatch(center) {
  if (!('geolocation' in navigator)) { toast('Этот браузер не умеет определять местоположение'); return; }
  if (center) wantCenter = true;
  if (watchId != null) { if (me && center) centerOnMe(); return; }
  watchId = navigator.geolocation.watchPosition(onPos, onPosErr, { enableHighAccuracy: true, maximumAge: 10000, timeout: 30000 });
}

function centerOnMe() {
  wantCenter = false;
  if (!map || !me) return;
  focus(me.lat, me.lon, Math.max(map.getZoom(), 14));
}

function onPos(p) {
  me = { lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy, t: Date.now() };
  $('#btn-locate').classList.add('on');
  if (map) {
    if (!meMarker) {
      meCircle = L.circle([me.lat, me.lon], { radius: me.acc, stroke: false, fillColor: '#2f7fd1', fillOpacity: 0.12, interactive: false }).addTo(map);
      meMarker = L.marker([me.lat, me.lon], { icon: L.divIcon({ className: 'me', html: '<i></i>', iconSize: [22, 22], iconAnchor: [11, 11] }), interactive: false, zIndexOffset: 400 }).addTo(map);
    } else {
      meMarker.setLatLng([me.lat, me.lon]);
      meCircle.setLatLng([me.lat, me.lon]).setRadius(me.acc);
    }
  }
  if (wantCenter) centerOnMe();
}

function geoMsg(err) {
  return err.code === 1
    ? 'Нет доступа к геопозиции. Разрешите его для этого сайта в настройках браузера.'
    : err.code === 3 ? 'Не удалось быстро определить местоположение. Выйдите на открытое место и попробуйте ещё раз.'
      : 'Не удалось определить местоположение.';
}

function onPosErr(err) {
  if (err.code === 1) {
    if (watchId != null) navigator.geolocation.clearWatch(watchId);
    watchId = null;
    $('#btn-locate').classList.remove('on');
  }
  if (err.code === 1 || wantCenter) toast(geoMsg(err), 6000);
  wantCenter = false;
}

// Свежая точка для «Метка здесь»: разовый запрос, плюс слежение для синей точки.
function getHere() {
  if (me && Date.now() - me.t < 20000 && me.acc < 150) return Promise.resolve(me);
  if (!('geolocation' in navigator)) return Promise.reject(new Error('Этот браузер не умеет определять местоположение'));
  return new Promise((res, rej) => {
    navigator.geolocation.getCurrentPosition(
      p => { onPos(p); res(me); },
      err => {
        if (err.code !== 1 && me && Date.now() - me.t < 5 * 60e3) { res(me); return; }
        rej(new Error(geoMsg(err)));
      },
      { enableHighAccuracy: true, timeout: 25000, maximumAge: 15000 },
    );
    startWatch(false);
  });
}

// ---------- точка на карте ----------
async function openPoint(lat, lon, preset = {}) {
  point = { lat, lon, name: preset.name || '', sub: preset.sub || '', wx: null };
  setTmpPin(lat, lon);
  currentSpot = null;
  highlightSpot(null);
  const node = V.pointSheet(point);
  point.node = node;
  openSheet(node, 'point');
  focus(lat, lon);
  if (location.hash !== '#point') { go('#point'); }
  const my = point;
  if (!preset.name) {
    S.reverse(lat, lon).then(pl => { if (point === my && pl) { my.name = pl.name; my.sub = pl.sub; V.setPointPlace(node, pl); } }).catch(() => {
      if (point === my) V.setPointPlace(node, { name: 'Точка на карте', sub: '' });
    });
  }
  loadPointWx(my);
}

async function loadPointWx(my) {
  const box = $('[data-f=wx]', my.node);
  try {
    const wx = await fetchOverview(my.lat, my.lon);
    if (point !== my) return;
    my.wx = wx;
    V.setWx(box, wx);
  } catch (e) {
    if (point !== my) return;
    V.setWxError(box, e.message, () => { box.innerHTML = '<div class="wx-loading"><span class="spin"></span>Загружаю погоду…</div>'; loadPointWx(my); });
  }
}

async function createSpotAt(lat, lon, { wx, name, sub } = {}) {
  const spot = S.newSpot(lat, lon);
  spot.name = name ? S.uniqueName(name) : S.nextNumberName();
  spot.place = name || '';
  spot.region = sub || '';
  if (wx && Date.now() - wx.fetchedAt < 2 * HOUR) {
    spot.live = wx;
    spot.createdWeather = S.weekBefore(wx, spot.createdAt);
  }
  await S.saveSpot(spot);
  try { navigator.storage?.persist?.(); } catch {}
  // название и погода догружаются в фоне
  (async () => {
    let changed = false;
    if (!name) {
      try {
        const pl = await S.reverse(lat, lon);
        if (pl && pl.name) {
          spot.place = pl.name; spot.region = pl.sub;
          if (/^Место №\d+$/.test(spot.name)) spot.name = S.uniqueName(pl.name);
          changed = true;
        }
      } catch {}
    }
    if (!spot.live) {
      try { await S.refreshSpotLive(spot); changed = true; } catch {}
    }
    if (changed) {
      await S.saveSpot(spot);
      if (currentSpot === spot.id && sheetKind() === 'spot') refreshSpot(spot.id);
    }
  })();
  return spot;
}

async function savePoint() {
  if (!point) return;
  const p = point;
  const spot = await createSpotAt(p.lat, p.lon, { wx: p.wx, name: p.name && p.name !== 'Точка на карте' ? p.name : '', sub: p.sub });
  point = null;
  clearTmpPin();
  toast('Метка сохранена');
  location.replace('#spot-' + spot.id);
}

async function markHere() {
  const b = $('#btn-mark-here');
  if (b.disabled) return;
  b.disabled = true;
  const lbl = $('.lbl', b);
  const t0 = lbl.textContent;
  lbl.textContent = 'Определяю место…';
  try {
    const pos = await getHere();
    const spot = await createSpotAt(pos.lat, pos.lon);
    toast(pos.acc > 100 ? `Метка поставлена. Точность около ${fDist(pos.acc / 1000)}` : 'Метка поставлена');
    go('#spot-' + spot.id);
  } catch (e) {
    toast(e.message, 6000);
  } finally {
    b.disabled = false;
    lbl.textContent = t0;
  }
}

// ---------- шторка ----------
let sheetKindV = null;
const sheetKind = () => sheetKindV;

function openSheet(node, kind) {
  sheetBody.replaceChildren(node);
  sheetBody.scrollTop = 0;
  sheetKindV = kind;
  if (sheet.hidden) {
    sheet.hidden = false;
    sheet.dataset.size = 'half';
  }
  document.body.classList.add('has-sheet');
}

function closeSheet() {
  if (sheet.hidden) return;
  sheet.hidden = true;
  sheet.style.height = '';
  sheetBody.replaceChildren();
  sheetKindV = null;
  document.body.classList.remove('has-sheet');
  clearTmpPin();
  point = null;
  if (currentSpot) { currentSpot = null; highlightSpot(null); }
}

function initSheetGrip() {
  const grip = $('#sheet-grip');
  let startY = 0, startH = 0, dragging = false, moved = false;
  grip.addEventListener('pointerdown', e => {
    if (isDesktop()) return;
    dragging = true; moved = false;
    startY = e.clientY;
    startH = sheet.getBoundingClientRect().height;
    grip.setPointerCapture(e.pointerId);
    sheet.classList.add('dragging');
  });
  grip.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = startY - e.clientY;
    if (Math.abs(dy) > 4) moved = true;
    const max = window.innerHeight - 90;
    sheet.style.height = Math.max(80, Math.min(max, startH + dy)) + 'px';
  });
  const end = e => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('dragging');
    const h = sheet.getBoundingClientRect().height;
    sheet.style.height = '';
    if (!moved) { sheet.dataset.size = sheet.dataset.size === 'full' ? 'half' : 'full'; return; }
    const vh = window.innerHeight;
    if (h < vh * 0.24) go('#map');
    else sheet.dataset.size = h > vh * 0.62 ? 'full' : 'half';
  };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
  grip.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sheet.dataset.size = sheet.dataset.size === 'full' ? 'half' : 'full'; }
  });
}

function highlightSpot(id) {
  spotMarkers.forEach((m, sid) => {
    const e = m.getElement && m.getElement();
    if (e) e.classList.toggle('sel', sid === id);
  });
}

function openSpot(id) {
  const spot = S.spotById(id);
  if (!spot) { toast('Место не найдено'); location.replace('#map'); return; }
  const same = currentSpot === id && sheetKind() === 'spot';
  clearTmpPin();
  point = null;
  currentSpot = id;
  const node = V.spotSheet(spot);
  openSheet(node, 'spot');
  highlightSpot(id);
  if (!same) focus(spot.lat, spot.lon, map ? Math.max(map.getZoom(), 13) : undefined);
  V.loadSpotWeather(spot, node);
}

function refreshSpot(id) {
  renderSpotMarkers();
  if (currentSpot === id && sheetKind() === 'spot') {
    const top = sheetBody.scrollTop;
    const spot = S.spotById(id);
    if (!spot) return;
    const node = V.spotSheet(spot);
    sheetBody.replaceChildren(node);
    sheetBody.scrollTop = top;
    highlightSpot(id);
    V.loadSpotWeather(spot, node);
  }
}

// ---------- страницы ----------
function showPage(node, deep) {
  page.replaceChildren(node);
  page.hidden = false;
  page.classList.toggle('deep', !!deep);
  page.scrollTop = 0;
  document.body.classList.add('has-page');
  document.body.classList.toggle('deep-page', !!deep);
}
function hidePage() {
  if (page.hidden) return;
  page.hidden = true;
  page.replaceChildren();
  document.body.classList.remove('has-page', 'deep-page');
}

function setTab(t) {
  $$('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === t));
}

function route() {
  const h = decodeURIComponent(location.hash.slice(1)) || 'map';
  const i = h.indexOf('-');
  const kind = i === -1 ? h : h.slice(0, i);
  const id = i === -1 ? '' : h.slice(i + 1);
  closeModal(false);
  closeViewer();
  $('#search-results').hidden = true;
  switch (kind) {
    case 'map':
      hidePage(); closeSheet(); setTab('map'); break;
    case 'point':
      hidePage(); setTab('map');
      if (!point) location.replace('#map');
      break;
    case 'spot':
      hidePage(); setTab('map'); openSpot(id); break;
    case 'spots':
      closeSheet(); showPage(V.spotsPage(), false); setTab('spots'); break;
    case 'journal':
      closeSheet(); showPage(V.journalPage(), false); setTab('journal'); break;
    case 'report':
      showPage(V.reportPage(id), true); break;
    case 'new':
      showPage(V.formPage({ spotId: id }), true); break;
    case 'edit':
      showPage(V.formPage({ reportId: id }), true); break;
    case 'settings':
      showPage(V.settingsPage(), true); break;
    default:
      location.replace('#map');
  }
  if (map) setTimeout(() => map.invalidateSize(), 50);
}

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}
function back(fallback) {
  if (navCount > 0 && history.length > 1) history.back();
  else location.replace(fallback || '#map');
}

// ---------- окна, тосты, просмотр фото ----------
let toastT;
function toast(msg, ms = 3200) {
  toastEl.textContent = msg;
  toastEl.hidden = false;
  toastEl.classList.remove('show');
  void toastEl.offsetWidth;
  toastEl.classList.add('show');
  clearTimeout(toastT);
  toastT = setTimeout(() => { toastEl.classList.remove('show'); setTimeout(() => { toastEl.hidden = true; }, 250); }, ms);
}

const modal = $('#modal');
let modalDone = null;
function closeModal(val) {
  if (modal.hidden) return;
  modal.hidden = true;
  modal.replaceChildren();
  const f = modalDone; modalDone = null;
  if (f) f(val);
}
function openModal(node) {
  return new Promise(res => {
    closeModal(null);
    modal.replaceChildren(node);
    modal.hidden = false;
    modalDone = res;
    const first = node.querySelector('input, textarea, button.accent, button.danger-fill');
    setTimeout(() => first && first.focus(), 30);
  });
}
modal.addEventListener('click', e => { if (e.target === modal) closeModal(null); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { if (!modal.hidden) closeModal(null); else if (!$('#viewer').hidden) closeViewer(); }
});

function ask({ title, text = '', ok = 'Да', danger = false }) {
  const node = el(`<div class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3>${text ? `<p>${esc(text)}</p>` : ''}
    <div class="dlg-btns"><button type="button" class="btn" data-v="0">Отмена</button><button type="button" class="btn ${danger ? 'danger-fill' : 'accent'}" data-v="1">${esc(ok)}</button></div>
  </div>`);
  $$('[data-v]', node).forEach(b => { b.onclick = () => closeModal(b.dataset.v === '1'); });
  return openModal(node).then(v => !!v);
}

function askText({ title, value = '', placeholder = '', multiline = false, ok = 'Сохранить' }) {
  const node = el(`<form class="dlg" role="dialog" aria-modal="true" aria-label="${esc(title)}">
    <h3>${esc(title)}</h3>
    ${multiline ? `<textarea id="dlg-in" rows="5" placeholder="${esc(placeholder)}">${esc(value)}</textarea>` : `<input id="dlg-in" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">`}
    <div class="dlg-btns"><button type="button" class="btn" data-v="0">Отмена</button><button type="submit" class="btn accent">${esc(ok)}</button></div>
  </form>`);
  $('[data-v]', node).onclick = () => closeModal(null);
  node.onsubmit = e => { e.preventDefault(); closeModal($('#dlg-in', node).value); };
  return openModal(node);
}

const viewerEl = $('#viewer');
let vState = null;
async function viewer(ids, i) {
  vState = { ids, i };
  viewerEl.hidden = false;
  viewerEl.innerHTML = `<img alt=""><div class="v-bar"><span class="v-n"></span><button type="button" class="icon-btn" data-v="x" aria-label="Закрыть">${icon('close')}</button></div>
    ${ids.length > 1 ? `<button type="button" class="v-nav prev" aria-label="Предыдущее">${icon('back')}</button><button type="button" class="v-nav next" aria-label="Следующее">${icon('chevron')}</button>` : ''}`;
  $('[data-v=x]', viewerEl).onclick = closeViewer;
  const prev = $('.prev', viewerEl), next = $('.next', viewerEl);
  if (prev) prev.onclick = () => showV(-1);
  if (next) next.onclick = () => showV(1);
  let x0 = null;
  viewerEl.onpointerdown = e => { x0 = e.clientX; };
  viewerEl.onpointerup = e => { if (x0 != null && Math.abs(e.clientX - x0) > 50) showV(e.clientX < x0 ? 1 : -1); x0 = null; };
  showV(0);
}
async function showV(d) {
  if (!vState) return;
  const n = vState.ids.length;
  vState.i = (vState.i + d + n) % n;
  $('.v-n', viewerEl).textContent = n > 1 ? `${vState.i + 1} из ${n}` : '';
  $('img', viewerEl).src = (await S.photoURL(vState.ids[vState.i])) || '';
}
function closeViewer() {
  if (viewerEl.hidden) return;
  viewerEl.hidden = true;
  viewerEl.replaceChildren();
  vState = null;
}

// ---------- поиск ----------
function initSearch() {
  const form = $('#search'), input = $('#search-q'), clear = $('#search-clear'), box = $('#search-results');
  input.addEventListener('input', () => { clear.hidden = !input.value; });
  clear.onclick = () => { input.value = ''; clear.hidden = true; box.hidden = true; input.focus(); };
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const q = input.value.trim();
    if (q.length < 2) return;
    input.blur();
    const m = q.match(/^\s*(-?\d{1,2}(?:[.,]\d+)?)\s*[,; ]\s*(-?\d{1,3}(?:[.,]\d+)?)\s*$/);
    if (m) {
      const lat = +m[1].replace(',', '.'), lon = +m[2].replace(',', '.');
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
        box.hidden = true;
        if (map) map.setView([lat, lon], Math.max(map.getZoom(), 13));
        openPoint(lat, lon);
        return;
      }
    }
    box.hidden = false;
    box.innerHTML = '<div class="sr-msg"><span class="spin"></span>Ищу…</div>';
    try {
      const c = map ? map.getCenter() : null;
      const list = await S.search(q, c ? { lat: c.lat, lon: c.lng } : null);
      if (!list.length) { box.innerHTML = '<div class="sr-msg">Ничего не нашлось. Попробуйте иначе: «озеро Сенеж», «Волга Тверь».</div>'; return; }
      box.innerHTML = list.map((r, i) => `<button type="button" class="sr" data-i="${i}">${icon('pin')}<span><b>${esc(r.name)}</b><small>${esc(r.sub)}</small></span></button>`).join('');
      $$('.sr', box).forEach(b => {
        b.onclick = () => {
          const r = list[+b.dataset.i];
          box.hidden = true;
          if (!page.hidden) { hidePage(); setTab('map'); }
          if (map) {
            if (r.bbox && Math.abs(r.bbox[1] - r.bbox[0]) > 0.005) map.fitBounds([[r.bbox[0], r.bbox[2]], [r.bbox[1], r.bbox[3]]], { maxZoom: 14, padding: [30, 30] });
            else map.setView([r.lat, r.lon], 14);
          }
          openPoint(r.lat, r.lon, { name: r.name, sub: r.sub });
        };
      });
    } catch {
      box.innerHTML = '<div class="sr-msg">Поиск не удался. Проверьте интернет.</div>';
    }
  });
  document.addEventListener('pointerdown', e => {
    if (!box.hidden && !e.target.closest('#search-results, #search')) box.hidden = true;
  });
}

// ---------- кнопки ----------
function initUI() {
  initSheetGrip();
  initSearch();
  $('#btn-locate').onclick = () => {
    if (me && map) { centerOnMe(); }
    startWatch(true);
  };
  $('#btn-layers').onclick = () => map && setLayer(layersMode === 'sat' ? 'scheme' : 'sat');
  $('#btn-mark-here').onclick = markHere;
  document.addEventListener('click', async e => {
    const c = e.target.closest('[data-copy]');
    if (!c) return;
    e.preventDefault();
    toast((await copyText(c.dataset.copy)) ? 'Координаты скопированы' : c.dataset.copy);
  });
  $$('#tabbar a').forEach(a => a.addEventListener('click', e => {
    if (a.getAttribute('href') === location.hash) { e.preventDefault(); route(); }
  }));
}

// ---------- контекст для экранов ----------
const ctx = {
  go, back,
  replace: h => location.replace(h),
  toast, ask, askText, viewer,
  me: () => me,
  savePoint,
  refreshSpot,
  refreshMarkers: renderSpotMarkers,
  canInstall: () => !!installEvt,
  install: async () => { if (!installEvt) return; installEvt.prompt(); try { await installEvt.userChoice; } catch {} installEvt = null; },
};

boot();
