const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function sourceBetween(name, next) {
  const start = index.indexOf(`function ${name}`);
  const end = index.indexOf(`function ${next}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return index.slice(start, end);
}

test('management distinguishes planned due dates and delivery dates without a manager completion action', () => {
  for (const label of ['編集者初稿', 'クライアント初稿', '納期（予定）', '納品日']) assert.match(index, new RegExp(label));
  assert.match(index, /editor_delivery_completed:'編集者が納品を完了'/);
  assert.doesNotMatch(index, /action==='clientApproved'/);
  assert.match(index, /先方からOKが出たら、担当編集者が納品日と納品の証跡URLを記録して完了にします/);
  assert.match(index, /completedDeliveryDate:_portalField/);
  assert.match(index, /transactionDate:j\.completedDeliveryDate/);
  assert.doesNotMatch(index, /transactionDate:j\.completedDeliveryDate\|\|j\.deliveryDate/);
});

test('subcase cards open their own native button detail target', () => {
  assert.match(index, /function openLegacySubcaseDetail\(jobId,subId\)/);
  assert.match(index, /function openPortalSubcaseDetail\(portalUid,jobId,subId\)/);
  assert.match(index, /button\.video-subcase-row/);
  assert.match(index, /openLegacySubcaseDetail\(\$\{JSON\.stringify\(j\.id\)/);
  assert.match(index, /aria-label="\$\{esc\(s\.title\).*詳細を開く/);
  assert.doesNotMatch(index, /args=value=>esc\(JSON\.stringify/);
});

test('portal child documents are grouped under a display-only parent and keep a direct child detail target', () => {
  const context = {
    _videoUpdatedMillis: value => Number(value || 0),
  };
  vm.createContext(context);
  vm.runInContext(`${sourceBetween('_videoPortalGroupKey', '_videoPortalParentLead')}${sourceBetween('_videoPortalParentLead', '_videoGroupPortalJobs')}${sourceBetween('_videoGroupPortalJobs', '_videoJobs')}this.groupPortal=_videoGroupPortalJobs;`, context);
  const result = context.groupPortal([
    { _portalUid: 'editor-1', id: 'child-a', _raw: { parentCaseId: 'parent-9', parentCaseName: '9月分' }, title: '動画A', clientDisplay: 'クライアント', deadline: '2026-09-01', status: '進行中', assignee: '編集者A', biz: 'haken', updatedAt: 1 },
    { _portalUid: 'editor-1', id: 'child-b', _raw: { parentCaseId: 'parent-9', parentCaseName: '9月分' }, title: '動画B', clientDisplay: 'クライアント', deadline: '2026-09-02', status: '確認待ち', assignee: '編集者B', biz: 'haken', updatedAt: 2 },
    { _portalUid: 'editor-1', id: 'single', _raw: { parentCaseId: 'single', parentCaseName: '単発案件' }, title: '単発案件', clientDisplay: 'クライアント', deadline: '2026-09-03', status: '進行中', assignee: '編集者A', biz: 'edit', updatedAt: 3 },
  ]);
  const parent = result.find(job => job._aggregateParent);
  assert.equal(parent.title, '9月分');
  assert.equal(parent._portalChildCount, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(parent.subtasks.map(job => [job.id, job._portalChildPortalUid, job._portalChildJobId]))), [
    ['child-a', 'editor-1', 'child-a'],
    ['child-b', 'editor-1', 'child-b'],
  ]);
  assert.equal(result.find(job => job.id === 'single')._aggregateParent, undefined);
  const card = sourceBetween('_videoCard', 'openVideoLegacySafeModal');
  assert.match(card, /s\._portalChildJobId\?`openPortalJobModal\(\$\{JSON\.stringify\(s\._portalChildPortalUid\)/);
  assert.match(card, /親案件・集計/);
});

test('saving one legacy subcase draft schedule does not alter its parent or siblings', () => {
  const context = {
    S: { jobs: [{
      id: 'parent-1',
      subtasks: [
        { id: 'a', title: '1本目', editorDraftDate: '2026-09-01', clientDraftDate: '2026-09-02' },
        { id: 'b', title: '2本目', editorDraftDate: '2026-09-03', clientDraftDate: '2026-09-04' },
      ],
    }] },
    _videoCanEdit: () => true,
    SELF_WID: '__self',
    document: { getElementById: id => ({ value: id === 'vs-editor-draft' ? '2026-09-10' : '2026-09-11' }) },
    Date: { now: () => 1234 },
    _myEmail: () => 'manager@example.test',
    save: () => { context.saved = true; },
    closeModal: () => { context.closed = true; },
    render: () => { context.rendered = true; },
    toast: value => { context.toast = value; },
  };
  vm.createContext(context);
  vm.runInContext(`${sourceBetween('_findVideoSubcase', '_videoSubcaseDetailHtml')}${sourceBetween('saveLegacySubcaseDraftDates', 'openPortalSubcaseDetail')}this.saveDrafts = saveLegacySubcaseDraftDates;`, context);
  context.saveDrafts('parent-1', 'a');
  const [first, second] = context.S.jobs[0].subtasks;
  assert.equal(first.editorDraftDate, '2026-09-10');
  assert.equal(first.clientDraftDate, '2026-09-11');
  assert.equal(second.editorDraftDate, '2026-09-03');
  assert.equal(second.clientDraftDate, '2026-09-04');
  assert.equal(context.S.jobs[0].statusHistory.at(-1).subId, 'a');
  assert.equal(context.saved && context.closed && context.rendered, true);
});
