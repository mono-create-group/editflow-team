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
  const editorBody = rules.match(/function validEditorReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const managerBody = rules.match(/function validManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(editorBody, /'editing'/);
  assert.match(editorBody, /'director_review'/);
  assert.match(managerBody, /'director_review'/);
  assert.match(managerBody, /'client_submission'/);
  assert.match(managerBody, /'client_review'/);
  assert.match(managerBody, /'delivered'/);
  assert.match(managerBody, /reviewRound\(request\.resource\.data\) == reviewRound\(resource\.data\) \+ 1/);
});

test('workflow changes append one matching, role-owned event without dropping prior events', () => {
  for (const marker of [
    'function reviewEventsUnchanged()', 'function appendsOneReviewEvent()',
    'after.size() == before.size() + 1', 'after.hasAll(before)',
    'function lastReviewEventMatches(type, fromStage, toStage, round, status, role)',
    "event.get('byUid', '') == request.auth.uid", "'editor_submitted'",
    "'director_approved'", "'client_submitted'", "'client_revision_requested'",
    "'client_approved_delivered'", "return owner() ? 'owner' : 'director'",
  ]) assert.ok(rules.includes(marker), `missing ${marker}`);
  assert.match(rules, /&& reviewEventsUnchanged\(\)/);
  assert.match(rules, /&& validEditorSubmittedEvent\(/);
  assert.match(rules, /&& validManagerProgressEvent\(/);
});

test('workflow-aware editor saves cannot change director or client-owned statuses', () => {
  const body = rules.match(/function validEditorWorkflowStatus\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(body, /reviewStage\(resource\.data\) == 'editing'/);
  assert.match(body, /reviewStage\(request\.resource\.data\) == 'director_review'/);
  assert.match(body, /request\.resource\.data\.status in \['初稿提出済み', '修正稿提出済み'\]/);
  assert.match(body, /request\.resource\.data\.status == resource\.data\.status/);
  assert.match(rules, /&& validEditorWorkflowStatus\(\)/);
});

test('manager same-stage updates keep both status and review event history intact', () => {
  const body = rules.match(/function validManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  const sameStage = body.match(/\|\| \(hasReviewWorkflow\(resource\.data\)[\s\S]*?reviewEventsUnchanged\(\)\)/)?.[0] || '';
  assert.match(sameStage, /reviewStage\(request\.resource\.data\) == reviewStage\(resource\.data\)/);
  assert.match(sameStage, /reviewRound\(request\.resource\.data\) == reviewRound\(resource\.data\)/);
  assert.match(sameStage, /request\.resource\.data\.status == resource\.data\.status/);
  assert.match(sameStage, /reviewEventsUnchanged\(\)/);
});

test('client revision events require a bounded non-empty correction reason', () => {
  const body = rules.match(/function validManagerProgressEvent\([^]*?\n    \}/)?.[0] || '';
  assert.match(body, /type != 'client_revision_requested'/);
  assert.match(body, /event\.get\('reason', ''\) is string/);
  assert.match(body, /event\.get\('reason', ''\)\.size\(\) > 0/);
  assert.match(body, /event\.get\('reason', ''\)\.size\(\) <= 2000/);
});

test('completed or payment-approved jobs cannot be silently reopened', () => {
  const body = rules.match(/function preservesFinalJob\(\) \{([\s\S]*?)\n    \}/)?.[1] || '';
  assert.match(body, /resource\.data\.status == '完了'/);
  assert.match(body, /resource\.data\.get\('payableApproved', false\) == true/);
  assert.match(body, /request\.resource\.data\.status == '完了'/);
});
