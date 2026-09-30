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
    },{level:'error'});
    return true;
  }
  const api=Object.freeze({install,pressureError});
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.EditflowFirestorePressure=api;
})(typeof globalThis!=='undefined'?globalThis:this);
