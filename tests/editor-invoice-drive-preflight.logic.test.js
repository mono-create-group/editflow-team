const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');

function sourceOf(name) {
  const start = editor.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must be defined`);
  let depth = 0, opened = false;
  for (let i = start; i < editor.length; i += 1) {
    if (editor[i] === '{') { depth += 1; opened = true; }
    if (editor[i] === '}' && opened && --depth === 0) return editor.slice(start, i + 1);
  }
  assert.fail(`${name} must close`);
}

test('invoice upload is a true two-step flow: connection first, then a visible user-triggered picker', () => {
  const picker = sourceOf('requestInvoiceUpload');
  assert.match(picker, /await preflightInvoiceDrive\(iid\)/);
  assert.doesNotMatch(picker, /\.click\(/);
  assert.match(picker, /render\(\);toast\('Driveに接続しました。次に「原本を選択」を押してください'\)/);
  assert.match(editor, /style="display:\$\{driveToken\?'inline-flex':'none'\}"/);
  assert.match(editor, /Driveを接続/);
  assert.match(editor, /原本を選択/);
  assert.match(editor, /Driveを再接続/);
  assert.match(editor, /scope:DRIVE_SCOPE/);
});

test('Drive preflight has one explicit reconnect path and preserves the narrow Drive scope', () => {
  const preflight = sourceOf('preflightInvoiceDrive');
  assert.match(preflight, /await driveConnect\(\)/);
  assert.match(preflight, /invoiceDriveReconnectId=iid/);
  assert.match(preflight, /toast\(invoiceDriveError\(error\)\)/);
  assert.match(editor, /const DRIVE_SCOPE='https:\/\/www\.googleapis\.com\/auth\/drive\.file'/);
});

test('Drive 403 errors distinguish permission, API setup, and quota instead of mislabeling all as permissions', () => {
  const message = sourceOf('invoiceDriveError');
  assert.match(message, /dailylimitexceeded\|userratelimitexceeded\|ratelimitexceeded\|quota/);
  assert.match(message, /accessnotconfigured\|drive api has not been used\|service disabled/);
  assert.match(message, /insufficientpermissions\|insufficientfilepermissions\|forbidden\|permission/);
});
