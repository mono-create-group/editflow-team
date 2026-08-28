const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('manager derives invoice month and payment date only from actual delivery', () => {
  assert.match(index, /billing-terms\.js\?v=/);
  assert.match(index, /_portalBillingTerms\(j\.completedDeliveryDate\)/);
  assert.match(index, /data\.payableMonth=billingTerms\?\.invoiceMonth\|\|''/);
  assert.match(index, /invoiceAvailableOn:billingTerms\.invoiceAvailableOn/);
  assert.match(index, /paymentDueDate:billingTerms\.paymentDueDate/);
  assert.doesNotMatch(index, /j\.payableMonth\|\|j\.deadline/);
});

test('editor invoice dates are fixed to the calculated billing schedule', () => {
  assert.match(editor, /invoiceReadyOn\(terms\)/);
  assert.match(editor, /issueDate:terms\.invoiceAvailableOn/);
  assert.match(editor, /dueDate:terms\.paymentDueDate/);
  assert.match(editor, /invoiceAvailableOn:terms\.invoiceAvailableOn/);
  assert.match(editor, /paymentDueDate:terms\.paymentDueDate/);
});

test('rules reject invoices whose issue and payment dates differ from authorization', () => {
  assert.match(rules, /get\(path\)\.data\.invoiceAvailableOn == request\.resource\.data\.invoiceAvailableOn/);
  assert.match(rules, /get\(path\)\.data\.paymentDueDate == request\.resource\.data\.paymentDueDate/);
  assert.match(rules, /request\.resource\.data\.issueDate == request\.resource\.data\.invoiceAvailableOn/);
  assert.match(rules, /request\.resource\.data\.dueDate == request\.resource\.data\.paymentDueDate/);
});
