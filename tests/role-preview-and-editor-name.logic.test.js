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
  assert.match(index, /確認中は誤変更を防ぐため保存・承認・削除を無効にします/);
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
  assert.match(editor, /btn\.closest\('\.nav,\.editor-nav-mobile'\)/, 'desktop and mobile navigation remain usable in read-only preview');
  assert.match(features, /data-preview-safe onclick="openEditorJob/, 'the owner can open an actual assigned case without enabling writes');
  assert.match(features, /data-preview-safe class="btn job-type-filter/, 'read-only preview can filter actual assigned cases');
  assert.match(features, /data-preview-safe class="notification-item/, 'read-only preview can follow a notification to its case');
  assert.match(editor, /function buildLegacyPreviewJobs\(shared,member\)/);
  assert.match(editor, /collection\('shared'\)\.doc\('mcapp'\)\.onSnapshot/);
  assert.match(editor, /previewLegacy:true/);
  assert.match(features, /if\(!job\|\|job\.previewLegacy\)return/);
});

test('a video director sees every saved child case under a parent assigned to that director', () => {
  assert.match(editor, /const isVideoDirector=Array\.isArray\(member\?\.roles\)&&member\.roles\.includes\('動画編集ディレクター'\)/);
  assert.match(editor, /if\(isVideoDirector&&assigned\(j\)&&children\.length\)return children\.map\(x=>make\(j,x\.sub,x\.index\)\)/);
  assert.match(editor, /ADMIN_PREVIEW\|\|\(Array\.isArray\(access\?\.roles\)&&access\.roles\.includes\('動画編集ディレクター'\)\)/);
  assert.match(editor, /const relevant=children\.filter\(x=>assigned\(x\.sub\)\)/, 'pure editors remain limited to their own children');
  assert.match(editor, /x\.isLegacySubtask\|\|!linkedParents\.has/, 'an integrated parent is not duplicated, while its independent children remain visible');
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
  assert.match(features, /ここに出るのは、管理者が募集を開始した案件だけ/);
  assert.match(features, /進行中の担当案件はありません/);
  assert.match(features, /完了済みの担当案件は0件です/);
  assert.match(editor, /従来どおり入力できます/);
  assert.match(editor, /管理者の報酬確定を待たずに通常の請求書を作成できます/);
});
