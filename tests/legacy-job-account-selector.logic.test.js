const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const index=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const manager=fs.readFileSync(path.resolve(__dirname,'..','manager-features.js'),'utf8');

test('legacy parent job editor selects an account belonging to the chosen client',()=>{
  assert.match(index,/id="j-account" onchange="applyOwnerClientPriceFromMaster\(\)"/);
  assert.match(index,/function changeJobClientSelection\(\)/);
  assert.match(index,/account\.innerHTML=_jobAccountOptions\(clientId\)/);
  assert.match(index,/managerOwnerClientAccounts/);
  assert.match(manager,/function ownerClientAccounts\(clientId\)/);
  assert.match(manager,/window\.managerOwnerClientAccounts=ownerClientAccounts/);
});

test('account-specific price and selected account are saved without exposing pricing in the account list',()=>{
  assert.match(index,/_ownerMasterClientUnitPrice\(clientId,accountId\)/);
  assert.match(index,/const accountSelect=document\.getElementById\('j-account'\),accountId=/);
  assert.match(index,/clientId:document\.getElementById\('j-cl'\)\.value\|\|null,accountId,accountName,workerIds/);
  assert.doesNotMatch(manager,/function ownerClientAccounts\(clientId\)[\s\S]*?return client\?masterAccounts\(client\)\.map\(account=>\(\{[^}]*price/);
});

test('an archived account already saved on a job remains selectable',()=>{
  assert.match(index,/if\(selected&&!rows\.some\(row=>row\.id===selected\)\)rows\.push\(\{id:selected,name:String\(selectedName\|\|'過去のアカウント'\)\}\)/);
});
