const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'app-ui.css'), 'utf8');

function sortLogic() {
  const start = html.indexOf('function _videoUpdatedMillis');
  const end = html.indexOf('function _videoFiltered', start);
  assert.ok(start >= 0 && end > start, 'video sorting helpers must exist');
  const context = { VIDEO_SORT: 'deadline' };
  vm.createContext(context);
  vm.runInContext(`${html.slice(start, end)}\nthis.sort=_videoSortJobs;`, context);
  return context.sort;
}

test('video cases can be sorted by deadline, update time, and title', () => {
  const sort = sortLogic();
  const rows = [
    { id: 'b', title: 'B案件', deadline: '', updatedAt: 20 },
    { id: 'c', title: 'C案件', deadline: '2026-09-10', updatedAt: 10 },
    { id: 'a', title: 'A案件', deadline: '2026-09-01', updatedAt: 30 }
  ];
  assert.deepEqual(Array.from(sort(rows, 'deadline'), x => x.id), ['a', 'c', 'b']);
  assert.deepEqual(Array.from(sort(rows, 'updated-desc'), x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(Array.from(sort(rows, 'updated-asc'), x => x.id), ['c', 'b', 'a']);
  assert.deepEqual(Array.from(sort(rows, 'title'), x => x.id), ['a', 'b', 'c']);
});

test('sort selection persists and applies to parent and subcases', () => {
  assert.match(html, /sessionStorage\.setItem\('mc_video_sort',VIDEO_SORT\)/);
  assert.match(html, /aria-label="案件の並び替え"/);
  assert.match(html, /期限が近い順/);
  assert.match(html, /更新が新しい順/);
  assert.match(html, /更新が古い順/);
  assert.match(html, /案件名順/);
  assert.match(html, /const subtasks=_videoSortJobs\(j\.subtasks\|\|\[\]\)/);
});

test('desktop board scrolls horizontally while mobile remains a vertical list', () => {
  assert.match(css, /\.app-kanban\{[^}]*overflow-x:auto/);
  assert.match(css, /\.app-kanban\{[^}]*-webkit-overflow-scrolling:touch/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.app-kanban\{[^}]*grid-template-columns:1fr[^}]*overflow-x:visible/);
  assert.match(html, /工程ボードは左右にスクロールできます/);
});
