const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  let depth = 0, opened = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; opened = true; }
    if (source[i] === '}' && opened && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${name} must close`);
}

test('editor quota contract stops registered portal, feature, and DM listeners once before pausing network', async () => {
  let stopped = 0, drafts = 0, disable = 0, notice = 0;
  const context = {
    Promise,
    console: { warn() {} },
    window: { dispatchEvent() {} }, Event: function Event() {},
    db: { disableNetwork() { disable += 1; return Promise.resolve(); } },
    portalQuotaCircuitOpen: false, portalQuotaNoticeShown: false, portalQuotaWriteBlockInstalled: false, portalQuotaStops: new Set(),
    portalSaveVisibleDrafts() { drafts += 1; },
    portalQuotaNotice() { notice += 1; },
  };
  vm.createContext(context);
  vm.runInContext(`${functionSource(editor, 'portalIsQuotaError')}\n${functionSource(editor, 'portalBlockFirestoreWritePrimitives')}\n${functionSource(editor, 'portalEnterQuotaCircuit')}\nthis.enter=portalEnterQuotaCircuit;`, context);
  context.portalQuotaStops.add(() => { stopped += 1; });
  context.portalQuotaStops.add(() => { stopped += 1; });
  assert.equal(context.enter({ code: 'resource-exhausted' }, 'DM'), true);
  assert.equal(context.enter({ message: 'Quota exceeded' }, 'DM'), true);
  await Promise.resolve();
  assert.equal(stopped, 2);
  assert.equal(drafts, 1);
  assert.equal(disable, 1);
  assert.equal(notice, 1);
});

test('all editor and feature snapshot errors route to the shared quota circuit', () => {
  const editorListeners = (editor.match(/\.onSnapshot\(/g) || []).length;
  const editorRoutes = (editor.match(/portalSnapshotError\(e,/g) || []).length;
  assert.equal(editorRoutes, editorListeners);
  const featureListeners = (features.match(/\.onSnapshot\(/g) || []).length;
  const featureRoutes = (features.match(/portalReadError\(e,/g) || []).length;
  assert.equal(featureRoutes, featureListeners);
  assert.match(editor, /window\.EditflowFirestoreQuota=\{handle:portalEnterQuotaCircuit,registerStop:portalRegisterQuotaStop,isOpen:\(\)=>portalQuotaCircuitOpen,writeAllowed:\(\)=>!portalQuotaCircuitOpen\}/);
  assert.match(editor, /if\(portalQuotaCircuitOpen\)\{try\{fn\(\)\}/);
  assert.match(functionSource(editor, 'startPortal'), /if\(portalQuotaCircuitOpen\)return/);
  assert.match(features, /EditflowFirestoreQuota\?\.registerStop/);
  assert.match(features, /EditflowFirestoreQuota\?\.isOpen\?\.\(\)/);
  assert.match(features, /stopFeatures\(\)/);
  assert.match(features, /PORTAL_APP_VERSION='20260829-14'/);
});

test('editor quota recovery only exposes an explicit reload path and never claims cloud data was saved', () => {
  const retry = functionSource(editor, 'retryPortalFirestoreAfterQuota');
  const notice = functionSource(editor, 'portalQuotaNotice');
  assert.match(retry, /location\.assign\(/);
  assert.doesNotMatch(retry, /enableNetwork|setTimeout|setInterval/);
  assert.match(notice, /案件・進捗・DMの保存状況は確認できません/);
  assert.match(notice, /再読み込みして再接続/);
  assert.doesNotMatch(notice, /保存済み/);
});

test('quota-open editor writes are blocked before Firestore or Drive work can start', () => {
  assert.match(editor, /function portalWriteBlocked\(\)\{if\(!portalQuotaCircuitOpen\)return false;toast\('クラウド接続停止中。再読み込み後に操作してください'\)/);
  assert.match(editor, /function portalBlockFirestoreWritePrimitives\(\)/);
  assert.match(editor, /\['set','update','delete'\]/);
  assert.match(editor, /guard\(collection,'add'\)/);
  assert.match(editor, /guard\(batch,'commit'\)/);
  assert.match(editor, /guard\(db,'runTransaction'\)/);
  for (const name of [
    'requestAccess', 'createJob', 'saveJobProgress', 'saveDisplayName', 'saveProfile',
    'draftInvoice', 'draftManualInvoice', 'persistInvoiceFile', 'saveGeneratedInvoice',
    'uploadInvoiceFile', 'submitInvoice', 'createRevision',
  ]) assert.match(editor, new RegExp(`${name}=portalGuardWrite\\(${name}\\)`));
  for (const name of [
    'completeEditorDelivery', 'saveGroupEditorDraftDate', 'createDispatchJob', 'claimBoardJob',
    'sendJobMessage', 'saveAvailability', 'markManualRead', 'submitSuggestion',
    'sendDirectMessage', 'markAllDirectMessagesRead', 'enableEditorPushNotifications',
    'disableEditorPushNotifications',
  ]) assert.match(features, new RegExp(`${name}=guardPortalFeatureWrite\\(${name}\\)`));
  assert.match(functionSource(features, 'refreshEditorPushStatus'), /EditflowFirestoreQuota\?\.isOpen\?\.\(\)/);
  assert.match(features, /function portalFeatureWriteBlocked\(\)/);
  assert.match(features, /クラウド接続停止中。再読み込み後に操作してください/);
});

test('editor low-level quota guard rejects every Firestore write primitive before enqueue', async () => {
  let touches=0;
  class Doc{set(){touches+=1;return Promise.resolve()}update(){touches+=1;return Promise.resolve()}delete(){touches+=1;return Promise.resolve()}}
  class Collection{doc(){return new Doc()}add(){touches+=1;return Promise.resolve()}}
  class Batch{commit(){touches+=1;return Promise.resolve()}}
  class Db{collection(){return new Collection()}batch(){return new Batch()}runTransaction(){touches+=1;return Promise.resolve()}}
  const context={Promise,Object,Error,console:{warn(){}},db:new Db(),portalQuotaCircuitOpen:true,portalQuotaWriteBlockInstalled:false};
  vm.createContext(context);
  vm.runInContext(`${functionSource(editor,'portalBlockFirestoreWritePrimitives')}\nthis.install=portalBlockFirestoreWritePrimitives`,context);
  context.install();
  await assert.rejects(context.db.collection('x').doc('y').set({}));
  await assert.rejects(context.db.collection('x').doc('y').update({}));
  await assert.rejects(context.db.collection('x').doc('y').delete());
  await assert.rejects(context.db.collection('x').add({}));
  await assert.rejects(context.db.batch().commit());
  await assert.rejects(context.db.runTransaction(()=>{}));
  assert.equal(touches,0);
});
