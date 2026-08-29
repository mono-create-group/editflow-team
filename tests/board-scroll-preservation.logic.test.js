const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sourceBetween(name, next) {
  const start = index.indexOf(`function ${name}`);
  const end = index.indexOf(`function ${next}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return index.slice(start, end);
}

test('board horizontal position survives a full view replacement', () => {
  const before = { scrollLeft: 480, isConnected: false };
  const after = { scrollLeft: 0, isConnected: true };
  let current = before;
  const context = {
    document: { querySelector: selector => selector === '#view .board-wrap' ? current : null },
    requestAnimationFrame: callback => callback(),
  };
  vm.createContext(context);
  vm.runInContext([
    sourceBetween('_captureViewBoardScroll', '_restoreViewBoardScroll'),
    sourceBetween('_restoreViewBoardScroll', 'render'),
    'this.capture = _captureViewBoardScroll;',
    'this.restore = _restoreViewBoardScroll;',
  ].join('\n'), context);

  const saved = context.capture();
  current = after;
  context.restore(saved);
  assert.equal(saved, 480);
  assert.equal(after.scrollLeft, 480);
});

test('render captures before replacing #view and restores immediately after', () => {
  const renderSource = sourceBetween('render', 'subTabs');
  const captureAt = renderSource.indexOf('const previousBoardScrollLeft=_captureViewBoardScroll()');
  const replaceAt = renderSource.indexOf("document.getElementById('view').innerHTML=rolePreviewBanner()");
  const restoreAt = renderSource.indexOf('_restoreViewBoardScroll(previousBoardScrollLeft)');
  assert.ok(captureAt >= 0 && replaceAt > captureAt && restoreAt > replaceAt);
});
