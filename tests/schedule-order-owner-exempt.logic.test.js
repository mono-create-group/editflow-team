const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');

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

// 会長指示: 編集者初稿・クライアント初稿・納品日は同日でもよい。さらにオーナーは順序が前後しても保存できる。
// 編集者はしっかり順番どおりに入力させる（編集者ポータル側の検証は変えない）。
const reversed = { sharedDate: '2026-09-01', editorDraftDate: '2026-09-12', clientDraftDate: '2026-09-10', deliveryDate: '2026-09-11' };
const sameDay = { sharedDate: '2026-09-01', editorDraftDate: '2026-09-10', clientDraftDate: '2026-09-10', deliveryDate: '2026-09-10' };

test('the owner is exempt from the schedule order check; others still see the order error', () => {
  const make = owner => {
    const ctx = vm.createContext({ _isOwner: () => owner });
    ['_scheduleOrderEnforced', '_jobScheduleError'].forEach(name => vm.runInContext(functionSource(index, name), ctx));
    return ctx;
  };
  assert.equal(vm.runInContext(`_jobScheduleError(${JSON.stringify(reversed)})`, make(true)), '');
  assert.match(vm.runInContext(`_jobScheduleError(${JSON.stringify(reversed)})`, make(false)), /の順で入力してください/);
  // 同日は誰でも通る（従来どおり）。
  assert.equal(vm.runInContext(`_jobScheduleError(${JSON.stringify(sameDay)})`, make(false)), '');
  // サムネイル納品日の上限チェックはオーナーでも残す。
  assert.match(vm.runInContext(`_jobScheduleError(${JSON.stringify({ ...sameDay, thumbnailDate: '2026-09-20' })})`, make(true)), /サムネイル納品日/);
  // _isOwner が無い環境（単体テスト・旧画面）では順序チェックを維持する。
  const bare = vm.createContext({});
  ['_scheduleOrderEnforced', '_jobScheduleError'].forEach(name => vm.runInContext(functionSource(index, name), bare));
  assert.match(vm.runInContext(`_jobScheduleError(${JSON.stringify(reversed)})`, bare), /の順で入力してください/);
});

test('board publishing skips the order check for the owner only, and the editor portal keeps it', () => {
  assert.match(manager, /const enforceOrder=!\(typeof _isOwner==='function'&&_isOwner\(\)\);/);
  assert.match(manager, /if\(enforceOrder&&editorDraftDate&&clientDraftDate&&clientDraftDate<editorDraftDate\)return\{error:`「\$\{title\}」：クライアント初稿は編集者初稿以降に設定してください`/);
  assert.match(manager, /if\(enforceOrder&&clientDraftDate&&deliveryDate&&deliveryDate<clientDraftDate\)return\{error:`「\$\{title\}」：納期（予定）はクライアント初稿以降に設定してください`/);
  // 編集者ポータルの scheduleError は順序を強制したまま（同日は許容）。
  const ctx = vm.createContext({});
  vm.runInContext(functionSource(editor, 'scheduleError'), ctx);
  assert.match(vm.runInContext(`scheduleError(${JSON.stringify(reversed)})`, ctx), /の順で入力してください/);
  assert.equal(vm.runInContext(`scheduleError(${JSON.stringify(sameDay)})`, ctx), '');
});
