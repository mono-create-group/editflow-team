#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const testsDirectory = path.join(root, 'tests');
const dmBackendTest = 'dm-staff-workflow.test.js';
const onlyDmBackend = process.argv.slice(2).join(' ') === '--only-dm-backend';
if (!['', '--only-dm-backend'].includes(process.argv.slice(2).join(' '))) {
  console.error('usage: node scripts/run-unit-tests.cjs [--only-dm-backend]');
  process.exit(2);
}

const allTests = fs.readdirSync(testsDirectory)
  .filter(name => /(?:\.logic|\.integration)?\.test\.js$/.test(name))
  .sort();
let selected = onlyDmBackend ? [dmBackendTest] : allTests.filter(name => name !== dmBackendTest);

if (!onlyDmBackend) {
  console.log(`SKIP ${dmBackendTest}: requires EDITFLOW_DM_BACKEND_FILE to supply the external Apps Script backend.`);
  console.log('SKIP dm-workflow-mock-server.js: fixture server helper, not a test process.');
}

const env = { ...process.env };
if (onlyDmBackend) {
  if (!env.EDITFLOW_DM_BACKEND_FILE) {
    console.error(`SKIP ${dmBackendTest}: set EDITFLOW_DM_BACKEND_FILE=/absolute/path/to/Code.js to run it.`);
    process.exit(0);
  }
  const hook = path.join(root, 'scripts', 'dm-backend-read-redirect.cjs');
  env.NODE_OPTIONS = [env.NODE_OPTIONS, `--require=${hook}`].filter(Boolean).join(' ');
}

const testPaths = selected.map(name => path.join('tests', name));
console.log(`RUN ${testPaths.length} deterministic unit test files`);
const result = spawnSync(process.execPath, ['--test', ...testPaths], {
  cwd: root,
  env,
  stdio: 'inherit',
});
process.exit(result.status === null ? 1 : result.status);
