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

test('push registration is unavailable until secure installed client, permission, and server config exist', () => {
  assert.match(client, /function supported\(\)/);
  assert.match(client, /function isInstalled\(\)/);
  assert.match(client, /if \(!result\.installed\)/);
  assert.match(client, /if \(!result\.configured\)/);
  assert.match(client, /if \(!active\.enabled\) throw new Error\('push_server_not_ready'\)/);
  assert.match(client, /Notification\.requestPermission\(\)/);
});

test('editor device subscription is private and self-owned in Firestore', () => {
  assert.match(rules, /match \/push_devices\/\{deviceId\}/);
  assert.match(rules, /allow create: if editor\(uid\)/);
  assert.match(rules, /request\.resource\.data\.deviceId == deviceId/);
  assert.match(rules, /request\.resource\.data\.keys\.keys\(\)\.hasOnly\(\['p256dh','auth'\]\)/);
  assert.match(rules, /allow delete: if editor\(uid\)/);
  assert.match(rules, /allow read: if portalManager\(uid\) \|\| editor\(uid\)/);
});

test('service worker receives privacy-safe push and returns to the editor portal on tap', () => {
  assert.match(sw, /self\.addEventListener\('push'/);
  assert.match(sw, /Specific DM\/case content is/);
  assert.match(sw, /self\.addEventListener\('notificationclick'/);
  assert.match(sw, /clients\.openWindow\(target\)/);
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
