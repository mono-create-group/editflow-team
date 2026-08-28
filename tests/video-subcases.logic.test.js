const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function functionSource(name) {
  const source = html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, 'm'))?.[0];
  assert.ok(source, `${name} helper must exist`);
  return source;
}

test('video cards normalize and expose saved subcases', () => {
  const context = { S: { workers: [{ id: 'worker-1', name: '編集者A' }] } };
  vm.createContext(context);
  vm.runInContext(`const SELF_WID='__self';\n${functionSource('_videoSubtaskAssignee')}\n${functionSource('_videoSubtasks')}\nthis.normalize=_videoSubtasks;`, context);
  const result = context.normalize({ subtasks: [
    { title: '1本目', status: '修正中', workerId: 'worker-1', deliveryDate: '2026-08-30' },
    { title: '2本目', done: true, workerId: '__self', clientDraftDate: '2026-08-29' },
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { id: '0', title: '1本目', deadline: '2026-08-30', status: '修正中', assignee: '編集者A', progressMilestones: [], updatedAt: 0, done: false },
    { id: '1', title: '2本目', deadline: '2026-08-29', status: '完了', assignee: 'mono.create社内対応', progressMilestones: [], updatedAt: 0, done: true },
  ]);
});

test('portal video cards fall back to linked legacy subcases without mutating data', () => {
  const context = { S: { workers: [] } };
  vm.createContext(context);
  vm.runInContext(`const SELF_WID='__self';\n${functionSource('_videoSubtaskAssignee')}\n${functionSource('_videoSubtasks')}\nthis.normalize=_videoSubtasks;`, context);
  const portal = { subtasks: [] };
  const legacy = { subtasks: [{ title: '既存サブ案件', status: '進行中' }] };
  const before = JSON.stringify({ portal, legacy });
  const result = context.normalize(portal, legacy);
  assert.equal(result[0].title, '既存サブ案件');
  assert.equal(result[0].assignee, '未割当');
  assert.equal(JSON.stringify({ portal, legacy }), before);
  assert.match(html, /subtasks:_videoSubtasks\(j,linked,workerNames\)/);
});

test('video case cards render subcase name, assignee, deadline, and status', () => {
  assert.match(html, /<details class="video-subcase-list"/);
  assert.match(html, /<summary class="video-subcase-head">/);
  assert.match(html, /class="video-subcase-list"/);
  assert.match(html, /class="video-subcase-title"/);
  assert.match(html, /担当 \$\{esc\(s\.assignee\)\}/);
  assert.match(html, /期限 \$\{esc\(s\.deadline\|\|'未設定'\)\}/);
  assert.match(html, /class="badge \$\{badge\} video-subcase-status"/);
});

test('workflow keeps repeatable director and client review rounds without rewriting legacy status', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource('_videoWorkflow')}\nthis.workflow=_videoWorkflow;`, context);
  assert.deepEqual({...context.workflow({status:'D確認OK'})}, {round:1,stage:'client_submission'});
  assert.deepEqual({...context.workflow({status:'修正中'})}, {round:2,stage:'editing'});
  assert.deepEqual({...context.workflow({status:'FB待ち'})}, {round:1,stage:'director_review'});
  assert.deepEqual({...context.workflow({status:'確認待ち'})}, {round:1,stage:'client_review'});
  assert.deepEqual({...context.workflow({workflow:{round:3,stage:'director_review'},status:'修正稿提出済み'})}, {round:3,stage:'director_review'});
  assert.match(html, /function advancePortalWorkflow\(portalUid,id,action\)/);
  assert.match(html, /progressEvents:/);
});

test('video status labels keep stored legacy values while showing unambiguous labels', () => {
  const labels = html.match(/const VIDEO_STATUS_LABELS=\{[^\n]+\};\nfunction videoStatusLabel\([^\n]+/)?.[0];
  assert.ok(labels, 'videoStatusLabel must preserve stored values');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${labels}\nthis.label=videoStatusLabel;`, context);
  assert.equal(context.label('修正中'), '修正中');
  assert.equal(context.label('FB待ち'), 'mono.create FB中');
  assert.equal(context.label('確認待ち'), '先方確認中');
  assert.match(html, /<option value="\$\{esc\(x\)\}"/);
});

test('legacy video operations keep child cases inside parent details in every operational list', () => {
  for (const marker of ['function rJobItem(j)', 'function rProjWorker()', 'function rProjPriority()', 'function rProjPayment()', 'function _profitGroupedHtml(jobs,mode)']) {
    const start = html.indexOf(marker);
    assert.ok(start >= 0, `${marker} must exist`);
    const scope = html.slice(start, start + 7000);
    assert.match(scope, /<details[^>]*(video-subcase-list|subtask-list)/, `${marker} nests child cases`);
  }
});

test('manager video workspace has accessible context, attention, and responsive kanban primitives', () => {
  assert.match(html, /href="app-ui\.css"/);
  assert.match(html, /class="app-breadcrumb"/);
  assert.match(html, /class="app-attention-grid"/);
  assert.match(html, /class="app-context-switch" role="tablist"/);
  assert.match(html, /class="app-view-tabs" role="tablist"/);
  assert.match(html, /class="app-kanban"/);
  assert.match(html, /aria-selected="\$\{VIDEO_TAB===k\}"/);
  assert.match(html, /function _videoCaseSummary\(job\)/);
});
