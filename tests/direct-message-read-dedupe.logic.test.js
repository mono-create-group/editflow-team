#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'direct-messages.js'), 'utf8');
const editorSource = fs.readFileSync(path.resolve(__dirname, '..', 'editor-features.js'), 'utf8');
const owner = { id: 'owner-uid', email: 'mono.create.group@gmail.com', name: '中村', approved: true, owner: true, roles: ['動画編集ディレクター'] };
const editor = { id: 'editor-uid', email: 'editor@example.test', name: '菅野', approved: true, roles: ['動画編集者'], editorKind: 'direct' };

function load({ failFirstWrite = false } = {}) {
  let writes = 0, reads = 0, fail = failFirstWrite;
  const listeners = [];
  const db = {
    collection(name) {
      assert.equal(name, 'direct_threads');
      return {
        where() { return this; },
        onSnapshot(ok) { listeners.push(ok); return () => {}; },
        doc(id) {
          return {
            id,
            get: async () => { reads += 1; return { exists: false }; },
            collection(child) {
              assert.equal(child, 'reads');
              return { doc() { return { get: async () => { reads += 1; return { exists: false }; }, set: async () => { writes += 1; if (fail) { fail = false; throw new Error('temporary'); } } }; } };
            }
          };
        }
      };
    }
  };
  const window = {
    location: { search: '' }, fbDb: db,
    FB_USER: { uid: editor.id, email: editor.email }, APP_ACCESS: editor, ACCESS_RECORDS: [owner, editor],
    EditflowFirestoreQuota: { isOpen: () => false, registerStop: () => {} }
  };
  const context = vm.createContext({ window, URLSearchParams, encodeURIComponent, Date, Array, Object, String, Number, Boolean, Set, Map, Promise, console, Error });
  vm.runInContext(source, context, { filename: 'direct-messages.js' });
  const thread = { id: 'thread-1', participantA: editor.id, participantB: owner.id, ownerUid: owner.id, lastSenderUid: owner.id, lastMessageAt: 123, lastMessagePreview: '初稿です' };
  return { api: window.EditflowDM, thread, counts: () => ({ writes, reads }), listeners };
}

test('DM read receipt does no work for an empty initial list or self-sent thread', async () => {
  const { api, thread, counts, listeners } = load();
  api.watch(() => {});
  assert.equal(counts().reads, 0, 'watch does not issue an explicit initial list query');
  listeners[0]({ docs: [] });
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(counts(), { writes: 0, reads: 0 }, 'empty initial snapshot has no receipt reads or writes');
  await api.markRead(thread.id, { ...thread, lastSenderUid: editor.id });
  assert.deepEqual(counts(), { writes: 0, reads: 0 }, 'opening a self-sent thread never writes a receipt');
});

test('DM read receipt writes once for the same incoming snapshot, including concurrent callbacks', async () => {
  const { api, thread, counts } = load();
  await Promise.all([api.markRead(thread.id, thread), api.markRead(thread.id, thread)]);
  await api.markRead(thread.id, thread);
  assert.deepEqual(counts(), { writes: 1, reads: 0 }, 'one incoming message creates at most one receipt write and no validation get');
});

test('a failed read receipt remains retryable', async () => {
  const { api, thread, counts } = load({ failFirstWrite: true });
  await assert.rejects(api.markRead(thread.id, thread), /temporary/);
  await api.markRead(thread.id, thread);
  assert.deepEqual(counts(), { writes: 2, reads: 0 }, 'only a successful acknowledgement suppresses later writes');
});

test('DM watcher hydrates from listener snapshots instead of calling list again', () => {
  assert.match(source, /ownerThreadQuery\(me\)\.onSnapshot\(snapshot =>/);
  assert.doesNotMatch(source, /\n\s*emit\(\);\n\s*return trackedStop/, 'watch must not force a duplicate pre-snapshot emit');
  assert.match(source, /const rows = await enrichThreads\(me, snapshots\)/);
  assert.match(editorSource, /api\.markRead\(threadId,thread\)/, 'open DM passes the already-watched thread into receipt handling');
});

test('active DM retries acknowledgement when the thread-list snapshot arrives after messages', () => {
  const start = editorSource.indexOf('function updateDmThreads(');
  const end = editorSource.indexOf('async function startDmFeatures', start);
  assert.ok(start >= 0 && end > start);
  const body = editorSource.slice(start, end);
  assert.ok(body.indexOf('feature.dmThreads=incoming') < body.indexOf('markOpenDirectThreadRead(feature.dmActiveThreadId)'));
  assert.match(body, /if\(feature\.dmActiveThreadId\)markOpenDirectThreadRead\(feature\.dmActiveThreadId\)/);
});
