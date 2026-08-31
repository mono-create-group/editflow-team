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
  assert.equal(context.bucket({status:'先方確認中'}), 'active');
  assert.equal(context.bucket({status:'完了'}), 'completed');
  assert.equal(context.bucket({status:'キャンセル'}), 'completed');
  assert.match(features, /jobsListMode:'active'/);
  assert.match(features, /setEditorJobsListMode\('active'\)/);
  assert.match(features, /setEditorJobsListMode\('completed'\)/);
  assert.match(features, /data-preview-safe class="btn job-list-tab/);
});

test('management progress board follows the actual editor-to-client workflow', () => {
  for (const marker of ['editor_work', 'director_review', 'client_submission', 'client_review', 'delivered']) {
    assert.match(index, new RegExp(marker));
  }
  assert.match(index, /\['progress','編集進行ボード'\]/);
  assert.match(index, /if\(VIDEO_TAB==='progress'\)/);
  assert.match(index, /workspaceBody=_videoProgressBoard\(visible\)/);
  assert.match(index, /video-progress-row/);
  assert.match(index, /progressMilestones:Array\.isArray\(j\.progressMilestones\)/);
  assert.match(index, /const VIDEO_STATUS_LABELS=\{'FB待ち':'mono\.create FB中','確認待ち':'先方確認中'\}/);
  assert.match(index, /function _videoCurrentProgressLabel\(job\)/);
  assert.match(index, /class="video-progress-current">いま：/);
  assert.match(index, /class="video-progress-next">次：/);
  assert.match(index, /クライアントから指示が来たときだけ編集者へ戻り、修正後にもう一度D確認/);
});

test('progress board explains the current step without rewriting saved data', () => {
  const start = index.indexOf('function _videoProgressStepState');
  const end = index.indexOf('\nfunction _videoProgressRows', start);
  assert.ok(start >= 0 && end > start, 'progress state helper must exist');
  const context = {_videoWorkflow(job){const status=String(job?.status||'');if(job?.workflow?.stage)return job.workflow;if(status==='完了')return{round:1,stage:'delivered'};if(status==='修正中')return{round:2,stage:'editing'};if(status==='D確認OK')return{round:1,stage:'client_submission'};if(status==='FB待ち'||['初稿提出済み','修正稿提出済み'].includes(status))return{round:status==='修正稿提出済み'?2:1,stage:'director_review'};if(['先方確認中','確認待ち'].includes(status))return{round:1,stage:'client_review'};return{round:1,stage:'editing'};},_editorOwnsPortalCompletion(job){return job?.businessType==='dispatch'||job?.source==='direct_client';}};
  vm.createContext(context);
  vm.runInContext(`${index.slice(start, end)};this.state=_videoProgressStepState;this.next=_videoProgressNextAction;`, context);
  assert.deepEqual({...context.state({status:'進行中'}, 'editor_work')}, {state:'active',label:'初稿を編集中'});
  assert.deepEqual({...context.state({status:'修正中'}, 'editor_work')}, {state:'active',label:'修正中（2回目）'});
  assert.deepEqual({...context.state({status:'FB待ち'}, 'director_review')}, {state:'active',label:'確認待ち'});
  assert.deepEqual({...context.state({status:'先方確認中'}, 'client_review')}, {state:'active',label:'先方確認中'});
  assert.deepEqual({...context.state({status:'D確認OK'}, 'client_submission')}, {state:'active',label:'先方へ提出する'});
  assert.deepEqual({...context.state({status:'完了'}, 'delivered')}, {state:'done',label:'完了'});
  assert.equal(context.next({status:'先方確認中'}), 'クライアントの返事待ち（OKならDが完了／修正なら編集者へ戻す）');
  assert.equal(context.next({status:'先方確認中',businessType:'dispatch'}), 'クライアントの返事待ち（OKなら担当編集者が実納品日・納品URLを記録して完了／修正ならDが編集者へ戻す）');
  assert.deepEqual({...context.state({status:'先方確認中',progressEvents:[{type:'editor_submitted',status:'修正稿提出済み'}]}, 'editor_work')}, {state:'done',label:'修正稿を提出済み'});
  assert.deepEqual({...context.state({status:'進行中'}, 'director_review')}, {state:'waiting',label:'初稿提出後'});
  assert.deepEqual({...context.state({status:'修正中'}, 'director_review')}, {state:'waiting',label:'修正稿提出後'});
  assert.deepEqual({...context.state({status:'進行中'}, 'client_review')}, {state:'waiting',label:'クライアント提出後'});
  assert.doesNotMatch(index, /label:key==='director_review'\?'稿の提出後'/);
});

test('progress board groups collapsed child cases with a readable current-status summary', () => {
  assert.match(index, /function _videoProgressStatusSummary\(rows\)/);
  assert.match(index, /const order=\['修正中','D確認待ち','先方へ提出中','先方確認中'/);
  assert.match(index, /class="video-progress-parent-state">現在：/);
  assert.match(index, /\$\{visible\.length\}\/\$\{children\.length\}件/);
});

test('management copy names the next person and separates editor and director actions', () => {
  assert.match(index, /現在の進捗 <b>/);
  assert.match(index, /次に対応する人 <b>/);
  assert.match(index, /紫色が現在地です/);
  assert.match(index, /class="video-progress-next">次：/);
  assert.match(index, /ディレクターまたはオーナーは修正指示・D確認OK・先方確認中を更新し、クライアントOK後に完了へ進めます/);
  assert.match(index, /編集者は編集開始・初稿提出・修正稿提出を記録し、先方OK後は実納品日と納品URLを付けて完了へ進めます/);
});
