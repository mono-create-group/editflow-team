const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const rules=fs.readFileSync(path.resolve(__dirname,'..','firestore.rules'),'utf8');

test('effective dated client rates are owner-only and cannot rewrite their scope',()=>{
  assert.match(rules,/function validOwnerClientRateDocument\(\)/);
  assert.match(rules,/recordType == 'owner_client_rate'/);
  assert.match(rules,/effectiveFrom\.matches\('\^\[0-9\]\{4\}-\[0-9\]\{2\}-\[0-9\]\{2\}\$'\)/);
  assert.match(rules,/function validOwnerClientRateUpdate\(\)/);
  assert.match(rules,/effectiveFrom == resource\.data\.effectiveFrom/);
  assert.match(rules,/match \/owner_client_rates\/\{rateId\}[\s\S]*?allow delete: if false/);
});

test('finance requires a schedule id/date or an explicit override reason',()=>{
  assert.match(rules,/pricingRateId','pricingEffectiveFrom/);
  assert.match(rules,/\['master','account_master','client_schedule','account_schedule','case_override'\]/);
  assert.match(rules,/pricingSource in \['client_schedule','account_schedule'\]/);
  assert.match(rules,/pricingEffectiveFrom/);
  assert.match(rules,/pricingSource != 'case_override'[\s\S]*overrideReason\.size\(\) > 0/);
});

test('owner performance records are owner-only and daily check includes immutable today totals',()=>{
  for(const name of ['owner_delivery_goals','owner_daily_delivery_checks','owner_editor_quality_reviews']) assert.match(rules,new RegExp(`match \\/${name}\\/`));
  assert.match(rules,/todayCount','todayAmount/);
  assert.match(rules,/summary\.todayCount is int/);
  assert.match(rules,/summary\.todayAmount is int/);
  assert.match(rules,/match \/owner_daily_delivery_checks\/\{date\}[\s\S]*?allow update, delete: if false/);
  assert.match(rules,/qualityEvaluationCount/);
});

test('dispatch completion cannot use the manager completion route',()=>{
  assert.match(rules,/function managerMayCompleteJob\(\)/);
  assert.match(rules,/businessType', ''\) != 'dispatch'/);
  const manager=[
    rules.match(/function validCurrentManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1]||'',
    rules.match(/function validLegacyManagerReviewTransition\(\) \{([\s\S]*?)\n    \}/)?.[1]||'',
  ].join('\n');
  assert.equal((manager.match(/managerMayCompleteJob\(\)/g)||[]).length,2);
  assert.match(manager,/resource\.data\.status in \['先方確認中', '確認待ち'\][\s\S]*?managerMayCompleteJob\(\)[\s\S]*?reviewStage\(request\.resource\.data\) == 'delivered'[\s\S]*?client_approved_completed/);
  assert.match(manager,/reviewStage\(resource\.data\) == 'client_review'[\s\S]*?managerMayCompleteJob\(\)[\s\S]*?reviewStage\(request\.resource\.data\) == 'delivered'[\s\S]*?client_approved_completed/);
  const revisionBranches=manager.match(/reviewStage\(request\.resource\.data\) == 'editing'[\s\S]{0,320}?client_revision_requested/g)||[];
  assert.equal(revisionBranches.length,2);
  for(const branch of revisionBranches)assert.doesNotMatch(branch,/managerMayCompleteJob/);
});

test('feedback review and feedback-derived manuals are transaction-bound',()=>{
  assert.match(rules,/match \/feedback\/\{feedbackId\}/);
  assert.match(rules,/function validFeedbackReview\(uid\)/);
  assert.match(rules,/resource\.data\.status == 'submitted'/);
  assert.match(rules,/request\.resource\.data\.status in \['approved','rejected'\]/);
  assert.match(rules,/function validFeedbackManualCreate\(manualId\)/);
  assert.match(rules,/existsAfter\(feedbackPath\)/);
  assert.match(rules,/getAfter\(feedbackPath\)\.data\.manualId == manualId/);
  assert.match(rules,/allowedUids == \[getAfter\(feedbackPath\)\.data\.editorUid\]/);
  assert.match(rules,/request\.resource\.data\.createdBy is string/);
});
