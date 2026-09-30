'use strict';
(() => {
  const API_BASE='https://mono-editing-intake.mono-create-group.workers.dev/api/internal-admin';
  let host=null,instance=null,generation=0,ownerUid=null,loading=null;
  const scriptUrl=new URL('./editing-intake/',document.currentScript.src);
  const bundleVersion=new URL(document.currentScript.src).searchParams.get('v')||'fixture';
  function loadScript(name,mountOnly=false){return new Promise((resolve,reject)=>{const script=document.createElement('script');const url=new URL(name,scriptUrl);url.searchParams.set('v',bundleVersion);script.src=url.href;if(mountOnly)script.setAttribute('data-mount-only','');script.onload=resolve;script.onerror=()=>{script.remove();reject(Error('受付画面の読み込みに失敗しました。画面を開き直してください。'));};document.head.append(script);});}
  function stop(){generation++;instance?.dispose();instance=null;host?.remove();host=null;ownerUid=null;}
  async function renderInto(placeholder,{getUser,isOwner,onClose}){
    if(!isOwner()||!getUser()){stop();placeholder.textContent='オーナー専用の画面です。';return;}
    const uid=getUser().uid;
    if(host&&ownerUid===uid){placeholder.replaceWith(host);return;}
    stop();ownerUid=uid;const expected=++generation;
    host=document.createElement('div');host.id='editing-intake-native';placeholder.replaceWith(host);
    const root=host.attachShadow({mode:'open'});root.innerHTML='<p>編集受付を読み込んでいます。</p>';
    try{
      if(!loading)loading=Promise.all([loadScript('app.js',true),loadScript('presentation.js')]).catch(error=>{loading=null;throw error;});
      await loading;
      if(expected!==generation||!isOwner()||getUser()?.uid!==uid)return;
      root.innerHTML='<style>'+globalThis.MonoEditingIntakePresentation.css+'</style>'+globalThis.MonoEditingIntakePresentation.html;
      instance=globalThis.MonoEditingIntake.mount({root,apiBase:API_BASE,onClose,onUnauthorized:()=>{const current=host,parent=host?.parentNode;stop();if(current){current.textContent='編集受付へのアクセスを確認できません。ログイン状態とオーナー権限を確認し、画面を開き直してください。';parent?.append(current);}},getAuthHeaders:async()=>{
        const user=getUser();
        if(expected!==generation||!isOwner()||!user||user.uid!==uid){stop();throw Error('オーナーのログインを確認してください。');}
        const token=await user.getIdToken();
        if(expected!==generation||!isOwner()||getUser()?.uid!==uid){stop();throw Error('ログイン状態が変更されました。');}
        return {Authorization:'Bearer '+token};
      }});
    }catch(error){if(expected===generation){root.textContent=error.message;ownerUid=null;}}
  }
  globalThis.EditflowEditingIntake={renderInto,stop};
})();
