const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');

test('owner data bridge exposes readiness separately from empty portal collections', () => {
  assert.match(index, /let _ownerPortalBridgeReady=\{access:false,jobs:false,invoices:false,profiles:false,authorizations:false\}/);
  assert.match(index, /window\.EditflowOwnerDataBridge=Object\.freeze\(/);
  assert.match(index, /ready:\{\.\.\._ownerPortalBridgeReady\}/);
  assert.match(index, /accessRecords:ACCESS_RECORDS\.slice\(\)/);
  assert.match(index, /portalJobs:PORTAL_JOBS\.slice\(\)/);
  assert.match(index, /_resetOwnerPortalBridge\(\)/);
  assert.match(index, /_ownerPortalBridgeReady\.jobs=true;_notifyOwnerPortalBridge\(\)/);
});

test('manager reuses owner bridge instead of opening duplicate owner access and portal listeners', () => {
  assert.match(manager, /bridge\.subscribe\(snapshot=>hydrateOwnerBridge\(snapshot\)\)/);
  assert.match(manager, /if\(owner\)return;/);
  assert.match(manager, /if\(_isOwner\(\)\)\{[\s\S]{0,450}EditflowOwnerDataBridge/);
  assert.doesNotMatch(manager, /const aq=_isOwner\(\)\?fbDb\.collection\('access'\)/);
  assert.match(manager, /const aq=fbDb\.collection\('access'\)\.where\('directorUid','==',FB_USER\.uid\)/);
  assert.match(manager, /stopNested\(\{preserveOwnerPortalData:owner,resetPricing:false\}\)/);
});

test('director scoped portal subscriptions remain in place', () => {
  assert.match(manager, /if\(isDirector\(\)&&FB_USER\?\.uid\)/);
  assert.match(manager, /director invoice/);
  assert.match(manager, /director authorization/);
  assert.match(manager, /director profile/);
});
