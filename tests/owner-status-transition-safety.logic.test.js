const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('video owner options keep pre-assignment flow and expose the nine official post-assignment states', () => {
  const expected = ['アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了'];
  assert.match(index, /const VIDEO_WORKFLOW_STATUSES=\['アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了'\]/);
  const edit = index.slice(index.indexOf('  edit:{'), index.indexOf('\n  },', index.indexOf('  edit:{')));
  const haken = index.slice(index.indexOf('  haken:{'), index.indexOf('\n  },', index.indexOf('  haken:{')));
  assert.match(edit, /statuses:\['案件掲載中','未着手','アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了','キャンセル'\]/);
  assert.match(haken, /statuses:\['案件掲載中','募集中','編集者決定','受注済み','アサイン済み','進行中','編集者進行中','初稿提出済み','修正中','修正稿提出済み','D確認OK','先方確認中','完了','キャンセル'\]/);
  for (const value of expected) {
    assert.ok(edit.includes(`'${value}'`));
    assert.ok(haken.includes(`'${value}'`));
  }
  assert.match(index, /function bizStatOpts\(k,cur\)\{const list=bizCfgOf\(k\)\.statuses\.slice\(\);if\(cur&&list\.indexOf\(cur\)<0\)list\.unshift\(cur\)/);
});

test('linked subcases change progress from the visible status field without bypassing the portal workflow', () => {
  assert.match(index, /function _legacyPortalStatusLocked\(record\)\{return !!\(record&&String\(record\.portalUid\|\|''\)\.trim\(\)&&String\(record\.portalJobId\|\|''\)\.trim\(\)\);\}/);
  assert.match(index, /id="j-stat" onchange="jobStatusChanged\(this\)" \$\{linkedPortalParent\?'disabled':''\}/);
  assert.match(index, /class="j-sub-status"[^>]*onchange="jobSubStatusChanged\(this\)"/);
  assert.match(index, /portalStatusLocked&&!portalJob\?'disabled':''/);
  assert.match(index, /function _portalSubcaseStatusOptions\(job\)/);
  assert.match(index, /ステータス欄から進捗を変更できます/);
  assert.match(index, /現在の工程で選べる進捗だけを表示します。/);
  assert.match(index, /if\(_legacyPortalStatusLocked\(current\)&&requestedStatus!==current\.status\)\{toast\('進捗はサブ案件詳細の進捗操作で更新してください','warn'\);return;\}/);
  assert.match(index, /if\(_legacyPortalStatusLocked\(previous\)&&requestedSubStatus!==previous\.status\)subStatusError=/);
  assert.match(index, /if\(subStatusError\)\{toast\(subStatusError,'warn'\);return;\}/);
  assert.match(index, /const portalProgressAction=portalStatusLocked\?`openPortalJobModal\(\$\{JSON\.stringify\(String\(s\.portalUid\)\)\},\$\{JSON\.stringify\(String\(s\.portalJobId\)\)\}\)`:\'\';/);
  assert.match(index, /onclick="\$\{esc\(portalProgressAction\)\}"/);
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const action = `openPortalJobModal(${JSON.stringify('uid"with-quote')},${JSON.stringify('job"with-quote')})`;
  const rendered = `<button onclick="${esc(action)}">進捗を開く</button>`;
  assert.match(rendered, /onclick="openPortalJobModal\(&quot;uid\\&quot;with-quote&quot;,&quot;job\\&quot;with-quote&quot;\)"/);
  assert.doesNotMatch(rendered, /onclick="openPortalJobModal\("/);
});

test('portal job administration displays status only and rejects tampered raw status saves', () => {
  const modal = index.slice(index.indexOf('function openPortalJobModal'), index.indexOf('\nasync function savePortalJobAdmin'));
  const save = index.slice(index.indexOf('async function savePortalJobAdmin'), index.indexOf('\nfunction _portalLegacyId'));
  assert.match(modal, /<input id="vp-status" value="\$\{esc\(bizStatusLabel\(portalBiz,j\.status\)\)\}" data-status="\$\{esc\(j\.status\)\}" readonly aria-readonly="true">/);
  assert.doesNotMatch(modal, /<select id="vp-status"/);
  assert.match(modal, /進捗は下の「進捗共有」の操作から更新します。/);
  assert.match(save, /const statusField=document\.getElementById\('vp-status'\),requestedStatus=String\(statusField\?\.dataset\.status\|\|j\.status\);/);
  assert.match(save, /if\(String\(statusField\?\.value\|\|''\)!==bizStatusLabel\(_portalVideoBiz\(j\),j\.status\)\|\|requestedStatus!==j\.status\)return toast\('進捗は「進捗共有」の操作から更新してください','warn'\);/);
  assert.match(index, /function advancePortalWorkflow\(portalUid,id,action,providedReason,providedCompletionDate,providedImages,options\)/);
});

test('linked parent subcases expose only current valid workflow actions inline', () => {
  assert.match(index, /function _canManagePortalWorkflow\(job\)\{/);
  assert.match(index, /if\(_isActualOwner\(\)\)return FB_USER\?\.emailVerified===true/);
  assert.match(index, /return hasAppRole\('動画編集ディレクター'\)/);
  assert.match(index, /String\(job\.directorUid\)===String\(FB_USER\?\.uid\|\|''\)/);
  assert.match(index, /if\(!_canManagePortalWorkflow\(j\)\)return toast\('この案件の進捗を変更する権限がありません','err'\)/);
  assert.match(index, /function _portalWorkflowActionsForJob\(job\)\{/);
  assert.match(index, /stage==='director_review'\)return\[\['directorRevision','修正指示（修正中）'\],\['directorApprove','D確認OKにする'\],\['directorApproveAndSubmit','D確認OK・先方へ提出済み（先方確認中）'\]\]/);
  // 会長報告: D確認OK の子案件を「完了」に変えられなかった。D確認OK からは先方提出（先方確認中）と先方OK（完了）を
  // 一度に記録する複合操作を出す。担当編集者が完了を記録する案件（派遣）では出さない。
  assert.match(index, /stage==='client_submission'\)return _editorOwnsPortalCompletion\(job\)\?\[\['clientSubmitted','先方確認中にする'\]\]:\[\['clientSubmitted','先方確認中にする'\],\['clientSubmitAndApprove','先方提出済み・先方OK（完了）'\]\]/);
  assert.match(index, /clientSubmitAndApprove:'完了'/);
  const combined = index.slice(index.indexOf("if(action==='clientSubmitAndApprove'){"), index.indexOf("if(action==='clientApproved'&&_editorOwnsPortalCompletion(j))return toast("));
  assert.match(combined, /_videoWorkflow\(j\)\.stage!=='client_submission'\)return toast/);
  assert.match(combined, /if\(_editorOwnsPortalCompletion\(j\)\)return toast/);
  assert.match(combined, /advancePortalWorkflow\(portalUid,id,'clientSubmitted','',providedCompletionDate\)/);
  assert.match(combined, /if\(submitted!==true\)return submitted;/);
  assert.match(combined, /return advancePortalWorkflow\(portalUid,id,'clientApproved','',providedCompletionDate\);/);
  assert.match(index, /w\.stage==='client_submission'\?\(editorCompletion\?\[\['clientSubmitted','先方へ提出する'\]\]:\[\['clientSubmitted','先方へ提出する'\],\['clientSubmitAndApprove','先方提出済み・クライアントOK・完了'\]\]\):/);
  assert.match(index, /stage==='client_review'\)return _editorOwnsPortalCompletion\(job\)\?\[\['clientRevision','修正指示（修正中）'\]\]:\[\['clientRevision','修正指示（修正中）'\],\['clientApproved','先方OK（完了）'\]\]/);
  assert.match(index, /function advanceLegacyPortalSubcaseWorkflow\(portalUid,jobId,controlKey\)\{/);
  assert.match(index, /selectedOptions\?\.\[0\]\?\.dataset\?\.action/);
  assert.match(index, /const allowed=_portalWorkflowActionsForJob\(job\)\.map\(\(\[value\]\)=>value\);/);
  assert.match(index, /if\(!allowed\.includes\(action\)\)return toast\('現在の工程ではこの操作はできません。案件を開き直してください','warn'\);/);
  assert.match(index, /修正指示の内容/);
  // 会長指示: 案件編集の「進捗を保存」で親案件の編集画面を閉じない。
  assert.match(index, /await advancePortalWorkflow\(portalUid,jobId,action,reason,completionDate,images,\{keepOpen:true\}\);/);
  assert.match(index, /async function advancePortalWorkflow\(portalUid,id,action,providedReason,providedCompletionDate,providedImages,options\)/);
  assert.match(index, /providedReason===undefined\?\(document\.getElementById\('vp-correction'\)\?\.value\.trim\(\)\|\|''\):String\(providedReason\)\.trim\(\)/);
  assert.match(index, /const PORTAL_WORKFLOW_ACTION_PENDING=new Set\(\);/);
  assert.match(index, /if\(PORTAL_WORKFLOW_ACTION_PENDING\.has\(pendingKey\)\)return toast\('進捗を保存しています。完了までお待ちください','warn'\);/);
  assert.match(index, /byRole:_isActualOwner\(\)\?'owner':'director'/);
  assert.match(index, /function _portalWorkflowSaveErrorMessage\(error\)/);
  assert.match(index, /await batch\.commit\(\);/);
  assert.match(index, /batch\.set\(event,\{\.\.\.eventData,at:firebase\.firestore\.FieldValue\.serverTimestamp\(\)\}\)/);
  assert.match(index, /workflow legacy projection/);
  assert.match(index, /は保存済みです。社内案件一覧への反映は保留です。画面を再読み込みしてください/);
  assert.ok((index.match(/PORTAL_WORKFLOW_ACTION_PENDING\.delete\(pendingKey\);/g) || []).length >= 2);
});

test('inline portal workflow actions quote escaped JSON before placement in an HTML attribute', () => {
  assert.match(index, /const portalConfirmAction=portalStatusLocked\?`advanceLegacyPortalSubcaseWorkflow\(\$\{JSON\.stringify\(String\(s\.portalUid\)\)\},\$\{JSON\.stringify\(String\(s\.portalJobId\)\)\},\$\{JSON\.stringify\(portalControlKey\)\}\)`:'';/);
  assert.match(index, /onclick="\$\{esc\(portalConfirmAction\)\}" disabled>進捗を保存<\/button>/);
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const action = `advanceLegacyPortalSubcaseWorkflow(${JSON.stringify('uid"quoted')},${JSON.stringify('job"quoted')},${JSON.stringify('safe-key')})`;
  const rendered = `<button onclick="${esc(action)}">進捗を保存</button>`;
  assert.match(rendered, /onclick="advanceLegacyPortalSubcaseWorkflow\(&quot;uid\\&quot;quoted&quot;,&quot;job\\&quot;quoted&quot;,&quot;safe-key&quot;\)"/);
  assert.doesNotMatch(rendered, /onclick="advanceLegacyPortalSubcaseWorkflow\("/);
});

test('completion records the selected non-future date in both the job and audit event', () => {
  assert.match(index, /function _validPortalCompletionDate\(value\)/);
  assert.match(index, /id="vp-completion-date" type="date"/);
  assert.match(index, /完了日を今日以前の日付で入力してください/);
  assert.match(index, /action==='clientApproved'\?\{completedDeliveryDate:completionDate\}:\{\}/);
  assert.match(index, /event\.completedDeliveryDate/);
  assert.match(index, /id="\$\{esc\(portalControlKey\)\}-completed-date"/);
  assert.match(index, /data-portal-manager-completion="\$\{managerCompletesPortal\?'1':'0'\}"/);
  assert.match(index, /managerCanSetCompletion=internal\|\|portalManagerCompletion\|\|\(_curJobBiz\(\)==='edit'&&!portalStatusLocked\)/);
  assert.match(index, /if\(completed\)completed\.disabled=!managerCanSetCompletion/);
  assert.match(index, /completedLabel\.textContent=managerCanSetCompletion\?'完了日（Dまたはオーナーが記録）'/);
  assert.match(index, /「完了」にするとき、実際に完了した日を記録します。/);
});

test('ordinary legacy subcases require and retain a completion date when newly completed', () => {
  assert.match(index, /requestedSubStatus==='完了'&&previous\.status!=='完了'&&!requestedCompletionDate/);
  assert.match(index, /を完了にする場合は、完了日を入力してください/);
  assert.match(index, /completedDeliveryDate:requestedCompletionDate/);
  assert.match(index, /if\(date&&select\?\.value==='完了'&&!date\.value\)date\.value=today\(\)/);
});

test('the owner can move a linked subcase to any workflow status through the audited manual override', () => {
  // 会長指示: 子案件モーダルのステータスをオーナーは自由に変えられるようにする。
  // 案件モーダルの「任意の進捗に変更」と同じ経路（理由必須・履歴に残る・ルール検証済み）を子案件のステータス欄から使う。
  const vm = require('node:vm');
  function fnSource(name) {
    const start = index.indexOf(`function ${name}(`);
    assert.notEqual(start, -1, `${name} must exist`);
    const open = index.indexOf('{', start);
    let depth = 0, quote = '', escaped = false;
    for (let i = open; i < index.length; i += 1) {
      const ch = index[i];
      if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
      if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
      if (ch === '{') depth += 1; else if (ch === '}' && --depth === 0) return index.slice(start, i + 1);
    }
    throw new Error(`unterminated ${name}`);
  }
  const make = owner => {
    const ctx = vm.createContext({
      VIDEO_WORKFLOW_STATUSES: ['アサイン済み', '進行中', '編集者進行中', '初稿提出済み', '修正中', '修正稿提出済み', 'D確認OK', '先方確認中', '完了'],
      _isActualOwner: () => owner, _rolePreviewActive: () => false, bizStatusLabel: (_biz, status) => status, _portalVideoBiz: () => 'edit',
      _videoWorkflow: job => job.workflow || { round: 1, stage: 'editing' }, _editorOwnsPortalCompletion: () => false,
    });
    ['_portalWorkflowActionsForJob', '_portalWorkflowTargetStatus', '_ownerCanOverridePortalStatus', '_portalSubcaseStatusOptions'].forEach(name => vm.runInContext(fnSource(name), ctx));
    return ctx;
  };
  // 編集者作業中（案内できる次の1手が無い工程）でも、オーナーには全ステータスが出る。
  const ownerOptions = vm.runInContext(`_portalSubcaseStatusOptions({status:'編集者進行中',workflow:{round:1,stage:'editing'}})`, make(true));
  const values = Array.from(ownerOptions, ([value]) => value);
  assert.equal(values[0], '編集者進行中');
  ['アサイン済み', '進行中', '初稿提出済み', '修正中', '修正稿提出済み', 'D確認OK', '先方確認中', '完了'].forEach(status => assert.ok(values.includes(status), `${status} must be selectable`));
  assert.ok(Array.from(ownerOptions).filter(([, , action]) => action === 'managerStatusOverride').every(([, label]) => /（任意変更）$/.test(label)));
  // 案内される1手（D確認OK など）は任意変更ではなく従来の誘導操作のまま。
  const review = vm.runInContext(`_portalSubcaseStatusOptions({status:'初稿提出済み',workflow:{round:1,stage:'director_review'}})`, make(true));
  assert.equal(Array.from(review).find(([value]) => value === 'D確認OK')[2], 'directorApprove');
  // ディレクター（オーナー以外）には出さない。完了・請求確定済みにも出さない。
  const director = vm.runInContext(`_portalSubcaseStatusOptions({status:'編集者進行中',workflow:{round:1,stage:'editing'}})`, make(false));
  assert.equal(Array.from(director).length, 1);
  assert.equal(vm.runInContext(`_ownerCanOverridePortalStatus({status:'完了'})`, make(true)), false);
  assert.equal(vm.runInContext(`_ownerCanOverridePortalStatus({status:'進行中',payableApproved:true})`, make(true)), false);
  // 子案件モーダルの保存は、監査つきの setPortalWorkflowStatus に値を渡して実行する（ルール上の manager_status_changed 経路）。
  const handler = fnSource('advanceLegacyPortalSubcaseWorkflow');
  assert.match(handler, /if\(action==='managerStatusOverride'\)\{/);
  assert.match(handler, /if\(!_ownerCanOverridePortalStatus\(job\)\)return toast\('任意の進捗変更はオーナーのみ操作できます','err'\);/);
  assert.match(handler, /return setPortalWorkflowStatus\(portalUid,jobId,\{status,reason:overrideReason,evidenceUrl,completionDate,clientApprovalConfirmed,keepOpen:true\}\);/);
  assert.match(handler, /status==='完了'\?confirm\(/);
  const setter = fnSource('setPortalWorkflowStatus');
  assert.match(setter, /function setPortalWorkflowStatus\(portalUid,id,provided\)/);
  assert.match(setter, /const input=provided&&typeof provided==='object'\?provided:null;/);
  // 会長指示: オーナーは理由なしでも任意変更できる。ディレクターは従来どおり必須。
  assert.match(setter, /if\(!reason&&_portalStatusReasonRequired\(\)\)return toast\('変更理由を入力してください','warn'\);/);
  assert.match(setter, /if\(needsEvidence&&!evidenceUrl\)return toast/);
  // 変更理由欄と提出リンク欄はステータス欄の選択に応じて出す。
  assert.match(index, /class="j-sub-portal-evidence" type="url"/);
  assert.match(fnSource('jobSubStatusChanged'), /\['directorRevision','clientRevision','managerStatusOverride'\]\.includes\(action\)/);
  assert.match(index, /オーナーは任意の進捗へ変更できます。/);
});
