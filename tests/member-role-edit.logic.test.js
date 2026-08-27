const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('registered members expose edit and delete actions', () => {
  assert.match(index, /onclick="mrEditMember\('\$\{m\.id\}'\)"[^>]*>編集<\/button>/);
  assert.match(index, /onclick="mrRemoveMember\('\$\{m\.id\}'\)"[^>]*>削除<\/button>/);
  assert.match(index, /メンバー権限を編集/);
  assert.match(index, /変更を保存/);
});

test('role selection validation is shared by add, approve, and edit', () => {
  const fn = index.match(/function mrValidateRoleSelection\(roles,workerId\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fn, 'mrValidateRoleSelection must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fn}\nthis.validate=mrValidateRoleSelection;`, context);
  assert.equal(context.validate([], null), '少なくとも1つの役割を選択してください');
  assert.equal(context.validate(['動画編集者'], null), '動画編集者には担当者の紐付けが必要です');
  assert.equal(context.validate(['動画編集者'], 'worker-1'), '');
  assert.equal(context.validate(['営業'], null), '');
  assert.equal((index.match(/mrValidateRoleSelection\(roles,workerId\)/g) || []).length >= 4, true);
});

test('editing an approved member updates access before local state', () => {
  const start = index.indexOf('async function mrSaveMemberEdit(id)');
  const end = index.indexOf('async function mrRemoveMember(id)', start);
  const body = index.slice(start, end);
  assert.match(body, /collection\('access'\)\.doc\(targetUid\)\.set/);
  assert.match(body, /nextWorkerId=roles\.includes\('動画編集者'\)\?workerId:null/);
  assert.match(body, /name,roles,workerId:nextWorkerId,approved:true/);
  assert.ok(body.indexOf("collection('access')") < body.indexOf('Object.assign(m,'), 'cloud access must save before local state');
  assert.match(body, /return toast\('権限を保存できませんでした/);
});
