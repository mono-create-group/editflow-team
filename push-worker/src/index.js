import { buildPushPayload } from '@block65/webcrypto-web-push';

const MAX_BODY = 4 * 1024;
const MAX_DEVICES = 20;
const MAX_RECIPIENTS = 8;
// A push that is only useful while the phone happens to be awake is the same
// as no push at all.  A day of retry matches the app's own workflow rhythm
// (invoice review, feedback, case chat) without keeping stale hints alive.
const PUSH_TTL_SECONDS = 86400;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_PER_UID = 30;
const TOKEN_AUDIENCE_PREFIX = 'https://securetoken.google.com/';
const DEVICE_APP_PATHS = new Set(['./?notification=1', './editor.html?notification=1']);
const NOTIFY_PATH = '/v1/push/notify';
const DIRECT_THREAD_PATH = '/v1/push/direct-thread';
// Locked-screen text stays categorical.  No name, amount, client, case title,
// or message body is ever encrypted into the payload.
const DIRECT_THREAD_NOTICE = Object.freeze({
  body: '新しい連絡があります。アプリを開いて確認してください。',
  tag: 'editor-dm',
  notificationId: '',
});
const NOTIFY_BODIES = Object.freeze({
  invoice_submitted: '請求書の提出があります。アプリを開いて確認してください。',
  invoice_returned: '請求書の確認結果があります。アプリを開いて確認してください。',
  feedback: 'フィードバックの更新があります。アプリを開いて確認してください。',
  case_message: '案件に新しい連絡があります。アプリを開いて確認してください。',
});
const NOTIFY_KINDS = new Set(Object.keys(NOTIFY_BODIES));
// A caller mistake must not read as a server outage: only these are 4xx.
const CLIENT_ERRORS = new Set(['kind_invalid', 'thread_id_invalid', 'invoice_id_invalid', 'job_id_invalid', 'portal_uid_invalid', 'invoice_scope_invalid']);
const DENIED_ERRORS = new Set(['notify_access_denied', 'thread_access_denied']);
const NOT_FOUND_ERRORS = new Set(['notify_target_not_found', 'thread_not_found']);
let cachedServiceToken = null;
const rateBuckets = new Map();

function json(value, status = 200, origin = '') {
  const headers = new Headers({
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
  });
  if (origin) { headers.set('access-control-allow-origin', origin); headers.set('vary', 'Origin'); }
  return new Response(JSON.stringify(value), { status, headers });
}

function allowedOrigin(request, env) {
  const origin = String(request.headers.get('origin') || '').replace(/\/+$/, '');
  const allowed = String(env.EDITOR_PUSH_ALLOWED_ORIGINS || '').split(',').map((x) => x.trim().replace(/\/+$/, '')).filter(Boolean);
  return origin && allowed.includes(origin) ? origin : '';
}

function configErrors(env) {
  const errors = [];
  if (String(env.FREE_TIER_ONLY || '').toLowerCase() !== 'true') errors.push('FREE_TIER_ONLY_required');
  if (!String(env.FIREBASE_PROJECT_ID || '').trim()) errors.push('FIREBASE_PROJECT_ID_missing');
  if (!String(env.FIREBASE_ADMIN_SA_JSON || '').trim()) errors.push('FIREBASE_ADMIN_SA_JSON_missing');
  if (!/^[A-Za-z0-9_-]{40,200}$/.test(String(env.WEB_PUSH_VAPID_PUBLIC_KEY || ''))) errors.push('WEB_PUSH_VAPID_PUBLIC_KEY_missing');
  if (String(env.WEB_PUSH_VAPID_PRIVATE_KEY || '').length < 32) errors.push('WEB_PUSH_VAPID_PRIVATE_KEY_missing');
  return errors;
}

// Best-effort, isolate-local throttle.  It adds no paid binding and is not a
// durable quota: it exists so a scripted client cannot fan a single signed-in
// account out across every stored device in a loop.
function rateLimited(uid) {
  const now = Date.now();
  const bucket = rateBuckets.get(uid);
  if (!bucket || now - bucket.start >= RATE_LIMIT_WINDOW_MS) {
    if (rateBuckets.size > 500) {
      for (const [key, value] of rateBuckets) if (now - value.start >= RATE_LIMIT_WINDOW_MS) rateBuckets.delete(key);
    }
    rateBuckets.set(uid, { start: now, count: 1 });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT_MAX_PER_UID;
}

// Path traversal and collection escapes are rejected before any Firestore URL
// is built.  `.` and `..` are valid characters but never valid document ids.
function documentId(value) {
  const id = String(value || '');
  if (!/^[A-Za-z0-9_.:@~-]{1,300}$/.test(id) || id === '.' || id === '..') return '';
  return id;
}

function b64urlDecode(value) {
  const raw = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(raw + '='.repeat((4 - (raw.length % 4)) % 4));
  return Uint8Array.from(binary, (x) => x.charCodeAt(0));
}

function parseJwt(token) {
  const pieces = String(token || '').split('.');
  if (pieces.length !== 3 || pieces.some((piece) => !piece)) throw new Error('token_shape_invalid');
  const decode = (piece) => JSON.parse(new TextDecoder().decode(b64urlDecode(piece)));
  // A decode failure must surface as a fixed code.  The raw parser message
  // echoes decoded bytes of the supplied token back into the response body.
  try {
    return { header: decode(pieces[0]), claims: decode(pieces[1]), signingInput: `${pieces[0]}.${pieces[1]}`, signature: b64urlDecode(pieces[2]) };
  } catch (_) {
    throw new Error('token_shape_invalid');
  }
}

async function verifyFirebaseIdToken(request, env) {
  const match = String(request.headers.get('authorization') || '').match(/^Bearer\s+(.+)$/i);
  if (!match) throw new Error('authorization_required');
  const parsed = parseJwt(match[1]);
  if (parsed.header.alg !== 'RS256' || !parsed.header.kid) throw new Error('token_header_invalid');
  const keysResponse = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com', { signal: AbortSignal.timeout(10_000) });
  const keys = await keysResponse.json();
  const jwk = (keys.keys || []).find((key) => key.kid === parsed.header.kid);
  if (!jwk) throw new Error('token_key_missing');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, parsed.signature, new TextEncoder().encode(parsed.signingInput));
  const now = Math.floor(Date.now() / 1000);
  if (!valid || parsed.claims.aud !== env.FIREBASE_PROJECT_ID || parsed.claims.iss !== `${TOKEN_AUDIENCE_PREFIX}${env.FIREBASE_PROJECT_ID}` || !parsed.claims.sub || parsed.claims.exp <= now || parsed.claims.iat > now) throw new Error('token_invalid');
  return { uid: String(parsed.claims.sub), token: match[1] };
}

async function serviceAccessToken(env) {
  if (configErrors(env).length) throw new Error('push_not_ready');
  if (cachedServiceToken && cachedServiceToken.expiresAt - Date.now() > 60_000) return cachedServiceToken.value;
  let account;
  try { account = JSON.parse(env.FIREBASE_ADMIN_SA_JSON); } catch (_) { throw new Error('service_account_invalid'); }
  if (account?.project_id !== env.FIREBASE_PROJECT_ID || typeof account?.client_email !== 'string' || typeof account?.private_key !== 'string') throw new Error('service_account_invalid');
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, '');
  const der = b64urlDecode(pem.replace(/\+/g, '-').replace(/\//g, '_'));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  const unsigned = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const assertion = `${unsigned}.${btoa(String.fromCharCode(...new Uint8Array(signature))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
  const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }), signal: AbortSignal.timeout(10_000) });
  const body = await response.json();
  if (!response.ok || typeof body?.access_token !== 'string') throw new Error('service_account_token_rejected');
  cachedServiceToken = { value: body.access_token, expiresAt: Date.now() + Math.max(60, Math.min(Number(body.expires_in) || 3600, 3600)) * 1000 };
  return cachedServiceToken.value;
}

function firestoreValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('stringValue' in value) return String(value.stringValue || '');
  if ('booleanValue' in value) return value.booleanValue === true;
  if ('integerValue' in value) return Number(value.integerValue || 0);
  if ('arrayValue' in value) return Array.isArray(value.arrayValue?.values) ? value.arrayValue.values.map(firestoreValue) : [];
  if ('mapValue' in value) return Object.fromEntries(Object.entries(value.mapValue?.fields || {}).map(([key, child]) => [key, firestoreValue(child)]));
  return null;
}

function safeDeviceAppPath(value) {
  const appPath = String(value || '');
  return DEVICE_APP_PATHS.has(appPath) ? appPath : '';
}

function recipientDeviceAppPath(value) {
  const appPath = String(value || '');
  // Existing editor subscriptions predate appPath.  They were only created
  // from editor.html, so preserve their route while rejecting any non-empty
  // value outside the current allow-list.
  if (!appPath) return './editor.html?notification=1';
  return safeDeviceAppPath(appPath);
}

async function readDirectThread(env, token, threadId) {
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const database = encodeURIComponent(env.FIRESTORE_DATABASE_ID || '(default)');
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/direct_threads/${encodeURIComponent(threadId)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'thread_not_found' : 'thread_lookup_failed');
  const body = await response.json();
  return firestoreValue({ mapValue: { fields: body.fields || {} } }) || {};
}

function documentsBase(env) {
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const database = encodeURIComponent(env.FIRESTORE_DATABASE_ID || '(default)');
  return `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents`;
}

// Every notify authorization read uses the CALLER's Firebase ID token, so
// Firestore Rules — not this worker — decide whether the caller may act on the
// named portal.  The service account is touched only afterwards.
async function readScopedDocument(env, token, segments) {
  const path = segments.map(encodeURIComponent).join('/');
  const response = await fetch(`${documentsBase(env)}/${path}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 403) throw new Error('notify_access_denied');
  if (response.status === 404) throw new Error('notify_target_not_found');
  if (!response.ok) throw new Error('notify_lookup_failed');
  const body = await response.json();
  return firestoreValue({ mapValue: { fields: body.fields || {} } }) || {};
}

// A one-row list is the cheapest proof that Rules still grant this caller the
// portal scope.  It needs no document id, so a notification does not have to
// echo a record the caller only just created.
async function assertScopedCollection(env, token, segments) {
  const path = segments.map(encodeURIComponent).join('/');
  const response = await fetch(`${documentsBase(env)}/${path}?pageSize=1`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 403) throw new Error('notify_access_denied');
  if (!response.ok) throw new Error('notify_lookup_failed');
  return true;
}

async function queryAccessUids(env, token, where) {
  const response = await fetch(`${documentsBase(env)}:runQuery`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ structuredQuery: { from: [{ collectionId: 'access' }], where, limit: MAX_RECIPIENTS } }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error('owner_lookup_failed');
  const rows = await response.json();
  return (Array.isArray(rows) ? rows : []).map((row) => String(row?.document?.name || '').split('/').pop()).filter(Boolean);
}

// Owner identity matches the app and the Firestore Rules: a configured address
// on the access row, or an explicit `owner: true` flag.  The list of addresses
// lives in wrangler vars, never in a client payload.
async function ownerRecipients(env, serviceToken) {
  const emails = String(env.OWNER_NOTIFY_EMAILS || '').split(',').map((value) => value.trim()).filter(Boolean).slice(0, 10);
  if (!emails.length) throw new Error('owner_emails_not_configured');
  const results = await Promise.allSettled([
    queryAccessUids(env, serviceToken, { fieldFilter: { field: { fieldPath: 'email' }, op: 'IN', value: { arrayValue: { values: emails.map((email) => ({ stringValue: email })) } } } }),
    queryAccessUids(env, serviceToken, { fieldFilter: { field: { fieldPath: 'owner' }, op: 'EQUAL', value: { booleanValue: true } } }),
  ]);
  if (results.every((result) => result.status === 'rejected')) throw new Error('owner_lookup_failed');
  return [...new Set(results.flatMap((result) => (result.status === 'fulfilled' ? result.value : [])))];
}

async function accessRecord(env, token, uid) {
  const response = await fetch(`${documentsBase(env)}/access/${encodeURIComponent(uid)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (response.status === 404) return {};
  if (!response.ok) throw new Error('access_lookup_failed');
  const body = await response.json();
  return firestoreValue({ mapValue: { fields: body.fields || {} } }) || {};
}

// When an editor is the sender, the escalation target is their assigned video
// director if one exists, and the owners otherwise.
async function managerRecipients(env, serviceToken, portalUid) {
  const record = await accessRecord(env, serviceToken, portalUid);
  const directorUid = typeof record.directorUid === 'string' ? record.directorUid.trim() : '';
  if (directorUid && directorUid !== portalUid) return [directorUid];
  return ownerRecipients(env, serviceToken);
}

async function listRecipientDevices(env, token, uid) {
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const database = encodeURIComponent(env.FIRESTORE_DATABASE_ID || '(default)');
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/editor_portals/${encodeURIComponent(uid)}/push_devices?pageSize=${MAX_DEVICES}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error('device_lookup_failed');
  const body = await response.json();
  return (Array.isArray(body.documents) ? body.documents : []).slice(0, MAX_DEVICES).map((doc) => ({
    name: String(doc.name || ''),
    data: firestoreValue({ mapValue: { fields: doc.fields || {} } }) || {},
  })).filter(({ name, data }) => name
    && /^https:\/\//.test(String(data.endpoint || ''))
    && data.keys?.p256dh
    && data.keys?.auth
    && data.permission === 'granted'
    && data.appInstalled === true
    && recipientDeviceAppPath(data.appPath));
}

async function deleteExpiredDevice(token, name) {
  if (!name) return;
  await fetch(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

async function sendWebPushes(env, recipientUid, token, notice = DIRECT_THREAD_NOTICE) {
  const devices = await listRecipientDevices(env, token, recipientUid);
  const vapid = { subject: String(env.WEB_PUSH_VAPID_SUBJECT || ''), publicKey: String(env.WEB_PUSH_VAPID_PUBLIC_KEY || ''), privateKey: String(env.WEB_PUSH_VAPID_PRIVATE_KEY || '') };
  let sent = 0, expired = 0, failed = 0;
  await Promise.all(devices.map(async ({ name, data }) => {
    try {
      // `appPath` is constrained at registration and checked again here.  No
      // thread, case, sender, money, or message content is included in the
      // encrypted payload visible on a locked device.
      const message = {
        data: JSON.stringify({
          title: 'mono.create',
          body: notice.body,
          url: recipientDeviceAppPath(data.appPath),
          tag: notice.tag,
          notificationId: notice.notificationId,
        }),
        options: { ttl: PUSH_TTL_SECONDS },
      };
      const payload = await buildPushPayload(message, { endpoint: data.endpoint, expirationTime: null, keys: data.keys }, vapid);
      const response = await fetch(data.endpoint, { ...payload, signal: AbortSignal.timeout(10_000) });
      if (response.ok) { sent += 1; return; }
      if (response.status === 404 || response.status === 410) { expired += 1; await deleteExpiredDevice(token, name); return; }
      failed += 1;
    } catch (_) { failed += 1; }
  }));
  return { sent, expired, failed, attempted: devices.length };
}

async function directThreadRecipient({ env, actor, threadId }) {
  if (!/^[A-Za-z0-9_-]{1,300}$/.test(threadId)) throw new Error('thread_id_invalid');
  // Read with the caller's Firebase ID token so Firestore Rules re-check the
  // current owner/director/editor relationship.  The service account is used
  // only after this authorization succeeds, to look up the recipient devices.
  const thread = await readDirectThread(env, actor.token, threadId);
  const participants = Array.isArray(thread.participants) ? thread.participants.filter((uid) => typeof uid === 'string' && uid.length <= 128) : [];
  if (participants.length !== 2 || !participants.includes(actor.uid)) throw new Error('thread_access_denied');
  const recipientUid = participants.find((uid) => uid !== actor.uid);
  if (!recipientUid) throw new Error('thread_recipient_missing');
  return recipientUid;
}

async function directThreadPlan({ request, env, body }) {
  const actor = await verifyFirebaseIdToken(request, env);
  const recipientUid = await directThreadRecipient({ env, actor, threadId: String(body?.threadId || '') });
  return { actor, recipients: [recipientUid], notice: DIRECT_THREAD_NOTICE };
}

// The tag collapses repeat deliveries for the same record on the device, and
// the notificationId lets the open app treat the push as a re-sync hint for
// that exact record instead of a blind refresh.
function notifyNotice(kind, referenceId) {
  const reference = String(referenceId || kind);
  return {
    body: NOTIFY_BODIES[kind],
    tag: `editflow-${kind}-${reference}`.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 120),
    notificationId: `${kind}:${reference}`.slice(0, 512),
  };
}

/*
 * Recipients are derived here, never accepted from the caller.  Each branch
 * first proves — with the caller's own ID token — that Firestore Rules still
 * grant that caller the portal/record it names.  A `targetUid` in the request
 * body is deliberately ignored.
 */
async function notifyPlan({ request, env, body }) {
  const actor = await verifyFirebaseIdToken(request, env);
  const kind = String(body?.kind || '');
  if (!NOTIFY_KINDS.has(kind)) throw new Error('kind_invalid');
  const portalUid = documentId(body?.portalUid);
  const jobId = documentId(body?.jobId);
  const invoiceId = documentId(body?.invoiceId);
  let recipients = [];
  let reference = '';

  if (kind === 'invoice_submitted') {
    if (!invoiceId) throw new Error('invoice_id_invalid');
    if (portalUid && portalUid !== actor.uid) throw new Error('invoice_scope_invalid');
    const invoice = await readScopedDocument(env, actor.token, ['editor_portals', actor.uid, 'editor_invoices', invoiceId]);
    if (String(invoice.editorUid || '') !== actor.uid) throw new Error('invoice_scope_invalid');
    recipients = await ownerRecipients(env, await serviceAccessToken(env));
    reference = invoiceId;
  } else if (kind === 'invoice_returned') {
    if (!portalUid) throw new Error('portal_uid_invalid');
    if (!invoiceId) throw new Error('invoice_id_invalid');
    const invoice = await readScopedDocument(env, actor.token, ['editor_portals', portalUid, 'editor_invoices', invoiceId]);
    if (String(invoice.editorUid || '') !== portalUid) throw new Error('invoice_scope_invalid');
    recipients = [portalUid];
    reference = invoiceId;
  } else if (kind === 'feedback') {
    if (!portalUid) throw new Error('portal_uid_invalid');
    await assertScopedCollection(env, actor.token, ['editor_portals', portalUid, 'feedback']);
    // An editor recording their own learning escalates to their reviewer; a
    // reviewer's approval or return goes back down to that editor.
    recipients = actor.uid === portalUid
      ? await managerRecipients(env, await serviceAccessToken(env), portalUid)
      : [portalUid];
    reference = jobId || portalUid;
  } else {
    if (!portalUid) throw new Error('portal_uid_invalid');
    if (!jobId) throw new Error('job_id_invalid');
    const job = await readScopedDocument(env, actor.token, ['editor_portals', portalUid, 'editor_jobs', jobId]);
    const editorUid = documentId(job.editorUid) || portalUid;
    recipients = actor.uid === editorUid
      ? await managerRecipients(env, await serviceAccessToken(env), portalUid)
      : [editorUid];
    reference = jobId;
  }

  const unique = [...new Set(recipients.map((uid) => documentId(uid)).filter(Boolean))].filter((uid) => uid !== actor.uid).slice(0, MAX_RECIPIENTS);
  return { actor, recipients: unique, notice: notifyNotice(kind, reference) };
}

// Exported for the contract tests only.  The Workers runtime uses the default
// export; these named exports add no route and no capability.
export { notifyNotice, documentId, NOTIFY_BODIES, NOTIFY_KINDS, PUSH_TTL_SECONDS, RATE_LIMIT_MAX_PER_UID };

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      if (!origin) return json({ ok: false, error: 'origin_not_allowed' }, 403);
      // A 204 must not carry a body: constructing one throws, which turned
      // every CORS preflight into a 500 and stopped the browser from ever
      // issuing the POST behind it.
      const response = new Response(null, { status: 204, headers: { 'access-control-allow-origin': origin, vary: 'Origin', 'cache-control': 'no-store' } });
      response.headers.set('access-control-allow-methods', 'POST, OPTIONS');
      response.headers.set('access-control-allow-headers', 'authorization, content-type');
      response.headers.set('access-control-max-age', '600');
      return response;
    }
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      const errors = configErrors(env);
      return json({ ok: errors.length === 0, mode: 'fail_closed', errors }, errors.length ? 503 : 200, origin);
    }
    if (!origin) return json({ ok: false, error: 'origin_not_allowed' }, 403);
    const pathname = new URL(request.url).pathname;
    if (request.method !== 'POST' || (pathname !== DIRECT_THREAD_PATH && pathname !== NOTIFY_PATH)) return json({ ok: false, error: 'not_found' }, 404, origin);
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: 'request_too_large' }, 413, origin);
    let body;
    try { body = JSON.parse(text); } catch (_) { return json({ ok: false, error: 'invalid_json' }, 400, origin); }
    try {
      const plan = pathname === NOTIFY_PATH
        ? await notifyPlan({ request, env, body })
        : await directThreadPlan({ request, env, body });
      if (rateLimited(plan.actor.uid)) return json({ ok: false, error: 'rate_limited' }, 429, origin);
      if (!plan.recipients.length) return json({ ok: true, sent: 0, expired: 0, failed: 0, attempted: 0, recipients: 0 }, 200, origin);
      const serviceToken = await serviceAccessToken(env);
      const results = await Promise.all(plan.recipients.map((uid) => sendWebPushes(env, uid, serviceToken, plan.notice)));
      const total = results.reduce((sum, item) => ({
        sent: sum.sent + item.sent,
        expired: sum.expired + item.expired,
        failed: sum.failed + item.failed,
        attempted: sum.attempted + item.attempted,
      }), { sent: 0, expired: 0, failed: 0, attempted: 0 });
      return json({ ok: true, ...total, recipients: plan.recipients.length }, 200, origin);
    } catch (error) {
      const code = String(error?.message || 'push_dispatch_rejected');
      const auth = /authorization|token/.test(code);
      const status = auth ? 401 : DENIED_ERRORS.has(code) ? 403 : NOT_FOUND_ERRORS.has(code) ? 404 : CLIENT_ERRORS.has(code) ? 400 : 503;
      return json({ ok: false, error: code }, status, origin);
    }
  },
};
