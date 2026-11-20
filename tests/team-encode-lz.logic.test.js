const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');

function inlineLz(source) {
  const start = source.indexOf('<script>/* lz-string 1.5.0');
  assert.ok(start >= 0, 'inline lz-string must exist');
  return source.slice(source.indexOf('>', start) + 1, source.indexOf('</script>', start));
}
function between(source, from, to) {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert.ok(start >= 0 && end > start, `${from} must exist`);
  return source.slice(start, end);
}

// 実データは使わず、使い捨ての案件データだけで往復を確かめる。
function makeCodec() {
  const context = {};
  context.window = context;
  vm.createContext(context);
  vm.runInContext(`${inlineLz(index)}\n${between(index, 'const TEAM_LZ_MIN_CHARS', '\n// ─── salesLeads分割格納')}\nthis.enc=_teamEncode;this.dec=_teamDecode;`, context);
  return context;
}
function fakeJobs(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `job${i}`, title: `案件${i} ショート動画の編集`, status: i % 3 ? '編集中' : '先方確認中', clientId: `c${i % 40}`, workerIds: [`w${i % 12}`], dueDate: '2026-11-20', memo: '修正指示：テロップの位置と効果音を調整'.repeat(3), updatedAt: 1763600000000 + i }));
}

test('large jobs are LZ-compressed and decode back to the exact same array', () => {
  const c = makeCodec();
  const jobs = fakeJobs(3500);
  const plain = JSON.stringify(jobs);
  assert.ok(plain.length > 200000);
  const encoded = c.enc('jobs', jobs);
  assert.ok(encoded.startsWith('LZ:'));
  assert.ok(encoded.length < plain.length / 2, 'compressed payload must be much smaller');
  assert.equal(JSON.stringify(c.dec(encoded)), plain);
  // 同じ中身なら同じ文字列(差分判定で無駄な書き込みを起こさない)
  assert.equal(c.enc('jobs', JSON.parse(plain)), encoded);
});

test('small ledgers stay plain JSON exactly as before', () => {
  const c = makeCodec();
  const jobs = fakeJobs(20);
  assert.equal(c.enc('jobs', jobs), JSON.stringify(jobs));
  assert.equal(c.enc('clients', []), '[]');
  assert.equal(JSON.stringify(c.dec(c.enc('jobs', jobs))), JSON.stringify(jobs));
});

test('other large keys use the same threshold, except plain-read salesDirectives', () => {
  const c = makeCodec();
  const big = fakeJobs(3500);
  assert.ok(c.enc('teamPages', big).startsWith('LZ:'));
  assert.ok(c.enc('bizBoard', { rows: big }).startsWith('LZ:'));
  assert.equal(c.enc('salesDirectives', big), JSON.stringify(big)); // dm-manual.html は JSON.parse で直接読む
  assert.ok(c.enc('salesLeads', fakeJobs(40)).startsWith('LZ:')); // 従来どおり 4000 文字超で圧縮
});

test('editor portal preview reads both plain and LZ shared arrays', () => {
  const context = {};
  context.window = context;
  vm.createContext(context);
  const fn = editor.slice(editor.indexOf('  function previewSharedArray('), editor.indexOf('\n', editor.indexOf('  function previewSharedArray(')));
  vm.runInContext(`${inlineLz(editor)}\n${fn}\nthis.read=previewSharedArray;`, context);
  const c = makeCodec();
  const jobs = fakeJobs(3500);
  assert.equal(JSON.stringify(context.read(c.enc('jobs', jobs))), JSON.stringify(jobs));
  assert.deepEqual(JSON.parse(JSON.stringify(context.read(c.enc('jobs', fakeJobs(2))))), fakeJobs(2));
  assert.deepEqual(JSON.parse(JSON.stringify(context.read('LZ:broken!!'))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(context.read(null))), []);
  // editor.html の lz-string は index.html と同じ物
  assert.equal(inlineLz(editor), inlineLz(index));
});

test('every shared/mcapp jobs write goes through _teamEncode', () => {
  assert.doesNotMatch(index, /jobs:JSON\.stringify\(/);
  assert.match(index, /tx\.set\(ref,\{jobs:_teamEncode\('jobs',jobs\)/);
  assert.match(index, /jobs:_teamEncode\('jobs',S\.jobs\)/);
});

test('repeated saves reuse the compressed payload instead of recompressing', () => {
  const c = makeCodec();
  const jobs = fakeJobs(3500);
  const first = c.enc('jobs', jobs);
  let calls = 0;
  const original = c.LZString.compressToBase64;
  c.LZString.compressToBase64 = (...args) => { calls += 1; return original.apply(c.LZString, args); };
  assert.equal(c.enc('jobs', JSON.parse(JSON.stringify(jobs))), first);
  assert.equal(calls, 0);
  jobs[0].status = '納品済み';
  const next = c.enc('jobs', jobs);
  assert.equal(calls, 1);
  assert.notEqual(next, first);
  // 解凍結果を使い回しても、戻すたびに別の配列(呼び出し側の書き換えが他に漏れない)
  const a = c.dec(next), b = c.dec(next);
  assert.notEqual(a, b);
  assert.equal(a[0].status, '納品済み');
});
