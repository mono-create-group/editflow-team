const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

test('assigned jobs default to active and keep completed jobs in a separate tab', () => {
  const fn = features.match(/function editorJobBucket\(job\)\{[^\n]+\}/)?.[0];
  assert.ok(fn, 'editorJobBucket must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${fn};this.bucket=editorJobBucket;`, context);
  assert.equal(context.bucket({status:'進行中'}), 'active');
  assert.equal(context.bucket({status:'確認待ち'}), 'active');
  assert.equal(context.bucket({status:'完了'}), 'completed');
  assert.equal(context.bucket({status:'キャンセル'}), 'completed');
  assert.match(features, /jobsListMode:'active'/);
  assert.match(features, /setEditorJobsListMode\('active'\)/);
  assert.match(features, /setEditorJobsListMode\('completed'\)/);
  assert.match(features, /data-preview-safe class="btn job-list-tab/);
});

test('management progress board tracks initial, revision, director check, and delivery', () => {
  for (const marker of ['initial_submitted', 'revision_submitted', 'director_approved', 'client_approved_delivered']) {
    assert.match(index, new RegExp(marker));
  }
  assert.match(index, /\['progress','編集進行ボード'\]/);
  assert.match(index, /if\(VIDEO_TAB==='progress'\)/);
  assert.match(index, /workspaceBody=_videoProgressBoard\(visible\)/);
  assert.match(index, /video-progress-row/);
  assert.match(index, /progressMilestones:Array\.isArray\(j\.progressMilestones\)/);
  assert.match(index, /const VIDEO_STATUS_LABELS=\{'FB待ち':'mono\.create FB中','確認待ち':'先方確認中'\}/);
  assert.match(index, /function _videoCurrentProgressLabel\(job\)/);
  assert.match(index, /class="video-progress-current">現在：/);
});

test('progress board infers legacy status without rewriting saved data', () => {
  const start = index.indexOf('function _videoProgressMilestoneState');
  const end = index.indexOf('\nfunction _videoProgressRows', start);
  assert.ok(start >= 0 && end > start, 'progress state helper must exist');
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${index.slice(start, end)};this.state=_videoProgressMilestoneState;`, context);
  assert.deepEqual({...context.state({status:'進行中'}, 'initial_submitted')}, {state:'active',label:'対応中'});
  assert.deepEqual({...context.state({status:'修正中'}, 'revision_submitted')}, {state:'active',label:'対応中'});
  assert.deepEqual({...context.state({status:'FB待ち'}, 'director_approved')}, {state:'active',label:'mono.create FB中'});
  assert.deepEqual({...context.state({status:'確認待ち'}, 'client_approved_delivered')}, {state:'active',label:'先方確認中'});
  assert.deepEqual({...context.state({status:'D確認OK'}, 'director_approved')}, {state:'done',label:'完了'});
  assert.deepEqual({...context.state({status:'完了'}, 'client_approved_delivered')}, {state:'done',label:'完了'});
  assert.deepEqual({...context.state({status:'進行中',progressMilestones:[{key:'initial_submitted'}]}, 'initial_submitted')}, {state:'done',label:'完了'});
});

test('progress board groups collapsed child cases with a readable current-status summary', () => {
  assert.match(index, /function _videoProgressStatusSummary\(rows\)/);
  assert.match(index, /const order=\['修正中','mono\.create FB中','先方確認中'/);
  assert.match(index, /class="video-progress-parent-state">現在：/);
  assert.match(index, /\$\{visible\.length\}\/\$\{children\.length\}件/);
});

test('management copy names the next person and separates editor and director actions', () => {
  assert.match(index, /現在の進捗 <b>/);
  assert.match(index, /次に対応する人 <b>/);
  assert.match(index, /編集者は初稿・修正稿を提出し、ディレクターまたはオーナーがD確認以降を更新します/);
  assert.match(index, /編集者は初稿・修正稿を提出します。ディレクターまたはオーナーがD確認、クライアントへの提出、修正指示、納品を更新します/);
});
