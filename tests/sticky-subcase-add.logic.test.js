const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const editor=fs.readFileSync(path.join(root,'editor-features.js'),'utf8');
const manager=fs.readFileSync(path.join(root,'manager-features.js'),'utf8');

function assertStickyAdd(source,{scrollClass,listId,footerClass,action,formStart,formEnd}){
  const start=source.indexOf(formStart),end=source.indexOf(formEnd,start);
  assert.ok(start>=0&&end>start,'form source must exist');
  const form=source.slice(start,end);
  assert.ok(form.indexOf(scrollClass)<form.indexOf(listId));
  assert.ok(form.indexOf(listId)<form.indexOf(footerClass));
  assert.match(form,new RegExp(`${footerClass}[^]*${action}`));
  assert.match(source,new RegExp(`\\.${scrollClass}\\{[^}]*overflow-y:auto[^}]*overflow-x:hidden`));
  assert.match(source,new RegExp(`\\.${footerClass}\\{[^}]*position:sticky[^}]*bottom:0`));
  assert.match(source,new RegExp(`\\.${footerClass} \\.btn\\{[^}]*min-height:44px`));
}

test('editor dispatch form keeps an in-scroll sticky child-case add action',()=>{
  assertStickyAdd(editor,{
    scrollClass:'dispatch-subcase-scroll',
    listId:'new-dispatch-subcases',
    footerClass:'dispatch-subcase-add',
    action:'editorAddDispatchSubcase\\(\\)',
    formStart:'function jobFormExtended()',
    formEnd:'function dispatchSubcaseRowHtml',
  });
  assert.match(editor,/dispatch-subcase-add \.btn\{[^}]*width:100%/);
});

test('manager board form keeps an in-scroll sticky child-case add action',()=>{
  assertStickyAdd(manager,{
    scrollClass:'manager-board-subcase-scroll',
    listId:'mb-subcase-list',
    footerClass:'manager-board-subcase-add',
    action:'managerAddBoardSubcase\\(\\)',
    formStart:'function boardFormHtml(editors)',
    formEnd:'function manualFormHtml',
  });
  assert.match(manager,/function boardFormHtml\(editors\)\{\s*ensureManagerResponsiveStyles\(\)/);
  assert.match(manager,/@media\(max-width:700px\)\{[^]*manager-board-subcase-add \.btn\{min-height:48px/);
});
