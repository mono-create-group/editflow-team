const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app-ui.css'), 'utf8');

function accountLogic() {
  const start = source.indexOf("const nameKey=v=>");
  const end = source.indexOf('function masterAccounts(client)', start);
  assert.ok(start >= 0 && end > start, 'account helper source must exist');
  const context = { safeId: () => 'generated-id' };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.logic={mergeAccounts,accountHiddenNames,visibleAccounts,accountMatches,editAccountList,deleteAccountList,addOrReviveAccount};`, context);
  return context.logic;
}

test('renaming keeps the stable account id and hides stale historical names', () => {
  const logic = accountLogic();
  const renamed = logic.editAccountList([{ id: 'account-1', name: '旧アカウント' }], { id: 'account-1', name: '旧アカウント' }, '新アカウント');
  assert.equal(renamed[0].id, 'account-1');
  assert.equal(renamed[0].name, '新アカウント');
  assert.deepEqual(Array.from(renamed[0].formerNames), ['旧アカウント']);
  const visible = logic.visibleAccounts(
    logic.mergeAccounts(renamed, [{ id: 'historic-copy', name: '旧アカウント' }]),
    logic.accountHiddenNames({ accounts: renamed })
  );
  assert.deepEqual(Array.from(visible, x => x.name), ['新アカウント']);
});

test('deleting is a reversible logical delete and future selectors omit it', () => {
  const logic = accountLogic();
  const deleted = logic.deleteAccountList([{ id: 'account-1', name: 'ライフライン' }], { id: 'account-1', name: 'ライフライン' });
  assert.equal(deleted[0].active, false);
  assert.equal(logic.visibleAccounts(deleted).length, 0);
  const revived = logic.addOrReviveAccount(deleted, { id: 'new-id', name: 'ライフライン' });
  assert.equal(revived[0].id, 'account-1');
  assert.equal(revived[0].active, true);
});

test('account management exposes clear edit and delete actions with safe copy', () => {
  assert.match(source, /managerOpenMasterAccountEdit/);
  assert.match(source, /managerOpenMasterAccountDelete/);
  assert.match(source, /managerSaveMasterAccountEdit/);
  assert.match(source, /managerConfirmMasterAccountDelete/);
  assert.match(source, /既存案件、請求、進捗、履歴は削除・変更しません/);
  assert.match(source, /syncCatalogAccountChange\(client,account,nextName,false\)/);
  assert.match(source, /syncCatalogAccountChange\(client,account,'',true\)/);
  assert.match(css, /\.manager-account-row\{[^}]*grid-template-columns:minmax\(0,1fr\) auto/);
  assert.match(css, /\.manager-account-actions \.btn\{min-width:64px\}/);
});

test('account mutations remain owner-only and do not rewrite historical jobs', () => {
  for (const name of ['saveMasterAccountEdit', 'confirmMasterAccountDelete']) {
    const start = source.indexOf(`function ${name}`);
    const end = source.indexOf('\n  }', start) + 4;
    const body = source.slice(start, end);
    assert.match(body, /if\(!_isOwner\(\)\)/);
    assert.doesNotMatch(body, /PORTAL_JOBS\s*\.|S\.jobs\s*=/);
  }
});
