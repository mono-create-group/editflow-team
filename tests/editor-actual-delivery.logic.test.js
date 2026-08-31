const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const features=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');
const editor=fs.readFileSync(path.resolve(__dirname,'..','editor.html'),'utf8');
const rules=fs.readFileSync(path.resolve(__dirname,'..','firestore.rules'),'utf8');

test('dispatch editor can complete only after canonical client review',()=>{
  assert.match(features,/completedDeliveryDate/);
  assert.match(features,/function editorCanCompleteDelivery\(job\)/);
  assert.match(features,/businessType==='dispatch'\|\|job\?\.source==='direct_client'/);
  assert.match(features,/stage==='client_review'/);
  assert.match(features,/\['先方確認中','確認待ち'\]/);
  assert.match(features,/function editorDeliveryCompletionHtml\(/);
  assert.match(editor,/async function completeEditorDelivery\(jid\)/);
  assert.match(editor,/deliveryCompletionSavingIds/);
  assert.match(editor,/type:'editor_delivery_completed'/);
});

test('editor card shows both draft dates, planned due date, and the delivery date',()=>{
  for(const label of ['編集者 初稿','クライアント 初稿','納期（予定）','納品日'])assert.match(features,new RegExp(label));
  assert.match(features,/editor-job-dates/);
});

test('work guide keeps edit-agency review ownership with the director or owner',()=>{
  assert.match(editor,/編集代行案件の完了はディレクターまたはオーナー/);
  assert.match(editor,/編集者派遣案件の完了は担当編集者が実納品日と納品URL/);
  assert.match(editor,/子案件ごとに案件名・編集者支払額・指示を入力してください/);
  assert.match(features,/job\?\.businessType==='dispatch'\|\|job\?\.source==='direct_client'/);
});

test('rules require the dispatch-only client-review completion transition and exact event',()=>{
  assert.match(rules,/function validEditorDeliveryCompletion\(uid, jobId\)/);
  assert.match(rules,/businessType', ''\) == 'dispatch'/);
  assert.match(rules,/resource\.data\.status in \['先方確認中', '確認待ち'\]/);
  assert.match(rules,/lastReviewEventMatches\('editor_delivery_completed', 'client_review', 'delivered'/);
  assert.match(rules,/completedDeliveryDate\.matches\('\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$'\)/);
  assert.match(rules,/getAfter\([^\n]+\)\.data\.get\('blocker', ''\) == ''/);
  assert.match(rules,/events\/delivery-completion/);
  assert.match(rules,/eventId == 'delivery-completion'/);
  assert.match(rules,/getAfter\(deliveryEventPath\)\.data\.fromStage == 'client_review'/);
  assert.doesNotMatch(editor,/doc\('delivery-completion'\)[^\n]*deliveryDate:/);
  assert.match(rules,/validEditorReviewTransition\(uid, jobId\)/);
});
