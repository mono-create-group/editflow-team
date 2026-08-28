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
});

test('dispatch child cases validate their own schedule, instructions, and URLs',()=>{
  assert.match(source,/function readDispatchSubcases\(\)/);
  assert.match(source,/すべての子案件に、案件名・納品期限・依頼内容を入力してください/);
  assert.match(source,/const dateError=scheduleError\(schedule\)/);
  assert.match(source,/URLは https:\/\/ または http:\/\/ で入力してください/);
  assert.match(source,/dispatchSubcaseRows\(\)\.length>=50/);
});

test('dispatch writes each child atomically with a shared stable parent identity',()=>{
  assert.match(source,/if\(feature\.dispatchSubmitting\)return/);
  assert.match(source,/const parentCaseId=id\(\),parentCaseName=requestedParentName\|\|subcases\.items\[0\]\.title/);
  assert.match(source,/subcases\.items\.forEach\(subcase=>/);
  assert.match(source,/caseName:parentCaseName,parentCaseId,parentCaseName/);
  assert.match(source,/batch\.set\(ref,data\);batch\.set\(ref\.collection\('events'\)\.doc\(\)/);
  assert.match(source,/await batch\.commit\(\)/);
});

test('dispatch preview never writes cases',()=>{
  assert.match(source,/if\(DEMO\)return toast\('プレビューでは案件を保存できません'\)/);
});
