import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import worker, { notifyNotice, documentId, NOTIFY_BODIES, PUSH_TTL_SECONDS, RATE_LIMIT_MAX_PER_UID } from '../src/index.js';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/index.js'), 'utf8');

const PROJECT = 'editflow-mono-create';
const ORIGIN = 'https://mono-create-group.github.io';
const DOCUMENTS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const OWNER_EMAILS = 'owner-a@example.com,owner-b@example.com';
const encoder = new TextEncoder();
const b64url = (bytes) => Buffer.from(bytes).toString('base64url');

/*
 * The harness signs a genuine RS256 ID token and serves the matching JWK, so
 * `verifyFirebaseIdToken` runs its real signature check.  Nothing here weakens
 * or bypasses the worker's own authorization: only the network is faked.
 */
async function harness() {
  const rsa = { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' };
  const signer = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
  const serviceAccount = await crypto.subtle.generateKey(rsa, true, ['sign', 'verify']);
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const device = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const publicJwk = { ...(await crypto.subtle.exportKey('jwk', signer.publicKey)), kid: 'test-kid' };
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', serviceAccount.privateKey);
  const vapidPrivate = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const env = {
    FREE_TIER_ONLY: 'true',
    FIREBASE_PROJECT_ID: PROJECT,
    FIRESTORE_DATABASE_ID: '(default)',
    EDITOR_PUSH_ALLOWED_ORIGINS: ORIGIN,
    OWNER_NOTIFY_EMAILS: OWNER_EMAILS,
    WEB_PUSH_VAPID_SUBJECT: 'mailto:push@example.com',
    WEB_PUSH_VAPID_PUBLIC_KEY: b64url(await crypto.subtle.exportKey('raw', vapid.publicKey)),
    WEB_PUSH_VAPID_PRIVATE_KEY: String(vapidPrivate.d),
    FIREBASE_ADMIN_SA_JSON: JSON.stringify({
      project_id: PROJECT,
      client_email: 'push@example.iam.gserviceaccount.com',
      private_key: `-----BEGIN PRIVATE KEY-----\n${Buffer.from(pkcs8).toString('base64')}\n-----END PRIVATE KEY-----\n`,
    }),
  };
  return {
    env,
    publicJwk,
    signerKey: signer.privateKey,
    devicePublicKey: b64url(await crypto.subtle.exportKey('raw', device.publicKey)),
  };
}

async function signIdToken(key, uid) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(encoder.encode(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'test-kid' })));
  const claims = b64url(encoder.encode(JSON.stringify({
    aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: uid, iat: now - 30, exp: now + 3600,
  })));
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, encoder.encode(`${header}.${claims}`));
  return `${header}.${claims}.${b64url(new Uint8Array(signature))}`;
}

function firestoreDocument(name, fields) {
  return { name: `projects/${PROJECT}/databases/(default)/documents/${name}`, fields };
}

function deviceFields(devicePublicKey) {
  return {
    endpoint: { stringValue: 'https://push.example/endpoint' },
    keys: { mapValue: { fields: { p256dh: { stringValue: devicePublicKey }, auth: { stringValue: b64url(new Uint8Array(16)) } } } },
    permission: { stringValue: 'granted' },
    appInstalled: { booleanValue: true },
    appPath: { stringValue: './editor.html?notification=1' },
  };
}

// `documents` maps a Firestore document path to its fields; anything absent is
// answered with 404 so an unauthorized-looking read cannot silently succeed.
function installFetch(kit, { documents = {}, denied = [], owners = ['owner-a'], devicesFor = [], pushStatus = 201, log }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url || input);
    log?.push({ url, method: init.method || 'GET', body: init.body });
    if (url.includes('securetoken@system.gserviceaccount.com')) return Response.json({ keys: [kit.publicJwk] });
    if (url.startsWith('https://oauth2.googleapis.com/token')) return Response.json({ access_token: 'service-token', expires_in: 3600 });
    if (url.startsWith('https://push.example/')) return new Response('', { status: pushStatus });
    if (url === `${DOCUMENTS}:runQuery`) {
      return Response.json(owners.map((uid) => ({ document: firestoreDocument(`access/${uid}`, { email: { stringValue: 'owner-a@example.com' } }) })));
    }
    const path = url.slice(`${DOCUMENTS}/`.length).split('?')[0];
    if (denied.includes(path)) return Response.json({ error: { status: 'PERMISSION_DENIED' } }, { status: 403 });
    if (path.endsWith('/push_devices')) {
      const uid = path.split('/')[1];
      return Response.json({ documents: devicesFor.includes(uid) ? [{ name: `${DOCUMENTS}/${path}/device-1`, fields: deviceFields(kit.devicePublicKey) }] : [] });
    }
    if (path.endsWith('/feedback')) return Response.json({ documents: [] });
    if (documents[path]) return Response.json(firestoreDocument(path, documents[path]));
    return Response.json({ error: { status: 'NOT_FOUND' } }, { status: 404 });
  };
  return () => { globalThis.fetch = original; };
}

function notifyRequest(token, body) {
  return new Request('https://push.example.workers.dev/v1/push/notify', {
    method: 'POST',
    headers: { origin: ORIGIN, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

test('notify derives owner recipients for a submitted invoice and ignores a caller-supplied target', async () => {
  const kit = await harness();
  const token = await signIdToken(kit.signerKey, 'editor-1');
  const log = [];
  const restore = installFetch(kit, {
    log,
    documents: { 'editor_portals/editor-1/editor_invoices/inv-1': { editorUid: { stringValue: 'editor-1' } } },
    owners: ['owner-a'],
    devicesFor: ['owner-a'],
  });
  try {
    const response = await worker.fetch(notifyRequest(token, { kind: 'invoice_submitted', invoiceId: 'inv-1', targetUid: 'attacker-uid' }), kit.env);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual({ ok: body.ok, sent: body.sent, recipients: body.recipients }, { ok: true, sent: 1, recipients: 1 });
    const devicePaths = log.filter((entry) => entry.url.includes('/push_devices')).map((entry) => entry.url);
    assert.equal(devicePaths.length, 1);
    assert.ok(devicePaths[0].includes('/editor_portals/owner-a/push_devices'));
    assert.ok(!log.some((entry) => entry.url.includes('attacker-uid')));
  } finally { restore(); }
});

test('notify refuses an invoice claimed under somebody else\'s portal', async () => {
  const kit = await harness();
  const token = await signIdToken(kit.signerKey, 'editor-1');
  const restore = installFetch(kit, { documents: {} });
  try {
    const scoped = await worker.fetch(notifyRequest(token, { kind: 'invoice_submitted', portalUid: 'editor-2', invoiceId: 'inv-1' }), kit.env);
    assert.equal(scoped.status, 400);
    assert.equal((await scoped.json()).error, 'invoice_scope_invalid');
    const denied = await worker.fetch(notifyRequest(token, { kind: 'invoice_returned', portalUid: 'editor-2', invoiceId: 'inv-9' }), kit.env);
    assert.equal(denied.status, 404);
    assert.equal((await denied.json()).error, 'notify_target_not_found');
  } finally { restore(); }
});

test('notify rejects a traversal-shaped identifier and an unknown kind before any Firestore read', async () => {
  const kit = await harness();
  const token = await signIdToken(kit.signerKey, 'editor-1');
  const log = [];
  const restore = installFetch(kit, { log });
  try {
    const traversal = await worker.fetch(notifyRequest(token, { kind: 'case_message', portalUid: '../access', jobId: 'job-1' }), kit.env);
    assert.equal(traversal.status, 400);
    assert.equal((await traversal.json()).error, 'portal_uid_invalid');
    const unknown = await worker.fetch(notifyRequest(token, { kind: 'anything_goes', portalUid: 'editor-1' }), kit.env);
    assert.equal(unknown.status, 400);
    assert.equal((await unknown.json()).error, 'kind_invalid');
    assert.ok(!log.some((entry) => entry.url.startsWith(DOCUMENTS)));
  } finally { restore(); }
});

test('a portal read that Firestore Rules deny becomes a 403 rather than a delivery', async () => {
  const kit = await harness();
  const token = await signIdToken(kit.signerKey, 'stranger');
  const restore = installFetch(kit, { denied: ['editor_portals/editor-1/feedback'] });
  try {
    const response = await worker.fetch(notifyRequest(token, { kind: 'feedback', portalUid: 'editor-1' }), kit.env);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).error, 'notify_access_denied');
  } finally { restore(); }
});

test('a case message escalates to the assigned director and comes back down to the editor', async () => {
  const kit = await harness();
  const log = [];
  const restore = installFetch(kit, {
    log,
    documents: {
      'editor_portals/editor-1/editor_jobs/job-1': { editorUid: { stringValue: 'editor-1' } },
      'access/editor-1': { directorUid: { stringValue: 'director-9' } },
    },
    devicesFor: ['director-9', 'editor-1'],
  });
  try {
    const fromEditor = await worker.fetch(notifyRequest(await signIdToken(kit.signerKey, 'editor-1'), { kind: 'case_message', portalUid: 'editor-1', jobId: 'job-1' }), kit.env);
    assert.equal((await fromEditor.json()).sent, 1);
    assert.ok(log.some((entry) => entry.url.includes('/editor_portals/director-9/push_devices')));
    log.length = 0;
    const fromManager = await worker.fetch(notifyRequest(await signIdToken(kit.signerKey, 'director-9'), { kind: 'case_message', portalUid: 'editor-1', jobId: 'job-1' }), kit.env);
    assert.equal((await fromManager.json()).sent, 1);
    assert.ok(log.some((entry) => entry.url.includes('/editor_portals/editor-1/push_devices')));
    assert.ok(!log.some((entry) => entry.url.includes('/editor_portals/director-9/push_devices')));
  } finally { restore(); }
});

test('an editor without a director escalates to the configured owner accounts only', async () => {
  const kit = await harness();
  const log = [];
  const restore = installFetch(kit, {
    log,
    documents: { 'editor_portals/editor-1/editor_jobs/job-2': { editorUid: { stringValue: 'editor-1' } } },
    owners: ['owner-a', 'owner-b'],
    devicesFor: ['owner-a', 'owner-b'],
  });
  try {
    const response = await worker.fetch(notifyRequest(await signIdToken(kit.signerKey, 'editor-1'), { kind: 'case_message', portalUid: 'editor-1', jobId: 'job-2' }), kit.env);
    const body = await response.json();
    assert.deepEqual({ recipients: body.recipients, sent: body.sent }, { recipients: 2, sent: 2 });
    const query = log.find((entry) => entry.url.endsWith(':runQuery'));
    assert.ok(String(query.body).includes('owner-a@example.com') && String(query.body).includes('owner-b@example.com'));
  } finally { restore(); }
});

test('an expired push endpoint deletes the stored device instead of retrying it', async () => {
  const kit = await harness();
  const log = [];
  const restore = installFetch(kit, {
    log,
    pushStatus: 410,
    documents: { 'editor_portals/editor-3/editor_invoices/inv-3': { editorUid: { stringValue: 'editor-3' } } },
    devicesFor: ['owner-a'],
  });
  try {
    const response = await worker.fetch(notifyRequest(await signIdToken(kit.signerKey, 'editor-3'), { kind: 'invoice_submitted', invoiceId: 'inv-3' }), kit.env);
    const body = await response.json();
    assert.deepEqual({ sent: body.sent, expired: body.expired }, { sent: 0, expired: 1 });
    assert.ok(log.some((entry) => entry.method === 'DELETE' && entry.url.includes('/push_devices/device-1')));
  } finally { restore(); }
});

test('delivery uses a one-day TTL so a sleeping phone still receives the push', async () => {
  const kit = await harness();
  const log = [];
  const restore = installFetch(kit, {
    log,
    documents: { 'editor_portals/editor-4/editor_invoices/inv-4': { editorUid: { stringValue: 'editor-4' } } },
    devicesFor: ['owner-a'],
  });
  try {
    await worker.fetch(notifyRequest(await signIdToken(kit.signerKey, 'editor-4'), { kind: 'invoice_submitted', invoiceId: 'inv-4' }), kit.env);
    assert.equal(PUSH_TTL_SECONDS, 86400);
    assert.match(source, /options: \{ ttl: PUSH_TTL_SECONDS \}/);
    assert.doesNotMatch(source, /ttl: 60/);
  } finally { restore(); }
});

test('one signed-in account cannot loop the endpoint without being throttled', async () => {
  const kit = await harness();
  const token = await signIdToken(kit.signerKey, 'editor-flood');
  const restore = installFetch(kit, {
    documents: { 'editor_portals/editor-flood/editor_invoices/inv-f': { editorUid: { stringValue: 'editor-flood' } } },
    devicesFor: ['owner-a'],
  });
  try {
    let throttled = 0;
    for (let attempt = 0; attempt <= RATE_LIMIT_MAX_PER_UID + 1; attempt += 1) {
      const response = await worker.fetch(notifyRequest(token, { kind: 'invoice_submitted', invoiceId: 'inv-f' }), kit.env);
      if (response.status === 429) throttled += 1;
    }
    assert.ok(throttled >= 1);
  } finally { restore(); }
});

test('notification tags and ids are derived from the kind and record, never from caller text', () => {
  assert.deepEqual(notifyNotice('feedback', 'job-1'), {
    body: NOTIFY_BODIES.feedback,
    tag: 'editflow-feedback-job-1',
    notificationId: 'feedback:job-1',
  });
  assert.equal(notifyNotice('case_message', 'job/../x').tag, 'editflow-case_message-job----x');
  assert.equal(notifyNotice('invoice_returned', '').notificationId, 'invoice_returned:invoice_returned');
  assert.ok(notifyNotice('invoice_submitted', 'x'.repeat(400)).tag.length <= 120);
  Object.values(NOTIFY_BODIES).forEach((body) => {
    assert.ok(body.includes('アプリを開いて確認してください'));
    assert.ok(!/[0-9]|円|様/.test(body));
  });
});

test('identifier validation keeps collection escapes out of every Firestore path', () => {
  assert.equal(documentId('abc_123-XY'), 'abc_123-XY');
  ['', '.', '..', 'a/b', '../access', 'a?b', 'a b', 'x'.repeat(301)].forEach((value) => {
    assert.equal(documentId(value), '', `expected ${JSON.stringify(value)} to be rejected`);
  });
});

test('the CORS preflight both routes depend on returns a bodyless 204 instead of throwing', async () => {
  const kit = await harness();
  const preflight = (path, origin) => worker.fetch(new Request(`https://push.example.workers.dev${path}`, { method: 'OPTIONS', headers: { origin } }), kit.env);
  for (const path of ['/v1/push/notify', '/v1/push/direct-thread']) {
    const response = await preflight(path, ORIGIN);
    assert.equal(response.status, 204);
    assert.equal(response.body, null);
    assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
    assert.equal(response.headers.get('access-control-allow-headers'), 'authorization, content-type');
    assert.equal(await response.text(), '');
  }
  assert.equal((await preflight('/v1/push/notify', 'https://evil.example')).status, 403);
});

test('the notify route accepts no recipient field and reuses the existing origin gate', () => {
  assert.doesNotMatch(source, /body\?\.targetUid|body\.targetUid|recipientUid: body/);
  assert.match(source, /if \(!origin\) return json\(\{ ok: false, error: 'origin_not_allowed' \}, 403\)/);
  assert.match(source, /pathname !== DIRECT_THREAD_PATH && pathname !== NOTIFY_PATH/);
  assert.match(source, /readScopedDocument\(env, actor\.token/);
  assert.match(source, /assertScopedCollection\(env, actor\.token/);
  assert.doesNotMatch(source, /readScopedDocument\(env, serviceToken|assertScopedCollection\(env, serviceToken/);
});
