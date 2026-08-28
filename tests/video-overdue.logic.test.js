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
  const exemptSource = html.match(/function _videoDeadlineExemptStatus\([^\n]+/)?.[0];
  const fnSource = html.match(/function _videoIsOverdue\([^]*?\n\}/)?.[0];
  assert.ok(setSource && exemptSource && fnSource, 'manager overdue helper must exist');
  const context = { today: () => '2026-08-26' };
  vm.createContext(context);
  vm.runInContext(`${setSource}\n${exemptSource}\n${fnSource}\nthis.check=_videoIsOverdue;`, context);
  assert.equal(context.check({ deadline: '2026-08-01', status: '確認待ち' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '修正中' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '初稿提出済み' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: 'D確認OK' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '初稿完成' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: 'FB待ち' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '納品' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '納品済み' }, '2026-08-26'), false);
  assert.equal(context.check({ deadline: '2026-08-01', status: '進行中' }, '2026-08-26'), true);
  assert.equal(context.check({ deadline: '2026-08-27', status: '進行中' }, '2026-08-26'), false);
});

test('editor portal uses the same overdue exclusions', () => {
  const html = source('editor.html');
  const setSource = html.match(/const JOB_OVERDUE_EXCLUDED_STATUSES=new Set\(\[[^\n]+\]\);/)?.[0];
  const exemptSource = html.match(/function isJobDeadlineExemptStatus\([^\n]+/)?.[0];
  const fnSource = html.match(/function isJobOverdue\([^\n]+/)?.[0];
  assert.ok(setSource && exemptSource && fnSource, 'editor overdue helper must exist');
  const context = { localDate: () => '2026-08-26', jobDelivery: job => job.deliveryDate };
  vm.createContext(context);
  vm.runInContext(`${setSource}\n${exemptSource}\n${fnSource}\nthis.check=isJobOverdue;`, context);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '確認待ち' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '修正中' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '修正稿提出済み' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: 'D確認OK' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '初稿完成' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: 'FB待ち' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '納品' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '納品済み' }, '2026-08-26'), false);
  assert.equal(context.check({ deliveryDate: '2026-08-01', status: '進行中' }, '2026-08-26'), true);
});

test('manager deadline notifications do not label review or delivered work as overdue', () => {
  const html = source('index.html');
  const setSource = html.match(/const VIDEO_OVERDUE_EXCLUDED_STATUSES=new Set\(\[[^\n]+\]\);/)?.[0];
  const exemptSource = html.match(/function _videoDeadlineExemptStatus\([^\n]+/)?.[0];
  const start = html.indexOf('function _videoNotificationItems(');
  const end = html.indexOf('\nfunction openVideoNotification(', start);
  const fnSource = start >= 0 && end > start ? html.slice(start, end) : '';
  assert.ok(setSource && exemptSource && fnSource, 'manager notification helper must exist');
  const context = {
    PBIZ: 'edit',
    S: { jobs: [
      { id: 'revision', title: '修正中', status: '修正中', editorDraftDate: 'past', biz: 'edit' },
      { id: 'delivered', title: '納品済み', status: '納品済み', deliveryDate: 'past', biz: 'edit' },
      { id: 'active', title: '進行中', status: '進行中', deliveryDate: 'past', biz: 'edit' },
      { id: 'revision-upcoming', title: '修正中の期日予告', status: '修正中', deliveryDate: 'future', biz: 'edit' },
    ] },
    PORTAL_JOBS: [
      { id: 'portal-review', _portalUid: 'u1', title: 'FB待ち', status: 'FB待ち', deliveryDate: 'past', businessType: 'edit_agency' },
    ],
    jobBiz: () => 'edit',
    _portalVideoBiz: () => 'edit',
    daysUntil: value => value === 'past' ? -5 : 1,
    _canViewFinancials: () => false,
  };
  vm.createContext(context);
  vm.runInContext(`${setSource}\n${exemptSource}\n${fnSource}\nthis.items=_videoNotificationItems('edit');`, context);
  const overdueIds = context.items.filter(item => item.remaining < 0).map(item => item.jobId);
  assert.deepEqual([...overdueIds], ['active']);
  assert.equal(context.items.some(item => item.jobId === 'revision-upcoming' && item.timing === '明日'), true);
});
