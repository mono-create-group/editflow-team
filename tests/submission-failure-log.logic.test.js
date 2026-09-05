const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const editor=fs.readFileSync(path.resolve(__dirname,'..','editor.html'),'utf8');
const owner=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const rules=fs.readFileSync(path.resolve(__dirname,'..','firestore.rules'),'utf8');

function functionSource(source,name){
  const start=source.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  const asyncStart=source.lastIndexOf('async ',start);
  const from=asyncStart>=0&&asyncStart+6===start?asyncStart:start;
  // 引数の分割代入 {a,b} を本体の波括弧と数えないよう、引数リストの終端から数え始める。
  const bodyStart=source.indexOf('){',start);
  assert.notEqual(bodyStart,-1,`${name} must have a body`);
  let depth=0,opened=false;
  for(let i=bodyStart+1;i<source.length;i+=1){
    if(source[i]==='{'){depth+=1;opened=true;}
    if(source[i]==='}'&&opened&&--depth===0)return source.slice(from,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('a failed progress save writes a redacted failure record that never blocks the user',()=>{
  const save=functionSource(editor,'saveJobProgressRequired');
  assert.match(save,/logSubmissionFailure\(\{jid,job:j,status,previousStatus,error:e,editorSubmitted,schedule,evidence\}\)/);
  const log=functionSource(editor,'logSubmissionFailure');
  assert.match(log,/if\(DEMO\|\|ADMIN_PREVIEW\|\|!db\|\|!user\?\.uid\)return;/);
  assert.match(log,/db\.collection\('editor_submit_failures'\)\.add\(record\)\.catch\(/);
  assert.doesNotMatch(log,/instructions|correctionReason|progress:|ownPay|editorPayAmount/,'no case text or money leaves the portal');
  const calls=[];
  const context={DEMO:false,ADMIN_PREVIEW:false,db:{collection:name=>({add:record=>{calls.push([name,record]);return Promise.resolve()}})},user:{uid:'u1',email:'e@example.com',displayName:'みゆう'},access:{name:'みゆう'},PORTAL_APP_VERSION:'20260905-06',safeUrl:v=>/^https?:\/\//.test(v),now:()=>123,navigator:{userAgent:'UA'},firebase:{firestore:{FieldValue:{serverTimestamp:()=>'TS'}}},console:{warn:()=>{}}};
  vm.createContext(context);
  vm.runInContext(`${log}\nthis.log=logSubmissionFailure;`,context);
  context.log({jid:'j1',job:{title:'WD-S087',parentCaseName:'9月分',workflow:{round:2,stage:'editing'}},status:'修正稿提出済み',previousStatus:'修正中',error:{code:'permission-denied',message:'Missing or insufficient permissions.'},editorSubmitted:true,schedule:{sharedDate:'2026-08-28',editorDraftDate:'2026-09-02',clientDraftDate:'2026-09-11',deliveryDate:''},evidence:'https://drive.google.com/x'});
  assert.equal(calls.length,1);
  const [name,record]=calls[0];
  assert.equal(name,'editor_submit_failures');
  assert.equal(record.uid,'u1');
  assert.equal(record.code,'permission-denied');
  assert.equal(record.status,'修正稿提出済み');
  assert.equal(record.evidenceOk,true);
  assert.equal(record.workflow?.round,2);assert.equal(record.workflow?.stage,'editing');
  assert.equal(record.appVersion,'20260905-06');
  assert.equal(record.at,'TS');
  const allowed=rules.match(/match \/editor_submit_failures\/\{failureId\}[\s\S]*?hasOnly\(\[([\s\S]*?)\]\)/)[1].match(/'([^']+)'/g).map(s=>s.replace(/'/g,''));
  for(const key of Object.keys(record))assert.ok(allowed.includes(key),`rules must allow key ${key}`);
});

test('Firestore lets only the editor create their own failure record and only the owner read all of them',()=>{
  const block=rules.slice(rules.indexOf('match /editor_submit_failures/{failureId}'));
  const end=block.indexOf('match /editor_portals/{uid}');
  const body=block.slice(0,end);
  assert.match(body,/allow read: if owner\(\) \|\| \(signedIn\(\) && resource\.data\.uid == request\.auth\.uid\)/);
  assert.match(body,/request\.resource\.data\.uid == request\.auth\.uid/);
  assert.match(body,/request\.resource\.data\.at == request\.time/);
  assert.match(body,/allow update, delete: if false;/);
});

test('the owner submission review page lists recent failure records with a plain-language cause',()=>{
  assert.match(functionSource(owner,'rVideoSubmissions'),/\$\{_ownerSubmitFailuresHtml\(\)\}/);
  assert.match(functionSource(owner,'ownerLoadSubmitFailures'),/collection\('editor_submit_failures'\)\.orderBy\('at','desc'\)\.limit\(30\)/);
  const context={};
  vm.createContext(context);
  vm.runInContext(`${functionSource(owner,'_ownerSubmitFailureHint')}\nthis.hint=_ownerSubmitFailureHint;`,context);
  assert.equal(context.hint({hasEvidence:false,evidenceOk:false,code:''}),'提出URLが空のまま');
  assert.equal(context.hint({hasEvidence:true,evidenceOk:false,code:''}),'提出URLが https:// で始まっていない');
  assert.match(context.hint({hasEvidence:true,evidenceOk:true,code:'permission-denied'}),/保存が拒否された/);
  assert.match(context.hint({hasEvidence:true,evidenceOk:true,code:'resource-exhausted'}),/利用上限/);
});
