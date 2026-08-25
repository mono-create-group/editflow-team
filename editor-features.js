(function(){
  'use strict';

  const PORTAL_APP_VERSION='20260826-02';
  const feature={
    board:[],catalog:[],manuals:[],schedules:[],release:null,
    messages:new Map(),messageUnsubs:new Map(),unsubs:[],startedFor:'',serverVersion:''
  };
  const original={
    navHtml,render,startPortal,jobForm,jobsHtml,jobCard,createJob,dashboardHtml,logout
  };

  function accessKind(){return String(access?.editorKind||'direct')}
  function isExternal(){return accessKind()==='external'}
  function assignedDirectorUid(){return String(access?.directorUid||'')}
  function editorDisplayName(){return access?.name||user?.displayName||'編集者'}
  function uniqById(items){const map=new Map();items.forEach(x=>x&&x.id&&map.set(x.id,x));return[...map.values()]}
  function stamp(v){return v&&typeof v.toMillis==='function'?v.toMillis():Number(v||0)}
  function byUpdated(a,b){return(stamp(b.updatedAt)||stamp(b.createdAt))-(stamp(a.updatedAt)||stamp(a.createdAt))}
  function accountItems(clientId){return(feature.catalog.find(x=>x.id===clientId)?.accounts||[]).filter(x=>x&&x.id&&x.name)}
  function validText(v,max){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=max}
  function releaseVersion(){return feature.release?.version||feature.serverVersion||''}
  function unsavedInputsPresent(){
    return !!document.querySelector('input:not([disabled]),textarea,select') && (
      !!sessionStorage.getItem(draftKey()) || jobs.some(j=>!!sessionStorage.getItem(jobDraftKey(j.id)))
    );
  }

  function injectStyles(){
    if(document.getElementById('editor-features-style'))return;
    const style=document.createElement('style');style.id='editor-features-style';style.textContent=`
      .update-banner{position:sticky;top:69px;z-index:19;display:flex;align-items:center;gap:10px;margin:-2px 0 14px;padding:11px 13px;border:1px solid #c4b5fd;border-radius:10px;background:#f5f3ff;box-shadow:var(--shadow)}
      .update-banner>div{flex:1;min-width:0}.update-banner b{display:block;font-size:12px}.update-banner span{font-size:10.5px;color:var(--t2)}
      .role-chip{display:inline-flex;align-items:center;margin-top:4px;padding:2px 7px;border-radius:99px;background:var(--purple2);color:#5b21b6;font-size:9px;font-weight:800}
      .feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.feature-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
      .board-card{display:flex;flex-direction:column;gap:8px}.board-card .actions{margin-top:auto}.scope-line{display:flex;gap:5px;flex-wrap:wrap}.scope-chip{display:inline-flex;padding:3px 7px;border-radius:7px;background:var(--card2);font-size:10px;color:var(--t2)}
      .message-thread{border-top:1px solid var(--border);margin-top:12px;padding-top:10px}.message{padding:8px 9px;margin:6px 0;border-radius:9px;background:var(--card2);font-size:11px}.message.mine{background:var(--purple2)}.message-head{display:flex;justify-content:space-between;gap:8px;color:var(--t3);font-size:9.5px;margin-bottom:3px}.message-body{white-space:pre-wrap;overflow-wrap:anywhere}
      .availability-card{border-left:3px solid var(--green)}.availability-card.unavailable{border-left-color:var(--t3)}.availability-hours{font-size:16px;font-weight:850;margin:4px 0}
      .manual-body{white-space:pre-wrap;font-size:12px;color:var(--t2);margin:9px 0}.manual-meta{font-size:10px;color:var(--t3)}
      .privacy-note{display:flex;gap:8px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:10px;font-size:11px;color:var(--t2)}
      .catalog-empty{border:1px dashed var(--border);border-radius:9px;padding:14px;color:var(--t2);font-size:11px}
      @media(max-width:760px){.feature-grid,.feature-grid.two{grid-template-columns:1fr}.update-banner{top:65px;align-items:flex-start;flex-wrap:wrap}.update-banner .btn{width:auto}}
    `;document.head.appendChild(style);
  }

  function updateAccountOptions(){
    const client=$('#new-client-id'),account=$('#new-account-id');if(!client||!account)return;
    const selected=account.dataset.selected||account.value||'';
    account.innerHTML='<option value="">アカウントを選択</option>'+accountItems(client.value).map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('');
    account.dataset.selected='';saveCaseDraft();
  }

  function navHtmlExtended(){
    const items=[['guide','使い方ガイド'],['dashboard','概要'],['board','案件を探す'],['jobs','担当案件'],['schedule','スケジュール'],['manuals','マニュアル'],['suggestion','匿名目安箱'],['invoices','請求書'],['settings','請求者設定']];
    return`<nav class="nav" aria-label="編集者メニュー">${items.map(([k,l])=>`<button type="button" class="btn ${view===k?'active':''}" onclick="setView('${k}')">${l}</button>`).join('')}</nav>`;
  }

  function dashboardExtended(){
    const base=original.dashboardHtml();
    const open=feature.board.filter(x=>x.status==='open').length;
    const availability=feature.schedules.find(x=>x.id===user?.uid);
    const intro=`<section class="section"><div class="feature-grid two"><div class="card notice"><b>${isExternal()?'外部編集者':'mono.create 直接契約編集者'}</b><div class="muted">${isExternal()?'担当ディレクターの案件・支払いのみ表示します。':'クライアント請求額・利益・他の編集者の報酬は表示しません。'}</div></div><div class="card"><div class="muted">新しい案件</div><b style="font-size:24px">${open}</b><div class="muted">${availability?.available?`稼働可 ${esc(availability.fromDate||'')} 〜 ${esc(availability.toDate||'')}`:'スケジュール未登録'}</div></div></div></section>`;
    return base+intro;
  }

  function jobFormExtended(){
    const d=readCaseDraft(),sharedDate=Object.prototype.hasOwnProperty.call(d,'sharedDate')?d.sharedDate:localDate(),deliveryDate=d.deliveryDate||d.deadline||'',catalog=feature.catalog.filter(x=>x.active!==false),accounts=accountItems(d.clientId||'');
    if(!catalog.length)return`<div class="card catalog-empty"><b>案件登録用のクライアントがまだ設定されていません。</b><div>管理者がクライアントとアカウントを登録すると、ここから「編集者派遣」の案件を追加できます。</div></div>`;
    return`<div class="card"><div class="section-title"><h2>編集者派遣の案件を登録</h2><span>入力内容は自動で一時保存</span></div><div class="form-grid" oninput="saveCaseDraft()" onchange="saveCaseDraft()"><div class="field"><label for="new-client-id">クライアント *</label><select id="new-client-id" onchange="updateAccountOptions()"><option value="">クライアントを選択</option>${catalog.map(x=>`<option value="${esc(x.id)}" ${x.id===d.clientId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label for="new-account-id">アカウント名 *</label><select id="new-account-id" data-selected="${esc(d.accountId||'')}"><option value="">アカウントを選択</option>${accounts.map(x=>`<option value="${esc(x.id)}" ${x.id===d.accountId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field full"><label for="new-case">案件・バッチ名</label><input id="new-case" maxlength="120" value="${esc(d.caseName||'')}" placeholder="例：2026年9月分"></div><div class="field"><label for="new-title">個別動画・案件名 *</label><input id="new-title" maxlength="120" value="${esc(d.title||'')}" placeholder="例：ショート動画 03"></div><div class="field"><label for="new-shared">受注日</label><input id="new-shared" type="date" value="${esc(sharedDate)}"></div><div class="field"><label for="new-deadline">納品日 *</label><input id="new-deadline" type="date" value="${esc(deliveryDate)}"></div><details class="optional-box"><summary>初稿日など詳しい日程を入力</summary><div class="form-grid" style="margin-top:8px"><div class="field"><label for="new-editor-draft">編集者 初稿</label><input id="new-editor-draft" type="date" value="${esc(d.editorDraftDate||'')}"></div><div class="field"><label for="new-client-draft">クライアント提出 初稿</label><input id="new-client-draft" type="date" value="${esc(d.clientDraftDate||'')}"></div><div class="field"><label for="new-thumbnail">サムネイル納品日</label><input id="new-thumbnail" type="date" value="${esc(d.thumbnailDate||'')}"></div></div></details><div class="field"><label class="check"><input id="new-urgent" type="checkbox" ${d.urgent?'checked':''}> 緊急案件として登録</label></div><div class="field"><label for="new-request">依頼内容URL</label><input id="new-request" type="url" value="${esc(d.requestUrl||'')}" placeholder="https://"></div><div class="field"><label for="new-source">素材URL</label><input id="new-source" type="url" value="${esc(d.sourceUrl||'')}" placeholder="https://"></div><div class="field full"><label for="new-instructions">依頼内容・編集指示 *</label><textarea id="new-instructions" maxlength="3000">${esc(d.instructions||'')}</textarea></div></div><div class="actions"><button class="btn primary job-primary" type="button" onclick="createJob()">編集者派遣に案件を登録</button></div></div>`;
  }

  function jobsExtended(){return`${pageHead('担当案件','受託・進捗・質問・納品をここで完結')}<ol class="flow"><li><b>STEP 1</b>案件を受ける／登録</li><li><b>STEP 2</b>日程と指示を確認</li><li><b>STEP 3</b>質問・初稿・修正</li><li><b>STEP 4</b>納品証跡を登録</li></ol>${jobFormExtended()}<section class="section"><div class="section-title"><h2>案件一覧</h2><span>${jobs.length}件</span></div><div class="job-list">${sortNewest(jobs).map(jobCard).join('')||'<div class="card empty">担当案件はありません</div>'}</div></section>`}

  function boardHtml(){
    const list=feature.board.filter(x=>x.status==='open').sort(byUpdated);
    return`${pageHead('案件を探す','受けられる案件だけを表示')}<div class="privacy-note"><b>表示範囲</b><span>${isExternal()?'担当ディレクターから届いた案件のみです。':'公開案件と、ご自身宛ての案件のみです。'} クライアント請求額と利益は保存も表示もしません。</span></div><section class="section"><div class="feature-grid">${list.map(x=>`<article class="card board-card"><div class="job-top"><div><div class="job-title">${esc(x.title||'')}</div><div class="job-meta">${esc(x.clientName||'')} / ${esc(x.accountName||'')}</div></div>${x.urgent?'<span class="pill red">緊急</span>':'<span class="pill">募集中</span>'}</div>${x.caseName?`<div class="muted">${esc(x.caseName)}</div>`:''}<div class="scope-line"><span class="scope-chip">初稿 ${esc(x.editorDraftDate||'未設定')}</span><span class="scope-chip">納品 ${esc(x.deliveryDate||'未設定')}</span></div><div class="job-body">${esc(x.summary||x.instructions||'')}</div><div class="actions"><button class="btn primary" onclick="claimBoardJob('${esc(x.id)}')">この案件を受ける</button></div></article>`).join('')||'<div class="card empty">現在受けられる案件はありません</div>'}</div></section>`;
  }

  function scheduleHtml(){
    const mine=feature.schedules.find(x=>x.id===user?.uid)||{};
    return`${pageHead('編集可能スケジュール','予定の詳細ではなく、受託可能な量だけを共有')}<div class="split"><div class="card"><div class="form-grid"><div class="field"><label for="av-from">対応可能期間 開始</label><input id="av-from" type="date" value="${esc(mine.fromDate||localDate())}"></div><div class="field"><label for="av-to">対応可能期間 終了</label><input id="av-to" type="date" value="${esc(mine.toDate||'')}"></div><div class="field"><label for="av-hours">1週間の対応可能時間</label><input id="av-hours" type="number" min="0" max="100" value="${Number(mine.hoursPerWeek||0)}"></div><div class="field"><label for="av-capacity">受けられる本数</label><input id="av-capacity" type="number" min="0" max="100" value="${Number(mine.capacity||0)}"></div><div class="field"><label for="av-type">対応できる案件</label><select id="av-type"><option ${mine.workType==='short'?'selected':''} value="short">ショート</option><option ${mine.workType==='long'?'selected':''} value="long">ロング</option><option ${mine.workType==='both'?'selected':''} value="both">両方</option></select></div><div class="field"><label class="check"><input id="av-ok" type="checkbox" ${mine.available!==false?'checked':''}> 新規案件を受けられる</label></div><div class="field full"><label for="av-note">業務上の補足（公開してよい内容のみ）</label><textarea id="av-note" maxlength="300" placeholder="例：平日夜、ショート2本まで">${esc(mine.note||'')}</textarea></div></div><div class="actions"><button class="btn primary" onclick="saveAvailability()">スケジュールを保存</button></div></div><div class="card notice"><b>書かない情報</b><p class="muted">他の編集者も閲覧できるため、通院・家族・私用などプライベートな理由は入力しないでください。</p></div></div><section class="section"><div class="section-title"><h2>チームの稼働目安</h2><span>${feature.schedules.length}名</span></div><div class="feature-grid">${feature.schedules.sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).map(x=>`<article class="card availability-card ${x.available===false?'unavailable':''}"><b>${esc(x.name||'編集者')}</b><div class="availability-hours">${x.available===false?'新規受託を停止中':`週 ${Number(x.hoursPerWeek||0)}時間 / ${Number(x.capacity||0)}本`}</div><div class="muted">${esc(x.fromDate||'')} 〜 ${esc(x.toDate||'')} ・ ${x.workType==='short'?'ショート':x.workType==='long'?'ロング':'両方'}</div>${x.note?`<div class="job-body">${esc(x.note)}</div>`:''}</article>`).join('')||'<div class="card empty">スケジュールはまだありません</div>'}</div></section>`;
  }

  function manualsHtml(){
    return`${pageHead('マニュアル保管庫','全体・クライアント・アカウント別に表示')}<div class="feature-grid two">${feature.manuals.sort(byUpdated).map(x=>{const u=safeUrl(x.url||'');return`<article class="card"><div class="job-top"><div><b>${esc(x.title||'')}</b><div class="manual-meta">${esc(x.scopeLabel||x.scope||'全体')} ・ version ${esc(x.version||'1')}</div></div><span class="pill">${x.required?'必読':'参考'}</span></div>${x.body?`<div class="manual-body">${esc(x.body)}</div>`:''}<div class="actions">${u?`<a class="btn small" href="${esc(u)}" target="_blank" rel="noopener">マニュアルを開く</a>`:''}<button class="btn primary small" onclick="markManualRead('${esc(x.id)}','${esc(String(x.version||'1'))}')">読了を記録</button></div></article>`}).join('')||'<div class="card empty">表示できるマニュアルはありません</div>'}</div>`;
  }

  function suggestionHtml(){
    return`${pageHead('匿名目安箱','投稿者のUID・氏名・メールをレコードに保存しません')}<div class="split"><div class="card"><div class="field"><label for="sg-category">種類</label><select id="sg-category"><option>業務改善</option><option>人間関係・ハラスメント</option><option>報酬・契約</option><option>アプリの不具合</option><option>その他</option></select></div><div class="field" style="margin-top:10px"><label for="sg-message">内容 *</label><textarea id="sg-message" maxlength="2000" placeholder="状況と改善してほしいことを入力"></textarea></div><label class="check" style="margin-top:10px"><input id="sg-reply" type="checkbox" checked> 匿名の返信コードを発行する</label><div class="actions"><button class="btn primary" onclick="submitSuggestion()">匿名で送信</button></div></div><div><div class="card privacy-note"><b>匿名性</b><span>投稿時の認証は外部からの悪用防止にのみ使います。投稿レコードには投稿者を特定する項目を保存しません。</span></div><div class="card" style="margin-top:10px"><b>匿名返信を確認</b><div class="field" style="margin-top:8px"><input id="sg-code" maxlength="32" placeholder="返信コード"></div><div class="actions"><button class="btn small" onclick="checkSuggestionReply()">返信を確認</button></div><div id="sg-reply-result" class="muted"></div></div></div></div>`;
  }

  function messageBlock(job){
    const list=(feature.messages.get(job.id)||[]).slice().sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt));
    return`<div class="message-thread"><div class="section-title"><h2>案件内チャット</h2><span>ここの履歴を正本として保存</span></div>${list.map(x=>`<div class="message ${x.byUid===user?.uid?'mine':''}"><div class="message-head"><span>${esc(x.byName||'メンバー')} ・ ${esc(x.kind||'メッセージ')}</span><span>${x.createdAt&&typeof x.createdAt.toDate==='function'?x.createdAt.toDate().toLocaleString('ja-JP'):''}</span></div><div class="message-body">${esc(x.body||'')}</div>${safeUrl(x.url||'')?`<a class="safe-link" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">添付URLを開く</a>`:''}</div>`).join('')||'<div class="muted">まだメッセージはありません</div>'}<div class="form-grid" style="margin-top:8px"><div class="field"><label for="msg-kind-${job.id}">種類</label><select id="msg-kind-${job.id}"><option>質問</option><option>回答</option><option>初稿提出</option><option>修正指示</option><option>修正稿提出</option><option>納品</option><option>連絡</option></select></div><div class="field"><label for="msg-url-${job.id}">関連URL</label><input id="msg-url-${job.id}" type="url" placeholder="https://"></div><div class="field full"><label for="msg-body-${job.id}">メッセージ</label><textarea id="msg-body-${job.id}" maxlength="2000"></textarea></div></div><div class="actions"><button class="btn primary small" onclick="sendJobMessage('${job.id}')">メッセージを送信</button></div></div>`;
  }

  function jobCardExtended(job){
    const base=original.jobCard(job);
    return base.replace('</article>',`${messageBlock(job)}</article>`);
  }

  function mountUpdateBanner(){
    if(!user||!access?.approved)return;
    const v=releaseVersion();if(!v||v===PORTAL_APP_VERSION)return document.getElementById('portal-update-banner')?.remove();
    if(document.getElementById('portal-update-banner'))return;
    const nav=document.querySelector('#app .nav');if(!nav)return;
    const el=document.createElement('div');el.id='portal-update-banner';el.className='update-banner';el.innerHTML=`<div><b>新しいシステム更新があります</b><span>${esc(v)} ・ ${unsavedInputsPresent()?'入力内容を一時保存してから再読み込みます。':'再読み込みで最新版に切り替わります。'}</span></div><button class="btn primary small" onclick="reloadPortalUpdate()">保存して再読み込み</button>`;nav.after(el);
  }

  function renderExtended(){
    original.render();
    injectStyles();
    const who=document.querySelector('#account b');if(who&&!document.querySelector('#account .role-chip'))who.insertAdjacentHTML('afterend',`<span class="role-chip">${isExternal()?'外部編集者':'直接契約編集者'}</span>`);
    mountUpdateBanner();syncMessageSubscriptions();
  }

  function stopFeatures(){
    feature.unsubs.forEach(x=>{try{x()}catch(_){}});feature.unsubs=[];
    feature.messageUnsubs.forEach(x=>{try{x()}catch(_){}});feature.messageUnsubs.clear();feature.messages.clear();feature.startedFor='';
  }

  function mergeBoard(items){feature.board=uniqById([...feature.board,...items]);render()}
  function mergeManuals(items){feature.manuals=uniqById([...feature.manuals,...items]);render()}

  function startFeatures(){
    if(DEMO||!user||!access?.approved||feature.startedFor===user.uid)return;
    stopFeatures();feature.startedFor=user.uid;
    const root=db.collection('editor_portals').doc(user.uid);
    feature.unsubs.push(root.collection('client_catalog').onSnapshot(q=>{feature.catalog=q.docs.map(d=>({id:d.id,...d.data()}));render()},()=>toast('クライアント一覧を読み込めません')));
    const boardQueries=isExternal()&&assignedDirectorUid()
      ?[db.collection('editor_job_board').where('directorUid','==',assignedDirectorUid())]
      :[db.collection('editor_job_board').where('audience','==','direct'),db.collection('editor_job_board').where('eligibleUids','array-contains',user.uid)];
    boardQueries.forEach(q=>feature.unsubs.push(q.onSnapshot(s=>mergeBoard(s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='open')),e=>console.warn('board',e?.code||e))));
    feature.unsubs.push(db.collection('editor_schedules').onSnapshot(q=>{feature.schedules=q.docs.map(d=>({id:d.id,...d.data()}));render()},e=>console.warn('schedules',e?.code||e)));
    feature.unsubs.push(db.collection('editor_manuals').where('audience','==','all').onSnapshot(q=>mergeManuals(q.docs.map(d=>({id:d.id,...d.data()}))),e=>console.warn('manuals',e?.code||e)));
    feature.unsubs.push(db.collection('editor_manuals').where('allowedUids','array-contains',user.uid).onSnapshot(q=>mergeManuals(q.docs.map(d=>({id:d.id,...d.data()}))),e=>console.warn('manuals assigned',e?.code||e)));
    feature.unsubs.push(db.collection('system').doc('releases_current').onSnapshot(d=>{feature.release=d.exists?d.data():null;render()},e=>console.warn('release',e?.code||e)));
  }

  function syncMessageSubscriptions(){
    if(DEMO||!db||!user)return;
    const ids=new Set(jobs.map(x=>x.id));
    feature.messageUnsubs.forEach((unsub,jid)=>{if(!ids.has(jid)){try{unsub()}catch(_){}feature.messageUnsubs.delete(jid);feature.messages.delete(jid)}});
    jobs.forEach(j=>{if(feature.messageUnsubs.has(j.id))return;const u=db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(j.id).collection('messages').orderBy('createdAt','asc').limit(200).onSnapshot(q=>{feature.messages.set(j.id,q.docs.map(d=>({id:d.id,...d.data()})));render()},e=>console.warn('messages',e?.code||e));feature.messageUnsubs.set(j.id,u)});
  }

  async function createDispatchJob(){
    const clientId=$('#new-client-id')?.value||'',accountId=$('#new-account-id')?.value||'',client=feature.catalog.find(x=>x.id===clientId),accountItem=accountItems(clientId).find(x=>x.id===accountId),title=$('#new-title')?.value.trim(),caseName=$('#new-case')?.value.trim()||'',deliveryDate=$('#new-deadline')?.value,instructions=$('#new-instructions')?.value.trim(),requestUrl=$('#new-request')?.value.trim()||'',sourceUrl=$('#new-source')?.value.trim()||'',schedule={sharedDate:$('#new-shared')?.value||'',editorDraftDate:$('#new-editor-draft')?.value||'',clientDraftDate:$('#new-client-draft')?.value||'',thumbnailDate:$('#new-thumbnail')?.value||'',deliveryDate};
    if(!client||!accountItem||!title||!deliveryDate||!instructions)return toast('クライアント・アカウント・案件名・納品日・依頼内容は必須です');
    const dateError=scheduleError(schedule);if(dateError)return toast(dateError);if((requestUrl&&!safeUrl(requestUrl))||(sourceUrl&&!safeUrl(sourceUrl)))return toast('URLは https:// または http:// で入力してください');
    const jid=id(),at=now(),data={recordType:'editor_portal_job',businessType:'dispatch',title,caseName,clientId,clientDisplay:client.name,accountId,accountDisplay:accountItem.name,deadline:deliveryDate,...schedule,requestUrl,sourceUrl,instructions,urgent:!!$('#new-urgent')?.checked,status:'受注済み',progress:'',evidenceUrl:'',blocker:'',workDate:'',startTime:'',endTime:'',submittedByUid:user.uid,editorUid:user.uid,editorEmail:user.email||'',editorName:editorDisplayName(),directorUid:assignedDirectorUid(),source:'direct_client',createdAt:at,updatedAt:at,history:[{at,type:'created',by:user.uid,status:'受注済み'}]};
    if(DEMO){jobs.unshift({id:jid,...data});sessionStorage.removeItem(draftKey());render();return toast('編集者派遣に案件を登録しました')}
    try{const ref=db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid),ev=ref.collection('events').doc(),batch=db.batch();batch.set(ref,data);batch.set(ev,{at:firebase.firestore.FieldValue.serverTimestamp(),type:'created',byUid:user.uid,status:data.status,deliveryDate,businessType:'dispatch'});await batch.commit();sessionStorage.removeItem(draftKey());toast('編集者派遣に案件を登録しました')}catch(e){console.warn(e);toast('案件を登録できませんでした')}
  }

  async function claimBoardJob(jid){
    const board=feature.board.find(x=>x.id===jid);if(!board||board.status!=='open')return toast('この案件はすでに受託済みです');
    if(!confirm(`「${board.title}」を受けますか？\n受託後は担当案件に追加されます。`))return;
    const at=now(),portalRef=db?.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid),data={recordType:'editor_portal_job',businessType:'edit_agency',boardJobId:jid,title:board.title||'',caseName:board.caseName||'',clientId:board.clientId||'',clientDisplay:board.clientName||'',accountId:board.accountId||'',accountDisplay:board.accountName||'',deadline:board.deliveryDate||'',sharedDate:localDate(),editorDraftDate:board.editorDraftDate||'',clientDraftDate:board.clientDraftDate||'',thumbnailDate:board.thumbnailDate||'',deliveryDate:board.deliveryDate||'',requestUrl:board.requestUrl||'',sourceUrl:board.sourceUrl||'',instructions:board.instructions||board.summary||'',urgent:!!board.urgent,status:'受注済み',progress:'',evidenceUrl:'',blocker:'',workDate:'',startTime:'',endTime:'',submittedByUid:user.uid,editorUid:user.uid,editorEmail:user.email||'',editorName:editorDisplayName(),directorUid:board.directorUid||'',source:'job_board',createdAt:at,updatedAt:at,history:[{at,type:'claimed',by:user.uid,status:'受注済み'}]};
    if(DEMO){feature.board=feature.board.filter(x=>x.id!==jid);jobs.unshift({id:jid,...data});render();return toast('案件を受託しました')}
    try{await db.runTransaction(async tx=>{const boardRef=db.collection('editor_job_board').doc(jid),snap=await tx.get(boardRef);if(!snap.exists||snap.data().status!=='open')throw new Error('already-claimed');tx.update(boardRef,{status:'assigned',assignedUid:user.uid,assignedName:editorDisplayName(),assignedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});tx.set(portalRef,data);tx.set(portalRef.collection('events').doc(),{at:firebase.firestore.FieldValue.serverTimestamp(),type:'claimed',byUid:user.uid,status:'受注済み',boardJobId:jid})});toast('案件を受託しました')}catch(e){console.warn(e);toast(e?.message==='already-claimed'?'別の編集者が先に受託しました':'案件を受託できませんでした')}
  }

  async function sendJobMessage(jid){
    const body=$('#msg-body-'+jid)?.value.trim()||'',url=$('#msg-url-'+jid)?.value.trim()||'',kind=$('#msg-kind-'+jid)?.value||'連絡';if(!validText(body,2000))return toast('メッセージを入力してください');if(url&&!safeUrl(url))return toast('URLを確認してください');
    const data={body,kind,url:url?safeUrl(url):'',byUid:user.uid,byName:editorDisplayName(),byRole:isExternal()?'外部編集者':'編集者',createdAt:DEMO?now():firebase.firestore.FieldValue.serverTimestamp()};
    if(DEMO){feature.messages.set(jid,[...(feature.messages.get(jid)||[]),{id:id(),...data}]);render();return toast('メッセージを送信しました')}
    try{await db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid).collection('messages').add(data);toast('メッセージを送信しました')}catch(e){console.warn(e);toast('メッセージを送信できませんでした')}
  }

  async function saveAvailability(){
    const fromDate=$('#av-from')?.value||'',toDate=$('#av-to')?.value||'',hoursPerWeek=Number($('#av-hours')?.value||0),capacity=Number($('#av-capacity')?.value||0),workType=$('#av-type')?.value||'both',available=!!$('#av-ok')?.checked,note=$('#av-note')?.value.trim()||'';if(!fromDate||!toDate||toDate<fromDate)return toast('対応可能期間を確認してください');if(hoursPerWeek<0||hoursPerWeek>100||capacity<0||capacity>100)return toast('対応時間と本数を確認してください');const data={name:editorDisplayName(),fromDate,toDate,hoursPerWeek,capacity,workType,available,note,updatedAt:DEMO?now():firebase.firestore.FieldValue.serverTimestamp()};
    if(DEMO){const i=feature.schedules.findIndex(x=>x.id===user.uid);if(i>=0)feature.schedules[i]={id:user.uid,...data};else feature.schedules.push({id:user.uid,...data});render();return toast('スケジュールを保存しました')}
    try{await db.collection('editor_schedules').doc(user.uid).set(data,{merge:true});toast('スケジュールを保存しました')}catch(e){console.warn(e);toast('スケジュールを保存できませんでした')}
  }

  async function markManualRead(manualId,version){
    if(DEMO)return toast('読了を記録しました');try{await db.collection('editor_portals').doc(user.uid).collection('manual_reads').doc(manualId).set({manualId,version,readAt:firebase.firestore.FieldValue.serverTimestamp()},{merge:true});toast('読了を記録しました')}catch(e){console.warn(e);toast('読了を記録できませんでした')}
  }

  async function submitSuggestion(){
    const category=$('#sg-category')?.value||'その他',message=$('#sg-message')?.value.trim()||'',needsReply=!!$('#sg-reply')?.checked;if(!validText(message,2000))return toast('内容を入力してください');const replyCode=needsReply?crypto.getRandomValues(new Uint32Array(3)).join('-'):'';const data={category,message,replyCode,status:'未確認',createdAt:DEMO?now():firebase.firestore.FieldValue.serverTimestamp()};
    if(DEMO){$('#sg-message').value='';if(replyCode)prompt('この返信コードを保存してください。',replyCode);return toast('匿名で送信しました')}
    try{await db.collection('editor_suggestions').add(data);$('#sg-message').value='';if(replyCode)prompt('投稿者を特定せず返信を確認するため、このコードを保存してください。',replyCode);toast('匿名で送信しました')}catch(e){console.warn(e);toast('目安箱を送信できませんでした')}
  }

  async function checkSuggestionReply(){
    const code=$('#sg-code')?.value.trim()||'',out=$('#sg-reply-result');if(!code)return toast('返信コードを入力してください');if(DEMO){out.textContent='デモ：まだ返信はありません。';return}try{const snap=await db.collection('editor_suggestion_replies').doc(code).get();out.textContent=snap.exists?(snap.data().message||'返信があります。'):'まだ返信はありません。'}catch(e){console.warn(e);out.textContent='返信を確認できませんでした。'}
  }

  function saveVisibleDrafts(){
    try{if($('#new-title'))saveCaseDraft();jobs.forEach(j=>{if($('#job-status-'+j.id))saveJobDraft(j.id)})}catch(e){console.warn('draft save',e)}
  }
  async function reloadPortalUpdate(){
    saveVisibleDrafts();const bust='?v='+Date.now();try{if('caches'in window){const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith('mcshanai-')).map(k=>caches.delete(k)))}if('serviceWorker'in navigator){const regs=await navigator.serviceWorker.getRegistrations();await Promise.all(regs.map(r=>r.unregister()))}}catch(e){console.warn(e)}location.href=location.pathname+bust;
  }
  async function checkServerVersion(){
    try{const res=await fetch('sw.js?vchk='+Date.now(),{cache:'no-store'}),text=await res.text(),m=text.match(/mcshanai-(\d{8}-\d{2})/);if(m&&m[1]!==PORTAL_APP_VERSION){feature.serverVersion=m[1];render()}}catch(_){}
  }

  function seedDemoFeatures(){
    access.editorKind='direct';feature.catalog=[{id:'demo-client',name:'大塚周平さん',active:true,accounts:[{id:'account-a',name:'大塚周平 公式YouTube'},{id:'account-b',name:'掊業用サブチャンネル'}]}];feature.board=[{id:'board-demo',status:'open',audience:'direct',title:'ショート動画 05',clientName:'大塚周平さん',accountName:'大塚周平 公式YouTube',caseName:'9月分',editorDraftDate:'2026-08-28',deliveryDate:'2026-08-30',summary:'参考動画と構成指示を確認して編集してください。',instructions:'参考動画と構成指示を確認して編集してください。',createdAt:now()}];feature.manuals=[{id:'manual-1',title:'お仕事の進め方',scope:'global',scopeLabel:'全体',version:'2.0',required:true,body:'案件の受託、質問、初稿、修正、納品はすべてこのアプリで行います。',updatedAt:now()}];feature.schedules=[{id:user.uid,name:user.displayName,available:true,fromDate:localDate(),toDate:'2026-09-15',hoursPerWeek:20,capacity:4,workType:'both',note:'平日夜と土日対応可'}];feature.messages.set('demo-1',[{id:'m1',byUid:'manager',byName:'中村航汰',kind:'連絡',body:'不明点はこの案件チャットで聞いてください。',createdAt:now()-3600000}]);render();
  }

  navHtml=navHtmlExtended;
  dashboardHtml=dashboardExtended;
  jobForm=jobFormExtended;
  jobsHtml=jobsExtended;
  jobCard=jobCardExtended;
  createJob=createDispatchJob;
  render=renderExtended;
  startPortal=function(){original.startPortal();startFeatures()};
  logout=async function(){stopFeatures();return original.logout()};
  window.updateAccountOptions=updateAccountOptions;
  window.claimBoardJob=claimBoardJob;
  window.sendJobMessage=sendJobMessage;
  window.saveAvailability=saveAvailability;
  window.markManualRead=markManualRead;
  window.submitSuggestion=submitSuggestion;
  window.checkSuggestionReply=checkSuggestionReply;
  window.reloadPortalUpdate=reloadPortalUpdate;

  const originalRenderBody=render;
  render=function(){
    if(user&&access?.approved){
      let body;
      if(view==='board')body=boardHtml();else if(view==='schedule')body=scheduleHtml();else if(view==='manuals')body=manualsHtml();else if(view==='suggestion')body=suggestionHtml();
      if(body){accountHtml();$('#app').innerHTML=navHtml()+body;injectStyles();mountUpdateBanner();return}
    }
    originalRenderBody();
  };

  injectStyles();
  if(DEMO)seedDemoFeatures();else{
    if(user&&access?.approved)startFeatures();
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)checkServerVersion()});
    setInterval(checkServerVersion,5*60*1000);checkServerVersion();
  }
})();
