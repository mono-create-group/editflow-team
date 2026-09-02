const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'owner-yellow-ui.css'),'utf8');

test('owner overview renders a case-detail workspace instead of KPI-only cards',()=>{
  assert.match(html,/function _videoReferenceWorkspace\(\{biz,all,active,title,addJobAction,tabs,screenSwitch=''\}\)/);
  assert.match(html,/const overview=_videoReferenceWorkspace\(\{biz,all,active,title,addJobAction,tabs,screenSwitch\}\)/);
  assert.ok(html.indexOf('const addJobAction=')<html.indexOf('const overview=_videoReferenceWorkspace'),'the primary action must exist before the workspace renders');
  assert.match(html,/if\(VIDEO_TAB==='overview'\)return`\$\{showBusinessSwitcher\?rBizBar\(\):''\}<div id="video-workspace" class="ref-owner-page">\$\{overview\}<\/div>`/);
  for(const token of ['ref-workspace-topbar','ref-case-main','ref-case-rail','ref-subcase-table','ref-chat-panel','ref-finance-panel'])assert.ok(html.includes(token),token);
});

test('opening either video case area always clears a remembered legacy tab',()=>{
  assert.match(html,/if\(\['videoedit','videohaken'\]\.includes\(V\)&&VIDEO_TAB!=='overview'\)\{\s*VIDEO_TAB='overview';\s*sessionStorage\.setItem\('mc_video_tab',VIDEO_TAB\);/);
  assert.match(html,/if\(nextView==='videoedit'\|\|nextView==='videohaken'\)\{\s*VIDEO_TAB='overview';VIDEO_RENDER_LIMIT=50;\s*sessionStorage\.setItem\('mc_video_tab',VIDEO_TAB\);/);
});

test('reference workspace preserves existing edit and financial destinations',()=>{
  assert.match(html,/onclick="\$\{esc\(click\)\}">編集<\/button>/);
  assert.doesNotMatch(html,/onclick="\$\{click\}"/);
  assert.match(html,/class="ref-subcase-row" onclick="\$\{esc\(subClick\)\}"/);
  assert.doesNotMatch(html,/class="ref-subcase-row" onclick="\$\{subClick\}"/);
  assert.match(html,/onclick="setVideoTab\('manage-profit'\)">利益ページを開く/);
  assert.match(html,/const managementTabs=_isScopedVideoDirectorAccess\(\)\?\[\]:BIZ_CFG\[biz\]\.tabs/);
  assert.match(html,/\$\{_isOwner\(\)\?`<section class="ref-finance-panel"/);
  assert.match(html,/const subClick=sub\._portalChildJobId\?/);
});

test('case action strings are HTML-escaped before becoming inline handlers',()=>{
  assert.match(html,/click=j\._source==='portal'\?`openPortalJobModal\(\$\{JSON\.stringify\(j\._portalUid\)\},\$\{JSON\.stringify\(sourceJobId\)\}\)`/);
  assert.match(html,/class="video-job-main" onclick="\$\{esc\(click\)\}"/);
  assert.match(html,/video-material-card-action" onclick="\$\{esc\(openMaterials\(-1\)\)\}"/);
});

test('every legacy case page stays available inside the new white and yellow shell',()=>{
  assert.match(html,/function _videoReferenceTabs\(tabs\)/);
  assert.match(html,/class="ref-global-tabs" aria-label="案件管理ページ"/);
  assert.match(html,/ref-workspace ref-renderer-workspace/);
  assert.match(html,/BIZ_CFG\[biz\]\.tabs\.filter\(k=>k!=='board'&&_canOpenProjectTab\(k\)\)\.map\(k=>\[`manage-\$\{k\}`/);
  for(const route of ['board','profit','payment','completed','worker'])assert.match(html,new RegExp(`${route}:rProj`,''),route);
  assert.match(css,/\.ref-global-tabs\{[^}]*display:flex;[^}]*overflow:visible/);
  assert.match(css,/\.ref-renderer-main\{min-width:0;/);
});

test('global case navigation is icon-led but remains unambiguous and accessible',()=>{
  for(const route of ['manage-board','manage-profit','manage-payment','manage-completed','manage-worker'])assert.ok(html.includes(`'${route}':`),route);
  assert.match(html,/data-tooltip="\$\{esc\(name\)\}" \$\{VIDEO_TAB===key\?'aria-current="page"':''\}/);
  assert.match(html,/aria-label="\$\{esc\(name\)\}" title="\$\{esc\(name\)\}"/);
  assert.match(html,/<span class="ref-tab-label" aria-hidden="true">\$\{esc\(short\)\}<\/span>/);
  assert.match(html,/function _videoReferenceTabIcon\(key\)/);
  assert.match(html,/class="ref-more-tabs-menu"/);
  assert.match(css,/\.ref-primary-tabs>button,\.ref-more-tabs>summary[^}]*min-height:/);
  assert.match(css,/data-tooltip[^}]*focus-visible/);
  assert.match(css,/\.ref-tab-label\{[^}]*font-size:9px/);
  assert.match(html,/function _videoReferenceTopbar\(tabs=\[\]\)/);
  assert.match(html,/class="ref-topbar-module" title="移動するページを選択"/);
  assert.match(html,/<select aria-label="移動するページを選択" onchange="setVideoTab\(this\.value\)"/);
  assert.match(html,/_videoReferenceTopbar\(tabs\)/);
});

test('reference workspace has bounded desktop and narrow mobile grids',()=>{
  assert.match(css,/\.ref-workspace-body\{display:grid;grid-template-columns:minmax\(0,1fr\) 330px/);
  assert.match(css,/@media\(max-width:980px\)\{\.ref-workspace-body\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?\.ref-case-grid,\.ref-case-rail\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css,/\.ref-workspace,.ref-case-main,.ref-case-rail,.ref-panel,[^}]*\.ref-renderer-content\{max-width:100%;min-width:0\}/);
});
