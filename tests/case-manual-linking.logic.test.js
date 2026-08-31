const fs=require('node:fs');
const path=require('node:path');
const test=require('node:test');
const assert=require('node:assert/strict');

const root=path.resolve(__dirname,'..');
const manager=fs.readFileSync(path.join(root,'manager-features.js'),'utf8');
const editor=fs.readFileSync(path.join(root,'editor-features.js'),'utf8');
const rules=fs.readFileSync(path.join(root,'firestore.rules'),'utf8');
const index=fs.readFileSync(path.join(root,'index.html'),'utf8');

test('manager case form selects only safe manual metadata and supplies common fallback fields',()=>{
  assert.match(manager,/function selectableManualsForCase\(targetUid='',openAll=false\)/);
  assert.match(manager,/openAll\?audience==='all'/);
  assert.match(manager,/allowedUids\.includes\(targetUid\)/);
  assert.match(manager,/window\.managerSelectableManualsForCase=.*\{id,title,required,audience\}/);
  assert.doesNotMatch(manager,/managerSelectableManualsForCase=.*body/);
  assert.match(manager,/mb-parent-manuals/);
  assert.match(manager,/mb-parent-caution/);
  assert.match(manager,/mb-subcase-manuals/);
  assert.match(manager,/mb-subcase-caution/);
  assert.match(manager,/manualIds=combinedManualIds\(parentManualIds,subcase\.manualIds\)/);
  assert.match(manager,/caution=subcase\.caution\|\|parentCaution/);
});

test('editor transports case links without embedding manuals and shows cautions before instructions',()=>{
  assert.match(editor,/manualIds:Array\.isArray\(board\.manualIds\)\?board\.manualIds\.slice\(0,20\)/);
  assert.match(editor,/parentManualIds:Array\.isArray\(board\.parentManualIds\)\?board\.parentManualIds\.slice\(0,20\)/);
  assert.match(editor,/function caseCautionHtml\(job\)/);
  assert.match(editor,/function caseManualCardsHtml\(job\)/);
  assert.match(editor,/\$\{caseCautionHtml\(selected\)\}\$\{caseManualCardsHtml\(selected\)\}<section class="application-instructions">/);
  assert.match(editor,/\$\{caseCautionHtml\(j\)\}\$\{caseManualCardsHtml\(j\)\}\$\{j\.instructions/);
  assert.doesNotMatch(editor,/caseManualCardsHtml[\s\S]{0,900}manual\.body/);
});

test('rules cap manual references and caution text on board and portal cases',()=>{
  assert.match(rules,/function validCaseManualLinks\(data\)/);
  assert.match(rules,/data\.get\('manualIds', \[\]\)\.size\(\) <= 20/);
  assert.match(rules,/data\.get\('parentManualIds', \[\]\)\.size\(\) <= 20/);
  assert.match(rules,/data\.get\('caution', ''\)\.size\(\) <= 2000/);
  assert.match(rules,/data\.get\('parentCaution', ''\)\.size\(\) <= 2000/);
  assert.match(rules,/validCaseManualLinks\(request\.resource\.data\)/);
  const ownerUpdate=rules.slice(rules.indexOf('allow update: if owner()',rules.indexOf('match /editor_jobs/{jobId}')),rules.indexOf('allow delete: if false',rules.indexOf('match /editor_jobs/{jobId}')));
  assert.match(ownerUpdate,/'manualIds','parentManualIds','caution','parentCaution'/);
  assert.match(ownerUpdate,/validCaseManualLinks\(request\.resource\.data\)/);
});

test('legacy parent and child editors preserve linked manuals and highlight cautions before notes',()=>{
  assert.match(index,/id="j-manuals" multiple/);
  assert.match(index,/id="j-caution" maxlength="2000"/);
  assert.match(index,/class="j-sub-manuals" multiple/);
  assert.match(index,/class="j-sub-caution" maxlength="2000"/);
  assert.match(index,/manualIds,parentManualIds,caution,parentCaution/);
  const detail=index.slice(index.indexOf('function _videoSubcaseDetailHtml('),index.indexOf('function openLegacySubcaseDetail('));
  assert.ok(detail.indexOf('job-case-caution')<detail.indexOf('指示・メモ'));
});
