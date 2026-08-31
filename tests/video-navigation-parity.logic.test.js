const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.join(__dirname,'..');
const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const css=fs.readFileSync(path.join(root,'app-ui.css'),'utf8');

test('オーナーと旧台帳スタッフは全管理タブを再利用し、ディレクターは開かない',()=>{
  assert.match(html,/const managementTabs=_isScopedVideoDirectorAccess\(\)\?\[\]:BIZ_CFG\[biz\]\.tabs\.filter\(k=>k!=='board'&&_canOpenProjectTab\(k\)\)\.map\(k=>\[`manage-\$\{k\}`/);
  assert.match(html,/\{board:rProjBoard,deadline:rProjDeadline,listing:rProjListing,list:\(\)=>rProjList\(clients\),clients:rProjClients,profit:rProjProfit,payment:rProjPayment,invoice:rProjInvoice,completed:rProjCompleted,worker:rProjWorker,priority:rProjPriority\}\[managementKey\]/);
  assert.match(html,/VIDEO_TAB==='legacy'\)\{VIDEO_TAB='manage-board'/);
});

test('利益と支払いは既存のオーナー権限判定を通して表示する',()=>{
  assert.match(html,/function _canOpenProjectTab\(tab\)\{[\s\S]*tab==='profit'\|\|tab==='payment'[\s\S]*return _canViewFinancials\(\)/);
  assert.match(html,/function rProjProfit\(\)\{\s*if\(!_canViewFinancials\(\)\)/);
  assert.match(html,/function rProjPayment\(\)\{\s*if\(!_canViewFinancials\(\)\)/);
});

test('旧画面と同じ全ボタンを折り返して常時表示できる',()=>{
  for(const label of ['📋 ボード','📅 今日明日期限','📢 掲載中','📄 リスト','👥 クライアント一覧','💰 利益','💳 支払い','✅ 完了済み','📊 優先度表'])assert.ok(html.includes(label),label);
  assert.match(css,/\.app-view-tabs\.app-view-tabs-parity\{[^}]*flex-wrap:wrap;[^}]*overflow:visible/);
  assert.match(html,/＋ クライアント追加[\s\S]*＋ 案件追加/);
});
