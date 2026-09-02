const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

test('review-cycle schema is optional for legacy jobs and bounded for new jobs', () => {
  for (const value of [
    "'workflow' in data", "'progressEvents' in data", "data.workflow.round is int",
    "data.workflow.round >= 0", "data.progressEvents.size() <= 200",
  ]) assert.match(rules, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  for (const stage of ['editing', 'director_review', 'client_submission', 'client_review', 'delivered']) {
    assert.match(rules, new RegExp(`'${stage}'`));
  }
  for (const field of ['workflow', 'progressEvents', 'parentJobId', 'parentJobTitle']) {
    assert.match(rules, new RegExp(`'${field}'`));
  }
});

test('review workflow keeps editor submissions and manager decisions separate', () => {
  const editorBody = rules.match(/function validEditorReviewTransition\(uid, jobId\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const managerBody = rules.match(/function validManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const currentBody = rules.match(/function validCurrentManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const legacyBody = rules.match(/function validLegacyManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const allManagerBodies = `${managerBody}\n${currentBody}\n${legacyBody}`;
  assert.match(editorBody, /'editing'/);
  assert.match(editorBody, /'director_review'/);
  assert.match(allManagerBodies, /'director_review'/);
  assert.match(allManagerBodies, /'client_submission'/);
  assert.match(allManagerBodies, /'client_review'/);
  assert.match(allManagerBodies, /client_approved_completed/);
  assert.match(allManagerBodies, /request\.resource\.data\.status == '完了'/);
  assert.match(allManagerBodies, /request\.resource\.data\.get\('completedDeliveryDate', ''\) != ''/);
  const editorAllow = rules.match(/function validEditorSubmissionPortalUpdate\(uid, jobId\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.doesNotMatch(editorAllow, /validEditorDeliveryCompletion\(\)/);
  assert.match(allManagerBodies, /reviewRound\(request\.resource\.data\) == reviewRound\(resource\.data\) \+ 1/);
});

test('workflow changes append one matching, role-owned event without dropping prior events', () => {
  for (const marker of [
    'function reviewEventsUnchanged()', 'function appendsOneReviewEvent()',
    'after.size() == before.size() + 1', 'after.hasAll(before)',
    'function lastReviewEventMatches(type, fromStage, toStage, round, status, role)',
    "event.get('byUid', '') == request.auth.uid", "'editor_submitted'",
    "'director_revision_requested'", "'director_approved'", "'client_submitted'",
    "'client_revision_requested'", "'client_approved_completed'",
    "return owner() ? 'owner' : 'director'",
  ]) assert.ok(rules.includes(marker), `missing ${marker}`);
  assert.match(rules, /&& reviewEventsUnchanged\(\)/);
  assert.match(rules, /&& validEditorSubmittedEvent\(/);
  assert.match(rules, /&& validManagerProgressEvent\(/);
});

test('editor draft submissions bind the stored evidence URL to the appended workflow event', () => {
  const body = rules.match(/function validEditorSubmittedEvent\(fromStage, round, status\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(body, /request\.resource\.data\.evidenceUrl is string/);
  assert.ok(body.includes("request.resource.data.evidenceUrl.matches('^https?://.+')"));
  assert.match(body, /event\.get\('evidenceUrl', ''\) is string/);
  assert.ok(body.includes("event.get('evidenceUrl', '').matches('^https?://.+')"));
  assert.match(body, /event\.get\('evidenceUrl', ''\) == request\.resource\.data\.evidenceUrl/);
});

test('workflow-aware editor saves cannot change director or client-owned statuses', () => {
  const body = rules.match(/function validEditorWorkflowStatus\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(body, /reviewStage\(resource\.data\) == 'editing'/);
  assert.match(body, /reviewStage\(request\.resource\.data\) == 'director_review'/);
  assert.match(body, /validEditorSubmissionStatus\([\s\S]*resource\.data\.status, request\.resource\.data\.status/);
  assert.match(body, /request\.resource\.data\.status == resource\.data\.status/);
  assert.match(rules, /&& validEditorWorkflowStatus\(\)/);
});

test('manager same-stage updates keep both status and review event history intact', () => {
  const body = rules.match(/function validCurrentManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const sameStage = body.match(/\|\| \(reviewStage\(request\.resource\.data\)[\s\S]*?reviewEventsUnchanged\(\)\)/)?.[0] || '';
  assert.match(sameStage, /reviewStage\(request\.resource\.data\) == reviewStage\(resource\.data\)/);
  assert.match(sameStage, /reviewRound\(request\.resource\.data\) == reviewRound\(resource\.data\)/);
  assert.match(sameStage, /request\.resource\.data\.status == resource\.data\.status/);
  assert.match(sameStage, /reviewEventsUnchanged\(\)/);
});

test('legacy manager metadata saves cannot jump directly into workflow-owned states', () => {
  const body = rules.match(/function validLegacyManagerNonWorkflowUpdate\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(body, /!hasReviewWorkflow\(resource\.data\)/);
  assert.match(body, /!hasReviewWorkflow\(request\.resource\.data\)/);
  assert.match(body, /reviewEventsUnchanged\(\)/);
  assert.match(body, /request\.resource\.data\.status == resource\.data\.status/);
  assert.match(body, /!workflowControlledStatus\(request\.resource\.data\.status\)/);
  const controlled = rules.match(/function workflowControlledStatus\(status\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  for (const status of ['編集者進行中', '初稿提出済み', '修正中', '修正稿提出済み', 'D確認OK', '先方確認中', '完了']) {
    assert.match(controlled, new RegExp(`'${status}'`));
  }
});

test('legacy portal review statuses can migrate only through the matching manager workflow action', () => {
  const body = rules.match(/function validLegacyManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  for (const marker of [
    "resource.data.status == 'D確認OK'",
    "reviewStage(request.resource.data) == 'client_review'",
    "'client_submitted', 'client_submission', 'client_review'",
    "resource.data.status in ['先方確認中', '確認待ち']",
    "'client_revision_requested', 'client_review', 'editing'",
    "'client_approved_completed', 'client_review', 'delivered'",
    "request.resource.data.get('completedDeliveryDate', '') != ''",
  ]) assert.ok(body.includes(marker), `missing ${marker}`);
  assert.ok((body.match(/reviewRound\(request\.resource\.data\) == 2/g) || []).length >= 2);
  assert.ok((body.match(/reviewRound\(request\.resource\.data\) == 1/g) || []).length >= 2);
});

test('legacy FB待ち records can enter the review workflow only through a D decision event', () => {
  const body = rules.match(/function validLegacyManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const currentBody = rules.match(/function validCurrentManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.ok(body.includes("resource.data.status in ['初稿提出済み', '修正稿提出済み', 'FB待ち']"));
  assert.equal((body.match(/'director_approved', 'director_review', 'client_submission'/g) || []).length, 1);
  assert.equal((body.match(/'director_revision_requested', 'director_review', 'editing'/g) || []).length, 1);
  assert.match(currentBody, /'director_approved', 'director_review', 'client_submission'/);
  assert.match(currentBody, /'director_revision_requested', 'director_review', 'editing'/);
  assert.match(body, /validManagerProgressEvent\(/);
});

test('director and client revision events require a bounded non-empty correction reason', () => {
  const body = rules.match(/function validManagerProgressEvent\([^]*?\n    \}/)?.[0] || '';
  const transitionBodies = [
    rules.match(/function validCurrentManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '',
    rules.match(/function validLegacyManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '',
  ].join('\n');
  assert.match(transitionBodies, /request\.resource\.data\.status == '修正中'/);
  assert.match(transitionBodies, /reviewStage\(request\.resource\.data\) == 'editing'/);
  assert.match(transitionBodies, /reviewRound\(request\.resource\.data\)/);
  assert.match(body, /type in \['director_revision_requested', 'client_revision_requested'\]/);
  assert.match(body, /event\.get\('reason', ''\) is string/);
  assert.match(body, /event\.get\('reason', ''\)\.size\(\) > 0/);
  assert.match(body, /event\.get\('reason', ''\)\.size\(\) <= 2000/);
});

test('manager workflow evaluation separates current and legacy paths to stay within the rules expression budget', () => {
  const managerBody = rules.match(/function validManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const currentBody = rules.match(/function validCurrentManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const legacyBody = rules.match(/function validLegacyManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(managerBody, /validCurrentManagerReviewTransition\(\)/);
  assert.match(managerBody, /validLegacyManagerReviewTransition\(\)/);
  assert.match(currentBody, /hasReviewWorkflow\(resource\.data\)/);
  assert.match(legacyBody, /!hasReviewWorkflow\(resource\.data\)/);
  assert.match(rules, /function validManagerJobShapeUpdate\(data\)/);
  assert.match(rules, /changed\.hasAny\(\[\s*'sharedDate','editorDraftDate'/);
  assert.match(rules, /function scopedVideoDirectorFor\(uid\)/);
  assert.match(rules, /get\(accessPath\(request\.auth\.uid\)\)\.data\.roles\.hasAny\(\['動画編集ディレクター'\]\)/);
  assert.match(rules, /get\(accessPath\(uid\)\)\.data\.get\('directorUid', ''\) == request\.auth\.uid/);
  const directorAllow = rules.match(/function validDirectorPortalUpdate\(uid\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const ownerAllow = rules.match(/function validOwnerPortalUpdate\(uid, jobId\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.equal((directorAllow.match(/validManagerReviewTransition\(\)/g) || []).length, 1);
  assert.equal((ownerAllow.match(/validManagerReviewTransition\(\)/g) || []).length, 1);
});

test('completed or payment-approved jobs cannot be silently reopened', () => {
  const body = rules.match(/function preservesFinalJob\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(body, /resource\.data\.status == '完了'/);
  assert.match(body, /resource\.data\.get\('payableApproved', false\) == true/);
  assert.match(body, /request\.resource\.data\.status == '完了'/);
});
