(function(){
  'use strict';
  const WRITE_ALLOWLIST=new Set(['task.set_done','task.set_priority']);
  const READ_ALLOWLIST=new Set(['tasks','jobs','pipeline','teamKgis','teamKpis']);
  const PINNED_BRIDGE_ORIGIN='__AI_BRIDGE_ORIGIN__';
  let currentUser=null,currentApp='',connected=false,lastError='';

  function normalizeEndpoint(raw){
    try{
      const url=new URL(String(raw||''));
      const local=(url.hostname==='127.0.0.1'||url.hostname==='localhost')&&url.protocol==='http:';
      if((url.protocol!=='https:'&&!local)||url.username||url.password||url.search||url.hash)return'';
      return (url.origin+url.pathname).replace(/\/$/,'');
    }catch(_){return'';}
  }
  function endpoint(){
    const meta=document.querySelector('meta[name="ai-bridge-url"]');
    const configured=normalizeEndpoint(meta&&meta.content);
    const pinned=normalizeEndpoint(PINNED_BRIDGE_ORIGIN);
    return configured&&configured===pinned?pinned:'';
  }
  async function token(){
    if(!currentUser)throw new Error('google_login_required');
    return currentUser.getIdToken(false);
  }
  async function request(path,options){
    const base=endpoint();
    if(!base)throw new Error('ai_bridge_not_configured');
    const headers=Object.assign({'Authorization':'Bearer '+await token(),'Content-Type':'application/json'},options&&options.headers||{});
    const response=await fetch(base+path,Object.assign({},options||{},{headers,cache:'no-store',credentials:'omit'}));
    let body={};try{body=await response.json();}catch(_){}
    if(!response.ok)throw new Error(body.error||('ai_bridge_http_'+response.status));
    return body;
  }
  function badge(){
    const text=!currentUser?'':!endpoint()?'AI接続: 未設定':connected?'AI接続: 認証済み':lastError?'AI接続: 停止':'AI接続: 確認中';
    ['auth-ui','mob-auth-ui'].forEach(id=>{
      const root=document.getElementById(id);if(!root)return;
      let el=root.querySelector('.ai-bridge-status');
      if(!text){if(el)el.remove();return;}
      if(!el){el=document.createElement('div');el.className='ai-bridge-status';el.style.cssText='font-size:10px;margin-top:5px;color:var(--t3)';root.appendChild(el);}
      el.textContent=text;
      el.style.color=connected?'var(--green)':lastError?'var(--red)':'var(--t3)';
    });
  }
  async function connect(user,appName){
    currentUser=user||null;currentApp=appName||'';connected=false;lastError='';badge();
    if(!currentUser||!endpoint())return false;
    try{await request('/v1/session',{method:'POST',body:'{}'});connected=true;}
    catch(error){lastError=String(error&&error.message||error);console.warn('AI bridge:',lastError);}
    badge();return connected;
  }
  function disconnect(){currentUser=null;currentApp='';connected=false;lastError='';badge();}
  async function read(resource,options){
    if(!READ_ALLOWLIST.has(resource))throw new Error('resource_not_allowlisted');
    const body=Object.assign({app:currentApp,resource,limit:50},options||{});
    return request('/v1/read',{method:'POST',body:JSON.stringify(body)});
  }
  async function operate(operation,entityId,value,expectedHash,idempotencyKey){
    if(!WRITE_ALLOWLIST.has(operation))throw new Error('operation_not_allowlisted');
    const key=idempotencyKey||(crypto.randomUUID?crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)));
    return request('/v1/operations',{method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify({app:currentApp,operation,entity_id:entityId,value,expected_hash:expectedHash})});
  }
  async function undo(auditId,expectedHash,idempotencyKey){
    const key=idempotencyKey||(crypto.randomUUID?crypto.randomUUID():(Date.now()+'-'+Math.random().toString(36).slice(2)));
    return request('/v1/operations/'+encodeURIComponent(auditId)+'/undo',{method:'POST',headers:{'X-Idempotency-Key':key},body:JSON.stringify({expected_hash:expectedHash})});
  }
  function cloneJson(value){return value===undefined?undefined:JSON.parse(JSON.stringify(value));}
  function stable(value){
    if(Array.isArray(value))return'['+value.map(stable).join(',')+']';
    if(value&&typeof value==='object')return'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+stable(value[key])).join(',')+'}';
    return JSON.stringify(value);
  }
  function taskBody(task){const copy={};Object.keys(task||{}).forEach(key=>{if(key!=='updatedAt')copy[key]=task[key];});return copy;}
  function taskEqual(left,right){return stable(taskBody(left||{}))===stable(taskBody(right||{}));}
  function taskBaseline(tasks){const result=new Map();(tasks||[]).forEach(task=>{if(task&&task.id)result.set(String(task.id),cloneJson(task));});return result;}
  function stampChangedTasks(tasks,baseline,now){
    const at=Number(now)||Date.now(),changed=[];
    (tasks||[]).forEach(task=>{if(!task||!task.id)return;const id=String(task.id),prior=baseline&&baseline.get(id);if(!prior||!taskEqual(task,prior)){task.updatedAt=Math.max(at,(Number(task.updatedAt)||0)+1);changed.push(id);}});
    return changed;
  }
  function sameValue(left,right){return stable(left)===stable(right);}
  function mergeOne(local,remote,base){
    const result={},keys=new Set([...Object.keys(base||{}),...Object.keys(local||{}),...Object.keys(remote||{})]);keys.delete('updatedAt');
    const localAt=Number(local&&local.updatedAt)||0,remoteAt=Number(remote&&remote.updatedAt)||0;
    keys.forEach(key=>{
      const bh=Object.prototype.hasOwnProperty.call(base||{},key),lh=Object.prototype.hasOwnProperty.call(local||{},key),rh=Object.prototype.hasOwnProperty.call(remote||{},key);
      const bv=bh?base[key]:undefined,lv=lh?local[key]:undefined,rv=rh?remote[key]:undefined;
      const lc=lh!==bh||(lh&&!sameValue(lv,bv)),rc=rh!==bh||(rh&&!sameValue(rv,bv));
      let useLocal=false,useRemote=false;
      if(lc&&!rc)useLocal=true;else if(rc&&!lc)useRemote=true;else if(lc&&rc){if(lh&&rh&&sameValue(lv,rv))useRemote=true;else if(localAt>remoteAt)useLocal=true;else useRemote=true;}else if(rh)useRemote=true;else if(lh)useLocal=true;
      if(useLocal&&lh)result[key]=cloneJson(lv);else if(useRemote&&rh)result[key]=cloneJson(rv);
    });
    if(Object.prototype.hasOwnProperty.call(local||{},'updatedAt')||Object.prototype.hasOwnProperty.call(remote||{},'updatedAt')||Object.prototype.hasOwnProperty.call(base||{},'updatedAt'))result.updatedAt=Math.max(localAt,remoteAt,Number(base&&base.updatedAt)||0);
    return result;
  }
  function mergeTaskChanges(localTasks,remoteTasks,baseline){
    const local=taskBaseline(localTasks),remote=taskBaseline(remoteTasks),base=baseline||new Map(),ids=[];
    (localTasks||[]).concat(remoteTasks||[]).forEach(task=>{const id=task&&String(task.id||'');if(id&&ids.indexOf(id)<0)ids.push(id);});
    const merged=[];
    ids.forEach(id=>{const l=local.get(id),r=remote.get(id),b=base.get(id);if(l&&r)merged.push(mergeOne(l,r,b));else if(r)merged.push(cloneJson(r));else if(l&&(!b||!taskEqual(l,b)))merged.push(cloneJson(l));});
    return merged;
  }
  window.AIBridge=Object.freeze({connect,disconnect,read,operate,undo,taskBaseline,stampChangedTasks,mergeTaskChanges,get connected(){return connected;},get lastError(){return lastError;}});
})();
