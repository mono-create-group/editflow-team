const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const rules = fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8');

function block(start, end) {
  const from = rules.indexOf(start);
  const to = rules.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `missing rules block: ${start}`);
  return rules.slice(from, to);
}

test('director board updates keep publication, ownership, and claim boundaries immutable', () => {
  const update = block('function validDirectorBoardUpdate()', 'function validClaimedBoardProjection');
  assert.match(update, /validDirectorBoardAudience\(resource\.data\)/);
  assert.match(update, /validDirectorBoardAudience\(request\.resource\.data\)/);
  assert.match(update, /affectedKeys\(\)\.hasOnly/);
  const allowedFields = update.slice(update.indexOf('hasOnly(['), update.indexOf(']);', update.indexOf('hasOnly([')));
  assert.doesNotMatch(allowedFields, /'audience'|'eligibleUids'|'directorUid'|'assignedUid'/);
});

test('a job-board claim has one identity-bound, field-matched portal projection', () => {
  const projection = block('function validClaimedBoardProjection(jobId)', 'function validJobStatus');
  assert.match(projection, /request\.resource\.data\.get\('boardJobId', ''\) == jobId/);
  for (const field of ['title', 'parentCaseId', 'clientId', 'sourceClientId', 'accountId', 'directorUid']) {
    assert.match(projection, new RegExp(`request\\.resource\\.data\\.get\\('${field}'`));
  }
  assert.match(projection, /board\.get\('parentCaseId', ''\) != '' \? board\.get\('parentCaseId', ''\) : jobId/);
  assert.match(projection, /board\.get\('sourceClientId', ''\) != '' \? board\.get\('sourceClientId', ''\) : board\.get\('clientId', ''\)/);
  const create = block("match /editor_jobs/{jobId}", 'allow create: if owner()');
  assert.match(create, /request\.resource\.data\.boardJobId == jobId/);
  assert.match(create, /validClaimedBoardProjection\(jobId\)/);
  assert.equal((projection.match(/getAfter\(/g) || []).length, 1, 'claim validation uses one board lookup and stays inside Rules read-call budget');
});

test('claim deliberately leaves operational copy fields mutable at creation to stay below the Rules expression limit', () => {
  const projection = block('function validClaimedBoardProjection(jobId)', 'function validJobStatus');
  // These fields do not determine the claimant, client/account routing, or
  // owner-only finance record. They are still bounded by the normal portal
  // schema and cannot be changed later by an editor, but are not deep-compared
  // during the atomic claim because that path otherwise exceeds 1000 rules
  // expressions in the real Firestore Emulator.
  for (const field of ['instructions', 'requestUrl', 'sourceUrl', 'deliveryDate', 'attachments']) {
    assert.doesNotMatch(projection, new RegExp(`request\\.resource\\.data\\.get\\('${field}'`));
  }
  assert.match(rules, /1000-expression limit/);
});

test('video workspace reads exclude unrelated approved roles and legacy submissions fail closed', () => {
  const videoMember = block('function videoWorkspaceMember()', 'function validDirectorBoardAudience');
  assert.match(videoMember, /'動画編集者','動画編集ディレクター'/);
  const schedules = block('match /editor_schedules/{uid}', 'function validFeedbackDocument');
  assert.match(schedules, /allow read: if videoWorkspaceMember\(\)/);
  const manuals = block('match /editor_manuals/{manualId}', 'match /editor_suggestions');
  assert.match(manuals, /videoWorkspaceMember\(\)/);
  assert.match(manuals, /resource\.data\.get\('directorUid', ''\) == request\.auth\.uid/);
  const submissions = block('match /submissions/{submissionId}', 'match /editor_profile');
  assert.match(submissions, /allow create: if false/);
});
