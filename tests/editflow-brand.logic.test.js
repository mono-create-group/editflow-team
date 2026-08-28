const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');

test('EditFlow uses the same real logo asset in owner and editor shells',()=>{
  const index=read('index.html');
  const editor=read('editor.html');
  const features=read('editor-features.js');
  const logo=read('editflow-logo.svg');
  assert.match(logo,/<title id="title">EditFlow<\/title>/);
  assert.match(index,/app-brand-logo[^>]+editflow-logo\.svg/);
  assert.match(editor,/brand-logo[^>]+editflow-logo\.svg[^>]+alt="EditFlow"/);
  assert.match(features,/editor-sidebar-brand[^`]+editflow-logo\.svg[^`]+alt="EditFlow"/);
});

test('service worker precaches the EditFlow logo',()=>{
  assert.match(read('sw.js'),/\.\/editflow-logo\.svg/);
});

test('application instructions describe the yellow acceptance action',()=>{
  const features=read('editor-features.js');
  assert.match(features,/黄色の「この案件を受ける」/);
  assert.doesNotMatch(features,/最後の紫ボタン/);
});
