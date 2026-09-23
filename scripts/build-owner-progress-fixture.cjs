const fs=require('node:fs');
const {source,extract}=require('../tests/helpers/owner-progress-source.cjs');
const functions=['_legacyPortalStatusLocked','_ownerCanOverridePortalStatus','_ownerCanEditProgress','_ownerProgressAction','_ownerProgressButton','_ownerStatusBadge','_ownerPortalInlineHtml','toggleOwnerInlineProgress','saveOwnerInlineProgress','_refreshOwnerInlineProgress','_refreshJobModalPortalSubProgress','_legacySubcasePortalDetailStatus','_videoSubcaseDetailHtml','_findVideoSubcase','openLegacySubcaseDetail','saveLegacySubcaseDraftDates','openVideoProgressModal','saveLegacyProgressFromBoard','_videoWorkflowStageForStatus','_videoManualProgressRound','_portalStatusReasonRequired','_portalStatusAuditReason','_portalStatusEvidenceRequired','_portalWorkflowSaveErrorMessage','_validPortalCompletionDate','setPortalWorkflowStatus','_applyPortalToLegacy','_aggregateSubcaseStatus'];
const css=source.match(/<style>([^]*?)<\/style>/)[1];
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><title>オーナー進捗保存 検証</title><style>${css}
body{display:block;overflow:auto;padding:24px}main{max-width:960px;margin:auto}#modal:not(:empty){margin:20px auto;padding:24px;background:white;max-width:700px;border:1px solid #ddd;border-radius:12px}.fixture-actions{display:flex;gap:8px;flex-wrap:wrap}#result{white-space:pre-wrap}</style>
<main><h1>オーナー進捗保存 検証</h1><p>架空データ専用。Firebase接続なし。保存先はこの検証ページのローカル記録のみ。</p><div class="fixture-actions"><button onclick="resetFixture()">検証データを初期化</button><button onclick="show('detail')">サブ案件詳細</button><button onclick="show('parent')">親案件編集</button><button onclick="show('portal')">ポータル案件詳細</button><button onclick="openVideoProgressModal('legacy','ordinary','')">通常案件の進捗</button><button onclick="preview=!preview;show('parent')">権限プレビュー切替</button><button onclick="failNext=true">次の保存を通信エラーにする</button></div><p id="notice" role="status"></p><div id="modal"></div><pre id="result"></pre></main><script>
const storageKey='owner-progress-fixture-v1';
const statuses=['アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了'];
const VIDEO_WORKFLOW_STATUSES=statuses,SCOLBG={},JOB_MODAL_SUB_RECORDS=[],ACCESS_RECORDS=[],SELF_WID='self';let preview=false,failNext=false;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const _isActualOwner=()=>true,_isOwner=()=>!preview,_rolePreviewActive=()=>preview,_videoCanEdit=()=>!preview;
const today=()=> '2026-09-23',_myEmail=()=> 'owner@example.test',FB_USER={uid:'owner',emailVerified:true};
const jobBiz=()=> 'edit',bizCfgOf=()=>({statuses}),bizStatusLabel=(_b,s)=>s,videoStatusLabel=s=>s,_jobSubDefaultStatus=()=> 'アサイン済み';
const _editorOwnsPortalCompletion=()=>false,_canManagePortalWorkflow=()=>!preview,_videoWorkflow=j=>j.workflow||{round:1,stage:'editing'},_videoSafeUrl=s=>s;
const _videoCaseMaterials=()=>[],_caseManualIds=x=>x||[],_jobCaseManualCardsHtml=()=>'',_videoSubtaskAssignee=()=> '社内対応（検証）',_videoAttachmentLinksHtml=()=>'',_editorDraftDateSetter=j=>j?.editorDraftDateSetter||'creator';
const _paymentRecipientSnapshot=()=>({}),_videoUpdatedMillis=v=>Number(v)||0,_portalField=(j,k,f)=>Object.hasOwn(j,k)?j[k]:f,_videoAttachments=x=>x||[],updateJobInternalScheduleRules=()=>{};
let S,PORTAL_JOBS,persisted;
function init(){const saved=JSON.parse(localStorage.getItem(storageKey)||'null');S=saved?.S||{workers:[],jobs:[{id:'parent',title:'保存確認用の親案件',status:'先方確認中',subtasks:[{id:'child',title:'保存確認用のサブ案件',status:'先方確認中',workerId:'self',portalUid:'u',portalJobId:'p',editorDraftDate:'2026-09-14'}]},{id:'ordinary',title:'通常案件の保存確認',status:'進行中'}]};PORTAL_JOBS=saved?.PORTAL_JOBS||[{id:'p',_portalUid:'u',title:'保存確認用のサブ案件',status:'先方確認中',workflow:{round:1,stage:'client_review'},legacyParentId:'parent',legacySubtaskId:'child',progressEvents:[]}];persisted=JSON.parse(JSON.stringify(PORTAL_JOBS[0]));result();}
function result(){document.getElementById('result').textContent=JSON.stringify({portal:PORTAL_JOBS[0].status,child:S.jobs[0].subtasks[0].status,parent:S.jobs[0].status,done:S.jobs[0].subtasks[0].done||false,completion:PORTAL_JOBS[0].completedDeliveryDate||'',audit:PORTAL_JOBS[0].progressEvents.length,ordinary:S.jobs[1].status},null,2);}
function save(){localStorage.setItem(storageKey,JSON.stringify({S,PORTAL_JOBS}));result()}
function render(){result()}
function openModal(html){document.getElementById('modal').innerHTML=html}
function openModalLg(html){openModal(html)}
function closeModal(){document.getElementById('modal').innerHTML=''}
function toast(msg){document.getElementById('notice').textContent=msg;result()}
function resetFixture(){localStorage.removeItem(storageKey);init();show('detail')}
function show(type){if(type==='detail'){openLegacySubcaseDetail('parent','child');return;}const record={portalUid:'u',portalJobId:'p'};openModal('<h2>'+ (type==='parent'?'親案件編集':'ポータル案件詳細')+'</h2><label>未保存のメモ<input aria-label="未保存のメモ" value="保持する入力"></label><input id="'+(type==='parent'?'j-stat':'vp-status')+'" data-status="'+PORTAL_JOBS[0].status+'" readonly value="'+PORTAL_JOBS[0].status+'">'+_ownerPortalInlineHtml(record,'owner-'+type));}
const ref={collection(){return this},doc(){return this}};
const fbDb={collection:()=>ref,batch(){let writes=[];return{set(_ref,data){writes.push(data)},async commit(){if(failNext){failNext=false;throw {code:'unavailable'}}persisted={...persisted,...JSON.parse(JSON.stringify(writes[0]))}}}}};
const firebase={firestore:{FieldValue:{serverTimestamp:()=>Date.now()}}};
const PORTAL_WORKFLOW_ACTION_PENDING=new Set();
${functions.map(extract).join('\n')}
init();show('detail');
</script></html>`;
fs.writeFileSync(require('node:path').resolve(__dirname,'../tests/owner-progress-everywhere.visual.html'),html);
