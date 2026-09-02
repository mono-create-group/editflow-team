const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editor = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');

function functionSource(name) {
  const functionStart = editor.indexOf(`function ${name}(`);
  assert.notEqual(functionStart, -1, `${name} must be defined`);
  const start = editor.slice(Math.max(0, functionStart - 6), functionStart) === 'async ' ? functionStart - 6 : functionStart;
  let depth = 0;
  let opened = false;
  for (let i = start; i < editor.length; i += 1) {
    if (editor[i] === '{') { depth += 1; opened = true; }
    if (editor[i] === '}' && opened && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

const baseJob = {
  id: 'job-1', status: '進行中', deadline: '2026-09-01', deliveryDate: '2026-09-01',
  sharedDate: '2026-08-28', editorDraftDate: '2026-08-29', clientDraftDate: '2026-08-30', thumbnailDate: '',
  progress: 'カット完了', evidenceUrl: 'https://example.com/draft', blocker: '', workDate: '2026-08-28',
  startTime: '09:00', endTime: '12:00', workflow: { round: 1, stage: 'editing' }, history: [], progressEvents: [], progressMilestones: []
};

function valuesFor(job, changes = {}) {
  const next = { ...job, ...changes };
  return {
    '#job-status-job-1': { value: next.status }, '#job-delivery-job-1': { value: next.deliveryDate || next.deadline },
    '#job-shared-job-1': { value: next.sharedDate }, '#job-editor-draft-job-1': { value: next.editorDraftDate },
    '#job-client-draft-job-1': { value: next.clientDraftDate }, '#job-thumbnail-job-1': { value: next.thumbnailDate },
    '#job-progress-job-1': { value: next.progress }, '#job-evidence-job-1': { value: next.evidenceUrl },
    '#job-blocker-job-1': { value: next.blocker }, '#job-workdate-job-1': { value: next.workDate },
    '#job-start-job-1': { value: next.startTime }, '#job-end-job-1': { value: next.endTime }
  };
}

function makeHarness({ job = baseJob, changes, commitError } = {}) {
  const controls = valuesFor(job, changes);
  const calls = { update: 0, set: 0, commit: 0, clear: 0, toasts: [] };
  const context = {
    jobs: [{ ...job }], DEMO: false, user: { uid: 'editor-1', email: 'editor@example.com', displayName: '編集者' }, access: { name: '編集者' },
    $: selector => controls[selector] || null, safeUrl: value => /^https?:\/\//.test(value), now: () => 123,
    editorDraftDateSetter: () => 'editor', editorCanSaveStatus: () => true, editorMilestoneError: () => '', scheduleError: () => '',
    EDITOR_MILESTONE_BY_STATUS: { '初稿提出済み': { key: 'initial_submitted', label: '初稿提出' }, '修正稿提出済み': { key: 'revision_submitted', label: '修正稿提出' } },
    clearJobDraft: () => { calls.clear += 1; }, saveJobDraft: () => {}, setJobInlineError: () => {}, clearJobInlineError: () => {}, progressSavingIds: new Set(), toast: message => { calls.toasts.push(message); }, console: { warn: () => {} },
    portalSaveErrorMessage: () => '保存に失敗しました', portalWriteFailure: () => ({ quota: false, message: '保存に失敗しました' }),
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
    db: { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }) }) }), batch: () => ({ update: () => { calls.update += 1; }, set: () => { calls.set += 1; }, commit: async () => { calls.commit += 1; if (commitError) throw new Error('offline'); } }) }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('jobProgressInputsUnchanged')}\n${functionSource('saveJobProgressRequired')}\nthis.save = saveJobProgressRequired;`, context);
  return { context, calls };
}

test('same progress inputs produce no Firestore writes and clear only the local draft', async () => {
  const { context, calls } = makeHarness();
  await context.save('job-1');
  assert.deepEqual({ update: calls.update, set: calls.set, commit: calls.commit, clear: calls.clear }, { update: 0, set: 0, commit: 0, clear: 1 });
  assert.deepEqual(calls.toasts, ['変更はありません']);
});

test('stored surrounding whitespace does not create a semantic progress update', async () => {
  const { context, calls } = makeHarness({ job: { ...baseJob, progress: ' カット完了 ', evidenceUrl: 'https://example.com/draft ' } });
  await context.save('job-1');
  assert.equal(calls.commit, 0);
  assert.deepEqual(calls.toasts, ['変更はありません']);
});

test('one changed progress field keeps the required job and event writes', async () => {
  const { context, calls } = makeHarness({ changes: { progress: '書き出し完了' } });
  await context.save('job-1');
  assert.deepEqual({ update: calls.update, set: calls.set, commit: calls.commit, clear: calls.clear }, { update: 1, set: 1, commit: 1, clear: 1 });
  assert.deepEqual(calls.toasts, ['変更を保存しました']);
});

test('a normal initial submission records its milestone once, but a repeated click is a no-op', async () => {
  const initial = makeHarness({ changes: { status: '初稿提出済み' } });
  await initial.context.save('job-1');
  assert.equal(initial.calls.update, 1);
  assert.equal(initial.calls.set, 1);
  assert.deepEqual(initial.calls.toasts, ['初稿の提出を記録しました']);

  const repeatedJob = { ...baseJob, status: '初稿提出済み' };
  const repeated = makeHarness({ job: repeatedJob });
  await repeated.context.save('job-1');
  assert.equal(repeated.calls.commit, 0);
  assert.equal(repeated.calls.set, 0);
  assert.deepEqual(repeated.calls.toasts, ['変更はありません']);
});

test('initial submission event includes the workflow round required by Firestore rules', async () => {
  const { context, calls } = makeHarness({ changes: { status: '初稿提出済み' } });
  let jobData;
  context.db.batch = () => ({ update: (_ref, data) => { jobData = data; calls.update += 1; }, set: () => { calls.set += 1; }, commit: async () => { calls.commit += 1; } });
  await context.save('job-1');
  assert.equal(jobData.progressEvents[0].round, 1);
});

test('failed saves preserve the local draft for retry', async () => {
  const { context, calls } = makeHarness({ changes: { status: '初稿提出済み' }, commitError: true });
  await context.save('job-1');
  assert.equal(calls.commit, 1);
  assert.equal(calls.clear, 0);
  assert.equal(context.$('#job-status-job-1').value, '進行中');
  assert.deepEqual(calls.toasts, ['初稿・修正稿の提出は記録されていません。入力内容は保持しました。']);
});
