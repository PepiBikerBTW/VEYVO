self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
// Private pages, API data and sign-in responses must never enter a shared cache.
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<!doctype html><html lang="cs"><meta name="viewport" content="width=device-width,initial-scale=1"><title>VEYVO</title><body style="background:#091726;color:#fff;font:18px system-ui;padding:32px"><h1>Jsi offline</h1><p>Pro načtení běhů a AI coache se připoj k internetu.</p><button onclick="location.reload()">Zkusit znovu</button></body></html>',{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}})))});
