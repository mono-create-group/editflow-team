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
  assert.match(source,/class="new-subcase-editor-pay"/);
  assert.match(source,/編集者支払額（円） \*/);
  assert.match(source,/mono\.createからの精算先は担当ディレクター/);
  assert.match(source,/あなたに支払われる金額です/);
  assert.match(source,/案件追加者が設定/);
  assert.match(source,/担当編集者が設定/);
  assert.match(source,/function dispatchDraftSetterChanged\(select\)/);
});

test('dispatch child cases require their pay and instructions, while actual delivery is recorded only after delivery',()=>{
  assert.match(source,/function readDispatchSubcases\(\)/);
  assert.match(source,/すべての子案件に、案件名・編集者支払額・依頼内容を入力してください/);
  assert.match(source,/editorPayAmount=positiveYen\(row\.querySelector\('\.new-subcase-editor-pay'\)\?\.value\)/);
  assert.match(source,/編集者支払額は1円以上の整数で入力してください/);
  assert.doesNotMatch(source,/new-subcase-delivery/);
  assert.match(source,/納品日は案件追加時には入力しません/);
  assert.match(source,/deliveryDate:''/);
  assert.match(source,/j\.source==='direct_client'\?`<input id="job-delivery-/);
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
  assert.match(source,/clientId,sourceClientId:client\.sourceClientId\|\|client\.id,clientDisplay:client\.name/);
  assert.match(source,/editorPayAmount:subcase\.editorPayAmount/);
  assert.match(source,/編集者支払額<\/b> ¥\$\{positiveYen\(j\.editorPayAmount\)\.toLocaleString\('ja-JP'\)\}/);
  assert.match(source,/editorDraftDateSetter:subcase\.editorDraftDateSetter/);
  assert.match(source,/batch\.set\(ref,data\);batch\.set\(ref\.collection\('events'\)\.doc\(\)/);
  assert.match(source,/await batch\.commit\(\)/);
});

test('claimed board jobs retain the selected draft-date setter while old board rows stay editor-settable',()=>{
  assert.match(source,/editorDraftDateSetter=board\.editorDraftDateSetter==='creator'\?'creator':'editor'/);
  assert.match(source,/editorDraftDate:board\.editorDraftDate\|\|'',editorDraftDateSetter,clientDraftDate/);
  assert.match(source,/clientId:board\.clientId\|\|'',sourceClientId:board\.sourceClientId\|\|board\.clientId\|\|''/);
  assert.match(source,/function editorSetsDraftDate\(job\)\{return draftDateSetter\(job\)==='editor'\}/);
});

test('dispatch preview never writes cases',()=>{
  assert.match(source,/if\(DEMO\)return toast\('プレビューでは案件を保存できません'\)/);
});
