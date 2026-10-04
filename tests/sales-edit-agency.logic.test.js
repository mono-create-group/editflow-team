const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const videoJs=fs.readFileSync(path.join(__dirname,'..','sales-video-leads.js'),'utf8');
// 2026-10-03 会長確定文面(改変禁止)。2026-10-04 会長指示で「最初の1本は無料トライアル」の3行を追加。index.html の SL_EDIT_DM_TEXT と1文字でも違えば失敗させる。
const CONFIRMED_DM=`初めまして！

動画編集を行なっている
mono.create 中村と申します。

もし現在
「編集に使う時間がない」
「クオリティが安定しない」
「投稿本数を上げたい」
などのお悩みがあれば、一度お話をお聞かせください！

最初の1本は
トライアルとして
無料で編集させていただきます！

お問い合わせは以下のサイトからお願いいたします！
単価やポートフォリオ等がご覧になれます。
https://mono-create-group.github.io/lp/sample-hp/creators-list/client.html

ご検討のほどよろしくお願いいたします！`;

function extractFunction(name){
  const start=html.indexOf('function '+name+'(');
  assert.notEqual(start,-1,name+' must exist in index.html');
  let depth=0;
  for(let i=html.indexOf('{',start);i<html.length;i++){
    if(html[i]==='{')depth++;
    if(html[i]==='}'&&--depth===0)return html.slice(start,i+1);
  }
  throw new Error('unterminated '+name);
}
function extractConst(name){
  const start=html.indexOf('const '+name+'=');
  assert.notEqual(start,-1,name+' must exist in index.html');
  return html.slice(start,html.indexOf(';\n',start)+1);
}
function poolContext(){
  const ctx=vm.createContext({_slBiz:'hp',_slSrc:'store'});
  const wrapper=videoJs.slice(videoJs.indexOf('const _baseInPool=slInPool;'),videoJs.indexOf('if(!SL_BIZ.some('));
  vm.runInContext([extractConst('SL_FOOD_GENRES'),extractFunction('slSrcOf'),extractFunction('slInPool'),
    "const VIDEO_BIZ='video';const VIDEO_SRC='video-job';",videoJs.match(/function _videoLeadIs\(l\)\{[^\n]*\}/)[0],wrapper].join('\n'),ctx);
  return ctx;
}

test('edit agency tab is appended without changing the existing business tabs',()=>{
  const ctx=vm.createContext({});
  vm.runInContext(`${extractConst('SL_BIZ')}\nthis.keys=SL_BIZ.map(b=>b.k);this.edit=SL_BIZ.find(b=>b.k==='edit');`,ctx);
  assert.deepEqual(Array.from(ctx.keys),['hp','consult','app','shift','edit']);
  assert.deepEqual({...ctx.edit},{k:'edit',label:'編集代行',short:'編集'});
});

test('編集代行 leads appear only in the edit tab and the edit tab shows nothing else',()=>{
  const ctx=poolContext();
  const tabs=[['hp','store'],['hp','threads'],['consult','store'],['app','store'],['shift','store'],['video','store']];
  const creator={segment:'編集代行',instagram:'@creator_a'};
  const foodCreator={segment:'編集代行',genre:'カフェ',hp:'なし',instagram:'@creator_b'};
  for(const lead of [creator,foodCreator]){
    for(const [biz,src] of tabs){ctx._slBiz=biz;ctx._slSrc=src;assert.equal(ctx.slInPool(lead),false,`${biz}/${src}`);}
    for(const src of ['any','store','threads'])assert.equal(ctx.slInPool(lead,'hp',src),false);
    assert.equal(ctx.slInPool(lead,'edit','any'),true);
    ctx._slBiz='edit';ctx._slSrc='store';assert.equal(ctx.slInPool(lead),true);
  }
  const others=[{genre:'美容室',hp:'なし'},{genre:'ラーメン',hp:'なし'},{src:'threads'},{segment:'AI顧問',genre:'工務店',hp:'なし'},{segment:'編集',genre:'美容室',hp:'なし'},{src:'video-job'}];
  for(const lead of others){
    assert.equal(ctx.slInPool(lead,'edit','any'),false);
    ctx._slBiz='edit';assert.equal(ctx.slInPool(lead),false);
  }
  // 既存タブの振り分けは従来どおり
  assert.equal(ctx.slInPool({genre:'美容室',hp:'なし'},'hp','store'),true);
  assert.equal(ctx.slInPool({genre:'ラーメン'},'shift','any'),true);
  assert.equal(ctx.slInPool({segment:'AI顧問'},'consult','any'),true);
  assert.equal(ctx.slInPool({src:'threads'},'hp','threads'),true);
  assert.equal(ctx.slInPool({genre:'整体',hp:'あり'},'app','any'),true);
});

function dmContext(lead,biz){
  const els={},out={modal:null,clip:[]};
  const ctx=vm.createContext({
    S:{salesLeads:[lead],salesLeadExclusions:[]},_slBiz:biz,OWNER_NAME:'中村航汰',URL,
    document:{getElementById:id=>els[id]||(els[id]={value:'',style:{}})},
    navigator:{clipboard:{writeText:text=>{out.clip.push(text);return Promise.resolve();}}},
    _isOwner:()=>true,save(){},toast(){},openModal:h=>{out.modal=h;},
    esc:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    slStatusOf:(l,b)=>(l.biz?.[b||biz]?.s)||'未接触'
  });
  vm.runInContext([extractConst('SL_EDIT_DM_TEXT'),extractConst('SL_IG_RESERVED'),extractFunction('slIgHandle'),extractFunction('slPrepareOwnerDm'),extractFunction('slCopyOwnerDm')].join('\n'),ctx);
  return {ctx,out};
}
const textarea=modal=>modal.match(/<textarea id="sl-owner-dm-text"[^>]*>([\s\S]*?)<\/textarea>/)[1];

test('編集代行 DM uses the chairman-confirmed text character for character',async()=>{
  const lead={id:'e1',name:'クリエイターA',instagram:'@creator_a',segment:'編集代行',biz:{edit:{s:'未接触',n:'',m:''}},contacts:[]};
  const {ctx,out}=dmContext(lead,'edit');
  assert.equal(vm.runInContext('SL_EDIT_DM_TEXT',ctx),CONFIRMED_DM);
  ctx.slPrepareOwnerDm('e1');
  assert.equal(textarea(out.modal),CONFIRMED_DM);
  assert.match(out.modal,/Instagramなし→削除/);
  assert.doesNotMatch(out.modal,/公式サイトあり/);
  ctx.document.getElementById('sl-owner-dm-text').value=textarea(out.modal);
  ctx.slCopyOwnerDm('e1');
  await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(out.clip,[CONFIRMED_DM]);
  assert.equal(lead.dmDraft,CONFIRMED_DM);
});

test('other segments keep the empty draft and both exclusion buttons',()=>{
  const lead={id:'h1',name:'店舗A',instagram:'@shop_a',genre:'美容室',hp:'なし',biz:{hp:{s:'未接触',n:'',m:''}},contacts:[]};
  const {ctx,out}=dmContext(lead,'hp');
  ctx.slPrepareOwnerDm('h1');
  assert.equal(textarea(out.modal),'');
  assert.match(out.modal,/公式サイトあり→削除/);
  assert.match(out.modal,/Instagramなし→削除/);
});

test('Instagram post/reel URLs and scheme-less URLs never become DM handles',()=>{
  const ctx=vm.createContext({URL});
  vm.runInContext([extractConst('SL_IG_RESERVED'),extractFunction('slIgHandle')].join('\n'),ctx);
  const cases={
    '@creator_a':'creator_a','creator.a':'creator.a','https://www.instagram.com/creator_a/':'creator_a',
    'https://instagram.com/creator_a?igsh=x':'creator_a','https://www.instagram.com/@creator_a':'creator_a',
    'instagram.com/creator_a':'creator_a','www.instagram.com/creator_a/':'creator_a','m.instagram.com/creator_a':'creator_a',
    'https://www.instagram.com/p/AbC123/':null,'https://www.instagram.com/reel/AbC123/':null,'https://www.instagram.com/reels/AbC/':null,
    'https://www.instagram.com/stories/creator_a/1/':null,'https://www.instagram.com/explore/locations/1/':null,'https://www.instagram.com/tv/x/':null,
    'https://www.instagram.com/accounts/login/?next=%2Fshop%2F':null,'https://www.instagram.com/direct/inbox/':null,
    'instagram.com':null,'instagram.com/p/AbC/':null,'lit.link/creator':null,'https://lit.link/creator':null,'@p':null,'':null
  };
  for(const [value,want] of Object.entries(cases))assert.equal(ctx.slIgHandle(value),want,value);
});

// 営業リスト区画の実コード+動画編集案件ラッパーを、使い捨てのダミーデータで動かす(本番のSには触れない)
function salesSectionContext(leads){
  const start=html.indexOf('// ===営業リスト===');
  const end=html.indexOf('// ===MIGRATION: 既存leadへ地域を後付け===');
  assert.ok(start>0&&end>start,'sales section markers must exist');
  const out={answers:[],prompts:[],toasts:[],saves:0};
  let seq=0;
  const ctx=vm.createContext({
    S:{salesLeads:leads,signins:[],settings:{},salesDirectives:[],hpFees:[],salesSites:[]},
    ADMIN_EMAILS:[],OWNER_NAME:'中村航汰',FB_USER:null,V:'none',console,URL,window:{},navigator:{},
    document:{getElementById:()=>null,addEventListener(){}},
    esc:s=>String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'),
    today:()=>'2026-10-03',uid:()=>'new-'+(++seq),save:()=>{out.saves++;},render(){},toast:(m,k)=>out.toasts.push([m,k]),openModal(){},closeModal(){},
    prompt:msg=>{out.prompts.push(msg);return out.answers.shift();},
    myRole:()=>'full',_myEmail:()=>'',tpFmtDate:x=>String(x),_isOwner:()=>true
  });
  vm.runInContext(html.slice(start,end),ctx,{filename:'sales-section.js'});
  vm.runInContext(videoJs,ctx,{filename:'sales-video-leads.js'});
  const view=(biz,search='')=>vm.runInContext(`_slBiz=${JSON.stringify(biz)};_slSrc='store';_slPage=0;_slSearch=${JSON.stringify(search)};rSalesLeads()`,ctx);
  return {ctx,out,view};
}
const rowNames=page=>[...page.matchAll(/<div class="sl-name">([^<]*)<\/div>/g)].map(m=>m[1]);

test('manual add in the edit tab creates a 編集代行 lead that stays in the edit tab',()=>{
  const existing={id:'e0',name:'既存クリエイター',instagram:'@creator_a',segment:'編集代行',biz:{edit:{s:'未接触',n:'',m:''}},contacts:[]};
  const {ctx,out,view}=salesSectionContext([existing]);
  view('edit');
  out.answers.push('新規クリエイター','https://www.instagram.com/new_creator/?igsh=1');
  ctx.slAddManual();
  const added=ctx.S.salesLeads[1];
  assert.deepEqual(out.prompts,['アカウント名を入力:','Instagramの@ID またはプロフィールURL（任意）:']);
  assert.equal(added.segment,'編集代行');
  assert.equal(added.instagram,'@new_creator');
  assert.equal(added.region,'全国');
  assert.deepEqual({...added.biz.edit},{s:'未接触',n:'',m:''});
  assert.equal(added.biz.hp,undefined);
  assert.deepEqual(['hp','consult','app','shift','video','edit'].filter(b=>ctx.slInPool(added,b,'any')),['edit']);
  // 投稿URL・既存と同じIG(大文字小文字は無視)は追加しない
  out.answers.push('投稿URL','https://www.instagram.com/p/xyz/');ctx.slAddManual();
  out.answers.push('重複','@CREATOR_A');ctx.slAddManual();
  assert.equal(ctx.S.salesLeads.length,2);
  // 他事業タブの手動追加は従来どおり(HP事業のレコード)
  view('app');
  out.answers.push('店舗X');ctx.slAddManual();
  const store=ctx.S.salesLeads[2];
  assert.equal(store.segment,undefined);
  assert.deepEqual(Object.keys(store.biz),['hp']);
});

test('edit tab hides store-only panels and searches by Instagram @ID',()=>{
  const leads=[
    {id:'h1',name:'美容室A',genre:'美容室',hp:'なし',instagram:'@salon_a',address:'北海道旭川市',biz:{hp:{s:'未接触',n:'',m:''}},contacts:[]},
    {id:'e1',name:'クリエイターA',instagram:'@creator_a',segment:'編集代行',biz:{edit:{s:'未接触',n:'',m:''}},contacts:[]},
    {id:'e2',name:'クリエイターB',instagram:'https://www.instagram.com/creator_b/',segment:'編集代行',biz:{edit:{s:'DM済み',n:'',m:''}},contacts:[]}
  ];
  const {out,view}=salesSectionContext(leads);
  const page=view('edit');
  assert.deepEqual(rowNames(page),['クリエイターA','クリエイターB']);
  assert.doesNotMatch(page,/CSVインポート|slImportCSV|slClearAll/);
  assert.doesNotMatch(page,/地域別まとめ|IGあり・HPなし|>HP: /);
  assert.match(page,/placeholder="アカウント名・@IDで検索…"/);
  assert.deepEqual([...page.matchAll(/slPrepareOwnerDm\('([^']+)'\)/g)].map(m=>m[1]),['e1']);
  assert.deepEqual(rowNames(view('edit','@creator_b')),['クリエイターB']);
  // HP制作タブは従来どおり(店舗向けの表示・CSV取込あり、編集代行リードは出ない)
  const hp=view('hp');
  assert.deepEqual(rowNames(hp),['美容室A']);
  assert.match(hp,/CSVインポート/);
  assert.match(hp,/IGあり・HPなし/);
  assert.match(hp,/>HP: なし</);
  assert.equal(out.saves,0);
});
