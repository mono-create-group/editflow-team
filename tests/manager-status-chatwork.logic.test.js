const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');

test('Chatwork comparison normalizes full-width characters and spacing', () => {
  const fn = source.match(/function normalizeChatworkName\(value\)\{[^}]+\}/)?.[0];
  assert.ok(fn, 'normalizeChatworkName must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fn};this.normalizeChatworkName=normalizeChatworkName;`, context);
  assert.equal(context.normalizeChatworkName(' 鈴木　真由美 '), context.normalizeChatworkName('鈴木 真由美'));
  assert.equal(context.normalizeChatworkName('R．Ishida'), context.normalizeChatworkName('r.ishida'));
});

test('legacy assignment status counts parent and subcase assignments', () => {
  const fn = source.match(/function legacyAssignmentCount\(editor\)\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(fn, 'legacyAssignmentCount must exist');
  const context = {_isOwner:()=>true,S:{jobs:[
    {id:'parent',workerIds:['w1'],subtasks:[{workerId:'w2'},{workerId:'w1'}]},
    {id:'sub-only',workerId:'w2',subtasks:[{workerId:'w1'}]},
    {id:'deleted',workerId:'w1',deleted:true}
  ]}};
  vm.createContext(context);
  vm.runInContext(`${fn};this.legacyAssignmentCount=legacyAssignmentCount;`, context);
  assert.equal(context.legacyAssignmentCount({workerId:'w1'}), 3);
  assert.equal(context.legacyAssignmentCount({workerId:'w2'}), 2);
  assert.equal(context.legacyAssignmentCount({workerId:''}), 0);
});

test('director view never reads or syncs legacy assignments', () => {
  const count = source.match(/function legacyAssignmentCount\(editor\)\{[\s\S]*?\n  \}/)?.[0];
  const entries = source.match(/function legacySyncEntriesForEditor\(editor\)\{[\s\S]*?\n  \}/)?.[0];
  const sync = source.match(/function canSyncLegacyForEditor\(\)\{[^}]+\}/)?.[0];
  assert.ok(count);
  assert.ok(entries);
  assert.ok(sync);
  const context = {_isOwner:()=>false,S:{jobs:[{workerId:'legacy-worker'}]}};
  vm.createContext(context);
  vm.runInContext(`${count};${entries};${sync};this.count=legacyAssignmentCount;this.entries=legacySyncEntriesForEditor;this.canSync=canSyncLegacyForEditor;`, context);
  assert.equal(context.count({workerId:'legacy-worker'}), 0);
  assert.equal(context.entries({workerId:'legacy-worker'}).length, 0);
  assert.equal(context.canSync({workerId:'legacy-worker'}), false);
});

test('management roster keeps loading, permission, job, and Chatwork states explicit', () => {
  assert.match(source, /利用可能/);
  assert.match(source, /案件なし/);
  assert.match(source, /設定中/);
  assert.match(source, /Chatwork名不一致/);
  assert.match(source, /Chatwork名確認待ち/);
  assert.match(source, /chatworkNameVerifiedAt/);
  assert.match(source, /managerOpenChatworkNameCheck/);
  assert.match(source, /onclick="managerOpenChatworkNameCheck\('\$\{esc\(e\.id\)\}'\)"/);
  assert.doesNotMatch(source, /rosterHtmlWithCopy/);
  assert.match(source, /state\.loaded\.portalJobs\.has\(editor\.id\)/);
  assert.match(source, /担当案件 \$\{s\.portalCount\}件/);
  assert.match(source, /directorView\?'':syncButton/);
  assert.match(source, /if\(isDirector\(\)&&FB_USER\?\.uid\)/);
  assert.match(source, /root\.collection\('invoice_authorizations'\)/);
  assert.match(source, /if\(!_isOwner\(\)\)return toast\('請求書の承認・差戻しはオーナーのみ行えます'/);
});
