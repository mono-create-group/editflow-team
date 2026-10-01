/* Catch Firestore stream pressure even while SDK write promises remain pending. */
(function(root){
  'use strict';
  const installed=new WeakSet();
  function pressureError(entry){
    if(!entry||!String(entry.type||'').includes('firestore'))return null;
    const message=String(entry.message||'');
    if(!/resource-exhausted|quota exceeded|maximum allowed queued writes/i.test(message))return null;
    return Object.assign(new Error(message),{code:'resource-exhausted'});
  }
  function install(sdk,handle){
    if(!sdk||typeof sdk.onLog!=='function'||typeof handle!=='function'||installed.has(sdk))return false;
    installed.add(sdk);
    let stopped=false;
    sdk.onLog(entry=>{
      const error=pressureError(entry);
      if(!error||stopped)return;
      stopped=true;
      // Leave the SDK log callback before stopping listeners/network. Never retry here.
      Promise.resolve().then(()=>handle(error,'Firestore stream pressure')).catch(error=>console.warn('Firestore pressure stop failed',error));
    },{level:'warn'});
    return true;
  }
  // One same-origin stop record is shared with personal EditFlow. It contains
  // no user data. Refreshing or opening another tab must not bypass a stop.
  function createCooldown({storage,events,now=Date.now,key='ef_sync_cloud_pause_v1'}={}){
    let memory=null;
    function read(){
      try{
        const saved=JSON.parse(storage?.getItem(key)||'null');
        if(saved&&Number.isFinite(saved.until)&&saved.until>(memory?.until||0))memory=saved;
      }catch(_){}
      return memory&&memory.until>now()?{...memory}:null;
    }
    function nextReset(at){
      // Firestore's daily quota resets around midnight in Los Angeles.
      // Search UTC minutes so both PST/PDT transitions use the correct date.
      const format=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit'});
      const day=format.format(at);
      let next=Math.floor(at/60000)*60000+60000;
      while(format.format(next)===day)next+=60000;
      return next+15*60000;
    }
    function pause(){
      const prior=read();
      if(prior)return prior;
      memory={until:nextReset(now()),reason:'quota'};
      try{storage?.setItem(key,JSON.stringify(memory));}catch(_){}
      return{...memory};
    }
    function restore(handle){
      const saved=read();if(!saved)return false;
      handle(Object.assign(new Error('Firestore quota cooldown is active'),{code:'resource-exhausted'}),'saved quota stop');
      return true;
    }
    function listen(handle){
      if(!events?.addEventListener)return()=>{};
      const callback=event=>{if(event.key===key&&event.newValue)restore(handle)};
      events.addEventListener('storage',callback);
      return()=>events.removeEventListener('storage',callback);
    }
    return Object.freeze({read,pause,restore,listen});
  }
  function browserCooldown(){
    let storage;try{storage=root.localStorage;}catch(_){}
    return createCooldown({storage,events:root});
  }
  // Key order is not a data edit. Array order remains significant unless the
  // caller explicitly normalizes a top-level ID-addressed shared collection.
  function stableJson(value){
    return JSON.stringify(value,function(_key,item){
      if(!item||typeof item!=='object'||Array.isArray(item))return item;
      return Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]]));
    });
  }
  function sharedSignature(data,decode){
    const normalized={};
    Object.keys(data).forEach(key=>{
      const raw=data[key],decoded=typeof raw==='string'?decode(raw):null;
      let value=decoded===null?raw:decoded;
      if(Array.isArray(value)&&value.every(row=>row&&typeof row==='object'&&row.id)){
        value=value.slice().sort((a,b)=>String(a.id).localeCompare(String(b.id)));
      }
      normalized[key]=value;
    });
    return stableJson(normalized);
  }
  const api=Object.freeze({install,pressureError,createCooldown,browserCooldown,stableJson,sharedSignature});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EditflowFirestorePressure=api;
})(typeof globalThis!=='undefined'?globalThis:this);
