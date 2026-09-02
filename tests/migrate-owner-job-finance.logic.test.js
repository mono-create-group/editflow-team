const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const tool=require(path.join(__dirname,'..','scripts','migrate-owner-job-finance.cjs'));

const parent={id:'legacy-1',unitPrice:6000,workerPay:3000,profit:3000,monthlyFee:500,salesPay:0,invoiceDate:'2026-09-25',subtasks:[{id:'sub-1',title:'動画A',unitPrice:4000,workerPay:2000,profit:2000,salesPay:100},{title:'動画B',unitPrice:2000,workerPay:1000}]};
const source=jobs=>({jobs:JSON.stringify(jobs)});

test('one immutable owner_legacy_finance snapshot is planned for every finance-bearing parent',()=>{
  const plan=tool.buildPlan(source([parent]));
  assert.equal(tool.LEGACY_COLLECTION,'owner_legacy_finance');
  assert.equal(plan.candidates.length,1);
  const snapshot=plan.candidates[0].snapshot;
  assert.equal(snapshot.recordType,'owner_legacy_finance');
  assert.equal(snapshot.revision,1);
  assert.equal(snapshot.legacyJobId,'legacy-1');
  assert.equal(snapshot.sourceHash.length,64);
  assert.deepEqual(snapshot.parentAmounts,{unitPrice:6000,workerPay:3000,profit:3000,monthlyFee:500,salesPay:0});
  assert.deepEqual(snapshot.subtaskAmounts[0],{id:'sub-1',index:0,titleHash:snapshot.subtaskAmounts[0].titleHash,unitPrice:4000,workerPay:2000,profit:2000,monthlyFee:0,salesPay:100});
  assert.equal(snapshot.subtaskAmounts[1].id,undefined);
  assert.equal(snapshot.subtaskAmounts[1].index,1);
  assert.equal(snapshot.subtaskAmounts[1].titleHash.length,64);
});

test('missing amounts become zero and duplicate child ids fail closed',()=>{
  const noValues=tool.buildPlan(source([{id:'zeroes',unitPrice:0,subtasks:[{id:'a',title:'x',workerPay:4}]}]));
  assert.equal(noValues.candidates.length,1);
  assert.deepEqual(noValues.candidates[0].snapshot.parentAmounts,{unitPrice:0,workerPay:0,profit:0,monthlyFee:0,salesPay:0});
  const duplicate=tool.buildPlan(source([{...parent,id:'duplicate',subtasks:[{id:'same',unitPrice:1},{id:'same',unitPrice:2}]}]));
  assert.deepEqual(duplicate.conflicts.map(row=>row.reason),['duplicate_subtask_id']);
});

test('idempotency requires both sourceHash and all normalized amounts to match',()=>{
  const first=tool.buildPlan(source([parent]));
  const exact={...first.candidates[0].snapshot};
  const same=tool.buildPlan(source([parent]),new Map([['legacy-1',exact]]));
  assert.equal(same.alreadyMigrated.length,1);
  const changed={...exact,parentAmounts:{...exact.parentAmounts,workerPay:999}};
  const conflict=tool.buildPlan(source([parent]),new Map([['legacy-1',changed]]));
  assert.deepEqual(conflict.conflicts.map(row=>row.reason),['existing_ledger_mismatch']);
});

test('clear plan removes only amount keys from parent and children and retains financial dates',()=>{
  const plan=tool.buildPlan(source([parent]));
  const cleaned=tool.cleanupJobs([parent],plan)[0];
  for(const key of tool.AMOUNT_KEYS){assert.equal(Object.hasOwn(cleaned,key),false);for(const child of cleaned.subtasks)assert.equal(Object.hasOwn(child,key),false);}
  assert.equal(cleaned.ownerFinanceId,'legacy-1');
  assert.equal(cleaned.invoiceDate,'2026-09-25');
  assert.equal(cleaned.subtasks[0].title,'動画A');
});

test('apply transaction reads every candidate ledger before it creates any ledger',async()=>{
  const plan=tool.buildPlan(source([{...parent,id:'legacy-1'},{...parent,id:'legacy-2',subtasks:[]}]))
  const events=[],sharedRef={kind:'shared'},refs=new Map();
  const db={
    collection(name){return{doc(id){const ref={kind:name,id};refs.set(`${name}/${id}`,ref);return ref;}}},
    async runTransaction(callback){
      let readAll=false;
      return callback({
        async get(ref){events.push(`get:${ref.kind}`);return{exists:true,data:()=>source([{...parent,id:'legacy-1'},{...parent,id:'legacy-2',subtasks:[]}])};},
        async getAll(...candidateRefs){events.push(`getAll:${candidateRefs.length}`);readAll=true;return candidateRefs.map(()=>({exists:false,data:()=>null}));},
        create(ref){assert.equal(readAll,true,'a ledger create must follow the complete candidate read');events.push(`create:${ref.id}`);},
        update(){events.push('update');}
      });
    }
  };
  const admin={firestore:{FieldValue:{serverTimestamp:()=>({server:true})}}};
  await tool.applyLive(admin,{db,sharedRef,source:source([{...parent,id:'legacy-1'},{...parent,id:'legacy-2',subtasks:[]}])},plan,{clearSharedFinance:false,migratedBy:'test'});
  assert.deepEqual(events,['get:shared','getAll:2','create:legacy-1','create:legacy-2']);
});

test('clear stage revalidates every immutable ledger inside the transaction before removing shared amounts',async()=>{
  const original=[{...parent,id:'legacy-1'},{...parent,id:'legacy-2',subtasks:[]}];
  const first=tool.buildPlan(source(original));
  const ledgers=new Map(first.candidates.map(row=>[row.id,{...row.snapshot,migratedAt:1,migratedBy:'owner'}]));
  const plan=tool.buildPlan(source(original),ledgers);
  const events=[],sharedRef={kind:'shared'},writes=[];
  const db={
    collection(name){return{doc(id){return{kind:name,id};}}},
    async runTransaction(callback){
      let readAll=false;
      return callback({
        async get(ref){events.push(`get:${ref.kind}`);return{exists:true,data:()=>source(original)};},
        async getAll(...refs){events.push(`getAll:${refs.length}`);readAll=true;return refs.map(ref=>({exists:true,data:()=>ledgers.get(ref.id)}));},
        create(){throw new Error('clear stage must never create a ledger');},
        update(ref,data){assert.equal(readAll,true);events.push('update');writes.push(data);}
      });
    }
  };
  const admin={firestore:{FieldValue:{serverTimestamp:()=>({server:true})}}};
  await tool.applyLive(admin,{db,sharedRef,source:source(original)},plan,{clearSharedFinance:true,migratedBy:'test'});
  assert.deepEqual(events,['get:shared','getAll:2','update']);
  const cleaned=JSON.parse(writes[0].jobs);
  assert.equal(cleaned.every(job=>job.ownerFinanceId===job.id),true);
  assert.equal(cleaned.some(job=>tool.AMOUNT_KEYS.some(key=>Object.hasOwn(job,key))),false);

  const missingDb={...db,async runTransaction(callback){return callback({
    async get(){return{exists:true,data:()=>source(original)};},
    async getAll(...refs){return refs.map((ref,index)=>({exists:index!==0,data:()=>ledgers.get(ref.id)}));},
    create(){throw new Error('unexpected create');},
    update(){throw new Error('clear must stop before update');}
  });}};
  await assert.rejects(()=>tool.applyLive(admin,{db:missingDb,sharedRef,source:source(original)},plan,{clearSharedFinance:true,migratedBy:'test'}),/消去直前に見つからない/);
});

test('restore reads every ledger before writes and restores only amounts while retaining operational fields',async()=>{
  const original=[{...parent,id:'legacy-1',status:'案件掲載中'},{...parent,id:'legacy-2',subtasks:[],status:'案件掲載中'}],migration=tool.buildPlan(source(original)),snapshots=migration.candidates.map(row=>row.snapshot);
  const cleared=tool.cleanupJobs(original,migration).map((job,index)=>({...job,status:index===0?'修正中':'完了',deliveryDate:`2026-09-0${index+1}`,notes:'restore must keep this'}));
  const events=[],sharedRef={kind:'shared'},writes=[];
  const db={
    collection(name){return{doc(id){return{kind:name,id};},where(field,op,value){return{kind:'correction-query',field,op,value,limit(){return this;}}}}},
    async runTransaction(callback){
      let readAll=false;
      return callback({
        async get(ref){events.push(`get:${ref.kind}`);if(ref.kind==='correction-query')return{empty:true};return{exists:true,data:()=>source(cleared)};},
        async getAll(...refs){events.push(`getAll:${refs.length}`);readAll=true;return snapshots.map(snapshot=>({exists:true,data:()=>({...snapshot,migratedAt:1,migratedBy:'owner'})}));},
        update(ref,data){assert.equal(readAll,true);events.push('update');writes.push(data);},
        delete(ref){assert.equal(readAll,true);events.push(`delete:${ref.id}`);}
      });
    }
  };
  const admin={firestore:{FieldValue:{serverTimestamp:()=>({server:true})}}};
  await tool.applyRestoreLive(admin,{db,sharedRef,source:source(cleared)},snapshots,{restoredBy:'test'});
  await tool.applyRestoreLive(admin,{db,sharedRef,source:source(cleared)},snapshots,{restoredBy:'test'});
  assert.deepEqual(events,['get:shared','getAll:2','get:correction-query','get:correction-query','update','delete:legacy-1','delete:legacy-2','get:shared','getAll:2','get:correction-query','get:correction-query','update','delete:legacy-1','delete:legacy-2']);
  const restored=JSON.parse(writes[0].jobs);
  assert.equal(restored[0].status,'修正中');
  assert.equal(restored[0].deliveryDate,'2026-09-01');
  assert.equal(restored[0].notes,'restore must keep this');
  assert.equal(restored[0].unitPrice,6000);
  assert.equal(restored[0].subtasks[0].workerPay,2000);
  assert.equal(Object.hasOwn(restored[0],'ownerFinanceId'),false);
  assert.match(writes[0].ledgerRestoreToken,/^[0-9a-f-]{32,}$/i);
  assert.notEqual(writes[0].ledgerRestoreToken,writes[1].ledgerRestoreToken);
  assert.deepEqual(writes[0].ledgerRestoreAt,{server:true});
});

test('restore fails closed when current amount keys or owner ledger links are not exactly in the cleared state',()=>{
  const migration=tool.buildPlan(source([parent])),snapshot=migration.candidates[0].snapshot,cleared=tool.cleanupJobs([parent],migration)[0];
  assert.throws(()=>tool.restoreJobs([{...cleared,unitPrice:1}],[snapshot]),/current_parent_amount_present/);
  assert.throws(()=>tool.restoreJobs([{...cleared,ownerFinanceId:'different'}],[snapshot]),/ownerFinanceId_mismatch/);
  assert.throws(()=>tool.restoreJobs([{...cleared,id:'different'}],[snapshot]),/missing_current_legacy_job_id/);
});

test('restore fails closed while an append-only finance correction exists',async()=>{
  const original=[{...parent,id:'legacy-1'}],migration=tool.buildPlan(source(original)),snapshots=migration.candidates.map(row=>row.snapshot),cleared=tool.cleanupJobs(original,migration);
  const sharedRef={kind:'shared'},db={
    collection(name){return{doc(id){return{kind:name,id};},where(){return{kind:'correction-query',limit(){return this;}}}}},
    async runTransaction(callback){return callback({
      async get(ref){if(ref.kind==='correction-query')return{empty:false};return{exists:true,data:()=>source(cleared)};},
      async getAll(){return snapshots.map(snapshot=>({exists:true,data:()=>snapshot}));},
      update(){throw new Error('restore must stop before update');},delete(){throw new Error('restore must stop before delete');}
    });}
  };
  const admin={firestore:{FieldValue:{serverTimestamp:()=>({server:true})}}};
  await assert.rejects(()=>tool.applyRestoreLive(admin,{db,sharedRef,source:source(cleared)},snapshots,{restoredBy:'test'}),/ledger_correction_present:legacy-1/);
});

test('migration tool keeps dry-run, 0600 backup, two-stage clear, ADC and read-only OAuth safeguards',()=>{
  const text=fs.readFileSync(path.join(__dirname,'..','scripts','migrate-owner-job-finance.cjs'),'utf8');
  assert.match(text,/mode:0o600/);
  assert.match(text,/--clear-shared-finance は --apply/);
  assert.match(text,/まずsnapshot作成のみを完了/);
  assert.match(text,/--adc（gcloud application-default login）/);
  assert.match(text,/--access-token 経路は読み取り専用dry-run/);
  assert.match(text,/owner_legacy_finance/);
  assert.match(text,/owner_legacy_finance_corrections/);
  assert.match(text,/ledger_correction_present/);
  assert.match(text,/ledgerRestoreToken/);
  assert.match(text,/ledgerRestoreAt:admin\.firestore\.FieldValue\.serverTimestamp\(\)/);
  const reads=text.indexOf('await tx.getAll(...candidateRefs)');
  const creates=text.indexOf('for(const {row,ref} of missing)');
  assert.ok(reads>=0&&creates>reads,'candidate ledger reads must be complete before the create loop');
  assert.match(text,/--confirm-restore-owner-legacy-finance/);
  const restoreReads=text.indexOf('await tx.getAll(...refs)');
  const correctionReads=text.indexOf("where('legacyFinanceId','==',id)",restoreReads);
  const restoreWrites=text.indexOf('tx.update(live.sharedRef',restoreReads);
  assert.ok(restoreReads>=0&&correctionReads>restoreReads&&restoreWrites>correctionReads,'restore must read ledgers and correction guards before shared writes');
});
