self.addEventListener('install',event=>{event.waitUntil(self.skipWaiting())});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.map(key=>caches.delete(key)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  event.respondWith(fetch(event.request,{cache:'no-store'}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const url=event.notification.data?.url||'./?v=7';
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(clients=>{
    for(const client of clients){if('focus'in client){client.navigate?.(url);return client.focus()}}
    return self.clients.openWindow?self.clients.openWindow(url):undefined;
  }));
});
