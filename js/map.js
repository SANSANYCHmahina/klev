// Собственный лёгкий движок карты: тайлы OSM/Esri, перетаскивание с инерцией,
// щипок и колесо для масштаба, двойной тап, метки, круги. API — подмножество Leaflet,
// чтобы приложение не зависело от внешних библиотек и CDN.

const TS = 256;
const MAXLAT = 85.05112878;
const clampLat = lat => Math.max(-MAXLAT, Math.min(MAXLAT, lat));

class Point {
  constructor(x, y) { this.x = x; this.y = y; }
  add(p) { p = toPoint(p); return new Point(this.x + p.x, this.y + p.y); }
  subtract(p) { p = toPoint(p); return new Point(this.x - p.x, this.y - p.y); }
}
class LatLng {
  constructor(lat, lng) { this.lat = lat; this.lng = lng; }
}
const toPoint = p => (p instanceof Point ? p : Array.isArray(p) ? new Point(p[0], p[1]) : new Point(p.x, p.y));
const toLL = a => (a instanceof LatLng ? a : Array.isArray(a) ? new LatLng(a[0], a[1]) : new LatLng(a.lat, a.lng ?? a.lon));

function proj(lat, lng, z) {
  const s = TS * 2 ** z;
  const sin = Math.sin(clampLat(lat) * Math.PI / 180);
  return new Point((lng + 180) / 360 * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s);
}
function unproj(x, y, z) {
  const s = TS * 2 ** z;
  const n = Math.PI - 2 * Math.PI * y / s;
  return new LatLng(180 / Math.PI * Math.atan(Math.sinh(n)), x / s * 360 - 180);
}
const div = cls => { const d = document.createElement('div'); d.className = cls; return d; };
const mid = (a, b) => new Point((a.x + b.x) / 2, (a.y + b.y) / 2);

class Evented {
  on(t, f) { this._ev = this._ev || {}; (this._ev[t] = this._ev[t] || []).push(f); return this; }
  off(t, f) { if (this._ev && this._ev[t]) this._ev[t] = this._ev[t].filter(x => x !== f); return this; }
  fire(t, e = {}) { ((this._ev || {})[t] || []).slice().forEach(f => f({ type: t, target: this, ...e })); return this; }
}

class Layer extends Evented {
  addTo(m) { m.addLayer(this); return this; }
  remove() { if (this._map) this._map.removeLayer(this); return this; }
}

class MapView extends Evented {
  constructor(el, o = {}) {
    super();
    this.el = typeof el === 'string' ? document.getElementById(el) : el;
    this.o = { minZoom: 2, maxZoom: 19, ...o };
    this.el.classList.add('mm');
    this.el.tabIndex = 0;
    this.el.setAttribute('role', 'application');
    this.pane = div('mm-pane');
    this.tilePane = div('mm-tiles');
    this.overPane = div('mm-over');
    this.markerPane = div('mm-markers');
    this.pane.append(this.tilePane, this.overPane, this.markerPane);
    this.ctrls = div('mm-ctrls');
    this.attr = div('mm-attr');
    this.el.append(this.pane, this.ctrls, this.attr);
    this._center = new LatLng(0, 0);
    this._zoom = 3;
    this._layers = new Set();
    this._prefix = '';
    const self = this;
    this.attributionControl = { setPrefix(p) { self._prefix = p || ''; self._updAttr(); return this; } };
    this._size = new Point(this.el.clientWidth || 1, this.el.clientHeight || 1);
    if ('ResizeObserver' in window) new ResizeObserver(() => this.invalidateSize()).observe(this.el);
    else window.addEventListener('resize', () => this.invalidateSize());
    this._initInput();
  }

  getSize() { return new Point(this._size.x, this._size.y); }
  getCenter() { return new LatLng(this._center.lat, this._center.lng); }
  getZoom() { return this._zoom; }
  project(ll, z = this._zoom) { ll = toLL(ll); return proj(ll.lat, ll.lng, z); }
  unproject(p, z = this._zoom) { p = toPoint(p); return unproj(p.x, p.y, z); }
  _clampZ(z) { return Math.max(this.o.minZoom, Math.min(this.o.maxZoom, Math.round(z))); }
  _origin() {
    const c = this.project(this._center);
    return new Point(c.x - this._size.x / 2, c.y - this._size.y / 2);
  }
  latLngToContainerPoint(ll) {
    const p = this.project(ll), o = this._origin();
    const ws = TS * 2 ** this._zoom, cx = this._size.x / 2;
    let x = p.x - o.x;
    while (x - cx > ws / 2) x -= ws;
    while (cx - x > ws / 2) x += ws;
    return new Point(x, p.y - o.y);
  }
  containerPointToLatLng(pt) {
    const o = this._origin();
    return this.unproject(new Point(o.x + pt.x, o.y + pt.y));
  }

  invalidateSize() {
    const w = this.el.clientWidth, h = this.el.clientHeight;
    if (w && h && (w !== this._size.x || h !== this._size.y)) {
      this._size = new Point(w, h);
      this._update(false);
    }
    return this;
  }

  _set(center, zoom) {
    zoom = this._clampZ(zoom);
    const lng = (((center.lng + 180) % 360) + 360) % 360 - 180;
    this._center = new LatLng(clampLat(center.lat), lng);
    const zc = zoom !== this._zoom;
    this._zoom = zoom;
    this._update(zc);
  }

  setView(c, z, opts = {}) {
    c = toLL(c);
    z = this._clampZ(z ?? this._zoom);
    this._stopAnim();
    this._stopInertia(true);
    if (opts.animate && z === this._zoom) {
      const a = this.project(this._center), b = this.project(c);
      const d = Math.hypot(b.x - a.x, b.y - a.y);
      if (d > 1 && d < 3 * Math.max(this._size.x, this._size.y)) { this._animPan(a, b); return this; }
    }
    this._set(c, z);
    this.fire('moveend');
    return this;
  }

  fitBounds(b, o = {}) {
    const sw = toLL(b[0]), ne = toLL(b[1]);
    const pad = o.padding ? toPoint(o.padding).x : 0;
    let z = this._clampZ(Math.min(o.maxZoom ?? this.o.maxZoom, this.o.maxZoom));
    for (; z > this.o.minZoom; z--) {
      const p1 = this.project(sw, z), p2 = this.project(ne, z);
      if (Math.abs(p2.x - p1.x) <= this._size.x - 2 * pad && Math.abs(p2.y - p1.y) <= this._size.y - 2 * pad) break;
    }
    const p1 = this.project(sw, z), p2 = this.project(ne, z);
    return this.setView(this.unproject(mid(p1, p2), z), z);
  }

  zoomIn() { this.zoomAround(new Point(this._size.x / 2, this._size.y / 2), 1); return this; }
  zoomOut() { this.zoomAround(new Point(this._size.x / 2, this._size.y / 2), -1); return this; }

  zoomAround(p, dz) {
    const z1 = this._clampZ(this._zoom + dz);
    if (z1 === this._zoom) return;
    this._stopAnim();
    this._stopInertia(false);
    const ll = this.containerPointToLatLng(p);
    const s = 2 ** (z1 - this._zoom);
    const t0 = performance.now(), dur = 230;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const finish = () => {
      this._raf = null;
      this._clearTransform();
      const c = this.project(ll, z1).subtract(p).add(new Point(this._size.x / 2, this._size.y / 2));
      this._set(this.unproject(c, z1), z1);
      this.fire('moveend');
    };
    if (reduce) { finish(); return; }
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      this._transform(1 + (s - 1) * e, p, p);
      if (k < 1) this._raf = requestAnimationFrame(step); else finish();
    };
    this._raf = requestAnimationFrame(step);
  }

  _animPan(a, b) {
    const t0 = performance.now(), dur = 320;
    const step = now => {
      const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 3;
      this._set(this.unproject(new Point(a.x + (b.x - a.x) * e, a.y + (b.y - a.y) * e)), this._zoom);
      if (k < 1) this._raf = requestAnimationFrame(step);
      else { this._raf = null; this.fire('moveend'); }
    };
    this._raf = requestAnimationFrame(step);
  }
  _stopAnim() {
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = null; this._clearTransform(); }
  }

  _inertia(vx, vy) {
    let last = performance.now();
    const step = now => {
      const dt = Math.min(40, now - last);
      last = now;
      const c = this.project(this._center);
      this._set(this.unproject(new Point(c.x - vx * dt, c.y - vy * dt)), this._zoom);
      const k = 0.9955 ** dt;
      vx *= k; vy *= k;
      if (Math.hypot(vx, vy) > 0.03) this._iraf = requestAnimationFrame(step);
      else { this._iraf = null; this.fire('moveend'); }
    };
    this._iraf = requestAnimationFrame(step);
  }
  _stopInertia(silent) {
    if (this._iraf) { cancelAnimationFrame(this._iraf); this._iraf = null; if (!silent) this.fire('moveend'); }
  }

  _transform(s, m0, m) {
    this.pane.style.transform = `translate(${m.x - s * m0.x}px, ${m.y - s * m0.y}px) scale(${s})`;
  }
  _clearTransform() { this.pane.style.transform = ''; }

  addLayer(l) {
    if (this._layers.has(l)) return this;
    this._layers.add(l);
    l._map = this;
    l._add(this);
    this._updAttr();
    return this;
  }
  removeLayer(l) {
    if (!this._layers.has(l)) return this;
    this._layers.delete(l);
    l._remove();
    l._map = null;
    this._updAttr();
    return this;
  }
  hasLayer(l) { return this._layers.has(l); }

  _update(zc) { this._layers.forEach(l => l._update && l._update(zc)); }

  _updAttr() {
    const parts = [...this._layers].map(l => l.options && l.options.attribution).filter(Boolean);
    this.attr.innerHTML = [this._prefix, ...new Set(parts)].filter(Boolean).join(' | ');
    this.attr.hidden = !this.attr.innerHTML;
  }

  _initInput() {
    const el = this.el;
    const pts = new Map();
    let drag = null, pinch = null, track = [];
    const rel = e => { const r = el.getBoundingClientRect(); return new Point(e.clientX - r.left, e.clientY - r.top); };

    el.addEventListener('pointerdown', e => {
      if (e.target.closest('.mm-ctrls, .mm-attr')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      this._stopAnim();
      this._stopInertia(true);
      try { el.setPointerCapture(e.pointerId); } catch {}
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pts.size === 1) {
        drag = { start: p, c0: this.project(this._center), t0: performance.now(), moved: false, target: e.target, type: e.pointerType };
        track = [{ p, t: performance.now() }];
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const m = mid(a, b);
        pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, m0: m, m, s: 1, z0: this._zoom, ll: this.containerPointToLatLng(m) };
        drag = null;
        el.classList.add('mm-dragging');
      }
    });

    el.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = rel(e);
      pts.set(e.pointerId, p);
      if (pinch && pts.size >= 2) {
        const [a, b] = [...pts.values()];
        pinch.s = Math.max(0.12, Math.min(16, Math.hypot(a.x - b.x, a.y - b.y) / pinch.d0));
        pinch.m = mid(a, b);
        this._transform(pinch.s, pinch.m0, pinch.m);
      } else if (drag) {
        const dx = p.x - drag.start.x, dy = p.y - drag.start.y;
        if (!drag.moved && Math.hypot(dx, dy) < (drag.type === 'mouse' ? 3 : 8)) return;
        drag.moved = true;
        el.classList.add('mm-dragging');
        this._set(this.unproject(new Point(drag.c0.x - dx, drag.c0.y - dy)), this._zoom);
        track.push({ p, t: performance.now() });
        if (track.length > 8) track.shift();
      }
    });

    const up = e => {
      if (!pts.has(e.pointerId)) return;
      const p = rel(e);
      pts.delete(e.pointerId);
      if (pinch) {
        if (pts.size < 2) {
          const z1 = this._clampZ(pinch.z0 + Math.log2(pinch.s));
          this._clearTransform();
          const c = this.project(pinch.ll, z1).subtract(pinch.m).add(new Point(this._size.x / 2, this._size.y / 2));
          this._set(this.unproject(c, z1), z1);
          this.fire('moveend');
          pinch = null;
          if (pts.size === 1) {
            const [q] = pts.values();
            drag = { start: q, c0: this.project(this._center), t0: performance.now(), moved: true, target: null, type: 'touch' };
            track = [];
          } else el.classList.remove('mm-dragging');
        }
        return;
      }
      if (!drag) return;
      el.classList.remove('mm-dragging');
      if (!drag.moved) {
        if (e.type === 'pointerup' && performance.now() - drag.t0 < 700) this._tap(p, drag.target);
      } else {
        const now = performance.now();
        const recent = track.filter(s => now - s.t < 120);
        if (e.type === 'pointerup' && recent.length >= 2) {
          const a = recent[0], b = recent[recent.length - 1];
          const dt = Math.max(16, b.t - a.t);
          let vx = (b.p.x - a.p.x) / dt, vy = (b.p.y - a.p.y) / dt;
          const sp = Math.hypot(vx, vy);
          if (sp > 3) { vx *= 3 / sp; vy *= 3 / sp; }
          if (sp > 0.25 && !matchMedia('(prefers-reduced-motion: reduce)').matches) this._inertia(vx, vy);
          else this.fire('moveend');
        } else this.fire('moveend');
      }
      drag = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);

    let acc = 0, wheelT = 0;
    el.addEventListener('wheel', e => {
      e.preventDefault();
      acc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
      const now = performance.now();
      if (this._raf || now - wheelT < 200 || Math.abs(acc) < 40) return;
      const dz = acc < 0 ? 1 : -1;
      acc = 0;
      wheelT = now;
      this.zoomAround(rel(e), dz);
    }, { passive: false });

    el.addEventListener('keydown', e => {
      const step = 90;
      const c = this.project(this._center);
      const mv = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (mv) {
        e.preventDefault();
        this._animPan(c, c.add(new Point(mv[0], mv[1])));
      } else if (e.key === '+' || e.key === '=') { e.preventDefault(); this.zoomIn(); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); this.zoomOut(); }
    });
  }

  // Одиночный тап — «клик» по карте (с задержкой, чтобы распознать двойной тап).
  _tap(p, target) {
    const mk = target && target.closest && target.closest('.mm-marker');
    if (mk && mk._mm && mk._mm.options.interactive !== false) {
      mk._mm.fire('click', { latlng: mk._mm._ll });
      return;
    }
    const now = performance.now();
    if (this._lastTap && now - this._lastTap.t < 320 && Math.hypot(p.x - this._lastTap.p.x, p.y - this._lastTap.p.y) < 36) {
      clearTimeout(this._tapT);
      this._lastTap = null;
      this.zoomAround(p, 1);
      return;
    }
    const ll = this.containerPointToLatLng(p);
    this._lastTap = { t: now, p };
    clearTimeout(this._tapT);
    this._tapT = setTimeout(() => { this._lastTap = null; this.fire('click', { latlng: ll }); }, 290);
  }
}

// ---------- слои ----------
class TileLayer extends Layer {
  constructor(url, o = {}) {
    super();
    this.url = url;
    this.options = { maxZoom: 19, ...o };
    this._tiles = new Map();
  }
  _add(m) {
    this._box = div('mm-layer');
    m.tilePane.append(this._box);
    this._update(false);
  }
  _remove() {
    this._dropBack();
    if (this._box) this._box.remove();
    this._box = null;
    this._tiles.clear();
  }
  _url(x, y, z) {
    const n = 2 ** z;
    const xx = ((x % n) + n) % n;
    return this.url.replace('{z}', z).replace('{x}', xx).replace('{y}', y);
  }
  _update(zc) {
    const m = this._map;
    if (!m || !this._box) return;
    const z = m._zoom;
    const tz = Math.min(z, this.options.maxNativeZoom ?? this.options.maxZoom);
    const ts = TS * 2 ** (z - tz);
    const n = 2 ** tz;
    const o = m._origin(), size = m._size;
    if (zc && this._tiles.size && this._lastO) {
      this._dropBack();
      const old = this._box;
      old.classList.add('mm-back');
      this._back = { el: old, z: this._lastZ, o: this._lastO };
      this._box = div('mm-layer');
      old.after(this._box);
      this._tiles = new Map();
      this._backT = setTimeout(() => this._dropBack(), 2500);
    }
    const x0 = Math.floor(o.x / ts) - 1, x1 = Math.floor((o.x + size.x) / ts) + 1;
    const y0 = Math.max(0, Math.floor(o.y / ts) - 1), y1 = Math.min(n - 1, Math.floor((o.y + size.y) / ts) + 1);
    const keep = new Set();
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const key = tz + '/' + x + '/' + y;
        keep.add(key);
        let t = this._tiles.get(key);
        if (!t) {
          t = new Image();
          t.className = 'mm-tile';
          t.alt = '';
          t.decoding = 'async';
          t.draggable = false;
          t.onload = () => { t.classList.add('ok'); this._checkLoaded(); };
          t.onerror = () => { t.classList.add('err'); this._checkLoaded(); };
          t.src = this._url(x, y, tz);
          this._tiles.set(key, t);
          this._box.append(t);
        }
        if (t._ts !== ts) { t.style.width = t.style.height = ts + 'px'; t._ts = ts; }
        t.style.transform = `translate(${Math.round(x * ts - o.x)}px, ${Math.round(y * ts - o.y)}px)`;
      }
    }
    for (const [k, t] of this._tiles) if (!keep.has(k)) { t.src = ''; t.remove(); this._tiles.delete(k); }
    this._lastO = o;
    this._lastZ = z;
    if (this._back) {
      const s = 2 ** (z - this._back.z);
      this._back.el.style.transform = `translate(${s * this._back.o.x - o.x}px, ${s * this._back.o.y - o.y}px) scale(${s})`;
    }
  }
  _checkLoaded() {
    if (!this._back) return;
    for (const t of this._tiles.values()) if (!t.classList.contains('ok') && !t.classList.contains('err')) return;
    setTimeout(() => this._dropBack(), 220);
  }
  _dropBack() {
    clearTimeout(this._backT);
    if (this._back) { this._back.el.remove(); this._back = null; }
  }
}

class LayerGroup extends Layer {
  constructor(ls) { super(); this._ls = new Set(ls || []); }
  _add(m) { this._ls.forEach(l => m.addLayer(l)); }
  _remove() { this._ls.forEach(l => { if (l._map) l._map.removeLayer(l); }); }
  addLayer(l) { this._ls.add(l); if (this._map) this._map.addLayer(l); return this; }
  removeLayer(l) { this._ls.delete(l); if (l._map) l._map.removeLayer(l); return this; }
  clearLayers() { [...this._ls].forEach(l => this.removeLayer(l)); return this; }
}

class DivIcon { constructor(o = {}) { this.options = o; } }

class Marker extends Layer {
  constructor(ll, o = {}) { super(); this._ll = toLL(ll); this.options = o; }
  _add(m) {
    const ic = (this.options.icon || new DivIcon()).options;
    const el = div('mm-marker ' + (ic.className || ''));
    el.innerHTML = ic.html || '';
    const sz = ic.iconSize || [12, 12];
    const an = ic.iconAnchor || [sz[0] / 2, sz[1] / 2];
    el.style.width = sz[0] + 'px';
    el.style.height = sz[1] + 'px';
    el.style.marginLeft = -an[0] + 'px';
    el.style.marginTop = -an[1] + 'px';
    if (this.options.interactive !== false) {
      el.classList.add('mm-int');
      if (this.options.title) { el.title = this.options.title; el.setAttribute('aria-label', this.options.title); }
      if (this.options.keyboard !== false) {
        el.tabIndex = 0;
        el.setAttribute('role', 'button');
        el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this.fire('click', { latlng: this._ll }); } });
      }
    }
    el._mm = this;
    this._el = el;
    m.markerPane.append(el);
    this._update();
  }
  _remove() { if (this._el) this._el.remove(); this._el = null; }
  _update() {
    if (!this._el || !this._map) return;
    const p = this._map.latLngToContainerPoint(this._ll);
    this._el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px)`;
    this._el.style.zIndex = Math.round(p.y) + (this.options.zIndexOffset || 0) + 10000;
  }
  setLatLng(ll) { this._ll = toLL(ll); this._update(); return this; }
  getLatLng() { return this._ll; }
  getElement() { return this._el; }
}

class Circle extends Layer {
  constructor(ll, o = {}) { super(); this._ll = toLL(ll); this.options = o; }
  _add(m) {
    const el = div('mm-circle');
    el.style.background = this.options.fillColor || '#2f7fd1';
    el.style.opacity = this.options.fillOpacity ?? 0.2;
    this._el = el;
    m.overPane.append(el);
    this._update();
  }
  _remove() { if (this._el) this._el.remove(); this._el = null; }
  _update() {
    if (!this._el || !this._map) return;
    const m = this._map;
    const p = m.latLngToContainerPoint(this._ll);
    const mpp = 156543.03392 * Math.cos(this._ll.lat * Math.PI / 180) / 2 ** m._zoom;
    const r = Math.max(4, (this.options.radius || 10) / mpp);
    if (r > 4000) { this._el.style.display = 'none'; return; }
    this._el.style.display = '';
    this._el.style.width = this._el.style.height = 2 * r + 'px';
    this._el.style.transform = `translate(${p.x - r}px, ${p.y - r}px)`;
  }
  setLatLng(ll) { this._ll = toLL(ll); this._update(); return this; }
  setRadius(r) { this.options.radius = r; this._update(); return this; }
}

// Картинка, привязанная к координатам (слой глубин). bounds: [[юг, запад], [север, восток]].
class ImageOverlay extends Layer {
  constructor(url, bounds, o = {}) {
    super();
    this.url = url;
    this._sw = toLL(bounds[0]);
    this._ne = toLL(bounds[1]);
    this.options = { opacity: 1, ...o };
    this._off = { lat: 0, lng: 0 };
  }
  _add(m) {
    const img = new Image();
    img.className = 'mm-image';
    img.alt = '';
    img.draggable = false;
    img.decoding = 'async';
    img.style.opacity = this.options.opacity;
    this._el = img;
    this._lvl = null;
    m.overPane.append(img);
    this._update();
  }
  // Подбираем картинку нужного размера: на дальнем масштабе — уменьшенную, чтобы линии не рябили.
  _pickLevel(w) {
    const lv = this.options.levels, full = this.options.width;
    if (!lv || !full) return null;
    const need = w * (window.devicePixelRatio || 1);
    let n = lv[0];
    for (const x of lv) if (full / x >= need * 0.9) n = x;
    return n;
  }
  _src(n) { return n == null ? this.url : this.url.replace('{n}', n); }
  _remove() { if (this._el) this._el.remove(); this._el = null; }
  _corners() {
    return [
      new LatLng(this._ne.lat + this._off.lat, this._sw.lng + this._off.lng),
      new LatLng(this._sw.lat + this._off.lat, this._ne.lng + this._off.lng),
    ];
  }
  _update() {
    if (!this._el || !this._map) return;
    const [nw, se] = this._corners();
    const a = this._map.latLngToContainerPoint(nw), b = this._map.latLngToContainerPoint(se);
    this._el.style.width = (b.x - a.x) + 'px';
    this._el.style.height = (b.y - a.y) + 'px';
    this._el.style.transform = `translate(${a.x}px, ${a.y}px)`;
    const n = this._pickLevel(b.x - a.x);
    if (n !== this._lvl || !this._el.getAttribute('src')) {
      this._lvl = n;
      const src = this._src(n);
      if (!this._el.getAttribute('src')) { this._el.src = src; return; }
      const pre = new Image();
      pre.onload = () => { if (this._el && this._lvl === n) this._el.src = src; };
      pre.src = src;
    }
  }
  getBounds() { const [nw, se] = this._corners(); return [[se.lat, nw.lng], [nw.lat, se.lng]]; }
  setOpacity(o) { this.options.opacity = o; if (this._el) this._el.style.opacity = o; return this; }
  setOffset(lat, lng) { this._off = { lat, lng }; this._update(); return this; }
  getOffset() { return { ...this._off }; }
  getElement() { return this._el; }
}

function zoomControl(o = {}) {
  return {
    addTo(m) {
      const box = div('mm-zoom');
      box.innerHTML = `<button type="button" aria-label="${o.zoomInTitle || 'Zoom in'}" title="${o.zoomInTitle || ''}">+</button><button type="button" aria-label="${o.zoomOutTitle || 'Zoom out'}" title="${o.zoomOutTitle || ''}">−</button>`;
      const [a, b] = box.querySelectorAll('button');
      a.onclick = () => m.zoomIn();
      b.onclick = () => m.zoomOut();
      m.ctrls.append(box);
      return this;
    },
  };
}

export const L = {
  map: (el, o) => new MapView(el, o),
  tileLayer: (url, o) => new TileLayer(url, o),
  layerGroup: ls => new LayerGroup(ls),
  marker: (ll, o) => new Marker(ll, o),
  divIcon: o => new DivIcon(o),
  circle: (ll, o) => new Circle(ll, o),
  imageOverlay: (url, bounds, o) => new ImageOverlay(url, bounds, o),
  latLng: (a, b) => (b != null ? new LatLng(a, b) : toLL(a)),
  point: (x, y) => new Point(x, y),
  control: { zoom: zoomControl },
};
