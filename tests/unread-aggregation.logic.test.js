const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const bulletin = fs.readFileSync(path.join(root, 'bulletin.js'), 'utf8');
const dm = fs.readFileSync(path.join(root, 'direct-messages.js'), 'utf8');
const push = fs.readFileSync(path.join(root, 'editor-push.js'), 'utf8');
const owner = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function registry() {
  const events = [];
  const window = { dispatchEvent: event => events.push(event) };
  const context = vm.createContext({ window, Map, Set, Array, Object, String, Number, Boolean, CustomEvent: class CustomEvent { constructor(type, init) { this.type = type; this.detail = init?.detail; } } });
  vm.runInContext(bulletin, context, { filename: 'bulletin.js' });
  return { api: window.EditflowUnread, events };
}

test('four canonical unread notifications display as four even when categories repeat two of them', () => {
  const { api } = registry();
  api.set('dm', [{ notificationId: 'dm:thread-a:100', unread: true }, { notificationId: 'dm:thread-b:200', unread: true }]);
  api.set('case', [{ notificationId: 'dm:thread-a:100', unread: true }, { notificationId: 'case:job-c:message-d', unread: true }, { notificationId: 'case:job-d:message-e', unread: true }]);
  api.set('bulletin', [{ notificationId: 'case:job-c:message-d', unread: true }, { notificationId: 'case:job-d:message-e', unread: true }]);
  assert.deepEqual(JSON.parse(JSON.stringify(api.snapshot().ids)), ['case:job-c:message-d', 'case:job-d:message-e', 'dm:thread-a:100', 'dm:thread-b:200']);
  assert.equal(api.snapshot().count, 4);
});

test('re-subscribing a source replaces its old records and zero clears the app state', () => {
  const { api } = registry();
  api.set('dm', [{ notificationId: 'dm:thread-a:100', unread: true }, { notificationId: 'dm:thread-b:200', unread: true }]);
  api.set('dm', [{ notificationId: 'dm:thread-b:200', unread: true }]);
  assert.equal(api.snapshot().count, 1);
  api.set('dm', []);
  assert.equal(api.snapshot().count, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(api.snapshot().ids)), []);
});

test('push code does not use browser notification totals as unread badge totals', () => {
  assert.match(push, /async function pendingBadgeCount\(\)[\s\S]*return 0;/);
  assert.doesNotMatch(push, /getNotifications\(\)/);
  assert.match(push, /authoritative: false/);
  assert.doesNotMatch(push, /syncBadge\(badgeCount\)/);
});

test('owner app and service worker load the shared registry and never increment a push-local count', () => {
  assert.match(owner, /<script src="\.\/bulletin\.js\?v=20260831-\d+"><\/script>/);
  assert.match(editor, /<script src="\.\/bulletin\.js\?v=20260831-\d+"><\/script>/);
  assert.match(sw, /'\.\/bulletin\.js'/);
  assert.match(owner, /function ownerSetUnreadSource\(source,items\)/);
  assert.match(owner, /api\.unreadItems\?\.\(OWNER_DM_STATE\.threads\)/);
  assert.match(owner, /window\.addEventListener\('editflow-unread-source'/);
  assert.doesNotMatch(owner, /pendingCount|pendingBadgeCount/);
  assert.doesNotMatch(sw, /previous\+1|setAppBadge\?\.\(badgeCount\)/);
});

test('editor badge uses source snapshots and clears all editor sources on stop', () => {
  const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
  assert.match(features, /function syncEditorUnreadSources\(\)/);
  assert.match(features, /registry\.set\('editor-dm',api\?\.unreadItems\?\.\(feature\.dmThreads\)\|\|\[\]\)/);
  assert.match(features, /registry\.set\('editor-case',editorCaseUnreadItems\(\)\)/);
  assert.match(features, /registry\?\.clear\?\.\('editor-dm'\)/);
  assert.match(features, /registry\?\.clear\?\.\('editor-case'\)/);
  assert.doesNotMatch(features, /return Math\.max\(0,Math\.min\(999,dmUnreadCount\(\)\+unreadNotificationItems\(\)\.length\)\);/);
});

test('DM unread entries have stable token identities and collapse duplicate snapshots', () => {
  assert.match(dm, /function unreadNotificationId\(thread\)/);
  assert.match(dm, /`dm:\$\{id\}:\$\{token\}`/);
  assert.match(dm, /function unreadItems\(threads\)/);
  assert.match(dm, /unique\.set\(notificationId/);
});

test('DM helper treats a repeated Firestore snapshot as one unread notification', () => {
  const owner = { id: 'owner', email: 'mono.create.group@gmail.com', approved: true, owner: true, roles: ['動画編集ディレクター'] };
  const window = { location: { search: '' }, FB_USER: { uid: 'owner', email: owner.email }, APP_ACCESS: owner, ACCESS_RECORDS: [owner], DEMO: true };
  const context = vm.createContext({ window, URLSearchParams, encodeURIComponent, Date, Array, Object, String, Number, Boolean, Set, Map, Promise, console });
  vm.runInContext(dm, context, { filename: 'direct-messages.js' });
  const thread = { id: 'thread-a', unread: true, lastSenderUid: 'editor-a', lastMessageAt: 100, lastMessagePreview: '確認お願いします' };
  const rows = window.EditflowDM.unreadItems([thread, { ...thread }]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].notificationId, 'dm:thread-a:editor-a:100:確認お願いします');
});
