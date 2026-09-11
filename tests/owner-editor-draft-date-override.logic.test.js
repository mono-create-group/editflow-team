const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('owner can edit an editor-owned first-draft date in every manager surface', () => {
  // Parent, portal job, and child-detail inputs are locked for non-owners only.
  assert.match(index, /!_isOwner\(\)&&parentDraftSetter!=='creator'\?'disabled':''/);
  assert.match(index, /canEdit&&\(draftSetter==='creator'\|\|owner\)\?'':'disabled'/);
  assert.match(index, /canEdit&&\(setter==='creator'\|\|_isOwner\(\)\)\?'':'disabled'/);
  assert.match(index, /draftSetter==='editor'&&!_isOwner\(\)\?'disabled':''/);
  assert.match(index, /setter==='editor'&&!_isOwner\(\)/);
  assert.match(index, /_isOwner\(\)&&draftSetter==='editor'\?'オーナーは担当編集者設定の日付も変更できます。'/);
});

test('owner date override is allowed through calendar and save guards', () => {
  const calendar = index.slice(index.indexOf('async function _caseScheduleSetDate'), index.indexOf('function rProjPriority'));
  assert.match(calendar, /editorOwned\(found\.sub\)&&!_isOwner\(\)/);
  assert.match(calendar, /editorOwned\(parent\)&&!_isOwner\(\)/);
  assert.match(calendar, /editorOwned\(job\)&&!_isOwner\(\)/);
});

test('subcase caution text remains escaped and visible', () => {
  assert.match(index, /aria-label="案件の注意事項"><b>注意事項<\/b><div>\$\{esc\(caution\)\}<\/div>/);
});
