import { buildPushPayload } from '@block65/webcrypto-web-push';

const MAX_BODY = 4 * 1024;
const MAX_DEVICES = 20;
const TOKEN_AUDIENCE_PREFIX = 'https://securetoken.google.com/';
let cachedServiceToken = null;

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

function b64urlDecode(value) {
  const raw = String(value).replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(raw + '='.repeat((4 - (raw.length % 4)) % 4));
  return Uint8Array.from(binary, (x) => x.charCodeAt(0));
}

function parseJwt(token) {
  const pieces = String(token || '').split('.');
  if (pieces.length !== 3 || pieces.some((piece) => !piece)) throw new Error('token_shape_invalid');
  const decode = (piece) => JSON.parse(new TextDecoder().decode(b64urlDecode(piece)));
  return { header: decode(pieces[0]), claims: decode(pieces[1]), signingInput: `${pieces[0]}.${pieces[1]}`, signature: b64urlDecode(pieces[2]) };
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

async function readDirectThread(env, token, threadId) {
  const project = encodeURIComponent(env.FIREBASE_PROJECT_ID);
  const database = encodeURIComponent(env.FIRESTORE_DATABASE_ID || '(default)');
  const response = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/direct_threads/${encodeURIComponent(threadId)}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(response.status === 404 ? 'thread_not_found' : 'thread_lookup_failed');
  const body = await response.json();
  return firestoreValue({ mapValue: { fields: body.fields || {} } }) || {};
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
  })).filter(({ name, data }) => name && /^https:\/\//.test(String(data.endpoint || '')) && data.keys?.p256dh && data.keys?.auth && data.permission === 'granted' && data.appInstalled === true);
}

async function deleteExpiredDevice(token, name) {
  if (!name) return;
  await fetch(`https://firestore.googleapis.com/v1/${name}`, { method: 'DELETE', headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

async function sendWebPushes(env, recipientUid, token) {
  const devices = await listRecipientDevices(env, token, recipientUid);
  const vapid = { subject: String(env.WEB_PUSH_VAPID_SUBJECT || ''), publicKey: String(env.WEB_PUSH_VAPID_PUBLIC_KEY || ''), privateKey: String(env.WEB_PUSH_VAPID_PRIVATE_KEY || '') };
  const message = { data: JSON.stringify({ title: 'mono.create', body: '新しい連絡があります。アプリを開いて確認してください。', url: './editor.html?notification=1', tag: 'editor-dm' }), options: { ttl: 60 } };
  let sent = 0, expired = 0, failed = 0;
  await Promise.all(devices.map(async ({ name, data }) => {
    try {
      const payload = await buildPushPayload(message, { endpoint: data.endpoint, expirationTime: null, keys: data.keys }, vapid);
      const response = await fetch(data.endpoint, { ...payload, signal: AbortSignal.timeout(10_000) });
      if (response.ok) { sent += 1; return; }
      if (response.status === 404 || response.status === 410) { expired += 1; await deleteExpiredDevice(token, name); return; }
      failed += 1;
    } catch (_) { failed += 1; }
  }));
  return { sent, expired, failed, attempted: devices.length };
}

async function directThreadRecipient({ request, env, threadId }) {
  const actor = await verifyFirebaseIdToken(request, env);
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

export default {
  async fetch(request, env) {
    const origin = allowedOrigin(request, env);
    if (request.method === 'OPTIONS') {
      if (!origin) return json({ ok: false, error: 'origin_not_allowed' }, 403);
      const response = json({}, 204, origin);
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
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/v1/push/direct-thread') return json({ ok: false, error: 'not_found' }, 404, origin);
    const text = await request.text();
    if (text.length > MAX_BODY) return json({ ok: false, error: 'request_too_large' }, 413, origin);
    let body;
    try { body = JSON.parse(text); } catch (_) { return json({ ok: false, error: 'invalid_json' }, 400, origin); }
    try {
      const recipientUid = await directThreadRecipient({ request, env, threadId: String(body?.threadId || '') });
      const result = await sendWebPushes(env, recipientUid, await serviceAccessToken(env));
      return json({ ok: true, ...result }, 200, origin);
    } catch (error) {
      const code = String(error?.message || 'push_dispatch_rejected');
      const auth = /authorization|token/.test(code);
      return json({ ok: false, error: code }, auth ? 401 : 503, origin);
    }
  },
};
