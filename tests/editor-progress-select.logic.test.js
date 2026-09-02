const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const features = fs.readFileSync(path.resolve(__dirname, '..', 'editor-features.js'), 'utf8');
const editor = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');
const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; opened = true; }
    if (source[i] === '}' && opened && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('assigned job cards expose a visible progress selector instead of a one-action button', () => {
  assert.match(features, /<label for="quick-status-\$\{jid\}">進捗を選択<\/label>/);
  assert.match(features, /id="quick-status-\$\{jid\}" onchange="updateEditorProgressChoice\('\$\{jid\}'\)"/);
  assert.match(features, /id="quick-progress-save-\$\{jid\}"[^>]+onclick="submitEditorProgressChoice\('\$\{jid\}'\)" disabled/);
  assert.match(features, /進捗を選択してください/);
  assert.match(features, /job-submit-panel editor-progress-picker/);
});

test('editor choices follow the current workflow and never expose manager-owned review states', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    functionSource(features, 'editorWorkflow'),
    functionSource(features, 'editorAllowedStatuses'),
    'this.allowed=editorAllowedStatuses;',
  ].join('\n'), context);

  assert.deepEqual([...context.allowed({ status: 'アサイン済み', workflow: { round: 1, stage: 'editing' } })], ['アサイン済み', '編集者進行中']);
  for (const legacy of ['未着手', '受注済み', '進行中']) assert.deepEqual([...context.allowed({ status: legacy, workflow: { round: 1, stage: 'editing' } })], [legacy, '編集者進行中']);
  assert.deepEqual([...context.allowed({ status: '編集者進行中', workflow: { round: 1, stage: 'editing' } })], ['編集者進行中', '初稿提出済み']);
  assert.deepEqual([...context.allowed({ status: '修正中', workflow: { round: 2, stage: 'editing' } })], ['修正中', '修正稿提出済み']);
  assert.deepEqual([...context.allowed({ status: '初稿提出済み', workflow: { round: 1, stage: 'director_review' } })], ['初稿提出済み']);
  for (const forbidden of ['D確認OK', '先方確認中', '確認待ち', '完了']) {
    assert.equal(context.allowed({ status: '修正中', workflow: { round: 2, stage: 'editing' } }).includes(forbidden), false);
  }
});

test('selecting a submission reveals its evidence input while an ordinary start does not', () => {
  const controls = {
    '#quick-status-job-1': { value: '修正稿提出済み' },
    '#quick-evidence-field-job-1': { hidden: true },
    '#quick-evidence-label-job-1': { textContent: '' },
    '#quick-progress-save-job-1': { disabled: true, textContent: '' },
  };
  const toasts = [];
  const context = {
    jobs: [{ id: 'job-1', status: '修正中', workflow: { round: 2, stage: 'editing' } }],
    $: selector => controls[selector] || null,
    toast: message => toasts.push(message),
  };
  vm.createContext(context);
  vm.runInContext([
    functionSource(features, 'editorWorkflow'),
    functionSource(features, 'editorAllowedStatuses'),
    functionSource(features, 'updateEditorProgressChoice'),
    'this.update=updateEditorProgressChoice;',
  ].join('\n'), context);

  context.update('job-1');
  assert.equal(controls['#quick-evidence-field-job-1'].hidden, false);
  assert.equal(controls['#quick-evidence-label-job-1'].textContent, '修正稿URL *');
  assert.equal(controls['#quick-progress-save-job-1'].disabled, false);
  assert.equal(controls['#quick-progress-save-job-1'].textContent, '修正稿を提出');

  controls['#quick-status-job-1'].value = '修正中';
  context.update('job-1');
  assert.equal(controls['#quick-evidence-field-job-1'].hidden, true);
  assert.equal(controls['#quick-progress-save-job-1'].textContent, '選択した進捗を保存');
  assert.deepEqual(toasts, []);
});

test('submission selections keep using the existing progress save route and evidence requirement', () => {
  const controls = {
    '#quick-evidence-job-1': { value: '' },
    '#job-evidence-job-1': { value: '' },
  };
  const calls = [];
  const context = {
    $: selector => controls[selector] || null,
    safeUrl: value => /^https?:\/\//.test(value),
    toast: message => calls.push(['toast', message]), setJobInlineError: (jid, message) => calls.push(['inline', jid, message]), clearJobInlineError: jid => calls.push(['clear', jid]),
    quickJobStatus: (jid, status) => calls.push(['save', jid, status]),
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource(features, 'submitEditorJobAction')}\nthis.submit=submitEditorJobAction;`, context);

  context.submit('job-1', '初稿提出済み');
  assert.deepEqual(calls, [['inline', 'job-1', '初稿・修正稿を提出する前に、提出した内容のURLを入力してください。入力内容は保持されています。']]);
  controls['#quick-evidence-job-1'].value = 'https://example.com/initial';
  context.submit('job-1', '初稿提出済み');
  assert.equal(controls['#job-evidence-job-1'].value, 'https://example.com/initial');
  assert.deepEqual(calls.at(-1), ['save', 'job-1', '初稿提出済み']);
});

test('quick progress inline handlers are exported to the browser window', () => {
  assert.match(features, /window\.updateEditorProgressChoice=updateEditorProgressChoice/);
  assert.match(features, /window\.submitEditorProgressChoice=submitEditorProgressChoice/);
});

test('editor save validation permits assigned to editor work but keeps mono.create internal progress unavailable', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource(editor, 'editorWorkflowForSave')}\n${functionSource(editor, 'editorCanSaveStatus')}\nthis.can=editorCanSaveStatus;`, context);
  const assigned = { status: 'アサイン済み', workflow: { round: 1, stage: 'editing' } };
  assert.equal(context.can(assigned, '編集者進行中'), true);
  assert.equal(context.can(assigned, '進行中'), false);
  assert.equal(context.can({ status: '進行中', workflow: { round: 1, stage: 'editing' } }, '編集者進行中'), true);
  assert.equal(context.can({ status: '初稿完成' }, '初稿提出済み'), true);
  assert.equal(context.can({ status: '初稿完成', workflow: { round: 1, stage: 'editing' } }, '初稿提出済み'), false);
  assert.equal(context.can(assigned, '初稿提出済み'), false);
  assert.equal(context.can({ status: '初稿提出済み', workflow: { round: 1, stage: 'director_review' } }, '修正中'), false);
});

test('new direct, dispatch, and claimed jobs begin assigned rather than in the internal progress state', () => {
  const createJob = functionSource(editor, 'createJob');
  const createDispatchJob = functionSource(features, 'createDispatchJob');
  const claimBoardJob = functionSource(features, 'claimBoardJob');
  assert.match(createJob, /status:'アサイン済み'/);
  assert.match(createJob, /history:\[\{at,type:'created',by:user\.uid,status:'アサイン済み'\}\]/);
  assert.match(createDispatchJob, /status:'アサイン済み'/);
  assert.match(createDispatchJob, /history:\[\{at,type:'created',by:user\.uid,status:'アサイン済み'\}\]/);
  assert.match(claimBoardJob, /status:'アサイン済み'/);
  assert.match(claimBoardJob, /history:\[\{at,type:'claimed',by:user\.uid,status:'アサイン済み'\}\]/);
  assert.match(features, /type:'claimed',byUid:user\.uid,status:'アサイン済み',boardJobId:jid/);
  assert.match(editor, /id:'demo-1'[\s\S]*?status:'編集者進行中'/);
});

test('Firestore enforces the same initial and revision submission predecessors as the UI', () => {
  const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
  assert.match(rules, /function validEditorSubmissionStatus\(previousStatus, nextStatus\)/);
  assert.match(rules, /nextStatus == '初稿提出済み'[\s\S]*previousStatus == '編集者進行中'/);
  assert.match(rules, /nextStatus == '修正稿提出済み' && previousStatus == '修正中'/);
  assert.match(rules, /function validLegacyEditorSubmissionStatus\(previousStatus, nextStatus\)/);
  assert.match(rules, /previousStatus in \['進行中', '初稿完成'\]/);
  assert.equal((rules.match(/validEditorSubmissionStatus\(/g) || []).length, 4, 'helper plus all three submission rule paths must stay aligned');
});

test('Firestore requires editor-created portal jobs to begin assigned', () => {
  const editorCreate = rules.match(/allow create: if request\.resource\.data\.get\('source', ''\) == 'legacy_sync'[\s\S]*?request\.resource\.data\.history\.size\(\) == 1\);/)?.[0] || '';
  assert.match(editorCreate, /&& editor\(uid\)/);
  assert.match(editorCreate, /request\.resource\.data\.status == 'アサイン済み'/);
});
