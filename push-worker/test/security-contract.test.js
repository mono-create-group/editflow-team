import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import worker from '../src/index.js';

const root = resolve(import.meta.dirname, '..');
const source = readFileSync(resolve(root, 'src/index.js'), 'utf8');
const manifest = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

test('uses Workers-compatible standard Web Push encryption', () => {
  assert.equal(manifest.dependencies['@block65/webcrypto-web-push'], '^1.0.2');
  assert.match(source, /import \{ buildPushPayload \} from '@block65\/webcrypto-web-push'/);
  assert.match(source, /await buildPushPayload\(message, \{ endpoint: data\.endpoint/);
});

test('a caller cannot provide a recipient UID', () => {
  assert.match(source, /verifyFirebaseIdToken\(request, env\)/);
  assert.match(source, /readDirectThread\(env, token, threadId\)/);
  assert.match(source, /readDirectThread\(env, actor\.token, threadId\)/);
  assert.match(source, /participants\.includes\(actor\.uid\)/);
  assert.match(source, /const recipientUid = participants\.find/);
  assert.doesNotMatch(source, /body\?\.recipientUid|body\.recipientUid/);
});

test('expired endpoints are removed and delivery remains bounded and private', () => {
  assert.match(source, /const MAX_DEVICES = 20/);
  assert.match(source, /pageSize=\$\{MAX_DEVICES\}/);
  assert.match(source, /response\.status === 404 \|\| response\.status === 410/);
  assert.match(source, /deleteExpiredDevice\(token, name\)/);
  assert.match(source, /新しい連絡があります。アプリを開いて確認してください。/);
});

test('worker remains free tier and secret-free in tracked configuration', () => {
  const toml = readFileSync(resolve(root, 'wrangler.toml'), 'utf8');
  assert.match(toml, /FREE_TIER_ONLY = "true"/);
  assert.doesNotMatch(toml, /WEB_PUSH_VAPID_PRIVATE_KEY\s*=/);
  assert.match(source, /FIREBASE_ADMIN_SA_JSON_missing/);
});

test('missing deployment secrets fail closed instead of enabling delivery', async () => {
  const response = await worker.fetch(new Request('https://push.example/health'), { FREE_TIER_ONLY: 'true', FIREBASE_PROJECT_ID: 'editflow-mono-create' });
  assert.equal(response.status, 503);
  const body = await response.json();
  assert.equal(body.ok, false);
  assert.ok(body.errors.includes('FIREBASE_ADMIN_SA_JSON_missing'));
});
