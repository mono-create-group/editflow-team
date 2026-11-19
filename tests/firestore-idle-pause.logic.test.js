const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function idleBlock() {
  const start = source.indexOf('// ── 放置タブの接続休止');
  const end = source.indexOf("if(typeof window!=='undefined'&&typeof document!=='undefined'){\n  try{_fbInstallWriteTracker(fbDb);}", start);
  assert.ok(start >= 0 && end > start, 'idle pause block must exist');
  return source.slice(start, end);
}

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

// 実データ(S・localStorage・クラウド)には触れず、使い捨ての文脈だけで検証する。
function makeContext(overrides = {}) {
  const calls = { stop: 0, external: 0, disable: 0, notice: 0, writeBlock: 0, reload: 0, fbSave: 0 };
  const context = {
    Promise, Date, Set, Object, Error, console: { warn() {}, info() {} },
    setTimeout, clearTimeout,
    FB_USER: { uid: 'test-user' },
    _fbIdlePaused: false,
    _fbQuotaReadCircuitOpen: false,
    _fbSaveTimer: null,
    _fbSaveRun: null,
    _fbPersonalSaveInFlight: false,
    _fbPersonalSaveQueued: false,
    _teamSaveInFlight: false,
    _teamSaveQueued: false,
    _invoiceStatusSaving: false,
    _fbQuotaExternalStops: new Set([() => { calls.external += 1; }]),
    _stopRoleSubscriptions() { calls.stop += 1; },
    _fbInstallQuotaWriteBlock() { calls.writeBlock += 1; },
    fbDb: { disableNetwork() { calls.disable += 1; return Promise.resolve(); } },
    fbSave() { calls.fbSave += 1; },
    location: { reload() { calls.reload += 1; } },
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(`${idleBlock()}
    this.api={
      reason:_fbIdleReason,flush:_fbFlushPendingSaves,enter:_fbEnterIdlePause,resume:_fbResumeFromIdle,
      track:_fbTrackWrite,installTracker:_fbInstallWriteTracker,
      setActivity:v=>{_fbIdleLastActivity=v},setHiddenSince:v=>{_fbIdleHiddenSince=v},
      failSeq:()=>_fbWriteFailSeq,pending:()=>_fbPendingWrites.size,
      consts:{hidden:FB_IDLE_HIDDEN_MS,active:FB_IDLE_ACTIVE_MS}
    };
    _fbShowIdlePauseNotice=function(){this.__notice=(this.__notice||0)+1}.bind(this);`, context);
  return { context, calls, api: context.api };
}

test('idle reason: hidden 10 min or no input for 30 min; never while quota-stopped, paused or signed out', () => {
  const { api } = makeContext();
  const base = { now: 100_000_000, hidden: false, hiddenSince: 0, lastActivity: 100_000_000, paused: false, entering: false, quotaOpen: false, signedIn: true };
  assert.equal(api.consts.hidden, 10 * 60 * 1000);
  assert.equal(api.consts.active, 30 * 60 * 1000);
  assert.equal(api.reason(base), '');
  assert.equal(api.reason({ ...base, hidden: true, hiddenSince: base.now - 9 * 60 * 1000 }), '');
  assert.equal(api.reason({ ...base, hidden: true, hiddenSince: base.now - 10 * 60 * 1000 }), 'hidden');
  assert.equal(api.reason({ ...base, lastActivity: base.now - 29 * 60 * 1000 }), '');
  assert.equal(api.reason({ ...base, lastActivity: base.now - 30 * 60 * 1000 }), 'inactive');
  const idle = { ...base, lastActivity: 0, hidden: true, hiddenSince: 1 };
  assert.equal(api.reason({ ...idle, quotaOpen: true }), '');
  assert.equal(api.reason({ ...idle, paused: true }), '');
  assert.equal(api.reason({ ...idle, entering: true }), '');
  assert.equal(api.reason({ ...idle, signedIn: false }), '');
});

test('flush runs the delayed save immediately and waits for queued follow-up saves', async () => {
  let runs = 0;
  const { context, api } = makeContext();
  context._fbSaveTimer = setTimeout(() => assert.fail('timer must be replaced by the immediate run'), 60_000);
  context._fbSaveRun = () => {
    runs += 1;
    context._fbSaveTimer = null; context._fbSaveRun = null;
    if (runs === 1) {
      // 1回目の保存中に後続が積まれ、finally が再び遅延保存を張る流れを再現する。
      context._fbPersonalSaveInFlight = true;
      setTimeout(() => {
        context._fbPersonalSaveInFlight = false;
        context._fbSaveRun = () => { runs += 1; context._fbSaveTimer = null; context._fbSaveRun = null; };
        context._fbSaveTimer = setTimeout(() => assert.fail('follow-up must also run immediately'), 60_000);
      }, 20);
    }
  };
  assert.equal(await api.flush(3000), true);
  assert.equal(runs, 2);
  assert.equal(context._fbSaveTimer, null);
});

test('flush reports failure when a tracked write rejects, and when saves never settle', async () => {
  const failing = makeContext();
  failing.context._fbSaveRun = () => {
    failing.context._fbSaveTimer = null;
    failing.api.track(Promise.reject(new Error('offline')));
  };
  failing.context._fbSaveTimer = setTimeout(() => {}, 60_000);
  assert.equal(await failing.api.flush(3000), false);
  assert.equal(failing.api.failSeq(), 1);
  assert.equal(failing.api.pending(), 0);

  const stuck = makeContext({ _teamSaveInFlight: true });
  assert.equal(await stuck.api.flush(200), false);

  const quota = makeContext({ _fbQuotaReadCircuitOpen: true });
  assert.equal(await quota.api.flush(200), false);
});

test('entering idle pause stops listeners, blocks writes and disables the network only after a clean flush', async () => {
  const { context, calls, api } = makeContext();
  api.setActivity(Date.now() - 31 * 60 * 1000);
  assert.equal(await api.enter('inactive'), true);
  assert.equal(context._fbIdlePaused, true);
  assert.deepEqual([calls.writeBlock, calls.stop, calls.external, calls.disable], [1, 1, 1, 1]);
  assert.equal(context.__notice, 1);
  // 2回目は何もしない
  assert.equal(await api.enter('inactive'), false);
  assert.equal(calls.disable, 1);
});

test('a failed flush keeps the tab connected, keeps data, and retries the save next time', async () => {
  const { context, calls, api } = makeContext();
  api.setActivity(Date.now() - 31 * 60 * 1000);
  context._fbSaveTimer = setTimeout(() => {}, 60_000);
  context._fbSaveRun = () => { context._fbSaveTimer = null; api.track(Promise.reject(new Error('network'))); };
  assert.equal(await api.enter('inactive'), false);
  assert.equal(context._fbIdlePaused, false);
  assert.deepEqual([calls.stop, calls.disable, calls.writeBlock], [0, 0, 0]);
  // 次の判定では保存を再実行してから休止する
  assert.equal(await api.enter('inactive'), true);
  assert.equal(calls.fbSave, 1);
});

test('quota stop takes precedence, and user activity during the flush cancels the pause', async () => {
  const quota = makeContext({ _fbQuotaReadCircuitOpen: true });
  quota.api.setActivity(0);
  assert.equal(await quota.api.enter('inactive'), false);
  assert.equal(quota.calls.disable, 0);

  const busy = makeContext({ _teamSaveInFlight: true });
  busy.api.setActivity(Date.now() - 31 * 60 * 1000);
  setTimeout(() => { busy.api.setActivity(Date.now() + 1); busy.context._teamSaveInFlight = false; }, 30);
  assert.equal(await busy.api.enter('inactive'), false);
  assert.equal(busy.context._fbIdlePaused, false);
  assert.equal(busy.calls.disable, 0);
});

test('resume always reloads instead of re-enabling the network', () => {
  const { context, calls, api } = makeContext({ _fbIdlePaused: true });
  api.resume(); api.resume();
  assert.equal(calls.reload, 1);
  assert.doesNotMatch(idleBlock().replace(/^\s*\/\/.*$/gm, ''), /enableNetwork/);
  assert.equal(context._fbIdlePaused, true);
});

test('write tracker wraps every write primitive without changing results', async () => {
  class Doc { set(){return Promise.resolve('s')} update(){return Promise.reject(new Error('u'))} delete(){return Promise.resolve('d')} }
  class Collection { doc(){return new Doc()} add(){return Promise.resolve('a')} }
  class Batch { commit(){return Promise.resolve('c')} }
  class Db { collection(){return new Collection()} batch(){return new Batch()} runTransaction(){return Promise.resolve('t')} }
  const { api } = makeContext();
  const db = new Db();
  assert.equal(api.installTracker(db), true);
  assert.equal(await db.collection('x').doc('y').set({}), 's');
  await assert.rejects(db.collection('x').doc('y').update({}));
  assert.equal(await db.collection('x').add({}), 'a');
  assert.equal(await db.batch().commit(), 'c');
  assert.equal(await db.runTransaction(() => {}), 't');
  await new Promise(r => setTimeout(r, 0));
  assert.equal(api.failSeq(), 1);
  assert.equal(api.pending(), 0);
});

test('paused tabs never rewrite local state and every write gate honours the pause', () => {
  assert.match(functionSource('_lsSaveState'), /^function _lsSaveState\(obj\)\{\n[^\n]*\n  if\(_fbIdlePaused\)return false;/);
  assert.match(functionSource('save'), /^function save\(\)\{\n  if\(_fbIdlePaused\)return;/);
  assert.match(functionSource('_fbInstallQuotaWriteBlock'), /if\(_fbQuotaReadCircuitOpen\|\|_fbIdlePaused\)return Promise\.reject/);
  assert.match(source, /writeAllowed:\(\)=>!_fbQuotaReadCircuitOpen&&!_fbIdlePaused/);
  assert.match(source, /if\(_fbQuotaReadCircuitOpen\|\|_fbIdlePaused\)\{try\{stop\(\)\}catch\(_\)\{\}\}/);
  // 休止は quota 停止のフラグ・クールダウンを立てない(再読み込み後に再接続できるように)
  const block = idleBlock();
  assert.doesNotMatch(block, /_fbQuotaBlocked=true|_fbQuotaReadCircuitOpen=true|_fbCooldown/);
  assert.doesNotMatch(block, /_lsSaveState/);
  assert.doesNotMatch(functionSource('_fbEnterQuotaReadCircuit'), /_fbIdlePaused/);
  // 遅延保存は従来どおり2秒で、休止前の即時実行用に本体を残す
  assert.match(functionSource('fbSave'), /_fbSaveTimer=setTimeout\(_fbSaveRun=\(\)=>\{\n    _fbSaveTimer=null;_fbSaveRun=null;/);
});
