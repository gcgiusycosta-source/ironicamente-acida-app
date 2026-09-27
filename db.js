const IADB = (() => {
  const DB_NAME = 'ironicamente_acida_v1';
  const DB_VERSION = 4;
  const STORE_NAMES = ['phrases','stickers','projects','meta','drafts','media'];
  const memory = Object.fromEntries(STORE_NAMES.map(n => [n, new Map()]));
  let dbPromise;
  let memoryMode = false;

  function keyFor(store, value) {
    if (store === 'meta' || store === 'drafts') return value?.key;
    return value?.id;
  }

  function open() {
    if (memoryMode) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      if (!('indexedDB' in window)) { memoryMode = true; resolve(null); return; }
      let settled = false;
      const finish = (db) => { if (!settled) { settled = true; resolve(db); } };
      const timer = setTimeout(() => { memoryMode = true; finish(null); }, 2200);
      try {
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
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('drafts')) db.createObjectStore('drafts', { keyPath: 'key' });
          if (!db.objectStoreNames.contains('media')) db.createObjectStore('media', { keyPath: 'id' });
        };
        req.onsuccess = () => { clearTimeout(timer); finish(req.result); };
        req.onerror = () => { clearTimeout(timer); memoryMode = true; finish(null); };
        req.onblocked = () => { clearTimeout(timer); memoryMode = true; finish(null); };
      } catch (_) {
        clearTimeout(timer); memoryMode = true; finish(null);
      }
    });
    return dbPromise;
  }

  async function tx(store, mode = 'readonly') {
    const db = await open();
    if (!db) return null;
    return db.transaction(store, mode).objectStore(store);
  }

  function reqPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function get(store, key) {
    const s = await tx(store);
    return s ? reqPromise(s.get(key)) : memory[store]?.get(key);
  }
  async function getAll(store) {
    const s = await tx(store);
    return s ? reqPromise(s.getAll()) : [...(memory[store]?.values() || [])];
  }
  async function put(store, value) {
    const s = await tx(store, 'readwrite');
    if (s) return reqPromise(s.put(value));
    const key = keyFor(store, value); if (key != null) memory[store].set(key, value); return key;
  }
  async function del(store, key) {
    const s = await tx(store, 'readwrite');
    if (s) return reqPromise(s.delete(key));
    memory[store]?.delete(key);
  }
  async function clear(store) {
    const s = await tx(store, 'readwrite');
    if (s) return reqPromise(s.clear());
    memory[store]?.clear();
  }
  async function bulkPut(store, values) {
    const db = await open();
    if (!db) { values.forEach(v => { const k = keyFor(store,v); if (k != null) memory[store].set(k,v); }); return; }
    return new Promise((resolve, reject) => {
      const tr = db.transaction(store, 'readwrite');
      const s = tr.objectStore(store);
      values.forEach(v => s.put(v));
      tr.oncomplete = () => resolve();
      tr.onerror = () => reject(tr.error);
      tr.onabort = () => reject(tr.error);
    });
  }

  async function metaGet(key, fallback = null) { const r = await get('meta', key); return r ? r.value : fallback; }
  async function metaSet(key, value) { return put('meta', { key, value }); }
  function isMemoryMode(){ return memoryMode; }

  return { open, get, getAll, put, del, clear, bulkPut, metaGet, metaSet, isMemoryMode };
})();
