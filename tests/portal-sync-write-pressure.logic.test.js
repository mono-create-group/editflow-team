const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {extract}=require('./helpers/owner-progress-source.cjs');
function context(subcase=false){
  let clock=1000;
  const target={id:'parent',title:'案件',status:'進行中',subtasks:subcase?[{id:'child',status:'進行中'}]:[],statusHistory:[]};
  const c=vm.createContext({S:{jobs:[target]},ACCESS_RECORDS:[],Date:{now:()=>++clock},_myEmail:()=> 'owner@test.invalid',_isOwner:()=>true,
    _paymentRecipientSnapshot:()=>({}),_portalField:(j,k,v)=>Object.hasOwn(j,k)?j[k]:v,_editorDraftDateSetter:(_j,f='creator')=>f,_videoAttachments:a=>a,_caseManualIds:a=>a||[],
    _videoUpdatedMillis:v=>Number(v)||0,jobBiz:()=> 'edit',_jobSubDefaultStatus:()=> '進行中',_aggregateSubcaseStatus:()=> '進行中',_legacyPortalStatusLocked:()=>false});
  vm.runInContext(extract('_applyPortalToLegacy'),c);
  const job={id:subcase?'child':'portal',_portalUid:'editor',linkedLegacyJobId:'parent',status:'進行中',title:'案件'};
  return {c,target,job};
}
test('parent sync ignores its own save timestamp on subsequent shared snapshots',()=>{
  const {c,target,job}=context();job.updatedAt=500;
  assert.equal(c._applyPortalToLegacy(job),true);
  target.updatedAt=2000; // _stampTeamChanges stamps the outgoing legacy write.
  const before=JSON.stringify(target);
  assert.equal(c._applyPortalToLegacy(job),false);
  assert.equal(JSON.stringify(target),before,'no audit entry or timestamp churn');
  assert.equal(c._applyPortalToLegacy({...job,status:'先方確認中',updatedAt:2100}),true);
  assert.equal(target.status,'先方確認中');
});
test('timestamp-less child snapshots converge without a save loop',()=>{
  const {c,target,job}=context(true);
  assert.equal(c._applyPortalToLegacy(job),true);
  const before=JSON.stringify(target);
  for(let n=0;n<100;n++)assert.equal(c._applyPortalToLegacy(job),false);
  assert.equal(JSON.stringify(target),before);
  assert.equal(c._applyPortalToLegacy({...job,editorDraftDate:'2026-10-02'}),true);
  assert.equal(target.subtasks[0].editorDraftDate,'2026-10-02');
});
