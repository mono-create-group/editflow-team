const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');

test('editor navigation uses local inline SVG icons and the five Slack-style mobile destinations', () => {
  assert.match(source, /function navHtmlExtended\(\)/);
  assert.match(source, /const mobile=\[\['dashboard','ホーム'\],\['jobs','案件'\],\['dm','DM'\],\['notifications','通知'\]\]/);
  assert.match(source, /editor-sidebar-label">案件管理/);
  assert.match(source, /editor-sidebar-label">コミュニケーション/);
  assert.match(source, /editor-nav-icon/);
  assert.match(source, /<svg viewBox="0 0 24 24" aria-hidden="true">/);
  assert.match(source, /<span>その他<\/span>/);
  assert.doesNotMatch(source, /instagram\.com|Instagram|insta-logo/i);
});

test('home has a horizontally scrollable attention rail and a single-column feed', () => {
  assert.match(source, /class="editor-home-rail"/);
  assert.match(source, /class="editor-home-chips"/);
  assert.match(source, /class="editor-home-chip"/);
  assert.match(source, /editor-home-feed/);
  assert.match(source, /\.editor-home-chips\{[^}]*overflow-x:auto/);
  assert.match(source, /\.editor-job-list\{[^}]*grid-template-columns:minmax\(0,860px\)/);
});

test('the mobile navigation and attention controls retain touch-safe size and readable type', () => {
  assert.match(source, /\.editor-nav-mobile \.editor-nav-button[^}]*min-height:44px/);
  assert.match(source, /\.editor-home-chip-state\{font-size:14px/);
  assert.match(source, /\.editor-home-chip b\{[^}]*font-size:16px/);
  assert.match(source, /\.editor-home-chip small\{[^}]*font-size:14px/);
  assert.match(source, /@media\(max-width:760px\)\{body\{padding-bottom:76px/);
});

test('non-primary destinations remain inside the existing details menu', () => {
  assert.match(source, /const more=items\.filter/);
  assert.match(source, /<details class="editor-nav-more">/);
  assert.match(source, /editor-nav-more-menu/);
});
