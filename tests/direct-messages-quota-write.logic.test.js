#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'direct-messages.js'), 'utf8');
const owner = { id: 'owner-uid', email: 'mono.create.group@gmail.com', name: '中村', approved: true, owner: true, roles: ['動画編集ディレクター'] };
const editor = { id: 'editor-uid', email: 'editor@example.test', name: '菅野', approved: true, roles: ['動画編集者'], editorKind: 'direct' };

function loadCircuitOpenApi() {
  let databaseTouched = false;
  const db = new Proxy({}, { get() { databaseTouched = true; throw new Error('Firestore must not be touched while the circuit is open'); } });
  const window = {
    location: { search: '' }, fbDb: db,
    FB_USER: { uid: owner.id, email: owner.email }, APP_ACCESS: owner, ACCESS_RECORDS: [owner, editor],
    EditflowFirestoreQuota: { isOpen: () => true, registerStop: () => {} }
  };
  const context = vm.createContext({ window, URLSearchParams, encodeURIComponent, Date, Array, Object, String, Number, Boolean, Set, Map, Promise, console, Error });
  vm.runInContext(source, context, { filename: 'direct-messages.js' });
  return { api: window.EditflowDM, touched: () => databaseTouched };
}

test('DM write entries fail closed without touching Firestore while the quota circuit is open', async () => {
  const { api, touched } = loadCircuitOpenApi();
  const paused = /クラウド接続停止中。再読み込み後に操作してください/;
  await assert.rejects(api.ensureThread(editor.id), paused);
  await assert.rejects(api.send(editor.id, '確認です'), paused);
  await assert.rejects(api.markRead('dm_v1_owner__editor'), paused);
  await assert.rejects(api.markAllRead(['dm_v1_owner__editor']), paused);
  assert.equal(touched(), false, 'a paused write must not perform reads, writes, or enqueue a later Firestore action');
  assert.equal(api.cloudWritePausedMessage, 'クラウド接続停止中。再読み込み後に操作してください');
});

test('all direct-message Firestore write entry points use the shared quota guard', () => {
  for (const name of ['ensureThread', 'send', 'markRead', 'markAllRead']) {
    assert.match(source, new RegExp(`async function ${name}\\([^)]*\\) \\{\\s*assertCloudWriteAvailable\\(\\)`), `${name} must fail closed before Firestore work`);
  }
});
