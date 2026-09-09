const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
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

// 会長指示: 社内でカット・テロップ挿入まで終え、残り工程を編集者へ回す案件が増える。
// Firestore ルールの更新キーを増やさず、attachments の type:'作業分担' 行で表現する。
test('work split is a typed attachment that both apps detect the same way', () => {
  const job = { attachments: [{ type: '素材', title: '素材', url: 'https://example.com/src' }, { type: '作業分担', title: '社内でカット・テロップ挿入まで完了 ／ 編集者の担当：装飾・BGM', url: 'https://drive.google.com/drive/folders/x' }] };
  const owner = vm.createContext({ URL });
  vm.runInContext(functionSource(index, '_videoWorkSplit'), owner);
  const ownerSplit = vm.runInContext(`_videoWorkSplit(${JSON.stringify(job)})`, owner);
  assert.equal(ownerSplit.url, 'https://drive.google.com/drive/folders/x');
  assert.equal(vm.runInContext('_videoWorkSplit({attachments:[{type:"素材",url:"https://a"}]})', owner), null);
  const portal = vm.createContext({});
  vm.runInContext(functionSource(editor, 'editorWorkSplit'), portal);
  assert.equal(vm.runInContext(`editorWorkSplit(${JSON.stringify(job)}).title`, portal), job.attachments[1].title);
  assert.match(index, /VIDEO_ATTACHMENT_TYPES=\[[^\]]*'作業分担'[^\]]*\]/, 'the attachment editor must keep the 作業分担 type instead of downgrading it to その他');
});

test('the board form offers the split and publish requires the prproj link, adds the row, and appends the caution', () => {
  assert.match(manager, /<select id="mb-work-split" onchange="managerWorkSplitChanged\(this\)">/);
  assert.match(manager, /<option value="inhouse_cut_telop">社内でカット・テロップ済み → 残り工程を編集者へ<\/option>/);
  assert.match(manager, /id="mb-split-prproj" type="url"/);
  assert.match(manager, /window\.managerWorkSplitChanged=function\(select\)/);
  const publish = functionSource(manager, 'publishBoard');
  assert.match(publish, /const workSplit=internal\?'full':\(document\.getElementById\('mb-work-split'\)\?\.value\|\|'full'\);/);
  assert.match(publish, /if\(!prprojUrl\)return toast\('社内編集済みプロジェクト（prproj）のURLを/);
  assert.match(publish, /parentAttachmentRead\.items\.unshift\(\{id:safeId\(\),type:'作業分担',title:`社内でカット・テロップ挿入まで完了 ／ 編集者の担当：\$\{tasks\}`,url:prprojUrl\}\)/);
  assert.match(publish, /splitCaution=`【作業分担】カットとテロップ挿入は社内で完了済みです。カットの順序・テロップの内容は変更しないでください。編集者の担当：\$\{tasks\}`/);
  // 子案件に個別の注意事項があっても、作業分担の注意は落とさない。
  assert.match(publish, /caution=splitCaution&&subcase\.caution\?\[splitCaution,subcase\.caution\]\.join\('\\n'\)\.slice\(0,2000\):\(subcase\.caution\|\|parentCaution\)/);
  // 20件上限の判定より前に作業分担行を足す（上限超過を見逃さない）。
  assert.ok(publish.indexOf("type:'作業分担'") < publish.indexOf('parentAttachmentRead.items.length+item.attachments.length>20'));
});

test('editors, the submission inbox, the case modal, and the legacy ledger all show the split', () => {
  assert.match(editor, /split=editorWorkSplit\(job\),tool=String\(j\.tool\|\|lastSubmission\.tool\|\|'premiere'\)==='capcut'\?'capcut':'premiere',jid=esc\(j\.id\);/);
  assert.match(editor, /社内でカット・テロップ挿入まで完了しています。残り工程を担当してください。/);
  assert.match(editor, /社内編集済みプロジェクトを開く/);
  assert.match(index, /\$\{item\.workSplit\?'<span class="badge ba">社内カット・テロップ済み<\/span>':''\}/);
  assert.match(index, /workSplit:_videoWorkSplit\(job\),/);
  assert.match(index, /\$\{_videoWorkSplitNoticeHtml\(j\)\}\n\t\$\{canEdit\?_videoAttachmentEditorHtml\(/);
  assert.match(index, /scopes:\['動画編集','サムネイル制作','動画編集＋サムネイル','ショート動画','VSL','スクール動画','残り工程（社内カット・テロップ済み）','その他'\]/);
  assert.match(index, /scopes:\['長尺動画','ショート動画','サムネイル制作','残り工程（社内カット・テロップ済み）','その他'\]/);
  const notice = vm.createContext({ URL, esc: v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])) });
  ['_videoSafeUrl', '_videoWorkSplit', '_videoWorkSplitNoticeHtml'].forEach(name => vm.runInContext(functionSource(index, name), notice));
  const html = vm.runInContext(`_videoWorkSplitNoticeHtml({attachments:[{type:'作業分担',title:'x <y>',url:'javascript:alert(1)'}]})`, notice);
  assert.match(html, /x &lt;y&gt;/);
  assert.match(html, /prproj のリンクが未登録です/);
  assert.equal(vm.runInContext(`_videoWorkSplitNoticeHtml({attachments:[]})`, notice), '');
});
