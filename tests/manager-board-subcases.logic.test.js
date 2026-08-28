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
  assert.match(manager,/class="mb-subcase-client-draft"/);
  assert.match(manager,/class="mb-subcase-delivery"/);
  assert.match(manager,/class="mb-subcase-instructions"/);
  assert.match(manager,/mb-subcase-attachments-/);
});

test('manager validates every child case and preserves child-specific materials',()=>{
  assert.match(manager,/function readBoardSubcases\(\)/);
  assert.match(manager,/すべての子案件に、案件名・納品期限・編集指示を入力してください/);
  assert.match(manager,/クライアント初稿は編集者初稿以降/);
  assert.match(manager,/row\.querySelector\('\.video-attachment-list'\)/);
  assert.match(manager,/attachments:attachmentRead\.items/);
  assert.match(manager,/subcases\.items\.length>1&&!caseName/);
});

test('published board jobs share one stable parent identifier while keeping each child distinct',()=>{
  assert.match(manager,/const parentCaseId=safeId\(\),parentCaseName=caseName\|\|subcases\.items\[0\]\.title/);
  assert.match(manager,/subcases\.items\.forEach\(subcase=>/);
  assert.match(manager,/doc\(subcase\.id\)/);
  assert.match(manager,/parentCaseId,parentCaseName/);
  assert.match(manager,/title:subcase\.title/);
  assert.match(manager,/editorDraftDate:subcase\.editorDraftDate,clientDraftDate:subcase\.clientDraftDate/);
  assert.match(rules,/'parentCaseId','parentCaseName'/);
});

test('single-job publishing remains supported through the default child row',()=>{
  assert.match(manager,/\$\{boardSubcaseRowHtml\(\)\}/);
  assert.match(manager,/if\(subcases\.items\.length>1&&!caseName\)/);
});
