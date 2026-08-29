const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const editor=fs.readFileSync(path.join(root,'editor.html'),'utf8');
const features=fs.readFileSync(path.join(root,'editor-features.js'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('instructional editor demo is synthetic, read-only, and does not initialize Firebase',()=>{
  assert.match(editor,/const DEMO=PAGE_PARAMS\.get\('demo'\)==='editor'/);
  assert.match(editor,/if\(DEMO\)initDemo\(\);else initializePortalFirebase\(\);/);
  assert.match(editor,/編集者向け説明用デモ/);
  assert.match(editor,/実データは読み込まず、保存・応募・提出・通知設定はできません/);
  assert.match(editor,/if\(!ADMIN_PREVIEW&&!DEMO\)return/);
  assert.match(editor,/説明用デモでは保存・応募・提出はできません/);
  assert.match(features,/function seedDemoFeatures\(\)/);
  for(const expected of ['feature.board=','feature.manuals=','feature.schedules=','feature.messages.set('])assert.ok(features.includes(expected),`demo feature fixture includes ${expected}`);
});

test('owner role preview exposes the editor instructional demo separately from actual-data previews',()=>{
  assert.match(index,/function editorInstructionalDemoAction\(\)/);
  assert.match(index,/href="\.\/editor\.html\?demo=editor"/);
  assert.match(index,/説明用デモを開く/);
  assert.match(index,/rolePreviewSettingsHtml\(\)[\s\S]*?editorInstructionalDemoAction\(\)/);
  assert.match(index,/openRolePreviewChooser\(\)[\s\S]*?editorInstructionalDemoAction\(\)/);
});
