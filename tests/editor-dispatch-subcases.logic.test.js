const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'..','editor-features.js'),'utf8');

test('dispatch registration presents one parent and an editable child-case list',()=>{
  assert.match(source,/親案件に「9月分」などを入れ、子案件に各動画名を追加してください/);
  assert.match(source,/id="new-dispatch-subcases"/);
  assert.match(source,/function dispatchSubcaseRowHtml\(/);
  assert.match(source,/editorAddDispatchSubcase\(\)/);
  assert.match(source,/editorRemoveDispatchSubcase\(this\)/);
  assert.match(source,/class="new-subcase-editor-draft-setter"/);
  assert.match(source,/案件追加者が設定/);
  assert.match(source,/担当編集者が設定/);
  assert.match(source,/function dispatchDraftSetterChanged\(select\)/);
});

test('dispatch child cases validate their own schedule, instructions, and URLs',()=>{
  assert.match(source,/function readDispatchSubcases\(\)/);
  assert.match(source,/すべての子案件に、案件名・納期（予定）・依頼内容を入力してください/);
  assert.match(source,/const dateError=scheduleError\(schedule\)/);
  assert.match(source,/URLは https:\/\/ または http:\/\/ で入力してください/);
  assert.match(source,/dispatchSubcaseRows\(\)\.length>=50/);
  assert.match(source,/editorDraftDateSetter=row\.querySelector\('\.new-subcase-editor-draft-setter'\)\?\.value==='editor'\?'editor':'creator'/);
  assert.match(source,/editorDraftDateSetter==='creator'&&!schedule\.editorDraftDate/);
});

test('dispatch writes each child atomically with a shared stable parent identity',()=>{
  assert.match(source,/if\(feature\.dispatchSubmitting\)return/);
  assert.match(source,/const parentCaseId=id\(\),parentCaseName=requestedParentName\|\|subcases\.items\[0\]\.title/);
  assert.match(source,/subcases\.items\.forEach\(subcase=>/);
  assert.match(source,/caseName:parentCaseName,parentCaseId,parentCaseName/);
  assert.match(source,/editorDraftDateSetter:subcase\.editorDraftDateSetter/);
  assert.match(source,/batch\.set\(ref,data\);batch\.set\(ref\.collection\('events'\)\.doc\(\)/);
  assert.match(source,/await batch\.commit\(\)/);
});

test('claimed board jobs retain the selected draft-date setter while old board rows stay editor-settable',()=>{
  assert.match(source,/editorDraftDateSetter=board\.editorDraftDateSetter==='creator'\?'creator':'editor'/);
  assert.match(source,/editorDraftDate:board\.editorDraftDate\|\|'',editorDraftDateSetter,clientDraftDate/);
  assert.match(source,/function editorSetsDraftDate\(job\)\{return draftDateSetter\(job\)==='editor'\}/);
});

test('dispatch preview never writes cases',()=>{
  assert.match(source,/if\(DEMO\)return toast\('プレビューでは案件を保存できません'\)/);
});
