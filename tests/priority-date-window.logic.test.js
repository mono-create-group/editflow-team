const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function _priorityDateShift(');
const end = html.indexOf('\nfunction rProjPriority()', start);
const helpers = html.slice(start, end);

function group(rows, today = '2026-09-02') {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${helpers}\nthis.result=_priorityRowsByWindow(${JSON.stringify(rows)},${JSON.stringify(today)});`, context);
  return JSON.parse(JSON.stringify(context.result));
}

test('dueOrOverdue includes every dated row through the current day', () => {
  const rows = [
    { id: 'too-old', date: '2026-08-29' },
    { id: 'three-days-ago', date: '2026-08-30' },
    { id: 'two-days-ago', date: '2026-08-31' },
    { id: 'yesterday', date: '2026-09-01' },
    { id: 'today', date: '2026-09-02' },
  ];
  const result = group(rows);
  assert.deepEqual(result.dueOrOverdue.map(row => row.id), ['too-old', 'three-days-ago', 'two-days-ago', 'yesterday', 'today']);
});

test('tomorrow, day after tomorrow, later, and unset stay in their own groups', () => {
  const result = group([
    { id: 'tomorrow', date: '2026-09-03' },
    { id: 'day-after', date: '2026-09-04' },
    { id: 'later', date: '2026-09-12' },
    { id: 'unset', date: '' },
    { id: 'invalid', date: '2026-09-99' },
  ]);
  assert.deepEqual(result.tomorrow.map(row => row.id), ['tomorrow']);
  assert.deepEqual(result.dayAfter.map(row => row.id), ['day-after']);
  assert.deepEqual(result.laterOrUnset.map(row => row.id), ['later', 'unset', 'invalid']);
});

test('priority view excludes completed parents and completed child rows', () => {
  const start = html.indexOf('function rProjPriority()');
  const end = html.indexOf('\nfunction rProjProfit()', start);
  const source = html.slice(start, end);
  assert.match(source, /const rows=_caseScheduleScopedRows\(field\)/);
  assert.match(source, /本日まで/);
  assert.match(source, /最も遠い日付、日付未設定の順に全件表示します/);
});
