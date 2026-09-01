const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function makeContext(){
  let seq=0;
  const ctx={
    console,URL,
    S:{salesLeads:[]},
    SL_BIZ:[{k:'hp',label:'HP制作',short:'HP'},{k:'app',label:'自動化ツール',short:'自動化'}],
    SL_BIZ_KEYS:['hp','app'],_slBiz:'hp',_slPage:0,V:'none',
    _slFilterStatus:'all',_slFilterGenre:'all',_slFilterBeautyAudience:'all',_slFilterBeautyService:'all',_slFilterSubgenre:'all',_slFilterRegion:'all',_slFilterContact:'all',_slFilterAssignee:'all',_slFilterOverlap:false,_slFilterApproach:'all',
    _slCloudLoaded:true,FB_USER:{uid:'owner'},
    uid:()=>`id-${++seq}`,today:()=> '2026-09-01',
    esc:v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;'),
    _slSplitCSVLine:line=>{const out=[];let cur='',quoted=false;for(let i=0;i<line.length;i++){const ch=line[i];if(ch==='"'){if(quoted&&line[i+1]==='"'){cur+='"';i++;}else quoted=!quoted;}else if(ch===','&&!quoted){out.push(cur);cur='';}else cur+=ch;}out.push(cur);return out;},
    slInPool:(l,biz)=>biz==='app',rSalesLeads:()=>'<div>base</div>',slSetBiz(){},
    slStatusOf:(l,biz)=>(l.biz?.[biz]?.s)||'未接触',slNextOf:(l,biz)=>(l.biz?.[biz]?.n)||'',slMemoOf:(l,biz)=>(l.biz?.[biz]?.m)||'',
    slBizObj:(l,biz)=>{l.biz=l.biz||{};return l.biz[biz]||(l.biz[biz]={s:'未接触',n:'',m:''});},
    save(){ctx.saved=(ctx.saved||0)+1;},render(){},toast(){},openModal(){},closeModal(){},document:{getElementById(){return null;}},
  };
  ctx.window=ctx;
  vm.createContext(ctx);
  const src=fs.readFileSync(path.join(__dirname,'..','sales-video-leads.js'),'utf8');
  vm.runInContext(src,ctx,{filename:'sales-video-leads.js'});
  return ctx;
}

test('video job CSV enforces price, count, official URL, and CapCut exclusion',()=>{
  const ctx=makeContext();
  const csv=[
    '区分,サービス,案件名,案件URL,1本単価,総報酬,本数,掲載日,応募期限,ソフト指定,業務内容,編集内容,必要スキル,募集状態,最終確認日',
    '新着,ココナラ,Premiere案件,https://coconala.com/job_matching/5240623,4000円,4000円,1本,2026-08-30,2026-09-09,Premiere Pro,ショート動画制作,カット・テロップ,Premiere Pro,募集中,2026-09-01',
    '新着,ココナラ,低単価,https://coconala.com/job_matching/1,2500円,2500円,1本,2026-08-30,2026-09-09,Premiere Pro,制作,編集,Premiere Pro,募集中,2026-09-01',
    '新着,ランサーズ,CapCut案件,https://www.lancers.jp/work/detail/2,5000円,5000円,1本,2026-08-30,2026-09-09,CapCut,制作,編集,CapCut,募集中,2026-09-01'
  ].join('\n');
  const parsed=ctx.SalesVideoLeads.parseCsv(csv);
  const result=ctx.SalesVideoLeads.upsert(parsed);
  assert.deepEqual({added:result.added,updated:result.updated,skipped:result.skipped},{added:1,updated:0,skipped:2});
  assert.equal(ctx.S.salesLeads.length,1);
  assert.equal(ctx.S.salesLeads[0].unitPrice,4000);
  assert.equal(ctx.S.salesLeads[0].videoCount,'1本');
  assert.equal(ctx.S.salesLeads[0].service,'ココナラ');
  assert.equal(ctx.S.salesLeads[0].biz.video.s,'新着');
});

test('same job URL updates facts without duplicating or overwriting workflow status',()=>{
  const ctx=makeContext();
  let result=ctx.SalesVideoLeads.upsert([{name:'案件A',jobUrl:'https://www.lancers.jp/work/detail/5594318',unitPrice:'3000',videoCount:'1本',software:'Premiere Pro',workContent:'制作',editContent:'カット',freshness:'新着'}]);
  assert.equal(result.added,1);
  ctx.S.salesLeads[0].biz.video.s='検討中';
  result=ctx.SalesVideoLeads.upsert([{name:'案件A 更新',jobUrl:'https://www.lancers.jp/work/detail/5594318#detail',unitPrice:'3500',videoCount:'2本',software:'DaVinci Resolve',workContent:'制作更新',editContent:'カット・テロップ',freshness:'継続'}]);
  assert.equal(result.updated,1);
  assert.equal(ctx.S.salesLeads.length,1);
  assert.equal(ctx.S.salesLeads[0].name,'案件A 更新');
  assert.equal(ctx.S.salesLeads[0].unitPrice,3500);
  assert.equal(ctx.S.salesLeads[0].biz.video.s,'検討中');
  assert.equal(ctx.slInPool(ctx.S.salesLeads[0],'video'),true);
  assert.equal(ctx.slInPool(ctx.S.salesLeads[0],'app'),false);
});

test('video sales-list page includes all requested report fields',()=>{
  const ctx=makeContext();
  ctx.SalesVideoLeads.upsert([{name:'ショート動画編集',jobUrl:'https://coconala.com/job_matching/5241190',unitPrice:'10000',totalReward:'10,000円',videoCount:'1本',postedAt:'2026-08-30',deadline:'2026-09-06',software:'Premiere Pro / Final Cut Pro',workContent:'継続ショート動画制作',editContent:'カット・テロップ・BGM',requiredSkills:'縦型動画編集',freshness:'新着',listingStatus:'募集中',lastCheckedAt:'2026-09-01'}]);
  ctx._slBiz='video';
  const html=ctx.rSalesLeads();
  for(const text of ['案件ページを開く','1本 10,000円','本数: 1本','掲載日: 2026-08-30','応募期限: 2026-09-06','ソフト指定:','業務内容:','編集内容:','必要スキル:'])assert.match(html,new RegExp(text));
});

test('owner shell and service worker load the video-lead extension on the same release',()=>{
  const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  assert.match(index,/const APP_VERSION='20260901-02';/);
  assert.match(index,/<script src="\.\/sales-video-leads\.js\?v=20260901-02"><\/script>/);
  assert.match(sw,/const CACHE='mcshanai-20260901-02';/);
  assert.match(sw,/'\.\/sales-video-leads\.js'/);
});
