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

test('legacy records linked to a portal cannot silently change progress from the parent editor', () => {
  assert.match(index, /function _legacyPortalStatusLocked\(record\)\{return !!\(record&&String\(record\.portalUid\|\|''\)\.trim\(\)&&String\(record\.portalJobId\|\|''\)\.trim\(\)\);\}/);
  assert.match(index, /id="j-stat" \$\{linkedPortalParent\?'disabled':''\}/);
  assert.match(index, /class="j-sub-status"[^>]*\$\{portalStatusLocked\?'disabled':''\}/);
  assert.match(index, /進捗はサブ案件詳細の進捗操作で更新します。/);
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
  assert.match(index, /function advancePortalWorkflow\(portalUid,id,action,providedReason\)/);
});

test('linked parent subcases expose only current valid workflow actions inline', () => {
  assert.match(index, /function _portalWorkflowActionsForJob\(job\)\{/);
  assert.match(index, /stage==='director_review'\)return\[\['directorRevision','修正指示（修正中）'\],\['directorApprove','D確認OKにする'\]\]/);
  assert.match(index, /stage==='client_submission'\)return\[\['clientSubmitted','先方確認中にする'\]\]/);
  assert.match(index, /stage==='client_review'\)return\[\['clientRevision','修正指示（修正中）'\],\['clientApproved','先方OK（完了）'\]\]/);
  assert.match(index, /function advanceLegacyPortalSubcaseWorkflow\(portalUid,jobId,controlKey\)\{/);
  assert.match(index, /const allowed=_portalWorkflowActionsForJob\(job\)\.map\(\(\[value\]\)=>value\);/);
  assert.match(index, /if\(!allowed\.includes\(action\)\)return toast\('現在の工程ではこの操作はできません。案件を開き直してください','warn'\);/);
  assert.match(index, /修正指示の内容（修正指示を選んだ場合は必須）/);
  assert.match(index, /await advancePortalWorkflow\(portalUid,jobId,action,reason\);/);
  assert.match(index, /async function advancePortalWorkflow\(portalUid,id,action,providedReason\)/);
  assert.match(index, /providedReason===undefined\?\(document\.getElementById\('vp-correction'\)\?\.value\.trim\(\)\|\|''\):String\(providedReason\)\.trim\(\)/);
  assert.match(index, /const PORTAL_WORKFLOW_ACTION_PENDING=new Set\(\);/);
  assert.match(index, /if\(PORTAL_WORKFLOW_ACTION_PENDING\.has\(pendingKey\)\)return toast\('進捗を保存しています。完了までお待ちください','warn'\);/);
  assert.match(index, /finally\{PORTAL_WORKFLOW_ACTION_PENDING\.delete\(pendingKey\);\}/);
});

test('inline portal workflow actions quote escaped JSON before placement in an HTML attribute', () => {
  assert.match(index, /const portalConfirmAction=portalStatusLocked\?`advanceLegacyPortalSubcaseWorkflow\(\$\{JSON\.stringify\(String\(s\.portalUid\)\)\},\$\{JSON\.stringify\(String\(s\.portalJobId\)\)\},\$\{JSON\.stringify\(portalControlKey\)\}\)`:'';/);
  assert.match(index, /onclick="\$\{esc\(portalConfirmAction\)\}">進捗を確定<\/button>/);
  const esc = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const action = `advanceLegacyPortalSubcaseWorkflow(${JSON.stringify('uid"quoted')},${JSON.stringify('job"quoted')},${JSON.stringify('safe-key')})`;
  const rendered = `<button onclick="${esc(action)}">進捗を確定</button>`;
  assert.match(rendered, /onclick="advanceLegacyPortalSubcaseWorkflow\(&quot;uid\\&quot;quoted&quot;,&quot;job\\&quot;quoted&quot;,&quot;safe-key&quot;\)"/);
  assert.doesNotMatch(rendered, /onclick="advanceLegacyPortalSubcaseWorkflow\("/);
});
