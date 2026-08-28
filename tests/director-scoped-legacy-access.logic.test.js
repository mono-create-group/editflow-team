const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

function accessHelpersContext(overrides = {}) {
  const start = source.indexOf('function _isScopedVideoDirectorAccess()');
  const end = source.indexOf('async function _requestAccess()', start);
  assert.ok(start >= 0 && end > start, 'director access helpers must exist');
  const context = {
    APP_ROLES: ['動画編集者', '動画編集ディレクター', '営業'],
    APP_ACCESS: null,
    ROLE_PREVIEW: null,
    _isActualOwner: () => false,
    _rolePreviewActive: () => false,
    ...overrides,
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(start, end)}\nthis.scoped=_isScopedVideoDirectorAccess;this.core=_coreAccessAllowed;this.app=_appAccessAllowed;`, context);
  return context;
}

test('video director uses the app through scoped portal access, including hybrid roles', () => {
  const context = accessHelpersContext();
  context.APP_ACCESS = { approved: true, roles: ['動画編集ディレクター'] };
  assert.equal(context.scoped(), true);
  assert.equal(context.core(), false);
  assert.equal(context.app(), true);
  context.APP_ACCESS = { approved: true, roles: ['動画編集ディレクター', '営業'] };
  assert.equal(context.scoped(), true);
  assert.equal(context.core(), false);
  assert.equal(context.app(), true);
});

test('owner and non-director core staff retain the legacy workspace', () => {
  const owner = accessHelpersContext({ _isActualOwner: () => true });
  owner.APP_ACCESS = { approved: true, roles: [] };
  assert.equal(owner.scoped(), false);
  assert.equal(owner.core(), true);
  const staff = accessHelpersContext();
  staff.APP_ACCESS = { approved: true, roles: ['営業'] };
  assert.equal(staff.scoped(), false);
  assert.equal(staff.core(), true);
});

test('director authentication starts only scoped portal listeners and clears legacy browser copies', () => {
  assert.match(source, /if\(_appAccessAllowed\(\)\)\{\s*if\(_coreAccessAllowed\(\)\)\{fbSetupRealtimeSync\(\);fbSetupTeamSync\(\);\}\s*fbSetupPortalOpsSync\(\)/);
  assert.match(source, /_clearSensitiveLocalState\(true\);\s*_purgeLegacyDirectorLocalCopies\(\)/);
  assert.match(source, /ef_team_v5_backup_/);
  assert.match(source, /mcapp_paid_cleanup_bak_/);
  assert.match(source, /mcapp_biz_bak/);
});

test('director UI cannot reopen legacy management, other workspaces, or legacy sync', () => {
  assert.match(source, /if\(_isScopedVideoDirectorAccess\(\)\)return\['video'\]/);
  assert.match(source, /if\(_isScopedVideoDirectorAccess\(\)\)return\(ROLE_VIEW_ACCESS\['動画編集ディレクター'\]\|\|\[\]\)\.includes\(v\)/);
  assert.match(source, /managementTabs=_isScopedVideoDirectorAccess\(\)\?\[\]/);
  assert.match(source, /const jobs=_isScopedVideoDirectorAccess\(\)\?\[\]:\(S\.jobs\|\|\[\]\)/);
  const syncStart = source.indexOf('async function syncLegacyAssignedSubtasksToPortal');
  const syncEnd = source.indexOf('function _applyPortalToLegacy', syncStart);
  const syncBody = source.slice(syncStart, syncEnd);
  assert.match(syncBody, /if\(!_isOwner\(\)\)return\{synced:0,skipped:0\}/);
  assert.doesNotMatch(syncBody, /myRoles\(\)\.includes\('動画編集ディレクター'\)/);
});

test('owner can recalculate all current director settlement authorizations', () => {
  const start = source.indexOf('async function rebuildAllDirectorInvoiceAuthorizations()');
  const end = source.indexOf('async function _refreshInvoiceAuthorization', start);
  const body = source.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.match(body, /if\(!_isOwner\(\)\)return/);
  assert.match(body, /_directorSettlementTargetsForJob/);
  assert.match(body, /PORTAL_AUTHORIZATIONS/);
  assert.match(body, /_refreshDirectorSettlementTargets\(unique\)/);
});
