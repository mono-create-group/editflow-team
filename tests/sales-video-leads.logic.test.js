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
  assert.equal(ctx.S.salesLeads[0].platformFeeAmount,880);
  assert.equal(ctx.S.salesLeads[0].netUnitPrice,3120);
  assert.equal(ctx.S.salesLeads[0].biz.video.s,'新着');
});

test('Threads leads accept unknown software and optional CapCut but reject CapCut-required work',()=>{
  const ctx=makeContext();
  const result=ctx.SalesVideoLeads.upsert([
    {name:'Threadsソフト未記載',jobUrl:'https://www.threads.com/@editor/post/abc123',unitPrice:'5000',videoCount:'1本',software:'未記載',workContent:'ショート動画編集',editContent:'カット・テロップ'},
    {name:'Threadsソフト不問',jobUrl:'https://threads.com/@editor/post/def456',unitPrice:'3000',videoCount:'月10本',software:'使用ソフト不問（CapCut・Premiere Pro等）',workContent:'ショート動画編集',editContent:'カット・テロップ'},
    {name:'CapCut必須',jobUrl:'https://www.threads.com/@editor/post/ghi789',unitPrice:'5000',videoCount:'1本',software:'CapCut必須',workContent:'ショート動画編集',editContent:'カット・テロップ'}
  ]);
  assert.deepEqual({added:result.added,updated:result.updated,skipped:result.skipped},{added:2,updated:0,skipped:1});
  assert.deepEqual(Array.from(ctx.S.salesLeads,lead=>lead.service),['Threads','Threads']);
  assert.equal(ctx.S.salesLeads[0].platformFeeRate,null);
  assert.equal(ctx.S.salesLeads[0].platformFeeAmount,null);
  assert.equal(ctx.S.salesLeads[0].netUnitPrice,null);
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

test('platform fees and estimated take-home are calculated from official rates',()=>{
  const ctx=makeContext();
  const coco={...ctx.SalesVideoLeads.fee('ココナラ',3792)};
  assert.equal(coco.rate,.22);
  assert.equal(coco.feeAmount,834);
  assert.equal(coco.netAmount,2958);
  assert.match(coco.source,/coconala-support\.zendesk\.com/);
  const lancers={...ctx.SalesVideoLeads.fee('ランサーズ',5000)};
  assert.equal(lancers.rate,.165);
  assert.equal(lancers.feeAmount,825);
  assert.equal(lancers.netAmount,4175);
  assert.match(lancers.source,/lancers\.jp/);
  const threads={...ctx.SalesVideoLeads.fee('Threads',5000)};
  assert.equal(threads.known,false);
  assert.equal(threads.feeAmount,null);
  assert.equal(threads.netAmount,null);
});

test('Lancers instant payout shows the additional five percent without allocating a per-withdrawal bank fee',()=>{
  const ctx=makeContext();
  const low={...ctx.SalesVideoLeads.instantPayout('ランサーズ',4175)};
  assert.equal(low.feeAmount,209);
  assert.equal(low.netAfterInstantFee,3966);
  assert.equal(low.eligibleAsSingle,false);
  assert.equal(low.bankFeeRakuten,110);
  assert.equal(low.bankFeeOther,550);
  const eligible={...ctx.SalesVideoLeads.instantPayout('ランサーズ',12000)};
  assert.equal(eligible.netAfterInstantFee,11400);
  assert.equal(eligible.eligibleAsSingle,true);
  assert.equal(ctx.SalesVideoLeads.instantPayout('ココナラ',12000),null);
});

test('video sales-list page includes all requested report fields',()=>{
  const ctx=makeContext();
  ctx.SalesVideoLeads.upsert([{name:'ショート動画編集',jobUrl:'https://coconala.com/job_matching/5241190',unitPrice:'10000',totalReward:'10,000円',videoCount:'1本',postedAt:'2026-08-30',deadline:'2026-09-06',software:'Premiere Pro / Final Cut Pro',workContent:'継続ショート動画制作',editContent:'カット・テロップ・BGM',requiredSkills:'縦型動画編集',freshness:'新着',listingStatus:'募集中',lastCheckedAt:'2026-09-01'}]);
  ctx._slBiz='video';
  const html=ctx.rSalesLeads();
  for(const text of ['案件ページを開く','提示 1本 10,000円','手数料差引後（見込） 7,800円','プラットフォーム手数料: 2,200円（22%）','本数: 1本','掲載日: 2026-08-30','応募期限: 2026-09-06','ソフト指定:','業務内容:','編集内容:','必要スキル:'])assert.match(html,new RegExp(text));
});

test('Lancers card includes instant payout estimate, aggregate eligibility, and separate bank fees',()=>{
  const ctx=makeContext();
  ctx.SalesVideoLeads.upsert([{name:'ランサーズ案件',jobUrl:'https://www.lancers.jp/work/detail/5594638',unitPrice:'5000',totalReward:'5000円',videoCount:'1本',software:'Premiere Pro',workContent:'制作',editContent:'編集'}]);
  ctx._slBiz='video';
  const html=ctx.rSalesLeads();
  for(const text of ['即日払い5%差引後（概算・振込手数料前） 3,966円','即日払い手数料（概算）: 209円','この案件単体では金額条件未達です','楽天銀行110円／その他銀行550円'])assert.match(html,new RegExp(text));
});

test('Threads cards expose the source filter and never invent a take-home amount',()=>{
  const ctx=makeContext();
  ctx.SalesVideoLeads.upsert([{name:'Threads案件',jobUrl:'https://www.threads.com/@editor/post/abc123',unitPrice:'5000',totalReward:'1本5,000円〜',videoCount:'継続',software:'未記載',workContent:'ショート動画制作',editContent:'カット・テロップ'}]);
  ctx._slBiz='video';
  const html=ctx.rSalesLeads();
  for(const text of ['Threads <strong>1</strong>','setServiceFilter(\'Threads\')','取引条件・手数料は投稿者へ個別確認','Threadsは募集投稿の提示額です'])assert.ok(html.includes(text));
  assert.doesNotMatch(html,/手数料差引後（見込）/);
});

test('owner shell and service worker load the video-lead extension on the same release',()=>{
  const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const sw=fs.readFileSync(path.join(__dirname,'..','sw.js'),'utf8');
  assert.match(index,/const APP_VERSION='20260905-02';/);
  assert.match(index,/<script src="\.\/sales-video-leads\.js\?v=20260905-02"><\/script>/);
  assert.match(sw,/const CACHE='mcshanai-20260905-02';/);
  assert.match(sw,/'\.\/sales-video-leads\.js'/);
});
