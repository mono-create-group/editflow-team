const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {extract,source}=require('./helpers/owner-progress-source.cjs');
function fixture(owner=true){
 const parent={id:'parent',invoiceDate:'1999-01-01',subtasks:[{id:'one',invoiceDate:'2026-09-30',paymentDate:'2026-10-31',payoutDate:'2026-11-15',dueDate:'2026-10-30',portalUid:'editor',portalJobId:'portal'},{id:'two',invoiceDate:'2026-12-01'}]};
 const c=vm.createContext({S:{jobs:[parent]},_isOwner:()=>owner,esc:v=>String(v).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;'),document:{},toast:()=>{}});
 for(const name of ['_portalFinanceDateTarget','_caseFinanceDatesHtml','openCaseFinanceDates'])vm.runInContext(extract(name),c);
 return{c,parent,job:{_portalUid:'editor',id:'portal',legacyParentId:'parent',legacySubtaskId:'one'}};
}
test('portal detail shows the linked child dates without inheriting parent or sibling finance',()=>{
 const {c,parent,job}=fixture();const before=JSON.stringify(parent),target=c._portalFinanceDateTarget(job),html=c._caseFinanceDatesHtml(target);
 assert.equal(target.record,parent.subtasks[0]);assert.equal(target.index,0);
 for(const date of ['2026-09-30','2026-10-31','2026-11-15','2026-10-30'])assert.ok(html.includes(date));
 for(const date of ['1999-01-01','2026-12-01'])assert.ok(!html.includes(date));
 assert.ok(html.includes('請求・支払の日付を編集'));assert.equal(JSON.stringify(parent),before);
 parent.subtasks[0].paymentDate=null;assert.match(c._caseFinanceDatesHtml(c._portalFinanceDateTarget(job)),/未設定/);
});
test('unlinked, missing child, deleted and reassigned portal records cannot target another ledger',()=>{
 const {c,parent,job}=fixture();
 for(const changed of [{legacySubtaskId:'missing',id:'missing'},{_portalUid:'former'},{legacyParentId:'missing'},{legacyParentId:''}])assert.equal(c._portalFinanceDateTarget({...job,...changed}),null);
 parent.deleted=true;assert.equal(c._portalFinanceDateTarget(job),null);
 assert.match(c._caseFinanceDatesHtml(null),/連携先を確認/);assert.doesNotMatch(c._caseFinanceDatesHtml(null),/onclick=/);
});
test('standalone linked cases show their own dates; directors see no finance section',()=>{
 const {c,parent,job}=fixture();parent.subtasks=[];parent.portalJobId='portal';parent.portalUid='editor';
 assert.equal(c._portalFinanceDateTarget({...job,legacySubtaskId:'',linkedLegacyJobId:'parent'}).record,parent);
 const hidden=fixture(false);assert.equal(hidden.c._portalFinanceDateTarget(hidden.job),null);assert.equal(hidden.c._caseFinanceDatesHtml({record:parent,parent,index:-1}),'');
});
test('edit shortcut expands only the selected child and focuses its existing invoice field',()=>{
 const {c}=fixture();let opened,expanded,focused=0,scrolled=0;
 const field={scrollIntoView(){scrolled++},focus(){focused++}},button={},shell={querySelector:s=>s==='button'?button:field};
 c.openJobModal=id=>opened=id;c.expandJobSubEditor=b=>expanded=b;
 c.document={querySelector:s=>{assert.equal(s,'#j-sub-cont .j-sub-shell[data-state-index="1"]');return shell;},getElementById:()=>field};
 c.openCaseFinanceDates('parent',1);assert.equal(opened,'parent');assert.equal(expanded,button);assert.equal(focused,1);assert.equal(scrolled,1);
 opened=null;c.openCaseFinanceDates('parent',99);assert.equal(opened,null);
});
test('both detail routes use the section; shortcut reuses existing saves and creates no writes or messages',()=>{
 assert.match(extract('openPortalJobModal'),/_caseFinanceDatesHtml\(_portalFinanceDateTarget\(j\)\)/);
 assert.match(extract('openLegacySubcaseDetail'),/financeDates:_caseFinanceDatesHtml/);
 assert.match(extract('_videoSubcaseDetailHtml'),/\$\{financeDates\}/);
 assert.match(extract('_jobModalSubCompactBodyHtml'),/record\?\.payoutDate/);
 for(const name of ['_portalFinanceDateTarget','_caseFinanceDatesHtml','openCaseFinanceDates'])assert.doesNotMatch(extract(name),/fbDb|\.set\(|save\(|sendMessage|fetch\(/);
 // Existing round-trip readers preserve all four fields, including lazily expanded child rows.
 for(const field of ['invoiceDate','paymentDate','payoutDate','dueDate']){
  assert.ok(extract('_readJobSubEditorState').includes(field));assert.ok(extract('saveJob').includes(field));
 }
});
