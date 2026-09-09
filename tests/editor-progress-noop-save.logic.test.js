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
    '#job-start-job-1': { value: next.startTime }, '#job-end-job-1': { value: next.endTime },
    '#job-pm-job-1': { value: next.pmUrl || '' }, '#job-frameio-job-1': { value: next.frameioUrl || '' }, '#job-tool-job-1': { value: next.tool || 'premiere' }
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
    clearJobDraft: () => { calls.clear += 1; }, saveJobDraft: () => {}, logSubmissionFailure: () => {}, setJobInlineError: () => {}, clearJobInlineError: () => {}, progressSavingIds: new Set(), toast: message => { calls.toasts.push(message); }, console: { warn: () => {} },
    portalSaveErrorMessage: () => '保存に失敗しました', portalWriteFailure: () => ({ quota: false, message: '保存に失敗しました' }),
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'server-time' } } },
    db: { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({}) }) }) }) }) }), batch: () => ({ update: (_ref, payload) => { calls.update += 1; calls.lastUpdate = payload; }, set: () => { calls.set += 1; }, commit: async () => { calls.commit += 1; if (commitError) throw new Error('offline'); } }) }
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('jobProgressInputsUnchanged')}\n${functionSource('portalProgressFailureMessage')}\n${functionSource('saveJobProgressRequired')}\nthis.save = saveJobProgressRequired;`, context);
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
  const initial = makeHarness({ changes: { status: '初稿提出済み', pmUrl: 'https://example.com/pm' } });
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
  const { context, calls } = makeHarness({ changes: { status: '初稿提出済み', pmUrl: 'https://example.com/pm' } });
  let jobData;
  context.db.batch = () => ({ update: (_ref, data) => { jobData = data; calls.update += 1; }, set: () => { calls.set += 1; }, commit: async () => { calls.commit += 1; } });
  await context.save('job-1');
  assert.equal(jobData.progressEvents[0].round, 1);
});

test('failed saves preserve the local draft for retry', async () => {
  const { context, calls } = makeHarness({ changes: { status: '初稿提出済み', pmUrl: 'https://example.com/pm' }, commitError: true });
  await context.save('job-1');
  assert.equal(calls.commit, 1);
  assert.equal(calls.clear, 0);
  assert.equal(context.$('#job-status-job-1').value, '進行中');
  assert.deepEqual(calls.toasts, ['初稿・修正稿の提出は記録されていません。入力内容は保持しました。']);
});

test('an initial or revision submission without the project-management link is rejected before any write', async () => {
  // 会長指示: 初稿・修正稿の提出時はプロマネリンク必須。Frame.io リンクは任意。
  const { context, calls } = makeHarness({ changes: { status: '初稿提出済み' } });
  await context.save('job-1');
  assert.equal(calls.update, 0);
  assert.equal(calls.commit, 0);
  assert.ok(calls.toasts.some(message => /プロマネリンク/.test(message)), calls.toasts.join(' / '));
  const optionalFrameio = makeHarness({ changes: { status: '初稿提出済み', pmUrl: 'https://example.com/pm' } });
  await optionalFrameio.context.save('job-1');
  assert.equal(optionalFrameio.calls.commit, 1, 'Frame.io link stays optional');
});

test('submission links are recorded on the submission event and history, never as top-level job keys', async () => {
  // Firestore ルールの更新キー一覧にトップレベルの pmUrl / frameioUrl は無いため、イベント・履歴側に保存する。
  const { context, calls } = makeHarness({ changes: { status: '初稿提出済み', pmUrl: 'https://example.com/pm', frameioUrl: 'https://f.io/x' } });
  await context.save('job-1');
  assert.equal(calls.commit, 1);
  const data = calls.lastUpdate;
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'pmUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'frameioUrl'), false);
  const event = data.progressEvents.find(row => row.type === 'editor_submitted');
  assert.equal(event.pmUrl, 'https://example.com/pm');
  assert.equal(event.frameioUrl, 'https://f.io/x');
  assert.equal(event.tool, 'premiere');
  assert.equal(data.history[data.history.length - 1].pmUrl, 'https://example.com/pm');
  assert.equal(data.progressMilestones[0].frameioUrl, 'https://f.io/x');
});

test('a CapCut delivery submits without the project-management link and records the tool', async () => {
  // 会長指示: CapCut で納品する編集者もいる。CapCut ならプロマネ・Frame.io は不要。
  const { context, calls } = makeHarness({ changes: { status: '修正稿提出済み', tool: 'capcut', pmUrl: '', frameioUrl: '' } });
  await context.save('job-1');
  assert.equal(calls.commit, 1, calls.toasts.join(' / '));
  const event = calls.lastUpdate.progressEvents.find(row => row.type === 'editor_submitted');
  assert.equal(event.tool, 'capcut');
  assert.equal(event.pmUrl, null);
  // CapCut を選んでいれば、欄に残っていた古いリンクも記録しない。
  const stale = makeHarness({ changes: { status: '修正稿提出済み', tool: 'capcut', pmUrl: 'https://example.com/old', frameioUrl: 'https://f.io/old' } });
  await stale.context.save('job-1');
  const staleEvent = stale.calls.lastUpdate.progressEvents.find(row => row.type === 'editor_submitted');
  assert.deepEqual([staleEvent.pmUrl, staleEvent.frameioUrl], [null, null]);
  // Premiere のままプロマネ無しは従来どおり差し戻し（案内文で CapCut への切替を示す）。
  const premiere = makeHarness({ changes: { status: '修正稿提出済み', tool: 'premiere' } });
  await premiere.context.save('job-1');
  assert.equal(premiere.calls.commit, 0);
  assert.ok(premiere.calls.toasts.some(message => /CapCut/.test(message)), premiere.calls.toasts.join(' / '));
});
