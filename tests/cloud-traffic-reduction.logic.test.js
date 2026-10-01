const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const guard=require('../firestore-pressure-guard');
const {source,extract}=require('./helpers/owner-progress-source.cjs');
const manager=fs.readFileSync(path.join(__dirname,'../manager-features.js'),'utf8');
function cooldown(at='2026-10-01T06:00:00Z'){
  const values=new Map(),handlers=new Map();let clock=Date.parse(at);
  const storage={getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v)};
  const events={addEventListener:(k,v)=>handlers.set(k,v),removeEventListener:k=>handlers.delete(k)};
  return{storage,events,values,handlers,now:()=>clock,setNow:n=>clock=n,api:guard.createCooldown({storage,events,now:()=>clock})};
}
test('quota stop survives reload and cannot be extended by repeated restore',()=>{
  const c=cooldown(),pause=c.api.pause();assert.equal(pause.until,Date.parse('2026-10-01T07:15:00Z'));
  const reloaded=guard.createCooldown(c);let stops=0;
  assert.equal(reloaded.restore(e=>{assert.equal(e.code,'resource-exhausted');stops++;reloaded.pause()}),true);
  assert.equal(stops,1);assert.deepEqual(reloaded.read(),pause);
  c.setNow(pause.until);assert.equal(reloaded.read(),null);assert.equal(reloaded.restore(()=>assert.fail()),false);
});
test('Pacific midnight calculation handles both daylight-saving transitions',()=>{
  assert.equal(cooldown('2026-03-08T09:00:00Z').api.pause().until,Date.parse('2026-03-09T07:15:00Z'));
  assert.equal(cooldown('2026-11-01T08:00:00Z').api.pause().until,Date.parse('2026-11-02T08:15:00Z'));
});
test('personal EditFlow pause and storage event stop the internal app without extending the pause',()=>{
  const c=cooldown();let stops=0;const stop=c.api.listen(()=>stops++);
  const record={until:c.now()+60000,reason:'budget'};
  c.storage.setItem('ef_sync_cloud_pause_v1',JSON.stringify(record));
  c.handlers.get('storage')({key:'ef_sync_cloud_pause_v1',newValue:JSON.stringify(record)});
  assert.equal(stops,1);assert.deepEqual(c.api.pause(),record);stop();assert.equal(c.handlers.size,0);
});
test('storage failure keeps the current-tab stop and malformed values cannot crash the guard',()=>{
  const broken=guard.createCooldown({storage:{getItem(){throw Error('blocked')},setItem(){throw Error('blocked')}},now:()=>Date.parse('2026-10-01T00:00Z')});
  assert.ok(broken.pause().until);assert.ok(broken.read());
  const c=cooldown();c.storage.setItem('ef_sync_cloud_pause_v1','bad json');assert.equal(c.api.read(),null);
});
test('warning-level Firestore quota logs are handled once without matching other SDK warnings',async()=>{
  let logger,stops=0;guard.install({onLog(fn,options){assert.equal(options.level,'warn');logger=fn}},()=>stops++);
  logger({type:'@firebase/auth',message:'Quota exceeded'});
  logger({type:'@firebase/firestore',level:'warn',message:'resource-exhausted'});
  logger({type:'@firebase/firestore',level:'error',message:'resource-exhausted'});
  await Promise.resolve();assert.equal(stops,1);
});
const decode=raw=>{try{return JSON.parse(raw)}catch(_){return null}};
test('shared signature ignores object key/record order, not real values or nested array order',()=>{
  const a={jobs:JSON.stringify([{id:'b',status:'進行中'},{id:'a',subtasks:[{id:'x'},{id:'y'}]}]),salesLeads:'SHARDED',legacyFinanceRestoreAck:'token'};
  const b={...a,jobs:JSON.stringify([{subtasks:[{id:'x'},{id:'y'}],id:'a'},{status:'進行中',id:'b'}])};
  const before=JSON.stringify(a);assert.equal(guard.sharedSignature(a,decode),guard.sharedSignature(b,decode));
  assert.notEqual(guard.sharedSignature(a,decode),guard.sharedSignature({...b,jobs:b.jobs.replace('進行中','完了')},decode));
  assert.notEqual(guard.sharedSignature(a,decode),guard.sharedSignature({...b,jobs:b.jobs.replace('[{"id":"x"},{"id":"y"}]','[{"id":"y"},{"id":"x"}]')},decode));
  assert.notEqual(guard.sharedSignature(a,decode),guard.sharedSignature({...b,legacyFinanceRestoreAck:'different'},decode));
  assert.equal(JSON.stringify(a),before);
});
test('canonical personal JSON keeps manual array order and user-supplied prototype keys',()=>{
  assert.equal(guard.stableJson({z:1,a:2}),guard.stableJson({a:2,z:1}));
  assert.notEqual(guard.stableJson({tasks:[1,2]}),guard.stableJson({tasks:[2,1]}));
  const input=JSON.parse('{"__proto__":{"x":1},"a":2}');assert.deepEqual(JSON.parse(guard.stableJson(input)),input);
});
test('adding one editor among 200 only starts one new catalog listener and removal stops only that editor',()=>{
  const opened=[],closed=[],callbacks=new Map(),state={editors:Array.from({length:200},(_,n)=>({id:'e'+n})),catalog:new Map()};
  const ownerCatalogStops=new Map();
  const c=vm.createContext({state,ownerCatalogStops,renderSafe(){},quotaSnapshotError(){},fbDb:{collection:()=>({doc:uid=>({collection:()=>({onSnapshot:next=>{opened.push(uid);callbacks.set(uid,next);return()=>closed.push(uid)}})})})}});
  vm.runInContext(manager.slice(manager.indexOf('function reconcileOwnerCatalogs()'),manager.indexOf('function start(){')),c);
  c.reconcileOwnerCatalogs();assert.equal(opened.length,200);
  callbacks.get('e5')({docs:[{id:'client',data:()=>({name:'fixture'})}]});
  state.editors.push({id:'added'});c.reconcileOwnerCatalogs();assert.equal(opened.length,201);assert.equal(closed.length,0);
  state.editors=state.editors.filter(x=>x.id!=='e3');c.reconcileOwnerCatalogs();assert.deepEqual(closed,['e3']);
  assert.equal(state.catalog.get('e5')[0].name,'fixture');
  c.reconcileOwnerCatalogs();assert.equal(opened.length,201);
});
test('quota/error restart gates return before creating any core subscriptions',()=>{
  const c=vm.createContext({FB_USER:{uid:'test'},_fbQuotaBlocked:true,fbDb:{collection:()=>assert.fail('no reads')},_isOwner:()=>true});
  for(const fn of ['fbSetupRealtimeSync','fbSetupTeamSync','fbSetupPortalOpsSync','fbSetupAccessAdmin']){
    // Only the early-return prefix is required here; integration below covers boot.
    const start=source.indexOf('function '+fn+'('),end=source.indexOf('\n',source.indexOf('\n',start)+1);
    vm.runInContext(source.slice(start,end)+'\n}',c);c[fn]();
  }
});
test('boot restores pause before access reads; access quota errors do not clear business data',()=>{
  assert.match(source,/if\(user&&!_fbCooldown\?\.restore\(_fbEnterQuotaReadCircuit\)\)\{\s*await resolveAppAccess/);
  const resolve=extract('resolveAppAccess');
  assert.match(resolve,/if\(_fbEnterQuotaReadCircuit\(e,'access resolution'\)\)return null/);
  assert.match(resolve,/if\(_fbEnterQuotaReadCircuit\(e,'access control'\)\)return null/);
  assert.match(extract('fbSave'),/maxAttempts:2/);
  assert.match(extract('fbSave'),/\},2000\)/); // Keep existing save latency; shared ledgers are not cached locally.
});
test('unchanged shared records in different order cause zero writes; an actual edit writes once',async()=>{
  let writes=0;
  const jobs=[{id:'b',status:'進行中',updatedAt:1},{id:'a',status:'完了',updatedAt:2}];
  const c=vm.createContext({window:{EditflowFirestorePressure:guard},TEAM_KEYS:['jobs'],S:{jobs},_invoiceStatusSaving:false,
    FB_USER:{uid:'fixture'},TEAM_SHARE_OK:true,_fbQuotaBlocked:false,_teamCloudLoaded:true,_teamKnownCounts:{jobs:2},
    _teamLedgerRestoreAck:'ack',_teamLastPayload:guard.sharedSignature({jobs:JSON.stringify([...jobs].reverse()),legacyFinanceRestoreAck:'ack'},decode),
    _teamSaveInFlight:false,_teamSaveQueued:false,_slShardsSave(){},_teamDecode:decode,_teamEncode:(_k,v)=>JSON.stringify(v),
    crypto:{randomUUID:()=> 'nonce'},firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'ts'}}},
    fbDb:{collection:()=>({doc:()=>({set:()=>{writes++;return Promise.resolve()}})})},console,_fbFailClosed:()=>false});
  vm.runInContext(source.slice(source.indexOf('function _teamSave(){'),source.indexOf('function _teamCloudBaseline(')),c);
  c._teamSave();assert.equal(writes,0);
  jobs[0].status='先方確認中';c._teamSave();c._teamSave();
  for(let i=0;i<8;i++)await Promise.resolve();
  assert.equal(writes,1);c._teamSave();assert.equal(writes,1);
});
