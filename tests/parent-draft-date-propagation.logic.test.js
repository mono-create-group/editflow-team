const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// 会長報告: 親案件の「編集者 初稿」が変更できない（子案件があると欄が無効化されていた）。
test('the owner can edit the parent editor-draft date and it propagates to unset or aggregate-matching subcases only', () => {
  // 子案件があるとき、オーナーだけ欄を有効にする（ディレクターは従来どおり無効）。
  assert.match(index, /id="j-editor-draft" value="\$\{j\?\.editorDraftDate\|\|''\}" \$\{subs\.length\?\(_isOwner\(\)\?'':'disabled'\):\(!_isOwner\(\)&&parentDraftSetter!=='creator'\?'disabled':''\)\}/);
  assert.match(index, /const PARENT_DRAFT_BULK_HINT='ここに入れると、未設定の子案件（案件追加者が設定するもの）へ一括で入ります。/);
  assert.match(index, /subs\.length\?\(_isOwner\(\)\?PARENT_DRAFT_BULK_HINT:'子案件ごとに設定します。'\)/);
  assert.match(index, /hasSubs\?\(_isOwner\(\)\?PARENT_DRAFT_BULK_HINT:'子案件ごとに下の欄で設定します。'\)/);
  // 保存時: 親の値が直前の集約値と違うときだけ、未設定 or 集約値と同じ子案件に入れる。担当編集者が設定する子案件は触らない。
  const save = index.slice(index.indexOf('async function saveJob(){'), index.indexOf('const subtasks=_isOwner()?parsedSubtasks:oldSubs;'));
  assert.match(save, /if\(_isOwner\(\)&&parsedSubtasks\.length&&parentEditorDraftDate\)\{/);
  assert.match(save, /const previousAggregate=\(oldSubs\.map\(sub=>sub\?\.editorDraftDate\)\.filter\(Boolean\)\.sort\(\)\[0\]\)\|\|String\(current\?\.editorDraftDate\|\|''\)\|\|null;/);
  assert.match(save, /if\(parentEditorDraftDate!==previousAggregate\)parsedSubtasks\.forEach\(sub=>\{if\(_editorDraftDateSetter\(sub\)!=='creator'&&sub\.workerId!==SELF_WID\)return;if\(!sub\.editorDraftDate\|\|sub\.editorDraftDate===previousAggregate\)sub\.editorDraftDate=parentEditorDraftDate;\}\);/);
  // 一括反映は「編集者初稿日を入力してください」の検証より前に行う（未設定の子案件を先に埋める）。
  assert.ok(save.indexOf('parsedSubtasks.forEach(sub=>{if(_editorDraftDateSetter(sub)') < save.indexOf('の編集者初稿日を入力してください'));
  // 親に保存される値は従来どおり子案件の最早日（集約）。
  assert.match(index, /const aggregateDraftDate=subtasks\.length\?\(subtasks\.map\(sub=>sub\.editorDraftDate\)\.filter\(Boolean\)\.sort\(\)\[0\]\|\|null\):parentEditorDraftDate/);
});
