const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const index = read('index.html');
const editor = read('editor.html');
const manager = read('manager-features.js');
const direct = read('direct-messages.js');

test('owner and editor pages expose the same quota stop contract', () => {
  assert.match(index, /EditflowFirestoreQuota=Object\.freeze\(\{[\s\S]*handle:[\s\S]*registerStop:[\s\S]*isOpen:/);
  assert.match(editor, /EditflowFirestoreQuota=\{handle:portalEnterQuotaCircuit,registerStop:portalRegisterQuotaStop,isOpen:/);
  assert.match(index, /_fbQuotaExternalStops\.forEach/);
  assert.match(editor, /portalQuotaStops\.forEach/);
});

test('manager listeners route quota errors and cannot restart after the circuit opens', () => {
  const listeners = (manager.match(/\.onSnapshot\(/g) || []).length;
  const routed = (manager.match(/=>quotaSnapshotError\(/g) || []).length;
  assert.equal(routed, listeners, 'all manager listener errors must enter the quota circuit');
  assert.match(manager, /registerStop\?\.\(stop\)/);
  assert.match(manager, /isOpen\?\.\(\)\|\|!FB_USER/);
});

test('DM watches are tracked, stopped, and do not restart while quota is blocked', () => {
  assert.match(direct, /registerStop\?\.\(stopAllWatches\)/);
  assert.match(direct, /return trackedStop\(/);
  assert.match(direct, /quotaWatchError\(error, 'threads'\)/);
  assert.match(direct, /quotaWatchError\(error, 'messages'\)/);
  assert.match(direct, /EditflowFirestoreQuota\?\.isOpen\?\.\(\)/);
});
