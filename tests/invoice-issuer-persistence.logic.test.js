const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
function between(a,b){const start=html.indexOf(a),end=html.indexOf(b,start+1);assert.ok(start>=0&&end>start);return html.slice(start,end);}
const helpers=between('function _restoreInvoiceIssuer(', 'function _endNextMonth(');
const saving=between('async function saveInvoiceInfo(', 'function rProjCompleted(');
const decoding=between('function _decodePersonalState(', 'function _applyCloudData(');
function harness(){
  const calls=[],fields={};
  for(const id of ['name','person','zip','tel','address','email','regno','bank','branch','acctype','accno','accholder','terms','deftax','defwh','notes','save'])fields['ii-'+id]={value:'',checked:false,disabled:false};
  fields['ii-name'].value='検証用屋号';fields['ii-bank'].value='テスト銀行';
  fields['ii-name'].closest=()=>({querySelectorAll:()=>Object.values(fields)});
  let resolve,reject;const commit=new Promise((a,b)=>{resolve=a;reject=b});
  const c=vm.createContext({S:{settings:{}},FB_USER:{uid:'owner-a'},_invoiceIssuerCloud:null,_invoiceIssuerSaving:false,_fbQuotaBlocked:false,_fbQuotaReadCircuitOpen:false,
    navigator:{onLine:true},window:{},document:{getElementById:id=>fields[id]},_canViewFinancials:()=>true,
    toast:(...x)=>calls.push(['toast',...x]),render:()=>calls.push(['render']),closeModal:()=>calls.push(['close']),_fbFailClosed:()=>false,
    fbDb:{collection:n=>({doc:uid=>({set:(data,opts)=>{calls.push(['write',n,uid,JSON.parse(JSON.stringify(data)),opts]);return commit;}})})},
    save:()=>{throw new Error('generic save/notifications must not run')},fetch:()=>{throw new Error('external sends forbidden')}});
  vm.runInContext(decoding+helpers+saving,c);
  return {c,calls,fields,resolve,reject};
}
test('save waits for cloud acknowledgement and writes only private issuer; reload restores it',async()=>{
  const h=harness(),pending=h.c.saveInvoiceInfo();
  assert.equal(h.fields['ii-save'].disabled,true);
  assert.equal(h.c.S.settings.issuer,undefined);
  assert.equal(h.calls.length,1);
  const [,collection,uid,data]=h.calls[0];assert.equal(collection,'users');assert.equal(uid,'owner-a');
  assert.deepEqual(Object.keys(data),['invoiceIssuer']);
  await h.c.saveInvoiceInfo();assert.equal(h.calls.length,1,'double-click suppressed');
  h.resolve();await pending;
  assert.equal(h.c._issuer().name,'検証用屋号');assert.ok(h.calls.some(x=>x[0]==='close'));
  h.c.S={settings:{},_savedAt:Date.now()+9999};h.c._invoiceIssuerCloud=null;
  h.c._restoreInvoiceIssuer(data,'owner-a');assert.equal(h.c._issuer().bankName,'テスト銀行');
  // A stale generic save cannot overwrite the dedicated field.
  h.c._restoreInvoiceIssuer({...data,json_mcapp:JSON.stringify({settings:{issuer:{name:'古い屋号'}}})},'owner-a');
  assert.equal(h.c._issuer().name,'検証用屋号');
});
test('failed save retains entered fields, restores controls and never reports success',async()=>{
  const h=harness(),pending=h.c.saveInvoiceInfo();h.reject({code:'permission-denied'});await pending;
  assert.equal(h.fields['ii-name'].value,'検証用屋号');assert.equal(h.fields['ii-save'].disabled,false);
  assert.equal(h.c.S.settings.issuer,undefined);assert.equal(h.calls.some(x=>x[0]==='close'),false);
  assert.ok(h.calls.some(x=>x[0]==='toast'&&x[1].includes('保存できません')));
});
test('blank, offline, quota and unauthenticated saves stop before writes',async()=>{
  for(const mode of ['blank','offline','quota','signout']){
    const h=harness();if(mode==='blank')h.fields['ii-name'].value=' ';if(mode==='offline')h.c.navigator.onLine=false;if(mode==='quota')h.c._fbQuotaBlocked=true;if(mode==='signout')h.c.FB_USER=null;
    await h.c.saveInvoiceInfo();assert.equal(h.calls.some(x=>x[0]==='write'),false,mode);
  }
});
test('late save acknowledgement cannot copy issuer into a different account',async()=>{
  const h=harness(),pending=h.c.saveInvoiceInfo();h.c.FB_USER={uid:'owner-b'};h.resolve();await pending;
  assert.equal(h.c.S.settings.issuer,undefined);assert.equal(h.calls.some(x=>x[0]==='close'),false);
});
test('legacy cloud issuer restores even when sanitized local timestamp is newer',()=>{
  const h=harness();let snapshot;
  Object.assign(h.c,{_fbUnsubscribe:null,_fbPersonalLastPayload:'',migrate:s=>s,renderSyncSafe:()=>{},_lsSaveState:()=>{},fbSave:()=>{},localStorage:{},console,
    fbDb:{collection:()=>({doc:()=>({onSnapshot:callback=>{snapshot=callback;return()=>{}}})})}});
  h.c.S={settings:{},_uid:'owner-a',_savedAt:9000};
  // Limit extraction to this function, before the TEAM_KEYS declaration.
  const sync=between('function fbSetupRealtimeSync(', '// ===チーム共有');vm.runInContext(sync,h.c);
  h.c.fbSetupRealtimeSync();
  snapshot({exists:true,data:()=>({json_mcapp:JSON.stringify({settings:{issuer:{name:'保存済み屋号'}}}),ts_mcapp:{toMillis:()=>1000}})});
  assert.equal(h.c._issuer().name,'保存済み屋号');assert.equal(h.c.S.settings.issuer.name,'保存済み屋号');
  h.c.FB_USER={uid:'owner-b'};snapshot({exists:true,data:()=>({invoiceIssuer:{name:'別アカウントへ混ぜない'}})});
  assert.equal(h.c.S.settings.issuer.name,'保存済み屋号');
});
test('ordinary personal transaction retains legacy issuer absent from local cache',async()=>{
  const h=harness(),writes=[];let scheduled,transaction;
  const remote={settings:{issuer:{name:'旧形式の保存済み屋号'},theme:'old'},tasks:[]};
  Object.assign(h.c,{_fbSaveTimer:null,_fbPersonalSaveInFlight:false,_fbPersonalSaveQueued:false,_fbPersonalLastPayload:'',_personalTaskBaseline:new Map(),
    _stampTeamChanges:()=>{},clearTimeout:()=>{},setTimeout:fn=>{scheduled=fn},_teamSave:()=>{},_packState:()=>JSON.stringify({settings:{theme:'new'},tasks:[]}),_packPersonalState:JSON.stringify,
    fbDb:{collection:()=>({doc:()=>({})}),runTransaction:fn=>(transaction=fn({get:async()=>({exists:true,data:()=>({json_mcapp:JSON.stringify(remote)})}),set:(_ref,data)=>writes.push(data)}))},
    firebase:{firestore:{FieldValue:{serverTimestamp:()=>0}}}});
  vm.runInContext(between('function fbSave(', '// 個人ドキュメント'),h.c);h.c.fbSave();scheduled();await transaction;
  const saved=JSON.parse(writes[0].json_mcapp);assert.equal(saved.settings.issuer.name,remote.settings.issuer.name);assert.equal(saved.settings.theme,'new');
});
test('issuer and bank data remain excluded from local cache',()=>{
  const h=harness();h.c.LS_OMIT_KEYS=['jobs'];vm.runInContext(between('function _lsSanitizeState(', 'function _lsPutState('),h.c);
  const clean=h.c._lsSanitizeState({settings:{issuer:{accountNo:'1234567'},theme:'light'},jobs:[]});
  assert.equal(clean.settings.issuer,undefined);assert.equal(clean.settings.theme,'light');
});
