const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(root, 'sw.js'), 'utf8');

function sourceBetween(name, next) {
  const start = index.indexOf(`function ${name}`);
  const end = index.indexOf(`function ${next}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return index.slice(start, end);
}

test('quota classifier catches Firestore resource exhaustion without matching ordinary failures', () => {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(sourceBetween('_fbIsQuotaError', '_fbFailClosed') + '\nthis.isQuota = _fbIsQuotaError;', context);
  assert.equal(context.isQuota({ code: 'resource-exhausted' }), true);
  assert.equal(context.isQuota({ message: 'Quota exceeded.' }), true);
  assert.equal(context.isQuota({ code: 'permission-denied' }), false);
});

test('personal saves are locally safe, coalesced, and stop after a quota failure', () => {
  const source = sourceBetween('fbSave', '_packState');
  assert.match(source, /_teamSave\(\);\s*if\(_fbQuotaBlocked\)return;/);
  assert.match(source, /if\(_fbPersonalSaveInFlight\)\{_fbPersonalSaveQueued=true;return;\}/);
  assert.match(source, /if\(initialPayload===_fbPersonalLastPayload\)return;/);
  assert.match(source, /_fbFailClosed\(e,'personal'\)/);
  assert.match(source, /if\(queued&&!_fbQuotaBlocked\)fbSave\(\)/);
  assert.match(index, /function _personalCloudState\(source\)/);
  assert.match(index, /const EXCL=\{bizBoard:1,_savedAt:1\}/);
});

test('shared writes and lead shards are payload-deduplicated and quota fail-closed', () => {
  const source = sourceBetween('_teamSave', 'fbSetupTeamSync');
  assert.match(source, /if\(!FB_USER\|\|TEAM_SHARE_OK===false\|\|_fbQuotaBlocked\)return;/);
  assert.match(source, /_slShardsSave\(\);/);
  assert.match(source, /const payloadSignature=JSON\.stringify\(data\);/);
  assert.match(source, /if\(payloadSignature===_teamLastPayload\)return;/);
  assert.match(source, /if\(_teamSaveInFlight\)\{_teamSaveQueued=true;return;\}/);
  assert.match(source, /_fbFailClosed\(e,'team share'\)/);
  assert.match(source, /if\(queued&&!_fbQuotaBlocked\)_teamSave\(\)/);
  const shards = sourceBetween('_slShardsSave', '_stampTeamChanges');
  assert.match(shards, /\|\|_fbQuotaBlocked\)return;/);
  assert.match(shards, /if\(!_slCloudLoaded\)return;/);
  assert.match(shards, /_fbFailClosed\(e,'leads shard'\)/);
});

test('first successful snapshots seed no-op baselines without hiding local changes', () => {
  const personalSync = sourceBetween('fbSetupRealtimeSync', '_teamEncode');
  assert.match(personalSync, /_fbPersonalLastPayload='';/);
  assert.match(personalSync, /_fbPersonalLastPayload=_packPersonalState\(_personalCloudState\(_decodePersonalState\(doc\.data\(\)\.json_mcapp\)\)\)/);
  assert.match(personalSync, /if\(localTs>cloudTs\+1000\)\{\s*fbSave\(\)/);

  const teamSync = sourceBetween('fbSetupTeamSync', '_registerSignin');
  assert.match(teamSync, /_teamLastPayload=_teamCloudBaseline\(d\)/);
  assert.match(teamSync, /if\(!doc\.exists\)\{_teamCloudLoaded=true;_schedulePortalLegacySync\(\);_teamSave\(\);return;\}/);
  const baseline = sourceBetween('_teamCloudBaseline', 'fbSetupTeamSync');
  assert.match(baseline, /\(S\[k\]\|\|\[\]\)\.length\?_teamEncode\(k,\[\]\)/);
});

test('lead shards wait for all initial snapshots and preserve a pre-sync local delta', () => {
  const teamSync = sourceBetween('fbSetupTeamSync', '_registerSignin');
  assert.match(teamSync, /_slShardLoaded=Array\(SL_SHARD_N\)\.fill\(false\)/);
  assert.match(teamSync, /_slInitialRemoteShards=Array\(SL_SHARD_N\)\.fill\(null\)/);
  assert.match(teamSync, /_slShardLoaded\[i\]=true/);
  assert.match(teamSync, /_slInitialRemoteShards\[i\]=remote/);
  assert.match(teamSync, /if\(!_slCloudLoaded&&_slShardLoaded\.every\(Boolean\)\)/);
  assert.match(teamSync, /const remoteBaseline=_slInitialRemoteShards\.reduce/);
  assert.match(teamSync, /_slShardJson=_slLeadSignature\(remoteBaseline\)/);
  assert.match(teamSync, /if\(_slLeadSignature\(S\.salesLeads\|\|\[\]\)!==_slShardJson\)_slShardsSave\(\)/);
});

test('lead signature ignores asynchronous shard arrival order', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(sourceBetween('_slLeadSignature', '_slEncodeShard') + '\nthis.signature = _slLeadSignature;', context);
  const first = [{ id: 'lead-10', updatedAt: 2 }, { id: 'lead-2', updatedAt: 1 }];
  assert.equal(context.signature(first), context.signature([...first].reverse()));
  assert.notEqual(context.signature(first), context.signature([{ id: 'lead-10', updatedAt: 3 }, first[1]]));
});

test('sign-in presence is touched at most once per day unless identity changes', () => {
  const source = sourceBetween('_registerSignin', 'signInWithGoogle');
  assert.match(source, /const identityChanged=/);
  assert.match(source, /if\(!isNew&&!identityChanged&&now-Number\(r\.lastSeen\|\|0\)<86400000\)return;/);
  assert.match(source, /r\.lastSeen=now/);
});

test('quota notice never claims shared ledgers were safely cached on the device', () => {
  const notice = sourceBetween('_fbShowQuotaMaintenanceNotice', 'retryFirestoreAfterQuota');
  assert.match(notice, /共有案件・顧客・進捗の保存状況は確認できません/);
  assert.match(notice, /再読み込みして再接続/);
  assert.doesNotMatch(notice, /共有.*保存済み/);
});

test('service worker cache and app version are bumped together', () => {
  assert.match(index, /const APP_VERSION='20260902-07';/);
  assert.match(sw, /const CACHE='mcshanai-20260902-07';/);
});
