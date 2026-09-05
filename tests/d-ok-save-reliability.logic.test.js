const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function source(name) {
  const match = html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, 'm'));
  assert.ok(match, `${name} must exist`);
  return match[0];
}

test('workflow save errors distinguish no-write causes without exposing backend details', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source('_portalWorkflowSaveErrorMessage')}\nthis.message=_portalWorkflowSaveErrorMessage;`, context);
  assert.match(context.message({ code: 'permission-denied' }), /権限確認/);
  assert.match(context.message({ code: 'resource-exhausted' }), /保存回数の上限/);
  assert.match(context.message({ code: 'unavailable' }), /通信/);
  assert.match(context.message({ code: 'unknown' }), /進捗は未変更/);
  assert.doesNotMatch(context.message({ message: 'secret backend detail' }), /secret/);
});

test('workflow commit is handled before best-effort legacy projection', () => {
  const begin = html.indexOf('async function advancePortalWorkflow');
  const end = html.indexOf('\nfunction _editorMilestoneSummary', begin);
  const body = html.slice(begin, end);
  assert.ok(begin >= 0 && end > begin, 'workflow action must exist');
  const commit = body.indexOf('await batch.commit();');
  const projection = body.indexOf('workflow legacy projection');
  assert.ok(commit >= 0 && projection > commit, 'legacy projection runs only after Firestore commit');
  assert.match(body, /toast\(_portalWorkflowSaveErrorMessage\(e\),'err'\)/);
  assert.match(body, /toast\(legacyProjectionSaved\?`進捗を更新しました（\$\{videoStatusLabel\(status\)\}）`/);
  assert.match(body, /byRole:_isActualOwner\(\)\?'owner':'director'/);
});
