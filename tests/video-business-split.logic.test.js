const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('portal video jobs are routed to the correct business screen', () => {
  const fnSource = html.match(/function _portalVideoBiz\(j\)\{[^]*?\n\}/)?.[0];
  assert.ok(fnSource, 'portal business routing helper must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fnSource}\nthis.route=_portalVideoBiz;`, context);
  assert.equal(context.route({ businessType: 'dispatch' }), 'haken');
  assert.equal(context.route({ source: 'direct_client' }), 'haken');
  assert.equal(context.route({ businessType: 'edit_agency' }), 'edit');
  assert.equal(context.route({ source: 'job_board' }), 'edit');
  assert.equal(context.route({ boardJobId: 'board-1' }), 'edit');
  assert.equal(context.route({}), 'edit');
});

test('both video case screens are registered and use fixed business renderers', () => {
  assert.match(html, /\{id:'videoedit',label:'編集代行案件'/);
  assert.match(html, /\{id:'videohaken',label:'編集者派遣案件'/);
  assert.match(html, /function rVideoEditProjects\(\)\{[^}]*PBIZ='edit'/);
  assert.match(html, /function rVideoHakenProjects\(\)\{[^}]*PBIZ='haken'/);
  assert.match(html, /const all=_videoJobs\(\)\.filter\(j=>j\.biz===biz\)/);
});
