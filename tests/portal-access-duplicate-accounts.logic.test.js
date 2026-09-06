const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');

function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  const bodyStart=html.indexOf('){',start);
  assert.notEqual(bodyStart,-1,`${name} must have a body`);
  let depth=0,opened=false;
  for(let i=bodyStart+1;i<html.length;i+=1){
    if(html[i]==='{'){depth+=1;opened=true;}
    if(html[i]==='}'&&opened&&--depth===0)return html.slice(start,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

function makeContext(records){
  const context={SELF_WID:'self',ACCESS_RECORDS:records};
  vm.createContext(context);
  vm.runInContext([functionSource('_legacyPortalAccessMatches'),functionSource('_accessUpdatedMillis'),functionSource('_legacyPortalAccessForWorker'),'this.pick=_legacyPortalAccessForWorker;'].join('\n'),context);
  return context;
}
const base={approved:true,workerId:'w1',roles:['動画編集者']};

test('a worker with two approved portal accounts is still synced, to the linked or most specific account',()=>{
  const older={...base,id:'old',email:'suzu@example.com',updatedAt:100};
  const direct={...base,id:'new',email:'mono@example.com',editorKind:'direct',updatedAt:200};
  const c=makeContext([older,direct]);
  assert.equal(c.pick('w1').id,'new','the account with a contract kind wins');
  assert.equal(c.pick('w1','old').id,'old','an already linked subcase keeps its account');
  assert.equal(c.pick('w1','unknown').id,'new');
  const c2=makeContext([{...base,id:'a',updatedAt:100},{...base,id:'b',updatedAt:300}]);
  assert.equal(c2.pick('w1').id,'b','otherwise the most recently updated account wins');
  assert.equal(makeContext([older]).pick('w1').id,'old');
  assert.equal(makeContext([]).pick('w1'),null);
  assert.equal(makeContext([older]).pick('self'),null);
  assert.equal(makeContext([{...base,approved:false,id:'x'}]).pick('w1'),null,'unapproved accounts never receive jobs');
});

test('the sync reports duplicate accounts and missing portal links instead of skipping silently',()=>{
  const sync=functionSource('syncLegacyAssignedSubtasksToPortal');
  assert.match(sync,/_legacyPortalAccessForWorker\(workerId,record\.portalUid\)/);
  assert.match(sync,/担当編集者のポータル連携が未設定（アプリ利用の承認が必要）/);
  assert.match(sync,/担当編集者のアカウントが\$\{_legacyPortalAccessMatches\(workerId\)\.length\}件ある/);
  assert.doesNotMatch(sync,/if\(!access\)\{if\(_editorDraftDateSetter\(record\)==='editor'\)problems/,'creator-set subcases must not be skipped silently');
});
