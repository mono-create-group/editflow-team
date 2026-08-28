const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const features=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');
const rules=fs.readFileSync(path.resolve(__dirname,'..','firestore.rules'),'utf8');

test('editor records a real delivery date separately from the promised delivery deadline',()=>{
  assert.match(features,/completedDeliveryDate/);
  assert.match(features,/実納品日 \*/);
  assert.match(features,/納品の証跡URL \*/);
  assert.match(features,/editor_delivery_completed/);
  assert.match(features,/先方確認が完了するまで納品完了にはできません/);
});

test('editor card shows both draft dates, deadline, and the actual delivery date',()=>{
  for(const label of ['編集者 初稿','クライアント 初稿','納品期限','実納品日'])assert.match(features,new RegExp(label));
  assert.match(features,/editor-job-dates/);
});

test('rules only allow the editor delivery completion from client review with evidence and no blocker',()=>{
  assert.match(rules,/function validEditorDeliveryCompletion\(\)/);
  for(const marker of [
    "reviewStage(resource.data) == 'client_review'",
    "reviewStage(request.resource.data) == 'delivered'",
    "request.resource.data.status == '完了'",
    "'editor_delivery_completed', 'client_review', 'delivered'",
    "request.resource.data.get('completedDeliveryDate', '') != ''",
  ])assert.match(rules,new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.doesNotMatch(rules,/client_approved_delivered', 'client_review', 'delivered'/);
});
