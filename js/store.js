// Данные приложения: места, отчёты, фото, поиск мест, резервная копия, догрузка погоды.
import { db } from './db.js';
import { uid, DAY, HOUR, fetchT } from './util.js';
import { fetchOverview, fetchRange } from './weather.js';

export const state = { spots: [], reports: [] };
const listeners = new Set();
export const onChange = fn => listeners.add(fn);
const emit = what => listeners.forEach(fn => fn(what));

export async function load() {
  const [spots, reports] = await Promise.all([db.all('spots'), db.all('reports')]);
  state.spots = spots || [];
  state.reports = reports || [];
}

export const spotById = id => state.spots.find(s => s.id === id) || null;
export const reportById = id => state.reports.find(r => r.id === id) || null;
export const reportsOf = spotId => state.reports.filter(r => r.spotId === spotId).sort((a, b) => b.startMs - a.startMs);

function upsert(arr, v) {
  const i = arr.findIndex(x => x.id === v.id);
  if (i === -1) arr.push(v); else arr[i] = v;
}

export async function saveSpot(spot) {
  await db.put('spots', spot);
  upsert(state.spots, spot);
  emit('spots');
}

export async function deleteSpot(id) {
  const reps = reportsOf(id);
  const photoIds = reps.flatMap(r => r.photos || []);
  await delPhotos(photoIds);
  await db.delMany('reports', reps.map(r => r.id));
  await db.del('spots', id);
  state.reports = state.reports.filter(r => r.spotId !== id);
  state.spots = state.spots.filter(s => s.id !== id);
  emit('spots');
}

export async function saveReport(r) {
  await db.put('reports', r);
  upsert(state.reports, r);
  emit('reports');
}

export async function deleteReport(id) {
  const r = reportById(id);
  if (!r) return;
  await delPhotos(r.photos || []);
  await db.del('reports', id);
  state.reports = state.reports.filter(x => x.id !== id);
  emit('reports');
}

// ---------- Новое место ----------
export function newSpot(lat, lon) {
  return {
    id: uid(), lat, lon,
    name: '', place: '', region: '',
    note: '',
    createdAt: Date.now(),
    createdWeather: null,
    live: null,
  };
}

// Неделя погоды до момента ms из обзорного ответа.
export function weekBefore(wx, ms) {
  if (!wx) return null;
  const hours = wx.hours.filter(h => h.t > ms - 7 * DAY && h.t <= ms + HOUR);
  if (hours.length < 24) return null;
  return { ...wx, current: null, hours, days: wx.days.filter(d => d.t >= ms - 8 * DAY && d.t <= ms) };
}

export function uniqueName(base) {
  const names = new Set(state.spots.map(s => s.name));
  if (!names.has(base)) return base;
  for (let i = 2; i < 999; i++) if (!names.has(`${base} · ${i}`)) return `${base} · ${i}`;
  return base;
}

export function nextNumberName() {
  let n = state.spots.length + 1;
  while (state.spots.some(s => s.name === 'Место №' + n)) n++;
  return 'Место №' + n;
}

// ---------- Фото ----------
const urls = new Map();

export async function addPhoto(blob, w, h) {
  const id = uid();
  const buf = await blob.arrayBuffer();
  await db.put('photos', { id, type: blob.type || 'image/jpeg', buf, w, h, createdAt: Date.now() });
  return id;
}

export async function photoURL(id) {
  if (urls.has(id)) return urls.get(id);
  const p = await db.get('photos', id);
  if (!p) return null;
  const u = URL.createObjectURL(new Blob([p.buf], { type: p.type }));
  urls.set(id, u);
  return u;
}

export async function delPhotos(ids) {
  if (!ids.length) return;
  ids.forEach(id => { const u = urls.get(id); if (u) { URL.revokeObjectURL(u); urls.delete(id); } });
  await db.delMany('photos', ids);
}

export async function compressImage(file, max = 1600, q = 0.82) {
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('Не удалось открыть фото'));
      i.src = src;
    });
    let w = img.naturalWidth, h = img.naturalHeight;
    const k = Math.min(1, max / Math.max(w, h));
    w = Math.round(w * k); h = Math.round(h * k);
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    c.getContext('2d').drawImage(img, 0, 0, w, h);
    const blob = await new Promise(res => c.toBlob(res, 'image/jpeg', q));
    if (!blob) throw new Error('Не удалось сжать фото');
    return { blob, w, h };
  } finally {
    URL.revokeObjectURL(src);
  }
}

// ---------- Поиск и названия мест (OpenStreetMap Nominatim) ----------
const NOM = 'https://nominatim.openstreetmap.org';
const revCache = new Map();

function placeFrom(j) {
  const a = j.address || {};
  const locality = a.village || a.town || a.city || a.hamlet || a.isolated_dwelling || a.suburb || a.municipality || null;
  const isWater = ['natural', 'waterway', 'water'].includes(j.category) || ['water', 'river', 'lake', 'reservoir', 'bay', 'stream', 'canal', 'pond'].includes(j.type) || j.addresstype === 'water';
  const name = (isWater && j.name) || j.name || locality || a.county || a.state || '';
  const sub = [locality && locality !== name ? locality : null, a.county && a.county !== name ? a.county : null, a.state && a.state !== name ? a.state : null]
    .filter(Boolean).slice(0, 2).join(', ');
  return { name, sub };
}

export async function reverse(lat, lon) {
  const key = lat.toFixed(3) + ',' + lon.toFixed(3);
  if (revCache.has(key)) return revCache.get(key);
  const p = new URLSearchParams({ format: 'jsonv2', lat: lat.toFixed(5), lon: lon.toFixed(5), zoom: 14, 'accept-language': 'ru', addressdetails: 1 });
  const r = await fetchT(`${NOM}/reverse?${p}`, 10000);
  if (!r.ok) throw new Error('reverse ' + r.status);
  const j = await r.json();
  const out = j && !j.error ? placeFrom(j) : null;
  revCache.set(key, out);
  return out;
}

export async function search(q, near) {
  const p = new URLSearchParams({ format: 'jsonv2', q, limit: 7, 'accept-language': 'ru', addressdetails: 1 });
  if (near) {
    const d = 3;
    p.set('viewbox', [near.lon - d, near.lat + d, near.lon + d, near.lat - d].map(v => v.toFixed(3)).join(','));
  }
  const r = await fetchT(`${NOM}/search?${p}`, 12000);
  if (!r.ok) throw new Error('search ' + r.status);
  const list = await r.json();
  return list.map(j => {
    const pl = placeFrom(j);
    return {
      name: j.name || pl.name || j.display_name.split(',')[0],
      sub: pl.sub || j.display_name.split(',').slice(1, 3).join(',').trim(),
      lat: +j.lat, lon: +j.lon,
      bbox: j.boundingbox ? j.boundingbox.map(Number) : null, // [south, north, west, east]
    };
  });
}

// ---------- Погода для мест и отчётов ----------
export async function refreshSpotLive(spot) {
  const wx = await fetchOverview(spot.lat, spot.lon);
  spot.live = wx;
  if (!spot.createdWeather && Date.now() - spot.createdAt < 2 * DAY) {
    spot.createdWeather = weekBefore(wx, spot.createdAt);
  }
  await saveSpot(spot);
  return wx;
}

export async function reportWeather(spot, r) {
  return fetchRange(spot.lat, spot.lon, r.startMs - 7 * DAY, r.endMs);
}

let syncing = false;
// Догружаем погоду, которую не удалось получить без интернета.
export async function syncPending() {
  if (syncing || !navigator.onLine) return 0;
  syncing = true;
  let n = 0;
  try {
    for (const s of state.spots.filter(s => !s.createdWeather && !s.weatherGaveUp)) {
      try {
        const wx = await fetchRange(s.lat, s.lon, s.createdAt - 7 * DAY, s.createdAt);
        s.createdWeather = { ...wx, hours: wx.hours.filter(h => h.t <= s.createdAt + HOUR) };
        await saveSpot(s); n++;
      } catch (e) {
        if (!navigator.onLine) break;
        s.weatherTries = (s.weatherTries || 0) + 1;
        if (s.weatherTries >= 5) s.weatherGaveUp = true;
        await saveSpot(s);
      }
    }
    for (const r of state.reports.filter(r => r.weatherPending)) {
      const s = spotById(r.spotId);
      if (!s) continue;
      if (r.endMs > Date.now() + 14 * DAY) continue;
      try {
        r.weather = await reportWeather(s, r);
        r.weatherPending = false;
        await saveReport(r); n++;
      } catch {
        if (!navigator.onLine) break;
      }
    }
  } finally {
    syncing = false;
  }
  return n;
}

// ---------- Резервная копия ----------
const blobToB64 = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(',')[1] || '');
  fr.onerror = () => rej(fr.error);
  fr.readAsDataURL(blob);
});

export async function exportData() {
  const [spots, reports, photos] = await Promise.all([db.all('spots'), db.all('reports'), db.all('photos')]);
  const ph = [];
  for (const p of photos) {
    ph.push({ id: p.id, type: p.type, w: p.w, h: p.h, createdAt: p.createdAt, data: await blobToB64(new Blob([p.buf], { type: p.type })) });
  }
  const json = JSON.stringify({ app: 'klev', version: 1, exportedAt: new Date().toISOString(), spots, reports, photos: ph });
  return new Blob([json], { type: 'application/json' });
}

export async function importData(file) {
  let j;
  try { j = JSON.parse(await file.text()); } catch { throw new Error('Это не файл резервной копии'); }
  if (!j || j.app !== 'klev' || !Array.isArray(j.spots)) throw new Error('Файл не похож на копию из этого приложения');
  const photos = (j.photos || []).map(p => {
    const bin = atob(p.data || '');
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return { id: p.id, type: p.type || 'image/jpeg', w: p.w, h: p.h, createdAt: p.createdAt, buf: buf.buffer };
  });
  if (photos.length) await db.putMany('photos', photos);
  if (j.spots.length) await db.putMany('spots', j.spots);
  if ((j.reports || []).length) await db.putMany('reports', j.reports);
  await load();
  emit('all');
  return { spots: j.spots.length, reports: (j.reports || []).length, photos: photos.length };
}
