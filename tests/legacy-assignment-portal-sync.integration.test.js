const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('async function syncLegacyAssignedSubtasksToPortal(');
const end=html.indexOf('\nfunction _applyPortalToLegacy',start);
assert.ok(start>=0&&end>start,'legacy synchronizer source must exist');
const syncSource=html.slice(start,end);

function fakeDb(){
  const docs=new Map();
  const makeRef=parts=>({path:parts.join('/'),async get(){return{exists:docs.has(this.path),data:()=>docs.get(this.path)}}});
  return{
    docs,
    collection(name){return{doc:id=>({collection:sub=>({doc:subId=>makeRef([name,id,sub,subId])})})}},
    batch(){const writes=[];return{set(ref,data,options){writes.push({ref,data,options})},async commit(){for(const {ref,data,options} of writes){const prev=docs.get(ref.path)||{};docs.set(ref.path,options?.merge?{...prev,...data}:data)}}}},
  };
}

test('和光8件と清水7件を、みゆう本人のポータルだけへ重複なく同期する',async()=>{
  const db=fakeDb(),saved={count:0};
  const makeChildren=(prefix,count,deliveryDate)=>Array.from({length:count},(_,i)=>({id:`${prefix}-${String(i+1).padStart(3,'0')}`,title:`${prefix}動画${i+1}`,status:'進行中',deliveryDate,clientDraftDate:'2026-09-11',editorDraftDateSetter:'editor',workerId:'worker-miyuu'}));
  const parents=[
    {id:'wako-sep',biz:'edit',title:'9月分_和光市デンタルオフィス',clientId:'itsuba',subtasks:makeChildren('WD-S',8,'')},
    {id:'shimizu-sep',biz:'edit',title:'清水運輸グループ様_9月分',clientId:'itsuba',subtasks:makeChildren('SU-S',7,'2026-09-03')},
  ];
  const context={
    S:{jobs:parents,clients:[{id:'itsuba',name:'itsuba.net 河戸様'}]},fbDb:db,FB_USER:{uid:'owner'},SELF_WID:'self',
    _isOwner:()=>true,myRoles:()=>['オーナー'],jobBiz:j=>j.biz,_legacyPortalStatus:s=>['完了','キャンセル'].includes(s)?'':s,
    _legacyPortalWorkerId:(parent,record)=>record.workerId||parent.workerId||'',
    _legacyPortalJobId:(parentId,subId)=>`legacy_${parentId}_${subId}`.replace(/[^A-Za-z0-9_-]/g,'_'),
    _legacyPortalAccessForWorker:wid=>wid==='worker-miyuu'?{id:'uid-miyuu',email:'miyuu@example.test',name:'みゆう',directorUid:'uid-miura'}:null,
    _editorDraftDateSetter:r=>r.editorDraftDateSetter==='creator'?'creator':'editor',_videoAttachments:rows=>rows||[],_paymentWorkerName:()=>'',
    _myEmail:()=> 'owner@example.test',toast:()=>{},save:()=>{saved.count++},
    firebase:{firestore:{FieldValue:{serverTimestamp:()=>({serverTimestamp:true})}}},console,Date,String,Number,Array,Set,Map,Promise,
  };
  vm.createContext(context);vm.runInContext(`${syncSource}\nthis.sync=syncLegacyAssignedSubtasksToPortal;`,context);
  const first=[];for(const parent of parents)first.push(await context.sync(parent,{silent:true,targetUid:'uid-miyuu',onlyMissing:true}));
  assert.equal(first.reduce((n,row)=>n+row.synced,0),15);
  assert.equal(db.docs.size,15);
  for(const [docPath,doc] of db.docs){
    assert.match(docPath,/^editor_portals\/uid-miyuu\/editor_jobs\/legacy_/);
    assert.equal(doc.editorUid,'uid-miyuu');assert.equal(doc.submittedByUid,'uid-miyuu');assert.equal(doc.source,'legacy_sync');
    for(const forbidden of ['unitPrice','workerPay','ownPay','payableApproved','payableMonth'])assert.equal(Object.hasOwn(doc,forbidden),false,`${forbidden} must not reach Miyuu`);
  }
  assert.equal([...db.docs.values()].filter(doc=>doc.legacyParentId==='wako-sep'&&doc.deliveryDate==='').length,8,'納期が未設定の旧和光案件も推測で日付を補完せず連携する');
  const second=[];for(const parent of parents)second.push(await context.sync(parent,{silent:true,targetUid:'uid-miyuu',onlyMissing:true}));
  assert.equal(second.reduce((n,row)=>n+row.synced,0),0);assert.equal(db.docs.size,15);
  assert.ok(parents.flatMap(parent=>parent.subtasks).every(child=>child.portalUid==='uid-miyuu'&&child.portalJobId));
  assert.ok(saved.count>=2,'legacy records receive stable portal links after successful writes');
});
