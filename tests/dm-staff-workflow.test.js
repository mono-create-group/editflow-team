#!/usr/bin/env node
'use strict';

/* Isolated browser-less contract tests.  They execute the shipped inline
 * scripts with fake DOM, storage and fetch; no live endpoint is contacted. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const root = require('node:path').resolve(__dirname, '..');

const wait = () => new Promise(resolve => setImmediate(resolve));
const response = (body, ok = true, contentType = 'application/json') => ({
  ok, status: ok ? 200 : 500, headers: { get: () => contentType }, json: async () => body,
  text: async () => typeof body === 'string' ? body : JSON.stringify(body)
});
function element() {
  return { value: '', textContent: '', innerHTML: '', className: '', disabled: false,
    style: {}, dataset: {}, checked: false, open: false, options: [{ textContent: '' }, { textContent: '' }],
    addEventListener(type, fn) { (this.listeners || (this.listeners = {}))[type] = fn; },
    closest() { return null; }, select() {} };
}
function ids(html) { return [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]); }
function envFor(html, fetchImpl) {
  const els = Object.fromEntries(ids(html).map(id => [id, element()]));
  const storage = new Map();
  const document = { hidden: false, body: { appendChild() {}, removeChild() {} },
    getElementById: id => els[id] || (els[id] = element()), createElement: element,
    addEventListener() {}, execCommand: () => true };
  const ctx = { document, localStorage: { getItem:k => storage.get(k) || null, setItem:(k,v) => storage.set(k, String(v)) },
    fetch: fetchImpl, confirm: () => true, alert() {}, navigator: {}, location: { pathname: '/dm-manual.html', replace() {} },
    setTimeout: fn => { fn(); return 1; }, clearTimeout() {}, setInterval() {}, Date, JSON, String, Number,
    Array, Object, Math, RegExp, Error, encodeURIComponent, unescape, encodeURIComponent, btoa: s => Buffer.from(s, 'binary').toString('base64'),
    firebase: undefined, window: null };
  ctx.window = ctx;
  ctx.window.addEventListener = () => {};
  return { ctx: vm.createContext(ctx), els, storage };
}
function scripts(html) { return [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].map(m => m[1]); }
function runManual(fetchImpl) {
  const html = fs.readFileSync(root + '/dm-manual.html', 'utf8');
  const e = envFor(html, fetchImpl);
  for (const script of scripts(html)) vm.runInContext(script, e.ctx);
  return e;
}
function runEntry(fetchImpl) {
  const html = fs.readFileSync(root + '/dm-entry.html', 'utf8');
  const e = envFor(html, fetchImpl);
  vm.runInContext(scripts(html).at(-1), e.ctx);
  return e;
}

async function entryRegistration() {
  const calls = [];
  const e = runEntry((url, init) => { calls.push({url, init}); return Promise.resolve(response({success:true})); });
  e.els.name.value = '山田 太郎'; e.els.email.value = 'staff@example.com'; e.els.agreeChk.checked = true;
  e.els.f.listeners.submit({preventDefault(){}}); await wait(); await wait();
  assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0].init.body).action, 'dmstaff_apply');
  assert.match(e.els.msg.innerHTML, /登録が完了/); assert.equal(e.els.f.style.display, 'none');

  const failure = runEntry(() => Promise.reject(new Error('offline')));
  failure.els.name.value = '山田'; failure.els.email.value = 'staff@example.com'; failure.els.agreeChk.checked = true;
  failure.els.f.listeners.submit({preventDefault(){}}); await wait(); await wait();
  assert.match(failure.els.msg.textContent, /通信に失敗/); assert.equal(failure.els.sbtn.disabled, false);

  const consent = runEntry(() => { throw new Error('must not send'); });
  consent.els.name.value = '山田'; consent.els.email.value = 'staff@example.com';
  consent.els.f.listeners.submit({preventDefault(){}});
  assert.match(consent.els.msg.textContent, /同意チェック/); assert.equal(consent.els.terms.open, true);
}

async function manualWorkflow() {
  const requests = [];
  const e = runManual((url, init) => {
    requests.push({url, init});
    if (String(url).includes('igname_list')) return Promise.resolve(response({success:true,names:[{n:'mono.create AI',ai:true},{n:'mono.create HP'}]}));
    if (String(url).includes('igname_claim')) return Promise.resolve(response({success:true,name:'mono.create AI'}));
    if (String(url).includes('showcase_list')) return Promise.resolve(response(JSON.stringify({success:true,list:[{id:'1',g:'美容室',url:'https://example.test/demo'}]}), true, 'text/plain'));
    if (String(url).includes('dmfaq_ask')) return Promise.resolve(response(JSON.stringify({ok:true,answer:'毎日20通までです。',matched:true}), true, 'text/plain'));
    if (init && JSON.parse(init.body).action === 'dmstaff_igreport') return Promise.resolve(response({success:true}));
    if (init && JSON.parse(init.body).action === 'invoice_upload') return Promise.resolve(response({ok:true}));
    return Promise.resolve(response({success:true}));
  });
  await wait(); await wait();

  e.els.staffName.value = '山田'; e.ctx.pickName(0);
  assert.equal(e.els.claimBtn.disabled, true, 'AI name needs acknowledgement');
  e.els.aiOk.checked = true; e.ctx.updateClaimUI(); assert.equal(e.els.claimBtn.disabled, false);
  e.ctx.claimName(); await wait(); await wait();
  const claim = requests.find(r => String(r.url).includes('action=igname_claim'));
  assert.ok(claim, 'name claim request is issued');
  assert.match(String(claim.url), /staff=%E5%B1%B1%E7%94%B0/);
  assert.equal(e.storage.get('dmm_staff'), '山田'); assert.match(e.els.claimResult.innerHTML, /予約が完了/);

  const beforeInvalidIg = requests.length;
  e.els.igHandle.value = 'mono yamada'; e.els.igEmail.value = 'ig@example.com'; e.els.igPw.value = 'safe-pass';
  e.ctx.reportIg();
  assert.equal(requests.length, beforeInvalidIg, 'invalid IG handle is rejected before transmission');
  assert.match(e.els.igReportResult.textContent, /英数字・ピリオド・アンダーバー/);

  e.els.igHandle.value = '@mono_yamada'; e.els.igEmail.value = 'ig@example.com'; e.els.igPw.value = 'safe-pass';
  e.ctx.reportIg(); await wait(); await wait(); assert.match(e.els.igReportResult.innerHTML, /受け付け/);

  e.ctx.pickShowcase(0); assert.equal(e.els.genUrl.value, 'https://example.test/demo'); assert.match(e.els.dmText.textContent, /はじめまして/);
  e.els.faqQ.value = 'DMは何通？'; e.ctx.faqAsk(); await wait(); await wait(); assert.match(e.els.faqAns.innerHTML, /毎日20通/);

  e.els.invName.value = '山田'; e.els.invMonth.value = '2026-08'; e.els.invCount.value = '2'; e.els.invPayPlan.value = 'commission';
  e.ctx.invSend(); await wait(); await wait();
  const invoice = requests.find(r => r.init && r.init.body && JSON.parse(r.init.body).action === 'invoice_upload');
  assert.ok(invoice, 'invoice request is issued'); assert.equal(JSON.parse(invoice.init.body).editor, '営業_山田');
  assert.match(e.els.invSendResult.innerHTML, /請求書を送信/);

  const badInvoice = runManual((url, init) => {
    if (String(url).includes('igname_list')) return Promise.resolve(response({success:true,names:[]}));
    if (String(url).includes('showcase_list')) return Promise.resolve(response(JSON.stringify({success:true,list:[]}), true, 'text/plain'));
    if (init && JSON.parse(init.body).action === 'invoice_upload') {
      return Promise.resolve({ok:true,status:200,headers:{get:()=> 'text/html'},json:async()=>{throw new Error('html error page');}});
    }
    return Promise.resolve(response({success:true}));
  });
  await wait(); await wait();
  badInvoice.els.invName.value = '山田'; badInvoice.els.invMonth.value = '2026-08';
  badInvoice.ctx.invSend(); await wait(); await wait();
  assert.match(badInvoice.els.invSendResult.textContent, /送信に失敗/);
  assert.equal(badInvoice.els.invFallback.style.display, 'block', 'unverified invoice response fails closed');
}

function extractFunction(source, name) {
  const start = source.indexOf('function ' + name + '(');
  assert.notEqual(start, -1, name + ' must exist in index.html');
  let open = source.indexOf('{', start), depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    if (source[i] === '}' && --depth === 0) return source.slice(start, i + 1);
  }
  throw new Error('unterminated function ' + name);
}
function backendIgValidation() {
  const backend = fs.readFileSync(root + '/../automation/poitto_hp_backend/Code.js', 'utf8');
  const ctx = vm.createContext({
    Date, Math, String,
    _rateLimitOk_: () => true,
    json_: value => value
  });
  vm.runInContext(extractFunction(backend, 'dmStaffIgReport_'), ctx);
  assert.equal(ctx.dmStaffIgReport_({name:'山田',ig:'mono yamada',igemail:'ig@example.com',igpw:'safe-pass'}).error, 'invalid_ig_handle');
  assert.equal(ctx.dmStaffIgReport_({name:'山田',ig:'mono_yamada',igemail:'invalid-email',igpw:'safe-pass'}).error, 'invalid_ig_email');
}
async function ownerDmWorkflow() {
  const index = fs.readFileSync(root + '/index.html', 'utf8');
  const lead = { id: 'lead-1', name: '秘密店舗', instagram: '@secret_shop', status: '未接触', contacts: [] };
  const els = { 'sl-owner-dm-text': element(), 'sl-owner-dm-aftercopy': element() };
  const opened = [], saved = [], toasts = [];
  const ctx = vm.createContext({
    S: { salesLeads: [lead], salesLeadExclusions: [] }, OWNER_NAME: 'オーナー', _slBiz: 'hp',
    document: { getElementById: id => els[id] || (els[id] = element()) }, navigator: { clipboard: { writeText: () => Promise.resolve() } },
    window: { open: (...args) => opened.push(args) }, confirm: () => true, Date, Array, Object, String, Math,
    _isOwner: () => true, slStatusOf: l => l.status, slIgHandle: v => String(v).replace(/^@/, ''),
    slIgDmComposeUrl: h => 'https://instagram.com/direct/new/?username=' + h,
    slBizObj: l => l, SL_CONTACT_STATUSES: ['DM済み', '成約'], slRecentOtherContact: () => null,
    slPushContact: (l, biz, approach, assignee, status) => l.contacts.push({ d: '2026-08-16', a: assignee, s: status, biz, approach }),
    save: () => saved.push(true), render: () => {}, closeModal: () => {}, openModal: html => { els.modal = html; },
    toast: m => toasts.push(m), esc: s => String(s), uid: () => 'audit-1', today: () => '2026-08-16',
    _srRange: 'all', _srRangeStart: () => '0000-00-00', _slAssignees: () => ['オーナー', '営業A']
  });
  ['srStats', 'slPrepareOwnerDm', 'slCopyOwnerDm', 'slConfirmOwnerDmSent', 'slOpenOwnerDm', 'slExcludeOwnerDm', 'slSetStatus']
    .forEach(name => vm.runInContext(extractFunction(index, name), ctx));

  ctx.slPrepareOwnerDm('lead-1'); assert.match(els.modal, /DMを準備/);
  els['sl-owner-dm-text'].value = '個別確認済みのDM本文'; ctx.slCopyOwnerDm('lead-1'); await wait();
  assert.equal(lead.dmDraft, '個別確認済みのDM本文'); assert.equal(els['sl-owner-dm-aftercopy'].style.display, 'block');
  ctx.slOpenOwnerDm('lead-1'); assert.equal(lead.assignee, 'オーナー'); assert.match(opened[0][0], /secret_shop/);
  ctx.slConfirmOwnerDmSent('lead-1'); assert.equal(lead.status, 'DM済み'); assert.equal(lead.approach, 'DM営業');
  const ranking = ctx.srStats('all'); assert.deepEqual(JSON.parse(JSON.stringify(ranking[0])), {who:'オーナー',sent:1,won:0,rate:0});

  const sensitive = { id: 'lead-2', name: '秘匿店名', instagram: '@private', email: 'secret@example.test', phone: '090-0000', status: '未接触' };
  ctx.S.salesLeads.push(sensitive); ctx.slExcludeOwnerDm('lead-2', '公式サイトあり');
  assert.equal(ctx.S.salesLeads.some(l => l.id === 'lead-2'), false);
  const audit = ctx.S.salesLeadExclusions.at(-1);
  assert.deepEqual(Object.keys(audit).sort(), ['excludedAt', 'excludedBy', 'id', 'reason']);
  assert.equal(JSON.stringify(audit).includes('秘匿店名'), false); assert.equal(JSON.stringify(audit).includes('private'), false);
}

(async () => { await entryRegistration(); await manualWorkflow(); backendIgValidation(); await ownerDmWorkflow(); console.log('DM staff workflow contracts: PASS'); })()
  .catch(error => { console.error(error.stack || error); process.exitCode = 1; });
