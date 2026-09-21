const CACHE='ia-v1-flat-20260921-2';
const CORE=['./','./index.html','./styles.css','./db.js','./zip.js','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./logo.png','./signature.svg','./phrases.json','./stickers.json'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(res=>{
    const copy=res.clone();if(new URL(e.request.url).origin===location.origin)caches.open(CACHE).then(c=>c.put(e.request,copy));return res;
  }).catch(()=>hit)));
});
