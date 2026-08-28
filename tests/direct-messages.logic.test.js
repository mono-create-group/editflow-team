#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const source = fs.readFileSync(path.resolve(__dirname, '..', 'direct-messages.js'), 'utf8');

function load({ user, access, records, demo = true }) {
  const window = { location: { search: '' }, FB_USER: user, APP_ACCESS: access, ACCESS_RECORDS: records, DEMO: demo };
  const context = vm.createContext({ window, URLSearchParams, encodeURIComponent, Date, Array, Object, String, Number, Boolean, Set, Map, Promise, console });
  vm.runInContext(source, context, { filename: 'direct-messages.js' });
  return window.EditflowDM;
}

const owner = { id: 'owner-uid', email: 'mono.create.group@gmail.com', name: '中村', approved: true, owner: true, roles: ['動画編集ディレクター'] };
const director = { id: 'director-uid', email: 'director@example.test', name: '三浦', approved: true, roles: ['動画編集ディレクター'] };
const direct = { id: 'direct-uid', email: 'direct@example.test', name: '菅野', approved: true, roles: ['動画編集者'], editorKind: 'direct' };
const external = { id: 'external-uid', email: 'external@example.test', name: '外部編集者', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'director-uid' };
const otherExternal = { id: 'other-external-uid', email: 'other@example.test', name: '別チーム', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'other-director' };
const records = [owner, director, direct, external, otherExternal];

{
  const api = load({ user: { uid: owner.id, email: owner.email }, access: owner, records });
  assert.deepEqual(JSON.parse(JSON.stringify(api.peers().map(x => x.uid).sort())), ['direct-uid', 'director-uid', 'external-uid', 'other-external-uid']);
  assert.equal(api.canMessage(external.id), true);
}
{
  const api = load({ user: { uid: director.id, email: director.email }, access: director, records });
  assert.deepEqual(JSON.parse(JSON.stringify(api.peers().map(x => x.uid).sort())), ['external-uid', 'owner-uid']);
  assert.equal(api.canMessage(direct.id), false, 'a director cannot DM a direct editor outside their team');
}
{
  const api = load({ user: { uid: external.id, email: external.email }, access: external, records });
  assert.deepEqual(JSON.parse(JSON.stringify(api.peers().map(x => x.uid).sort())), ['director-uid', 'owner-uid']);
  assert.equal(api.canMessage(otherExternal.id), false);
  assert.equal(api.threadId(external.id, director.id), api.threadId(director.id, external.id), 'thread id is deterministic');
  assert.throws(() => api.threadId(external.id, external.id), /invalid-direct-message-participants/);
}
{
  const api = load({ user: { uid: direct.id, email: direct.email }, access: direct, records });
  assert.deepEqual(JSON.parse(JSON.stringify(api.peers().map(x => x.uid))), ['owner-uid']);
  assert.equal(api.canMessage(director.id), false);
  assert.rejects(() => api.send(owner.id, 'x'.repeat(2001)), /invalid-direct-message-body/);
}

const rules = fs.readFileSync(path.resolve(__dirname, '..', 'firestore.rules'), 'utf8');
assert.match(rules, /match \/direct_threads\/\{threadId\}/);
assert.match(rules, /match \/messages\/\{messageId\}/);
assert.match(rules, /allow update, delete: if false;/, 'messages are append-only');
assert.match(rules, /match \/reads\/\{uid\}/);
assert.match(rules, /allow read: if self\(uid\)/, 'read receipt is private');
assert.match(rules, /dmExternalFor/);
assert.match(source, /function ownerThreadQuery\(me\)/);
assert.match(source, /where\('ownerUid', '!=', ''\)/, 'non-owner list is limited to owner conversations');
assert.match(source, /Current director\/external conversations are watched by deterministic/, 'team conversations use deterministic document watches');
console.log('direct messages contracts: PASS');
