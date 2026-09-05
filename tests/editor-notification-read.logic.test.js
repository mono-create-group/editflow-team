const fs=require('fs');
const path=require('path');
const test=require('node:test');
const assert=require('node:assert/strict');

const source=fs.readFileSync(path.resolve(__dirname,'..','editor-features.js'),'utf8');

test('unread badge is calculated from per-editor read state, not every active notification',()=>{
  assert.match(source,/function unreadNotificationItems\(\)\{const read=notificationReadIds\(\);return notificationItems\(\)\.filter\(item=>!read\.has\(item\.id\)\)\}/);
  assert.match(source,/function editorVisibleNotificationCount\(\)\{[\s\S]*?sourceSnapshot\?\.\('editor-case'\)\.ids/);
  assert.match(source,/const noticeCount=editorVisibleNotificationCount\(\);/);
  assert.match(source,/editor_notification_read_\$\{user\?\.uid\|\|'guest'\}/);
});

test('each notification can be read, and all currently unread notifications can be read together',()=>{
  assert.match(source,/onclick="markEditorNotificationRead\('\$\{esc\(x\.id\)\}'\)">既読<\/button>/);
  assert.match(source,/すべて既読にする/);
  assert.match(source,/function markEditorNotificationRead\(id,shouldRender=true\)\{if\(!id\)return;const read=notificationReadIds\(\);read\.add\(id\);saveNotificationReadIds\(read\);if\(shouldRender\)render\(\)\}/);
  assert.match(source,/function markEditorNotificationsRead\(\)\{const read=notificationReadIds\(\);notificationItems\(\)\.forEach\(x=>read\.add\(x\.id\)\);saveNotificationReadIds\(read\);render\(\)\}/);
});

test('opening a notification marks it read but preserves the underlying case and message',()=>{
  assert.match(source,/const item=notificationItems\(\)\.find\(x=>x\.id===id\);if\(item\)markEditorNotificationRead\(id,false\);/);
  assert.match(source,/既読にしても案件やメッセージは削除されません/);
  assert.match(source,/window\.markEditorNotificationRead=markEditorNotificationRead;/);
});

test('deadline and required notifications use the same unread filter and device copy does not promise background delivery',()=>{
  assert.match(source,/kind:'required'[\s\S]*persistent:true/);
  assert.match(source,/kind:'due'[\s\S]*persistent:true/);
  assert.match(source,/return notificationItems\(\)\.filter\(item=>!read\.has\(item\.id\)\)/);
  assert.match(source,/アプリを開いている間の新着DMを知らせます/);
});
