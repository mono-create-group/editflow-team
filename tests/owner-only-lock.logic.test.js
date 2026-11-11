const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const lock=require('../scripts/owner-lock.cjs');

const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const index=read('index.html'),editor=read('editor.html'),rules=read('firestore.rules');

const OWNER=['nakamurakouta512@gmail.com','mono.create.group@gmail.com'];

function functionSource(html,name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  let depth=0,opened=false;
  for(let i=start;i<html.length;i+=1){
    if(html[i]==='{'){depth+=1;opened=true;}
    if(html[i]==='}'&&opened&&--depth===0)return html.slice(start,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('ルール・社内アプリ・編集者ポータルの3つが同じロック状態で、会長のアドレスも同じ',()=>{
  assert.equal(lock.rulesState(rules),'on');
  assert.equal(lock.flagState(index),'on');
  assert.equal(lock.flagState(editor),'on');
  const inRules=[...rules.slice(rules.indexOf('function ownerEmail()'),rules.indexOf('function signedIn()')).matchAll(/'([^']+@[^']+)'/g)].map(m=>m[1]);
  assert.deepEqual(inRules,OWNER);
  assert.deepEqual([...index.match(/const OWNER_LOCK_EMAILS=\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]),OWNER);
  assert.deepEqual([...editor.match(/const OWNER_EMAILS=\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).sort(),[...OWNER].sort());
  assert.deepEqual([...index.match(/const ADMIN_EMAILS=\[([^\]]+)\]/)[1].matchAll(/'([^']+)'/g)].map(m=>m[1]).sort(),[...OWNER].sort(),'アプリ内の会長判定とロックの会長が食い違わない');
});

function lockedFn(html,flagName,helperName,emails){
  const context={};
  vm.createContext(context);
  vm.runInContext(`const ${flagName}=true;const ${emails.name}=${JSON.stringify(emails.list)};${functionSource(html,helperName)}\nthis.locked=${helperName};`,context);
  return context.locked;
}

test('社内アプリ：会長だけ通し、未確認メール・似たアドレス・他人・未ログインの扱いが正しい',()=>{
  const locked=lockedFn(index,'OWNER_ONLY_LOCK','_ownerOnlyLocked',{name:'OWNER_LOCK_EMAILS',list:OWNER});
  assert.equal(locked(null),false,'未ログインはロックの対象ではない（ログイン画面を出す）');
  for(const email of OWNER){
    assert.equal(locked({email,emailVerified:true}),false,`${email} は通す`);
    assert.equal(locked({email:email.toUpperCase(),emailVerified:true}),false,'大文字小文字は区別しない');
    assert.equal(locked({email:` ${email} `,emailVerified:true}),false,'前後の空白は無視');
    assert.equal(locked({email,emailVerified:false}),true,'メール未確認は止める');
  }
  assert.equal(locked({email:'staff@example.com',emailVerified:true}),true);
  assert.equal(locked({email:`${OWNER[0]}.evil`,emailVerified:true}),true,'似たアドレスは止める');
  assert.equal(locked({email:'',emailVerified:true}),true);
  assert.equal(locked({emailVerified:true}),true,'メールが無いアカウントは止める');
});

test('編集者ポータル：同じ判定',()=>{
  const locked=lockedFn(editor,'OWNER_ONLY_LOCK','ownerOnlyLocked',{name:'OWNER_EMAILS',list:OWNER});
  assert.equal(locked(null),false);
  for(const email of OWNER)assert.equal(locked({email,emailVerified:true}),false);
  assert.equal(locked({email:OWNER[0],emailVerified:false}),true);
  assert.equal(locked({email:'editor@example.com',emailVerified:true}),true);
});

test('社内アプリ：認証の入口で、書き込み・通知につながる処理より前にサインアウトして止まる',()=>{
  const start=index.indexOf('fbAuth.onAuthStateChanged(async user=>{');
  assert.notEqual(start,-1);
  const body=index.slice(start,index.indexOf('// ===GOOGLE CALENDAR===',start));
  const gate=body.indexOf('if(_ownerOnlyLocked(user)){');
  assert.ok(gate>0,'ゲートがある');
  const gateBody=body.slice(gate,body.indexOf('if(user)_ownerLockNotice=false;'));
  assert.match(gateBody,/await fbAuth\.signOut\(\)/);
  assert.match(gateBody,/return;/);
  assert.match(gateBody,/FB_USER=null/,'非オーナーを FB_USER に入れない');
  for(const later of ['FB_USER=user;','resolveAppAccess()','fbSetupRealtimeSync()','fbSetupTeamSync()','fbSetupPortalOpsSync()','_registerSignin','AIBridge.connect','gcalSilentReconnect']){
    assert.ok(body.indexOf(later)>gate,`${later} はゲートより後`);
  }
  // サインアウトの前後で、アクセス申請（会長に通知が出る元）を作る関数を呼ばない
  assert.doesNotMatch(gateBody,/_requestAccess|accessRequests|fbSave|save\(\)|toast\(|fetch\(|EditorPush|Notification/);
});

test('編集者ポータル：認証の入口で、アクセス申請の監視・作成より前にサインアウトして止まる',()=>{
  const body=functionSource(editor,'handlePortalAuthState');
  const gate=body.indexOf('if(ownerOnlyLocked(nextUser)){');
  assert.ok(gate>0);
  const gateBody=body.slice(gate,body.indexOf('if(nextUser)ownerLockNotice=false;'));
  assert.match(gateBody,/auth\.signOut\(\)/);
  assert.match(gateBody,/user=null/);
  assert.match(gateBody,/return loginScreen\(\)/);
  assert.ok(body.indexOf('observeAccess()')>gate,'アクセス確認（申請の作成を含む）はゲートより後');
  assert.doesNotMatch(gateBody,/requestAccess|accessRequest|observeAccess|\.set\(|\.add\(|fetch\(|EditorPush|Notification/);
});

test('ロック中のログイン画面：「始められます」の案内を出さず、止められた時は理由を出す',()=>{
  const gate=functionSource(index,'_gateLoginHTML');
  assert.match(gate,/現在はご利用いただけません/);
  assert.match(gate,/管理者のみ利用できます/);
  assert.match(gate,/このアカウントではログインできません/);
  assert.match(gate,/\$\{OWNER_ONLY_LOCK\?'':'<div class="note">アカウントをお持ちでない方も/);
  const login=functionSource(editor,'loginScreen');
  assert.match(login,/管理者のみ利用できます/);
  assert.match(login,/ownerLockNotice\?'<div class="auth-status danger" role="alert">このアカウントではログインできません。<\/div>'/);
  assert.match(login,/\$\{OWNER_ONLY_LOCK\?'':'<span class="auth-note">初回は管理者の承認が必要です/);
});

test('ON/OFF スクリプト：OFF は元のルールと同じ定義に戻り、ON に戻すと元のロックと完全に一致する',()=>{
  const off=lock.applyRules(rules,'off');
  assert.equal(lock.rulesState(off),'off');
  assert.match(off,/function signedIn\(\) \{\n      return request\.auth != null;\n    \}/,'解除中は元の signedIn() と同じ');
  assert.doesNotMatch(off,/ownerEmail/,'解除中は ownerEmail を持たない（処理量が元と同じ）');
  assert.equal(lock.applyRules(off,'on'),rules,'ON→OFF→ON で元に戻る');
  assert.equal(lock.applyRules(rules,'on'),rules,'ON を2回かけても変わらない');
  const flagOff=lock.applyFlag(index,'off');
  assert.equal(lock.flagState(flagOff),'off');
  assert.equal(lock.applyFlag(flagOff,'on'),index);
});

test('ON/OFF スクリプトのコマンドは、書き換えるだけで公開・送信・通知をしない',()=>{
  const code=read('scripts/owner-lock.cjs').split('\n').filter(line=>!line.trim().startsWith('//')).join('\n');
  const modules=[...code.matchAll(/require\('([^']+)'\)/g)].map(m=>m[1]);
  assert.deepEqual(modules.sort(),['node:fs','node:path'],'ファイルの読み書きだけ（通信・外部コマンドは使わない）');
  assert.doesNotMatch(code,/child_process|spawn|fetch\(|https?:\/\//);
});

test('元の定義：ロック解除時のルールは、ロック導入前のコミットの signedIn()/owner() と同じ文面',()=>{
  const off=lock.applyRules(rules,'off');
  const region=off.slice(off.indexOf('// BEGIN OWNER LOCK'),off.indexOf('// END OWNER LOCK'));
  assert.match(region,/function owner\(\) \{\n      return signedIn\(\)\n        && request\.auth\.token\.email_verified == true\n        && request\.auth\.token\.email in \[\n          'nakamurakouta512@gmail\.com',\n          'mono\.create\.group@gmail\.com'\n        \];\n    \}/);
});
