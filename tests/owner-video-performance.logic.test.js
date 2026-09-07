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

test('finance is also found through the linked legacy ledger id of a promoted portal job', () => {
  // 統合済みポータル案件は linkedLegacyJobId しか持たないため、legacy 台帳をこの ID でも探す。
  const units = logic.normalizeWorkUnits([
    { id: 'p1', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-09-02', linkedLegacyJobId: 'L1', businessType: 'edit_agency' },
  ], [], '__self');
  const joined = logic.joinOwnerFinance(units, [{ recordType: 'owner_legacy_finance', legacyJobId: 'L1', parentAmounts: { unitPrice: 3200 } }]);
  assert.equal(joined[0].amount, 3200);
  assert.equal(joined[0].amountSource, 'finance');
  assert.equal(joined[0].amountMissing, false);
});

test('a completed unit without any owner ledger falls back to the caller resolver, then to the job price, never to zero', () => {
  // 派遣以外のポータル案件は owner_job_finance が作られない。クライアント単価表（呼び出し側の解決関数）で
  // 金額を引けるようにし、それも無ければ「金額未設定」のまま残す（0円に化けさせない）。
  const units = logic.normalizeWorkUnits([
    { id: 'agency', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-09-03', businessType: 'edit_agency', clientId: 'c1' },
    { id: 'unpriced', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-09-04', businessType: 'edit_agency', clientId: 'c2' },
  ], [
    { id: 'legacy-own', status: '完了', completedDeliveryDate: '2026-09-05', unitPrice: 2000 },
    { id: 'legacy-zero', status: '完了', completedDeliveryDate: '2026-09-06', unitPrice: 0 },
  ], '__self');
  const resolver = unit => (unit.clientId === 'c1' ? { amount: 2100, source: 'client_rate' } : null);
  const joined = logic.joinOwnerFinance(units, [], { fallbackAmount: resolver });
  const byId = Object.fromEntries(joined.map(unit => [unit.id, unit]));
  assert.deepEqual([byId.agency.amount, byId.agency.amountSource, byId.agency.amountMissing], [2100, 'client_rate', false]);
  assert.deepEqual([byId.unpriced.amount, byId.unpriced.amountMissing], [null, true]);
  assert.deepEqual([byId['legacy-own'].amount, byId['legacy-own'].amountSource], [2000, 'job']);
  assert.equal(byId['legacy-zero'].amountMissing, true, 'a masked 0 unit price on a legacy job is not a confirmed amount');
  const summary = logic.summarizeDelivery(joined, { month: '2026-09' });
  assert.equal(summary.all.amount, 4100);
  assert.equal(summary.all.missingAmountCount, 2);
  assert.equal(logic.missingAmountUnits(joined).length, 2);
  // 解決関数が例外を投げても集計は落とさない。
  const guarded = logic.joinOwnerFinance(units, [], { fallbackAmount: () => { throw new Error('boom'); } });
  assert.equal(guarded.filter(unit => unit.amountMissing).length, 3);
});

test('dashboard forwards the fallback resolver so the gate and page use the same amounts', () => {
  const data = logic.dashboard({
    portalJobs: [{ id: 'agency', _portalUid: 'u', status: '完了', completedDeliveryDate: '2026-09-03', businessType: 'edit_agency' }],
    jobs: [], finance: [], goal: { month: '2026-09', agencyTargetCount: 10, agencyTargetAmount: 50000 }, selfWid: '__self', month: '2026-09', today: '2026-09-06',
    fallbackAmount: () => 2100,
  });
  assert.equal(data.monthSummary.all.amount, 2100);
  assert.equal(data.monthSummary.all.missingAmountCount, 0);
});

test('missing-amount units are listed with a way to open the case instead of a bare count', () => {
  // 会長が「金額未設定が1件」のロック画面から進めなくなった。どの案件かと直す導線を出す。
  const units = logic.joinOwnerFinance(logic.normalizeWorkUnits([
    { id: 'p1', _portalUid: 'u1', status: '完了', completedDeliveryDate: '2026-09-04', businessType: 'edit_agency', title: '17若く見える人と老けて見える人.mp4', editorName: '山田 美咲' },
    { id: 'priced', _portalUid: 'u1', status: '完了', completedDeliveryDate: '2026-09-05', businessType: 'dispatch', title: '金額あり' },
  ], [
    { id: 'L2', status: '完了', completedDeliveryDate: '2026-09-02', title: '旧台帳', subtasks: [{ id: 's1', title: '子1 <案件>', status: '完了', completedDeliveryDate: '2026-09-02' }] },
  ], '__self'), [{ portalUid: 'u1', portalJobId: 'priced', clientUnitPrice: 5000 }]);
  const html = logic.missingAmountListHtml(units);
  assert.match(html, /金額未設定の完了案件 2件/);
  assert.match(html, /17若く見える人と老けて見える人\.mp4/);
  assert.match(html, /山田 美咲/);
  assert.doesNotMatch(html, /金額あり/);
  assert.match(html, /onclick="ownerPerformanceOpenUnit\(&quot;portal:u1:p1&quot;\)"/);
  assert.match(html, /onclick="ownerPerformanceOpenUnit\(&quot;legacy:L2:s1&quot;\)"/);
  // ポータル案件だけクライアント単価表への導線を出す（旧台帳案件は案件モーダルで単価を直す）。
  assert.equal((html.match(/setV\('videoclients'\)/g) || []).length, 1);
  assert.match(html, /子1 &lt;案件&gt;/);
  assert.equal(logic.missingAmountListHtml(units.filter(unit => !unit.amountMissing)), '');
  const legacyUnit = units.find(unit => unit.key === 'legacy:L2:s1');
  assert.deepEqual([legacyUnit.legacyParentId, legacyUnit.legacySubtaskId], ['L2', 's1']);
});

test('the gate and the performance page both render the missing-amount list and expose the open action', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'owner-video-performance.js'), 'utf8');
  assert.match(source, /確認を確定できません。<\/p>\$\{missingAmountListHtml\(data\.monthSummary\.rows\)\}/);
  assert.match(source, /<div class="owner-performance-cards">\$\{cards\}<\/div>\$\{missingAmountListHtml\(data\.monthSummary\.rows\)\}/);
  assert.match(source, /global\.ownerPerformanceOpenUnit = openUnitFromPage;/);
  assert.match(source, /global\.openPortalJobModal\(text\(unit\._portalUid \|\| unit\.portalUid \|\| unit\.editorUid\), text\(unit\.id\)\)/);
  assert.match(source, /global\.openLegacySubcaseDetail\(text\(unit\.legacyParentId\), text\(unit\.legacySubtaskId\)\)/);
  assert.match(source, /global\.openVideoLegacySafeModal\(text\(unit\.legacyParentId\)\)/);
  // 確認の確定条件（金額未設定0件）と Firestore ルールは変えていない。
  assert.match(source, /Number\(summary\.missingAmountCount \|\| 0\) > 0\) throw new Error\('delivery-summary-incomplete'\)/);
  const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  assert.match(index, /fallbackAmount:_ownerPerformanceFallbackAmount\}/);
  assert.match(index, /function _ownerPerformanceFallbackAmount\(unit\)\{[\s\S]*?_ownerPortalClientPricingSnapshot\(job\)/);
  assert.match(index, /return Number\.isInteger\(amount\)&&amount>0\?\{amount,source:'client_rate'\}:null;/);
});
