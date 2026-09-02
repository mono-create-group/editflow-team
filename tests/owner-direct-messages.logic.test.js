const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');
const page = source.slice(source.indexOf('// === オーナー用社内DM ==='), source.indexOf('function rEditorPortal()'));

test('owner navigation exposes a direct-message page in the video workspace', () => {
  assert.match(source, /\{id:'directmessages',label:'DM',icon:'💬'\}/);
  assert.match(source, /views:\['editorportal','videoedit','videosubmissions','videohaken','videoclients','workers','videoschedules','videomanuals','videofeedback','videoperformance','videoinvoices','directmessages','videosuggestions'\]/);
  assert.match(source, /directmessages:rOwnerDirectMessages/);
  assert.match(source, /if\(v==='directmessages'\)return false/);
  assert.match(source, /<script src="\.\/direct-messages\.js\?v=20260902-12"><\/script>/);
});

test('owner DM reuses the guarded shared data layer for peers, threads, history, send, and read receipts', () => {
  for (const name of ['loadPeers', 'watch', 'watchMessages', 'send', 'markRead']) {
    assert.match(page, new RegExp(`api\\.${name}\\(`), `${name} must use EditflowDM instead of a parallel Firestore path`);
  }
  assert.match(page, /ownerDmWriteBlocked\(\)/);
  assert.match(page, /_fbQuotaReadCircuitOpen\|\|window\.EditflowFirestoreQuota\?\.isOpen\?\.\(\)/);
  assert.match(page, /デモ・確認モードではDMを送信できません/);
  assert.match(page, /ownerDmStop\(true\)/);
});

test('DM unread stays current globally while peer and message reads stay on the DM route', () => {
  assert.match(page, /if\(!api\|\|!_isOwner\(\)\|\|!FB_USER\|\|ownerDmIsDemo\(\)\|\|ownerDmReadBlocked\(\)\)return;/);
  assert.match(page, /function ownerDmReadBlocked\(\)\{return !!\(_fbQuotaReadCircuitOpen\|\|window\.EditflowFirestoreQuota\?\.isOpen\?\.\(\)\);\}/);
  assert.match(page, /function ownerDmLoadPeers\(\)\{[\s\S]*?V!=='directmessages'/);
  assert.match(page, /if\(!api\|\|V!=='directmessages'\|\|!id\|\|ownerDmIsDemo\(\)\|\|ownerDmReadBlocked\(\)\)return;/);
  assert.match(source, /if\(_isOwner\(\)&&typeof ownerDmEnsureStyles==='function'\)\{ownerDmEnsureStyles\(\);ownerDmStart\(\);ownerSyncAppBadge\(\);\}/);
  assert.match(source, /if\(V==='directmessages'&&view!=='directmessages'&&typeof ownerDmStopMessages==='function'\)ownerDmStopMessages\(\);/);
  assert.match(page, /if\(V==='directmessages'\)\{[\s\S]*?ownerDmWatchMessages/);
  assert.match(source, /try\{if\(V==='directmessages'\)render\(\);else renderNav\(\);\}/);
});

test('DM peer IDs are carried as HTML data, not interpolated into executable JavaScript', () => {
  assert.match(page, /data-owner-dm-peer="\$\{esc\(String\(peer\.uid\)\)\}"/);
  assert.match(page, /onclick="ownerDmOpenPeerFromEvent\(event\)"/);
  assert.match(page, /function ownerDmOpenPeerFromEvent\(event\)\{/);
  assert.doesNotMatch(page, /onclick="ownerDmOpenPeer\('\$\{esc\(peer\.uid\)\}'\)"/);
});

test('owner DM styling is available when the navigation is rendered and demo mode has no dead return action', () => {
  assert.match(source, /if\(_isOwner\(\)&&typeof ownerDmEnsureStyles==='function'\)\{ownerDmEnsureStyles\(\);ownerDmStart\(\);ownerSyncAppBadge\(\);\}/);
  assert.match(page, /const returnButton=_rolePreviewActive\(\)\?/);
  assert.match(page, /通常のオーナー画面でDMを開いてください/);
});

test('DM has an unread badge and does not render project or billing amounts', () => {
  assert.match(page, /function ownerDmUnreadCount\(\)/);
  assert.match(source, /owner-dm-nav-badge/);
  assert.match(page, /案件・クライアント・請求の金額はこのDMには表示しません/);
  assert.doesNotMatch(page, /unitPrice|editorPayAmount|clientUnitPrice|profit|invoiceAmount/);
});
