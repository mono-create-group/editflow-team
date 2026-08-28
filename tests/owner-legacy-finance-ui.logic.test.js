const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

test('owner subscribes to the private legacy finance ledger and overlays parent and child amounts',()=>{
  assert.match(source,/collection\('owner_legacy_finance'\)\.onSnapshot/);
  assert.match(source,/finance\.recordType==='owner_legacy_finance'/);
  assert.match(source,/parentAmounts/);
  assert.match(source,/subtaskAmounts/);
  assert.match(source,/return\{\.\.\.job,unitPrice,workerPay,profit:/);
});

test('migrated cases never write owner-only amounts back into shared jobs',()=>{
  assert.match(source,/financeProtected=!!\(currentFinance\|\|current\?\.ownerFinanceId\)/);
  assert.match(source,/current\?\.ownerFinanceId&&!currentFinance\)\{toast\('金額台帳を確認できないため保存を中止しました/);
  assert.match(source,/const sharedData=financeProtected/);
  assert.match(source,/\.\.\._stripLegacyAmounts\(data\),ownerFinanceId:String\(currentFinance\?\.id\|\|current\?\.ownerFinanceId\|\|current\?\.id\|\|''\)/);
  assert.match(source,/subtasks:\(data\.subtasks\|\|\[\]\)\.map\(_stripLegacyAmounts\)/);
  assert.match(source,/Object\.assign\(j,sharedData\)/);
});

test('a verified migration can replace stale shared finance without weakening ordinary data-loss protection',()=>{
  assert.match(source,/const verifiedFinanceMigration=incoming\.ownerFinanceId&&String\(incoming\.ownerFinanceId\)===String\(incoming\.id\|\|''\)/);
  assert.ok(source.indexOf("incoming.status==='案件掲載中'")<source.indexOf('const verifiedFinanceMigration='));
  assert.match(source,/\(cur\.unitPrice\|\|0\)>0&&!\(\(incoming\.unitPrice\|\|0\)>0\)/);
  assert.match(source,/ledgerRestoreToken/);
  assert.match(source,/legacyFinanceRestoreAck:_teamLedgerRestoreAck/);
  assert.match(source,/const financeWriteNonce=`\$\{_teamLedgerRestoreAck\}:\$\{financeWriteId\}`/);
  assert.match(source,/const ledgerRestoreFullyApplied=!replaceLedgers\|\|replacedLedgerCount===TEAM_LEDGER_KEYS\.length/);
  assert.match(source,/const ledgerRestoreReady=ledgerRestoreFullyApplied&&ledgerLocalStateSafe/);
  assert.match(source,/_teamLedgerRestoreAck=ledgerRestoreReady&&ledgerLocalStateSafe\?restoreToken:''/);
  const persist=source.indexOf('ledgerLocalStateSafe=_lsSaveState(S)');
  const remember=source.indexOf('localStorage.setItem(TEAM_LEDGER_RESTORE_KEY,restoreToken)',persist);
  assert.ok(persist>=0&&remember>persist,'sanitized state must persist before the restore token is remembered');
});

test('migrated finance is immutable in the legacy modal while operational fields stay available',()=>{
  assert.match(source,/const ownerFinanceLocked=!!\(j\?\._ownerFinance\|\|rawJob\?\.ownerFinanceId\)/);
  assert.match(source,/ownerFinanceLocked\?' \(\u30aa\u30fc\u30ca\u30fc\u5c02\u7528\u53f0\u5e33\u3078\u79fb\u884c\u6e08\u307f\)'/);
  assert.match(source,/data-finance-locked=/);
  assert.match(source,/financeLocked\?'readonly'/);
});

test('all legacy profit and payment totals restore owner-only amounts before calculation',()=>{
  assert.match(source,/function jobTotalIn\(j\)\{\s*j=_withOwnerJobFinance\(j\);/);
  assert.match(source,/function jobTotalOut\(j\)\{\s*j=_withOwnerJobFinance\(j\);/);
});
