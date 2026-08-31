const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

test('案件一覧 uses the unified board that includes direct editor dispatch jobs', () => {
  assert.match(source, /if\(VIDEO_TAB==='manage-board'\)\{VIDEO_TAB='board'/);
  assert.match(source, /businessType==='dispatch'\|\|j\?\.source==='direct_client'/);
  assert.match(source, /const all=_videoJobs\(\)\.filter\(j=>j\.biz===biz\)/);
  assert.match(source, /onclick="setVideoTab\('board'\)"[^>]*>⚙<\/button>/);
});

test('legacy-only manage-board is not exposed as the main 案件 tab', () => {
  assert.match(source, /\?\['board','manage-profit','manage-payment','manage-completed','manager-editors','manager-clients'\]/);
  assert.match(source, /BIZ_CFG\[biz\]\.tabs\.filter\(k=>k!=='board'/);
  assert.doesNotMatch(source, /title="案件一覧" onclick="setVideoTab\('manage-board'\)"/);
});
