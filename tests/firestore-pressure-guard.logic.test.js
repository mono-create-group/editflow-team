const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const guard=require('../firestore-pressure-guard');
const {extract}=require('./helpers/owner-progress-source.cjs');
test('a hidden retrying SDK stream error stops once even though its write promise never rejects',async()=>{
  let logger,stops=0;const sdk={onLog(fn,options){assert.equal(options.level,'warn');logger=fn}};
  guard.install(sdk,()=>stops++);
  assert.equal(guard.install(sdk,()=>assert.fail('must not replace handler')),false);
  const unresolved=new Promise(()=>{});let writeFailed=false;unresolved.catch(()=>writeFailed=true);
  const entry={type:'@firebase/firestore',level:'error',message:'Firestore (10.12.0): FirebaseError: [code=resource-exhausted]: Write stream exhausted maximum allowed queued writes.'};
  logger(entry);logger(entry);await Promise.resolve();
  assert.equal(stops,1);assert.equal(writeFailed,false);
});
test('auth errors and ordinary network messages do not stop Firestore',()=>{
  for(const entry of [{type:'@firebase/auth',message:'resource-exhausted'},{type:'@firebase/firestore',message:'permission-denied'},{type:'@firebase/firestore',message:'Using maximum backoff delay to prevent overloading the backend.'}])assert.equal(guard.pressureError(entry),null);
  assert.equal(guard.pressureError({type:'@firebase/firestore',message:'Quota exceeded.'}).code,'resource-exhausted');
});
test('pressure stops queued save timers without clearing the user state',()=>{
  const state={draft:'keep',jobs:[{id:'test'}]},cancelled=[];
  const c=vm.createContext({_fbSaveTimer:71,_fbPersonalSaveQueued:true,_teamSaveQueued:true,S:state,clearTimeout:id=>cancelled.push(id)});
  vm.runInContext(extract('_fbCancelPendingSaves'),c);c._fbCancelPendingSaves();
  assert.deepEqual(cancelled,[71]);assert.equal(c._fbSaveTimer,null);assert.equal(c._fbPersonalSaveQueued,false);assert.equal(c._teamSaveQueued,false);assert.equal(c.S,state);
});
test('quota-open saves do not stamp records or schedule another write',()=>{
  const c=vm.createContext({FB_USER:{uid:'owner'},_fbQuotaBlocked:true,S:{jobs:[]},_stampTeamChanges:()=>assert.fail('must not stamp'),setTimeout:()=>assert.fail('must not schedule')});
  vm.runInContext(extract('fbSave'),c);c.fbSave();
});
test('both entrypoints install the log guard before authentication starts subscriptions and cache it',()=>{
  const root=path.join(__dirname,'..');
  const index=fs.readFileSync(path.join(root,'index.html'),'utf8'),editor=fs.readFileSync(path.join(root,'editor.html'),'utf8'),sw=fs.readFileSync(path.join(root,'sw.js'),'utf8');
  assert.ok(index.includes('EditflowFirestorePressure?.install(firebase,_fbEnterQuotaReadCircuit)'));
  assert.ok(editor.includes('EditflowFirestorePressure?.install(firebase,portalEnterQuotaCircuit)'));
  for(const s of [index,editor,sw])assert.ok(s.includes('firestore-pressure-guard.js'));
});
