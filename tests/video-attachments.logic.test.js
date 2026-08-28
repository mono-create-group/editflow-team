const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editorFeatures = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const managerFeatures = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

function source(name) {
  const result = html.match(new RegExp(`function ${name}\\([^]*?\\n\\}`, 'm'))?.[0];
  assert.ok(result, `${name} must exist`);
  return result;
}

test('materials accept only http(s), keep supported types, and cap display at 20', () => {
  const context = { URL };
  vm.createContext(context);
  vm.runInContext(`function _videoSafeUrl(v){try{const u=new URL(v);return['https:','http:'].includes(u.protocol)?u.href:'';}catch(_){return'';}}\nconst VIDEO_ATTACHMENT_TYPES=['素材','台本','参考動画','参考画像','指示書','その他'];\n${source('_videoAttachmentType')}\nthis.normalize=_videoAttachments;`, context);
  const rows = context.normalize([
    { id: 'script', type: '台本', title: '台本101', url: 'https://example.com/script' },
    { id: 'video', type: '参考動画', title: '参考', url: 'http://example.com/video' },
    { id: 'bad', type: '素材', title: 'bad', url: 'javascript:alert(1)' },
    { id: 'file', type: '素材', title: 'file', url: 'file:///private/file' },
    { id: 'other', type: '未知', title: 'other', url: 'https://example.com/other' },
    ...Array.from({ length: 25 }, (_, index) => ({ id: `n${index}`, type: '素材', title: `素材${index}`, url: `https://example.com/${index}` })),
  ]);
  assert.equal(rows.length, 20);
  assert.equal(rows[0].type, '台本');
  assert.equal(rows[1].type, '参考動画');
  assert.equal(rows[2].type, 'その他');
  assert.ok(rows.every(row => /^https?:\/\//.test(row.url)));
});

test('legacy requestUrl and sourceUrl remain readable alongside new materials without duplicates', () => {
  const context = { URL, Set };
  vm.createContext(context);
  vm.runInContext(`function _videoSafeUrl(v){try{const u=new URL(v);return['https:','http:'].includes(u.protocol)?u.href:'';}catch(_){return'';}}\nconst VIDEO_ATTACHMENT_TYPES=['素材','台本','参考動画','参考画像','指示書','その他'];\n${source('_videoAttachmentType')}\n${source('_videoCaseMaterials')}\nthis.materials=_videoCaseMaterials;`, context);
  const rows = context.materials([{ type: '台本', title: '台本', url: 'https://example.com/request' }], {
    requestUrl: 'https://example.com/request', sourceUrl: 'https://example.com/source',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(rows)).map(row => row.url), ['https://example.com/request', 'https://example.com/source']);
});

test('parent and child attachment editors, read-only viewer, and cards are wired', () => {
  assert.match(html, /素材・資料/);
  assert.match(html, /function openLegacyAttachmentViewer\(id,subId\)/);
  assert.match(html, /function openPortalAttachmentViewer\(portalUid,id,subId\)/);
  assert.match(html, /function _readVideoAttachments\(root\)/);
  assert.match(html, /addSubVideoAttachmentRow\(this\)/);
  assert.match(html, /attachments:canManageMaterials\?subAttachmentReads\[i\]\.items/);
  assert.match(html, /attachments:canManageMaterials\?parentAttachmentRead\.items/);
  assert.match(html, /attachments:attachmentRead\.items/);
  assert.match(html, /rel="noopener noreferrer"/);
  assert.match(html, /素材・資料は1案件につき20件までです/);
  assert.match(html, /data-sub-id="\$\{esc\(s\.id\|\|''\)\}"/);
  assert.match(html, /oldSubs\.find\(sub=>String\(sub\?\.id\|\|''\)===savedId\)/);
});

test('published work keeps materials after an editor accepts it', () => {
  assert.match(managerFeatures, /mb-attachment-list/);
  assert.match(managerFeatures, /attachments:attachmentRead\.items/);
  assert.match(editorFeatures, /attachments:Array\.isArray\(board\.attachments\)\?board\.attachments\.slice\(0,20\):\[\]/);
  assert.match(editorFeatures, /function editorResourceLinks\(job\)/);
});

test('Firestore limits attachment writes to portal managers while editors remain read-only', () => {
  assert.match(rules, /function validAttachments\(data\)/);
  assert.match(rules, /data\.attachments is list && data\.attachments\.size\(\) <= 20/);
  const editorBlock = rules.slice(rules.indexOf('allow update: if editor(uid)'), rules.indexOf('allow update: if directorFor(uid)'));
  assert.doesNotMatch(editorBlock, /'attachments'/);
  const managerBlock = rules.slice(rules.indexOf('allow update: if directorFor(uid)'), rules.indexOf('allow delete: if false', rules.indexOf('allow update: if directorFor(uid)')));
  assert.match(managerBlock, /'workflow','progressEvents','attachments'/);
  assert.match(managerBlock, /validAttachments\(request\.resource\.data\)/);
  const createBlock = rules.slice(rules.indexOf('allow create: if editor(uid)'), rules.indexOf('// One-time owner migration'));
  assert.match(createBlock, /'parentJobId','parentJobTitle','attachments'/);
  assert.match(createBlock, /validAttachments\(request\.resource\.data\)/);
  const boardBlock = rules.slice(rules.indexOf('match \/editor_job_board\/\{jobId\}'), rules.indexOf('match \/editor_schedules\/\{uid\}'));
  assert.match(boardBlock, /'summary','instructions','requestUrl','sourceUrl','attachments'/);
  assert.match(boardBlock, /validAttachments\(request\.resource\.data\)/);
});
