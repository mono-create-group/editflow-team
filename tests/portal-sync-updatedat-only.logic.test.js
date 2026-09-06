const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const rules=fs.readFileSync(path.resolve(__dirname,'..','firestore.rules'),'utf8');
const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');

test('an owner update that only touches updatedAt is never routed to the chat-stamp validator',()=>{
  const start=rules.indexOf('function validPortalJobUpdate(');
  const body=rules.slice(start,rules.indexOf('function ',start+10));
  assert.match(body,/changed\.hasAny\(\['lastMessageAt','lastMessageSenderUid','lastMessagePreview'\]\)\s*&& changed\.hasOnly\(\[\s*'lastMessageAt','lastMessageSenderUid','lastMessagePreview','updatedAt'\s*\]\) \? validJobChatStamp\(uid\)/);
});

test('the sync failure toast names the reason instead of a generic message',()=>{
  assert.match(html,/担当編集者の画面へ\$\{problems\.length\?`\$\{problems\.length\}件を`:''\}同期できませんでした\$\{reason\?`（\$\{reason\}）`:''\}/);
  assert.match(html,/担当編集者の画面へ同期できませんでした（\$\{String\(error&&error\.code\|\|error&&error\.message\|\|''\)\.replace\(\/\^firestore\\\/\/,''\)\|\|'原因不明'\}）/);
});
