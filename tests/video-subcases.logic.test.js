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
  vm.runInContext(`const SELF_WID='__self';\n${functionSource('_editorDraftDateSetter')}\n${functionSource('_videoSubtaskAssignee')}\n${functionSource('_videoSubtasks')}\nthis.normalize=_videoSubtasks;`, context);
  const result = context.normalize({ subtasks: [
    { title: '1本目', status: '修正中', workerId: 'worker-1', deliveryDate: '2026-08-30' },
    { title: '2本目', done: true, workerId: '__self', clientDraftDate: '2026-08-29' },
  ] });
  assert.deepEqual(JSON.parse(JSON.stringify(result)), [
    { id: '0', title: '1本目', deadline: '2026-08-30', editorDraftDate: '', editorDraftDateSetter: 'editor', clientDraftDate: '', completedDeliveryDate: '', status: '修正中', assignee: '編集者A', progressMilestones: [], updatedAt: 0, done: false },
    { id: '1', title: '2本目', deadline: '2026-08-29', editorDraftDate: '', editorDraftDateSetter: 'editor', clientDraftDate: '2026-08-29', completedDeliveryDate: '', status: '完了', assignee: 'mono.create社内対応', progressMilestones: [], updatedAt: 0, done: true },
  ]);
});

test('portal video cards fall back to linked legacy subcases without mutating data', () => {
  const context = { S: { workers: [] } };
  vm.createContext(context);
  vm.runInContext(`const SELF_WID='__self';\n${functionSource('_editorDraftDateSetter')}\n${functionSource('_videoSubtaskAssignee')}\n${functionSource('_videoSubtasks')}\nthis.normalize=_videoSubtasks;`, context);
  const portal = { subtasks: [] };
  const legacy = { subtasks: [{ title: '既存サブ案件', status: '進行中' }] };
  const before = JSON.stringify({ portal, legacy });
  const result = context.normalize(portal, legacy);
  assert.equal(result[0].title, '既存サブ案件');
  assert.equal(result[0].assignee, '未割当');
  assert.equal(JSON.stringify({ portal, legacy }), before);
  assert.match(html, /subtasks:_videoSubtasks\(j,linked,workerNames\)/);
});

test('video case cards render subcase name, assignee, planned due date, and status', () => {
  assert.match(html, /<details class="video-subcase-list"/);
  assert.match(html, /<summary class="video-subcase-head">/);
  assert.match(html, /class="video-subcase-list"/);
  assert.match(html, /class="video-subcase-title"/);
  assert.match(html, /担当 \$\{esc\(s\.assignee\)\}/);
  assert.match(html, /納期（予定） \$\{esc\(s\.deadline\|\|'未設定'\)\}/);
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
  assert.match(html, /function advancePortalWorkflow\(portalUid,id,action,providedReason,providedCompletionDate\)/);
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

test('legacy video operations keep child cases inside parent details except the exhaustive priority list', () => {
  for (const marker of ['function rJobItem(j)', 'function rProjWorker()', 'function rProjPayment()', 'function _profitGroupedHtml(jobs,mode)']) {
    const start = html.indexOf(marker);
    assert.ok(start >= 0, `${marker} must exist`);
    const scope = html.slice(start, start + 7000);
    assert.match(scope, /<details[^>]*(video-subcase-list|subtask-list)/, `${marker} nests child cases`);
  }
  const priority=html.slice(html.indexOf('function rProjPriority()'),html.indexOf('// ===HABITS==='));
  assert.match(priority,/g\.items\.map\(rowHtml\)/,'priority renders every child as a visible row');
  assert.doesNotMatch(priority,/<details/,'priority does not hide child rows in collapsed details');
});

test('legacy board cards show each subcase assignee and both draft dates', () => {
  const start = html.indexOf('function rProjCard(j)');
  const end = html.indexOf('// 今日・明日が期限', start);
  assert.ok(start >= 0 && end > start, 'legacy board card renderer must exist');
  const scope = html.slice(start, end);
  assert.match(scope, /class="subcase-card-link"/);
  assert.match(scope, /担当者 \$\{esc\(subAssignee\)\}/);
  assert.match(scope, /_videoDraftMetaHtml\('editor',s\.editorDraftDate\)/);
  assert.match(scope, /_videoDraftMetaHtml\('client',s\.clientDraftDate\)/);
  assert.match(scope, /openLegacySubcaseDetail\(\$\{JSON\.stringify\(j\.id\)\}/);
  assert.match(html, /\.subcase-card-link\{min-width:0;flex:1;/);
  assert.match(html, /class="video-draft-mark" aria-hidden="true">\$\{mark\}<\/span><span>初稿/);
  assert.match(html, /mark=editor\?'編':'ク'/);
});

test('a child with a different active status appears as a shortcut in its own board column', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource('_boardSubcaseStatus')}\n${functionSource('_boardMixedSubcases')}\n${functionSource('_boardSubcaseRefs')}\nthis.refs=_boardSubcaseRefs;`, context);
  const parent = { id:'parent-1', title:'9月分', status:'編集者進行中', subtasks:[
    { id:'sub-1', title:'台本1', status:'修正中' },
    { id:'sub-2', title:'台本2', status:'編集者進行中' },
  ] };
  assert.equal(context.refs([parent],'修正中').length,1);
  assert.equal(context.refs([parent],'編集者進行中').length,0);
  assert.match(html, /class="board-subcase-shortcut"/);
  assert.match(html, /_boardMixedStatusSummaryHtml\(j\)/);
  const shortcutSource=functionSource('rProjSubcaseShortcut');
  assert.match(shortcutSource,/esc\(JSON\.stringify/);
  assert.doesNotMatch(shortcutSource,/toggleJobSub|markJobPaid|saveJob/);
});

test('manager video workspace has accessible case context, next action, and responsive kanban primitives', () => {
  assert.match(html, /href="app-ui\.css"/);
  assert.match(html, /class="ref-breadcrumb"/);
  assert.match(html, /class="ref-workspace-body"/);
  assert.match(html, /class="ref-next-action"/);
  assert.match(html, /class="app-context-switch" role="tablist"/);
  assert.match(html, /class="ref-global-tabs" aria-label="案件管理ページ"/);
  assert.match(html, /class="app-kanban"/);
  assert.match(html, /aria-current="page"/);
  assert.match(html, /function _videoCaseSummary\(job\)/);
});
