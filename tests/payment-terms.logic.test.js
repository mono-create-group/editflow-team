const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');

function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  let depth=0,opened=false;
  for(let i=start;i<html.length;i+=1){
    if(html[i]==='{'){depth+=1;opened=true;}
    if(html[i]==='}'&&opened&&--depth===0)return html.slice(start,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}
function constSource(name){
  const start=html.indexOf(`const ${name}=`),end=html.indexOf('];',start);
  assert.ok(start>=0&&end>start,`${name} must be defined`);
  return html.slice(start,end+2);
}

function makeContext(){
  const context={today:()=>'2026-09-06'};
  vm.createContext(context);
  vm.runInContext([constSource('PAYMENT_TERMS'),functionSource('_paymentTermsValue'),functionSource('_paymentTermsLabel'),functionSource('_addDaysIso'),functionSource('_hkMonthEnd'),functionSource('_billingDatesForTerms'),'this.dates=_billingDatesForTerms;this.value=_paymentTermsValue;this.label=_paymentTermsLabel;'].join('\n'),context);
  return context;
}

test('payment terms cover prepaid, on-delivery, month-end, next-month-end and manual entry',()=>{
  const c=makeContext();
  assert.deepEqual(['prepaid','on_delivery','month_end','next_month_end','custom'].map(v=>c.value(v)),['prepaid','on_delivery','month_end','next_month_end','custom']);
  assert.equal(c.value('unknown'),'custom');
  assert.equal(c.value(undefined),'custom','jobs saved before this feature keep their manually entered dates');
  assert.match(c.label('prepaid'),/先払い/);
  assert.match(c.label('on_delivery'),/納品時/);
});

test('prepaid bills at the order date and is due a week later, even before delivery',()=>{
  const c=makeContext();
  assert.deepEqual({...c.dates('prepaid',{sharedDate:'2026-09-10',deliveryDate:'',completedDeliveryDate:''})},{invoiceDate:'2026-09-10',dueDate:'2026-09-17'});
  assert.deepEqual({...c.dates('prepaid',{sharedDate:'',deliveryDate:'',completedDeliveryDate:''})},{invoiceDate:'2026-09-06',dueDate:'2026-09-13'},'falls back to today when no order date is recorded');
});

test('delivery-based terms stay empty until a delivery date exists, then derive the dates',()=>{
  const c=makeContext();
  for(const terms of ['on_delivery','month_end','next_month_end']){
    assert.deepEqual({...c.dates(terms,{sharedDate:'2026-09-01',deliveryDate:'',completedDeliveryDate:''})},{invoiceDate:'',dueDate:''});
  }
  assert.deepEqual({...c.dates('on_delivery',{sharedDate:'2026-09-01',deliveryDate:'2026-09-20',completedDeliveryDate:'2026-09-18'})},{invoiceDate:'2026-09-18',dueDate:'2026-09-25'},'the actual delivery date wins over the planned one');
  assert.deepEqual({...c.dates('month_end',{sharedDate:'',deliveryDate:'2026-09-20',completedDeliveryDate:''})},{invoiceDate:'2026-09-20',dueDate:'2026-09-30'});
  assert.deepEqual({...c.dates('next_month_end',{sharedDate:'',deliveryDate:'2026-09-20',completedDeliveryDate:''})},{invoiceDate:'2026-09-20',dueDate:'2026-10-31'});
  assert.deepEqual({...c.dates('next_month_end',{sharedDate:'',deliveryDate:'2026-01-31',completedDeliveryDate:''})},{invoiceDate:'2026-01-31',dueDate:'2026-02-28'});
  assert.equal(c.dates('custom',{sharedDate:'2026-09-01',deliveryDate:'2026-09-20'}),null,'manual entry is never overwritten');
});

test('the job modal offers the terms, recomputes on date changes, and the save path fills empty dates',()=>{
  assert.match(html,/<select id="j-payment-terms" onchange="applyPaymentTerms\(\)">/);
  assert.match(html,/id="j-shared" value="\$\{j\?\.sharedDate\|\|''\}" onchange="applyPaymentTerms\(\)"/);
  assert.match(html,/id="j-deliver" value="\$\{j\?\.deliveryDate\|\|''\}" onchange="applyPaymentTerms\(\)"/);
  assert.match(html,/id="j-completed-delivery"[^>]*onchange="applyPaymentTerms\(\)"/);
  assert.match(functionSource('jobStatusChanged'),/applyPaymentTerms\(\)/);
  assert.match(functionSource('saveJob'),/paymentTerms:_isOwner\(\)\?_paymentTermsValue\(/);
  assert.match(functionSource('saveJob'),/if\(!data\.invoiceDate&&auto\.invoiceDate\)data\.invoiceDate=auto\.invoiceDate;if\(!data\.dueDate&&auto\.dueDate\)data\.dueDate=auto\.dueDate;/);
  assert.match(functionSource('saveJob'),/!\['on_delivery','month_end','next_month_end'\]\.includes\(paymentTermsChoice\)\)\{toast\('請求書提出日を入力してください/);
  const apply=functionSource('applyPaymentTerms');
  assert.match(apply,/if\(terms==='custom'\)return;/,'manual dates are left alone');
});
