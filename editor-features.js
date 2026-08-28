(function(){
  'use strict';

  const PORTAL_APP_VERSION='20260828-16';
  const feature={
    board:[],catalog:[],manuals:[],schedules:[],release:null,
    messages:new Map(),messageUnsubs:new Map(),unsubs:[],startedFor:'',serverVersion:'',jobsListMode:'active',jobsTypeFilter:'all',lastSuggestionCode:''
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
  function accountItems(clientId){return(feature.catalog.find(x=>x.id===clientId)?.accounts||[]).filter(x=>x&&x.id&&x.name&&x.active!==false)}
  function validText(v,max){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=max}
  function notificationReadKey(){return`editor_notification_read_${user?.uid||'guest'}`}
  function notificationReadIds(){try{return new Set(JSON.parse(localStorage.getItem(notificationReadKey())||'[]'))}catch(_){return new Set()}}
  function saveNotificationReadIds(ids){try{localStorage.setItem(notificationReadKey(),JSON.stringify([...ids].slice(-1000)))}catch(_){}}
  function activeJob(job){return !['完了','キャンセル'].includes(job?.status)}
  function daysFromToday(value){if(!value)return null;return Math.round((dateAtNoon(value)-dateAtNoon(localDate()))/86400000)}
  function editorDeadlineExemptStatus(status){return isJobDeadlineExemptStatus(status)}
  function editorWorkIsOverdue(job,baseDate=localDate()){
    const deliveryDate=job?.deliveryDate||job?.deadline||'';
    return !!(deliveryDate&&deliveryDate<baseDate&&!editorDeadlineExemptStatus(job?.status));
  }
  function editorJobType(job){return['dispatch','haken','direct_client'].includes(String(job?.businessType||job?.source||''))?'dispatch':'agency'}
  function editorJobTypeLabel(job){return editorJobType(job)==='dispatch'?'編集者派遣':'編集代行'}
  function editorDeadline(job,baseDate=localDate()){
    const entries=[['編集者初稿',job?.editorDraftDate],['クライアント提出',job?.clientDraftDate],['納品',job?.deliveryDate||job?.deadline]].filter(([,date])=>!!date);
    if(!entries.length)return{label:'未設定',date:'',days:null};
    const future=entries.filter(([,date])=>date>=baseDate);
    const [label,date]=(future.length?future:entries.slice(-1)).sort((a,b)=>a[1].localeCompare(b[1]))[0];
    return{label,date,days:daysFromToday(date)};
  }
  function editorDeadlineLabel(job,baseDate=localDate()){
    const next=editorDeadline(job,baseDate);if(!next.date)return'次の締切：未設定';
    const d=dateAtNoon(next.date),weekday=WEEKDAY_LABELS[(d.getDay()+6)%7],exempt=next.days<0&&editorDeadlineExemptStatus(job?.status),relative=exempt?'期限経過・超過対象外':next.days<0?`${Math.abs(next.days)}日超過`:next.days===0?'本日':next.days===1?'明日':`あと${next.days}日`;
    return`次の締切：${next.label} ${next.date.slice(5).replace('-','/')}（${weekday}）・${relative}`;
  }
  function editorJobSortByDeadline(list){return[...list].sort((a,b)=>{const ad=editorDeadline(a).days,bd=editorDeadline(b).days,an=ad===null?Infinity:ad,bn=bd===null?Infinity:bd;return an-bn||byUpdated(a,b)})}
  function editorTimelineState(job){
    const workflow=editorWorkflow(job),order=['editing','director_review','client_submission','client_review','delivered'],current=Math.max(0,order.indexOf(workflow.stage)),cancelled=String(job?.status||'')==='キャンセル',workLabel=workflow.round>1?`第${workflow.round}回 修正作業`:'編集作業';
    return order.map((key,index)=>({key,label:[workLabel,'D確認','クライアント提出','クライアント確認','納品'][index],state:cancelled?'optional':index<current?'done':index===current?'current':'todo'}));
  }
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
      .notification-button{position:relative}.notification-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:#dc2626;color:#fff;font-size:9px;font-weight:900}.notification-list{display:flex;flex-direction:column;gap:7px}.notification-item{width:100%;display:flex;align-items:center;gap:10px;text-align:left;border:1px solid var(--border);border-left:3px solid var(--amber);border-radius:10px;background:var(--card);padding:10px;cursor:pointer}.notification-item:hover{background:var(--card2)}.notification-copy{flex:1;min-width:0}.notification-copy b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.notification-copy span{display:block;font-size:10.5px;color:var(--t2);margin-top:2px}.quick-draft{display:flex;align-items:end;gap:8px;margin:9px 0;padding:10px;border:1px solid #c4b5fd;border-radius:10px;background:#f5f3ff}.quick-draft .field{flex:1;margin:0}.quick-draft .btn{min-height:40px}
      .feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.feature-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
      .board-card{display:flex;flex-direction:column;gap:8px;border:2px solid #c4b5fd;box-shadow:0 6px 20px rgba(91,33,182,.10)}.board-card .actions{margin-top:auto}.claim-button{width:100%;min-height:52px;font-size:14px;background:linear-gradient(135deg,#7c3aed,#5b21b6)!important;box-shadow:0 7px 18px rgba(91,33,182,.25)}.claim-button:hover{transform:translateY(-1px)}.accept-howto{display:flex;align-items:flex-start;gap:10px;margin:10px 0 14px;padding:12px 14px;border:1px solid #c4b5fd;border-radius:11px;background:#f5f3ff;color:#4c1d95}.accept-howto b{display:block;font-size:12px}.accept-howto span{display:block;margin-top:2px;font-size:10.5px;color:#6d28d9;line-height:1.6}.scope-line{display:flex;gap:5px;flex-wrap:wrap}.scope-chip{display:inline-flex;padding:3px 7px;border-radius:7px;background:var(--card2);font-size:10px;color:var(--t2)}
      .message-thread{border-top:1px solid var(--border);margin-top:12px;padding-top:10px}.message{padding:8px 9px;margin:6px 0;border-radius:9px;background:var(--card2);font-size:11px}.message.mine{background:var(--purple2)}.message-head{display:flex;justify-content:space-between;gap:8px;color:var(--t3);font-size:9.5px;margin-bottom:3px}.message-body{white-space:pre-wrap;overflow-wrap:anywhere}
      .availability-card{border-left:3px solid var(--green)}.availability-card.unavailable{border-left-color:var(--t3)}.availability-hours{font-size:16px;font-weight:850;margin:4px 0}
      .availability-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:10px}.availability-day{min-width:0;border:1px solid var(--border);border-radius:11px;padding:10px;background:var(--card)}.availability-day-head{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:7px}.availability-day-head b{font-size:12px}.availability-day-head span{font-size:9px;color:var(--t3)}.availability-day .field{margin-top:6px}.availability-day label{font-size:9.5px}.availability-day input,.availability-day select,.availability-day textarea{min-width:0;padding:7px 8px;font-size:12px}.availability-day textarea{min-height:52px}.availability-time{display:grid;grid-template-columns:1fr 1fr;gap:5px}.availability-bulk{margin-bottom:10px;background:#f8fafc}.availability-bulk-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;align-items:end}.availability-bulk-days{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}.availability-bulk-days label{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:10.5px}.availability-bulk-days input,.availability-routine input{width:auto}.availability-routine{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding:10px;background:var(--purple2);border-radius:9px;font-size:11px}.team-day-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.team-day-chip{font-size:9.5px;padding:3px 6px;border-radius:6px;background:var(--card2);color:var(--t2)}.team-day-chip.on{background:#ecfdf5;color:#047857}.team-day-chip.consult{background:#fffbeb;color:#b45309}
      .manual-body{white-space:pre-wrap;font-size:12px;color:var(--t2);margin:9px 0}.manual-meta{font-size:10px;color:var(--t3)}
      .privacy-note{display:flex;gap:8px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:10px;font-size:11px;color:var(--t2)}
      .catalog-empty{border:1px dashed var(--border);border-radius:9px;padding:14px;color:var(--t2);font-size:11px}
      .job-list-tabs,.job-type-filters{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 10px}.job-list-tab{min-width:132px;justify-content:center;border:1.5px solid var(--border);background:var(--card);color:var(--t2)}.job-list-tab.active,.job-type-filter.active{border-color:#7c3aed;background:#f5f3ff;color:#5b21b6;box-shadow:0 3px 12px rgba(124,58,237,.13)}.job-list-tab .accept-count{margin-left:2px;background:#7c3aed}.job-list-tab:not(.active) .accept-count{background:#94a3b8}.job-type-filter{min-height:44px;padding:8px 12px;font-size:14px}.editor-job-list{display:grid;grid-template-columns:minmax(0,860px);justify-content:center;gap:12px}.editor-case-group{padding:0;border:2px solid #c4b5fd;overflow:hidden}.editor-case-group>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:70px;padding:13px 15px;cursor:pointer;background:#faf5ff}.editor-case-group>summary::-webkit-details-marker{display:none}.editor-case-group>summary b{display:block;font-size:16px;color:#312e81}.editor-case-group>summary small{display:block;margin-top:3px;color:var(--t2);font-size:12px}.editor-case-group-count{white-space:nowrap;padding:5px 8px;border-radius:99px;background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:850}.editor-case-group-body{display:grid;gap:10px;padding:12px}.editor-case-group-body .editor-job-card{box-shadow:none}.editor-workflow-hint{padding:0 14px 12px;color:var(--t3);font-size:10px}.editor-job-card{border-color:#ddd6fe}.editor-job-card .job-meta{font-size:14px}.job-urgent-note{margin:10px 0;padding:10px;border-radius:9px;background:#fff7ed;border-left:3px solid #f59e0b;font-size:14px;color:#92400e}.job-urgent-note.danger{background:#fef2f2;border-left-color:#dc2626;color:#991b1b}.deadline-summary{margin:10px 0;padding:10px 12px;border-radius:9px;background:#f8fafc;font-size:14px;font-weight:800;color:#334155}.deadline-summary.overdue{background:#fef2f2;color:#b91c1c}.editor-timeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin:12px 0}.editor-timeline-step{position:relative;min-width:0;padding:25px 8px 0;text-align:center;color:var(--t3)}.editor-timeline-step:before{content:'';position:absolute;z-index:2;left:50%;top:4px;width:9px;height:9px;transform:translateX(-50%);border:2px solid #cbd5e1;border-radius:50%;background:#fff}.editor-timeline-step:not(:last-child):after{content:'';position:absolute;z-index:1;left:50%;right:-50%;top:9px;height:2px;background:#e2e8f0}.editor-timeline-step.done{color:#047857}.editor-timeline-step.done:before{border-color:#10b981;background:#10b981}.editor-timeline-step.done:after{background:#86efac}.editor-timeline-step.current{color:#5b21b6;font-weight:800}.editor-timeline-step.current:before{border-color:#7c3aed;background:#f5f3ff}.editor-timeline-step.optional{color:#64748b}.editor-timeline-step.optional:before{border-style:dashed}.editor-timeline-step b{display:block;font-size:12px;line-height:1.35}.editor-timeline-step span{display:block;margin-top:3px;font-size:11px;line-height:1.45;overflow-wrap:anywhere}.job-next-action{margin:11px 0 0;font-size:14px}.job-waiting{margin-top:10px;padding:10px 12px;border-radius:9px;background:#fffbeb;color:#92400e;font-size:14px}.job-submit-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px;margin-top:10px;padding:10px;border:1px solid #c4b5fd;border-radius:10px;background:#faf5ff}.job-submit-panel .field{margin:0}.job-submit-panel .btn{min-height:44px}.dispatch-create{margin-top:18px}.dispatch-create summary{min-height:52px;display:flex;align-items:center;cursor:pointer;font-weight:850;color:#5b21b6;font-size:14px}.dispatch-create[open] summary{border-bottom:1px solid var(--border);margin-bottom:12px}.dispatch-create summary::-webkit-details-marker{display:none}.board-card details{margin-top:3px;border-top:1px solid var(--border);padding-top:8px}.board-card summary{min-height:44px;display:flex;align-items:center;color:#5b21b6;font-size:14px;font-weight:800;cursor:pointer}.board-card .claim-button{margin-top:8px}.editor-job-card details summary:focus-visible,.editor-case-group>summary:focus-visible,.board-card summary:focus-visible,.job-list-tab:focus-visible,.job-type-filter:focus-visible,.claim-button:focus-visible{outline:3px solid rgba(124,58,237,.35);outline-offset:2px}
      .editor-nav-desktop{position:relative;overflow:visible;flex-wrap:wrap}.editor-nav-more{position:relative}.editor-nav-more summary{list-style:none}.editor-nav-more summary::-webkit-details-marker{display:none}.editor-nav-more-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:90;display:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;width:min(340px,calc(100vw - 36px));padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 18px 48px rgba(15,23,42,.18)}.editor-nav-more[open]>.editor-nav-more-menu{display:grid}.editor-nav-more-menu .btn{width:100%;min-width:0;min-height:44px;justify-content:flex-start;padding:9px 11px;text-align:left;white-space:normal;line-height:1.35}.editor-nav-mobile{display:none}.editor-primary-action{border:2px solid #7c3aed;background:#faf5ff}.editor-primary-action .actions{margin-top:10px}.editor-next-child{display:block;margin-top:4px;font-size:12px;color:#5b21b6;font-weight:750}.editor-case-group>summary>span:first-child{min-width:0}.editor-case-group>summary b,.editor-case-group>summary small{overflow-wrap:anywhere}
      @media(max-width:980px){.availability-calendar{grid-template-columns:repeat(2,minmax(0,1fr))}.availability-bulk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){.editor-nav-desktop{display:none}.editor-nav-mobile{position:fixed;left:0;right:0;bottom:0;z-index:80;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:4px;margin:0;padding:7px 5px calc(7px + env(safe-area-inset-bottom));border-top:1px solid var(--border);background:rgba(255,255,255,.96);box-shadow:0 -5px 20px rgba(15,23,42,.12);backdrop-filter:blur(14px)}.editor-nav-mobile .btn{min-width:0;min-height:44px;padding:5px 3px;font-size:10px;line-height:1.2}.editor-nav-mobile .btn.active{background:#ede9fe;color:#5b21b6}.editor-nav-more{position:static;display:flex;align-items:stretch}.editor-nav-more summary{display:flex;align-items:center;justify-content:center;width:100%;min-height:44px;padding:5px 3px;border:1px solid var(--border);border-radius:9px;font-size:10px;text-align:center;cursor:pointer}.editor-nav-more-menu{position:fixed;top:auto;right:12px;bottom:calc(66px + env(safe-area-inset-bottom));left:12px;z-index:95;width:auto;max-height:min(62dvh,460px);grid-template-columns:repeat(2,minmax(0,1fr));overflow-y:auto;padding:12px}.editor-nav-more-menu .btn{min-height:52px;padding:11px 12px;font-size:14px}.feature-grid,.feature-grid.two,.availability-calendar,.availability-bulk-grid{grid-template-columns:1fr}.update-banner{top:65px;align-items:flex-start;flex-wrap:wrap}.update-banner .btn{width:auto}.availability-day{display:grid;grid-template-columns:70px minmax(0,1fr);gap:7px}.availability-day-head{display:block}.availability-day>.field,.availability-day>.availability-time{margin-top:0}.availability-day .field.full{grid-column:1/-1}.editor-timeline{grid-template-columns:1fr;gap:0}.editor-timeline-step{min-height:44px;padding:7px 5px 9px 32px;text-align:left}.editor-timeline-step:before{left:8px;top:11px;transform:none}.editor-timeline-step:not(:last-child):after{left:13px;right:auto;top:23px;width:2px;height:calc(100% - 7px)}.editor-timeline-step b,.editor-timeline-step span{display:inline;font-size:12px;line-height:1.5}.editor-timeline-step span{margin:0 0 0 7px}.job-list-tab{flex:1;min-width:0}.job-type-filter{flex:1;min-width:0}.job-submit-panel{grid-template-columns:1fr}.job-submit-panel .btn{width:100%}.dispatch-create summary{font-size:14px}}
      @media(max-width:420px){.editor-case-group>summary{align-items:flex-start;flex-direction:column}.editor-case-group-count{white-space:normal;max-width:100%}.notification-copy b,.notification-copy span{overflow-wrap:anywhere;white-space:normal}.editor-nav-mobile .btn{font-size:9px}}
      @media(pointer:coarse){.editor-job-card .btn.small,.notification-item,.editor-nav-more summary{min-height:44px}}
    `;document.head.appendChild(style);
  }

  function updateAccountOptions(){
    const client=$('#new-client-id'),account=$('#new-account-id');if(!client||!account)return;
    const selected=account.dataset.selected||account.value||'';
    account.innerHTML='<option value="">アカウントを選択</option>'+accountItems(client.value).map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('');
    account.dataset.selected='';saveCaseDraft();
  }

  function navHtmlExtended(){
    const items=[['dashboard','ホーム'],['jobs','担当案件'],['board','案件を探す'],['notifications','通知'],['schedule','スケジュール'],['manuals','マニュアル'],['invoices',isExternal()?'支払い案内':'請求書'],['settings','登録情報'],['guide','使い方ガイド'],['suggestion','匿名目安箱']];
    const desktop=[['dashboard','ホーム'],['jobs','担当案件'],['board','案件を探す'],['notifications','通知']];
    const mobile=[['dashboard','ホーム'],['jobs','案件'],['board','探す'],['notifications','通知']];
    const open=feature.board.filter(x=>x.status==='open').length;
    const noticeCount=notificationItems().length;
    const button=([k,l])=>`<button type="button" class="btn ${k==='board'?'accept-entry ':''}${k==='notifications'?'notification-button ':''}${view===k?'active':''}" aria-current="${view===k?'page':'false'}" onclick="setView('${k}')">${l}${k==='board'&&open?` <span class="accept-count" aria-label="公開案件 ${open}件">${open}</span>`:''}${k==='notifications'&&noticeCount?` <span class="notification-count" aria-label="未対応通知 ${noticeCount}件">${noticeCount}</span>`:''}</button>`;
    const more=items.filter(([k])=>!mobile.some(([primary])=>primary===k));
    const moreMenu=`<details class="editor-nav-more"><summary class="btn ${more.some(([k])=>view===k)?'active':''}" aria-label="その他のメニューを開く">その他</summary><div class="editor-nav-more-menu">${more.map(button).join('')}</div></details>`;
    return`<nav class="nav editor-nav-desktop" aria-label="編集者メニュー">${desktop.map(button).join('')}${moreMenu}</nav><nav class="editor-nav-mobile" aria-label="編集者メニュー（モバイル）">${mobile.map(button).join('')}${moreMenu}</nav>`;
  }

  function dashboardExtended(){
    const active=jobs.filter(activeJob),overdue=active.filter(j=>editorWorkIsOverdue(j)),review=active.filter(j=>['初稿提出済み','修正稿提出済み','D確認OK','初稿完成','確認待ち','修正中','FB待ち'].includes(j.status)),payable=activeAuthorization(new Date().toISOString().slice(0,7))?.jobIds?.length||0,priority=editorJobSortByDeadline([...overdue,...active.filter(j=>j.blocker)].filter((j,i,a)=>a.findIndex(x=>x.id===j.id)===i)).slice(0,6);
    const next=editorJobSortByDeadline([...overdue,...active.filter(j=>j.blocker),...active]).find(Boolean);
    const nextAction=next?`<section class="card editor-primary-action"><div class="section-title"><h2>今日、次にすること</h2><span>${esc(editorDeadlineLabel(next))}</span></div><b>${esc(editorNotificationTitle(next))}</b><div class="muted">${esc(editorWaitMessage(next)||nextEditorJobAction(next)?.[1]||'案件の詳細を確認してください。')}</div><div class="actions"><button class="btn primary" type="button" data-preview-safe onclick="openEditorJob('${esc(next.id)}')">この案件を開く</button></div></section>`:`<section class="card editor-primary-action"><div class="section-title"><h2>今日、次にすること</h2></div><b>進行中の案件はありません</b><div class="actions"><button class="btn primary" type="button" data-preview-safe onclick="setView('board')">案件を探す</button></div></section>`;
    const billingMetric=isExternal()?'<div class="card metric"><span>契約・支払い</span><b style="font-size:14px">ディレクター管理</b></div>':`<div class="card metric"><span>今月の請求候補</span><b>${payable}</b></div>`;
    const base=`${pageHead('ホーム','今日、対応することを確認')} ${nextAction}<div class="grid"><div class="card metric"><span>進行中</span><b>${active.length}</b></div><div class="card metric"><span>期限超過</span><b style="color:var(--red)">${overdue.length}</b></div><div class="card metric"><span>確認・修正</span><b>${review.length}</b></div>${billingMetric}</div><section class="section"><div class="section-title"><h2>優先して確認する案件</h2><span>期限が近い案件・確認が必要な案件</span></div><div class="editor-job-list">${editorGroupJobs(priority).map(group=>editorGroupHtml(group,'priority')).join('')||'<div class="card empty">優先して確認する案件はありません</div>'}</div></section>`;
    const open=feature.board.filter(x=>x.status==='open').length;
    const availability=feature.schedules.find(x=>x.id===portalUid());
    const intro=`<details class="section"><summary class="muted" style="cursor:pointer">初めて使う方へ</summary><div class="feature-grid two" style="margin-top:8px"><div class="card notice"><b>${isExternal()?'外部編集者':'mono.create 直接契約編集者'}</b><div class="muted">${isExternal()?'担当ディレクターから依頼された案件と、その案件の連絡だけを表示します。単価・請求額・利益は表示しません。':'クライアントへの請求額・利益・他の編集者の報酬は表示しません。'}</div><button class="btn small" type="button" onclick="setView('guide')">使い方ガイドを開く</button></div><div class="card"><div class="muted">応募できる編集代行案件</div><b style="font-size:24px">${open}</b><div class="muted">${availability?.available?`編集できる期間 ${esc(availability.fromDate||'')} 〜 ${esc(availability.toDate||'')}`:'スケジュールは未登録です'}</div></div></div></details>`;
    return base+intro;
  }

  function jobFormExtended(){
    const d=readCaseDraft(),sharedDate=Object.prototype.hasOwnProperty.call(d,'sharedDate')?d.sharedDate:localDate(),deliveryDate=d.deliveryDate||d.deadline||'',catalog=feature.catalog.filter(x=>x.active!==false),accounts=accountItems(d.clientId||'');
    if(!catalog.length){const guidance=isExternal()?'担当ディレクターまたはオーナーが、この編集者へクライアントとアカウントを共有すると表示されます。':'オーナーがクライアントとアカウントを登録・同期すると、ここから「編集者派遣」の案件を追加できます。';return`<div class="card catalog-empty"><b>案件登録用のクライアントがまだ共有されていません。</b><div>${guidance}</div></div>`;}
    return`<details class="card dispatch-create"><summary>＋ 編集者派遣の案件を追加</summary><p class="muted">派遣先クライアントから直接届いた案件だけを登録します。上の「案件を探す」で受ける編集代行案件は、ここには入力しません。</p><div class="form-grid" oninput="saveCaseDraft()" onchange="saveCaseDraft()"><div class="field"><label for="new-client-id">クライアント *</label><select id="new-client-id" onchange="updateAccountOptions()"><option value="">クライアントを選択</option>${catalog.map(x=>`<option value="${esc(x.id)}" ${x.id===d.clientId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label for="new-account-id">アカウント名 *</label><select id="new-account-id" data-selected="${esc(d.accountId||'')}"><option value="">アカウントを選択</option>${accounts.map(x=>`<option value="${esc(x.id)}" ${x.id===d.accountId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field full"><label for="new-case">案件・バッチ名</label><input id="new-case" maxlength="120" value="${esc(d.caseName||'')}" placeholder="例：2026年9月分"></div><div class="field"><label for="new-title">個別動画・案件名 *</label><input id="new-title" maxlength="120" value="${esc(d.title||'')}" placeholder="例：ショート動画 03"></div><div class="field"><label for="new-shared">受注日</label><input id="new-shared" type="date" value="${esc(sharedDate)}"></div><div class="field"><label for="new-deadline">納品日 *</label><input id="new-deadline" type="date" value="${esc(deliveryDate)}"></div><details class="optional-box"><summary>初稿日など詳しい日程を入力</summary><div class="form-grid" style="margin-top:8px"><div class="field"><label for="new-editor-draft">編集者 初稿</label><input id="new-editor-draft" type="date" value="${esc(d.editorDraftDate||'')}"></div><div class="field"><label for="new-client-draft">クライアント提出 初稿</label><input id="new-client-draft" type="date" value="${esc(d.clientDraftDate||'')}"></div><div class="field"><label for="new-thumbnail">サムネイル納品日</label><input id="new-thumbnail" type="date" value="${esc(d.thumbnailDate||'')}"></div></div></details><div class="field"><label class="check"><input id="new-urgent" type="checkbox" ${d.urgent?'checked':''}> 緊急案件として登録</label></div><div class="field"><label for="new-request">依頼内容URL</label><input id="new-request" type="url" value="${esc(d.requestUrl||'')}" placeholder="https://"></div><div class="field"><label for="new-source">素材URL</label><input id="new-source" type="url" value="${esc(d.sourceUrl||'')}" placeholder="https://"></div><div class="field full"><label for="new-instructions">依頼内容・編集指示 *</label><textarea id="new-instructions" maxlength="3000">${esc(d.instructions||'')}</textarea></div></div><div class="actions"><button class="btn primary job-primary" type="button" onclick="createJob()">編集者派遣に案件を登録</button></div></details>`;
  }

  function editorJobBucket(job){return['完了','キャンセル'].includes(String(job?.status||''))?'completed':'active'}
  function editorGroupText(value){return String(value||'').normalize('NFKC').replace(/[\s\u3000]+/g,' ').trim()}
  function editorWorkflow(job){
    const raw=job?.workflow&&typeof job.workflow==='object'?job.workflow:{},status=String(job?.status||''),stage=['editing','director_review','client_submission','client_review','delivered'].includes(raw.stage)?raw.stage:(status==='完了'?'delivered':['初稿提出済み','修正稿提出済み','FB待ち'].includes(status)?'director_review':status==='D確認OK'?'client_submission':status==='確認待ち'?'client_review':'editing');
    return{round:Math.max(1,Number(raw.round)||1),stage,progressEvents:Array.isArray(job?.progressEvents)?job.progressEvents:[]};
  }
  function editorWorkflowLabel(stage,status=''){if(status==='FB待ち')return'mono.create FB中';if(status==='確認待ち')return'先方確認中';if(status==='修正中')return'修正中';return({editing:'編集作業中',director_review:'D確認待ち',client_submission:'先方へ提出中',client_review:'先方確認中',delivered:'納品完了'})[stage]||'編集作業中'}
  function editorWaitMessage(job){const status=String(job?.status||'');if(status==='FB待ち')return'mono.create FB中です。確認・修正指示をお待ちください。';if(status==='確認待ち')return'先方確認中です。修正指示またはOKの連絡をお待ちください。';return({director_review:'D確認待ちです。ディレクターが確認します。',client_submission:'ディレクターが先方へ提出中です。',client_review:'先方確認中です。修正指示またはOKの連絡をお待ちください。',delivered:'納品完了です。編集者側の操作はありません。'})[editorWorkflow(job).stage]||''}
  function editorAllowedStatuses(job){
    if(editorWorkflow(job).stage!=='editing')return[String(job?.status||'')].filter(Boolean);
    const current=String(job?.status||''),allowed={未着手:['未着手','進行中'],受注済み:['受注済み','進行中'],進行中:['進行中','初稿提出済み'],編集者進行中:['編集者進行中','初稿提出済み'],初稿完成:['初稿完成','初稿提出済み'],修正中:['修正中','修正稿提出済み']}[current];
    return allowed||[current].filter(Boolean);
  }
  function editorJobParent(job){
    const explicit=editorGroupText(job?.parentCaseId||job?.linkedLegacyJobId||job?.parentJobId||job?.caseId).replace(/^legacy:/,'');
    const caseName=editorGroupText(job?.parentCaseName||job?.caseName),client=editorGroupText(job?.clientId||job?.clientDisplay),account=editorGroupText(job?.accountId||job?.accountDisplay),type=editorJobType(job);
    if(explicit)return{key:`id:${explicit}`,title:caseName||editorGroupText(job?.parentCaseName)||editorGroupText(job?.title)||'親案件',client:editorGroupText(job?.clientDisplay),account:editorGroupText(job?.accountDisplay)};
    if(caseName)return{key:`case:${type}|${client}|${account}|${caseName}`,title:caseName,client:editorGroupText(job?.clientDisplay),account:editorGroupText(job?.accountDisplay)};
    return{key:`job:${String(job?.id||'')}`,title:editorGroupText(job?.title)||'案件名未設定',client:editorGroupText(job?.clientDisplay),account:editorGroupText(job?.accountDisplay)};
  }
  function editorGroupJobs(list){
    const map=new Map();list.forEach(job=>{const parent=editorJobParent(job),group=map.get(parent.key)||{...parent,jobs:[]};group.jobs.push(job);map.set(parent.key,group)});
    return [...map.values()].map(group=>({...group,jobs:editorJobSortByDeadline(group.jobs)})).sort((a,b)=>editorJobSortByDeadline(a.jobs)[0]&&editorJobSortByDeadline(b.jobs)[0]?editorJobSortByDeadline(a.jobs)[0].id.localeCompare(editorJobSortByDeadline(b.jobs)[0].id):0);
  }
  function editorGroupSummary(group){
    const statuses=group.jobs.map(x=>String(x.status||'')),review=statuses.filter(x=>['初稿提出済み','修正稿提出済み','D確認OK','確認待ち','初稿完成','修正中','FB待ち'].includes(x)).length,overdue=group.jobs.filter(editorWorkIsOverdue).length,parts=[`子案件 ${group.jobs.length}件`];
    if(review)parts.push(`確認・修正 ${review}件`);if(overdue)parts.push(`期限超過 ${overdue}件`);return parts.join(' ・ ');
  }
  function editorGroupNext(group){
    const job=editorJobSortByDeadline(group.jobs)[0];
    if(!job)return'';
    return `${editorNotificationTitle(job)} ・ ${editorWaitMessage(job)||editorDeadlineLabel(job)}`;
  }
  function editorNotificationTitle(job){const parent=editorJobParent(job),child=editorGroupText(job?.title)||'担当案件';return parent.title===child?child:`${parent.title} ／ ${child}`}
  function editorGroupHtml(group,kind='jobs'){
    const workflow=editorWorkflow(group.jobs[0]),meta=[group.client,group.account].filter(Boolean).join(' / '),summary=editorGroupSummary(group);
    return`<details id="editor-case-${esc(group.key)}" data-case-key="${esc(group.key)}" class="card editor-case-group"><summary aria-label="親案件 ${esc(group.title)} を開く"><span><b>${esc(group.title)}</b><small>${esc(meta||'クライアント・アカウント未設定')}</small><span class="editor-next-child">次：${esc(editorGroupNext(group))}</span></span><span class="editor-case-group-count">${esc(summary)}</span></summary><div class="editor-case-group-body">${group.jobs.map(jobCard).join('')}</div><div class="editor-workflow-hint">現在の進捗：${esc(editorWorkflowLabel(workflow.stage,group.jobs[0]?.status))} / ${workflow.round}回目</div></details>`;
  }
  function setEditorJobsListMode(mode){feature.jobsListMode=mode==='completed'?'completed':'active';render()}
  function setEditorJobsTypeFilter(type){feature.jobsTypeFilter=['all','agency','dispatch'].includes(type)?type:'all';render()}
  function jobsExtended(){
    const active=jobs.filter(j=>editorJobBucket(j)==='active'),completed=jobs.filter(j=>editorJobBucket(j)==='completed'),showCompleted=feature.jobsListMode==='completed',source=showCompleted?completed:active,visible=source.filter(j=>feature.jobsTypeFilter==='all'||editorJobType(j)===feature.jobsTypeFilter),ordered=showCompleted?sortNewest(visible):editorJobSortByDeadline(visible);
    const empty=showCompleted
      ?'<div class="card empty"><b>完了済みの担当案件は0件です</b><br><span class="muted">案件を納品完了にすると、ここへ移動します。</span></div>'
      :'<div class="card empty"><b>進行中の担当案件はありません</b><br><span class="muted">編集代行は「案件を探す」から受けると表示されます。編集者派遣の案件は、この画面から登録できます。</span></div>';
    return`${pageHead('担当案件','親案件を開くと、担当している子案件を確認・更新できます。')}<section class="section"><div class="section-title"><h2>${showCompleted?'完了した案件':'進行中の案件'}</h2><span>${visible.length}件</span></div><div class="job-list-tabs" role="tablist" aria-label="担当案件の表示切り替え"><button type="button" data-preview-safe class="btn job-list-tab ${showCompleted?'':'active'}" role="tab" aria-selected="${!showCompleted}" aria-current="${!showCompleted?'page':'false'}" onclick="setEditorJobsListMode('active')">進行中 <span class="accept-count">${active.length}</span></button><button type="button" data-preview-safe class="btn job-list-tab ${showCompleted?'active':''}" role="tab" aria-selected="${showCompleted}" aria-current="${showCompleted?'page':'false'}" onclick="setEditorJobsListMode('completed')">完了 <span class="accept-count">${completed.length}</span></button></div><div class="job-type-filters" aria-label="案件種別で絞り込み"><button type="button" data-preview-safe class="btn job-type-filter ${feature.jobsTypeFilter==='all'?'active':''}" aria-pressed="${feature.jobsTypeFilter==='all'}" onclick="setEditorJobsTypeFilter('all')">すべて</button><button type="button" data-preview-safe class="btn job-type-filter ${feature.jobsTypeFilter==='agency'?'active':''}" aria-pressed="${feature.jobsTypeFilter==='agency'}" onclick="setEditorJobsTypeFilter('agency')">編集代行</button><button type="button" data-preview-safe class="btn job-type-filter ${feature.jobsTypeFilter==='dispatch'?'active':''}" aria-pressed="${feature.jobsTypeFilter==='dispatch'}" onclick="setEditorJobsTypeFilter('dispatch')">編集者派遣</button></div><div class="editor-job-list">${editorGroupJobs(ordered).map(group=>editorGroupHtml(group)).join('')||empty}</div></section>${jobFormExtended()}`;
  }

  function boardHtml(){
    const list=feature.board.filter(x=>x.status==='open').sort(byUpdated).map(x=>({...x,clientDisplay:x.clientDisplay||x.clientName||'',accountDisplay:x.accountDisplay||x.accountName||'',businessType:'edit_agency'}));
    const empty=`<div class="card empty"><b>現在、募集中の編集代行案件はありません</b><br><span class="muted">ここに出るのは、管理者が募集を開始した案件だけです。すでに担当している案件は「担当案件」で確認できます。</span><div class="actions" style="justify-content:center"><button class="btn primary" type="button" onclick="setView('jobs')">担当案件を開く</button></div></div>`;
    const previewNote=ADMIN_PREVIEW?'<div class="privacy-note"><b>オーナーの確認画面</b><span>このページは「募集中の案件」だけを表示します。登録済みの案件全体は、管理画面の「編集代行案件」で確認してください。</span></div>':'';
    return`${pageHead('募集中の案件','管理者が募集を開始した編集代行案件を表示します。')}<div class="accept-howto"><span style="font-size:20px">✅</span><div><b>日程と内容を確認してから、最後の紫ボタンで受けてください</b><span>「この案件を受ける」を押すと、担当案件へ自動で移動します。</span></div></div>${previewNote}<div class="privacy-note"><b>この画面に出る案件</b><span>${isExternal()?'担当ディレクターが募集した案件だけです。':'全員向けに公開された案件と、あなた宛ての案件だけです。'} クライアントへの請求額と利益は表示しません。</span></div><section class="section"><div class="editor-job-list">${editorGroupJobs(list).map(group=>`<details class="card editor-case-group"><summary><span><b>${esc(group.title)}</b><small>${esc([group.client,group.account].filter(Boolean).join(' / ')||'クライアント・アカウント未設定')}</small></span><span class="editor-case-group-count">募集中 ${group.jobs.length}件</span></summary><div class="editor-case-group-body">${group.jobs.map(x=>{const requested=x.audience==='designated'||Array.isArray(x.eligibleUids)&&x.eligibleUids.length===1;return`<article class="card board-card"><div class="job-top"><div><div class="job-title">${esc(x.title||'案件名未設定')}</div><div class="job-meta">初稿 ${esc(x.editorDraftDate||'未設定')} / 納品 ${esc(x.deliveryDate||'未設定')}</div></div>${requested?'<span class="pill red">編集リクエスト</span>':x.urgent?'<span class="pill red">緊急</span>':'<span class="pill">募集中</span>'}</div><details><summary>日程・案件内容を確認する</summary><div class="job-body">${esc(x.summary||x.instructions||'案件内容は未設定です。')}</div>${x.instructions&&x.summary?`<div class="muted">${esc(x.instructions)}</div>`:''}</details><button class="btn primary claim-button" type="button" onclick="claimBoardJob('${esc(x.id)}')">✓ この案件を受ける</button></article>`}).join('')}</div></details>`).join('')||empty}</div></section>`;
  }

  function scheduleHtml(){
    const mine=feature.schedules.find(x=>x.id===portalUid())||{},days=scheduleDaysForWeek(mine),start=days[0].date,end=days[6].date;
    const dayCards=days.map((d,i)=>`<article class="availability-day"><div class="availability-day-head"><b>${WEEKDAY_LABELS[i]}曜日</b><span>${esc(d.date.slice(5).replace('-','/'))}</span></div><div class="field"><label for="av-status-${i}">対応</label><select id="av-status-${i}"><option value="available" ${d.status==='available'?'selected':''}>編集可能</option><option value="consult" ${d.status==='consult'?'selected':''}>要相談</option><option value="unavailable" ${d.status==='unavailable'?'selected':''}>不可</option></select></div><div class="availability-time"><div class="field"><label for="av-start-${i}">開始</label><input id="av-start-${i}" type="time" value="${esc(d.startTime)}"></div><div class="field"><label for="av-end-${i}">終了</label><input id="av-end-${i}" type="time" value="${esc(d.endTime)}"></div></div><div class="field"><label for="av-capacity-${i}">受託可能本数</label><input id="av-capacity-${i}" type="number" min="0" max="20" value="${Number(d.capacity||0)}"></div><div class="field"><label for="av-type-${i}">案件種別</label><select id="av-type-${i}"><option value="both" ${d.workType==='both'?'selected':''}>両方</option><option value="short" ${d.workType==='short'?'selected':''}>ショート</option><option value="long" ${d.workType==='long'?'selected':''}>ロング</option></select></div><div class="field full"><label for="av-note-${i}">業務上の補足</label><textarea id="av-note-${i}" maxlength="80" placeholder="例：18時以降">${esc(d.note)}</textarea></div></article>`).join('');
    const team=feature.schedules.slice().sort((a,b)=>String(a.name||'').localeCompare(String(b.name||''))).map(x=>{const xd=scheduleDaysForWeek(x),open=xd.filter(d=>d.status!=='unavailable'),capacity=open.reduce((n,d)=>n+Number(d.capacity||0),0);return`<article class="card availability-card ${open.length?'':'unavailable'}"><b>${esc(x.name||'編集者')}</b><div class="availability-hours">${open.length?`${open.length}日 / ${capacity}本`:'今週は受託不可'}</div><div class="muted">${esc(start)} 〜 ${esc(end)}</div><div class="team-day-chips">${xd.map((d,i)=>`<span class="team-day-chip ${d.status==='available'?'on':d.status==='consult'?'consult':''}">${WEEKDAY_LABELS[i]} ${statusLabel(d.status)}${d.capacity?` ${Number(d.capacity)}本`:''}</span>`).join('')}</div></article>`}).join('');
    return`${pageHead('編集可能スケジュール',`今週の1週間（${start} 〜 ${end}）だけを入力`)}<div class="card availability-bulk"><b>一括登録</b><div class="muted">曜日を選び、同じ内容をまとめて反映できます。</div><div class="availability-bulk-days">${WEEKDAY_LABELS.map((label,i)=>`<label><input class="av-bulk-day" type="checkbox" value="${i}" checked> ${label}</label>`).join('')}</div><div class="availability-bulk-grid"><div class="field"><label for="av-bulk-status">対応</label><select id="av-bulk-status"><option value="available">編集可能</option><option value="consult">要相談</option><option value="unavailable">不可</option></select></div><div class="field"><label for="av-bulk-start">開始</label><input id="av-bulk-start" type="time"></div><div class="field"><label for="av-bulk-end">終了</label><input id="av-bulk-end" type="time"></div><div class="field"><label for="av-bulk-capacity">本数</label><input id="av-bulk-capacity" type="number" min="0" max="20" value="0"></div><div class="field"><label for="av-bulk-type">種別</label><select id="av-bulk-type"><option value="both">両方</option><option value="short">ショート</option><option value="long">ロング</option></select></div><div class="field"><label for="av-bulk-note">補足</label><input id="av-bulk-note" maxlength="80" placeholder="例：18時以降"></div></div><div class="actions"><button class="btn small" type="button" onclick="toggleAllAvailabilityDays(true)">7日すべて選択</button><button class="btn primary small" type="button" onclick="applyAvailabilityBulk()">選んだ日に反映</button></div></div><div class="availability-calendar">${dayCards}</div><label class="availability-routine"><input id="av-routine" type="checkbox" ${mine.routineEnabled?'checked':''}><span><b>毎週のルーティンとして保存</b><br>次週以降は同じ曜日・時間・本数を自動入力します。変更がある週だけ直せます。</span></label><div class="actions"><button class="btn primary" type="button" onclick="saveAvailability()">今週の1週間を保存</button></div><div class="card notice" style="margin-top:10px"><b>入力しない情報</b><p class="muted">他の編集者も閲覧できるため、通院・家族・私用などプライベートな理由は入力しないでください。</p></div><section class="section"><div class="section-title"><h2>チームの今週の稼働目安</h2><span>${feature.schedules.length}名</span></div><div class="feature-grid">${team||'<div class="card empty">スケジュールはまだありません</div>'}</div></section>`;
  }

  function manualsHtml(){
    return`${pageHead('マニュアル保管庫','全体・クライアント・アカウント別に表示')}<div class="feature-grid two">${feature.manuals.sort(byUpdated).map(x=>{const u=safeUrl(x.url||'');return`<article class="card"><div class="job-top"><div><b>${esc(x.title||'')}</b><div class="manual-meta">${esc(x.scopeLabel||x.scope||'全体')} ・ version ${esc(x.version||'1')}</div></div><span class="pill">${x.required?'必読':'参考'}</span></div>${x.body?`<div class="manual-body">${esc(x.body)}</div>`:''}<div class="actions">${u?`<a class="btn small" href="${esc(u)}" target="_blank" rel="noopener">マニュアルを開く</a>`:''}<button class="btn primary small" onclick="markManualRead('${esc(x.id)}','${esc(String(x.version||'1'))}')">読了を記録</button></div></article>`}).join('')||'<div class="card empty">表示できるマニュアルはありません</div>'}</div>`;
  }

  function suggestionHtml(){
    const issued=feature.lastSuggestionCode?`<div class="card notice" style="margin-top:10px" role="status"><b>返信コードを控えてください</b><p class="muted">管理者からの匿名返信を確認するときに使います。あなたの氏名は記録しません。</p><div class="actions"><input id="sg-issued-code" readonly value="${esc(feature.lastSuggestionCode)}" aria-label="発行した返信コード"><button class="btn small" onclick="copySuggestionCode()">コードをコピー</button></div></div>`:'';
    return`${pageHead('匿名目安箱','氏名・メールアドレスを記録せずに、意見を送れます')}<div class="split"><div><div class="card"><div class="field"><label for="sg-category">種類</label><select id="sg-category"><option>業務改善</option><option>人間関係・ハラスメント</option><option>報酬・契約</option><option>アプリの不具合</option><option>その他</option></select></div><div class="field" style="margin-top:10px"><label for="sg-message">内容 *</label><textarea id="sg-message" maxlength="2000" placeholder="困っていることや、改善してほしいことを入力"></textarea></div><label class="check" style="margin-top:10px"><input id="sg-reply" type="checkbox" checked> 匿名で返信を受け取るためのコードを発行する</label><div class="actions"><button class="btn primary" onclick="submitSuggestion()">匿名で送信</button></div></div>${issued}</div><div><div class="card privacy-note"><b>匿名で送れます</b><span>ログインは不正利用を防ぐためだけに使います。投稿の内容には、あなたを特定する情報を保存しません。</span></div><div class="card" style="margin-top:10px"><b>管理者からの返信を確認</b><div class="field" style="margin-top:8px"><input id="sg-code" maxlength="32" placeholder="返信コード"></div><div class="actions"><button class="btn small" onclick="checkSuggestionReply()">返信を確認</button></div><div id="sg-reply-result" class="muted"></div></div></div></div>`;
  }

  function notificationItems(){
    const read=notificationReadIds(),items=[];
    feature.board.filter(x=>x.status==='open').forEach(x=>{const id=`board:${x.id}`;if(!read.has(id)){const requested=x.audience==='designated'||Array.isArray(x.eligibleUids)&&x.eligibleUids.length===1;items.push({id,kind:'board',target:'board',jobId:x.id,icon:requested?'🎯':'📣',title:x.title||'新しい募集案件',detail:`${requested?'あなたへの編集リクエスト ・ ':''}${x.clientName||''} ${x.editorDraftDate?`・初稿 ${x.editorDraftDate}`:''}`,timing:requested?'リクエスト':'新着',persistent:false})}});
    jobs.filter(activeJob).forEach(j=>{
      if(!j.editorDraftDate)items.push({id:`draft-missing:${j.id}`,kind:'required',target:'jobs',jobId:j.id,icon:'✏️',title:editorNotificationTitle(j),detail:'編集者初稿日を設定してください',timing:'要設定',persistent:true});
      [['editorDraftDate','編集者初稿','✏️'],['clientDraftDate','クライアント初稿','📋'],['deliveryDate','納期','📅']].forEach(([key,label,icon])=>{const value=j[key]||(key==='deliveryDate'?j.deadline:'');const days=daysFromToday(value);if(days===null||days>3||(days<0&&editorDeadlineExemptStatus(j.status)))return;items.push({id:`due:${j.id}:${key}:${value}`,kind:'due',target:'jobs',jobId:j.id,icon,title:editorNotificationTitle(j),detail:`${label} ${value}`,timing:days<0?`${Math.abs(days)}日超過`:days===0?'今日':days===1?'明日':`あと${days}日`,persistent:true,order:days})});
      (feature.messages.get(j.id)||[]).forEach(m=>{const id=`message:${j.id}:${m.id}`;if(m.byUid!==user?.uid&&!read.has(id))items.push({id,kind:'message',target:'jobs',jobId:j.id,icon:'💬',title:editorNotificationTitle(j),detail:`${m.byName||'担当者'}：${String(m.body||'').slice(0,90)}`,timing:'未読',persistent:false,order:-1})});
    });
    return items.sort((a,b)=>(a.order??0)-(b.order??0)||String(a.title).localeCompare(String(b.title)));
  }
  function notificationsHtml(){
    const items=notificationItems();
    return`${pageHead('通知','初稿日・納品日・案件内の連絡を確認')}<div class="card"><div class="section-title"><h2>確認が必要な通知</h2><span>${items.length}件</span></div><div class="notification-list">${items.map(x=>`<button type="button" data-preview-safe class="notification-item" aria-label="${esc(`${x.title}、${x.detail}、${x.timing}`)}" onclick="openEditorNotification('${esc(x.id)}','${esc(x.target)}','${esc(x.jobId||'')}')"><span class="app-sr-only">通知：</span><span class="notification-copy"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span></span><span class="pill ${x.timing.includes('超過')?'red':''}">${esc(x.timing)}</span></button>`).join('')||'<div class="empty">今、確認が必要な通知はありません</div>'}</div>${items.some(x=>!x.persistent)?'<div class="actions"><button class="btn small" type="button" onclick="markEditorNotificationsRead()">新着・メッセージを既読にする</button></div>':''}<div class="muted" style="margin-top:9px">確認待ち・修正中・納品済みの案件は、期限超過として表示しません。初稿日を設定したり、案件の内容を更新したりすると、該当する通知は消えます。</div></div>`;
  }
  function openEditorNotification(id,target){
    const item=notificationItems().find(x=>x.id===id);if(item&&!item.persistent){const read=notificationReadIds();read.add(id);saveNotificationReadIds(read)}
    view=target==='board'?'board':'jobs';render();
    if(item?.jobId&&view==='jobs')setTimeout(()=>openEditorJob(item.jobId),50);
  }
  function openEditorJob(jobId){
    const job=jobs.find(x=>x.id===jobId);if(!job)return;
    if(view!=='jobs'){view='jobs';render();return setTimeout(()=>openEditorJob(jobId),50)}
    const group=document.querySelector(`[data-case-key="${CSS.escape(editorJobParent(job).key)}"]`);if(group)group.open=true;
    const card=document.querySelector(`#editor-job-${CSS.escape(jobId)}`)||document.getElementById(`job-editor-draft-${jobId}`)?.closest('article');
    card?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function markEditorNotificationsRead(){const read=notificationReadIds();notificationItems().filter(x=>!x.persistent).forEach(x=>read.add(x.id));saveNotificationReadIds(read);render()}

  function messageBlock(job){
    const list=(feature.messages.get(job.id)||[]).slice().sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt));
    return`<div class="message-thread"><div class="section-title"><h2>案件内チャット</h2><span>この案件の連絡を残します</span></div>${list.map(x=>`<div class="message ${x.byUid===portalUid()?'mine':''}"><div class="message-head"><span>${esc(x.byName||'メンバー')} ・ ${esc(x.kind||'メッセージ')}</span><span>${x.createdAt&&typeof x.createdAt.toDate==='function'?x.createdAt.toDate().toLocaleString('ja-JP'):''}</span></div><div class="message-body">${esc(x.body||'')}</div>${safeUrl(x.url||'')?`<a class="safe-link" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">添付URLを開く</a>`:''}</div>`).join('')||'<div class="muted">まだ連絡はありません</div>'}<div class="form-grid" style="margin-top:8px"><div class="field"><label for="msg-kind-${job.id}">種類</label><select id="msg-kind-${job.id}"><option>質問</option><option>回答</option><option>初稿提出</option><option>修正指示</option><option>修正稿提出</option><option>納品</option><option>連絡</option></select></div><div class="field"><label for="msg-url-${job.id}">関連URL</label><input id="msg-url-${job.id}" type="url" placeholder="https://"></div><div class="field full"><label for="msg-body-${job.id}">メッセージ</label><textarea id="msg-body-${job.id}" maxlength="2000" placeholder="相手に伝えたいことを入力"></textarea></div></div><div class="actions"><button class="btn primary small" onclick="sendJobMessage('${job.id}')">メッセージを送信</button></div></div>`;
  }


  // The editor portal deliberately renders a separate card per child job; a
  // parent case only groups these cards and never becomes a mutable record.
  function jobCardExtended(job){
    const j={...job,...readJobDraft(job.id)},deliveryDate=j.deliveryDate||j.deadline||'',overdue=editorWorkIsOverdue(j),r=safeUrl(j.requestUrl),s=safeUrl(j.sourceUrl),e=safeUrl(j.evidenceUrl),action=nextEditorJobAction(j),statuses=editorAllowedStatuses(j),timeline=editorTimelineState(j),deadline=editorDeadlineLabel(j),waiting=editorWaitMessage(j),jid=esc(j.id);
    const links=`<div class="link-row">${r?`<a class="safe-link" target="_blank" rel="noopener" href="${esc(r)}">依頼内容</a>`:''}${s?`<a class="safe-link" target="_blank" rel="noopener" href="${esc(s)}">素材</a>`:''}${e?`<a class="safe-link" target="_blank" rel="noopener" href="${esc(e)}">提出した内容</a>`:''}</div>`;
    const statusControl=waiting?`<div class="field"><label>ステータス</label><div class="editor-readonly-status" aria-label="ステータス ${esc(videoStatusLabel(j.status))}">${esc(videoStatusLabel(j.status))}（ディレクター・管理者が更新）</div><input id="job-status-${jid}" type="hidden" value="${esc(j.status||'')}"></div>`:`<div class="field"><label for="job-status-${jid}">ステータス</label><select id="job-status-${jid}">${statuses.map(x=>`<option value="${esc(x)}" ${x===j.status?'selected':''}>${esc(videoStatusLabel(x))}</option>`).join('')}</select></div>`;
    const fields=`<div class="form-grid" oninput="saveJobDraft('${jid}')" onchange="saveJobDraft('${jid}')">${statusControl}<div class="field"><label for="job-shared-${jid}">受注日</label><input id="job-shared-${jid}" type="date" value="${esc(j.sharedDate||'')}"></div><div class="field"><label for="job-editor-draft-${jid}">編集者 初稿</label><input id="job-editor-draft-${jid}" type="date" value="${esc(j.editorDraftDate||'')}"></div><div class="field"><label for="job-client-draft-${jid}">クライアント提出 初稿</label><input id="job-client-draft-${jid}" type="date" value="${esc(j.clientDraftDate||'')}"></div><div class="field"><label for="job-thumbnail-${jid}">サムネイル納品日</label><input id="job-thumbnail-${jid}" type="date" value="${esc(j.thumbnailDate||'')}"></div><div class="field"><label for="job-delivery-${jid}">納品日 *</label><input id="job-delivery-${jid}" type="date" value="${esc(deliveryDate)}"></div><div class="field"><label for="job-workdate-${jid}">作業日</label><input id="job-workdate-${jid}" type="date" value="${esc(j.workDate||'')}"></div><div class="field"><label for="job-start-${jid}">開始時刻</label><input id="job-start-${jid}" type="time" value="${esc(j.startTime||'')}"></div><div class="field"><label for="job-end-${jid}">終了時刻</label><input id="job-end-${jid}" type="time" value="${esc(j.endTime||'')}"></div><div class="field full"><label for="job-progress-${jid}">進み具合のメモ</label><textarea id="job-progress-${jid}" maxlength="2000">${esc(j.progress||'')}</textarea></div><div class="field"><label for="job-evidence-${jid}">提出した内容のURL</label><input id="job-evidence-${jid}" type="url" value="${esc(j.evidenceUrl||'')}" placeholder="https://"></div><div class="field"><label for="job-blocker-${jid}">作業を止めている理由</label><input id="job-blocker-${jid}" maxlength="300" value="${esc(j.blocker||'')}"></div></div>`;
    return`<article id="editor-job-${jid}" data-job-id="${jid}" class="card job-card editor-job-card ${overdue?'notice danger':''}"><div class="job-top"><div><span class="pill">${editorJobTypeLabel(j)}</span><div class="job-title" style="margin-top:6px">${esc(j.title||'案件名未設定')}</div><div class="job-meta">${esc(j.clientDisplay||'クライアント未設定')} / ${esc(j.accountDisplay||'アカウント未設定')}</div></div>${statusPill(j.status)}</div>${j.correctionReason?`<div class="job-urgent-note danger"><b>差戻し内容</b><br>${esc(j.correctionReason)}</div>`:''}${j.blocker?`<div class="job-urgent-note danger"><b>停止・確認が必要です</b><br>${esc(j.blocker)}</div>`:''}<div class="deadline-summary ${overdue?'overdue':''}">${esc(deadline)}${overdue?'（作業中の案件）':''}</div><div class="editor-timeline" aria-label="編集進行の5段階">${timeline.map(x=>`<div class="editor-timeline-step ${x.state}"><b>${x.state==='done'?'完了':x.state==='current'?'現在':x.state==='optional'?'必要時':'未到達'}</b><span>${esc(x.label)}</span></div>`).join('')}</div>${waiting?`<div class="job-waiting"><b>現在の状況：</b>${esc(waiting)}</div>`:editorActionHtml(j,action,e)}<details class="job-detail"><summary>案件の詳細・連絡を開く</summary>${j.instructions?`<div class="job-body">${esc(j.instructions)}</div>`:''}${links}${fields}<div class="actions"><button class="btn primary job-primary" type="button" onclick="saveJobProgress('${jid}')">変更を保存</button></div>${messageBlock(j)}</details></article>`;
  }

  function editorActionHtml(job,action,evidence){
    if(!action)return job.status==='FB待ち'?'<div class="job-waiting"><b>次にすること：</b>ディレクターからの確認・修正指示を待ちます（操作不要）</div>':'';
    const requiresEvidence=['初稿提出済み','修正稿提出済み','完了'].includes(action[0]);
    if(!requiresEvidence)return`<div class="job-next-action"><b>次にすること：</b>${esc(action[1])}</div><div class="actions"><button class="btn primary job-primary" type="button" onclick="quickJobStatus('${esc(job.id)}','${esc(action[0])}')">${esc(action[2])}</button></div>`;
    const label=action[0]==='完了'?'納品URL':action[0]==='修正稿提出済み'?'修正稿URL':'初稿URL';
    return`<div class="job-next-action"><b>次にすること：</b>${esc(action[1])}</div><div class="job-submit-panel"><div class="field"><label for="quick-evidence-${esc(job.id)}">${label} *</label><input id="quick-evidence-${esc(job.id)}" type="url" value="${esc(evidence||'')}" placeholder="https://"></div><button class="btn primary job-primary" type="button" onclick="submitEditorJobAction('${esc(job.id)}','${esc(action[0])}')">${esc(action[2])}</button></div>`;
  }

  function submitEditorJobAction(jid,status){
    const quick=$('#quick-evidence-'+jid),detail=$('#job-evidence-'+jid),value=quick?.value.trim()||'';
    if(!value)return toast('提出・納品URLを入力してください');
    if(!safeUrl(value))return toast('URLを確認してください');
    if(detail)detail.value=value;
    quickJobStatus(jid,status);
  }

  function nextEditorJobAction(job){
    if(editorWorkflow(job).stage!=='editing')return null;
    const next={未着手:['進行中','作業を開始します','作業を開始する'],受注済み:['進行中','作業を開始します','作業を開始する'],進行中:['初稿提出済み','初稿を提出します','初稿を提出した'],編集者進行中:['初稿提出済み','初稿を提出します','初稿を提出した'],初稿完成:['初稿提出済み','初稿を提出します','初稿を提出した'],修正中:['修正稿提出済み','修正稿を提出します','修正稿を提出した']}[String(job?.status||'')];
    return next||null;
  }

  function editorDraftQuickPanel(job){if(!activeJob(job))return'';return`<div class="quick-draft"><div class="field"><label for="quick-editor-draft-${job.id}">編集者 初稿日</label><input id="quick-editor-draft-${job.id}" type="date" value="${esc(job.editorDraftDate||'')}"></div><button class="btn primary small" type="button" onclick="saveEditorDraftDate('${job.id}')">初稿日を保存</button></div>`}
  async function saveEditorDraftDate(jid){
    const job=jobs.find(x=>x.id===jid),value=$(`#quick-editor-draft-${jid}`)?.value||'';if(!job)return;if(!value)return toast('編集者初稿日を入力してください');
    const schedule={sharedDate:job.sharedDate||'',editorDraftDate:value,clientDraftDate:job.clientDraftDate||'',thumbnailDate:job.thumbnailDate||'',deliveryDate:job.deliveryDate||job.deadline||''},dateError=scheduleError(schedule);if(dateError)return toast(dateError);
    if(DEMO){job.editorDraftDate=value;render();return toast('編集者初稿日を保存しました')}
    try{await db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid).update({editorDraftDate:value,updatedAt:now()});job.editorDraftDate=value;render();toast('編集者初稿日を保存しました')}catch(e){console.warn(e);toast('編集者初稿日を保存できませんでした')}
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
    mountUpdateBanner();syncMessageSubscriptions();applyAdminPreviewReadOnly();
  }

  function stopFeatures(){
    feature.unsubs.forEach(x=>{try{x()}catch(_){}});feature.unsubs=[];
    feature.messageUnsubs.forEach(x=>{try{x()}catch(_){}});feature.messageUnsubs.clear();feature.messages.clear();feature.startedFor='';
  }

  function mergeBoard(items){feature.board=uniqById([...feature.board,...items]);render()}
  function mergeManuals(items){feature.manuals=uniqById([...feature.manuals,...items]);render()}

  function startFeatures(){
    if(DEMO||!user||!access?.approved||feature.startedFor===portalUid())return;
    stopFeatures();feature.startedFor=portalUid();
    const root=db.collection('editor_portals').doc(portalUid());
    feature.unsubs.push(root.collection('client_catalog').onSnapshot(q=>{feature.catalog=q.docs.map(d=>({id:d.id,...d.data()}));render()},()=>toast('クライアント一覧を読み込めません')));
    const boardQueries=isExternal()&&assignedDirectorUid()
      ?[db.collection('editor_job_board').where('directorUid','==',assignedDirectorUid())]
      :[db.collection('editor_job_board').where('audience','==','direct'),db.collection('editor_job_board').where('eligibleUids','array-contains',portalUid())];
    boardQueries.forEach(q=>feature.unsubs.push(q.onSnapshot(s=>mergeBoard(s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='open')),e=>console.warn('board',e?.code||e))));
    feature.unsubs.push(db.collection('editor_schedules').onSnapshot(q=>{feature.schedules=q.docs.map(d=>({id:d.id,...d.data()}));render()},e=>console.warn('schedules',e?.code||e)));
    feature.unsubs.push(db.collection('editor_manuals').where('audience','==','all').onSnapshot(q=>mergeManuals(q.docs.map(d=>({id:d.id,...d.data()}))),e=>console.warn('manuals',e?.code||e)));
    feature.unsubs.push(db.collection('editor_manuals').where('allowedUids','array-contains',portalUid()).onSnapshot(q=>mergeManuals(q.docs.map(d=>({id:d.id,...d.data()}))),e=>console.warn('manuals assigned',e?.code||e)));
    feature.unsubs.push(db.collection('system').doc('releases_current').onSnapshot(d=>{feature.release=d.exists?d.data():null;render()},e=>console.warn('release',e?.code||e)));
  }

  function syncMessageSubscriptions(){
    if(DEMO||!db||!user)return;
    const ids=new Set(jobs.map(x=>x.id));
    feature.messageUnsubs.forEach((unsub,jid)=>{if(!ids.has(jid)){try{unsub()}catch(_){}feature.messageUnsubs.delete(jid);feature.messages.delete(jid)}});
    jobs.filter(j=>!j.previewLegacy).forEach(j=>{if(feature.messageUnsubs.has(j.id))return;const u=db.collection('editor_portals').doc(portalUid()).collection('editor_jobs').doc(j.id).collection('messages').orderBy('createdAt','asc').limit(200).onSnapshot(q=>{feature.messages.set(j.id,q.docs.map(d=>({id:d.id,...d.data()})));render()},e=>console.warn('messages',e?.code||e));feature.messageUnsubs.set(j.id,u)});
  }

  async function createDispatchJob(){
    const clientId=$('#new-client-id')?.value||'',accountId=$('#new-account-id')?.value||'',client=feature.catalog.find(x=>x.id===clientId),accountItem=accountItems(clientId).find(x=>x.id===accountId),title=$('#new-title')?.value.trim(),caseName=$('#new-case')?.value.trim()||'',deliveryDate=$('#new-deadline')?.value,instructions=$('#new-instructions')?.value.trim(),requestUrl=$('#new-request')?.value.trim()||'',sourceUrl=$('#new-source')?.value.trim()||'',schedule={sharedDate:$('#new-shared')?.value||'',editorDraftDate:$('#new-editor-draft')?.value||'',clientDraftDate:$('#new-client-draft')?.value||'',thumbnailDate:$('#new-thumbnail')?.value||'',deliveryDate};
    if(!client||!accountItem||!title||!deliveryDate||!instructions)return toast('クライアント・アカウント・案件名・納品日・依頼内容は必須です');
    const dateError=scheduleError(schedule);if(dateError)return toast(dateError);if((requestUrl&&!safeUrl(requestUrl))||(sourceUrl&&!safeUrl(sourceUrl)))return toast('URLは https:// または http:// で入力してください');
    const jid=id(),at=now(),data={recordType:'editor_portal_job',businessType:'dispatch',title,caseName,clientId,clientDisplay:client.name,accountId,accountDisplay:accountItem.name,deadline:deliveryDate,...schedule,requestUrl,sourceUrl,instructions,urgent:!!$('#new-urgent')?.checked,status:'受注済み',workflow:{round:1,stage:'editing'},progressEvents:[],progress:'',evidenceUrl:'',blocker:'',workDate:'',startTime:'',endTime:'',submittedByUid:user.uid,editorUid:user.uid,editorEmail:user.email||'',editorName:editorDisplayName(),directorUid:assignedDirectorUid(),source:'direct_client',createdAt:at,updatedAt:at,history:[{at,type:'created',by:user.uid,status:'受注済み'}]};
    if(DEMO){jobs.unshift({id:jid,...data});sessionStorage.removeItem(draftKey());render();return toast('編集者派遣に案件を登録しました')}
    try{const ref=db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid),ev=ref.collection('events').doc(),batch=db.batch();batch.set(ref,data);batch.set(ev,{at:firebase.firestore.FieldValue.serverTimestamp(),type:'created',byUid:user.uid,status:data.status,deliveryDate,businessType:'dispatch'});await batch.commit();sessionStorage.removeItem(draftKey());toast('編集者派遣に案件を登録しました')}catch(e){console.warn(e);toast('案件を登録できませんでした')}
  }

  async function claimBoardJob(jid){
    const board=feature.board.find(x=>x.id===jid);if(!board||board.status!=='open')return toast('この案件はすでに受託済みです');
    if(!confirm(`「${board.title}」を受けますか？\n受託後は担当案件に追加されます。`))return;
    const at=now(),portalRef=db?.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid),data={recordType:'editor_portal_job',businessType:'edit_agency',boardJobId:jid,title:board.title||'',caseName:board.caseName||'',clientId:board.clientId||'',clientDisplay:board.clientName||'',accountId:board.accountId||'',accountDisplay:board.accountName||'',deadline:board.deliveryDate||'',sharedDate:localDate(),editorDraftDate:board.editorDraftDate||'',clientDraftDate:board.clientDraftDate||'',thumbnailDate:board.thumbnailDate||'',deliveryDate:board.deliveryDate||'',requestUrl:board.requestUrl||'',sourceUrl:board.sourceUrl||'',instructions:board.instructions||board.summary||'',urgent:!!board.urgent,status:'受注済み',workflow:{round:1,stage:'editing'},progressEvents:[],progress:'',evidenceUrl:'',blocker:'',workDate:'',startTime:'',endTime:'',submittedByUid:user.uid,editorUid:user.uid,editorEmail:user.email||'',editorName:editorDisplayName(),directorUid:board.directorUid||'',source:'job_board',createdAt:at,updatedAt:at,history:[{at,type:'claimed',by:user.uid,status:'受注済み'}]};
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
    if(DEMO){feature.lastSuggestionCode=replyCode;render();return toast('匿名で送信しました')}
    try{await db.collection('editor_suggestions').add(data);feature.lastSuggestionCode=replyCode;render();toast('匿名で送信しました')}catch(e){console.warn(e);toast('目安箱を送信できませんでした')}
  }

  async function copySuggestionCode(){const code=feature.lastSuggestionCode||'';if(!code)return toast('コピーする返信コードがありません');try{await navigator.clipboard.writeText(code);toast('返信コードをコピーしました')}catch(_){const input=$('#sg-issued-code');input?.select();toast('返信コードを選択しました。コピーして保存してください')}}

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

  const editorGuideBase=guideHtml;
  guideHtml=()=>{
    let html=editorGuideBase();
    if(isExternal())html=html
      .replace(/<section class="card guide-detail"><h2>2\. 請求者設定<\/h2>[\s\S]*?<\/section>/,'<section class="card guide-detail"><h2>2. 支払い・契約の確認</h2><ol><li>金額と請求は担当ディレクターとの契約に従います。</li><li>このアプリに単価・請求額・利益は表示されません。</li><li>不明点は担当ディレクターへ確認します。</li></ol></section>')
      .replace(/<section class="card guide-detail"><h2>請求書<\/h2>[\s\S]*?<\/section>/,'<section class="card guide-detail"><h2>支払い案内</h2><ol><li>外部編集者はmono.createへ請求書を提出しません。</li><li>担当ディレクターがチーム分をまとめてmono.createへ請求します。</li><li>ご自身の支払いは担当ディレクターへ確認します。</li></ol><div class="actions"><button class="btn small" onclick="setView(\'invoices\')">支払い案内を開く</button></div></section>')
      .replace(/<div class="card"><b>請求書が作れない<\/b><span>[\s\S]*?<\/span><\/div>/,'<div class="card"><b>支払いを確認したい</b><span>担当ディレクターへ確認します。外部編集者の画面に単価や請求額は表示されません。</span></div>');
    return html;
  };

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
  window.copySuggestionCode=copySuggestionCode;
  window.checkSuggestionReply=checkSuggestionReply;
  window.reloadPortalUpdate=reloadPortalUpdate;
  window.openEditorNotification=openEditorNotification;
  window.openEditorJob=openEditorJob;
  window.markEditorNotificationsRead=markEditorNotificationsRead;
  window.saveEditorDraftDate=saveEditorDraftDate;
  window.setEditorJobsListMode=setEditorJobsListMode;
  window.setEditorJobsTypeFilter=setEditorJobsTypeFilter;
  window.submitEditorJobAction=submitEditorJobAction;

  const originalRenderBody=render;
  render=function(){
    if(user&&access?.approved){
      let body;
      if(view==='notifications')body=notificationsHtml();else if(view==='board')body=boardHtml();else if(view==='schedule')body=scheduleHtml();else if(view==='manuals')body=manualsHtml();else if(view==='suggestion')body=suggestionHtml();
      if(body){accountHtml();$('#app').innerHTML=adminPreviewBanner()+navHtml()+body;injectStyles();mountUpdateBanner();applyAdminPreviewReadOnly();return}
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
