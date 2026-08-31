const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');

function body(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `${start} block was not found`);
  return source.slice(from, to);
}

test('editor dispatch requires a client but permits no account', () => {
  const create = body(editor, 'async function createDispatchJob()', 'async function claimBoardJob');
  assert.match(editor, /アカウント名（任意）/);
  assert.match(editor, /アカウントなし（クライアント共通）/);
  assert.match(create, /if\(!client\)return toast\('クライアントを選択してください'\)/);
  assert.doesNotMatch(create, /if\(!client\|\|!accountItem\)/);
  assert.match(create, /if\(accountId&&!accountItem\)/);
  assert.match(create, /accountId:accountItem\?\.id\|\|''/);
  assert.match(create, /accountDisplay:accountItem\?\.name\|\|''/);
});

test('manager board publishing keeps account optional and stores empty account fields', () => {
  const publish = body(manager, 'async function publishBoard()', 'async function saveManual');
  assert.match(manager, /アカウントなし（クライアント共通）/);
  assert.match(publish, /if\(\(!openAll&&!target\)\|\|!client\)return toast\('公開先・クライアントを選択してください'/);
  assert.doesNotMatch(publish, /\|\|!account\)return toast/);
  assert.match(publish, /if\(accountId&&!account\)/);
  assert.match(publish, /accountId:account\?\.id\|\|''/);
  assert.match(publish, /accountName:account\?\.name\|\|''/);
  assert.match(publish, /notes:\[client\.name,account\?\.name\]\.filter\(Boolean\)\.join\(' \/ '\)/);
});

test('sharing a client with an editor does not require or fabricate an account', () => {
  const share = body(manager, 'async function saveCatalog()', 'function hydrateClients');
  assert.match(manager, /placeholder="アカウント名（任意）"/);
  assert.match(share, /if\(!uid\|\|!clientId\|\|!name\)return toast\('編集者・既存クライアントを選択してください'/);
  assert.match(share, /addedAccount=accountName\?\[\{id:safeId\(\),name:accountName\}\]:\[\]/);
  assert.match(share, /if\(accountName&&master&&sourceRecord/);
});

test('no-account pricing resolves through the client default', () => {
  const pricing = body(manager, 'function clientUnitPriceFor(', 'function ownerClientUnitPrice(');
  assert.match(pricing, /return priceValue\(record\?\.defaultClientUnitPrice\)/);
  assert.match(manager, /アカウント未選択時はクライアント共通の標準単価/);
});
