const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const editor = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');

function functionSource(name) {
  const start = editor.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
  let depth = 0;
  let opened = false;
  for (let i = start; i < editor.length; i += 1) {
    if (editor[i] === '{') { depth += 1; opened = true; }
    if (editor[i] === '}' && opened && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('quota errors state that the progress was not submitted and retain the retry path', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource('portalSaveErrorMessage')}\nthis.messageFor = portalSaveErrorMessage;`, context);
  const message = context.messageFor({ code: 'resource-exhausted', message: 'Quota exceeded.' });
  assert.match(message, /送信されていません/);
  assert.match(message, /入力内容を残したまま/);
  assert.match(message, /もう一度提出/);
});

test('the required progress save reports the classified failure and clears drafts only after commit', () => {
  const source = functionSource('saveJobProgressRequired');
  const commitAt = source.indexOf('await batch.commit()');
  const clearAt = source.indexOf('clearJobDraft(jid)', commitAt);
  assert.ok(commitAt >= 0 && clearAt > commitAt, 'draft is cleared only after a successful commit');
  assert.match(source, /round:workflow\.round/);
  assert.match(source, /if\(select\)select\.value=previousStatus/);
  assert.match(source, /saveJobDraft\(jid\)/);
  assert.match(source, /提出は記録されていません。入力内容は保持しました。/);
  assert.match(source, /finally\{progressSavingIds\.delete\(jid\)\}/);
});
