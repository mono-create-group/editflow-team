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
    _isOwner: () => false,
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

test('Firestore treats only editor-only accounts as isolated', () => {
  const body = rules.match(/function pureEditor\(uid\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.match(body, /roles\.hasAny\(\['動画編集者'\]\)/);
  for (const role of ['動画編集ディレクター','AIコンサルタント','AIエンジニア','Webデザイナー','営業','SNSマーケター']) {
    assert.match(body, new RegExp(`'${role}'`));
  }
  assert.match(body, /!get\(accessPath\(uid\)\)\.data\.roles\.hasAny/);
});
