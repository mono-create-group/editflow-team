const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const direct = fs.readFileSync(path.join(root, 'direct-messages.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'editor-manifest.json'), 'utf8'));

test('Slack-style workspace keeps cases and communication in separate navigation groups', () => {
  assert.match(features, /editor-sidebar-label">案件管理/);
  assert.match(features, /editor-sidebar-label">コミュニケーション/);
  assert.match(features, /\['dm','DM'\]/);
  assert.match(features, /body\.classList\.toggle\('editor-slack-layout'/);
});

test('DM inbox has thread list, unread count, all-read, conversation, and one composer', () => {
  assert.match(features, /function dmHtml\(\)/);
  assert.match(features, /class="card dm-shell/);
  assert.match(features, /class="dm-inbox"/);
  assert.match(features, /未読 \$\{dmUnreadCount\(\)\}件/);
  assert.match(features, /markAllDirectMessagesRead\(\)/);
  assert.match(features, /class="dm-messages"/);
  assert.match(features, /onsubmit="sendDirectMessage\(event\)"/);
  assert.match(features, /案件内チャットに残してください/);
});

test('DM data layer is loaded before UI extension and the editor is installable', () => {
  assert.ok(editor.indexOf('direct-messages.js') < editor.indexOf('editor-features.js'));
  assert.match(editor, /rel="manifest" href="editor-manifest\.json"/);
  assert.equal(manifest.start_url, './editor.html');
  assert.match(direct, /async function loadPeers\(\)/);
  assert.match(direct, /where\('participants', 'array-contains', me\.uid\)/);
  assert.match(direct, /thread\.ownerUid === counterpartUid/);
  assert.match(features, /dmPeer\(peerUid\)\|\|\(existingThread\?dmThreadPeer\(existingThread\):null\)/);
});

test('device notification permission is requested only from a visible user action', () => {
  assert.match(features, /onclick="enableEditorDeviceNotifications\(\)"/);
  assert.match(features, /async function enableEditorDeviceNotifications\(\)/);
  assert.match(features, /Notification\.requestPermission\(\)/);
  assert.match(features, /if\(typeof Notification==='undefined'\)/);
});

test('mobile DM keeps the back action compact so the recipient name remains readable', () => {
  assert.match(features, /\.dm-back\{display:inline-flex;width:auto;flex:0 0 auto\}/);
  assert.match(features, /\.dm-thread-head h2,\.dm-thread-head span\{overflow:hidden;text-overflow:ellipsis;white-space:nowrap\}/);
});
