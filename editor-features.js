(function(){
  'use strict';

  const PORTAL_APP_VERSION='20260829-11';
  const feature={
    board:[],boardSelectedId:'',boardSearch:'',catalog:[],manuals:[],schedules:[],release:null,
    messages:new Map(),messageUnsubs:new Map(),messageLoading:new Set(),openMessageJobIds:new Set(),groupDraftSaving:new Set(),unsubs:[],startedFor:'',serverVersion:'',jobsListMode:'active',jobsTypeFilter:'all',lastSuggestionCode:'',
    dmPeers:[],dmThreads:[],dmMessages:[],dmActivePeerUid:'',dmActiveThreadId:'',dmThreadUnsub:null,dmMessageUnsub:null,dmLoading:false,dmError:'',dmStartedFor:'',dmInitialSnapshot:false,dmSeenMessages:new Map(),
    pushStatus:null,pushStatusFor:'',pushStatusLoading:false
  };
  const original={
    navHtml,render,startPortal,jobForm,jobsHtml,jobCard,createJob,dashboardHtml,logout
  };

  function accessKind(){return String(access?.editorKind||'direct')}
  function isExternal(){return accessKind()==='external'}
  function assignedDirectorUid(){return String(access?.directorUid||'')}
  function editorDisplayName(){return access?.name||user?.displayName||'編集者'}
  function draftDateSetter(job){return editorDraftDateSetter(job)==='creator'?'creator':'editor'}
  function editorSetsDraftDate(job){return draftDateSetter(job)==='editor'}
  function uniqById(items){const map=new Map();items.forEach(x=>x&&x.id&&map.set(x.id,x));return[...map.values()]}
  function stamp(v){return v&&typeof v.toMillis==='function'?v.toMillis():Number(v||0)}
  function byUpdated(a,b){return(stamp(b.updatedAt)||stamp(b.createdAt))-(stamp(a.updatedAt)||stamp(a.createdAt))}
  function accountItems(clientId){return(feature.catalog.find(x=>x.id===clientId)?.accounts||[]).filter(x=>x&&x.id&&x.name&&x.active!==false)}
  function validText(v,max){return typeof v==='string'&&v.trim().length>0&&v.trim().length<=max}
  function positiveYen(value){const text=String(value??'').trim();if(!/^\d+$/.test(text))return null;const amount=Number(text);return Number.isSafeInteger(amount)&&amount>0&&amount<=100000000?amount:null}
  function editorResourceLinks(job){
    const items=[],seen=new Set(),add=(type,title,value)=>{const url=safeUrl(value||'');if(!url||seen.has(url))return;seen.add(url);items.push({type:String(type||'資料').slice(0,30),title:String(title||type||'資料').slice(0,160),url})};
    add('依頼内容','依頼内容',job?.requestUrl);add('素材','素材',job?.sourceUrl);
    (Array.isArray(job?.attachments)?job.attachments:[]).slice(0,20).forEach(item=>add(item?.type||'資料',item?.title||item?.name||'名称未設定',item?.url||item?.href));
    add('提出','提出した内容',job?.evidenceUrl);
    return items.length?`<div class="editor-resource-list" aria-label="素材・資料">${items.map(item=>`<a class="editor-resource-link" href="${esc(item.url)}" target="_blank" rel="noopener noreferrer"><span>${esc(item.type)}</span><b>${esc(item.title)}</b><span aria-hidden="true">↗</span></a>`).join('')}</div>`:'';
  }
  function applicationIcon(name){
    const paths={
      calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
      document:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v5h5M9 13h6M9 17h6"/>',
      media:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m7 15 3-3 3 3 2-2 3 3M8 9h.01"/>',
      check:'<path d="m5 12 4 4L19 6"/>',
      clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'
    };
    return`<svg class="application-icon application-icon-${name}" viewBox="0 0 24 24" aria-hidden="true">${paths[name]||paths.document}</svg>`;
  }
  function hydrateEditorVisualMarks(){
    document.querySelectorAll('.application-info dt').forEach((label,index)=>{
      if(label.querySelector('.application-icon'))return;
      const text=label.textContent||'';
      label.insertAdjacentHTML('afterbegin',applicationIcon(/初稿|納期|日程/.test(text)?'calendar':index===2?'check':'document'));
    });
    document.querySelectorAll('.notification-item').forEach(item=>{
      const copy=item.querySelector('.notification-copy'),read=item.querySelector('.notification-read');
      if(copy&&!item.querySelector('.notification-visual-icon')){
        const text=copy.textContent||'',kind=/初稿|納期|日程/.test(text)?'calendar':/連絡|DM|チャット/.test(text)?'check':'document';
        copy.insertAdjacentHTML('beforebegin',`<span class="notification-visual-icon">${applicationIcon(kind)}</span>`);
      }
      if(read&&!read.querySelector('.application-icon'))read.innerHTML=`${applicationIcon('check')}<span class="app-sr-only">既読</span>`;
    });
  }
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
    const entries=[['編集者初稿',job?.editorDraftDate],['クライアント初稿',job?.clientDraftDate]].filter(([,date])=>!!date);
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
  function editorJobSortByAddedOrder(list){return[...list].sort((a,b)=>{const ai=Number.isInteger(a?.subtaskIndex)?a.subtaskIndex:null,bi=Number.isInteger(b?.subtaskIndex)?b.subtaskIndex:null;if(ai!==null&&bi!==null&&ai!==bi)return ai-bi;const at=tsValue(a?.createdAt),bt=tsValue(b?.createdAt);if(at&&bt&&at!==bt)return at-bt;const titleOrder=editorGroupText(a?.title||a?.id).localeCompare(editorGroupText(b?.title||b?.id),'ja',{numeric:true,sensitivity:'base'});return titleOrder||String(a?.id||'').localeCompare(String(b?.id||''),'ja',{numeric:true})})}
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
      .notification-button{position:relative}.notification-count{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;padding:0 5px;border-radius:99px;background:#dc2626;color:#fff;font-size:9px;font-weight:900}.notification-list{display:flex;flex-direction:column;gap:7px}.notification-item{display:flex;align-items:stretch;gap:7px;border:1px solid var(--border);border-left:3px solid var(--amber);border-radius:10px;background:var(--card);padding:7px}.notification-open{width:100%;display:flex;align-items:center;gap:10px;min-width:0;text-align:left;border:0;border-radius:7px;background:transparent;padding:3px;cursor:pointer}.notification-open:hover,.notification-open:focus-visible{background:var(--card2)}.notification-read{flex:0 0 auto;min-height:36px;padding:0 9px;white-space:nowrap;font-size:11px}.notification-copy{flex:1;min-width:0}.notification-copy b{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.notification-copy span{display:block;font-size:10.5px;color:var(--t2);margin-top:2px}.quick-draft,.group-draft-panel{display:flex;align-items:end;gap:8px;margin:9px 0;padding:10px;border:1px solid #c4b5fd;border-radius:10px;background:#f5f3ff}.quick-draft .field,.group-draft-panel .field{flex:1;margin:0}.quick-draft .btn,.group-draft-panel .btn{min-height:40px}.group-draft-panel b{display:block;font-size:14px;color:#4c1d95}.group-draft-panel .muted{margin-top:2px}
      .feature-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.feature-grid.two{grid-template-columns:repeat(2,minmax(0,1fr))}
      .board-card{display:flex;flex-direction:column;gap:8px;border:2px solid #c4b5fd;box-shadow:0 6px 20px rgba(91,33,182,.10)}.board-card .actions{margin-top:auto}.claim-button{width:100%;min-height:52px;font-size:14px;background:linear-gradient(135deg,#7c3aed,#5b21b6)!important;box-shadow:0 7px 18px rgba(91,33,182,.25)}.claim-button:hover{transform:translateY(-1px)}.accept-howto{display:flex;align-items:flex-start;gap:10px;margin:10px 0 14px;padding:12px 14px;border:1px solid #c4b5fd;border-radius:11px;background:#f5f3ff;color:#4c1d95}.accept-howto b{display:block;font-size:12px}.accept-howto span{display:block;margin-top:2px;font-size:10.5px;color:#6d28d9;line-height:1.6}.scope-line{display:flex;gap:5px;flex-wrap:wrap}.scope-chip{display:inline-flex;padding:3px 7px;border-radius:7px;background:var(--card2);font-size:10px;color:var(--t2)}
      .message-thread{border-top:1px solid var(--border);margin-top:12px;padding-top:10px}.message{padding:8px 9px;margin:6px 0;border-radius:9px;background:var(--card2);font-size:11px}.message.mine{background:var(--purple2)}.message-head{display:flex;justify-content:space-between;gap:8px;color:var(--t3);font-size:9.5px;margin-bottom:3px}.message-body{white-space:pre-wrap;overflow-wrap:anywhere}
      .availability-card{border-left:3px solid var(--green)}.availability-card.unavailable{border-left-color:var(--t3)}.availability-hours{font-size:16px;font-weight:850;margin:4px 0}
      .availability-calendar{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:8px;margin-top:10px}.availability-day{min-width:0;border:1px solid var(--border);border-radius:11px;padding:10px;background:var(--card)}.availability-day-head{display:flex;align-items:center;justify-content:space-between;gap:5px;margin-bottom:7px}.availability-day-head b{font-size:12px}.availability-day-head span{font-size:9px;color:var(--t3)}.availability-day .field{margin-top:6px}.availability-day label{font-size:9.5px}.availability-day input,.availability-day select,.availability-day textarea{min-width:0;padding:7px 8px;font-size:12px}.availability-day textarea{min-height:52px}.availability-time{display:grid;grid-template-columns:1fr 1fr;gap:5px}.availability-bulk{margin-bottom:10px;background:#f8fafc}.availability-bulk-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;align-items:end}.availability-bulk-days{display:flex;gap:5px;flex-wrap:wrap;margin:8px 0}.availability-bulk-days label{display:inline-flex;align-items:center;gap:4px;padding:5px 8px;background:var(--card);border:1px solid var(--border);border-radius:8px;font-size:10.5px}.availability-bulk-days input,.availability-routine input{width:auto}.availability-routine{display:flex;align-items:flex-start;gap:7px;margin-top:12px;padding:10px;background:var(--purple2);border-radius:9px;font-size:11px}.team-day-chips{display:flex;gap:4px;flex-wrap:wrap;margin-top:7px}.team-day-chip{font-size:9.5px;padding:3px 6px;border-radius:6px;background:var(--card2);color:var(--t2)}.team-day-chip.on{background:#ecfdf5;color:#047857}.team-day-chip.consult{background:#fffbeb;color:#b45309}
      .manual-body{white-space:pre-wrap;font-size:12px;color:var(--t2);margin:9px 0}.manual-meta{font-size:10px;color:var(--t3)}
      .privacy-note{display:flex;gap:8px;align-items:flex-start;background:#f8fafc;border:1px solid #e2e8f0;border-radius:9px;padding:10px;font-size:11px;color:var(--t2)}
      .catalog-empty{border:1px dashed var(--border);border-radius:9px;padding:14px;color:var(--t2);font-size:11px}
      .editor-resource-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:10px 0}.editor-resource-link{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:7px;min-height:48px;padding:9px 11px;border:1px solid #ddd6fe;border-radius:10px;background:#faf5ff;color:#312e81;text-decoration:none}.editor-resource-link:hover,.editor-resource-link:focus-visible{border-color:#7c3aed;background:#f5f3ff}.editor-resource-link span:first-child{padding:3px 7px;border-radius:99px;background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:850}.editor-resource-link b{min-width:0;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
      .job-list-tabs,.job-type-filters{display:flex;gap:7px;flex-wrap:wrap;margin:0 0 10px}.job-list-tab{min-width:132px;justify-content:center;border:1.5px solid var(--border);background:var(--card);color:var(--t2)}.job-list-tab.active,.job-type-filter.active{border-color:#7c3aed;background:#f5f3ff;color:#5b21b6;box-shadow:0 3px 12px rgba(124,58,237,.13)}.job-list-tab .accept-count{margin-left:2px;background:#7c3aed}.job-list-tab:not(.active) .accept-count{background:#94a3b8}.job-type-filter{min-height:44px;padding:8px 12px;font-size:14px}.editor-job-list{display:grid;grid-template-columns:minmax(0,860px);justify-content:center;gap:12px}.editor-case-group{padding:0;border:2px solid #c4b5fd;overflow:hidden}.editor-case-group>summary{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:70px;padding:13px 15px;cursor:pointer;background:#faf5ff}.editor-case-group>summary::-webkit-details-marker{display:none}.editor-case-group>summary b{display:block;font-size:16px;color:#312e81}.editor-case-group>summary small{display:block;margin-top:3px;color:var(--t2);font-size:12px}.editor-case-group-count{white-space:nowrap;padding:5px 8px;border-radius:99px;background:#ede9fe;color:#5b21b6;font-size:12px;font-weight:850}.editor-case-group-body{display:grid;gap:10px;padding:12px}.editor-case-group-body .editor-job-card{box-shadow:none}.editor-workflow-hint{padding:0 14px 12px;color:var(--t3);font-size:10px}.editor-job-card{border-color:#ddd6fe}.editor-job-card .job-meta{font-size:14px}.job-urgent-note{margin:10px 0;padding:10px;border-radius:9px;background:#fff7ed;border-left:3px solid #f59e0b;font-size:14px;color:#92400e}.job-urgent-note.danger{background:#fef2f2;border-left-color:#dc2626;color:#991b1b}.deadline-summary{margin:10px 0;padding:10px 12px;border-radius:9px;background:#f8fafc;font-size:14px;font-weight:800;color:#334155}.deadline-summary.overdue{background:#fef2f2;color:#b91c1c}.editor-timeline{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:0;margin:12px 0}.editor-timeline-step{position:relative;min-width:0;padding:25px 8px 0;text-align:center;color:var(--t3)}.editor-timeline-step:before{content:'';position:absolute;z-index:2;left:50%;top:4px;width:9px;height:9px;transform:translateX(-50%);border:2px solid #cbd5e1;border-radius:50%;background:#fff}.editor-timeline-step:not(:last-child):after{content:'';position:absolute;z-index:1;left:50%;right:-50%;top:9px;height:2px;background:#e2e8f0}.editor-timeline-step.done{color:#047857}.editor-timeline-step.done:before{border-color:#10b981;background:#10b981}.editor-timeline-step.done:after{background:#86efac}.editor-timeline-step.current{color:#5b21b6;font-weight:800}.editor-timeline-step.current:before{border-color:#7c3aed;background:#f5f3ff}.editor-timeline-step.optional{color:#64748b}.editor-timeline-step.optional:before{border-style:dashed}.editor-timeline-step b{display:block;font-size:12px;line-height:1.35}.editor-timeline-step span{display:block;margin-top:3px;font-size:11px;line-height:1.45;overflow-wrap:anywhere}.job-next-action{margin:11px 0 0;font-size:14px}.job-waiting{margin-top:10px;padding:10px 12px;border-radius:9px;background:#fffbeb;color:#92400e;font-size:14px}.job-submit-panel{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:end;gap:8px;margin-top:10px;padding:10px;border:1px solid #c4b5fd;border-radius:10px;background:#faf5ff}.job-submit-panel .field{margin:0}.job-submit-panel .btn{min-height:44px}.dispatch-create{margin-top:18px}.dispatch-create summary{min-height:52px;display:flex;align-items:center;cursor:pointer;font-weight:850;color:#5b21b6;font-size:14px}.dispatch-create[open] summary{border-bottom:1px solid var(--border);margin-bottom:12px}.dispatch-create summary::-webkit-details-marker{display:none}.dispatch-subcase-scroll{min-width:0;max-height:min(68vh,760px);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;border:1px solid var(--border);border-radius:12px;background:var(--card)}.dispatch-subcase-list{display:grid;gap:9px;min-width:0;padding:10px}.dispatch-subcase{min-width:0}.dispatch-subcase-add{position:sticky;bottom:0;z-index:3;display:flex;min-width:0;padding:10px;border-top:1px solid var(--border);background:var(--card);box-shadow:0 -8px 18px rgba(15,23,42,.08)}.dispatch-subcase-add .btn{width:100%;min-width:0;min-height:44px;justify-content:center}.board-card details{margin-top:3px;border-top:1px solid var(--border);padding-top:8px}.board-card summary{min-height:44px;display:flex;align-items:center;color:#5b21b6;font-size:14px;font-weight:800;cursor:pointer}.board-card .claim-button{margin-top:8px}.editor-job-card details summary:focus-visible,.editor-case-group>summary:focus-visible,.board-card summary:focus-visible,.job-list-tab:focus-visible,.job-type-filter:focus-visible,.claim-button:focus-visible{outline:3px solid rgba(124,58,237,.35);outline-offset:2px}
      .editor-nav-desktop{position:relative;overflow:visible;flex-wrap:wrap}.editor-nav-more{position:relative}.editor-nav-more summary{list-style:none}.editor-nav-more summary::-webkit-details-marker{display:none}.editor-nav-more-menu{position:absolute;top:calc(100% + 6px);right:0;z-index:90;display:none;grid-template-columns:repeat(2,minmax(0,1fr));gap:6px;width:min(340px,calc(100vw - 36px));padding:10px;border:1px solid var(--border);border-radius:12px;background:var(--card);box-shadow:0 18px 48px rgba(15,23,42,.18)}.editor-nav-more[open]>.editor-nav-more-menu{display:grid}.editor-nav-more-menu .btn{width:100%;min-width:0;min-height:44px;justify-content:flex-start;padding:9px 11px;text-align:left;white-space:normal;line-height:1.35}.editor-nav-mobile{display:none}.editor-primary-action{border:2px solid #7c3aed;background:#faf5ff}.editor-primary-action .actions{margin-top:10px}.editor-next-child{display:block;margin-top:4px;font-size:14px;color:#4c1d95;font-weight:800;line-height:1.5}.editor-case-group>summary>span:first-child{min-width:0}.editor-case-group>summary b,.editor-case-group>summary small{overflow-wrap:anywhere}
      .editor-sidebar-head{padding:8px 10px 16px;border-bottom:1px solid rgba(255,255,255,.14)}.editor-sidebar-brand{display:flex;min-width:0;align-items:center;gap:9px}.editor-sidebar-brand img{display:block;width:34px;height:34px;flex:0 0 34px;border-radius:4px}.editor-sidebar-brand-copy{display:block;min-width:0}.editor-sidebar-brand b{display:block;color:#fff;font-size:15px;line-height:1.2;white-space:nowrap}.editor-sidebar-brand small{display:block;margin-top:2px;color:rgba(255,255,255,.76);font-size:10px;font-weight:800;line-height:1.25;white-space:nowrap}.editor-sidebar-head>span{display:block;margin-top:8px;font-size:12px;color:rgba(255,255,255,.68)}.editor-sidebar-section{display:grid;gap:3px}.editor-sidebar-label{padding:12px 10px 4px;color:rgba(255,255,255,.58);font-size:11px;font-weight:800;letter-spacing:.08em}.editor-sidebar-section .editor-nav-button{width:100%;justify-content:flex-start}.editor-sidebar-footer{margin-top:auto;padding-top:10px;border-top:1px solid rgba(255,255,255,.12)}
      .dm-shell{display:grid;grid-template-columns:minmax(260px,340px) minmax(0,1fr);min-height:620px;overflow:hidden;padding:0}.dm-inbox{min-width:0;border-right:1px solid var(--border);background:#fff}.dm-inbox-head,.dm-thread-head{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:68px;padding:12px 14px;border-bottom:1px solid var(--border)}.dm-inbox-head h2,.dm-thread-head h2{margin:0;font-size:17px}.dm-inbox-head span,.dm-thread-head span{display:block;color:var(--t2);font-size:12px}.dm-list{display:grid;max-height:552px;overflow-y:auto}.dm-list-label{padding:14px 14px 6px;color:var(--t2);font-size:12px;font-weight:850}.dm-person{position:relative;display:grid;grid-template-columns:42px minmax(0,1fr) auto;align-items:center;gap:9px;width:100%;min-height:66px;padding:9px 12px;border:0;border-bottom:1px solid #f1f5f9;background:#fff;color:var(--text);text-align:left}.dm-person:hover,.dm-person:focus-visible,.dm-person.active{background:#f8f5ff}.dm-avatar{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:11px;background:linear-gradient(145deg,#7c3aed,#4c1d95);color:#fff;font-weight:900}.dm-person-copy{min-width:0}.dm-person-copy b,.dm-person-copy span{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-person-copy b{font-size:14px}.dm-person-copy span{margin-top:2px;color:var(--t2);font-size:12px}.dm-person-meta{display:grid;justify-items:end;gap:5px;color:var(--t3);font-size:10px}.dm-unread-dot{width:9px;height:9px;border-radius:50%;background:#7c3aed}.dm-chat{display:flex;min-width:0;min-height:620px;flex-direction:column;background:#fff}.dm-back{display:none}.dm-messages{display:flex;flex:1;min-height:0;max-height:460px;flex-direction:column;gap:2px;overflow-y:auto;padding:14px}.dm-message{display:grid;grid-template-columns:38px minmax(0,1fr);gap:9px;padding:8px;border-radius:9px}.dm-message:hover{background:#f8fafc}.dm-message .dm-avatar{width:38px;height:38px;border-radius:9px;font-size:12px}.dm-message-head{display:flex;align-items:baseline;gap:7px}.dm-message-head b{font-size:14px}.dm-message-head time{color:var(--t3);font-size:10px}.dm-message-body{margin-top:2px;white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.65}.dm-compose{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:8px;margin-top:auto;padding:12px 14px;border-top:1px solid var(--border);background:#fff}.dm-compose textarea{width:100%;min-height:52px;max-height:160px;resize:vertical;border:1px solid #cbd5e1;border-radius:10px;padding:10px 12px}.dm-compose .btn{min-width:92px}.dm-guidance{margin:0 14px 12px;padding:9px 10px;border-radius:8px;background:#f8fafc;color:#475569;font-size:12px}.device-notification-card{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:12px;margin-bottom:12px;border:1.5px solid #c4b5fd;background:#faf5ff}.device-notification-card h2{margin:0;font-size:15px;color:#312e81}.device-notification-card p{margin:3px 0 0;color:#475569;font-size:13px;line-height:1.6}.device-notification-card .btn{min-width:150px}
      .editor-nav-button{gap:7px}.editor-nav-icon{display:inline-flex;align-items:center;justify-content:center;width:18px;height:18px;flex:0 0 18px}.editor-nav-icon svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}.editor-nav-desktop{padding:10px 0 14px;border-bottom:1px solid var(--border)}.editor-nav-desktop .editor-nav-button{min-height:44px;border-color:transparent;box-shadow:none;color:#475569;background:transparent}.editor-nav-desktop .editor-nav-button:hover,.editor-nav-desktop .editor-nav-button.active{border-color:#e2e8f0;background:#fff;color:#312e81;box-shadow:0 2px 8px rgba(15,23,42,.06)}.editor-home-rail{margin:0 -2px 14px;padding:10px 0 2px}.editor-home-rail-head{display:flex;align-items:baseline;justify-content:space-between;padding:0 2px 8px}.editor-home-rail-head b{font-size:16px;color:#1e293b}.editor-home-rail-head span{font-size:14px;color:#64748b}.editor-home-chips{display:flex;gap:8px;overflow-x:auto;padding:0 2px 8px;scroll-snap-type:x mandatory;-webkit-overflow-scrolling:touch}.editor-home-chip{display:flex;min-width:min(278px,82vw);min-height:94px;flex:0 0 min(278px,82vw);flex-direction:column;align-items:flex-start;gap:4px;padding:12px;border:1px solid #e2e8f0;border-radius:12px;background:#fff;text-align:left;scroll-snap-align:start;box-shadow:0 3px 12px rgba(15,23,42,.05)}.editor-home-chip:hover,.editor-home-chip:focus-visible{border-color:#a78bfa;background:#faf5ff}.editor-home-chip-state{font-size:14px;font-weight:850;color:#5b21b6}.editor-home-chip b{max-width:100%;font-size:16px;line-height:1.35;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.editor-home-chip small{max-width:100%;font-size:14px;line-height:1.35;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.editor-home-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}.editor-home-stats .metric{grid-column:auto;min-width:0;padding:12px;box-shadow:none}.editor-home-stats .metric span{font-size:14px}.editor-home-stats .metric b{font-size:22px}.editor-home-feed{max-width:860px;margin-inline:auto}.editor-home-feed .section-title{padding:2px 2px 0}.editor-home-feed .section-title span{font-size:14px}
      .editor-primary-action,.editor-case-group,.editor-job-card,.board-card,.job-submit-panel{min-width:0;overflow-wrap:anywhere}.editor-primary-action{padding:16px}.editor-action-kicker{display:inline-flex;align-items:center;min-height:28px;padding:3px 9px;border-radius:99px;background:#5b21b6;color:#fff;font-size:14px;font-weight:850;line-height:1.35}.editor-primary-action .section-title{align-items:flex-start;gap:10px;margin:8px 0}.editor-primary-action .section-title h2{font-size:20px;line-height:1.35}.editor-deadline-chip{display:inline-flex;align-items:center;min-height:30px;padding:3px 9px;border:1px solid #a78bfa;border-radius:99px;background:#fff;color:#4c1d95;font-size:14px!important;font-weight:850;line-height:1.35}.editor-action-title{display:block;font-size:18px;line-height:1.45;color:#1e1b4b}.editor-current-state,.editor-next-instruction{margin-top:10px;padding:11px 12px;border-radius:10px;background:#fff;border:1px solid #ddd6fe}.editor-current-state{display:flex;align-items:center;gap:8px}.editor-current-state span,.editor-next-instruction span{font-size:14px;font-weight:800;color:#475569}.editor-current-state b{font-size:15px;color:#4c1d95}.editor-next-instruction p{margin:4px 0 0;font-size:14px;line-height:1.65;color:#334155}.editor-case-group>summary small,.editor-case-group-count,.editor-workflow-hint{font-size:14px;line-height:1.5}.editor-workflow-hint{color:#475569;font-weight:700}.editor-job-status-line{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin:10px 0;padding:10px 12px;border:1px solid #c4b5fd;border-radius:10px;background:#faf5ff}.editor-job-status-line span{font-size:14px;color:#475569;font-weight:800}.editor-job-status-line b{font-size:15px;color:#4c1d95}.editor-next-owner{margin:-2px 0 10px;padding-left:12px;font-size:14px;line-height:1.5;color:#475569}.editor-next-owner b{color:#334155}.deadline-summary{border:1px solid #cbd5e1;font-size:14px;line-height:1.55}.editor-timeline-step b,.editor-timeline-step span{font-size:14px;line-height:1.5}.editor-timeline-step.current{background:#faf5ff;border-radius:8px}.job-waiting{border:1px solid #fbbf24;font-size:14px;line-height:1.6}.job-next-action{padding:10px 12px;border-left:4px solid #7c3aed;border-radius:8px;background:#faf5ff;font-size:14px;line-height:1.6}.job-submit-panel label,.job-submit-panel input{font-size:14px}.accept-howto b,.accept-howto span,.privacy-note,.catalog-empty,.board-card .job-meta{font-size:14px;line-height:1.6}.board-card details summary{min-height:44px}.editor-job-card .job-meta{color:#475569;line-height:1.55}.editor-case-group>summary{min-height:76px}.editor-case-group>summary:after{content:'開く';font-size:14px;font-weight:800;color:#5b21b6;white-space:nowrap}.editor-case-group[open]>summary:after{content:'閉じる'}
      @media(min-width:761px){body.editor-slack-layout main#app{max-width:none;margin:0;padding:24px 28px 64px 264px}.editor-slack-layout .topbar-in{max-width:none}.editor-slack-layout .editor-nav-desktop{position:fixed;top:69px;bottom:0;left:0;z-index:18;display:flex;width:236px;flex-direction:column;flex-wrap:nowrap;gap:6px;padding:12px 10px 18px;overflow-y:auto;border:0;background:linear-gradient(180deg,#3f0e40 0%,#28102f 100%);box-shadow:8px 0 28px rgba(32,10,38,.12)}.editor-slack-layout .editor-nav-desktop .editor-nav-button{min-height:42px;padding:8px 10px;border:0;border-radius:7px;background:transparent;color:rgba(255,255,255,.82);box-shadow:none}.editor-slack-layout .editor-nav-desktop .editor-nav-button:hover,.editor-slack-layout .editor-nav-desktop .editor-nav-button.active{background:rgba(255,255,255,.15);color:#fff}.editor-slack-layout .editor-nav-desktop .accept-count,.editor-slack-layout .editor-nav-desktop .notification-count{margin-left:auto}.editor-slack-layout .editor-nav-desktop .editor-nav-more{display:none}.editor-slack-layout .page-head,.editor-slack-layout .editor-home-rail,.editor-slack-layout .editor-primary-action,.editor-slack-layout .editor-home-stats,.editor-slack-layout .section{max-width:1080px;margin-left:auto;margin-right:auto}}
      @media(max-width:980px){.availability-calendar{grid-template-columns:repeat(2,minmax(0,1fr))}.availability-bulk-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){body{padding-bottom:76px}.editor-nav-desktop{display:none}.editor-nav-mobile{position:fixed;left:0;right:0;bottom:0;z-index:80;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:2px;margin:0;padding:6px 4px calc(6px + env(safe-area-inset-bottom));border-top:1px solid var(--border);background:rgba(255,255,255,.98);box-shadow:0 -5px 20px rgba(15,23,42,.12);backdrop-filter:blur(14px)}.editor-nav-mobile .btn{min-width:0;min-height:44px}.editor-nav-mobile .editor-nav-button,.editor-nav-mobile .editor-nav-more summary{min-width:0;min-height:44px;padding:4px 2px;border-color:transparent;background:transparent;box-shadow:none;font-size:10px;line-height:1.2;flex-direction:column;gap:2px}.editor-nav-mobile .editor-nav-button.active,.editor-nav-mobile .editor-nav-more summary.active{background:#f5f3ff;color:#5b21b6}.editor-nav-mobile .editor-nav-icon{width:19px;height:19px}.editor-nav-mobile .editor-nav-icon svg{width:19px;height:19px}.editor-nav-mobile .accept-count,.editor-nav-mobile .notification-count{position:absolute;top:1px;right:5px;min-width:16px;height:16px;padding:0 4px;font-size:9px}.editor-nav-more{position:static;display:flex;align-items:stretch}.editor-nav-more summary{display:flex;align-items:center;justify-content:center;width:100%;cursor:pointer}.editor-nav-more-menu{position:fixed;top:auto;right:12px;bottom:calc(66px + env(safe-area-inset-bottom));left:12px;z-index:95;width:auto;max-height:min(62dvh,460px);grid-template-columns:repeat(2,minmax(0,1fr));overflow-y:auto;padding:12px}.editor-nav-more-menu .btn{min-height:52px;padding:11px 12px;font-size:14px}.feature-grid,.feature-grid.two,.availability-calendar,.availability-bulk-grid{grid-template-columns:1fr}.update-banner{top:65px;align-items:flex-start;flex-wrap:wrap}.update-banner .btn{width:auto}.availability-day{display:grid;grid-template-columns:70px minmax(0,1fr);gap:7px}.availability-day-head{display:block}.availability-day>.field,.availability-day>.availability-time{margin-top:0}.availability-day .field.full{grid-column:1/-1}.editor-timeline{grid-template-columns:1fr;gap:0}.editor-timeline-step{min-height:44px;padding:7px 5px 9px 32px;text-align:left}.editor-timeline-step:before{left:8px;top:11px;transform:none}.editor-timeline-step:not(:last-child):after{left:13px;right:auto;top:23px;width:2px;height:calc(100% - 7px)}.editor-timeline-step b,.editor-timeline-step span{display:inline;font-size:14px;line-height:1.5}.editor-timeline-step span{margin:0 0 0 7px}.job-list-tab{flex:1;min-width:0}.job-type-filter{flex:1;min-width:0}.job-submit-panel{grid-template-columns:1fr}.job-submit-panel .btn{width:100%}.dispatch-create summary{font-size:14px}.editor-primary-action .section-title{flex-wrap:wrap}.editor-deadline-chip{max-width:100%;white-space:normal}.editor-current-state{align-items:flex-start;flex-direction:column;gap:3px}.editor-case-group>summary:after{align-self:flex-start}.editor-case-group-count{white-space:normal}.editor-job-status-line{align-items:flex-start;flex-direction:column;gap:3px}.editor-home-rail{margin-bottom:12px}.editor-home-rail-head span{font-size:14px}.editor-home-stats{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.editor-home-stats .metric{min-height:76px}.editor-home-chip{min-width:82vw;flex-basis:82vw}.editor-home-feed .section-title{align-items:flex-start;flex-direction:column;gap:2px}.dm-shell{display:block;min-height:calc(100dvh - 170px)}.dm-inbox{border-right:0}.dm-chat{display:none;min-height:calc(100dvh - 170px)}.dm-shell.dm-mobile-chat .dm-inbox{display:none}.dm-shell.dm-mobile-chat .dm-chat{display:flex}.dm-thread-head>div{min-width:0}.dm-thread-head h2,.dm-thread-head span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dm-back{display:inline-flex;width:auto;flex:0 0 auto}.dm-list{max-height:none}.dm-messages{max-height:none;min-height:45dvh}.dm-compose{position:sticky;bottom:68px;grid-template-columns:minmax(0,1fr) auto}.dm-compose .btn{min-width:70px;padding-inline:10px}.device-notification-card{grid-template-columns:1fr}.device-notification-card .btn{width:100%}}
      @media(max-width:420px){.editor-case-group>summary{align-items:flex-start;flex-direction:column}.editor-case-group-count{white-space:normal;max-width:100%}.notification-copy b,.notification-copy span{overflow-wrap:anywhere;white-space:normal}.notification-item{align-items:stretch}.notification-read{padding:0 7px;font-size:10px}.editor-nav-mobile .btn{font-size:9px}}
      @media(max-width:760px){.group-draft-panel{align-items:stretch;flex-direction:column}.group-draft-panel .btn{width:100%;min-height:44px}}
      @media(max-width:760px){.editor-resource-list{grid-template-columns:1fr}}
      @media(pointer:coarse){.editor-job-card .btn.small,.notification-item,.editor-nav-more summary{min-height:44px}}
    `;style.textContent+=`.editor-job-dates{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;margin:10px 0}.editor-job-dates div{padding:8px 10px;border:1px solid #e2e8f0;border-radius:9px;background:#f8fafc;color:#475569;font-size:12px}.editor-job-dates span{display:block;font-size:10px;font-weight:800;color:#64748b}.editor-job-dates b{display:block;margin-top:2px;font-size:13px;color:#1e293b}.editor-job-dates .actual{border-color:#86efac;background:#ecfdf5}.push-setup-banner{display:flex;align-items:center;justify-content:space-between;gap:12px;max-width:1080px;margin:0 auto 14px;padding:12px 14px;border:2px solid #a78bfa;border-radius:12px;background:#faf5ff;color:#312e81}.push-setup-banner b{display:block;font-size:14px}.push-setup-banner span{display:block;margin-top:3px;color:#5b21b6;font-size:12px;line-height:1.5}.push-setup-card{max-width:760px;margin:0 auto}.push-setup-card h2{margin:0 0 7px}.push-setup-card ol{margin:14px 0;padding-left:22px;line-height:2}.push-setup-card li::marker{font-weight:850;color:#6d28d9}.push-status{margin:12px 0;padding:11px 12px;border-radius:9px;background:#f8fafc;color:#475569;line-height:1.55}.push-status.ready{background:#ecfdf5;color:#047857}.push-actions{display:flex;gap:8px;flex-wrap:wrap}@media(max-width:760px){.push-setup-banner{align-items:flex-start;flex-direction:column}.push-setup-banner .btn{width:100%}}`;document.head.appendChild(style);
  }

  function updateAccountOptions(){
    const client=$('#new-client-id'),account=$('#new-account-id');if(!client||!account)return;
    const selected=account.dataset.selected||account.value||'';
    account.innerHTML='<option value="">アカウントを選択</option>'+accountItems(client.value).map(x=>`<option value="${esc(x.id)}" ${x.id===selected?'selected':''}>${esc(x.name)}</option>`).join('');
    account.dataset.selected='';saveCaseDraft();
  }

  function navHtmlExtended(){
    const items=[['dashboard','ホーム'],['jobs','担当案件'],['board','案件を探す'],['dm','DM'],['notifications','通知'],['schedule','スケジュール'],['manuals','マニュアル'],['invoices',isExternal()?'支払い案内':'請求書'],['settings','登録情報'],['mobile-setup','スマホ通知'],['guide','使い方ガイド'],['suggestion','匿名目安箱']];
    const work=[['dashboard','ホーム'],['jobs','担当案件'],['board','案件を探す']],communication=[['dm','DM'],['notifications','通知']],tools=[['schedule','スケジュール'],['manuals','マニュアル'],['invoices',isExternal()?'支払い案内':'請求書'],['settings','登録情報']];
    const mobile=[['dashboard','ホーム'],['jobs','案件'],['dm','DM'],['notifications','通知']];
    const open=feature.board.filter(x=>x.status==='open').length;
    const noticeCount=unreadNotificationItems().length;
    const navIcon=(key)=>({
      dashboard:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z"></path><path d="M9 21v-7h6v7"></path></svg>',
      board:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"></circle><path d="m20 20-4.2-4.2"></path></svg>',
      jobs:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="17" rx="2"></rect><path d="M8 9h8M8 13h8M8 17h5"></path></svg>',
      notifications:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"></path><path d="M10 21h4"></path></svg>',
      dm:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16v12H9l-5 4z"></path><path d="M8 9h8M8 13h5"></path></svg>',
      schedule:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"></rect><path d="M7 3v4M17 3v4M3 10h18"></path></svg>',
      manuals:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h10a4 4 0 0 1 4 4v12H9a4 4 0 0 0-4 1z"></path><path d="M5 4v17"></path></svg>',
      invoices:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3h9l4 4v14H6z"></path><path d="M15 3v5h5M9 13h6M9 17h6"></path></svg>',
      settings:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.3 2.3-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5v.2h-3.2v-.2a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1L6 17l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H4.7v-3.2h.2a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L6 7.8 8.3 5.5l.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.5v-.2h3.2v.2a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1 2.3 2.3-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.5 1h.2V14h-.2a1.7 1.7 0 0 0-1.4 1z"></path></svg>',
      guide:'<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"></circle><path d="M9.5 9a2.5 2.5 0 1 1 3.8 2.1c-.8.5-1.3.9-1.3 1.9M12 17h.01"></path></svg>',
      suggestion:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v11H9l-4 4z"></path><path d="M8 9h8M8 12h5"></path></svg>'
      ,"mobile-setup":'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2" width="12" height="20" rx="2"></rect><path d="M10 18h4M12 6v7M9 10l3 3 3-3"></path></svg>'
    }[key]||'');
    const dmCount=dmUnreadCount();
    const button=([k,l])=>`<button type="button" class="btn editor-nav-button ${k==='board'?'accept-entry ':''}${k==='notifications'||k==='dm'?'notification-button ':''}${view===k?'active':''}" aria-current="${view===k?'page':'false'}" onclick="setView('${k}')"><span class="editor-nav-icon">${navIcon(k)}</span><span>${l}</span>${k==='board'&&open?` <span class="accept-count" aria-label="公開案件 ${open}件">${open}</span>`:''}${k==='notifications'&&noticeCount?` <span class="notification-count" aria-label="未対応通知 ${noticeCount}件">${noticeCount}</span>`:''}${k==='dm'&&dmCount?` <span class="notification-count" aria-label="未読DM ${dmCount}件">${dmCount}</span>`:''}</button>`;
    const more=items.filter(([k])=>!mobile.some(([primary])=>primary===k));
    const moreMenu=`<details class="editor-nav-more"><summary class="btn editor-nav-button ${more.some(([k])=>view===k)?'active':''}" aria-label="その他のメニューを開く"><span class="editor-nav-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"></circle><circle cx="12" cy="12" r="1.5"></circle><circle cx="19" cy="12" r="1.5"></circle></svg></span><span>その他</span></summary><div class="editor-nav-more-menu">${more.map(button).join('')}</div></details>`;
    const desktop=`<nav class="nav editor-nav-desktop" aria-label="編集者ワークスペース"><div class="editor-sidebar-head"><div class="editor-sidebar-brand"><img src="./editflow-logo.svg" alt="EditFlow"></div><span>案件と連絡をここで管理</span></div><div class="editor-sidebar-section"><div class="editor-sidebar-label">案件管理</div>${work.map(button).join('')}</div><div class="editor-sidebar-section"><div class="editor-sidebar-label">コミュニケーション</div>${communication.map(button).join('')}</div><div class="editor-sidebar-section"><div class="editor-sidebar-label">ツール</div>${tools.map(button).join('')}</div><div class="editor-sidebar-footer">${button(['guide','使い方ガイド'])}${button(['suggestion','匿名目安箱'])}</div></nav>`;
    return`${desktop}<nav class="editor-nav-mobile" aria-label="編集者メニュー（モバイル）">${mobile.map(button).join('')}${moreMenu}</nav>`;
  }

  function dashboardExtended(){
    const active=jobs.filter(activeJob),overdue=active.filter(j=>editorWorkIsOverdue(j)),review=active.filter(j=>['初稿提出済み','修正稿提出済み','D確認OK','初稿完成','確認待ち','修正中','FB待ち'].includes(j.status)),payable=activeAuthorization(new Date().toISOString().slice(0,7))?.jobIds?.length||0,priority=editorJobSortByDeadline([...overdue,...active.filter(j=>j.blocker)].filter((j,i,a)=>a.findIndex(x=>x.id===j.id)===i)).slice(0,6);
    const next=editorJobSortByDeadline([...overdue,...active.filter(j=>j.blocker),...active]).find(Boolean);
    const nextAction=next?`<section class="card editor-primary-action"><span class="editor-action-kicker">最優先</span><div class="section-title"><h2>今日、次にすること</h2><span class="editor-deadline-chip">${esc(editorDeadlineLabel(next))}</span></div><b class="editor-action-title">${esc(editorNotificationTitle(next))}</b><div class="editor-current-state"><span>現在の進捗</span><b>${esc(editorWorkflowLabel(editorWorkflow(next).stage,next.status))}</b></div><div class="editor-next-instruction"><span>次にすること</span><p>${esc(editorWaitMessage(next)||nextEditorJobAction(next)?.[1]||'案件の詳細を確認してください。')}</p></div><div class="actions"><button class="btn primary" type="button" data-preview-safe onclick="openEditorJob('${esc(next.id)}')">この案件を開く</button></div></section>`:`<section class="card editor-primary-action"><span class="editor-action-kicker">今日の確認</span><div class="section-title"><h2>今日、次にすること</h2></div><b class="editor-action-title">進行中の案件はありません</b><div class="editor-next-instruction"><span>次にすること</span><p>募集中の案件を確認するか、派遣先から直接届いた案件を担当案件で登録してください。</p></div><div class="actions"><button class="btn primary" type="button" data-preview-safe onclick="setView('board')">案件を探す</button></div></section>`;
    const billingMetric=isExternal()?'<div class="card metric"><span>契約・支払い</span><b style="font-size:14px">ディレクター管理</b></div>':`<div class="card metric"><span>今月の請求候補</span><b>${payable}</b></div>`;
    const attention=[...overdue,...active.filter(j=>j.blocker),...active].filter((j,i,a)=>a.findIndex(x=>x.id===j.id)===i).slice(0,8);
    const attentionRail=attention.length?`<section class="editor-home-rail" aria-label="要対応の案件"><div class="editor-home-rail-head"><b>要対応</b><span>横にスワイプして確認</span></div><div class="editor-home-chips">${attention.map(job=>`<button type="button" class="editor-home-chip" onclick="openEditorJob('${esc(job.id)}')"><span class="editor-home-chip-state">${esc(editorWorkflowLabel(editorWorkflow(job).stage,job.status))}</span><b>${esc(editorNotificationTitle(job))}</b><small>${esc(editorDeadlineLabel(job))}</small></button>`).join('')}</div></section>`:'';
    const base=`${pageHead('ホーム','今日、次にすることだけを確認します。')}${attentionRail}${nextAction}<div class="editor-home-stats"><div class="card metric"><span>進行中</span><b>${active.length}</b></div><div class="card metric"><span>期限超過</span><b style="color:var(--red)">${overdue.length}</b></div><div class="card metric"><span>確認・修正</span><b>${review.length}</b></div>${billingMetric}</div><section class="section editor-home-feed"><div class="section-title"><h2>優先して確認する案件</h2><span>詳細は親案件を開いて確認</span></div><div class="editor-job-list">${editorGroupJobs(priority).map(group=>editorGroupHtml(group,'priority')).join('')||'<div class="card empty">優先して確認する案件はありません</div>'}</div></section>`;
    const open=feature.board.filter(x=>x.status==='open').length;
    const availability=feature.schedules.find(x=>x.id===portalUid());
    const intro=`<details class="section"><summary class="muted" style="cursor:pointer">初めて使う方へ</summary><div class="feature-grid two" style="margin-top:8px"><div class="card notice"><b>${isExternal()?'外部編集者':'mono.create 直接契約編集者'}</b><div class="muted">${isExternal()?'担当ディレクターから依頼された案件と、その案件の連絡だけを表示します。単価・請求額・利益は表示しません。':'クライアントへの請求額・利益・他の編集者の報酬は表示しません。'}</div><button class="btn small" type="button" onclick="setView('guide')">使い方ガイドを開く</button></div><div class="card"><div class="muted">応募できる編集代行案件</div><b style="font-size:24px">${open}</b><div class="muted">${availability?.available?`編集できる期間 ${esc(availability.fromDate||'')} 〜 ${esc(availability.toDate||'')}`:'スケジュールは未登録です'}</div></div></div></details>`;
    return base+intro;
  }

  function jobFormExtended(){
    const d=readCaseDraft(),sharedDate=Object.prototype.hasOwnProperty.call(d,'sharedDate')?d.sharedDate:localDate(),deliveryDate=d.deliveryDate||d.deadline||'',catalog=feature.catalog.filter(x=>x.active!==false),accounts=accountItems(d.clientId||'');
    if(!catalog.length){const guidance=isExternal()?'担当ディレクターまたはオーナーが、この編集者へクライアントとアカウントを共有すると表示されます。':'オーナーがクライアントとアカウントを登録・同期すると、ここから「編集者派遣」の案件を追加できます。';return`<div class="card catalog-empty"><b>案件登録用のクライアントがまだ共有されていません。</b><div>${guidance}</div></div>`;}
    return`<details class="card dispatch-create"><summary>＋ 編集者派遣の案件を追加</summary><p class="muted">派遣先クライアントから直接届いた案件だけを登録します。親案件に「9月分」などを入れ、子案件に各動画名を追加してください。上の「案件を探す」で受ける編集代行案件は、ここには入力しません。</p><div class="form-grid"><div class="field"><label for="new-client-id">クライアント *</label><select id="new-client-id" onchange="updateAccountOptions()"><option value="">クライアントを選択</option>${catalog.map(x=>`<option value="${esc(x.id)}" ${x.id===d.clientId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field"><label for="new-account-id">アカウント名 *</label><select id="new-account-id" data-selected="${esc(d.accountId||'')}"><option value="">アカウントを選択</option>${accounts.map(x=>`<option value="${esc(x.id)}" ${x.id===d.accountId?'selected':''}>${esc(x.name)}</option>`).join('')}</select></div><div class="field full"><label for="new-case">親案件名</label><input id="new-case" maxlength="120" value="${esc(d.caseName||'')}" placeholder="例：2026年9月分"></div><div class="field"><label for="new-parent-request">親案件共通の台本・依頼URL（任意）</label><input id="new-parent-request" type="url" value="${esc(d.parentRequestUrl||'')}" placeholder="全ての子案件で使うリンク"></div><div class="field"><label for="new-parent-source">親案件共通の素材URL（任意）</label><input id="new-parent-source" type="url" value="${esc(d.parentSourceUrl||'')}" placeholder="全ての子案件で使うリンク"></div><div class="field"><label for="new-parent-manuals">親案件共通のマニュアル（任意）</label><select id="new-parent-manuals" multiple size="3">${editorManualOptions(d.manualIds||[])}</select></div><div class="field"><label for="new-parent-caution">親案件共通の注意事項（任意）</label><textarea id="new-parent-caution" maxlength="2000" placeholder="編集者に必ず伝えたいことを入力します。">${esc(d.caution||'')}</textarea></div><div class="field"><label for="new-shared">受注日</label><input id="new-shared" type="date" value="${esc(sharedDate)}"></div><div class="field"><label class="check"><input id="new-urgent" type="checkbox" ${d.urgent?'checked':''}> 緊急案件として登録</label></div><div class="field full" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><b>子案件</b><button class="btn small" type="button" onclick="editorAddDispatchSubcase()">＋ 子案件を追加</button></div><div class="field full dispatch-subcase-scroll"><div id="new-dispatch-subcases" class="dispatch-subcase-list">${dispatchSubcaseRowHtml(id(),{title:d.title||'',editorDraftDate:d.editorDraftDate||'',clientDraftDate:d.clientDraftDate||'',thumbnailDate:d.thumbnailDate||'',deliveryDate,requestUrl:d.requestUrl||'',sourceUrl:d.sourceUrl||'',instructions:d.instructions||'',editorPayAmount:d.editorPayAmount||''})}</div><div class="dispatch-subcase-add"><button class="btn primary" type="button" onclick="editorAddDispatchSubcase()">＋ 子案件を追加</button></div></div></div><div class="actions"><button class="btn primary job-primary" type="button" onclick="createJob()">編集者派遣に案件を登録</button></div></details>`;
  }

  function selectedCaseManualIds(select){return[...(select?.selectedOptions||[])].map(option=>String(option.value||'').trim()).filter(Boolean).filter((value,index,values)=>values.indexOf(value)===index).slice(0,20)}
  function editorManualOptions(selected=[]){const ids=new Set(Array.isArray(selected)?selected.map(String):[]);return(feature.manuals||[]).map(manual=>({id:String(manual.id||''),title:String(manual.title||''),required:!!manual.required})).filter(manual=>manual.id&&manual.title).sort((a,b)=>a.title.localeCompare(b.title,'ja')).map(manual=>`<option value="${esc(manual.id)}" ${ids.has(manual.id)?'selected':''}>${esc(manual.title)}${manual.required?'（必読）':''}</option>`).join('')}
  function dispatchSubcaseRowHtml(subcaseId=id(),value={}){const setter=value.editorDraftDateSetter==='editor'?'editor':'creator',payHelp=isExternal()?'この金額はオーナーへ参考額として伝わります。mono.createからの精算先は担当ディレクターで、あなたへの支払いは担当ディレクターとの契約に従います。':'この子案件で、あなたに支払われる金額です。';return`<section class="dispatch-subcase" data-subcase-id="${esc(subcaseId)}" style="border:1px solid var(--border);border-radius:10px;padding:10px;background:var(--card2)"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-bottom:8px"><b>子案件</b><button type="button" class="btn small" onclick="editorRemoveDispatchSubcase(this)">削除</button></div><div class="form-grid"><div class="field full"><label>個別動画・案件名 *</label><input class="new-subcase-title" maxlength="120" value="${esc(value.title||'')}" placeholder="例：ショート動画 03"></div><div class="field"><label>編集者支払額（円） *</label><input class="new-subcase-editor-pay" type="number" min="1" step="1" inputmode="numeric" value="${esc(value.editorPayAmount||'')}" placeholder="例：3000"><div class="muted">${payHelp}</div></div><div class="field"><label>編集者初稿日の設定者</label><select class="new-subcase-editor-draft-setter" onchange="editorDispatchDraftSetterChanged(this)"><option value="creator" ${setter==='creator'?'selected':''}>案件追加者が設定</option><option value="editor" ${setter==='editor'?'selected':''}>担当編集者が設定</option></select></div><div class="field"><label>編集者 初稿</label><input class="new-subcase-editor-draft" type="date" value="${esc(value.editorDraftDate||'')}" ${setter==='editor'?'disabled':''}><div class="muted new-subcase-editor-draft-help">${setter==='editor'?'担当編集者が受託後に設定します。':'案件追加時に設定します。'}</div></div><div class="field"><label>クライアント 初稿</label><input class="new-subcase-client-draft" type="date" value="${esc(value.clientDraftDate||'')}"></div><div class="field"><label>サムネイル納品日</label><input class="new-subcase-thumbnail" type="date" value="${esc(value.thumbnailDate||'')}"></div><div class="notice" style="box-shadow:none"><b>納品日は案件追加時には入力しません</b><br>先方OK後、担当編集者が実際に納品した日と納品先URLを記録すると報酬対象になります。</div><div class="field"><label>この子案件だけのマニュアル（任意）</label><select class="new-subcase-manuals" multiple size="3">${editorManualOptions(value.manualIds||[])}</select><div class="muted">選ばない場合は親案件の共通マニュアルを表示します。</div></div><div class="field"><label>この子案件だけの注意事項（任意）</label><textarea class="new-subcase-caution" maxlength="2000" placeholder="選ばない場合は親案件の注意事項を表示します。">${esc(value.caution||'')}</textarea></div><div class="field"><label>この子案件だけの台本・依頼URL（任意）</label><input class="new-subcase-request" type="url" value="${esc(value.requestUrl||'')}" placeholder="空欄なら親案件の共通リンクを使用"></div><div class="field"><label>この子案件だけの素材URL（任意）</label><input class="new-subcase-source" type="url" value="${esc(value.sourceUrl||'')}" placeholder="空欄なら親案件の共通リンクを使用"></div><div class="field full"><label>依頼内容・編集指示 *</label><textarea class="new-subcase-instructions" maxlength="3000">${esc(value.instructions||'')}</textarea></div></div></section>`}
  function dispatchSubcaseRows(){return[...document.querySelectorAll('#new-dispatch-subcases .dispatch-subcase')]}
  function dispatchDraftSetterChanged(select){const row=select?.closest?.('.dispatch-subcase'),input=row?.querySelector('.new-subcase-editor-draft'),help=row?.querySelector('.new-subcase-editor-draft-help'),editorSets=select?.value==='editor';if(!input)return;input.disabled=editorSets;if(editorSets)input.value='';if(help)help.textContent=editorSets?'担当編集者が受託後に設定します。':'案件追加時に設定します。'}
  function addDispatchSubcase(){const list=$('#new-dispatch-subcases');if(!list)return;if(dispatchSubcaseRows().length>=50)return toast('子案件は1回の登録につき50件までです');list.insertAdjacentHTML('beforeend',dispatchSubcaseRowHtml());list.lastElementChild?.querySelector('.new-subcase-title')?.focus()}
  function removeDispatchSubcase(button){const rows=dispatchSubcaseRows();if(rows.length<=1)return toast('子案件は1件以上入力してください');button?.closest('.dispatch-subcase')?.remove()}
  function readDispatchSubcases(){const rows=dispatchSubcaseRows();if(!rows.length)return{error:'子案件を1件以上入力してください',items:[]};const items=[];for(const row of rows){const title=row.querySelector('.new-subcase-title')?.value.trim()||'',editorPayAmount=positiveYen(row.querySelector('.new-subcase-editor-pay')?.value),editorDraftDateSetter=row.querySelector('.new-subcase-editor-draft-setter')?.value==='editor'?'editor':'creator',schedule={sharedDate:$('#new-shared')?.value||'',editorDraftDate:editorDraftDateSetter==='editor'?'':(row.querySelector('.new-subcase-editor-draft')?.value||''),clientDraftDate:row.querySelector('.new-subcase-client-draft')?.value||'',thumbnailDate:row.querySelector('.new-subcase-thumbnail')?.value||'',deliveryDate:''},instructions=row.querySelector('.new-subcase-instructions')?.value.trim()||'',manualIds=selectedCaseManualIds(row.querySelector('.new-subcase-manuals')),caution=row.querySelector('.new-subcase-caution')?.value.trim()||'',requestUrl=row.querySelector('.new-subcase-request')?.value.trim()||'',sourceUrl=row.querySelector('.new-subcase-source')?.value.trim()||'';if(!title||!instructions)return{error:'すべての子案件に、案件名・編集者支払額・依頼内容を入力してください',items:[]};if(editorPayAmount===null)return{error:`「${title}」：編集者支払額は1円以上の整数で入力してください`,items:[]};if(editorDraftDateSetter==='creator'&&!schedule.editorDraftDate)return{error:`「${title}」：案件追加者が設定する場合は編集者初稿日を入力してください`,items:[]};const dateError=scheduleError(schedule);if(dateError)return{error:`「${title}」：${dateError}`,items:[]};if((requestUrl&&!safeUrl(requestUrl))||(sourceUrl&&!safeUrl(sourceUrl)))return{error:`「${title}」：URLは https:// または http:// で入力してください`,items:[]};items.push({id:row.dataset.subcaseId||id(),title,editorPayAmount,editorDraftDateSetter,schedule,instructions,manualIds,caution,requestUrl,sourceUrl})}return{error:'',items}}

  function editorJobBucket(job){return['完了','キャンセル'].includes(String(job?.status||''))?'completed':'active'}
  function editorGroupText(value){return String(value||'').normalize('NFKC').replace(/[\s\u3000]+/g,' ').trim()}
  function editorWorkflow(job){
    const raw=job?.workflow&&typeof job.workflow==='object'?job.workflow:{},status=String(job?.status||''),stage=['editing','director_review','client_submission','client_review','delivered'].includes(raw.stage)?raw.stage:(status==='完了'?'delivered':['初稿提出済み','修正稿提出済み','FB待ち'].includes(status)?'director_review':status==='D確認OK'?'client_submission':status==='確認待ち'?'client_review':'editing');
    return{round:Math.max(1,Number(raw.round)||1),stage,progressEvents:Array.isArray(job?.progressEvents)?job.progressEvents:[]};
  }
  function editorWorkflowLabel(stage,status=''){if(status==='FB待ち')return'mono.create FB中';if(status==='確認待ち')return'先方確認中';if(status==='修正中')return'修正中';return({editing:'編集作業中',director_review:'D確認待ち',client_submission:'先方へ提出中',client_review:'先方確認中',delivered:'納品完了'})[stage]||'編集作業中'}
  function editorNextOwner(job){const stage=editorWorkflow(job).stage;return({editing:'あなた',director_review:'ディレクター',client_submission:'ディレクター',client_review:'クライアント',delivered:'対応不要'})[stage]||'あなた'}
  function editorWaitMessage(job){const status=String(job?.status||'');if(status==='FB待ち')return'mono.create FB中です。確認・修正指示をお待ちください。';if(status==='確認待ち')return'先方確認中です。修正指示またはOKの連絡をお待ちください。';return({director_review:'D確認待ちです。ディレクターが確認します。',client_submission:'ディレクターが先方へ提出中です。',client_review:'先方確認中です。修正指示またはOKの連絡をお待ちください。',delivered:'納品完了です。編集者側の操作はありません。'})[editorWorkflow(job).stage]||''}
  function editorAllowedStatuses(job){
    if(editorWorkflow(job).stage!=='editing')return[String(job?.status||'')].filter(Boolean);
    const current=String(job?.status||''),allowed={未着手:['未着手','進行中'],受注済み:['受注済み','進行中'],進行中:['進行中','初稿提出済み'],編集者進行中:['編集者進行中','初稿提出済み'],初稿完成:['初稿完成','初稿提出済み'],修正中:['修正中','修正稿提出済み']}[current];
    return allowed||[current].filter(Boolean);
  }
  function editorJobParent(job){
    const explicit=editorGroupText(job?.parentCaseId||job?.linkedLegacyJobId||job?.parentJobId||job?.caseId).replace(/^legacy:/,'');
    const caseName=editorGroupText(job?.parentCaseName||job?.caseName),client=editorGroupText(job?.clientId||job?.clientDisplay),account=editorGroupText(job?.accountId||job?.accountDisplay),type=editorJobType(job);
    if(explicit)return{key:`id:${type}|${client}|${account}|${explicit}`,title:caseName||editorGroupText(job?.parentCaseName)||editorGroupText(job?.title)||'親案件',client:editorGroupText(job?.clientDisplay),account:editorGroupText(job?.accountDisplay)};
    if(caseName)return{key:`case:${type}|${client}|${account}|${caseName}`,title:caseName,client:editorGroupText(job?.clientDisplay),account:editorGroupText(job?.accountDisplay)};
    return{key:`job:${String(job?.id||'')}`,title:editorGroupText(job?.title)||'案件名未設定',client:editorGroupText(job?.clientDisplay),account:editorGroupText(job?.accountDisplay)};
  }
  function editorGroupJobs(list){
    const map=new Map();list.forEach(job=>{const parent=editorJobParent(job),group=map.get(parent.key)||{...parent,jobs:[]};group.jobs.push(job);map.set(parent.key,group)});
    return [...map.values()].map(group=>({...group,jobs:editorJobSortByAddedOrder(group.jobs)})).sort((a,b)=>editorJobSortByDeadline(a.jobs)[0]&&editorJobSortByDeadline(b.jobs)[0]?editorJobSortByDeadline(a.jobs)[0].id.localeCompare(editorJobSortByDeadline(b.jobs)[0].id):0);
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
  function groupDraftEligibleJobs(group){return(group?.jobs||[]).filter(job=>activeJob(job)&&!job.previewLegacy&&editorSetsDraftDate(job)&&!job.editorDraftDate)}
  function groupDraftPanel(group){
    const targets=groupDraftEligibleJobs(group);if(!targets.length)return'';
    return`<div class="group-draft-panel"><div class="field"><b>サブ案件の編集者初稿日をまとめて設定</b><div class="muted">初稿日が未設定のサブ案件 ${targets.length}件に、同じ日付を反映します。設定済みの日付は変更しません。</div><label>編集者 初稿日<input class="group-editor-draft-input" type="date"></label></div><button class="btn primary small group-editor-draft-save" type="button" onclick="saveGroupEditorDraftDate(this)">まとめて保存</button></div>`;
  }
  function editorGroupHtml(group,kind='jobs'){
    const workflow=editorWorkflow(editorJobSortByDeadline(group.jobs)[0]||group.jobs[0]),meta=[group.client,group.account].filter(Boolean).join(' / '),summary=editorGroupSummary(group);
    return`<details id="editor-case-${esc(group.key)}" data-case-key="${esc(group.key)}" class="card editor-case-group"><summary aria-label="親案件 ${esc(group.title)} を開く"><span><b>${esc(group.title)}</b><small>${esc(meta||'クライアント・アカウント未設定')}</small><span class="editor-next-child">次：${esc(editorGroupNext(group))}</span></span><span class="editor-case-group-count">${esc(summary)}</span></summary>${kind==='jobs'?groupDraftPanel(group):''}<div class="editor-case-group-body">${group.jobs.map(jobCard).join('')}</div><div class="editor-workflow-hint">現在の進捗：${esc(editorWorkflowLabel(workflow.stage,group.jobs[0]?.status))} / ${workflow.round}回目</div></details>`;
  }
  function setEditorJobsListMode(mode){feature.jobsListMode=mode==='completed'?'completed':'active';render()}
  function setEditorJobsTypeFilter(type){feature.jobsTypeFilter=['all','agency','dispatch'].includes(type)?type:'all';render()}
  function selectBoardJob(jid){
    if(!feature.board.some(item=>item?.id===jid&&item.status==='open'))return;
    feature.boardSelectedId=jid;render();
  }
  function filterEditorBoardSearch(value){
    feature.boardSearch=String(value||'').slice(0,120);
    if(view==='board')render();
  }
  function jobsExtended(){
    const active=jobs.filter(j=>editorJobBucket(j)==='active'),completed=jobs.filter(j=>editorJobBucket(j)==='completed'),showCompleted=feature.jobsListMode==='completed',source=showCompleted?completed:active,visible=source.filter(j=>feature.jobsTypeFilter==='all'||editorJobType(j)===feature.jobsTypeFilter),ordered=showCompleted?sortNewest(visible):editorJobSortByDeadline(visible);
    const empty=showCompleted
      ?'<div class="card empty"><b>完了済みの担当案件は0件です</b><br><span class="muted">案件を納品完了にすると、ここへ移動します。</span></div>'
      :'<div class="card empty"><b>進行中の担当案件はありません</b><br><span class="muted">編集代行は「案件を探す」から受けると表示されます。編集者派遣の案件は、この画面から登録できます。</span></div>';
    return`${pageHead('担当案件','親案件を開くと、担当している子案件を確認・更新できます。')}<section class="section"><div class="section-title"><h2>${showCompleted?'完了した案件':'進行中の案件'}</h2><span>${visible.length}件</span></div><div class="job-list-tabs" role="tablist" aria-label="担当案件の表示切り替え"><button type="button" data-preview-safe class="btn job-list-tab ${showCompleted?'':'active'}" role="tab" aria-selected="${!showCompleted}" aria-current="${!showCompleted?'page':'false'}" onclick="setEditorJobsListMode('active')">進行中 <span class="accept-count">${active.length}</span></button><button type="button" data-preview-safe class="btn job-list-tab ${showCompleted?'active':''}" role="tab" aria-selected="${showCompleted}" aria-current="${showCompleted?'page':'false'}" onclick="setEditorJobsListMode('completed')">完了 <span class="accept-count">${completed.length}</span></button></div><div class="job-type-filters" aria-label="案件種別で絞り込み"><button type="button" data-preview-safe class="btn job-type-filter ${feature.jobsTypeFilter==='all'?'active':''}" aria-pressed="${feature.jobsTypeFilter==='all'}" onclick="setEditorJobsTypeFilter('all')">すべて</button><button type="button" data-preview-safe class="btn job-type-filter ${feature.jobsTypeFilter==='agency'?'active':''}" aria-pressed="${feature.jobsTypeFilter==='agency'}" onclick="setEditorJobsTypeFilter('agency')">編集代行</button><button type="button" data-preview-safe class="btn job-type-filter ${feature.jobsTypeFilter==='dispatch'?'active':''}" aria-pressed="${feature.jobsTypeFilter==='dispatch'}" onclick="setEditorJobsTypeFilter('dispatch')">編集者派遣</button></div><div class="editor-job-list">${editorGroupJobs(ordered).map(group=>editorGroupHtml(group)).join('')||empty}</div></section>${jobFormExtended()}`;
  }

  function boardHtml(){
    const all=feature.board.filter(x=>x.status==='open').sort(byUpdated).map(x=>({...x,clientDisplay:x.clientDisplay||x.clientName||'',accountDisplay:x.accountDisplay||x.accountName||'',businessType:'edit_agency'}));
    const query=feature.boardSearch.trim().toLocaleLowerCase('ja-JP');
    const list=query?all.filter(item=>[item.title,item.caseName,item.parentCaseName,item.clientName,item.accountName,item.summary,item.instructions].join(' ').toLocaleLowerCase('ja-JP').includes(query)):all;
    const selected=list.find(item=>item.id===feature.boardSelectedId)||list[0]||null;
    const empty=`<div class="card empty board-empty"><b>現在、募集中の編集代行案件はありません</b><br><span class="muted">ここに出るのは、管理者が募集を開始した案件だけです。すでに担当している案件は「担当案件」で確認できます。</span><div class="actions" style="justify-content:center"><button class="btn primary" type="button" onclick="setView('jobs')">担当案件を開く</button></div></div>`;
    if(!selected)return`${boardWorkspaceHeader()}${empty}`;
    const requested=selected.audience==='designated'||Array.isArray(selected.eligibleUids)&&selected.eligibleUids.length===1;
    const dates=[['編集者初稿',selected.editorDraftDate],['クライアント初稿',selected.clientDraftDate],['納期（予定）',selected.deliveryDate]].filter(([,date])=>date);
    const resources=editorResourceLinks(selected)||'<div class="board-resource-empty">素材・資料は受託後に案件詳細から確認できます。</div>';
    const groupTitle=selected.caseName||selected.parentCaseName||'募集中の案件';
    const applicantNote=isExternal()?'担当ディレクターの募集案件です。':'公開中の編集代行案件です。';
    const siblingKey=selected.parentCaseId||selected.parentCaseName||selected.caseName||selected.id;
    const siblings=editorJobSortByAddedOrder(all.filter(item=>(item.parentCaseId||item.parentCaseName||item.caseName||item.id)===siblingKey));
    const subcaseTable=`<section class="application-subcases"><div class="application-section-head"><div><h3>子案件</h3><span>${siblings.length}件</span></div><button type="button" data-preview-safe class="btn small application-resource-jump" aria-label="素材・資料へ" onclick="document.querySelector('.application-resources')?.scrollIntoView({behavior:'smooth'})">${applicationIcon('media')}<span>素材・資料へ</span></button></div><div class="application-subcase-table" role="table" aria-label="子案件一覧"><div class="application-subcase-row application-subcase-head" role="row"><span>案件名</span><span>状況</span><span>編集者初稿</span><span>納期（予定）</span></div>${siblings.map(item=>`<button type="button" data-preview-safe class="application-subcase-row ${item.id===selected.id?'active':''}" role="row" aria-current="${item.id===selected.id?'true':'false'}" onclick="selectBoardJob('${esc(item.id)}')"><b>${esc(item.title||'案件名未設定')}</b><span><i class="application-table-status">${item.id===selected.id?'確認中':'募集中'}</i></span><span>${esc(item.editorDraftDate||'未設定')}</span><span>${esc(item.deliveryDate||'未設定')}</span></button>`).join('')}</div></section>`;
    return`${boardWorkspaceHeader()}<section class="application-workspace" aria-label="案件応募ワークスペース"><main class="application-detail application-detail-wide"><div class="application-detail-head"><div class="application-breadcrumb">案件一覧 <span>›</span> ${esc(groupTitle)}</div><div class="application-title-row"><div><h2>${esc(groupTitle)}</h2><p>${esc([selected.clientName,selected.accountName].filter(Boolean).join(' / ')||'クライアント・アカウント未設定')}</p></div><div class="application-title-tools"><span class="application-status ${requested||selected.urgent?'attention':''}">${requested?'編集リクエスト':selected.urgent?'緊急':'募集中'}</span><button type="button" data-preview-safe class="btn small" onclick="document.querySelector('.application-subcases')?.scrollIntoView({behavior:'smooth'})">子案件を見る</button></div></div></div><div class="application-info-grid"><section class="application-info"><h3>案件情報</h3><dl><div><dt>親案件</dt><dd>${esc(groupTitle)}</dd></div><div><dt>案件種別</dt><dd>編集代行</dd></div><div><dt>募集状況</dt><dd>編集者を募集中</dd></div></dl></section><section class="application-info"><h3>選択中の子案件</h3><dl>${dates.map(([label,date])=>`<div><dt>${esc(label)}</dt><dd>${esc(date)}</dd></div>`).join('')||'<div><dt>日程</dt><dd>未設定</dd></div>'}</dl></section></div>${subcaseTable}${caseCautionHtml(selected)}${caseManualCardsHtml(selected)}<section class="application-instructions"><h3>${esc(selected.title||'案件名未設定')}の編集内容</h3><p>${esc(selected.summary||selected.instructions||'案件内容は未設定です。')}</p>${selected.instructions&&selected.summary?`<p class="application-instruction-more">${esc(selected.instructions)}</p>`:''}</section><section class="application-resources"><div><h3>素材・資料</h3><span>リンクを開いて確認</span></div>${resources}</section></main><aside class="application-confirm"><div class="application-confirm-head"><span>応募前の確認</span><b>3項目</b></div><ol><li><span>1</span><div><b>日程を確認</b><p>初稿日と納期（予定）に対応できることを確認します。</p></div></li><li><span>2</span><div><b>素材・指示を確認</b><p>必要な素材と編集内容を確認してから応募します。</p></div></li><li><span>3</span><div><b>受託後に開始</b><p>受託後は担当案件に自動で追加されます。</p></div></li></ol><div class="application-privacy"><b>表示されない情報</b><span>クライアント請求額と利益は表示しません。</span></div><button class="btn primary claim-button" type="button" onclick="claimBoardJob('${esc(selected.id)}')">この案件を受ける</button><small>${applicantNote}</small></aside></section>`;
  }

  function caseCautionHtml(job){const caution=String(job?.caution||'').trim();return caution?`<section class="job-urgent-note danger" aria-label="案件の注意事項"><b>注意事項</b><br>${esc(caution)}</section>`:''}
  function caseManualCardsHtml(job){const manualIds=[...new Set((Array.isArray(job?.manualIds)?job.manualIds:[]).map(String))].slice(0,20),manuals=manualIds.map(id=>feature.manuals.find(manual=>String(manual.id||'')===id)).filter(Boolean);if(!manuals.length)return'';return`<section class="application-resources" aria-label="この案件に紐づくマニュアル"><div><h3>この案件のマニュアル</h3><span>マニュアル保管庫で確認</span></div><div class="feature-grid two">${manuals.map(manual=>`<article class="card"><b>${esc(manual.title||'マニュアル')}</b><div class="manual-meta">${manual.required?'必読':'参考'} ・ version ${esc(manual.version||'1')}</div><button type="button" class="btn small" onclick="setView('manuals')">マニュアルを開く</button></article>`).join('')}</div></section>`}

  function boardWorkspaceHeader(){
    const preview=ADMIN_PREVIEW?'<span class="application-preview-chip">確認モード</span>':'';
    return`<div class="application-page-head"><div><div class="application-breadcrumb">案件 <span>›</span> 募集中の案件</div><h1>案件を探す</h1><p>日程・素材を確認して受託。</p></div><div class="application-header-marks" aria-label="応募前に確認する項目">${applicationIcon('calendar')}${applicationIcon('media')}${applicationIcon('check')}${preview}</div></div>`;
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
  function unreadNotificationItems(){const read=notificationReadIds();return notificationItems().filter(item=>!read.has(item.id))}
  function notificationsHtml(){
    const items=unreadNotificationItems();
    return`${pageHead('通知','初稿日・納期（予定）・案件内の連絡を確認')}${deviceNotificationHtml()}<div class="card"><div class="section-title"><h2>未読の通知</h2><span>${items.length}件</span></div><div class="notification-list">${items.map(x=>`<div data-preview-safe class="notification-item"><button type="button" class="notification-open" aria-label="${esc(`${x.title}、${x.detail}、${x.timing}`)}を開く" onclick="openEditorNotification('${esc(x.id)}','${esc(x.target)}','${esc(x.jobId||'')}')"><span class="app-sr-only">通知：</span><span class="notification-copy"><b>${esc(x.title)}</b><span>${esc(x.detail)}</span></span><span class="pill ${x.timing.includes('超過')?'red':''}">${esc(x.timing)}</span></button><button class="btn small notification-read" type="button" aria-label="${esc(x.title)}を既読にする" onclick="markEditorNotificationRead('${esc(x.id)}')">既読</button></div>`).join('')||'<div class="empty">未読の通知はありません</div>'}</div>${items.length?'<div class="actions"><button class="btn small" type="button" onclick="markEditorNotificationsRead()">すべて既読にする</button></div>':''}<div class="muted" style="margin-top:9px">既読にしても案件やメッセージは削除されません。案件の進捗は「担当案件」でいつでも確認できます。確認待ち・修正中・納品済みの案件は、期限超過として表示しません。</div></div>`;
  }
  function openEditorNotification(id,target){
    const item=notificationItems().find(x=>x.id===id);if(item)markEditorNotificationRead(id,false);
    view=target==='board'?'board':'jobs';render();
    if(item?.jobId&&view==='jobs')setTimeout(()=>openEditorJob(item.jobId),50);
  }
  function openEditorJob(jobId){
    const job=jobs.find(x=>x.id===jobId);if(!job)return;
    if(view!=='jobs'){view='jobs';render();return setTimeout(()=>openEditorJob(jobId),50)}
    ensureJobMessages(jobId);
    const group=document.querySelector(`[data-case-key="${CSS.escape(editorJobParent(job).key)}"]`);if(group)group.open=true;
    const card=document.querySelector(`#editor-job-${CSS.escape(jobId)}`)||document.getElementById(`job-editor-draft-${jobId}`)?.closest('article');
    card?.scrollIntoView({behavior:'smooth',block:'start'});
  }
  function markEditorNotificationRead(id,shouldRender=true){if(!id)return;const read=notificationReadIds();read.add(id);saveNotificationReadIds(read);if(shouldRender)render()}
  function markEditorNotificationsRead(){const read=notificationReadIds();notificationItems().forEach(x=>read.add(x.id));saveNotificationReadIds(read);render()}

  function pushClient(){return window.EditorPush||null}
  function pushStatusCopy(status){
    if(status?.ready)return 'この端末は、アプリを閉じていてもDMの通知を受け取れる状態です。';
    return status?.reason||'スマホ通知の状態を確認しています。';
  }
  async function refreshEditorPushStatus(shouldRender=false){
    const api=pushClient(),uid=user?.uid||'';
    if(DEMO||ADMIN_PREVIEW||!api||!db||!uid||feature.pushStatusLoading)return;
    feature.pushStatusLoading=true;
    try{feature.pushStatus=await api.status({db,uid});feature.pushStatusFor=uid}catch(error){console.warn('push status',error);feature.pushStatus={ready:false,reason:'通知の状態を確認できませんでした。'};feature.pushStatusFor=uid}finally{feature.pushStatusLoading=false}
    if(shouldRender&&user?.uid===uid)render();
  }
  function pushSetupBannerHtml(){
    if(ADMIN_PREVIEW||DEMO||feature.pushStatus?.ready)return '';
    const copy=pushStatusCopy(feature.pushStatus);
    return `<section class="push-setup-banner" aria-label="スマホ通知の設定"><div><b>スマホ通知の設定がまだ完了していません</b><span>${esc(copy)}</span></div><button class="btn primary small" type="button" onclick="setView('mobile-setup')">設定を開く</button></section>`;
  }
  function mobileSetupHtml(){
    const status=feature.pushStatus,statusCopy=pushStatusCopy(status),canEnable=!!pushClient()&&!DEMO&&!ADMIN_PREVIEW;
    const actions=status?.ready
      ?`<div class="push-actions"><button class="btn small" type="button" onclick="refreshEditorPushSetup()">状態を再確認</button><button class="btn danger small" type="button" onclick="disableEditorPushNotifications()">この端末の通知をオフにする</button></div>`
      :`<div class="push-actions"><button class="btn primary" type="button" ${canEnable?'':'disabled'} onclick="enableEditorPushNotifications()">通知を有効にする</button><button class="btn small" type="button" onclick="refreshEditorPushSetup()">状態を再確認</button></div>`;
    return `${pageHead('スマホ通知の設定','iPhoneを閉じている間もDMの通知を受け取るための設定です。')}<section class="card push-setup-card"><h2>最初に一度だけ設定します</h2><ol><li>iPhoneでは Safari または Chrome でこのアプリを開き、サインインします。</li><li>共有メニューから「ホーム画面に追加」を選びます。</li><li>追加したアプリアイコンから、もう一度このアプリを開きます。</li><li>下の「通知を有効にする」を押して、通知を許可します。</li></ol><div class="push-status ${status?.ready?'ready':''}"><b>${status?.ready?'✓ 設定完了':'現在の状態'}</b><br>${esc(statusCopy)}</div>${actions}<p class="muted" style="margin:12px 0 0">通知本文にはDMや案件の内容を表示しません。通知を押すとアプリのDM画面を開きます。</p></section>`;
  }
  async function enableEditorPushNotifications(){
    if(DEMO||ADMIN_PREVIEW)return toast('確認画面では通知を変更できません');
    const api=pushClient();if(!api||!db||!user?.uid)return toast('通知の準備ができていません');
    try{const status=await api.enable({db,uid:user.uid});feature.pushStatus=status;feature.pushStatusFor=user.uid;render();toast(status?.ready?'通知を有効にしました':'通知の登録を完了できませんでした')}catch(error){console.warn('push enable',error);await refreshEditorPushStatus(false);render();toast('通知を有効にできませんでした。SafariまたはChromeでホーム画面に追加してからお試しください')}
  }
  async function disableEditorPushNotifications(){
    if(DEMO||ADMIN_PREVIEW)return toast('確認画面では通知を変更できません');
    const api=pushClient();if(!api||!db||!user?.uid)return;
    try{await api.disable({db,uid:user.uid});feature.pushStatus={ready:false,reason:'この端末の通知をオフにしました。'};feature.pushStatusFor=user.uid;render();toast('この端末の通知をオフにしました')}catch(error){console.warn('push disable',error);toast('通知をオフにできませんでした')}
  }

  function deviceNotificationHtml(){
    if(pushClient()){
      const status=feature.pushStatus,copy=pushStatusCopy(status),action=status?.ready?'<button class="btn small" type="button" onclick="setView(\'mobile-setup\')">設定を確認</button>':'<button class="btn primary" type="button" onclick="setView(\'mobile-setup\')">スマホ通知を設定</button>';
      return`<section class="card device-notification-card"><div><h2>スマホ通知</h2><p>${esc(copy)}</p></div>${action}</section>`;
    }
    const supported=typeof Notification!=='undefined',permission=supported?Notification.permission:'unsupported',installed=!!(window.matchMedia?.('(display-mode: standalone)').matches||navigator.standalone);
    const copy=!supported?'このブラウザは端末通知に対応していません。':permission==='granted'?`端末通知はオンです。アプリを開いている間の新着DMを知らせます。${installed?'ホーム画面からアプリとして開けます。':'iPhoneはSafariの共有から「ホーム画面に追加」するとアプリのように開けます。'}`:permission==='denied'?'端末側で通知が拒否されています。SafariまたはChromeの設定から通知を許可してください。':'アプリを開いている間の新着DMを、端末通知で知らせます。';
    const action=permission==='default'?'<button class="btn primary" type="button" onclick="enableEditorDeviceNotifications()">端末通知をオンにする</button>':'';
    return`<section class="card device-notification-card"><div><h2>端末通知</h2><p>${esc(copy)}</p></div>${action}</section>`;
  }

  async function enableEditorDeviceNotifications(){
    if(typeof Notification==='undefined')return toast('このブラウザは端末通知に対応していません');
    try{const permission=await Notification.requestPermission();render();toast(permission==='granted'?'端末通知をオンにしました':'端末通知はオンになっていません')}catch(error){console.warn(error);toast('端末通知の設定を開けませんでした')}
  }

  function dmApi(){return window.EditflowDM||null}
  function dmUnreadCount(){return feature.dmThreads.filter(thread=>thread.unread).length}
  function dmPeer(uid){return feature.dmPeers.find(peer=>peer.uid===uid)||null}
  function dmThreadPeer(thread){return dmPeer(thread?.counterpartUid)||{uid:thread?.counterpartUid||'',name:thread?.counterpartName||'メンバー',roles:[]}}
  function dmInitial(name){return String(name||'?').trim().slice(0,2)}
  function dmRole(peer){return peer?.roles?.includes('動画編集ディレクター')?'編集ディレクター':peer?.editorKind==='external'?'外部編集者':'編集者'}
  function dmTime(value){const ms=stamp(value);if(!ms)return'';const date=new Date(ms),today=new Date();return date.toDateString()===today.toDateString()?date.toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):date.toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'})}
  function dmThreadForPeer(uid){return feature.dmThreads.find(thread=>thread.counterpartUid===uid)||null}

  function dmHtml(){
    if(ADMIN_PREVIEW)return`${pageHead('DM','1対1の連絡')}<div class="card empty"><b>DMはオーナー本人の画面で確認します</b><br><span class="muted">他の編集者の確認画面からは、DMの送信・既読変更はできません。</span></div>`;
    const activePeer=dmPeer(feature.dmActivePeerUid)||dmThreadPeer(feature.dmThreads.find(x=>x.id===feature.dmActiveThreadId)),activeName=activePeer?.name||'',existingPeerIds=new Set(feature.dmThreads.map(x=>x.counterpartUid));
    const threadRows=feature.dmThreads.map(thread=>{const peer=dmThreadPeer(thread);return`<button data-preview-safe class="dm-person ${feature.dmActiveThreadId===thread.id?'active':''}" type="button" onclick="openDirectMessage('${esc(peer.uid)}','${esc(thread.id)}')"><span class="dm-avatar">${esc(dmInitial(peer.name))}</span><span class="dm-person-copy"><b>${esc(peer.name)}</b><span>${esc(thread.lastMessagePreview||'まだメッセージはありません')}</span></span><span class="dm-person-meta"><time>${esc(dmTime(thread.lastMessageAt||thread.updatedAt))}</time>${thread.unread?'<span class="dm-unread-dot" aria-label="未読"></span>':''}</span></button>`}).join('');
    const newPeers=feature.dmPeers.filter(peer=>!existingPeerIds.has(peer.uid)).map(peer=>`<button data-preview-safe class="dm-person" type="button" onclick="openDirectMessage('${esc(peer.uid)}','')"><span class="dm-avatar">${esc(dmInitial(peer.name))}</span><span class="dm-person-copy"><b>${esc(peer.name)}</b><span>${esc(dmRole(peer))} ・ 新しいDM</span></span><span aria-hidden="true">›</span></button>`).join('');
    const messages=feature.dmMessages.map(message=>`<div class="dm-message ${message.senderUid===user?.uid?'mine':''}"><span class="dm-avatar">${esc(dmInitial(message.senderName))}</span><div><div class="dm-message-head"><b>${esc(message.senderName||'メンバー')}</b><time>${esc(dmTime(message.createdAt))}</time></div><div class="dm-message-body">${esc(message.body||'')}</div></div></div>`).join('');
    const inbox=`<aside class="dm-inbox"><div class="dm-inbox-head"><div><h2>DM</h2><span>未読 ${dmUnreadCount()}件</span></div>${dmUnreadCount()?'<button class="btn small" type="button" onclick="markAllDirectMessagesRead()">すべて既読</button>':''}</div><div class="dm-list">${feature.dmLoading?'<div class="empty">会話を読み込んでいます…</div>':feature.dmError?`<div class="empty"><b>DMを読み込めませんでした</b><br><button class="btn small" type="button" onclick="retryDirectMessages()">もう一度読み込む</button></div>`:`${threadRows||'<div class="empty">まだDMはありません</div>'}${newPeers?`<div class="dm-list-label">新しいDM</div>${newPeers}`:''}`}</div></aside>`;
    const chat=activePeer?`<section class="dm-chat"><div class="dm-thread-head"><button data-preview-safe class="btn small dm-back" type="button" onclick="closeDirectMessage()">← 一覧</button><div><h2>${esc(activeName)}</h2><span>${esc(dmRole(activePeer))}</span></div></div><div id="dm-messages" class="dm-messages" aria-live="polite">${messages||'<div class="empty">まだメッセージはありません。<br>下の入力欄から最初のDMを送れます。</div>'}</div><p class="dm-guidance">案件ごとの修正指示・素材・提出URLは「担当案件」の案件内チャットに残してください。</p><form class="dm-compose" onsubmit="sendDirectMessage(event)"><label class="app-sr-only" for="dm-compose-body">${esc(activeName)}へのDM</label><textarea id="dm-compose-body" maxlength="2000" placeholder="${esc(activeName)}へメッセージ"></textarea><button class="btn primary" type="submit">送信</button></form></section>`:`<section class="dm-chat"><div class="empty"><b>会話を選んでください</b><br><span class="muted">左の一覧から相手を選ぶと、1対1で連絡できます。</span></div></section>`;
    return`${pageHead('DM','案件の外で必要な連絡を1対1で確認')}<div class="card dm-shell ${activePeer?'dm-mobile-chat':''}">${inbox}${chat}</div>`;
  }

  function showForegroundDmNotification(thread){
    if(typeof Notification==='undefined'||Notification.permission!=='granted'||!document.hidden)return;
    try{const notice=new Notification(thread.counterpartName||'新しいDM',{body:thread.lastMessagePreview||'メッセージが届きました',icon:'./icon-192.png',tag:`dm:${thread.id}`});notice.onclick=()=>{window.focus();view='dm';openDirectMessage(thread.counterpartUid,thread.id)}}catch(error){console.warn('notification',error)}
  }

  function updateDmThreads(next,error){
    if(error){feature.dmError=String(error?.message||error);feature.dmLoading=false;return scheduleSnapshotRender()}
    const incoming=Array.isArray(next)?next:[];
    incoming.forEach(thread=>{const key=`${stamp(thread.lastMessageAt)}:${thread.lastSenderUid||''}:${thread.lastMessagePreview||''}`,previous=feature.dmSeenMessages.get(thread.id);if(feature.dmInitialSnapshot&&thread.unread&&previous&&previous!==key)showForegroundDmNotification(thread);feature.dmSeenMessages.set(thread.id,key)});
    feature.dmInitialSnapshot=true;feature.dmThreads=incoming;feature.dmLoading=false;feature.dmError='';scheduleSnapshotRender();
  }

  async function startDmFeatures(force=false){
    const api=dmApi();if(!api||!user||!access?.approved||ADMIN_PREVIEW)return;
    if(!force&&feature.dmStartedFor===user.uid)return;
    if(feature.dmThreadUnsub){try{feature.dmThreadUnsub()}catch(_){}feature.dmThreadUnsub=null}
    if(feature.dmMessageUnsub){try{feature.dmMessageUnsub()}catch(_){}feature.dmMessageUnsub=null}
    feature.dmStartedFor=user.uid;feature.dmLoading=true;feature.dmError='';
    try{feature.dmPeers=await api.loadPeers();feature.dmThreadUnsub=api.watch(updateDmThreads)}catch(error){feature.dmError=String(error?.message||error);feature.dmLoading=false;scheduleSnapshotRender()}
  }

  function openDirectMessage(peerUid,threadId=''){
    const api=dmApi(),existingThread=feature.dmThreads.find(thread=>thread.id===threadId||thread.counterpartUid===peerUid),peer=dmPeer(peerUid)||(existingThread?dmThreadPeer(existingThread):null);if(!api||!peer)return toast('DMの相手を確認できません');
    if(feature.dmMessageUnsub){try{feature.dmMessageUnsub()}catch(_){}feature.dmMessageUnsub=null}
    feature.dmActivePeerUid=peerUid;feature.dmActiveThreadId=threadId||api.threadId(user.uid,peerUid);feature.dmMessages=[];view='dm';
    const existing=threadId||dmThreadForPeer(peerUid)?.id||'';
    if(DEMO){feature.dmMessages=[{id:'demo-dm-1',senderUid:'demo-owner',senderName:'中村',body:'案件以外の連絡はこのDMで確認できます。',createdAt:now()-3600000}];render();return setTimeout(scrollDirectMessages,0)}
    if(existing){feature.dmMessageUnsub=api.watchMessages(existing,(messages,error)=>{if(error){feature.dmError=String(error?.message||error);return scheduleSnapshotRender()}feature.dmMessages=messages;api.markRead(existing).catch(()=>{});feature.dmThreads=feature.dmThreads.map(thread=>thread.id===existing?{...thread,unread:false}:thread);scheduleSnapshotRender();setTimeout(scrollDirectMessages,0)})}
    render();setTimeout(scrollDirectMessages,0);
  }

  function closeDirectMessage(){feature.dmActivePeerUid='';feature.dmActiveThreadId='';feature.dmMessages=[];if(feature.dmMessageUnsub){try{feature.dmMessageUnsub()}catch(_){}feature.dmMessageUnsub=null}render()}
  function scrollDirectMessages(){const box=document.getElementById('dm-messages');if(box)box.scrollTop=box.scrollHeight}
  async function sendDirectMessage(event){
    event?.preventDefault?.();if(ADMIN_PREVIEW)return;const body=$('#dm-compose-body')?.value.trim()||'',peerUid=feature.dmActivePeerUid,api=dmApi();if(!body)return toast('メッセージを入力してください');if(!api||!peerUid)return toast('DMの相手を確認できません');
    const button=event?.submitter;if(button)button.disabled=true;
    try{if(DEMO){feature.dmMessages.push({id:id(),senderUid:user.uid,senderName:editorDisplayName(),body,createdAt:now()});$('#dm-compose-body').value='';render();setTimeout(scrollDirectMessages,0);return toast('DMを送信しました')};const result=await api.send(peerUid,body);const input=$('#dm-compose-body');if(input)input.value='';await openDirectMessage(peerUid,result.threadId);toast('DMを送信しました');const push=pushClient();if(push&&result?.threadId&&user?.getIdToken){user.getIdToken().then(idToken=>push.dispatchDirectThread({threadId:result.threadId,idToken})).catch(error=>console.warn('dm push dispatch',error))}}catch(error){console.warn(error);toast('DMを送信できませんでした')}finally{if(button?.isConnected)button.disabled=false}
  }
  async function markAllDirectMessagesRead(){const api=dmApi(),ids=feature.dmThreads.filter(x=>x.unread).map(x=>x.id);if(!api||!ids.length)return;try{await api.markAllRead(ids);feature.dmThreads=feature.dmThreads.map(x=>({...x,unread:false}));render();toast('すべてのDMを既読にしました')}catch(error){console.warn(error);toast('DMを既読にできませんでした')}}
  function retryDirectMessages(){feature.dmStartedFor='';startDmFeatures(true);render()}

  function messageBlock(job){
    const list=(feature.messages.get(job.id)||[]).slice().sort((a,b)=>stamp(a.createdAt)-stamp(b.createdAt));
    const loaded=feature.messageUnsubs.has(job.id)||DEMO,loading=feature.messageLoading.has(job.id),thread=loading?'<div class="muted">案件内チャットを読み込んでいます…</div>':loaded?(list.map(x=>`<div class="message ${x.byUid===portalUid()?'mine':''}"><div class="message-head"><span>${esc(x.byName||'メンバー')} ・ ${esc(x.kind||'メッセージ')}</span><span>${x.createdAt&&typeof x.createdAt.toDate==='function'?x.createdAt.toDate().toLocaleString('ja-JP'):''}</span></div><div class="message-body">${esc(x.body||'')}</div>${safeUrl(x.url||'')?`<a class="safe-link" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">添付URLを開く</a>`:''}</div>`).join('')||'<div class="muted">まだ連絡はありません</div>'):'<div class="muted">この詳細を開くと、案件内チャットを読み込みます。</div>';
    return`<div class="message-thread" data-message-job-id="${esc(job.id)}"><div class="section-title"><h2>案件内チャット</h2><span>この案件の連絡を残します</span></div>${thread}<div class="form-grid" style="margin-top:8px"><div class="field"><label for="msg-kind-${job.id}">種類</label><select id="msg-kind-${job.id}"><option>質問</option><option>回答</option><option>初稿提出</option><option>修正指示</option><option>修正稿提出</option><option>納品</option><option>連絡</option></select></div><div class="field"><label for="msg-url-${job.id}">関連URL</label><input id="msg-url-${job.id}" type="url" placeholder="https://"></div><div class="field full"><label for="msg-body-${job.id}">メッセージ</label><textarea id="msg-body-${job.id}" maxlength="2000" placeholder="相手に伝えたいことを入力"></textarea></div></div><div class="actions"><button class="btn primary small" onclick="sendJobMessage('${job.id}')">メッセージを送信</button></div></div>`;
  }


  // The editor portal deliberately renders a separate card per child job; a
  // parent case only groups these cards and never becomes a mutable record.
  function jobCardExtended(job){
    const j={...job,...readJobDraft(job.id)},deliveryDate=j.deliveryDate||j.deadline||'',overdue=editorWorkIsOverdue(j),e=safeUrl(j.evidenceUrl),action=nextEditorJobAction(j),statuses=editorAllowedStatuses(j),timeline=editorTimelineState(j),deadline=editorDeadlineLabel(j),waiting=editorWaitMessage(j),jid=esc(j.id);
    const links=editorResourceLinks(j);
    const statusControl=waiting?`<div class="field"><label>ステータス</label><div class="editor-readonly-status" aria-label="ステータス ${esc(videoStatusLabel(j.status))}">${esc(videoStatusLabel(j.status))}（ディレクター・管理者が更新）</div><input id="job-status-${jid}" type="hidden" value="${esc(j.status||'')}"></div>`:`<div class="field"><label for="job-status-${jid}">ステータス</label><select id="job-status-${jid}">${statuses.map(x=>`<option value="${esc(x)}" ${x===j.status?'selected':''}>${esc(videoStatusLabel(x))}</option>`).join('')}</select></div>`;
    const draftLocked=!editorSetsDraftDate(j),draftDateControl=`<div class="field"><label for="job-editor-draft-${jid}">編集者 初稿</label><input id="job-editor-draft-${jid}" type="date" value="${esc(j.editorDraftDate||'')}" ${draftLocked?'disabled':''}>${draftLocked?'<div class="muted">案件追加者が設定します。</div>':''}</div>`;
    const editorPay=editorJobType(j)==='dispatch'&&positiveYen(j.editorPayAmount)!==null?`<div class="deadline-summary"><b>編集者支払額</b> ¥${positiveYen(j.editorPayAmount).toLocaleString('ja-JP')}</div>`:'',deliveryControl=j.source==='direct_client'?`<input id="job-delivery-${jid}" type="hidden" value="${esc(deliveryDate)}">`:`<div class="field"><label for="job-delivery-${jid}">納期（予定）</label><input id="job-delivery-${jid}" type="date" value="${esc(deliveryDate)}"></div>`;
    const fields=`<div class="form-grid" oninput="saveJobDraft('${jid}')" onchange="saveJobDraft('${jid}')">${statusControl}<div class="field"><label for="job-shared-${jid}">受注日</label><input id="job-shared-${jid}" type="date" value="${esc(j.sharedDate||'')}"></div>${draftDateControl}<div class="field"><label for="job-client-draft-${jid}">クライアント 初稿</label><input id="job-client-draft-${jid}" type="date" value="${esc(j.clientDraftDate||'')}"></div><div class="field"><label for="job-thumbnail-${jid}">サムネイル納品日</label><input id="job-thumbnail-${jid}" type="date" value="${esc(j.thumbnailDate||'')}"></div>${deliveryControl}<div class="field"><label for="job-workdate-${jid}">作業日</label><input id="job-workdate-${jid}" type="date" value="${esc(j.workDate||'')}"></div><div class="field"><label for="job-start-${jid}">開始時刻</label><input id="job-start-${jid}" type="time" value="${esc(j.startTime||'')}"></div><div class="field"><label for="job-end-${jid}">終了時刻</label><input id="job-end-${jid}" type="time" value="${esc(j.endTime||'')}"></div><div class="field full"><label for="job-progress-${jid}">進み具合のメモ</label><textarea id="job-progress-${jid}" maxlength="2000">${esc(j.progress||'')}</textarea></div><div class="field"><label for="job-evidence-${jid}">提出した内容のURL</label><input id="job-evidence-${jid}" type="url" value="${esc(j.evidenceUrl||'')}" placeholder="https://"></div><div class="field"><label for="job-blocker-${jid}">作業を止めている理由</label><input id="job-blocker-${jid}" maxlength="300" value="${esc(j.blocker||'')}"></div></div>`;
    return`<article id="editor-job-${jid}" data-job-id="${jid}" class="card job-card editor-job-card ${overdue?'notice danger':''}"><div class="job-top"><div><span class="pill">${editorJobTypeLabel(j)}</span><div class="job-title" style="margin-top:6px">${esc(j.title||'案件名未設定')}</div><div class="job-meta">${esc(j.clientDisplay||'クライアント未設定')} / ${esc(j.accountDisplay||'アカウント未設定')}</div></div>${statusPill(j.status)}</div><div class="editor-job-status-line" aria-label="現在の工程"><span>現在の進捗</span><b>${esc(editorWorkflowLabel(editorWorkflow(j).stage,j.status))}</b></div><div class="editor-next-owner">次の担当：<b>${esc(editorNextOwner(j))}</b></div>${j.correctionReason?`<div class="job-urgent-note danger"><b>差戻し内容</b><br>${esc(j.correctionReason)}</div>`:''}${j.blocker?`<div class="job-urgent-note danger"><b>停止・確認が必要です</b><br>${esc(j.blocker)}</div>`:''}<div class="deadline-summary ${overdue?'overdue':''}">${esc(deadline)}${overdue?'（作業中の案件）':''}</div>${editorPay}<div class="editor-timeline" aria-label="編集進行の5段階">${timeline.map(x=>`<div class="editor-timeline-step ${x.state}"><b>${x.state==='done'?'完了':x.state==='current'?'いまここ':x.state==='optional'?'必要時':'未到達'}</b><span>${esc(x.label)}</span></div>`).join('')}</div>${waiting?`<div class="job-waiting"><b>現在の状況：</b>${esc(waiting)}</div>`:editorActionHtml(j,action,e)}<details class="job-detail" ${feature.openMessageJobIds.has(j.id)?'open':''} ontoggle="ensureJobMessages('${jid}',this.open)"><summary>案件の詳細・連絡を開く</summary>${caseCautionHtml(j)}${caseManualCardsHtml(j)}${j.instructions?`<div class="job-body">${esc(j.instructions)}</div>`:''}${links}${fields}<div class="actions"><button class="btn primary job-primary" type="button" onclick="saveJobProgress('${jid}')">変更を保存</button></div>${messageBlock(j)}</details></article>`;
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

  function editorDeliveryCompletionHtml(job){
    const jid=esc(job.id),completed=job.completedDeliveryDate||localDate(),evidence=safeUrl(job.evidenceUrl||'');
    return`<div class="job-submit-panel editor-delivery-panel"><div class="field"><label for="completed-delivery-date-${jid}">納品日 *</label><input id="completed-delivery-date-${jid}" type="date" value="${esc(completed)}"></div><div class="field"><label for="completed-delivery-evidence-${jid}">納品の証跡URL *</label><input id="completed-delivery-evidence-${jid}" type="url" value="${esc(evidence)}" placeholder="https://"></div><button class="btn primary job-primary" type="button" onclick="completeEditorDelivery('${jid}')">納品を完了した</button></div><div class="muted" style="margin-top:6px">先方OK後、納品日と納品先URLを記録して完了にします。納品日が未記録の案件には報酬が発生しません。</div>`;
  }

  async function completeEditorDelivery(jid){
    if(ADMIN_PREVIEW)return toast('実データ確認モードでは変更できません');
    const job=jobs.find(x=>x.id===jid);if(!job)return;
    const flow=editorWorkflow(job);if(flow.stage!=='client_review'||String(job.status||'')!=='確認待ち')return toast('先方確認が完了するまで納品完了にはできません');
    const completedDeliveryDate=$('#completed-delivery-date-'+jid)?.value||'',evidenceUrl=$('#completed-delivery-evidence-'+jid)?.value.trim()||'';
    if(!completedDeliveryDate)return toast('納品日を入力してください');
    if(!safeUrl(evidenceUrl))return toast('納品の証跡URLを入力してください');
    if(String(job.blocker||'').trim())return toast('停止理由を解消してから納品完了にしてください');
    const at=now(),workflow={round:flow.round,stage:'delivered'},progressEvent={at,type:'editor_delivery_completed',byUid:user.uid,byEmail:user.email||'',byRole:'担当編集者',fromStage:'client_review',toStage:'delivered',status:'完了',completedDeliveryDate,evidenceUrl},historyEntry={at,type:'editor_delivery_completed',by:user.uid,byEmail:user.email||'',byName:editorDisplayName(),byRole:'担当編集者',status:'完了',completedDeliveryDate,evidenceUrl};
    const data={status:'完了',completedDeliveryDate,evidenceUrl,blocker:'',workflow,progressEvents:[...(Array.isArray(job.progressEvents)?job.progressEvents:[]).slice(-98),progressEvent],lastProgressChangedByUid:user.uid,lastProgressChangedByEmail:user.email||'',lastProgressChangedByRole:'担当編集者',updatedAt:at,history:[...(Array.isArray(job.history)?job.history:[]).slice(-98),historyEntry]};
    if(DEMO){Object.assign(job,data);clearJobDraft(jid);render();return toast('納品日を記録し、案件を完了にしました')}
    try{const ref=db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid),event=ref.collection('events').doc(),batch=db.batch();batch.update(ref,data);batch.set(event,{at:firebase.firestore.FieldValue.serverTimestamp(),type:'editor_delivery_completed',byUid:user.uid,byEmail:user.email||'',byRole:'担当編集者',status:'完了',completedDeliveryDate,deliveryDate:job.deliveryDate||job.deadline||'',evidenceUrl});await batch.commit();clearJobDraft(jid);toast('納品日を記録し、案件を完了にしました')}catch(error){console.warn(error);toast('納品完了を保存できませんでした')}
  }

  function nextEditorJobAction(job){
    if(editorWorkflow(job).stage!=='editing')return null;
    const next={未着手:['進行中','作業を開始します','作業を開始する'],受注済み:['進行中','作業を開始します','作業を開始する'],進行中:['初稿提出済み','初稿を提出します','初稿を提出した'],編集者進行中:['初稿提出済み','初稿を提出します','初稿を提出した'],初稿完成:['初稿提出済み','初稿を提出します','初稿を提出した'],修正中:['修正稿提出済み','修正稿を提出します','修正稿を提出した']}[String(job?.status||'')];
    return next||null;
  }

  async function saveGroupEditorDraftDate(trigger){
    if(ADMIN_PREVIEW)return toast('実データ確認モードでは変更できません');
    const container=trigger?.closest?.('.editor-case-group'),groupKey=container?.dataset?.caseKey||'';
    if(!groupKey)return toast('親案件を確認できませんでした');
    if(feature.groupDraftSaving.has(groupKey))return;
    const input=container.querySelector('.group-editor-draft-input'),button=trigger,value=input?.value||'';
    if(!value)return toast('編集者初稿日を入力してください');
    const group=editorGroupJobs(jobs).find(x=>x.key===groupKey),targets=groupDraftEligibleJobs(group);
    if(!targets.length)return toast('まとめて設定できる未完了のサブ案件はありません');
    if(targets.length>450)return toast('一度に保存できるサブ案件は450件までです');
    for(const job of targets){const schedule={sharedDate:job.sharedDate||'',editorDraftDate:value,clientDraftDate:job.clientDraftDate||'',thumbnailDate:job.thumbnailDate||'',deliveryDate:job.deliveryDate||job.deadline||''},dateError=scheduleError(schedule);if(dateError)return toast(`${job.title||'案件'}：${dateError}`)}
    feature.groupDraftSaving.add(groupKey);if(button)button.disabled=true;
    try{
      if(DEMO){targets.forEach(job=>{job.editorDraftDate=value});render();toast(`${targets.length}件の編集者初稿日を保存しました`);return}
      const batch=db.batch(),updatedAt=now();targets.forEach(job=>batch.update(db.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(job.id),{editorDraftDate:value,updatedAt}));await batch.commit();targets.forEach(job=>{job.editorDraftDate=value});render();toast(`${targets.length}件の編集者初稿日を保存しました`);
    }catch(error){console.warn(error);toast('編集者初稿日をまとめて保存できませんでした')}
    finally{feature.groupDraftSaving.delete(groupKey);if(button?.isConnected)button.disabled=false}
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
    document.body.classList.toggle('editor-slack-layout',!!(user&&access?.approved));
    const who=document.querySelector('#account b');if(who&&!document.querySelector('#account .role-chip'))who.insertAdjacentHTML('afterend',`<span class="role-chip">${isExternal()?'外部編集者':'直接契約編集者'}</span>`);
    mountUpdateBanner();mountPushSetupBanner();syncMessageSubscriptions();applyAdminPreviewReadOnly();
  }

  function mountPushSetupBanner(){
    document.getElementById('editor-push-setup-banner')?.remove();
    if(!user||!access?.approved)return;
    const html=pushSetupBannerHtml();if(!html)return;
    const page=document.querySelector('#app .page-head')||document.querySelector('#app > main')||document.querySelector('#app');
    if(!page)return;
    page.insertAdjacentHTML('beforebegin',html.replace('class="push-setup-banner"','id="editor-push-setup-banner" class="push-setup-banner"'));
  }

  function stopFeatures(){
    feature.unsubs.forEach(x=>{try{x()}catch(_){}});feature.unsubs=[];
    feature.messageUnsubs.forEach(x=>{try{x()}catch(_){}});feature.messageUnsubs.clear();feature.messages.clear();feature.messageLoading.clear();feature.openMessageJobIds.clear();feature.startedFor='';
    if(feature.dmThreadUnsub){try{feature.dmThreadUnsub()}catch(_){}feature.dmThreadUnsub=null}
    if(feature.dmMessageUnsub){try{feature.dmMessageUnsub()}catch(_){}feature.dmMessageUnsub=null}
    feature.dmStartedFor='';feature.dmPeers=[];feature.dmThreads=[];feature.dmMessages=[];feature.dmActivePeerUid='';feature.dmActiveThreadId='';feature.dmInitialSnapshot=false;feature.dmSeenMessages.clear();
  }

  function mergeBoard(items){feature.board=uniqById([...feature.board,...items]);scheduleSnapshotRender()}
  function mergeManuals(items){feature.manuals=uniqById([...feature.manuals,...items]);scheduleSnapshotRender()}

  function startFeatures(){
    if(DEMO||!user||!access?.approved||feature.startedFor===portalUid())return;
    stopFeatures();feature.startedFor=portalUid();
    const root=db.collection('editor_portals').doc(portalUid());
    feature.unsubs.push(root.collection('client_catalog').onSnapshot(q=>{feature.catalog=q.docs.map(d=>({id:d.id,...d.data()}));scheduleSnapshotRender()},()=>toast('クライアント一覧を読み込めません')));
    const boardQueries=isExternal()&&assignedDirectorUid()
      ?[db.collection('editor_job_board').where('directorUid','==',assignedDirectorUid())]
      :[db.collection('editor_job_board').where('audience','==','direct'),db.collection('editor_job_board').where('eligibleUids','array-contains',portalUid())];
    boardQueries.forEach(q=>feature.unsubs.push(q.onSnapshot(s=>mergeBoard(s.docs.map(d=>({id:d.id,...d.data()})).filter(x=>x.status==='open')),e=>console.warn('board',e?.code||e))));
    feature.unsubs.push(db.collection('editor_schedules').onSnapshot(q=>{feature.schedules=q.docs.map(d=>({id:d.id,...d.data()}));scheduleSnapshotRender()},e=>console.warn('schedules',e?.code||e)));
    feature.unsubs.push(db.collection('editor_manuals').where('audience','==','all').onSnapshot(q=>mergeManuals(q.docs.map(d=>({id:d.id,...d.data()}))),e=>console.warn('manuals',e?.code||e)));
    feature.unsubs.push(db.collection('editor_manuals').where('allowedUids','array-contains',portalUid()).onSnapshot(q=>mergeManuals(q.docs.map(d=>({id:d.id,...d.data()}))),e=>console.warn('manuals assigned',e?.code||e)));
    feature.unsubs.push(db.collection('system').doc('releases_current').onSnapshot(d=>{feature.release=d.exists?d.data():null;scheduleSnapshotRender()},e=>console.warn('release',e?.code||e)));
    startDmFeatures();refreshEditorPushStatus(true);
  }

  function syncMessageSubscriptions(){
    if(DEMO||!db||!user)return;
    const ids=new Set(jobs.map(x=>x.id));
    feature.messageUnsubs.forEach((unsub,jid)=>{if(!ids.has(jid)){try{unsub()}catch(_){}feature.messageUnsubs.delete(jid);feature.messages.delete(jid);feature.messageLoading.delete(jid);feature.openMessageJobIds.delete(jid)}});
  }

  function ensureJobMessages(jid,opened=true){
    if(!opened){
      feature.openMessageJobIds.delete(jid);
      const unsub=feature.messageUnsubs.get(jid);if(unsub){try{unsub()}catch(_){}feature.messageUnsubs.delete(jid)}
      feature.messages.delete(jid);feature.messageLoading.delete(jid);return;
    }
    feature.openMessageJobIds.add(jid);
    if(DEMO||!db||!user||feature.messageUnsubs.has(jid)||feature.messageLoading.has(jid))return;
    const job=jobs.find(x=>x.id===jid);if(!job||job.previewLegacy)return;
    feature.messageLoading.add(jid);scheduleSnapshotRender();
    const u=db.collection('editor_portals').doc(portalUid()).collection('editor_jobs').doc(jid).collection('messages').orderBy('createdAt','asc').limit(200).onSnapshot(q=>{feature.messages.set(jid,q.docs.map(d=>({id:d.id,...d.data()})));feature.messageLoading.delete(jid);scheduleSnapshotRender()},e=>{feature.messageLoading.delete(jid);console.warn('messages',e?.code||e);scheduleSnapshotRender()});
    feature.messageUnsubs.set(jid,u);
  }

  async function createDispatchJob(){
    if(feature.dispatchSubmitting)return;
    const clientId=$('#new-client-id')?.value||'',accountId=$('#new-account-id')?.value||'',client=feature.catalog.find(x=>x.id===clientId),accountItem=accountItems(clientId).find(x=>x.id===accountId),requestedParentName=$('#new-case')?.value.trim()||'',parentRequestUrl=$('#new-parent-request')?.value.trim()||'',parentSourceUrl=$('#new-parent-source')?.value.trim()||'',parentManualIds=selectedCaseManualIds($('#new-parent-manuals')),parentCaution=$('#new-parent-caution')?.value.trim()||'';
    if(!client||!accountItem)return toast('クライアント・アカウントを選択してください');
    if((parentRequestUrl&&!safeUrl(parentRequestUrl))||(parentSourceUrl&&!safeUrl(parentSourceUrl)))return toast('親案件共通リンクは https:// または http:// で入力してください');
    const subcases=readDispatchSubcases();if(subcases.error)return toast(subcases.error);if(subcases.items.length>1&&!requestedParentName)return toast('複数の子案件は、親案件名を入力してください');
    if(DEMO)return toast('プレビューでは案件を保存できません');
    feature.dispatchSubmitting=true;
    const parentCaseId=id(),parentCaseName=requestedParentName||subcases.items[0].title,at=now(),urgent=!!$('#new-urgent')?.checked;
    try{
      const root=db.collection('editor_portals').doc(user.uid).collection('editor_jobs'),batch=db.batch(),created=[];
      subcases.items.forEach((subcase,subtaskIndex)=>{
        const requestUrl=subcase.requestUrl||parentRequestUrl,sourceUrl=subcase.sourceUrl||parentSourceUrl,manualIds=subcase.manualIds.length?subcase.manualIds:parentManualIds,caution=subcase.caution||parentCaution;
        const data={recordType:'editor_portal_job',businessType:'dispatch',title:subcase.title,caseName:parentCaseName,parentCaseId,parentCaseName,subtaskIndex,clientId,sourceClientId:client.sourceClientId||client.id,clientDisplay:client.name,accountId,accountDisplay:accountItem.name,deadline:subcase.schedule.deliveryDate,...subcase.schedule,editorDraftDateSetter:subcase.editorDraftDateSetter,editorPayAmount:subcase.editorPayAmount,requestUrl,sourceUrl,instructions:subcase.instructions,manualIds,parentManualIds,caution,parentCaution,urgent,status:'受注済み',workflow:{round:1,stage:'editing'},progressEvents:[],progress:'',evidenceUrl:'',blocker:'',workDate:'',startTime:'',endTime:'',submittedByUid:user.uid,editorUid:user.uid,editorEmail:user.email||'',editorName:editorDisplayName(),directorUid:assignedDirectorUid(),source:'direct_client',createdAt:at,updatedAt:at,history:[{at,type:'created',by:user.uid,status:'受注済み'}]},ref=root.doc(subcase.id);
        batch.set(ref,data);batch.set(ref.collection('events').doc(),{at:firebase.firestore.FieldValue.serverTimestamp(),type:'created',byUid:user.uid,status:data.status,deliveryDate:data.deliveryDate,businessType:'dispatch',parentCaseId});created.push({id:subcase.id,...data});
      });
      await batch.commit();jobs=[...created,...jobs.filter(job=>!created.some(item=>item.id===job.id))];sessionStorage.removeItem(draftKey());toast(`編集者派遣に${created.length}件を登録しました`);
    }catch(e){console.warn(e);toast('案件を登録できませんでした')}finally{feature.dispatchSubmitting=false}
  }

  async function claimBoardJob(jid){
    const board=feature.board.find(x=>x.id===jid);if(!board||board.status!=='open')return toast('この案件はすでに受託済みです');
    if(!confirm(`「${board.title}」を受けますか？\n受託後は担当案件に追加されます。`))return;
    const at=now(),portalRef=db?.collection('editor_portals').doc(user.uid).collection('editor_jobs').doc(jid),editorDraftDateSetter=board.editorDraftDateSetter==='creator'?'creator':'editor',data={recordType:'editor_portal_job',businessType:'edit_agency',boardJobId:jid,title:board.title||'',caseName:board.caseName||'',parentCaseId:board.parentCaseId||jid,parentCaseName:board.parentCaseName||board.caseName||board.title||'',subtaskIndex:Number.isInteger(board.subtaskIndex)?board.subtaskIndex:0,clientId:board.clientId||'',sourceClientId:board.sourceClientId||board.clientId||'',clientDisplay:board.clientName||'',accountId:board.accountId||'',accountDisplay:board.accountName||'',deadline:board.deliveryDate||'',sharedDate:localDate(),editorDraftDate:board.editorDraftDate||'',editorDraftDateSetter,clientDraftDate:board.clientDraftDate||'',thumbnailDate:board.thumbnailDate||'',deliveryDate:board.deliveryDate||'',requestUrl:board.requestUrl||'',sourceUrl:board.sourceUrl||'',attachments:Array.isArray(board.attachments)?board.attachments.slice(0,20):[],instructions:board.instructions||board.summary||'',manualIds:Array.isArray(board.manualIds)?board.manualIds.slice(0,20):[],parentManualIds:Array.isArray(board.parentManualIds)?board.parentManualIds.slice(0,20):[],caution:String(board.caution||'').slice(0,2000),parentCaution:String(board.parentCaution||'').slice(0,2000),urgent:!!board.urgent,status:'受注済み',workflow:{round:1,stage:'editing'},progressEvents:[],progress:'',evidenceUrl:'',blocker:'',workDate:'',startTime:'',endTime:'',submittedByUid:user.uid,editorUid:user.uid,editorEmail:user.email||'',editorName:editorDisplayName(),directorUid:board.directorUid||'',source:'job_board',createdAt:at,updatedAt:at,history:[{at,type:'claimed',by:user.uid,status:'受注済み'}]};
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
    feature.dmPeers=[{uid:'demo-owner',name:'中村',roles:['動画編集ディレクター'],editorKind:'direct'}];
    feature.dmThreads=[{id:'demo-thread',counterpartUid:'demo-owner',counterpartName:'中村',lastMessagePreview:'明日の案件を確認してください',lastMessageAt:now()-3600000,lastSenderUid:'demo-owner',unread:true}];
    access.editorKind='direct';feature.catalog=[{id:'demo-client',name:'大塚周平さん',active:true,accounts:[{id:'account-a',name:'大塚周平 公式YouTube'},{id:'account-b',name:'掊業用サブチャンネル'}]}];feature.board=[{id:'board-demo',status:'open',audience:'direct',title:'ショート動画 05',clientName:'大塚周平さん',accountName:'大塚周平 公式YouTube',caseName:'9月分',editorDraftDate:'2026-08-28',deliveryDate:'2026-08-30',summary:'参考動画と構成指示を確認して編集してください。',instructions:'参考動画と構成指示を確認して編集してください。',createdAt:now()}];feature.manuals=[{id:'manual-1',title:'お仕事の進め方',scope:'global',scopeLabel:'全体',version:'2.0',required:true,body:'案件の受託、質問、初稿、修正、納品はすべてこのアプリで行います。',updatedAt:now()}];feature.schedules=[{id:user.uid,name:user.displayName,weekStart:demoDates[0],weekEnd:demoDates[6],days:demoDays,routineEnabled:false,routine:[],available:true,fromDate:demoDates[0],toDate:demoDates[6],hoursPerWeek:26,capacity:7,workType:'both',note:''}];feature.messages.set('demo-1',[{id:'m1',byUid:'manager',byName:'中村航汰',kind:'連絡',body:'不明点はこの案件チャットで聞いてください。',createdAt:now()-3600000}]);render();
  }

  const editorGuideBase=guideHtml;
  guideHtml=()=>{
    let html=editorGuideBase();
    html=html
      .replace('D確認・クライアント提出・納品完了はディレクターまたは管理者が更新します。','D確認・クライアント提出・先方確認はディレクターまたは管理者が更新します。先方OK後の納品日は、担当編集者が納品先URLと一緒に記録します。納品日が未記録の案件には報酬が発生しません。')
      .replace('案件内容・初稿日・納品日を確認します。','案件内容・初稿日・納期（予定）を確認します。')
      .replace('案件名・納品日・指示を入力します。','親案件名と子案件名、編集者初稿、クライアント初稿、納期（予定）、指示を入力します。')
      .replace('提出後は「D確認待ち」になります。D確認・クライアント提出・クライアント確認・納品完了は、ディレクターまたは管理者が更新します。','提出後は「D確認待ち」になります。D確認・クライアント提出・クライアント確認はディレクターまたは管理者が更新します。先方OK後、実際に納品した日と納品先URLは担当編集者が記録して完了にします。')
      .replace('その後の確認・納品はディレクターまたは管理者が進めます。','その後の確認はディレクターまたは管理者が進めます。先方OK後の納品日は、担当編集者が記録します。')
      .replace('編集者が更新するのは初稿・修正稿の提出だけです。D確認・クライアント提出・修正指示・納品完了は、ディレクターまたは管理者が更新します。','編集者が更新するのは初稿・修正稿の提出と、先方OK後の納品完了です。D確認・クライアント提出・修正指示は、ディレクターまたは管理者が更新します。');
    if(isExternal())html=html
      .replace(/<section class="card guide-detail"><h2>2\. 請求者設定<\/h2>[\s\S]*?<\/section>/,'<section class="card guide-detail"><h2>2. 支払い・契約の確認</h2><ol><li>金額と請求は担当ディレクターとの契約に従います。</li><li>このアプリに単価・請求額・利益は表示されません。</li><li>不明点は担当ディレクターへ確認します。</li></ol></section>')
      .replace(/<section class="card guide-detail"><h2>請求書<\/h2>[\s\S]*?<\/section>/,'<section class="card guide-detail"><h2>支払い案内</h2><ol><li>外部編集者はmono.createへ請求書を提出しません。</li><li>担当ディレクターがチーム分をまとめてmono.createへ請求します。</li><li>ご自身の支払いは担当ディレクターへ確認します。</li></ol><div class="actions"><button class="btn small" onclick="setView(\'invoices\')">支払い案内を開く</button></div></section>')
      .replace(/<div class="card"><b>請求書が作れない<\/b><span>[\s\S]*?<\/span><\/div>/,'<div class="card"><b>支払いを確認したい</b><span>担当ディレクターへ確認します。外部編集者の画面に単価や請求額は表示されません。</span></div>');
    return html;
  };

  const baseJobCardWithActualDelivery=jobCardExtended;
  jobCardExtended=function(job){
    const flow=editorWorkflow(job),dates=`<div class="editor-job-dates" aria-label="案件の日程"><div><span>編集者 初稿</span><b>${esc(job.editorDraftDate||'未設定')}</b></div><div><span>クライアント 初稿</span><b>${esc(job.clientDraftDate||'未設定')}</b></div><div><span>納期（予定）</span><b>${esc(job.deliveryDate||job.deadline||'未設定')}</b></div>${job.completedDeliveryDate?`<div class="actual"><span>納品日</span><b>${esc(job.completedDeliveryDate)}</b></div>`:''}</div>`;
    const completion=flow.stage==='client_review'&&String(job.status||'')==='確認待ち'?editorDeliveryCompletionHtml(job):'';
    return baseJobCardWithActualDelivery(job)
      .replace('</div><div class="editor-timeline"',`${dates}</div><div class="editor-timeline"`)
      .replace('<details class="job-detail"',`${completion}<details class="job-detail"`);
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
  window.editorAddDispatchSubcase=addDispatchSubcase;
  window.editorRemoveDispatchSubcase=removeDispatchSubcase;
  window.editorDispatchDraftSetterChanged=dispatchDraftSetterChanged;
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
  window.markEditorNotificationRead=markEditorNotificationRead;
  window.openEditorJob=openEditorJob;
  window.ensureJobMessages=ensureJobMessages;
  window.markEditorNotificationsRead=markEditorNotificationsRead;
  window.saveGroupEditorDraftDate=saveGroupEditorDraftDate;
  window.setEditorJobsListMode=setEditorJobsListMode;
  window.setEditorJobsTypeFilter=setEditorJobsTypeFilter;
  window.selectBoardJob=selectBoardJob;
  window.filterEditorBoardSearch=filterEditorBoardSearch;
  window.submitEditorJobAction=submitEditorJobAction;
  window.completeEditorDelivery=completeEditorDelivery;
  window.enableEditorDeviceNotifications=enableEditorDeviceNotifications;
  window.enableEditorPushNotifications=enableEditorPushNotifications;
  window.disableEditorPushNotifications=disableEditorPushNotifications;
  window.refreshEditorPushSetup=()=>refreshEditorPushStatus(true);
  window.openDirectMessage=openDirectMessage;
  window.closeDirectMessage=closeDirectMessage;
  window.sendDirectMessage=sendDirectMessage;
  window.markAllDirectMessagesRead=markAllDirectMessagesRead;
  window.retryDirectMessages=retryDirectMessages;

  const originalRenderBody=render;
  render=function(){
    if(user&&access?.approved){
      let body;
      if(view==='notifications')body=notificationsHtml();else if(view==='dm')body=dmHtml();else if(view==='board')body=boardHtml();else if(view==='schedule')body=scheduleHtml();else if(view==='manuals')body=manualsHtml();else if(view==='suggestion')body=suggestionHtml();else if(view==='mobile-setup')body=mobileSetupHtml();
      if(body){accountHtml();$('#app').innerHTML=adminPreviewBanner()+navHtml()+body;hydrateEditorVisualMarks();injectStyles();mountUpdateBanner();mountPushSetupBanner();applyAdminPreviewReadOnly();return}
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
