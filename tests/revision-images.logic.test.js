const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');

function functionSource(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const open = source.indexOf('{', start);
  let depth = 0, quote = '', escaped = false;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (quote) { if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth += 1; else if (ch === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error(`unterminated ${name}`);
}
const escapeHtml = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 会長指示: 修正指示に画像を添え、編集者が確認できるようにする。Storage 未設定のため共有URL方式。
test('image urls are parsed safely, de-duplicated, and capped at ten', () => {
  const ctx = vm.createContext({ URL, esc: escapeHtml });
  ['_videoSafeUrl', '_videoParseImageUrls', '_videoImagePreviewUrl', '_videoRevisionImagesHtml'].forEach(name => vm.runInContext(functionSource(index, name), ctx));
  const parsed = vm.runInContext(`_videoParseImageUrls(${JSON.stringify('https://a.example/1.png\nhttps://a.example/1.png, javascript:alert(1)、https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing not-a-url')})`, ctx);
  assert.deepEqual(Array.from(parsed), ['https://a.example/1.png', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing']);
  const many = vm.runInContext(`_videoParseImageUrls(Array.from({length:14},(_,i)=>'https://a.example/'+i+'.png').join('\\n'))`, ctx);
  assert.equal(many.length, 10);
  assert.equal(vm.runInContext(`_videoImagePreviewUrl('https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view?usp=sharing')`, ctx), 'https://drive.google.com/thumbnail?id=1AbCdEfGhIjKlMnOp&sz=w600');
  assert.equal(vm.runInContext(`_videoImagePreviewUrl('https://a.example/1.png')`, ctx), 'https://a.example/1.png');
  const html = vm.runInContext(`_videoRevisionImagesHtml(['https://a.example/x.png?a=1&b=2','javascript:alert(1)'])`, ctx);
  assert.match(html, /<img src="https:\/\/a\.example\/x\.png\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /javascript:/);
  assert.equal(vm.runInContext(`_videoRevisionImagesHtml([])`, ctx), '');
});

test('revision actions record the images on the progress event and the history shows them', () => {
  const flow = functionSource(index, 'advancePortalWorkflow');
  assert.match(flow, /function advancePortalWorkflow\(portalUid,id,action,providedReason,providedCompletionDate,providedImages\)\{/);
  // 修正指示（D／クライアント）のときだけ画像を読む。承認系の遷移には付けない。
  assert.match(flow, /images=\['directorRevision','clientRevision'\]\.includes\(action\)\?_videoParseImageUrls\(providedImages===undefined\?\(document\.getElementById\('vp-correction-images'\)\?\.value\|\|''\):providedImages\):\[\]/);
  assert.match(flow, /\.\.\.\(reason\?\{reason\}:\{\}\),\.\.\.\(images\.length\?\{images\}:\{\}\),/);
  assert.match(index, /<textarea id="vp-correction-images"/);
  assert.match(functionSource(index, '_videoWorkflowHistoryItem'), /_videoRevisionImagesHtml\(event\?\.images\)/);
  // 旧台帳の子案件モーダルからも画像URLを渡せる。
  assert.match(index, /class="j-sub-portal-images"/);
  assert.match(functionSource(index, 'advanceLegacyPortalSubcaseWorkflow'), /const images=document\.getElementById\(`\$\{controlKey\}-images`\)\?\.value\|\|'';\n  await advancePortalWorkflow\(portalUid,jobId,action,reason,completionDate,images\);/);
});

test('editors see the latest revision images as thumbnails next to the instruction', () => {
  const ctx = vm.createContext({ esc: escapeHtml, safeUrl: v => (/^https?:\/\//.test(String(v || '')) ? String(v) : '') });
  ['latestRevisionEvent', 'revisionImagePreviewUrl', 'editorRevisionImagesHtml'].forEach(name => vm.runInContext(functionSource(editor, name), ctx));
  const job = { progressEvents: [
    { type: 'director_revision_requested', images: ['https://old.example/1.png'] },
    { type: 'editor_submitted' },
    { type: 'client_revision_requested', images: ['https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view', 'javascript:alert(1)'] },
  ] };
  const html = vm.runInContext(`editorRevisionImagesHtml(${JSON.stringify(job)})`, ctx);
  assert.match(html, /修正指示の画像/);
  assert.match(html, /thumbnail\?id=1AbCdEfGhIjKlMnOp/);
  assert.doesNotMatch(html, /old\.example/, 'only the latest revision instruction is shown');
  assert.doesNotMatch(html, /javascript:/);
  assert.equal(vm.runInContext(`editorRevisionImagesHtml({progressEvents:[{type:'editor_submitted'}]})`, ctx), '');
  assert.match(editor, /\$\{editorRevisionImagesHtml\(job\)\}<div class="actions"><button class="btn primary small" type="button" onclick="openEditorFeedback/);
});
