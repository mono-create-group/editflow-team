const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function functionSource(name, nextName) {
  const functionStart = index.indexOf(`function ${name}(`);
  const start = index.slice(Math.max(0, functionStart - 6), functionStart) === 'async ' ? functionStart - 6 : functionStart;
  const syncEnd = index.indexOf(`function ${nextName}(`, functionStart);
  const asyncEnd = index.indexOf(`async function ${nextName}(`, functionStart);
  const end = [syncEnd, asyncEnd].filter(position => position > functionStart).sort((a, b) => a - b)[0] ?? -1;
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return index.slice(start, end);
}

test('access requests default to creating the applicant as a new trial editor', () => {
  assert.match(index, /const MR_NEW_WORKER_VALUE='__new_editor__'/);
  assert.match(index, /申請者を新しい編集者として登録（トライアル）/);
  assert.match(index, /既存編集者へ紐付け（引き継ぎ）/);
  assert.match(index, /新規登録は申請時のChatwork表示名で編集者台帳へ追加します/);
  const options = functionSource('mrApprovalWorkerOptions', 'mrAccessRequestWorkerId');
  assert.ok(options.indexOf('MR_NEW_WORKER_VALUE') < options.indexOf('既存編集者へ紐付け'), 'new editor is the first/default choice');
});

test('new editor records are deterministic, editable trial records linked to the portal uid', () => {
  const sources = [
    functionSource('mrAccessRequestWorkerId', 'mrAccessRequestWorker'),
    functionSource('mrAccessRequestWorker', 'mrBuildAccessRequestWorker'),
    functionSource('mrBuildAccessRequestWorker', 'mrCommitNewEditorApproval'),
  ].join('\n');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${sources}\nthis.makeId=mrAccessRequestWorkerId;this.find=mrAccessRequestWorker;this.build=mrBuildAccessRequestWorker;`, context);
  assert.equal(context.makeId('abc/123'), 'portal-abc_123');
  const req = { id: 'uid-1', name: '編集 太郎', email: 'EDITOR@EXAMPLE.COM' };
  const worker = context.build(req, context.makeId(req.id), Date.UTC(2026, 8, 2));
  assert.equal(worker.id, 'portal-uid-1');
  assert.equal(worker.name, '編集 太郎');
  assert.equal(worker.contact, 'editor@example.com');
  assert.equal(worker.employStatus, 'trial');
  assert.equal(worker.portalUid, 'uid-1');
  assert.equal(worker.source, 'access_request');
  assert.equal(context.find([worker], 'uid-1').id, worker.id);
});

test('new worker and access approval are committed in one Firestore transaction', () => {
  const commit = functionSource('mrCommitNewEditorApproval', 'mrDirectorOptions');
  assert.match(commit, /fbDb\.runTransaction\(async tx=>/);
  assert.match(commit, /tx\.get\(teamRef\)/);
  assert.match(commit, /tx\.set\(teamRef,\{workers:_teamEncode\('workers',nextWorkers\)/);
  assert.match(commit, /tx\.set\(accessRef,\{\.\.\.accessData,workerId:committedWorker\.id/);
  assert.match(commit, /tx\.set\(requestRef,\{\.\.\.requestData,approvedAt:serverAt/);
  assert.match(commit, /if\(!Array\.isArray\(remoteWorkers\)\)throw new Error\('worker-ledger-unavailable'\)/);
});

test('transaction writes the same generated worker id to the team ledger and access record', async () => {
  const helperSources = [
    functionSource('mrAccessRequestWorkerId', 'mrAccessRequestWorker'),
    functionSource('mrAccessRequestWorker', 'mrBuildAccessRequestWorker'),
    functionSource('mrBuildAccessRequestWorker', 'mrCommitNewEditorApproval'),
    functionSource('mrCommitNewEditorApproval', 'mrDirectorOptions'),
  ].join('\n');
  const writes = [];
  const db = {
    collection(name) { return { doc(id) { return { name, id }; } }; },
    async runTransaction(callback) {
      const tx = {
        async get() { return { exists: true, data: () => ({ workers: JSON.stringify([]) }) }; },
        set(ref, data, options) { writes.push({ ref, data, options }); },
      };
      return callback(tx);
    },
  };
  const context = {
    _teamCloudLoaded: true,
    fbDb: db,
    _teamDecode: JSON.parse,
    _teamEncode: (_key, value) => JSON.stringify(value),
    FB_USER: { uid: 'owner-uid' },
    firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SERVER_TIME' } } },
  };
  vm.createContext(context);
  vm.runInContext(`${helperSources}\nthis.commit=mrCommitNewEditorApproval;`, context);
  const worker = await context.commit(
    { id: 'applicant-uid', name: '新規 編集者', email: 'new@example.com' },
    { uid: 'applicant-uid', roles: ['動画編集者'], approved: true },
    { status: 'approved' },
  );
  assert.equal(worker.id, 'portal-applicant-uid');
  const teamWrite = writes.find(write => write.ref.name === 'shared');
  const accessWrite = writes.find(write => write.ref.name === 'access');
  const requestWrite = writes.find(write => write.ref.name === 'accessRequests');
  assert.equal(JSON.parse(teamWrite.data.workers)[0].id, worker.id);
  assert.equal(accessWrite.data.workerId, worker.id);
  assert.equal(requestWrite.data.status, 'approved');
  assert.equal(writes.length, 3);
});

test('approval retains the handover route and fails closed before creating a new editor', () => {
  const approve = functionSource('mrApproveRequest', 'mrRejectRequest');
  assert.match(approve, /createNewWorker=grantsEditor&&workerId===MR_NEW_WORKER_VALUE/);
  assert.match(approve, /if\(createNewWorker&&!_teamCloudLoaded\)return toast/);
  assert.match(approve, /if\(createNewWorker&&_fbQuotaBlocked\)return toast/);
  assert.match(approve, /createdWorker=await mrCommitNewEditorApproval/);
  assert.match(approve, /else\{[\s\S]*?const batch=fbDb\.batch\(\)/, 'existing editor handover still uses the existing approval route');
  assert.match(approve, /workerId:grantsEditor\?resolvedWorkerId:null/);
  assert.doesNotMatch(approve.slice(0, approve.indexOf('await mrCommitNewEditorApproval')), /S\.workers\.push/, 'local worker ledger is not changed before the transaction commits');
});
