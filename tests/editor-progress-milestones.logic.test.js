const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('editors can only submit initial and revision work with evidence', () => {
  const fn = editor.match(/function editorMilestoneError\([^\n]+/)?.[0];
  assert.ok(fn, 'editorMilestoneError helper must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fn}\nthis.check=editorMilestoneError;`, context);
  assert.equal(context.check('進行中', '初稿提出済み', ''), '初稿・修正稿の提出時は証跡URLを登録してください');
  assert.equal(context.check('進行中', '初稿提出済み', 'https://example.com/draft'), '');
  assert.match(context.check('進行中', 'D確認OK', 'https://example.com/draft'), /ディレクターまたは管理者/);
  assert.match(context.check('初稿提出済み', 'D確認OK', 'https://example.com/draft'), /ディレクターまたは管理者/);
  assert.equal(context.check('修正中', '修正稿提出済み', 'https://example.com/revision'), '');
  assert.match(context.check('D確認OK', '完了', 'https://example.com/delivery'), /ディレクターまたは管理者/);
  assert.match(context.check('修正稿提出済み', '完了', 'https://example.com/delivery'), /ディレクターまたは管理者/);
});

test('only initial and revision milestones are editor-owned', () => {
  for (const value of ['initial_submitted', 'revision_submitted']) {
    assert.match(editor, new RegExp(value));
  }
  assert.match(editor, /lastProgressChangedByRole:'担当編集者'/);
  assert.match(editor, /type:milestone\?'editor_milestone':'progress'/);
  assert.match(editor, /\['初稿提出済み','修正稿提出済み'\]\.includes\(status\)/);
  assert.match(editor, /この工程はディレクターまたは管理者が更新します/);
  assert.match(editor, /担当編集者が更新する進捗/);
});

test('Firestore accepts editor milestones and prevents manager proxy completion', () => {
  for (const status of ['初稿提出済み', '修正稿提出済み', 'D確認OK']) {
    assert.match(rules, new RegExp(`'${status}'`));
  }
  for (const field of ['progressMilestones', 'lastProgressChangedByUid', 'lastProgressChangedByEmail', 'lastProgressChangedByRole']) {
    assert.match(rules, new RegExp(`'${field}'`));
  }
  assert.match(rules, /request\.resource\.data\.get\('lastProgressChangedByUid', uid\) == uid/);
  assert.match(rules, /request\.resource\.data\.get\('lastProgressChangedByRole', '担当編集者'\) == '担当編集者'/);
  assert.equal((rules.match(/!\(request\.resource\.data\.status in \['初稿提出済み','修正稿提出済み','D確認OK','完了'\]\)/g) || []).length, 2);
});
