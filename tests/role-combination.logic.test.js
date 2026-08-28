const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('editor role can be combined with a core staff role', () => {
  const fn = index.match(/function _coreAccessAllowed\(\)\{[^}]+\}/)?.[0];
  assert.ok(fn, '_coreAccessAllowed must exist');
  const context = {
    APP_ROLES: ['動画編集者','動画編集ディレクター','AIコンサルタント','AIエンジニア','Webデザイナー','営業','SNSマーケター'],
    APP_ACCESS: null,
    _isActualOwner: () => false,
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\nthis.allowed=_coreAccessAllowed;`, context);
  context.APP_ACCESS = { approved: true, roles: ['動画編集者'] };
  assert.equal(context.allowed(), false);
  context.APP_ACCESS = { approved: true, roles: ['動画編集者', 'Webデザイナー'] };
  assert.equal(context.allowed(), true);
  context.APP_ACCESS = { approved: true, roles: ['動画編集者', '動画編集ディレクター'] };
  assert.equal(context.allowed(), true);
  assert.doesNotMatch(index, /動画編集者.{0,20}他の役割と併用できません/);
  assert.match(index, /hasAppRole\('動画編集者'\).*編集者ポータルを開く/);
});

test('video director automatically receives editor permission', () => {
  const grantFn = index.match(/function rolesGrantVideoEditor\(roles\)\{[^}]+\}/)?.[0];
  assert.ok(grantFn, 'rolesGrantVideoEditor must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${grantFn}\nthis.grants=rolesGrantVideoEditor;`, context);
  assert.equal(context.grants(['動画編集者']), true);
  assert.equal(context.grants(['動画編集ディレクター']), true);
  assert.equal(context.grants(['営業']), false);
  assert.match(index, /role==='動画編集者'&&rolesGrantVideoEditor\(roles\)/);
  assert.match(index, /動画編集ディレクターには動画編集者の権限も自動で含まれます/);
  assert.match(fs.readFileSync(path.join(root, 'editor.html'), 'utf8'), /roles\.includes\('動画編集者'\)\|\|roles\.includes\('動画編集ディレクター'\)/);
  assert.match(fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8'), /rolesGrantVideoEditor\(x\.roles\|\|\[\]\)/);
});

test('Firestore treats only editor-only accounts as isolated', () => {
  const body = rules.match(/function pureEditor\(uid\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.match(body, /roles\.hasAny\(\['動画編集者'\]\)/);
  for (const role of ['動画編集ディレクター','AIコンサルタント','AIエンジニア','Webデザイナー','営業','SNSマーケター']) {
    assert.match(body, new RegExp(`'${role}'`));
  }
  assert.match(body, /!get\(accessPath\(uid\)\)\.data\.roles\.hasAny/);
});

test('Firestore grants a director the editor self-service boundary', () => {
  const body = rules.match(/function editor\(uid\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.match(body, /hasRole\(uid, '動画編集者'\)/);
  assert.match(body, /hasRole\(uid, '動画編集ディレクター'\)/);
  const board = rules.match(/function canSeeBoard\(data\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.match(board, /editor\(request\.auth\.uid\)/);
});
