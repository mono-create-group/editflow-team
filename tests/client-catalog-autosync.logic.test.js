const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const editorSource = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

function catalogLogic() {
  const accountStart = source.indexOf('const nameKey=v=>');
  const accountEnd = source.indexOf('function masterAccounts(client)', accountStart);
  const mergeStart = source.indexOf('function mergeMasterCatalogAccounts(', accountEnd);
  const mergeEnd = source.indexOf('function directCatalogEditors()', mergeStart);
  assert.ok(accountStart >= 0 && accountEnd > accountStart && mergeStart > accountEnd && mergeEnd > mergeStart);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${source.slice(accountStart, accountEnd)}\n${source.slice(mergeStart, mergeEnd)}\nthis.logic={mergeMasterCatalogAccounts};`, context);
  return context.logic;
}

test('master catalog sync preserves account IDs and propagates rename / logical deletion', () => {
  const { mergeMasterCatalogAccounts } = catalogLogic();
  const renamed = mergeMasterCatalogAccounts(
    [{ id: 'acct-a', name: '新アカウント', formerNames: ['旧アカウント'] }],
    [{ id: 'acct-a', name: '旧アカウント', active: true }]
  );
  assert.equal(renamed[0].id, 'acct-a');
  assert.equal(renamed[0].name, '新アカウント');
  assert.deepEqual(Array.from(renamed[0].formerNames), ['旧アカウント']);

  const deleted = mergeMasterCatalogAccounts(
    [{ id: 'acct-a', name: '新アカウント', active: false, formerNames: ['旧アカウント'] }],
    renamed
  );
  assert.equal(deleted[0].id, 'acct-a');
  assert.equal(deleted[0].active, false);
});

test('editor selectors omit logically deleted accounts and explain direct versus external sharing', () => {
  assert.match(source, /\.active!==false/);
  assert.match(editorSource, /担当ディレクターまたはオーナー/);
  assert.match(editorSource, /登録・同期/);
});

test('automatic master synchronization targets direct editors only', () => {
  const start = source.indexOf('function directCatalogEditors()');
  const end = source.indexOf('async function syncDirectCatalogForClient', start);
  const body = source.slice(start, end);
  assert.match(body, /editor\.editorKind!=='external'/);
  assert.match(source, /syncDirectCatalogForClient\(next,\{previous\}\)/);
  assert.match(source, /syncDirectCatalogForClient\(next,\{previous\}\)/);
  assert.match(source, /active:client\.deleted!==true/);
  assert.match(source, /formerNames/);
  assert.doesNotMatch(body, /external.*return true/);
});

test('client create edit and logical deletion sync before local ledger mutation', () => {
  const saveStart = source.indexOf('async function saveClientWithCatalog()');
  const deleteStart = source.indexOf('async function confirmDelClientWithCatalog(id)');
  const bulkStart = source.indexOf('async function syncMasterCatalog()');
  const saveBody = source.slice(saveStart, deleteStart);
  const deleteBody = source.slice(deleteStart, bulkStart);
  assert.ok(saveBody.indexOf('await syncDirectCatalogForClient') < saveBody.indexOf('S.clients.push(next)'));
  assert.ok(deleteBody.indexOf('await syncDirectCatalogForClient') < deleteBody.indexOf('Object.assign(current,next)'));
  assert.match(deleteBody, /deleted:true/);
  assert.match(source, /window\.saveClient=saveClientWithCatalog/);
  assert.match(source, /window\.confirmDelClient=confirmDelClientWithCatalog/);
});

test('owner can bulk sync existing master clients and sees exact scope', () => {
  const start = source.indexOf('async function syncMasterCatalog()');
  const end = source.indexOf('window.saveClient=saveClientWithCatalog', start);
  const body = source.slice(start, end);
  assert.match(body, /既存クライアント \$\{clients\.length\}件を直接契約編集者 \$\{editors\.length\}名へ同期/);
  assert.match(body, /外部編集者には共有しません/);
  assert.match(body, /カタログ \$\{documents\}件/);
  assert.match(source, /managerSyncMasterCatalog/);
});

test('catalog schema permits the bounded former-name trail used by direct synchronization', () => {
  const start = rules.indexOf('function validClientCatalogDocument()');
  const end = rules.indexOf('function approvedMember()', start);
  const block = rules.slice(start, end);
  assert.match(block, /'formerNames'/);
  assert.match(block, /get\('formerNames', \[\]\) is list/);
  assert.match(block, /get\('formerNames', \[\]\)\.size\(\) <= 100/);
  assert.match(block, /get\('active', true\) is bool/);
  const managerStart = rules.indexOf('function catalogManager(uid)');
  const managerEnd = rules.indexOf('function validClientCatalogDocument()', managerStart);
  const managerBlock = rules.slice(managerStart, managerEnd);
  assert.match(managerBlock, /return owner\(\)/);
  assert.match(managerBlock, /editorKind\(uid\) == 'external'/);
  assert.match(managerBlock, /directorUid/);
  assert.match(rules, /allow create, update: if catalogManager\(uid\)\s*&& validClientCatalogDocument\(\)/);
});
