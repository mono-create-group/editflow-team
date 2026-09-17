const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function _profitSubcaseDate(');
const end = html.indexOf('function isJobPaid(', start);
assert.ok(start >= 0 && end > start, 'profit subcase helpers are present');

const context = vm.createContext({
  SELF_WID: '__self',
  jobMainIn: job => job.unitPrice || 0,
  jobMainOut: job => job.workerPay || 0,
});
vm.runInContext(`${html.slice(start, end)};this.profitRows=_profitSubcaseRows;`, context);

test('profit rows keep each subcase amount and payment month separate', () => {
  const job = {
    title: '9月分',
    subtasks: [
      { title: '胃カメラ洗浄風景', unitPrice: 8000, workerPay: 3000, paymentDate: '2026-09-30' },
      { title: '胃カメラ練習', unitPrice: 4000, workerPay: 1000, paymentDate: '2026-10-31' },
    ],
  };

  assert.deepEqual(
    context.profitRows(job).map(row => [row.title, row.inAmount, row.outAmount, row.paymentDate]),
    [
      ['胃カメラ洗浄風景', 8000, 3000, '2026-09-30'],
      ['胃カメラ練習', 4000, 1000, '2026-10-31'],
    ],
  );
  assert.deepEqual(context.profitRows(job, '2026-09').map(row => row.title), ['胃カメラ洗浄風景']);
  assert.deepEqual(context.profitRows(job, '2026-10').map(row => row.title), ['胃カメラ練習']);
});

test('profit rows keep the parent fallback for standalone jobs', () => {
  const rows = context.profitRows({ title: '親案件のみ', unitPrice: 5000, workerPay: 1200, paymentDate: '2026-09-30' });
  assert.equal(JSON.stringify(rows.map(row => [row.index, row.title, row.inAmount, row.outAmount, row.paymentDate])), JSON.stringify([
    [-1, '親案件のみ', 5000, 1200, '2026-09-30'],
  ]));
});

test('profit page renders parent and subcase financial rows', () => {
  assert.match(html, /親案件 \/ サブ案件/);
  assert.match(html, /_profitSubcaseRows\(j,curM\)/);
  assert.match(html, /入金予定日はサブ案件ごと/);
  assert.match(html, /_profitGroupedHtml\(jobs,groupMode,curM\)/);
});
