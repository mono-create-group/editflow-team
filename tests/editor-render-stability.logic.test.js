const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const editor=fs.readFileSync(path.resolve(__dirname,'..','editor.html'),'utf8');
const features=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');
const owner=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');

function functionSource(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  let depth=0,opened=false;
  for(let i=start;i<source.length;i+=1){
    if(source[i]==='{'){depth+=1;opened=true;}
    if(source[i]==='}'&&opened&&--depth===0)return source.slice(start,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('an opened parent case stays open across full re-renders',()=>{
  assert.match(features,/openCaseGroupKeys:new Set\(\)/);
  assert.match(features,/class="card editor-case-group"\$\{feature\.openCaseGroupKeys\.has\(group\.key\)\?' open':''\} ontoggle="setEditorCaseGroupOpen\('\$\{esc\(group\.key\)\}',this\.open\)"/);
  assert.match(features,/window\.setEditorCaseGroupOpen=setEditorCaseGroupOpen/);
  assert.match(functionSource(features,'openEditorJob'),/feature\.openCaseGroupKeys\.add\(String\(editorJobParent\(job\)\.key\|\|''\)\)/);
  const context={feature:{openCaseGroupKeys:new Set()}};
  vm.createContext(context);
  vm.runInContext(`${functionSource(features,'setEditorCaseGroupOpen')}\nthis.set=setEditorCaseGroupOpen;`,context);
  context.set('case-a',true);context.set('case-b',true);context.set('case-a',false);context.set('',true);
  assert.deepEqual([...context.feature.openCaseGroupKeys],['case-b']);
});

test('snapshot re-renders wait while the editor is typing and restore the submit panel afterwards',()=>{
  assert.match(editor,/function editorIsTypingInApp\(\)/);
  assert.match(functionSource(editor,'scheduleSnapshotRender'),/if\(editorIsTypingInApp\(\)\)\{snapshotRenderDeferred=true/);
  assert.match(editor,/document\.addEventListener\('focusout'/);
  assert.match(functionSource(editor,'captureEditorFormState'),/quick-status-\|quick-evidence-\|msg-body-/);
  assert.match(functionSource(editor,'restoreEditorFormState'),/updateEditorProgressChoice\(jid\)/);
  assert.match(functionSource(editor,'render'),/const formState=captureEditorFormState\(\);[\s\S]*restoreEditorFormState\(formState\)/);
});

test('a rejected submission explains the cause and retries once with a minimal payload',()=>{
  const catchBlock=functionSource(editor,'saveJobProgressRequired');
  assert.match(catchBlock,/String\(e&&e\.code\|\|''\)==='permission-denied'/);
  assert.match(catchBlock,/const minimal=\{status,workflow,progressEvents,progressMilestones,evidenceUrl:evidence,lastProgressChangedByUid:user\.uid/);
  assert.doesNotMatch(catchBlock.slice(catchBlock.indexOf('const minimal=')),/minimal=\{[^}]*(sharedDate|editorDraftDate|deliveryDate|deadline)/,'the retry must not resend schedule fields');
  assert.match(catchBlock,/setJobInlineError\(jid,message\);toast\(message\)/);
  const context={};
  vm.createContext(context);
  vm.runInContext(`${functionSource(editor,'portalProgressFailureMessage')}\nthis.msg=portalProgressFailureMessage;`,context);
  assert.match(context.msg({code:'permission-denied'},true,{quota:false}),/初稿・修正稿の提出が拒否されました[\s\S]*https:\/\/[\s\S]*（permission-denied）$/);
  assert.match(context.msg({code:'unavailable'},true,{quota:false}),/通信が不安定/);
  assert.match(context.msg({code:'unauthenticated'},false,{quota:false}),/ログインの有効期限/);
  assert.equal(context.msg({code:'resource-exhausted'},true,{quota:true,message:'QUOTA'}),'QUOTA');
  assert.match(context.msg({},true,{quota:false}),/初稿・修正稿の提出は記録されていません。入力内容は保持しました。$/);
});

test('invoice submission, invoice return, and case chat dispatch push notifications without blocking the save',()=>{
  assert.match(editor,/kind:'invoice_submitted',invoiceId:iid,idToken/);
  assert.match(owner,/kind:'invoice_returned',portalUid,invoiceId:id,idToken/);
  assert.match(functionSource(features,'sendJobMessage'),/kind:'case_message',portalUid:user\.uid,jobId:jid,idToken/);
  assert.match(editor,/管理者への通知は届かなかった可能性があります/);
  assert.match(features,/相手への通知は届かなかった可能性があります/);
  assert.match(functionSource(features,'pushStatusCopy'),/status\?\.message\|\|status\?\.reason/);
  assert.match(functionSource(owner,'ownerPushCopy'),/status\?\.message\|\|status\?\.reason/);
  assert.match(functionSource(editor,'startPortal'),/push\.ensureSubscribed\(\{db,uid:user\.uid\}\)/);
  assert.match(functionSource(owner,'ownerRefreshPushStatus'),/api\.ensureSubscribed\(\{db:fbDb,uid\}\)/);
});

test('the invoice manual is reachable from the invoice screen and the owner link library',()=>{
  assert.match(functionSource(editor,'invoiceStepsHtml'),/href="\.\/invoice-manual\.html"/);
  assert.match(owner,/id:'doclink_invoice_manual'[\s\S]{0,300}invoice-manual\.html/);
  const manual=fs.readFileSync(path.resolve(__dirname,'..','invoice-manual.html'),'utf8');
  assert.match(manual,/1案件＝1行/);
  assert.match(manual,/word-break:keep-all/);
  assert.doesNotMatch(manual,/[\u{1F300}-\u{1FAFF}]/u,'no emoji in the manual');
});
