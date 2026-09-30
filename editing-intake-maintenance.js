'use strict';
(function(global){
 const API='https://mono-editing-intake.mono-create-group.workers.dev/api/internal-admin';
 function mount({auth,document,fetchImpl=global.fetch}){
  const el=id=>document.getElementById(id);let user=null,generation=0,busy=false,enabled=false,controller=null;
  const notice=text=>{el('notice').textContent=text;};
  function render(){el('login').hidden=!!user;el('health').hidden=!user;el('prepare').hidden=!user||!enabled;for(const id of ['login','health','prepare'])el(id).disabled=busy;}
  async function api(path,method='GET'){
   if(!user)throw Error('ログインを確認してください。');
   const current=user,epoch=generation,token=await current.getIdToken();
   if(epoch!==generation||user!==current)throw Error('ログイン状態が変更されました。');
   const response=await fetchImpl(API+path,{method,credentials:'omit',signal:controller.signal,headers:{Authorization:'Bearer '+token,...(method==='POST'?{'Content-Type':'application/json'}:{})},...(method==='POST'?{body:'{}'}:{})});
   if(epoch!==generation||user!==current)throw Error('ログイン状態が変更されました。');
   if(!response.ok){if(response.status===401||response.status===403){enabled=false;render();}throw Error(response.status===401?'ログインを確認してください。':response.status===403?'社内アプリの管理者のみ利用できます。':'接続を確認できませんでした。時間をおいて再度お試しください。');}
   const result=await response.json();if(epoch!==generation||user!==current)throw Error('ログイン状態が変更されました。');return result;
  }
  async function run(action){if(busy)return;busy=true;render();try{await action();}catch(error){notice(error.message);}finally{busy=false;render();}}
  el('login').onclick=()=>run(async()=>{await auth.signInWithPopup(new global.firebase.auth.GoogleAuthProvider());});
  el('health').onclick=()=>run(async()=>{const r=await api('/drive/health');if(r.connectionVerified!==true||typeof r.canAddChildren!=='boolean'||typeof r.broadAccess!=='boolean')throw Error('接続確認の結果を取得できませんでした。');notice((r.canAddChildren?'素材保管先への接続とフォルダ追加権限を確認しました。':'接続できましたが、フォルダ追加権限がありません。')+(r.broadAccess?' 保管先には広い共有権限があります。非公開の保管先を確認してください。':'')+' お客様の共有アクセスは別途確認が必要です。');});
  el('prepare').onclick=()=>run(async()=>{if(!enabled)throw Error('この操作は現在利用できません。');const r=await api('/maintenance/drive-root','POST');if(typeof r.rootFolderId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(r.rootFolderId))throw Error('保管先の確認結果を取得できませんでした。');notice('非公開の素材保管先を確認しました。保管先ID: '+r.rootFolderId+'。受付先の切り替えはまだ行っていません。');});
  const unsubscribe=auth.onAuthStateChanged(async next=>{generation++;const epoch=generation;controller?.abort();controller=new AbortController();user=next;enabled=false;render();if(!user){notice('ログインを確認してください。');return;}try{const config=await api('/config');if(epoch!==generation)return;enabled=config.driveRootProvisionAvailable===true;notice('素材保管先の接続確認');render();}catch(error){if(epoch===generation)notice(error.message);}});
  render();return {dispose(){generation++;controller?.abort();unsubscribe();user=null;enabled=false;render();}};
 }
 global.EditingIntakeMaintenance={mount};
})(globalThis);
