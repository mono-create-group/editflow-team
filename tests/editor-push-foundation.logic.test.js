const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const client = fs.readFileSync(path.join(root, 'editor-push.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');
const worker = fs.readFileSync(path.join(root, 'push-worker', 'src', 'index.js'), 'utf8');
const workerToml = fs.readFileSync(path.join(root, 'push-worker', 'wrangler.toml'), 'utf8');
const editorFeatures = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const owner = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('push registration is unavailable until secure installed client, permission, and server config exist', () => {
  assert.match(client, /function supported\(\)/);
  assert.match(client, /function isInstalled\(\)/);
  assert.match(client, /if \(requiresInstalledApp\(\) && !result\.installed\)/);
  assert.match(client, /if \(!result\.configured\)/);
  assert.match(client, /if \(!active\.enabled\) throw new Error\('push_server_not_ready'\)/);
  assert.match(client, /Notification\.requestPermission\(\)/);
});

test('editor device subscription is private and self-owned in Firestore', () => {
  assert.match(rules, /match \/push_devices\/\{deviceId\}/);
  assert.match(rules, /function pushDeviceOwner\(uid\)/);
  assert.match(rules, /return self\(uid\) && \(owner\(\)/);
  assert.match(rules, /allow create: if pushDeviceOwner\(uid\)/);
  assert.match(rules, /request\.resource\.data\.deviceId == deviceId/);
  assert.match(rules, /request\.resource\.data\.keys\.keys\(\)\.hasOnly\(\['p256dh','auth'\]\)/);
  assert.match(rules, /'appPath','platform'/);
  assert.match(rules, /'\.\/\?notification=1', '\.\/editor\.html\?notification=1'/);
  assert.match(rules, /allow delete: if pushDeviceOwner\(uid\)/);
  assert.match(rules, /allow read: if pushDeviceOwner\(uid\)/);
});

test('service worker receives privacy-safe push, badges the app, and opens the registered app route', () => {
  assert.match(sw, /self\.addEventListener\('push'/);
  assert.match(sw, /Specific DM\/case content is/);
  assert.match(sw, /self\.navigator\?\.setAppBadge\?\.\(badgeCount\)/);
  assert.match(sw, /client\.postMessage\(\{type:'editflow-push-received',badgeCount\}\)/);
  assert.match(sw, /self\.addEventListener\('notificationclick'/);
  assert.match(sw, /new URL\(client\.url\)\.pathname===absolute\.pathname/);
  assert.match(sw, /clients\.openWindow\(absolute\.href\)/);
});

test('dedicated worker stays free tier and rejects recipient-selected dispatch', () => {
  assert.match(workerToml, /FREE_TIER_ONLY = "true"/);
  assert.match(worker, /function configErrors\(env\)/);
  assert.match(worker, /FIREBASE_ADMIN_SA_JSON_missing/);
  assert.match(worker, /WEB_PUSH_VAPID_PRIVATE_KEY_missing/);
  assert.match(worker, /verifyFirebaseIdToken/);
  assert.match(worker, /directThreadRecipient/);
  assert.doesNotMatch(worker, /body\?\.recipientUid|body\.recipientUid/);
  assert.match(worker, /const recipientUid = participants\.find/);
  assert.match(worker, /buildPushPayload/);
  assert.match(worker, /const recipientUid = participants\.find/);
});

test('unread counts use a local app badge without adding Firestore writes', () => {
  assert.match(client, /async function syncBadge\(count\)/);
  assert.match(client, /navigator\?\.setAppBadge/);
  assert.match(client, /navigator\?\.clearAppBadge/);
  assert.match(client, /async function pendingBadgeCount\(\)/);
  assert.match(client, /reg\.getNotifications\(\)/);
  assert.match(editorFeatures, /function editorUnreadBadgeCount\(\)/);
  assert.match(editorFeatures, /window\.EditorPush\?\.syncBadge\?\.\(count\)/);
  assert.match(editorFeatures, /feature\.dmThreads=incoming;feature\.dmLoading=false;feature\.dmError='';syncEditorAppBadge\(\)/);
  assert.match(owner, /function ownerSyncAppBadge\(\)/);
  assert.match(owner, /pendingCount:0/);
  assert.match(owner, /window\.addEventListener\('editflow-push-received'/);
  assert.match(owner, /await api\.pendingBadgeCount\?\.\(\)/);
  assert.match(owner, /OWNER_DM_STATE\.threads=Array\.isArray\(threads\)\?threads:\[\];OWNER_DM_STATE\.error='';OWNER_PUSH_STATE\.pendingCount=0;ownerSyncAppBadge\(\)/);
});

test('notification taps open the matching DM page before the unread snapshot is loaded', () => {
  const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
  assert.match(owner, /new URLSearchParams\(location\.search\)\.get\('notification'\)==='1'\?'directmessages'/);
  assert.match(editor, /view=PAGE_PARAMS\.get\('notification'\)==='1'\?'dm':'dashboard'/);
  const renderStart = owner.indexOf('function render(){');
  const authWait = owner.indexOf('if(!_authSettled){', renderStart);
  const accessWait = owner.indexOf('if(FB_USER&&!ACCESS_RESOLVED)', renderStart);
  const roleGuard = owner.indexOf('if(!isViewAllowed(V))', renderStart);
  assert.ok(renderStart >= 0 && authWait > renderStart && authWait < accessWait && authWait < roleGuard);
  const authWaitEnd = owner.indexOf('if(FB_USER&&!ACCESS_RESOLVED)', authWait);
  assert.doesNotMatch(owner.slice(authWait, authWaitEnd), /sessionStorage\.setItem\('ef_team_view'/);
});

test('desktop browsers can register notifications while iPhone still requires a Home Screen app', () => {
  assert.match(client, /function requiresInstalledApp\(\)/);
  assert.match(client, /function appPath\(\)/);
  assert.match(client, /appPath: appPath\(\)/);
  assert.match(client, /if \(requiresInstalledApp\(\) && !result\.installed\)/);
  assert.match(client, /if \(requiresInstalledApp\(\) && !isInstalled\(\)\) throw new Error\('push_install_required'\)/);
  assert.match(editorFeatures, /PC・スマホでDMや案件の新着に気づけるようにします/);
  assert.match(owner, /PCはブラウザ通知を許可します/);
});

test('existing device registration adds the new route without rewriting immutable createdAt', () => {
  assert.match(client, /const existing = await ref\.get\(\)/);
  assert.match(client, /ref\.set\(existing\.exists \? data : \{ \.\.\.data, createdAt: Date\.now\(\) \}, \{ merge: true \}\)/);
  assert.doesNotMatch(client, /deviceRef\(db, uid\)\.set\(\{ \.\.\.data, createdAt: Date\.now\(\) \}/);
});
