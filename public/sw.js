const BASE=new URL(self.registration.scope);
const PREFIX='workshop-phone:'+encodeURIComponent(BASE.href)+':';
const CACHE=PREFIX+'__CACHE_VERSION__';
const ASSETS=['./','index.html','style.css','app.js','phone-store.js','scanner.js','offline.js','android-bridge.js','vendor/html5-qrcode.min.js','manifest.webmanifest','favicon.svg','icons/icon-192.png','icons/icon-512.png'].map(path=>new URL(path,BASE).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(ASSETS.map(path=>new Request(path,{cache:'reload'})));await self.skipWaiting();})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
 for(const key of await caches.keys()){
  const olderScopeCache=key.startsWith(PREFIX)&&key!==CACHE;
  // Earlier root installations used an unscoped name. Project apps leave it alone.
  const legacyRootCache=BASE.pathname==='/'&&key.startsWith('workshop-phone-');
  if(olderScopeCache||legacyRootCache)await caches.delete(key);
 }
 await self.clients.claim();
})()));
self.addEventListener('fetch',event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=='GET'||url.origin!==BASE.origin||!url.pathname.startsWith(BASE.pathname))return;
 event.respondWith((async()=>{const cache=await caches.open(CACHE);const cached=await cache.match(event.request.mode==='navigate'?BASE.href:event.request);if(cached)return cached;return fetch(event.request);})());
});
self.addEventListener('message',event=>{
 if(event.data?.type!=='OFFLINE_STATUS')return;
 event.waitUntil((async()=>{const cache=await caches.open(CACHE);const results=await Promise.all(ASSETS.map(asset=>cache.match(asset)));event.ports[0]?.postMessage({ready:results.every(Boolean)});})());
});
