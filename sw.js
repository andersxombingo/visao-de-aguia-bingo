const CACHE='visao-de-aguia-bingo-v04';
const APP=['./','./index.html','./styles.css','./app.js','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{if(e.request.method!=='GET')return;e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).then(resp=>{if(new URL(e.request.url).origin===location.origin){const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));}return resp;}).catch(()=>caches.match('./index.html'))));});
