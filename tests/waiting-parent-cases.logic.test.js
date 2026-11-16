const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sourceBetween(name, next) {
  const start = index.indexOf(`function ${name}`);
  const end = index.indexOf(`function ${next}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return index.slice(start, end);
}

function escSource() {
  const start = index.indexOf('function esc(');
  const end = index.indexOf('\n', start);
  assert.ok(start >= 0 && end > start, 'esc source must exist');
  return index.slice(start, end);
}

function load() {
  const context = {};
  vm.createContext(context);
  vm.runInContext([
    escSource(),
    sourceBetween('_videoUpdatedMillis', '_videoSortJobs'),
    sourceBetween('_jobHasSubcaseStructure', '_caseScheduleRows'),
    'this.pick = _waitingParentCases;',
    'this.strip = _waitingParentStrip;',
  ].join('\n'), context);
  return context;
}

// Throwaway objects only: nothing here touches the app's live state.
function parent(overrides = {}) {
  return {
    _source: 'legacy', biz: 'edit', id: 'p1', title: '8月分', clientDisplay: '横井様', assignee: '未割当', status: '進行中', updatedAt: 0,
    subtasks: [
      { id: 's1', title: '1本目', status: '完了', done: true },
      { id: 's2', title: '2本目', status: 'キャンセル', done: false },
    ],
    ...overrides,
  };
}

test('a parent whose children are all finished is listed as waiting for the next materials', () => {
  const { pick } = load();
  const result = pick([parent()], { biz: 'edit', query: '' });
  assert.equal(result.waiting.length, 1);
  assert.equal(result.waiting[0].job.id, 'p1');
  assert.equal(result.waiting[0].total, 2);
  assert.equal(result.completed.length, 0);
});

test('a parent that still has an open child is not listed', () => {
  const { pick } = load();
  const open = parent({ subtasks: [{ id: 's1', status: '完了', done: true }, { id: 's2', status: '進行中', done: false }] });
  const result = pick([open], { biz: 'edit', query: '' });
  assert.equal(result.waiting.length, 0);
});

test('a normal case without children is not listed', () => {
  const { pick } = load();
  const result = pick([parent({ id: 'single', subtasks: [] })], { biz: 'edit', query: '' });
  assert.equal(result.waiting.length, 0);
});

test('a completed parent is listed only when the search matches it', () => {
  const { pick } = load();
  const done = parent({ id: 'old', title: '7月分', status: '完了' });
  assert.equal(pick([done], { biz: 'edit', query: '' }).completed.length, 0);
  assert.equal(pick([done], { biz: 'edit', query: '' }).waiting.length, 0);
  const hit = pick([done], { biz: 'edit', query: '横井' });
  assert.equal(hit.completed.length, 1);
  assert.equal(hit.completed[0].job.id, 'old');
  assert.equal(pick([done], { biz: 'edit', query: '別の人' }).completed.length, 0);
});

test('the search filters by title and client name', () => {
  const { pick } = load();
  const list = [parent({ id: 'a', title: '8月分', clientDisplay: '横井様' }), parent({ id: 'b', title: '秋の撮影', clientDisplay: '田中様' })];
  assert.equal(pick(list, { biz: 'edit', query: '横井' }).waiting.map(r => r.job.id).join(","), "a");
  assert.equal(pick(list, { biz: 'edit', query: '秋の' }).waiting.map(r => r.job.id).join(","), "b");
  assert.equal(pick(list, { biz: 'edit', query: '' }).waiting.length, 2);
});

test('cancelled parents and other businesses are excluded', () => {
  const { pick } = load();
  const list = [parent({ id: 'c', status: 'キャンセル' }), parent({ id: 'h', biz: 'haken' })];
  const edit = pick(list, { biz: 'edit', query: '横井' });
  assert.equal(edit.waiting.length + edit.completed.length, 0);
  assert.equal(pick(list, { biz: 'haken', query: '' }).waiting.map(r => r.job.id).join(","), "h");
});

test('the strip shows the label, client, child count and the open button, and never mutates the input', () => {
  const { strip } = load();
  const job = parent();
  const before = JSON.stringify(job);
  const html = strip([job], { biz: 'edit', query: '', owner: true });
  assert.match(html, /次の素材待ちの親案件（子案件はすべて完了）/);
  assert.match(html, /横井様 ・ 子案件 2本すべて完了/);
  assert.match(html, /openJobModal\(&quot;p1&quot;\)/);
  assert.equal(JSON.stringify(job), before);
  assert.equal(strip([], { biz: 'edit', query: '' }), '');
  const doneHtml = strip([parent({ status: '完了' })], { biz: 'edit', query: '横井', owner: true });
  assert.match(doneHtml, /完了済みの親案件/);
});

function loadAutoStatus() {
  const context = {
    bizCfgOf: () => ({ statuses: ['未着手', '進行中', '初稿提出済み', '完了', 'キャンセル'] }),
  };
  vm.createContext(context);
  vm.runInContext([
    sourceBetween('_aggregateSubcaseStatus', '_jobSubDefaultStatus'),
    sourceBetween('_jobSubDefaultStatus', '_parentAutoStatus'),
    sourceBetween('_parentAutoStatus', 'bizScopeOpts'),
    'this.auto = _parentAutoStatus;',
  ].join('\n'), context);
  return context;
}

const allDone = [{ status: '完了', done: true }, { status: 'キャンセル', done: false }];

test('awaiting materials ON keeps the parent from auto-completing', () => {
  const { auto } = loadAutoStatus();
  assert.equal(auto({ awaitingMaterials: true }, 'edit', allDone), '未着手');
  assert.equal(auto({ awaitingMaterials: true }, 'edit', [{ status: 'キャンセル' }]), '未着手');
  assert.equal(auto({ awaitingMaterials: true }, 'edit', [{ status: '完了', done: true }, { status: '進行中' }]), '進行中');
});

test('awaiting materials OFF behaves exactly as before', () => {
  const { auto } = loadAutoStatus();
  assert.equal(auto({ awaitingMaterials: false }, 'edit', allDone), '完了');
  assert.equal(auto({}, 'edit', [{ status: 'キャンセル' }]), 'キャンセル');
  assert.equal(auto(null, 'edit', [{ status: '初稿提出済み' }, { status: '進行中' }]), '進行中');
});

test('every parent auto-status site goes through the shared helper', () => {
  const calls = index.match(/_aggregateSubcaseStatus\(/g) || [];
  assert.equal(calls.length, 2, 'only the definition and the helper itself may call the aggregate');
  assert.match(index, /parent\.status=found\?_parentAutoStatus\(parent,biz,parent\.subtasks\):status;/);
  assert.match(index, /parent\.status=_parentAutoStatus\(parent,jobBiz\(parent\),parent\.subtasks\);/);
  assert.match(index, /target\.status=_parentAutoStatus\(target,jobBiz\(target\),target\.subtasks\);/);
  assert.match(index, /const finalStatus=parentStatusAuto\?_parentAutoStatus\(\{awaitingMaterials\},currentBiz,subtasks\):requestedStatus;/);
  assert.match(index, /hasSubcases:hasSubcaseStructure,awaitingMaterials,/);
  assert.match(index, /_source:'legacy',_raw:j,biz:jobBiz\(j\),id:j\.id,awaitingMaterials:j\.awaitingMaterials===true,/);
});

test('a parent with awaiting materials ON is listed even with open children', () => {
  const { pick, strip } = load();
  const job = parent({ awaitingMaterials: true, subtasks: [{ id: 's1', status: '完了', done: true }, { id: 's2', status: '進行中' }, { id: 's3', status: '未着手' }] });
  const result = pick([job], { biz: 'edit', query: '' });
  assert.equal(result.waiting.length, 1);
  assert.equal(result.waiting[0].awaiting, true);
  const html = strip([job], { biz: 'edit', query: '', owner: true });
  assert.match(html, /素材待ち ・ 子案件 3本（完了 1本）/);
  assert.equal(pick([{ ...job, _source: 'portal' }], { biz: 'edit', query: '' }).waiting.length, 0, 'portal jobs have no switch');
  assert.equal(pick([{ ...job, status: 'キャンセル' }], { biz: 'edit', query: '' }).waiting.length, 0);
  assert.equal(pick([job], { biz: 'edit', query: '別の人' }).waiting.length, 0);
  assert.equal(pick([{ ...job, awaitingMaterials: false, _raw: { awaitingMaterials: true } }], { biz: 'edit', query: '' }).waiting.length, 1, 'raw field is honoured');
});
