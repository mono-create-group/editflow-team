const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const manager=fs.readFileSync(path.join(__dirname,'..','manager-features.js'),'utf8');
const rules=fs.readFileSync(path.join(__dirname,'..','firestore.rules'),'utf8');

test('manager publish form supports an editable list of child cases',()=>{
  assert.match(manager,/function boardSubcaseRowHtml\(/);
  assert.match(manager,/id="mb-subcase-list"/);
  assert.match(manager,/managerAddBoardSubcase\(\)/);
  assert.match(manager,/managerRemoveBoardSubcase\(this\)/);
  assert.match(manager,/class="mb-subcase-title"/);
  assert.match(manager,/class="mb-subcase-draft"/);
  assert.match(manager,/class="mb-subcase-draft-setter"/);
  assert.match(manager,/案件追加者が設定/);
  assert.match(manager,/担当編集者が設定/);
  assert.match(manager,/managerBoardDraftSetterChanged\(this\)/);
  assert.match(manager,/class="mb-subcase-client-draft"/);
  assert.match(manager,/class="mb-subcase-instructions"/);
  assert.match(manager,/mb-subcase-attachments-/);
  assert.match(manager,/納品日は担当編集者が記録します/);
  for(const field of ['mb-subcase-unit','mb-subcase-pay','mb-subcase-invoice','mb-subcase-due','mb-subcase-payment','mb-subcase-payout'])assert.doesNotMatch(manager,new RegExp(field));
  assert.match(manager,/クライアント単価はクライアント一覧のオーナー専用マスターで管理します/);
  assert.match(manager,/id="mb-client-pricing-status"/);
});

test('manager validates every child case and preserves child-specific materials',()=>{
  assert.match(manager,/function readBoardSubcases\(\)/);
  assert.match(manager,/すべての子案件に、案件名・納期（予定）・編集指示を入力してください/);
  assert.match(manager,/クライアント初稿は編集者初稿以降/);
  assert.match(manager,/案件追加者が設定する場合は、編集者初稿日を入力してください/);
  assert.match(manager,/editorDraftDateSetter=row\.querySelector\('\.mb-subcase-draft-setter'\)/);
  assert.match(manager,/editorDraftDateSetter,editorDraftDate/);
  assert.match(manager,/row\.querySelector\('\.video-attachment-list'\)/);
  assert.match(manager,/attachments:attachmentRead\.items/);
  assert.doesNotMatch(manager,/paymentDate:_isOwner\(\)/);
  assert.doesNotMatch(manager,/payoutDate:_isOwner\(\)/);
  assert.match(manager,/subcases\.items\.length>1&&!caseName/);
});

test('published board jobs share one stable parent identifier while keeping each child distinct',()=>{
  assert.match(manager,/const parentCaseId=safeId\(\),parentCaseName=caseName\|\|subcases\.items\[0\]\.title/);
  assert.match(manager,/subcases\.items\.forEach\(subcase=>/);
  assert.match(manager,/doc\(subcase\.id\)/);
  assert.match(manager,/parentCaseId,parentCaseName/);
  assert.match(manager,/title:subcase\.title/);
  assert.match(manager,/editorDraftDateSetter:subcase\.editorDraftDateSetter,editorDraftDate:subcase\.editorDraftDate,clientDraftDate:subcase\.clientDraftDate/);
  assert.doesNotMatch(manager,/const data=\{[^}]*unitPrice:subcase\.unitPrice/);
  assert.match(rules,/'parentCaseId','parentCaseName'/);
});

test('board publish keeps finance out of legacy/shared parent and child records',()=>{
  assert.match(manager,/if\(_isOwner\(\)\)\{/);
  assert.match(manager,/S\.jobs\.unshift\(\{id:parentCaseId/);
  assert.match(manager,/subtasks=subcases\.items\.map\(item=>\(\{/);
  assert.match(manager,/editorDraftDateSetter:item\.editorDraftDateSetter/);
  assert.match(manager,/editorDraftDateSetter:parentDraftSetter/);
  assert.match(manager,/unitPrice:0,workerPay:0,profit:0/);
  assert.doesNotMatch(manager,/unitPrice:item\.unitPrice/);
  assert.doesNotMatch(manager,/workerPay:item\.workerPay/);
  assert.doesNotMatch(manager,/invoiceDate:item\.invoiceDate/);
  assert.doesNotMatch(manager,/payoutDate:item\.payoutDate/);
  assert.match(manager,/owner_job_finance is created only when the/);
});

test('single-job publishing remains supported through the default child row',()=>{
  assert.match(manager,/\$\{boardSubcaseRowHtml\(\)\}/);
  assert.match(manager,/if\(subcases\.items\.length>1&&!caseName\)/);
});
