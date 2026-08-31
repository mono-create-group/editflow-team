const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const manager=fs.readFileSync(path.join(root,'manager-features.js'),'utf8');
const editor=fs.readFileSync(path.join(root,'editor-features.js'),'utf8');
const feedback=fs.readFileSync(path.join(root,'feedback-workflow.js'),'utf8');

test('client and account manual records require a matching scope target',()=>{
  assert.match(manager,/id="mm-client" disabled/);
  assert.match(manager,/function manualScopeChanged\(\)/);
  assert.match(manager,/if\(scope!==\'global\'&&!clientId\)return toast\('対象クライアントを選択してください'/);
  assert.match(manager,/if\(scope===\'account\'&&!accountId\)return toast\('対象アカウントを選択してください'/);
  assert.match(manager,/clientId,accountId,version:/);
  assert.match(manager,/recordType:'editor_manual',kind:'manual'/);
  assert.match(manager,/createdAt:timestamp,createdBy:actor/);
});

test('new board and dispatch jobs merge scoped manuals with case-specific choices',()=>{
  assert.match(manager,/function scopedManualIdsForCase\(client,account,targetUid='',openAll=false\)/);
  assert.match(manager,/parentManualIds=combinedManualIds\(selectedManualIds\(document.getElementById\('mb-parent-manuals'\)\),scopedManualIdsForCase\(client,account,target,openAll\)\)/);
  assert.match(manager,/manualIds=combinedManualIds\(parentManualIds,subcase\.manualIds\)/);
  assert.match(editor,/function scopedManualIdsForDispatch\(client,accountId=''\)/);
  assert.match(editor,/parentManualIds=combinedCaseManualIds\(selectedCaseManualIds\(\$\('#new-parent-manuals'\)\),scopedManualIdsForDispatch\(client,accountId\)\)/);
  assert.match(editor,/manualIds=combinedCaseManualIds\(parentManualIds,subcase\.manualIds\)/);
});

test('feedback uses a short draft and a dedicated review-to-manual workflow',()=>{
  assert.match(editor,/過去フィードバックに記録/);
  assert.match(editor,/function openEditorFeedback\(jid\)/);
  assert.match(editor,/configureFeedback\(\)\?\.openFromJob\?\.\(job\)/);
  assert.match(feedback,/function saveOpenDraft\(\)/);
  assert.match(feedback,/collection\('feedback'\)/);
  assert.match(feedback,/status:'submitted'/);
  assert.match(feedback,/kind:'feedback'/);
  assert.match(feedback,/createdBy:reviewerName/);
  assert.doesNotMatch(editor,/【過去フィードバック記録】/);
});
