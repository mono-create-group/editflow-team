const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');

function logic() {
  const start = source.indexOf('  const ymd=value=>');
  const end = source.indexOf('  function ownerClientRateForCase', start);
  assert.ok(start >= 0 && end > start, 'rate selection helpers must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.logic={rateAmount,selectClientRate,rateScopeMatches};`, context);
  return context.logic;
}

function ensureLogic({ owner = true, quotaOpen = false, get } = {}) {
  const start = source.indexOf('  function ensureClientRatesReady(){');
  const end = source.indexOf('  function stopClientRates()', start);
  assert.ok(start >= 0 && end > start, 'one-shot rate loader must exist');
  const context = {
    state: { clientRates: [], clientRatesReady: false, clientRatesLoadPromise: null },
    _isOwner: () => owner,
    window: { EditflowFirestoreQuota: { isOpen: () => quotaOpen } },
    fbDb: { collection: () => ({ get }) },
    quotaSnapshotError: () => false,
    console: { warn() {} },
    renderSafe() {},
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.ensure=ensureClientRatesReady;`, context);
  return context;
}

const client = { id: 'client-1', sourceRecordId: 'client-1', _clientSource: 'projects' };
const rate = (id, effectiveFrom, accountId = '', active = true, revision = 1) => ({
  id, clientSource: 'projects', sourceClientId: 'client-1', accountId, effectiveFrom,
  clientUnitPrice: 3500, editorPayAmount: 3000, active, revision,
});

test('latest active rate on or before the case date is selected', () => {
  const result = logic().selectClientRate([rate('old', '2026-08-01'), rate('new', '2026-09-01')], client, '', '2026-09-10');
  assert.equal(result.id, 'new');
  assert.equal(logic().selectClientRate([rate('future', '2026-09-01')], client, '', '2026-08-31'), null);
});

test('account-specific schedule wins and falls back to client-wide schedule', () => {
  const helpers = logic();
  const rows = [rate('client', '2026-08-01'), rate('account', '2026-08-15', 'account-a')];
  assert.equal(helpers.selectClientRate(rows, client, 'account-a', '2026-09-01').id, 'account');
  assert.equal(helpers.selectClientRate(rows, client, 'account-b', '2026-09-01').id, 'client');
});

test('soft-deactivated rows are ignored and payment validation never turns missing into zero', () => {
  const helpers = logic();
  assert.equal(helpers.selectClientRate([rate('disabled', '2026-08-01', '', false), rate('active', '2026-07-01')], client, '', '2026-09-01').id, 'active');
  assert.equal(helpers.rateAmount('', { allowZero: true }), null);
  assert.equal(helpers.rateAmount(0, { allowZero: true }), 0);
  assert.equal(helpers.rateAmount(0), null);
});

test('schedule UI and mutations are owner-only and never rewrite confirmed job finance', () => {
  for (const name of ['saveClientRate', 'toggleClientRate']) {
    const start = source.indexOf(`function ${name}`);
    const end = source.indexOf('\n  }', start) + 4;
    const body = source.slice(start, end);
    assert.match(body, /if\(!_isOwner\(\)\)/);
    assert.doesNotMatch(body, /owner_job_finance|PORTAL_JOBS\s*=|S\.jobs\s*=/);
  }
  assert.match(source, /owner_client_rates/);
  assert.match(source, /既存案件の金額は変わりません/);
});

test('schedule inputs remain usable on mobile instead of shrinking to spinner width', () => {
  assert.match(source, /\.manager-rate-form\{display:grid/);
  assert.match(source, /\.manager-rate-form\{display:grid;grid-template-columns:minmax\(0,1fr\) minmax\(0,1fr\)/);
  assert.match(source, /\.manager-rate-field-date,\.manager-rate-save\{grid-column:1\/-1\}/);
  assert.match(source, /\.manager-rate-disclosure\{min-width:0;max-width:100%;overflow:hidden\}/);
  assert.match(source, /\.manager-rate-field input\{width:100%;min-width:0;min-height:44px\}/);
  assert.doesNotMatch(source, /\.manager-rate-form\{[^}]*minmax\(170px,1fr\)/);
  assert.match(source, /inputmode="numeric" placeholder="例: 3500"/);
  assert.match(source, /inputmode="numeric" placeholder="例: 3000"/);
  assert.match(source, /function clientsPage\(\)\{ensureManagerResponsiveStyles\(\)/);
});

test('one-shot loader coalesces concurrent calls and fails closed for quota or read errors', async () => {
  let calls = 0;
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const context = ensureLogic({ get: () => { calls += 1; return pending; } });
  const first = context.ensure();
  const second = context.ensure();
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  resolve({ docs: [{ id: 'rate-1', data: () => ({ effectiveFrom: '2026-09-01' }) }] });
  const loaded = await first;
  assert.equal(loaded.ok, true);
  assert.equal(loaded.rates[0].id, 'rate-1');

  const quota = ensureLogic({ quotaOpen: true, get: () => { throw new Error('must not read'); } });
  const quotaResult = await quota.ensure();
  assert.equal(quotaResult.ok, false); assert.equal(quotaResult.error, 'quota-unavailable'); assert.equal(quotaResult.rates.length, 0);
  const failure = ensureLogic({ get: () => Promise.reject(new Error('offline')) });
  const failureResult = await failure.ensure();
  assert.equal(failureResult.ok, false); assert.equal(failureResult.error, 'rates-unavailable'); assert.equal(failureResult.rates.length, 0);
});
