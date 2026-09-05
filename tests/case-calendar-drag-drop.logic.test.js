const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'..','app-ui.css'),'utf8');

function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  const asyncStart=html.lastIndexOf('async ',start);
  const from=asyncStart>=0&&asyncStart+6===start?asyncStart:start;
  let depth=0,opened=false;
  for(let i=start;i<html.length;i+=1){
    if(html[i]==='{'){depth+=1;opened=true;}
    if(html[i]==='}'&&opened&&--depth===0)return html.slice(from,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('calendar entries are draggable and every day cell accepts a drop for the displayed draft field',()=>{
  const calendar=functionSource('rProjCalendar');
  assert.match(calendar,/class="case-calendar-item[^"]*"[^>]*draggable="true" data-case-ref="\$\{esc\(ref\)\}" ondragstart="_caseCalendarDragStart\(event\)" ondragend="_caseCalendarDragEnd\(event\)"/);
  assert.match(calendar,/data-calendar-date="\$\{date\}" ondragover="_caseCalendarDragOver\(event\)" ondragleave="_caseCalendarDragLeave\(event\)" ondrop="_caseCalendarDrop\(event,'\$\{date\}'\)"/);
  assert.match(calendar,/case-calendar-unset-list[\s\S]*draggable="true" data-case-ref/);
  assert.match(functionSource('_caseCalendarDrop'),/_caseScheduleSetDate\(ref,prioOpts\[pi\]\[0\],date\)/,'the drop writes the field currently selected in the toggle');
  assert.match(css,/\.case-calendar-day\.drag-over\{/);
  assert.match(css,/\.case-calendar-item\[draggable="true"\][^{]*\{cursor:grab\}/);
});

function makeContext(){
  const calls=[];
  const context={
    S:{jobs:[
      {id:'legacy-1',biz:'edit',status:'進行中',editorDraftDate:'2026-09-02',clientDraftDate:'2026-09-08',editorDraftDateSetter:'creator',subtasks:[
        {id:'s1',status:'未着手',editorDraftDate:'2026-09-03',clientDraftDate:'',editorDraftDateSetter:'creator'},
        {id:'s2',status:'未着手',editorDraftDate:'',clientDraftDate:'',editorDraftDateSetter:'editor'},
      ]},
    ]},
    PORTAL_JOBS:[{id:'p1',_portalUid:'uid-1',editorDraftDate:'2026-09-04',clientDraftDate:'',editorDraftDateSetter:'creator'}],
    PRIO_IDX:0,
    _videoCanEdit:()=>true,
    _myEmail:()=>'owner@example.com',
    _editorDraftDateSetter:record=>record?.editorDraftDateSetter||'editor',
    _findVideoSubcase:(parent,subId)=>{const index=(parent?.subtasks||[]).findIndex(sub=>String(sub.id)===String(subId));return index<0?null:{index,sub:parent.subtasks[index]};},
    _canManagePortalWorkflow:()=>true,
    save:()=>calls.push(['save']),
    render:()=>calls.push(['render']),
    toast:(message,kind)=>calls.push(['toast',message,kind||'']),
    console:{warn:()=>{}},
    fbDb:{collection:()=>({doc:()=>({collection:()=>({doc:()=>({set:(data,opts)=>{calls.push(['firestore',data,opts]);return Promise.resolve();}})})})})},
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('_caseScheduleSetDate')}\nthis.setDate=_caseScheduleSetDate;`,context);
  return{context,calls};
}

test('dropping a legacy parent moves only the displayed field and records history before saving',async()=>{
  const{context,calls}=makeContext();
  await context.setDate({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'editorDraftDate','2026-09-10');
  const job=context.S.jobs[0];
  assert.equal(job.editorDraftDate,'2026-09-10');
  assert.equal(job.clientDraftDate,'2026-09-08','the other draft date is untouched');
  assert.equal(job.statusHistory.at(-1).type,'calendar_date_move');
  assert.deepEqual(calls.map(c=>c[0]),['save','render','toast']);
  assert.equal(calls.at(-1)[1],'編集者初稿を2026-09-10に変更しました');
});

test('dropping a legacy subtask updates that subtask only and respects editor-owned draft dates',async()=>{
  const{context,calls}=makeContext();
  await context.setDate({t:'sub',s:'legacy',j:'legacy-1',u:'',sub:'s1',pj:'',pu:''},'clientDraftDate','2026-09-12');
  const[first,second]=context.S.jobs[0].subtasks;
  assert.equal(first.clientDraftDate,'2026-09-12');
  assert.equal(first.editorDraftDate,'2026-09-03');
  assert.equal(second.clientDraftDate,'');
  assert.ok(calls.some(c=>c[0]==='save'));

  calls.length=0;
  await context.setDate({t:'sub',s:'legacy',j:'legacy-1',u:'',sub:'s2',pj:'',pu:''},'editorDraftDate','2026-09-12');
  assert.equal(second.editorDraftDate,'','editor-owned draft dates are not overwritten by the owner');
  assert.deepEqual(calls,[['toast','この子案件の編集者初稿は担当編集者が設定します','warn']]);
});

test('dropping a portal job writes a merge update with only the moved field',async()=>{
  const{context,calls}=makeContext();
  await context.setDate({t:'job',s:'portal',j:'p1',u:'uid-1',sub:'',pj:'',pu:''},'editorDraftDate','2026-09-15');
  const write=calls.find(c=>c[0]==='firestore');
  assert.ok(write,'a Firestore write happens');
  assert.deepEqual(Object.keys(write[1]).sort(),['editorDraftDate','updatedAt','updatedBy']);
  assert.equal(write[2]?.merge,true,'the write is a merge so no other field is clobbered');
  assert.equal(context.PORTAL_JOBS[0].editorDraftDate,'2026-09-15');
  assert.ok(!calls.some(c=>c[0]==='save'),'portal rows never touch the legacy save path');
});

test('unsupported rows and invalid input are rejected without writing',async()=>{
  const{context,calls}=makeContext();
  await context.setDate({t:'job',s:'portal-parent',j:'parent:x',u:'',sub:'',pj:'',pu:''},'editorDraftDate','2026-09-15');
  await context.setDate({t:'sub',s:'portal',j:'p1',u:'uid-1',sub:'inner',pj:'',pu:''},'editorDraftDate','2026-09-15');
  await context.setDate({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'deliveryDate','2026-09-15');
  await context.setDate({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'editorDraftDate','not-a-date');
  assert.ok(!calls.some(c=>c[0]==='save'||c[0]==='firestore'));
  assert.equal(context.S.jobs[0].editorDraftDate,'2026-09-02');
});

test('setting the parent job progress to 完了 fills the owner-recorded delivery date when it is empty',()=>{
  const context={today:()=>'2026-09-05',document:{getElementById:id=>id==='j-completed-delivery'?context.completed:null}};
  vm.createContext(context);
  vm.runInContext(`${functionSource('jobStatusChanged')}\nthis.changed=jobStatusChanged;`,context);
  context.completed={disabled:false,value:''};
  context.changed({value:'完了'});
  assert.equal(context.completed.value,'2026-09-05');
  context.completed={disabled:false,value:'2026-09-01'};
  context.changed({value:'完了'});
  assert.equal(context.completed.value,'2026-09-01','an existing date is kept');
  context.completed={disabled:true,value:''};
  context.changed({value:'完了'});
  assert.equal(context.completed.value,'','a locked field is never written');
  context.completed={disabled:false,value:''};
  context.changed({value:'進行中'});
  assert.equal(context.completed.value,'');
  assert.match(html,/<select id="j-stat" onchange="jobStatusChanged\(this\)"/);
});

test('saving a job or subcase as 完了 without a delivery date falls back to today',()=>{
  assert.match(html,/completedDeliveryDate:!hasSubtasks&&parentInternalOnly\?\(document\.getElementById\('j-completed-delivery'\)\?\.value\|\|\(requestedStatus==='完了'\?today\(\):null\)\)/);
  assert.match(html,/requestedCompletionDate=completionEditable\?\(el\.querySelector\('\.j-sub-completed-delivery'\)\?\.value\|\|\(requestedSubStatus==='完了'\?today\(\):null\)\)/);
});

test('the calendar and priority views can be limited to mono.create internal editing',()=>{
  assert.match(html,/let CASE_CAL_SCOPE=/);
  assert.match(functionSource('_caseScheduleToggle'),/aria-label="表示する担当"[\s\S]*setCaseCalendarScope\('internal'\)[\s\S]*社内対応のみ/);
  assert.match(functionSource('rProjCalendar'),/rows=_caseScheduleScopedRows\(field\)/);
  assert.match(functionSource('rProjPriority'),/rows=_caseScheduleScopedRows\(field\)/);
  const context={SELF_WID:'self',CASE_CAL_SCOPE:'internal',_videoWorkerAssignmentIds:job=>Array.isArray(job.workerIds)?job.workerIds:[],_caseScheduleRows:()=>[
    {type:'job',job:{id:'a',workerIds:['self'],assignee:'mono.create社内対応'}},
    {type:'job',job:{id:'b',workerIds:['w1'],assignee:'みゆう'}},
    {type:'job',job:{id:'c',workerIds:['self','w1'],assignee:'2名'}},
    {type:'sub',job:{id:'d',workerIds:[]},sub:{id:'d1',workerId:'self',assignee:'mono.create社内対応'}},
    {type:'sub',job:{id:'d',workerIds:[]},sub:{id:'d2',workerId:'w2',assignee:'みゆう'}},
    {type:'job',job:{id:'e',workerIds:[],assignee:'mono.create社内対応'}},
  ]};
  vm.createContext(context);
  vm.runInContext(`${functionSource('_caseScheduleRowInternal')}\n${functionSource('_caseScheduleScopedRows')}\nthis.scoped=_caseScheduleScopedRows;`,context);
  assert.deepEqual(context.scoped('editorDraftDate').map(r=>r.sub?r.sub.id:r.job.id),['a','d1','e']);
  context.CASE_CAL_SCOPE='all';
  assert.equal(context.scoped('editorDraftDate').length,6);
});
