const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');

test('one optional precache failure does not reject the service-worker install',async()=>{
  const handlers={},cached=[];
  const context={
    self:{addEventListener:(name,handler)=>{handlers[name]=handler},skipWaiting:async()=>{}},
    caches:{open:async()=>({put:async(url,response)=>cached.push([url,response])}),keys:async()=>[]},
    fetch:async url=>url==='missing'?{ok:false,status:404}:{ok:true,status:200,url},
    Promise,Error,URL,clients:{matchAll:async()=>[]},
  };
  vm.runInNewContext(source,context,{filename:'sw.js'});
  await context.precacheAssets({put:async(url,response)=>cached.push([url,response])},['ready'],['missing']);
  assert.deepEqual(cached.map(([url])=>url),['ready']);
  let install;
  handlers.install({waitUntil:promise=>{install=promise}});
  await assert.doesNotReject(install);
});

test('a required page or bundle failure rejects service-worker installation',async()=>{
  const context={self:{addEventListener(){}},fetch:async()=>({ok:false,status:404}),Promise,Error,URL};
  vm.runInNewContext(source,context,{filename:'sw.js'});
  await assert.rejects(context.precacheAssets({put:async()=>{}},['required'],[]),/precache 404/);
});

test('service worker retains its versioned cache and independent precache contract',()=>{
  assert.match(source,/const CACHE='mcshanai-\d{8}-\d{2}';/);
  assert.match(source,/const REQUIRED_URLS=\[/);
  assert.match(source,/Promise\.all\(required\.map/);
  assert.match(source,/Promise\.allSettled\(optional\.map/);
  assert.match(source,/fetch\(e\.request,\{cache:'no-store'\}\)/);
  assert.match(source,/function canonicalNavigationKey\(request\)/);
  assert.match(source,/caches\.match\(canonicalNavigationKey\(e\.request\),\{ignoreSearch:true\}\)/);
  assert.match(source,/caches\.match\(e\.request,\{ignoreSearch:true\}\)/);
  assert.match(source,/u\.includes\('script\.google\.com'\)/);
  assert.match(source,/caches\.open\(CACHE\)\.then\(c=>precacheAssets\(c\)\)\.then\(\(\)=>self\.skipWaiting\(\)\)/);
});
