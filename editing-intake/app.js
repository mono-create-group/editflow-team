'use strict';
globalThis.MonoEditingIntake = {mount: function mount(mountOptions={}) {
  const embedded=Boolean(mountOptions.root);
  const realDocument=globalThis.document;
  const controller=embedded?new AbortController():null;
  let disposed=false;
  const document=embedded?{
    getElementById:id=>mountOptions.root.getElementById(id),
    querySelector:selector=>mountOptions.root.querySelector(selector),
    querySelectorAll:selector=>mountOptions.root.querySelectorAll(selector),
    createElement:tag=>realDocument.createElement(tag),
    addEventListener:(type,listener)=>mountOptions.root.addEventListener(type,listener,{signal:controller.signal}),
    get body(){return mountOptions.root.querySelector('[data-intake-shell]');},
    get activeElement(){return mountOptions.root.activeElement;},
    get visibilityState(){return realDocument.visibilityState;}
  }:realDocument;
  if(embedded&&(typeof mountOptions.getAuthHeaders!=='function'||!/^https:\/\/mono-editing-intake\.mono-create-group\.workers\.dev\/api\/internal-admin$/.test(mountOptions.apiBase)))throw Error('Invalid internal API configuration');

  const $ = id => document.getElementById(id);
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const receiptNumber = id => /^order_[a-f0-9]{40}$/.test(id) ? id.slice(-12).toUpperCase().match(/.{4}/g).join('-') : String(id);
  const customerDisplayName = o => o.customerName?.trim()||'お名前未登録';
  const money = n => new Intl.NumberFormat('ja-JP', {style:'currency',currency:'JPY'}).format(n);
  const labels = {inquiry:'相談内容の確認中',quoted:'見積もり確認待ち',accepted:'お手続き・制作中',awaiting:'制作開始前',editing:'編集中',delivered:'納品確認待ち',revision_requested:'修正内容の確認中',revising:'修正中',completed:'完了',cancellation_pending:'キャンセル手続き中',cancelled:'キャンセル完了'};
  const kinds = {customer:'ご希望による修正',provider_error:'制作側の不備',major_change:'大幅な変更の相談'};
  const commandLabels = {create_order:'相談を受け付け',update_hearing:'ヒアリング回答を更新',issue_quote:'見積もりを提示',accept_quote:'見積もりを承認',report_payment:'振込を報告',verify_payment:'入金を確認',report_materials:'素材提出を報告',verify_materials:'素材を確認',reconfirm_delivery:'納品日の再合意を記録',start_editing:'編集を開始',deliver:'動画を納品',request_revision:'修正を依頼',classify_revision:'修正内容を分類',start_revision:'修正を開始',confirm_delivery:'納品を確認',request_cancellation:'キャンセルの相談を記録',stop_for_cancellation:'作業停止を記録',reconcile_cancellation_payments:'入金総額の照合を記録',issue_cancellation_settlement:'キャンセルの精算案を提示',accept_cancellation_settlement:'精算案への同意を記録',record_cancellation_refund:'返金の実施記録を保存',finalize_cancellation:'キャンセルの完了を記録',issue_revision_quote:'追加見積もりを提示',accept_revision_quote:'追加見積もりへの同意を記録',report_revision_payment:'追加料金の振込を報告',verify_revision_payment:'追加料金の入金確認を記録',reconfirm_revision_delivery:'追加作業の納品日再合意を記録'};
  const state = {user:null,csrf:null,config:null,order:null,orders:[],busy:false,view:'list',filter:'active',search:'',materials:null,pageMeta:null,pageCursor:null,previousCursors:[],nextCursor:null};
  let inquiryDraft=null;const hearingDrafts=new Map();
  const entryKey='editing.entry-intent.v1';
  const entryValues=new Set(['new','additional','orders','support']);
  let entryStorageFailed=false;
  function captureEntry() {
    if(embedded)return null;
    const hash=globalThis.location?.hash||'';
    let saved=null;try{saved=sessionStorage.getItem(entryKey);}catch{entryStorageFailed=true;}
    const selected=hash?hash.slice(1):saved;
    const intent=entryValues.has(selected)?selected:null;
    try{if(intent)sessionStorage.setItem(entryKey,intent);else sessionStorage.removeItem(entryKey);}catch{entryStorageFailed=true;}
    return intent;
  }
  let pendingEntry=captureEntry();
  function consumeEntry(){
    const intent=pendingEntry;pendingEntry=null;if(embedded)return null;
    try{sessionStorage.removeItem(entryKey);}catch{entryStorageFailed=true;}
    if(entryValues.has((globalThis.location?.hash||'').slice(1))){try{globalThis.history?.replaceState(null,'',globalThis.location.pathname+globalThis.location.search);}catch{}}
    return intent;
  }
  async function renderEntry(){
    const intent=consumeEntry();
    if(admin()||!intent){await loadList();return;}
    if(intent==='new'){await loadList();renderNew();}
    else if(intent==='additional'){
      state.view='additional';state.order=null;
      $('content').innerHTML=`<section class="panel"><h1>追加依頼</h1><p>新しい動画の相談と、ご依頼済みの動画への素材追加は、別のお手続きです。</p><div class="actions">${button('新しい動画を相談する','new',true)}${button('このアプリの案件に素材を追加する','list')}</div><p class="hint">素材追加だけでは、新しい注文や請求は発生しません。</p>${legacyOrderHelp()}</section>`;
    }else{
      await loadList();
      if(intent==='support')$('content').innerHTML=`<section class="panel"><h1>修正・質問</h1><p>修正は下の一覧から対象案件を開き、該当する動画の修正欄へお進みください。</p><p>一般的なご質問は、公式LINEのトークへ入力してください。</p><a href="https://line.me/ti/p/@229dbicf" target="_blank" rel="noopener noreferrer">公式LINEを開く</a></section>`+$('content').innerHTML;
    }
    if(entryStorageFailed)notice('画面の移動先を一時保存できません。このページでは選択を保持していますが、ログイン後は公式LINEのメニューから選び直してください。',true);
  }
  let entryApplying=false;
  async function applyEntry({initializing=false}={}){
    if(!state.user||(state.busy&&!initializing)||entryApplying)return;
    entryApplying=true;
    try{do{await renderEntry();}while(pendingEntry&&state.user&&!state.busy);}
    finally{entryApplying=false;}
  }
  function drainEntry(){
    if(!pendingEntry||!state.user||state.busy||entryApplying)return;
    if(admin()){consumeEntry();return;}
    void applyEntry().catch(error=>notice(errorText(error),true));
  }
  if(!embedded)globalThis.addEventListener?.('hashchange',()=>{
    pendingEntry=captureEntry();
    drainEntry();
    if(!state.user&&pendingEntry&&entryStorageFailed)notice('移動先を一時保存できません。ログイン後は公式LINEのメニューから選び直してください。',true);
  });
  let materialsGeneration=0;
  // Only an opaque SHA-256 fingerprint and random request ID cross a reload.
  // Form values, account IDs and credentials are never put in browser storage.
  const requests = new Map();
  const requestPrefix = 'editing.pending-request.v1.';
  let requestStorageAvailable = true;
  const button = (text, action, primary=false, extra='') => `<button type="button" data-action="${action}" class="${primary?'primary':''}" ${extra}>${esc(text)}</button>`;
  const input = (name,label,type='text',value='',required=true,extra='') => `<label class="field"><span>${esc(label)}${required?'':'（任意）'}</span><input name="${name}" type="${type}" value="${esc(value)}" ${required?'required':''} ${extra}></label>`;
  const area = (name,label,value='',required=true) => `<label class="field full"><span>${esc(label)}</span><textarea name="${name}" ${required?'required':''} maxlength="10000">${esc(value)}</textarea></label>`;
  const legalLinks = () => '<p class="hint"><button type="button" data-legal="terms">取引条件</button> <button type="button" data-legal="privacy">プライバシーポリシー</button></p>';
  document.addEventListener('click',event=>{const target=event.target.closest('[data-legal]');if(!target)return;const dialog=document.getElementById('legal-'+target.dataset.legal);if(dialog&&!dialog.open)dialog.showModal();});
  const submit = text => `<div class="actions"><button class="primary" type="submit">${esc(text)}</button></div>`;
  // Display-only sentence blocks. Escape every fragment, keep URL tokens intact,
  // and balance each sentence without changing saved customer input.
  function sentenceText(value) {
    const source=String(value??'未定'),sentences=[];
    let pending='',hasSentence=false;
    source.split(/(https?:\/\/[^\s<>"']+)/i).forEach((part,index)=>{
      if(index%2){pending+=esc(part);return;}
      part.split(/(。)/).forEach(fragment=>{
        pending+=esc(fragment);
        if(fragment==='。'){sentences.push(pending);pending='';hasSentence=true;}
      });
    });
    if(!hasSentence)return esc(source);
    if(pending.trim())sentences.push(pending);
    else if(pending)sentences[sentences.length-1]+=pending;
    return sentences.map(sentence=>`<span class="detail-sentence">${sentence}</span>`).join('');
  }
  const dl = rows => `<dl class="details">${rows.map(([k,v,title])=>`<dt>${esc(k)}</dt><dd${title?` title="${esc(title)}"`:''}>${sentenceText(v)}</dd>`).join('')}</dl>`;
  const badge = status => `<span class="badge status-${esc(status)}">${esc(labels[status]||status)}</span>`;
  const latest = arr => arr?.[arr.length-1];
  const admin = () => state.user?.role === 'admin';
  const reported = item => Boolean(item?.reported || item?.reports?.length);
  const kindSelect = (value='customer') => `<label class="field"><span>修正の理由</span><select name="kind">${Object.entries(kinds).map(([k,v])=>`<option value="${k}" ${k===value?'selected':''}>${v}</option>`).join('')}</select></label>`;
  function notice(text,error=false,fullId='') {
    if(disposed)return;
    $('notice').title=fullId;
    $('notice').textContent=text; $('notice').hidden=!text;
    $('notice').className=error?'error':''; $('notice').setAttribute('role',error?'alert':'status');
    if(text) $('notice').focus();
  }
  function heading() { notice(''); $('main').focus(); }
  function setBusy(value) {
    if(disposed)return;
    state.busy=value; document.body.classList.toggle('busy',value);
    document.querySelectorAll('button,input,select,textarea').forEach(el=>{
      if(value) { el.dataset.wasDisabled=String(el.disabled); el.disabled=true; }
      else if(el.dataset.wasDisabled!==undefined) { el.disabled=el.dataset.wasDisabled==='true'; delete el.dataset.wasDisabled; }
    });
    document.querySelectorAll('form').forEach(el=>el.setAttribute('aria-busy',String(value)));
    if(!value)drainEntry();
  }
  async function api(url,options={}) {
    let response;
    if(disposed)throw Error('画面は閉じられています。');
    if(embedded&&(!url.startsWith('/api/')||/\/notifications(?:\/|$)|\/fixture(?:\/|$)|\/logout$/.test(url)))throw Error('この操作は社内画面では利用できません。');
    const authHeaders=embedded?await mountOptions.getAuthHeaders():{};
    if(disposed)throw Error('画面は閉じられています。');
    try { response=await fetch(embedded?mountOptions.apiBase+url.slice(4):url,{cache:'no-store',...options,credentials:embedded?'omit':'same-origin',...(controller?{signal:controller.signal}:{}),headers:{'Content-Type':'application/json',...(state.csrf&&!embedded?{'X-CSRF-Token':state.csrf}:{}),...options.headers,...authHeaders}}); }
    catch { throw Object.assign(new Error('通信が中断されました。保存結果はまだ確認できません。同じ内容で再度送信すると、重複を防いで確認します。'),{unknown:true}); }
    if(disposed)throw Error('画面は閉じられています。');
    let data;
    try {data=await response.json();} catch {throw Object.assign(new Error('応答を確認できません。同じ内容で再度送信してください。'),{unknown:!(response.status>=400&&response.status<500),status:response.status});}
    if(embedded&&[401,403].includes(response.status))mountOptions.onUnauthorized?.();
    if(!response.ok) throw Object.assign(new Error(data.error?.message||'操作に失敗しました。'),{code:data.error?.code,status:response.status,unknown:response.status>=500});
    return data;
  }
  function errorText(error) {
    const known = {UNAUTHENTICATED:'ログインの有効期限が切れています。ページを再読み込みしてログインしてください。',REVISION_CONFLICT:'別の更新があります。「最新情報に更新」で内容を確認してから操作してください。',FORBIDDEN:'この案件を操作する権限がありません。',ADDITIONAL_QUOTE_REQUIRED:'追加の見積もりが必要です。条件の確認が済むまで修正を開始できません。',PAYMENT_AMOUNT_MISMATCH:'入金額が見積もり総額と一致しません。金額を照合してください。',DELIVERY_RECONFIRMATION_REQUIRED:'入金が期限を過ぎているため、納品日の再合意を記録してください。'};
    return known[error.code] || error.message;
  }
  function requestStorageFailed() {
    requestStorageAvailable=false;
    if($('request-storage-warning'))return;
    const warning=document.createElement('div');
    warning.id='request-storage-warning';warning.className='fixture';
    warning.setAttribute('role','status');warning.setAttribute('aria-live','polite');
    warning.textContent='このブラウザでは再送用の番号を保持できません。ページを開いたままの再送では重複を防ぎますが、再読み込み後の重複防止は保証できません。通信結果が不明な場合は、このページを閉じずに同じ内容で再送して確認してください。';
    $('environment').after(warning);
  }
  function canonical(value) {
    if(value===null||typeof value!=='object')return JSON.stringify(value);
    if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
    return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  }
  async function requestFingerprint(url,body,scope) {
    if(!globalThis.isSecureContext||!globalThis.crypto?.subtle||typeof crypto.randomUUID!=='function')throw Error('安全な送信番号を作成できません。HTTPSの画面で開き直してください。');
    if(!state.user?.id)throw Error('ログインしてから、もう一度お試しください。');
    const source=canonical({actorId:state.user.id,role:state.user.role,customerId:state.user.customerId??null,scope,url,body});
    const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
    return Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
  }
  function pendingRequest(fingerprint) {
    let id=requests.get(fingerprint);
    if(!id&&requestStorageAvailable) {
      try {
        id=sessionStorage.getItem(requestPrefix+fingerprint);
        if(id!==null&&!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) {id=null;requestStorageFailed();}
      } catch {requestStorageFailed();}
    }
    if(!id)id=crypto.randomUUID();
    requests.set(fingerprint,id);
    if(requestStorageAvailable) {
      try {
        sessionStorage.setItem(requestPrefix+fingerprint,id);
        if(sessionStorage.getItem(requestPrefix+fingerprint)!==id)requestStorageFailed();
      } catch {requestStorageFailed();}
    }
    return id;
  }
  function forgetRequest(fingerprint) {
    requests.delete(fingerprint);
    if(requestStorageAvailable) {
      try {sessionStorage.removeItem(requestPrefix+fingerprint);}catch {requestStorageFailed();}
    }
  }
  async function mutation(url,body,scope) {
    const fingerprint=await requestFingerprint(url,body,scope);
    const requestId=pendingRequest(fingerprint);
    try {
      const data=await api(url,{method:'POST',body:JSON.stringify({...body,requestId})});
      if(!data?.order||typeof data.order.id!=='string'||!Number.isSafeInteger(data.order.revision)||typeof data.eventId!=='string'||typeof data.replayed!=='boolean')throw Object.assign(new Error('保存完了の応答を確認できません。同じ内容で再度送信してください。'),{unknown:true});
      forgetRequest(fingerprint);return data;
    } catch(error) {if(error.status>=400&&error.status<500)forgetRequest(fingerprint);throw error;}
  }
  async function mutateOrder(type,payload) {
    const order=state.order;
    const result=await mutation(`/api/orders/${encodeURIComponent(order.id)}/commands`,{expectedRevision:order.revision,command:{type,payload}},`${order.id}:${type}:${payload.videoId||''}`);
    await showSaved(result,`${commandLabels[type]}しました。`);
  }
  async function showSaved(result,message) {
    state.order=result.order; state.view='detail'; renderDetail();
    try {await loadOrder(result.order.id);notice(message+(result.replayed?' 前回の保存結果を確認しました。':''),false,result.order.id);}
    catch(error) {notice(`${message} 最新情報の取得に失敗しました。「最新情報に更新」で確認してください。\n${errorText(error)}`,true,result.order.id);}
  }
  const videoMark = '<span class="video-mark" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><rect x="7" y="10" width="27" height="28" rx="5"/><path d="m34 19 8-5v20l-8-5M18 18l9 6-9 6z"/></svg></span>';
  const lineLink = '<a class="line-link" href="https://line.me/ti/p/@229dbicf" target="_blank" rel="noopener noreferrer">公式LINE</a>';
  function chrome() {
    document.body.classList.toggle('admin-mode',admin());
    document.body.classList.toggle('signed-in',Boolean(state.user));
    $('environment').innerHTML=state.config?.mode==='fixture'?'<div class="fixture">ローカル検証用 · テスト用アカウントと保存データを使用しています。</div>':'';
    $('account').innerHTML=state.user?`<span>${admin()?'管理者':'お客様'}</span>${button(embedded?'社内アプリへ戻る':'ログアウト','logout')}`:'';
    $('navigation').innerHTML=state.user?`<div class="nav-label">${admin()?'案件管理':'ご依頼の状況'}</div>${button('案件一覧','list')}${!admin()?button('新しい相談','new'):''}${embedded&&admin()?button('素材保管先の接続確認','drive-health'):''}${embedded&&admin()&&state.config?.driveRootProvisionAvailable===true?button('非公開の素材保管先を準備','drive-root-provision'):''}${lineLink}`:'';
  }
  async function checkDriveHealth() {
    if(!embedded||!admin())throw Error('社内アプリの管理者のみ確認できます。');
    const result=await api('/api/drive/health');
    if(result.connectionVerified!==true||typeof result.canAddChildren!=='boolean'||typeof result.broadAccess!=='boolean')throw Error('接続確認の結果を取得できませんでした。');
    const message=result.canAddChildren?'素材保管先への接続とフォルダ追加権限を確認しました。':'接続できましたが、フォルダ追加権限がありません。';
    notice(message+(result.broadAccess?' 保管先には広い共有権限があります。非公開の保管先を確認してください。':'')+' お客様の共有アクセスは別途確認が必要です。',!result.canAddChildren||result.broadAccess);
  }
  async function provisionDriveRoot() {
    if(!embedded||!admin()||state.config?.driveRootProvisionAvailable!==true)throw Error('この操作は現在利用できません。');
    const result=await api('/api/maintenance/drive-root',{method:'POST',body:JSON.stringify({})});
    if(typeof result.rootFolderId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(result.rootFolderId))throw Error('保管先の確認結果を取得できませんでした。');
    notice('非公開の素材保管先を確認しました。保管先ID: '+result.rootFolderId+'。受付先の切り替えはまだ行っていません。');
  }
  async function loginScreen() {
    state.user=null;state.csrf=null;state.orders=[];state.order=null;state.materials=null;state.search='';state.filter='active';state.pageMeta=null;state.pageCursor=null;state.previousCursors=[];state.nextCursor=null;inquiryDraft=null;hearingDrafts.clear();listLoadGeneration++;state.view='login';chrome();
    if(embedded){$('content').innerHTML='<section class="panel"><h1>ログインを確認してください</h1><p>社内アプリへログインし直してください。</p></section>';return;}
    let fixture='';
    if(state.config.mode==='fixture') {
      const data=await api('/api/fixture/users');
      fixture=`<hr class="separator"><form data-form="fixture"><h2>ローカル検証用ログイン</h2><label class="field"><span>テスト用アカウント</span><select name="userId" required>${data.users.map(u=>`<option value="${esc(u.id)}">${esc(u.label)}</option>`).join('')}</select></label>${submit('このアカウントで確認する')}</form>`;
    }
    if(entryStorageFailed&&pendingEntry)notice('移動先を一時保存できません。ログイン後は公式LINEのメニューから選び直してください。',true);
    $('content').innerHTML=`<section class="panel login"><p class="eyebrow">EDITING WORKSPACE</p><h1>ご依頼の状況を確認</h1><p class="muted">ご相談、見積もり、動画の確認をこちらで行えます。</p>${state.config.lineLoginAvailable?'<a class="button primary" href="/auth/line/start">LINEでログイン</a>':'<p class="inline-note">ログインの受付準備中です。</p>'}${fixture}</section>`;
  }
  async function initialize() {
    try {
      state.config=await api('/api/config');if(embedded)state.config.adminNotificationsAvailable=false;
      try { const session=await api('/api/session');if(embedded&&session.user?.role!=='admin')throw Error('オーナー権限を確認できません。');state.user=session.user;state.csrf=session.csrfToken;chrome();await applyEntry({initializing:true}); }
      catch(error) {if(error.status===401) await loginScreen(); else throw error;}
    } catch(error) { if(disposed)return;$('content').innerHTML='<h1>案件管理を読み込めませんでした</h1><p>接続先を確認してから、ページを再読み込みしてください。</p>'; notice(errorText(error),true); }
  }
  function cancellationLocked(o) {return Boolean(o.cancellation)||['cancellation_pending','cancelled'].includes(o.status);}
  function settlementAccepted(c,s) {return Boolean(s&&c?.acceptedSettlement?.settlementVersion===s.version);}
  function refundRemaining(c,s) {
    if(!s||!Number.isSafeInteger(s.refundYen))return null;
    const recorded=c?.refund?.settlementVersion===s.version?c.refund.amountYen:0;
    return Math.max(0,s.refundYen-recorded);
  }
  function orderStatus(o) {
    if(o.listSummary)return o.status;
    if(o.status!=='cancelled')return o.status;
    const c=o.cancellation,s=latest(c?.settlements);
    return c?.finalized&&c.reconciliation&&settlementAccepted(c,s)&&refundRemaining(c,s)===0?'cancelled':'cancellation_pending';
  }
  function cancellationNext(o) {
    const c=o.cancellation,s=latest(c?.settlements);
    if(orderStatus(o)==='cancelled')return '精算・返金の確認を終え、キャンセル手続きが完了しました';
    if(!c?.stopped)return admin()?'対象動画の作業を停止し、停止記録を残してください':'キャンセルの相談を受け付けました。制作側が作業の停止を確認します';
    if(!c.reconciliation)return admin()?'未記録の実入金を確認し、入金総額を銀行記録と照合してください':'作業を停止しました。制作側で入金状況を確認しています';
    if(!s||s.receivedYen!==receivedTotal(o))return admin()?'入金額と実施済み作業を確認し、精算案を提示してください':'作業を停止しました。精算の内容をご案内します';
    if(!settlementAccepted(c,s))return admin()?'お客様による精算案の確認待ちです':'返金額と精算の内容をご確認ください';
    if(refundRemaining(c,s)>0)return admin()?'返金を実施した後、金額・日付・根拠を記録してください':'精算案を確認しました。制作側の返金実施記録をお待ちください';
    return admin()?'必要な精算・返金の記録がそろいました。キャンセルを完了できます':'精算・返金の記録を確認し、キャンセルの完了手続きを進めています';
  }
  const receivedTotal = o => Number.isSafeInteger(o.paymentSummary?.totalReceivedYen)&&o.paymentSummary.totalReceivedYen>=0?o.paymentSummary.totalReceivedYen:null;
  function cancellationReconciliation(o) {
    const total=receivedTotal(o);
    if(total===null)return '<p class="inline-note danger-note">入金総額を取得できません。最新情報に更新してください。</p>'+button('入金総額を再取得','refresh');
    const q=latest(o.quotes),missing=[];
    if(o.acceptedQuote&&q&&!o.payment.verified)missing.push(`<details><summary>通常料金の未記録の入金を確認する（${money(q.totalYen)}）</summary><form data-form="payment"><div class="grid">${input('amountYen','実際の入金額（税込円）','number','',true,'min="1" step="1"')}${input('receivedDate','入金日','date')}${area('evidence','照合した入金の根拠（管理者のみ）')}</div>${submit('通常料金の実入金を記録')}</form></details>`);
    (o.videos||[]).forEach(v=>{const x=v.activeRevision?.extra,additional=latest(x?.quotes);if(x?.accepted&&additional&&!x.payment?.verified)missing.push(`<details><summary>${esc(v.title)}の追加料金の未記録入金を確認する（${money(additional.amountYen)}）</summary><form data-form="revision-payment" data-video="${esc(v.id)}"><div class="grid">${input('amountYen','実際の追加入金額（税込円）','number','',true,'min="1" step="1"')}${input('receivedDate','追加入金日','date')}${area('evidence','照合した追加入金の根拠（管理者のみ）')}</div>${submit('追加料金の実入金を記録')}</form></details>`);});
    return `<h3>入金状況を照合</h3><p class="inline-note">現在記録されている入金総額：${money(total)}（通常料金と追加料金の合計）</p><p class="hint">銀行の入金記録を確認し、未記録の実入金があれば先に記録してください。振込報告だけでは入金済みにしません。</p>${missing.join('')}<form data-form="cancellation-reconcile"><h3>実際の入金総額を照合</h3><div class="grid">${input('confirmedReceivedYen','銀行記録で確認した実入金総額（税込円）','number','',true,'min="0" step="1"')}${area('evidence','銀行の入金記録を照合した根拠（管理者のみ）')}</div><label class="check"><input type="checkbox" required><span>通常料金・追加料金・未処理の振込を確認しました。未入金の場合も、確認した根拠と0円を記録します。</span></label>${submit('実入金総額の照合記録を保存')}</form>`;
  }
  function settlementEditor(o) {
    const c=o.cancellation,s=latest(c.settlements),received=receivedTotal(o);
    if(received===null)return '<p class="inline-note danger-note">入金総額を取得できません。最新情報に更新してから精算案を作成してください。</p>'+button('入金総額を再取得','refresh');
    const noWork=Array.isArray(c.stopped?.startedVideoIds)&&c.stopped.startedVideoIds.length===0;
    return `<form data-form="settlement"><h3>${s?'精算案を新しい版で提示':'精算案を作成'}</h3><p class="hint">実入金 ${money(received)} を基準に、実施済み作業と事前承認済みの取消できない外部費用を精算します。追加請求は行いません。</p>${noWork?'<p class="inline-note">着手前のため、実施済み作業の精算額は0円です。</p>':''}<div class="grid">${input('performedWorkYen','実施済み作業の精算額（税込円）','number',noWork?0:s?.performedWorkYen??0,true,`min="0" step="1" ${noWork?'readonly':''}`)}${input('externalCostYen','取消できない外部費用（税込円）','number',s?.externalCostYen??0,true,'min="0" step="1"')}${area('workBasis','事前に提示した精算基準・実施済み作業の内訳',s?.workBasis||'')}${area('externalCostDescription','外部費用の内容（お客様に表示・費用がある場合は必須）',s?.externalCostDescription||'',false)}${area('externalCostEvidence','外部費用の実額と取消不能の根拠（管理者のみ）',s?.externalCostEvidence||'',false)}${area('externalCostApprovalEvidence','外部費用をお客様が事前承認した記録（管理者のみ）',s?.externalCostApprovalEvidence||'',false)}${input('refundYen','返金予定額（税込円・自動計算）','number',s?.refundYen??received,true,'min="0" step="1" readonly')}</div><p id="settlement-preview" class="inline-note" aria-live="polite"></p>${submit(s?'新しい版の精算案を提示する':'精算案をお客様に提示する')}</form>`;
  }
  function cancellationPanel(o) {
    const c=o.cancellation;
    if(!c) {
      if(admin()||o.status==='completed'||o.status==='cancelled')return '';
      return `<details class="panel"><summary>キャンセルの相談</summary><form data-form="cancellation-request"><p>この案件のキャンセルをご希望の場合は、理由をお知らせください。相談後に作業の停止と精算内容を確認します。この操作だけでキャンセルや返金が完了することはありません。</p>${area('reason','キャンセルを希望する理由')}${submit('キャンセルを相談する')}</form></details>`;
    }
    const s=latest(c.settlements),accepted=settlementAccepted(c,s),remaining=refundRemaining(c,s),complete=orderStatus(o)==='cancelled',current=Boolean(c.reconciliation&&s?.receivedYen===receivedTotal(o));
    let next='';
    if(!complete&&admin()) {
      if(!c.stopped)next=`<form data-form="cancellation-stop">${area('note','対象動画の作業停止を確認した記録（管理者のみ）')}${submit('作業の停止を記録する')}</form>`;
      else if(!c.reconciliation)next=cancellationReconciliation(o);
      else if(!s||!current)next=settlementEditor(o);
      else if(!accepted)next=`<p class="inline-note">お客様による第${s.version}版の精算案の確認をお待ちしています。</p><details><summary>精算案を修正する</summary>${settlementEditor(o)}</details>`;
      else if(remaining>0)next=`<form data-form="cancellation-refund"><h3>返金の実施記録</h3><p class="hint">実際に返金を行った後に記録してください。この画面から銀行送金は行いません。</p><div class="grid">${input('amountYen','実際に返金した金額（税込円）','number','',true,'min="1" step="1"')}${input('refundedDate','返金を実施した日','date')}${area('evidence','返金を実施した根拠（管理者のみ）')}</div>${submit('返金の実施記録を保存')}</form>`;
      else if(remaining===0)next=`<form data-form="cancellation-finalize"><label class="check"><input type="checkbox" required><span>第${s.version}版の精算への同意と、必要な返金の実施記録を確認しました。</span></label>${submit('キャンセル手続きを完了する')}</form>`;
    } else if(!complete&&s&&current&&!accepted) {
      next=`<form data-form="cancellation-accept"><label class="check"><input type="checkbox" required><span>第${s.version}版の精算内容、精算額 ${money(s.chargedYen)} と返金予定額 ${money(s.refundYen)} を確認し、同意します。</span></label>${submit('この精算内容に同意する')}<p class="hint">同意後、必要な返金とキャンセルの完了手続きを進めます。</p></form>`;
    }
    const summary=s?`<h3>精算案 第${s.version}版</h3>${dl([['確認済みの入金額',money(s.receivedYen)],['実施済み作業分',money(s.performedWorkYen)],['外部費用',money(s.externalCostYen)],['精算額の合計',money(s.chargedYen)],['返金予定額',money(s.refundYen)],['精算の基準・内訳',s.workBasis],...(s.externalCostYen?[['外部費用の内容',s.externalCostDescription]]:[])])}${accepted?`<p class="badge">第${s.version}版の精算にお客様が同意済み</p>`:''}${s.refundYen===0?'<p class="inline-note">この精算案での返金対象額は0円です。</p>':c.refund?.settlementVersion===s.version?`${dl([['実施記録のある返金額',money(c.refund.amountYen)],['返金実施日',c.refund.refundedDate]])}<p class="inline-note">${remaining===0?'合意した返金額の実施記録を確認しました。':`残り ${money(remaining)} の返金を確認する必要があります。`}</p>`:'<p class="inline-note">返金の実施記録はまだありません。</p>'}`:'';
    return `<section class="panel"><h2>${complete?'キャンセルの完了記録':'キャンセルの手続き'}</h2>${dl([['ご相談の理由',c.requested.reason],['作業の停止',c.stopped?'停止を確認済み':'確認待ち'],['入金総額の照合',c.reconciliation?'照合済み':'未確認']])}${admin()&&c.stopped?.note?dl([['作業停止の記録',c.stopped.note]]):''}${summary}${complete?'<p class="badge">キャンセル手続き完了</p>':next}${c.settlements.length>1?`<details><summary>以前の精算案</summary>${c.settlements.slice(0,-1).reverse().map(old=>`<h3>第${old.version}版</h3>${dl([['精算額',money(old.chargedYen)],['返金予定額',money(old.refundYen)],['精算の基準・内訳',old.workBasis]])}`).join('')}</details>`:''}</section>`;
  }
  function updateSettlementPreview() {
    const form=document.querySelector('[data-form="settlement"]');
    if(!form)return;
    const performed=form.querySelector('[name=performedWorkYen]'),external=form.querySelector('[name=externalCostYen]'),refund=form.querySelector('[name=refundYen]');
    const work=Number(performed.value),cost=Number(external.value),received=receivedTotal(state.order);
    const valid=received!==null&&performed.value!==''&&external.value!==''&&Number.isSafeInteger(work)&&Number.isSafeInteger(cost)&&work>=0&&cost>=0&&Number.isSafeInteger(work+cost)&&work+cost<=received;
    refund.value=valid?String(received-work-cost):'';
    $('settlement-preview').textContent=valid?`確認済み入金 ${money(received)} − 精算額 ${money(work+cost)} ＝ 返金予定 ${money(received-work-cost)}`:'精算額は、確認済みの入金額以内の整数で入力してください。';
    form.querySelector('button[type=submit]').disabled=!valid;
  }
  function adminTask(o,today=new Date(Date.now()+9*60*60*1000).toISOString().slice(0,10)) {
    if(o.listSummary)return o.adminTask;
    const task=(category,label)=>({category,label});
    if(['completed','cancelled'].includes(orderStatus(o)))return task('done','すべてのお手続きが完了しました');
    if(cancellationLocked(o)) {
      const c=o.cancellation,s=latest(c?.settlements);
      const waiting=c?.stopped&&c.reconciliation&&s&&s.receivedYen===receivedTotal(o)&&!settlementAccepted(c,s);
      return task(waiting?'waiting':'action',cancellationNext(o));
    }
    const q=latest(o.quotes);
    if(!q)return task('action','ヒアリングを確認して見積もりを作成してください');
    if(!o.acceptedQuote)return q.paymentDueDate<today?task('action','見積もり未承認のまま支払期限を過ぎています。条件をご確認ください'):task('waiting','お客様の見積もり確認待ちです');
    if(!o.payment.verified) {
      if(reported(o.payment))return task('action','振込報告があります。実入金を照合してください');
      return q.paymentDueDate<today?task('action','支払期限を過ぎています。お支払い状況をご確認ください'):task('waiting','お客様のお支払い・振込報告待ちです');
    }
    const tasks=o.videos.filter(v=>v.status!=='completed').map(v=>{
      const a=v.activeRevision,x=a?.extra,extraQuote=latest(x?.quotes);
      if(v.status==='revision_requested') {
        if(!a?.kind)return task('action','修正指示を確認し、修正の区分を確定してください');
        if(needsRevisionQuote(v)) {
          if(!revisionQuoteCurrent(v))return task('action',extraQuote?'最新の修正指示に合わせて追加見積もりを更新してください':'追加修正の見積もりを作成してください');
          if(!x.accepted)return task('waiting','追加見積もりのお客様確認待ちです');
          if(!x.payment?.verified)return reported(x.payment)?task('action','追加料金の振込報告があります。実入金を照合してください'):extraQuote.paymentDueDate<today?task('action','追加料金の支払期限を過ぎています。状況をご確認ください'):task('waiting','追加料金のお支払い・振込報告待ちです');
          if(!paidRevisionReady(v))return task('action','追加修正の納品日を再確認してください');
        }
        return task('action','修正を開始できます');
      }
      if(v.status==='delivered')return latest(v.deliveries)?.reviewDueDate<today?task('action','納品後の確認期限を過ぎています。確認待ちのままご連絡ください'):task('waiting','お客様の納品確認待ちです');
      if(['editing','revising'].includes(v.status))return v.dueDate<today?task('action','納品日を過ぎています。制作状況と納品日をご確認ください'):task('working',v.status==='revising'?'修正作業を進め、修正版を納品してください':'編集作業を進め、完成した動画を納品してください');
      if(o.payment.verified.late&&!v.deliveryReconfirmation)return task('action','入金が期限後のため、納品日を再確認してください');
      if(!v.materials.verified)return reported(v.materials)?task('action','素材提出の報告があります。必要素材を確認してください'):task('waiting','お客様の素材提出・報告待ちです');
      return task('action','入金と素材の確認がそろいました。編集を開始できます');
    });
    return tasks.find(t=>t.category==='action')||tasks.find(t=>t.category==='working')||tasks[0]||task('done','すべての動画の確認が完了しました');
  }
  function nextAction(o) {
    if(o.listSummary)return o.nextAction;
    if(admin())return adminTask(o).label;
    if(cancellationLocked(o))return cancellationNext(o);
    if(o.status==='completed')return 'すべての動画の確認が完了しました';
    if(!latest(o.quotes))return admin()?'ヒアリングを確認して見積もりを作成':'編集内容の確認をお待ちください';
    if(!o.acceptedQuote)return admin()?'お客様の見積もり確認待ち':'見積もりの内容をご確認ください';
    if(!o.payment.verified)return admin()?'実入金を照合してください':reported(o.payment)?'振込報告済み・入金確認待ち':'お振り込み後にご報告ください';
    const additional=o.videos.find(v=>revisionQuoteCurrent(v)&&!v.activeRevision.extra.accepted);
    if(additional)return '追加見積もりの内容をご確認ください';
    const extraPayment=o.videos.map(v=>v.activeRevision?.extra).find(x=>x?.accepted&&!x.payment?.verified);
    if(extraPayment)return reported(extraPayment.payment)?'追加料金の振込報告済み・入金確認待ち':'追加料金のお振り込み後にご報告ください';
    if(o.videos.some(v=>v.status==='revision_requested'))return '修正内容を確認しています';
    if(o.videos.some(v=>v.status==='delivered'))return admin()?'お客様の納品確認待ち':'納品された動画をご確認ください';
    if(o.videos.some(v=>!v.materials.verified))return admin()?'必要素材を確認してください':'動画ごとの素材提出をご確認ください';
    return '動画ごとの進行状況をご確認ください';
  }
  let notificationItems=[];
  async function loadNotifications(){
    const data=await api('/api/notifications');notificationItems=data.items;state.view='notifications';
    const labels={approval_required:'送信承認待ち',approved:'承認済み・未送信',sending:'送信結果を確認中',accepted:'LINE受付済み（配信・既読は未確認）',unknown:'結果不明・同じ内容で再試行可能',quota_blocked:'無料枠を確認できないため停止',configuration_error:'設定の確認が必要',needs_review:'結果の確認が必要'};
    $('content').innerHTML=`<section class="panel"><h1>管理者へのLINE通知</h1><p>${esc(data.message)}</p><p class="hint">受付の保存と通知は別です。LINE受付済みでも、配信・既読を確認したことにはなりません。</p>${button('案件一覧へ戻る','list')}${button('通知を更新','notifications')}</section>${notificationItems.map((n,i)=>`<section class="panel"><h2>${esc(labels[n.status]||n.status)}</h2><p>宛先：${esc(n.payload.to)}</p><p>添付：なし</p><pre class="preserve">${esc(n.payload.messages[0].text)}</pre>${data.configured&&['approval_required','approved','unknown','sending'].includes(n.status)?`<label class="check"><input id="notify-check-${i}" type="checkbox"><span>この宛先・全文での送信を承認します。</span></label>${button(n.status==='approval_required'?'承認して送信する':'同じ内容で再試行する','notify-send',true,`data-index="${i}"`)}`:''}</section>`).join('')||'<p>確認対象の通知はありません。</p>'}`;
  }
  let listLoadGeneration=0,searchTimer=null;
  function listUrl(cursor=state.pageCursor) {
    return '/api/orders?limit=25&status='+encodeURIComponent(state.filter)+'&query='+encodeURIComponent(state.search.trim())+(cursor?'&cursor='+encodeURIComponent(cursor):'');
  }
  function applyListPage(data) {
    if(!Array.isArray(data?.orders)||data.orders.length>100)throw Error('案件一覧の応答を確認できません。もう一度更新してください。');
    state.orders=data.orders;state.nextCursor=data.nextCursor||null;
    state.pageMeta={counts:data.counts||null,total:Number.isSafeInteger(data.total)?data.total:data.orders.length};
  }
  async function loadList({cursor=null,previous=[],keepControls=false}={}) {
    const generation=++listLoadGeneration,identity=materialsIdentity(),filter=state.filter,search=state.search;
    const data=await api(listUrl(cursor));
    if(generation!==listLoadGeneration||identity!==materialsIdentity()||filter!==state.filter||search!==state.search||(keepControls&&(state.view!=='list'||state.busy)))return;
    applyListPage(data);state.pageCursor=cursor;state.previousCursors=previous;state.order=null;state.view='list';listUpdatedAt=Date.now();lastListRefreshAttempt=listUpdatedAt;listRefreshPaused=false;
    if(keepControls){renderCards();renderListStatus();}else renderList();
  }
  function listCounts() {
    if(!admin())return {action:0,waiting:0,working:0};
    if(state.pageMeta?.counts)return state.pageMeta.counts;
    const counts={action:0,waiting:0,working:0};state.orders.forEach(o=>{const k=adminTask(o).category;if(k in counts)counts[k]++;});return counts;
  }
  function renderPagination() {
    const node=$('list-pagination');if(!node)return;
    node.innerHTML=state.pageMeta?`<p class="hint">該当 ${state.pageMeta.total}件 · このページ ${state.orders.length}件</p><div class="actions">${button('前のページ','page-previous',false,state.previousCursors.length?'':'disabled')}${button('次のページ','page-next',false,state.nextCursor?'':'disabled')}</div>`:'';
  }
  let listUpdatedAt=0,listRefreshing=false,lastListRefreshAttempt=0,listRefreshPaused=false;
  function renderListStatus(message='') {
    const summary=$('list-summary'),updated=$('list-updated');
    if(summary&&admin()) {
      const counts=listCounts();
      summary.textContent=`対応が必要 ${counts.action}件 · お客様待ち ${counts.waiting}件 · 制作中 ${counts.working}件`;
      for(const [key,category] of [['attention','action'],['waiting','waiting'],['working','working']]){const count=$('count-'+key);if(count)count.textContent=String(counts[category]);}
    }
    if(updated)updated.textContent=message||`最終更新 ${new Date(listUpdatedAt).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit',timeZone:'Asia/Tokyo'})} · 一覧を表示中は1分ごとに確認します`;
  }
  async function refreshListInBackground() {
    if(!state.user||state.view!=='list'||state.busy||listRefreshing||listRefreshPaused||document.visibilityState!=='visible'||Date.now()-lastListRefreshAttempt<60000||$('order-list')?.contains?.(document.activeElement))return;
    const identity=materialsIdentity(),loadedAt=listUpdatedAt,generation=listLoadGeneration;listRefreshing=true;lastListRefreshAttempt=Date.now();
    try {
      const data=await api(listUrl(),{signal:AbortSignal.timeout(10000)});
      if(identity!==materialsIdentity()||loadedAt!==listUpdatedAt||generation!==listLoadGeneration||state.view!=='list'||state.busy||$('order-list')?.contains?.(document.activeElement))return;
      applyListPage(data);listUpdatedAt=Date.now();renderCards();renderListStatus();
    } catch(error) {
      if(identity===materialsIdentity()&&loadedAt===listUpdatedAt&&generation===listLoadGeneration&&state.view==='list'&&!state.busy) {
        if(error.status===401)listRefreshPaused=true;
        renderListStatus(error.status===401?'ログインの有効期限が切れています。再読み込みしてログインしてください。':'最新情報を取得できませんでした。表示中の内容は前回取得時点の情報です。');
      }
    } finally {listRefreshing=false;}
  }
  const refreshTimer=globalThis.setInterval?.(()=>void refreshListInBackground(),60000);
  document.addEventListener('visibilitychange',()=>void refreshListInBackground());
  function legacyOrderHelp() {
    return '<div class="inline-note"><p>公式LINEで以前にご依頼いただいた案件は、この一覧には自動で表示されません。</p><p>素材の追加は、ご案内済みのフォルダへ入れ、公式LINEでお知らせください。新しい相談として登録する必要はありません。</p><a href="https://line.me/ti/p/@229dbicf" target="_blank" rel="noopener noreferrer">公式LINEで連絡する</a></div>';
  }
  function orderTitle(o){if(o.listSummary)return o.title;return (o.videos[0]?.title||'動画のご相談')+(o.videos.length>1?` ほか${o.videos.length-1}本`:'');}
  function progressRail(o){
    if(o.listSummary?o.progressStage===null:cancellationLocked(o))return '';
    const stage=o.listSummary?o.progressStage:!latest(o.quotes)?0:!o.acceptedQuote?1:!o.payment?.verified?2:o.videos.some(v=>!v.materials?.verified)?3:o.videos.some(v=>!['delivered','completed'].includes(v.status))?4:5;
    return `<ol class="progress-rail" aria-label="ご依頼の進行">${['相談','見積もり','お支払い','素材','制作','納品'].map((label,i)=>`<li class="${i<stage?'done':i===stage?'current':''}" ${i===stage?'aria-current="step"':''}><span>${i<stage?'✓':i+1}</span>${label}</li>`).join('')}</ol>`;
  }
  function customerGuide(){return `<aside class="customer-guide"><section class="panel"><h2>ご利用の流れ</h2>${[['1','内容を確認','ご希望の編集と素材を確認し、見積もりをご案内します。'],['2','料金を確認して先払い','見積もりに同意後、期日までにお振り込みください。'],['3','納品・修正を確認','完成した動画をご確認ください。修正もこちらでお伝えいただけます。']].map(([n,title,text])=>`<div class="guide-step"><span>${n}</span><div><h3>${title}</h3><p class="hint">${text}</p></div></div>`).join('')}</section><section class="panel"><h2>お困りのときは</h2><p class="hint">ご不明な点は、公式LINEのトークでご相談ください。</p>${lineLink}</section></aside>`;}
  function renderList() {
    const counts=listCounts();
    const tiles=admin()?`<div class="summary-tiles">${[['attention','対応が必要',counts.action],['waiting','お客様待ち',counts.waiting],['working','制作中',counts.working]].map(([key,label,count])=>`<button class="summary-tile ${key}" data-action="filter" data-filter="${key}"><span>${label}</span><strong id="count-${key}">${count}</strong><span class="tile-arrow" aria-hidden="true">›</span></button>`).join('')}</div>`:'';
    $('content').innerHTML=`<div class="toolbar page-heading"><div><p class="eyebrow">${admin()?'管理者用':'EDITING WORKSPACE'}</p><h1>${admin()?'案件一覧':'ご依頼の動画'}</h1><p class="muted">${admin()?'次に対応する案件を確認できます。':'見積もり・素材・納品をまとめて確認できます。'}</p></div><div class="heading-actions">${button('最新情報に更新','refresh')}${admin()&&state.config?.adminNotificationsAvailable?button('LINE通知を確認','notifications'):''}${!admin()?button('＋ 新しい相談','new',true):''}</div></div>${tiles}<div class="workspace-columns ${admin()?'admin-columns':'customer-columns'}"><section class="list-workspace"><div class="list-tools"><label class="field search-field"><span>案件を検索</span><input id="search" type="search" placeholder="動画名・受付番号${admin()?'・お名前':''}" value="${esc(state.search)}"></label><label class="field filter-field"><span>表示する状態</span><select id="filter" aria-label="表示する状態"><option value="active" ${state.filter==='active'?'selected':''}>進行中</option><option value="all" ${state.filter==='all'?'selected':''}>すべて</option>${admin()?`<option value="attention" ${state.filter==='attention'?'selected':''}>対応が必要</option><option value="waiting" ${state.filter==='waiting'?'selected':''}>お客様待ち</option><option value="working" ${state.filter==='working'?'selected':''}>制作中</option>`:''}${Object.entries(labels).filter(([k])=>['inquiry','quoted','accepted','cancellation_pending','completed','cancelled'].includes(k)).map(([k,v])=>`<option value="${k}" ${state.filter===k?'selected':''}>${v}</option>`).join('')}</select></label></div>${admin()?'<p id="list-summary" class="sr-only" aria-live="polite"></p>':''}<div id="order-list"></div><div id="list-pagination" class="list-pagination" aria-label="案件一覧のページ切り替え"></div><p id="list-updated" class="hint" role="status"></p>${!admin()?`<details class="legacy-help"><summary>以前にLINEでご依頼いただいた案件</summary>${legacyOrderHelp()}</details>`:'<p class="hint reconciliation-note">振込報告だけでは入金確認済みになりません。</p>'}</section>${admin()?'<aside id="order-preview" class="order-preview"></aside>':customerGuide()}</div>`;
    renderCards();renderListStatus();
  }
  function renderCards() {
    const query=state.search.trim().toLocaleLowerCase();
    const orders=state.pageMeta?state.orders:state.orders.filter(o=>(state.filter==='all'||(admin()&&['attention','waiting','working'].includes(state.filter)?adminTask(o).category===(state.filter==='attention'?'action':state.filter):state.filter==='active'?!['completed','cancelled'].includes(orderStatus(o)):orderStatus(o)===state.filter))&&[o.id,receiptNumber(o.id),o.customerName||'',...o.videos.map(v=>v.title),...(admin()?[o.customerId]:[])].join(' ').toLocaleLowerCase().includes(query));
    if(!state.pageMeta)orders.sort((a,b)=>(admin()?['action','working','waiting','done'].indexOf(adminTask(a).category)-['action','working','waiting','done'].indexOf(adminTask(b).category):0)||Date.parse(b.updatedAt)-Date.parse(a.updatedAt));
    $('order-list').innerHTML=orders.length?orders.map((o,i)=>{
      const q=o.listSummary?(o.latestQuoteTotalYen!==null?{totalYen:o.latestQuoteTotalYen}:null):latest(o.quotes),due=o.listSummary?(o.dueDate||'未定'):o.videos.find(v=>v.dueDate)?.dueDate||q?.lines?.[0]?.dueDate||'未定';
      return `<article class="order-card ${admin()?'admin-order':'customer-order'} ${i===0?'featured':''}"><div class="order-card-heading">${videoMark}<div><h2 class="order-title">${esc(orderTitle(o))}</h2><p class="order-meta" title="${esc(o.id)}">${admin()?esc(customerDisplayName(o))+' · ':''}受付番号 ${esc(receiptNumber(o.id))}</p>${badge(orderStatus(o))}</div></div>${!admin()?progressRail(o):''}<div class="order-next"><div><strong>${esc(nextAction(o))}</strong>${admin()?`<p class="hint">納品日 ${esc(due)}</p>`:''}</div>${!admin()&&q?`<p class="card-amount">${money(q.totalYen)}<small>税込</small></p>`:''}${button(admin()?'確認する':'詳細を確認する','open',i===0,`data-id="${esc(o.id)}"`)}</div></article>`;
    }).join(''):'<section class="panel empty"><h2>該当する案件はありません</h2><p class="muted">検索条件を変更してご確認ください。</p></section>';
    const preview=$('order-preview');
    if(preview){const o=orders[0],q=o?.listSummary?(o.latestQuoteTotalYen!==null?{totalYen:o.latestQuoteTotalYen}:null):latest(o?.quotes);preview.innerHTML=o?`<section class="panel preview-card"><div class="preview-art">${videoMark}<span>${o.listSummary?o.videoCount:o.videos.length}本のご依頼</span></div><h2>${esc(orderTitle(o))}</h2><p class="muted">${esc(customerDisplayName(o))}</p>${dl([['見積もり金額',q?money(q.totalYen)+'（税込）':'未提示'],['納品日',o.listSummary?(o.dueDate||'未定'):o.videos.find(v=>v.dueDate)?.dueDate||q?.lines?.[0]?.dueDate||'未定']])}<div class="inline-note">${esc(nextAction(o))}</div>${button('案件を開いて確認する','open',true,`data-id="${esc(o.id)}"`)}</section>`:'';}
    renderPagination();
  }
  const hearingEnums={platform:{undecided:'未定',instagram:'Instagram',youtube:'YouTube',tiktok:'TikTok',other:'その他'},materialStatus:{undecided:'未定・相談したい',ready:'必要な素材がそろっている',partial:'一部はそろっている',not_ready:'これから準備する'},deadlineFlexibility:{undecided:'未定・相談したい',preferred:'希望日はあるが調整できる',fixed:'使用日が決まっている'}};
  const hearingLabels={platform:'掲載する場所',goal:'この動画で伝えたいこと',referenceUrl:'参考動画のURL',referenceNotes:'参考動画のどこを似せたいか',requestedEditing:'希望する編集',avoidNotes:'避けたい表現・編集',materialStatus:'素材の準備状況',materialNotes:'素材について補足',deadlineFlexibility:'希望日について'};
  function hearingSelect(name,value='undecided') {return `<label class="field"><span>${hearingLabels[name]}（任意）</span><select name="hearing_${name}">${Object.entries(hearingEnums[name]).map(([key,label])=>`<option value="${key}" ${value===key?'selected':''}>${label}</option>`).join('')}</select></label>`;}
  function hearingArea(name,label,value) {const limits={goal:500,referenceNotes:1000,requestedEditing:2000,avoidNotes:1000,materialNotes:1500};return area('hearing_'+name,label,value||'',false).replace('maxlength="10000"',`maxlength="${limits[name]}"`);}
  function hearingFields(h={}) {return `<div class="grid">${hearingSelect('platform',h.platform)}${hearingSelect('materialStatus',h.materialStatus)}${hearingSelect('deadlineFlexibility',h.deadlineFlexibility)}${input('hearing_referenceUrl','参考動画のURL','url',h.referenceUrl||'',false,'maxlength="2048" placeholder="https://"')}${hearingArea('referenceNotes','参考動画のどこを似せたいか（例：字幕の大きさ・テンポ）',h.referenceNotes)}${hearingArea('goal',hearingLabels.goal,h.goal)}${hearingArea('requestedEditing','希望する編集（決まっていることだけで大丈夫です）',h.requestedEditing)}${hearingArea('avoidNotes',hearingLabels.avoidNotes,h.avoidNotes)}${hearingArea('materialNotes',hearingLabels.materialNotes,h.materialNotes)}</div>`;}
  function hearingValues(form) {const values={};for(const key of Object.keys(hearingLabels)){const element=form.querySelector(`[name="hearing_${key}"]`);values[key]=element?.value?.trim()|| (hearingEnums[key]?'undecided':'');}return values;}
  function captureInquiry(form) {
    if(!form||form.dataset.form!=='inquiry')return;
    const value=name=>form.querySelector(`[name="${name}"]`)?.value||'';
    inquiryDraft={customerName:value('customerName'),brief:value('brief'),requestedDueDate:value('requestedDueDate'),bulkType:value('bulkType'),bulkCount:value('bulkCount'),hearing:hearingValues(form),detailsOpen:Boolean(form.querySelector('[data-hearing-details]')?.open),videos:[...form.querySelectorAll('[data-video-row]')].map(row=>({title:row.querySelector('[name=title]').value,type:row.querySelector('[name=type]').value,durationSeconds:row.querySelector('[name=durationSeconds]').value,autoTitle:row.dataset.autoTitle==='true',customType:row.dataset.customType==='true'}))};
  }
  function captureHearingDraft(form) {if(form?.dataset.form==='hearing'&&state.order)hearingDrafts.set(state.order.id,hearingValues(form));}
  function inquiryRow(index,value={}) {
    const type=value.type||'',title=value.title??(type?`${videoTypeLabel(type)} ${index}`:`動画 ${index}`);
    return `<fieldset data-video-row data-auto-title="${value.autoTitle!==false}" data-custom-type="${Boolean(value.customType)}"><legend>動画 ${index}</legend><div class="grid">${input('title','動画名・仮のタイトル','text',title,true,'maxlength="500"')}<label class="field"><span>動画の種類</span><select name="type" required><option value="">選んでください</option>${['short','long','opening','ending'].map(k=>`<option value="${k}" ${k===type?'selected':''}>${videoTypeLabel(k)}</option>`).join('')}</select></label>${input('durationSeconds','予定する完成尺（秒・未定なら空欄）','number',value.durationSeconds??'',false,'min="1" step="1"')}<div class="actions">${button('この動画を削除','remove-video')}</div></div></fieldset>`;
  }
  function applyVideoBatch(form) {
    const rows=$('inquiry-videos'),count=Number(form.querySelector('[name=bulkCount]').value),type=form.querySelector('[name=bulkType]').value;
    if(!['short','long','opening','ending'].includes(type))throw Error('主な動画の種類を選んでください。種類からのご相談は公式LINEで受け付けています。');
    if(!Number.isInteger(count)||count<1||count>20)throw Error('今回の本数は1〜20本の整数で指定してください。');
    if(count<rows.children.length)throw Error('入力済みの内容を残すため、本数を減らすときは対象動画の「この動画を削除」を押してください。');
    for(const [index,row] of [...rows.children].entries())if(row.dataset.customType!=='true'){
      row.querySelector('[name=type]').value=type;
      if(row.dataset.autoTitle==='true')row.querySelector('[name=title]').value=`${videoTypeLabel(type)} ${index+1}`;
    }
    while(rows.children.length<count)rows.insertAdjacentHTML('beforeend',inquiryRow(rows.children.length+1,{type}));
    syncVideoCount(form);
  }
  function syncVideoCount(form) {const count=$('inquiry-videos').children.length;form.querySelector('[name=bulkCount]').value=count;const summary=form.querySelector('[data-video-details] summary');if(summary)summary.textContent=`動画ごとの名前・種類・完成尺（${count}本）`;captureInquiry(form);}
  function renderNew() {
    state.view='new';state.order=null;
    const previous=state.orders.filter(o=>o.customerId===state.user.customerId&&o.customerName).slice().sort((a,b)=>Date.parse(b.updatedAt)-Date.parse(a.updatedAt))[0];
    const draft=inquiryDraft||{customerName:previous?.customerName||'',brief:'',requestedDueDate:'',bulkType:'',bulkCount:'1',videos:[{}],hearing:{}};
    $('content').innerHTML=`<h1>新しい動画のご相談</h1><p class="muted">まずは、わかる範囲でお知らせください。編集内容と料金は、ご希望を確認してから決めます。</p><form class="panel" data-form="inquiry"><h2>今回のご相談</h2><div class="grid">${input('customerName','会社名・お名前','text',draft.customerName,true,'maxlength="150" autocomplete="name"')}${area('brief','どんな動画を頼みたいですか（短い説明で大丈夫です）',draft.brief)}${input('requestedDueDate','希望する納品日（未定なら空欄）','date',draft.requestedDueDate,false)}</div><div class="batch-videos grid"><label class="field"><span>主な動画の種類</span><select name="bulkType" required><option value="">選んでください</option>${['short','long','opening','ending'].map(k=>`<option value="${k}" ${draft.bulkType===k?'selected':''}>${videoTypeLabel(k)}</option>`).join('')}</select></label>${input('bulkCount','今回の本数','number',draft.bulkCount||draft.videos.length,true,'min="1" max="20" step="1"')}<div class="actions">${button('この本数の動画を用意する','video-batch')}</div></div><p class="hint">種類から相談したい方は、公式LINEへお知らせください。</p>${lineLink}<p class="hint">同じ種類なら、まとめて入力欄を用意できます。仮のタイトルのまま相談でき、動画ごとに変更もできます。</p><details data-video-details><summary>動画ごとの名前・種類・完成尺（${draft.videos.length}本）</summary><div id="inquiry-videos">${draft.videos.map((v,i)=>inquiryRow(i+1,v)).join('')}</div>${button('動画をもう1本追加','add-video')}</details><details data-hearing-details ${draft.detailsOpen?'open':''}><summary>参考動画・素材・編集の希望を追加する（任意）</summary><p class="hint">決まっている項目だけで大丈夫です。まだわからないことは、相談後にも追加できます。</p>${hearingFields(draft.hearing)}</details><p class="hint">下書きは、この画面を開いている間だけ保持します。再読み込みやログアウトをすると未送信の内容は消えます。1回の相談は20本までです。</p><p class="hint">ご相談だけで注文や請求が確定することはありません。</p>${legalLinks()}${submit('相談を送る')}</form>`;
  }
  function hearingPanel(o) {
    const h=o.hearing||{},editable=o.status==='inquiry'&&!o.quotes.length;
    const rows=Object.entries(hearingLabels).map(([key,label])=>[label,hearingEnums[key]?(hearingEnums[key][h[key]]||'未定'):h[key]||'未記入']);
    return `<section class="panel"><h2>編集についてのご希望</h2>${dl(rows)}${editable?`<details><summary>決まったこと・不足している回答を追加する</summary><form data-form="hearing"><p class="hint">お見積もり前の回答として保存します。送信済みの内容を確認してから更新してください。</p>${hearingFields(hearingDrafts.get(o.id)||h)}${submit('ヒアリング回答を更新する')}</form></details>`:'<p class="hint">お見積もり後の条件変更は、公式LINEでご相談ください。合意した内容をこの欄から上書きすることはありません。</p>'}</section>`;
  }
  async function loadOrder(id) {
    // Fetch the independent materials card in parallel. A missing integration
    // or failed materials read must never hide an otherwise readable order.
    void loadMaterials(id);
    const data=await api(`/api/orders/${encodeURIComponent(id)}`);state.order=data.order;state.view='detail';renderDetail();
  }
  function materialsIdentity() {return `${state.user?.role||''}:${state.user?.id||''}:${state.user?.customerId||''}`;}
  function checkedMaterials(data) {
    if(!data?.materials||!['unconfigured','identity_required','ready_to_prepare','ready','closed'].includes(data.materials.status))throw Error('素材提出先の応答を確認できません。');
    return data.materials;
  }
  function renderMaterialsCard() {
    const target=$('materials-card');
    if(target&&state.view==='detail'&&state.order)target.innerHTML=materialsPanel(state.order);
  }
  async function loadMaterials(id) {
    const generation=++materialsGeneration,identity=materialsIdentity();
    state.materials={orderId:id,loading:true,data:null,error:null};
    if(state.order?.id===id)renderMaterialsCard();
    try {
      const data=checkedMaterials(await api(`/api/orders/${encodeURIComponent(id)}/materials`,{signal:AbortSignal.timeout(10000)}));
      if(generation!==materialsGeneration||identity!==materialsIdentity())return;
      state.materials={orderId:id,loading:false,data,error:null};
    } catch(error) {
      if(generation!==materialsGeneration||identity!==materialsIdentity())return;
      state.materials={orderId:id,loading:false,data:null,error:'素材提出先を取得できませんでした。案件情報は引き続き確認できます。素材提出先を再取得してください。'};
    }
    if(state.order?.id===id)renderMaterialsCard();
  }
  function materialsFolderUrl(value) {
    const safe=safeUrl(value);
    if(!safe)return null;
    const url=new URL(safe);
    return url.hostname==='drive.google.com'&&/^\/drive\/(?:u\/\d+\/)?folders\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)?url.href:null;
  }
  function materialsPanel(o) {
    const current=state.materials?.orderId===o.id?state.materials:null,m=current?.data;
    const title='<h2>素材の提出先</h2>';
    if(!current||current.loading)return `<section class="panel" aria-busy="true">${title}<p class="muted">素材提出先を確認しています。</p></section>`;
    if(current.error)return `<section class="panel">${title}<p class="inline-note danger-note" role="alert">${esc(current.error)}</p>${button('素材提出先を再取得','materials-refresh')}</section>`;
    const closed=m.status==='closed'||o.status==='completed'||cancellationLocked(o);
    const folderUrl=!closed&&m.status==='ready'?materialsFolderUrl(m.folderUrl):null;
    let content=folderUrl?`<a class="button primary" href="${esc(folderUrl)}" target="_blank" rel="noopener noreferrer">この依頼の素材フォルダを開く</a>${m.folderName?`<p class="folder-path">${esc(m.folderName)}</p>`:''}<p class="hint">フォルダを開くだけでは提出完了になりません。アップロード後、動画ごとに素材の提出完了をご報告ください。</p>`:m.status==='ready'?`<p class="inline-note danger-note">素材フォルダのURLを確認できません。提出先を再取得してください。</p>${button('素材提出先を再取得','materials-refresh')}`:admin()?'<p>素材フォルダの共有準備が完了すると、提出先を案内できます。</p>':'<p>素材の提出先は個別にご案内します。案内をお待ちください。</p>';
    if(closed)content='<p>この案件の素材受付は終了、または停止しています。</p>';
    if(admin()) {
      const canManage=!closed,locked=m.identityLocked!==false;
      if(m.verifiedEmail)content+=dl([['確認済みの共有先',m.verifiedEmail]]);
      if(m.identityVerification)content+=`<details><summary>共有先の本人確認記録（管理者のみ）</summary>${dl([['確認した連絡手段',({line:'LINE',email:'メール',other:'その他'})[m.identityVerification.channel]||m.identityVerification.channel],['確認日時',m.identityVerification.confirmedAt],['確認の根拠',m.identityVerification.evidence]])}</details>`;
      if(m.metadataPrivacyGuaranteed===false&&!closed)content+='<p class="inline-note">指定の親フォルダにアクセスできる人には、お客様のフォルダ名が見える場合があります。素材の閲覧権限は個別に確認します。</p>';
      if(m.status==='unconfigured')content+='<p class="muted">素材フォルダの連携設定は準備中です。受付や通常の案件操作は引き続き利用できます。</p>';
      if(canManage) {
        if(!locked)content+=`<details ${m.verifiedEmail?'':'open'}><summary>${m.verifiedEmail?'共有先の本人確認記録を更新':'Googleアカウントの本人確認を記録'}</summary><form data-form="materials-identity"><p class="hint">共有するGoogleアカウントをお客様本人に確認した後、その結果を記録してください。</p><div class="grid">${input('email','本人確認したGoogleアカウントのメールアドレス','email',m.verifiedEmail||'',true,'maxlength="254" autocomplete="off"')}<label class="field"><span>本人確認を行った連絡手段</span><select name="channel"><option value="line">LINE</option><option value="email">メール</option><option value="other">その他</option></select></label>${input('confirmedAt','本人確認を行った日時（日本時間）','datetime-local','',true,'step="1"')}${area('evidence','本人確認の根拠（管理者のみ）')}</div>${submit('共有先の本人確認記録を保存')}</form></details>`;
        else content+='<p class="hint">共有準備を開始済みのため、この画面では共有先メールアドレスを変更できません。</p>';
        if(m.status==='ready_to_prepare'&&m.verifiedEmail) {
          if(!o.customerName?.trim())content+='<p class="inline-note danger-note">会社名・お名前が未登録のため、フォルダを準備できません。名前を確認済みの案件から準備してください。</p>';
          else content+=`<form data-form="materials-prepare"><p class="hint">確認済みの共有先へ、このお客様のフォルダ内に、今回の依頼分の素材フォルダを準備します。</p>${submit('今回の素材フォルダを準備する')}</form>`;
        }
      }
    }
    return `<section class="panel">${title}${content}</section>`;
  }
  async function materialsMutation(action,payload) {
    const id=state.order.id,identity=materialsIdentity(),generation=++materialsGeneration;
    let response;
    try {response=checkedMaterials(await api(`/api/orders/${encodeURIComponent(id)}/materials/${action}`,{method:'POST',body:JSON.stringify(payload)}));}
    catch(error) {
      // A timed-out prepare may have started sharing. Re-read the server lock
      // before permitting another identity edit; never infer a successful upload.
      if(identity===materialsIdentity()&&state.order?.id===id)await loadMaterials(id);
      if(error.unknown)throw Error('操作結果の応答を確認できませんでした。素材提出先の最新状態を確認してからお進みください。');
      throw error;
    }
    if(generation!==materialsGeneration||identity!==materialsIdentity()||state.order?.id!==id)return;
    state.materials={orderId:id,loading:false,data:response,error:null};renderMaterialsCard();
    notice(action==='verify-identity'?'共有先の本人確認記録を保存しました。':response.status==='ready'&&materialsFolderUrl(response.folderUrl)?'素材フォルダの共有設定を確認しました。提出先を利用できます。':'素材フォルダの状態を更新しました。表示内容をご確認ください。');
  }
  function quoteSummary(q,o) {
    return `<h2>見積もり 第${q.version}版</h2><p class="amount">${money(q.totalYen)} <small>税込・${q.lines.length}本合計</small></p>${q.lines.map(line=>`<details open><summary>${esc(o.videos.find(v=>v.id===line.videoId)?.title||line.videoId)} · ${money(line.totalYen)}</summary>${dl([['完成尺',`${line.durationSeconds}秒`],['今回の編集範囲',line.scope],['対象外の作業',line.excludedScope],['基本料金',money(line.baseYen)],['追加料金',money(line.extraYen)],...(line.extraYen?[['追加の理由',line.extraReason]]:[]),['納品日',line.dueDate],['素材提出期限',line.materialsDueDate]])}</details>`).join('')}${dl([['支払期日',q.paymentDueDate],['振込先・お支払いのご案内',q.paymentInstructions||'振込先と手数料は個別にご案内します。'],['キャンセル・精算基準',q.cancellationBasis]])}<p class="hint">お客様都合の無料修正は2回まで。制作側の不備は回数に含めません。</p>`;
  }
  function quoteEditor(o) {
    const q=latest(o.quotes);
    return `<details class="panel" ${!q?'open':''}><summary>${q?'見積もりを改訂する':'見積もりを作成する'}</summary><form data-form="quote"><p class="hint">全動画の編集範囲と具体的な日付を確定して提示します。祝日は自動計算しません。</p>${o.videos.map((v,i)=>{
      const l=q?.lines.find(line=>line.videoId===v.id);
      return `<fieldset data-quote-video="${esc(v.id)}" data-type="${v.type}"><legend>${i+1}. ${esc(v.title)} · ${esc(videoTypeLabel(v.type))}</legend><div class="grid">${input('durationSeconds','確定する完成尺（秒）','number',l?.durationSeconds??v.durationSeconds??'',true,'min="1" step="1"')}${input('extraYen','内容による追加料金（税込円）','number',l?.extraYen??0,true,'min="0" step="1"')}${area('scope','今回行う編集',l?.scope||'')}${area('excludedScope','今回の料金に含まない作業',l?.excludedScope||'')}${area('extraReason','追加料金の理由（追加がある場合は必須）',l?.extraReason||'',false)}${input('dueDate','納品日','date',l?.dueDate||o.requestedDueDate||'')}${input('materialsDueDate','素材提出期限','date',l?.materialsDueDate||'')}</div><div class="price-preview" data-price></div></fieldset>`;
    }).join('')}<div class="grid">${input('paymentDueDate','支払期日','date',q?.paymentDueDate||'')}${area('paymentInstructions','振込先・手数料などのお支払い案内（任意・4,000文字以内）',q?.paymentInstructions||'',false).replace('maxlength="10000"','maxlength="4000"')}${area('cancellationBasis','事前に提示するキャンセル・精算基準',q?.cancellationBasis||'')}</div><p id="quote-total" class="amount"></p>${submit(q?'新しい版として見積もりを提示':'見積もりを提示する')}</form></details>`;
  }
  function paymentPanel(o,q) {
    if(!o.acceptedQuote)return '';
    const verified=o.payment.verified,locked=cancellationLocked(o);
    return `<section class="panel"><h2>お支払い</h2>${dl([['見積もりの確認',`第${q.version}版を確認済み`],['振込先・お支払いのご案内',q.paymentInstructions||'振込先と手数料は個別にご案内します。'],['振込の報告',reported(o.payment)?'報告済み':'未報告'],['実入金の確認',verified?'確認済み':'未確認'],...(verified?[['入金額',money(verified.amountYen)],['入金日',verified.receivedDate]]:[])])}${verified?.late&&!locked?'<p class="inline-note danger-note">支払期日後の入金です。制作開始前に納品日の再確認が必要です。</p>':''}${!locked&&!verified&&!admin()?`<p class="hint">ご案内した振込先へお振り込み後にご報告ください。入金の確認は制作側で行います。</p>${!reported(o.payment)?button('振込を報告する','command',true,'data-command="report_payment"'):''}`:''}${!locked&&!verified&&admin()?`<form data-form="payment"><h3>実入金を照合</h3><div class="grid">${input('amountYen','実際の入金額（税込円）','number','',true,'min="1" step="1"')}${input('receivedDate','入金日','date')}${area('evidence','照合した入金の根拠（管理者のみ）')}</div>${submit('入金の照合結果を記録')}</form>`:''}</section>`;
  }
  function renderDetail() {
    const o=state.order,q=latest(o.quotes),isComplete=o.status==='completed'||cancellationLocked(o);
    $('content').innerHTML=`<div class="toolbar"><div><p class="eyebrow id" title="${esc(o.id)}">受付番号 ${esc(receiptNumber(o.id))}</p><h1>${esc(o.videos[0].title)}${o.videos.length>1?` ほか${o.videos.length-1}本`:''}</h1>${badge(orderStatus(o))}</div>${button('最新情報に更新','refresh')}</div><p class="inline-note">${esc(nextAction(o))}</p>${cancellationLocked(o)?cancellationPanel(o):''}<section class="panel"><h2>ご相談の内容</h2><p class="preserve">${esc(o.brief)}</p>${dl([['会社名・お名前',customerDisplayName(o),admin()?'顧客ID: '+o.customerId:null],['希望する納品日',o.requestedDueDate],['対象動画',`${o.videos.length}本`]])}</section>${hearingPanel(o)}${q?`<section class="panel">${quoteSummary(q,o)}${!admin()&&!o.acceptedQuote&&!isComplete?`<form data-form="accept">${legalLinks()}<label class="check"><input type="checkbox" name="agreement" required><span>第${q.version}版の料金・編集範囲・日付・キャンセル条件を確認しました。</span></label>${submit('この見積もりで依頼する')}<p class="hint">この操作で決済は行われません。</p></form>`:o.acceptedQuote?'<p class="badge">お客様確認済み</p>':!isComplete?'<p>お客様の確認をお待ちしています。</p>':''}</section>`:''}${admin()&&!o.acceptedQuote&&!isComplete?quoteEditor(o):''}${q?paymentPanel(o,q):''}<div id="materials-card">${materialsPanel(o)}</div><h2>動画ごとの進行</h2>${o.videos.map(v=>videoPanel(v,o)).join('')}${!cancellationLocked(o)?cancellationPanel(o):''}${o.quotes.length>1?`<details class="panel"><summary>以前の見積もり（${o.quotes.length-1}件）</summary>${o.quotes.slice(0,-1).reverse().map(old=>`<section class="panel">${quoteSummary(old,o)}</section>`).join('')}</details>`:''}${admin()?`<details class="panel"><summary>操作履歴</summary><ol class="history">${(o.history||[]).slice().reverse().map(h=>`<li>${esc(new Date(h.at).toLocaleString('ja-JP'))} · ${esc(commandLabels[h.type]||h.type)} · ${esc(h.actorId)}</li>`).join('')}</ol></details>`:''}`;
    updatePrices();updateSettlementPreview();
  }
  const needsRevisionQuote = v => v.activeRevision?.kind==='major_change'||(v.activeRevision?.kind==='customer'&&v.customerRevisionRounds>=2);
  function revisionQuoteCurrent(v) {
    const a=v.activeRevision,q=latest(a?.extra?.quotes);
    return q&&q.kind===a.kind&&q.instructionCount===a.instructions.length?q:null;
  }
  function paidRevisionReady(v) {
    const q=revisionQuoteCurrent(v),x=v.activeRevision?.extra;
    return Boolean(q&&x.accepted?.quoteVersion===q.version&&x.payment?.verified?.quoteVersion===q.version&&x.payment.verified.amountYen===q.amountYen&&(!x.payment.verified.late||x.deliveryReconfirmation));
  }
  function revisionQuoteSummary(q) {
    return `<h3>追加見積もり 第${q.version}版</h3><p class="amount">${money(q.amountYen)} <small>税込・この修正の追加料金</small></p>${dl([['追加で行う作業',q.scope],['料金に含まない作業',q.excludedScope],['追加作業の納品日',q.dueDate],['追加分の支払期日',q.paymentDueDate],['キャンセル・精算基準',q.cancellationBasis]])}`;
  }
  function revisionQuoteEditor(v) {
    const q=latest(v.activeRevision?.extra?.quotes);
    return `<details><summary>${q?'追加見積もりを改訂する':'追加見積もりを作成する'}</summary><form data-form="revision-quote" data-video="${esc(v.id)}"><p class="hint">今回の修正指示に対応する追加料金と範囲を提示します。合意と実入金の確認後に作業を開始します。</p><div class="grid">${input('amountYen','追加料金（税込円）','number',q?.amountYen??'',true,'min="1" step="1"')}${area('scope','追加で行う作業',q?.scope||'')}${area('excludedScope','料金に含まない作業',q?.excludedScope||'')}${input('dueDate','追加作業の納品日','date',q?.dueDate||'')}${input('paymentDueDate','追加分の支払期日','date',q?.paymentDueDate||'')}${area('cancellationBasis','追加作業のキャンセル・精算基準',q?.cancellationBasis||'')}</div>${submit(q?'新しい版の追加見積もりを提示する':'追加見積もりを提示する')}</form></details>`;
  }
  function revisionQuotePanel(v,o) {
    const a=v.activeRevision,x=a?.extra,q=latest(x?.quotes),current=revisionQuoteCurrent(v);
    if(!a||(!needsRevisionQuote(v)&&!x?.accepted))return '';
    const editable=!cancellationLocked(o)&&v.status==='revision_requested',accepted=Boolean(current&&x?.accepted?.quoteVersion===current.version),verified=x?.payment?.verified;
    let controls='';
    if(editable&&admin()) {
      if(!x?.accepted)controls=revisionQuoteEditor(v);
      else if(!verified)controls=`<form data-form="revision-payment" data-video="${esc(v.id)}"><h3>追加料金の実入金を照合</h3><div class="grid">${input('amountYen','実際の入金額（税込円）','number','',true,'min="1" step="1"')}${input('receivedDate','追加料金の入金日','date')}${area('evidence','照合した入金の根拠（管理者のみ）')}</div>${submit('追加料金の入金確認を記録')}</form>`;
      else if(verified.late&&!x.deliveryReconfirmation)controls=`<form data-form="revision-reconfirm" data-video="${esc(v.id)}"><h3>追加作業の納品日を再確認</h3><p class="hint">追加料金の入金確認後に、お客様と再合意した記録を保存します。</p><div class="grid">${input('dueDate','再合意した納品日','date',q.dueDate)}${input('confirmedAt','お客様が合意した日時（日本時間）','datetime-local','',true,'step="1"')}<label class="field"><span>合意を確認した連絡手段</span><select name="channel"><option value="line">LINE</option><option value="email">メール</option><option value="other">その他</option></select></label>${area('evidence','お客様の合意を確認できる記録')}${area('reason','納品日を再確認した理由')}</div>${submit('追加作業の納品日再合意を保存')}</form>`;
    } else if(editable&&!admin()) {
      if(current&&!x?.accepted)controls=`<form data-form="revision-accept" data-video="${esc(v.id)}">${legalLinks()}<label class="check"><input type="checkbox" required><span>追加見積もり第${q.version}版の ${money(q.amountYen)}、作業範囲、日付、キャンセル条件を確認し、依頼します。</span></label>${submit('この追加見積もりで依頼する')}</form>`;
      else if(accepted&&!verified&&!reported(x.payment))controls=`<form data-form="revision-report" data-video="${esc(v.id)}"><p class="hint">ご案内した方法で追加料金をお振り込み後、ご報告ください。</p>${submit('追加料金の振込を報告する')}</form>`;
    }
    return `<section class="panel"><h3>追加料金が必要な修正</h3>${q?revisionQuoteSummary(q):'<p>作業開始前に、追加料金と対応内容をご案内します。</p>'}${q&&!current?'<p class="inline-note danger-note">見積もり提示後に修正内容が変わっています。現在の内容に合わせた新しい見積もりを確認してください。</p>':''}${accepted?`<p class="badge">追加見積もり第${q.version}版をお客様が確認済み</p>${dl([['追加料金の振込報告',reported(x.payment)?'報告済み':'未報告'],['追加料金の実入金',verified?'確認済み':'未確認'],...(verified?[['確認済みの追加料金',money(verified.amountYen)],['追加入金日',verified.receivedDate]]:[])])}<p class="hint">合意済みの修正指示と区分は固定されています。追加の変更は別途ご相談ください。</p>`:''}${verified?.late&&!x.deliveryReconfirmation?'<p class="inline-note danger-note">追加料金が期日後に入金されています。作業開始前に納品日の再合意が必要です。</p>':''}${x?.deliveryReconfirmation?dl([['再合意した納品日',x.deliveryReconfirmation.dueDate]]):''}${controls}</section>`;
  }
  function paidRevisionHistory(v) {
    const records=v.paidRevisions||v.revisionRequests?.filter(a=>a.billing?.kind==='paid'&&a.extra).map(a=>({deliveryVersion:a.deliveryVersion,extra:a.extra}))||[];
    const accepted=records.map(record=>({record,q:record.extra?.quotes?.find(q=>q.version===record.extra.accepted?.quoteVersion)})).filter(item=>item.q);
    return accepted.length?`<details><summary>合意済みの追加見積もり・支払い履歴</summary>${accepted.map(({record,q})=>`<section class="panel"><p class="muted">納品第${record.deliveryVersion}版への修正</p>${revisionQuoteSummary(q)}${dl([['追加料金の実入金',record.extra.payment?.verified?money(record.extra.payment.verified.amountYen):'未確認'],['追加入金日',record.extra.payment?.verified?.receivedDate]])}</section>`).join('')}</details>`:'';
  }
  function videoPanel(v,o) {
    const d=latest(v.deliveries),a=v.activeRevision,done=v.status==='completed',locked=cancellationLocked(o);
    let controls='';
    if(!locked&&!done&&v.status==='awaiting') {
      if(admin()) {
        if(!v.materials.verified) controls+=`<form data-form="materials" data-video="${esc(v.id)}">${area('note','必要素材の確認記録（管理者のみ）')}${submit('素材を確認済みとして記録')}</form>`;
        if(o.payment.verified?.late&&!v.deliveryReconfirmation)controls+=`<form data-form="reconfirm" data-video="${esc(v.id)}"><hr class="separator"><h3>納品日の再合意を記録</h3><div class="grid">${input('dueDate','再合意した納品日','date',v.dueDate||'')}${input('confirmedAt','お客様が合意した日時（日本時間）','datetime-local','',true)}<label class="field"><span>合意を確認した連絡手段</span><select name="channel"><option value="line">LINE</option><option value="email">メール</option><option value="other">その他</option></select></label>${area('evidence','お客様の合意を確認できる記録')}${area('reason','納品日を再確認した理由')}</div>${submit('納品日の再合意を保存')}</form>`;
        const ready=o.acceptedQuote&&o.payment.verified&&v.materials.verified&&(!o.payment.verified.late||v.deliveryReconfirmation);
        controls+=`<div class="actions">${button('編集を開始する','command',true,`data-command="start_editing" data-video="${esc(v.id)}" ${ready?'':'disabled'}`)}</div>${!ready?'<p class="hint">見積もり確認・実入金確認・この動画の素材確認がそろうと開始できます。</p>':''}`;
      } else if(!reported(v.materials)&&!v.materials.verified) controls+=`<p class="hint">個別にご案内した方法で素材を提出した後に、ご報告ください。</p>${button('素材の提出完了を報告','command',false,`data-command="report_materials" data-video="${esc(v.id)}"`)}`;
    }
    if(!locked&&admin()&&['editing','revising'].includes(v.status))controls+=`<form data-form="delivery" data-video="${esc(v.id)}"><div class="grid">${input('url','納品する動画のURL','url','',true,'placeholder="https://"')}${input('reviewDueDate','お客様の確認期限','date')}</div>${submit(v.status==='revising'?'修正版を納品する':'動画を納品する')}</form>`;
    if(!locked&&!admin()&&!a?.extra?.accepted&&['delivered','revision_requested'].includes(v.status)) {
      controls+=`<details><summary>修正したい箇所を伝える</summary><form data-form="revision" data-video="${esc(v.id)}">${kindSelect()}${area('instructions','修正箇所・時間・ご希望の内容')}<p class="hint">修正の理由は制作側が内容を確認して確定します。追加の指示は、修正開始前までまとめて受け付けます。</p>${submit('この版への修正指示を送る')}</form></details>`;
      if(v.status==='delivered')controls+=`<form data-form="confirm" data-video="${esc(v.id)}"><label class="check"><input type="checkbox" required><span>納品された第${d.version}版を確認し、この動画の完了に同意します。</span></label>${submit('この動画の確認を完了する')}</form>`;
    }
    if(!locked&&admin()&&v.status==='revision_requested') {
      const extra=needsRevisionQuote(v),ready=extra?paidRevisionReady(v):Boolean(a?.kind);
      controls+=`${!a?.extra?.accepted?`<form data-form="classify" data-video="${esc(v.id)}">${kindSelect(a?.kind||'customer')}${submit('修正の区分を確定する')}</form>`:''}${extra&&!ready?'<p class="inline-note">追加見積もりへの合意・実入金・必要な納品日再合意がそろうと開始できます。</p>':''}<div class="actions">${button(extra?'合意済みの追加修正を開始する':'修正を開始する','command',true,`data-command="start_revision" data-video="${esc(v.id)}" ${ready?'':'disabled'}`)}</div>`;
    }
    const deliveryLink=d&&safeUrl(d.url);
    return `<section class="panel"><div class="toolbar"><h3>${esc(v.title)}</h3>${badge(locked?(orderStatus(o)==='cancelled'?'cancelled':o.cancellation?.stopped?'作業停止中':'作業停止の確認待ち'):v.status)}</div>${dl([['種類',videoTypeLabel(v.type)],['完成尺',v.durationSeconds?`${v.durationSeconds}秒`:'未定'],['納品日',v.dueDate],['素材の提出報告',reported(v.materials)?'報告済み':'未報告'],['素材の確認',v.materials.verified?'確認済み':'未確認'],['完了した無料修正',`${v.customerRevisionRounds} / 2回（お客様都合）`],['完了した有料修正',`${v.paidRevisionRounds??0}回`]])}${admin()&&v.materials.verified?.note?dl([['素材の確認記録',v.materials.verified.note]]):''}${v.deliveryReconfirmation?dl([['再合意した納品日',v.deliveryReconfirmation.dueDate],['再合意の記録',v.deliveryReconfirmation.customerConfirmation.evidence]]):''}${d?`<div class="inline-note"><strong>最新の納品 · 第${d.version}版</strong><p>確認期限：${esc(d.reviewDueDate)}</p>${deliveryLink?`<a class="button" href="${esc(deliveryLink)}" target="_blank" rel="noopener noreferrer">納品された動画を開く</a>`:'<p>納品URLを確認できません。</p>'}</div>`:''}${a?`<div class="inline-note"><h3>第${a.deliveryVersion}版への修正指示</h3>${a.instructions.map(i=>`<p class="preserve">${esc(i.text)}<br><span class="muted">希望区分：${esc(kinds[i.requestedKind]||i.requestedKind)}</span></p>`).join('')}<p>確定区分：${esc(kinds[a.kind]||'制作側で確認中')}</p></div>`:''}${revisionQuotePanel(v,o)}${done?'<p class="badge">お客様による納品確認が完了しました</p>':controls}${paidRevisionHistory(v)}${v.deliveries.length>1?`<details><summary>以前の納品を確認</summary>${v.deliveries.slice(0,-1).reverse().map(old=>safeUrl(old.url)?`<p><a href="${esc(safeUrl(old.url))}" target="_blank" rel="noopener noreferrer">第${old.version}版を開く</a></p>`:'').join('')}</details>`:''}</section>`;
  }
  function safeUrl(value) {try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}}
  function videoTypeLabel(type) { return ({short:'ショート',long:'長尺',opening:'YouTubeオープニング制作',ending:'YouTubeエンディング制作'})[type] || '未確認'; }
  function price(type,seconds) {
    if(!Number.isSafeInteger(seconds)||seconds<1)throw Error('完成尺は1秒以上の整数で入力してください。');
    if(type==='opening'||type==='ending')return 5000;
    if(type==='short')return 4000+Math.ceil(Math.max(0,seconds-120)/60)*1000;
    if(type==='long')return seconds<=600?13000:seconds<=900?16000:20000+Math.ceil(Math.max(0,seconds-1200)/60)*1000;
    throw Error('動画の種類を確認してください。');
  }
  function updatePrices() {
    let total=0,valid=true;
    document.querySelectorAll('[data-quote-video]').forEach(row=>{try{const seconds=Number(row.querySelector('[name=durationSeconds]').value),extraEl=row.querySelector('[name=extraYen]'),extra=Number(extraEl.value);if(extraEl.value===''||!Number.isSafeInteger(extra)||extra<0)throw Error('追加料金を0円以上の整数で入力してください。');const base=price(row.dataset.type,seconds);total+=base+extra;row.querySelector('[data-price]').textContent=`基本料金 ${money(base)} ＋ 追加 ${money(extra)} ＝ ${money(base+extra)}（税込）`;}catch(error){valid=false;row.querySelector('[data-price]').textContent=error.message;}});
    if($('quote-total'))$('quote-total').textContent=valid?`合計 ${money(total)}（税込）`:'合計：入力内容を確認してください';
  }
  async function submitForm(form) {
    const f=new FormData(form),get=name=>String(f.get(name)||'').trim(),n=name=>Number(get(name)),type=form.dataset.form,videoId=form.dataset.video;
    if(type==='fixture') {await api('/api/fixture/login',{method:'POST',body:JSON.stringify({userId:get('userId')})});requests.clear();await initialize();notice('ローカル検証用アカウントでログインしました。');return;}
    if(type==='inquiry') {
      if(!get('customerName')||get('customerName').length>150)throw Error('会社名・お名前を150文字以内で入力してください。');
      applyVideoBatch(form);
      const videos=[...form.querySelectorAll('[data-video-row]')].map(row=>({title:row.querySelector('[name=title]').value.trim(),type:row.querySelector('[name=type]').value,durationSeconds:row.querySelector('[name=durationSeconds]').value===''?null:Number(row.querySelector('[name=durationSeconds]').value)}));
      captureInquiry(form);const result=await mutation('/api/orders',{input:{customerName:get('customerName'),brief:get('brief'),requestedDueDate:get('requestedDueDate')||null,hearing:hearingValues(form),videos}},'new-order');inquiryDraft=null;await showSaved(result,`ご相談を保存しました。受付番号：${receiptNumber(result.order.id)}`);return;
    }
    if(type==='hearing'){captureHearingDraft(form);await mutateOrder('update_hearing',{hearing:hearingValues(form)});hearingDrafts.delete(state.order.id);return;}
    if(type==='materials-identity') {await materialsMutation('verify-identity',{email:get('email'),channel:get('channel'),confirmedAt:new Date(`${get('confirmedAt')}${get('confirmedAt').length===16?':00':''}+09:00`).toISOString(),evidence:get('evidence')});return;}
    if(type==='materials-prepare') {await materialsMutation('prepare-folder',{});return;}
    const o=state.order,q=latest(o.quotes),v=o.videos.find(item=>item.id===videoId);
    if(type==='quote') {
      const lines=[...form.querySelectorAll('[data-quote-video]')].map(row=>{const value=name=>row.querySelector(`[name=${name}]`).value.trim();const extraYen=Number(value('extraYen'));if(extraYen&&!value('extraReason'))throw Error('追加料金がある動画には、追加の理由を記入してください。');if(value('materialsDueDate')>value('dueDate'))throw Error('素材提出期限は納品日以前を指定してください。');return {videoId:row.dataset.quoteVideo,durationSeconds:Number(value('durationSeconds')),extraYen,scope:value('scope'),excludedScope:value('excludedScope'),extraReason:value('extraReason'),dueDate:value('dueDate'),materialsDueDate:value('materialsDueDate')};});
      await mutateOrder('issue_quote',{lines,paymentDueDate:get('paymentDueDate'),paymentInstructions:get('paymentInstructions'),cancellationBasis:get('cancellationBasis')});
    } else if(type==='accept')await mutateOrder('accept_quote',{quoteVersion:q.version});
    else if(type==='payment')await mutateOrder('verify_payment',{quoteVersion:q.version,amountYen:n('amountYen'),receivedDate:get('receivedDate'),evidence:get('evidence')});
    else if(type==='materials')await mutateOrder('verify_materials',{videoId,note:get('note')});
    else if(type==='reconfirm')await mutateOrder('reconfirm_delivery',{videoId,dueDate:get('dueDate'),reason:get('reason'),customerConfirmation:{channel:get('channel'),confirmedAt:new Date(`${get('confirmedAt')}:00+09:00`).toISOString(),evidence:get('evidence')}});
    else if(type==='delivery') {if(!safeUrl(get('url')))throw Error('納品URLはユーザー名・パスワードを含まない https:// のURLを入力してください。');await mutateOrder('deliver',{videoId,url:get('url'),reviewDueDate:get('reviewDueDate')});}
    else if(type==='revision')await mutateOrder('request_revision',{videoId,deliveryVersion:latest(v.deliveries).version,kind:get('kind'),instructions:get('instructions')});
    else if(type==='classify')await mutateOrder('classify_revision',{videoId,kind:get('kind')});
    else if(type==='confirm')await mutateOrder('confirm_delivery',{videoId,deliveryVersion:latest(v.deliveries).version});
    else if(type==='cancellation-request')await mutateOrder('request_cancellation',{reason:get('reason')});
    else if(type==='cancellation-stop')await mutateOrder('stop_for_cancellation',{note:get('note')});
    else if(type==='cancellation-reconcile')await mutateOrder('reconcile_cancellation_payments',{confirmedReceivedYen:n('confirmedReceivedYen'),evidence:get('evidence')});
    else if(type==='settlement') {
      const performedWorkYen=n('performedWorkYen'),externalCostYen=n('externalCostYen'),received=receivedTotal(o);
      if(received===null)throw Error('入金総額を取得できません。最新情報に更新してから精算案を作成してください。');
      const refundYen=received-performedWorkYen-externalCostYen;
      if(!Number.isSafeInteger(performedWorkYen)||!Number.isSafeInteger(externalCostYen)||performedWorkYen<0||externalCostYen<0||!Number.isSafeInteger(refundYen)||refundYen<0)throw Error('精算額は、確認済みの入金額以内の整数で入力してください。');
      if(externalCostYen&&['externalCostDescription','externalCostEvidence','externalCostApprovalEvidence'].some(name=>!get(name)))throw Error('外部費用がある場合は、お客様向けの説明・実額と取消不能の根拠・事前承認の記録をすべて記入してください。');
      await mutateOrder('issue_cancellation_settlement',{performedWorkYen,externalCostYen,refundYen,workBasis:get('workBasis'),externalCostDescription:get('externalCostDescription'),externalCostEvidence:get('externalCostEvidence'),externalCostApprovalEvidence:get('externalCostApprovalEvidence')});
    }
    else if(type==='cancellation-accept')await mutateOrder('accept_cancellation_settlement',{settlementVersion:latest(o.cancellation.settlements).version});
    else if(type==='cancellation-refund')await mutateOrder('record_cancellation_refund',{settlementVersion:latest(o.cancellation.settlements).version,amountYen:n('amountYen'),refundedDate:get('refundedDate'),evidence:get('evidence')});
    else if(type==='cancellation-finalize')await mutateOrder('finalize_cancellation',{});
    else if(type==='revision-quote') {
      if(get('paymentDueDate')>get('dueDate'))throw Error('追加分の支払期日は、追加作業の納品日以前にしてください。');
      await mutateOrder('issue_revision_quote',{videoId,amountYen:n('amountYen'),scope:get('scope'),excludedScope:get('excludedScope'),dueDate:get('dueDate'),paymentDueDate:get('paymentDueDate'),cancellationBasis:get('cancellationBasis')});
    }
    else if(type==='revision-accept')await mutateOrder('accept_revision_quote',{videoId,quoteVersion:latest(v.activeRevision.extra.quotes).version});
    else if(type==='revision-report')await mutateOrder('report_revision_payment',{videoId,quoteVersion:latest(v.activeRevision.extra.quotes).version});
    else if(type==='revision-payment')await mutateOrder('verify_revision_payment',{videoId,quoteVersion:latest(v.activeRevision.extra.quotes).version,amountYen:n('amountYen'),receivedDate:get('receivedDate'),evidence:get('evidence')});
    else if(type==='revision-reconfirm')await mutateOrder('reconfirm_revision_delivery',{videoId,quoteVersion:latest(v.activeRevision.extra.quotes).version,dueDate:get('dueDate'),reason:get('reason'),customerConfirmation:{channel:get('channel'),confirmedAt:new Date(`${get('confirmedAt')}${get('confirmedAt').length===16?':00':''}+09:00`).toISOString(),evidence:get('evidence')}});
  }
  async function run(action) {if(state.busy)return;setBusy(true);try{await action();}catch(error){notice(errorText(error),true);}finally{setBusy(false);}}
  document.addEventListener('submit',event=>{const form=event.target;if(!form.matches('form[data-form]'))return;event.preventDefault();if(!form.reportValidity()||state.busy)return;/* Capture enabled inputs before busy disables form controls. */const operation=submitForm(form);setBusy(true);operation.catch(error=>notice(errorText(error),true)).finally(()=>setBusy(false));});
  document.addEventListener('click',event=>{
    const target=event.target.closest('[data-action]');if(!target||state.busy)return;
    captureInquiry(document.querySelector('form[data-form=inquiry]'));captureHearingDraft(document.querySelector('form[data-form=hearing]'));
    const action=target.dataset.action;
    if(action==='filter'){state.filter=target.dataset.filter;void run(()=>loadList());return;}
    if(action==='new'){captureInquiry(document.querySelector('form[data-form=inquiry]'));heading();renderNew();return;}
    if(action==='video-batch'){try{applyVideoBatch(target.closest('form'));const details=target.closest('form').querySelector('[data-video-details]');details.querySelector('summary').textContent=`動画ごとの名前・種類・完成尺（${$('inquiry-videos').children.length}本）`;notice('動画の入力欄を用意しました。');}catch(error){notice(errorText(error),true);}return;}
    if(action==='add-video'){const rows=$('inquiry-videos');if(rows.children.length>=20){notice('1回の相談は20本までです。',true);return;}const type=target.closest('form').querySelector('[name=bulkType]').value;if(!['short','long','opening','ending'].includes(type)){notice('先に主な動画の種類を選んでください。',true);return;}rows.insertAdjacentHTML('beforeend',inquiryRow(rows.children.length+1,{type}));rows.lastElementChild.querySelector('input').focus();syncVideoCount(target.closest('form'));return;}
    if(action==='remove-video'){const rows=$('inquiry-videos');if(rows.children.length===1){notice('相談する動画を1本以上入力してください。',true);return;}target.closest('[data-video-row]').remove();[...rows.children].forEach((row,i)=>row.querySelector('legend').textContent=`動画 ${i+1}`);syncVideoCount(target.closest('form'));return;}
    run(async()=>{
      if(action==='drive-health'){await checkDriveHealth();}
      else if(action==='drive-root-provision'){await provisionDriveRoot();}
      else if(action==='notifications'){await loadNotifications();heading();}
      else if(action==='notify-send'){
        const i=Number(target.dataset.index),n=notificationItems[i];
        if(!n||!$(`notify-check-${i}`)?.checked)throw Error('宛先と全文を確認し、送信の承認にチェックしてください。');
        await api(`/api/notifications/${encodeURIComponent(n.eventId)}/${n.status==='approval_required'?'approve':'retry'}`,{method:'POST',body:JSON.stringify({hash:n.hash,confirm:true})});await loadNotifications();notice('送信処理を受け付けました。通知を更新して結果をご確認ください。');
      }
      else if(action==='list'){await loadList();heading();}
      else if(action==='page-next'&&state.nextCursor){await loadList({cursor:state.nextCursor,previous:[...state.previousCursors,state.pageCursor]});heading();}
      else if(action==='page-previous'&&state.previousCursors.length){const previous=state.previousCursors.slice();const cursor=previous.pop();await loadList({cursor,previous});heading();}
      else if(action==='open'){await loadOrder(target.dataset.id);heading();}
      else if(action==='materials-refresh'){await loadMaterials(state.order.id);}
      else if(action==='refresh'){if(state.view==='detail')await loadOrder(state.order.id);else await loadList();notice('最新情報を表示しました。');}
      else if(action==='logout'){if(embedded){mountOptions.onClose?.();return;}await api('/api/logout',{method:'POST',body:'{}'});requests.clear();state.orders=[];state.order=null;state.materials=null;materialsGeneration++;await loginScreen();notice('ログアウトしました。');}
      else if(action==='command'){const type=target.dataset.command,payload={};if(target.dataset.video)payload.videoId=target.dataset.video;if(type==='report_payment')payload.quoteVersion=latest(state.order.quotes).version;await mutateOrder(type,payload);}
    });
  });
  document.addEventListener('input',event=>{const row=event.target.closest('[data-video-row]');if(row&&event.target.name==='title')row.dataset.autoTitle='false';captureInquiry(event.target.closest('form'));captureHearingDraft(event.target.closest('form'));if(event.target.id==='search'){state.search=event.target.value;listLoadGeneration++;clearTimeout(searchTimer);searchTimer=setTimeout(()=>{if(state.view==='list')void loadList({keepControls:true}).catch(error=>notice(errorText(error),true));},300);}if(event.target.closest('[data-quote-video]'))updatePrices();if(event.target.closest('[data-form=settlement]'))updateSettlementPreview();});
  document.addEventListener('change',event=>{const row=event.target.closest('[data-video-row]');if(row&&event.target.name==='type')row.dataset.customType='true';if(event.target.name==='bulkType'&&event.target.value){try{applyVideoBatch(event.target.closest('form'));}catch(error){notice(errorText(error),true);}}captureInquiry(event.target.closest('form'));captureHearingDraft(event.target.closest('form'));if(event.target.id==='filter'){state.filter=event.target.value;void run(()=>loadList());}});
  // Public legal links open once per page load, without requiring a session.
  // Rendering a form or closing the dialog must not open it again.
  const initialLegal = !embedded&&globalThis.location?.search ? new URLSearchParams(globalThis.location.search).get('legal') : null;
  if (initialLegal === 'privacy' || initialLegal === 'terms') {
    const initialDialog = document.getElementById('legal-' + initialLegal);
    if (initialDialog && !initialDialog.open) initialDialog.showModal();
  }
  initialize();
  return {dispose(){disposed=true;controller?.abort();globalThis.clearInterval?.(refreshTimer);clearTimeout(searchTimer);listLoadGeneration++;materialsGeneration++;requests.clear();hearingDrafts.clear();inquiryDraft=null;state.user=null;state.order=null;state.orders=[];state.materials=null;}};
}};
if(!globalThis.document?.currentScript?.hasAttribute('data-mount-only'))globalThis.MonoEditingIntake.mount();
