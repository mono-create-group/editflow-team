const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const contract = JSON.parse(fs.readFileSync(path.join(__dirname, 'operational-contract.json'), 'utf8'));

test('assigned is a first-class video job status in both edit and dispatch boards', () => {
  assert.match(index, /const PSTATUS=\[[^;]*'アサイン済み'/);
  assert.match(index, /'アサイン済み':'--blue'/);
  assert.match(index, /'アサイン済み':'bb'/);
  assert.match(index, /'アサイン済み':'#3b82f6'/);
  for (const biz of ['edit', 'haken']) {
    const start = index.indexOf(`  ${biz}:{`);
    const end = index.indexOf('\n  },', start);
    const config = index.slice(start, end);
    assert.match(config, /statuses:\[[^\]]*'アサイン済み'/);
    assert.match(config, /board:\[[^\]]*'アサイン済み'/);
  }
});

test('assigned remains visible through the video board and legacy portal mapping', () => {
  assert.match(index, /\{id:'assigned',label:'アサイン済み',statuses:\['編集者決定','アサイン済み','受注済み'\]\}/);
  const mapper = index.slice(index.indexOf('function _legacyPortalStatus'), index.indexOf('\nfunction _legacyPortalAccessForWorker'));
  assert.match(mapper, /value==='確認待ち'\)return'先方確認中'/);
  assert.match(mapper, /\['編集者決定','受注済み','未着手'\]\.includes\(value\)\)return'アサイン済み'/);
  assert.match(mapper, /'アサイン済み','進行中','編集者進行中'/);
});

test('assigned and the official editor start state are enforced by the Firestore workflow contract', () => {
  assert.ok(contract.editor_job_statuses.includes('アサイン済み'));
  assert.ok(contract.editor_job_statuses.includes('編集者進行中'));
  assert.ok(contract.editor_job_statuses.includes('先方確認中'));
  assert.match(rules, /function validEditorStartTransition\(previousStatus, nextStatus\)/);
  assert.match(rules, /nextStatus == '編集者進行中'[\s\S]*previousStatus in \['未着手', '受注済み', '進行中', 'アサイン済み'\]/);
  assert.match(rules, /nextStatus == '初稿提出済み'[\s\S]*previousStatus == '編集者進行中'/);
  assert.match(rules, /nextStatus == '修正稿提出済み' && previousStatus == '修正中'/);
});
