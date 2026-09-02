const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');

test('owner case save persists protected parent and subcase prices to private finance snapshots',()=>{
  assert.match(index,/async function _saveOwnerFinanceSnapshot\(finance,currentJob,nextJob\)/);
  assert.match(index,/collection\('owner_legacy_finance'\).*\.update\(update\)/s);
  assert.match(index,/currentClientUnitPrice,currentApprovedPayAmount,revision/);
  assert.match(index,/async function saveJob\(\)/);
  assert.match(index,/await _saveOwnerFinanceSnapshot\(currentFinance,current,data\)/);
  assert.match(index,/subtasks:\(data\.subtasks\|\|\[\]\)\.map\(_stripLegacyAmounts\)/);
});

test('private finance rules allow owner revisions but preserve original financial sources',()=>{
  assert.match(rules,/function validOwnerJobFinanceUpdate\(\)/);
  assert.match(rules,/function validOwnerLegacyFinanceUpdate\(financeId\)/);
  assert.match(rules,/request\.resource\.data\.parentAmounts == resource\.data\.parentAmounts/);
  assert.match(rules,/request\.resource\.data\.subtaskAmounts == resource\.data\.subtaskAmounts/);
  assert.match(rules,/allow update: if owner\(\) && validOwnerJobFinanceUpdate\(\)/);
  assert.match(rules,/allow update: if owner\(\) && validOwnerLegacyFinanceUpdate\(financeId\)/);
});

test('dispatch payable mirror follows the owner current payment amount',()=>{
  assert.match(rules,/finance\.get\('currentApprovedPayAmount', finance\.approvedPayAmount\)/);
});
