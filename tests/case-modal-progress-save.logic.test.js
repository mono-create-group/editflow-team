const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
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

// 会長指示: 案件編集の「進捗を保存」で親案件の編集画面が閉じてしまい、途中の入力ごと消えてしまう。閉じないようにする。
test('saving subcase progress from the case form keeps the case modal open', () => {
  const handler = functionSource('advanceLegacyPortalSubcaseWorkflow');
  assert.match(handler, /keepOpen:true\}\);/);
  assert.match(handler, /images,\{keepOpen:true\}\);/);
  const advance = functionSource('advancePortalWorkflow');
  assert.match(advance, /if\(!\(options&&options\.keepOpen&&_refreshJobModalPortalSubProgress\(portalUid,id\)\)\)closeModal\(\);/);
  const setter = functionSource('setPortalWorkflowStatus');
  assert.match(setter, /if\(!\(input&&input\.keepOpen&&_refreshJobModalPortalSubProgress\(portalUid,id\)\)\)closeModal\(\);/);
  // スナップショット到着前でも新しい工程を見せるため、手元の案件にも反映してから描き直す。
  assert.match(setter, /Object\.assign\(j,data\);/);
});

test('subcase detail exposes an editable status and persists the selected status', () => {
  const modal = index.slice(index.indexOf('function _videoSubcaseDetailHtml'), index.indexOf('\nfunction openLegacySubcaseDetail'));
  assert.match(modal, /<select id="vs-status"/);
  assert.match(modal, /statusCanEdit=canEdit&&!statusLocked/);
  assert.match(modal, /bizStatOpts\(jobBiz\(parent\)/);
  assert.match(modal, /portalProgress=portalJob\?_videoManualProgressControl\(portalJob,portalUid\):''/);
  const saver = functionSource('saveLegacySubcaseDraftDates');
  assert.match(saver, /const requestedStatus=document\.getElementById\('vs-status'\)\?\.value/);
  assert.match(saver, /status:requestedStatus/);
  assert.match(saver, /type:requestedStatus===previousStatus\?'subcase_schedule_update':'subcase_status_update'/);
  assert.match(saver, /fromStatus:previousStatus/);
});

// 行ごと作り直すと、入力途中の日程・単価まで消える（§11 データを壊さない）。触るのはステータス欄と理由欄だけにする。
test('the inline refresh only resets the status control and the reason inputs', () => {
  const refresh = functionSource('_refreshJobModalPortalSubProgress');
  assert.doesNotMatch(refresh, /mkSubRow|innerHTML=_jobModalSubCompactBodyHtml/);
  assert.match(refresh, /select\.innerHTML=_portalSubcaseStatusOptions\(job\)/);
  assert.match(refresh, /\['reason','images','evidence'\]\.forEach/);
  assert.match(refresh, /confirmButton\)confirmButton\.disabled=true/);
  assert.match(refresh, /updateJobInternalScheduleRules\(\)/);
  assert.match(refresh, /if\(!select\)return false;/);
});

// オーナーは理由入力を省略できるが、Firestore の監査契約を満たす理由文字列は必ず生成する。
test('the reason stays required for directors and owner omissions get an audit reason', () => {
  const source = functionSource('_portalStatusReasonRequired');
  const run = (owner, preview) => {
    const ctx = vm.createContext({ _isActualOwner: () => owner, _rolePreviewActive: () => preview });
    vm.runInContext(source, ctx);
    return vm.runInContext('_portalStatusReasonRequired()', ctx);
  };
  assert.equal(run(true, false), false);
  assert.equal(run(false, false), true);
  // オーナーが役割プレビュー中なら、見えている役割どおり必須に戻す。
  assert.equal(run(true, true), true);
  const auditContext = vm.createContext({});
  vm.runInContext(functionSource('_portalStatusAuditReason'), auditContext);
  assert.equal(vm.runInContext("_portalStatusAuditReason('')", auditContext), '社内アプリで進捗を変更');
  assert.equal(vm.runInContext("_portalStatusAuditReason(' 実際の進捗へ修正 ')", auditContext), '実際の進捗へ修正');
  const setter = functionSource('setPortalWorkflowStatus');
  assert.match(setter, /if\(!reason&&_portalStatusReasonRequired\(\)\)return toast\('変更理由を入力してください','warn'\);/);
  assert.match(setter, /const auditReason=_portalStatusAuditReason\(reason\)/);
  assert.match(setter, /reason:auditReason/);
  assert.match(setter, /correctionReason:status==='修正中'\?auditReason:''/);
  // 提出リンク・完了日・クライアントOKの確認は緩めない。
  assert.match(setter, /if\(needsEvidence&&!evidenceUrl\)return toast/);
  assert.match(setter, /status==='完了'&&!clientApprovalConfirmed/);
  assert.match(setter, /_validPortalCompletionDate\(completionDate\)/);
  assert.match(functionSource('togglePortalManualProgressFields'), /\(_portalStatusReasonRequired\(\)&&!reason\)/);
});
