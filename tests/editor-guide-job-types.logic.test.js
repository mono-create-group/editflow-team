const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const editor=fs.readFileSync(path.resolve(__dirname,'..','editor.html'),'utf8');
const features=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');

test('the editor guide explains dispatch versus agency cases before the setup steps',()=>{
  const guide=editor.indexOf('案件には2つの形態があります'),setup=editor.indexOf('最初の1回だけすること');
  assert.ok(guide>0&&setup>guide,'the comparison sits at the top of the guide');
  assert.match(editor,/<h2>編集者派遣<\/h2><p><b>クライアントと直接やり取りする形態<\/b>/);
  assert.match(editor,/<h2>編集代行<\/h2><p><b>ディレクターが間に入る形態<\/b>/);
  assert.match(editor,/ディレクターがクライアントへ納品します/);
  assert.match(editor,/案件外の依頼も、クライアントから直接あなたに届きます/);
});

test('the assigned-case type filter carries a one-line explanation and a link to the guide',()=>{
  assert.match(features,/class="muted job-type-hint"[^>]*>編集者派遣＝クライアントと直接やり取りし[\s\S]*編集代行＝ディレクターへ納品し[\s\S]*onclick="setView\('guide'\)">違いを見る<\/button>/);
});
