// Графики (SVG), барометр-циферблат, значок луны.
import { DOW, DAY, fTime, fDay, num, esc } from './util.js';

const STEPS = [0.5, 1, 2, 5, 10, 20, 50, 100];

/**
 * Линейный график по часам.
 * cfg: { data, lines:[{get, cls, area, fmt}], from, to, off, now, band:[a,b], height, minSpan, zero, aria }
 */
export function chart(el, cfg) {
  el.classList.add('chart');
  let lastW = 0;
  const draw = () => {
    const W = Math.round(el.clientWidth);
    if (!W || W === lastW) return;
    lastW = W;
    render(el, cfg, W);
  };
  if ('ResizeObserver' in window) {
    new ResizeObserver(draw).observe(el);
  } else {
    window.addEventListener('resize', draw);
  }
  requestAnimationFrame(draw);
}

function render(el, cfg, W) {
  const H = cfg.height || 150;
  const m = { l: 34, r: 10, t: 18, b: 22 };
  const iw = W - m.l - m.r, ih = H - m.t - m.b;
  const { from, to, off = 0, now } = cfg;
  const offMs = off * 1000;
  const inRange = cfg.data.filter(d => d.t >= from && d.t <= to);
  const series = cfg.lines.map(L => ({
    ...L,
    pts: inRange.map(d => ({ t: d.t, v: L.get(d) })).filter(p => p.v != null && !Number.isNaN(p.v)),
  }));
  const all = series.flatMap(s => s.pts.map(p => p.v));
  if (all.length < 2) {
    el.innerHTML = '<div class="chart-empty">Нет данных за этот период</div>';
    return;
  }
  let min = Math.min(...all), max = Math.max(...all);
  if (cfg.zero) min = 0;
  const minSpan = cfg.minSpan || 1;
  if (max - min < minSpan) {
    if (cfg.zero) max = min + minSpan;
    else { const c = (max + min) / 2; min = c - minSpan / 2; max = c + minSpan / 2; }
  }
  const step = STEPS.find(s => (max - min) / s <= 4) || 100;
  const lo = Math.floor(min / step) * step;
  let hi = Math.ceil(max / step) * step;
  if (hi <= lo) hi = lo + step;
  const x = t => m.l + (t - from) / (to - from) * iw;
  const y = v => m.t + (1 - (v - lo) / (hi - lo)) * ih;
  const f1 = v => v.toFixed(1);
  let g = '';

  for (let v = lo; v <= hi + 1e-9; v += step) {
    const yy = f1(y(v));
    g += `<line class="g" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
    g += `<text class="yl" x="${m.l - 6}" y="${f1(+yy + 3.5)}">${num(v, step < 1 ? 1 : 0)}</text>`;
  }

  const dayW = DAY / (to - from) * iw;
  const every = dayW < 24 ? 3 : dayW < 34 ? 2 : 1;
  const first = Math.ceil((from + offMs) / DAY) * DAY - offMs;
  let di = 0;
  for (let t = first - DAY; t < to; t += DAY, di++) {
    if (t > from) g += `<line class="gd" x1="${f1(x(t))}" x2="${f1(x(t))}" y1="${m.t}" y2="${H - m.b}"/>`;
    const mid = t + DAY / 2;
    const xm = x(mid);
    if (di % every === 0 && xm > m.l + 12 && xm < W - m.r - 12) {
      const d = new Date(mid + offMs);
      const lbl = dayW * every < 44 ? String(d.getUTCDate()) : DOW[d.getUTCDay()] + ' ' + d.getUTCDate();
      g += `<text class="xl" x="${f1(xm)}" y="${H - 6}">${lbl}</text>`;
    }
  }

  if (cfg.band) {
    const xa = Math.max(m.l, x(cfg.band[0])), xb = Math.min(W - m.r, x(cfg.band[1]));
    if (xb > m.l && xa < W - m.r) {
      g += `<rect class="band" x="${f1(xa)}" y="${m.t}" width="${f1(Math.max(3, xb - xa))}" height="${ih}" rx="2"/>`;
      if (cfg.bandLabel) g += `<text class="bandl" x="${f1(Math.min(W - m.r - 2, Math.max(m.l + 2, (xa + xb) / 2)))}" y="${m.t - 6}">${esc(cfg.bandLabel)}</text>`;
    }
  }

  const path = pts => pts.map((p, i) => (i ? 'L' : 'M') + f1(x(p.t)) + ' ' + f1(y(p.v))).join('');
  for (const s of series) {
    if (s.pts.length < 2) continue;
    const past = now ? s.pts.filter(p => p.t <= now) : s.pts;
    const fut = now ? s.pts.filter(p => p.t >= now) : [];
    if (past.length && fut.length) fut.unshift(past[past.length - 1]);
    if (s.area) {
      const a = s.pts;
      g += `<path class="area ${s.cls}" d="${path(a)}L${f1(x(a[a.length - 1].t))} ${f1(y(lo))}L${f1(x(a[0].t))} ${f1(y(lo))}Z"/>`;
    }
    if (past.length > 1) g += `<path class="ln ${s.cls}" d="${path(past)}"/>`;
    if (fut.length > 1) g += `<path class="ln fut ${s.cls}" d="${path(fut)}"/>`;
  }

  const main = series[0];
  if (now && now >= from && now <= to) {
    const xn = f1(x(now));
    g += `<line class="now" x1="${xn}" x2="${xn}" y1="${m.t - 3}" y2="${H - m.b}"/>`;
    g += `<text class="nowl" x="${Math.min(W - m.r - 16, Math.max(m.l + 16, +xn))}" y="${m.t - 6}">сейчас</text>`;
    const v = interp(main.pts, now);
    if (v != null) g += `<circle class="dot ${main.cls}" cx="${xn}" cy="${f1(y(v))}" r="4"/>`;
  } else if (main.pts.length) {
    const p = main.pts[main.pts.length - 1];
    g += `<circle class="dot ${main.cls}" cx="${f1(x(p.t))}" cy="${f1(y(p.v))}" r="3.5"/>`;
  }

  el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${esc(cfg.aria || 'График')}">${g}` +
    `<g class="cur" visibility="hidden"><line class="cur-l" y1="${m.t}" y2="${H - m.b}"/>${series.map(s => `<circle class="cur-d ${s.cls}" r="3.5"/>`).join('')}</g>` +
    `<rect class="hit" x="${m.l}" y="0" width="${iw}" height="${H}" fill="transparent"/></svg><div class="tip" hidden></div>`;

  const svg = el.firstElementChild, cur = svg.querySelector('.cur'), tip = el.querySelector('.tip');
  const curL = cur.querySelector('.cur-l'), dots = [...cur.querySelectorAll('.cur-d')];
  let hideT;
  const show = ev => {
    const r = svg.getBoundingClientRect();
    const px = (ev.clientX - r.left) * (W / r.width);
    const t = from + (px - m.l) / iw * (to - from);
    const p = nearest(main.pts, t);
    if (!p) return;
    const xx = x(p.t);
    curL.setAttribute('x1', xx); curL.setAttribute('x2', xx);
    const parts = [];
    series.forEach((s, i) => {
      const q = s.pts.find(z => z.t === p.t);
      if (q) { dots[i].setAttribute('cx', xx); dots[i].setAttribute('cy', y(q.v)); dots[i].style.display = ''; parts.push(s.fmt ? s.fmt(q.v) : num(q.v)); }
      else dots[i].style.display = 'none';
    });
    cur.setAttribute('visibility', 'visible');
    tip.textContent = `${fDay(p.t, off)}, ${fTime(p.t, off)} · ${parts.join(' · ')}`;
    tip.hidden = false;
    const tw = tip.offsetWidth;
    const left = Math.min(el.clientWidth - tw, Math.max(0, xx * (r.width / W) - tw / 2));
    tip.style.left = left + 'px';
    clearTimeout(hideT);
  };
  const hide = (delay = 0) => {
    clearTimeout(hideT);
    hideT = setTimeout(() => { cur.setAttribute('visibility', 'hidden'); tip.hidden = true; }, delay);
  };
  const hit = svg.querySelector('.hit');
  hit.addEventListener('pointermove', show);
  hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => hide(0));
  hit.addEventListener('pointerup', e => { if (e.pointerType !== 'mouse') hide(1600); });
  hit.addEventListener('pointercancel', () => hide(0));
}

function nearest(pts, t) {
  if (!pts.length) return null;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].t <= t) lo = mid; else hi = mid;
  }
  return Math.abs(pts[lo].t - t) <= Math.abs(pts[hi].t - t) ? pts[lo] : pts[hi];
}

function interp(pts, t) {
  if (!pts.length) return null;
  const i = pts.findIndex(p => p.t >= t);
  if (i === -1) return null;
  if (i === 0) return pts[0].t === t ? pts[0].v : null;
  const a = pts[i - 1], b = pts[i];
  return a.v + (b.v - a.v) * ((t - a.t) / (b.t - a.t));
}

// Барометр: шкала в мм рт. ст., основная стрелка — сейчас, тонкая — сутки назад
// (как контрольная стрелка на настоящем барометре).
export function dial(cur, ref) {
  if (cur == null) return '';
  const lo = Math.round(cur / 10) * 10 - 25, hi = lo + 50;
  const cx = 74, cy = 76, r = 62;
  const clamp = v => Math.min(hi, Math.max(lo, v));
  const ang = v => Math.PI - (clamp(v) - lo) / (hi - lo) * Math.PI;
  const pt = (v, rr) => [cx + rr * Math.cos(ang(v)), cy - rr * Math.sin(ang(v))];
  const f = n => n.toFixed(1);
  let s = `<path class="bz-arc" d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}"/>`;
  for (let v = lo; v <= hi; v++) {
    const major = v % 5 === 0;
    const [x1, y1] = pt(v, r - 1), [x2, y2] = pt(v, r - (major ? 9 : 5));
    s += `<line class="${major ? 'bz-maj' : 'bz-min'}" x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}"/>`;
    if (v % 10 === 0) {
      const [tx, ty] = pt(v, r - 19);
      s += `<text class="bz-l" x="${f(tx)}" y="${f(ty + 3.5)}">${v}</text>`;
    }
  }
  if (ref != null) {
    const [rx, ry] = pt(ref, r - 4);
    s += `<line class="bz-ref" x1="${cx}" y1="${cy}" x2="${f(rx)}" y2="${f(ry)}"/>`;
  }
  const [nx, ny] = pt(cur, r - 8);
  s += `<line class="bz-needle" x1="${cx}" y1="${cy}" x2="${f(nx)}" y2="${f(ny)}"/>`;
  s += `<circle class="bz-hub" cx="${cx}" cy="${cy}" r="5"/>`;
  return `<svg class="baro" viewBox="0 0 148 84" role="img" aria-label="Барометр: ${Math.round(cur)} мм рт. ст.">${s}</svg>`;
}

export function moonIcon(phase) {
  const r = 8.5, cx = 12, cy = 12;
  const illum = (1 - Math.cos(2 * Math.PI * phase)) / 2;
  let lit = '';
  if (illum > 0.97) lit = `<circle class="moon-lit" cx="${cx}" cy="${cy}" r="${r}"/>`;
  else if (illum > 0.03) {
    const waxing = phase < 0.5;
    const k = (Math.abs(Math.cos(2 * Math.PI * phase)) * r).toFixed(2);
    const crescent = illum < 0.5;
    const limb = waxing ? 1 : 0;
    const term = waxing ? (crescent ? 0 : 1) : (crescent ? 1 : 0);
    lit = `<path class="moon-lit" d="M${cx} ${cy - r}A${r} ${r} 0 0 ${limb} ${cx} ${cy + r}A${k} ${r} 0 0 ${term} ${cx} ${cy - r}Z"/>`;
  }
  return `<svg class="i moon" viewBox="0 0 24 24" aria-hidden="true"><circle class="moon-dark" cx="${cx}" cy="${cy}" r="${r}"/>${lit}</svg>`;
}
