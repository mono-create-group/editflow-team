const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

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
  assert.match(html, /visible=filtered\.slice\(0,VIDEO_RENDER_LIMIT\)/);
  assert.match(html, /function showMoreVideoCases\(\)\{VIDEO_RENDER_LIMIT\+=50;render\(\);\}/);
  assert.match(html, /_videoQueryTimer=setTimeout\(render,140\)/);
  assert.match(html, /oninput="setVideoQuery\(this\.value\)"/);
});
