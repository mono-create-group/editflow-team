const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.resolve(__dirname, '..', 'editor-features.js'), 'utf8');

test('mobile setup is reachable through the existing more menu without adding a sixth primary mobile button', () => {
  assert.match(source, /\['mobile-setup','スマホ通知'\]/);
  assert.match(source, /const mobile=\[\['dashboard','ホーム'\],\['jobs','案件'\],\['dm','DM'\],\['notifications','通知'\]\]/);
  assert.match(source, /grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});

test('approved editors see clear iPhone installation and permission instructions until true ready status', () => {
  assert.match(source, /function pushSetupBannerHtml\(\)/);
  assert.match(source, /feature\.pushStatus\?\.ready\)return ''/);
  assert.match(source, /Safari または Chrome/);
  assert.match(source, /ホーム画面に追加/);
  assert.match(source, /アプリアイコンから/);
  assert.match(source, /通知を有効にする/);
  assert.match(source, /api\.status\(\{db,uid\}\)/);
});

test('preview and demo cannot write notification settings, while normal users call EditorPush enable and disable', () => {
  assert.match(source, /if\(DEMO\|\|ADMIN_PREVIEW\)return toast\('確認画面では通知を変更できません'\)/);
  assert.match(source, /api\.enable\(\{db,uid:user\.uid\}\)/);
  assert.match(source, /api\.disable\(\{db,uid:user\.uid\}\)/);
  assert.match(source, /status\?\.ready\?'通知を有効にしました':'通知の登録を完了できませんでした'/);
});

test('a successful DM dispatches a privacy-safe push asynchronously and cannot fail the DM send', () => {
  assert.match(source, /toast\('DMを送信しました'\);const push=pushClient\(\)/);
  assert.match(source, /user\.getIdToken\(\)\.then\(idToken=>push\.dispatchDirectThread\(\{threadId:result\.threadId,idToken\}\)\)\.catch/);
  assert.doesNotMatch(source, /dispatchDirectThread\(\{[^}]*body/);
});
