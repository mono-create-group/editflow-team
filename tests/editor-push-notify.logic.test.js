const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const clientSource = fs.readFileSync(path.join(root, 'editor-push.js'), 'utf8');
const feedbackSource = fs.readFileSync(path.join(root, 'feedback-workflow.js'), 'utf8');

const ENDPOINT = 'https://push.example.workers.dev';
const VAPID = 'B'.repeat(87);

function memoryStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => { store.set(key, String(value)); },
    removeItem: (key) => { store.delete(key); },
    _store: store,
  };
}

/*
 * `editor-push.js` is an IIFE over `window`.  Loading it into a fresh vm
 * context per case gives real branch coverage of status()/dispatchNotify()
 * without a browser, and without letting one case's localStorage leak into
 * the next.
 */
function loadClient(overrides = {}) {
  const context = {
    isSecureContext: true,
    location: { hostname: 'mono-create-group.github.io', pathname: '/editflow-team/editor.html' },
    navigator: { userAgent: 'Mozilla/5.0 (Macintosh)', serviceWorker: {}, platform: 'MacIntel' },
    matchMedia: () => ({ matches: false }),
    PushManager: function PushManager() {},
    Notification: { permission: 'granted', requestPermission: async () => 'granted' },
    localStorage: memoryStorage(),
    crypto: { getRandomValues: (bytes) => { bytes.forEach((_, index) => { bytes[index] = index + 1; }); return bytes; } },
    btoa: (value) => Buffer.from(value, 'binary').toString('base64'),
    atob: (value) => Buffer.from(value, 'base64').toString('binary'),
    fetch: async () => { throw new Error('fetch not stubbed'); },
    EDITOR_PUSH_CONFIG: { enabled: true, endpoint: ENDPOINT, vapidPublicKey: VAPID },
    console,
    ...overrides,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(clientSource, context);
  return context;
}

function pushRegistration(context, { subscription = null, storedDevice = false } = {}) {
  context.navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => subscription, subscribe: async () => subscription } }) };
  return {
    db: {
      collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: storedDevice }) }) }) }) }),
    },
    uid: 'editor-1',
  };
}

test('status reports a machine reason and a separate Japanese message for every blocked state', async () => {
  const unsupported = loadClient({ PushManager: undefined });
  const blocked = await unsupported.EditorPush.status({});
  assert.equal(blocked.reason, 'unsupported');
  assert.equal(blocked.message, unsupported.EditorPush.reasonMessages.unsupported);

  const denied = loadClient({ Notification: { permission: 'denied' } });
  assert.equal((await denied.EditorPush.status({})).reason, 'permission_denied');

  const prompt = loadClient({ Notification: { permission: 'default' } });
  assert.equal((await prompt.EditorPush.status({})).reason, 'permission_default');

  const unconfigured = loadClient({ EDITOR_PUSH_CONFIG: { enabled: false, endpoint: '', vapidPublicKey: '' } });
  assert.equal((await unconfigured.EditorPush.status({})).reason, 'server_not_ready');

  const ready = loadClient();
  const options = pushRegistration(ready, { subscription: { endpoint: 'https://push.example/x' }, storedDevice: true });
  const ok = await ready.EditorPush.status(options);
  assert.deepEqual({ reason: ok.reason, ready: ok.ready }, { reason: 'ok', ready: true });

  const partial = loadClient();
  const partialOptions = pushRegistration(partial, { subscription: null, storedDevice: false });
  assert.equal((await partial.EditorPush.status(partialOptions)).reason, 'not_subscribed');

  const broken = loadClient();
  broken.navigator.serviceWorker = { ready: Promise.reject(new Error('offline')) };
  assert.equal((await broken.EditorPush.status({})).reason, 'unknown');
});

test('an iPhone is told to install, and after one standalone launch is told to re-open the installed app', async () => {
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)', serviceWorker: {} };
  const fresh = loadClient({ navigator: { ...iphone } });
  const first = await fresh.EditorPush.status({});
  assert.equal(first.reason, 'ios_not_installed');
  assert.match(first.message, /ホーム画面に追加/);

  const seen = memoryStorage();
  const installed = loadClient({ navigator: { ...iphone, standalone: true }, localStorage: seen });
  pushRegistration(installed, { subscription: { endpoint: 'https://push.example/x' }, storedDevice: true });
  assert.equal((await installed.EditorPush.status({ })).reason, 'not_subscribed');
  assert.equal(seen.getItem('mc_editor_push_install_seen'), '1');

  const reopened = loadClient({ navigator: { ...iphone }, localStorage: seen });
  const again = await reopened.EditorPush.status({});
  assert.equal(again.reason, 'ios_open_from_home');
  assert.match(again.message, /開き直す/);
});

test('dispatchNotify names a record, never a recipient, and reports failures instead of throwing', async () => {
  const context = loadClient();
  const calls = [];
  context.fetch = async (url, init) => {
    calls.push({ url, init });
    return { ok: true, status: 200, json: async () => ({ ok: true, sent: 2, recipients: 2 }) };
  };
  const result = await context.EditorPush.dispatchNotify({
    kind: 'invoice_submitted', invoiceId: 'inv-1', portalUid: 'editor-1',
    targetUid: 'attacker', body: 'secret amount', idToken: 'token-1',
  });
  assert.deepEqual({ ok: result.ok, sent: result.sent }, { ok: true, sent: 2 });
  assert.equal(calls[0].url, `${ENDPOINT}/v1/push/notify`);
  assert.equal(calls[0].init.headers.authorization, 'Bearer token-1');
  const sentBody = JSON.parse(calls[0].init.body);
  assert.deepEqual(sentBody, { kind: 'invoice_submitted', portalUid: 'editor-1', invoiceId: 'inv-1' });
  assert.ok(!('targetUid' in sentBody) && !('body' in sentBody));
});

test('dispatchNotify refuses an unknown kind, a missing token, and an unconfigured server without throwing', async () => {
  const context = loadClient();
  context.fetch = async () => { throw new Error('should not be called'); };
  const outcome = (result) => ({ ok: result.ok, reason: result.reason });
  assert.deepEqual(outcome(await context.EditorPush.dispatchNotify({ kind: 'made_up', idToken: 't' })), { ok: false, reason: 'push_kind_invalid' });
  assert.deepEqual(outcome(await context.EditorPush.dispatchNotify({ kind: 'feedback' })), { ok: false, reason: 'push_dispatch_input_invalid' });

  const offline = loadClient();
  offline.fetch = async () => { throw new Error('network down'); };
  assert.deepEqual(outcome(await offline.EditorPush.dispatchNotify({ kind: 'feedback', portalUid: 'editor-1', idToken: 't' })), { ok: false, reason: 'push_dispatch_unreachable' });

  const rejected = loadClient();
  rejected.fetch = async () => ({ ok: false, status: 403, json: async () => ({ ok: false, error: 'notify_access_denied' }) });
  assert.deepEqual(outcome(await rejected.EditorPush.dispatchNotify({ kind: 'feedback', portalUid: 'editor-1', idToken: 't' })), { ok: false, reason: 'notify_access_denied' });

  const unconfigured = loadClient({ EDITOR_PUSH_CONFIG: { enabled: false, endpoint: '', vapidPublicKey: '' } });
  assert.deepEqual(outcome(await unconfigured.EditorPush.dispatchNotify({ kind: 'feedback', portalUid: 'x', idToken: 't' })), { ok: false, reason: 'push_server_not_ready' });
});

test('ensureSubscribed re-registers a dropped endpoint silently and never prompts for permission', async () => {
  const already = loadClient();
  const readyOptions = pushRegistration(already, { subscription: { endpoint: 'https://push.example/x' }, storedDevice: true });
  const unchanged = await already.EditorPush.ensureSubscribed(readyOptions);
  assert.equal(unchanged.reason, 'ok');

  let prompted = false;
  const prompt = loadClient({ Notification: { permission: 'default', requestPermission: async () => { prompted = true; return 'granted'; } } });
  pushRegistration(prompt, { subscription: null, storedDevice: false });
  const skipped = await prompt.EditorPush.ensureSubscribed({ uid: 'editor-1' });
  assert.equal(skipped.reason, 'permission_default');
  assert.equal(prompted, false);

  const recovered = loadClient();
  const writes = [];
  const subscription = { endpoint: 'https://push.example/new', toJSON: () => ({ endpoint: 'https://push.example/new', keys: { p256dh: 'p'.repeat(40), auth: 'a'.repeat(20) } }) };
  // The browser subscription and the Firestore device row are tracked apart:
  // the worker deleted the row, so the client must write a fresh one.
  let subscribed = false;
  let deviceRow = false;
  recovered.navigator.serviceWorker = { ready: Promise.resolve({ pushManager: { getSubscription: async () => (subscribed ? subscription : null), subscribe: async () => { subscribed = true; return subscription; } } }) };
  const db = { collection: () => ({ doc: () => ({ collection: () => ({ doc: () => ({ get: async () => ({ exists: deviceRow }), set: async (data) => { writes.push(data); deviceRow = true; } }) }) }) }) };
  const restored = await recovered.EditorPush.ensureSubscribed({ db, uid: 'editor-1' });
  assert.equal(restored.reason, 'ok');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].appPath, './editor.html?notification=1');
  assert.equal(typeof writes[0].createdAt, 'number');
});

test('feedback submit and review notify the other side without being able to fail the saved record', () => {
  assert.match(feedbackSource, /async function notifyPush\(kind,payload\)/);
  assert.match(feedbackSource, /api\.dispatchNotify\(\{\.\.\.payload,kind,idToken:await user\.getIdToken\(\)\}\)/);
  assert.match(feedbackSource, /if\(!result\?\.ok\)toast\('相手への通知は届かなかった可能性があります'\)/);
  assert.match(feedbackSource, /notifyPush\('feedback',\{portalUid:uid,jobId:open\.job\.id\}\);\s*\n?\s*return true;/);
  assert.match(feedbackSource, /notifyPush\('feedback',\{portalUid:String\(portalId\),jobId:row\.jobId\}\);return true/);
  // The push is fired after the transaction resolves and is never awaited into
  // the try/catch that decides whether the write itself succeeded.
  assert.doesNotMatch(feedbackSource, /await notifyPush\(/);
});

test('the client keeps offering only the two registered app routes and no caller-chosen URL', () => {
  assert.match(clientSource, /const NOTIFY_KINDS = \['invoice_submitted', 'invoice_returned', 'feedback', 'case_message'\]/);
  assert.doesNotMatch(clientSource, /options\?\.targetUid|options\.targetUid|targetUid:/);
  assert.match(clientSource, /\['portalUid', 'jobId', 'invoiceId', 'threadId'\]\.forEach/);
  assert.match(clientSource, /function appPath\(\)/);
});
