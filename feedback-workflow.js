(function(root){
  'use strict';

  // Feedback is kept apart from case-chat.  This makes the editor's learning
  // record searchable and lets an approved item become a scoped manual without
  // exposing any payment or owner-only data to editors.
  const state={db:null,user:null,access:null,getJobs:null,getPortalUids:null,unsubs:[],editorRows:[],managerRows:[],open:null,submitting:false,reviewing:new Set(),started:false,mode:'',managerScopeKey:'',editorReadError:'',managerReadError:''};
  const MAX_NOTE=1800,MAX_REVIEW=800;
  const now=()=>Date.now();
  const text=(v,max=MAX_NOTE)=>String(v||'').trim().slice(0,max);
  const safe=(v)=>String(v||'').replace(/[^A-Za-z0-9_-]/g,'_').slice(0,180);
  const hash=(value)=>{let h=2166136261;for(const c of String(value||'')){h^=c.charCodeAt(0);h=Math.imul(h,16777619)}return(h>>>0).toString(36)};
  const at=()=>root.firebase?.firestore?.FieldValue?.serverTimestamp?.()||now();
  const esc=(v)=>typeof root.esc==='function'?root.esc(String(v??'')):String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const toast=(message,kind)=>typeof root.toast==='function'?root.toast(message,kind):console.info(message);
  const isOwner=()=>typeof root._isOwner==='function'?root._isOwner():!!state.access?.owner;
  const isDirector=()=>!isOwner()&&(typeof root.hasAppRole==='function'?root.hasAppRole('動画編集ディレクター'):Array.isArray(state.access?.roles)&&state.access.roles.includes('動画編集ディレクター'));
  const blocked=()=>typeof root.portalWriteBlocked==='function'?root.portalWriteBlocked():!!root.EditflowFirestoreQuota?.isOpen?.();
  const portalUid=()=>String(state.user?.uid||root.FB_USER?.uid||'');
  const userName=()=>String(state.access?.name||state.user?.displayName||state.user?.email||'編集者').slice(0,120);
  const draftKey=(uid,jobId)=>`editflow-feedback-v2:${uid}:${jobId}`;
  function draftFor(jobId){try{return JSON.parse(sessionStorage.getItem(draftKey(portalUid(),jobId))||'{}')}catch(_){return{}}}
  function saveDraft(jobId,row){try{sessionStorage.setItem(draftKey(portalUid(),jobId),JSON.stringify(row))}catch(_){}}
  function removeDraft(jobId){try{sessionStorage.removeItem(draftKey(portalUid(),jobId))}catch(_){}}
  function correctionText(job){return text(job?.correctionReason||job?.feedback||job?.revisionReason||'',MAX_NOTE)}
  function isCorrection(job){return String(job?.status||'')==='修正中'||!!correctionText(job)}
  function feedbackId(job,draft){return`fb_${hash([portalUid(),job?.id||'',job?.parentCaseId||'',job?.workflow?.round||1,correctionText(job),draft.nonce||''].join('|'))}`}
  function manualId(row){return`feedback_${safe(row.portalUid)}_${safe(row.id)}`.slice(0,220)}
  function stamp(v){return v&&typeof v.toMillis==='function'?v.toMillis():Number(v||0)}
  function normalize(id,data){const row=data&&typeof data==='object'?data:{};return{id:String(id||row.id||''),portalUid:String(row.portalUid||''),jobId:String(row.jobId||''),editorUid:String(row.editorUid||row.portalUid||''),editorName:String(row.editorName||''),jobTitle:String(row.jobTitle||''),clientId:String(row.clientId||''),accountId:String(row.accountId||''),clientName:String(row.clientName||''),accountName:String(row.accountName||''),correctionReason:text(row.correctionReason),learning:text(row.learning),status:['submitted','approved','rejected'].includes(row.status)?row.status:'submitted',reviewNote:text(row.reviewNote,MAX_REVIEW),reviewedByUid:String(row.reviewedByUid||''),reviewedByName:String(row.reviewedByName||''),manualId:String(row.manualId||''),createdAt:row.createdAt||null,updatedAt:row.updatedAt||null};}
  function canSee(row){if(isOwner())return true;if(!isDirector())return false;const allowed=new Set((typeof state.getPortalUids==='function'?state.getPortalUids():[]).map(String));return allowed.has(String(row.portalUid));}
  function managerPortalUids(){return[...new Set((typeof state.getPortalUids==='function'?state.getPortalUids():[]).map(String).filter(Boolean))].sort();}
  function listenerError(kind,error,uid=''){
    if(root.EditflowFirestoreQuota?.handle?.(error,kind==='manager'?'past feedback':'my past feedback'))return;
    // A portal can disappear from a director's scope between the access and
    // feedback snapshots. Ignore only that already-revoked scope; a denial on
    // the current scope is actionable and must remain visible to the manager.
    const permissionDenied=String(error?.code||'').toLowerCase()==='permission-denied';
    if(kind==='manager'&&permissionDenied&&!managerPortalUids().includes(String(uid)))return;
    const message='過去フィードバックを読み込めませんでした。通信を確認して再読み込みしてください。';
    if(kind==='manager')state.managerReadError=message;else state.editorReadError=message;
    root.render?.();
  }
  function configure(options={}){Object.assign(state,{db:options.db||state.db||root.fbDb||root.db||null,user:options.user||state.user||root.FB_USER||root.user||null,access:options.access||state.access||root.APP_ACCESS||root.access||null,getJobs:options.getJobs||state.getJobs,getPortalUids:options.getPortalUids||state.getPortalUids});return api}
  function openFromJob(job){
    if(!job?.id||!isCorrection(job))return null;
    const existing=draftFor(job.id),draft={nonce:existing.nonce||`${now()}-${Math.random().toString(36).slice(2,10)}`,learning:text(existing.learning),job:{id:String(job.id),title:String(job.title||job.caseName||'案件'),clientId:String(job.clientId||job.sourceClientId||''),accountId:String(job.accountId||''),clientName:String(job.clientDisplay||job.clientName||''),accountName:String(job.accountDisplay||job.accountName||''),parentCaseId:String(job.parentCaseId||''),workflow:{round:Number(job.workflow?.round||1)},correctionReason:correctionText(job)}};
    state.open=draft;saveDraft(job.id,draft);return draft;
  }
  // The push is a courtesy on top of an already-committed Firestore write.
  // It must never fail the submit/review it follows, and it must never claim
  // success it cannot prove: the recipient is derived server-side, so a
  // rejection here means the other side simply was not told.
  async function notifyPush(kind,payload){
    const api=root.EditorPush,user=state.user||root.FB_USER;
    if(!api?.dispatchNotify||typeof user?.getIdToken!=='function')return{ok:false,reason:'push_unavailable'};
    let result={ok:false,reason:'push_failed'};
    try{result=await api.dispatchNotify({...payload,kind,idToken:await user.getIdToken()})||result}
    catch(error){console.warn('feedback push',error)}
    if(!result?.ok)toast('相手への通知は届かなかった可能性があります');
    return result;
  }
  function editorRows(){return state.editorRows.slice().sort((a,b)=>stamp(b.createdAt)-stamp(a.createdAt))}
  function renderEditorPage(){
    const current=state.open,rows=editorRows();
    const form=current?`<section class="card feedback-workflow"><div class="section-title"><h2>過去フィードバックに記録</h2><span>修正時の学びを次回へ残します</span></div>${current.job.correctionReason?`<div class="job-urgent-note"><b>Dからの修正指示</b><br>${esc(current.job.correctionReason)}</div>`:''}<div class="field"><label for="feedback-workflow-learning">今回の学び・次回の注意点 *</label><textarea id="feedback-workflow-learning" maxlength="${MAX_NOTE}" placeholder="例：冒頭1秒で結論を出す。テロップは句読点の位置で改行する。">${esc(current.learning||'')}</textarea></div><div class="actions"><button class="btn small" type="button" onclick="FeedbackWorkflow.saveOpenDraft()">下書きを保存</button><button class="btn primary small" type="button" onclick="FeedbackWorkflow.submit()">提出する</button></div></section>`:'<section class="card"><p class="muted">「修正中」の案件を開くと、ここから過去フィードバックを記録できます。</p></section>';
    const list=rows.length?rows.map(row=>`<article class="card"><b>${esc(row.jobTitle||'案件')}</b><span class="tag">${esc(row.status==='approved'?'マニュアル化済み':row.status==='rejected'?'差し戻し':'確認待ち')}</span><p style="white-space:pre-wrap">${esc(row.learning)}</p>${row.reviewNote?`<p class="muted">確認コメント：${esc(row.reviewNote)}</p>`:''}</article>`).join(''):'<p class="muted">まだ記録はありません。</p>';
    return`<div class="page"><div class="page-head"><h1>過去フィードバック</h1><p>修正から得た学びを、承認後に自分向けマニュアルとして残します。</p></div>${state.editorReadError?`<div class="notice warn">${esc(state.editorReadError)}</div>`:''}${form}<section><div class="section-title"><h2>自分の記録</h2></div>${list}</section></div>`;
  }
  function renderManagerPage(){
    if(!isOwner()&&!isDirector())return'<div class="page"><div class="empty">このページを確認する権限がありません。</div></div>';
    const rows=state.managerRows.filter(canSee).sort((a,b)=>stamp(b.createdAt)-stamp(a.createdAt));
    const cards=rows.length?rows.map(row=>`<article class="card"><div class="section-title"><h3>${esc(row.editorName||'編集者')}：${esc(row.jobTitle||'案件')}</h3><span>${esc(row.status)}</span></div>${row.correctionReason?`<p class="muted">修正指示：${esc(row.correctionReason)}</p>`:''}<p style="white-space:pre-wrap">${esc(row.learning)}</p>${row.status==='submitted'?`<div class="field"><label for="feedback-review-${esc(row.id)}">確認コメント（任意）</label><textarea id="feedback-review-${esc(row.id)}" maxlength="${MAX_REVIEW}"></textarea></div><div class="actions"><button class="btn primary small" onclick="FeedbackWorkflow.review('${esc(row.portalUid)}','${esc(row.id)}','approved')">承認してマニュアル化</button><button class="btn small" onclick="FeedbackWorkflow.review('${esc(row.portalUid)}','${esc(row.id)}','rejected')">差し戻し</button></div>`:`<p class="muted">${row.reviewNote?`確認コメント：${esc(row.reviewNote)}`:'確認済み'}</p>`}</article>`).join(''):'<p class="muted">確認待ちの過去フィードバックはありません。</p>';
    return`<div class="page"><div class="page-head"><h1>過去フィードバック</h1><p>承認した内容だけを、該当編集者向けのマニュアルにします。</p></div>${state.managerReadError?`<div class="notice warn">${esc(state.managerReadError)}</div>`:''}${cards}</div>`;
  }
  function start(mode='editor'){
    // A render can happen for every snapshot.  Keep the one lazy listener
    // alive while this page remains open instead of multiplying reads.
    configure();
    const scopeKey=mode==='manager'?managerPortalUids().join('|'):portalUid();
    if(state.started&&state.mode===mode&&(mode!=='manager'||state.managerScopeKey===scopeKey))return true;
    stop();if(!state.db||!portalUid())return false;
    if(mode==='manager'){
      if(!isOwner()&&!isDirector())return false;
      // Do not leave feedback from a revoked scope visible while the new
      // listener set is still connecting (including the empty-scope state).
      state.managerRows=[];state.managerReadError='';
      state.started=true;state.mode=mode;state.managerScopeKey=scopeKey;
      // Collection-group feedback reads are denied by the nested feedback rule.
      // Both owner and director therefore use their already-authorized portal
      // scope; this also keeps Firestore rules from being treated as filters.
      const rowsByPortal=new Map(),publish=()=>{state.managerRows=[...rowsByPortal.values()].flat().filter(canSee);root.render?.()},uids=managerPortalUids();
      uids.forEach(uid=>{
        const query=state.db.collection('editor_portals').doc(uid).collection('feedback').orderBy('createdAt','desc').limit(200);
        state.unsubs.push(query.onSnapshot(
          s=>{rowsByPortal.set(uid,s.docs.map(d=>normalize(d.id,d.data())));state.managerReadError='';publish()},
          e=>{rowsByPortal.delete(uid);publish();listenerError('manager',e,uid)}
        ));
      });
    }else{
      state.started=true;state.mode=mode;
      const q=state.db.collection('editor_portals').doc(portalUid()).collection('feedback').orderBy('createdAt','desc').limit(200);
      state.unsubs.push(q.onSnapshot(s=>{state.editorRows=s.docs.map(d=>normalize(d.id,d.data()));state.editorReadError='';root.render?.()},e=>listenerError('editor',e)));
    }
    return true;
  }
  function stop(){state.unsubs.splice(0).forEach(unsub=>{try{unsub()}catch(_){}});state.started=false;state.mode='';state.managerScopeKey=''}
  function saveOpenDraft(){const open=state.open;if(!open)return false;const input=root.document?.getElementById('feedback-workflow-learning');open.learning=text(input?.value??open.learning);saveDraft(open.job.id,open);toast('下書きを保存しました');return true}
  async function submit(){
    const open=state.open;if(!open||state.submitting)return false;
    saveOpenDraft();if(!open.learning)return toast('フィードバックを入力してください'),false;if(blocked())return false;
    const uid=portalUid(),ref=state.db?.collection('editor_portals').doc(uid).collection('feedback').doc(feedbackId(open.job,open));if(!uid||!ref)return false;
    state.submitting=true;
    const payload={recordType:'editor_feedback',portalUid:uid,jobId:open.job.id,parentCaseId:open.job.parentCaseId||'',editorUid:uid,editorName:userName(),jobTitle:open.job.title,clientId:open.job.clientId,accountId:open.job.accountId,clientName:open.job.clientName,accountName:open.job.accountName,correctionReason:open.job.correctionReason,learning:open.learning,status:'submitted',reviewNote:'',reviewedByUid:'',reviewedByName:'',manualId:'',createdAt:at(),updatedAt:at()};
    try{
      await state.db.runTransaction(async tx=>{const existing=await tx.get(ref);if(existing.exists){const row=normalize(ref.id,existing.data());if(row.status==='submitted'||row.status==='approved')return;throw new Error('feedback-already-reviewed')}tx.set(ref,payload)});
      removeDraft(open.job.id);state.open=null;toast('過去フィードバックを提出しました。確認後にマニュアルへ反映されます');
      notifyPush('feedback',{portalUid:uid,jobId:open.job.id});
      return true;
    }catch(error){console.warn('feedback submit',error);toast(error?.message==='feedback-already-reviewed'?'確認済みの記録は再提出できません':'過去フィードバックを提出できませんでした','err');return false}finally{state.submitting=false}
  }
  async function review(portalId,id,nextStatus){
    if((nextStatus!=='approved'&&nextStatus!=='rejected')||!canSee({portalUid:portalId})||state.reviewing.has(`${portalId}/${id}`)||blocked())return false;
    const row=state.managerRows.find(x=>x.portalUid===String(portalId)&&x.id===String(id));if(!row||row.status!=='submitted'||!state.db)return false;
    const input=root.document?.getElementById(`feedback-review-${id}`),reviewNote=text(input?.value,MAX_REVIEW),key=`${portalId}/${id}`,feedbackRef=state.db.collection('editor_portals').doc(portalId).collection('feedback').doc(id),manualRef=state.db.collection('editor_manuals').doc(manualId(row));state.reviewing.add(key);
    try{await state.db.runTransaction(async tx=>{const snap=await tx.get(feedbackRef);if(!snap.exists)throw new Error('missing-feedback');const latest=normalize(id,snap.data());if(latest.status!=='submitted')throw new Error('already-reviewed');const reviewerUid=portalUid(),reviewerName=userName(),review={status:nextStatus,reviewNote,reviewedByUid:reviewerUid,reviewedByName:reviewerName,updatedAt:at()};tx.update(feedbackRef,review);if(nextStatus==='approved')tx.set(manualRef,{recordType:'editor_manual',kind:'feedback',title:`過去フィードバック：${latest.jobTitle||'案件'}`.slice(0,160),body:latest.learning,url:'',scope:latest.accountId?'account':latest.clientId?'client':'global',scopeLabel:latest.accountId?'アカウント':latest.clientId?'クライアント':'全体',clientId:latest.clientId,accountId:latest.accountId,version:'1.0',required:false,audience:'assigned',allowedUids:[latest.editorUid],directorUid:isDirector()?reviewerUid:'',origin:{type:'editor_feedback',portalUid:latest.portalUid,feedbackId:latest.id,jobId:latest.jobId},active:true,createdAt:at(),createdBy:reviewerName,updatedAt:at(),updatedBy:reviewerName},{merge:false});if(nextStatus==='approved')tx.update(feedbackRef,{manualId:manualRef.id})});toast(nextStatus==='approved'?'承認し、編集者向けマニュアルへ反映しました':'差し戻しました');notifyPush('feedback',{portalUid:String(portalId),jobId:row.jobId});return true}catch(error){console.warn('feedback review',error);toast(error?.message==='already-reviewed'?'すでに確認済みです':'確認結果を保存できませんでした','err');return false}finally{state.reviewing.delete(key)}}
  const api={configure,openFromJob,renderEditorPage,renderManagerPage,start,stop,submit,review,saveOpenDraft,_test:{normalize,isCorrection,feedbackId,manualId,canSee,managerPortalUids,listenerError}};
  root.EditflowFeedback=api;
  // Backward-compatible short name for the inline buttons rendered by this
  // module.  Integrations should use EditflowFeedback.
  root.FeedbackWorkflow=api;
})(window);
