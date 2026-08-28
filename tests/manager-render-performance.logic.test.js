const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');

function functionSource(name) {
  const marker = `function ${name}`;
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `${name} must exist`);
  let depth = 0, began = false;
  for (let i = start; i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; began = true; }
    if (source[i] === '}') {
      depth -= 1;
      if (began && depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

test('portal subscriptions only change when editor id or contract relationship changes', () => {
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${functionSource('portalSubscriptionSignature')};this.signature=portalSubscriptionSignature;`, context);
  const first = [
    {id: 'editor-b', editorKind: 'external', directorUid: 'director-1', name: '変更前の表示名'},
    {id: 'editor-a', editorKind: 'direct', directorUid: '', name: '鈴木'}
  ];
  const renamed = [
    {id: 'editor-a', editorKind: 'direct', directorUid: '', name: '鈴木 真由美'},
    {id: 'editor-b', editorKind: 'external', directorUid: 'director-1', name: '変更後の表示名'}
  ];
  assert.equal(context.signature(first), context.signature(renamed));
  assert.notEqual(context.signature(first), context.signature([{...renamed[0]}, {...renamed[1], editorKind: 'direct'}]));
  assert.notEqual(context.signature(first), context.signature([{...renamed[0]}, {...renamed[1], directorUid: 'director-2'}]));
});

test('manager rendering is coalesced to one animation frame', () => {
  const renderSafe = functionSource('renderSafe');
  assert.match(renderSafe, /state\.renderFrame!==null/);
  assert.match(renderSafe, /requestAnimationFrame/);
  assert.match(renderSafe, /state\.renderFrame=null/);
  assert.match(source, /function cancelManagerRender\(\)/);
});

test('manager start lifecycle has no permanent two-second polling loop', () => {
  assert.doesNotMatch(source, /setInterval\s*\(/);
  assert.match(source, /fbAuth\.onAuthStateChanged\(\(\)=>scheduleManagerLifecycle\(800\)\)/);
  assert.match(source, /window\.addEventListener\('pageshow',\(\)=>scheduleManagerLifecycle\(\)\)/);
  assert.match(source, /document\.addEventListener\('visibilitychange'/);
  assert.match(source, /if\(!ACCESS_RESOLVED\)/);
});

test('performance helpers do not write Firestore records', () => {
  const helperSource = ['cancelManagerRender', 'renderSafe', 'portalSubscriptionSignature', 'syncManagerLifecycle', 'scheduleManagerLifecycle']
    .map(functionSource).join('\n');
  assert.doesNotMatch(helperSource, /\.set\(|\.add\(|\.update\(|\.delete\(|\.commit\(/);
});
