// Общие помощники: даты, числа, форматирование, сеть.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const pad = n => String(n).padStart(2, '0');
export const DAY = 864e5;
export const HOUR = 36e5;

export const DOW = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
export const DOW_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
export const MON_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const MON_FULL = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];

// Время «по месту»: сдвигаем на смещение пояса (в секундах) и читаем UTC-поля.
export const shift = (ms, off) => new Date(ms + off * 1000);
export const devOff = (ms = Date.now()) => -new Date(ms).getTimezoneOffset() * 60;

export function fTime(ms, off = devOff(ms)) {
  const d = shift(ms, off);
  return pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes());
}
export function fDay(ms, off = devOff(ms)) {
  const d = shift(ms, off);
  return DOW[d.getUTCDay()] + ' ' + d.getUTCDate();
}
export function fDate(ms, off = devOff(ms), withYear) {
  const d = shift(ms, off);
  const y = d.getUTCFullYear();
  const s = d.getUTCDate() + ' ' + MON_GEN[d.getUTCMonth()];
  return (withYear ?? y !== new Date().getFullYear()) ? s + ' ' + y : s;
}
// 'YYYY-MM-DD' → '27 октября' (+ год, если не текущий)
export function fDateISO(iso, withYear) {
  const [y, m, d] = iso.split('-').map(Number);
  const s = d + ' ' + MON_GEN[m - 1];
  return (withYear ?? y !== new Date().getFullYear()) ? s + ' ' + y : s;
}
export function dowISO(iso, full) {
  const [y, m, d] = iso.split('-').map(Number);
  const i = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return full ? DOW_FULL[i] : DOW[i];
}
export function todayISO() {
  const d = new Date();
  return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
}
export function nowHM() {
  const d = new Date();
  return pad(d.getHours()) + ':' + pad(d.getMinutes());
}

export function num(v, digits = 0) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('ru-RU', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
// число без лишних нулей: 1,5 / 2 / 0,25
export function numT(v, max = 2) {
  if (v == null || Number.isNaN(v)) return '—';
  return Number(v).toLocaleString('ru-RU', { maximumFractionDigits: max });
}
export function signed(v, digits = 1) {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Number(v.toFixed(digits));
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + num(Math.abs(r), digits);
}
export function temp(v) {
  if (v == null || Number.isNaN(v)) return '—';
  const r = Math.round(v);
  return (r > 0 ? '+' : r < 0 ? '−' : '') + Math.abs(r) + '°';
}

export const HPA2MM = 0.750062;
export const toMM = h => (h == null ? null : h * HPA2MM);

const WD = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
const WD_FULL = ['северный', 'северо-восточный', 'восточный', 'юго-восточный', 'южный', 'юго-западный', 'западный', 'северо-западный'];
const wdi = d => Math.round((((d % 360) + 360) % 360) / 45) % 8;
export const compass = d => (d == null ? '—' : WD[wdi(d)]);
export const compassFull = d => (d == null ? '' : WD_FULL[wdi(d)]);

export function distKm(a, b) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}
export function fDist(km) {
  if (km == null) return '';
  if (km < 1) return Math.round(km * 1000 / 10) * 10 + ' м';
  if (km < 10) return num(km, 1) + ' км';
  return num(Math.round(km)) + ' км';
}
export const fCoord = (lat, lon) => lat.toFixed(5) + ', ' + lon.toFixed(5);

export function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}
export function fDuration(min) {
  min = Math.max(0, Math.round(min));
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return m + ' мин';
  return h + ' ч' + (m ? ' ' + m + ' мин' : '');
}

export async function fetchT(url, ms = 15000, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;opacity:0;left:-1000px';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch {}
    ta.remove();
    return ok;
  }
}

export const isDesktop = () => matchMedia('(min-width: 880px)').matches;
