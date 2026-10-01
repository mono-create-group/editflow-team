const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
const {extract}=require('./helpers/owner-progress-source.cjs');
function syncContext(parents,jobs,access=[]){
  let saves=0,clock=1000,conflicts=[];
  const c=vm.createContext({S:{jobs:parents},PORTAL_JOBS:jobs,ACCESS_RECORDS:access,Date:{now:()=>++clock},_myEmail:()=> 'owner@test.invalid',_isOwner:()=>true,_teamCloudLoaded:true,_fbQuotaBlocked:false,
    _paymentRecipientSnapshot:()=>({}),_portalField:(j,k,v)=>Object.hasOwn(j,k)?j[k]:v,_editorDraftDateSetter:(_j,f='creator')=>f,_videoAttachments:a=>a,_caseManualIds:a=>a||[],
    _videoUpdatedMillis:v=>Number(v)||0,jobBiz:()=> 'edit',_jobSubDefaultStatus:()=> '進行中',_aggregateSubcaseStatus:()=> '進行中',_legacyPortalStatusLocked:()=>false,
    save:()=>saves++,renderSyncSafe:()=>{},_showPortalLegacySyncConflicts:rows=>{conflicts=rows}});
  vm.runInContext(['_portalLegacySyncPlan','_syncPortalJobsIntoLegacy','_applyPortalToLegacy'].map(extract).join('\n'),c);
  return{c,saves:()=>saves,conflicts:()=>conflicts};
}
const parent=()=>({id:'parent',title:'Original',status:'進行中',subtasks:[],statusHistory:[]});
const jobs=()=>[{id:'a',_portalUid:'editorA',linkedLegacyJobId:'parent',title:'A',status:'進行中'},{id:'b',_portalUid:'editorB',linkedLegacyJobId:'parent',title:'B',status:'完了'}];
test('ambiguous portal links do not change legacy data or produce writes over 100 shared snapshots',()=>{
  const row=parent(),before=JSON.stringify(row),fixture=syncContext([row],jobs());
  for(let n=0;n<100;n++)assert.equal(fixture.c._syncPortalJobsIntoLegacy(),false);
  assert.equal(fixture.saves(),0);assert.equal(JSON.stringify(row),before);assert.equal(fixture.conflicts().length,1);
});
test('explicit portal binding resolves the ambiguity without selecting an arbitrary job',()=>{
  const row={...parent(),portalUid:'editorA',portalJobId:'a'},fixture=syncContext([row],jobs().reverse());
  assert.equal(fixture.c._syncPortalJobsIntoLegacy(),true);assert.equal(row.title,'A');
  for(let n=0;n<20;n++)assert.equal(fixture.c._syncPortalJobsIntoLegacy(),false);
  assert.equal(fixture.saves(),1);assert.equal(fixture.conflicts().length,0);
});
test('one ambiguous parent does not prevent a separately linked case from syncing',()=>{
  const safe={...parent(),id:'safe'},fixture=syncContext([parent(),safe],[...jobs(),{id:'c',_portalUid:'editorC',linkedLegacyJobId:'safe',title:'Changed',status:'完了'}]);
  assert.equal(fixture.c._syncPortalJobsIntoLegacy(),true);assert.equal(safe.title,'Changed');
  assert.equal(fixture.c._syncPortalJobsIntoLegacy(),false);assert.equal(fixture.saves(),1);
});
test('distinct children of one parent are independent, but duplicate links to one child are blocked',()=>{
  const row={...parent(),subtasks:[{id:'s1',title:'First'},{id:'s2',title:'Second'}]};
  const a={...jobs()[0],legacySubtaskId:'s1'},b={...jobs()[1],legacySubtaskId:'s2'},fixture=syncContext([row],[a,b]);
  let plan=fixture.c._portalLegacySyncPlan([a,b]);assert.equal(plan.safe.length,2);assert.equal(plan.conflicts.length,0);
  plan=fixture.c._portalLegacySyncPlan([a,{...b,legacySubtaskId:'s1'}]);assert.equal(plan.safe.length,0);assert.equal(plan.conflicts.length,1);
});
test('quota interaction gate permits only the owner D1 shadow host and recovery controls',()=>{
  const c=vm.createContext({_fbQuotaReadCircuitOpen:true,V:'editingintake',FB_USER:{uid:'owner'},_isOwner:()=>true});
  vm.runInContext(extract('_fbQuotaIntakeAllowed')+'\n'+extract('_fbQuotaEventAllowed'),c);
  const event=id=>({composedPath:()=>[{id:'inner-control'},{id}]});
  assert.equal(c._fbQuotaEventAllowed(event('editing-intake-native')),true);
  assert.equal(c._fbQuotaEventAllowed(event('firestore-quota-maintenance')),true);
  for(const id of ['view','sidebar','modal'])assert.equal(c._fbQuotaEventAllowed(event(id)),false);
  c.V='videoedit';assert.equal(c._fbQuotaEventAllowed(event('editing-intake-native')),false);
  c.V='editingintake';c._isOwner=()=>false;assert.equal(c._fbQuotaEventAllowed(event('editing-intake-native')),false);
  c._fbQuotaReadCircuitOpen=false;assert.equal(c._fbQuotaEventAllowed(event('view')),true);
});
test('quota D1 opening leaves the Firestore circuit closed and does not reconnect it',()=>{
  let destination='',refresh=0;
  const c=vm.createContext({_fbQuotaReadCircuitOpen:true,FB_USER:{uid:'owner'},_isOwner:()=>true,setV:v=>{destination=v},_fbRefreshQuotaNotice:()=>refresh++});
  vm.runInContext(extract('openIntakeDuringFirestoreQuota'),c);
  assert.equal(c.openIntakeDuringFirestoreQuota(),true);assert.equal(destination,'editingintake');assert.equal(refresh,1);assert.equal(c._fbQuotaReadCircuitOpen,true);
  c._isOwner=()=>false;assert.equal(c.openIntakeDuringFirestoreQuota(),false);
});
const manager=fs.readFileSync(path.join(__dirname,'../manager-features.js'),'utf8');
function managerFn(name){const start=manager.indexOf('  function '+name+'('),end=manager.indexOf('\n  }',start);return manager.slice(start,end+4)}
test('view-scoped manager listeners are absent at intake/startup, deduplicated, and stopped on leave',()=>{
  const calls=[],stops=[],state={started:'owner',viewUnsubs:new Map()},query=name=>({orderBy(){return this},limit(){return this},onSnapshot(){calls.push(name);return()=>stops.push(name)}});
  const c=vm.createContext({state,V:'editingintake',window:{EditflowFirestoreQuota:{isOpen:()=>false}},_isOwner:()=>true,fbDb:{collection:query},quotaSnapshotError(){},renderSafe(){}});
  vm.runInContext(managerFn('syncViewSubscriptions'),c);
  c.syncViewSubscriptions();assert.equal(calls.length,0);
  c.V='videoschedules';c.syncViewSubscriptions();c.syncViewSubscriptions();assert.deepEqual(calls,['editor_schedules']);
  c.V='videosuggestions';c.syncViewSubscriptions();assert.deepEqual(stops,['editor_schedules']);assert.deepEqual(calls,['editor_schedules','editor_suggestions']);
  c.V='editingintake';c.syncViewSubscriptions();assert.equal(stops.length,2);
  c.window.EditflowFirestoreQuota.isOpen=()=>true;c.V='videoschedules';c.syncViewSubscriptions();assert.equal(calls.length,2);
  assert.doesNotMatch(managerFn('start'),/editor_job_board|editor_schedules|editor_suggestions/);
  assert.match(managerFn('start'),/owner_client_pricing/);assert.match(managerFn('start'),/editor_manuals/);
});

test('quota-only intake route bypasses daily gates that would require unavailable Firestore data',()=>{
  const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.match(html,/const _ownerPerformanceBypass=.*\|\|_fbQuotaIntakeAllowed\(\)/);
  assert.match(html,/!_fbQuotaIntakeAllowed\(\)\&\&checkDailyLock\(\)/);
});

test('render releases view listeners even when an access or daily gate returns early',()=>{
  const render=extract('render');
  assert.match(render,/finally\{\s*window\.managerSyncViewSubscriptions\?\.\(\);/);
});
