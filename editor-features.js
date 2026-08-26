(function(){
  'use strict';

  const PORTAL_APP_VERSION='20260826-15';
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
  const WEEKDAY_LABELS=['月','火','水','木','金','土','日'];
  function dateAtNoon(value){const d=new Date(`${value}T12:00:00`);return Number.isNaN(d.getTime())?new Date():d}
  function localYmd(d){return`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function addLocalDays(value,n){const d=dateAtNoon(value);d.setDate(d.getDate()+n);return localYmd(d)}
  function weekMonday(value=localDate()){const d=dateAtNoon(value),offset=(d.getDay()+6)%7;d.setDate(d.getDate()-offset);return localYmd(d)}
  function weekDates(value=localDate()){const start=weekMonday(value);return Array.from({length:7},(_,i)=>addLocalDays(start,i))}
  function defaultDay(date){return{date,status:'unavailable',startTime:'',endTime:'',capacity:0,workType:'both',note:''}}
  function normalizeDay(day,date){const x=day&&typeof day==='object'?day:{};return{date,status:['available','consult','unavailable'].includes(x.status)?x.status:(x.available===true?'available':'unavailable'),startTime:/^\d{2}:\d{2}$/.test(x.startTime||'')?x.startTime:'',endTime:/^\d{2}:\d{2}$/.test(x.endTime||'')?x.endTime:'',capacity:Math.max(0,Math.min(20,Number(x.capacity||0))),workType:['short','long','both'].includes(x.workType)?x.workType:'both',note:String(x.note||'').slice(0,80)}}
  function scheduleDaysForWeek(record){
    const dates=weekDates(),start=dates[0],saved=Array.isArray(record?.days)&&record.weekStart===start?record.days:null;
    if(saved)return dates.map((date,i)=>normalizeDay(saved.find(x=>x?.date===date)||saved[i],date));
    if(record?.routineEnabled&&Array.isArray(record.routine)&&record.routine.length)return dates.map((date,i)=>normalizeDay(record.routine.find(x=>Number(x?.weekday)===i+1),date));
    if(record?.fromDate&&record?.toDate){const active=dates.map(date=>date>=record.fromDate&&date<=record.toDate&&record.available!==false),count=active.filter(Boolean).length,total=Math.max(0,Number(record.capacity||0));let seen=0;return dates.map((date,i)=>{if(!active[i])return defaultDay(date);const base=Math.floor(total/Math.max(1,count)),extra=seen<total%Math.max(1,count)?1:0;seen++;return normalizeDay({status:'available',capacity:base+extra,workType:record.workType||'both',note:i===0?record.note||'':''},date)})}
    return dates.map(defaultDay);
  }
  function statusLabel(status){return status==='available'?'編集可能':status==='consult'?'要相談':'不可'}
  function typeLabel(type){return type==='short'?'ショート':type==='long'?'ロング':'両方'}
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
      .nav .btn.accept-entry{border:2px solid #7c3aed;background:#f5f3ff;color:#5b21b6;box-shadow:0 4px 14px rgba(124,58,237,.18);font-weight:850}.nav .btn.accept-entry.active{background:linear-gradient(135deg,#7c3aed,#5b21b6);color:#fff;border-color:#5b21b6}.accept-count{display:inline-flex;align-items:center;justify-content:center;min-width:20px;height:20px;padding:0 6px;border-radius:99px;background:#dc2626;color:#fff;font-size:10px;font-weight:900}
      .feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.feature-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
      .board-card{display:flex;flex-direction:column;gap:8px;border:2px solid #c4b5fd;box-shadow:0 6px 20px rgba(91,33,182,.10)}.board-card .actions{margin-top:auto}.claim-button{width:100%;min-height:52px;font-size:14px;background:linear-gradient(135deg,#7c3aed,#5b21b6)!important;box-shadow:0 7px 18px rgba(91,33,182,.25)}.claim-button:hover{transform:translateY(-1px)}.accept-howto{display:flex;align-items:flex-start;gap:10px;margin:10px 0 14px;padding:12px 14px;border:1px solid #c4b5fd;border-radius:11px;background:#f5f3ff;color:#4c1d95}.accept-howto b{display:block;font-size:12px}.accept-howto span{display:block;margin-top:2px;font-size:10.5px;color:#6d28d9;line-height:1.6}.scope-line{display:flex;gap:5px;flex-wrap:wrap}.scope-chip{display:inline-flex;padding:3px 7px;border-radius:7px;background:var(--card2);font-size:10px;color:var(--t2)}
      .message-thread{border-top:1px solid var(--border);margin-top:12px;padding-top:10px}.message{padding:8px 9px;margin:6px 0;border-radius:9px;background:var(--card2);font-size:11px}.message.mine{background:var(--purple2)}.message-head{display:flex;justify-content:space-between;gap:8px;color:var(--t3);font-size:9.5px;margin-bottom:3px}.message-body{white-space:pre-wrap;overflow-wrap:anywhere}
      .availability-card{border-left:3px solid var(--green)}.availability-card.unavailable{border-left-color:var(--t3)}.availability-hours{font-size:16px;font-weight:850;margin:4px 0}
      .availability-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:10px}.availability-day{min-width:0;border:1px solid var(--border);border-radius:11px;padding:10px;background:var(--card)}.availability-day-head{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:7px}.availability-day-head b{font-size:12px}.availability-day-head span{font-size:9px;color:var(--t3)}.availability-day .field{margin-top:6px}.availability-day label{font-size:9.5px}.availability-day input,.availability-day select,.availability-day textarea{min-width:0;padding:7px 8px;font-size:12px}.availability-day textarea{min-height:52px}.availability-time{display:grid;grid-template-columns:1fr 1fr;gap:5px}.availability-bulk{margin-bottom:10px;background:#f8fafc}.availability-bulk-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;align-items:end}.availability-bulk-days{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}.availability-bulk-days label{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:10.5px}.availability-bulk-days input,.availability-routine input{width:auto}.availability-routine{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding:10px;background:var(--purple2);border-radius:9px;font-size:11px}.team-day-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.team-day-chip{font-size:9.5px;padding:3px 6px;border-radius:6px;background:var(--card2);color:var(--t2)}.team-day-chip.on{background:#ecfdf5;color:#047857}.team-day-chip.consult{background:#fffbeb;color:#b45309}
      .manual-body{white-space:pre-wrap;font-size:12px;color:var(--t2);margin:9px 0}.manual-meta{font-size:10px;color:var(--t3)}
      .privacy-note{display:flex;gap:8px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:10px;font-size:11px;color:var(--t2)}
      .catalog-empty{border:1px dashed var(--border);border-radius:9px;padding:14px;color:var(--t2);font-size:11px}
      @media(max-width:980px){.availability-calendar{grid-template-columns:repeat(2,minmax(0,1fr))}.availability-bulk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){.feature-grid,.feature-grid.two,.availability-calendar,.availability-bulk-grid{grid-template-columns:1fr}.update-banner{top:65px;align-items:flex-start;flex-wrap:wrap}.update-banner .btn{width:auto}.availability-day{display:grid;grid-template-columns:70px minmax(0,1fr);gap:7px}.availability-day-head{display:block}.availability-day>.field,.availability-day>.availability-time{margin-top:0}.availability-day .field.full{grid-column:1/-1}}
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
    const open=feature.board.filter(x=>x.status==='open').length;
    return`<nav class="nav" aria-label="編集者メニュー">${items.map(([k,l])=>`<button type="button" class="btn ${k==='board'?'accept-entry ':''}${view===k?'active':''}" onclick="setView('${k}')">${k==='board'?'🔍 ':''}${l}${k==='board'&&open?` <span class="accept-count">${open}</span>`:''}</button>`).join('')}</nav>`;
  }

  function dashboardExtended(){
    const base=original.dashboardHtml();
    const open=feature.board.filter(x=>x.status==='open').length;
    const availability=feature.schedules.find(x=>x.id===user?.uid);
    const intro=`<section class="section"><div class="feature-grid two"><div class="card notice"><b>${isExternal()?'外部編集者':'mono.create 直接契約編集者'}</b><div class="muted">${isExternal()?'担当ディレクターの案件・支払いのみ表示します。':'クライアント請求額・利益・他の編集者の報酬は表示しません。'}</div></div><div class="card" style="border:2px solid ${open?'#7c3aed':'var(--border)'}"><div class="muted">受けられる編集代行案件</div><b style="font-size:24px">${open}</b><div class="muted">${availability?.available?`稼働可 ${esc(availability.fromDate||'')} 〜 ${esc(availability.toDate||'')}`:'スケジュール未登録'}</div>${open?'<div class="actions"><button class="btn primary small" onclick="setView(\'board\')">🔍 案件を探す</button></div>':''}</div></div></section>`;
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
    return`${pageHead('案件を探す','mono.createから募集中の編集代行案件')}<div class="accept-howto"><span style="font-size:20px">✅</span><div><b>内容と日程を確認し、紫のボタンを押してください</b><span>案件内容・初稿日・納品日を確認 → 「この案件を受ける」 → 「担当案件」に自動反映</span></div></div><div class="privacy-note"><b>表示範囲</b><span>${isExternal()?'担当ディレクターから届いた案件のみです。':'公開案件と、ご自身宛ての案件のみです。'} クライアント請求額と利益は保存も表示もしません。</span></div><section class="section"><div class="feature-grid">${list.map(x=>`<article class="card board-card"><div class="job-top"><div><div class="job-title">${esc(x.title||'')}</div><div class="job-meta">${esc(x.clientName||'')} / ${esc(x.accountName||'')}</div></div>${x.urgent?'<span class="pill red">緊急</span>':'<span class="pill">募集中</span>'}</div>${x.caseName?`<div class="muted">${esc(x.caseName)}</div>`:''}<div class="scope-line"><span class="scope-chip">初稿 ${esc(x.editorDraftDate||'未設定')}</span><span class="scope-chip">納品 ${esc(x.deliveryDate||'未設定')}</span></div><div class="job-body">${esc(x.summary||x.instructions||'')}</div><div class="actions"><button class="btn primary claim-button" onclick="claimBoardJob('${esc(x.id)}')">✓ この案件を受ける</button></div></article>`).join('')||'<div class="card empty">現在受けられる案件はありません</div>'}</div></section>`;
  }

  function scheduleHtml(){
    const mine=feature.schedules.find(x=>x.id===user?.uid)||{},days=scheduleDaysForWeek(mine),start=days[0].date,end=days[6].date;
    const dayCards=days.map((d,i)=>`<article class="availability-day"><div class="availability-day-head"><b>${WEEKDAY_LABELS[i]}曜日</b><span>${esc(d.date.slice(5).replace('-','/'))}</span></div><div class="field"><label for="av-status-${i}">対応</label><select id="av-status-${i}"><option value="available" ${d.status==='available'?'selected':''}>編集可能</option><option value="consult" ${d.status==='consult'?'selected':''}>要相談</option><option value="unavailable" ${d.status==='unavailable'?'selected':''}>不可</option></select></div><div class="availability-time"><div class="field"><label for="av-start-${i}">開始</label><input id="av-start-${i}" type="time" value="${esc(d.startTime)}"></div><div class="field"><label for="av-end-${i}">終了</label><input id="av-end-${i}" type="time" value="${esc(d.endTime)}"></div></div><div class="field"><label for="av-capacity-${i}">受託可能本数</label><input id="av-capacity-${i}" type="number" min="0" max="20" value="${Number(d.capacity||0)}"></div><div class="field"><label for="av-type-${i}">案件種別</label><select id="av-type-${i}"><option value="both" ${d.workType==='both'?'selected':''}>両方</option><option value="short" ${d.workType==='short'?'selected':''}>ショート</option><option value="long" ${d.workType==='long'?'selected':''}>ロング</option></select></div><div class="field full"><label for="av-note-${i}">業務上の補足</label><textarea id="av-note-${i}" maxlength="80" placeholder="例：18時以降">${esc(d.note)}</textarea></div></article>`).join('');
    const team=feature.schedules.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).map(x=>{const xd=scheduleDaysForWeek(x),open=xd.filter(d=>d.status!=='unavailable'),capacity=open.reduce((n,d)=>n+Number(d.capacity||0),0);return`<article class="card availability-card ${open.length?'':'unavailable'}"><b>${esc(x.name||'編集者')}</b><div class="availability-hours">${open.length?`${open.length}日 / ${capacity}本`:'今週は受託不可'}</div><div class="muted">${esc(start)} 〜 ${esc(end)}</div><div class="team-day-chips">${xd.map((d,i)=>`<span class="team-day-chip ${d.status==='available'?'on':d.status==='consult'?'consult':''}">${WEEKDAY_LABELS[i]} ${statusLabel(d.status)}${d.capacity?` ${Number(d.capacity)}本`:''}</span>`).join('')}</div></article>`}).join('');
    return`${pageHead('編集可能スケジュール',`今週の1週間（${start} 〜 ${end}）だけを入力`)}<div class="card availability-bulk"><b>一括登録</b><div class="muted">曜日を選び、同じ内容をまとめて反映できます。</div><div class="availability-bulk-days">${WEEKDAY_LABELS.map((label,i)=>`<label><input class="av-bulk-day" type="checkbox" value="${i}" checked> ${label}</label>`).join('')}</div><div class="availability-bulk-grid"><div class="field"><label for="av-bulk-status">対応</label><select id="av-bulk-status"><option value="available">編集可能</option><option value="consult">要相談</option><option value="unavailable">不可</option></select></div><div class="field"><label for="av-bulk-start">開始</label><input id="av-bulk-start" type="time"></div><div class="field"><label for="av-bulk-end">終了</label><input id="av-bulk-end" type="time"></div><div class="field"><label for="av-bulk-capacity">本数</label><input id="av-bulk-capacity" type="number" min="0" max="20" value="0"></div><div class="field"><label for="av-bulk-type">種別</label><select id="av-bulk-type"><option value="both">両方</option><option value="short">ショート</option><option value="long">ロング</option></select></div><div class="field"><label for="av-bulk-note">補足</label><input id="av-bulk-note" maxlength="80" placeholder="例：18時以降"></div></div><div class="actions"><button class="btn small" type="button" onclick="toggleAllAvailabilityDays(true)">7日すべて選択</button><button class="btn primary small" type="button" onclick="applyAvailabilityBulk()">選んだ日に反映</button></div></div><div class="availability-calendar">${dayCards}</div><label class="availability-routine"><input id="av-routine" type="checkbox" ${mine.routineEnabled?'checked':''}><span><b>毎週のルーティンとして保存</b><br>次週以降は同じ曜日・時間・本数を自動入力します。変更がある週だけ直せます。</span></label><div class="actions"><button class="btn primary" type="button" onclick="saveAvailability()">今週の1週間を保存</button></div><div class="card notice" style="margin-top:10px"><b>入力しない情報</b><p class="muted">他の編集者も閲覧できるため、通院・家族・私用などプライベートな理由は入力しないでください。</p></div><section class="section"><div class="section-title"><h2>チームの今週の稼働目安</h2><span>${feature.schedules.length}名</span></div><div class="feature-grid">${team||'<div class="card empty">スケジュールはまだありません</div>'}</div></section>`;
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
    return base.replace('<details class="job-detail">',`${editorMilestonePanel(job)}<details class="job-detail">`).replace('</article>',`${messageBlock(job)}</article>`);
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
    if(DEMO){feature.board=feature.board.filter(x=>x.id!==jid);jobs.unshift({id:jid,...data});view='jobs';render();return toast('案件を受託し、担当案件に反映しました')}
    try{await db.runTransaction(async tx=>{const boardRef=db.collection('editor_job_board').doc(jid),snap=await tx.get(boardRef);if(!snap.exists||snap.data().status!=='open')throw new Error('already-claimed');tx.update(boardRef,{status:'assigned',assignedUid:user.uid,assignedName:editorDisplayName(),assignedAt:firebase.firestore.FieldValue.serverTimestamp(),updatedAt:firebase.firestore.FieldValue.serverTimestamp()});tx.set(portalRef,data);tx.set(portalRef.collection('events').doc(),{at:firebase.firestore.FieldValue.serverTimestamp(),type:'claimed',byUid:user.uid,status:'受注済み',boardJobId:jid})});jobs=[{id:jid,...data},...jobs.filter(x=>x.id!==jid)];view='jobs';render();toast('案件を受託し、担当案件に反映しました')}catch(e){console.warn(e);toast(e?.message==='already-claimed'?'別の編集者が先に受託しました':'案件を受託できませんでした')}
  }

  async function sendJobMessage(jid){
    const body=$('#msg-body-'+jid)?.value.trim()||'',url=$('#msg-url-'+jid)?.value.trim()||'',kind=$('#msg-kind-'+jid)?.value||'連絡';if(!validText(body,2000))return toast('メッセージを入力してください');if(url&&!safeUrl(url))return toast('URLを確認してください');
    const data={body,kind,url:url?safeUrl(url):'',byUid:user.uid,byName:editorDisplayName(),byRole:isExternal()?'外部編集者':'編集者',createdAt:DEMO?now():firebase.firestore.FieldValue.serverTimestamp()};
    if(DEMO){feature.messages.set(jid,[...(feature.messages.get(jid)||[]),{id:id(),...data}]);render();return toast('メッセージを送信しました')}
    try{await db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid).collection('messages').add(data);toast('メッセージを送信しました')}catch(e){console.warn(e);toast('メッセージを送信できませんでした')}
  }

  function toggleAllAvailabilityDays(checked){document.querySelectorAll('.av-bulk-day').forEach(x=>{x.checked=checked})}
  function applyAvailabilityBulk(){
    const selected=[...document.querySelectorAll('.av-bulk-day:checked')].map(x=>Number(x.value));if(!selected.length)return toast('反映する曜日を選んでください');
    const values={status:$('#av-bulk-status')?.value||'available',startTime:$('#av-bulk-start')?.value||'',endTime:$('#av-bulk-end')?.value||'',capacity:Math.max(0,Math.min(20,Number($('#av-bulk-capacity')?.value||0))),workType:$('#av-bulk-type')?.value||'both',note:$('#av-bulk-note')?.value.trim().slice(0,80)||''};
    if((values.startTime&&!values.endTime)||(!values.startTime&&values.endTime)||values.startTime&&values.endTime&&values.endTime<=values.startTime)return toast('開始時刻と終了時刻を確認してください');
    selected.forEach(i=>{const fields={status:values.status,start:values.startTime,end:values.endTime,capacity:values.capacity,type:values.workType,note:values.note};Object.entries(fields).forEach(([key,value])=>{const el=$(`#av-${key}-${i}`);if(el)el.value=value})});toast(`${selected.length}日分に反映しました`);
  }
  function readAvailabilityDays(){
    const dates=weekDates(),days=dates.map((date,i)=>normalizeDay({status:$(`#av-status-${i}`)?.value||'unavailable',startTime:$(`#av-start-${i}`)?.value||'',endTime:$(`#av-end-${i}`)?.value||'',capacity:Number($(`#av-capacity-${i}`)?.value||0),workType:$(`#av-type-${i}`)?.value||'both',note:$(`#av-note-${i}`)?.value.trim()||''},date));
    for(let i=0;i<days.length;i++){const d=days[i];if((d.startTime&&!d.endTime)||(!d.startTime&&d.endTime)||d.startTime&&d.endTime&&d.endTime<=d.startTime)return{error:`${WEEKDAY_LABELS[i]}曜日の開始・終了時刻を確認してください`};if(d.capacity<0||d.capacity>20)return{error:`${WEEKDAY_LABELS[i]}曜日の本数を0〜20で入力してください`}}
    return{days};
  }
  async function saveAvailability(){
    const read=readAvailabilityDays();if(read.error)return toast(read.error);const days=read.days,start=days[0].date,end=days[6].date,routineEnabled=!!$('#av-routine')?.checked,open=days.filter(d=>d.status!=='unavailable'),capacity=open.reduce((n,d)=>n+Number(d.capacity||0),0),hoursPerWeek=open.reduce((n,d)=>{if(!d.startTime||!d.endTime)return n;const [sh,sm]=d.startTime.split(':').map(Number),[eh,em]=d.endTime.split(':').map(Number);return n+Math.max(0,(eh*60+em-sh*60-sm)/60)},0),types=[...new Set(open.map(d=>d.workType))],workType=types.length===1?types[0]:'both',routine=routineEnabled?days.map((d,i)=>({weekday:i+1,status:d.status,startTime:d.startTime,endTime:d.endTime,capacity:d.capacity,workType:d.workType,note:d.note})):[];
    const data={name:editorDisplayName(),weekStart:start,weekEnd:end,days,routineEnabled,routine,fromDate:start,toDate:end,hoursPerWeek:Math.round(hoursPerWeek*10)/10,capacity,workType,available:open.length>0,note:'',updatedAt:DEMO?now():firebase.firestore.FieldValue.serverTimestamp()};
    if(DEMO){const i=feature.schedules.findIndex(x=>x.id===user.uid);if(i>=0)feature.schedules[i]={id:user.uid,...data};else feature.schedules.push({id:user.uid,...data});render();return toast('今週の1週間を保存しました')}
    try{await db.collection('editor_schedules').doc(user.uid).set(data);toast('今週の1週間を保存しました')}catch(e){console.warn(e);toast('スケジュールを保存できませんでした')}
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
    const demoDates=weekDates(),demoDays=demoDates.map((date,i)=>normalizeDay({status:i<5?'available':i===5?'consult':'unavailable',startTime:i<5?'18:00':i===5?'10:00':'',endTime:i<5?'22:00':i===5?'16:00':'',capacity:i<5?1:i===5?2:0,workType:'both',note:i<5?'平日夜':''},date));
    access.editorKind='direct';feature.catalog=[{id:'demo-client',name:'大塚周平さん',active:true,accounts:[{id:'account-a',name:'大塚周平 公式YouTube'},{id:'account-b',name:'掊業用サブチャンネル'}]}];feature.board=[{id:'board-demo',status:'open',audience:'direct',title:'ショート動画 05',clientName:'大塚周平さん',accountName:'大塚周平 公式YouTube',caseName:'9月分',editorDraftDate:'2026-08-28',deliveryDate:'2026-08-30',summary:'参考動画と構成指示を確認して編集してください。',instructions:'参考動画と構成指示を確認して編集してください。',createdAt:now()}];feature.manuals=[{id:'manual-1',title:'お仕事の進め方',scope:'global',scopeLabel:'全体',version:'2.0',required:true,body:'案件の受託、質問、初稿、修正、納品はすべてこのアプリで行います。',updatedAt:now()}];feature.schedules=[{id:user.uid,name:user.displayName,weekStart:demoDates[0],weekEnd:demoDates[6],days:demoDays,routineEnabled:false,routine:[],available:true,fromDate:demoDates[0],toDate:demoDates[6],hoursPerWeek:26,capacity:7,workType:'both',note:''}];feature.messages.set('demo-1',[{id:'m1',byUid:'manager',byName:'中村航汰',kind:'連絡',body:'不明点はこの案件チャットで聞いてください。',createdAt:now()-3600000}]);render();
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
  window.toggleAllAvailabilityDays=toggleAllAvailabilityDays;
  window.applyAvailabilityBulk=applyAvailabilityBulk;
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
