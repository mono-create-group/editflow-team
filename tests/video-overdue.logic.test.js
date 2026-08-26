const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');

function source(name) {
  return fs.readFileSync(path.join(root, name), 'utf8');
}

test('manager overdue excludes confirmation and revision statuses', () => {
  const html = source('index.html');
  const setSource = html.match(/const VIDEO_OVERDUE_EXCLUDED_STATUSES=new Set\(\[[^\n]+\]\);/)?.[0];
  const fnSource = html.match(/function _videoIsOverdue\([^]*?\n\}/)?.[0];
  assert.ok(setSource && fnSource, 'manager overdue helper must exist');
  const context = { today: () => '2026-08-26' };
  vm.createContext(context);
  vm.runInContext(`${setSource}\n${fnSource}\nthis.check=_videoIsOverdue;`, context);
  assert.equal(context.check({ deadline: '2026-08-01', status: '確認待ち' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '修正中' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '初稿提出済み' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: 'D確認OK' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '進行中' }, '2026-08-26'), true);
  assert.equal(context.check({ deadline: '2026-08-27', status: '進行中' }, '2026-08-26'), false);
});

test('editor portal uses the same overdue exclusions', () => {
  const html = source('editor.html');
  const setSource = html.match(/const JOB_OVERDUE_EXCLUDED_STATUSES=new Set\(\[[^\n]+\]\);/)?.[0];
  const fnSource = html.match(/function isJobOverdue\([^\n]+/)?.[0];
  assert.ok(setSource && fnSource, 'editor overdue helper must exist');
  const context = { localDate: () => '2026-08-26', jobDelivery: job => job.deliveryDate };
  vm.createContext(context);
  vm.runInContext(`${setSource}\n${fnSource}\nthis.check=isJobOverdue;`, context);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '確認待ち' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '修正中' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '修正稿提出済み' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: 'D確認OK' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '進行中' }, '2026-08-26'), true);
});
