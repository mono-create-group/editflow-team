const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const dm = fs.readFileSync(path.join(root, 'direct-messages.js'), 'utf8');

function functionSource(source, header) {
  const start = source.indexOf(header);
  assert.ok(start >= 0, `${header} must exist`);
  let depth = 0, opened = false;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') { depth += 1; opened = true; }
    if (source[i] === '}' && opened && --depth === 0) return source.slice(start, i + 1);
  }
  assert.fail(`${header} must close`);
}

// ---------------------------------------------------------------- owner list states

test('the owner invoice tab separates loading, failure, and a genuinely empty list', () => {
  const html = functionSource(index, 'function _videoInvoiceHtml()');
  assert.match(html, /if\(!_ownerPortalBridgeReady\.invoices\)return/);
  assert.match(html, /請求書を読み込み中です/);
  assert.match(html, /請求書を取得できませんでした/);
  assert.match(html, /onclick="location\.reload\(\)"/);
  // 「提出された請求書はありません」は接続済みかつ0件のときだけ。
  const emptyAt = html.indexOf('提出された請求書はありません');
  const guardAt = html.indexOf('if(!_ownerPortalBridgeReady.invoices)return');
  assert.ok(guardAt >= 0 && emptyAt > guardAt, 'the empty message must come after the connection guard');
  // リスナーの成功・失敗が両方その状態へ反映されること。
  assert.match(index, /_ownerPortalBridgeReady\.invoices=true;_ownerPortalInvoiceSyncFailed=false;/);
  assert.match(index, /_ownerPortalBridgeReady\.invoices=false;_ownerPortalInvoiceSyncFailed=true;/);
});

test('editor drafts stay out of the owner invoice list', () => {
  const html = functionSource(index, 'function _videoInvoiceHtml()');
  assert.match(html, /filter\(x=>!_portalIsExternal\(x\._portalUid\)&&x\.status!=='下書き'\)/);
});

test('the accepted tax rates are [0,10] on both sides and a legacy 8% is warned about, not rewritten', () => {
  assert.equal(index.includes('[0,8,10]'), false, 'the owner side must no longer accept 8% as valid');
  const helper = functionSource(index, 'function _portalProfileTaxRate(profile)');
  assert.match(helper, /if\(\[0,10\]\.includes\(rate\)\)return rate;/);
  // 8%は 10% に読み替えない。そのまま返して、請求書チェックで警告として見せる。
  assert.match(helper, /return rate===8\?8:0;/);
  const check = functionSource(index, 'function _portalInvoiceCheck(x)');
  assert.match(check, /rate===8\)return\{ok:false,reason:'8%の旧税率が残っています。10%で請求書を作り直してください'\}/);
  assert.match(check, /!\[0,10\]\.includes\(rate\)\)return\{ok:false,reason:'税率を確認してください'\}/);
  const context = vm.createContext({ Number });
  vm.runInContext(`${helper}this.rate=_portalProfileTaxRate;`, context);
  assert.equal(context.rate({ taxRate: 10 }), 10);
  assert.equal(context.rate({ taxRate: 0 }), 0);
  assert.equal(context.rate({ taxRate: 8 }), 8);
  assert.equal(context.rate({ taxRate: 5 }), 0);
  assert.equal(context.rate(undefined), 0);
});

// ------------------------------------------------------------- DM failure surfacing

test('a DM whose push notification fails still keeps the message and says so', () => {
  const editorSend = functionSource(features, 'async function sendDirectMessage(event)');
  assert.match(editorSend, /catch\(error=>\{console\.warn\('dm push dispatch',error\);toast\('メッセージは保存しましたが、相手への通知は届かなかった可能性があります'\)\}/);
  // 送信自体は成功しているので、DMを取り消したりエラーにしたりはしない。
  assert.match(editorSend, /toast\('DMを送信しました'\)/);
  const ownerSend = functionSource(index, 'async function ownerDmSend()');
  assert.match(ownerSend, /console\.warn\('owner dm push dispatch',error\);toast\('メッセージは保存しましたが、相手への通知は届かなかった可能性があります','warn'\);/);
  assert.match(ownerSend, /toast\('DMを送信しました'\)/);
});

test('an unreadable read receipt holds the verdict instead of forcing the thread unread', () => {
  assert.match(dm, /catch \(_\) \{ receiptPending = true; \}/);
  assert.match(dm, /const unread = receiptPending \? false : \(thread\.lastSenderUid !== me\.uid && lastAt > readAt\);/);
  assert.match(dm, /readReceiptPending: receiptPending/);
});

// --------------------------------------------------- job chat unread without opening

test('a new case-chat message is recorded on the case document by both sides', () => {
  const editorSend = functionSource(features, 'async function sendJobMessage(jid)');
  assert.match(editorSend, /jobRef\.update\(\{lastMessageAt:at,lastMessageSenderUid:user\.uid,lastMessagePreview:String\(body\)\.replace\(\/\\s\+\/g,' '\)\.trim\(\)\.slice\(0,80\),updatedAt:at\}\)/);
  // 控えが失敗しても送信は成立しているので、送信そのものは失敗扱いにしない。
  assert.match(editorSend, /catch\(error\)\{console\.warn\('job chat stamp'/);
  const stamp = functionSource(index, 'async function _stampJobChatLastMessage(portalUid,jobId,body,senderUid)');
  assert.match(stamp, /lastMessageAt:Date\.now\(\),lastMessageSenderUid:String\(senderUid\|\|''\),lastMessagePreview:_jobChatPreview\(body\)/);
  // 控えの失敗を送信失敗として報告しない（送信自体は成立している）。
  assert.match(manager, /try\{await window\._stampJobChatLastMessage\?\.\(portalUid,jid,body,FB_USER\.uid\)\}catch\(error\)\{console\.warn\('job chat stamp'/);
  const preview = vm.createContext({ String });
  vm.runInContext(`${functionSource(index, 'function _jobChatPreview(body)')}this.preview=_jobChatPreview;`, preview);
  assert.equal(preview.preview('あ'.repeat(200)).length, 80);
  assert.equal(preview.preview(' 初稿を\n 出しました '), '初稿を 出しました');
  assert.equal(preview.preview(null), '');
});

test('case-chat unread comes from the case document, so closing the detail does not clear it', () => {
  const items = functionSource(features, 'function notificationItems()');
  // feature.messages は案件を開いたときだけ読み込むため、通知の判定には使わない。
  assert.doesNotMatch(items, /feature\.messages\.get/);
  assert.match(items, /const chat=jobChatUnreadItem\(j,read\);if\(chat\)items\.push\(chat\);/);
  const unread = functionSource(features, 'function jobChatUnreadItem(job,read)');
  assert.match(unread, /String\(job\.lastMessageSenderUid\|\|''\)===String\(user\?\.uid\|\|''\)\)return null;/);
  assert.match(unread, /persistent:true/);

  const context = vm.createContext({ String, Number, Date, user: { uid: 'me' } });
  vm.runInContext([
    functionSource(features, 'function portalMillis(value)'),
    functionSource(features, 'function jobChatNotificationId(job)'),
    unread,
    "function editorNotificationTitle(job){return job.title}",
    'this.item=jobChatUnreadItem;this.idOf=jobChatNotificationId;',
  ].join('\n'), context);

  const read = new Set();
  assert.equal(context.item({ id: 'j1', title: '案件', lastMessageAt: 0 }, read), null, 'no chat means no notification');
  assert.equal(context.item({ id: 'j1', title: '案件', lastMessageAt: 10, lastMessageSenderUid: 'me' }, read), null, 'own message is not unread');
  const mine = context.item({ id: 'j1', title: '案件', lastMessageAt: 10, lastMessageSenderUid: 'other', lastMessagePreview: '確認お願いします' }, read);
  assert.equal(mine.id, 'jobchat:j1:10');
  assert.equal(mine.detail, '確認お願いします');
  // 既読にすると消え、新しい発言が来ると同じ案件でも改めて未読になる。
  read.add(mine.id);
  assert.equal(context.item({ id: 'j1', title: '案件', lastMessageAt: 10, lastMessageSenderUid: 'other' }, read), null);
  assert.equal(context.item({ id: 'j1', title: '案件', lastMessageAt: 20, lastMessageSenderUid: 'other' }, read).id, 'jobchat:j1:20');
  // Firestore の Timestamp でも数値でも同じ判定になること。
  assert.equal(context.idOf({ id: 'j1', lastMessageAt: { toMillis: () => 30 } }), 'jobchat:j1:30');
  assert.equal(context.idOf({ id: 'j1', lastMessageAt: { seconds: 2 } }), 'jobchat:j1:2000');
});

test('the case-chat stamp is the only portal job update that may carry those three fields', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  const guard = functionSource(rules, 'function validJobChatStamp(uid)');
  assert.match(guard, /\(directorFor\(uid\) \|\| editor\(uid\)\)/);
  assert.match(guard, /lastMessageSenderUid', ''\) == request\.auth\.uid/);
  assert.match(guard, /lastMessagePreview', ''\)\.size\(\) <= 80/);
  const update = functionSource(rules, 'function validPortalJobUpdate(uid, jobId)');
  assert.match(update, /changed\.hasOnly\(\[\s*'lastMessageAt','lastMessageSenderUid','lastMessagePreview','updatedAt'\s*\]\) \? validJobChatStamp\(uid\)/);
});
