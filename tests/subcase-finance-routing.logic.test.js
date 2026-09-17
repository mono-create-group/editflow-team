const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
  const start = index.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = index.indexOf('{', start);
  let depth = 0;
  let quote = '';
  let escaped = false;
  for (let i = open; i < index.length; i += 1) {
    const ch = index[i];
    if (quote) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}' && --depth === 0) return index.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

test('subcase mode routes finance fields away from the parent case', () => {
  const mode = functionSource('setJobSubcaseMode');
  assert.match(mode, /jf-parent-finance/);
  assert.match(mode, /請求・支払情報/);

  const modal = index;
  assert.match(modal, /id="jf-parent-finance"/);
  assert.match(modal, /各サブ案件の請求・支払欄へ入力してください/);
  assert.match(modal, /class="j-sub-payment-terms"/);
  assert.match(modal, /class="j-sub-invoice"/);
  assert.match(modal, /class="j-sub-due"/);
  assert.match(modal, /class="j-sub-payment"/);
  assert.match(modal, /class="j-sub-payout"/);
  assert.match(modal, /class="j-sub-paid-val"/);
});

test('subcase finance dates auto-calculate and persist on the subcase', () => {
  const apply = functionSource('applyJobSubPaymentTerms');
  assert.match(apply, /_billingDatesForTerms\(terms/);
  assert.match(apply, /j-sub-invoice/);
  assert.match(apply, /j-sub-due/);

  const reader = functionSource('_readJobSubEditorState');
  assert.match(reader, /const paymentTerms=row\.querySelector\('\.j-sub-payment-terms'\)/);
  assert.match(reader, /paidAt=row\.querySelector\('\.j-sub-paid-val'\)/);

  const saver = functionSource('saveJob');
  assert.match(saver, /const paymentTerms=el\.querySelector\('\.j-sub-payment-terms'\)/);
  assert.match(saver, /paidAt=el\.querySelector\('\.j-sub-paid-val'\)/);
  assert.match(saver, /data\.paymentTerms='custom';data\.invoiceDate=null;data\.dueDate=null;data\.paymentDate=null;data\.paidAt=null;data\.payoutDate=null/);
});

test('invoice listing and editor use subcase billing dates without parent fallback', () => {
  const invoiceDate = functionSource('_subInvoiceDate');
  assert.match(invoiceDate, /sub\.invoiceDate/);
  assert.match(invoiceDate, /!Array\.isArray\(j\.subtasks\)\|\|!j\.subtasks\.length/);
  assert.doesNotMatch(invoiceDate, /sub\.invoiceDate\|\|j\.invoiceDate/);

  const jobDate = functionSource('_jobInvDate');
  assert.match(jobDate, /if\(subtasks\.length\)/);
  assert.match(jobDate, /s\.invoiceDate\|\|s\.completedDeliveryDate\|\|s\.deliveryDate/);

  const editor = functionSource('openInvoiceEditor');
  assert.match(editor, /sub\.dueDate/);
  assert.match(editor, /selectedRows/);
});

test('parent payment state reflects subcase payment state when subcases exist', () => {
  const paid = functionSource('isJobPaid');
  assert.match(paid, /subs\.length\?subs\.every\(s=>!!s\.paidAt\)/);
  const mark = functionSource('markJobPaid');
  assert.match(mark, /j\.subtasks\.forEach\(s=>\{s\.paidAt=at;\}\)/);
  const month = functionSource('_jobPaymentDate');
  assert.match(month, /s\.paymentDate/);
});
