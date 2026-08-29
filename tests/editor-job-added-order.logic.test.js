const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

function addedOrderSorter() {
  const groupText = features.match(/function editorGroupText\([^\n]+/)?.[0];
  const sorter = features.match(/function editorJobSortByAddedOrder\([^\n]+/)?.[0];
  assert.ok(groupText && sorter, 'added-order helpers must remain extractable');
  const context = {
    tsValue(value) {
      if (typeof value === 'number') return value;
      if (value && typeof value.toMillis === 'function') return value.toMillis();
      return Date.parse(value || '') || 0;
    },
  };
  vm.createContext(context);
  vm.runInContext(`${groupText}\n${sorter}\nthis.sortAdded=editorJobSortByAddedOrder;`, context);
  return jobs => Array.from(context.sortAdded(jobs));
}

test('assigned children use their persisted addition index instead of deadline order', () => {
  const sort = addedOrderSorter();
  const result = sort([
    { id: 'c', title: 'third', subtaskIndex: 2, editorDraftDate: '2026-08-01' },
    { id: 'a', title: 'first', subtaskIndex: 0, editorDraftDate: '2026-09-01' },
    { id: 'b', title: 'second', subtaskIndex: 1, editorDraftDate: '2026-08-15' },
  ]);
  assert.deepEqual(result.map(job => job.id), ['a', 'b', 'c']);
  assert.match(features, /jobs:editorJobSortByAddedOrder\(group\.jobs\)/);
  assert.match(features, /editorGroupNext\(group\)[^]*editorJobSortByDeadline\(group\.jobs\)\[0\]/);
});

test('existing Wako records without an index fall back to natural case-number order', () => {
  const sort = addedOrderSorter();
  const createdAt = '2026-08-29T02:10:29.164Z';
  const result = sort([
    { id: 'x3', title: 'WD-S085', createdAt },
    { id: 'x2', title: 'WD-S084', createdAt },
    { id: 'x1', title: 'WD-S078', createdAt },
  ]);
  assert.deepEqual(result.map(job => job.title), ['WD-S078', 'WD-S084', 'WD-S085']);
});

test('separately added legacy-free jobs keep chronological creation order', () => {
  const sort = addedOrderSorter();
  const result = sort([
    { id: 'later', title: 'A', createdAt: '2026-08-29T02:00:00Z' },
    { id: 'earlier', title: 'Z', createdAt: '2026-08-28T02:00:00Z' },
  ]);
  assert.deepEqual(result.map(job => job.id), ['earlier', 'later']);
});

test('all creation and synchronization routes persist the child position', () => {
  assert.match(features, /subcases\.items\.forEach\(\(subcase,subtaskIndex\)=>/);
  assert.match(features, /parentCaseId,parentCaseName,subtaskIndex,clientId/);
  assert.match(features, /subtaskIndex:Number\.isInteger\(board\.subtaskIndex\)\?board\.subtaskIndex:0/);
  assert.match(features, /siblings=editorJobSortByAddedOrder\(/);
  assert.match(manager, /subcases\.items\.forEach\(\(subcase,subtaskIndex\)=>/);
  assert.match(manager, /parentCaseId,parentCaseName,subtaskIndex,clientId/);
  assert.match(index, /subtaskIndex:index,setter,draft,status/);
  assert.match(index, /title,subtaskIndex:item\.subtaskIndex,clientDisplay/);
});

test('Firestore accepts only a bounded integer addition index', () => {
  assert.match(rules, /function validSubtaskIndex\(data\)/);
  assert.match(rules, /data\.subtaskIndex is int && data\.subtaskIndex >= 0 && data\.subtaskIndex < 500/);
  assert.ok((rules.match(/'subtaskIndex'/g) || []).length >= 4);
  assert.ok((rules.match(/validSubtaskIndex\(request\.resource\.data\)/g) || []).length >= 4);
});
