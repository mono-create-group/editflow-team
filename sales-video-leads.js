(function(){
const VIDEO_BIZ='video';
const VIDEO_SRC='video-job';
const VIDEO_STATUSES=['新着','検討中','応募予定','応募済み','受注','見送り','募集終了'];
const VIDEO_PLATFORM_FEES={
  'ココナラ':{rate:.22,label:'22%',source:'https://coconala-support.zendesk.com/hc/ja/articles/230180287-%E8%B2%A9%E5%A3%B2%E6%99%82%E3%81%AE%E6%89%8B%E6%95%B0%E6%96%99%E3%81%AB%E3%81%A4%E3%81%84%E3%81%A6'},
  'ランサーズ':{rate:.165,label:'16.5%',source:'https://www.lancers.jp/faq/A1034/936'}
};
let _videoLeadStatus='all';
let _videoLeadService='all';
let _videoLeadSearch='';

function _videoLeadIs(l){return !!l&&l.src===VIDEO_SRC;}
function _videoLeadUrl(value){
  try{
    const u=new URL(String(value||'').trim());
    if(!/^https?:$/.test(u.protocol))return'';
    if(!/(^|\.)(coconala\.com|lancers\.jp)$/i.test(u.hostname))return'';
    u.hash='';
    return u.toString();
  }catch(_){return'';}
}
function _videoLeadAmount(value){
  const n=parseInt(String(value||'').replace(/[^0-9]/g,''),10);
  return Number.isFinite(n)?n:0;
}
function _videoLeadFee(service,unitPrice){
  const amount=Number(unitPrice||0);
  const profile=VIDEO_PLATFORM_FEES[service];
  if(!profile||!Number.isFinite(amount)||amount<=0)return{rate:0,label:'未確認',feeAmount:0,netAmount:0,source:''};
  const feeAmount=Math.round(amount*profile.rate);
  return{rate:profile.rate,label:profile.label,feeAmount,netAmount:amount-feeAmount,source:profile.source};
}
function _videoLeadCapCutText(x){
  return [x.software,x.workContent,x.editContent].map(v=>String(v||'')).join(' ');
}
function _videoLeadNormalize(raw){
  const jobUrl=_videoLeadUrl(raw.jobUrl);
  const unitPrice=_videoLeadAmount(raw.unitPrice);
  const name=String(raw.name||'').trim();
  const videoCount=String(raw.videoCount||'').trim();
  if(!jobUrl)return{ok:false,reason:'ココナラ／ランサーズの案件URLがありません'};
  if(!name)return{ok:false,reason:'案件名がありません'};
  if(unitPrice<3000)return{ok:false,reason:'1本単価が3,000円未満または未確認です'};
  if(!videoCount)return{ok:false,reason:'本数が未確認です'};
  if(/cap\s*cut|キャップカット/i.test(_videoLeadCapCutText(raw)))return{ok:false,reason:'CapCut指定を含みます'};
  const service=/lancers\.jp/i.test(jobUrl)?'ランサーズ':'ココナラ';
  const fee=_videoLeadFee(service,unitPrice);
  const flowStatus=VIDEO_STATUSES.includes(raw.flowStatus)?raw.flowStatus:'新着';
  const now=new Date().toISOString();
  return{ok:true,value:{
    id:raw.id||uid(),src:VIDEO_SRC,name,service,
    jobUrl,unitPrice,platformFeeRate:fee.rate,platformFeeAmount:fee.feeAmount,netUnitPrice:fee.netAmount,
    platformFeeSource:fee.source,totalReward:String(raw.totalReward||'').trim(),videoCount,
    postedAt:String(raw.postedAt||'').trim(),deadline:String(raw.deadline||'').trim(),
    software:String(raw.software||'未確認').trim()||'未確認',
    workContent:String(raw.workContent||'').trim(),editContent:String(raw.editContent||'').trim(),
    requiredSkills:String(raw.requiredSkills||'').trim(),
    listingStatus:String(raw.listingStatus||'募集中').trim()||'募集中',
    freshness:String(raw.freshness||'新着').trim()||'新着',
    lastCheckedAt:String(raw.lastCheckedAt||today()).trim()||today(),
    biz:raw.biz||{video:{s:flowStatus,n:'',m:''}},contacts:Array.isArray(raw.contacts)?raw.contacts:[],
    createdAt:raw.createdAt||now,updatedAt:now
  }};
}
function _videoLeadParseCsv(text){
  const lines=String(text||'').split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length)return[];
  let start=/^(区分|新着・継続)[,\t]/.test(lines[0])?1:0;
  const out=[];
  for(let i=start;i<lines.length;i++){
    const c=_slSplitCSVLine(lines[i]).map(s=>s.trim());
    const[freshness,service,name,jobUrl,unitPrice,totalReward,videoCount,postedAt,deadline,software,workContent,editContent,requiredSkills,listingStatus,lastCheckedAt]=c;
    out.push({freshness,service,name,jobUrl,unitPrice,totalReward,videoCount,postedAt,deadline,software,workContent,editContent,requiredSkills,listingStatus,lastCheckedAt});
  }
  return out;
}
function _videoLeadUpsert(rawRows){
  if(typeof _slCloudLoaded!=='undefined'&&typeof FB_USER!=='undefined'&&FB_USER&&!_slCloudLoaded){
    return{added:0,updated:0,skipped:rawRows.length,errors:['営業リストのクラウド読込が完了していません']};
  }
  if(!Array.isArray(S.salesLeads))S.salesLeads=[];
  const byUrl=new Map(S.salesLeads.filter(l=>_videoLeadIs(l)&&!l.deleted).map(l=>[_videoLeadUrl(l.jobUrl),l]));
  let added=0,updated=0,skipped=0;
  const errors=[];
  rawRows.forEach((raw,index)=>{
    const n=_videoLeadNormalize(raw);
    if(!n.ok){skipped++;errors.push(`${index+1}行目: ${n.reason}`);return;}
    const incoming=n.value;
    const current=byUrl.get(incoming.jobUrl);
    if(current){
      const keepBiz=current.biz&&current.biz.video?current.biz.video:null;
      const keepCreated=current.createdAt;
      Object.assign(current,incoming,{id:current.id,createdAt:keepCreated||incoming.createdAt});
      if(keepBiz){if(!current.biz)current.biz={};current.biz.video=keepBiz;}
      current.deleted=false;
      updated++;
    }else{
      S.salesLeads.push(incoming);byUrl.set(incoming.jobUrl,incoming);added++;
    }
  });
  if(added||updated)save();
  return{added,updated,skipped,errors};
}
function _videoLeadMoney(n){return Number(n||0).toLocaleString('ja-JP')+'円';}
function _videoLeadStatusColor(s){
  if(s==='受注')return'var(--green)';
  if(s==='見送り'||s==='募集終了')return'var(--red)';
  if(s==='応募済み')return'var(--blue)';
  if(s==='検討中'||s==='応募予定')return'var(--amber)';
  return'var(--purple)';
}
function _videoLeadSorted(){
  const q=_videoLeadSearch.toLowerCase();
  return (S.salesLeads||[]).filter(l=>_videoLeadIs(l)&&!l.deleted)
    .filter(l=>_videoLeadStatus==='all'||slStatusOf(l,VIDEO_BIZ)===_videoLeadStatus)
    .filter(l=>_videoLeadService==='all'||l.service===_videoLeadService)
    .filter(l=>!q||[l.name,l.service,l.workContent,l.editContent,l.software,l.requiredSkills].some(v=>String(v||'').toLowerCase().includes(q)))
    .sort((a,b)=>{
      const fresh=(b.freshness==='新着'?1:0)-(a.freshness==='新着'?1:0);
      if(fresh)return fresh;
      const posted=String(b.postedAt||'').localeCompare(String(a.postedAt||''));
      return posted||Number(b.unitPrice||0)-Number(a.unitPrice||0);
    });
}
function _videoLeadCards(rows){
  if(!rows.length)return`<div class="empty"><div class="empty-icon">🎬</div><div class="empty-title">条件に合う動画編集案件はありません</div></div>`;
  return rows.map(l=>{
    const st=slStatusOf(l,VIDEO_BIZ);
    const fee=_videoLeadFee(l.service,l.unitPrice);
    const statusBtns=VIDEO_STATUSES.map(s=>`<button class="sl-status-btn" onclick="SalesVideoLeads.setStatus('${l.id}','${s}')" style="opacity:${st===s?1:.42};border-color:${_videoLeadStatusColor(s)};color:${_videoLeadStatusColor(s)}">${s}</button>`).join('');
    return`<article class="sl-row sl-lead-row" style="align-items:flex-start">
      <div class="sl-row-body" style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:7px;flex-wrap:wrap">
          <span class="badge bk">${esc(l.service||'未確認')}</span>
          <span class="badge" style="color:${l.freshness==='新着'?'var(--purple)':'var(--t2)'};border:1px solid var(--border)">${esc(l.freshness||'継続')}</span>
          <span class="badge" style="color:${_videoLeadStatusColor(st)};border:1px solid currentColor">${esc(st)}</span>
          <span style="font-size:11px;color:var(--t3)">${esc(l.listingStatus||'募集中')}</span>
        </div>
        <div class="sl-name" style="margin-top:7px">${esc(l.name||'')}</div>
        <div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:7px;font-size:12px">
          <strong style="color:var(--green);font-size:14px">提示 1本 ${_videoLeadMoney(l.unitPrice)}</strong>
          <strong style="color:var(--blue);font-size:14px">手数料差引後（見込） ${_videoLeadMoney(fee.netAmount)}</strong>
          <span style="color:var(--t2)">プラットフォーム手数料: ${_videoLeadMoney(fee.feeAmount)}（${esc(fee.label)}）</span>
          <span style="color:var(--t2)">総報酬: ${esc(l.totalReward||'未確認')}</span>
          <span style="color:var(--t2)">本数: ${esc(l.videoCount||'未確認')}</span>
          <span style="color:var(--t2)">掲載日: ${esc(l.postedAt||'未確認')}</span>
          <span style="color:var(--t2)">応募期限: ${esc(l.deadline||'未確認')}</span>
        </div>
        <div style="margin-top:5px;font-size:10.5px;color:var(--t3)">差引後金額は提示単価からプラットフォーム手数料のみを控除した見込額です。振込手数料・源泉徴収等は含みません。 <a href="${esc(fee.source||'#')}" target="_blank" rel="noopener">手数料の公式根拠</a></div>
        <div style="margin-top:8px;padding:8px 10px;border:1px solid var(--border);border-radius:var(--rs);background:var(--card2);font-size:12px;line-height:1.65">
          <div><b>ソフト指定:</b> ${esc(l.software||'未確認')}</div>
          <div><b>業務内容:</b> ${esc(l.workContent||'未確認')}</div>
          <div><b>編集内容:</b> ${esc(l.editContent||'未確認')}</div>
          ${l.requiredSkills?`<div><b>必要スキル:</b> ${esc(l.requiredSkills)}</div>`:''}
        </div>
        <div style="margin-top:8px;display:flex;align-items:center;gap:7px;flex-wrap:wrap">
          <a class="btn btn-p btn-xs" href="${esc(l.jobUrl)}" target="_blank" rel="noopener">案件ページを開く</a>
          <button class="btn btn-g btn-xs" onclick="SalesVideoLeads.openForm('${l.id}')">内容を編集</button>
          <span style="font-size:10.5px;color:var(--t3)">最終確認: ${esc(l.lastCheckedAt||'未確認')}</span>
        </div>
        <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:4px">${statusBtns}</div>
        <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
          <input type="date" class="sl-inline-input" value="${esc(slNextOf(l,VIDEO_BIZ))}" onchange="SalesVideoLeads.setBizField('${l.id}','n',this.value)" style="width:135px" aria-label="次アクション日">
          <input type="text" class="sl-inline-input" placeholder="メモ…" value="${esc(slMemoOf(l,VIDEO_BIZ))}" onchange="SalesVideoLeads.setBizField('${l.id}','m',this.value)" style="flex:1;min-width:180px;max-width:440px">
        </div>
      </div>
    </article>`;
  }).join('');
}
function _videoLeadPage(){
  const all=(S.salesLeads||[]).filter(l=>_videoLeadIs(l)&&!l.deleted);
  const rows=_videoLeadSorted();
  const newCount=all.filter(l=>l.freshness==='新着').length;
  const coco=all.filter(l=>l.service==='ココナラ').length;
  const lancers=all.filter(l=>l.service==='ランサーズ').length;
  return`<div class="ph"><div class="ph-title">📞 営業リスト<small>ココナラ・ランサーズの動画編集案件</small></div>
    <button class="btn btn-g btn-sm" onclick="SalesVideoLeads.openForm('')">＋ 案件を追加</button></div>
    <div class="sl-biz-tabs">${SL_BIZ.map(b=>`<button class="sl-biz-tab${_slBiz===b.k?' act':''}" onclick="slSetBiz('${b.k}')">${esc(b.label)}<span class="sl-biz-count">${b.k===VIDEO_BIZ?all.length:(S.salesLeads||[]).filter(l=>!l.deleted&&slInPool(l,b.k,'any')).length}</span></button>`).join('')}</div>
    <div style="margin-bottom:14px;display:flex;flex-wrap:wrap;gap:0">
      <span class="sl-summary-chip">総数 <strong>${all.length}</strong></span>
      <span class="sl-summary-chip" style="color:var(--purple)">新着 <strong>${newCount}</strong></span>
      <span class="sl-summary-chip">ココナラ <strong>${coco}</strong></span>
      <span class="sl-summary-chip">ランサーズ <strong>${lancers}</strong></span>
    </div>
    <div class="filter-bar" style="margin-bottom:8px">${['all',...VIDEO_STATUSES].map(s=>`<button class="fbtn${_videoLeadStatus===s?' act':''}" onclick="SalesVideoLeads.setStatusFilter('${s}')">${s==='all'?'すべて':s}</button>`).join('')}</div>
    <div class="filter-bar" style="margin-bottom:12px">${['all','ココナラ','ランサーズ'].map(s=>`<button class="fbtn${_videoLeadService===s?' act':''}" onclick="SalesVideoLeads.setServiceFilter('${s}')">${s==='all'?'サービスすべて':s}</button>`).join('')}</div>
    <div style="margin-bottom:14px;display:flex;gap:8px;align-items:center"><input type="search" placeholder="案件名・業務内容・ソフトで検索…" value="${esc(_videoLeadSearch)}" oninput="SalesVideoLeads.setSearch(this.value)" style="max-width:360px"><span style="font-size:12px;color:var(--t2)">${rows.length}件</span></div>
    <details class="card" style="margin-bottom:16px"><summary style="cursor:pointer;font-weight:700">CSV一括取り込み（毎朝の自動登録用）</summary>
      <div style="font-size:11px;color:var(--t2);line-height:1.7;margin:9px 0">列順: 区分,サービス,案件名,案件URL,1本単価,総報酬,本数,掲載日,応募期限,ソフト指定,業務内容,編集内容,必要スキル,募集状態,最終確認日<br>同じ案件URLは重複追加せず、最新の確認内容へ更新します。1本3,000円未満・本数不明・CapCut指定は登録しません。手数料と差引後受取見込額はサービスと1本単価から自動計算します。</div>
      <textarea id="video-lead-csv" placeholder="確認済み案件のCSVを貼り付け…" style="min-height:100px;width:100%;font:11px monospace"></textarea>
      <div style="margin-top:8px"><button class="btn btn-p btn-sm" onclick="SalesVideoLeads.importCsv()">取り込む</button><span id="video-lead-import-result" style="margin-left:8px;font-size:11px;color:var(--t2)"></span></div>
    </details>
    ${_videoLeadCards(rows)}`;
}
function _videoLeadForm(id){
  const l=(S.salesLeads||[]).find(x=>x.id===id&&_videoLeadIs(x))||{};
  return`<div class="mhdr"><div class="mtitle">${id?'動画編集案件を編集':'動画編集案件を追加'}</div><button class="mclose" onclick="closeModal()">✕</button></div>
    <input type="hidden" id="vlf-id" value="${esc(id||'')}">
    <div class="fg"><div class="fl">案件名</div><input id="vlf-name" value="${esc(l.name||'')}"></div>
    <div class="fg"><div class="fl">案件URL</div><input id="vlf-url" type="url" value="${esc(l.jobUrl||'')}"></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:8px">
      <div class="fg"><div class="fl">1本単価</div><input id="vlf-price" type="number" min="3000" value="${esc(String(l.unitPrice||''))}"></div>
      <div class="fg"><div class="fl">総報酬</div><input id="vlf-total" value="${esc(l.totalReward||'')}"></div>
      <div class="fg"><div class="fl">本数</div><input id="vlf-count" value="${esc(l.videoCount||'')}"></div>
      <div class="fg"><div class="fl">掲載日</div><input id="vlf-posted" value="${esc(l.postedAt||'')}"></div>
      <div class="fg"><div class="fl">応募期限</div><input id="vlf-deadline" value="${esc(l.deadline||'')}"></div>
      <div class="fg"><div class="fl">区分</div><select id="vlf-fresh"><option${l.freshness==='新着'?' selected':''}>新着</option><option${l.freshness==='継続'?' selected':''}>継続</option></select></div>
    </div>
    <div class="fg"><div class="fl">ソフト指定</div><input id="vlf-software" value="${esc(l.software||'')}"></div>
    <div class="fg"><div class="fl">業務内容</div><textarea id="vlf-work">${esc(l.workContent||'')}</textarea></div>
    <div class="fg"><div class="fl">編集内容</div><textarea id="vlf-edit">${esc(l.editContent||'')}</textarea></div>
    <div class="fg"><div class="fl">必要スキル</div><input id="vlf-skills" value="${esc(l.requiredSkills||'')}"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><div class="fg"><div class="fl">募集状態</div><input id="vlf-listing" value="${esc(l.listingStatus||'募集中')}"></div><div class="fg"><div class="fl">最終確認日</div><input id="vlf-checked" value="${esc(l.lastCheckedAt||today())}"></div></div>
    <div class="mfooter"><button class="btn btn-g" onclick="closeModal()">キャンセル</button><button class="btn btn-p" onclick="SalesVideoLeads.saveForm()">保存</button></div>`;
}
function _value(id){return document.getElementById(id)?.value||'';}

const _baseInPool=slInPool;
slInPool=function(l,bizKey,srcKey){
  const bk=bizKey||_slBiz;
  if(_videoLeadIs(l))return bk===VIDEO_BIZ;
  if(bk===VIDEO_BIZ)return false;
  return _baseInPool(l,bk,srcKey);
};
if(!SL_BIZ.some(b=>b.k===VIDEO_BIZ))SL_BIZ.push({k:VIDEO_BIZ,label:'動画編集案件',short:'動画案件'});
if(!SL_BIZ_KEYS.includes(VIDEO_BIZ))SL_BIZ_KEYS.push(VIDEO_BIZ);
const _baseSalesPage=rSalesLeads;
rSalesLeads=function(){return _slBiz===VIDEO_BIZ?_videoLeadPage():_baseSalesPage();};
const _baseSetBiz=slSetBiz;
slSetBiz=function(biz){
  _slFilterStatus='all';_slFilterGenre='all';_slFilterBeautyAudience='all';_slFilterBeautyService='all';_slFilterSubgenre='all';_slFilterRegion='all';_slFilterContact='all';_slFilterAssignee='all';_slFilterOverlap=false;_slFilterApproach='all';
  if(biz===VIDEO_BIZ){_slBiz=VIDEO_BIZ;_slPage=0;render();return;}
  _baseSetBiz(biz);
};

window.SalesVideoLeads={
  parseCsv:_videoLeadParseCsv,normalize:_videoLeadNormalize,upsert:_videoLeadUpsert,fee:_videoLeadFee,
  setSearch(v){_videoLeadSearch=String(v||'');render();},
  setStatusFilter(v){_videoLeadStatus=v;render();},
  setServiceFilter(v){_videoLeadService=v;render();},
  setStatus(id,status){const l=(S.salesLeads||[]).find(x=>x.id===id&&_videoLeadIs(x));if(!l||!VIDEO_STATUSES.includes(status))return;slBizObj(l,VIDEO_BIZ).s=status;if(status==='受注'&&!l.wonAt)l.wonAt=today();l.updatedAt=new Date().toISOString();save();render();},
  setBizField(id,field,value){const l=(S.salesLeads||[]).find(x=>x.id===id&&_videoLeadIs(x));if(!l||!['n','m'].includes(field))return;slBizObj(l,VIDEO_BIZ)[field]=String(value||'');l.updatedAt=new Date().toISOString();save();},
  importCsv(){const el=document.getElementById('video-lead-csv');const resultEl=document.getElementById('video-lead-import-result');const rows=_videoLeadParseCsv(el?.value||'');const result=_videoLeadUpsert(rows);if(resultEl)resultEl.textContent=`新規${result.added}件・更新${result.updated}件・除外${result.skipped}件`;if(result.errors.length)toast(result.errors.slice(0,3).join(' / '),'warn');else toast(`動画編集案件を新規${result.added}件・更新${result.updated}件登録しました`,'ok');render();return result;},
  openForm(id){openModal(_videoLeadForm(id));},
  saveForm(){
    const id=_value('vlf-id');const current=(S.salesLeads||[]).find(x=>x.id===id&&_videoLeadIs(x));
    const raw={id:id||undefined,name:_value('vlf-name'),jobUrl:_value('vlf-url'),unitPrice:_value('vlf-price'),totalReward:_value('vlf-total'),videoCount:_value('vlf-count'),postedAt:_value('vlf-posted'),deadline:_value('vlf-deadline'),freshness:_value('vlf-fresh'),software:_value('vlf-software'),workContent:_value('vlf-work'),editContent:_value('vlf-edit'),requiredSkills:_value('vlf-skills'),listingStatus:_value('vlf-listing'),lastCheckedAt:_value('vlf-checked'),biz:current?.biz,contacts:current?.contacts,createdAt:current?.createdAt};
    const n=_videoLeadNormalize(raw);if(!n.ok){toast(n.reason,'warn');return;}
    const result=_videoLeadUpsert([n.value]);if(result.skipped){toast(result.errors[0]||'保存できませんでした','warn');return;}closeModal();render();toast(id?'案件内容を更新しました':'案件を追加しました','ok');
  }
};
if(typeof V!=='undefined'&&V==='salesleads')render();
})();
