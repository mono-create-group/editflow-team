const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const index = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

function sourceBetween(name, next) {
  const start = index.indexOf(`function ${name}`);
  const end = index.indexOf(`function ${next}`, start);
  assert.ok(start >= 0 && end > start, `${name} source must exist`);
  return index.slice(start, end);
}

function paymentContext({ records, jobs = [], workers = [] } = {}) {
  const context = {
    ACCESS_RECORDS: records || [],
    SELF_WID: '__self',
    S: { workers },
    BJOBS: () => jobs,
    getJobWorkerIds: job => job.workerIds || (job.workerId ? [job.workerId] : []),
    _portalBillingTerms: value => value ? {
      invoiceMonth: String(value).slice(0, 7),
      invoiceAvailableOn: `${String(value).slice(0, 7)}-25`,
      paymentDueDate: `${String(value).slice(0, 7)}-30`,
    } : null,
  };
  vm.createContext(context);
  vm.runInContext([
    sourceBetween('_paymentAccessForWorker', 'resolvePaymentRecipient'),
    sourceBetween('resolvePaymentRecipient', '_paymentRecipientForRecord'),
    sourceBetween('_paymentRecipientForRecord', '_paymentRecipientSnapshot'),
    sourceBetween('_paymentRecipientSnapshot', '_paymentWorkerName'),
    sourceBetween('_paymentWorkerName', '_profitWorkerLabel'),
    sourceBetween('getPayEntries', 'rProjPayment'),
    sourceBetween('_directorTeamInvoiceLines', '_directorSettlementTargetsForJob'),
    'this.resolvePaymentRecipient = resolvePaymentRecipient;',
    'this.paymentRecipientForRecord = _paymentRecipientForRecord;',
    'this.getPayEntries = getPayEntries;',
    'this.directorTeamInvoiceLines = _directorTeamInvoiceLines;',
  ].join('\n'), context);
  return context;
}

const relationship = [
  { id: 'miyuu-uid', approved: true, workerId: 'miyuu-worker', editorKind: 'external', directorUid: 'miura-uid', roles: ['動画編集者'] },
  { id: 'miura-uid', approved: true, workerId: 'miura-worker', editorKind: 'direct', roles: ['動画編集ディレクター'] },
  { id: 'direct-uid', approved: true, workerId: 'direct-worker', editorKind: 'direct', roles: ['動画編集者'] },
];

test('external Miyuu resolves to Miura as the payment recipient while a direct editor remains self-paid', () => {
  const context = paymentContext({ records: relationship });
  const external = context.resolvePaymentRecipient('miyuu-worker');
  assert.deepEqual(JSON.parse(JSON.stringify(external)), {
    ok: true, blocked: false, assigneeWorkerId: 'miyuu-worker', assigneeUid: 'miyuu-uid',
    payeeWorkerId: 'miura-worker', payeeUid: 'miura-uid', directorUid: 'miura-uid', route: 'director_team', reason: '',
  });
  const direct = context.resolvePaymentRecipient('direct-worker');
  assert.equal(direct.ok, true);
  assert.equal(direct.route, 'direct');
  assert.equal(direct.payeeWorkerId, 'direct-worker');
  assert.equal(direct.payeeUid, 'direct-uid');
});

test('missing director or director payment worker fails closed instead of paying the external editor', () => {
  const missingDirector = paymentContext({ records: [relationship[0]] }).resolvePaymentRecipient('miyuu-worker');
  assert.equal(missingDirector.ok, false);
  assert.equal(missingDirector.blocked, true);
  assert.equal(missingDirector.payeeWorkerId, '');
  assert.match(missingDirector.reason, /担当ディレクター/);

  const noPayeeWorker = paymentContext({ records: [relationship[0], { ...relationship[1], workerId: '' }] }).resolvePaymentRecipient('miyuu-worker');
  assert.equal(noPayeeWorker.ok, false);
  assert.equal(noPayeeWorker.payeeUid, 'miura-uid');
  assert.match(noPayeeWorker.reason, /支払先/);
});

test('stored payment snapshot remains Miura after Miyuu moves to another director', () => {
  const snapshot = {
    billingResolutionStatus: 'resolved', billingAssigneeWorkerId: 'miyuu-worker', billingAssigneeUid: 'miyuu-uid',
    billingRecipientWorkerId: 'miura-worker', billingRecipientUid: 'miura-uid', billingDirectorUid: 'miura-uid', billingRoute: 'director_team',
  };
  const moved = [
    { ...relationship[0], directorUid: 'next-director-uid' },
    { id: 'next-director-uid', approved: true, workerId: 'next-director-worker', roles: ['動画編集ディレクター'] },
  ];
  const resolved = paymentContext({ records: moved }).paymentRecipientForRecord(snapshot, 'miyuu-worker');
  assert.equal(resolved.payeeUid, 'miura-uid');
  assert.equal(resolved.payeeWorkerId, 'miura-worker');
  assert.equal(resolved.source, 'snapshot');
});

test('payment entries group 3,000 yen under Miura while retaining Miyuu as the work assignee', () => {
  const jobs = [{
    id: 'wako-sept', title: '和光市 9月分', payoutDate: '2026-09-30',
    subtasks: [{ id: 'su-17', title: 'SU-S017', workerId: 'miyuu-worker', workerPay: 3000, payoutDate: '2026-09-30' }],
  }];
  const context = paymentContext({ records: relationship, jobs, workers: [{ id: 'miyuu-worker', name: 'みゆう' }, { id: 'miura-worker', name: '三浦' }] });
  const entries = context.getPayEntries('2026-09');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].assigneeWorkerId, 'miyuu-worker');
  assert.equal(entries[0].payeeWorkerId, 'miura-worker');
  assert.equal(entries[0].payeeUid, 'miura-uid');
  assert.equal(entries[0].workerPay, 3000);
  const grouped = Object.groupBy(entries, entry => entry.payeeWorkerId);
  assert.equal(grouped['miura-worker'].reduce((sum, entry) => sum + entry.workerPay, 0), 3000);
  assert.equal(grouped['miyuu-worker'], undefined);
});

test('director invoice lines aggregate the external editor work under the director UID only', () => {
  const jobs = [{
    id: 'wako-sept', title: '和光市 9月分', completedDeliveryDate: '2026-09-10',
    subtasks: [{ id: 'su-17', title: 'SU-S017', workerId: 'miyuu-worker', workerPay: 3000, completedDeliveryDate: '2026-09-10' }],
  }];
  const context = paymentContext({ records: relationship, jobs, workers: [{ id: 'miyuu-worker', name: 'みゆう' }, { id: 'miura-worker', name: '三浦' }] });
  const miuraLines = context.directorTeamInvoiceLines('miura-uid', '2026-09', 10);
  assert.equal(miuraLines.length, 1);
  assert.equal(miuraLines[0].amount, 3000);
  assert.match(miuraLines[0].serviceDescription, /作業担当 みゆう/);
  assert.equal(context.directorTeamInvoiceLines('miyuu-uid', '2026-09', 10).length, 0);
});

test('director team invoice validation accepts only the current team lines', () => {
  const teamLine = { jobId: 'team:wako-sept:su-17', title: '和光市 9月分 / SU-S017', serviceDescription: '和光市 9月分 / SU-S017（作業担当 みゆう）', transactionDate: '2026-09-10', amount: 3000, taxRate: 10 };
  const authorization = { id: '2026-09', _portalUid: 'miura-uid', active: true, revision: 1, invoiceDocumentId: '2026-09-r1-v1', invoiceVersion: 1, month: '2026-09', invoiceAvailableOn: '2026-09-25', paymentDueDate: '2026-09-30', jobIds: [teamLine.jobId], lines: [teamLine], subtotal: 3000, taxByRate: { 10: 300 }, tax: 300, total: 3300 };
  const invoice = { id: '2026-09-r1-v1', _portalUid: 'miura-uid', authorizationId: '2026-09', authorizationRevision: 1, version: 1, month: '2026-09', invoiceAvailableOn: '2026-09-25', paymentDueDate: '2026-09-30', issueDate: '2026-09-25', dueDate: '2026-09-30', jobIds: [teamLine.jobId], lines: [teamLine], subtotal: 3000, taxByRate: { 10: 300 }, tax: 300, total: 3300, file: { provider: 'google-drive', id: 'drive-file', sha256: 'hash', webViewLink: 'https://drive.google.com/file/d/drive-file', sharedWith: ['owner@example.test'] }, ownerShareStatus: 'shared' };
  const context = {
    PORTAL_AUTHORIZATIONS: [authorization], PORTAL_INVOICES: [], PORTAL_JOBS: [],
    PORTAL_PROFILES: [{ _portalUid: 'miura-uid', taxRate: 10 }], ADMIN_EMAILS: ['owner@example.test'],
    _portalIsExternal: () => false, _videoDriveUrl: value => value,
    _directorTeamInvoiceLines: () => [teamLine],
  };
  vm.createContext(context);
  const invoiceCheckStart = index.indexOf('function _portalInvoiceCheck');
  const invoiceCheckEnd = index.indexOf('async function portalRegistrationReview', invoiceCheckStart);
  assert.ok(invoiceCheckStart >= 0 && invoiceCheckEnd > invoiceCheckStart);
  vm.runInContext(`${index.slice(invoiceCheckStart, invoiceCheckEnd)}this.checkInvoice = _portalInvoiceCheck;`, context);
  assert.equal(context.checkInvoice(invoice).ok, true);
  context._directorTeamInvoiceLines = () => [];
  assert.match(context.checkInvoice(invoice).reason, /外部編集者分の明細/);
});

test('deleting a case recalculates every affected director invoice authorization', () => {
  const remove = sourceBetween('delJob', 'delLog');
  assert.match(remove, /_directorSettlementTargetsForJob\(j\)/);
  assert.match(remove, /_refreshDirectorSettlementTargets\(targets\)/);
  assert.match(remove, /catch\(error=>/);
});

test('payment UI explicitly separates work assignee from payment recipient', () => {
  assert.match(index, /作業担当：/);
  assert.match(index, /精算先：/);
  assert.match(index, /作業担当：\$\{assignee\} ／ 精算先：/);
  assert.match(index, /payeeWorkerId/);
  assert.match(index, /billingRecipientWorkerId/);
});
