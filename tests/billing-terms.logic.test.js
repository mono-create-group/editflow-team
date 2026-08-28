const test=require('node:test');
const assert=require('node:assert/strict');
const billing=require('../billing-terms.js');

test('delivery on or before the 25th is invoiced on that month 25th and paid next month end',()=>{
  assert.deepEqual({...billing.forCompletedDelivery('2026-08-25')},{
    completedDeliveryDate:'2026-08-25',
    invoiceMonth:'2026-08',
    invoiceAvailableOn:'2026-08-25',
    paymentDueDate:'2026-09-30',
  });
});

test('delivery after the 25th is invoiced next month 25th and paid the following month end',()=>{
  assert.deepEqual({...billing.forCompletedDelivery('2026-08-26')},{
    completedDeliveryDate:'2026-08-26',
    invoiceMonth:'2026-09',
    invoiceAvailableOn:'2026-09-25',
    paymentDueDate:'2026-10-31',
  });
});

test('year changes and leap-year month ends are calculated without local-time drift',()=>{
  assert.equal(billing.forCompletedDelivery('2026-12-26').invoiceAvailableOn,'2027-01-25');
  assert.equal(billing.forCompletedDelivery('2026-12-26').paymentDueDate,'2027-02-28');
  assert.equal(billing.forCompletedDelivery('2028-01-26').paymentDueDate,'2028-03-31');
});

test('invalid or missing actual delivery dates cannot receive billing terms',()=>{
  for(const value of ['',null,'2026-02-30','2026/08/25'])assert.equal(billing.forCompletedDelivery(value),null);
});
