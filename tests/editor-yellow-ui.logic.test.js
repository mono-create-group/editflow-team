const fs=require('fs');
const path=require('path');
const css=fs.readFileSync(path.join(__dirname,'..','editor-yellow-ui.css'),'utf8');
const required=[
  'body.editor-yellow-ui', '.editor-yellow-ui .accept-howto', '.editor-yellow-ui .claim-button',
  '.editor-yellow-ui .editor-case-group', '.editor-yellow-ui .board-card',
  '.editor-yellow-ui .editor-nav-mobile', '.editor-yellow-ui .invoice-card',
  '.editor-yellow-ui .login-card', '.editor-yellow-ui .job-detail',
  '.editor-yellow-ui .dispatch-create', '.editor-yellow-ui .dm-shell',
  '.editor-yellow-ui .dm-person.active', '.editor-yellow-ui .dm-compose',
  '.editor-yellow-ui .device-notification-card', '.editor-yellow-ui .push-setup-banner',
  '.editor-yellow-ui .brand-logo', '.editor-yellow-ui .editor-sidebar-brand',
  '.editor-yellow-ui .editor-more-popover', '.editor-yellow-ui .application-workspace',
  '.editor-yellow-ui .application-list', '.editor-yellow-ui .application-detail', '.editor-yellow-ui .application-confirm',
  '.editor-yellow-ui .notification-item', '.editor-yellow-ui .notification-read',
  '.editor-yellow-ui .availability-day .availability-time',
  '@media(max-width:760px)', '@media(max-width:375px)'
];
for(const selector of required){if(!css.includes(selector))throw new Error(`missing yellow editor selector: ${selector}`)}
if(!css.includes('background:#ffca0a'))throw new Error('reference yellow primary token must be used');
if(!css.includes('color:#171a1f'))throw new Error('ink token must be used');
for(const legacy of ['#7c3aed','#6d28d9','#5b21b6','#faf5ff','#ede9fe']){
  if(css.toLowerCase().includes(legacy))throw new Error(`legacy purple token remains in yellow stylesheet: ${legacy}`);
}
if(/(^|\n)\s*(?:body|\.btn|\.card)\s*\{/m.test(css))throw new Error('all editor yellow rules must remain scoped');
for(const token of ['.editor-yellow-ui .brand-logo','background:#fff;box-shadow:0 1px 3px rgba(32,33,36,.03)','.editor-yellow-ui .claim-button{min-height:46px;border:1px solid #ffca0a']){
  if(!css.includes(token))throw new Error(`reference application styling missing: ${token}`);
}
if(css.includes('box-shadow:3px 3px 0 #171a1f!important'))throw new Error('application CTA must not use the former black hard shadow');
const features=fs.readFileSync(path.join(__dirname,'..','editor-features.js'),'utf8');
for(const token of ['function selectBoardJob(jid)','function filterEditorBoardSearch(value)','function applicationIcon(name)','function hydrateEditorVisualMarks()','class="application-workspace"','class="application-confirm"','application-resource-jump','onclick="claimBoardJob(\'${esc(selected.id)}\')"']){
  if(!features.includes(token))throw new Error(`application workspace behavior missing: ${token}`);
}
if(!css.includes('.application-subcase-row.application-subcase-head{display:none!important}'))throw new Error('mobile application table header must be hidden');
if(!css.includes('grid-template-columns:repeat(2,minmax(0,1fr))!important'))throw new Error('mobile availability time inputs must remain a two-column pair');
if(!css.includes('.application-confirm li>span:after{content:"✓"'))throw new Error('application checks must use compact visual marks');
for(const token of ['.application-info dt .application-icon','.notification-visual-icon','.availability-bulk .btn.primary']){
  if(!css.includes(token))throw new Error(`visual icon or yellow CTA styling missing: ${token}`);
}
if(!css.includes('@media(max-width:420px){.editor-yellow-ui .application-resource-jump'))throw new Error('mobile resource jump must become a 44px icon button');
if(!css.includes('.application-confirm .claim-button{order:1;min-height:48px'))throw new Error('mobile application CTA must follow the confirmation heading');
console.log('editor yellow UI static logic test: ok');
