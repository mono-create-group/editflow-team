const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=html.indexOf('function getPayEntries(');
const end=html.indexOf('function rProjPayment(',start);
assert.ok(start>=0&&end>start,'payment helpers must exist');
const source=html.slice(start,end);

function fixture(){
  const parent={id:'parent',title:'親案件',workerId:'worker-a',workerPay:5000,payoutDate:'2026-09-30'};
  const withSub={id:'with-sub',title:'子案件あり',payoutDate:'2026-09-30',subtasks:[
    {id:'sub-a',title:'サブA',workerId:'worker-b',workerPay:3000,payoutDate:'2026-09-30'},
    {id:'sub-self',title:'社内作業',workerId:'self',workerPay:1000,payoutDate:'2026-09-30'},
  ]};
  const calls={save:0,render:0,toasts:[]};
  const context={
    S:{jobs:[parent,withSub]},SELF_WID:'self',
    getJobWorkerIds(job){return [job.workerId].filter(Boolean);},
    _paymentRecipientForRecord(record,workerId){return workerId?{ok:true,payeeWorkerId:workerId,payeeUid:`uid-${workerId}`,route:'direct'}:{ok:false,reason:'支払先未設定'};},
    _canViewFinancials(){return true;},
    _myEmail(){return'owner@example.test';},
    today(){return'2026-09-15';},
    confirm(){return true;},
    save(){calls.save++;},render(){calls.render++;},toast(message){calls.toasts.push(message);},
    Date,Object,String,Number,Array,Math,
  };
  context.BJOBS=()=>context.S.jobs;
  vm.createContext(context);
  vm.runInContext(`${source}\nthis.getPayEntries=getPayEntries;this.toggleWorkerPaymentPaid=toggleWorkerPaymentPaid;`,context);
  return{context,parent,withSub,calls};
}

test('支払予定日を残したまま親案件の実支払日を保存・取消できる',()=>{
  const{context,parent,calls}=fixture();
  assert.equal(context.toggleWorkerPaymentPaid('parent','',-1),true);
  assert.equal(parent.workerPaidAt,'2026-09-15');
  assert.equal(parent.payoutDate,'2026-09-30');
  assert.equal(parent.workerPaidBy,'owner@example.test');
  assert.equal(calls.save,1);
  assert.equal(context.toggleWorkerPaymentPaid('parent','',-1),true);
  assert.equal(parent.workerPaidAt,null);
  assert.equal(parent.payoutDate,'2026-09-30');
});

test('サブ案件の支払済みは対象の子だけを更新し月別一覧へ反映する',()=>{
  const{context,parent,withSub}=fixture();
  const before=context.getPayEntries('2026-09');
  assert.deepEqual(Array.from(before,e=>e.label),['親案件','サブA']);
  assert.equal(context.toggleWorkerPaymentPaid('with-sub','sub-a',0),true);
  assert.equal(withSub.subtasks[0].workerPaidAt,'2026-09-15');
  assert.equal(withSub.subtasks[1].workerPaidAt,undefined);
  assert.equal(parent.workerPaidAt,undefined);
  const after=context.getPayEntries('2026-09');
  assert.equal(after.find(e=>e.subtaskId==='sub-a').workerPaidAt,'2026-09-15');
});

test('支払先未設定では支払済みにできず、画面は支払状態と取消操作を表示する',()=>{
  const{context,parent,calls}=fixture();
  parent.workerId=null;
  assert.equal(context.toggleWorkerPaymentPaid('parent','',-1),false);
  assert.equal(parent.workerPaidAt,undefined);
  assert.equal(calls.save,0);
  assert.match(html,/支払済み<\/button>/);
  assert.match(html,/未払いに戻す/);
  assert.match(html,/支払済み \$\{e\.workerPaidAt\}/);
  assert.match(html,/支払予定 \$\{e\.payoutDate\}/);
});

test('支払いページと操作はオーナーの財務権限を必須にする',()=>{
  assert.match(html,/function rProjPayment\(\)\{\s*if\(!_canViewFinancials\(\)\)/);
  assert.match(source,/function toggleWorkerPaymentPaid[\s\S]*if\(!_canViewFinancials\(\)\)/);
});
