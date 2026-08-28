const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const features = fs.readFileSync(path.resolve(__dirname, '..', 'editor-features.js'), 'utf8');

test('each assigned parent case offers a collapsed-group draft date control only for unfinished children', () => {
  assert.match(features, /function groupDraftEligibleJobs\(group\)\{return\(group\?\.jobs\|\|\[\]\)\.filter\(job=>activeJob\(job\)&&!job\.previewLegacy&&!job\.editorDraftDate\)\}/);
  assert.match(features, /サブ案件の編集者初稿日をまとめて設定/);
  assert.match(features, /初稿日が未設定のサブ案件 \$\{targets\.length\}件/);
  assert.match(features, /設定済みの日付は変更しません/);
  assert.match(features, /kind==='jobs'\?groupDraftPanel\(group\):''/);
  assert.match(features, /class="group-editor-draft-input"/);
  assert.match(features, /onclick="saveGroupEditorDraftDate\(this\)"/);
  assert.match(features, /@media\(max-width:760px\)\{\.group-draft-panel\{align-items:stretch;flex-direction:column\}/);
  assert.match(features, /id="job-editor-draft-\$\{jid\}"/);
  assert.match(features, /onclick="saveJobProgress\('\$\{jid\}'\)"/);
});

test('bulk draft save protects preview mode, invalid ordering, double presses, and failed writes', () => {
  const source = features.match(/async function saveGroupEditorDraftDate\([^]*?\n  \}/)?.[0];
  assert.ok(source, 'bulk save function exists');
  assert.match(source, /if\(ADMIN_PREVIEW\)return toast\('実データ確認モードでは変更できません'\)/);
  assert.match(source, /container=trigger\?\.closest\?\.\('\.editor-case-group'\),groupKey=container\?\.dataset\?\.caseKey\|\|''/);
  assert.match(source, /feature\.groupDraftSaving\.has\(groupKey\)/);
  assert.match(source, /if\(targets\.length>450\)return toast/);
  assert.match(source, /feature\.groupDraftSaving\.add\(groupKey\);if\(button\)button\.disabled=true/);
  assert.match(source, /dateError=scheduleError\(schedule\);if\(dateError\)return toast/);
  assert.match(source, /try\{/);
  assert.match(source, /catch\(error\)\{console\.warn\(error\);toast\('編集者初稿日をまとめて保存できませんでした'\)\}/);
  assert.match(source, /finally\{feature\.groupDraftSaving\.delete\(groupKey\)/);
});

test('a real portal uses one Firestore batch and changes local card values only after commit', () => {
  const source = features.match(/async function saveGroupEditorDraftDate\([^]*?\n  \}/)?.[0];
  assert.match(source, /const batch=db\.batch\(\),updatedAt=now\(\)/);
  assert.match(source, /targets\.forEach\(job=>batch\.update\(db\.collection\('editor_portals'\)\.doc\(user\.uid\)\.collection\('editor_jobs'\)\.doc\(job\.id\),\{editorDraftDate:value,updatedAt\}\)\);await batch\.commit\(\);targets\.forEach\(job=>\{job\.editorDraftDate=value\}\)/);
  assert.match(features, /window\.saveGroupEditorDraftDate=saveGroupEditorDraftDate/);
});
