const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');
const css=fs.readFileSync(path.resolve(__dirname,'..','app-ui.css'),'utf8');

function evaluateFunction(name,endName,expression){
  const start=html.indexOf(`function ${name}(`),end=html.indexOf(`\nfunction ${endName}(`,start),context={};
  assert.ok(start>=0&&end>start,`${name} source exists`);
  vm.createContext(context);
  vm.runInContext(`${html.slice(start,end)}\nthis.result=${expression};`,context);
  return JSON.parse(JSON.stringify(context.result));
}

test('calendar tab is available for both video businesses and uses the shared draft selector',()=>{
  assert.match(html,/tabs:\['board','calendar','deadline','listing'/);
  assert.equal((html.match(/tabs:\['board','calendar','deadline','listing'/g)||[]).length,2);
  assert.match(html,/calendar:rProjCalendar/);
  assert.match(html,/\['board','manage-calendar','manage-priority','manage-profit'/);
  assert.match(html,/'manage-calendar':'<path/);
  assert.match(html,/function _caseScheduleToggle\([\s\S]*aria-label="表示する初稿日"/);
  assert.match(html,/function rProjCalendar\(\)[\s\S]*_caseScheduleRows\(field\)/);
  assert.match(html,/function rProjPriority\(\)[\s\S]*_caseScheduleRows\(field\)/);
});

test('calendar grid covers a complete month including leap day',()=>{
  const days=evaluateFunction('_caseCalendarMonthShift','setCaseCalendarMonth',"_caseCalendarDays('2028-02')");
  assert.equal(days.length%7,0);
  assert.ok(days.includes('2028-02-29'));
  assert.equal(days.filter(Boolean).length,29);
});

test('schedule rows include every active parent and child but exclude completed records',()=>{
  const source=[
    {id:'legacy',biz:'edit',status:'進行中',editorDraftDate:'2026-09-02',subtasks:[{id:'s1',status:'未着手',editorDraftDate:'2026-09-03'},{id:'s2',status:'完了',editorDraftDate:'2026-09-04'}]},
    {id:'done',biz:'edit',status:'完了',editorDraftDate:'2026-09-01',subtasks:[]},
    {id:'aggregate',biz:'edit',status:'進行中',_aggregateParent:true,editorDraftDate:'',subtasks:[{id:'p1',status:'進行中',editorDraftDate:'2026-09-05',_portalChildJobId:'p1'}]},
    {id:'other',biz:'haken',status:'進行中',editorDraftDate:'2026-09-02',subtasks:[]},
  ];
  const result=evaluateFunction('_caseScheduleRows','_caseScheduleOpenAction',`_caseScheduleRows('editorDraftDate','edit',${JSON.stringify(source)})`);
  assert.deepEqual(result.map(row=>row.type==='sub'?row.sub.id:row.job.id),['legacy','s1','p1']);
});

test('calendar and priority CSS keep all entries accessible on desktop and narrow screens',()=>{
  assert.match(css,/\.case-calendar-scroll\{[^}]*overflow-x:auto/);
  assert.match(css,/\.case-calendar-items\{display:grid/);
  assert.match(css,/\.case-calendar-unset-list\{display:grid/);
  assert.match(css,/\.priority-table\{[^}]*min-width:760px/);
  assert.doesNotMatch(html,/case-calendar-items[\s\S]{0,500}\.slice\(/);
});
