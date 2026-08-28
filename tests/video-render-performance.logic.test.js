const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8');

test('video normalization is memoized once per full render and uses lookup maps', () => {
  assert.match(html, /_renderEpoch\+=1/);
  assert.match(html, /if\(_videoJobsMemoEpoch===_renderEpoch\)return _videoJobsMemo/);
  assert.match(html, /clientNames=new Map/);
  assert.match(html, /legacyById=new Map\(\),legacyByPortal=new Map/);
  assert.doesNotMatch(html, /const linked=\(S\.jobs\|\|\[\]\)\.find/);
});

test('hidden video tabs do not build card markup before they are selected', () => {
  assert.match(html, /if\(VIDEO_TAB==='board'\)\{/);
  assert.match(html, /else if\(VIDEO_TAB==='queue'\)\{/);
  assert.match(html, /const filtered=_videoFiltered\(biz,all\)/);
  assert.match(html, /let workspaceBody=overview/);
});

test('large case lists render in bounded batches and search waits for typing to pause', () => {
  assert.match(html, /let VIDEO_RENDER_LIMIT=50/);
  assert.match(html, /function _videoPhaseBuckets\(filtered,renderLimit=VIDEO_RENDER_LIMIT\)/);
  assert.match(html, /perPhaseLimit=Math\.max\(10,Math\.ceil\(renderLimit\/VIDEO_PHASES\.length\)\)/);
  assert.match(html, /shown=phaseJobs\.slice\(0,perPhaseLimit\)/);
  assert.match(html, /function showMoreVideoCases\(\)\{VIDEO_RENDER_LIMIT\+=50;render\(\);\}/);
  assert.match(html, /_videoQueryTimer=setTimeout\(render,140\)/);
  assert.match(html, /oninput="setVideoQuery\(this\.value\)"/);
});

test('each kanban phase receives visible rows when its header count is non-zero', () => {
  assert.match(html, /const filtered=_videoFiltered\(biz,all\),\{byPhase,perPhaseLimit,renderedCount\}=_videoPhaseBuckets\(filtered\)/);
  assert.match(html, /<span class="badge bk">\$\{phaseJobs\.length\}<\/span>/);
  assert.match(html, /shown\.map\(_videoCard\)\.join\(''\)/);
  assert.match(html, /この工程の案件はありません/);
  assert.doesNotMatch(html, /visible\.forEach\(j=>byPhase\.get\(_videoPhase\(j\.status\)\.id\)/);
});

test('phase batching keeps a review case visible even when earlier rows fill other phases', () => {
  const start = html.indexOf('const VIDEO_PHASES=');
  const end = html.indexOf('function _videoIsOverdue', start);
  assert.ok(start >= 0 && end > start);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.bucket=_videoPhaseBuckets;`, context);
  const rows = Array.from({ length: 50 }, (_, i) => ({ id: `editing-${i}`, status: '進行中' }));
  rows.push({ id: 'review-1', status: '確認待ち' });
  const result = context.bucket(rows, 50);
  assert.equal(result.byPhase.get('review').length, 1);
  assert.equal(result.byPhase.get('editing').slice(0, result.perPhaseLimit).length, 10);
  assert.equal(result.renderedCount, 11);
});
