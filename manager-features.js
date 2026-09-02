(function(){
  'use strict';
  const state={editors:[],catalog:new Map(),catalogRepairing:new Set(),assignmentSyncing:new Set(),invoiceActionPending:new Set(),board:[],boardFormOpen:false,manuals:[],schedules:[],suggestions:[],invoices:[],authorizations:[],profiles:[],clientPricing:new Map(),clientPricingReady:false,clientRates:[],clientRatesReady:false,clientRatesUnsub:null,clientRatesLoadPromise:null,portalJobsByEditor:new Map(),loaded:{editors:false,portalJobs:new Set()},unsubs:[],nested:[],started:'',portalSignature:null,renderFrame:null,lifecycleTimer:null};
  const originalVideoOperations=rVideoOperations;
  const originalWorkers=rWorkers;
  // index.html の既存クライアント操作を安全に拡張する。案件・履歴はこの処理で触らない。
  const originalSaveClient=window.saveClient;
  const originalConfirmDelClient=window.confirmDelClient;
  const DIRECT_ALL_ID='__direct_all__';
  const isDirector=()=>hasAppRole('動画編集ディレクター')&&!_isOwner();
  const canManage=()=>_isOwner()||hasAppRole('動画編集ディレクター');
  const quotaSnapshotError=(error,scope,fallback)=>{
    if(window.EditflowFirestoreQuota?.handle?.(error,`manager ${scope}`))return true;
    if(typeof fallback==='function')fallback(error);else console.warn(scope,error?.code||error);
    return false;
  };
  const safeId=()=>crypto.randomUUID?crypto.randomUUID():'id-'+Date.now()+'-'+Math.random().toString(16).slice(2);
  function legacyClients(){const rows=((S&&S.clients)||[]).filter(x=>!x.deleted).map(c=>({...c,_clientSource:'projects',sourceRecordId:c.id}));((S&&S.crmClients)||[]).filter(x=>!x.deleted).forEach(c=>{const found=rows.find(x=>nameKey(x.name)===nameKey(c.name));if(found){found._crmRecordId=c.id;found.accounts=mergeAccounts(found.accounts||[],c.accounts||[]);found.contact=found.contact||c.contact||'';found.phone=found.phone||c.phone||'';found.email=found.email||c.email||'';found.instagram=found.instagram||c.instagram||'';found.contractNote=found.contractNote||c.contractNote||'';found.bu=found.bu||c.bu||'';found.crmStatus=c.status||''}else rows.push({...c,id:`crm:${c.id}`,_clientSource:'crm',sourceRecordId:c.id,notes:c.contractNote||c.note||'',crmStatus:c.status||'',isTrial:['見込み','商談中'].includes(c.status)})});return rows}
  const legacyWorkers=()=>((S&&S.workers)||[]).filter(x=>!x.deleted);
  const linkedWorker=e=>legacyWorkers().find(w=>w.id===e?.workerId);
  const editorName=e=>e?.name||linkedWorker(e)?.name||e?.email||'編集者';
  const catalogsFor=uid=>state.catalog.get(uid)||[];
  const editorOptions=()=>state.editors.filter(x=>rolesGrantVideoEditor(x.roles||[])).map(x=>`<option value="${esc(x.id)}">${esc(editorName(x))} / ${x.editorKind==='external'?'外部':'直接'}</option>`).join('');
  const timestamp=v=>v&&typeof v.toMillis==='function'?v.toMillis():Number(v||0);
  const invoiceIncludedTax=(gross,rate)=>{const amount=Math.round(Number(gross)||0),percent=Number(rate)||0;return percent>0?Math.round(amount*percent/(100+percent)):0};
  const invoiceTaxInclusiveTotals=(lines=[])=>{const grossByRate={};let total=0;(lines||[]).forEach(line=>{const amount=Math.round(Number(line?.amount)||0),rate=Number(line?.taxRate)||0;total+=amount;grossByRate[rate]=(grossByRate[rate]||0)+amount});const taxByRate=Object.fromEntries(Object.entries(grossByRate).map(([rate,gross])=>[rate,invoiceIncludedTax(gross,Number(rate))])),tax=Object.values(taxByRate).reduce((sum,value)=>sum+Number(value||0),0);return{subtotal:total-tax,taxByRate,tax,total}};
  const weekdayLabels=['月','火','水','木','金','土','日'];
  function dateAtNoon(value){const d=new Date(`${value}T12:00:00`);return Number.isNaN(d.getTime())?new Date():d}
  function localYmd(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function addDays(value,n){const d=dateAtNoon(value);d.setDate(d.getDate()+n);return localYmd(d)}
  function currentWeekDates(){const d=dateAtNoon(today()),offset=(d.getDay()+6)%7;d.setDate(d.getDate()-offset);const start=localYmd(d);return Array.from({length:7},(_,i)=>addDays(start,i))}
  function scheduleDays(record){const dates=currentWeekDates();if(Array.isArray(record?.days)&&record.weekStart===dates[0])return dates.map((date,i)=>{const x=record.days.find(v=>v?.date===date)||record.days[i]||{};return{date,status:['available','consult','unavailable'].includes(x.status)?x.status:'unavailable',startTime:x.startTime||'',endTime:x.endTime||'',capacity:Number(x.capacity||0),workType:x.workType||'both',note:x.note||''}});if(record?.routineEnabled&&Array.isArray(record.routine))return dates.map((date,i)=>{const x=record.routine.find(v=>Number(v?.weekday)===i+1)||{};return{date,status:['available','consult','unavailable'].includes(x.status)?x.status:'unavailable',startTime:x.startTime||'',endTime:x.endTime||'',capacity:Number(x.capacity||0),workType:x.workType||'both',note:x.note||''}});return dates.map(date=>({date,status:record?.available===false?'unavailable':'consult',startTime:'',endTime:'',capacity:0,workType:record?.workType||'both',note:record?.note||''}))}
  const nameKey=v=>String(v||'').trim().toLocaleLowerCase('ja-JP');
  function mergeAccounts(...groups){
    const rows=[],byId=new Map(),byName=new Map();
    groups.flat().filter(Boolean).forEach(value=>{
      const raw=typeof value==='string'?{name:value}:value,name=String(raw?.name||'').trim();if(!name)return;
      const id=String(raw?.id||`name:${name}`),key=nameKey(name),same=byId.get(id)||byName.get(key),formerNames=[...new Set((Array.isArray(raw?.formerNames)?raw.formerNames:[]).map(x=>String(x||'').trim()).filter(Boolean))];
      if(same){same.formerNames=[...new Set([...(same.formerNames||[]),...formerNames])];return;}
      const row={id,name};if(raw?.active===false)row.active=false;if(formerNames.length)row.formerNames=formerNames;
      rows.push(row);byId.set(id,row);byName.set(key,row);
    });
    return rows;
  }
  function accountHiddenNames(client){const hidden=new Set();(client?.accounts||[]).forEach(a=>{(a?.formerNames||[]).forEach(x=>hidden.add(nameKey(x)));if(a?.active===false)hidden.add(nameKey(a?.name))});return hidden}
  function visibleAccounts(accounts,hidden=new Set()){return mergeAccounts(accounts||[]).filter(a=>a.active!==false&&!hidden.has(nameKey(a.name)))}
  function accountMatches(a,target){return!!(a&&target&&(String(a.id||'')===String(target.id||'')||nameKey(a.name)===nameKey(target.name)))}
  function editAccountList(accounts,target,newName){
    const rows=(accounts||[]).map(a=>typeof a==='string'?{id:`name:${a}`,name:a}:{...a,formerNames:Array.isArray(a.formerNames)?[...a.formerNames]:[]}),idx=rows.findIndex(a=>accountMatches(a,target)),next=String(newName||'').trim();
    if(!next)return rows;
    const current=idx>=0?rows[idx]:{id:target?.id||`name:${target?.name||next}`,name:target?.name||next,formerNames:[]},oldName=String(current.name||target?.name||'').trim();
    current.name=next;current.active=true;current.formerNames=[...new Set([...(current.formerNames||[]),oldName].filter(x=>x&&nameKey(x)!==nameKey(next)))];
    if(idx<0)rows.push(current);return rows;
  }
  function deleteAccountList(accounts,target){
    const rows=(accounts||[]).map(a=>typeof a==='string'?{id:`name:${a}`,name:a}:{...a,formerNames:Array.isArray(a.formerNames)?[...a.formerNames]:[]}),idx=rows.findIndex(a=>accountMatches(a,target));
    if(idx>=0)rows[idx].active=false;else if(target?.name)rows.push({id:target.id||`name:${target.name}`,name:target.name,active:false,formerNames:[]});return rows;
  }
  function addOrReviveAccount(accounts,account){
    const rows=(accounts||[]).map(a=>typeof a==='string'?{id:`name:${a}`,name:a}:{...a,formerNames:Array.isArray(a.formerNames)?[...a.formerNames]:[]}),idx=rows.findIndex(a=>nameKey(a.name)===nameKey(account?.name));
    if(idx>=0){rows[idx].active=true;rows[idx].name=account.name;rows[idx].formerNames=(rows[idx].formerNames||[]).filter(x=>nameKey(x)!==nameKey(account.name));return rows;}
    rows.push({id:account?.id||safeId(),name:account?.name||'',active:true,formerNames:[]});return rows;
  }
  function masterAccounts(client){const related=[...state.catalog.values()].flat().filter(c=>(c.sourceClientId&&c.sourceClientId===client.id)||nameKey(c.name)===nameKey(client.name)),jobs=(PORTAL_JOBS||[]).filter(j=>nameKey(j.clientDisplay||j.clientName)===nameKey(client.name)).map(j=>{const name=j.accountDisplay||j.accountName;return name?{id:j.accountId||`name:${name}`,name}:null}).filter(Boolean);return visibleAccounts(mergeAccounts(client.accounts||[],related.flatMap(c=>c.accounts||[]),jobs),accountHiddenNames(client))}
  function clientSourceRecord(client){return client?client._clientSource==='crm'?((S&&S.crmClients)||[]).find(c=>c.id===client.sourceRecordId):((S&&S.clients)||[]).find(c=>c.id===client.sourceRecordId||c.id===client.id):null}
  // client_catalog is readable by its assigned editor.  Pricing therefore
  // lives in the separate owner_client_pricing collection, never in the
  // legacy client record nor the editor-visible catalog document.
  const ownerPriceInputId=(clientId,accountId='default')=>`manager-client-price-${String(clientId||'').replace(/[^A-Za-z0-9_-]/g,'_')}-${String(accountId||'default').replace(/[^A-Za-z0-9_-]/g,'_')}`;
  const ownerPricingDocId=client=>`${client?._clientSource||'projects'}_${String(client?.sourceRecordId||client?.id||'').replace(/\//g,'_')}`;
  function priceValue(value){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isFinite(n)&&n>=0?Math.round(n):null}
  function accountPriceMap(record){const raw=record?.accountUnitPrices;return raw&&typeof raw==='object'&&!Array.isArray(raw)?raw:{}}
  function clientUnitPriceFor(client,accountId=''){
    const record=state.clientPricing.get(ownerPricingDocId(client))||{},map=accountPriceMap(record),key=String(accountId||'');
    if(key&&Object.prototype.hasOwnProperty.call(map,key))return priceValue(map[key]);
    return priceValue(record?.defaultClientUnitPrice);
  }
  function ownerClientUnitPrice(clientId,accountId=''){
    if(!_isOwner())return null;
    const client=legacyClients().find(row=>String(row.id)===String(clientId)||String(row.sourceRecordId||'')===String(clientId));
    return client?clientUnitPriceFor(client,accountId):null;
  }
  function ownerClientAccounts(clientId){
    if(!_isOwner())return[];
    const lookup=String(clientId||''),client=legacyClients().find(row=>String(row.id)===lookup||String(row.sourceRecordId||'')===lookup);
    return client?masterAccounts(client).map(account=>({id:String(account.id||''),name:String(account.name||'')})).filter(account=>account.id&&account.name):[];
  }
  function ownerClientPricingSnapshot(clientId,accountId=''){
    if(!_isOwner()||!state.clientPricingReady)return null;
    const lookup=String(clientId||''),clients=legacyClients();
    let client=clients.find(row=>String(row.id)===lookup||String(row.sourceRecordId||'')===lookup);
    if(!client&&lookup){
      const key=nameKey(lookup),matches=clients.filter(row=>nameKey(row.name)===key||(row.formerNames||[]).some(name=>nameKey(name)===key));
      if(matches.length===1)client=matches[0];
    }
    if(!client)return null;
    const pricingId=ownerPricingDocId(client),record=state.clientPricing.get(pricingId)||{},prices=accountPriceMap(record),key=String(accountId||''),hasAccount=!!key&&Object.prototype.hasOwnProperty.call(prices,key),amount=hasAccount?priceValue(prices[key]):priceValue(record.defaultClientUnitPrice);
    return{amount,pricingId,pricingSource:hasAccount?'account_master':'master',pricingRevision:Number(record.revision||0),pricingUpdatedAt:record.updatedAt||null,sourceClientId:String(client.sourceRecordId||client.id||''),clientSource:String(client._clientSource||'projects')};
  }
  const ymd=value=>/^\d{4}-\d{2}-\d{2}$/.test(String(value||''))?String(value):'';
  function rateAmount(value,{allowZero=false}={}){if(value===null||value===undefined||String(value).trim()==='')return null;const n=Number(value);return Number.isInteger(n)&&(allowZero?n>=0:n>0)?n:null}
  function rateScopeMatches(rate,client,accountId=''){
    if(!rate||rate.active===false)return false;
    if(String(rate.sourceClientId||'')!==String(client?.sourceRecordId||client?.id||''))return false;
    if(String(rate.clientSource||'projects')!==String(client?._clientSource||'projects'))return false;
    return String(rate.accountId||'')===String(accountId||'');
  }
  // Pure and intentionally independent from Firestore.  A matching account
  // row wins; otherwise the client-wide row is used.  A future-effective row
  // never leaks backwards into a past case.
  function selectClientRate(rates,client,accountId='',caseDate=''){
    const cutoff=ymd(caseDate);if(!client||!cutoff)return null;
    const rows=(Array.isArray(rates)?rates:[]).filter(rate=>rateScopeMatches(rate,client,accountId)&&ymd(rate.effectiveFrom)&&rate.effectiveFrom<=cutoff).sort((a,b)=>String(b.effectiveFrom).localeCompare(String(a.effectiveFrom))||Number(b.revision||0)-Number(a.revision||0)||String(b.id||'').localeCompare(String(a.id||'')));
    if(rows[0])return{...rows[0],pricingSource:accountId?'account_schedule':'client_schedule'};
    if(accountId)return selectClientRate(rates,client,'',caseDate);
    return null;
  }
  function ownerClientRateForCase(clientId,accountId='',caseDate=''){
    if(!_isOwner()||!state.clientRatesReady)return null;
    const client=legacyClients().find(row=>String(row.id)===String(clientId)||String(row.sourceRecordId||'')===String(clientId));
    return client?selectClientRate(state.clientRates,client,accountId,caseDate):null;
  }
  function clientRatesFor(client,accountId=''){
    return state.clientRates.filter(rate=>rateScopeMatches(rate,client,accountId)).sort((a,b)=>String(b.effectiveFrom||'').localeCompare(String(a.effectiveFrom||''))||Number(b.revision||0)-Number(a.revision||0));
  }
  function startClientRates(){
    if(!_isOwner()||!FB_USER||state.clientRatesUnsub)return;
    state.clientRatesReady=false;
    state.clientRatesUnsub=fbDb.collection('owner_client_rates').onSnapshot(q=>{state.clientRates=q.docs.map(d=>({id:d.id,...d.data()}));state.clientRatesReady=true;renderSafe()},error=>quotaSnapshotError(error,'owner client rates',err=>{state.clientRates=[];state.clientRatesReady=false;console.warn('owner client rates',err?.code||err);renderSafe()}));
  }
  // This is deliberately a one-shot read, not a startup listener.  Finance
  // creation may happen before the owner has visited the client screen.
  // Callers must treat {ok:false} and a missing selected rate as a hard stop.
  function ensureClientRatesReady(){
    if(!_isOwner())return Promise.resolve({ok:false,error:'owner-required',rates:[]});
    if(window.EditflowFirestoreQuota?.isOpen?.())return Promise.resolve({ok:false,error:'quota-unavailable',rates:[]});
    if(state.clientRatesReady)return Promise.resolve({ok:true,rates:state.clientRates.slice()});
    if(state.clientRatesLoadPromise)return state.clientRatesLoadPromise;
    state.clientRatesLoadPromise=fbDb.collection('owner_client_rates').get().then(snapshot=>{
      state.clientRates=snapshot.docs.map(doc=>({id:doc.id,...doc.data()}));state.clientRatesReady=true;
      return{ok:true,rates:state.clientRates.slice()};
    }).catch(error=>{
      quotaSnapshotError(error,'owner client rates one-shot',err=>console.warn('owner client rates one-shot',err?.code||err));
      state.clientRates=[];state.clientRatesReady=false;
      return{ok:false,error:'rates-unavailable',rates:[]};
    }).finally(()=>{state.clientRatesLoadPromise=null;renderSafe()});
    return state.clientRatesLoadPromise;
  }
  function stopClientRates(){if(state.clientRatesUnsub){try{state.clientRatesUnsub()}catch(_){}}state.clientRatesUnsub=null;state.clientRatesLoadPromise=null;state.clientRates=[];state.clientRatesReady=false}
  function clientsForEditor(uid){const rows=catalogsFor(uid).map(c=>({...c,catalogId:c.id,id:c.sourceClientId||c.id,accounts:visibleAccounts(c.accounts||[])}));if(_isOwner())legacyClients().forEach(c=>{const found=rows.find(x=>(x.sourceClientId&&x.sourceClientId===c.id)||nameKey(x.name)===nameKey(c.name)),accounts=masterAccounts(c);if(found)found.accounts=accounts;else rows.push({id:c.id,sourceClientId:c.id,name:c.name,accounts})});return rows}

  function stopNested({preserveOwnerPortalData=false,resetPricing=true}={}){
    state.nested.forEach(x=>{try{x()}catch(_){}});state.nested=[];state.catalog.clear();state.catalogRepairing.clear();state.assignmentSyncing.clear();
    if(!preserveOwnerPortalData){state.invoices=[];state.authorizations=[];state.profiles=[];state.portalJobsByEditor.clear();state.loaded.portalJobs.clear()}
    if(resetPricing){state.clientPricing.clear();state.clientPricingReady=false}
  }
  function cancelManagerRender(){if(state.renderFrame===null)return;if(typeof cancelAnimationFrame==='function')cancelAnimationFrame(state.renderFrame);else clearTimeout(state.renderFrame);state.renderFrame=null}
  function stop(){state.unsubs.forEach(x=>{try{x()}catch(_){}});state.unsubs=[];stopClientRates();stopNested();state.loaded.editors=false;state.started='';state.portalSignature=null;cancelManagerRender()}
  window.EditflowFirestoreQuota?.registerStop?.(stop);
  function renderSafe(){
    if(state.renderFrame!==null)return;
    const run=()=>{state.renderFrame=null;try{renderSyncSafe()}catch(_){try{render()}catch(__){}}};
    state.renderFrame=typeof requestAnimationFrame==='function'?requestAnimationFrame(run):setTimeout(run,0);
  }
  function portalSubscriptionSignature(editors){return(editors||[]).map(editor=>`${String(editor?.id||'')}:${editor?.editorKind==='external'?'external':'direct'}:${String(editor?.directorUid||'')}`).sort().join('|')}
  function ownerBridgeSnapshot(){
    const bridge=window.EditflowOwnerDataBridge;
    return _isOwner()&&bridge&&typeof bridge.snapshot==='function'?bridge.snapshot():null;
  }
  function hydrateOwnerBridge(snapshot){
    if(!_isOwner()||!snapshot||snapshot.owner!==true)return false;
    const ready=snapshot.ready||{},nextEditors=(ready.access?Array.isArray(snapshot.accessRecords)?snapshot.accessRecords:[]:[]).filter(x=>x&&x.approved===true&&rolesGrantVideoEditor(x.roles||[])),nextSignature=portalSubscriptionSignature(nextEditors);
    state.editors=nextEditors;state.loaded.editors=ready.access===true;
    state.invoices=ready.invoices&&Array.isArray(snapshot.portalInvoices)?snapshot.portalInvoices.slice():[];
    state.authorizations=ready.authorizations&&Array.isArray(snapshot.portalAuthorizations)?snapshot.portalAuthorizations.slice():[];
    state.profiles=ready.profiles&&Array.isArray(snapshot.portalProfiles)?snapshot.portalProfiles.slice():[];
    state.portalJobsByEditor.clear();state.loaded.portalJobs.clear();
    if(ready.jobs&&Array.isArray(snapshot.portalJobs)){
      snapshot.portalJobs.forEach(job=>{const uid=String(job?._portalUid||'');if(!uid)return;const rows=state.portalJobsByEditor.get(uid)||[];rows.push(job);state.portalJobsByEditor.set(uid,rows)});
      nextEditors.forEach(editor=>state.loaded.portalJobs.add(editor.id));
    }
    if(nextSignature!==state.portalSignature){state.portalSignature=nextSignature;subscribePortals()}
    renderSafe();return true;
  }
  function subscribePortals(){
    const owner=_isOwner();
    // オーナーは index.html の collection-group 購読結果を使う。ここで残すのは
    // 各編集者へ公開する client_catalog だけで、jobs/invoices/profile/auth は再購読しない。
    stopNested({preserveOwnerPortalData:owner,resetPricing:false});
    state.editors.forEach(e=>{
      const root=fbDb.collection('editor_portals').doc(e.id);
      // 閲覧や再接続で台帳を修復しない。カタログの一括同期はオーナーが明示的に
      // 「直接契約編集者へ一括同期」を押した場合だけ書き込む。
      state.nested.push(root.collection('client_catalog').onSnapshot(q=>{const catalogs=q.docs.map(d=>({id:d.id,...d.data()}));state.catalog.set(e.id,catalogs);renderSafe()},x=>quotaSnapshotError(x,'catalog')));
      if(owner)return;
      state.nested.push(root.collection('editor_jobs').onSnapshot(q=>{state.portalJobsByEditor.set(e.id,q.docs.map(d=>({id:d.id,_portalUid:e.id,...d.data()})));state.loaded.portalJobs.add(e.id);renderSafe()},x=>quotaSnapshotError(x,'portal jobs',err=>{state.loaded.portalJobs.delete(e.id);console.warn('portal jobs',err?.code||err);renderSafe()})));
      if(e.editorKind!=='external'){
        state.nested.push(root.collection('editor_invoices').onSnapshot(q=>{state.invoices=state.invoices.filter(x=>x._portalUid!==e.id).concat(q.docs.map(d=>({id:d.id,_portalUid:e.id,...d.data()})));renderSafe()},x=>quotaSnapshotError(x,'invoice')));
        state.nested.push(root.collection('invoice_authorizations').onSnapshot(q=>{state.authorizations=state.authorizations.filter(x=>x._portalUid!==e.id).concat(q.docs.map(d=>({id:d.id,_portalUid:e.id,...d.data()})));renderSafe()},x=>quotaSnapshotError(x,'authorization')));
        state.nested.push(root.collection('editor_profile').doc('self').onSnapshot(d=>{state.profiles=state.profiles.filter(x=>x._portalUid!==e.id);if(d.exists)state.profiles.push({id:d.id,_portalUid:e.id,...d.data()});renderSafe()},x=>quotaSnapshotError(x,'profile')));
      }
    });
    // ディレクター本人の請求・精算だけは、配下編集者とは別に本人ポータルから読む。
    // 旧台帳や他ディレクターのポータルには触れない。
    if(isDirector()&&FB_USER?.uid){
      const uid=FB_USER.uid,root=fbDb.collection('editor_portals').doc(uid);
      state.nested.push(root.collection('editor_invoices').onSnapshot(q=>{state.invoices=state.invoices.filter(x=>x._portalUid!==uid).concat(q.docs.map(d=>({id:d.id,_portalUid:uid,...d.data()})));renderSafe()},x=>quotaSnapshotError(x,'director invoice')));
      state.nested.push(root.collection('invoice_authorizations').onSnapshot(q=>{state.authorizations=state.authorizations.filter(x=>x._portalUid!==uid).concat(q.docs.map(d=>({id:d.id,_portalUid:uid,...d.data()})));renderSafe()},x=>quotaSnapshotError(x,'director authorization')));
      state.nested.push(root.collection('editor_profile').doc('self').onSnapshot(d=>{state.profiles=state.profiles.filter(x=>x._portalUid!==uid);if(d.exists)state.profiles.push({id:d.id,_portalUid:uid,...d.data()});renderSafe()},x=>quotaSnapshotError(x,'director profile')));
    }
  }
  function start(){
    if(window.EditflowFirestoreQuota?.isOpen?.()||!FB_USER||!ACCESS_RESOLVED||!canManage()||state.started===FB_USER.uid)return;
    stop();state.started=FB_USER.uid;
    if(_isOwner()){
      const bridge=window.EditflowOwnerDataBridge;
      if(!bridge||typeof bridge.subscribe!=='function'){console.warn('owner portal bridge unavailable');state.loaded.editors=false;renderSafe();return}
      state.unsubs.push(bridge.subscribe(snapshot=>hydrateOwnerBridge(snapshot)));
    }else{
      const aq=fbDb.collection('access').where('directorUid','==',FB_USER.uid);
      state.unsubs.push(aq.onSnapshot(q=>{const nextEditors=q.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.approved===true&&rolesGrantVideoEditor(x.roles||[])),nextSignature=portalSubscriptionSignature(nextEditors);state.editors=nextEditors;state.loaded.editors=true;if(nextSignature!==state.portalSignature){state.portalSignature=nextSignature;subscribePortals()}renderSafe()},e=>quotaSnapshotError(e,'editor relations',err=>{state.loaded.editors=false;console.warn('editor relations',err?.code||err);renderSafe()})));
    }
    const bq=_isOwner()?fbDb.collection('editor_job_board'):fbDb.collection('editor_job_board').where('directorUid','==',FB_USER.uid);
    state.unsubs.push(bq.onSnapshot(q=>{state.board=q.docs.map(d=>({id:d.id,...d.data()}));renderSafe()},e=>quotaSnapshotError(e,'manager board')));
    const mq=_isOwner()?fbDb.collection('editor_manuals'):fbDb.collection('editor_manuals').where('directorUid','==',FB_USER.uid);
    state.unsubs.push(mq.onSnapshot(q=>{state.manuals=q.docs.map(d=>({id:d.id,...d.data()}));renderSafe()},e=>quotaSnapshotError(e,'manager manuals')));
    if(_isOwner())state.unsubs.push(fbDb.collection('owner_client_pricing').onSnapshot(q=>{state.clientPricing=new Map(q.docs.map(d=>[d.id,{id:d.id,...d.data()}]));state.clientPricingReady=true;renderSafe()},e=>quotaSnapshotError(e,'owner client pricing',err=>{state.clientPricing.clear();state.clientPricingReady=false;console.warn('owner client pricing',err?.code||err);renderSafe()})));
    state.unsubs.push(fbDb.collection('editor_schedules').onSnapshot(q=>{state.schedules=q.docs.map(d=>({id:d.id,...d.data()}));renderSafe()},e=>quotaSnapshotError(e,'manager schedules')));
    if(_isOwner())state.unsubs.push(fbDb.collection('editor_suggestions').orderBy('createdAt','desc').limit(100).onSnapshot(q=>{state.suggestions=q.docs.map(d=>({id:d.id,...d.data()}));renderSafe()},e=>quotaSnapshotError(e,'suggestions')));
  }

  const activeManagerUid=()=>typeof rolePreviewUid==='function'?rolePreviewUid():(FB_USER?.uid||'');
  const managedEditors=()=>state.editors.filter(x=>rolesGrantVideoEditor(x.roles||[])).filter(x=>!isDirector()||x.id===activeManagerUid()||x.directorUid===activeManagerUid());
  const managedJobs=()=>(PORTAL_JOBS||[]).filter(j=>_isOwner()||j._portalUid===activeManagerUid()||j.directorUid===activeManagerUid());
  function normalizeChatworkName(value){return String(value||'').normalize('NFKC').replace(/[\s\u3000]+/g,'').toLocaleLowerCase('ja-JP')}
  function legacyAssignmentCount(editor){
    if(!_isOwner())return 0;
    const workerId=editor?.workerId;if(!workerId)return 0;
    return ((S&&S.jobs)||[]).filter(j=>!j.deleted).reduce((total,j)=>{
      const parent=(Array.isArray(j.workerIds)?j.workerIds:[j.workerId]).filter(Boolean).includes(workerId)?1:0;
      const children=(j.subtasks||[]).filter(s=>s&&!s.deleted&&s.workerId===workerId).length;
      return total+parent+children;
    },0);
  }
  function legacySyncEntriesForEditor(editor){
    if(!_isOwner())return[];
    const workerId=String(editor?.workerId||'');if(!workerId)return[];
    return ((S&&S.jobs)||[]).filter(parent=>parent&&!parent.deleted&&['edit','haken'].includes(jobBiz(parent))).flatMap(parent=>{
      const children=(parent.subtasks||[]).filter(child=>child&&!child.deleted),parentWorkers=[...new Set([...(Array.isArray(parent.workerIds)?parent.workerIds:[]),parent.workerId].filter(Boolean).map(String))],inherited=parentWorkers.length===1?parentWorkers[0]:'';
      const records=children.length?children:[parent];
      return records.filter(record=>{
        if(['完了','キャンセル'].includes(String(record.status||parent.status||'')))return false;
        if(children.length&&!String(record.id||'').trim())return false;
        const explicit=String(record.workerId||'');const assigned=explicit&&explicit!==SELF_WID?explicit:inherited;return assigned===workerId;
      }).map(record=>({parent,record}));
    });
  }
  function legacyUnlinkedEntriesForEditor(editor){
    const portalIds=new Set((state.portalJobsByEditor.get(editor?.id)||[]).map(job=>String(job.id||'')));
    return legacySyncEntriesForEditor(editor).filter(({record})=>!record.portalUid||!record.portalJobId||!portalIds.has(String(record.portalJobId)));
  }
  function canSyncLegacyForEditor(){return _isOwner()}
  function editorStatus(editor){
    const directorView=isDirector(),worker=directorView?null:linkedWorker(editor),permissionNormal=!!(editor?.approved===true&&rolesGrantVideoEditor(editor.roles||[])&&(directorView||!!(editor.workerId&&worker)));
    const portalReady=state.loaded.portalJobs.has(editor.id),portalCount=portalReady?(state.portalJobsByEditor.get(editor.id)||[]).length:null;
    const legacyCount=legacyAssignmentCount(editor),legacyUnlinkedCount=_isOwner()&&portalReady?legacyUnlinkedEntriesForEditor(editor).length:null,jobCount=portalCount===null?null:portalCount+(_isOwner()?legacyUnlinkedCount:0);
    const chatworkName=String(editor?.chatworkName||'').trim(),chatworkVerified=!!editor?.chatworkNameVerifiedAt;
    const chatwork=(!chatworkVerified||!chatworkName)?'pending':normalizeChatworkName(editor.name)===normalizeChatworkName(chatworkName)?'match':'mismatch';
    return{worker,permissionNormal,portalReady,portalCount,legacyCount,legacyUnlinkedCount,jobCount,chatwork,chatworkName};
  }
  function statusBadge(label,tone='bg'){return`<span class="badge ${tone}" style="font-size:10px">${esc(label)}</span>`}
  const portalJobBiz=j=>j.businessType==='dispatch'||(!j.businessType&&j.source==='direct_client')?'haken':j.businessType==='edit_agency'||(!j.businessType&&j.source==='job_board')?'edit':'edit';
  function page(title,description,body){return`<div class="ph"><div><div class="ph-title">${title}</div><div style="font-size:12px;color:var(--t2)">${description}</div></div></div><div class="card">${body}</div>`}
  function empty(message){return`<div style="padding:14px;text-align:center;color:var(--t3);font-size:12px">${message}</div>`}
  function block(title,body){return`<div style="border-top:1px solid var(--border);padding-top:12px;margin-top:14px"><div style="font-size:13px;font-weight:800;margin-bottom:8px">${title}</div>${body}</div>`}
  function ensureManagerResponsiveStyles(){
    if(document.getElementById('manager-responsive-styles'))return;
    const style=document.createElement('style');style.id='manager-responsive-styles';style.textContent=`
      .manager-relation-row{display:grid;grid-template-columns:minmax(180px,1.4fr) minmax(130px,.8fr) minmax(160px,1fr) auto;gap:8px;align-items:end;margin-bottom:10px;padding:10px;border:1px solid var(--border);border-radius:10px;background:var(--card2)}
      .manager-relation-editor{min-width:0;align-self:center}.manager-relation-editor b,.manager-relation-editor span{overflow-wrap:anywhere}
      .manager-relation-field{display:grid;gap:4px;min-width:0;font-size:14px;font-weight:800;color:#475569}
      .manager-relation-field select{min-height:44px;min-width:0;background:var(--card)}
      .manager-relation-save{min-height:44px;justify-content:center;white-space:nowrap}
      .manager-state-guidance{margin-top:7px;padding:8px 9px;border-left:3px solid var(--purple);border-radius:6px;background:#faf5ff;color:#475569;font-size:14px;line-height:1.55}
      .manager-state-guidance b{color:#5b21b6}
      .manager-board-subcase-scroll{grid-column:1/-1;min-width:0;max-height:min(68vh,760px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;border:1px solid var(--border);border-radius:12px;background:var(--card)}
      .manager-board-subcase-list{display:grid;gap:8px;min-width:0;padding:10px}.manager-board-subcase{min-width:0}
      .manager-board-subcase-add{position:sticky;bottom:0;z-index:3;display:flex;min-width:0;padding:10px;border-top:1px solid var(--border);background:var(--card);box-shadow:0 -8px 18px rgba(15,23,42,.08)}
      .manager-board-subcase-add .btn{width:100%;min-width:0;min-height:44px;justify-content:center}
      .manager-rate-form{display:grid;grid-template-columns:minmax(170px,1fr) minmax(130px,1fr) minmax(130px,1fr) auto;gap:6px;align-items:end}
      .manager-rate-field{display:grid;gap:3px;min-width:0;font-size:10px;color:var(--t2)}
      .manager-rate-field input{width:100%;min-width:0}
      .manager-rate-save{min-height:44px;white-space:nowrap}
      .manager-rate-row{display:grid;grid-template-columns:92px minmax(0,1fr) minmax(0,1fr) auto;gap:6px;align-items:center;padding:6px 0;border-top:1px solid var(--border);font-size:11px}
      @media(max-width:700px){.manager-relation-row{grid-template-columns:1fr;gap:10px;padding:12px}.manager-relation-field{font-size:14px}.manager-relation-field select,.manager-relation-save{width:100%;min-height:48px;font-size:14px}.manager-state-guidance{font-size:14px;padding:8px 9px}.manager-board-subcase-scroll{max-height:60vh}.manager-board-subcase-add{padding:9px}.manager-board-subcase-add .btn{min-height:48px}.manager-rate-form{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 8px}.manager-rate-field-date,.manager-rate-save{grid-column:1/-1}.manager-rate-field{font-size:12px}.manager-rate-field input{min-height:48px;font-size:16px}.manager-rate-save{width:100%;min-height:48px;justify-content:center}.manager-rate-row{grid-template-columns:1fr 1fr}.manager-rate-row>span:first-child{grid-column:1/-1;font-weight:800}.manager-rate-row>.btn{justify-self:end}.manager-rate-row-meta{grid-column:1/-1!important}}
    `;document.head.appendChild(style);
  }
  function relationHtml(editors){
    ensureManagerResponsiveStyles();
    const directors=(ACCESS_RECORDS||[]).filter(x=>x.approved===true&&(x.roles||[]).includes('動画編集ディレクター'));
    return block('契約区分と担当ディレクター',editors.map(e=>`<div class="manager-relation-row"><div class="manager-relation-editor"><b>${esc(editorName(e))}</b><div style="font-size:10px;color:var(--t3)">${esc(e.email||'')}</div></div><label class="manager-relation-field" for="rel-kind-${e.id}"><span>契約区分</span><select id="rel-kind-${e.id}" onchange="managerRelationToggle('${e.id}')"><option value="direct" ${e.editorKind!=='external'?'selected':''}>mono.create直接</option><option value="external" ${e.editorKind==='external'?'selected':''}>外部編集者</option></select></label><label class="manager-relation-field" for="rel-dir-${e.id}"><span>担当ディレクター</span><select id="rel-dir-${e.id}" ${e.editorKind==='external'?'':'disabled'}><option value="">担当ディレクターを選択</option>${directors.map(d=>`<option value="${d.id}" ${e.directorUid===d.id?'selected':''}>${esc(d.name||d.email||d.id)}</option>`).join('')}</select></label><button class="btn btn-g manager-relation-save" onclick="managerSaveRelation('${e.id}')">保存</button></div>`).join('')||'<div style="font-size:11px;color:var(--t3)">動画編集者の承認後に設定できます。</div>');
  }
  function catalogHtml(editors){const choices=_isOwner()?legacyClients():editors.flatMap(e=>catalogsFor(e.id)).filter((c,i,a)=>a.findIndex(x=>nameKey(x.name)===nameKey(c.name))===i),directCount=state.editors.filter(e=>e.editorKind!=='external').length;return block('既存クライアントを編集者へ共有',`<div style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:7px"><select id="mc-editor"><option value="">利用する編集者</option>${editors.map(e=>`<option value="${e.id}">${esc(editorName(e))}</option>`).join('')}</select><select id="mc-client"><option value="">既存クライアントを選択</option>${choices.map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select><input id="mc-account" maxlength="100" placeholder="アカウント名（任意）"><button class="btn btn-p btn-sm" onclick="managerSaveCatalog()">共有・追加</button></div><div style="display:flex;gap:7px;align-items:center;flex-wrap:wrap;margin-top:7px"><span style="font-size:10.5px;color:var(--t3)">クライアント名は既存台帳から引き継ぎます。アカウント名は必要な場合だけ追加します。</span>${_isOwner()?`<button class="btn btn-g btn-sm" onclick="managerSyncMasterCatalog()">直接契約編集者 ${directCount}名へ一括同期</button><button class="btn btn-g btn-sm" onclick="openClientModal()">＋ 新しいクライアント</button>`:''}</div>`)}
  function boardSubcaseRowHtml(key=safeId(),value={}){
    const attachments=Array.isArray(value.attachments)?value.attachments:[],attachmentListId=`mb-subcase-attachments-${key}`;
    const editorDraftDateSetter=value.editorDraftDateSetter==='editor'?'editor':'creator',editorDraftDate=editorDraftDateSetter==='creator'?(value.editorDraftDate||''):'';
    const manualOptions=boardManualOptions(value.manualIds||[],value._manualTarget,value._openAll);
    // This board is read by editors and directors.  It deliberately contains
    // no money fields: client prices and settlements stay in owner-only ledgers.
    return`<section class="manager-board-subcase" data-subcase-id="${esc(key)}" style="grid-column:1/-1;border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--card2)"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><b>子案件</b><button type="button" class="btn btn-g btn-xs" onclick="managerRemoveBoardSubcase(this)">この子案件を削除</button></div><div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px"><input class="mb-subcase-title" maxlength="120" value="${esc(value.title||'')}" placeholder="個別動画・案件名 *"><label style="font-size:10px">編集者初稿の設定者<select class="mb-subcase-draft-setter" onchange="managerBoardDraftSetterChanged(this)"><option value="creator" ${editorDraftDateSetter==='creator'?'selected':''}>案件追加者が設定</option><option value="editor" ${editorDraftDateSetter==='editor'?'selected':''}>担当編集者が設定</option></select></label><label style="font-size:10px">編集者初稿<input class="mb-subcase-draft" type="date" value="${esc(editorDraftDate)}" ${editorDraftDateSetter==='editor'?'disabled':''}></label><label style="font-size:10px">クライアント初稿<input class="mb-subcase-client-draft" type="date" value="${esc(value.clientDraftDate||'')}"></label><label style="font-size:10px">納期（予定・任意）<input class="mb-subcase-delivery" type="date" value="${esc(value.deliveryDate||'')}"></label><div class="notice" style="grid-column:1/-1;box-shadow:none;font-size:12px;line-height:1.6"><b>編集代行の完了はDまたはオーナーが記録します</b><br>先方OK後、実際の納品日と納品先URLを進捗操作で記録すると報酬対象になります。</div><textarea class="mb-subcase-instructions" maxlength="3000" placeholder="編集指示 *" style="grid-column:1/-1;min-height:76px">${esc(value.instructions||'')}</textarea><label style="font-size:10px">この子案件だけのマニュアル（任意）<select class="mb-subcase-manuals" multiple size="3" aria-label="この子案件だけのマニュアル">${manualOptions}</select><span style="color:var(--t3)">選ばない場合は親案件の共通マニュアルを表示します。</span></label><label style="font-size:10px">この子案件だけの注意事項（任意）<textarea class="mb-subcase-caution" maxlength="2000" placeholder="選ばない場合は親案件の注意事項を表示します。">${esc(value.caution||'')}</textarea></label><label style="font-size:10px">この子案件だけの台本・依頼URL（任意）<input class="mb-subcase-request" type="url" value="${esc(value.requestUrl||'')}" placeholder="空欄なら親案件の共通リンクを使用"></label><label style="font-size:10px">この子案件だけの素材URL（任意）<input class="mb-subcase-source" type="url" value="${esc(value.sourceUrl||'')}" placeholder="空欄なら親案件の共通リンクを使用"></label></div>${typeof _videoAttachmentEditorHtml==='function'?_videoAttachmentEditorHtml(attachments,`addVideoAttachmentRow(document.getElementById('${attachmentListId}'))`,attachmentListId):''}</section>`;
  }
  function selectedManualIds(select){return[...(select?.selectedOptions||[])].map(option=>String(option.value||'').trim()).filter(Boolean).filter((value,index,values)=>values.indexOf(value)===index).slice(0,20)}
  const combinedManualIds=(...groups)=>[...new Set(groups.flat().map(value=>String(value||'').trim()).filter(Boolean))].slice(0,20);
  function clientManualId(client){return String(client?.sourceClientId||client?.sourceRecordId||client?.id||'')}
  // Client/account manuals are saved as normal manual records.  They are
  // attached only when a *new* job is created; existing jobs stay untouched.
  function scopedManualIdsForCase(client,account,targetUid='',openAll=false){
    const clientId=clientManualId(client),accountId=String(account?.id||'');
    return selectableManualsForCase(targetUid,openAll).filter(manual=>{
      const raw=(state.manuals||[]).find(item=>String(item.id||'')===manual.id)||{};
      const scope=String(raw.scope||'global');
      if(scope==='client')return String(raw.clientId||'')===clientId;
      if(scope==='account')return !!accountId&&String(raw.clientId||'')===clientId&&String(raw.accountId||'')===accountId;
      return false;
    }).map(manual=>manual.id);
  }
  function boardManualTarget(){const target=document.getElementById('mb-editor')?.value||'',openAll=target===DIRECT_ALL_ID||!!document.getElementById('mb-open')?.checked;return{target,openAll}}
  function selectableManualsForCase(targetUid='',openAll=false){return(state.manuals||[]).filter(manual=>{const audience=String(manual?.audience||'');return openAll?audience==='all':audience==='all'||(!!targetUid&&Array.isArray(manual?.allowedUids)&&manual.allowedUids.includes(targetUid))}).map(manual=>({id:String(manual.id||''),title:String(manual.title||''),required:!!manual.required,audience:String(manual.audience||'')})).filter(manual=>manual.id&&manual.title).sort((a,b)=>a.title.localeCompare(b.title,'ja'))}
  function boardManualOptions(selected=[],targetUid,openAll){const scope=targetUid===undefined?boardManualTarget():{target:targetUid,openAll:!!openAll},selectedIds=new Set(Array.isArray(selected)?selected.map(String):[]);return selectableManualsForCase(scope.target,scope.openAll).map(manual=>`<option value="${esc(manual.id)}" ${selectedIds.has(manual.id)?'selected':''}>${esc(manual.title)}${manual.required?'（必読）':''}</option>`).join('')}
  function hydrateBoardManualSelectors(){const {target,openAll}=boardManualTarget();document.querySelectorAll('.mb-parent-manuals,.mb-subcase-manuals').forEach(select=>{const selected=selectedManualIds(select);const selectedIds=new Set(selected);select.innerHTML=selectableManualsForCase(target,openAll).map(manual=>`<option value="${esc(manual.id)}" ${selectedIds.has(manual.id)?'selected':''}>${esc(manual.title)}${manual.required?'（必読）':''}</option>`).join('')})}
  function boardSubcaseRows(){return[...document.querySelectorAll('#mb-subcase-list .manager-board-subcase')]}
  function boardDraftSetterChanged(select){const row=select?.closest('.manager-board-subcase'),input=row?.querySelector('.mb-subcase-draft');if(!input)return;const editor=select.value==='editor';input.disabled=editor;if(editor)input.value='';}
  function addBoardSubcase(){const list=document.getElementById('mb-subcase-list');if(!list)return;if(boardSubcaseRows().length>=50)return toast('子案件は1回の掲載につき50件までです','warn');list.insertAdjacentHTML('beforeend',boardSubcaseRowHtml());list.lastElementChild?.querySelector('.mb-subcase-title')?.focus()}
  function removeBoardSubcase(button){const rows=boardSubcaseRows();if(rows.length<=1)return toast('子案件は1件以上入力してください','warn');button?.closest('.manager-board-subcase')?.remove()}
  function readBoardSubcases(){
    const rows=boardSubcaseRows(),internal=document.getElementById('mb-mode')?.value==='internal';if(!rows.length)return{error:'子案件を1件以上入力してください',items:[]};
    const items=[];
    for(const row of rows){
      const title=row.querySelector('.mb-subcase-title')?.value.trim()||'',editorDraftDateSetter=row.querySelector('.mb-subcase-draft-setter')?.value==='editor'?'editor':'creator',editorDraftDate=editorDraftDateSetter==='creator'?(row.querySelector('.mb-subcase-draft')?.value||''):'',clientDraftDate=row.querySelector('.mb-subcase-client-draft')?.value||'',deliveryDate=row.querySelector('.mb-subcase-delivery')?.value||'',instructions=row.querySelector('.mb-subcase-instructions')?.value.trim()||'',manualIds=selectedManualIds(row.querySelector('.mb-subcase-manuals')),caution=row.querySelector('.mb-subcase-caution')?.value.trim()||'';
      if(!title||!instructions)return{error:'すべての子案件に、案件名・編集指示を入力してください',items:[]};
      if(!internal&&editorDraftDateSetter==='creator'&&!editorDraftDate)return{error:`「${title}」：案件追加者が設定する場合は、編集者初稿日を入力してください`,items:[]};
      if(editorDraftDate&&clientDraftDate&&clientDraftDate<editorDraftDate)return{error:`「${title}」：クライアント初稿は編集者初稿以降に設定してください`,items:[]};
      if(clientDraftDate&&deliveryDate&&deliveryDate<clientDraftDate)return{error:`「${title}」：納期（予定）はクライアント初稿以降に設定してください`,items:[]};
      const attachmentRead=typeof _readVideoAttachments==='function'?_readVideoAttachments(row.querySelector('.video-attachment-list')):{error:'',items:[]};
      if(attachmentRead.error)return{error:`「${title}」：${attachmentRead.error}`,items:[]};
      const requestUrl=row.querySelector('.mb-subcase-request')?.value.trim()||'',sourceUrl=row.querySelector('.mb-subcase-source')?.value.trim()||'';
      if((requestUrl&&!safeUrl(requestUrl))||(sourceUrl&&!safeUrl(sourceUrl)))return{error:`「${title}」：URLは https:// または http:// で入力してください`,items:[]};
      items.push({id:row.dataset.subcaseId||safeId(),title,editorDraftDateSetter,editorDraftDate,clientDraftDate,deliveryDate,instructions,manualIds,caution,requestUrl,sourceUrl,attachments:attachmentRead.items});
    }
    return{error:'',items};
  }
  function baseBoardFormHtml(editors){
    ensureManagerResponsiveStyles();
    const initialTarget=_isOwner()?DIRECT_ALL_ID:(editors[0]?.id||''),clients=clientsForEditor(initialTarget),individualOptions=editors.map((e,i)=>`<option value="${e.id}" ${!_isOwner()&&i===0?'selected':''}>${esc(editorName(e))}</option>`).join(''),targetOptions=_isOwner()?`<option value="${DIRECT_ALL_ID}" selected>mono.create直接編集者全員</option><option value="${SELF_WID}">mono.create 内編集</option>${individualOptions}`:individualOptions||'<option value="" disabled selected>担当編集者が未設定です</option>';
    const parentAttachments=typeof _videoAttachmentEditorHtml==='function'?_videoAttachmentEditorHtml([],"addVideoAttachmentRow(document.getElementById('mb-parent-attachment-list'))",'mb-parent-attachment-list'):'';
    return block('編集代行案件を募集（編集者の「案件を探す」に表示）',`<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px"><select id="mb-editor" aria-label="公開先の編集者" onchange="managerBoardTargetChanged()"><option value="">公開先を選択</option>${targetOptions}</select><select id="mb-mode" aria-label="公開方法" onchange="managerRequestModeChanged()"><option value="public">通常募集</option><option value="request">編集リクエスト（指定した1名のみ）</option></select><label style="font-size:11px;display:flex;align-items:center;gap:6px;grid-column:1/-1"><input id="mb-open" type="checkbox" ${_isOwner()?'checked':''} ${isDirector()?'disabled':''} onchange="managerBoardAudienceChanged()"> mono.create直接編集者全員に公開</label><select id="mb-client" aria-label="クライアント" onchange="managerHydrateBoardAccounts()"><option value="">クライアントを選択</option>${clients.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select><select id="mb-account" aria-label="アカウント"><option value="">先にクライアントを選択</option></select>${_isOwner()?'<div style="grid-column:1/-1;display:flex;gap:7px;flex-wrap:wrap"><input id="mb-account-new" maxlength="100" placeholder="選択肢がない場合：新しいアカウント名" style="flex:1;min-width:220px"><button class="btn btn-g btn-sm" onclick="managerAddBoardAccount()">＋ このクライアントにアカウントを登録</button></div><div id="mb-client-pricing-status" style="grid-column:1/-1;font-size:11px;color:var(--t2);padding:8px 10px;border:1px solid var(--border);border-radius:8px;background:var(--card2)">クライアントとアカウントを選択すると、オーナー専用の単価マスターを確認できます。</div>':''}<label style="grid-column:1/-1;font-size:10px">親案件・バッチ名 <input id="mb-case" maxlength="120" placeholder="例：和光市デンタルオフィス 9月分（子案件をまとめて表示します）"></label><label style="font-size:10px">親案件共通の台本・依頼URL（任意）<input id="mb-parent-request" type="url" placeholder="全ての子案件で使うリンク"></label><label style="font-size:10px">親案件共通の素材URL（任意）<input id="mb-parent-source" type="url" placeholder="全ての子案件で使うリンク"></label><label style="font-size:10px">親案件共通のマニュアル（任意）<select id="mb-parent-manuals" class="mb-parent-manuals" multiple size="3" aria-label="親案件共通のマニュアル">${boardManualOptions([],initialTarget,initialTarget===DIRECT_ALL_ID)}</select></label><label style="font-size:10px">親案件共通の注意事項（任意）<textarea id="mb-parent-caution" maxlength="2000" placeholder="編集者に必ず伝えたいことを入力します。子案件で未入力の場合にも表示します。"></textarea></label><div style="grid-column:1/-1"><b style="font-size:12px">親案件共通の素材・資料リンク（任意）</b><div style="font-size:10px;color:var(--t3);margin:3px 0 6px">子案件に個別リンクがない場合も、ここにまとめて登録できます。</div>${parentAttachments}</div><div style="grid-column:1/-1;display:flex;justify-content:space-between;gap:8px;align-items:center"><b>子案件</b><button type="button" class="btn btn-g btn-sm" onclick="managerAddBoardSubcase()">＋ 子案件を追加</button></div><div class="manager-board-subcase-scroll"><div id="mb-subcase-list" class="manager-board-subcase-list">${boardSubcaseRowHtml(safeId(),{_manualTarget:initialTarget,_openAll:initialTarget===DIRECT_ALL_ID})}</div><div class="manager-board-subcase-add"><button type="button" class="btn btn-p" onclick="managerAddBoardSubcase()">＋ 子案件を追加</button></div></div></div><div style="font-size:10.5px;color:var(--t3);margin-top:7px">クライアント単価はクライアント一覧のオーナー専用マスターで管理します。掲載中の案件には金額を保存せず、受託後の案件画面で標準単価を自動入力します。例外の金額はオーナーが案件画面で変更できます。</div><button class="btn btn-p btn-sm" style="margin-top:8px" onclick="managerPublishBoardJob()">案件を掲載・リクエスト</button>`)}
  function boardFormHtml(editors){
    let html=baseBoardFormHtml(editors).replace('編集代行案件を募集（編集者の「案件を探す」に表示）','編集代行案件を追加');
    if(!_isOwner())return html;
    html=html.replace(/(<select id="mb-mode"[^>]*>[\s\S]*?)(<\/select>)/,'$1<option value="internal">mono.create 内編集</option>$2');
    html=html.replace('<label style="font-size:11px;display:flex;align-items:center;gap:6px;grid-column:1/-1">','<label id="mb-open-label" style="font-size:11px;display:flex;align-items:center;gap:6px;grid-column:1/-1">');
    html=html.replace('<button class="btn btn-p btn-sm" style="margin-top:8px" onclick="managerPublishBoardJob()">','<button id="mb-submit" class="btn btn-p btn-sm" style="margin-top:8px" onclick="managerPublishBoardJob()">');
    return html;
  }
  function manualFormHtml(editors){const clients=legacyClients();return block('マニュアル保管庫',`<div style="display:grid;grid-template-columns:1fr 1fr;gap:7px"><select id="mm-editor"><option value="all">全編集者共通</option>${editors.map(e=>`<option value="${e.id}">${esc(editorName(e))}にだけ表示</option>`).join('')}</select><input id="mm-title" maxlength="160" placeholder="タイトル *"><select id="mm-scope" onchange="managerManualScopeChanged()"><option value="global">全体</option><option value="client">クライアント</option><option value="account">アカウント</option></select><input id="mm-version" maxlength="20" value="1.0" placeholder="version"><select id="mm-client" disabled onchange="managerManualClientChanged()"><option value="">クライアントを選択（全体は不要）</option>${clients.map(client=>`<option value="${esc(clientManualId(client))}">${esc(client.name)}</option>`).join('')}</select><select id="mm-account" disabled><option value="">アカウントを選択（クライアント別は不要）</option></select><input id="mm-url" type="url" placeholder="Google DriveなどのURL"><label style="font-size:11px"><input id="mm-required" type="checkbox"> 必読</label><textarea id="mm-body" maxlength="10000" placeholder="本文・更新内容" style="grid-column:1/-1;min-height:76px"></textarea></div><button class="btn btn-g btn-sm" style="margin-top:8px" onclick="managerSaveManual()">マニュアルを保存</button><div style="font-size:10px;color:var(--t3);margin-top:6px">クライアント別・アカウント別は、新規案件を作る際に自動で添付されます。既存案件は変更しません。登録済み ${state.manuals.length}件。</div>`)}
  function availabilityHtml(){const dates=currentWeekDates(),byDay=dates.map((date,i)=>{const entries=state.schedules.map(x=>({record:x,day:scheduleDays(x)[i]})).filter(x=>x.day.status!=='unavailable');return`<section class="manager-week-day"><div class="manager-week-date"><b>${weekdayLabels[i]}曜</b><br>${esc(date.slice(5).replace('-','/'))}</div><div>${entries.map(({record,day})=>`<div class="manager-week-entry"><b>${esc(record.name||'編集者')}</b><span>${day.status==='available'?'編集可能':'要相談'}${day.startTime&&day.endTime?` ・ ${esc(day.startTime)}〜${esc(day.endTime)}`:''}${day.capacity?` ・ ${Number(day.capacity)}本`:''}</span>${day.note?`<div style="color:var(--t3);margin-top:2px">${esc(day.note)}</div>`:''}</div>`).join('')||'<div class="manager-week-empty">登録なし</div>'}</div></section>`}).join('');return block(`今週の編集可能カレンダー（${dates[0]} 〜 ${dates[6]}）`,`<div class="manager-week-calendar">${byDay}</div><div style="font-size:10.5px;color:var(--t3);margin-top:8px">他の編集者にも、編集できる時間と本数だけを表示します。</div>`)}
  const externalSettlementKeys=['ownPay','payableApproved','payableApprovedAt','payableMonth'];
  function hasExternalSettlement(job){return externalSettlementKeys.some(key=>Object.prototype.hasOwnProperty.call(job||{},key))}
  function settlementPatch(job,{remove=false}={}){
    const patch={updatedAt:Date.now(),updatedBy:_myEmail()};
    externalSettlementKeys.forEach(key=>{
      if(remove)patch[key]=firebase.firestore.FieldValue.delete();
      else if(Object.prototype.hasOwnProperty.call(job||{},key))patch[key]=job[key];
    });
    return patch;
  }
  function settlementArchiveData(job){
    const field=key=>Object.prototype.hasOwnProperty.call(job||{},key)?job[key]:null;
    return{recordType:'external_compensation_archive',portalUid:job._portalUid,jobId:job.id,editorName:job.editorName||'',jobTitle:job.title||'',ownPay:field('ownPay'),payableApproved:field('payableApproved'),payableApprovedAt:field('payableApprovedAt'),payableMonth:field('payableMonth'),archivedAt:firebase.firestore.FieldValue.serverTimestamp(),archivedBy:_myEmail()};
  }
  async function settlementRowsForPortal(uid){
    const snapshot=await fbDb.collection('editor_portals').doc(uid).collection('editor_jobs').get();
    return snapshot.docs.map(doc=>({id:doc.id,_portalUid:uid,...doc.data()})).filter(hasExternalSettlement);
  }
  async function settlementRowsForPortals(uids){
    const lists=await Promise.all((uids||[]).filter(Boolean).map(settlementRowsForPortal));
    return lists.flat();
  }
  async function archiveSettlementRows(rows){
    for(let offset=0;offset<rows.length;offset+=150){
      const batch=fbDb.batch();
      rows.slice(offset,offset+150).forEach(job=>{
        const archiveId=`${job._portalUid}__${job.id}`.replace(/\//g,'_'),archive=fbDb.collection('external_compensation_archive').doc(archiveId),ref=fbDb.collection('editor_portals').doc(job._portalUid).collection('editor_jobs').doc(job.id);
        batch.set(archive,settlementArchiveData(job),{merge:true});
        batch.update(ref,settlementPatch(job,{remove:true}));
      });
      await batch.commit();
    }
  }
  async function restoreSettlementRows(rows){
    for(let offset=0;offset<rows.length;offset+=300){
      const batch=fbDb.batch();
      rows.slice(offset,offset+300).forEach(job=>batch.set(fbDb.collection('editor_portals').doc(job._portalUid).collection('editor_jobs').doc(job.id),settlementPatch(job),{merge:true}));
      await batch.commit();
    }
  }
  function externalSettlementJobs(){
    const externalIds=new Set(state.editors.filter(e=>e.editorKind==='external').map(e=>e.id)),rows=[...(PORTAL_JOBS||[]),...[...state.portalJobsByEditor.values()].flat()],seen=new Set();
    return rows.filter(j=>externalIds.has(j._portalUid)&&hasExternalSettlement(j)&&!seen.has(`${j._portalUid}/${j.id}`)&&(seen.add(`${j._portalUid}/${j.id}`),true));
  }
  function externalBillingBoundaryHtml(){
    const owner=_isOwner(),count=owner?externalSettlementJobs().length:0,copy='<b>外部編集者の金額はディレクターが管理</b><div style="font-size:11px;color:var(--t2);line-height:1.7;margin-top:4px">外部編集者には、クライアント単価もmono.createからディレクターへの依頼単価も表示しません。ディレクターは、配下編集者分をまとめた請求書を自分の編集者ポータルからmono.createへ提出します。</div>';
    const rebuild=owner?'<button class="btn btn-g btn-sm" style="margin-top:8px" onclick="window.rebuildAllDirectorInvoiceAuthorizations&&window.rebuildAllDirectorInvoiceAuthorizations()">全ディレクターの精算額を再計算</button>':'';
    return block('金額の表示範囲',`${copy}${count?`<div class="card notice warn" style="box-shadow:none;margin-top:10px"><b>過去の案件に金額情報が ${count}件残っています</b><div style="font-size:11px;color:var(--t2);margin:4px 0 8px">案件の内容・進み具合・履歴は変えず、金額だけをオーナー専用の保管先へ移します。</div><button class="btn btn-p btn-sm" onclick="managerMigrateExternalSettlement()">金額をオーナー専用の保管先へ移す</button></div>`:''}${rebuild}<div style="margin-top:10px"><a class="btn btn-g btn-sm" href="./editor.html" target="_blank" rel="noopener">${owner?'ディレクター用の請求書画面を開く':'自分の請求書画面を開く'}</a></div>`);
  }
  function invoiceHtml(list){const owner=_isOwner();return block(owner?'編集者からの請求書':'自分が提出した請求書',list.length?list.sort((a,b)=>timestamp(b.updatedAt||b.submittedAt)-timestamp(a.updatedAt||a.submittedAt)).map(x=>{const inclusive=x.taxInclusive===true;return`<div style="padding:8px;background:var(--card2);border-radius:8px;margin-bottom:6px"><div style="display:flex;align-items:center;gap:7px"><div style="flex:1"><b>${esc(owner?(x.editorName||x.issuer?.name||x._portalUid):'自分の請求書')}</b><div style="font-size:10px;color:var(--t3)">${esc(x.month||'')} ・ ¥${Number(x.total||0).toLocaleString()}${inclusive?'（税込）':'（旧・税別）'} ・ ${esc(x.status||'下書き')}</div></div>${x.file?.webViewLink?`<a class="btn btn-g btn-sm" target="_blank" rel="noopener" href="${esc(x.file.webViewLink)}">原本</a>`:''}${owner&&['提出済み','再提出'].includes(x.status)?`<button class="btn btn-g btn-sm" onclick="managerInvoiceAction('${x._portalUid}','${x.id}','差戻し')">差戻し</button><button class="btn btn-p btn-sm" ${inclusive?'':'disabled'} onclick="managerInvoiceAction('${x._portalUid}','${x.id}','承認済み')">承認</button>`:''}</div>${inclusive?'':'<div style="font-size:11px;color:var(--red);margin-top:7px">旧方式の税別請求書です。差戻して、税込金額で修正版を作成してください。</div>'}</div>`}).join(''):empty(owner?'提出された請求書はありません。':'自分が提出した請求書はありません。'))}
  function directorAuthorizationHtml(){
    if(!isDirector())return'';
    const rows=state.authorizations.slice().sort((a,b)=>String(b.month||'').localeCompare(String(a.month||'')));
    return block('自分への精算額',rows.length?rows.map(x=>`<div style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--card2);border-radius:8px;margin-bottom:7px"><div style="flex:1"><b>${esc(x.month||'対象月未設定')}</b><div style="font-size:11px;color:var(--t2);margin-top:3px">精算額 ¥${Number(x.total||0).toLocaleString()} ・ 明細 ${Array.isArray(x.jobIds)?x.jobIds.length:0}件</div><div style="font-size:10px;color:var(--t3);margin-top:3px">請求可能日 ${esc(x.invoiceAvailableOn||'未設定')} ／ 支払予定 ${esc(x.paymentDueDate||'未設定')}</div></div>${statusBadge(x.active?'請求可能':'対象なし',x.active?'bg':'ba')}</div>`).join(''):empty('確定した納品日にもとづく精算額はまだありません。'));
  }
  function threadHtml(jobs){const list=[...jobs].sort((a,b)=>timestamp(b.updatedAt)-timestamp(a.updatedAt)).slice(0,20);return block('案件内チャット',list.map(j=>`<div style="display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid var(--border)"><div style="flex:1"><b>${esc(j.title||'')}</b><div style="font-size:10px;color:var(--t3)">${esc(j.clientDisplay||'')} / ${esc(j.accountDisplay||'')} ・ ${esc(j.editorName||'')}</div></div><button class="btn btn-g btn-sm" onclick="managerSendMessage('${j._portalUid}','${j.id}')">連絡を送る</button></div>`).join('')||'<div style="font-size:11px;color:var(--t3)">案件はありません。</div>')}
  function suggestionsHtml(){return block('匿名目安箱（オーナーのみ）',state.suggestions.slice(0,30).map(x=>`<div style="padding:9px;background:var(--card2);border-radius:8px;margin-bottom:7px"><div style="font-size:10px;color:var(--t3)">${esc(x.category||'')} ・ ${esc(x.status||'未確認')}</div><div style="white-space:pre-wrap;font-size:12px;margin:4px 0">${esc(x.message||'')}</div>${x.replyCode?`<button class="btn btn-g btn-sm" onclick="managerReplySuggestion('${esc(x.id)}','${esc(x.replyCode)}')">匿名で返信</button>`:''}</div>`).join('')||'<div style="font-size:11px;color:var(--t3)">投稿はありません。</div>')}

  function editorStateGuidance(editor,status){
    if(!editor?.approved)return'<b>次にすること：</b>ログイン申請を承認してください。';
    if(!rolesGrantVideoEditor(editor.roles||[]))return'<b>次にすること：</b>動画編集者または動画編集ディレクターの役割を設定してください。';
    if(_isOwner()&&(!editor.workerId||!status.worker))return'<b>次にすること：</b>既存の編集者情報と紐付けてください。';
    if(!status.portalReady)return'<b>確認中：</b>案件を読み込んでいます。少し待ってから再表示してください。';
    if(status.chatwork==='mismatch')return'<b>正常：</b>アプリは利用できます。<br><b>次にすること：</b>Chatwork表示名を確認して保存してください。';
    if(status.chatwork==='pending')return'<b>正常：</b>ログイン・役割・担当者の設定は済んでいます。<br><b>次にすること：</b>Chatwork表示名を確認して保存してください。';
    return'<b>正常：</b>ログイン・役割・担当者の設定と、案件の読み込みが済んでいます。';
  }
  async function shareLegacySyncClients(editor,parents){
    const clientIds=[...new Set((parents||[]).map(parent=>String(parent?.clientId||'')).filter(Boolean))];
    const clients=legacyClients().filter(client=>clientIds.includes(String(client.id||client.sourceRecordId||'')));
    if(!clients.length)return{documents:0};
    const batch=fbDb.batch();
    clients.forEach(client=>{
      const existing=catalogsFor(editor.id).find(c=>(c.sourceClientId&&String(c.sourceClientId)===String(client.id))||nameKey(c.name)===nameKey(client.name));
      const ref=fbDb.collection('editor_portals').doc(editor.id).collection('client_catalog').doc(existing?.id||catalogDocIdForClient(client));
      batch.set(ref,{sourceClientId:client.id||client.sourceRecordId||'',name:client.name||'',formerNames:[...(client.formerNames||[])],accounts:mergeMasterCatalogAccounts(catalogAccountsFromMaster(client),existing?.accounts||[]),active:client.deleted!==true,manualIds:existing?.manualIds||[],updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()},{merge:true});
    });
    await batch.commit();return{documents:clients.length};
  }
  async function syncLegacyAssignmentsForEditor(uid){
    const editor=state.editors.find(item=>item.id===uid);if(!editor||!canSyncLegacyForEditor(editor))return toast('この編集者の案件を同期する権限がありません','warn');
    if(state.assignmentSyncing.has(uid))return;
    const entries=legacyUnlinkedEntriesForEditor(editor),parents=[...new Map(entries.map(item=>[String(item.parent.id||''),item.parent])).values()];
    if(!entries.length)return toast('未連携の担当案件はありません');
    state.assignmentSyncing.add(uid);renderSafe();
    try{
      const results=[];
      for(const parent of parents){
        const result=await window.syncLegacyAssignedSubtasksToPortal(parent,{silent:true,targetUid:uid,onlyMissing:true});results.push(result||{});
      }
      const catalog=await shareLegacySyncClients(editor,parents),synced=results.reduce((total,result)=>total+Number(result.synced||0),0),skipped=results.reduce((total,result)=>total+Number(result.skipped||0),0);
      toast(`${editorName(editor)}さんの本人画面へ ${synced}件を同期しました。対象クライアント ${catalog.documents}件を共有しました${skipped?`（${skipped}件は要確認）`:''}`,skipped?'warn':undefined);
    }catch(error){console.warn('legacy assignment portal sync',uid,error);toast('本人画面への同期に失敗しました。既存案件は変更していません','err');}
    finally{state.assignmentSyncing.delete(uid);renderSafe();}
  }
  function rosterHtml(editors){
    const directorView=isDirector(),description=directorView?'担当する外部編集者のポータル案件だけを表示します。旧台帳、他チームの案件、クライアント単価は表示しません。':'「利用可能」は、ログイン承認・動画編集の権限・既存の編集者情報の紐づけが済んでいる状態です。案件数は社内案件と編集者ポータル案件の合計です。Chatwork名は、オーナーが保存した名前と照合します。';
    if(!state.loaded.editors)return block('担当編集者',`${empty('編集者の権限情報を読み込んでいます。')}<div style="font-size:10px;color:var(--t3);margin-top:7px">${description}</div>`);
    return block('担当編集者',editors.length?`<div style="font-size:10.5px;color:var(--t3);line-height:1.65;margin-bottom:8px">${description}</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:8px">${editors.map(e=>{const director=(ACCESS_RECORDS||[]).find(x=>x.id===e.directorUid),s=editorStatus(e),permission=s.permissionNormal?statusBadge('利用可能','bg'):statusBadge('権限を確認','br'),jobs=s.jobCount===null?statusBadge('案件を確認中','ba'):statusBadge(s.jobCount===0?'案件なし':`案件${s.jobCount}件`,s.jobCount===0?'ba':'bp'),link=s.permissionNormal&&s.portalReady?statusBadge('利用できる状態','bg'):statusBadge('設定中','ba'),chatwork=s.chatwork==='match'?statusBadge('Chatwork名一致','bg'):s.chatwork==='mismatch'?statusBadge('Chatwork名不一致','br'):statusBadge('Chatwork名確認待ち','ba'),portalSummary=s.portalCount===null?'担当案件を確認中':`担当案件 ${s.portalCount}件`,legacySummary=`台帳上の担当：${s.legacyCount}件`,unlinkedSummary=s.legacyUnlinkedCount===null?'未連携：確認中':`未連携：${s.legacyUnlinkedCount}件`,needsSync=Number(s.legacyUnlinkedCount||0)>0&&canSyncLegacyForEditor(e),syncButton=needsSync?`<button class="btn btn-p btn-xs" style="margin-top:8px" ${state.assignmentSyncing.has(e.id)?'disabled':''} onclick="managerSyncLegacyAssignments('${esc(e.id)}')">${state.assignmentSyncing.has(e.id)?'同期中…':'本人画面へ同期'}</button>`:'';return`<div style="padding:10px;background:var(--card2);border-radius:8px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(directorView?(e.name||e.email||'編集者'):editorName(e))}</b><span class="badge ${e.editorKind==='external'?'ba':'bg'}">${e.editorKind==='external'?'外部編集者':'直接契約'}</span></div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:7px">${permission}${jobs}${link}${chatwork}</div><div style="font-size:11px;color:var(--t2);margin-top:7px">${directorView?portalSummary:`本人画面：${s.portalCount===null?'確認中':`${s.portalCount}件`} ／ ${legacySummary} ／ ${unlinkedSummary}`}</div>${directorView?'':syncButton}<div class="manager-state-guidance">${editorStateGuidance(e,s)}</div>${s.chatwork==='mismatch'?`<div style="font-size:10.5px;color:var(--red);margin-top:6px">アプリ: ${esc(e.name||'未登録')} ／ Chatwork: ${esc(s.chatworkName)}</div>`:''}${directorView?'':workerLine(s.worker)}<div style="font-size:10px;color:var(--t3);margin-top:4px">${esc(e.email||s.worker?.contact||'')}</div>${!directorView&&e.editorKind==='external'?`<div style="font-size:11px;color:var(--t2);margin-top:5px">担当 ${esc(director?.name||director?.email||'未設定')}</div>`:''}${_isOwner()?`<button class="btn btn-g btn-xs" style="margin-top:8px" onclick="managerOpenChatworkNameCheck('${esc(e.id)}')">Chatwork名を確認</button>`:''}</div>`}).join('')}</div>`:empty('担当する承認済み編集者はいません。'))
  }
  function workerLine(worker){return`${worker?.affiliation?`<div style="font-size:11px;color:var(--t2);margin-top:4px">${esc(worker.affiliation)}</div>`:''}${worker?.skills?`<div style="font-size:11px;color:var(--t2);margin-top:3px">${esc(worker.skills)}</div>`:''}`}
  function clientPriceEditorHtml(client,account=null){
    const accountId=account?.id||'',label=account?`${account.name} の単価`:'標準単価（アカウント別の設定がない場合）',price=clientUnitPriceFor(client,accountId),inputId=ownerPriceInputId(client.id,accountId||'default');
    return`<div style="display:flex;gap:6px;align-items:end;flex-wrap:wrap;margin-top:7px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--card)"><label style="display:grid;gap:3px;flex:1;min-width:170px;font-size:10.5px;color:var(--t2)" for="${esc(inputId)}"><span>${esc(label)}</span><input id="${esc(inputId)}" type="number" min="0" step="1" value="${price===null?'':esc(price)}" placeholder="未設定"></label><button class="btn btn-g btn-sm" onclick="managerSaveClientUnitPrice('${esc(client.id)}','${esc(accountId)}')">単価を保存</button></div>`;
  }
  const rateInputId=(clientId,accountId,field)=>`manager-rate-${String(clientId||'').replace(/[^A-Za-z0-9_-]/g,'_')}-${String(accountId||'default').replace(/[^A-Za-z0-9_-]/g,'_')}-${field}`;
  function clientRateScheduleHtml(client,account=null){
    const accountId=String(account?.id||''),scopeLabel=account?`${account.name}（アカウント別）`:'クライアント共通',rows=clientRatesFor(client,accountId),dateId=rateInputId(client.id,accountId,'date'),priceId=rateInputId(client.id,accountId,'price'),payId=rateInputId(client.id,accountId,'pay');
    const rowsHtml=!state.clientRatesReady?'<div style="font-size:11px;color:var(--t3)">適用日つき単価を読み込み中です。</div>':rows.length?rows.map(row=>`<div class="manager-rate-row"><span>${esc(row.effectiveFrom||'')}</span><span>受託 ¥${Number(row.clientUnitPrice||0).toLocaleString()}</span><span>編集者 ¥${Number(row.editorPayAmount||0).toLocaleString()}</span><button class="btn ${row.active===false?'btn-g':'btn-red'} btn-xs" onclick="managerToggleClientRate('${esc(row.id)}',${row.active===false?'true':'false'})">${row.active===false?'再有効化':'無効化'}</button><span class="manager-rate-row-meta" style="grid-column:1/-1;color:var(--t3)">${row.active===false?'無効':'有効'} ・ rev.${Number(row.revision||1)} ・ ${esc(row.updatedBy||row.createdBy||'')}</span></div>`).join(''):'<div style="font-size:11px;color:var(--t3)">まだ適用日つきの単価はありません。下の入力から追加してください。</div>';
    return`<details style="margin-top:8px;padding:8px;border:1px solid var(--border);border-radius:8px;background:var(--card)"><summary style="cursor:pointer;font-size:12px"><b>単価・編集者支払いの適用履歴</b>　${esc(scopeLabel)}</summary><div style="font-size:10.5px;color:var(--t3);line-height:1.6;margin:7px 0">新しく作る案件だけに適用します。過去の案件・確定済みの金額は変更しません。アカウント別がない場合はクライアント共通を使います。</div><div class="manager-rate-form"><label class="manager-rate-field manager-rate-field-date" for="${esc(dateId)}"><span>適用開始日</span><input id="${esc(dateId)}" type="date"></label><label class="manager-rate-field" for="${esc(priceId)}"><span>クライアント単価 *</span><input id="${esc(priceId)}" type="number" min="1" step="1" inputmode="numeric" placeholder="例: 3500"></label><label class="manager-rate-field" for="${esc(payId)}"><span>編集者支払い *</span><input id="${esc(payId)}" type="number" min="0" step="1" inputmode="numeric" placeholder="例: 3000"></label><button class="btn btn-p btn-sm manager-rate-save" onclick="managerSaveClientRate('${esc(client.id)}','${esc(accountId)}')">適用履歴を保存</button></div><div style="margin-top:7px">${rowsHtml}</div></details>`;
  }
  function masterClientsHtml(){startClientRates();const clients=legacyClients();return block('既存クライアント台帳',clients.length?`<div style="font-size:11px;color:var(--t2);line-height:1.65;margin-bottom:8px">クライアント単価はオーナーだけが確認・設定できます。編集者へ共有するクライアント一覧には金額を保存しないため、外部編集者・直接契約編集者とも単価や利益は見られません。</div><div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px">${clients.map(c=>{const accounts=masterAccounts(c),status=c.crmStatus||(c.isTrial?'トライアル':'成約'),source=c._clientSource==='crm'?'全社顧客台帳':'制作・派遣台帳';return`<div style="padding:12px;background:var(--card2);border-radius:10px"><div style="display:flex;justify-content:space-between;gap:8px;align-items:start"><div><b>${esc(c.name||'クライアント名未設定')}</b><div style="font-size:10.5px;color:var(--t3);margin-top:2px">${esc(source)}</div></div><span class="badge ${['見込み','商談中','トライアル'].includes(status)?'ba':'bg'}">${esc(status)}</span></div>${c.bu?`<div style="font-size:11px;color:var(--pl);margin-top:5px">${esc(c.bu)}</div>`:''}${c.contact||c.phone||c.email?`<div style="font-size:11px;color:var(--t2);margin-top:5px">${[c.contact,c.phone,c.email].filter(Boolean).map(esc).join(' / ')}</div>`:''}${c.notes||c.contractNote?`<div style="font-size:11px;color:var(--t3);margin-top:4px">${esc(c.notes||c.contractNote)}</div>`:''}${clientPriceEditorHtml(c)}${clientRateScheduleHtml(c)}<div class="manager-account-list" aria-label="${esc(c.name||'クライアント')}のアカウント一覧">${accounts.map(a=>`<div class="manager-account-row"><span class="manager-account-name">${esc(a.name)}</span><div class="manager-account-actions"><button class="btn btn-g btn-sm" aria-label="${esc(a.name)}を編集" onclick="managerOpenMasterAccountEdit('${esc(c.id)}','${esc(a.id)}')">編集</button><button class="btn btn-red btn-sm" aria-label="${esc(a.name)}を削除" onclick="managerOpenMasterAccountDelete('${esc(c.id)}','${esc(a.id)}')">削除</button></div></div>${clientPriceEditorHtml(c,a)}${clientRateScheduleHtml(c,a)}`).join('')||'<span style="font-size:12px;color:var(--t3)">アカウント未登録</span>'}</div><div class="manager-account-add"><label class="app-sr-only" for="master-account-${esc(c.id)}">${esc(c.name||'クライアント')}へ追加するアカウント名</label><input id="master-account-${esc(c.id)}" maxlength="100" placeholder="アカウント名を追加"><button class="btn btn-g btn-sm" onclick="managerSaveMasterAccount('${esc(c.id)}')">追加</button></div><div style="display:flex;gap:6px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px">${c._clientSource==='projects'?`<button class="btn btn-g btn-sm" onclick="openClientModal('${esc(c.sourceRecordId)}')">制作台帳を編集</button>`:''}${c._clientSource==='crm'?`<button class="btn btn-g btn-sm" onclick="crmOpenCard('${esc(c.sourceRecordId)}')">顧客台帳を編集</button>`:''}${c._crmRecordId?`<button class="btn btn-g btn-sm" onclick="crmOpenCard('${esc(c._crmRecordId)}')">顧客台帳も編集</button>`:''}</div></div>`}).join('')}</div>`:empty('既存のクライアント情報はありません。'))}
  function catalogListHtml(editors){const rows=editors.flatMap(e=>catalogsFor(e.id).map(c=>({editor:e,client:c})));return block('登録済みクライアント・アカウント',rows.length?rows.map(({editor,client})=>`<div style="padding:9px;background:var(--card2);border-radius:8px;margin-bottom:7px"><div style="display:flex;justify-content:space-between;gap:8px"><b>${esc(client.name||'クライアント名未設定')}</b><span style="font-size:10px;color:var(--t3)">${esc(editorName(editor))}</span></div><div style="display:flex;gap:5px;flex-wrap:wrap;margin-top:6px">${visibleAccounts(client.accounts||[]).map(a=>`<span class="badge bk">${esc(a.name||'アカウント名未設定')}</span>`).join('')||'<span style="font-size:11px;color:var(--t3)">アカウント未登録</span>'}</div></div>`).join(''):empty('登録済みのクライアント・アカウントはありません。'))}
  function manualListHtml(){return block('登録済みマニュアル',state.manuals.length?state.manuals.slice().sort((a,b)=>timestamp(b.updatedAt)-timestamp(a.updatedAt)).map(x=>`<div style="display:flex;gap:8px;align-items:center;padding:9px;background:var(--card2);border-radius:8px;margin-bottom:7px"><div style="flex:1;min-width:0"><b>${esc(x.title||'タイトル未設定')}</b><div style="font-size:10px;color:var(--t3)">${esc(x.scopeLabel||x.scope||'全体')} ・ version ${esc(x.version||'1.0')}${x.required?' ・ 必読':''}</div></div>${x.url?`<a class="btn btn-g btn-sm" href="${esc(x.url)}" target="_blank" rel="noopener">開く</a>`:''}</div>`).join(''):empty('登録済みのマニュアルはありません。'))}
  function editorPage(){const editors=managedEditors();if(_isOwner())return`${originalWorkers()}${page('編集者ログイン・契約設定','既存の編集者台帳はそのまま使い、ログイン権限と担当ディレクターだけを追加設定します。',`${relationHtml(editors)}${rosterHtml(editors)}`)}`;return page('編集者管理','既存の編集者情報を引き継ぎ、担当する外部編集者だけを表示します。単価や他チームの情報は表示しません。',rosterHtml(editors))}
  function clientsPage(){ensureManagerResponsiveStyles();const editors=managedEditors();return page('クライアント・アカウント管理','既存のクライアント情報をそのまま使い、必要なアカウント名と編集者への共有先だけを追加します。',`${_isOwner()?masterClientsHtml():''}${catalogHtml(editors)}${catalogListHtml(editors)}`)}
  function schedulesPage(){return page('編集可能スケジュール','編集者が登録した今週の1週間を、曜日ごとに確認します。',availabilityHtml())}
  function manualsPage(){const editors=managedEditors();return page('マニュアル保管庫','動画編集の進め方やクライアント別ルールを、対象の編集者へ共有します。',`${manualFormHtml(editors)}${manualListHtml()}`)}
  function invoicesPage(){let clientInvoices='';if(_isOwner()){PWORK='video';if(!['edit','haken'].includes(PBIZ))PBIZ='edit';clientInvoices=block('クライアントへ提出する請求書',`<div style="display:flex;gap:6px;margin-bottom:10px"><button class="btn btn-g btn-sm ${PBIZ==='edit'?'btn-p':''}" onclick="PBIZ='edit';render()">編集代行</button><button class="btn btn-g btn-sm ${PBIZ==='haken'?'btn-p':''}" onclick="PBIZ='haken';render()">編集者派遣</button></div>${rProjInvoice()}`)}const directorView=isDirector(),description=directorView?'配下編集者分を含む、自分への精算額と自分が提出した請求書を確認します。承認・差戻しはオーナーが行います。':'直接契約編集者の請求書と、ディレクター本人からのまとめ請求を確認します。外部編集者の金額はこのアプリで管理しません。';return page('請求書',description,`${clientInvoices}${externalBillingBoundaryHtml()}${directorAuthorizationHtml()}${invoiceHtml(state.invoices.slice())}`)}
  function suggestionsPage(){if(!_isOwner())return page('匿名目安箱','投稿者を特定せず、オーナーだけが内容を確認します。',empty('このページはオーナーのみ閲覧できます。'));return page('匿名目安箱','編集者から届いた匿名の意見を確認し、返信コードを通じて匿名で返答できます。',suggestionsHtml())}

  function boardFormToggled(el){state.boardFormOpen=!!el?.open}
  function openBoardForm(){
    state.boardFormOpen=true;
    let el=document.getElementById('manager-board-publish');
    if(!el&&typeof setVideoTab==='function'){
      setVideoTab('overview');
      el=document.getElementById('manager-board-publish');
    }
    if(!el){state.boardFormOpen=false;toast('掲載フォームを読み込めませんでした。画面を再読み込みしてください','err');return false}
    el.open=true;
    boardFormToggled(el);
    el.scrollIntoView({behavior:'smooth',block:'start'});
    setTimeout(()=>document.getElementById('mb-editor')?.focus(),250);
    return true;
  }
  rVideoOperations=function(...args){const base=originalVideoOperations(...args);if(!canManage())return base;const biz=['edit','haken'].includes(PBIZ)?PBIZ:'edit',jobs=managedJobs().filter(j=>portalJobBiz(j)===biz),sections=[];if(biz==='edit')sections.push(`<details id="manager-board-publish" class="manager-operation-disclosure" ${state.boardFormOpen?'open':''} ontoggle="managerBoardFormToggled(this)"><summary class="btn btn-g">新しい編集代行案件を掲載する</summary><div class="manager-operation-body">${boardFormHtml(managedEditors())}</div></details>`);sections.push(`<details class="manager-operation-disclosure"><summary class="btn btn-g">案件内チャットを開く</summary><div class="manager-operation-body">${threadHtml(jobs)}</div></details>`);if(VIDEO_TAB==='overview'){const actions=`<section class="ref-manager-panel"><div class="ref-rail-heading"><b>案件の操作</b><span>管理</span></div>${sections.join('')}</section>`;return base.replace('<div id="manager-overview-actions"></div>',`<div id="manager-overview-actions">${actions}</div>`)}return base};
  rWorkers=editorPage;
  window.managerVideoEditorsPage=editorPage;
  window.managerVideoClientsPage=clientsPage;
  window.managerVideoSchedulesPage=schedulesPage;
  window.managerVideoManualsPage=manualsPage;
  window.managerVideoInvoicesPage=invoicesPage;
  window.managerVideoSuggestionsPage=suggestionsPage;
  function relationToggle(uid){const kind=document.getElementById('rel-kind-'+uid)?.value,dir=document.getElementById('rel-dir-'+uid);if(dir)dir.disabled=kind!=='external'}
  async function saveRelation(uid){
    if(!_isOwner())return;
    const kind=document.getElementById('rel-kind-'+uid)?.value||'direct',directorUid=document.getElementById('rel-dir-'+uid)?.value||'';
    if(kind==='external'&&!directorUid)return toast('外部編集者は担当ディレクターを選択してください','warn');
    const editor=state.editors.find(x=>x.id===uid)||(ACCESS_RECORDS||[]).find(x=>x.id===uid),isMovingToExternal=kind==='external'&&editor?.editorKind!=='external',director=(ACCESS_RECORDS||[]).find(x=>x.id===directorUid);
    let settlementRows=[];
    try{
      if(isMovingToExternal){
        settlementRows=await settlementRowsForPortal(uid);
        if(settlementRows.length&&!confirm(`${editorName(editor)}さんの案件には金額の記録が ${settlementRows.length}件あります。\n外部編集者へ切り替える前に、金額4項目だけをオーナー専用の保管先へ移します。\n案件名・進み具合・履歴は変わりません。続けますか？`))return;
        if(settlementRows.length)await archiveSettlementRows(settlementRows);
      }
      await fbDb.collection('access').doc(uid).set({editorKind:kind,directorUid:kind==='external'?directorUid:'',invoiceRecipientName:kind==='external'?(director?.name||director?.email||'担当ディレクター'):'mono.create',updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()},{merge:true});
      toast(settlementRows.length?`契約区分を保存し、${settlementRows.length}件の金額を保管先へ移しました`:'契約区分を保存しました');
    }catch(e){
      console.warn(e);
      if(settlementRows.length&&isMovingToExternal){
        try{await restoreSettlementRows(settlementRows)}catch(restoreError){console.warn(restoreError);return toast('契約区分は変更していません。金額の復元を確認してください','err')}
      }
      toast('契約区分を保存できませんでした。契約区分・案件・履歴は変更していません','err');
    }
  }
  function catalogTargetsForClient(client,{directOnly=false,previous=null}={}){const rows=[];state.catalog.forEach((catalogs,uid)=>{const editor=state.editors.find(e=>e.id===uid);if(directOnly&&editor?.editorKind==='external')return;(catalogs||[]).forEach(c=>{const sourceIds=[client?.id,client?.sourceRecordId,previous?.id,previous?.sourceRecordId].filter(Boolean);const names=[client?.name,previous?.name,...(client?.formerNames||[]),...(previous?.formerNames||[])].filter(Boolean);if((c.sourceClientId&&sourceIds.includes(c.sourceClientId))||names.some(name=>nameKey(c.name)===nameKey(name)))rows.push({uid,catalog:c,editor})})});return rows}
  function catalogAccountChange(accounts,target,newName,remove){const rows=(accounts||[]).map(a=>typeof a==='string'?{id:`name:${a}`,name:a}:{...a,formerNames:Array.isArray(a.formerNames)?[...a.formerNames]:[]});if(remove)return rows.filter(a=>!accountMatches(a,target)&&a.active!==false);return rows.map(a=>accountMatches(a,target)?editAccountList([a],target,newName)[0]:a).filter(a=>a.active!==false)}
  function catalogDocIdForClient(client){return`master_${String(client?.id||client?.sourceRecordId||safeId()).replace(/\//g,'_')}`}
  function catalogAccountsFromMaster(client){return mergeAccounts(client?.accounts||[])}
  function mergeMasterCatalogAccounts(masterAccounts,currentAccounts){
    const incoming=mergeAccounts(masterAccounts||[]),existing=mergeAccounts(currentAccounts||[]),used=new Set(),rows=[];
    incoming.forEach(master=>{const found=existing.find((row,index)=>!used.has(index)&&(String(row.id)===String(master.id)||nameKey(row.name)===nameKey(master.name)||[...(row.formerNames||[])].some(n=>nameKey(n)===nameKey(master.name))));if(found)used.add(existing.indexOf(found));rows.push({...found,...master,id:master.id||found?.id,formerNames:[...new Set([...(found?.formerNames||[]),...(master?.formerNames||[])]) ]})});
    existing.forEach((row,index)=>{if(!used.has(index))rows.push(row)});
    return mergeAccounts(rows);
  }
  function directCatalogEditors(){const rows=state.editors.length?state.editors:(ACCESS_RECORDS||[]).filter(editor=>editor.approved===true&&rolesGrantVideoEditor(editor.roles||[]));return rows.filter(editor=>editor.editorKind!=='external')}
  async function syncMissingDirectCatalogsForEditor(editor,currentCatalogs=[]){
    if(!_isOwner()||!editor?.id||editor.editorKind==='external'||state.catalogRepairing.has(editor.id))return{documents:0};
    const clients=legacyClients(),missing=clients.filter(client=>!(currentCatalogs||[]).some(c=>(c.sourceClientId&&c.sourceClientId===client.id)||nameKey(c.name)===nameKey(client.name)));
    if(!missing.length)return{documents:0};
    state.catalogRepairing.add(editor.id);
    try{
      for(let offset=0;offset<missing.length;offset+=300){
        const batch=fbDb.batch();
        missing.slice(offset,offset+300).forEach(client=>{const ref=fbDb.collection('editor_portals').doc(editor.id).collection('client_catalog').doc(catalogDocIdForClient(client));batch.set(ref,{sourceClientId:client.id||client.sourceRecordId||'',name:client.name||'',formerNames:[...(client.formerNames||[])],accounts:catalogAccountsFromMaster(client),active:client.deleted!==true,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()},{merge:true})});
        await batch.commit();
      }
      return{documents:missing.length};
    }catch(error){console.warn('direct catalog repair',editor.id,error?.code||error);toast(`${editorName(editor)}さんのクライアント一覧を同期できませんでした`,'err');return{documents:0,error}}
    finally{state.catalogRepairing.delete(editor.id)}
  }
  async function syncDirectCatalogForClient(client,{previous=null}={}){
    if(!_isOwner()||!client)return{documents:0,editors:0};
    const editors=directCatalogEditors(),targets=catalogTargetsForClient(client,{directOnly:true,previous}),byUid=new Map();
    targets.forEach(target=>{if(!byUid.has(target.uid))byUid.set(target.uid,[]);byUid.get(target.uid).push(target.catalog)});
    const batch=fbDb.batch(),masterAccounts=catalogAccountsFromMaster(client),formerNames=[...new Set([...(client.formerNames||[]),previous?.name].filter(name=>name&&nameKey(name)!==nameKey(client.name)))];
    editors.forEach(editor=>{
      const matches=byUid.get(editor.id)||[],catalog=matches[0],ref=fbDb.collection('editor_portals').doc(editor.id).collection('client_catalog').doc(catalog?.id||catalogDocIdForClient(client));
      const accounts=mergeMasterCatalogAccounts(masterAccounts,catalog?.accounts||[]);
      batch.set(ref,{sourceClientId:client.id||client.sourceRecordId||'',name:client.name||'',formerNames,accounts,active:client.deleted!==true,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()},{merge:true});
    });
    if(!editors.length)return{documents:0,editors:0};
    await batch.commit();return{documents:editors.length,editors:editors.length};
  }
  async function syncCatalogAccountChange(client,target,newName,remove){
    const record=clientSourceRecord(client);if(!client||!record)return{documents:0,editors:0};
    const nextAccounts=remove?deleteAccountList(record.accounts||[],target):editAccountList(record.accounts||[],target,newName);
    return syncDirectCatalogForClient({...client,accounts:nextAccounts});
  }
  function masterAccountRecord(clientId,accountId){const client=legacyClients().find(c=>c.id===clientId),account=masterAccounts(client||{}).find(a=>String(a.id)===String(accountId));return{client,account,record:clientSourceRecord(client)}}
  function openMasterAccountEdit(clientId,accountId){
    if(!_isOwner())return toast('アカウントの編集はオーナーのみ行えます','warn');const{client,account}=masterAccountRecord(clientId,accountId);if(!client||!account)return toast('アカウントが見つかりません','warn');
    openModal(`<div class="mhdr"><div><div class="mtitle">アカウント名を編集</div><div style="font-size:11px;color:var(--t3);margin-top:3px">${esc(client.name||'クライアント')}</div></div><button class="mclose" aria-label="閉じる" onclick="closeModal()">✕</button></div><div class="fg"><label class="fl" for="manager-account-name">アカウント名 *</label><input id="manager-account-name" maxlength="100" value="${esc(account.name)}" oninput="markModalDirty()"></div><div style="padding:10px 12px;border-radius:9px;background:var(--app-info-soft);color:var(--app-info);font-size:12px;line-height:1.65">アカウントIDは変えません。既存案件に保存された名称と履歴も変更しません。</div><div class="mfooter"><button class="btn btn-g" onclick="closeModal()">キャンセル</button><button id="manager-account-save" class="btn btn-p" onclick="managerSaveMasterAccountEdit('${esc(clientId)}','${esc(accountId)}')">変更を保存</button></div>`);setTimeout(()=>document.getElementById('manager-account-name')?.focus(),50);
  }
  async function saveMasterAccountEdit(clientId,accountId){
    if(!_isOwner())return toast('アカウントの編集はオーナーのみ行えます','warn');const{client,account,record}=masterAccountRecord(clientId,accountId),nextName=(document.getElementById('manager-account-name')?.value||'').trim(),button=document.getElementById('manager-account-save');
    if(!client||!account||!record)return toast('アカウントが見つかりません','warn');if(!nextName)return toast('アカウント名を入力してください','warn');if(nextName.length>100)return toast('アカウント名は100文字以内で入力してください','warn');if(masterAccounts(client).some(a=>!accountMatches(a,account)&&nameKey(a.name)===nameKey(nextName)))return toast('同じアカウント名が登録済みです','warn');if(nameKey(nextName)===nameKey(account.name)){closeModal();return toast('アカウント名に変更はありません')}
    if(button)button.disabled=true;try{await syncCatalogAccountChange(client,account,nextName,false);record.accounts=editAccountList(record.accounts||[],account,nextName);record.updatedAt=Date.now();save();closeModal();render();toast('アカウント名を変更しました')}catch(e){console.warn(e);if(button)button.disabled=false;toast('アカウント名を変更できませんでした','err')}
  }
  function openMasterAccountDelete(clientId,accountId){
    if(!_isOwner())return toast('アカウントの削除はオーナーのみ行えます','warn');const{client,account}=masterAccountRecord(clientId,accountId);if(!client||!account)return toast('アカウントが見つかりません','warn');
    openModal(`<div class="mhdr"><div><div class="mtitle">アカウントを削除</div><div style="font-size:11px;color:var(--t3);margin-top:3px">${esc(client.name||'クライアント')}</div></div><button class="mclose" aria-label="閉じる" onclick="closeModal()">✕</button></div><div style="padding:12px;border:1px solid #fecdca;border-radius:10px;background:var(--app-danger-soft)"><b style="display:block;color:var(--app-danger)">${esc(account.name)}</b><p style="margin:6px 0 0;color:var(--app-text);font-size:12px;line-height:1.7">今後の案件追加と編集者への共有一覧から削除します。既存案件、請求、進捗、履歴は削除・変更しません。</p></div><div class="mfooter"><button class="btn btn-g" onclick="closeModal()">キャンセル</button><button id="manager-account-delete" class="btn btn-red" onclick="managerConfirmMasterAccountDelete('${esc(clientId)}','${esc(accountId)}')">削除する</button></div>`);
  }
  async function confirmMasterAccountDelete(clientId,accountId){
    if(!_isOwner())return toast('アカウントの削除はオーナーのみ行えます','warn');const{client,account,record}=masterAccountRecord(clientId,accountId),button=document.getElementById('manager-account-delete');if(!client||!account||!record)return toast('アカウントが見つかりません','warn');if(button)button.disabled=true;
    try{await syncCatalogAccountChange(client,account,'',true);record.accounts=deleteAccountList(record.accounts||[],account);record.updatedAt=Date.now();save();closeModal();render();toast('アカウントを削除しました。既存案件の履歴は保持されています')}catch(e){console.warn(e);if(button)button.disabled=false;toast('アカウントを削除できませんでした','err')}
  }
  async function saveMasterAccount(clientId){
    if(!_isOwner())return;const client=legacyClients().find(c=>c.id===clientId),record=clientSourceRecord(client),input=document.getElementById('master-account-'+clientId),accountName=input?.value.trim()||'';
    if(!client||!record||!accountName)return toast('アカウント名を入力してください','warn');const accounts=masterAccounts(client);if(accounts.some(a=>nameKey(a.name)===nameKey(accountName)))return toast('同じアカウントが登録済みです','warn');
    const nextAccounts=addOrReviveAccount(record.accounts||[],{id:safeId(),name:accountName});
    try{await syncDirectCatalogForClient({...client,accounts:nextAccounts});record.accounts=nextAccounts;record.updatedAt=Date.now();save();render();toast('アカウントを追加し、直接契約編集者へ同期しました')}catch(e){console.warn(e);toast('アカウントを同期できませんでした。台帳は変更していません','err')}
  }
  async function saveClientUnitPrice(clientId,accountId=''){
    if(!_isOwner())return toast('クライアント単価の設定はオーナーのみ行えます','warn');
    const client=legacyClients().find(row=>String(row.id)===String(clientId)),input=document.getElementById(ownerPriceInputId(clientId,accountId||'default'));
    if(!client||!input)return toast('クライアントまたはアカウントが見つかりません','err');
    const raw=String(input.value||'').trim(),price=priceValue(raw);
    if(raw!==''&&price===null)return toast('単価は0以上の整数で入力してください','warn');
    const pricingId=ownerPricingDocId(client),current=state.clientPricing.get(pricingId)||{},prices={...accountPriceMap(current)};
    if(accountId){
      if(price===null)delete prices[String(accountId)];else prices[String(accountId)]=price;
    }
    const payload={recordType:'owner_client_pricing',clientSource:String(client._clientSource||'projects'),sourceClientId:String(client.sourceRecordId||client.id||''),clientName:String(client.name||''),accountUnitPrices:prices,defaultClientUnitPrice:accountId?priceValue(current.defaultClientUnitPrice):price,revision:Number(current.revision||0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()};
    try{await fbDb.collection('owner_client_pricing').doc(pricingId).set(payload,{merge:true});toast(price===null?'クライアント単価を未設定に戻しました':'クライアント単価を保存しました')}catch(error){console.warn('owner client pricing',error);toast('クライアント単価を保存できませんでした','err')}
  }
  async function saveClientRate(clientId,accountId=''){
    if(!_isOwner())return toast('単価履歴の設定はオーナーのみ行えます','warn');
    const client=legacyClients().find(row=>String(row.id)===String(clientId));
    const effectiveFrom=ymd(document.getElementById(rateInputId(clientId,accountId,'date'))?.value),clientUnitPrice=rateAmount(document.getElementById(rateInputId(clientId,accountId,'price'))?.value),editorPayAmount=rateAmount(document.getElementById(rateInputId(clientId,accountId,'pay'))?.value,{allowZero:true});
    if(!client||!effectiveFrom)return toast('クライアントと適用開始日を確認してください','warn');
    if(clientUnitPrice===null)return toast('クライアント単価は1円以上の整数で入力してください','warn');
    if(editorPayAmount===null)return toast('編集者支払いは0円以上の整数で入力してください','warn');
    const account=accountId?masterAccounts(client).find(row=>String(row.id)===String(accountId)):null;
    if(accountId&&!account)return toast('アカウントが見つかりません','warn');
    // One record per client/account/effective date.  Updating the same row
    // keeps a visible audit revision instead of silently creating ambiguity.
    const existing=state.clientRates.find(row=>rateScopeMatches(row,client,accountId)&&String(row.effectiveFrom||'')===effectiveFrom);
    const payload={recordType:'owner_client_rate',clientSource:String(client._clientSource||'projects'),sourceClientId:String(client.sourceRecordId||client.id||''),clientName:String(client.name||''),accountId:String(accountId||''),accountName:String(account?.name||''),effectiveFrom,clientUnitPrice,editorPayAmount,active:true,revision:Number(existing?.revision||0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()};
    if(!existing)Object.assign(payload,{createdAt:firebase.firestore.FieldValue.serverTimestamp(),createdBy:_myEmail()});
    try{await fbDb.collection('owner_client_rates').doc(existing?.id||safeId()).set(payload,{merge:true});toast(existing?'単価履歴を更新しました':'単価履歴を追加しました')}catch(error){console.warn('owner client rates',error);toast('単価履歴を保存できませんでした','err')}
  }
  async function toggleClientRate(id,active){
    if(!_isOwner())return toast('単価履歴の変更はオーナーのみ行えます','warn');
    const row=state.clientRates.find(rate=>String(rate.id)===String(id));if(!row)return toast('単価履歴が見つかりません','warn');
    try{await fbDb.collection('owner_client_rates').doc(row.id).set({active:!!active,revision:Number(row.revision||0)+1,updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()},{merge:true});toast(active?'単価履歴を再有効化しました':'単価履歴を無効化しました。既存案件の金額は変わりません')}catch(error){console.warn('owner client rates',error);toast('単価履歴を変更できませんでした','err')}
  }
  async function saveCatalog(){const uid=document.getElementById('mc-editor')?.value||'',clientId=document.getElementById('mc-client')?.value||'',accountName=document.getElementById('mc-account')?.value.trim()||'',master=legacyClients().find(c=>c.id===clientId),sourceRecord=clientSourceRecord(master),available=_isOwner()?master:managedEditors().flatMap(e=>catalogsFor(e.id)).find(c=>c.id===clientId),name=master?.name||available?.name||'';if(!uid||!clientId||!name)return toast('編集者・既存クライアントを選択してください','warn');const existing=catalogsFor(uid).find(x=>x.sourceClientId===clientId||nameKey(x.name)===nameKey(name)),id=existing?.id||safeId(),addedAccount=accountName?[{id:safeId(),name:accountName}]:[],accounts=visibleAccounts(mergeAccounts(existing?.accounts||[],master?masterAccounts(master):[],addedAccount),master?accountHiddenNames(master):new Set());try{await fbDb.collection('editor_portals').doc(uid).collection('client_catalog').doc(id).set({sourceClientId:master?.id||existing?.sourceClientId||'',name,accounts,active:true,manualIds:existing?.manualIds||[],updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()},{merge:true});if(accountName&&master&&sourceRecord&&!masterAccounts(master).some(a=>nameKey(a.name)===nameKey(accountName))){sourceRecord.accounts=addOrReviveAccount(sourceRecord.accounts||[],{id:safeId(),name:accountName});sourceRecord.updatedAt=Date.now();save()}toast('既存クライアント情報を編集者へ共有しました')}catch(e){console.warn(e);toast('クライアントを共有できませんでした','err')}}
  function hydrateClients(){const uid=document.getElementById('mb-editor')?.value||'',el=document.getElementById('mb-client'),open=document.getElementById('mb-open');if(!el)return;if(open&&uid===DIRECT_ALL_ID)open.checked=true;else if(open&&uid)open.checked=false;const rows=clientsForEditor(uid);el.innerHTML='<option value="">クライアントを選択</option>'+rows.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');hydrateAccounts()}
  function hydrateManualAccounts(){
    const clientId=document.getElementById('mm-client')?.value||'',account=document.getElementById('mm-account'),client=legacyClients().find(row=>clientManualId(row)===String(clientId));
    if(!account)return;
    account.innerHTML='<option value="">アカウントを選択</option>'+(client?masterAccounts(client):[]).map(item=>`<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  }
  function manualScopeChanged(){
    const scope=document.getElementById('mm-scope')?.value||'global',client=document.getElementById('mm-client'),account=document.getElementById('mm-account');
    if(client)client.disabled=scope==='global';
    if(account)account.disabled=scope!=='account';
    if(scope==='account')hydrateManualAccounts();
  }
  function manualClientChanged(){if((document.getElementById('mm-scope')?.value||'global')==='account')hydrateManualAccounts()}
  function renderBoardPricingStatus(){
    const el=document.getElementById('mb-client-pricing-status');if(!el||!_isOwner())return;
    const uid=document.getElementById('mb-editor')?.value||'',clientId=document.getElementById('mb-client')?.value||'',accountId=document.getElementById('mb-account')?.value||'',client=clientsForEditor(uid).find(x=>x.id===clientId),pricing=client?ownerClientPricingSnapshot(client.id,accountId):null;
    if(!client){el.textContent='クライアントを選択すると、オーナー専用の単価マスターを確認できます。アカウント未選択時はクライアント共通の標準単価を表示します。';return}
    if(!state.clientPricingReady){el.textContent='クライアント単価マスターを読み込み中です。';return}
    const scopeLabel=accountId?'このクライアント・アカウント':'このクライアント共通';
    el.textContent=pricing?.amount===null||pricing?.amount===undefined?`${scopeLabel}の標準単価は未設定です。クライアント一覧で設定してください。`:`オーナー専用の標準単価：¥${Number(pricing.amount).toLocaleString()}（案件へは受託後に自動入力されます）`;
  }
  function hydrateAccounts(){const uid=document.getElementById('mb-editor')?.value||'',cid=document.getElementById('mb-client')?.value||'',client=clientsForEditor(uid).find(x=>x.id===cid),el=document.getElementById('mb-account');if(!el)return;const accounts=client?.accounts||[];el.innerHTML=`<option value="">${cid?'アカウントなし（クライアント共通）':'先にクライアントを選択'}</option>`+accounts.map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');el.onchange=renderBoardPricingStatus;renderBoardPricingStatus()}
  async function addBoardAccount(){
    if(!_isOwner())return toast('オーナーのみ登録できます','warn');const target=document.getElementById('mb-editor')?.value||'',clientId=document.getElementById('mb-client')?.value||'',input=document.getElementById('mb-account-new'),accountName=input?.value.trim()||'',master=legacyClients().find(c=>c.id===clientId),record=clientSourceRecord(master);
    if(!target||!master||!record)return toast('先にクライアントを選択してください','warn');if(!accountName)return toast('新しいアカウント名を入力してください','warn');if(masterAccounts(master).some(a=>nameKey(a.name)===nameKey(accountName)))return toast('同じアカウントが登録済みです','warn');
    const existing=(record.accounts||[]).find(a=>nameKey(a?.name||a)===nameKey(accountName)),account={id:existing?.id||safeId(),name:accountName},nextAccounts=addOrReviveAccount(record.accounts||[],account);
    try{await syncDirectCatalogForClient({...master,accounts:nextAccounts});record.accounts=nextAccounts;record.updatedAt=Date.now();save();const clientEl=document.getElementById('mb-client');hydrateClients();if(clientEl){clientEl.value=clientId;hydrateAccounts();const accountEl=document.getElementById('mb-account');if(accountEl)accountEl.value=account.id}if(input)input.value='';toast('アカウントを登録し、直接契約編集者へ同期しました')}catch(e){console.warn(e);toast('アカウントを同期できませんでした。台帳は変更していません','err')}
  }
  function clientModalValue(){return{name:(document.getElementById('cl-name')?.value||'').trim(),notes:(document.getElementById('cl-notes')?.value||'').trim(),isTrial:document.getElementById('cl-trial-val')?.value==='1'}}
  function withClientFormerName(current,next){const formerNames=[...new Set([...(current?.formerNames||[]),current?.name].filter(name=>name&&nameKey(name)!==nameKey(next.name)))];return{...current,...next,formerNames}}
  async function saveClientWithCatalog(){
    if(!_isOwner())return originalSaveClient();
    const values=clientModalValue();if(!values.name)return toast('クライアント名を入力してください','err');
    const current=EID?(S.clients||[]).find(client=>client.id===EID):null,previous=current?JSON.parse(JSON.stringify(current)):null;
    const next=current?withClientFormerName(current,values):{id:uid(),...values,formerNames:[],createdAt:new Date().toISOString()};
    try{
      const result=await syncDirectCatalogForClient(next,{previous});
      if(current){
        const wasTrialBefore=current.isTrial;Object.assign(current,next);
        if(wasTrialBefore&&!next.isTrial){if(!S.logs)S.logs=[];S.logs.push({id:uid(),type:'sales',date:today(),title:next.name,result:'成約',note:'トライアル→成約に変更時に自動記帳',sourceClientId:current.id,createdAt:new Date().toISOString()});toast(`🎉 ${next.name} の成約を営業目標に記帳しました`)}
      }else{
        S.clients.push(next);if(!S.logs)S.logs=[];if(!next.isTrial)S.logs.push({id:uid(),type:'sales',date:today(),title:next.name,result:'成約',note:'クライアント追加時に自動記帳',sourceClientId:next.id,createdAt:new Date().toISOString()});
      }
      save();closeModal();render();toast(`クライアントを保存しました（直接契約編集者 ${result.editors}名・${result.documents}件を同期）`);
    }catch(e){console.warn(e);toast('クライアントを同期できませんでした。台帳は変更していません','err')}
  }
  async function confirmDelClientWithCatalog(id){
    if(!_isOwner())return originalConfirmDelClient(id);
    const current=(S.clients||[]).find(client=>client.id===id);if(!current)return;
    const previous=JSON.parse(JSON.stringify(current)),next={...current,deleted:true,formerNames:[...new Set([...(current.formerNames||[]),current.name].filter(Boolean))]};
    try{const result=await syncDirectCatalogForClient(next,{previous});Object.assign(current,next);save();closeModal();render();toast(`クライアントを削除しました（直接契約編集者 ${result.editors}名・${result.documents}件を無効化）`)}catch(e){console.warn(e);toast('クライアントを同期できませんでした。台帳は変更していません','err')}
  }
  async function syncMasterCatalog(){
    if(!_isOwner())return toast('一括同期はオーナーのみ実行できます','warn');
    const clients=legacyClients(),editors=directCatalogEditors();if(!clients.length)return toast('同期するクライアントがありません','warn');if(!editors.length)return toast('直接契約編集者がいません','warn');
    if(!confirm(`既存クライアント ${clients.length}件を直接契約編集者 ${editors.length}名へ同期します。外部編集者には共有しません。既存案件・履歴は変更しません。`))return;
    try{const results=await Promise.all(clients.map(client=>syncDirectCatalogForClient(client))),documents=results.reduce((sum,result)=>sum+result.documents,0);toast(`一括同期しました：クライアント ${clients.length}件 ／ 編集者 ${editors.length}名 ／ カタログ ${documents}件`);renderSafe()}catch(e){console.warn(e);toast('一括同期に失敗しました。台帳・案件は変更していません','err')}
  }
  function requestModeChanged(){
    const mode=document.getElementById('mb-mode')?.value||'public',internal=mode==='internal',open=document.getElementById('mb-open'),openLabel=document.getElementById('mb-open-label'),target=document.getElementById('mb-editor'),submit=document.getElementById('mb-submit');if(!open||!target)return;
    if(internal){open.checked=false;open.disabled=true;target.value=SELF_WID;document.querySelectorAll('.mb-subcase-draft-setter').forEach(select=>{select.value='creator';boardDraftSetterChanged(select)})}
    else if(mode==='request'){open.checked=false;open.disabled=true;if(target.value===DIRECT_ALL_ID||target.value===SELF_WID)target.value=state.editors[0]?.id||''}
    else{if(target.value===SELF_WID)target.value=DIRECT_ALL_ID;open.disabled=isDirector();if(_isOwner()&&target.value===DIRECT_ALL_ID)open.checked=true}
    if(openLabel)openLabel.style.display=internal?'none':'flex';if(submit)submit.textContent=internal?'mono.create 内編集として追加':'案件を掲載・リクエスト';hydrateClients();hydrateBoardManualSelectors();
  }
  function boardTargetChanged(){
    const target=document.getElementById('mb-editor'),mode=document.getElementById('mb-mode');if(!target||!mode)return;
    if(target.value===SELF_WID)mode.value='internal';else if(mode.value==='internal')mode.value='public';
    requestModeChanged();hydrateClients();hydrateBoardManualSelectors();
  }
  function boardAudienceChanged(){const mode=document.getElementById('mb-mode')?.value||'public',open=document.getElementById('mb-open'),target=document.getElementById('mb-editor');if(mode==='internal'){if(open)open.checked=false;hydrateBoardManualSelectors();return}if(mode==='request'){if(open)open.checked=false;hydrateBoardManualSelectors();return}if(open?.checked&&target&&_isOwner()){target.value=DIRECT_ALL_ID;hydrateClients()}hydrateBoardManualSelectors()}
  async function publishBoard(){
    const target=document.getElementById('mb-editor')?.value||'',mode=document.getElementById('mb-mode')?.value||'public',clientId=document.getElementById('mb-client')?.value||'',accountId=document.getElementById('mb-account')?.value||'',client=clientsForEditor(target).find(x=>x.id===clientId),account=client?.accounts?.find(x=>x.id===accountId)||null,caseName=document.getElementById('mb-case')?.value.trim()||'',openAll=target===DIRECT_ALL_ID||!!document.getElementById('mb-open')?.checked;
    const internal=mode==='internal';
    if(internal&&!_isOwner())return toast('mono.create 内編集はオーナーのみ追加できます','warn');
    if(mode==='request'&&(!target||target===DIRECT_ALL_ID))return toast('編集リクエストを送る編集者を1名選んでください','warn');
    if((!openAll&&!target)||!client)return toast('公開先・クライアントを選択してください','warn');
    if(accountId&&!account)return toast('選択したアカウントを確認してください','warn');
    const parentRequestUrl=document.getElementById('mb-parent-request')?.value.trim()||'',parentSourceUrl=document.getElementById('mb-parent-source')?.value.trim()||'',parentManualIds=combinedManualIds(selectedManualIds(document.getElementById('mb-parent-manuals')),scopedManualIdsForCase(client,account,target,openAll)),parentCaution=document.getElementById('mb-parent-caution')?.value.trim()||'';
    if((parentRequestUrl&&!safeUrl(parentRequestUrl))||(parentSourceUrl&&!safeUrl(parentSourceUrl)))return toast('親案件共通リンクは https:// または http:// で入力してください','warn');
    const parentAttachmentRead=typeof _readVideoAttachments==='function'?_readVideoAttachments(document.getElementById('mb-parent-attachment-list')):{error:'',items:[]};
    if(parentAttachmentRead.error)return toast(parentAttachmentRead.error,'warn');
    const subcases=readBoardSubcases();if(subcases.error)return toast(subcases.error,'warn');
    const tooManyAttachments=subcases.items.find(item=>parentAttachmentRead.items.length+item.attachments.length>20);
    if(tooManyAttachments)return toast(`「${tooManyAttachments.title}」：親案件共通と個別を合わせて素材・資料は20件までです`,'warn');
    if(subcases.items.length>1&&!caseName)return toast('複数の子案件は、親案件・バッチ名を入力してください','warn');
    const parentCaseId=safeId(),parentCaseName=caseName||subcases.items[0].title,targetEditor=openAll?null:state.editors.find(x=>x.id===target),directorUid=openAll?'':isDirector()?FB_USER.uid:(targetEditor?.editorKind==='external'?targetEditor.directorUid||'':'');
    try{
      if(internal){
        const firstDate=key=>subcases.items.map(item=>item[key]).filter(Boolean).sort()[0]||null,at=Date.now(),price=Number(ownerClientPricingSnapshot(client.id,account?.id||'')?.amount)||0,subtasks=subcases.items.map((item,subtaskIndex)=>({id:item.id,title:item.title,subtaskIndex,done:false,status:'未着手',workerId:SELF_WID,sharedDate:today(),editorDraftDateSetter:'creator',editorDraftDate:item.editorDraftDate||null,clientDraftDate:item.clientDraftDate||null,deliveryDate:item.deliveryDate||null,completedDeliveryDate:null,unitPrice:price,workerPay:0,profit:price,instructions:item.instructions,manualIds:combinedManualIds(parentManualIds,item.manualIds),caution:item.caution||parentCaution,requestUrl:item.requestUrl||parentRequestUrl,sourceUrl:item.sourceUrl||parentSourceUrl,attachments:item.attachments,billingAssigneeWorkerId:SELF_WID,billingRecipientWorkerId:SELF_WID,billingRoute:'internal',billingResolutionStatus:'resolved'})),unitPrice=subtasks.reduce((sum,item)=>sum+(item.unitPrice||0),0);
        if(!S.jobs)S.jobs=[];
        S.jobs.unshift({id:parentCaseId,biz:'edit',jobType:'edit',title:parentCaseName,clientId:client.sourceClientId||client.id,accountId:account?.id||null,accountName:account?.name||null,workerId:SELF_WID,workerIds:[SELF_WID],billingAssigneeWorkerId:SELF_WID,billingRecipientWorkerId:SELF_WID,billingRoute:'internal',billingResolutionStatus:'resolved',scope:'動画編集',status:'未着手',unitPrice,workerPay:0,profit:unitPrice,sharedDate:today(),editorDraftDateSetter:'creator',editorDraftDate:firstDate('editorDraftDate'),clientDraftDate:firstDate('clientDraftDate'),deliveryDate:firstDate('deliveryDate'),completedDeliveryDate:null,notes:[client.name,account?.name].filter(Boolean).join(' / '),manualIds:parentManualIds,caution:parentCaution,requestUrl:parentRequestUrl,sourceUrl:parentSourceUrl,subtasks,attachments:parentAttachmentRead.items,source:'internal_edit',createdAt:new Date().toISOString(),updatedAt:at,updatedBy:_myEmail()});
        save();render();toast(`mono.create 内編集として${subcases.items.length}件追加しました`);return;
      }
      const batch=fbDb.batch();
      subcases.items.forEach((subcase,subtaskIndex)=>{
        const requestUrl=subcase.requestUrl||parentRequestUrl,sourceUrl=subcase.sourceUrl||parentSourceUrl,attachments=[...parentAttachmentRead.items,...subcase.attachments].slice(0,20),manualIds=combinedManualIds(parentManualIds,subcase.manualIds),caution=subcase.caution||parentCaution;
        const data={businessType:'edit_agency',title:subcase.title,caseName:parentCaseName,parentCaseId,parentCaseName,subtaskIndex,clientId:client.sourceClientId||client.id,clientName:client.name,accountId:account?.id||'',accountName:account?.name||'',summary:subcase.instructions.slice(0,300),instructions:subcase.instructions,requestUrl,sourceUrl,attachments,manualIds,parentManualIds,caution,parentCaution,editorDraftDateSetter:subcase.editorDraftDateSetter,editorDraftDate:subcase.editorDraftDate,clientDraftDate:subcase.clientDraftDate,thumbnailDate:'',deliveryDate:subcase.deliveryDate,urgent:false,status:'open',audience:openAll?'direct':(directorUid?'director_team':'designated'),eligibleUids:openAll?[]:[target],directorUid,createdByUid:FB_USER.uid,createdByName:_myEmail(),assignedUid:'',assignedName:'',assignedAt:null,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()};
        batch.set(fbDb.collection('editor_job_board').doc(subcase.id),data);
      });
      await batch.commit();
      if(_isOwner()){
        // S.jobs is synchronised to the legacy/shared views.  Keep its new
        // board records money-free; owner_job_finance is created only when the
        // accepted case has an owner-confirmed payment route.
        const firstDate=key=>subcases.items.map(item=>item[key]).filter(Boolean).sort()[0]||null,parentDraftSetter=subcases.items.every(item=>item.editorDraftDateSetter==='editor')?'editor':subcases.items.every(item=>item.editorDraftDateSetter==='creator')?'creator':'mixed',at=Date.now(),subtasks=subcases.items.map((item,subtaskIndex)=>({id:item.id,title:item.title,subtaskIndex,done:false,status:'案件掲載中',workerId:null,sharedDate:today(),editorDraftDateSetter:item.editorDraftDateSetter,editorDraftDate:item.editorDraftDate||null,clientDraftDate:item.clientDraftDate||null,deliveryDate:null,completedDeliveryDate:null,instructions:item.instructions,manualIds:item.manualIds.length?item.manualIds:parentManualIds,caution:item.caution||parentCaution,requestUrl:item.requestUrl||parentRequestUrl,sourceUrl:item.sourceUrl||parentSourceUrl,attachments:item.attachments,billingResolutionStatus:'unresolved'}));
        if(!S.jobs)S.jobs=[];
        S.jobs.unshift({id:parentCaseId,biz:'edit',jobType:'edit',title:parentCaseName,clientId:client.sourceClientId||client.id,workerId:null,workerIds:[],scope:'動画編集',status:'案件掲載中',unitPrice:0,workerPay:0,profit:0,sharedDate:today(),editorDraftDateSetter:parentDraftSetter,editorDraftDate:firstDate('editorDraftDate'),clientDraftDate:firstDate('clientDraftDate'),deliveryDate:null,completedDeliveryDate:null,notes:[client.name,account?.name].filter(Boolean).join(' / '),manualIds:parentManualIds,caution:parentCaution,requestUrl:parentRequestUrl,sourceUrl:parentSourceUrl,subtasks,attachments:parentAttachmentRead.items,source:'editor_job_board',boardParentCaseId:parentCaseId,createdAt:new Date().toISOString(),updatedAt:at,updatedBy:_myEmail()});
        save();
      }
      toast(mode==='request'?`編集リクエストを${subcases.items.length}件送りました`:`案件を${subcases.items.length}件掲載しました`);
    }catch(e){console.warn(e);toast(mode==='request'?'編集リクエストを送れませんでした':'案件を掲載できませんでした','err')}
  }
  async function saveManual(){let target=document.getElementById('mm-editor')?.value||'all';if(isDirector()&&target==='all')return toast('ディレクターは自分の外部編集者を選択してください','warn');const title=document.getElementById('mm-title')?.value.trim()||'',body=document.getElementById('mm-body')?.value.trim()||'',url=document.getElementById('mm-url')?.value.trim()||'',scope=document.getElementById('mm-scope')?.value||'global',clientId=scope==='global'?'':(document.getElementById('mm-client')?.value||''),accountId=scope==='account'?(document.getElementById('mm-account')?.value||''):'';if(!title||(!body&&!url))return toast('タイトルと本文またはURLを入力してください','warn');if(scope!=='global'&&!clientId)return toast('対象クライアントを選択してください','warn');if(scope==='account'&&!accountId)return toast('対象アカウントを選択してください','warn');const actor=_myEmail(),timestamp=firebase.firestore.FieldValue.serverTimestamp(),data={recordType:'editor_manual',kind:'manual',title,scope,scopeLabel:scope==='global'?'全体':scope==='client'?'クライアント':'アカウント',clientId,accountId,version:document.getElementById('mm-version')?.value.trim()||'1.0',body,url,required:!!document.getElementById('mm-required')?.checked,audience:target==='all'?'all':'assigned',allowedUids:target==='all'?[]:[target],directorUid:isDirector()?FB_USER.uid:'',active:true,createdAt:timestamp,createdBy:actor,updatedAt:timestamp,updatedBy:actor};try{await fbDb.collection('editor_manuals').doc(safeId()).set(data);toast('マニュアルを保存しました。新規案件へ自動添付されます')}catch(e){console.warn(e);toast('マニュアルを保存できませんでした','err')}}
  async function migrateExternalSettlement(){
    if(!_isOwner())return toast('金額データの移行はオーナーのみ行えます','warn');
    let rows=[];try{rows=await settlementRowsForPortals(state.editors.filter(e=>e.editorKind==='external').map(e=>e.id))}catch(e){console.warn(e);return toast('金額データを確認できませんでした','err')}if(!rows.length)return toast('移行対象の金額データはありません');
    if(!confirm(`外部編集者の案件 ${rows.length}件から金額4項目を分離します。\n案件・進捗・履歴は変更しません。\n分離前の値はオーナー専用アーカイブに保存します。`))return;
    try{
      await archiveSettlementRows(rows);
      toast(`外部編集者 ${rows.length}件の金額を安全領域へ移しました`);renderSafe();
    }catch(e){console.warn(e);toast('金額データの移行に失敗しました。アーカイブと案件の状態を再確認してください','err')}
  }
  async function invoiceAction(portalUid,id,next){
    if(!_isOwner())return toast('請求書の承認・差戻しはオーナーのみ行えます','warn');
    const x=state.invoices.find(v=>v._portalUid===portalUid&&v.id===id);if(!x)return;
    if(next==='承認済み'&&x.taxInclusive!==true)return toast('旧方式の税別請求書は承認できません。差戻して税込金額で再作成してください','warn');
    const actionKey=`${portalUid}:${id}`;if(state.invoiceActionPending.has(actionKey))return toast('請求書を更新中です。完了までお待ちください','warn');
    state.invoiceActionPending.add(actionKey);
    try{
      let reason='';
      if(next==='差戻し'){reason=(prompt('差戻し理由を入力してください')||'').trim();if(!reason)return}
      else if(next==='承認済み'){
        const sharedWith=new Set((x.file?.sharedWith||[]).map(value=>String(value||'').toLowerCase())),requiredOwners=(typeof ADMIN_EMAILS!=='undefined'?ADMIN_EMAILS:[]).map(value=>String(value||'').toLowerCase());
        if(x.file?.provider!=='google-drive'||!x.file?.id||!x.file?.sha256||x.ownerShareStatus!=='shared'||!requiredOwners.length||!requiredOwners.every(email=>sharedWith.has(email)))return toast('Drive原本・全管理者への共有・改ざん確認値がそろうまで承認できません','warn');
        if(!confirm('Drive原本・明細・振込先を確認しましたか？'))return;
      }
      const at=Date.now(),portal=fbDb.collection('editor_portals').doc(portalUid),ref=portal.collection('editor_invoices').doc(id),batch=fbDb.batch();
      batch.set(ref,{status:next,reviewReason:reason||null,updatedAt:at,updatedBy:_myEmail(),history:[...(x.history||[]).slice(-99),{at,by:_myEmail(),status:next,reason}]},{merge:true});
      if(next==='差戻し'&&x.authorizationId&&x.authorizationId!=='manual'){
        const nextVersion=Number(x.version||1)+1,nextInvoiceId=`${x.authorizationId}-v${nextVersion}-${at}`;
        const authorization=state.authorizations.find(a=>a._portalUid===portalUid&&a.id===x.authorizationId),totals=invoiceTaxInclusiveTotals(authorization?.lines||x.lines||[]);
        batch.update(portal.collection('invoice_authorizations').doc(x.authorizationId),{taxInclusive:true,...totals,invoiceVersion:nextVersion,invoiceDocumentId:nextInvoiceId,updatedAt:at,updatedBy:_myEmail()});
      }
      batch.set(ref.collection('events').doc(),{at:firebase.firestore.FieldValue.serverTimestamp(),byUid:FB_USER.uid,status:next,reason,invoiceId:id});
      await batch.commit();toast(`請求書を「${next}」に更新しました`);
    }catch(e){console.warn(e);toast('請求書を更新できませんでした','err')}
    finally{state.invoiceActionPending.delete(actionKey)}
  }
  async function sendMessage(portalUid,jid){const requested=prompt('種類（回答・修正指示・連絡など）','連絡');if(!requested)return;const allowed=['質問','回答','初稿提出','修正指示','修正稿提出','納品','連絡'],kind=allowed.includes(requested)?requested:'連絡';const body=(prompt('メッセージを入力してください')||'').trim();if(!body)return;const url=(prompt('関連URL（なければ空欄）','')||'').trim();try{await fbDb.collection('editor_portals').doc(portalUid).collection('editor_jobs').doc(jid).collection('messages').add({body,kind,url,byUid:FB_USER.uid,byName:APP_ACCESS?.name||_myEmail(),byRole:_isOwner()?'オーナー':'ディレクター',createdAt:firebase.firestore.FieldValue.serverTimestamp()});toast('案件チャットに送信しました')}catch(e){console.warn(e);toast('メッセージを送信できませんでした','err')}}
  async function replySuggestion(id,code){const message=(prompt('匿名返信を入力してください')||'').trim();if(!message)return;try{const batch=fbDb.batch();batch.set(fbDb.collection('editor_suggestion_replies').doc(code),{message,createdAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});batch.set(fbDb.collection('editor_suggestions').doc(id),{status:'返信済み'},{merge:true});await batch.commit();toast('匿名返信を保存しました')}catch(e){console.warn(e);toast('返信を保存できませんでした','err')}}
  function openChatworkNameCheck(uid){
    if(!_isOwner())return toast('Chatwork名の確認はオーナーのみ行えます','warn');
    const editor=state.editors.find(x=>x.id===uid)||(ACCESS_RECORDS||[]).find(x=>x.id===uid);if(!editor)return toast('編集者が見つかりません','warn');
    const current=editor.name||'',verified=editor.chatworkName||'';
    openModal(`<div class="mhdr"><div><div class="mtitle">Chatwork表示名を確認</div><div style="font-size:11px;color:var(--t3);margin-top:3px">${esc(editor.email||'')}</div></div><button class="mclose" onclick="closeModal()">✕</button></div><div style="font-size:11px;color:var(--t2);line-height:1.65;margin-bottom:10px">Chatworkで現在使われている表示名を確認して入力してください。保存後は、アプリ名との差分を編集者一覧で自動検出します。</div><div class="fg"><div class="fl">アプリに登録中の名前</div><input value="${esc(current)}" disabled></div><div class="fg"><div class="fl">確認したChatwork表示名 *</div><input id="manager-chatwork-name" maxlength="80" value="${esc(verified)}" placeholder="Chatworkと同じ名前"></div><label style="display:flex;gap:7px;align-items:flex-start;font-size:12px;margin-top:10px"><input id="manager-chatwork-sync" type="checkbox" checked style="width:auto;margin-top:2px"><span>アプリの登録名もこのChatwork表示名にそろえる</span></label><div class="mfooter"><button class="btn btn-g" onclick="closeModal()">キャンセル</button><button class="btn btn-p" onclick="managerSaveChatworkNameCheck('${esc(editor.id)}')">確認結果を保存</button></div>`);
  }
  async function saveChatworkNameCheck(uid){
    if(!_isOwner())return toast('Chatwork名の確認はオーナーのみ行えます','warn');
    const editor=state.editors.find(x=>x.id===uid)||(ACCESS_RECORDS||[]).find(x=>x.id===uid),chatworkName=(document.getElementById('manager-chatwork-name')?.value||'').trim(),sync=!!document.getElementById('manager-chatwork-sync')?.checked;
    if(!editor)return toast('編集者が見つかりません','warn');
    if(!chatworkName)return toast('Chatwork表示名を入力してください','warn');
    const payload={chatworkName,chatworkNameVerifiedAt:firebase.firestore.FieldValue.serverTimestamp(),chatworkNameVerifiedBy:_myEmail(),updatedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedBy:_myEmail()};
    if(sync)payload.name=chatworkName;
    try{
      await fbDb.collection('access').doc(uid).set(payload,{merge:true});
      if(sync){
        const legacy=(S.memberRoles||[]).find(x=>x&&!x.deleted&&String(x.email||'').toLowerCase()===String(editor.email||'').toLowerCase());
        if(legacy){legacy.name=chatworkName;legacy.updatedAt=Date.now();save();}
      }
      closeModal();toast(sync?'Chatwork名を確認し、アプリ名も更新しました':'Chatwork名の確認結果を保存しました');
    }catch(e){console.warn(e);toast('Chatwork名を保存できませんでした','err');}
  }

  function syncManagerLifecycle(retries=3){
    state.lifecycleTimer=null;
    if(!FB_USER){stop();renderSafe();return}
    if(!ACCESS_RESOLVED){
      if(retries>0)state.lifecycleTimer=setTimeout(()=>syncManagerLifecycle(retries-1),500);
      return;
    }
    if(canManage())start();else stop();
    renderSafe();
  }
  function scheduleManagerLifecycle(delay=0){
    if(state.lifecycleTimer!==null)clearTimeout(state.lifecycleTimer);
    state.lifecycleTimer=setTimeout(()=>syncManagerLifecycle(),delay);
  }

  window.managerBoardFormToggled=boardFormToggled;
  window.saveClient=saveClientWithCatalog;window.confirmDelClient=confirmDelClientWithCatalog;window.managerSyncLegacyAssignments=syncLegacyAssignmentsForEditor;window.managerSaveClientUnitPrice=saveClientUnitPrice;window.managerSaveClientRate=saveClientRate;window.managerToggleClientRate=toggleClientRate;window.getOwnerClientUnitPrice=ownerClientUnitPrice;window.managerOwnerClientUnitPrice=ownerClientUnitPrice;window.managerOwnerClientAccounts=ownerClientAccounts;window.managerOwnerClientPricingSnapshot=ownerClientPricingSnapshot;window.managerEnsureClientRatesReady=ensureClientRatesReady;window.managerOwnerClientRateForCase=ownerClientRateForCase;window.managerClientPricingReady=()=>_isOwner()&&state.clientPricingReady;window.managerManualScopeChanged=manualScopeChanged;window.managerManualClientChanged=manualClientChanged;
  window.managerRelationToggle=relationToggle;window.managerSaveRelation=saveRelation;window.managerSaveMasterAccount=saveMasterAccount;window.managerOpenMasterAccountEdit=openMasterAccountEdit;window.managerSaveMasterAccountEdit=saveMasterAccountEdit;window.managerOpenMasterAccountDelete=openMasterAccountDelete;window.managerConfirmMasterAccountDelete=confirmDelClientWithCatalog;window.managerSaveCatalog=saveCatalog;window.managerSyncMasterCatalog=syncMasterCatalog;window.managerHydrateBoardCatalog=hydrateClients;window.managerHydrateBoardAccounts=hydrateAccounts;window.managerHydrateBoardManuals=hydrateBoardManualSelectors;window.managerAddBoardAccount=addBoardAccount;window.managerAddBoardSubcase=addBoardSubcase;window.managerRemoveBoardSubcase=removeBoardSubcase;window.managerBoardDraftSetterChanged=boardDraftSetterChanged;window.managerRequestModeChanged=requestModeChanged;window.managerBoardTargetChanged=boardTargetChanged;window.managerBoardAudienceChanged=boardAudienceChanged;window.managerOpenBoardForm=openBoardForm;window.managerPublishBoardJob=publishBoard;window.managerSaveManual=saveManual;window.managerSelectableManualsForCase=(targetUid='')=>selectableManualsForCase(targetUid,false).map(({id,title,required,audience})=>({id,title,required,audience}));window.managerMigrateExternalSettlement=migrateExternalSettlement;window.managerInvoiceAction=invoiceAction;window.managerSendMessage=sendMessage;window.managerReplySuggestion=replySuggestion;window.managerOpenChatworkNameCheck=openChatworkNameCheck;window.managerSaveChatworkNameCheck=saveChatworkNameCheck;window.__managerStatusLogic={normalizeChatworkName,legacyAssignmentCount,legacySyncEntriesForEditor,legacyUnlinkedEntriesForEditor,canSyncLegacyForEditor};window.__managerAccountLogic={mergeAccounts,visibleAccounts,editAccountList,deleteAccountList,addOrReviveAccount,catalogAccountChange,mergeMasterCatalogAccounts,catalogAccountsFromMaster};window.__managerCatalogSyncLogic={catalogDocIdForClient,mergeMasterCatalogAccounts};window.__managerBoardSubcaseLogic={boardSubcaseRowHtml,boardDraftSetterChanged,selectableManualsForCase};window.__managerPricingLogic={priceValue,accountPriceMap,clientUnitPriceFor};window.__managerExternalPrivacyLogic={hasExternalSettlement};
  window.managerConfirmMasterAccountDelete=confirmMasterAccountDelete;
  window.__managerPricingLogic={priceValue,accountPriceMap,clientUnitPriceFor,rateAmount,selectClientRate,rateScopeMatches};
  fbAuth.onAuthStateChanged(()=>scheduleManagerLifecycle(800));
  window.addEventListener('pageshow',()=>scheduleManagerLifecycle());
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)scheduleManagerLifecycle()});
  setTimeout(renderSafe,50);
})();
