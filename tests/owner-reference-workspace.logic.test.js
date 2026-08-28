const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'owner-yellow-ui.css'),'utf8');

test('owner overview renders a case-detail workspace instead of KPI-only cards',()=>{
  assert.match(html,/function _videoReferenceWorkspace\(\{biz,all,active,title,addJobAction\}\)/);
  assert.match(html,/const overview=_videoReferenceWorkspace\(\{biz,all,active,title,addJobAction\}\)/);
  assert.ok(html.indexOf('const addJobAction=')<html.indexOf('const overview=_videoReferenceWorkspace'),'the primary action must exist before the workspace renders');
  assert.match(html,/if\(VIDEO_TAB==='overview'\)return`\$\{showBusinessSwitcher\?rBizBar\(\):''\}<div id="video-workspace" class="ref-owner-page">\$\{overview\}<\/div>`/);
  for(const token of ['ref-workspace-topbar','ref-case-main','ref-case-rail','ref-subcase-table','ref-chat-panel','ref-finance-panel'])assert.ok(html.includes(token),token);
});

test('reference workspace preserves existing edit and financial destinations',()=>{
  assert.match(html,/onclick="\$\{click\}">編集<\/button>/);
  assert.match(html,/onclick="setVideoTab\('manage-profit'\)">利益ページを開く/);
  assert.match(html,/const managementTabs=_isScopedVideoDirectorAccess\(\)\?\[\]:BIZ_CFG\[biz\]\.tabs/);
  assert.match(html,/\$\{_isOwner\(\)\?`<section class="ref-finance-panel"/);
  assert.match(html,/const subClick=sub\._portalChildJobId\?/);
});

test('reference workspace has bounded desktop and narrow mobile grids',()=>{
  assert.match(css,/\.ref-workspace-body\{display:grid;grid-template-columns:minmax\(0,1fr\) 330px/);
  assert.match(css,/@media\(max-width:980px\)\{\.ref-workspace-body\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css,/@media\(max-width:700px\)\{[\s\S]*?\.ref-case-grid,\.ref-case-rail\{grid-template-columns:minmax\(0,1fr\)\}/);
  assert.match(css,/\.ref-workspace,.ref-case-main,.ref-case-rail,.ref-panel\{max-width:100%;min-width:0\}/);
});
