const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');
const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');

test('owner can preview every role with current data in read-only mode', () => {
  for (const role of ['動画編集ディレクター', '動画編集者', 'AIコンサルタント', 'AIエンジニア', 'Webデザイナー', '営業', 'SNSマーケター']) {
    assert.match(index, new RegExp(role));
  }
  assert.match(index, /役職別の実データ画面を確認/);
  assert.match(index, /デモデータは使いません/);
  assert.match(index, /function applyRolePreviewReadOnly/);
  assert.match(index, /実データで権限確認中/);
  assert.match(manager, /activeManagerUid/);
  assert.match(manager, /x\.directorUid===activeManagerUid\(\)/);
});

test('owner can inspect an editor portal using that member actual portal data', () => {
  assert.match(index, /editor\.html\?previewUid=/);
  assert.match(editor, /const PREVIEW_UID_PARAM=/);
  assert.match(editor, /ADMIN_PREVIEW=!!\(PREVIEW_UID_PARAM&&owner\)/);
  assert.match(editor, /collection\('editor_portals'\)\.doc\(portalUid\(\)\)/);
  assert.match(features, /feature\.startedFor===portalUid\(\)/);
  assert.match(features, /applyAdminPreviewReadOnly\(\)/);
  assert.match(editor, /function buildLegacyPreviewJobs\(shared,member\)/);
  assert.match(editor, /collection\('shared'\)\.doc\('mcapp'\)\.onSnapshot/);
  assert.match(editor, /previewLegacy:true/);
  assert.match(features, /jobs\.filter\(j=>!j\.previewLegacy\)/);
});

test('editor display name is explicitly aligned with Chatwork and self-editable', () => {
  assert.match(editor, /Chatwork表示名 \*/);
  assert.match(editor, /Chatworkと同じ名前/);
  assert.match(editor, /function saveDisplayName\(\)/);
  assert.match(editor, /collection\('access'\)\.doc\(user\.uid\)\.update\(\{name,updatedAt:/);
  assert.match(index, /本人確認の取り違えを防ぐため、Chatworkの表示名と完全に揃えてください/);
  assert.match(index, /function rolePreviewEditMemberName\(uid\)/);
  assert.match(index, /function rolePreviewSaveMemberName\(uid\)/);
  assert.match(rules, /affectedKeys\(\)\.hasOnly\(\[\s*'name','updatedAt'/);
});

test('empty portal states explain zero data and keep the traditional invoice path available', () => {
  assert.match(features, /権限エラーではありません。管理者が編集代行案件を掲載/);
  assert.match(features, /このアカウントの担当案件は0件です/);
  assert.match(editor, /従来どおり入力できます/);
  assert.match(editor, /管理者の報酬確定を待たずに通常の請求書を作成できます/);
});
