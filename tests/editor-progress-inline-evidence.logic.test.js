const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const editor = fs.readFileSync(path.resolve(__dirname, '..', 'editor.html'), 'utf8');

test('quick initial/revision submission blocks locally before a write when evidence URL is missing', () => {
  assert.match(editor, /function quickJobStatus\(jid,status\).*\['初稿提出済み','修正稿提出済み'\]\.includes\(status\)&&!safeUrl\(evidence\).*初稿・修正稿を提出する前に/);
  assert.match(editor, /function setJobInlineError\(jid,message\)/);
  assert.match(editor, /quickField=\$\('#quick-evidence-field-'\+jid\),evidence=quickField&&!quickField\.hidden\?\$\('#quick-evidence-'\+jid\):\$\('#job-evidence-'\+jid\)/);
  assert.match(editor, /入力内容は保持されています/);
  assert.match(editor, /const milestoneError=editorMilestoneError\(previousStatus,status,evidence\);if\(milestoneError\)\{setJobInlineError/);
});
