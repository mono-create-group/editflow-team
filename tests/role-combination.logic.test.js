const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('editor role can be combined with non-director core staff while directors stay portal-scoped', () => {
  const start = index.indexOf('function _isScopedVideoDirectorAccess()');
  const end = index.indexOf('async function _requestAccess()', start);
  const fn = index.slice(start, end);
  assert.ok(start >= 0 && end > start, 'scoped access helpers must exist');
  const context = {
    APP_ROLES: ['動画編集者','動画編集ディレクター','AIコンサルタント','AIエンジニア','Webデザイナー','営業','SNSマーケター'],
    APP_ACCESS: null,
    _isActualOwner: () => false,
    _rolePreviewActive: () => false,
    ROLE_PREVIEW: null,
  };
  vm.createContext(context);
  vm.runInContext(`${fn}\nthis.allowed=_coreAccessAllowed;this.scoped=_isScopedVideoDirectorAccess;`, context);
  context.APP_ACCESS = { approved: true, roles: ['動画編集者'] };
  assert.equal(context.allowed(), false);
  context.APP_ACCESS = { approved: true, roles: ['動画編集者', 'Webデザイナー'] };
  assert.equal(context.allowed(), true);
  context.APP_ACCESS = { approved: true, roles: ['動画編集者', '動画編集ディレクター'] };
  assert.equal(context.scoped(), true);
  assert.equal(context.allowed(), false);
  context.APP_ACCESS = { approved: true, roles: ['動画編集ディレクター', '営業'] };
  assert.equal(context.allowed(), false);
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

test('video director has a visible route to the editor self-service portal', () => {
  assert.match(index, /\{id:'editorportal',label:'編集者本人ポータル',icon:'👤'\}/);
  const portalRenderer = index.match(/function rEditorPortal\(\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(portalRenderer, /href="\.\/editor\.html">編集者本人ポータルを開く/);
  assert.match(portalRenderer, /_rolePreviewActive\(\)/);
  assert.match(portalRenderer, /rolePreviewOpenEditor\('\$\{esc\(previewUid\)\}'\)/);
  assert.match(index, /GUIDE_PAGE_DEFS=\{\s*editorportal:/);
  assert.match(index, /GUIDE_PAGE_CHECKS=\{\s*editorportal:/);
  assert.match(index, /id:'video',label:'動画編集事業',views:\['editorportal','videoedit'/);
  const directorViews = index.match(/'動画編集ディレクター':\[([^\]]+)\]/)?.[1] || '';
  assert.match(directorViews, /'editorportal'/);
  assert.match(index, /editorportal:rEditorPortal/);
});

test('guide uses concrete, editor-facing labels instead of internal wording', () => {
  assert.match(index, /このページですること/);
  assert.match(index, /最初にすること/);
  assert.match(index, /終わったか確認する方法/);
  assert.match(index, /このページを使える人：/);
  assert.doesNotMatch(index, /guide-page-label">いつ使う？/);
  assert.doesNotMatch(index, /guide-page-first"><span class="guide-page-label">まず最初に/);
  assert.doesNotMatch(index, /guide-page-done"><b>完了の目印/);
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
  assert.match(body, /roles', \[\]\)\.hasAny\(\[\s*'動画編集者','動画編集ディレクター'\s*\]\)/);
  const board = rules.match(/function canSeeBoard\(data\) \{([\s\S]*?)\n\s*\}/)?.[1] || '';
  assert.match(board, /get\(accessPath\(request\.auth\.uid\)\)\.data\.get\('approved', false\) == true/);
  assert.match(board, /roles', \[\]\)\.hasAny\(\['動画編集者','動画編集ディレクター'\]\)/);
});
