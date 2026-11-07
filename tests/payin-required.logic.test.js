const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {extract}=require('./helpers/owner-progress-source.cjs');
function dom(skip='0'){
 const els={
  'j-payin':{value:'2026-12-25',disabled:false},
  'j-payin-skip':{value:skip},
  'j-payin-skip-btn':{textContent:'',style:{}},
  'j-payin-skip-lbl':{textContent:'',style:{}},
  'j-payin-required':{hidden:false},
 };
 const c=vm.createContext({document:{getElementById:id=>els[id]||null}});
 for(const name of ['updPayinSkipBtn','togglePayinSkip'])vm.runInContext(extract(name),c);
 return{c,els};
}
test('「トライアルのため不要」ON で入金予定日を無効化・クリアし、必須印を隠す。OFFで戻る',()=>{
 const {c,els}=dom();
 c.updPayinSkipBtn();assert.equal(els['j-payin-skip-btn'].textContent,'トライアルのため不要');assert.equal(els['j-payin'].disabled,false);assert.equal(els['j-payin-required'].hidden,false);
 c.togglePayinSkip();assert.equal(els['j-payin-skip'].value,'1');assert.equal(els['j-payin'].disabled,true);assert.equal(els['j-payin'].value,'');assert.equal(els['j-payin-required'].hidden,true);assert.equal(els['j-payin-skip-btn'].textContent,'不要を取り消す');
 c.togglePayinSkip();assert.equal(els['j-payin-skip'].value,'0');assert.equal(els['j-payin'].disabled,false);assert.equal(els['j-payin-required'].hidden,false);
});
test('saveJob は入金予定日を必須にし、不要ONなら免除して paymentNotRequired を保存、サブ案件ありは親で課さない',()=>{
 const src=extract('saveJob');
 assert.match(src,/入金予定日を入力してください/);
 assert.match(src,/!hasSubcaseStructureBeforeFinance&&document\.getElementById\('j-payin'\)&&document\.getElementById\('j-payin-skip'\)\?\.value!=='1'&&!document\.getElementById\('j-payin'\)\?\.value/);
 assert.match(src,/paymentNotRequired:_isOwner\(\)\?\(document\.getElementById\('j-payin-skip'\)\?\.value==='1'\):!!current\?\.paymentNotRequired/);
 assert.match(src,/paymentDate:_isOwner\(\)\?\(document\.getElementById\('j-payin-skip'\)\?\.value==='1'\?null:/);
 assert.match(src,/data\.paymentDate=null;data\.paymentNotRequired=false/);
});
function invoiceDom(terms='custom'){
 const els={
  'j-invoice':{value:'2026-12-01',disabled:false},
  'j-invoice-skip':{value:'0'},
  'j-invoice-skip-btn':{textContent:'',style:{}},
  'j-invoice-skip-lbl':{textContent:'',style:{}},
  'j-invoice-required':{hidden:false},
  'j-payment-terms':{value:terms},
 };
 const c=vm.createContext({document:{getElementById:id=>els[id]||null},_paymentTermsValue:v=>v});
 for(const name of ['updInvoiceSkipBtn','toggleInvoiceSkip'])vm.runInContext(extract(name),c);
 return{c,els};
}
test('請求書提出日も「トライアルのため不要」で無効化・クリア・必須印を隠す。OFFで戻る',()=>{
 const {c,els}=invoiceDom();
 c.updInvoiceSkipBtn();assert.equal(els['j-invoice-skip-btn'].textContent,'トライアルのため不要');assert.equal(els['j-invoice-required'].hidden,false);
 c.toggleInvoiceSkip();assert.equal(els['j-invoice-skip'].value,'1');assert.equal(els['j-invoice'].disabled,true);assert.equal(els['j-invoice'].value,'');assert.equal(els['j-invoice-required'].hidden,true);
 c.toggleInvoiceSkip();assert.equal(els['j-invoice'].disabled,false);assert.equal(els['j-invoice-required'].hidden,false);
 const d=invoiceDom('on_delivery');d.c.updInvoiceSkipBtn();assert.equal(d.els['j-invoice-required'].hidden,true);
});
test('saveJob は請求書提出日の不要を免除・保存し、自動補完でも埋めない。applyPaymentTerms は不要中に上書きしない',()=>{
 const src=extract('saveJob');
 assert.match(src,/document\.getElementById\('j-invoice-skip'\)\?\.value!=='1'&&!document\.getElementById\('j-invoice'\)\?\.value/);
 assert.match(src,/invoiceNotRequired:_isOwner\(\)\?\(document\.getElementById\('j-invoice-skip'\)\?\.value==='1'\):!!current\?\.invoiceNotRequired/);
 assert.match(src,/!data\.invoiceDate&&!data\.invoiceNotRequired&&auto\.invoiceDate/);
 assert.match(extract('applyPaymentTerms'),/invoice&&document\.getElementById\('j-invoice-skip'\)\?\.value!=='1'/);
});
