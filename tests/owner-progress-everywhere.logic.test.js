const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const parse5 = require('parse5');
const {source, extract} = require('./helpers/owner-progress-source.cjs');
const statuses = ['アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了'];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function context(extra = {}) {
  const c = vm.createContext({esc,console,Date,Set,VIDEO_WORKFLOW_STATUSES:statuses,SCOLBG:{},S:{jobs:[]},PORTAL_JOBS:[],JOB_MODAL_SUB_RECORDS:[],_isActualOwner:()=>true,_isOwner:()=>true,_rolePreviewActive:()=>false,_videoCanEdit:()=>true,today:()=> '2026-09-23',_myEmail:()=> 'owner@example.test',_editorOwnsPortalCompletion:()=>false,videoStatusLabel:s=>s,jobBiz:()=> 'edit',bizCfgOf:()=>({statuses}),bizStatusLabel:(_b,s)=>s,_jobSubDefaultStatus:()=> 'アサイン済み',...extra});
  ['_portalCompletionLockedForMe','_legacyPortalStatusLocked','_ownerCanOverridePortalStatus','_ownerCanEditProgress','_ownerProgressAction','_ownerProgressButton','_ownerStatusBadge','_ownerPortalInlineHtml','_legacySubcasePortalDetailStatus','toggleOwnerInlineProgress','saveOwnerInlineProgress'].forEach(n=>vm.runInContext(extract(n),c));
  return c;
}
function nodes(html) {const all=[]; const visit=n=>{if(n.tagName)all.push(n);(n.childNodes||[]).forEach(visit)};visit(parse5.parseFragment(html));return all;}
function attr(n,k){return n.attrs.find(a=>a.name===k)?.value;}

test('real parsed buttons execute with complete arguments, including quoted IDs', () => {
  const portal={_portalUid:'uid"x',id:'job"y',status:'先方確認中'};
  const c=context({PORTAL_JOBS:[portal]});
  const detail=c._legacySubcasePortalDetailStatus({}, {portalUid:portal._portalUid,portalJobId:portal.id},true);
  const html=detail.statusControl;
  const button=nodes(html).find(n=>n.tagName==='button');
  let called;
  vm.runInNewContext(attr(button,'onclick'),{saveOwnerInlineProgress:key=>{called=key}});
  assert.equal(called,detail.controlKey);
  assert.ok(nodes(html).some(n=>attr(n,'id')===`${called}-date`));
  assert.ok(nodes(html).some(n=>attr(n,'id')===`${called}-ok`));
  assert.equal(nodes(html).filter(n=>n.tagName==='option').length,9);
});

test('owner-only actions resolve parent, child, portal child and phase-slice IDs', () => {
  const c=context();
  const cases=[
    [{id:'parent'},null,['legacy','parent','']],
    [{id:'parent'}, {id:'sub'}, ['legacy','parent','sub']],
    [{id:'parent'}, {id:'sub',portalUid:'u',portalJobId:'p'}, ['portal','u','p']],
    [{id:'parent'}, {_portalChildPortalUid:'u',_portalChildJobId:'p'}, ['portal','u','p']],
    [{id:'p',_source:'portal',_portalUid:'u'},null,['portal','u','p']],
    [{id:'phase',_sourceJobId:'original'},null,['legacy','original','']],
    [{id:'phase',_sourceJobId:'original',_source:'portal',_portalUid:'u'},null,['portal','u','original']],
    [{id:'portal-parent'}, {id:'child',_legacyParentJobId:'legacy-parent'},['legacy','legacy-parent','child']],
    [{id:'parent',_raw:{portalUid:'u',portalJobId:'p'}},null,['portal','u','p']],
  ];
  for(const [parent,row,expected] of cases){let actual;vm.runInNewContext(c._ownerProgressAction(parent,row),{openVideoProgressModal:(...v)=>actual=v});assert.deepEqual(actual,expected);}
  assert.equal(context({_isActualOwner:()=>false})._ownerProgressButton({id:'p'}),'');
  assert.equal(context({_rolePreviewActive:()=>true})._ownerProgressButton({id:'p'}),'');
});

test('inline owner save sends completion confirmation and date through the audited writer',async()=>{
  let passed;
  const box={dataset:{portalUid:'u',portalJobId:'p'}};
  const fields={'k-status':{value:'完了',closest:()=>box},'k-reason':{value:''},'k-date':{value:'2026-09-18'},'k-ok':{checked:true}};
  const c=context({document:{getElementById:id=>fields[id]},setPortalWorkflowStatus:async(...v)=>{passed=v}});
  await c.saveOwnerInlineProgress('k');
  assert.deepEqual(JSON.parse(JSON.stringify(passed)),['u','p',{status:'完了',reason:'',completionDate:'2026-09-18',clientApprovalConfirmed:true,keepOpen:true}]);
  passed=null;c._rolePreviewActive=()=>true;c.toast=()=>{};await c.saveOwnerInlineProgress('k');assert.equal(passed,null);
});

function writerFixture({fail=false,owner=true,dispatch=false}={}){
  const job={_portalUid:'u',id:'p',status:'先方確認中',workflow:{round:1,stage:'client_review'},progressEvents:[],history:[],...(dispatch?{businessType:'dispatch'}:{})};
  const writes=[],persisted={},toasts=[];
  const ref={collection(){return this},doc(){return this}};
  const c=context({PORTAL_JOBS:[job],_editorOwnsPortalCompletion:j=>j.businessType==='dispatch',FB_USER:{uid:'u-owner',emailVerified:true},_isActualOwner:()=>owner,_canManagePortalWorkflow:()=>owner,_videoSafeUrl:s=>s,_videoWorkflow:j=>j.workflow,document:{getElementById:()=>null},toast:(...v)=>toasts.push(v),fbDb:{collection:()=>ref,batch:()=>({set:(_ref,data)=>writes.push(data),commit:async()=>{if(fail)throw {code:'permission-denied'};Object.assign(persisted,JSON.parse(JSON.stringify(writes[0])))}})},firebase:{firestore:{FieldValue:{serverTimestamp:()=>123}}},_applyPortalToLegacy:()=>true,save:()=>{},closeModal:()=>{},_refreshJobModalPortalSubProgress:()=>true});
  ['_portalCompletionLockedForMe','_videoWorkflowStageForStatus','_videoManualProgressRound','_portalStatusReasonRequired','_portalStatusAuditReason','_portalStatusEvidenceRequired','_portalWorkflowSaveErrorMessage','_validPortalCompletionDate','setPortalWorkflowStatus'].forEach(n=>vm.runInContext(extract(n),c));
  vm.runInContext('var PORTAL_WORKFLOW_ACTION_PENDING=new Set()',c);
  return{c,job,writes,persisted,toasts};
}
test('completion persists status/date/audit and reconstructs correctly after reload',async()=>{
  const f=writerFixture();await f.c.setPortalWorkflowStatus('u','p',{status:'完了',completionDate:'2026-09-18',clientApprovalConfirmed:true,keepOpen:true});
  assert.equal(f.writes.length,2);assert.equal(f.job.status,'完了');
  const reopened=JSON.parse(JSON.stringify(f.persisted));
  assert.equal(reopened.status,'完了');assert.equal(reopened.completedDeliveryDate,'2026-09-18');assert.equal(reopened.workflow.stage,'delivered');
  assert.equal(reopened.progressEvents[0].fromStatus,'先方確認中');assert.equal(reopened.progressEvents[0].clientApprovalConfirmed,true);
});
test('owner can complete a dispatch job from the status selector; a director still cannot',async()=>{
  // セレクタ: オーナーは「完了」が選べる。ロール確認中・オーナー以外は無効のまま。
  const portal={_portalUid:'u',id:'p',status:'先方確認中',businessType:'dispatch'};
  const completionOption=html=>nodes(html).find(n=>n.tagName==='option'&&attr(n,'value')==='完了');
  const inline=extra=>context({PORTAL_JOBS:[portal],_editorOwnsPortalCompletion:j=>j.businessType==='dispatch',...extra})._legacySubcasePortalDetailStatus({},{portalUid:'u',portalJobId:'p'},true).statusControl;
  assert.equal(attr(completionOption(inline()),'disabled'),undefined);
  // ロール確認中・オーナー以外では完了ロックが掛かる（ロック判定を直接確認）。
  const lock=extra=>context({_editorOwnsPortalCompletion:j=>j.businessType==='dispatch',...extra})._portalCompletionLockedForMe(portal);
  assert.equal(lock(),false);
  assert.equal(lock({_rolePreviewActive:()=>true}),true);
  assert.equal(lock({_isActualOwner:()=>false}),true);
  assert.equal(context({_editorOwnsPortalCompletion:()=>false,_isActualOwner:()=>false})._portalCompletionLockedForMe({}),false);
  // 保存: オーナーは監査イベントつきで完了になる。ディレクターは書き込まれず未変更。
  const owner=writerFixture({dispatch:true});
  await owner.c.setPortalWorkflowStatus('u','p',{status:'完了',completionDate:'2026-09-18',clientApprovalConfirmed:true,keepOpen:true});
  assert.equal(owner.writes.length,2);assert.equal(owner.job.status,'完了');
  assert.equal(owner.persisted.completedDeliveryDate,'2026-09-18');assert.equal(owner.persisted.progressEvents[0].type,'manager_status_changed');
  const director=writerFixture({dispatch:true,owner:false});
  director.c._canManagePortalWorkflow=()=>true;
  await director.c.setPortalWorkflowStatus('u','p',{status:'完了',reason:'完了へ変更',evidenceUrl:'https://example.com/d',completionDate:'2026-09-18',clientApprovalConfirmed:true,keepOpen:true});
  assert.equal(director.writes.length,0);assert.equal(director.job.status,'先方確認中');
  assert.match(director.toasts.at(-1)[0],/担当編集者が本人画面で記録/);
});
test('missing completion confirmation/date or failed remote write never pretends success',async()=>{
  for(const input of [{status:'完了',completionDate:'2026-09-18'},{status:'完了',clientApprovalConfirmed:true,completionDate:'2026-09-24'}]){const f=writerFixture();await f.c.setPortalWorkflowStatus('u','p',input);assert.equal(f.writes.length,0);assert.equal(f.job.status,'先方確認中');}
  const f=writerFixture({fail:true});await f.c.setPortalWorkflowStatus('u','p',{status:'修正中',keepOpen:true});assert.equal(f.job.status,'先方確認中');assert.deepEqual(f.persisted,{});assert.match(f.toasts.at(-1)[0],/未変更/);
});
test('ordinary board save handler survives HTML parsing and passes both target IDs',()=>{
  let html;
  const c=context({S:{jobs:[{id:'p"1',status:'進行中'}]},openModal:s=>html=s,_findVideoSubcase:()=>null,toast:()=>{}});
  vm.runInContext(extract('openVideoProgressModal'),c);c.openVideoProgressModal('legacy','p"1','');
  const save=nodes(html).find(n=>n.tagName==='button'&&(attr(n,'onclick')||'').includes('saveLegacyProgressFromBoard'));
  let args;vm.runInNewContext(attr(save,'onclick'),{saveLegacyProgressFromBoard:(...v)=>args=v});assert.deepEqual(args,['p"1','']);
});
test('all management entry surfaces have owner progress actions or the shared inline editor',()=>{
  const routes={openJobModal:'ownerLinkedStatusField',mkSubRow:'_ownerPortalInlineHtml',openPortalJobModal:'_ownerPortalInlineHtml',_legacySubcasePortalDetailStatus:'_ownerPortalInlineHtml',openVideoLegacyDetailModalSource:'ownerStatusField',_videoCard:'_ownerProgressButton',rJobItem:'_ownerStatusBadge',rProjCalendar:'_ownerProgressButton',rProjPriority:'_ownerStatusBadge',rProjProfit:'_ownerProgressButton'};
  for(const [fn,marker] of Object.entries(routes))assert.ok(extract(fn).includes(marker),fn);
  assert.doesNotMatch(source,/進捗を変更できる場所はここだけです/);
  assert.doesNotMatch(source,/onclick="(?:advanceLegacyPortalSubcaseWorkflow|saveLegacyProgressFromBoard)\(\$\{JSON\.stringify/);
});


test('linked status badges use persisted portal progress over stale legacy done flags',()=>{
  const c=context({PORTAL_JOBS:[{_portalUid:'u',id:'p',status:'先方確認中'}]});
  const html=c._ownerStatusBadge({id:'legacy',status:'完了',done:true,portalUid:'u',portalJobId:'p'});
  assert.match(html,/先方確認中/);assert.doesNotMatch(html,/>完了</);
  assert.match(c._ownerStatusBadge({id:'ordinary',status:'進行中',done:true}),/>完了</);
  vm.runInContext(extract('_jobModalSubCompactBodyHtml'),c);
  const compact=c._jobModalSubCompactBodyHtml({title:'child',status:'完了',portalUid:'u',portalJobId:'p'},0,'edit');
  assert.match(compact,/先方確認中/);assert.doesNotMatch(compact,/>完了</);
});
