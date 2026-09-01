const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

function sourceBetween(name,next){
  const start=index.indexOf(`function ${name}`);
  const end=index.indexOf(`function ${next}`,start);
  assert.ok(start>=0&&end>start,`${name} source must exist`);
  return index.slice(start,end);
}

test('poitto connection classifier separates authorization/network failures from payload failures',()=>{
  const context={};
  vm.createContext(context);
  vm.runInContext(sourceBetween('_poittoNeedsAuthorization','_poittoRecoveryNotice')+'\nthis.classify=_poittoNeedsAuthorization;',context);
  assert.equal(context.classify('Failed to fetch'),true);
  assert.equal(context.classify('Load failed'),true);
  assert.equal(context.classify('NetworkError when attempting to fetch resource.'),true);
  assert.equal(context.classify('HTTP 403'),true);
  assert.equal(context.classify('HTTP 500'),false);
  assert.equal(context.classify('rowsが取得できませんでした'),false);
});

test('poitto recovery notice is actionable only for the owner and never exposes a key',()=>{
  const source=sourceBetween('_poittoRecoveryNotice','_poittoKey');
  assert.match(source,/Google連携を確認/);
  assert.match(source,/target="_blank" rel="noopener noreferrer"/);
  assert.match(source,/オーナーにGoogle連携の再承認を依頼/);
  assert.match(source,/scope==='ig'\?'igLoad\(true\)':'inqReload\(\)'/);
  assert.doesNotMatch(source,/poitto_admin_key|mc_ig_viewkey|ADMIN_KEY/);
});

test('inquiries and IG network errors render the authorization recovery state',()=>{
  const inquiries=sourceBetween('rInquiries','inqSetStatus');
  const ig=sourceBetween('rIgAccounts','rSalesRank');
  assert.match(inquiries,/_poittoNeedsAuthorization\(INQ_ERR\)/);
  assert.match(inquiries,/Google連携に接続できません/);
  assert.match(ig,/_igErr==='NET'/);
  assert.match(ig,/_poittoRecoveryNotice\('ig'\)/);
  assert.match(index,/\.then\(r=>\{if\(!r\.ok\)throw new Error\('HTTP '\+r\.status\);return r\.json\(\);\}\)/);
  assert.match(index,/_igErr=_poittoNeedsAuthorization\(e&&e\.message\)\?'NET':'ERR'/);
  assert.doesNotMatch(ig,/通信環境を確認して/);
});
