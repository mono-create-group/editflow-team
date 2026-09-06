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

test('the editor guide lists the three editor-owned statuses and the manager-owned ones',()=>{
  const start=editor.indexOf('<h2>案件の受託</h2>'),end=editor.indexOf('最初の1回だけすること',start);
  const block=editor.slice(start,end);
  assert.ok(start>0&&end>start);
  for(const s of ['<b>編集者進行中</b>','<b>初稿提出済み</b>','<b>修正稿提出済み</b>'])assert.ok(block.includes(s),s);
  for(const s of ['<b>アサイン済み</b>','<b>進行中</b>','<b>修正中</b>','<b>D確認OK</b>','<b>先方確認中</b>','<b>完了</b>'])assert.ok(block.includes(s),s);
  assert.match(block,/マニュアルと素材はすべて案件に添付されています/);
  assert.match(block,/「次の担当：あなた」のときだけ操作が必要です/);
});
