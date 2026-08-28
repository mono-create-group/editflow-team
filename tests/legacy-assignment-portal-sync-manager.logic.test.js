const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.join(__dirname, '..');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function sourceOf(name) {
  const start = manager.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = manager.indexOf('\n  function ', start + 1);
  return manager.slice(start, next < 0 ? manager.length : next);
}

test('owner manager shows portal and unlinked legacy counts, then targets only the selected editor', () => {
  for (const marker of ['本人画面：${s.portalCount===null?', '台帳上の担当：${s.legacyCount}件', '未連携：${s.legacyUnlinkedCount}件', '本人画面へ同期']) {
    assert.match(manager, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(manager, /syncLegacyAssignedSubtasksToPortal\(parent,\{silent:true,targetUid:uid,onlyMissing:true\}\)/);
  assert.match(manager, /state\.assignmentSyncing\.has\(uid\)/);
  assert.match(manager, /jobCount=portalCount===null\?null:portalCount\+\(_isOwner\(\)\?legacyUnlinkedCount:0\)/);
  assert.match(manager, /editor\?\.editorKind==='external'/);
  assert.match(manager, /catalogAccountsFromMaster\(client\)/);
  assert.doesNotMatch(sourceOf('shareLegacySyncClients'), /ownPay|workerPay|unitPrice|payableApproved/);
});

test('manager unlinked count follows assigned child first and inherits one parent editor only', () => {
  const context = {
    _isOwner: () => true,
    S: { jobs: [
      { id: 'parent-one', biz: 'edit', workerId: 'miyuu', subtasks: [
        { id: 'a', title: '継承される子', status: '進行中' },
        { id: 'b', title: '明示担当が優先', workerId: 'other', status: '進行中' },
      ] },
      { id: 'parent-many', biz: 'edit', workerIds: ['miyuu', 'other'], subtasks: [{ id: 'c', status: '進行中' }] },
      { id: 'missing-child-id', biz: 'edit', workerId: 'miyuu', subtasks: [{ status: '進行中' }] },
    ] },
    state: { portalJobsByEditor: new Map([['portal-miyuu', []]]) },
    SELF_WID: '__self__',
    jobBiz: (job) => job.biz,
    Map,
    Set,
    String,
  };
  vm.createContext(context);
  vm.runInContext(`${sourceOf('legacySyncEntriesForEditor')}\n${sourceOf('legacyUnlinkedEntriesForEditor')}\nthis.entries=legacySyncEntriesForEditor;this.unlinked=legacyUnlinkedEntriesForEditor;`, context);
  const editor = { id: 'portal-miyuu', workerId: 'miyuu' };
  assert.deepEqual(JSON.parse(JSON.stringify(context.entries(editor).map(item => [item.parent.id, item.record.id]))), [['parent-one', 'a']]);
  assert.equal(context.unlinked(editor).length, 1);
});

test('legacy synchronizer enforces target UID, missing-only writes, child preference, parent inheritance, and stable child IDs', () => {
  assert.match(index, /function _legacyPortalWorkerId\(parent,record,hasChildren\)/);
  assert.match(index, /if\(explicit&&explicit!==SELF_WID\)return explicit/);
  assert.match(index, /return unique\.length===1\?unique\[0\]:''/);
  assert.match(index, /syncLegacyAssignedSubtasksToPortal\(jobOrId,\{silent=false,targetUid='',onlyMissing=false\}=\{\}\)/);
  assert.match(index, /if\(targetUid&&String\(access\.id\)!==String\(targetUid\)\)return/);
  assert.match(index, /if\(record\?\.deleted\)return/);
  assert.match(index, /if\(hasChildren&&!String\(record\.id\|\|''\)\.trim\(\)\)/);
  assert.match(index, /if\(existing&&onlyMissing\)\{alreadyRows\.add\(item\.portalJobId\);continue;\}/);
  assert.doesNotMatch(index, /const subId=[\s\S]{0,400}if\(!deliveryDate\)/);
  assert.match(fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8'), /delivery != '' \|\| sourceWithoutDeadline/);
});
