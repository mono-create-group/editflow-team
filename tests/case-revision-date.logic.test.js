const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'..','app-ui.css'),'utf8');
const sw=fs.readFileSync(path.resolve(__dirname,'..','sw.js'),'utf8');

function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  const asyncStart=html.lastIndexOf('async ',start);
  const from=asyncStart>=0&&asyncStart+6===start?asyncStart:start;
  let depth=0,opened=false;
  for(let i=start;i<html.length;i+=1){
    if(html[i]==='{'){depth+=1;opened=true;}
    if(html[i]==='}'&&opened&&--depth===0)return html.slice(from,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}
const plain=value=>JSON.parse(JSON.stringify(value));

test('修正日は編集代行・編集者派遣のカレンダー表示基準に3つ目として入る',()=>{
  const matches=html.match(/prio:\[\['clientDraftDate','クライアント初稿'\],\['editorDraftDate','編集者初稿'\],\['revisionDate','修正日'\]\]/g)||[];
  assert.equal(matches.length,2,'edit と haken の両方');
});

test('案件・子案件・ポータル案件の正規化行がすべて revisionDate を持つ',()=>{
  assert.match(functionSource('_videoSubtasks'),/revisionDate:s\.revisionDate\|\|''/);
  const jobs=functionSource('_videoJobs');
  assert.match(jobs,/revisionDate:j\.revisionDate\|\|''/,'旧案件');
  assert.match(jobs,/revisionDate:_revisionDateOfPortalJob\(j\._portalUid,j\.id\)/,'ポータル案件は台帳側の値を読む');
  assert.match(functionSource('_videoGroupPortalJobs'),/revisionDate:''/,'親のまとめ行');
});

function rowsContext({scope='all'}={}){
  const context={
    PBIZ:'edit',CASE_CAL_SCOPE:scope,SELF_WID:'self',
    _videoJobs:()=>[],
    _videoWorkerAssignmentIds:job=>job.workerIds||[],
  };
  vm.createContext(context);
  vm.runInContext(['_caseScheduleRows','_caseScheduleSortRows','_caseScheduleRowStatus','_caseScheduleRowInternal','_caseScheduleScopedRows'].map(functionSource).join('\n')+'\nthis.scoped=_caseScheduleScopedRows;this.rows=_caseScheduleRows;',context);
  return context;
}

test('修正日の表示は日付つきと「修正中で未入力」だけを残し、全案件が未設定に並ばない',()=>{
  const context=rowsContext();
  context._videoJobs=()=>[
    {id:'a',biz:'edit',title:'日付あり',status:'修正中',revisionDate:'2026-11-15'},
    {id:'b',biz:'edit',title:'修正中で未入力',status:'修正中',revisionDate:''},
    {id:'c',biz:'edit',title:'進行中で未入力',status:'進行中',revisionDate:''},
    {id:'d',biz:'edit',title:'進行中だが日付あり',status:'進行中',revisionDate:'2026-11-20'},
    {id:'e',biz:'edit',title:'完了',status:'完了',revisionDate:'2026-11-01'},
  ];
  const titles=field=>plain(context.scoped(field).map(row=>row.job.title)).sort();
  // _caseScheduleRows の既定引数 source=_videoJobs() を使うため、行の元データを差し替えて確認する
  assert.deepEqual(titles('revisionDate'),['修正中で未入力','日付あり','進行中だが日付あり'].sort());
  assert.deepEqual(titles('editorDraftDate'),['修正中で未入力','日付あり','進行中で未入力','進行中だが日付あり'].sort(),'初稿の表示は今までどおり全件');
});

test('修正日の表示でも担当「社内対応のみ」の絞り込みが効く',()=>{
  const context=rowsContext({scope:'internal'});
  context._videoJobs=()=>[
    {id:'a',biz:'edit',title:'社内',status:'修正中',revisionDate:'2026-11-15',workerIds:['self']},
    {id:'b',biz:'edit',title:'外部',status:'修正中',revisionDate:'2026-11-15',workerIds:['w1']},
  ];
  assert.deepEqual(plain(context.scoped('revisionDate').map(row=>row.job.title)),['社内']);
});

function makeContext({canEdit=true}={}){
  const calls=[];
  const context={
    S:{jobs:[
      {id:'legacy-1',biz:'edit',title:'社内案件',status:'修正中',revisionDate:null,subtasks:[]},
      {id:'legacy-2',biz:'edit',title:'サブあり親',status:'進行中',subtasks:[{id:'s1',title:'子1',status:'修正中'},{id:'s2',title:'子2',status:'進行中',revisionDate:'2026-11-18'}]},
      {id:'legacy-3',biz:'edit',title:'外部編集者の案件',portalUid:'uid-9',portalJobId:'pj-9',status:'修正中',subtasks:[]},
      {id:'legacy-4',biz:'edit',title:'外部サブあり親',status:'進行中',subtasks:[{id:'c1',title:'外部の子',portalUid:'uid-8',portalJobId:'pj-8',status:'修正中'}]},
    ]},
    _videoCanEdit:()=>canEdit,
    _myEmail:()=>'owner@example.com',
    _findVideoSubcase:(parent,subId)=>{const index=(parent?.subtasks||[]).findIndex((sub,i)=>String(sub?.id||i)===String(subId));return index<0?null:{index,sub:parent.subtasks[index]};},
    _isScopedVideoDirectorAccess:()=>false,
    save:()=>calls.push(['save']),
    render:()=>calls.push(['render']),
    toast:(message,kind)=>calls.push(['toast',message,kind||'']),
    esc:value=>String(value??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    today:()=>'2026-11-11',
    openModal:markup=>calls.push(['openModal',markup]),
    closeModal:()=>calls.push(['closeModal']),
    document:{getElementById:id=>id==='rev-date'?{value:context.__dateValue||''}:null},
  };
  vm.createContext(context);
  vm.runInContext(['_revisionLegacyTarget','_revisionDateOfPortalJob','_revisionResolveTarget','_caseScheduleSetRevisionDate','_caseScheduleSetDate','openRevisionDateModal','saveRevisionDateModal'].map(functionSource).join('\n')+'\nthis.setRev=_caseScheduleSetRevisionDate;this.setDate=_caseScheduleSetDate;this.portalRev=_revisionDateOfPortalJob;this.openModalFor=openRevisionDateModal;this.saveModal=saveRevisionDateModal;',context);
  return{context,calls};
}

test('旧案件に修正日を入れると、その案件だけに保存され履歴が残る',()=>{
  const{context,calls}=makeContext();
  context.setRev({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'2026-11-15');
  const job=context.S.jobs[0];
  assert.equal(job.revisionDate,'2026-11-15');
  assert.equal(context.S.jobs[1].revisionDate,undefined,'他の案件は触らない');
  assert.equal(job.statusHistory.at(-1).type,'calendar_date_move');
  assert.equal(job.statusHistory.at(-1).field,'revisionDate');
  assert.equal(job.status,'修正中','ステータスは変えない');
  assert.deepEqual(calls.map(c=>c[0]),['save','render','toast']);
  assert.equal(calls.at(-1)[1],'修正日を2026-11-15に設定しました');
});

test('子案件の修正日は対象の子案件だけに入り、兄弟の修正日は変わらない',()=>{
  const{context}=makeContext();
  context.setRev({t:'sub',s:'legacy',j:'legacy-2',u:'',sub:'s1',pj:'',pu:''},'2026-11-16');
  const[first,second]=context.S.jobs[1].subtasks;
  assert.equal(first.revisionDate,'2026-11-16');
  assert.equal(second.revisionDate,'2026-11-18');
  assert.equal(context.S.jobs[1].revisionDate,undefined,'親には書かない');
});

test('修正日は空にして消せる',()=>{
  const{context,calls}=makeContext();
  context.setRev({t:'sub',s:'legacy',j:'legacy-2',u:'',sub:'s2',pj:'',pu:''},'');
  assert.equal(context.S.jobs[1].subtasks[1].revisionDate,null);
  assert.equal(calls.at(-1)[1],'修正日を消しました');
  calls.length=0;
  context.setRev({t:'sub',s:'legacy',j:'legacy-2',u:'',sub:'s2',pj:'',pu:''},'');
  assert.deepEqual(calls,[],'すでに空なら何も保存しない');
});

test('外部編集者に割り当てた案件（ポータル行）も、オーナー台帳側に修正日を保存して読み戻せる',()=>{
  const{context,calls}=makeContext();
  context.setRev({t:'job',s:'portal',j:'pj-9',u:'uid-9',sub:'',pj:'',pu:''},'2026-11-17');
  assert.equal(context.S.jobs[2].revisionDate,'2026-11-17');
  assert.equal(context.portalRev('uid-9','pj-9'),'2026-11-17');
  assert.ok(!calls.some(c=>c[0]==='firestore'),'Firestore のポータル文書には書かない（ルールで書けるキーが固定のため）');

  context.setRev({t:'sub',s:'portal-parent',j:'parent:x',u:'uid-8',sub:'pj-8',pj:'pj-8',pu:'uid-8'},'2026-11-19');
  assert.equal(context.S.jobs[3].subtasks[0].revisionDate,'2026-11-19');
  assert.equal(context.portalRev('uid-8','pj-8'),'2026-11-19');
});

test('台帳に対応する案件が無い（編集者が直接登録した）行は、理由を出して何も保存しない',()=>{
  const{context,calls}=makeContext();
  const before=JSON.stringify(context.S);
  context.setRev({t:'job',s:'portal',j:'unknown',u:'uid-x',sub:'',pj:'',pu:''},'2026-11-17');
  assert.equal(JSON.stringify(context.S),before);
  assert.deepEqual(calls,[['toast','この案件は編集者が直接登録したため、修正日を保存できません','warn']]);
});

test('権限が無い・日付が不正なときは保存しない',()=>{
  const denied=makeContext({canEdit:false});
  denied.context.setRev({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'2026-11-15');
  assert.equal(denied.context.S.jobs[0].revisionDate,null);
  assert.deepEqual(denied.calls,[['toast','権限がありません','err']]);

  const{context,calls}=makeContext();
  context.setRev({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'11/15');
  assert.equal(context.S.jobs[0].revisionDate,null);
  assert.deepEqual(calls,[['toast','修正日は日付で入力してください','warn']]);
});

test('カレンダーのドロップ経路（_caseScheduleSetDate）でも修正日を動かせて、他の日付フィールドは拒否のまま',async()=>{
  const{context,calls}=makeContext();
  await context.setDate({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'revisionDate','2026-11-22');
  assert.equal(context.S.jobs[0].revisionDate,'2026-11-22');
  assert.deepEqual(calls.map(c=>c[0]),['save','render','toast']);
  calls.length=0;
  await context.setDate({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''},'deliveryDate','2026-11-22');
  assert.deepEqual(calls,[],'未対応のフィールドは今までどおり何もしない');
});

test('修正日の入力モーダル：現在値の表示・保存・消去が同じ保存経路を通る',()=>{
  const{context,calls}=makeContext();
  const ref=JSON.stringify({t:'sub',s:'legacy',j:'legacy-2',u:'',sub:'s2',pj:'',pu:''});
  context.openModalFor(ref);
  const modal=calls.find(c=>c[0]==='openModal')[1];
  assert.match(modal,/id="rev-date"[^>]*value="2026-11-18"/,'入力済みの修正日が初期値');
  assert.match(modal,/修正日を消す/);
  assert.match(modal,/ステータスは変わりません/);
  calls.length=0;
  context.__dateValue='2026-11-25';context.saveModal(ref,false);
  assert.equal(context.S.jobs[1].subtasks[1].revisionDate,'2026-11-25');
  assert.equal(calls[0][0],'closeModal');
  calls.length=0;
  context.saveModal(ref,true);
  assert.equal(context.S.jobs[1].subtasks[1].revisionDate,null);

  // 未入力の案件は今日が初期値で「消す」ボタンは出ない
  calls.length=0;
  context.openModalFor(JSON.stringify({t:'job',s:'legacy',j:'legacy-1',u:'',sub:'',pj:'',pu:''}));
  const empty=calls.find(c=>c[0]==='openModal')[1];
  assert.match(empty,/value="2026-11-11"/);
  assert.doesNotMatch(empty,/修正日を消す/);
});

test('カレンダー：修正日の表示では未設定の案件から直接入力でき、初稿の表示には修正日の印が出る',()=>{
  const calendar=functionSource('rProjCalendar');
  assert.match(calendar,/field==='revisionDate'\?`openRevisionDateModal\(\$\{JSON\.stringify\(ref\)\}\)`:_caseScheduleOpenAction\(row\)/);
  assert.match(calendar,/\$\{_caseRevisionButton\(ref\)\}/);
  assert.match(calendar,/field!=='revisionDate'\?_caseRevisionChip\(row\):''/);
  assert.match(calendar,/class="case-calendar-item[^"]*"[^>]*draggable="true" data-case-ref="\$\{esc\(ref\)\}"/,'ドラッグ移動の属性は今までどおり');
  assert.match(functionSource('_caseRevisionButton'),/openRevisionDateModal\(\$\{esc\(JSON\.stringify\(ref\)\)\}\)/);
  assert.match(css,/\.case-calendar-revision\{/);
  assert.match(css,/\.case-revision-action\{/);
});

test('案件編集フォームの修正日：単独案件と子案件の入力欄と保存が揃っている',()=>{
  assert.match(html,/id="j-revision"[^>]*value="\$\{esc\(j\?\.revisionDate\|\|''\)\}"/);
  assert.match(html,/class="j-sub-revision" type="date" value="\$\{esc\(s\.revisionDate\|\|''\)\}"/);
  const save=functionSource('saveJob');
  assert.match(save,/document\.getElementById\('j-revision'\)/);
  assert.match(save,/!hasSubcaseStructure&&revisionInput&&\(revisionInput\.value\|\|current\?\.revisionDate\)\)data\.revisionDate=revisionInput\.value\|\|null/);
  assert.match(save,/el\.querySelector\('\.j-sub-revision'\)\?\{revisionDate:el\.querySelector\('\.j-sub-revision'\)\.value\|\|null\}:\{\}/,'欄が無い子案件は既存の修正日を残す');
});

test('Firestore のポータル文書には修正日を書かない（ルールで書けるキーが固定）',()=>{
  const source=['_caseScheduleSetRevisionDate','_revisionResolveTarget','_revisionLegacyTarget'].map(functionSource).join('\n');
  assert.doesNotMatch(source,/fbDb|editor_portals|\.set\(/);
});

test('版の数字と service worker のキャッシュ名が揃っている',()=>{
  const version=html.match(/const APP_VERSION='([^']+)'/)[1];
  assert.match(sw,new RegExp(`const CACHE='mcshanai-${version}'`));
});
