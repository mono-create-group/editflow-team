const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const manager=fs.readFileSync(path.join(root,'manager-features.js'),'utf8');

test('重複する動画管理画面は左メニューとモバイルドロワーからだけ除外する',()=>{
  assert.match(html,/const VIDEO_EMBEDDED_VIEW_IDS=new Set\(\['videohaken','videoclients','workers'\]\)/);
  assert.match(html,/const visible=cfg\.filter\(c=>!c\.hidden&&isViewAllowed\(c\.id\)&&!VIDEO_EMBEDDED_VIEW_IDS\.has\(c\.id\)\)/);
  assert.match(html,/const cfg=getNavCfg\(\)\.filter\(c=>!VIDEO_EMBEDDED_VIEW_IDS\.has\(c\.id\)\),cps=\[\]/);
  for(const id of ['videohaken','videoclients','workers'])assert.match(html,new RegExp(`\\{id:'${id}',label:`),`${id} route remains available`);
});

test('編集者派遣は編集代行画面の種類切替から開ける',()=>{
  assert.match(html,/onclick="setV\('videohaken'\)">編集者派遣<\/button>/);
  assert.match(html,/function _videoReferenceWorkspace\(\{biz,all,active,title,addJobAction,tabs,screenSwitch=''\}\)/);
  assert.match(html,/<div class="ref-overview-switch">\$\{screenSwitch\}<\/div>/);
});

test('編集者の主アイコンは編集者管理を開き、旧編集者別集計はその他へ残す',()=>{
  assert.match(html,/const coreKeys=tabs\.some\(\(\[key\]\)=>key==='manager-editors'\)\s*\?\['manage-board','manage-profit','manage-payment','manage-completed','manager-editors','manager-clients'\]/);
  assert.match(html,/'manager-editors':'編集者'/);
  assert.match(html,/'manager-clients':'顧客'/);
  assert.match(html,/'manage-worker':'編集者別'/);
});

test('編集者管理とクライアント・アカウント管理は編集代行内で開く',()=>{
  assert.match(html,/const embeddedManagerTabs=biz==='edit'&&\(_isOwner\(\)\|\|_isScopedVideoDirectorAccess\(\)\)\?\[\['manager-editors','編集者管理'\],\['manager-clients','クライアント・アカウント管理'\]\]:\[\]/);
  assert.match(html,/workspaceBody=typeof window\.managerVideoEditorsPage==='function'\?window\.managerVideoEditorsPage\(\):rWorkers\(\)/);
  assert.match(html,/workspaceBody=typeof window\.managerVideoClientsPage==='function'\?window\.managerVideoClientsPage\(\):rProjClients\(\)/);
  assert.match(manager,/window\.managerVideoEditorsPage=editorPage/);
  assert.match(manager,/window\.managerVideoClientsPage=clientsPage/);
});
