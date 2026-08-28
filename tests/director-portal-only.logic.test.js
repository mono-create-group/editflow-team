const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');

function portalMergeContext(adminPreview) {
  return {
    ADMIN_PREVIEW: adminPreview,
    portalJobsSource: [{ id: 'portal-1', legacyParentId: 'parent-1', legacySubtaskId: 'child-1' }],
    previewLegacyJobs: [
      { id: 'legacy-1', legacyParentId: 'parent-1', legacySubtaskId: 'child-1', isLegacySubtask: true },
      { id: 'legacy-2', legacyParentId: 'parent-1', legacySubtaskId: 'child-2', isLegacySubtask: true },
    ],
    jobs: [],
  };
}

test('actual video-director portal renders only scoped portal jobs', () => {
  const start = source.indexOf('function legacyPreviewPairKey');
  const end = source.indexOf('function buildLegacyPreviewJobs', start);
  assert.ok(start >= 0 && end > start, 'portal merger source must exist');
  const context = portalMergeContext(false);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('combinePortalJobs()', context);
  assert.deepEqual(Array.from(context.jobs, row => row.id), ['portal-1']);
});

test('legacy jobs remain available only in owner read-only preview', () => {
  const start = source.indexOf('function legacyPreviewPairKey');
  const end = source.indexOf('function buildLegacyPreviewJobs', start);
  const context = portalMergeContext(true);
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  vm.runInContext('combinePortalJobs()', context);
  assert.deepEqual(Array.from(context.jobs, row => row.id), ['portal-1', 'legacy-2']);
  assert.match(source, /if\(ADMIN_PREVIEW\)next\.push\(db\.collection\('shared'\)\.doc\('mcapp'\)\.onSnapshot/);
});
