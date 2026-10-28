// Прогноз клёва мирной рыбы по погоде: сазан, лещ, рыбец.
// Это не научная модель, а рыбацкие приметы, собранные в понятные правила:
// каждая примета даёт плюс или минус, итог — от 1 до 5, и видно, из чего он сложился.
import { DAY, HOUR, toMM, fTime, compass, num } from './util.js';
import { valueAt, dayOf, surge, inSurgeArea, sstAt } from './weather.js';

export const SPECIES = [
  { id: 'sazan', name: 'Сазан' },
  { id: 'lesh', name: 'Лещ' },
  { id: 'rybets', name: 'Рыбец' },
];

export const SCORE_WORD = { 1: 'почти нет', 2: 'слабый', 3: 'средний', 4: 'хороший', 5: 'отличный' };

const mean = a => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const inSector = (d, a, b) => (a <= b ? d >= a && d <= b : d >= a || d <= b);

// Средняя температура воздуха за сутки (по часам).
function dayTemp(hours, t0) {
  return mean(hours.filter(h => h.t >= t0 && h.t < t0 + DAY && h.temp != null).map(h => h.temp));
}

// Вода догоняет воздух с запаздыванием: оцениваем её как среднее воздуха за 7–10 суток.
export function waterEstimate(hours, t) {
  // есть температура воды по морской модели — берём её
  const now = sstAt(hours, t);
  if (now != null) {
    const before = sstAt(hours, t - 3 * DAY);
    return { tw: now, trend: before != null ? now - before : 0, sea: true };
  }
  const daily = [];
  for (let i = 1; i <= 10; i++) { const v = dayTemp(hours, t - i * DAY); if (v != null) daily.push(v); }
  if (daily.length < 4) return null;
  const tw = mean(daily);
  const recent = mean(daily.slice(0, 3)), before = mean(daily.slice(3, 7));
  return { tw, trend: recent != null && before != null ? recent - before : 0 };
}

function windDay(hours, d0) {
  const hs = hours.filter(h => h.t >= d0 + 6 * HOUR && h.t < d0 + 21 * HOUR && h.ws != null);
  if (!hs.length) return null;
  let sx = 0, sy = 0;
  hs.forEach(h => { if (h.wd != null) { const r = h.wd * Math.PI / 180; sx += Math.sin(r) * h.ws; sy += Math.cos(r) * h.ws; } });
  return {
    ws: mean(hs.map(h => h.ws)),
    wg: Math.max(...hs.map(h => h.wg ?? h.ws)),
    wd: sx || sy ? (Math.atan2(sx, sy) * 180 / Math.PI + 360) % 360 : null,
  };
}

function rainDay(hours, d0) {
  const hs = hours.filter(h => h.t >= d0 && h.t < d0 + DAY);
  return {
    prec: hs.reduce((s, h) => s + (h.prec || 0), 0),
    storm: hs.some(h => h.code >= 95),
    cloud: mean(hs.filter(h => h.cloud != null).map(h => h.cloud)),
  };
}

const RULES = {
  sazan: {
    water(tw) {
      if (tw >= 20) return [1.5, 'вода тёплая — сазан активен'];
      if (tw >= 16) return [0.75, 'вода достаточно тёплая'];
      if (tw >= 12) return [-0.75, 'вода прохладная — сазан вялый'];
      return [-2, 'вода холодная — сазан почти не берёт'];
    },
    season(m) {
      if (m >= 5 && m <= 9) return [0.5, 'сезон сазана'];
      if (m === 4 || m === 10) return [0, null];
      return [-0.5, 'не сезон для сазана'];
    },
    hours: (rise, set) => [[rise - 0.5 * HOUR, rise + 3 * HOUR], [set - 2.5 * HOUR, set + 0.5 * HOUR]],
  },
  lesh: {
    water(tw) {
      if (tw >= 14 && tw <= 23) return [1, 'температура воды удобна для леща'];
      if (tw > 23) return [-0.25, 'жарко — лещ берёт ночью и на глубине'];
      if (tw >= 8) return [0, null];
      if (tw >= 4) return [-1, 'вода холодная — лещ стоит на ямах, берёт вяло'];
      return [-1.5, 'вода ледяная — лещ почти не кормится'];
    },
    season(m) {
      if (m === 9 || m === 10) return [0.5, 'осенний жор леща'];
      if (m >= 5 && m <= 8) return [0.25, null];
      if (m === 12 || m <= 2) return [-0.5, 'зима — лещ малоактивен'];
      return [0, null];
    },
    hours: (rise, set) => [[rise - 1.5 * HOUR, rise + 2.5 * HOUR], [set - 1 * HOUR, set + 3 * HOUR]],
  },
  rybets: {
    water(tw) {
      if (tw >= 8 && tw <= 18) return [0.5, 'температура воды подходит рыбцу'];
      if (tw > 22) return [-0.5, 'вода тёплая — рыбец уходит на течение и глубину'];
      if (tw < 5) return [-1, 'вода холодная'];
      return [0, null];
    },
    season(m) {
      if (m >= 9 && m <= 11) return [1, 'осенний ход рыбца в Дон'];
      if (m === 4 || m === 5) return [0.5, 'весенний ход рыбца'];
      if (m >= 6 && m <= 8) return [-0.25, null];
      return [-0.5, null];
    },
    hours: (rise, set) => [[rise + 0.5 * HOUR, rise + 5 * HOUR], [set - 3 * HOUR, set]],
  },
};

// Оценка на сутки, в которые попадает момент t.
export function biteDay(wx, t, speciesId) {
  const R = RULES[speciesId];
  const day = dayOf(wx.days, t);
  const d0 = day ? day.t : t - ((t + wx.off * 1000) % DAY);
  const noon = d0 + 12 * HOUR;
  const month = new Date(noon + wx.off * 1000).getUTCMonth() + 1;
  let s = 3;
  const plus = [], minus = [];
  const add = (v, txt) => { if (!v) return; s += v; if (txt) (v > 0 ? plus : minus).push(txt); };

  // давление
  const p = toMM(valueAt(wx.hours, noon, 'p')), p24 = toMM(valueAt(wx.hours, noon - DAY, 'p'));
  if (p != null && p24 != null) {
    const dp = p - p24, a = Math.abs(dp);
    if (a < 1.5) add(speciesId === 'lesh' ? 1.25 : 1, 'давление стабильное');
    else if (a < 4) {
      if (speciesId === 'sazan' && dp < 0) add(0.5, 'давление плавно падает — сазан оживает перед сменой погоды');
      else add(0, null);
    } else add(speciesId === 'lesh' ? -2 : -1.5, `давление ${dp > 0 ? 'резко растёт' : 'резко падает'} (${dp > 0 ? '+' : '−'}${num(a, 1)} мм за сутки)`);
  }

  // вода
  const w = waterEstimate(wx.hours, noon);
  if (w) {
    add(...R.water(w.tw));
    if (w.trend <= -3) add(-1, 'резкое похолодание');
    else if (w.trend >= 2 && (month <= 5 || month >= 9)) add(0.5, 'теплеет');
  }
  add(...R.season(month));

  // ветер
  const wd = windDay(wx.hours, d0);
  if (wd) {
    if (wd.ws >= 9) add(-1.25, `сильный ветер ${num(wd.ws, 0)} м/с`);
    else if (wd.ws >= 6.5) add(-0.25, `ветер свежий ${num(wd.ws, 0)} м/с`);
    else if (wd.ws >= 1.5) add(0.5, 'ветер слабый, есть рябь');
    if (wd.wg >= 15) add(-0.5, `порывы до ${num(wd.wg, 0)} м/с`);
    if (wd.wd != null && wd.ws >= 2) {
      if (inSector(wd.wd, 30, 130)) add(-0.75, `ветер восточный (${compass(wd.wd)}) — верховка`);
      else if (inSector(wd.wd, 190, 290)) add(0.5, `ветер ${compass(wd.wd)} — тёплый${inSurgeArea(wx.lat, wx.lon) ? ', с моря' : ''}`);
    }
  }

  // нагон/сгон (дельта Дона)
  if (inSurgeArea(wx.lat, wx.lon)) {
    const sg = surge(wx.hours, noon);
    if (sg.now >= 1) add(speciesId === 'sazan' ? 0.25 : 0.5, 'вода прибывает (нагон)');
    else if (sg.now <= -1) add(-0.5, 'сгон — рыба уходит на глубину');
  }

  // осадки
  const rn = rainDay(wx.hours, d0);
  if (rn.storm) add(-1, 'гроза');
  else if (rn.prec >= 10) add(-0.5, 'сильный дождь');
  else if (speciesId === 'lesh' && rn.cloud != null && rn.cloud >= 60 && rn.prec < 3) add(0.5, 'пасмурно — лещ смелее');

  const score = Math.max(1, Math.min(5, Math.round(s)));
  let best = [];
  if (day && day.rise && day.set) {
    best = R.hours(day.rise, day.set).map(([a, b]) => `${fTime(a, wx.off)}–${fTime(b, wx.off)}`);
  }
  return { score, raw: s, plus, minus, best, water: w };
}

// Прогноз на несколько суток вперёд для всех видов.
export function biteForecast(wx, now = Date.now(), days = 4) {
  const today = dayOf(wx.days, now);
  const start = today ? today.t : now;
  const out = [];
  for (let i = 0; i < days; i++) {
    const t = start + i * DAY + 12 * HOUR;
    if (!dayOf(wx.days, t)) break;
    out.push({ t, items: SPECIES.map(sp => ({ ...sp, ...biteDay(wx, t, sp.id) })) });
  }
  return out;
}
