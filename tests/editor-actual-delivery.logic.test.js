const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const features=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');
const editor=fs.readFileSync(path.resolve(__dirname,'..','editor.html'),'utf8');
const rules=fs.readFileSync(path.resolve(__dirname,'..','firestore.rules'),'utf8');

test('editor keeps recorded delivery dates visible but cannot complete a job',()=>{
  assert.match(features,/completedDeliveryDate/);
  assert.doesNotMatch(features,/function editorDeliveryCompletionHtml\(/);
  assert.doesNotMatch(features,/function completeEditorDelivery\(/);
  assert.doesNotMatch(features,/window\.completeEditorDelivery=/);
});

test('editor card shows both draft dates, planned due date, and the delivery date',()=>{
  for(const label of ['編集者 初稿','クライアント 初稿','納期（予定）','納品日'])assert.match(features,new RegExp(label));
  assert.match(features,/editor-job-dates/);
});

test('work guide assigns final review and completion to the director or owner',()=>{
  assert.match(editor,/修正中・D確認OK・先方確認中・完了はディレクターまたはオーナーが更新します/);
  assert.doesNotMatch(editor,/担当編集者が実際の納品日と納品先URLを入力し、納品完了にします/);
  assert.match(editor,/子案件ごとに案件名・編集者支払額・指示を必ず入力します/);
});

test('editor UI does not expose any completion mutation entry point',()=>{
  assert.doesNotMatch(features,/editor_delivery_completed/);
  assert.doesNotMatch(features,/納品を完了した/);
});
