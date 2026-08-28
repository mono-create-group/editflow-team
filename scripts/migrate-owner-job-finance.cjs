#!/usr/bin/env node
'use strict';

/* Owner-operated migration for historic shared/mcapp finance.
 * Default is dry-run. It always writes a mode-0600 backup/plan and never
 * changes Firestore unless --apply and --confirm-project are both supplied.
 *
 * First create immutable snapshots, then run a fresh dry-run. Only a second
 * --apply --clear-shared-finance run can remove amount keys from shared/mcapp.
 * Dates remain untouched. This tool never runs itself in production.
 */
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');

const AMOUNT_KEYS=['unitPrice','workerPay','profit','monthlyFee','salesPay'];
const MAX_AMOUNT=100000000;
const LEGACY_COLLECTION='owner_legacy_finance';
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const argValue=(args,name)=>{const i=args.indexOf(name);return i>=0?args[i+1]:''};
const hasArg=(args,name)=>args.includes(name);
const amount=value=>{const n=Number(value);return Number.isInteger(n)&&n>=0&&n<=MAX_AMOUNT?n:0};
const validDocId=value=>typeof value==='string'&&value.length>0&&value.length<=220&&!value.includes('/');
const hasAmountKeys=value=>!!value&&typeof value==='object'&&AMOUNT_KEYS.some(key=>Object.prototype.hasOwnProperty.call(value,key));
function decodeJobs(source){
  const doc=source?.shared?.mcapp||source?.mcapp||source,raw=doc?.jobs;
  if(Array.isArray(raw))return raw;
  if(typeof raw!=='string')throw new Error('shared/mcapp の jobs 配列が見つかりません');
  if(raw.startsWith('LZ:'))throw new Error('LZ圧縮された jobs は安全のため扱いません。非圧縮Firestore exportを指定してください');
  const jobs=JSON.parse(raw);if(!Array.isArray(jobs))throw new Error('shared/mcapp.jobs は配列ではありません');return jobs;
}
function amounts(value){const out={};AMOUNT_KEYS.forEach(key=>{out[key]=amount(value?.[key])});return out}
function stableSubtask(subtask,index,seenIds){
  const id=String(subtask?.id||'').trim(),titleHash=hash(String(subtask?.title||''));
  if(id){if(seenIds.has(id))throw new Error('duplicate_subtask_id');seenIds.add(id);return{id,index,titleHash,...amounts(subtask)}}
  return{index,titleHash,...amounts(subtask)};
}
function snapshotForJob(job){
  const legacyJobId=String(job?.id||'').trim();if(!validDocId(legacyJobId))return{skip:'invalid_legacy_job_id'};
  const subtasks=Array.isArray(job.subtasks)?job.subtasks:[],hasFinance=hasAmountKeys(job)||subtasks.some(hasAmountKeys);
  if(!hasFinance)return{skip:'no_finance'};
  let subtaskAmounts;
  try{const seen=new Set();subtaskAmounts=subtasks.map((subtask,index)=>stableSubtask(subtask,index,seen));}
  catch(error){return{conflict:error.message};}
  const body={recordType:'owner_legacy_finance',revision:1,legacyJobId,parentAmounts:amounts(job),subtaskAmounts};
  return{snapshot:{...body,sourceHash:hash(body)}};
}
function comparable(record){return{recordType:record.recordType,revision:Number(record.revision),legacyJobId:record.legacyJobId,sourceHash:record.sourceHash,parentAmounts:amounts(record.parentAmounts),subtaskAmounts:(record.subtaskAmounts||[]).map(row=>({...(row.id?{id:String(row.id)}:{}),index:Number(row.index),titleHash:String(row.titleHash||''),...amounts(row)}))};}
const sameSnapshot=(a,b)=>JSON.stringify(comparable(a))===JSON.stringify(comparable(b));
function buildPlan(source,existingById=new Map()){
  const jobs=decodeJobs(source),plan={candidates:[],alreadyMigrated:[],skipped:[],conflicts:[]},seenIds=new Set();
  jobs.forEach((job,index)=>{
    const result=snapshotForJob(job),id=String(job?.id||'').trim();
    if(result.skip){if(result.skip!=='no_finance')plan.skipped.push({index,id,reason:result.skip});return}
    if(result.conflict){plan.conflicts.push({index,id,reason:result.conflict});return}
    const snapshot=result.snapshot,existing=existingById.get(snapshot.legacyJobId);
    if(seenIds.has(snapshot.legacyJobId)){plan.conflicts.push({index,id:snapshot.legacyJobId,reason:'duplicate_legacy_job_id'});return}
    seenIds.add(snapshot.legacyJobId);
    if(existing){if(sameSnapshot(existing,snapshot))plan.alreadyMigrated.push({index,id:snapshot.legacyJobId,snapshot});else plan.conflicts.push({index,id:snapshot.legacyJobId,reason:'existing_ledger_mismatch'});return}
    plan.candidates.push({index,id:snapshot.legacyJobId,snapshot});
  });
  return plan;
}
function stripAmounts(value){const out={...value};AMOUNT_KEYS.forEach(key=>delete out[key]);return out}
function cleanupJobs(jobs,plan){
  const ids=new Set(plan.candidates.map(x=>x.id).concat(plan.alreadyMigrated.map(x=>x.id)));
  return jobs.map(job=>{const legacyJobId=String(job?.id||'');if(!ids.has(legacyJobId))return job;const next={...stripAmounts(job),ownerFinanceId:legacyJobId};if(Array.isArray(job.subtasks))next.subtasks=job.subtasks.map(stripAmounts);return next;});
}
function restoreSnapshotsFromBackup(payload){
  if(!payload||payload.schema!=='editflow-owner-legacy-finance-migration-v2'||!payload.source)throw new Error('有効な owner_legacy_finance バックアップではありません');
  const plan=buildPlan(payload.source,new Map());
  if(plan.conflicts.length||plan.skipped.length)throw new Error('バックアップ内に不一致・重複・不足があるため復元できません');
  if(!plan.candidates.length)throw new Error('バックアップに復元対象の金額スナップショットがありません');
  return plan.candidates.map(row=>row.snapshot);
}
function restoreJobs(currentJobs,snapshots){
  const byId=new Map();
  currentJobs.forEach(job=>{const id=String(job?.id||'');if(byId.has(id))throw new Error('duplicate_current_legacy_job_id');byId.set(id,job)});
  const snapshotById=new Map();
  snapshots.forEach(snapshot=>{if(snapshotById.has(snapshot.legacyJobId))throw new Error('duplicate_backup_legacy_job_id');snapshotById.set(snapshot.legacyJobId,snapshot)});
  snapshotById.forEach((_,legacyJobId)=>{if(!byId.has(legacyJobId))throw new Error(`missing_current_legacy_job_id:${legacyJobId}`)});
  return currentJobs.map(job=>{
    const id=String(job?.id||''),snapshot=snapshotById.get(id);if(!snapshot)return job;
    if(job.ownerFinanceId!==id)throw new Error(`ownerFinanceId_mismatch:${id}`);
    if(hasAmountKeys(job))throw new Error(`current_parent_amount_present:${id}`);
    const children=Array.isArray(job.subtasks)?job.subtasks:[],nextChildren=[...children],used=new Set();
    for(const amountRow of snapshot.subtaskAmounts){
      let index=-1;
      if(amountRow.id){const matches=children.map((child,i)=>String(child?.id||'')===amountRow.id?i:-1).filter(i=>i>=0);if(matches.length!==1)throw new Error(`subtask_id_mismatch:${id}`);index=matches[0];}
      else{index=Number(amountRow.index);if(!Number.isInteger(index)||!children[index]||hash(String(children[index]?.title||''))!==amountRow.titleHash)throw new Error(`subtask_index_or_title_mismatch:${id}`);}
      if(used.has(index))throw new Error(`duplicate_subtask_restore_target:${id}`);used.add(index);
      if(hasAmountKeys(children[index]))throw new Error(`current_subtask_amount_present:${id}`);
      nextChildren[index]={...children[index],...amounts(amountRow)};
    }
    if(children.length!==snapshot.subtaskAmounts.length)throw new Error(`subtask_count_mismatch:${id}`);
    const next={...job,...amounts(snapshot.parentAmounts)};if(Array.isArray(job.subtasks))next.subtasks=nextChildren;delete next.ownerFinanceId;return next;
  });
}
function backupPayload({project,source,plan,mode}){return{schema:'editflow-owner-legacy-finance-migration-v2',createdAt:new Date().toISOString(),project:project||'local-input',mode,source,plan};}
function writeBackup(file,payload){fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,JSON.stringify(payload,null,2)+'\n',{mode:0o600});return file}
const defaultBackup=()=>path.join('/tmp',`editflow-owner-legacy-finance-backup-${new Date().toISOString().replace(/[:.]/g,'-')}.json`);
function requireAdmin(){try{return require('firebase-admin')}catch(_){throw new Error('firebase-admin が見つかりません。安全な実行環境で firebase-admin を利用可能にしてください');}}
function initializeAdmin(admin,{project,serviceAccount,useAdc}){
  if(admin.apps.length)return;
  if(serviceAccount)admin.initializeApp({credential:admin.credential.cert(JSON.parse(fs.readFileSync(serviceAccount,'utf8'))),projectId:project});
  else if(useAdc)admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:project});
  else throw new Error('live接続には --service-account または --adc（gcloud application-default login）が必要です');
}
async function readLive(admin){
  const db=admin.firestore(),sharedRef=db.collection('shared').doc('mcapp'),shared=await sharedRef.get();
  if(!shared.exists)throw new Error('shared/mcapp が見つかりません');
  const ledger=await db.collection(LEGACY_COLLECTION).get();
  return{db,sharedRef,source:shared.data(),existingById:new Map(ledger.docs.map(d=>[d.id,{id:d.id,...d.data()}]))};
}
async function applyLive(admin,live,plan,{clearSharedFinance,migratedBy}){
  if(plan.conflicts.length)throw new Error(`ledger不一致または重複IDが ${plan.conflicts.length} 件あるため中止しました`);
  if(plan.candidates.length>400||(clearSharedFinance&&plan.alreadyMigrated.length>400))throw new Error('1回の安全上限（400件）を超えました。対象を分割してください');
  const beforeJobs=decodeJobs(live.source);
  // Clear is always a second pass: the current dry-run must prove every
  // legacy snapshot already exists and exactly matches before removal.
  if(clearSharedFinance&&plan.candidates.length)throw new Error('消去前に、まずsnapshot作成のみを完了し、再度dry-runで既存ledger一致を確認してください');
  if(clearSharedFinance&&(plan.skipped.length||!plan.alreadyMigrated.length))throw new Error('skipまたは未移行行があるため shared の金額消去を中止しました');
  if(!plan.candidates.length&&!clearSharedFinance)return{created:0,cleaned:false};
  const ledgerRestoreToken=typeof crypto.randomUUID==='function'?crypto.randomUUID():crypto.randomBytes(24).toString('hex');
  await live.db.runTransaction(async tx=>{
    const fresh=await tx.get(live.sharedRef);if(!fresh.exists)throw new Error('shared/mcapp が途中で消えたため中止しました');
    const freshJobs=decodeJobs(fresh.data());
    if(JSON.stringify(freshJobs)!==JSON.stringify(beforeJobs))throw new Error('shared/mcapp.jobs が確認後に変わりました。再度dry-runしてください');
    // Firestore transactions require every read before every write. Stage 1
    // validates candidates before create; Stage 2 re-reads every immutable
    // ledger and compares it with the fresh shared row before removing money.
    const verificationRows=clearSharedFinance?plan.alreadyMigrated:plan.candidates;
    const candidateRefs=verificationRows.map(row=>live.db.collection(LEGACY_COLLECTION).doc(row.id));
    const currentSnapshots=candidateRefs.length?await tx.getAll(...candidateRefs):[];
    const missing=[];
    for(let index=0;index<verificationRows.length;index++){
      const row=verificationRows[index],current=currentSnapshots[index];
      const freshResult=snapshotForJob(freshJobs[row.index]);
      if(!freshResult.snapshot||freshResult.snapshot.legacyJobId!==row.id||!sameSnapshot(freshResult.snapshot,row.snapshot))throw new Error(`shared ${row.id} が確認後に変わりました`);
      if(current.exists){if(!sameSnapshot(current.data(),row.snapshot))throw new Error(`ledger ${row.id} が確認後に変わりました`);continue}
      if(clearSharedFinance)throw new Error(`ledger ${row.id} が消去直前に見つからないため中止しました`);
      missing.push({row,ref:candidateRefs[index]});
    }
    for(const {row,ref} of missing){
      tx.create(ref,{...row.snapshot,migratedAt:admin.firestore.FieldValue.serverTimestamp(),migratedBy});
    }
    if(clearSharedFinance)tx.update(live.sharedRef,{jobs:JSON.stringify(cleanupJobs(freshJobs,plan)),ownerLegacyFinanceMigrationAt:admin.firestore.FieldValue.serverTimestamp(),ownerLegacyFinanceMigrationBy:migratedBy,ledgerRestoreToken,ledgerRestoreAt:admin.firestore.FieldValue.serverTimestamp()});
  });
  return{created:plan.candidates.length,cleaned:clearSharedFinance};
}
async function applyRestoreLive(admin,live,snapshots,{restoredBy}){
  if(snapshots.length>400)throw new Error('1回の安全上限（400件）を超えました。対象を分割してください');
  const beforeJobs=decodeJobs(live.source),ids=snapshots.map(snapshot=>snapshot.legacyJobId),refs=ids.map(id=>live.db.collection(LEGACY_COLLECTION).doc(id));
  const ledgerRestoreToken=typeof crypto.randomUUID==='function'?crypto.randomUUID():crypto.randomBytes(24).toString('hex');
  await live.db.runTransaction(async tx=>{
    const fresh=await tx.get(live.sharedRef);if(!fresh.exists)throw new Error('shared/mcapp が途中で消えたため中止しました');
    const freshJobs=decodeJobs(fresh.data());
    if(JSON.stringify(freshJobs)!==JSON.stringify(beforeJobs))throw new Error('shared/mcapp.jobs が確認後に変わりました。再度dry-runしてください');
    // All immutable ledgers are read and verified before either shared/jobs or
    // a ledger document is written/deleted.
    const ledgerSnapshots=refs.length?await tx.getAll(...refs):[];
    for(let index=0;index<snapshots.length;index++){
      const current=ledgerSnapshots[index];if(!current.exists)throw new Error(`ledger_missing:${ids[index]}`);
      if(!sameSnapshot(current.data(),snapshots[index]))throw new Error(`ledger_backup_mismatch:${ids[index]}`);
    }
    const restored=restoreJobs(freshJobs,snapshots);
    tx.update(live.sharedRef,{jobs:JSON.stringify(restored),ownerLegacyFinanceRestoreAt:admin.firestore.FieldValue.serverTimestamp(),ownerLegacyFinanceRestoreBy:restoredBy,ledgerRestoreToken,ledgerRestoreAt:admin.firestore.FieldValue.serverTimestamp()});
    for(const ref of refs)tx.delete(ref);
  });
  return{restored:snapshots.length};
}
async function fetchTokenDryRun(project,accessToken){
  const url=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/shared/mcapp`;
  const response=await fetch(url,{headers:{Authorization:`Bearer ${accessToken}`}});if(!response.ok)throw new Error(`OAuth token read failed: HTTP ${response.status}`);
  const doc=await response.json(),raw=doc?.fields?.jobs?.stringValue;if(typeof raw!=='string')throw new Error('OAuth token route requires shared/mcapp.jobs stringValue');
  return{jobs:raw};
}
async function main(){
  const args=process.argv.slice(2),input=argValue(args,'--input'),project=argValue(args,'--project'),serviceAccount=argValue(args,'--service-account'),useAdc=hasArg(args,'--adc'),accessToken=argValue(args,'--access-token'),apply=hasArg(args,'--apply'),clearSharedFinance=hasArg(args,'--clear-shared-finance'),restoreBackup=argValue(args,'--restore-backup'),confirmRestore=hasArg(args,'--confirm-restore-owner-legacy-finance'),confirmProject=argValue(args,'--confirm-project'),backup=argValue(args,'--backup')||defaultBackup(),migratedBy=argValue(args,'--migrated-by')||'owner-migration';
  if(clearSharedFinance&&!apply)throw new Error('--clear-shared-finance は --apply と同時にだけ使えます');
  if(input&&apply)throw new Error('--input はdry-run専用です');
  if(accessToken&&apply)throw new Error('--access-token 経路は読み取り専用dry-runです。applyには --service-account または --adc を使ってください');
  if(restoreBackup&&(!apply||!confirmRestore||!project||confirmProject!==project||(!serviceAccount&&!useAdc)))throw new Error('--restore-backup には --apply、--service-account または --adc、同じ値の --confirm-project、--confirm-restore-owner-legacy-finance が必要です');
  if(restoreBackup&&(input||accessToken||clearSharedFinance))throw new Error('--restore-backup はlive接続専用で、--input、--access-token、--clear-shared-financeと併用できません');
  if(apply&&(!project||confirmProject!==project||(!serviceAccount&&!useAdc)))throw new Error('--apply には --project、--service-account または --adc、同じ値の --confirm-project が必要です');
  let source,existingById=new Map(),admin,live;
  if(input){const inputData=JSON.parse(fs.readFileSync(input,'utf8'));source=inputData;existingById=new Map((Array.isArray(inputData.owner_legacy_finance)?inputData.owner_legacy_finance:[]).map(row=>[String(row.id||row.legacyJobId||''),row]));}
  else if(accessToken){if(!project)throw new Error('--access-token には --project が必要です');source=await fetchTokenDryRun(project,accessToken);}
  else{if(!project||(!serviceAccount&&!useAdc))throw new Error('dry-runには --input、または --project と --service-account / --adc が必要です');admin=requireAdmin();initializeAdmin(admin,{project,serviceAccount,useAdc});live=await readLive(admin);({source,existingById}=live)}
  if(restoreBackup){
    const restorePayload=JSON.parse(fs.readFileSync(restoreBackup,'utf8')),snapshots=restoreSnapshotsFromBackup(restorePayload),payload=backupPayload({project,source,plan:{restoreFrom:restoreBackup,snapshots},mode:'restore-apply'});writeBackup(backup,payload);
    console.log(JSON.stringify({mode:'restore-apply',backup,restoring:snapshots.length},null,2));
    console.log(JSON.stringify({applied:true,...await applyRestoreLive(admin,live,snapshots,{restoredBy:migratedBy})},null,2));return;
  }
  const plan=buildPlan(source,existingById),payload=backupPayload({project,source,plan,mode:apply?'apply':'dry-run'});writeBackup(backup,payload);
  console.log(JSON.stringify({mode:apply?'apply':'dry-run',backup,candidates:plan.candidates.length,alreadyMigrated:plan.alreadyMigrated.length,skipped:plan.skipped.length,conflicts:plan.conflicts.length},null,2));
  if(plan.conflicts.length)throw new Error('不一致または重複IDがあるためfail closedしました。バックアップを確認してください');
  if(!apply)return;
  console.log(JSON.stringify({applied:true,...await applyLive(admin,live,plan,{clearSharedFinance,migratedBy})},null,2));
}
module.exports={AMOUNT_KEYS,LEGACY_COLLECTION,decodeJobs,amounts,snapshotForJob,buildPlan,cleanupJobs,sameSnapshot,stripAmounts,restoreSnapshotsFromBackup,restoreJobs,applyLive,applyRestoreLive};
if(require.main===module)main().catch(error=>{console.error(`MIGRATION BLOCKED: ${error.message}`);process.exitCode=1});
