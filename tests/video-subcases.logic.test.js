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
    { id: '0', title: '1本目', deadline: '2026-08-30', status: '修正中', assignee: '編集者A', progressMilestones: [], done: false },
    { id: '1', title: '2本目', deadline: '2026-08-29', status: '完了', assignee: 'mono.create社内対応', progressMilestones: [], done: true },
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
  assert.match(html, /subtasks:_videoSubtasks\(j,linked\)/);
});

test('video case cards render subcase name, assignee, deadline, and status', () => {
  assert.match(html, /class="video-subcase-list"/);
  assert.match(html, /class="video-subcase-title"/);
  assert.match(html, /担当 \$\{esc\(s\.assignee\)\}/);
  assert.match(html, /期限 \$\{esc\(s\.deadline\|\|'未設定'\)\}/);
  assert.match(html, /class="badge \$\{badge\} video-subcase-status"/);
});
