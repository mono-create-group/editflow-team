const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('editor milestone order is enforced and submission evidence is required', () => {
  const fn = editor.match(/function editorMilestoneError\([^\n]+/)?.[0];
  assert.ok(fn, 'editorMilestoneError helper must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fn}\nthis.check=editorMilestoneError;`, context);
  assert.equal(context.check('進行中', '初稿提出済み', ''), '初稿・修正稿・納品の提出時は証跡URLを登録してください');
  assert.equal(context.check('進行中', '初稿提出済み', 'https://example.com/draft'), '');
  assert.match(context.check('進行中', 'D確認OK', 'https://example.com/draft'), /前の進捗/);
  assert.equal(context.check('初稿提出済み', 'D確認OK', 'https://example.com/draft'), '');
  assert.equal(context.check('修正中', '修正稿提出済み', 'https://example.com/revision'), '');
  assert.equal(context.check('D確認OK', '完了', 'https://example.com/delivery'), '');
  assert.match(context.check('修正稿提出済み', '完了', 'https://example.com/delivery'), /先に「DのOKが出た」/);
});

test('all four milestones are recorded as editor-owned and visible to managers', () => {
  for (const value of ['initial_submitted', 'revision_submitted', 'director_approved', 'client_approved_delivered']) {
    assert.match(editor, new RegExp(value));
  }
  assert.match(editor, /lastProgressChangedByRole:'担当編集者'/);
  assert.match(editor, /type:milestone\?'editor_milestone':'progress'/);
  assert.match(manager, /EDITOR_OWNED_VIDEO_STATUSES=new Set\(\['初稿提出済み','修正稿提出済み','D確認OK','完了'\]\)/);
  assert.match(manager, /この進捗は担当編集者本人が編集者ポータルから更新してください/);
  assert.match(manager, /担当編集者が更新する必須進捗/);
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
