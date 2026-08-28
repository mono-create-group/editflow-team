const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const editor=fs.readFileSync(path.join(root,'editor.html'),'utf8');
const features=fs.readFileSync(path.join(root,'editor-features.js'),'utf8');

test('legacy portal jobs remain editor-settable and creator-selected dates are protected in save payloads',()=>{
  assert.match(editor,/function editorDraftDateSetter\(j\)\{return j\?\.editorDraftDateSetter==='creator'\?'creator':'editor'\}/);
  assert.match(editor,/const editorDraftDate=editorDraftDateSetter\(j\)==='creator'\?\(j\.editorDraftDate\|\|''\):\$\('#job-editor-draft-'\+jid\)\.value/);
  assert.match(editor,/const schedule=\{sharedDate:\$\('#job-shared-'\+jid\)\.value,editorDraftDate,clientDraftDate/);
});

test('editor cards disable the date field when the creator controls it',()=>{
  assert.match(features,/const draftLocked=!editorSetsDraftDate\(j\),draftDateControl=/);
  assert.match(features,/\$\{draftLocked\?'disabled':''\}/);
  assert.match(features,/案件追加者が設定します。/);
});
