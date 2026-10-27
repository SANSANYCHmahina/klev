// Service worker: приложение и просмотренные куски карты работают без интернета.
const VERSION = 'klev-v4';
const SHELL = VERSION + '-shell';
const TILES = 'klev-tiles';
const LIBS = 'klev-libs';
const MAX_TILES = 2500;

const SHELL_FILES = [
  './', 'index.html', 'manifest.webmanifest', 'css/app.css',
  'js/app.js', 'js/map.js', 'js/depth.js', 'js/views.js', 'js/store.js', 'js/weather.js', 'js/charts.js', 'js/icons.js', 'js/db.js', 'js/util.js',
  'depth/rogozhkino-1.webp', 'depth/rogozhkino-2.webp', 'depth/rogozhkino-4.webp',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png',
];
const TILE_HOSTS = ['tile.openstreetmap.org', 'server.arcgisonline.com'];
const LIB_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.endsWith('-shell') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

let tilePuts = 0;
async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  if (keys.length <= MAX_TILES) return;
  await Promise.all(keys.slice(0, keys.length - MAX_TILES).map(k => c.delete(k)));
}

// Для картинок и скриптов с других сайтов просим CORS-ответ, чтобы его можно было сохранить.
async function corsFetch(req) {
  try {
    const r = await fetch(req.url, { mode: 'cors', credentials: 'omit' });
    if (r.ok) return r;
  } catch {}
  return fetch(req);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    e.respondWith((async () => {
      // Сначала сеть (чтобы обновления были видны сразу), без сети или при медленной связи — сохранённая копия.
      const c = await caches.open(SHELL);
      const key = req.mode === 'navigate' ? 'index.html' : req;
      const net = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(key, r.clone()); return r; });
      try {
        const r = await Promise.race([net, new Promise(res => setTimeout(res, 3500, null))]);
        if (r) return r;
      } catch {}
      const hit = await c.match(key, { ignoreSearch: true });
      if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
      try { return await net; } catch {
        return new Response('Нет сети', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith((async () => {
      const c = await caches.open(TILES);
      const hit = await c.match(req.url);
      if (hit) return hit;
      try {
        const r = await corsFetch(req);
        if (r.ok && r.type !== 'opaque') {
          await c.put(req.url, r.clone());
          if (++tilePuts % 100 === 0) e.waitUntil(trimTiles());
        }
        return r;
      } catch {
        return new Response('', { status: 504 });
      }
    })());
    return;
  }

  if (LIB_HOSTS.includes(url.hostname)) {
    e.respondWith((async () => {
      const c = await caches.open(LIBS);
      const hit = await c.match(req.url);
      if (hit) return hit;
      const r = await corsFetch(req);
      if (r.ok && r.type !== 'opaque') c.put(req.url, r.clone());
      return r;
    })());
    return;
  }

});
