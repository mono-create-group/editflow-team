const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const applyStart = html.indexOf('function _applyPortalToLegacy(');
const applyEnd = html.indexOf('\nasync function promotePortalJob', applyStart);
assert.ok(applyStart >= 0 && applyEnd > applyStart, 'portal-to-legacy adapter must exist');
const applySource = html.slice(applyStart, applyEnd);

test('owner subscription automatically applies editor portal updates after both ledgers load', () => {
  const ownerBranch = html.slice(
    html.indexOf("if(_isOwner()){", html.indexOf('function fbSetupPortalOpsSync()')),
    html.indexOf('}else{', html.indexOf('function fbSetupPortalOpsSync()')),
  );
  assert.match(ownerBranch, /PORTAL_JOBS=q\.docs/);
  assert.match(ownerBranch, /_schedulePortalLegacySync\(\)/);
  assert.match(html, /_teamCloudLoaded=true;\s*_schedulePortalLegacySync\(\)/);
  assert.match(html, /function _syncPortalJobsIntoLegacy\(\)[^]*_applyPortalToLegacy\(job,false\)[^]*if\(changed\)\{save\(\);renderSyncSafe\(\);\}/);
});

test('an editor draft date updates only the linked legacy child and is idempotent', () => {
  const linked = {
    id: 'legacy-parent',
    subtasks: [
      { id: 'WD-S086', portalUid: 'uid-miyuu', portalJobId: 'legacy_legacy-parent_WD-S086', editorDraftDate: null, editorDraftDateSetter: 'editor', status: '進行中' },
      { id: 'WD-S087', portalUid: 'uid-miyuu', portalJobId: 'legacy_legacy-parent_WD-S087', editorDraftDate: null, editorDraftDateSetter: 'editor', status: '進行中' },
    ],
    statusHistory: [],
  };
  const context = {
    S: { jobs: [linked] },
    ACCESS_RECORDS: [{ id: 'uid-miyuu', workerId: 'worker-miyuu' }],
    _paymentRecipientSnapshot: () => ({}),
    _portalField: (job, key, fallback) => Object.prototype.hasOwnProperty.call(job, key) ? (job[key] || null) : fallback,
    _editorDraftDateSetter: (job, fallback = 'creator') => job?.editorDraftDateSetter === 'editor' ? 'editor' : job?.editorDraftDateSetter === 'creator' ? 'creator' : fallback,
    _videoAttachments: rows => Array.isArray(rows) ? rows : [],
    _caseManualIds: rows => Array.isArray(rows) ? rows.map(String) : [],
    _videoUpdatedMillis: value => value?.toMillis?.() || Number(value || 0),
    _myEmail: () => 'owner@example.test',
    _isOwner: () => true,
    Date,
    JSON,
    Object,
    String,
    Number,
    Array,
  };
  vm.createContext(context);
  vm.runInContext(`${applySource}\nthis.applyPortal=_applyPortalToLegacy;`, context);

  const portal = {
    id: 'legacy_legacy-parent_WD-S086',
    _portalUid: 'uid-miyuu',
    legacyParentId: 'legacy-parent',
    legacySubtaskId: 'WD-S086',
    editorDraftDate: '2026-09-01',
    editorDraftDateSetter: 'editor',
    status: '進行中',
    updatedAt: { toMillis: () => 1788192000000 },
    updatedBy: 'miyuu@example.test',
  };

  assert.equal(context.applyPortal(portal, false), true);
  assert.equal(linked.subtasks[0].editorDraftDate, '2026-09-01');
  assert.equal(linked.subtasks[1].editorDraftDate, null);
  assert.equal(linked.statusHistory.at(-1).subId, 'WD-S086');
  assert.equal(context.applyPortal(portal, false), false, 'same portal snapshot must not create a write loop');

  const before = context.S.jobs.length;
  assert.equal(context.applyPortal({ ...portal, id: 'unlinked', legacyParentId: 'missing-parent' }, false), false);
  assert.equal(context.S.jobs.length, before, 'automatic sync never creates an unlinked legacy case');
});
