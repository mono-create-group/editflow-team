const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const start = html.indexOf('function _legacyAssignmentBinding(');
const end = html.indexOf('\nfunction _caseManualIds', start);
assert.ok(start >= 0 && end > start, 'assignment binding helper must exist');
const helperSource = html.slice(start, end);

function makeContext() {
  const context = {
    _legacyPortalAccessForWorker: workerId => workerId === 'worker-miyuu'
      ? { id: 'uid-miyuu', workerId }
      : null,
    _legacyPortalJobId: (parentId, subId) => `legacy_${parentId}_${subId}`,
    String,
  };
  vm.createContext(context);
  vm.runInContext(`${helperSource}\nthis.rebind=_legacyAssignmentBinding;`, context);
  return context;
}

test('changing Miura to Miyuu rebinds the existing portal link before save', () => {
  const context = makeContext();
  const previous = {
    id: 'WD-S083',
    workerId: 'worker-miura',
    portalUid: 'uid-miura',
    portalJobId: 'legacy_wako-aug_WD-S083',
    parentCaseId: 'legacy:wako-aug',
  };
  const next = context.rebind(previous, 'worker-miyuu', 'wako-aug', 'WD-S083');
  assert.equal(next.portalUid, 'uid-miyuu');
  assert.equal(next.portalJobId, 'legacy_wako-aug_WD-S083');
  assert.equal(next.parentCaseId, 'legacy:wako-aug');
});

test('keeping the same assignee preserves the existing portal link', () => {
  const context = makeContext();
  const previous = {
    workerId: 'worker-miyuu',
    portalUid: 'uid-miyuu',
    portalJobId: 'legacy_wako-aug_WD-S083',
    parentCaseId: 'legacy:wako-aug',
  };
  assert.deepEqual(
    JSON.parse(JSON.stringify(context.rebind(previous, 'worker-miyuu', 'wako-aug', 'WD-S083'))),
    { portalUid: 'uid-miyuu', portalJobId: 'legacy_wako-aug_WD-S083', parentCaseId: 'legacy:wako-aug' },
  );
});

test('saveJob applies the new assignment binding after the old record spread', () => {
  const saveStart = html.indexOf('function saveJob(');
  const saveEnd = html.indexOf('\nfunction openHabitModal', saveStart);
  const source = html.slice(saveStart, saveEnd);
  assert.match(source, /assignmentBinding=_legacyAssignmentBinding\(previous,workerId,current\?\.id\|\|'',subId\)/);
  assert.match(source, /workerId,\.\.\.assignmentBinding,\.\.\.billingSnapshot/);
});
