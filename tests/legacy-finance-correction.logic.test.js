const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');

const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');

function effective(base,row){
  if(!row||row.originalWorkerPay!==base||row.originalTitleHash!=='a'.repeat(64)||row.correctedWorkerPay!==row.originalWorkerPay+row.deltaWorkerPay)return{amount:base,warning:true};
  return{amount:row.correctedWorkerPay,warning:false};
}

test('legacy correction applies the approved 3500 minus 500 delta without rewriting the source amount',()=>{
  const result=effective(3500,{originalWorkerPay:3500,deltaWorkerPay:-500,correctedWorkerPay:3000,originalTitleHash:'a'.repeat(64)});
  assert.deepEqual(result,{amount:3000,warning:false});
  assert.match(source,/const correction=_legacyCorrectionForLine/);
  assert.match(source,/effectivePay=correction\?Number\(correction\.correctedWorkerPay\):workerPay/);
});

test('mismatched legacy correction is rejected and financial pages fail closed',()=>{
  const result=effective(3500,{originalWorkerPay:3000,deltaWorkerPay:-500,correctedWorkerPay:2500,originalTitleHash:'a'.repeat(64)});
  assert.deepEqual(result,{amount:3500,warning:true});
  assert.match(source,/金額訂正を無効化しました（原本不一致）/);
  assert.match(source,/OWNER_LEGACY_FINANCE_CORRECTIONS_READY/);
  assert.match(source,/function _ownerFinanceLedgersReady/);
  assert.match(source,/集計と支払い操作を停止しています/);
  assert.match(source,/revision連鎖不一致/);
});

test('empty-id legacy rows recheck the live title with the migration hash before correction',async()=>{
  const digest=await crypto.webcrypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify('台本61')));
  assert.equal(Buffer.from(digest).toString('hex'),'5bf6d5af46fec9602ebce5631e89e2eac14891b99aa1003ef9049d808860b656');
  assert.match(source,/liveTitleHash=liveSub\?await _legacyCorrectionTitleHash\(liveSub\.title\|\|''\):''/);
  assert.match(source,/liveTitleHash===String\(originalTitleHash\)/);
});

test('corrections are owner-only append-only records with evidence and no mutation route',()=>{
  assert.match(source,/collection\('owner_legacy_finance_corrections'\)\.onSnapshot/);
  assert.match(source,/runTransaction/);
  assert.match(source,/owner_legacy_finance_corrections'\)\.doc\(id\)/);
  assert.match(source,/collection\('owner_legacy_finance'\)\.doc\(String\(legacyFinanceId\)\)/);
  assert.match(source,/collection\('shared'\)\.doc\('mcapp'\)/);
  assert.match(source,/!liveSub\.workerPaidAt/);
  assert.match(source,/async function _legacyCorrectionTitleHash/);
  assert.match(source,/liveTitleHash===String\(originalTitleHash\)/);
  assert.match(source,/if\(!sourceMatches\|\|!unpaidMatches\)throw new Error\('source_changed'\)/);
  assert.match(rules,/match \/owner_legacy_finance_corrections\/\{correctionId\}/);
  assert.match(rules,/allow create: if owner\(\) && validOwnerLegacyFinanceCorrectionDocument\(correctionId\)/);
  assert.match(rules,/allow update, delete: if false/);
  assert.match(rules,/originalTitleHash/);
  assert.match(rules,/evidenceRef/);
  assert.match(rules,/supersedesCorrectionId/);
  assert.match(rules,/request\.resource\.data\.approvedBy == request\.auth\.token\.email/);
  assert.match(rules,/lines\[index\]\.get\('workerPay', -1\) == request\.resource\.data\.originalWorkerPay/);
});
