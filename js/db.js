// Хранилище на устройстве (IndexedDB): места, отчёты, фото.

const NAME = 'klev';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('spots')) d.createObjectStore('spots', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('reports')) {
        d.createObjectStore('reports', { keyPath: 'id' }).createIndex('spotId', 'spotId');
      }
      if (!d.objectStoreNames.contains('photos')) d.createObjectStore('photos', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Приложение открыто в другой вкладке. Закройте её и обновите страницу.'));
  });
  dbp.catch(() => { dbp = null; });
  return dbp;
}

function run(store, mode, fn) {
  return open().then(d => new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && typeof r === 'object' && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Запись отменена'));
  }));
}

export const db = {
  all: store => run(store, 'readonly', s => s.getAll()),
  get: (store, id) => run(store, 'readonly', s => s.get(id)),
  put: (store, v) => run(store, 'readwrite', s => s.put(v)),
  del: (store, id) => run(store, 'readwrite', s => s.delete(id)),
  putMany: (store, arr) => run(store, 'readwrite', s => { arr.forEach(v => s.put(v)); }),
  delMany: (store, ids) => run(store, 'readwrite', s => { ids.forEach(id => s.delete(id)); }),
  count: store => run(store, 'readonly', s => s.count()),
};
