const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('the case form explicitly separates normal and subcase structures', () => {
  assert.match(index, /id="j-case-structure"/);
  assert.match(index, /サブ案件なし（通常案件）/);
  assert.match(index, /サブ案件あり（親は共通情報のみ）/);
  const mode = functionSource(index, 'setJobSubcaseMode');
  for (const id of ['jf-parent-worker', 'jf-parent-schedule', 'jf-drafts', 'jf-client-draft', 'jf-parent-completed', 'jf-parent-thumbnail', 'jf-parent-payout']) {
    assert.match(mode, new RegExp(id));
  }
  assert.match(index, /subcaseMode:hasSubcaseStructure\?'with_subcases':'without_subcases'/);
  assert.match(index, /hasSubcases:hasSubcaseStructure/);
});

test('subcase mode clears parent-only schedule and assignment values on save', () => {
  const save = functionSource(index, 'saveJob');
  assert.match(save, /workerIds:parentWorkerIds,workerId:primaryWorkerId/);
  assert.match(save, /sharedDate:hasSubcaseStructure\?null/);
  assert.match(save, /editorDraftDate:aggregateDraftDate/);
  assert.match(save, /clientDraftDate:hasSubcaseStructure\?null/);
  assert.match(save, /deliveryDate:hasSubcaseStructure\?null/);
  assert.match(save, /payoutDate:_isOwner\(\)\?\(hasSubcaseStructure\?null/);
});

test('bulk client-draft and payout dates are available for child cases', () => {
  assert.match(index, /id="j-bulk-client-draft"/);
  assert.match(index, /id="j-bulk-payout"/);
  const bulk = functionSource(index, 'applyJobSubcaseBulkDates');
  assert.match(bulk, /\.j-sub-client/);
  assert.match(bulk, /\.j-sub-payout/);
  assert.match(bulk, /JOB_MODAL_SUB_RECORDS\[index\]/);
});

test('case schedule shows child rows only when a parent has subcases', () => {
  const context = vm.createContext({ PBIZ: 'edit' });
  vm.runInContext(`${functionSource(index, '_jobHasSubcaseStructure')}\n${functionSource(index, '_caseScheduleRows')}`, context);
  const jobs = [
    { id: 'parent-with-mode', biz: 'edit', status: '進行中', subcaseMode: 'with_subcases', clientDraftDate: '2026-09-20', subtasks: [{ id: 'child-1', status: '進行中', clientDraftDate: '2026-09-18' }] },
    { id: 'parent-with-children', biz: 'edit', status: '進行中', clientDraftDate: '2026-09-21', subtasks: [{ id: 'child-2', status: '進行中', clientDraftDate: '2026-09-19' }] },
    { id: 'normal', biz: 'edit', status: '進行中', clientDraftDate: '2026-09-22', subtasks: [] },
  ];
  const rows = vm.runInContext(`_caseScheduleRows('clientDraftDate','edit',${JSON.stringify(jobs)})`, context);
  assert.deepEqual(JSON.parse(JSON.stringify(rows.map(row => ({ type: row.type, job: row.job.id, sub: row.sub?.id || null, date: row.date })))), [
    { type: 'sub', job: 'parent-with-mode', sub: 'child-1', date: '2026-09-18' },
    { type: 'sub', job: 'parent-with-children', sub: 'child-2', date: '2026-09-19' },
    { type: 'job', job: 'normal', sub: null, date: '2026-09-22' },
  ]);
});
