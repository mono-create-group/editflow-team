const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const features = fs.readFileSync(path.resolve(__dirname, '..', 'editor-features.js'), 'utf8');

test('assigned jobs lead with the active one-column list and a collapsed dispatch form', () => {
  assert.match(features, /jobsListMode:'active'/);
  assert.match(features, /editor-job-list\{display:grid;grid-template-columns:minmax\(0,860px\)/);
  assert.match(features, /<details class="card dispatch-create"><summary>＋ 編集者派遣の案件を追加<\/summary>/);
  assert.ok(features.indexOf('editor-job-list') < features.indexOf('${jobFormExtended()}'), 'the list must be rendered before the dispatch form');
  assert.match(features, /createJob=createDispatchJob/);
  assert.match(features, /saveCaseDraft\(\)/);
});

test('job type filters and near-deadline ordering use dedicated helpers', () => {
  assert.match(features, /function editorJobType\(job\)/);
  assert.match(features, /function editorJobSortByDeadline\(list\)/);
  assert.match(features, /setEditorJobsTypeFilter\('agency'\)/);
  assert.match(features, /setEditorJobsTypeFilter\('dispatch'\)/);
  assert.match(features, /showCompleted\?sortNewest\(visible\):editorJobSortByDeadline\(visible\)/);
});

test('cards show the repeatable editor, director, client, and delivery timeline with details collapsed', () => {
  for (const label of ['編集作業', 'D確認', 'クライアント提出', 'クライアント確認', '納品']) assert.match(features, new RegExp(label));
  assert.match(features, /編集進行の5段階/);
  assert.match(features, /`第\$\{workflow\.round\}回 修正作業`/);
  assert.match(features, /<details class="job-detail"><summary>案件の詳細・連絡を開く<\/summary>/);
  assert.match(features, /\$\{messageBlock\(j\)\}<\/details>/);
  assert.match(features, /saveJobDraft\('\$\{jid\}'\)/);
  assert.match(features, /saveJobProgress\('\$\{jid\}'\)/);
  assert.match(features, /quickJobStatus\(jid,status\)/);
  assert.match(features, /D確認待ちです。ディレクターが確認します。/);
  assert.match(features, /function submitEditorJobAction\(jid,status\)/);
  assert.match(features, /提出・納品URLを入力してください/);
  assert.match(features, /クライアント確認中です。修正指示が届くまでお待ちください。/);
});

test('board cards reveal details before their full-width acceptance call to action', () => {
  assert.match(features, /<summary>日程・案件内容を確認する<\/summary>/);
  assert.match(features, /claim-button\{width:100%;min-height:52px/);
  assert.match(features, /担当案件を見る／派遣案件を追加/);
  assert.match(features, /db\.runTransaction/);
});

test('only active editorial work is counted as overdue', () => {
  assert.match(features, /function editorDeadlineExemptStatus\(status\)\{return isJobDeadlineExemptStatus\(status\)\}/);
  assert.match(features, /function editorWorkIsOverdue\(job,baseDate=localDate\(\)\)/);
  assert.match(features, /days<0&&editorDeadlineExemptStatus\(j\.status\)/);
  assert.match(features, /確認待ち・修正・納品済みは超過に含めません/);
});

test('overdue helper excludes review and delivered statuses while retaining active work', () => {
  const exemptSource = features.match(/function editorDeadlineExemptStatus\([^\n]+/)?.[0];
  const fnSource = features.match(/function editorWorkIsOverdue\([^]*?\n  \}/)?.[0];
  assert.ok(exemptSource && fnSource);
  const excluded = new Set(['完了','キャンセル','初稿提出済み','初稿完成','修正中','修正稿提出済み','D確認OK','確認待ち','FB待ち','納品','納品済み']);
  const context = { localDate: () => '2026-08-28', isJobDeadlineExemptStatus: status => excluded.has(status) };
  vm.createContext(context);
  vm.runInContext(`${exemptSource}\n${fnSource}\nthis.check=editorWorkIsOverdue;`, context);
  for (const status of excluded) {
    assert.equal(context.check({ deliveryDate: '2026-08-20', status }, '2026-08-28'), false, status);
  }
  assert.equal(context.check({ deliveryDate: '2026-08-20', status: '進行中' }, '2026-08-28'), true);
});

test('parent cases are collapsed and preserve independent child cards', () => {
  assert.match(features, /function editorJobParent\(job\)/);
  assert.match(features, /function editorGroupJobs\(list\)/);
  assert.match(features, /<details class="card editor-case-group">/);
  assert.match(features, /親案件を開くと、担当している子案件を確認・更新できます。/);
  assert.match(features, /editorGroupJobs\(ordered\)\.map\(group=>editorGroupHtml\(group\)\)/);
  assert.match(features, /group\.jobs\.map\(jobCard\)/);
});

test('mobile navigation and notification links keep the editor focused on one next action', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');
  assert.match(html, /app-ui\.css/);
  assert.match(features, /editor-nav-mobile/);
  assert.match(features, /その他/);
  assert.match(features, /今日、次にすること/);
  assert.match(features, /function openEditorJob\(jobId\)/);
  assert.match(features, /window\.openEditorJob=openEditorJob/);
  assert.match(features, /overdue=active\.filter\(j=>editorWorkIsOverdue\(j\)\)/);
  assert.match(features, /data-case-key/);
  assert.match(features, /editor-readonly-status/);
  assert.equal((features.match(/function jobCardExtended\(job\)/g) || []).length, 1);
});

test('job cards keep supporting edits behind details and expose one primary action path', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');
  assert.match(features, /<details class="job-detail"><summary>案件の詳細・連絡を開く<\/summary>/);
  assert.match(features, /<details><summary>日程・案件内容を確認する<\/summary>/);
  assert.match(features, /class="btn primary claim-button"/);
  assert.match(features, /editor-primary-action/);
  assert.doesNotMatch(features, /legacyJobCardExtendedUnused/);
  assert.equal((features.match(/function jobCardExtended\(job\)/g) || []).length, 1);
  assert.ok(html.indexOf('</style>') < html.indexOf('href="app-ui.css"'), 'shared CSS must load after portal overrides');
});

test('parent grouping uses a stable id, then client account and case name, and never merges unnamed jobs', () => {
  assert.match(features, /parentCaseId\|\|job\?\.linkedLegacyJobId\|\|job\?\.parentJobId\|\|job\?\.caseId/);
  assert.match(features, /case:\$\{type\}\|\$\{client\}\|\$\{account\}\|\$\{caseName\}/);
  assert.match(features, /return\{key:`job:\$\{String\(job\?\.id\|\|''\)\}`/);
  assert.match(features, /normalize\('NFKC'\)/);
});

test('workflow schema remains backward compatible and only writes editor submitted events', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');
  assert.match(features, /function editorWorkflow\(job\)/);
  assert.match(features, /\['editing','director_review','client_submission','client_review','delivered'\]/);
  assert.match(features, /workflow:\{round:1,stage:'editing'\},progressEvents:\[\]/);
  assert.match(html, /type:'editor_submitted'/);
  assert.match(html, /fromStage:'editing',toStage:'director_review'/);
});

test('dashboard priority work and notifications retain parent case context', () => {
  assert.match(features, /function editorGroupSummary\(group\)/);
  assert.match(features, /function editorNotificationTitle\(job\)/);
  assert.match(features, /editorGroupJobs\(priority\)\.map\(group=>editorGroupHtml\(group,'priority'\)\)/);
  assert.match(features, /title:editorNotificationTitle\(j\)/);
  assert.match(features, /function editorWorkflowLabel\(stage\)/);
  assert.match(features, /director_review:'ディレクター確認中'/);
  assert.match(features, /確認・修正 \$\{review\}件/);
});

test('editor workflow hides manager-owned actions and keeps waiting states read-only', () => {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');
  assert.match(features, /function editorAllowedStatuses\(job\)/);
  assert.match(features, /if\(editorWorkflow\(job\)\.stage!=='editing'\)return null/);
  assert.match(features, /director_review:'D確認待ちです。ディレクターが確認します。'/);
  assert.match(features, /client_submission:'ディレクターがクライアントへ提出中です。'/);
  assert.match(features, /client_review:'クライアント確認中です。修正指示が届くまでお待ちください。'/);
  assert.match(html, /function editorCanSaveStatus\(job,status\)/);
  assert.match(html, /if\(!editorCanSaveStatus\(j,status\)\)return rejectStatusChange/);
  assert.match(html, /\['初稿提出済み','修正稿提出済み'\]\.includes\(status\)\?EDITOR_MILESTONE_BY_STATUS/);
});

test('demo-style repeat flow infers editor wait states from legacy statuses', () => {
  const workflowSource = features.match(/function editorWorkflow\([^]*?\n  \}/)?.[0];
  const waitSource = features.match(/function editorWaitMessage\([^\n]+/)?.[0];
  assert.ok(workflowSource && waitSource);
  const context = {};
  vm.createContext(context);
  vm.runInContext(`${workflowSource}\n${waitSource}\nthis.wait=editorWaitMessage;`, context);
  assert.match(context.wait({ status: '初稿提出済み' }), /D確認待ち/);
  assert.match(context.wait({ status: 'D確認OK' }), /ディレクターがクライアントへ提出中/);
  assert.match(context.wait({ status: '確認待ち' }), /クライアント確認中/);
  assert.equal(context.wait({ status: '修正中' }), '');
});
