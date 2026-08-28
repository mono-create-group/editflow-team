const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const editor = fs.readFileSync(path.join(root, 'editor.html'), 'utf8');
const features = fs.readFileSync(path.join(root, 'editor-features.js'), 'utf8');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const manager = fs.readFileSync(path.join(root, 'manager-features.js'), 'utf8');

function mobileNavItems(source) {
  const nav = source.match(/<div id="mob-nav"[^>]*>([\s\S]*?)<\/div>/m)?.[1];
  assert.ok(nav, 'mob-nav must exist');
  return [...nav.matchAll(/class="mnav-item(?:\s|\")/g)].length;
}

test('each editorial journey leads with one visually distinct primary action', () => {
  assert.match(features, /editor-primary-action\{border:2px solid/);
  assert.match(editor, /class="btn primary job-primary"/);
  assert.match(features, /claim-button\{width:100%;min-height:52px/);
  assert.match(features, /<section class="application-workspace" aria-label="案件応募ワークスペース">/);
  assert.match(features, /<aside class="application-confirm">/);
  assert.equal((features.match(/onclick="claimBoardJob/g) || []).length, 1, 'the application detail has one claim CTA');
  assert.match(features, /この案件を受ける<\/button>/);
  assert.doesNotMatch(features, /最後の紫ボタン/);
  assert.match(index, /const headerPrimary=managementKey\?managementActions:\(VIDEO_TAB==='overview'&&attentionTotal/);
  assert.match(index, /<span>未割当<\/span>/);
  assert.match(index, /const utilityActions=`\$\{VIDEO_TAB==='overview'&&attentionTotal\?addJobAction:''\}/);
  assert.match(index, /managerOpenBoardForm\?managerOpenBoardForm\(\):openJobModal\(\)/);
  assert.match(manager, /id="manager-board-publish" class="manager-operation-disclosure"/);
  assert.match(manager, /必要なときだけ開く操作/);
});

test('editor home gives one primary action a textual priority, current state, next step, and deadline', () => {
  assert.match(features, /class="editor-action-kicker">最優先/);
  assert.match(features, /class="editor-deadline-chip">\$\{esc\(editorDeadlineLabel\(next\)\)\}<\/span>/);
  assert.match(features, /class="editor-current-state"><span>現在の進捗<\/span>/);
  assert.match(features, /class="editor-next-instruction"><span>次にすること<\/span>/);
  assert.match(features, /onclick="openEditorJob\('\$\{esc\(next\.id\)\}'\)">この案件を開く/);
});

test('mobile navigation is a five-item bottom bar in editor and main app', () => {
  // Four direct destinations plus the "more" disclosure keeps the bar at five touch targets.
  assert.match(features, /const mobile=\[\['dashboard','ホーム'\],\['jobs','案件'\],\['dm','DM'\],\['notifications','通知'\]\]/);
  assert.match(features, /<details class="editor-nav-more">/);
  assert.equal(mobileNavItems(index), 5);
  assert.match(features, /@media\(max-width:760px\)\{[^}]*\}\.editor-nav-desktop\{display:none\}\.editor-nav-mobile\{position:fixed;left:0;right:0;bottom:0/);
  assert.match(index, /#mob-nav\{\s*display:none;position:fixed;bottom:0/);
});

test('secondary editor navigation opens as a bounded readable menu', () => {
  assert.match(features, /\.editor-nav-desktop\{position:relative;overflow:visible;flex-wrap:wrap\}/);
  assert.match(features, /\.editor-nav-more-menu\{position:absolute;[^}]*grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(features, /\.editor-nav-more-menu \.btn\{width:100%;min-width:0;min-height:44px;justify-content:flex-start/);
  assert.match(features, /\.editor-nav-more-menu\{position:fixed;top:auto;right:12px;bottom:calc\(66px \+ env\(safe-area-inset-bottom\)\);left:12px/);
  assert.match(features, /max-height:min\(62dvh,460px\);grid-template-columns:repeat\(2,minmax\(0,1fr\)\);overflow-y:auto/);
});

test('notifications contain stable deep-link data and open the target context', () => {
  assert.match(index, /data-notification-target=/);
  assert.match(index, /data-notification-section=/);
  assert.match(index, /data-notification-auto-open=/);
  assert.match(index, /function openVideoNotification\(source,portalUid,jobId\)/);
  assert.match(index, /openPortalJobModal\(portalUid,jobId\)/);
  assert.doesNotMatch(index, /<details class="card"[^>]*\$\{items\.length\?'open':''\}/);
  assert.match(index, /内容を開く/);
});

test('assigned parent cases keep details while board child cases use a selected table row', () => {
  assert.match(features, /<details[^>]+class="card editor-case-group">/);
  assert.match(features, /editor-case-group>summary/);
  assert.match(features, /group\.jobs\.map\(jobCard\)/);
  assert.match(features, /class="application-subcase-table" role="table" aria-label="子案件一覧"/);
  assert.match(features, /class="application-subcase-row \$\{item\.id===selected\.id\?'active':''\}/);
  assert.match(features, /onclick="selectBoardJob\('\$\{esc\(item\.id\)\}'\)"/);
  assert.match(index, /<details class="video-subcase-list"/);
  assert.match(index, /video-subcase-children/);
  assert.match(index, /class="video-progress-parent-state">現在：/);
});

test('tabs expose selection semantics to assistive technology', () => {
  assert.match(index, /role="tablist" aria-label="編集進行ボードの表示範囲"/);
  assert.match(index, /role="tab" aria-selected="\$\{!isCompleted\}"/);
  assert.match(index, /role="tab" aria-selected="\$\{biz==='edit'\}"/);
  assert.match(features, /job-list-tab.*active/);
});

test('keyboard focus and touch targets meet the minimum interaction contract', () => {
  assert.match(`${editor}\n${features}`, /:focus-visible/);
  assert.match(index, /:focus-visible/);
  assert.match(editor, /\.btn\{min-height:44px/);
  assert.match(features, /\.editor-nav-mobile \.editor-nav-button,\.editor-nav-mobile \.editor-nav-more summary\{min-width:0;min-height:44px/);
  assert.match(index, /\.video-toolbar \[role=tab\]\{min-height:44px/);
});

test('375px and 390px layouts forbid page-level horizontal scrolling', () => {
  assert.match(index, /html\{width:100%;max-width:100%;overflow-x:hidden/);
  assert.match(index, /@media\(max-width:700px\)/);
  assert.match(features, /@media\(max-width:420px\)/);
  assert.match(features, /@media\(max-width:760px\)/);
  assert.match(editor, /<meta name="viewport" content="width=device-width,?initial-scale=1/);
  assert.match(index, /<meta name="viewport" content="width=device-width,?initial-scale=1/);
  assert.match(features, /\.editor-primary-action,\.editor-case-group,\.editor-job-card,.board-card,.job-submit-panel\{min-width:0;overflow-wrap:anywhere\}/);
  assert.match(features, /\.editor-primary-action \.section-title\{flex-wrap:wrap\}/);
});

test('the management progress board becomes a vertical, labelled stage layout on mobile', () => {
  assert.match(index, /@media\(min-width:701px\) and \(max-width:820px\)\{\.video-progress-head\{display:none\}/);
  assert.match(index, /\.video-progress-head\{display:none\}\.video-progress-row\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(index, /\.video-progress-info\{grid-column:1\/-1/);
  assert.match(index, /\.video-progress-stage::before\{content:attr\(data-label\)/);
  assert.match(index, /\.video-mobile-phase\{display:grid/);
});

test('workflow ownership is explicit for editors and management', () => {
  assert.match(features, /D確認待ちです。ディレクターが確認します。/);
  assert.match(features, /mono\.create FB中です。確認・修正指示をお待ちください。/);
  assert.match(features, /先方確認中です。修正指示またはOKの連絡をお待ちください。/);
  assert.match(index, /class="video-progress-current">いま：/);
  assert.match(index, /class="video-progress-next">次：/);
  assert.match(index, /編集者提出 → D確認 → 先方提出 → 修正指示 → 再D確認/);
  assert.match(index, /DのOKを記録/);
  assert.match(index, /クライアントへの提出を記録/);
  assert.match(index, /先方からOKが出たら、担当編集者が納品日と納品の証跡URLを記録して完了にします/);
});

test('management progress uses an explicit current-state label and readable non-colour cues', () => {
  assert.match(index, /\.video-progress-info \.video-progress-current\{[^}]*font-size:14px[^}]*font-weight:900[^}]*border:1\.5px solid #7c3aed/);
  assert.match(index, /\.video-progress-stage\{[^}]*min-height:72px[^}]*font-size:14px[^}]*font-weight:850/);
  assert.match(index, /\.video-progress-stage\.active\{border:2px solid #7c3aed/);
  assert.match(index, /\.video-progress-head\{[^}]*font-size:14px[^}]*font-weight:850/);
  assert.match(index, /\.video-progress-board \.video-subcase-head\{align-items:flex-start;flex-direction:column\}/);
});
