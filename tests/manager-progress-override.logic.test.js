const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

test('case modal offers every official workflow status without unlocking the raw status field', () => {
  const control = index.slice(index.indexOf('function _videoManualProgressControl'), index.indexOf('\nfunction _videoWorkflowHtml'));
  const modal = index.slice(index.indexOf('function openPortalJobModal'), index.indexOf('\nasync function savePortalJobAdmin'));
  assert.match(control, /VIDEO_WORKFLOW_STATUSES\.map\(status=>/);
  assert.match(control, /任意の進捗に変更/);
  assert.match(control, /変更理由（必須）/);
  assert.match(control, /setPortalWorkflowStatus/);
  assert.match(control, /status==='完了'&&editorCompletion\?'disabled':''/);
  assert.match(modal, /<input id="vp-status"[^>]*readonly aria-readonly="true">/);
});

test('manual progress save keeps role, final-state, completion, and audit safeguards', () => {
  const body = index.slice(index.indexOf('async function setPortalWorkflowStatus'), index.indexOf('\nfunction _editorMilestoneSummary'));
  for (const marker of [
    "_canManagePortalWorkflow(j)",
    "String(j.status||'')==='完了'||j.payableApproved===true",
    'VIDEO_WORKFLOW_STATUSES.includes(status)',
    "if(!reason)return toast('変更理由を入力してください'",
    "if(needsEvidence&&!evidenceUrl)return toast('提出・納品リンクを http:// または https:// から入力してください'",
    "status==='完了'&&_editorOwnsPortalCompletion(j)",
    "status==='完了'&&!clientApprovalConfirmed",
    '_validPortalCompletionDate(completionDate)',
    "type:'manager_status_changed'",
    "action:'managerStatusOverride'",
    "fromStatus:String(j.status||'')",
    "clientApprovalConfirmed:true",
    "needsEvidence?{evidenceUrl}",
    "correctionReason:status==='修正中'?reason:''",
    'await batch.commit()',
    '_applyPortalToLegacy({...j,...data},false)',
  ]) assert.ok(body.includes(marker), `missing ${marker}`);
  assert.match(index, /manager_status_changed:'管理者が進捗を変更'/);
  assert.match(index, /変更前：\$\{esc\(videoStatusLabel\(event\.fromStatus\)\)\} → 変更後：/);
  assert.match(index, /提出・納品リンク（必須）/);
  assert.match(index, /クライアントOKを確認済み/);
});

test('workflow stage and revision round stay consistent with the chosen status', () => {
  const stage = index.slice(index.indexOf('function _videoWorkflowStageForStatus'), index.indexOf('\nfunction _videoManualProgressRound'));
  assert.match(stage, /\['初稿提出済み','修正稿提出済み'\]\.includes\(status\).*return'director_review'/s);
  assert.match(stage, /status==='D確認OK'.*return'client_submission'/s);
  assert.match(stage, /status==='先方確認中'.*return'client_review'/s);
  assert.match(stage, /status==='完了'.*return'delivered'/s);
  assert.match(index, /status==='初稿提出済み'\)return 1/);
  assert.match(index, /status==='修正稿提出済み'\)return Math\.max\(2,current\.round\)/);
  assert.match(index, /status==='修正中'&&String\(job\?\.status\|\|''\)!=='修正中'\?current\.round\+1:current\.round/);
});

test('Firestore accepts only audited manager overrides and preserves completion ownership', () => {
  const override = rules.match(/function validManagerStatusOverride\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  for (const status of ['アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了']) {
    assert.ok(rules.includes(`'${status}'`), status);
  }
  assert.match(override, /status != resource\.data\.status/);
  assert.match(override, /managerSelectableStatus\(status\)/);
  assert.match(override, /reviewStage\(request\.resource\.data\) == managerWorkflowStageForStatus\(status\)/);
  assert.match(override, /'manager_status_changed'/);
  assert.match(override, /event\.get\('fromStatus', ''\) == resource\.data\.status/);
  assert.match(override, /event\.get\('reason', ''\)\.size\(\) > 0/);
  assert.match(override, /managerOverrideNeedsEvidence\(status\)/);
  assert.match(override, /event\.get\('evidenceUrl', ''\) == request\.resource\.data\.get\('evidenceUrl', ''\)/);
  assert.match(override, /event\.get\('completedDeliveryDate', ''\) == request\.resource\.data\.get\('completedDeliveryDate', ''\)/);
  assert.match(override, /event\.get\('clientApprovalConfirmed', false\) == true/);
  assert.match(override, /managerMayCompleteJob\(\)/);
  assert.match(rules, /return validManagerStatusOverride\(\)\s*\|\| validCurrentManagerReviewTransition\(\)/);
  assert.match(rules, /function preservesFinalJob\(\)/);
});
