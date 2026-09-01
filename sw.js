// mono.create 社内連絡アプリ SW
const CACHE='mcshanai-20260902-02';
const URLS=['./','./index.html','./editor.html','./billing-terms.js','./editor-features.js','./editor-push.js','./bulletin.js','./direct-messages.js','./feedback-workflow.js','./manager-features.js','./owner-video-performance.js','./sales-video-leads.js','./app-ui.css','./owner-yellow-ui.css','./editor-yellow-ui.css','./editflow-logo.svg','./manifest.json','./editor-manifest.json','./icon-192.png','./icon-512.png','./icon-512-maskable.png','./apple-touch-icon.png','./ai-bridge-client.js'];
const REQUIRED_URLS=['./','./index.html','./editor.html','./billing-terms.js','./editor-features.js','./editor-push.js','./bulletin.js','./direct-messages.js','./feedback-workflow.js','./manager-features.js','./owner-video-performance.js','./sales-video-leads.js','./app-ui.css','./owner-yellow-ui.css','./editor-yellow-ui.css','./ai-bridge-client.js'];
const OPTIONAL_URLS=URLS.filter(url=>!REQUIRED_URLS.includes(url));
async function cacheOne(cache,url){
  const response=await fetch(url,{cache:'no-store'});
  if(!response.ok)throw new Error(`precache ${response.status}`);
  await cache.put(url,response);
}
async function precacheAssets(cache,required=REQUIRED_URLS,optional=OPTIONAL_URLS){
  // A partial UI bundle is unsafe: required pages, JS, and CSS deliberately
  // fail installation. Images/manifests are recoverable enhancements only.
  await Promise.all(required.map(url=>cacheOne(cache,url)));
  await Promise.allSettled(optional.map(url=>cacheOne(cache,url)));
}
function canonicalNavigationKey(request){
  const path=new URL(request.url).pathname;
  return path.endsWith('/editor.html')?'./editor.html':'./index.html';
}
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>precacheAssets(c)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('mcshanai-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  // Cache only this app's own assets. Cross-origin auth scripts, avatars, APIs,
  // and user-specific responses must never persist in the app cache.
  const requestUrl=new URL(e.request.url);
  if(requestUrl.origin!==self.location.origin)return;
  // Authenticated APIs and Apps Script actions must never fall back to a stale
  // cached response: an old success would misrepresent a current 403 or send.
  const u=requestUrl.href; if(u.includes('firestore')||u.includes('googleapis')||u.includes('script.google.com')||u.includes('gstatic')||u.includes('firebaseio'))return;
  if(e.request.mode==='navigate'){
    e.respondWith(fetch(e.request,{cache:'no-store'}).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(canonicalNavigationKey(e.request),cp)).catch(()=>{});return r}).catch(()=>caches.match(canonicalNavigationKey(e.request),{ignoreSearch:true}).then(hit=>hit||caches.match(e.request,{ignoreSearch:true}))));
    return;
  }
  e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp)).catch(()=>{});return r}).catch(()=>caches.match(e.request,{ignoreSearch:true})));
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
