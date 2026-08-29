const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function functionSource(name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; opened = true; }
    if (source[i] === '}' && opened && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name} must have a complete body`);
}

test('quota read circuit unsubscribes once, pauses network, and preserves the current UI state', async () => {
  let stopCount = 0;
  let saveCount = 0;
  let disableCount = 0;
  let noticeCount = 0;
  let writeBlockCount = 0;
  const context = {
    Promise,
    console: { warn() {} },
    S: { draft: 'keep this visible' },
    _lsSaveState() { saveCount += 1; return true; },
    _stopRoleSubscriptions() { stopCount += 1; },
    fbDb: { disableNetwork() { disableCount += 1; return Promise.resolve(); } },
    _fbShowQuotaMaintenanceNotice() { noticeCount += 1; },
    _fbInstallQuotaWriteBlock() { writeBlockCount += 1; },
    _fbQuotaBlocked: false,
    _fbQuotaNoticeShown: false,
    _fbQuotaReadCircuitOpen: false,
    _fbQuotaExternalStops: new Set(),
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource('_fbIsQuotaError')}\n${functionSource('_fbEnterQuotaReadCircuit')}\nthis.enter = _fbEnterQuotaReadCircuit;`, context);
  assert.equal(context.enter({ code: 'resource-exhausted' }, 'team'), true);
  assert.equal(context.enter({ message: 'Quota exceeded' }, 'team'), true);
  await Promise.resolve();
  assert.equal(stopCount, 1);
  assert.equal(saveCount, 1);
  assert.equal(disableCount, 1);
  assert.equal(noticeCount, 1);
  assert.equal(writeBlockCount, 1);
  assert.equal(context.S.draft, 'keep this visible');
});

test('every realtime listener sends errors through the read circuit and retry is explicit only', () => {
  const listeners = (source.match(/\.onSnapshot\(/g) || []).length;
  const routed = (source.match(/_fbHandleSnapshotError\(/g) || []).length - 1; // helper declaration
  assert.equal(routed, listeners, 'all onSnapshot error callbacks must route through the circuit');
  const retry = functionSource('retryFirestoreAfterQuota');
  assert.match(retry, /location\.assign\(/);
  assert.doesNotMatch(retry, /enableNetwork|setTimeout|setInterval/);
  assert.match(source, /controllerchange',[\s\S]{0,100}if\(_fbQuotaReadCircuitOpen\)return/);
  const circuit = functionSource('_fbEnterQuotaReadCircuit');
  assert.match(circuit, /_stopRoleSubscriptions\(\)/);
  assert.match(circuit, /fbDb\.disableNetwork\(\)/);
  assert.match(circuit, /_lsSaveState\(S\)/);
  assert.match(circuit, /_fbInstallQuotaWriteBlock\(\)/);
});

test('maintenance notice never claims a shared write was saved', () => {
  const notice = functionSource('_fbShowQuotaMaintenanceNotice');
  assert.match(notice, /共有案件・顧客・進捗の保存状況は確認できません/);
  assert.match(notice, /再読み込みして再接続/);
  assert.doesNotMatch(notice, /共有.*保存済み/);
});

test('quota circuit blocks every low-level Firestore write primitive', () => {
  const guard = functionSource('_fbInstallQuotaWriteBlock');
  assert.match(guard, /\['set','update','delete'\]/);
  assert.match(guard, /guard\(collection,'add'\)/);
  assert.match(guard, /guard\(batch,'commit'\)/);
  assert.match(guard, /guard\(fbDb,'runTransaction'\)/);
  assert.match(guard, /_fbQuotaReadCircuitOpen/);
  assert.match(source, /writeAllowed:\(\)=>!_fbQuotaReadCircuitOpen/);
});

test('low-level guard rejects writes before the SDK can enqueue them', async () => {
  let touches = 0;
  class Doc { set(){touches+=1;return Promise.resolve()} update(){touches+=1;return Promise.resolve()} delete(){touches+=1;return Promise.resolve()} }
  class Collection { doc(){return new Doc()} add(){touches+=1;return Promise.resolve()} }
  class Batch { commit(){touches+=1;return Promise.resolve()} }
  class Db { collection(){return new Collection()} batch(){return new Batch()} runTransaction(){touches+=1;return Promise.resolve()} }
  const context={Promise,Object,Error,console:{warn(){}},fbDb:new Db(),_fbQuotaReadCircuitOpen:true,_fbQuotaWriteBlockInstalled:false};
  vm.createContext(context);
  vm.runInContext(`${functionSource('_fbQuotaWriteError')}\n${functionSource('_fbInstallQuotaWriteBlock')}\nthis.install=_fbInstallQuotaWriteBlock;`,context);
  context.install();
  await assert.rejects(context.fbDb.collection('x').doc('y').set({}));
  await assert.rejects(context.fbDb.collection('x').doc('y').update({}));
  await assert.rejects(context.fbDb.collection('x').doc('y').delete());
  await assert.rejects(context.fbDb.collection('x').add({}));
  await assert.rejects(context.fbDb.batch().commit());
  await assert.rejects(context.fbDb.runTransaction(()=>{}));
  assert.equal(touches,0);
});
