const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const html=fs.readFileSync(path.resolve(__dirname,'..','index.html'),'utf8');

function functionSource(name){
  const start=html.indexOf(`function ${name}(`);
  assert.notEqual(start,-1,`${name} must be defined`);
  const asyncStart=html.lastIndexOf('async ',start);
  const from=asyncStart>=0&&asyncStart+6===start?asyncStart:start;
  let depth=0,opened=false;
  for(let i=start;i<html.length;i+=1){
    if(html[i]==='{'){depth+=1;opened=true;}
    if(html[i]==='}'&&opened&&--depth===0)return html.slice(from,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

test('the submission review list lets a manager approve, or approve and submit to the client, in place',()=>{
  const view=functionSource('rVideoSubmissions');
  assert.match(view,/item\.canManage\?`<button[^>]+onclick="advancePortalWorkflow\(\$\{JSON\.stringify\(item\.portalUid\)\},\$\{JSON\.stringify\(item\.id\)\},'directorApprove'\)">D確認OK<\/button>/);
  assert.match(view,/'directorApproveAndSubmit'\)">D確認OK・先方へ提出済み<\/button>/);
  assert.match(view,/D確認と先方提出を一度に記録し、進捗が「先方確認中」になります/);
  assert.match(functionSource('_videoSubmissionReviewItems'),/canManage:typeof _canManagePortalWorkflow==='function'\?!!_canManagePortalWorkflow\(job\):false/);
});

test('approve-and-submit is a chain of the two rule-validated transitions and stops at D確認OK on failure',()=>{
  const flow=functionSource('advancePortalWorkflow');
  const chain=flow.slice(flow.indexOf("if(action==='directorApproveAndSubmit')"),flow.indexOf("if(action==='clientApproved'&&_editorOwnsPortalCompletion(j))"));
  assert.match(chain,/_videoWorkflow\(j\)\.stage!=='director_review'/);
  assert.match(chain,/const approved=await advancePortalWorkflow\(portalUid,id,'directorApprove'/);
  assert.match(chain,/if\(approved!==true\)return approved;/);
  assert.match(chain,/return advancePortalWorkflow\(portalUid,id,'clientSubmitted'/);
  assert.match(flow,/Object\.assign\(j,data\);\s*let legacyProjectionSaved=true;/,'the local job is updated before the second transition reads it');
  assert.match(flow,/PORTAL_WORKFLOW_ACTION_PENDING\.delete\(pendingKey\);\s*return true;\s*\}$/);
  assert.doesNotMatch(chain,/fbDb\.batch\(\)/,'the chain never writes a combined transition that the rules would reject');
});

test('the same action is offered in the case modal and in the linked-subcase status list',()=>{
  assert.match(html,/\['directorApprove','D確認OKにする'\],\['directorApproveAndSubmit','D確認OK・先方へ提出済み'\]/);
  assert.match(functionSource('_portalWorkflowActionsForJob'),/\['directorApproveAndSubmit','D確認OK・先方へ提出済み（先方確認中）'\]/);
});
