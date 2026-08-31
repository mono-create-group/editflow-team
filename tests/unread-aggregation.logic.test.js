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

test('visible submissions stay four when two separate DM records exist', () => {
  const { api } = registry();
  api.set('owner-submissions', [1, 2, 3, 4].map(id => ({ notificationId: `submission:${id}`, unread: true })));
  api.set('owner-dm', [1, 2].map(id => ({ notificationId: `dm:${id}`, unread: true })));
  assert.equal(api.snapshot().count, 6);
  assert.equal(api.sourceSnapshot('owner-submissions').count, 4);
  assert.equal(api.sourceSnapshot('owner-dm').count, 2);
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

test('owner Dock badge is rebuilt from the same pending submissions shown in navigation, not DM unread', () => {
  assert.match(owner, /function ownerSubmissionUnreadItems\(source=_videoSubmissionReviewItems\(\)\)/);
  assert.match(owner, /notificationId:`submission:\$\{portalUid\}:\$\{jobId\}:/);
  assert.match(owner, /api\.set\('owner-submissions',_isOwner\(\)&&!ownerDmIsDemo\(\)\?ownerSubmissionUnreadItems\(\):\[\]\)/);
  assert.match(owner, /function ownerVisibleNotificationCount\(\)\{[\s\S]*?sourceSnapshot\?\.\('owner-submissions'\)\.count/);
  assert.match(owner, /ownerSubmissionUnreadItems\(\)\.length/);
  assert.match(owner, /function ownerSyncAppBadge\(\)\{const count=ownerVisibleNotificationCount\(\);/);
  assert.doesNotMatch(owner, /function ownerSyncAppBadge\(\)\{[^}]*ownerUnreadCount\(/);
  assert.match(owner, /_ownerPortalBridgeReady\.jobs=true;_notifyOwnerPortalBridge\(\);\s*ownerSyncAppBadge\(\);/);
  const source = owner.match(/function ownerSubmissionUnreadItems\(source=_videoSubmissionReviewItems\(\)\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const collect = vm.runInNewContext(`(${source})`);
  const rows = collect([
    { portalUid: 'editor-a', id: 'job-1', round: 1, kind: '初稿' },
    { portalUid: 'editor-b', id: 'job-2', round: 2, kind: '修正稿' },
    { portalUid: 'editor-c', id: 'job-3', round: 1, kind: '初稿' },
    { portalUid: 'editor-d', id: 'job-4', round: 3, kind: '修正稿' }
  ]);
  assert.equal(rows.length, 4);
  assert.deepEqual(Array.from(rows, row => row.notificationId), [
    'submission:editor-a:job-1:1:初稿',
    'submission:editor-b:job-2:2:修正稿',
    'submission:editor-c:job-3:1:初稿',
    'submission:editor-d:job-4:3:修正稿'
  ]);
});

test('owner visible notification count falls back to the four rendered submissions without the registry', () => {
  const source = owner.match(/function ownerVisibleNotificationCount\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = vm.createContext({
    ownerSyncUnreadSources: () => null,
    ownerUnreadApi: () => null,
    _isOwner: () => true,
    ownerDmIsDemo: () => false,
    ownerSubmissionUnreadItems: () => [{}, {}, {}, {}],
    Number,
    Math,
  });
  vm.runInContext(`${source};this.result=ownerVisibleNotificationCount();`, context);
  assert.equal(context.result, 4);
});

test('authentication changes clear stale unread registry and device badge before rebuilding', () => {
  assert.match(owner, /fbAuth\.onAuthStateChanged\(async user=>\{[\s\S]*?EditflowUnread\?\.reset\?\.\(\);window\.EditorPush\?\.syncBadge\?\.\(0\)/);
  assert.match(editor, /function handlePortalAuthState\(nextUser\)\{[\s\S]*?EditflowUnread\?\.reset\?\.\(\);window\.EditorPush\?\.syncBadge\?\.\(0\)/);
});

test('editor badge uses source snapshots and clears all editor sources on stop', () => {
  const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
  assert.match(features, /function syncEditorUnreadSources\(\)/);
  assert.match(features, /registry\.set\('editor-dm',api\?\.unreadItems\?\.\(feature\.dmThreads\)\|\|\[\]\)/);
  assert.match(features, /registry\.set\('editor-case',editorCaseUnreadItems\(\)\)/);
  assert.match(features, /registry\?\.clear\?\.\('editor-dm'\)/);
  assert.match(features, /registry\?\.clear\?\.\('editor-case'\)/);
  assert.match(features, /function editorVisibleNotificationCount\(\)\{[\s\S]*?sourceSnapshot\?\.\('editor-case'\)\.count/);
  assert.match(features, /function syncEditorAppBadge\(\)\{\s*const count=editorVisibleNotificationCount\(\);/);
  const visibleCount = (features.match(/function editorVisibleNotificationCount\(\)\{[\s\S]*?\n  \}\n  function syncEditorAppBadge/) || [''])[0];
  assert.doesNotMatch(visibleCount, /dmUnreadCount\(/);
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
