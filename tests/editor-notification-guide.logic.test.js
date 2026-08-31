const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.join(__dirname, '..', 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(__dirname, '..', 'editor-features.js'), 'utf8');

test('editor guide explains the notification setup for PC and installed mobile apps', () => {
  assert.match(editor, /DM通知を必ず設定する/);
  assert.match(editor, /PC（Chrome \/ Edge）/);
  assert.match(editor, /Android（Chrome）/);
  assert.match(editor, /iPhone（Safari \/ ホーム画面）/);
  assert.match(editor, /ホーム画面に追加/);
  assert.match(editor, /通知を有効にする/);
  assert.match(editor, /ブラウザタブでも端末通知を有効にできます/);
  assert.match(editor, /アプリアイコンの赤い件数も使う場合/);
  assert.match(editor, /「端末通知」→「通知を有効にする」/);
});

test('editor guide distinguishes notification permission, unread counts, and lock-screen privacy', () => {
  assert.match(editor, /DMの赤い件数は、DMを開くか「すべて既読」にすると消えます/);
  assert.match(editor, /通知を見ただけでは既読になりません/);
  assert.match(editor, /ロック画面の通知には、DM本文・案件名・クライアント名などの具体的な内容を表示しません/);
  assert.match(editor, /通知が届かない・赤い件数が出ないとき/);
  assert.match(editor, /端末の設定でEditFlow（または利用ブラウザ）の通知がオンか確認/);
});

test('guide actions and actual notification setup routes stay aligned', () => {
  assert.match(editor, /onclick="setView\('mobile-setup'\)"/);
  assert.match(features, /function mobileSetupHtml\(\)/);
  assert.match(features, /通知を有効にする/);
  assert.match(features, /function dmUnreadCount\(\)/);
  assert.match(features, /notification-count/);
});
