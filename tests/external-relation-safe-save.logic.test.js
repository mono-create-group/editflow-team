const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const manager = fs.readFileSync(path.join(__dirname, '..', 'manager-features.js'), 'utf8');

function functionBody(name, nextName) {
  const start = manager.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `missing ${name}`);
  const end = manager.indexOf(`async function ${nextName}`, start + 1);
  return manager.slice(start, end === -1 ? manager.length : end);
}

test('changing a direct editor to external checks every portal job before access is changed', () => {
  const body = functionBody('saveRelation', 'syncDirectCatalogForClient');
  assert.match(body, /isMovingToExternal=kind==='external'&&editor\?\.editorKind!=='external'/);
  assert.match(body, /settlementRows=await settlementRowsForPortal\(uid\)/);
  assert.match(body, /金額4項目だけをオーナー専用の保管先へ移します/);
  assert.match(body, /案件名・進み具合・履歴は変わりません/);
  assert.match(body, /if\(settlementRows\.length\)await archiveSettlementRows\(settlementRows\)/);
  assert.ok(body.indexOf('archiveSettlementRows(settlementRows)') < body.indexOf("collection('access').doc(uid).set"), 'archive must finish before external access is saved');
});

test('cancelling the confirmation leaves the access record untouched', () => {
  const body = functionBody('saveRelation', 'syncDirectCatalogForClient');
  const confirmIndex = body.indexOf('confirm(`${editorName(editor)}さんの案件');
  const saveIndex = body.indexOf("collection('access').doc(uid).set");
  assert.ok(confirmIndex !== -1 && saveIndex !== -1 && confirmIndex < saveIndex);
  assert.match(body, /if\(settlementRows\.length&&!confirm\([\s\S]*?\)\)return;/);
});

test('failed relation save restores only the four payment fields and keeps case details/history', () => {
  const body = functionBody('saveRelation', 'syncDirectCatalogForClient');
  assert.match(body, /await restoreSettlementRows\(settlementRows\)/);
  assert.match(manager, /const externalSettlementKeys=\['ownPay','payableApproved','payableApprovedAt','payableMonth'\]/);
  const restore = functionBody('restoreSettlementRows', 'saveRelation');
  assert.match(restore, /settlementPatch\(job\)/);
  assert.doesNotMatch(restore, /title:|status:|history:|messages/);
});

test('manual migration and relation conversion use the same chunked archive helper', () => {
  const migration = functionBody('migrateExternalSettlement', 'invoiceAction');
  assert.match(migration, /settlementRowsForPortals\(state\.editors\.filter/);
  assert.match(migration, /await archiveSettlementRows\(rows\)/);
  const archive = functionBody('archiveSettlementRows', 'restoreSettlementRows');
  assert.match(archive, /offset\+=150/);
  assert.match(archive, /external_compensation_archive/);
  assert.match(archive, /settlementPatch\(job,\{remove:true\}\)/);
});
