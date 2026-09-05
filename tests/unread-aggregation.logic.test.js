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

test('owner DM and submission sources stay separate from unrelated unread sources', () => {
  const { api } = registry();
  api.set('owner-submissions', [1, 2, 3, 4].map(id => ({ notificationId: `submission:${id}`, unread: true })));
  api.set('owner-dm', [1, 2].map(id => ({ notificationId: `dm:${id}`, unread: true })));
  api.set('owner-case', [1, 2, 3].map(id => ({ notificationId: `case:${id}`, unread: true })));
  assert.equal(api.snapshot().count, 9);
  assert.equal(api.sourceSnapshot('owner-submissions').count, 4);
  assert.equal(api.sourceSnapshot('owner-dm').count, 2);
  assert.equal(api.sourceSnapshot('owner-case').count, 3);
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
  assert.match(owner, /<script src="\.\/bulletin\.js\?v=\d{8}-\d+"><\/script>/);
  assert.match(editor, /<script src="\.\/bulletin\.js\?v=\d{8}-\d+"><\/script>/);
  assert.match(sw, /'\.\/bulletin\.js'/);
  assert.match(owner, /function ownerSetUnreadSource\(source,items\)/);
  assert.match(owner, /api\.unreadItems\?\.\(OWNER_DM_STATE\.threads\)/);
  assert.match(owner, /window\.addEventListener\('editflow-unread-source'/);
  assert.doesNotMatch(owner, /pendingCount|pendingBadgeCount/);
  assert.doesNotMatch(sw, /previous\+1|setAppBadge\?\.\(badgeCount\)/);
});

test('owner Dock badge sums unread DM, pending submissions and pending invoices', () => {
  assert.match(owner, /function ownerSubmissionUnreadItems\(source=_videoSubmissionReviewItems\(\)\)/);
  assert.match(owner, /notificationId:`submission:\$\{portalUid\}:\$\{jobId\}:/);
  assert.match(owner, /api\.set\('owner-submissions',active\?ownerSubmissionUnreadItems\(\):\[\]\)/);
  assert.match(owner, /api\.set\('owner-invoices',active\?ownerInvoiceUnreadItems\(\):\[\]\)/);
  assert.match(owner, /sourceSnapshot\?\.\('owner-dm'\)\.count/);
  assert.match(owner, /function ownerVisibleNotificationCount\(\)\{[\s\S]*?sourceSnapshot\?\.\('owner-submissions'\)\.count/);
  assert.match(owner, /dmCount\+submissionCount\+invoiceCount/);
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

test('owner visible notification count excludes unrelated registry sources', () => {
  const source = owner.match(/function ownerVisibleNotificationCount\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = vm.createContext({
    ownerSyncUnreadSources: () => null,
    ownerUnreadApi: () => ({ sourceSnapshot: name => ({ count: ({ 'owner-dm': 2, 'owner-submissions': 4, 'owner-case': 30 })[name] || 0 }) }),
    _isOwner: () => true,
    ownerDmIsDemo: () => false,
    ownerDmApi: () => ({ unreadItems: () => [] }),
    OWNER_DM_STATE: { threads: [] },
    ownerSubmissionUnreadItems: () => [{}, {}, {}, {}],
    ownerInvoiceUnreadItems: () => [],
    Array,
    Number,
    Math,
  });
  vm.runInContext(`${source};this.result=ownerVisibleNotificationCount();`, context);
  assert.equal(context.result, 6);
});

test('owner visible notification count adds invoices waiting for approval', () => {
  const source = owner.match(/function ownerVisibleNotificationCount\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = vm.createContext({
    ownerSyncUnreadSources: () => null,
    ownerUnreadApi: () => ({ sourceSnapshot: name => ({ count: ({ 'owner-dm': 2, 'owner-submissions': 4, 'owner-invoices': 3, 'owner-case': 30 })[name] || 0 }) }),
    _isOwner: () => true,
    ownerDmIsDemo: () => false,
    ownerDmApi: () => ({ unreadItems: () => [] }),
    OWNER_DM_STATE: { threads: [] },
    ownerSubmissionUnreadItems: () => [{}, {}, {}, {}],
    ownerInvoiceUnreadItems: () => [{}, {}, {}],
    Array,
    Number,
    Math,
  });
  vm.runInContext(`${source};this.result=ownerVisibleNotificationCount();`, context);
  assert.equal(context.result, 9);
});

test('owner visible notification count falls back to unread DM plus submissions and invoices without the registry', () => {
  const source = owner.match(/function ownerVisibleNotificationCount\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = vm.createContext({
    ownerSyncUnreadSources: () => null,
    ownerUnreadApi: () => null,
    _isOwner: () => true,
    ownerDmIsDemo: () => false,
    ownerDmApi: () => ({ unreadItems: () => [{}, {}] }),
    OWNER_DM_STATE: { threads: [{ unread: true }, { unread: true }] },
    ownerSubmissionUnreadItems: () => [{}, {}, {}, {}],
    ownerInvoiceUnreadItems: () => [{}, {}, {}],
    Array,
    Number,
    Math,
  });
  vm.runInContext(`${source};this.result=ownerVisibleNotificationCount();`, context);
  assert.equal(context.result, 9);
});

test('owner invoice notifications cover only editor invoices the owner has not acted on', () => {
  const source = owner.match(/function ownerInvoiceUnreadItems\(source=PORTAL_INVOICES\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const context = vm.createContext({ OWNER_INVOICE_PENDING_STATUSES: ['提出済み', '再提出'], Array, String, PORTAL_INVOICES: [] });
  vm.runInContext(`${source};this.collect=ownerInvoiceUnreadItems;`, context);
  const rows = context.collect([
    { _portalUid: 'editor-a', id: 'inv-1', status: '提出済み', version: 1 },
    { _portalUid: 'editor-b', id: 'inv-2', status: '再提出', version: 2 },
    { _portalUid: 'editor-c', id: 'inv-3', status: '承認済み', version: 1 },
    { _portalUid: 'editor-d', id: 'inv-4', status: '下書き', version: 1 },
    { _portalUid: 'editor-e', id: 'inv-5', status: '差戻し', version: 1 },
    { _portalUid: '', id: 'inv-6', status: '提出済み', version: 1 },
    { _portalUid: 'editor-f', id: 'inv-7', status: '提出済み', updatedAt: 1730000000000 }
  ]);
  assert.deepEqual(Array.from(rows, row => row.notificationId), [
    'invoice:editor-a:inv-1:1',
    'invoice:editor-b:inv-2:2',
    'invoice:editor-f:inv-7:1730000000000'
  ]);
  assert.equal(rows.every(row => row.unread === true && row.kind === 'invoice'), true);
});

test('an owner approval or rejection clears the invoice notification without a separate read store', () => {
  const source = owner.match(/function ownerInvoiceUnreadItems\(source=PORTAL_INVOICES\)\{[\s\S]*?\n\}/)?.[0];
  const context = vm.createContext({ OWNER_INVOICE_PENDING_STATUSES: ['提出済み', '再提出'], Array, String, PORTAL_INVOICES: [] });
  vm.runInContext(`${source};this.collect=ownerInvoiceUnreadItems;`, context);
  const submitted = [{ _portalUid: 'editor-a', id: 'inv-1', status: '提出済み', version: 1 }];
  assert.equal(context.collect(submitted).length, 1);
  assert.equal(context.collect([{ ...submitted[0], status: '承認済み' }]).length, 0);
  assert.equal(context.collect([{ ...submitted[0], status: '差戻し' }]).length, 0);
  assert.doesNotMatch(owner, /invoiceNotificationRead|owner_invoice_read/);
});

test('the 請求書 sidebar entry shows a red count for invoices waiting on the owner', () => {
  assert.match(owner, /const invoicesPending=c\.id==='videoinvoices'\?ownerInvoiceUnreadItems\(\)\.length:0;/);
  assert.match(owner, /invoicesPending\?`<span class="video-submission-nav-badge" aria-label="未確認の請求書 \$\{invoicesPending\}件">/);
  assert.match(owner, /_ownerPortalBridgeReady\.invoices=true;_ownerPortalInvoiceSyncFailed=false;_notifyOwnerPortalBridge\(\);\s*ownerSyncAppBadge\(\);/);
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
  assert.match(features, /function editorVisibleNotificationCount\(\)\{[\s\S]*?sourceSnapshot\?\.\('editor-case'\)\.ids/);
  assert.match(features, /function syncEditorAppBadge\(\)\{\s*const count=editorVisibleNotificationCount\(\);/);
  const visibleCount = (features.match(/function editorVisibleNotificationCount\(\)\{[\s\S]*?\n  \}\n  function syncEditorAppBadge/) || [''])[0];
  assert.doesNotMatch(visibleCount, /dmUnreadCount\(/);
  assert.match(visibleCount, /sourceSnapshot\?\.\('editor-dm'\)\.ids/);
});

test('the editor app badge counts unread cases and unread DM, deduped by notification ID', () => {
  const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
  const source = features.match(/function editorVisibleNotificationCount\(\)\{[\s\S]*?\n  \}/)?.[0];
  assert.ok(source);
  const { api } = registry();
  api.set('editor-case', [{ notificationId: 'case:job-1:msg-1' }, { notificationId: 'case:job-2:msg-2' }, { notificationId: 'dm:thread-a:1' }]);
  api.set('editor-dm', [{ notificationId: 'dm:thread-a:1' }, { notificationId: 'dm:thread-b:2' }]);
  const context = vm.createContext({
    syncEditorUnreadSources: () => null,
    editorUnreadApi: () => api,
    editorCaseUnreadItems: () => [],
    dmApi: () => null,
    feature: { dmThreads: [] },
    Array, Set, Math, Number, String,
  });
  vm.runInContext(`${source};this.result=editorVisibleNotificationCount();`, context);
  assert.equal(context.result, 4);
});

test('the editor app badge falls back to case plus DM items when the registry is missing', () => {
  const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
  const source = features.match(/function editorVisibleNotificationCount\(\)\{[\s\S]*?\n  \}/)?.[0];
  const context = vm.createContext({
    syncEditorUnreadSources: () => null,
    editorUnreadApi: () => null,
    editorCaseUnreadItems: () => [{ notificationId: 'case:job-1:msg-1' }, { notificationId: 'case:job-2:msg-2' }],
    dmApi: () => ({ unreadItems: () => [{ notificationId: 'dm:thread-a:1' }, { notificationId: 'case:job-1:msg-1' }] }),
    feature: { dmThreads: [] },
    Array, Set, Math, Number, String,
  });
  vm.runInContext(`${source};this.result=editorVisibleNotificationCount();`, context);
  assert.equal(context.result, 3);
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
