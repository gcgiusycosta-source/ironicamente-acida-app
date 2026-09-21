const IADB = (() => {
  const DB_NAME = 'ironicamente_acida_v1';
  const DB_VERSION = 3;
  let dbPromise;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('phrases')) {
          const s = db.createObjectStore('phrases', { keyPath: 'id' });
          s.createIndex('category', 'category', { unique: false });
          s.createIndex('used', 'used', { unique: false });
        }
        if (!db.objectStoreNames.contains('stickers')) {
          const s = db.createObjectStore('stickers', { keyPath: 'id' });
          s.createIndex('category', 'category', { unique: false });
        }
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('drafts')) {
          db.createObjectStore('drafts', { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  async function tx(store, mode = 'readonly') {
    const db = await open();
    return db.transaction(store, mode).objectStore(store);
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, key) { return reqPromise((await tx(store)).get(key)); }
  async function getAll(store) { return reqPromise((await tx(store)).getAll()); }
  async function put(store, value) { return reqPromise((await tx(store, 'readwrite')).put(value)); }
  async function del(store, key) { return reqPromise((await tx(store, 'readwrite')).delete(key)); }
  async function clear(store) { return reqPromise((await tx(store, 'readwrite')).clear()); }
  async function bulkPut(store, values) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tr = db.transaction(store, 'readwrite');
      const s = tr.objectStore(store);
      values.forEach(v => s.put(v));
      tr.oncomplete = () => resolve();
      tr.onerror = () => reject(tr.error);
      tr.onabort = () => reject(tr.error);
    });
  }

  async function metaGet(key, fallback = null) {
    const r = await get('meta', key);
    return r ? r.value : fallback;
  }
  async function metaSet(key, value) { return put('meta', { key, value }); }

  return { open, get, getAll, put, del, clear, bulkPut, metaGet, metaSet };
})();
