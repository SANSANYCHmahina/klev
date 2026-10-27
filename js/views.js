// Экраны: погода, точка, место, списки, отчёт, форма, настройки.
import {
  $, $$, el, esc, uid, num, numT, signed, temp, toMM, compass, compassFull, fTime, fDay, fDate, fDateISO, dowISO,
  plural, fDuration, fDist, distKm, fCoord, todayISO, pad, DAY, HOUR, MON_FULL, devOff,
} from './util.js';
import { icon, wxIcon, windArrow, floatSVG } from './icons.js';
import { chart, dial, moonIcon } from './charts.js';
import { pressureAt, windowStats, dayOf, dayPressure, moon, wcode, surge, surgeText, inSurgeArea } from './weather.js';
import * as S from './store.js';

let ctx = null;
export const setCtx = c => { ctx = c; };

const METHODS = ['Поплавок', 'Фидер', 'Донка', 'Спиннинг', 'Джиг', 'Нахлыст', 'Карпфишинг', 'Зимняя', 'Жерлицы', 'Троллинг'];
const FISH = ['Окунь', 'Щука', 'Судак', 'Лещ', 'Подлещик', 'Плотва', 'Карась', 'Карп', 'Сазан', 'Линь', 'Язь', 'Голавль', 'Жерех', 'Сом', 'Налим', 'Густера', 'Краснопёрка', 'Уклейка', 'Ёрш', 'Елец', 'Чехонь', 'Синец', 'Берш', 'Форель', 'Хариус', 'Белый амур', 'Толстолобик', 'Ротан', 'Пескарь'];
const BAITS = ['Червь', 'Опарыш', 'Мотыль', 'Кукуруза', 'Перловка', 'Горох', 'Тесто', 'Хлеб', 'Манка', 'Бойл', 'Пеллетс', 'Живец', 'Воблер', 'Колебалка', 'Вертушка', 'Силикон', 'Поролонка', 'Балансир', 'Мормышка', 'Безмотылка', 'Блесна', 'Цикада', 'Поппер', 'Стример', 'Мушка'];

const routeURL = p => `https://yandex.ru/maps/?rtext=~${p.lat.toFixed(6)},${p.lon.toFixed(6)}&rtt=auto`;

// ---------- мелкие части ----------
const cell = (k, v, s = '') =>
  `<div class="cell"><div class="k">${k}</div><div class="v">${v}</div>${s ? `<div class="s">${s}</div>` : ''}</div>`;

function trendBadge(word, extra = '') {
  const cls = word.dir > 0 ? 'up' : word.dir < 0 ? 'down' : 'flat';
  const arrow = word.dir > 0 ? '↑' : word.dir < 0 ? '↓' : '→';
  return `<span class="trend ${cls} lv${word.level}"><b>${arrow}</b> ${word.text}${extra}</span>`;
}

const coordsRow = (lat, lon) =>
  `<div class="coords"><span class="mono">${fCoord(lat, lon)}</span><button type="button" class="link-btn" data-copy="${fCoord(lat, lon)}">${icon('copy')}Копировать</button></div>`;

const distLabel = (me, p) => {
  if (!me) return '';
  const km = distKm(me, p);
  return km < 0.03 ? 'вы здесь' : fDist(km) + ' от вас';
};

const loadingWx = () => `<div class="wx-loading"><span class="spin"></span>Загружаю погоду…</div>`;

function nearestHour(hours, t) {
  if (!hours.length) return null;
  return hours.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
}

export function fishSummary(r) {
  const f = (r.fish || []).filter(x => x.species || x.count || x.kg);
  if (!f.length) return { title: 'Без улова', count: 0, kg: 0, empty: true };
  const count = f.reduce((s, x) => s + (+x.count || 0), 0);
  const kg = f.reduce((s, x) => s + (+x.kg || 0), 0);
  const title = f.map(x => `${x.species || 'Рыба'}${x.count ? ' ' + x.count + ' шт' : ''}`).join(' · ');
  return { title, count, kg, empty: false };
}

const timeRange = r => (r.start && r.end ? `${r.start}–${r.end}` : r.start ? `с ${r.start}` : 'время не указано');

function reportCard(r, { showSpot } = {}) {
  const spot = S.spotById(r.spotId);
  const fs = fishSummary(r);
  const st = r.weather ? windowStats(r.weather.hours, r.startMs, r.endMs) : null;
  const sub = [r.bait, (r.method || []).join(', ')].filter(Boolean).join(' · ');
  const ph = r.photos || [];
  return `<a class="rcard" href="#report-${r.id}">
    <div class="rthumb${ph.length ? '' : ' none'}"${ph.length ? ` data-photo="${ph[0]}"` : ''}>${ph.length ? '' : icon('fish')}${ph.length > 1 ? `<span class="ph-n">${ph.length}</span>` : ''}</div>
    <div class="rbody">
      <div class="rtitle${fs.empty ? ' muted' : ''}">${esc(fs.title)}</div>
      <div class="rmeta">${dowISO(r.date)}, ${fDateISO(r.date)} · ${timeRange(r)}${showSpot && spot ? ' · ' + esc(spot.name) : ''}</div>
      ${sub ? `<div class="rbait">${esc(sub)}</div>` : ''}
    </div>
    ${st && st.pStart != null ? `<div class="rp"><b>${num(st.pStart)}</b><span>мм ${st.before.word.dir > 0 ? '↑' : st.before.word.dir < 0 ? '↓' : '→'}</span></div>` : r.weatherPending ? `<div class="rp pend" title="Погода ещё не загружена">${icon('wifiOff')}</div>` : ''}
  </a>`;
}

export async function hydratePhotos(root) {
  for (const n of $$('[data-photo]', root)) {
    const u = await S.photoURL(n.dataset.photo);
    if (!u) continue;
    if (n.tagName === 'IMG') n.src = u;
    else if (n.querySelector('img')) n.querySelector('img').src = u;
    else n.style.backgroundImage = `url("${u}")`;
  }
}

// ---------- блоки погоды ----------
function daysStrip(wx, now) {
  const today = dayOf(wx.days, now);
  const start = today ? today.t : now - DAY;
  const ds = wx.days.filter(d => d.t >= start).slice(0, 7);
  if (!ds.length) return '';
  return `<div class="days-wrap"><h4 class="mini-h">Прогноз по дням</h4><div class="days" role="list">${ds.map((d, i) => {
    const p = dayPressure(wx.hours, d);
    const w = wcode(d.code);
    return `<div class="day${i === 0 && today ? ' today' : ''}" role="listitem">
      <div class="d-n">${i === 0 && today ? 'Сегодня' : fDay(d.t + 12 * HOUR, wx.off)}</div>
      <div class="d-i" title="${esc(w.text)}">${wxIcon(w.icon)}</div>
      <div class="d-t"><b>${temp(d.tmax)}</b><span>${temp(d.tmin)}</span></div>
      <div class="d-w">${windArrow(d.wd)}<b>${compass(d.wd)}</b> ${num(d.wsmax, 0)} м/с</div>
      <div class="d-p">${p != null ? num(p) + ' мм' : '—'}</div>
    </div>`;
  }).join('')}</div></div>`;
}

function charts(node, wx, { from, to, now, band, bandLabel }) {
  chart($('[data-c=p]', node), {
    data: wx.hours, from, to, off: wx.off, now, band, bandLabel, minSpan: 8, height: 160,
    lines: [{ get: h => toMM(h.p), cls: 'p', area: true, fmt: v => num(v) + ' мм' }],
    aria: 'График давления',
  });
  chart($('[data-c=w]', node), {
    data: wx.hours, from, to, off: wx.off, now, band, zero: true, minSpan: 6, height: 118,
    lines: [
      { get: h => h.ws, cls: 'ws', area: true, fmt: v => num(v, 1) + ' м/с' },
      { get: h => h.wg, cls: 'wg', fmt: v => 'порывы ' + num(v, 0) },
    ],
    aria: 'График ветра',
  });
}

const chartsHTML = (pTitle, pNote) => `
  <div class="wx-chart"><div class="ch-head"><h4>Давление, мм рт. ст.</h4><span>${pNote}</span></div><div data-c="p"></div></div>
  <div class="wx-chart"><div class="ch-head"><h4>Ветер, м/с</h4><span class="legend"><i class="lg ws"></i>средний<i class="lg wg"></i>порывы</span></div><div data-c="w"></div></div>`;

// Подсказка про нагон/сгон (только дельта Дона и Таганрогский залив).
function surgeRow(wx, t, withForecast) {
  if (!inSurgeArea(wx.lat, wx.lon)) return '';
  const s = surge(wx.hours, t);
  if (s.now == null) return '';
  const dir = s.now > 0 ? 'up' : s.now < 0 ? 'down' : 'flat';
  const arrow = s.now > 0 ? '↑' : s.now < 0 ? '↓' : '→';
  const wind = s.past > 0.5 ? `низовка (с моря), в среднем ${num(s.past, 1)} м/с вдоль залива` : s.past < -0.5 ? `верховка (с суши), в среднем ${num(-s.past, 1)} м/с вдоль залива` : 'ветер вдоль залива слабый';
  let next = '';
  if (withForecast && s.soon != null && s.soon !== s.now) next = `<span class="sg-next">В ближайшие сутки: ${surgeText(s.soon).toLowerCase()}</span>`;
  return `<div class="surge ${dir} lv${Math.abs(s.now)}"><div class="sg-h"><b>${arrow}</b> ${surgeText(s.now)}</div><span class="sg-s">За сутки${withForecast ? '' : ' до начала'}: ${wind}.</span>${next}</div>`;
}

export function weatherLive(wx, { stale = false } = {}) {
  const now = Date.now();
  const c = wx.current && now - wx.current.t < 3 * HOUR ? wx.current : nearestHour(wx.hours, now) || {};
  const pr = pressureAt(wx.hours, now);
  const pNow = c.p != null ? toMM(c.p) : pr.now;
  const today = dayOf(wx.days, now);
  const mo = moon(now);
  const wc = wcode(c.code);
  const node = el(`<div class="wx">
    <div class="wx-baro">
      ${dial(pNow, pr.d24)}
      <div class="wx-p">
        <div class="k">Давление сейчас</div>
        <div class="big">${num(pNow)}<span class="u">мм рт. ст.</span></div>
        ${trendBadge(pr.word)}
        <div class="s">${[pr.ch24 != null ? `${signed(pr.ch24)} мм за сутки` : '', pr.next24 != null ? `прогноз ${signed(pr.next24)} мм` : ''].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
    ${surgeRow(wx, now, true)}
    <div class="wx-grid">
      ${cell('Ветер', `${windArrow(c.wd)}${num(c.ws, 1)}<small>м/с</small> <span class="v-t">${compass(c.wd)}</span>`, c.wg != null ? `порывы до ${num(c.wg, 0)} м/с` : '')}
      ${cell('Воздух', temp(c.temp), today ? `днём ${temp(today.tmax)}, ночью ${temp(today.tmin)}` : '')}
      ${cell('Небо', `${wxIcon(wc.icon)}<span class="v-t">${wc.text}</span>`, c.cloud != null ? `облачность ${Math.round(c.cloud)}%` : '')}
      ${cell('Осадки', today && today.prec != null ? `${num(today.prec, 1)}<small>мм за день</small>` : '—', c.hum != null ? `влажность ${Math.round(c.hum)}%` : '')}
      ${cell('Луна', `${moonIcon(mo.phase)}<span class="v-t">${mo.name}</span>`, `освещена на ${Math.round(mo.illum * 100)}%`)}
      ${cell('Солнце', today && today.rise ? `${fTime(today.rise, wx.off)}–${fTime(today.set, wx.off)}` : '—', today && today.rise ? `день ${fDuration((today.set - today.rise) / 60000)}` : '')}
    </div>
    ${chartsHTML('Давление', 'неделя назад → прогноз на 3 дня')}
    ${daysStrip(wx, now)}
    <div class="wx-src">Open-Meteo${wx.models ? ' · ' + wx.models : ''} · ${stale ? 'сохранено' : 'обновлено'} ${fDate(wx.fetchedAt)}, ${fTime(wx.fetchedAt)}${wx.elev != null ? ` · высота ${Math.round(wx.elev)} м` : ''}</div>
  </div>`);
  charts(node, wx, { from: now - 7 * DAY, to: now + 3 * DAY, now });
  return node;
}

// Условия за промежуток (рыбалка) + неделя до него.
export function weatherWindow(wx, from, to, { label = 'рыбалка' } = {}) {
  const st = windowStats(wx.hours, from, to);
  if (!st) return el('<p class="muted">Нет данных о погоде за это время.</p>');
  const day = dayOf(wx.days, from);
  const mo = moon((from + to) / 2);
  const b = st.before;
  const wc = wcode(st.code);
  const last = wx.hours.length ? wx.hours[wx.hours.length - 1].t : to;
  const node = el(`<div class="wx">
    <div class="wx-baro">
      ${dial(st.pStart, b.d24)}
      <div class="wx-p">
        <div class="k">Давление на начало</div>
        <div class="big">${num(st.pStart)}<span class="u">мм рт. ст.</span></div>
        ${trendBadge(b.word)}
        <div class="s">За сутки до начала ${signed(b.ch24)} мм, за 3 дня ${signed(b.ch72)} мм. За время рыбалки ${signed(st.pEnd != null && st.pStart != null ? st.pEnd - st.pStart : null)} мм.</div>
      </div>
    </div>
    ${surgeRow(wx, from, false)}
    <div class="wx-grid">
      ${cell('Ветер', `${windArrow(st.wd)}${num(st.ws, 1)}<small>м/с</small> <span class="v-t">${compass(st.wd)}</span>`, st.wg != null ? `порывы до ${num(st.wg, 0)} м/с` : '')}
      ${cell('Воздух', st.tmin != null && Math.round(st.tmin) !== Math.round(st.tmax) ? `${temp(st.tmin)}…${temp(st.tmax)}` : temp(st.tmax), day ? `за сутки ${temp(day.tmin)}…${temp(day.tmax)}` : '')}
      ${cell('Небо', `${wxIcon(wc.icon)}<span class="v-t">${wc.text}</span>`, st.cloud != null ? `облачность ${Math.round(st.cloud)}%` : '')}
      ${cell('Осадки', `${num(st.prec, 1)}<small>мм</small>`, st.hum != null ? `влажность ${Math.round(st.hum)}%` : '')}
      ${cell('Луна', `${moonIcon(mo.phase)}<span class="v-t">${mo.name}</span>`, `освещена на ${Math.round(mo.illum * 100)}%`)}
      ${cell('Солнце', day && day.rise ? `${fTime(day.rise, wx.off)}–${fTime(day.set, wx.off)}` : '—', day && day.rise ? `день ${fDuration((day.set - day.rise) / 60000)}` : '')}
    </div>
    ${chartsHTML('Давление', 'неделя до рыбалки, полоса — время ловли')}
    <div class="wx-src">Open-Meteo${wx.source === 'archive' ? ' (архив)' : ''} · загружено ${fDate(wx.fetchedAt)}, ${fTime(wx.fetchedAt)}</div>
  </div>`);
  const cTo = Math.min(last, to + 12 * HOUR);
  charts(node, wx, { from: from - 7 * DAY, to: Math.max(cTo, to + HOUR), now: null, band: [from, to], bandLabel: label });
  return node;
}

// Неделя до установки метки.
function weekBlock(wx, end) {
  const hs = wx.hours.filter(h => h.t <= end + HOUR);
  if (hs.length < 6) return el('<p class="muted">Данных недостаточно.</p>');
  const first = hs.find(h => h.p != null), lastH = [...hs].reverse().find(h => h.p != null);
  const ws = hs.filter(h => h.ws != null);
  const avgWs = ws.length ? ws.reduce((s, h) => s + h.ws, 0) / ws.length : null;
  const prec = hs.reduce((s, h) => s + (h.prec || 0), 0);
  const t = hs.map(h => h.temp).filter(v => v != null);
  const node = el(`<div class="wx">
    <p class="week-sum">Давление ${num(toMM(first?.p))} → ${num(toMM(lastH?.p))} мм (${signed(toMM(lastH?.p) - toMM(first?.p))}), ветер в среднем ${num(avgWs, 1)} м/с, осадков ${num(prec, 1)} мм${t.length ? `, воздух ${temp(Math.min(...t))}…${temp(Math.max(...t))}` : ''}.</p>
    ${chartsHTML('Давление', `${fDate(end - 7 * DAY, wx.off)} — ${fDate(end, wx.off)}`)}
  </div>`);
  charts(node, { ...wx, hours: hs }, { from: end - 7 * DAY, to: end, now: null });
  return node;
}

// ---------- шторка: точка на карте ----------
export function pointSheet(pt) {
  const dist = distLabel(ctx.me(), pt);
  const node = el(`<div class="sh">
    <header class="sh-head">
      <div class="sh-top"><div class="kicker">Точка на карте${dist ? ' · ' + dist : ''}</div>
        <button type="button" class="icon-btn" data-act="close" aria-label="Закрыть">${icon('close')}</button></div>
      <h2 class="sh-title" data-f="name">${esc(pt.name || 'Без названия')}</h2>
      <div class="sh-sub" data-f="sub">${esc(pt.sub || '')}</div>
      ${coordsRow(pt.lat, pt.lon)}
      <div class="depth-row" data-f="depth" hidden></div>
      <div class="sh-actions">
        <button type="button" class="btn accent" data-act="save">${icon('pin')}Сохранить метку</button>
        <a class="btn" href="${routeURL(pt)}" target="_blank" rel="noopener">${icon('route')}Маршрут</a>
      </div>
    </header>
    <section class="sec"><h3 class="sec-h">Погода здесь</h3><div data-f="wx">${loadingWx()}</div></section>
  </div>`);
  $('[data-act=close]', node).onclick = () => ctx.go('#map');
  $('[data-act=save]', node).onclick = e => { e.currentTarget.disabled = true; ctx.savePoint(); };
  return node;
}

// Глубина по карте глубин в шапке карточки.
export function setDepth(node, d) {
  const box = $('[data-f=depth]', node);
  if (!box) return;
  if (!d) { box.hidden = true; return; }
  box.hidden = false;
  box.innerHTML = `<span class="sw" style="background:${d.color}"></span><span><b>Глубина ≈ ${numT(d.lo, 1)}–${numT(d.hi, 1)} м</b><small>по карте глубин${d.edge ? ', у самого берега' : ''}</small></span>`;
}

export function setPointPlace(node, place) {
  if (!place) return;
  $('[data-f=name]', node).textContent = place.name || 'Без названия';
  $('[data-f=sub]', node).textContent = place.sub || '';
}

export function setWx(box, wx, opts) {
  box.replaceChildren(weatherLive(wx, opts));
}

export function setWxError(box, msg, retry) {
  box.replaceChildren(el(`<div class="wx-err"><p>${esc(msg)}</p><button type="button" class="btn sm">${icon('refresh')}Повторить</button></div>`));
  $('button', box).onclick = retry;
}

// ---------- шторка: моё место ----------
export function spotSheet(spot) {
  const reps = S.reportsOf(spot.id);
  const dist = distLabel(ctx.me(), spot);
  const placeLine = [spot.place && spot.place !== spot.name ? spot.place : '', spot.region].filter(Boolean).join(', ');
  const node = el(`<div class="sh">
    <header class="sh-head">
      <div class="sh-top"><div class="kicker">Моё место · с ${fDate(spot.createdAt)}${dist ? ' · ' + dist : ''}</div>
        <button type="button" class="icon-btn" data-act="close" aria-label="Закрыть">${icon('close')}</button></div>
      <h2 class="sh-title">${esc(spot.name)}</h2>
      ${placeLine ? `<div class="sh-sub">${esc(placeLine)}</div>` : ''}
      ${coordsRow(spot.lat, spot.lon)}
      <div class="depth-row" data-f="depth" hidden></div>
      <div class="sh-actions">
        <a class="btn accent" href="#new-${spot.id}">${icon('plus')}Отчёт о рыбалке</a>
        <a class="btn" href="${routeURL(spot)}" target="_blank" rel="noopener">${icon('route')}Маршрут</a>
      </div>
    </header>
    ${spot.note ? `<p class="note">${esc(spot.note).replace(/\n/g, '<br>')}</p>` : ''}
    <section class="sec">
      <h3 class="sec-h">Рыбалки здесь <span class="cnt">${reps.length}</span></h3>
      ${reps.length ? `<div class="cards">${reps.map(r => reportCard(r)).join('')}</div>`
        : `<div class="empty sm"><p>Отчётов пока нет. После рыбалки запишите время, улов, приманку и добавьте фото — погода за эти часы сохранится сама.</p></div>`}
    </section>
    <section class="sec"><h3 class="sec-h">Погода на месте</h3><div data-f="wx">${spot.live ? '' : loadingWx()}</div></section>
    <details class="fold" data-f="created">
      <summary>Погода за неделю до установки метки</summary>
      <div class="fold-b"></div>
    </details>
    <section class="sec manage">
      <button type="button" class="btn ghost sm" data-act="rename">${icon('edit')}Переименовать</button>
      <button type="button" class="btn ghost sm" data-act="note">Заметка</button>
      <button type="button" class="btn ghost sm danger" data-act="delete">${icon('trash')}Удалить место</button>
    </section>
  </div>`);
  hydratePhotos(node);
  fillCreated(node, spot);
  $('[data-act=close]', node).onclick = () => ctx.go('#map');
  $('[data-act=rename]', node).onclick = async () => {
    const v = await ctx.askText({ title: 'Название места', value: spot.name, placeholder: 'Например, «Коряжник у моста»' });
    if (v == null || !v.trim()) return;
    spot.name = v.trim();
    await S.saveSpot(spot);
    ctx.refreshSpot(spot.id);
  };
  $('[data-act=note]', node).onclick = async () => {
    const v = await ctx.askText({ title: 'Заметка о месте', value: spot.note, placeholder: 'Глубины, подъезд, где лучше встать…', multiline: true });
    if (v == null) return;
    spot.note = v.trim();
    await S.saveSpot(spot);
    ctx.refreshSpot(spot.id);
  };
  $('[data-act=delete]', node).onclick = async () => {
    const ok = await ctx.ask({
      title: 'Удалить место?',
      text: reps.length ? `Вместе с ним удалятся ${reps.length} ${plural(reps.length, 'отчёт', 'отчёта', 'отчётов')} и все фото. Вернуть не получится.` : 'Метка исчезнет с карты.',
      ok: 'Удалить', danger: true,
    });
    if (!ok) return;
    await S.deleteSpot(spot.id);
    ctx.toast('Место удалено');
    ctx.go('#map');
  };
  return node;
}

export function fillCreated(node, spot) {
  const body = $('[data-f=created] .fold-b', node);
  if (!body) return;
  if (spot.createdWeather) body.replaceChildren(weekBlock(spot.createdWeather, spot.createdAt));
  else body.innerHTML = '<p class="muted">Загрузится, когда будет интернет.</p>';
}

export async function loadSpotWeather(spot, node) {
  const box = $('[data-f=wx]', node);
  const fresh = spot.live && Date.now() - spot.live.fetchedAt < 30 * 60e3;
  if (spot.live) box.replaceChildren(weatherLive(spot.live, { stale: !fresh }));
  if (fresh) return;
  try {
    const wx = await S.refreshSpotLive(spot);
    if (!box.isConnected) return;
    box.replaceChildren(weatherLive(wx));
    fillCreated(node, spot);
  } catch (e) {
    if (!box.isConnected) return;
    if (!spot.live) setWxError(box, e.message, () => { box.innerHTML = loadingWx(); loadSpotWeather(spot, node); });
    else box.prepend(el(`<p class="wx-note">${icon('wifiOff')}Не удалось обновить — показываю сохранённую погоду.</p>`));
  }
}

// ---------- страница: мои места ----------
export function spotsPage() {
  const me = ctx.me();
  const items = S.state.spots.map(s => {
    const reps = S.reportsOf(s.id);
    return { s, reps, last: reps[0], act: Math.max(s.createdAt, reps[0]?.startMs || 0), dist: me ? distKm(me, s) : null };
  }).sort((a, b) => b.act - a.act);
  const node = el(`<div class="pg">
    <header class="pg-head"><h1>Мои места</h1>${items.length ? `<span class="pg-cnt">${items.length}</span>` : ''}</header>
    <div class="pg-body">
      ${items.length ? `<div class="list">${items.map(it => {
        const meta = [
          it.s.place && it.s.place !== it.s.name ? it.s.place : '',
          it.reps.length ? `${it.reps.length} ${plural(it.reps.length, 'рыбалка', 'рыбалки', 'рыбалок')}` : 'отчётов нет',
          it.last ? 'последняя ' + fDateISO(it.last.date) : '',
        ].filter(Boolean).join(' · ');
        return `<a class="spot-row" href="#spot-${it.s.id}">${floatSVG('mini')}<div class="sr-b"><b>${esc(it.s.name)}</b><small>${esc(meta)}</small></div>${it.dist != null ? `<span class="sr-d">${fDist(it.dist)}</span>` : ''}${icon('chevron', 'chev')}</a>`;
      }).join('')}</div>` : `<div class="empty">
        ${floatSVG('big')}
        <h2>Здесь будут ваши места</h2>
        <p>Стоите на берегу — нажмите на карте «Метка здесь». Присматриваете место — коснитесь его на карте и сохраните.</p>
        <a class="btn accent" href="#map">${icon('map')}Открыть карту</a>
      </div>`}
    </div>
  </div>`);
  return node;
}

// ---------- страница: журнал ----------
function insights(reps) {
  const lines = [];
  const sp = {};
  reps.forEach(r => (r.fish || []).forEach(f => { if (f.species) { const k = f.species.trim(); sp[k] = (sp[k] || 0) + (+f.count || 1); } }));
  const topSp = Object.entries(sp).sort((a, b) => b[1] - a[1])[0];
  if (topSp) lines.push(`Чаще всего попадается <b>${esc(topSp[0].toLowerCase())}</b> — ${topSp[1]} шт.`);
  const lucky = reps.filter(r => !fishSummary(r).empty);
  const bait = {};
  lucky.forEach(r => { if (r.bait) { const k = r.bait.trim().toLowerCase(); bait[k] = (bait[k] || 0) + (fishSummary(r).count || 1); } });
  const topBait = Object.entries(bait).sort((a, b) => b[1] - a[1])[0];
  if (topBait) lines.push(`Лучше всего работает <b>${esc(topBait[0])}</b> — ${topBait[1]} ${plural(topBait[1], 'рыба', 'рыбы', 'рыб')}.`);
  const ps = lucky.map(r => r.weather && windowStats(r.weather.hours, r.startMs, r.endMs)).filter(s => s && s.pStart != null);
  if (ps.length >= 2) {
    const vals = ps.map(s => s.pStart);
    const tw = { 0: 0, 1: 0, '-1': 0 };
    ps.forEach(s => { tw[s.before.word.dir]++; });
    const top = Object.entries(tw).sort((a, b) => b[1] - a[1])[0][0];
    const txt = top === '0' ? 'стабильном' : top === '1' ? 'растущем' : 'падающем';
    lines.push(`С уловом вы были при давлении <b>${num(Math.min(...vals))}–${num(Math.max(...vals))} мм</b>, чаще при ${txt}.`);
  }
  return lines.length ? `<div class="insight"><h3 class="mini-h">Что видно по журналу</h3><ul>${lines.map(l => `<li>${l}</li>`).join('')}</ul></div>` : '';
}

export function journalPage() {
  const reps = [...S.state.reports].sort((a, b) => b.startMs - a.startMs);
  const totals = reps.reduce((t, r) => { const f = fishSummary(r); t.n += f.count; t.kg += f.kg; return t; }, { n: 0, kg: 0 });
  const node = el(`<div class="pg">
    <header class="pg-head"><h1>Журнал</h1><a class="icon-btn" href="#settings" aria-label="Настройки и резервная копия">${icon('gear')}</a></header>
    <div class="pg-body">
      ${reps.length ? `
      <div class="totals">
        <div><b>${reps.length}</b><span>${plural(reps.length, 'рыбалка', 'рыбалки', 'рыбалок')}</span></div>
        <div><b>${totals.n}</b><span>${plural(totals.n, 'рыба', 'рыбы', 'рыб')}</span></div>
        <div><b>${numT(totals.kg, 1)}</b><span>кг улова</span></div>
      </div>
      ${insights(reps)}
      <label class="search-in">${icon('search')}<input type="search" id="j-q" placeholder="Рыба, приманка, место" autocomplete="off"></label>
      <div data-f="list"></div>` : `<div class="empty">
        ${icon('book', 'big')}
        <h2>Журнал пуст</h2>
        <p>Отчёты добавляются к местам: откройте метку на карте и нажмите «Отчёт о рыбалке».</p>
        <a class="btn accent" href="#map">${icon('map')}Открыть карту</a>
      </div>`}
    </div>
  </div>`);
  if (!reps.length) return node;
  const list = $('[data-f=list]', node);
  const draw = q => {
    q = (q || '').trim().toLowerCase();
    const f = q ? reps.filter(r => {
      const spot = S.spotById(r.spotId);
      return [spot?.name, spot?.place, r.bait, r.notes, ...(r.method || []), ...(r.fish || []).map(x => x.species)].filter(Boolean).join(' ').toLowerCase().includes(q);
    }) : reps;
    if (!f.length) { list.innerHTML = '<p class="muted center">Ничего не нашлось.</p>'; return; }
    let html = '', cur = '';
    f.forEach(r => {
      const [y, m] = r.date.split('-').map(Number);
      const key = MON_FULL[m - 1] + ' ' + y;
      if (key !== cur) { if (cur) html += '</div>'; html += `<h3 class="month">${key}</h3><div class="cards">`; cur = key; }
      html += reportCard(r, { showSpot: true });
    });
    list.innerHTML = html + '</div>';
    hydratePhotos(list);
  };
  draw('');
  $('#j-q', node).addEventListener('input', e => draw(e.target.value));
  return node;
}

// ---------- страница: отчёт ----------
function notFound(text) {
  const node = el(`<div class="pg"><header class="pg-head deep"><button type="button" class="icon-btn" data-act="back" aria-label="Назад">${icon('back')}</button><div class="pg-title"><b>Не найдено</b></div></header>
    <div class="pg-body"><div class="empty"><p>${esc(text)}</p><a class="btn" href="#journal">Открыть журнал</a></div></div></div>`);
  $('[data-act=back]', node).onclick = () => ctx.back('#journal');
  return node;
}

export function reportPage(id) {
  const r = S.reportById(id);
  if (!r) return notFound('Такого отчёта нет — возможно, он удалён.');
  const spot = S.spotById(r.spotId);
  const fs = fishSummary(r);
  const dur = (r.endMs - r.startMs) / 60000;
  const rows = (r.fish || []).filter(x => x.species || x.count || x.kg);
  const ph = r.photos || [];
  const node = el(`<div class="pg">
    <header class="pg-head deep">
      <button type="button" class="icon-btn" data-act="back" aria-label="Назад">${icon('back')}</button>
      <div class="pg-title"><small>${esc(spot ? spot.name : 'Место удалено')}</small><b>${dowISO(r.date, true)}, ${fDateISO(r.date)}</b></div>
      <a class="icon-btn" href="#edit-${r.id}" aria-label="Изменить отчёт">${icon('edit')}</a>
    </header>
    <div class="pg-body">
      ${ph.length ? `<div class="gallery${ph.length === 1 ? ' one' : ''}">${ph.map((p, i) => `<button type="button" class="g-item" data-i="${i}" aria-label="Открыть фото ${i + 1}"><img alt="" data-photo="${p}"></button>`).join('')}</div>` : ''}
      <section class="r-hero">
        <div class="kicker">${icon('clock')}${timeRange(r)}${r.start && r.end ? ' · ' + fDuration(dur) : ''}</div>
        <h2 class="r-title${fs.empty ? ' muted' : ''}">${esc(fs.title)}</h2>
        ${!fs.empty && (fs.count || fs.kg) ? `<div class="r-tot">${fs.count ? `<span><b>${fs.count}</b> ${plural(fs.count, 'рыба', 'рыбы', 'рыб')}</span>` : ''}${fs.kg ? `<span><b>${numT(fs.kg)}</b> кг</span>` : ''}</div>` : ''}
      </section>
      ${rows.length > 1 || rows.some(x => x.kg) ? `<div class="tbl-wrap"><table class="catch"><thead><tr><th>Рыба</th><th>шт</th><th>кг</th></tr></thead><tbody>
        ${rows.map(x => `<tr><td>${esc(x.species || 'Рыба')}</td><td>${x.count || '—'}</td><td>${x.kg ? numT(+x.kg) : '—'}</td></tr>`).join('')}
      </tbody></table></div>` : ''}
      ${r.bait || (r.method || []).length || r.depth ? `<dl class="facts">
        ${r.bait ? `<div><dt>На что ловилось</dt><dd>${esc(r.bait)}</dd></div>` : ''}
        ${(r.method || []).length ? `<div><dt>Способ</dt><dd>${esc(r.method.join(', '))}</dd></div>` : ''}
        ${r.depth ? `<div><dt>Глубина</dt><dd>${numT(+r.depth, 1)} м</dd></div>` : ''}
      </dl>` : ''}
      ${r.notes ? `<div class="notes">${esc(r.notes).replace(/\n/g, '<br>')}</div>` : ''}
      <section class="sec"><h3 class="sec-h">Погода во время рыбалки</h3><div data-f="wx"></div></section>
      <div class="end-actions">
        ${spot ? `<a class="btn ghost" href="#spot-${spot.id}">${icon('pin')}Место на карте</a>` : ''}
        <button type="button" class="btn ghost danger" data-act="delete">${icon('trash')}Удалить отчёт</button>
      </div>
    </div>
  </div>`);
  hydratePhotos(node);
  $$('.g-item', node).forEach(b => { b.onclick = () => ctx.viewer(ph, +b.dataset.i); });
  $('[data-act=back]', node).onclick = () => ctx.back(spot ? '#spot-' + spot.id : '#journal');
  const box = $('[data-f=wx]', node);
  const showWx = () => {
    if (r.weather) box.replaceChildren(weatherWindow(r.weather, r.startMs, r.endMs));
    else {
      box.replaceChildren(el(`<div class="wx-err"><p>${r.endMs > Date.now() + 14 * DAY ? 'Погода для этой даты появится ближе к ней.' : 'Погода ещё не загружена — не было интернета. Подтянется сама, когда связь появится.'}</p><button type="button" class="btn sm">${icon('refresh')}Загрузить сейчас</button></div>`));
      $('button', box).onclick = async e => {
        if (!spot) return;
        e.currentTarget.disabled = true;
        box.prepend(el(loadingWx()));
        try {
          r.weather = await S.reportWeather(spot, r);
          r.weatherPending = false;
          await S.saveReport(r);
        } catch (err) { ctx.toast(err.message); }
        showWx();
      };
    }
  };
  showWx();
  $('[data-act=delete]', node).onclick = async () => {
    const ok = await ctx.ask({ title: 'Удалить отчёт?', text: 'Отчёт и его фото удалятся с этого устройства.', ok: 'Удалить', danger: true });
    if (!ok) return;
    await S.deleteReport(r.id);
    ctx.toast('Отчёт удалён');
    ctx.replace(spot ? '#spot-' + spot.id : '#journal');
  };
  return node;
}

// ---------- страница: форма отчёта ----------
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }

export function formPage({ spotId, reportId }) {
  const editing = reportId ? S.reportById(reportId) : null;
  if (reportId && !editing) return notFound('Отчёт не найден.');
  const spot0 = S.spotById(editing ? editing.spotId : spotId);
  if (!spot0) return notFound('Место не найдено — возможно, оно удалено.');
  let r;
  if (editing) r = JSON.parse(JSON.stringify({ ...editing, weather: null }));
  else {
    const now = new Date();
    now.setMinutes(Math.floor(now.getMinutes() / 5) * 5);
    const st = new Date(now.getTime() - 3 * HOUR);
    const sameDay = st.getDate() === now.getDate();
    r = {
      id: uid(), spotId: spot0.id, date: todayISO(), start: sameDay ? hm(st) : '00:00', end: hm(now),
      fish: [], bait: '', method: [], depth: '', notes: '', photos: [], createdAt: Date.now(),
    };
  }
  if (!r.fish.length) r.fish.push({ species: '', count: '', kg: '' });
  const used = (k) => [...new Set(S.state.reports.flatMap(x => k === 'fish' ? (x.fish || []).map(f => f.species) : [x.bait]).filter(Boolean).map(s => s.trim()))];
  const fishList = [...new Set([...used('fish'), ...FISH])];
  const baitList = [...new Set([...used('bait'), ...BAITS])];

  const node = el(`<div class="pg">
    <header class="pg-head deep">
      <button type="button" class="icon-btn" data-act="back" aria-label="Назад">${icon('back')}</button>
      <div class="pg-title"><small>${esc(spot0.name)}</small><b>${editing ? 'Изменить отчёт' : 'Новый отчёт'}</b></div>
      <button class="btn accent sm" type="submit" form="rf">Сохранить</button>
    </header>
    <form id="rf" class="pg-body form" novalidate>
      <fieldset class="fs"><legend>Где и когда</legend>
        ${S.state.spots.length > 1 ? `<label class="fld"><span>Место</span><select id="rf-spot">${S.state.spots.map(s => `<option value="${s.id}"${s.id === r.spotId ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>` : ''}
        <label class="fld"><span>Дата</span><input type="date" id="rf-date" value="${r.date}" required></label>
        <div class="row2">
          <label class="fld"><span>Начал ловить</span><input type="time" id="rf-start" value="${r.start}" required></label>
          <label class="fld"><span>Закончил</span><input type="time" id="rf-end" value="${r.end}"></label>
        </div>
        <p class="hint">Закончили после полуночи — укажите время как есть, оно посчитается следующим днём.</p>
      </fieldset>
      <fieldset class="fs"><legend>Улов</legend>
        <div class="fish-head" aria-hidden="true"><span>Рыба</span><span>шт</span><span>кг</span><span></span></div>
        <div id="rf-fish" class="fish-rows"></div>
        <button type="button" class="btn ghost sm" id="rf-addfish">${icon('plus')}Ещё рыба</button>
        <p class="hint">Не клевало — оставьте пустым, отчёт сохранится «без улова». Это тоже полезно знать.</p>
      </fieldset>
      <fieldset class="fs"><legend>На что и чем</legend>
        <label class="fld"><span>На что ловилось</span><input id="rf-bait" list="dl-bait" value="${esc(r.bait)}" placeholder="мотыль, воблер 70 мм, кукуруза…" autocomplete="off"></label>
        <div class="fld"><span>Способ ловли</span><div class="chips" id="rf-method">${METHODS.map(m => `<button type="button" class="chip" aria-pressed="${r.method.includes(m)}">${m}</button>`).join('')}</div></div>
        <label class="fld narrow"><span>Глубина, м</span><input id="rf-depth" type="number" inputmode="decimal" step="0.1" min="0" value="${r.depth ?? ''}" placeholder="—"></label>
      </fieldset>
      <fieldset class="fs"><legend>Фото</legend>
        <div class="photos" id="rf-photos"></div>
      </fieldset>
      <fieldset class="fs"><legend>Описание</legend>
        <textarea id="rf-notes" rows="5" placeholder="Где стоял, как шла рыба, что сработало, что нет…">${esc(r.notes)}</textarea>
      </fieldset>
      <button class="btn accent block lg" type="submit" data-f="submit">Сохранить отчёт</button>
      <datalist id="dl-fish">${fishList.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
      <datalist id="dl-bait">${baitList.map(f => `<option value="${esc(f)}">`).join('')}</datalist>
    </form>
  </div>`);

  const fishBox = $('#rf-fish', node);
  const fishRow = f => {
    const row = el(`<div class="fish-row">
      <input class="f-sp" list="dl-fish" placeholder="Окунь" value="${esc(f.species || '')}" aria-label="Рыба" autocomplete="off">
      <input class="f-n" type="number" inputmode="numeric" min="0" step="1" placeholder="0" value="${f.count ?? ''}" aria-label="Количество, штук">
      <input class="f-kg" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0" value="${f.kg ?? ''}" aria-label="Вес, кг">
      <button type="button" class="icon-btn sm" aria-label="Убрать строку">${icon('close')}</button>
    </div>`);
    $('button', row).onclick = () => { row.remove(); if (!fishBox.children.length) fishBox.append(fishRow({})); };
    return row;
  };
  r.fish.forEach(f => fishBox.append(fishRow(f)));
  $('#rf-addfish', node).onclick = () => { const row = fishRow({}); fishBox.append(row); $('.f-sp', row).focus(); };

  $$('#rf-method .chip', node).forEach(c => { c.onclick = () => c.setAttribute('aria-pressed', c.getAttribute('aria-pressed') !== 'true'); });

  // фото
  const keep = [...(r.photos || [])];
  const removed = [];
  const added = [];
  const phBox = $('#rf-photos', node);
  const drawPhotos = () => {
    phBox.innerHTML = keep.map((id, i) => `<div class="ph"><img alt="" data-photo="${id}"><button type="button" class="ph-x" data-k="${i}" aria-label="Убрать фото">${icon('close')}</button></div>`).join('') +
      added.map((a, i) => `<div class="ph"><img alt="" src="${a.url}"><button type="button" class="ph-x" data-a="${i}" aria-label="Убрать фото">${icon('close')}</button></div>`).join('') +
      `<label class="ph add">${icon('camera')}<span>Добавить</span><input type="file" accept="image/*" multiple id="rf-file"></label>`;
    hydratePhotos(phBox);
    $$('.ph-x', phBox).forEach(b => {
      b.onclick = () => {
        if (b.dataset.k != null) removed.push(...keep.splice(+b.dataset.k, 1));
        else { const [a] = added.splice(+b.dataset.a, 1); URL.revokeObjectURL(a.url); }
        drawPhotos();
      };
    });
    $('#rf-file', phBox).onchange = async e => {
      const files = [...e.target.files];
      e.target.value = '';
      for (const f of files) {
        try {
          const c = await S.compressImage(f);
          added.push({ ...c, url: URL.createObjectURL(c.blob) });
        } catch (err) { ctx.toast(err.message); }
      }
      drawPhotos();
    };
  };
  drawPhotos();

  $('[data-act=back]', node).onclick = () => ctx.back(editing ? '#report-' + editing.id : '#spot-' + spot0.id);
  ctx.depthAt(spot0.lat, spot0.lon).then(d => {
    const inp = $('#rf-depth', node);
    if (d && inp && !inp.value) inp.placeholder = `по карте ${numT(d.lo, 1)}–${numT(d.hi, 1)}`;
  });

  let busy = false;
  $('#rf', node).addEventListener('submit', async e => {
    e.preventDefault();
    if (busy) return;
    const date = $('#rf-date', node).value, start = $('#rf-start', node).value, end = $('#rf-end', node).value;
    if (!date) { ctx.toast('Укажите дату'); $('#rf-date', node).focus(); return; }
    if (!start) { ctx.toast('Укажите, во сколько начали ловить'); $('#rf-start', node).focus(); return; }
    const startMs = new Date(`${date}T${start}`).getTime();
    let endMs = end ? new Date(`${date}T${end}`).getTime() : startMs + HOUR;
    if (endMs <= startMs) endMs += DAY;
    const fish = $$('.fish-row', node).map(row => ({
      species: $('.f-sp', row).value.trim(),
      count: $('.f-n', row).value === '' ? '' : Math.max(0, Math.round(+$('.f-n', row).value)),
      kg: $('.f-kg', row).value === '' ? '' : Math.max(0, +(+$('.f-kg', row).value.replace(',', '.')).toFixed(3)),
    })).filter(f => f.species || f.count || f.kg);
    const spotIdNew = $('#rf-spot', node)?.value || r.spotId;
    const spot = S.spotById(spotIdNew) || spot0;
    busy = true;
    const btns = $$('[type=submit]', node.closest('.pg') || node);
    btns.forEach(b => { b.disabled = true; b.dataset.t = b.textContent; b.textContent = 'Сохраняю…'; });
    try {
      const newIds = [];
      for (const a of added) newIds.push(await S.addPhoto(a.blob, a.w, a.h));
      if (removed.length) await S.delPhotos(removed);
      const changed = !editing || editing.startMs !== startMs || editing.endMs !== endMs || editing.spotId !== spot.id;
      const out = {
        ...(editing || {}),
        id: r.id, spotId: spot.id, date, start, end, startMs, endMs, tzOff: devOff(startMs),
        fish,
        bait: $('#rf-bait', node).value.trim(),
        method: $$('#rf-method .chip', node).filter(c => c.getAttribute('aria-pressed') === 'true').map(c => c.textContent),
        depth: $('#rf-depth', node).value === '' ? '' : +$('#rf-depth', node).value,
        notes: $('#rf-notes', node).value.trim(),
        photos: [...keep, ...newIds],
        createdAt: r.createdAt || Date.now(),
        updatedAt: Date.now(),
      };
      if (changed || !out.weather) {
        try {
          out.weather = await S.reportWeather(spot, out);
          out.weatherPending = false;
        } catch {
          out.weather = changed ? null : out.weather || null;
          out.weatherPending = !out.weather;
        }
      }
      await S.saveReport(out);
      added.forEach(a => URL.revokeObjectURL(a.url));
      ctx.toast(out.weatherPending ? 'Отчёт сохранён. Погоду подтяну, когда появится интернет.' : 'Отчёт сохранён');
      ctx.replace('#report-' + out.id);
    } catch (err) {
      ctx.toast('Не удалось сохранить: ' + err.message);
      btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.t; });
      busy = false;
    }
  });
  return node;
}

// ---------- страница: настройки и копия ----------
export function settingsPage() {
  const nPhotos = S.state.reports.reduce((s, r) => s + (r.photos || []).length, 0);
  const node = el(`<div class="pg">
    <header class="pg-head deep">
      <button type="button" class="icon-btn" data-act="back" aria-label="Назад">${icon('back')}</button>
      <div class="pg-title"><b>Настройки и копия</b></div>
    </header>
    <div class="pg-body">
      <section class="sec card">
        <h3 class="sec-h">Резервная копия</h3>
        <p>Места, отчёты и фото хранятся только на этом устройстве, в браузере. Сохраняйте копию в файл: она пригодится при смене телефона или очистке браузера.</p>
        <p class="muted" data-f="usage">${S.state.spots.length} ${plural(S.state.spots.length, 'место', 'места', 'мест')} · ${S.state.reports.length} ${plural(S.state.reports.length, 'отчёт', 'отчёта', 'отчётов')} · ${nPhotos} фото</p>
        <div class="btn-row">
          <button type="button" class="btn accent" data-act="export">${icon('download')}Сохранить копию</button>
          <label class="btn">${icon('upload')}Восстановить из файла<input type="file" accept="application/json,.json" id="imp" hidden></label>
        </div>
      </section>
      <section class="sec card" data-f="install">
        <h3 class="sec-h">Установить на телефон</h3>
        <p><b>Android, Chrome:</b> меню ⋮ → «Установить приложение» или «Добавить на главный экран».</p>
        <p><b>iPhone, Safari:</b> кнопка «Поделиться» → «На экран „Домой“».</p>
        <p class="muted">После установки приложение открывается без адресной строки, а карта уже просмотренных мест и сохранённая погода доступны без интернета.</p>
      </section>
      <section class="sec card">
        <h3 class="sec-h">Откуда данные</h3>
        <p>Погода — <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. Давление показано на уровне местности, как на бытовом барометре, в мм рт. ст. Ветер — на высоте 10 м.</p>
        <p>Карта — © участники <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>, спутник — Esri. Поиск и названия мест — Nominatim.</p>
        <p class="muted">Фаза луны рассчитывается на устройстве.</p>
      </section>
    </div>
  </div>`);
  $('[data-act=back]', node).onclick = () => ctx.back('#journal');
  if (ctx.canInstall()) {
    const b = el(`<button type="button" class="btn accent">${icon('download')}Установить приложение</button>`);
    b.onclick = () => ctx.install();
    $('[data-f=install]', node).append(b);
  }
  navigator.storage?.estimate?.().then(e => {
    if (!e || !e.usage) return;
    const u = $('[data-f=usage]', node);
    if (u) u.textContent += ` · занято ${num(e.usage / 1048576, 1)} МБ`;
  });
  $('[data-act=export]', node).onclick = async e => {
    const b = e.currentTarget;
    b.disabled = true;
    try {
      const blob = await S.exportData();
      const name = `klev-kopiya-${todayISO()}.json`;
      const file = new File([blob], name, { type: 'application/json' });
      if (/Android|iPhone|iPad/i.test(navigator.userAgent) && navigator.canShare && navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Копия журнала «Клёв»' }); return; } catch (err) { if (err.name === 'AbortError') return; }
      }
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
      ctx.toast('Копия сохранена в загрузки');
    } catch (err) {
      ctx.toast('Не получилось: ' + err.message);
    } finally {
      b.disabled = false;
    }
  };
  $('#imp', node).onchange = async e => {
    const f = e.target.files[0];
    e.target.value = '';
    if (!f) return;
    const ok = await ctx.ask({ title: 'Восстановить из копии?', text: 'Места и отчёты из файла добавятся к текущим. Совпадающие записи заменятся версией из файла.', ok: 'Восстановить' });
    if (!ok) return;
    try {
      const res = await S.importData(f);
      ctx.toast(`Готово: ${res.spots} ${plural(res.spots, 'место', 'места', 'мест')}, ${res.reports} ${plural(res.reports, 'отчёт', 'отчёта', 'отчётов')}`);
      ctx.refreshMarkers();
      ctx.replace('#journal');
    } catch (err) {
      ctx.toast(err.message);
    }
  };
  return node;
}
