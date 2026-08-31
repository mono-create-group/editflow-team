// mono.create 社内連絡アプリ SW
const CACHE='mcshanai-20260831-09';
const URLS=['./','./index.html','./editor.html','./billing-terms.js','./editor-features.js','./editor-push.js','./bulletin.js','./direct-messages.js','./feedback-workflow.js','./manager-features.js','./owner-video-performance.js','./app-ui.css','./owner-yellow-ui.css','./editor-yellow-ui.css','./editflow-logo.svg','./manifest.json','./editor-manifest.json','./icon-192.png','./icon-512.png','./icon-512-maskable.png','./apple-touch-icon.png','./ai-bridge-client.js'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(URLS)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mcshanai-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=e.request.url; if(u.includes('firestore')||u.includes('googleapis')||u.includes('gstatic')||u.includes('firebaseio'))return;
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});return r}).catch(()=>caches.match(e.request)));
});
self.addEventListener('push',event=>{
  let data={};
  try{data=event.data?event.data.json():{}}catch(_){data={}}
  const title=String(data?.title||'mono.create').slice(0,80);
  // Keep locked-screen notifications private.  Specific DM/case content is
  // shown only after the user opens the authenticated portal.
  const body=String(data?.body||'新しい連絡があります。アプリを開いて確認してください。').slice(0,140);
  const target=typeof data?.url==='string'&&data.url.startsWith('./')?data.url:'./editor.html?notification=1';
  const tag=String(data?.tag||'editor-notification').slice(0,120);
  const notificationId=typeof data?.notificationId==='string'?data.notificationId.slice(0,512):'';
  event.waitUntil((async()=>{
    // A web push is a delivery hint, not an unread-record mutation.  Do not
    // increment a per-device number here: duplicate deliveries, stale tabs,
    // and collapsed browser notifications otherwise overcount the app icon.
    await self.registration.showNotification(title,{body,icon:'./icon-192.png',badge:'./icon-192.png',tag,renotify:false,data:{url:target,notificationId}});
    const openClients=await clients.matchAll({type:'window',includeUncontrolled:true});
    openClients.forEach(client=>client.postMessage({type:'editflow-push-received',notificationId}));
  })());
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=event.notification?.data?.url||'./editor.html?notification=1';
  event.waitUntil((async()=>{
    const absolute=new URL(target,self.location.href),list=await clients.matchAll({type:'window',includeUncontrolled:true});
    const current=list.find(client=>{try{return new URL(client.url).pathname===absolute.pathname}catch(_){return false}});
    if(!current)return clients.openWindow(absolute.href);
    const destination=typeof current.navigate==='function'?await current.navigate(absolute.href):current;
    return (destination||current).focus();
  })());
});
