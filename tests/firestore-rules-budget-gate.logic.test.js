const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runner = fs.readFileSync(path.join(root, 'scripts', 'run-firestore-rules-tests.cjs'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('Firestore rules test fails when the emulator reports the 1,000-expression limit', () => {
  assert.equal(pkg.scripts['test:rules'], 'node scripts/run-firestore-rules-tests.cjs');
  assert.match(runner, /maximum of 1000 expressions to evaluate has been reached/);
  assert.match(runner, /if \(budgetErrors\.length > 0\)/);
  assert.match(runner, /process\.exit\(1\)/);
  assert.match(runner, /0 expression-limit errors/);
});

test('portal job updates use one intent dispatcher instead of overlapping allow rules', () => {
  const start = rules.indexOf('match /editor_jobs/{jobId}');
  const end = rules.indexOf('match /events/{eventId}', start);
  assert.ok(start >= 0 && end > start, 'portal job match must exist');
  const portalJobRules = rules.slice(start, end);
  assert.equal((portalJobRules.match(/allow update:/g) || []).length, 1);
  assert.match(portalJobRules, /allow update: if resource != null && validPortalJobUpdate\(uid, jobId\);/);
  assert.match(rules, /function validPortalJobUpdate\(uid, jobId\)/);
});
