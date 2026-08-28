const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manager = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');

test('contract relation controls have labeled fields and a 44px minimum touch target', () => {
  assert.match(manager, /class="manager-relation-row"/);
  assert.match(manager, /<span>契約区分<\/span><select id="rel-kind-/);
  assert.match(manager, /<span>担当ディレクター<\/span><select id="rel-dir-/);
  assert.match(manager, /class="btn btn-g manager-relation-save"/);
  assert.match(manager, /\.manager-relation-field select\{min-height:44px/);
  assert.match(manager, /\.manager-relation-save\{min-height:44px/);
  assert.match(manager, /\.manager-relation-field\{[^}]*font-size:14px[^}]*color:#475569/);
});

test('contract relation controls stack into one readable column on a phone', () => {
  const css = manager.slice(manager.indexOf('.manager-relation-row'), manager.indexOf('`;document.head.appendChild(style)'));
  assert.match(css, /@media\(max-width:700px\)\{\.manager-relation-row\{grid-template-columns:1fr/);
  assert.match(css, /\.manager-relation-field select,\.manager-relation-save\{width:100%;min-height:48px/);
});

test('editor status cards explain both a normal state and the next action for setup issues', () => {
  const start = manager.indexOf('function editorStateGuidance');
  const end = manager.indexOf('function rosterHtml', start);
  const body = manager.slice(start, end);
  assert.match(body, /<b>正常：<\/b>ログイン・役割・担当者の設定と、案件の読み込みが済んでいます/);
  assert.match(body, /<b>次にすること：<\/b>ログイン申請を承認してください/);
  assert.match(body, /<b>次にすること：<\/b>既存の編集者情報と紐付けてください/);
  assert.match(manager, /class="manager-state-guidance"/);
  assert.match(manager, /\.manager-state-guidance\{[^}]*color:#475569[^}]*font-size:14px/);
});

test('safe external relation archive and restore flow remains present', () => {
  const start = manager.indexOf('async function saveRelation');
  const end = manager.indexOf('function catalogTargetsForClient', start);
  const body = manager.slice(start, end);
  assert.match(body, /settlementRows=await settlementRowsForPortal\(uid\)/);
  assert.match(body, /await archiveSettlementRows\(settlementRows\)/);
  assert.match(body, /await restoreSettlementRows\(settlementRows\)/);
});
