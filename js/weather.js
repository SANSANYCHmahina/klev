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

// Модели прогноза: ICON (DWD, сетка до ~7 км над Европой и югом России) — на ближайшие 3 дня,
// ECMWF IFS — дальше. Если какой-то модели нет данных, берём другую, а в крайнем случае — общую смесь.
export const NEAR_MODEL = 'icon_seamless';
export const FAR_MODEL = 'ecmwf_ifs025';
const NEAR_DAYS = 3;

// ---------- погода с собственного сайта (сетка над Ростовской областью) ----------
// Open-Meteo из России без VPN часто недоступен. Поэтому GitHub раз в несколько часов скачивает
// погоду по сетке точек (шаг 0,25°) и кладёт файлы wx/<широта>_<долгота>.json на этот же сайт.
export const GRID = { lat0: 46.5, lat1: 48.0, lon0: 38.0, lon1: 42.25, step: 0.25 };

export function gridKey(lat, lon) {
  const g = GRID, h = g.step / 2;
  if (lat < g.lat0 - h || lat > g.lat1 + h || lon < g.lon0 - h || lon > g.lon1 + h) return null;
  const la = g.lat0 + Math.round((lat - g.lat0) / g.step) * g.step;
  const lo = g.lon0 + Math.round((lon - g.lon0) / g.step) * g.step;
  return la.toFixed(2) + '_' + lo.toFixed(2);
}

async function fromGrid(lat, lon) {
  const k = gridKey(lat, lon);
  if (!k) return null;
  try {
    const r = await fetchT(`wx/${k}.json`, 10000, { cache: 'no-cache' });
    if (!r.ok) return null;
    const j = await r.json();
    if (!j || !j.base || !j.base.hourly) return null;
    const wx = normalize(j.base, lat, lon);
    if (j.models) mergeModels(wx, j.models);
    wx.fetchedAt = (j.fetched || 0) * 1000 || Date.now();
    wx.via = 'site';
    return wx;
  } catch {
    return null;
  }
}

// Сейчас + неделя назад + прогноз на 7 дней.
export async function fetchOverview(lat, lon) {
  const g = await fromGrid(lat, lon);
  if (g && Date.now() - g.fetchedAt < 12 * HOUR) return g;
  try {
    const p = new URLSearchParams({ ...base(lat, lon), current: CURRENT, hourly: HOURLY, daily: DAILY, past_days: 7, forecast_days: 7 });
    const pm = new URLSearchParams({ ...base(lat, lon), hourly: HOURLY, models: `${NEAR_MODEL},${FAR_MODEL}`, past_days: 7, forecast_days: 7 });
    const [j, jm] = await Promise.all([getJSON(API + '?' + p), getJSON(API + '?' + pm).catch(() => null)]);
    const wx = normalize(j, lat, lon);
    if (jm) mergeModels(wx, jm);
    return wx;
  } catch (e) {
    if (g) return g; // устаревшие, но лучше, чем ничего
    throw new Error(gridKey(lat, lon)
      ? 'Погода пока не загрузилась. Проверьте интернет и нажмите «Повторить».'
      : 'Погодный сервис недоступен: это место вне зоны, где погода приходит через ваш сайт, а Open-Meteo без VPN не открывается.');
  }
}

const HKEYS = {
  temp: 'temperature_2m', hum: 'relative_humidity_2m', p: 'surface_pressure', pm: 'pressure_msl', prec: 'precipitation',
  cloud: 'cloud_cover', ws: 'wind_speed_10m', wd: 'wind_direction_10m', wg: 'wind_gusts_10m', code: 'weather_code',
};

function mergeModels(wx, jm) {
  const H = jm.hourly;
  if (!H || !H.time) return;
  const cut = Date.now() + NEAR_DAYS * DAY;
  const at = new Map(wx.hours.map((h, i) => [h.t, i]));
  let used = 0;
  H.time.forEach((t, i) => {
    const k = at.get(t * 1000);
    if (k == null) return;
    const order = t * 1000 <= cut ? [NEAR_MODEL, FAR_MODEL] : [FAR_MODEL, NEAR_MODEL];
    const h = wx.hours[k];
    for (const [f, v] of Object.entries(HKEYS)) {
      for (const m of order) {
        const arr = H[`${v}_${m}`];
        if (arr && arr[i] != null) { h[f] = arr[i]; used++; break; }
      }
    }
  });
  if (!used) return;
  // суточные значения пересчитываем по объединённым часам (восход/закат остаются)
  for (const d of wx.days) {
    const hs = wx.hours.filter(h => h.t >= d.t && h.t < d.t + DAY);
    if (hs.length < 12) continue;
    const v = k => hs.map(h => h[k]).filter(x => x != null);
    const t = v('temp'), ws = v('ws'), wg = v('wg'), pr = v('prec');
    if (t.length) { d.tmax = Math.max(...t); d.tmin = Math.min(...t); }
    if (ws.length) d.wsmax = Math.max(...ws);
    if (wg.length) d.wgmax = Math.max(...wg);
    if (pr.length) d.prec = pr.reduce((a, b) => a + b, 0);
    let sx = 0, sy = 0;
    hs.forEach(h => { if (h.wd != null && h.ws != null) { const r = h.wd * Math.PI / 180; sx += Math.sin(r) * h.ws; sy += Math.cos(r) * h.ws; } });
    if (sx || sy) d.wd = (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360;
  }
  wx.models = 'ICON + ECMWF';
}

// Нагон и сгон в дельте Дона и Таганрогском заливе.
// Ветер с запада-юго-запада («низовка») гонит воду из моря в залив и дельту — уровень растёт,
// с востока-северо-востока («верховка») — сгоняет, уровень падает. Считаем среднюю составляющую
// ветра вдоль оси залива за сутки до момента и сутки после.
const BAY_AXIS = 245;
export const inSurgeArea = (lat, lon) => lat > 46.8 && lat < 47.45 && lon > 38.0 && lon < 39.95;

export function surge(hours, t) {
  const comp = h => (h.ws == null || h.wd == null ? null : h.ws * Math.cos((h.wd - BAY_AXIS) * Math.PI / 180));
  const avg = (a, b) => {
    const v = hours.filter(h => h.t > a && h.t <= b).map(comp).filter(x => x != null);
    return v.length >= 6 ? v.reduce((s, x) => s + x, 0) / v.length : null;
  };
  const lvl = v => (v == null ? null : v >= 9 ? 2 : v >= 5 ? 1 : v <= -9 ? -2 : v <= -5 ? -1 : 0);
  const past = avg(t - DAY, t), next = avg(t, t + DAY);
  return { past, next, now: lvl(past), soon: lvl(next) };
}

export function surgeText(l) {
  return {
    2: 'Сильный нагон — вода прибывает',
    1: 'Возможен нагон — вода может прибывать',
    0: 'Ветер воду не гонит — уровень спокойный',
    '-1': 'Возможен сгон — вода может уходить',
    '-2': 'Сильный сгон — вода уходит',
  }[l];
}

const isoUTC = ms => new Date(ms).toISOString().slice(0, 10);

// Почасовая погода за произвольный промежуток (для отчётов и меток).
// Последние ~3 месяца берём из прогнозного API, всё что старше — из архива.
export async function fetchRange(lat, lon, fromMs, toMs) {
  const g = await fromGrid(lat, lon);
  if (g && g.hours.length && fromMs >= g.hours[0].t && toMs <= g.hours[g.hours.length - 1].t) {
    g.hours = g.hours.filter(h => h.t >= fromMs - 2 * HOUR && h.t <= toMs + 12 * HOUR);
    g.days = g.days.filter(d => d.t >= fromMs - DAY && d.t <= toMs + DAY);
    g.source = 'forecast';
    if (g.hours.some(h => h.p != null)) return g;
  }
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
