const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function _invoiceSubtasks(');
const end = html.indexOf('function _subInvoiceDate(', start);
assert.ok(start >= 0 && end > start, 'invoice aggregation helpers are present');

const context = vm.createContext({});
vm.runInContext(`${html.slice(start, end)};this.invoiceSubtasks=_invoiceSubtasks;this.invoiceAmount=_invAmt;this.invoiceLineName=_invoiceLineName;`, context);

test('parent price is adopted when the job has no subcases', () => {
  const job = { title: 'サッカーカップル', unitPrice: 3000, subtasks: [] };
  const rows = context.invoiceSubtasks(job);

  assert.equal(rows.length, 1);
  assert.equal(rows[0].index, -1);
  assert.equal(rows[0].sub.title, 'サッカーカップル');
  assert.equal(context.invoiceAmount(job), 3000);
  assert.equal(context.invoiceLineName(job, rows[0].sub, rows[0].index), 'サッカーカップル');
});

test('priced subcases take precedence over the parent price', () => {
  const job = {
    title: '8月分',
    unitPrice: 9000,
    subtasks: [
      { title: '動画A', unitPrice: 3000 },
      { title: '動画B', unitPrice: 3000 },
    ],
  };

  assert.deepEqual(
    context.invoiceSubtasks(job).map(row => [row.index, row.sub.title, row.sub.unitPrice]),
    [[0, '動画A', 3000], [1, '動画B', 3000]],
  );
  assert.equal(context.invoiceAmount(job), 6000);
  assert.equal(context.invoiceLineName(job, job.subtasks[0], 0), '8月分（動画A）');
});

test('a parent price is not substituted when unpriced subcases exist', () => {
  const job = { title: '8月分', unitPrice: 6000, subtasks: [{ title: '動画A', unitPrice: 0 }] };

  assert.equal(context.invoiceSubtasks(job).length, 0);
  assert.equal(context.invoiceAmount(job), 0);
});

test('the invoice page explains the parent-only fallback and keeps version caches aligned', () => {
  assert.match(html, /サブ案件がない場合は親案件の単価を採用します/);
  assert.match(html, /parentOnly\?'親案件':'サブ案件'/);
  assert.match(html, /請求明細 \$\{invoiceRows\.length\}件・合計/);
  assert.match(html, /選択した明細で請求書を作成/);
  assert.match(html, /index===-1&&_invoiceSubtasks\(_withOwnerJobFinance\(j\)\)\.some\(x=>x\.index===-1\)/);
  assert.match(html, /const APP_VERSION='20260902-14'/);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  assert.match(sw, /const CACHE='mcshanai-20260902-14'/);
});
