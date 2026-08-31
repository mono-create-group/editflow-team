const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

delete global.EditflowOwnerPerformance;
require(path.join(__dirname, '..', 'owner-video-performance.js'));
const { logic } = global.EditflowOwnerPerformance;

test('three editing targets produce one derived monthly total', () => {
  const totals = logic.goalTotals({
    internalTargetCount: 10, internalTargetAmount: 50000,
    agencyTargetCount: 20, agencyTargetAmount: 20000,
    dispatchTargetCount: 5, dispatchTargetAmount: 30000,
    targetCount: 999, targetAmount: 999999,
  });
  assert.equal(totals.targetCount, 35);
  assert.equal(totals.targetAmount, 100000);
  assert.deepEqual(
    [totals.rows.internal.count, totals.rows.agency.count, totals.rows.dispatch.count],
    [10, 20, 5],
  );
});

test('legacy single target remains editable as editing-agency target', () => {
  const totals = logic.goalTotals({ targetCount: 12, targetAmount: 48000 });
  assert.equal(totals.migratedFromLegacy, true);
  assert.equal(totals.rows.agency.count, 12);
  assert.equal(totals.rows.agency.amount, 48000);
  assert.equal(totals.targetCount, 12);
  assert.equal(totals.targetAmount, 48000);
});

test('normalizes actual delivered units without parent or portal-linked duplicates', () => {
  const units = logic.normalizeWorkUnits(
    [{ id: 'p1', _portalUid: 'u1', linkedLegacyJobId: 'legacy-child', status: '完了', completedDeliveryDate: '2026-08-31', businessType: 'edit_agency' }],
    [
      { id: 'parent', status: '完了', completedDeliveryDate: '2026-08-31', subtasks: [{ id: 'a', status: '完了', completedDeliveryDate: '2026-08-31', workerId: 'w1', businessType: 'edit_agency' }, { id: 'b', portalUid: 'u1', portalJobId: 'p1', status: '完了', completedDeliveryDate: '2026-08-31' }] },
      { id: 'legacy-child', status: '完了', completedDeliveryDate: '2026-08-31' },
      { id: 'not-delivered', status: '完了', completedDeliveryDate: '' },
    ], '__self');
  assert.equal(units.length, 3);
  assert.deepEqual(units.map(x => x.key).sort(), ['legacy:parent:a', 'legacy:not-delivered:parent', 'portal:u1:p1'].sort());
  assert.equal(logic.completedWorkUnits(units).length, 2);
});

test('separates internal, agency and dispatch totals and never turns missing finance into zero', () => {
  const units = logic.normalizeWorkUnits([
    { id: 'i', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-08-01', workerId: '__self', businessType: 'edit_agency' },
    { id: 'a', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-08-02', workerId: 'w', businessType: 'edit_agency' },
    { id: 'h', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-08-03', workerId: 'w2', businessType: 'dispatch' },
  ], [], '__self');
  const joined = logic.joinOwnerFinance(units, [{ portalUid: 'u', portalJobId: 'i', clientUnitPrice: 5000 }, { portalUid: 'u', portalJobId: 'a', clientUnitPrice: 4000 }]);
  const summary = logic.summarizeDelivery(joined, { month: '2026-08' });
  assert.deepEqual([summary.internal.count, summary.agency.count, summary.dispatch.count, summary.all.count], [1, 1, 1, 3]);
  assert.equal(summary.dispatch.amount, 0);
  assert.equal(summary.dispatch.missingAmountCount, 1);
  assert.equal(summary.all.amount, 9000);
});

test('monthly pace produces remaining daily and weekly targets', () => {
  const pace = logic.monthlyPace({ month: '2026-08', targetCount: 31, targetAmount: 31000 }, { count: 11, amount: 11000 }, '2026-08-21');
  assert.equal(pace.remainingCount, 20);
  assert.equal(pace.remainingAmount, 20000);
  assert.equal(pace.remainingDays, 11);
  assert.ok(pace.daily.count > 1.8 && pace.daily.count < 1.9);
  assert.ok(pace.weekly.amount > pace.daily.amount);
});

test('monthly pace uses the derived total from all three editing targets', () => {
  const pace = logic.monthlyPace({
    month: '2026-09',
    internalTargetCount: 10, internalTargetAmount: 50000,
    agencyTargetCount: 20, agencyTargetAmount: 20000,
    dispatchTargetCount: 5, dispatchTargetAmount: 30000,
    targetCount: 999, targetAmount: 999999,
  }, { count: 5, amount: 10000 }, '2026-09-01');
  assert.equal(pace.targetCount, 35);
  assert.equal(pace.targetAmount, 100000);
  assert.equal(pace.remainingCount, 30);
  assert.equal(pace.remainingAmount, 90000);
});

test('dashboard separates today from the monthly automatic delivery totals', () => {
  const portalJobs = [
    { id: 'today', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-08-31', businessType: 'dispatch' },
    { id: 'earlier', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-08-20', businessType: 'dispatch' },
  ];
  const finance = [
    { portalUid: 'u', portalJobId: 'today', clientUnitPrice: 3500 },
    { portalUid: 'u', portalJobId: 'earlier', clientUnitPrice: 4000 },
  ];
  const result = logic.dashboard({ portalJobs, finance, today: '2026-08-31', month: '2026-08' });
  assert.equal(result.todaySummary.all.count, 1);
  assert.equal(result.todaySummary.all.amount, 3500);
  assert.equal(result.monthSummary.all.count, 2);
  assert.equal(result.monthSummary.all.amount, 7500);
});

test('weekly ranking retains missing quality as unevaluated instead of zero quality', () => {
  const units = logic.normalizeWorkUnits([
    { id: 'a', _portalUid: 'u', editorUid: 'e1', editorName: '編集者A', status: '完了', completedDeliveryDate: '2026-08-31', deadline: '2026-08-31' },
    { id: 'b', _portalUid: 'u', editorUid: 'e2', editorName: '編集者B', status: '完了', completedDeliveryDate: '2026-08-31', deadline: '2026-08-30' },
  ]);
  const ranking = logic.weeklyEditorRanking(units, [{ editorUid: 'e1', score: 4 }], { weekStart: '2026-08-31' });
  const b = ranking.find(row => row.editorId === 'e2');
  assert.equal(b.averageQuality, null);
  assert.equal(b.qualityScore, null);
  assert.equal(b.qualityEvaluationRate, 0);
  assert.ok(Number.isFinite(b.score));
});

test('owner write APIs require explicit daily confirmation and validate quality score locally', async () => {
  await assert.rejects(() => global.EditflowOwnerPerformance.confirmDailyCheck({ confirmed: false }), /explicit-owner-confirmation-required/);
  await assert.rejects(() => global.EditflowOwnerPerformance.saveQualityReview({ score: 6 }), /owner-only|invalid-quality-review/);
});

test('quality action escapes its JSON arguments before placing them in HTML', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'owner-video-performance.js'), 'utf8');
  assert.match(source, /const review = .* action = `ownerPerformanceSaveQuality/);
  assert.match(source, /onclick="\$\{escapeHtml\(action\)\}"/);
  assert.doesNotMatch(source, /onclick="ownerPerformanceSaveQuality\(\$\{JSON\.stringify/);
});
