const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1; else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}

// 会長指示: サブ案件が入っている場合、親案件のステータスは入力させない（サブ案件の進み具合から自動で決める）。
const EDIT_STATUSES = ['案件掲載中', '未着手', 'アサイン済み', '進行中', '編集者進行中', '初稿提出済み', '修正中', '修正稿提出済み', 'D確認OK', '先方確認中', '完了', 'キャンセル'];

function makeContext() {
  const ctx = vm.createContext({ bizCfgOf: () => ({ statuses: EDIT_STATUSES }) });
  vm.runInContext(functionSource(index, '_aggregateSubcaseStatus'), ctx);
  return ctx;
}

function aggregate(subtasks, fallback = '進行中') {
  return vm.runInContext(`_aggregateSubcaseStatus('edit',${JSON.stringify(subtasks)},${JSON.stringify(fallback)})`, makeContext());
}

test('the parent status follows the least advanced open subcase', () => {
  assert.equal(aggregate([{ status: '初稿提出済み' }, { status: '進行中' }, { status: '完了' }]), '進行中');
  assert.equal(aggregate([{ status: 'D確認OK' }, { status: '修正中' }]), '修正中');
  assert.equal(aggregate([{ status: '先方確認中' }, { status: '先方確認中' }]), '先方確認中');
});

test('every subcase finished makes the parent finished; a done flag counts as finished', () => {
  assert.equal(aggregate([{ status: '完了' }, { status: '完了' }]), '完了');
  assert.equal(aggregate([{ status: '進行中', done: true }, { status: '完了' }]), '完了');
  // キャンセルは進み具合の比較から外し、残りが完了だけなら完了にする。
  assert.equal(aggregate([{ status: '完了' }, { status: 'キャンセル' }]), '完了');
  assert.equal(aggregate([{ status: 'キャンセル' }, { status: 'キャンセル' }]), 'キャンセル');
});

test('without subcases the requested status is kept as-is', () => {
  assert.equal(aggregate([], 'D確認OK'), 'D確認OK');
  assert.equal(aggregate([{ status: '' }, null], '未着手'), '未着手');
});

test('an unknown status never wins over a known one', () => {
  assert.equal(aggregate([{ status: '謎ステータス' }, { status: '進行中' }]), '進行中');
  assert.equal(aggregate([{ status: '謎ステータス' }]), '謎ステータス');
});

test('the case form hides the parent status field and shows the derived value instead', () => {
  assert.match(index, /<div class="fg" id="jf-stat">/);
  assert.match(index, /<div class="fg" id="jf-stat-auto" style="display:none">/);
  assert.match(index, /id="j-stat-auto"/);
  const rule = functionSource(index, 'updateJobParentStatusRule');
  assert.match(rule, /field\.style\.display=hasSubs\?'none':''/);
  assert.match(rule, /field\.setAttribute\('aria-hidden',hasSubs\?'true':'false'\)/);
  assert.match(rule, /parentSelect\.disabled=hasSubs/);
  assert.match(rule, /auto\.style\.display=hasSubs\?'':'none'/);
  assert.match(rule, /auto\.setAttribute\('aria-hidden',hasSubs\?'false':'true'\)/);
  assert.match(functionSource(index, 'updateJobInternalScheduleRules'), /updateJobParentStatusRule\(hasSubs\)/);
});

test('saveJob writes the derived status and does not lock the save behind the ops checklist', () => {
  const save = functionSource(index, 'saveJob');
  assert.match(save, /const parentStatusAuto=subtasks\.length>0&&!_legacyPortalStatusLocked\(current\);/);
  assert.match(save, /const finalStatus=parentStatusAuto\?_aggregateSubcaseStatus\(currentBiz,subtasks,_jobSubDefaultStatus\(currentBiz\)\):requestedStatus;/);
  assert.match(save, /const requestedStatus=String\(document\.getElementById\('j-stat'\)\?\.value\|\|''\);/);
  assert.match(save, /status:finalStatus,/);
  assert.match(save, /const entersOperationalCompletion=!parentStatusAuto&&opsRequiresChecklist/);
  // ポータル連携の親案件は従来どおり、案件編集からステータスを動かさない。
  assert.match(save, /if\(_legacyPortalStatusLocked\(current\)&&requestedStatus!==current\.status\)/);
});

// 実アプリで駆動して判明: 新規サブ案件の既定が「案件掲載中」（編集者募集の掲載中）だったため、
// 進行中の親案件にサブ案件を1件足すだけで親が「案件掲載中」へ落ちていた。
test('a brand-new subcase starts at 未着手 so adding one does not demote the parent', () => {
  const ctx = vm.createContext({
    bizCfgOf: biz => ({ statuses: biz === 'haken'
      ? ['案件掲載中', '募集中', '編集者決定', '受注済み', 'アサイン済み', '進行中', '完了', 'キャンセル']
      : EDIT_STATUSES }),
  });
  vm.runInContext(functionSource(index, '_jobSubDefaultStatus'), ctx);
  assert.equal(vm.runInContext("_jobSubDefaultStatus('edit')", ctx), '未着手');
  // 編集者派遣は掲載から始まるため従来どおり先頭のまま。
  assert.equal(vm.runInContext("_jobSubDefaultStatus('haken')", ctx), '案件掲載中');
  assert.match(index, /const st=s\.status\|\|_jobSubDefaultStatus\(_bk\);/);
  // 折りたたみカード・読み出し・保存の既定と揃っている。
  assert.match(index, /videoStatusLabel\(record\?\.status\|\|'未着手'\)/);
  assert.match(index, /requestedSubStatus=el\.querySelector\('\.j-sub-status'\)\?\.value\|\|'未着手'/);
});
