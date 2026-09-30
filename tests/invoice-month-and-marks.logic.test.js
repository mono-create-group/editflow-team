const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {extract}=require('./helpers/owner-progress-source.cjs');
function fixture(){
 const jobs=[{id:'edit',biz:'edit',clientId:'client',subtasks:[{id:'sept',title:'dated',unitPrice:4000,invoiceDate:'2026-09-30'},{id:'unset',title:'delivery-only',unitPrice:4000,completedDeliveryDate:'2026-09-11',paidAt:'2026-09-17'}]}, {id:'dispatch',biz:'haken',clientId:'client',unitPrice:6000,invoiceDate:'2026-09-30',paymentTerms:'prepaid'}, {id:'else',biz:'edit',clientId:'other',unitPrice:7000,invoiceDate:'2026-09-30'}, {id:'oct',biz:'haken',clientId:'client',unitPrice:8000,invoiceDate:'2026-10-01'}];
 const c=vm.createContext({S:{jobs,clients:[{id:'client',name:'Client'}]},PBIZ:'edit',window:{},jobBiz:j=>j.biz,_withOwnerJobFinance:j=>j,BJOBS:()=>jobs.filter(j=>j.biz==='edit'),_canViewFinancials:()=>true,_ownerFinanceLedgersReady:()=>true,LEGACY_FINANCE_CORRECTION_WARNINGS:[],_issuer:()=>({name:'Fixture'}),esc:String,secTitle:String,_isOwner:()=>true,today:()=> '2026-09-30',_renderInvoiceEditor:()=>{},_endNextMonth:()=>'',toast:()=>{},bizCfgOf:()=>({label:'other'})});
 for(const n of ['_clientInvoiceJobs','_invoicePrepaid','_invoiceBusinessLabel','_invoiceSubtasks','_invAmt','_invoiceLineName','_subInvoiceDate','_subInvoicedAt','_jobInvDate','_invoiceJobs','rProjInvoice','openInvoiceEditor','_invoiceMarkRefs','_applyInvoiceMarks'])vm.runInContext(extract(n),c);
 return{c,jobs};
}
test('delivery-only and parent dates never imply a child invoice month',()=>{
 const {c,jobs}=fixture();jobs[0].invoiceDate='2026-09-01';
 assert.equal(c._invoiceSubtasks(jobs[0],'2026-09').length,1);
 assert.equal(c._invoiceSubtasks(jobs[0],'unset')[0].sub.id,'unset');
 assert.equal(c._invoiceSubtasks(jobs[0],'dated').length,1);
 assert.equal(c._subInvoiceDate(jobs[0],jobs[0].subtasks[1]),'');
 const standalone={unitPrice:1,deliveryDate:'2026-09-05',completedDeliveryDate:'2026-09-11'};
 assert.equal(c._invoiceSubtasks(standalone,'2026-09').length,0);assert.equal(c._invoiceSubtasks(standalone,'unset').length,1);
});
test('combined draft contains only this client, month, selected lines and correct totals',()=>{
 const {c}=fixture();const before=JSON.stringify(c.S);
 c.openInvoiceEditor('client','2026-09',[{jobId:'edit',subtaskIndex:0},{jobId:'dispatch',subtaskIndex:-1}]);
 assert.equal(c.window._invDraft.items.length,2);assert.equal(c.window._invDraft.items.reduce((s,i)=>s+i.amount,0),10000);
 assert.match(c.window._invDraft.items[0].name,/編集代行/);assert.match(c.window._invDraft.items[1].name,/編集者派遣/);assert.equal(JSON.stringify(c.S),before);
 assert.equal(c.window._invDraft.subtaskRefs[0].subtaskId,'sept');
 c.window._clientInvoiceBiz='haken';assert.equal(c._invoiceJobs('client','2026-09').length,1);
});
test('unset view labels paid state honestly and provides no creation or mark buttons',()=>{
 const {c}=fixture();c.window._invMonth='unset';const html=c.rProjInvoice();
 assert.match(html,/提出日未設定/);assert.match(html,/入金済み 2026-09-17/);assert.match(html,/請求記録なし/);
 assert.doesNotMatch(html,/onclick="openInvoiceEditorFromSelection|onclick="markClientInvoiced/);
 c.window._invMonth='2026-09';assert.doesNotMatch(c.rProjInvoice(),/<b>delivery-only<\/b>/);
});
test('migrated zero-valued raw child marks persist by stable ID without exposing finance or marking other months',()=>{
 const {c,jobs}=fixture();const refs=c._invoiceMarkRefs([jobs[0]],'2026-09');
 const raw=JSON.parse(JSON.stringify(jobs));raw[0].ownerFinanceId='private';raw[0].subtasks.forEach(s=>s.unitPrice=0);raw[0].subtasks.reverse();
 const before=JSON.stringify(raw),next=c._applyInvoiceMarks(raw,refs,'2026-09-30',10);
 assert.equal(next[0].subtasks.find(s=>s.id==='sept').invoicedAt,'2026-09-30');assert.equal(next[0].subtasks.find(s=>s.id==='unset').invoicedAt,undefined);
 assert.equal(next[0].subtasks[0].unitPrice,0);assert.equal(JSON.stringify(raw),before);
 const reloaded=JSON.parse(JSON.stringify(next));assert.equal(c._subInvoicedAt(reloaded[0],reloaded[0].subtasks[1]),'2026-09-30');
 assert.equal(c._applyInvoiceMarks(reloaded,refs,null,11)[0].subtasks[1].invoicedAt,null);
});
test('prepaid rows are automatically invoiced without falsely marking them paid or changing dates',()=>{
 const {c,jobs}=fixture();const before=JSON.stringify(jobs);
 assert.equal(c._subInvoicedAt(jobs[1],jobs[1]),'先払い・自動');
 assert.equal(c._subInvoicedAt({paymentTerms:'prepaid',subtasks:[{}]},{}),'先払い・自動');
 assert.equal(c._subInvoicedAt({paymentTerms:'prepaid',subtasks:[{}]},{paymentTerms:'custom'}),null);
 assert.equal(JSON.stringify(jobs),before);
});
module.exports={fixture};
test('invoice status awaits the server, uses a transaction and leaves local records alone on failure',async()=>{
 const {c,jobs}=fixture();let release,remote=JSON.parse(JSON.stringify(jobs)),writes=0;
 Object.assign(c,{FB_USER:{uid:'owner'},_teamCloudLoaded:true,_fbQuotaBlocked:false,TEAM_SHARE_OK:true,navigator:{onLine:true},_teamSaveInFlight:false,_teamSaveQueued:false,_teamLedgerRestoreAck:'token',crypto:{randomUUID:()=> 'nonce'},firebase:{firestore:{FieldValue:{serverTimestamp:()=> 'server'}}},_teamDecode:JSON.parse,_teamEncode:(_k,v)=>JSON.stringify(v),_lsSaveState:()=>{},_fbFailClosed:()=>{},_teamSave:()=>{throw Error('unexpected retry')},fbDb:{collection:()=>({doc:()=> 'ref'}),runTransaction:async fn=>{await fn({get:async()=>({exists:true,data:()=>({jobs:JSON.stringify(remote),ledgerRestoreToken:'token'})}),set:(_ref,payload)=>{assert.equal(payload.legacyFinanceWriteNonce,'token:nonce');remote=JSON.parse(payload.jobs);writes++;}});await new Promise(r=>release=r);}}});
 vm.runInContext('let _invoiceStatusSaving=false;'+extract('_persistInvoiceMarks'),c);
 const refs=c._invoiceMarkRefs([jobs[0]],'2026-09'),promise=c._persistInvoiceMarks(refs,true);await new Promise(r=>setImmediate(r));
 assert.equal(c.S.jobs[0].subtasks[0].invoicedAt,undefined);assert.equal(await c._persistInvoiceMarks(refs,true),false);
 release();assert.equal(await promise,true);assert.equal(writes,1);assert.equal(c.S.jobs[0].subtasks[0].invoicedAt,'2026-09-30');
 const before=JSON.stringify(c.S);c.fbDb.runTransaction=async()=>{throw Error('offline')};assert.equal(await c._persistInvoiceMarks(refs,false),false);assert.equal(JSON.stringify(c.S),before);
});
