// Погода: Open-Meteo (бесплатно, без ключа), разбор ответа, давление, луна.
import { fetchT, toMM, DAY, HOUR } from './util.js';

const API = 'https://api.open-meteo.com/v1/forecast';
const ARCHIVE = 'https://archive-api.open-meteo.com/v1/archive';

const HOURLY = 'temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code';
const DAILY = 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,wind_speed_10m_max,wind_gusts_10m_max,wind_direction_10m_dominant,sunrise,sunset';
const CURRENT = 'temperature_2m,relative_humidity_2m,surface_pressure,pressure_msl,precipitation,cloud_cover,wind_speed_10m,wind_direction_10m,wind_gusts_10m,weather_code,is_day';

async function getJSON(url) {
  let r;
  try {
    r = await fetchT(url, 15000);
  } catch {
    throw new Error('Нет связи с погодным сервисом');
  }
  if (!r.ok) {
    let reason = '';
    try { reason = (await r.json()).reason || ''; } catch {}
    throw new Error('Погода недоступна' + (reason ? ': ' + reason : ` (код ${r.status})`));
  }
  return r.json();
}

const base = (lat, lon) => ({
  latitude: lat.toFixed(4),
  longitude: lon.toFixed(4),
  timezone: 'auto',
  timeformat: 'unixtime',
  wind_speed_unit: 'ms',
});

// Сейчас + 7 дней назад + прогноз на 7 дней.
export async function fetchOverview(lat, lon) {
  const p = new URLSearchParams({ ...base(lat, lon), current: CURRENT, hourly: HOURLY, daily: DAILY, past_days: 7, forecast_days: 7 });
  return normalize(await getJSON(API + '?' + p), lat, lon);
}

const isoUTC = ms => new Date(ms).toISOString().slice(0, 10);

// Почасовая погода за произвольный промежуток (для отчётов и меток).
// Последние ~3 месяца берём из прогнозного API, всё что старше — из архива.
export async function fetchRange(lat, lon, fromMs, toMs) {
  const now = Date.now();
  const archive = fromMs < now - 80 * DAY;
  const start = fromMs - DAY;
  let end = toMs + DAY;
  end = archive ? Math.min(end, now - 6 * DAY) : Math.min(end, now + 14 * DAY);
  if (end < start) throw new Error('Для этих дат погоды ещё нет');
  const p = new URLSearchParams({ ...base(lat, lon), hourly: HOURLY, daily: DAILY, start_date: isoUTC(start), end_date: isoUTC(end) });
  const wx = normalize(await getJSON((archive ? ARCHIVE : API) + '?' + p), lat, lon);
  wx.hours = wx.hours.filter(h => h.t >= fromMs - 2 * HOUR && h.t <= toMs + 12 * HOUR);
  wx.days = wx.days.filter(d => d.t >= fromMs - DAY && d.t <= toMs + DAY);
  wx.source = archive ? 'archive' : 'forecast';
  if (!wx.hours.some(h => h.p != null)) throw new Error('Сервис не вернул данные за эти даты');
  return wx;
}

const at = (o, k, i) => (o && o[k] && o[k][i] != null ? o[k][i] : null);
const ms = v => (v == null ? null : v * 1000);

export function normalize(j, lat, lon) {
  const H = j.hourly || {}, D = j.daily || {}, C = j.current || null;
  const hours = (H.time || []).map((t, i) => ({
    t: t * 1000,
    temp: at(H, 'temperature_2m', i),
    hum: at(H, 'relative_humidity_2m', i),
    p: at(H, 'surface_pressure', i),
    pm: at(H, 'pressure_msl', i),
    prec: at(H, 'precipitation', i),
    cloud: at(H, 'cloud_cover', i),
    ws: at(H, 'wind_speed_10m', i),
    wd: at(H, 'wind_direction_10m', i),
    wg: at(H, 'wind_gusts_10m', i),
    code: at(H, 'weather_code', i),
  }));
  const days = (D.time || []).map((t, i) => ({
    t: t * 1000,
    code: at(D, 'weather_code', i),
    tmax: at(D, 'temperature_2m_max', i),
    tmin: at(D, 'temperature_2m_min', i),
    prec: at(D, 'precipitation_sum', i),
    wsmax: at(D, 'wind_speed_10m_max', i),
    wgmax: at(D, 'wind_gusts_10m_max', i),
    wd: at(D, 'wind_direction_10m_dominant', i),
    rise: ms(at(D, 'sunrise', i)),
    set: ms(at(D, 'sunset', i)),
  }));
  const current = C ? {
    t: ms(C.time),
    temp: C.temperature_2m ?? null,
    hum: C.relative_humidity_2m ?? null,
    p: C.surface_pressure ?? null,
    pm: C.pressure_msl ?? null,
    prec: C.precipitation ?? null,
    cloud: C.cloud_cover ?? null,
    ws: C.wind_speed_10m ?? null,
    wd: C.wind_direction_10m ?? null,
    wg: C.wind_gusts_10m ?? null,
    code: C.weather_code ?? null,
    day: C.is_day ?? 1,
  } : null;
  return {
    lat, lon,
    elev: j.elevation ?? null,
    off: j.utc_offset_seconds || 0,
    tz: j.timezone || '',
    fetchedAt: Date.now(),
    current, hours, days,
  };
}

// Значение в момент времени (линейно между соседними часами).
export function valueAt(hours, t, key = 'p') {
  if (!hours || !hours.length) return null;
  let lo = 0, hi = hours.length - 1;
  if (t <= hours[0].t) return Math.abs(hours[0].t - t) <= 2 * HOUR ? hours[0][key] : null;
  if (t >= hours[hi].t) return Math.abs(hours[hi].t - t) <= 2 * HOUR ? hours[hi][key] : null;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (hours[mid].t <= t) lo = mid; else hi = mid;
  }
  const a = hours[lo], b = hours[hi];
  if (a[key] == null || b[key] == null) return a[key] ?? b[key];
  const k = (t - a.t) / (b.t - a.t);
  return a[key] + (b[key] - a[key]) * k;
}

export function trendWord(d) {
  if (d == null) return { text: 'нет данных', dir: 0, level: 0 };
  const a = Math.abs(d);
  if (a < 1.5) return { text: 'стабильное', dir: 0, level: 0 };
  if (a < 4) return { text: d > 0 ? 'медленно растёт' : 'медленно падает', dir: Math.sign(d), level: 1 };
  return { text: d > 0 ? 'быстро растёт' : 'быстро падает', dir: Math.sign(d), level: 2 };
}

// Давление в мм рт. ст. и как оно менялось.
export function pressureAt(hours, t) {
  const now = toMM(valueAt(hours, t, 'p'));
  const d24 = toMM(valueAt(hours, t - DAY, 'p'));
  const d72 = toMM(valueAt(hours, t - 3 * DAY, 'p'));
  const f24 = toMM(valueAt(hours, t + DAY, 'p'));
  const ch24 = now != null && d24 != null ? now - d24 : null;
  const ch72 = now != null && d72 != null ? now - d72 : null;
  const next24 = now != null && f24 != null ? f24 - now : null;
  return { now, d24, ch24, ch72, next24, word: trendWord(ch24) };
}

export function windowStats(hours, from, to) {
  let hs = hours.filter(h => h.t >= from - HOUR / 2 && h.t <= to + HOUR / 2);
  if (!hs.length && hours.length) {
    const mid = (from + to) / 2;
    hs = [hours.reduce((a, b) => (Math.abs(b.t - mid) < Math.abs(a.t - mid) ? b : a))];
    if (Math.abs(hs[0].t - mid) > 3 * HOUR) hs = [];
  }
  if (!hs.length) return null;
  const vals = k => hs.map(h => h[k]).filter(v => v != null);
  const avg = a => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
  const temps = vals('temp');
  let sx = 0, sy = 0;
  hs.forEach(h => { if (h.wd != null && h.ws != null) { const r = h.wd * Math.PI / 180; sx += Math.sin(r) * h.ws; sy += Math.cos(r) * h.ws; } });
  const wd = sx || sy ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : null;
  const codes = vals('code');
  const freq = {};
  codes.forEach(c => { freq[c] = (freq[c] || 0) + 1; });
  const code = codes.length ? +Object.entries(freq).sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0] : null;
  const pStart = toMM(valueAt(hours, from, 'p'));
  const pEnd = toMM(valueAt(hours, to, 'p'));
  return {
    pStart, pEnd,
    pAvg: toMM(avg(vals('p'))),
    before: pressureAt(hours, from),
    tmin: temps.length ? Math.min(...temps) : null,
    tmax: temps.length ? Math.max(...temps) : null,
    ws: avg(vals('ws')),
    wg: vals('wg').length ? Math.max(...vals('wg')) : null,
    wd,
    cloud: avg(vals('cloud')),
    hum: avg(vals('hum')),
    prec: vals('prec').reduce((s, v) => s + v, 0),
    code,
  };
}

// Сутки (по местному времени), в которые попадает момент t.
export function dayOf(days, t) {
  return days.find(d => t >= d.t && t < d.t + DAY) || null;
}

export function dayPressure(hours, d) {
  const hs = hours.filter(h => h.t >= d.t && h.t < d.t + DAY && h.p != null);
  if (!hs.length) return null;
  return toMM(hs.reduce((s, h) => s + h.p, 0) / hs.length);
}

// Фаза луны по среднему синодическому месяцу.
export function moon(t) {
  const SYN = 29.530588853;
  const ref = Date.UTC(2000, 0, 6, 18, 14);
  let age = ((t - ref) / DAY) % SYN;
  if (age < 0) age += SYN;
  const phase = age / SYN;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  const names = ['Новолуние', 'Растущий серп', 'Первая четверть', 'Растущая луна', 'Полнолуние', 'Убывающая луна', 'Последняя четверть', 'Убывающий серп'];
  const idx = Math.floor((age / SYN) * 8 + 0.5) % 8;
  return { age, phase, illum, name: names[idx] };
}

const CODES = {
  0: ['Ясно', 'sun'],
  1: ['Почти ясно', 'partly'],
  2: ['Переменная облачность', 'partly'],
  3: ['Пасмурно', 'cloud'],
  45: ['Туман', 'fog'],
  48: ['Туман с изморозью', 'fog'],
  51: ['Слабая морось', 'drizzle'],
  53: ['Морось', 'drizzle'],
  55: ['Сильная морось', 'drizzle'],
  56: ['Ледяная морось', 'drizzle'],
  57: ['Ледяная морось', 'drizzle'],
  61: ['Небольшой дождь', 'rain'],
  63: ['Дождь', 'rain'],
  65: ['Сильный дождь', 'rain'],
  66: ['Ледяной дождь', 'rain'],
  67: ['Ледяной дождь', 'rain'],
  71: ['Небольшой снег', 'snow'],
  73: ['Снег', 'snow'],
  75: ['Сильный снег', 'snow'],
  77: ['Снежная крупа', 'snow'],
  80: ['Небольшой ливень', 'rain'],
  81: ['Ливень', 'rain'],
  82: ['Сильный ливень', 'rain'],
  85: ['Снегопад', 'snow'],
  86: ['Сильный снегопад', 'snow'],
  95: ['Гроза', 'storm'],
  96: ['Гроза с градом', 'storm'],
  99: ['Гроза с градом', 'storm'],
};
export function wcode(c) {
  const v = CODES[c];
  return v ? { text: v[0], icon: v[1] } : { text: '—', icon: 'cloud' };
}
