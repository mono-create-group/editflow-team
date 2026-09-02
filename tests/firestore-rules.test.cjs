const fs = require('node:fs');
const path = require('node:path');
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  collectionGroup,
  addDoc,
  getDocs,
  query,
  where,
  runTransaction,
  writeBatch,
  serverTimestamp,
  deleteField,
} = require('firebase/firestore');

const root = path.resolve(__dirname, '..');
const projectId = 'demo-editflow';
const claims = (email) => ({ email, email_verified: true });

function portalJob(uid, overrides = {}) {
  return {
    recordType: 'editor_portal_job', businessType: 'dispatch', title: '案件1', caseName: '9月分',
    clientId: 'c1', sourceClientId: 'legacy-client-1', clientDisplay: 'クライアントA', accountId: 'a1', accountDisplay: 'アカウントA',
    deadline: '2026-09-10', sharedDate: '2026-09-01', editorDraftDate: '2026-09-05',
    editorDraftDateSetter: 'editor',
    clientDraftDate: '2026-09-06', thumbnailDate: '', deliveryDate: '2026-09-10',
    requestUrl: 'https://example.com/request', sourceUrl: 'https://example.com/source',
    instructions: '編集指示', urgent: false, status: 'アサイン済み', progress: '', evidenceUrl: '', blocker: '',
    editorPayAmount: 3000,
    workDate: '', startTime: '', endTime: '', submittedByUid: uid, editorUid: uid,
    editorEmail: `${uid}@example.com`, editorName: uid, directorUid: '', source: 'direct_client',
    createdAt: 1, updatedAt: 1, history: [{ at: 1, type: 'created', by: uid, status: 'アサイン済み' }],
    ...overrides,
  };
}

function externalWorkflowJob(overrides = {}) {
  const job = portalJob('external1', {
    businessType: 'edit_agency', title: 'WD-S086', caseName: '9月分_和光市デンタルオフィス',
    parentCaseId: 'parent-wako-09', parentCaseName: '9月分_和光市デンタルオフィス',
    deadline: '', deliveryDate: '', sharedDate: '2026-08-28', editorDraftDate: '2026-09-01',
    clientDraftDate: '2026-09-11', instructions: '', status: '進行中', directorUid: 'dir1',
    source: 'legacy_sync', legacyParentId: 'legacy-parent-wako-09',
    legacySubtaskId: 'legacy-subtask-wd-s086', subtaskIndex: 0,
    manualIds: [], parentManualIds: [], caution: '', parentCaution: '', attachments: [],
    workflow: { round: 1, stage: 'editing' }, progressEvents: [], progressMilestones: [],
    lastProgressChangedByUid: 'external1', lastProgressChangedByEmail: 'external1@example.com',
    lastProgressChangedByRole: '担当編集者', updatedBy: 'owner',
    history: [
      { at: 1, type: 'synced', by: 'owner', status: '進行中' },
      { at: 2, type: 'editor_progress', by: 'external1', status: '進行中' },
    ],
    ...overrides,
  });
  delete job.sourceClientId;
  delete job.editorPayAmount;
  return job;
}

function manualInvoice(uid, overrides = {}) {
  return {
    recordType: 'editor_invoice', editorUid: uid, editorEmail: `${uid}@example.com`, editorName: uid,
    month: '2026-09', jobIds: ['done1'], lines: [{ jobId: 'done1', title: '案件1', amount: 5000, taxRate: 0 }],
    issuer: { name: uid }, recipientName: 'mono.create', documentType: 'invoice',
    subtotal: 5000, taxByRate: { 0: 0 }, tax: 0, withholding: 0, withholdingStatus: 'none', total: 5000,
    status: '下書き', invoiceNumber: 'TEST-001', issueDate: '2026-09-25', dueDate: '2026-10-31',
    invoiceAvailableOn: '2026-09-25', paymentDueDate: '2026-10-31',
    retentionUntil: '2027-09-30', version: 1, idempotencyKey: `manual-${uid}`, file: {},
    ownerShareStatus: 'not_shared', createdAt: 1, updatedAt: 1, history: [],
    submittedAt: null, reviewReason: '', supersedesInvoiceId: '',
    authorizationId: 'manual', authorizationRevision: 0,
    ...overrides,
  };
}

function boardJob(overrides = {}) {
  return {
    businessType: 'edit_agency', title: '公開案件', caseName: '9月分', parentCaseId: 'parent-board-1', parentCaseName: '9月分', subtaskIndex: 0,
    clientId: 'c1', clientName: 'クライアントA', accountId: 'a1', accountName: 'アカウントA',
    summary: '概要', instructions: '編集指示', attachments: [], manualIds: [], parentManualIds: [], caution: '', parentCaution: '',
    requestUrl: 'https://example.com/request', sourceUrl: 'https://example.com/source',
    editorDraftDate: '2026-09-05', editorDraftDateSetter: 'creator', clientDraftDate: '2026-09-06', thumbnailDate: '',
    deliveryDate: '2026-09-10', urgent: false, status: 'open', audience: 'direct',
    eligibleUids: [], directorUid: '', createdByUid: 'owner', createdByName: 'owner',
    createdAt: 1, updatedAt: 1, assignedUid: '', assignedName: '', assignedAt: null,
    ...overrides,
  };
}

function legacyBoardJob(overrides = {}) {
  const job = boardJob({
    parentCaseId: undefined, parentCaseName: undefined, sourceClientId: undefined,
    editorDraftDateSetter: undefined, instructions: undefined,
    ...overrides,
  });
  ['parentCaseId', 'parentCaseName', 'sourceClientId', 'editorDraftDateSetter', 'instructions'].forEach(key => delete job[key]);
  return job;
}

// Mirrors the production claim payload in editor-features.js.  Keeping this
// fixture field-for-field with the board document proves the rules permit the
// normal atomic claim while rejecting a clone or a tampered projection.
function claimedBoardPortalJob(uid, jobId, board, overrides = {}) {
  const parentCaseId = board.parentCaseId || jobId;
  const parentCaseName = board.parentCaseName || board.caseName || board.title || '';
  const sourceClientId = board.sourceClientId || board.clientId || '';
  const editorDraftDateSetter = board.editorDraftDateSetter === 'creator' ? 'creator' : 'editor';
  const instructions = board.instructions || board.summary || '';
  return portalJob(uid, {
    businessType: board.businessType, boardJobId: jobId, source: 'job_board',
    title: board.title, caseName: board.caseName, parentCaseId, parentCaseName, subtaskIndex: board.subtaskIndex || 0,
    clientId: board.clientId, sourceClientId, clientDisplay: board.clientName,
    accountId: board.accountId, accountDisplay: board.accountName,
    deadline: board.deliveryDate, sharedDate: '2026-09-01',
    editorDraftDate: board.editorDraftDate, editorDraftDateSetter,
    clientDraftDate: board.clientDraftDate, thumbnailDate: board.thumbnailDate,
    deliveryDate: board.deliveryDate, requestUrl: board.requestUrl, sourceUrl: board.sourceUrl,
    attachments: board.attachments || [], instructions,
    manualIds: board.manualIds || [], parentManualIds: board.parentManualIds || [],
    caution: board.caution || '', parentCaution: board.parentCaution || '',
    urgent: board.urgent, directorUid: board.directorUid,
    ...overrides,
  });
}

function clientCatalog(overrides = {}) {
  return {
    sourceClientId: 'legacy-client-1', name: 'クライアントA', formerNames: [],
    accounts: [{ id: 'a1', name: 'アカウントA' }], active: true, manualIds: [],
    updatedAt: 1, updatedBy: 'owner',
    ...overrides,
  };
}

function ownerJobFinance(overrides = {}) {
  return {
    recordType: 'owner_job_finance', portalUid: 'external1', portalJobId: 'done1',
    legacyJobId: 'legacy-external1-done1', parentCaseId: 'parent-1', sourceClientId: 'c1', accountId: 'a1',
    clientUnitPrice: 6000, masterClientUnitPrice: 6000, pricingSource: 'account_master',
    pricingRevision: 1, pricingUpdatedAt: serverTimestamp(), overrideReason: '',
    editorPayReference: 3000, approvedPayAmount: 3500, payRoute: 'director_team',
    payeeUid: 'dir1', payeeWorkerId: 'worker-dir1', assigneeUid: 'external1',
    assigneeWorkerId: 'worker-external1', approvedBy: 'owner', approvedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function ownerLegacyFinance(overrides = {}) {
  return {
    recordType: 'owner_legacy_finance', legacyJobId: 'legacy-finance-1',
    sourceHash: 'a'.repeat(64),
    parentAmounts: { unitPrice: 6000, workerPay: 3000, profit: 3000, monthlyFee: 0, salesPay: 0 },
    subtaskAmounts: [{ id: 'sub-1', unitPrice: 6000, workerPay: 3000, profit: 3000, monthlyFee: 0, salesPay: 0 }],
    revision: 1, migratedAt: serverTimestamp(), migratedBy: 'owner',
    ...overrides,
  };
}

function ownerDeliveryGoal(overrides = {}) {
  return {
    recordType: 'owner_delivery_goal', month: '2026-09',
    internalTargetCount: 10, internalTargetAmount: 50000,
    agencyTargetCount: 20, agencyTargetAmount: 20000,
    dispatchTargetCount: 5, dispatchTargetAmount: 30000,
    targetCount: 35, targetAmount: 100000, active: true, revision: 1,
    createdAt: serverTimestamp(), createdBy: 'owner',
    updatedAt: serverTimestamp(), updatedBy: 'owner',
    ...overrides,
  };
}

function legacyOwnerDeliveryGoal(overrides = {}) {
  const goal = ownerDeliveryGoal(overrides);
  delete goal.internalTargetCount; delete goal.internalTargetAmount;
  delete goal.agencyTargetCount; delete goal.agencyTargetAmount;
  delete goal.dispatchTargetCount; delete goal.dispatchTargetAmount;
  return goal;
}

function weeklySchedule(overrides = {}) {
  const dates = ['2026-08-24','2026-08-25','2026-08-26','2026-08-27','2026-08-28','2026-08-29','2026-08-30'];
  const days = dates.map((date, index) => ({
    date, status: index < 5 ? 'available' : 'unavailable', startTime: index < 5 ? '18:00' : '',
    endTime: index < 5 ? '22:00' : '', capacity: index < 5 ? 1 : 0, workType: 'both', note: '',
  }));
  return {
    name: 'Direct 1', weekStart: dates[0], weekEnd: dates[6], days,
    routineEnabled: true, routine: days.map((day, index) => ({ weekday: index + 1, status: day.status, startTime: day.startTime, endTime: day.endTime, capacity: day.capacity, workType: day.workType, note: day.note })),
    fromDate: dates[0], toDate: dates[6], hoursPerWeek: 20, capacity: 5,
    workType: 'both', available: true, note: '', updatedAt: serverTimestamp(),
    ...overrides,
  };
}

function directThread(firstUid, secondUid, ownerUid = '') {
  const [participantA, participantB] = [firstUid, secondUid].sort();
  return {
    participantA, participantB, participants: [participantA, participantB], ownerUid,
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), lastMessageAt: null,
    lastMessagePreview: '', lastSenderUid: '', lastSenderName: '',
  };
}

async function expectDenied(label, promise) {
  await assertFails(promise);
  process.stdout.write(`PASS deny: ${label}\n`);
}

async function expectAllowed(label, promise) {
  await assertSucceeds(promise);
  process.stdout.write(`PASS allow: ${label}\n`);
}

(async () => {
  const env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8') },
  });
  try {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const db = ctx.firestore();
      const access = [
        ['direct1', { uid: 'direct1', email: 'direct1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'direct', workerId: 'worker-direct1' }],
        ['direct2', { uid: 'direct2', email: 'direct2@example.com', approved: true, roles: ['動画編集者'], editorKind: 'direct', workerId: 'worker-direct2' }],
        ['external1', { uid: 'external1', email: 'external1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'dir1', invoiceRecipientName: 'Dir 1', workerId: 'worker-external1' }],
        ['external2', { uid: 'external2', email: 'external2@example.com', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'dir2', invoiceRecipientName: 'Dir 2', workerId: 'worker-external2' }],
        ['externalHybrid', { uid: 'externalHybrid', email: 'externalHybrid@example.com', approved: true, roles: ['動画編集者', 'Webデザイナー'], editorKind: 'external', directorUid: 'dir1', invoiceRecipientName: 'Dir 1' }],
        ['hybrid1', { uid: 'hybrid1', email: 'hybrid1@example.com', approved: true, roles: ['動画編集者', 'Webデザイナー'], editorKind: 'direct' }],
        ['sales1', { uid: 'sales1', email: 'sales1@example.com', approved: true, roles: ['営業'], editorKind: 'direct' }],
        ['dir1', { uid: 'dir1', email: 'dir1@example.com', approved: true, roles: ['動画編集ディレクター'], workerId: 'worker-dir1' }],
        ['dir2', { uid: 'dir2', email: 'dir2@example.com', approved: true, roles: ['動画編集ディレクター'], workerId: 'worker-dir2' }],
      ];
      for (const [uid, data] of access) await setDoc(doc(db, 'access', uid), data);
      await setDoc(doc(db, 'system', 'access_control'), { enforced: true, compatibilityEmails: [] });
      await setDoc(doc(db, 'editor_job_board', 'direct-open'), boardJob());
      await setDoc(doc(db, 'editor_job_board', 'direct-tamper'), boardJob({ title: '改竄禁止の公開案件' }));
      await setDoc(doc(db, 'editor_job_board', 'direct-legacy'), legacyBoardJob({ title: '旧形式の公開案件', summary: '旧形式の概要だけを編集指示に使う' }));
      await setDoc(doc(db, 'editor_job_board', 'external-one'), boardJob({ audience: 'director_team', directorUid: 'dir1', eligibleUids: ['external1'] }));
      await setDoc(doc(db, 'editor_job_board', 'external-two'), boardJob({ audience: 'director_team', directorUid: 'dir2', eligibleUids: ['external2'] }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'done1'), portalJob('external1', { directorUid: 'dir1', status: '完了', evidenceUrl: 'https://example.com/delivery' }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-save-budget'), externalWorkflowJob());
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-director'), externalWorkflowJob({ title: '手動進捗変更-D' }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-no-reason'), externalWorkflowJob({ title: '手動進捗変更-理由なし' }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-revision'), externalWorkflowJob({ title: '手動進捗変更-修正稿' }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-initial-round-two'), externalWorkflowJob({
        title: '手動進捗変更-初稿', status: '修正中', workflow: { round: 2, stage: 'editing' },
      }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-owner-complete'), externalWorkflowJob({
        title: '手動進捗変更-完了', status: 'D確認OK', evidenceUrl: 'https://example.com/final-delivery', blocker: '',
        workflow: { round: 1, stage: 'client_submission' },
      }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-dispatch-complete'), externalWorkflowJob({
        title: '手動進捗変更-派遣完了', businessType: 'dispatch', status: '先方確認中',
        evidenceUrl: 'https://example.com/dispatch-delivery', blocker: '', workflow: { round: 1, stage: 'client_review' },
      }));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'workflow-live-legacy-complete'), externalWorkflowJob({
        submittedByUid: 'direct1', editorUid: 'direct1', editorEmail: 'direct1@example.com', editorName: 'Direct 1',
        directorUid: '', title: '台本101', caseName: '8月分', parentCaseId: 'legacy:parent-august',
        parentCaseName: '8月分', legacyParentId: 'parent-august', legacySubtaskId: 'script-101',
        status: '先方確認中', evidenceUrl: 'https://example.com/initial-delivery', blocker: '',
        workflow: { round: 1, stage: 'client_review' },
        progressEvents: [
          { at: 1, type: 'editor_submitted', round: 1, byUid: 'direct1', byEmail: 'direct1@example.com', byRole: '担当編集者', fromStage: 'editing', toStage: 'director_review', status: '初稿提出済み', evidenceUrl: 'https://example.com/initial-delivery' },
          { at: 2, type: 'director_approved', action: 'directorApprove', round: 1, byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner', fromStage: 'director_review', toStage: 'client_submission', workflow: { round: 1, stage: 'client_submission' }, status: 'D確認OK' },
          { at: 3, type: 'client_submitted', action: 'clientSubmitted', round: 1, byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner', fromStage: 'client_submission', toStage: 'client_review', workflow: { round: 1, stage: 'client_review' }, status: '先方確認中' },
        ],
        history: [
          { at: 0, type: 'synced', by: 'owner', status: '進行中' },
          { at: 1, type: 'editor_submitted', by: 'direct1', status: '初稿提出済み' },
          { at: 2, type: 'director_approved', by: 'owner', status: 'D確認OK' },
          { at: 3, type: 'client_submitted', by: 'owner', status: '先方確認中' },
          { at: 3, type: 'sync_projection', by: 'owner', status: '先方確認中' },
        ],
      }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-revision-save'), externalWorkflowJob({
        title: 'WD-S087', status: '修正中', evidenceUrl: 'https://example.com/initial',
        workflow: { round: 2, stage: 'editing' },
        progressEvents: [{
          at: 2, type: 'director_revision_requested', round: 2, byUid: 'dir1',
          byEmail: 'dir1@example.com', byRole: 'director', fromStage: 'director_review',
          toStage: 'editing', status: '修正中', reason: 'テロップ修正',
        }],
      }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'workflow-delivery-save'), externalWorkflowJob({
        businessType: 'dispatch', title: 'SU-S024', status: '先方確認中',
        evidenceUrl: 'https://example.com/initial', workflow: { round: 1, stage: 'client_review' },
        progressEvents: [{
          at: 2, type: 'client_submitted', round: 1, byUid: 'dir1',
          byEmail: 'dir1@example.com', byRole: 'director', fromStage: 'client_submission',
          toStage: 'client_review', status: '先方確認中', evidenceUrl: 'https://example.com/initial',
        }],
      }));
      // This legacy fixture simulates a historically saved external job with a
      // mono.create settlement field. The external editor must fail closed
      // until an owner removes/migrates it out of this readable document.
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'priced1'), portalJob('external1', { directorUid: 'dir1', ownPay: 5000, payableApproved: true, payableApprovedAt: 1, payableMonth: '2026-09' }));
      await setDoc(doc(db, 'editor_portals', 'external2', 'editor_jobs', 'done2'), portalJob('external2', { directorUid: 'dir2', status: '完了', evidenceUrl: 'https://example.com/delivery' }));
      await setDoc(doc(db, 'editor_portals', 'hybrid1', 'editor_jobs', 'own1'), portalJob('hybrid1'));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'priced-direct1'), portalJob('direct1', { ownPay: 5000, payableApproved: true, payableApprovedAt: 1, payableMonth: '2026-09' }));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'done1'), portalJob('direct1', { status: '完了', evidenceUrl: 'https://example.com/delivery', linkedLegacyJobId: 'legacy-direct1-done1' }));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'done-batch'), portalJob('direct1', { status: '完了', evidenceUrl: 'https://example.com/delivery', linkedLegacyJobId: 'legacy-direct1-batch' }));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'draft-creator'), portalJob('direct1', { editorDraftDateSetter: 'creator' }));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'draft-editor'), portalJob('direct1', { editorDraftDateSetter: 'editor' }));
      const legacyDraftSetterJob = portalJob('direct1');
      delete legacyDraftSetterJob.editorDraftDateSetter;
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_jobs', 'draft-legacy'), legacyDraftSetterJob);
      await setDoc(doc(db, 'editor_portals', 'external1', 'client_catalog', 'c1'), clientCatalog({ sourceClientId: '', formerNames: [] }));
      await setDoc(doc(db, 'editor_manuals', 'global'), { title: '全体', scope: 'global', scopeLabel: '全体', clientId: '', accountId: '', version: '1', body: '本文', url: '', required: true, audience: 'all', allowedUids: [], directorUid: '', updatedAt: 1, updatedBy: 'owner' });
      await setDoc(doc(db, 'editor_manuals', 'assigned'), { title: '個別', scope: 'client', scopeLabel: '個別', clientId: 'c1', accountId: '', version: '1', body: '本文', url: '', required: false, audience: 'assigned', allowedUids: ['external1'], directorUid: 'dir1', updatedAt: 1, updatedBy: 'dir1' });
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_invoices', 'inv1'), manualInvoice('external1', { status: '提出済み' }));
      await setDoc(doc(db, 'editor_portals', 'direct1', 'editor_invoices', 'inv1'), manualInvoice('direct1'));
      await setDoc(doc(db, 'editor_portals', 'dir1', 'editor_invoices', 'inv1'), manualInvoice('dir1'));
      await setDoc(doc(db, 'editor_portals', 'external1', 'invoice_authorizations', 'auth1'), { recordType: 'invoice_authorization', editorUid: 'external1', month: '2026-09', invoiceAvailableOn: '2026-09-25', paymentDueDate: '2026-10-31', jobIds: ['done1'], lines: [{ title: '案件1', amount: 5000 }], subtotal: 5000, tax: 0, total: 5000, revision: 1, invoiceVersion: 1, invoiceDocumentId: 'inv1', active: true });
      await setDoc(doc(db, 'editor_portals', 'direct1', 'invoice_authorizations', 'auth1'), { recordType: 'invoice_authorization', editorUid: 'direct1', month: '2026-09', invoiceAvailableOn: '2026-09-25', paymentDueDate: '2026-10-31', jobIds: ['done1'], lines: [{ title: '案件1', amount: 5000 }], subtotal: 5000, tax: 0, total: 5000, revision: 1, invoiceVersion: 1, invoiceDocumentId: 'inv1', active: true });
      await setDoc(doc(db, 'editor_portals', 'dir1', 'invoice_authorizations', 'auth1'), { recordType: 'invoice_authorization', editorUid: 'dir1', month: '2026-09', invoiceAvailableOn: '2026-09-25', paymentDueDate: '2026-10-31', jobIds: ['done1'], lines: [{ title: '案件1', amount: 5000 }], subtotal: 5000, tax: 0, total: 5000, revision: 1, invoiceVersion: 1, invoiceDocumentId: 'inv1', active: true });
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_invoices', 'inv1', 'events', 'e1'), { type: 'created', byUid: 'external1' });
      await setDoc(doc(db, 'editor_portals', 'external1', 'invoice_authorizations', 'auth1', 'events', 'e1'), { type: 'approved', byUid: 'dir1' });
      await setDoc(doc(db, 'shared', 'mcapp'), { clientPrice: 999999, profit: 999999 });
      await setDoc(doc(db, 'users', 'dir1'), { json_mcapp: 'legacy-director-private-copy', ts_mcapp: 1 });
      await setDoc(doc(db, 'users', 'hybrid1'), { json_mcapp: 'non-director-core-private-copy', ts_mcapp: 1 });
    });

    const direct1 = env.authenticatedContext('direct1', claims('direct1@example.com')).firestore();
    const direct2 = env.authenticatedContext('direct2', claims('direct2@example.com')).firestore();
    const external1 = env.authenticatedContext('external1', claims('external1@example.com')).firestore();
    const externalHybrid = env.authenticatedContext('externalHybrid', claims('externalHybrid@example.com')).firestore();
    const hybrid1 = env.authenticatedContext('hybrid1', claims('hybrid1@example.com')).firestore();
    const sales1 = env.authenticatedContext('sales1', claims('sales1@example.com')).firestore();
    const dir1 = env.authenticatedContext('dir1', claims('dir1@example.com')).firestore();
    const dir2 = env.authenticatedContext('dir2', claims('dir2@example.com')).firestore();
    const owner = env.authenticatedContext('owner', claims('mono.create.group@gmail.com')).firestore();

    const ownerPricing = {
      recordType: 'owner_client_pricing', clientSource: 'projects', sourceClientId: 'c1',
      clientName: 'クライアントA', defaultClientUnitPrice: 5000,
      accountUnitPrices: { a1: 6000 }, revision: 1, updatedAt: 1, updatedBy: 'owner',
    };
    await expectAllowed('owner stores client pricing in the owner-only master', setDoc(doc(owner, 'owner_client_pricing', 'projects_c1'), ownerPricing));
    await expectAllowed('owner reads client pricing master', getDoc(doc(owner, 'owner_client_pricing', 'projects_c1')));
    await expectDenied('direct editor cannot read client pricing master', getDoc(doc(direct1, 'owner_client_pricing', 'projects_c1')));
    await expectDenied('external editor cannot read client pricing master', getDoc(doc(external1, 'owner_client_pricing', 'projects_c1')));
    await expectDenied('video director cannot read client pricing master', getDoc(doc(dir1, 'owner_client_pricing', 'projects_c1')));
    await expectDenied('editor cannot write client pricing master', setDoc(doc(direct1, 'owner_client_pricing', 'projects-c2'), { ...ownerPricing, sourceClientId: 'c2' }));

    await expectAllowed('owner creates a three-part monthly delivery goal', setDoc(doc(owner, 'owner_delivery_goals', '2026-09'), ownerDeliveryGoal()));
    await expectAllowed('old app goal remains valid during the no-downtime rollout', setDoc(doc(owner, 'owner_delivery_goals', '2026-08'), legacyOwnerDeliveryGoal({ month: '2026-08' })));
    await expectAllowed('owner reads the private monthly delivery goal', getDoc(doc(owner, 'owner_delivery_goals', '2026-09')));
    await expectDenied('editor cannot read the private monthly delivery goal', getDoc(doc(direct1, 'owner_delivery_goals', '2026-09')));
    await expectDenied('monthly goal rejects a total that differs from its three parts', setDoc(doc(owner, 'owner_delivery_goals', '2026-10'), ownerDeliveryGoal({ month: '2026-10', targetCount: 36 })));
    await expectDenied('monthly goal rejects a partial three-part payload', setDoc(doc(owner, 'owner_delivery_goals', '2026-11'), { ...legacyOwnerDeliveryGoal({ month: '2026-11' }), internalTargetCount: 10 }));
    await expectAllowed('owner updates all three targets with a matching derived total', updateDoc(doc(owner, 'owner_delivery_goals', '2026-09'), {
      internalTargetCount: 12, internalTargetAmount: 60000,
      agencyTargetCount: 18, agencyTargetAmount: 18000,
      dispatchTargetCount: 6, dispatchTargetAmount: 36000,
      targetCount: 36, targetAmount: 114000, revision: 2,
      updatedAt: serverTimestamp(), updatedBy: 'owner',
    }));

    await expectAllowed('owner creates an immutable case finance record with external-editor to director routing', setDoc(doc(owner, 'owner_job_finance', 'legacy-external1-done1'), ownerJobFinance()));
    await expectAllowed('owner reads the private case finance record', getDoc(doc(owner, 'owner_job_finance', 'legacy-external1-done1')));
    await expectDenied('external editor cannot read private case finance', getDoc(doc(external1, 'owner_job_finance', 'legacy-external1-done1')));
    await expectDenied('assigned director cannot read private case finance', getDoc(doc(dir1, 'owner_job_finance', 'legacy-external1-done1')));
    await expectDenied('direct editor cannot read private case finance', getDoc(doc(direct1, 'owner_job_finance', 'legacy-external1-done1')));
    await expectDenied('owner cannot route an external editors settlement to the external editor', setDoc(doc(owner, 'owner_job_finance', 'bad-external-route'), ownerJobFinance({ legacyJobId: 'bad-external-route', payRoute: 'direct', payeeUid: 'external1', payeeWorkerId: 'worker-external1' })));
    await expectAllowed('owner routes a direct editors confirmed payment to that editor', setDoc(doc(owner, 'owner_job_finance', 'legacy-direct1-done1'), ownerJobFinance({ portalUid: 'direct1', portalJobId: 'done1', legacyJobId: 'legacy-direct1-done1', payRoute: 'direct', payeeUid: 'direct1', payeeWorkerId: 'worker-direct1', assigneeUid: 'direct1', assigneeWorkerId: 'worker-direct1', approvedPayAmount: 3000 })));
    await expectDenied('case price override requires an audit reason', setDoc(doc(owner, 'owner_job_finance', 'missing-override-reason'), ownerJobFinance({ legacyJobId: 'missing-override-reason', pricingSource: 'case_override', clientUnitPrice: 6500, overrideReason: '' })));
    await expectDenied('confirmed case finance cannot be silently rewritten', updateDoc(doc(owner, 'owner_job_finance', 'legacy-external1-done1'), { approvedPayAmount: 9999, updatedAt: serverTimestamp() }));
    await expectAllowed('owner creates an immutable legacy finance migration record', setDoc(doc(owner, 'owner_legacy_finance', 'legacy-finance-1'), ownerLegacyFinance()));
    await expectAllowed('owner reads an immutable legacy finance migration record', getDoc(doc(owner, 'owner_legacy_finance', 'legacy-finance-1')));
    await expectDenied('direct editor cannot read legacy finance migration records', getDoc(doc(direct1, 'owner_legacy_finance', 'legacy-finance-1')));
    await expectDenied('director cannot read legacy finance migration records', getDoc(doc(dir1, 'owner_legacy_finance', 'legacy-finance-1')));
    await expectDenied('legacy finance migration rejects malformed parent amounts', setDoc(doc(owner, 'owner_legacy_finance', 'legacy-finance-malformed'), ownerLegacyFinance({ legacyJobId: 'legacy-finance-malformed', parentAmounts: { unitPrice: 6000, workerPay: 3000, profit: 3000, monthlyFee: 0 } })));
    await expectDenied('legacy finance migration records are immutable', updateDoc(doc(owner, 'owner_legacy_finance', 'legacy-finance-1'), { revision: 2 }));
    await expectDenied('owner cannot approve a dispatch portal job with an amount different from its immutable case ledger', updateDoc(doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'done1'), { ownPay: 9999, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'owner' }));
    await expectAllowed('owner can approve a dispatch portal job only when ownPay mirrors immutable case ledger', updateDoc(doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'done1'), { ownPay: 3000, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'owner' }));
    const integrationBatch = writeBatch(owner);
    integrationBatch.set(doc(owner, 'owner_job_finance', 'legacy-direct1-batch'), ownerJobFinance({ portalUid: 'direct1', portalJobId: 'done-batch', legacyJobId: 'legacy-direct1-batch', payRoute: 'direct', payeeUid: 'direct1', payeeWorkerId: 'worker-direct1', assigneeUid: 'direct1', assigneeWorkerId: 'worker-direct1', approvedPayAmount: 3100 }));
    integrationBatch.update(doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'done-batch'), { ownPay: 3100, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'owner' });
    await expectAllowed('owner can atomically create immutable finance and its matching dispatch portal mirror', integrationBatch.commit());

    await expectAllowed('owner archives legacy external settlement before removing it from the portal job', setDoc(doc(owner, 'external_compensation_archive', 'external1-priced1'), { editorUid: 'external1', directorUid: 'dir1', sourceJobId: 'priced1', ownPay: 5000, payableApproved: true, payableMonth: '2026-09', archivedAt: 1 }));
    await expectDenied('external editor cannot read owner-only settlement archive', getDoc(doc(external1, 'external_compensation_archive', 'external1-priced1')));
    await expectDenied('director cannot read mono.create settlement archive', getDoc(doc(dir1, 'external_compensation_archive', 'external1-priced1')));
    await expectDenied('direct editor cannot read external settlement archive', getDoc(doc(direct1, 'external_compensation_archive', 'external1-priced1')));

    await expectAllowed('owner publishes edit-agency board job', setDoc(doc(owner, 'editor_job_board', 'owner-new'), boardJob({ createdByUid: 'owner' })));
    await expectAllowed('director publishes own edit-agency board job', setDoc(doc(dir1, 'editor_job_board', 'dir-new'), boardJob({ audience: 'director_team', directorUid: 'dir1', eligibleUids: ['external1'], createdByUid: 'dir1' })));
    await expectDenied('board rejects an unsupported business type', setDoc(doc(owner, 'editor_job_board', 'wrong-biz'), boardJob({ businessType: 'dispatch', createdByUid: 'owner' })));
    await expectDenied('board creator-set draft requires a date', setDoc(doc(owner, 'editor_job_board', 'creator-without-draft'), boardJob({ editorDraftDate: '', editorDraftDateSetter: 'creator', createdByUid: 'owner' })));
    await expectAllowed('board editor-set draft may start blank', setDoc(doc(owner, 'editor_job_board', 'editor-without-draft'), boardJob({ editorDraftDate: '', editorDraftDateSetter: 'editor', createdByUid: 'owner' })));

    await expectAllowed('direct editor sees direct board', getDoc(doc(direct1, 'editor_job_board', 'direct-open')));
    await expectDenied('external editor cannot see direct board', getDoc(doc(external1, 'editor_job_board', 'direct-open')));
    await expectAllowed('external editor sees own director board', getDoc(doc(external1, 'editor_job_board', 'external-one')));
    await expectDenied('external editor cannot see another director board', getDoc(doc(external1, 'editor_job_board', 'external-two')));
    await expectAllowed('editor reads own portal', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'done1')));
    await expectDenied('external editor is fail-closed from a legacy priced portal job', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'priced1')));
    await expectDenied('director cannot read a legacy priced external portal job', getDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'priced1')));
    await expectDenied('editor cannot read another portal', getDoc(doc(external1, 'editor_portals', 'external2', 'editor_jobs', 'done2')));
    await expectAllowed('director reads assigned external editor', getDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'done1')));
    await expectDenied('director cannot read another director editor', getDoc(doc(dir1, 'editor_portals', 'external2', 'editor_jobs', 'done2')));
    await expectDenied('director cannot use editor-jobs collection-group access after team transfers', getDocs(query(collectionGroup(dir1, 'editor_jobs'), where('directorUid', '==', 'dir1'))));
    await expectAllowed('owner reads every portal', getDoc(doc(owner, 'editor_portals', 'external2', 'editor_jobs', 'done2')));
    await expectDenied('editor cannot read shared financial monolith', getDoc(doc(direct1, 'shared', 'mcapp')));
    await expectAllowed('hybrid editor uses core staff data through the additional role', getDoc(doc(hybrid1, 'shared', 'mcapp')));
    await expectDenied('external editor with a legacy second role cannot read shared financial monolith', getDoc(doc(externalHybrid, 'shared', 'mcapp')));
    await expectDenied('video director cannot read the company-wide shared monolith', getDoc(doc(dir1, 'shared', 'mcapp')));
    await expectDenied('video director cannot write the company-wide shared monolith', updateDoc(doc(dir1, 'shared', 'mcapp'), { directorProbe: true }));
    await expectDenied('video director cannot read a shared sales shard', getDoc(doc(dir1, 'shared', 'mcapp_leads_0')));
    await expectDenied('video director cannot list shared records', getDocs(collection(dir1, 'shared')));
    await expectDenied('video director cannot collection-group query shared records', getDocs(collectionGroup(dir1, 'shared')));
    await expectAllowed('non-director core staff keeps shared monolith access', getDoc(doc(hybrid1, 'shared', 'mcapp')));
    await expectAllowed('pre-migration marker old core client can still update shared jobs', updateDoc(doc(hybrid1, 'shared', 'mcapp'), { jobs: 'legacy-v24-payload' }));
    await expectAllowed('owner marks shared ledger after immutable finance migration', updateDoc(doc(owner, 'shared', 'mcapp'), { ownerLegacyFinanceMigrationAt: 2, ledgerRestoreToken: 'restore-token-v29', legacyFinanceWriteNonce: 'stage2-migration' }));
    await expectDenied('post-migration old core client cannot overwrite shared jobs without nonce and restore acknowledgement', updateDoc(doc(hybrid1, 'shared', 'mcapp'), { jobs: 'stale-v24-payload' }));
    await expectDenied('post-migration jobs update rejects a wrong restore acknowledgement', updateDoc(doc(owner, 'shared', 'mcapp'), { jobs: 'wrong-ack-payload', legacyFinanceWriteNonce: 'wrong-token:v29-save-wrong', legacyFinanceRestoreAck: 'wrong-token' }));
    await expectAllowed('post-migration v29 client updates shared jobs with token-prefixed nonce and current restore acknowledgement', updateDoc(doc(owner, 'shared', 'mcapp'), { jobs: 'v29-payload', legacyFinanceWriteNonce: 'restore-token-v29:v29-save-1', legacyFinanceRestoreAck: 'restore-token-v29' }));
    await expectDenied('post-migration v28 merge cannot reuse the persisted acknowledgement with a bare nonce', updateDoc(doc(owner, 'shared', 'mcapp'), { jobs: 'stale-v28-after-v29', legacyFinanceWriteNonce: 'v28-bare-random-nonce' }));
    await expectAllowed('post-migration core client can update shared fields when jobs stay unchanged', updateDoc(doc(hybrid1, 'shared', 'mcapp'), { coreNonJobProbe: true }));
    await expectAllowed('non-director core staff keeps shared monolith write access', setDoc(doc(hybrid1, 'shared', 'core-staff-fixture'), { probe: true }));
    await expectAllowed('owner keeps shared monolith write access', updateDoc(doc(owner, 'shared', 'mcapp'), { ownerProbe: true }));
    await expectDenied('video director cannot read own legacy personal document', getDoc(doc(dir1, 'users', 'dir1')));
    await expectDenied('video director cannot write own legacy personal document', updateDoc(doc(dir1, 'users', 'dir1'), { directorProbe: true }));
    await expectAllowed('non-director core staff keeps own legacy personal document access', getDoc(doc(hybrid1, 'users', 'hybrid1')));
    await expectAllowed('non-director core staff keeps own legacy personal document write access', updateDoc(doc(hybrid1, 'users', 'hybrid1'), { coreStaffProbe: true }));
    await expectAllowed('owner keeps legacy personal document access', updateDoc(doc(owner, 'users', 'dir1'), { ownerProbe: true }));
    await expectAllowed('hybrid editor also uses own editor portal', getDoc(doc(hybrid1, 'editor_portals', 'hybrid1', 'editor_jobs', 'own1')));
    await expectDenied('hybrid editor still cannot read another editor portal', getDoc(doc(hybrid1, 'editor_portals', 'external1', 'editor_jobs', 'done1')));

    const managerOverrideEvent = ({
      byUid = 'dir1', byEmail = `${byUid}@example.com`, byRole = 'director',
      fromStatus = '進行中', fromStage = 'editing', status = 'D確認OK',
      toStage = 'client_submission', round = 1, reason = '実際の進行状況に合わせて修正',
      completedDeliveryDate = '', evidenceUrl = '', clientApprovalConfirmed = false,
    } = {}) => ({
      at: 3, byUid, byEmail, byRole, type: 'manager_status_changed',
      action: 'managerStatusOverride', fromStatus, fromStage, toStage, round,
      workflow: { round, stage: toStage }, status, reason,
      ...(evidenceUrl ? { evidenceUrl } : {}),
      ...(completedDeliveryDate ? { completedDeliveryDate } : {}),
      ...(clientApprovalConfirmed ? { clientApprovalConfirmed: true } : {}),
    });
    const managerOverrideUpdate = (event, previousEvents = []) => ({
      status: event.status, workflow: event.workflow, progressEvents: [...previousEvents, event],
      correctionReason: event.status === '修正中' ? event.reason : '',
      updatedAt: 3, updatedBy: event.byEmail,
      history: [...externalWorkflowJob().history, ...previousEvents, event],
      ...(event.evidenceUrl ? { evidenceUrl: event.evidenceUrl } : {}),
      ...(event.completedDeliveryDate ? { completedDeliveryDate: event.completedDeliveryDate } : {}),
    });
    const manualDirectorRef = doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-director');
    await expectDenied('unassigned director cannot manually override progress', updateDoc(
      doc(dir2, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-director'),
      managerOverrideUpdate(managerOverrideEvent({ byUid: 'dir2', byEmail: 'dir2@example.com' }))
    ));
    await expectDenied('assigned editor cannot claim a manager progress override', updateDoc(
      doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-director'),
      managerOverrideUpdate(managerOverrideEvent({ byUid: 'external1', byEmail: 'external1@example.com' }))
    ));
    const directorOverride = managerOverrideEvent();
    const directorOverrideBatch = writeBatch(dir1);
    directorOverrideBatch.update(manualDirectorRef, managerOverrideUpdate(directorOverride));
    directorOverrideBatch.set(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-director', 'events', 'manager-override-1'), {
      ...directorOverride, at: serverTimestamp(),
    });
    await expectAllowed('assigned director can choose a non-adjacent progress with an audit event', directorOverrideBatch.commit());
    const missingReason = managerOverrideEvent({ reason: '' });
    await expectDenied('manual progress override requires a reason', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-no-reason'),
      managerOverrideUpdate(missingReason)
    ));
    const submittedWithoutEvidence = managerOverrideEvent({
      status: '初稿提出済み', toStage: 'director_review', round: 1,
    });
    await expectDenied('manual submitted progress requires a matching evidence URL', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-no-reason'),
      managerOverrideUpdate(submittedWithoutEvidence)
    ));
    const revisionWrongRound = managerOverrideEvent({
      status: '修正稿提出済み', toStage: 'director_review', round: 1,
      evidenceUrl: 'https://example.com/revision-manual',
    });
    await expectDenied('manual revision submission cannot be recorded as round one', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-revision'),
      managerOverrideUpdate(revisionWrongRound)
    ));
    const revisionRoundTwo = managerOverrideEvent({
      status: '修正稿提出済み', toStage: 'director_review', round: 2,
      evidenceUrl: 'https://example.com/revision-manual',
    });
    await expectAllowed('manual revision submission normalizes to at least round two', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-revision'),
      managerOverrideUpdate(revisionRoundTwo)
    ));
    const initialWrongRound = managerOverrideEvent({
      fromStatus: '修正中', status: '初稿提出済み', toStage: 'director_review', round: 2,
      evidenceUrl: 'https://example.com/initial-manual',
    });
    await expectDenied('manual initial submission cannot retain a later revision round', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-initial-round-two'),
      managerOverrideUpdate(initialWrongRound)
    ));
    const initialRoundOne = managerOverrideEvent({
      fromStatus: '修正中', status: '初稿提出済み', toStage: 'director_review', round: 1,
      evidenceUrl: 'https://example.com/initial-manual',
    });
    await expectAllowed('manual initial submission normalizes to round one', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-initial-round-two'),
      managerOverrideUpdate(initialRoundOne)
    ));
    const completedDate = '2026-09-01';
    const ownerCompletion = managerOverrideEvent({
      byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner',
      fromStatus: 'D確認OK', fromStage: 'client_submission', status: '完了',
      toStage: 'delivered', completedDeliveryDate: completedDate,
      evidenceUrl: 'https://example.com/final-delivery', clientApprovalConfirmed: true,
      reason: 'クライアントOKを確認したため完了へ修正',
    });
    const ownerCompletionRef = doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-owner-complete');
    await expectDenied('manual completion requires explicit client approval confirmation', updateDoc(
      ownerCompletionRef,
      managerOverrideUpdate({ ...ownerCompletion, clientApprovalConfirmed: false })
    ));
    await expectDenied('manual completion audit date must match the job completion date', updateDoc(
      ownerCompletionRef,
      { ...managerOverrideUpdate(ownerCompletion), completedDeliveryDate: '2026-08-31' }
    ));
    await expectAllowed('owner can manually complete an edit-agency job with date, evidence, and audit reason', updateDoc(
      ownerCompletionRef, managerOverrideUpdate(ownerCompletion)
    ));
    const liveLegacyCompletionEvent = {
      at: 4, byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner',
      type: 'client_approved_completed', action: 'clientApproved', fromStage: 'client_review',
      toStage: 'delivered', round: 1, workflow: { round: 1, stage: 'delivered' },
      status: '完了', completedDeliveryDate: completedDate,
    };
    const liveLegacyCompletionBatch = writeBatch(owner);
    liveLegacyCompletionBatch.update(
      doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'workflow-live-legacy-complete'),
      {
        workflow: { round: 1, stage: 'delivered' },
        progressEvents: [
          { at: 1, type: 'editor_submitted', round: 1, byUid: 'direct1', byEmail: 'direct1@example.com', byRole: '担当編集者', fromStage: 'editing', toStage: 'director_review', status: '初稿提出済み', evidenceUrl: 'https://example.com/initial-delivery' },
          { at: 2, type: 'director_approved', action: 'directorApprove', round: 1, byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner', fromStage: 'director_review', toStage: 'client_submission', workflow: { round: 1, stage: 'client_submission' }, status: 'D確認OK' },
          { at: 3, type: 'client_submitted', action: 'clientSubmitted', round: 1, byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner', fromStage: 'client_submission', toStage: 'client_review', workflow: { round: 1, stage: 'client_review' }, status: '先方確認中' },
          liveLegacyCompletionEvent,
        ],
        status: '完了', completedDeliveryDate: completedDate, correctionReason: '',
        updatedAt: 4, updatedBy: 'mono.create.group@gmail.com',
        history: [
          { at: 0, type: 'synced', by: 'owner', status: '進行中' },
          { at: 1, type: 'editor_submitted', by: 'direct1', status: '初稿提出済み' },
          { at: 2, type: 'director_approved', by: 'owner', status: 'D確認OK' },
          { at: 3, type: 'client_submitted', by: 'owner', status: '先方確認中' },
          { at: 3, type: 'sync_projection', by: 'owner', status: '先方確認中' },
          liveLegacyCompletionEvent,
        ],
      }
    );
    liveLegacyCompletionBatch.set(
      doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'workflow-live-legacy-complete', 'events', 'client-approved'),
      { ...liveLegacyCompletionEvent, at: serverTimestamp() }
    );
    await expectAllowed('owner can complete a production-shaped legacy-sync job from the inline subcase control', liveLegacyCompletionBatch.commit());
    const reopenEvent = managerOverrideEvent({
      byUid: 'owner', byEmail: 'mono.create.group@gmail.com', byRole: 'owner',
      fromStatus: '完了', fromStage: 'delivered', status: '進行中', toStage: 'editing',
      reason: '完了後の再開を試行',
    });
    await expectDenied('completed progress cannot be reopened through the free selector', updateDoc(
      ownerCompletionRef, managerOverrideUpdate(reopenEvent, [ownerCompletion])
    ));
    const dispatchCompletion = managerOverrideEvent({
      fromStatus: '先方確認中', fromStage: 'client_review', status: '完了',
      toStage: 'delivered', completedDeliveryDate: completedDate,
      evidenceUrl: 'https://example.com/dispatch-delivery', clientApprovalConfirmed: true,
      reason: '管理者から派遣案件を完了へ変更',
    });
    await expectDenied('manager cannot take the assigned editors final-delivery action', updateDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-manual-dispatch-complete'),
      managerOverrideUpdate(dispatchCompletion)
    ));

    await expectAllowed('editor changes only own Chatwork display name', updateDoc(doc(direct1, 'access', 'direct1'), { name: 'Direct Chatwork', updatedAt: 2 }));
    await expectDenied('editor cannot change own roles while renaming', updateDoc(doc(direct1, 'access', 'direct1'), { name: 'Direct Chatwork', roles: ['動画編集者', '営業'], updatedAt: 3 }));
    await expectDenied('editor cannot rename another account', updateDoc(doc(direct1, 'access', 'direct2'), { name: 'Wrong', updatedAt: 2 }));

    // Direct-message directory and conversation boundaries. These query shapes
    // are the only access-directory list queries the Slack-style DM surface
    // may use: owner lists approved people; a director lists own externals.
    await expectAllowed('owner can load approved DM peer directory', getDocs(query(collection(owner, 'access'), where('approved', '==', true))));
    await expectAllowed('director can load only own external DM peers', getDocs(query(collection(dir1, 'access'), where('directorUid', '==', 'dir1'))));
    await expectDenied('direct editor cannot enumerate access directory', getDocs(query(collection(direct1, 'access'), where('approved', '==', true))));
    await expectAllowed('direct editor can read only own access record', getDoc(doc(direct1, 'access', 'direct1')));
    await expectDenied('direct editor cannot read director access record', getDoc(doc(direct1, 'access', 'dir1')));

    await expectAllowed('owner starts a DM with a direct editor', setDoc(doc(owner, 'direct_threads', 'dm-owner-direct1'), directThread('owner', 'direct1', 'owner')));
    await expectAllowed('direct editor reads own owner DM', getDoc(doc(direct1, 'direct_threads', 'dm-owner-direct1')));
    await expectDenied('unrelated director cannot read direct editor owner DM', getDoc(doc(dir1, 'direct_threads', 'dm-owner-direct1')));
    await expectAllowed('participant updates only latest-message summary', updateDoc(doc(direct1, 'direct_threads', 'dm-owner-direct1'), { updatedAt: serverTimestamp(), lastMessageAt: serverTimestamp(), lastMessagePreview: '確認しました。', lastSenderUid: 'direct1', lastSenderName: 'Direct 1' }));
    await expectDenied('nonparticipant cannot update DM summary', updateDoc(doc(dir1, 'direct_threads', 'dm-owner-direct1'), { updatedAt: serverTimestamp(), lastMessageAt: serverTimestamp(), lastMessagePreview: '改ざん', lastSenderUid: 'dir1', lastSenderName: 'Dir 1' }));
    await expectDenied('direct editor cannot start a DM with an unrelated director', setDoc(doc(direct1, 'direct_threads', 'dm-direct1-dir1'), directThread('direct1', 'dir1')));
    await expectAllowed('director starts a DM with own external editor', setDoc(doc(dir1, 'direct_threads', 'dm-dir1-external1'), directThread('dir1', 'external1')));
    await expectAllowed('external editor reads own director DM', getDoc(doc(external1, 'direct_threads', 'dm-dir1-external1')));
    await expectAllowed('owner starts a DM with an external editor', setDoc(doc(owner, 'direct_threads', 'dm-owner-external1'), directThread('owner', 'external1', 'owner')));
    await expectDenied('other director cannot start a DM with another teams external editor', setDoc(doc(dir2, 'direct_threads', 'dm-dir2-external1'), directThread('dir2', 'external1')));
    await expectAllowed('direct editor appends a text-only message', setDoc(doc(direct1, 'direct_threads', 'dm-owner-direct1', 'messages', 'm1'), { senderUid: 'direct1', senderName: 'Direct 1', body: '確認しました。', createdAt: serverTimestamp() }));
    await expectDenied('participant cannot forge another sender', setDoc(doc(owner, 'direct_threads', 'dm-owner-direct1', 'messages', 'm-forged'), { senderUid: 'direct1', senderName: 'Direct 1', body: 'なりすまし', createdAt: serverTimestamp() }));
    await expectDenied('message rejects case or money fields', setDoc(doc(direct1, 'direct_threads', 'dm-owner-direct1', 'messages', 'm-sensitive'), { senderUid: 'direct1', senderName: 'Direct 1', body: '確認しました。', ownPay: 5000, createdAt: serverTimestamp() }));
    await expectDenied('message is append-only', updateDoc(doc(direct1, 'direct_threads', 'dm-owner-direct1', 'messages', 'm1'), { body: '書き換え' }));
    await expectAllowed('editor stores only own read receipt', setDoc(doc(direct1, 'direct_threads', 'dm-owner-direct1', 'reads', 'direct1'), { readerUid: 'direct1', lastReadAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await expectDenied('owner cannot read editors private read receipt', getDoc(doc(owner, 'direct_threads', 'dm-owner-direct1', 'reads', 'direct1')));
    await expectDenied('owner cannot forge editors read receipt', setDoc(doc(owner, 'direct_threads', 'dm-owner-direct1', 'reads', 'direct1'), { readerUid: 'direct1', lastReadAt: serverTimestamp(), updatedAt: serverTimestamp() }));
    await expectDenied('generic participants-only DM list cannot bypass current relationship checks', getDocs(query(collection(direct1, 'direct_threads'), where('participants', 'array-contains', 'direct1'))));
    await expectAllowed('direct editor lists own owner conversations with an ownerUid filter', getDocs(query(collection(direct1, 'direct_threads'), where('participants', 'array-contains', 'direct1'), where('ownerUid', '!=', ''))));
    await expectAllowed('owner lists owner conversations with own ownerUid filter', getDocs(query(collection(owner, 'direct_threads'), where('participants', 'array-contains', 'owner'), where('ownerUid', '==', 'owner'))));

    await expectAllowed('video director receives editor board access', getDoc(doc(dir1, 'editor_job_board', 'direct-open')));
    await expectAllowed('video director creates a job in own editor portal', setDoc(doc(dir1, 'editor_portals', 'dir1', 'editor_jobs', 'director-own'), portalJob('dir1')));
    // Historical synchronized work and editor-created direct-client dispatch
    // both record actual delivery only when delivery is completed.
    const legacyUnscheduledExternalJob = portalJob('external1', {
      source: 'legacy_sync', directorUid: 'dir1', deadline: '', deliveryDate: '',
      parentCaseId: 'legacy-parent-miyuu', parentCaseName: '和光市デンタルオフィス様_9月分',
      legacyParentId: 'legacy-parent-miyuu', legacySubtaskId: 'legacy-subtask-miyuu-1',
    });
    delete legacyUnscheduledExternalJob.sourceClientId;
    delete legacyUnscheduledExternalJob.editorPayAmount;
    await expectDenied('video director cannot rerun legacy ledger synchronization', setDoc(
      doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'director-legacy-resync'),
      legacyUnscheduledExternalJob
    ));
    await expectAllowed('owner synchronizes an external legacy job with no planned delivery date', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-no-delivery-date'),
      legacyUnscheduledExternalJob
    ));
    await expectAllowed('owner creates a recoverable legacy projection for reassignment', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete'),
      { ...legacyUnscheduledExternalJob, legacySubtaskId: 'legacy-subtask-reassignment-delete' }
    ));
    await expectAllowed('owner records reassignment history before moving the projection', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete', 'events', 'history-before-move'),
      { at: 1, type: 'created', byUid: 'owner' }
    ));
    await expectAllowed('owner records a case message before moving the projection', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete', 'messages', 'message-before-move'),
      { body: '担当変更前の連絡', kind: '連絡', url: '', byUid: 'owner', byName: 'オーナー', byRole: 'オーナー', createdAt: 1 }
    ));
    await expectDenied('assigned editor cannot delete a synchronized legacy projection', deleteDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete')));
    await expectDenied('assigned director cannot delete a synchronized legacy projection', deleteDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete')));
    await expectAllowed('owner can remove a recoverable legacy projection during reassignment', deleteDoc(doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete')));
    await expectDenied('former editor cannot read orphaned reassignment history', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete', 'events', 'history-before-move')));
    await expectDenied('former editor cannot append orphaned reassignment history', setDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete', 'events', 'history-after-move'), { at: 2, type: 'progress', byUid: 'external1' }));
    await expectDenied('former editor cannot read orphaned case messages', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete', 'messages', 'message-before-move')));
    await expectDenied('former editor cannot append orphaned case messages', setDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-reassignment-delete', 'messages', 'message-after-move'), { body: '旧担当側からの追加', kind: '連絡', url: '', byUid: 'external1', byName: '旧担当', byRole: '担当編集者', createdAt: 2 }));
    await expectDenied('owner cannot delete an editor-created portal case', deleteDoc(doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'draft-editor')));
    await expectAllowed('owner synchronizes a legacy child with its zero-based added order', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-added-order-zero'),
      { ...legacyUnscheduledExternalJob, subtaskIndex: 0 }
    ));
    await expectAllowed('owner synchronizes a later legacy child with its added order', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-added-order-seven'),
      { ...legacyUnscheduledExternalJob, legacySubtaskId: 'legacy-subtask-miyuu-7', subtaskIndex: 7 }
    ));
    await expectAllowed('owner adds linked manuals and a caution to an existing synchronized job', updateDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-no-delivery-date'),
      {
        manualIds: ['assigned'], parentManualIds: ['global'],
        caution: '色調整の指示を最初に確認', parentCaution: '共通の注意事項', updatedAt: 2,
      }
    ));
    await expectDenied('legacy synchronization rejects a negative added order', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-added-order-negative'),
      { ...legacyUnscheduledExternalJob, legacySubtaskId: 'legacy-subtask-miyuu-negative', subtaskIndex: -1 }
    ));
    await expectDenied('legacy synchronization rejects a non-integer added order', setDoc(
      doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'legacy-added-order-fraction'),
      { ...legacyUnscheduledExternalJob, legacySubtaskId: 'legacy-subtask-miyuu-fraction', subtaskIndex: 1.5 }
    ));
    await expectAllowed('external editor saves progress on a legacy job while its delivery date stays blank', updateDoc(
      doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'legacy-no-delivery-date'),
      {
        progress: '編集作業中', lastProgressChangedByUid: 'external1',
        lastProgressChangedByEmail: 'external1@example.com',
        lastProgressChangedByRole: '担当編集者', updatedAt: 2,
      }
    ));
    // Regression for the production-shaped save that previously exhausted the
    // Firestore Rules 1,000-expression request budget. Each job update is
    // committed atomically with the immutable event written by editor.html.
    const workflowHistory = [
      { at: 1, type: 'synced', by: 'owner', status: '進行中' },
      { at: 2, type: 'editor_progress', by: 'external1', status: '進行中' },
    ];
    const startBatch = writeBatch(external1);
    startBatch.update(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-save-budget'), {
      status: '編集者進行中', deadline: '', deliveryDate: '', sharedDate: '2026-08-28',
      editorDraftDate: '2026-09-01', clientDraftDate: '2026-09-11', thumbnailDate: '',
      progress: '', evidenceUrl: '', blocker: '', workDate: '', startTime: '', endTime: '',
      workflow: { round: 1, stage: 'editing' }, progressEvents: [], progressMilestones: [],
      lastProgressChangedByUid: 'external1', lastProgressChangedByEmail: 'external1@example.com',
      lastProgressChangedByRole: '担当編集者', updatedAt: 3,
      history: [...workflowHistory, {
        at: 3, type: 'editor_progress', by: 'external1', byEmail: 'external1@example.com',
        byName: 'external1', byRole: '担当編集者', status: '編集者進行中',
        milestone: null, evidenceUrl: null,
      }],
    });
    startBatch.set(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-save-budget', 'events', 'progress-start'), {
      at: serverTimestamp(), type: 'progress', byUid: 'external1', byEmail: 'external1@example.com',
      byRole: '担当編集者', status: '編集者進行中', milestone: null, deliveryDate: '',
      hasEvidence: false, hasBlocker: false,
    });
    await expectAllowed('production-shaped external editor progress save stays within rules budget', startBatch.commit());

    const initialUrl = 'https://example.com/initial-draft';
    const initialEvent = {
      at: 4, type: 'editor_submitted', round: 1, byUid: 'external1',
      byEmail: 'external1@example.com', byRole: '担当編集者', fromStage: 'editing',
      toStage: 'director_review', status: '初稿提出済み', evidenceUrl: initialUrl,
    };
    const initialBatch = writeBatch(external1);
    initialBatch.update(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-save-budget'), {
      status: '初稿提出済み', evidenceUrl: initialUrl,
      workflow: { round: 1, stage: 'director_review' }, progressEvents: [initialEvent],
      progressMilestones: [{
        key: 'initial_submitted', label: '初稿を提出', status: '初稿提出済み', at: 4,
        byUid: 'external1', byEmail: 'external1@example.com', byName: 'external1',
        byRole: '担当編集者', evidenceUrl: initialUrl,
      }],
      lastProgressChangedByUid: 'external1', lastProgressChangedByEmail: 'external1@example.com',
      lastProgressChangedByRole: '担当編集者', updatedAt: 4,
      history: [...workflowHistory, {
        at: 3, type: 'editor_progress', by: 'external1', byEmail: 'external1@example.com',
        byName: 'external1', byRole: '担当編集者', status: '編集者進行中',
        milestone: null, evidenceUrl: null,
      }, {
        at: 4, type: 'editor_milestone', by: 'external1', byEmail: 'external1@example.com',
        byName: 'external1', byRole: '担当編集者', status: '初稿提出済み',
        milestone: 'initial_submitted', evidenceUrl: initialUrl,
      }],
    });
    initialBatch.set(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-save-budget', 'events', 'initial-submission'), {
      at: serverTimestamp(), type: 'editor_milestone', byUid: 'external1',
      byEmail: 'external1@example.com', byRole: '担当編集者', status: '初稿提出済み',
      milestone: 'initial_submitted', deliveryDate: '', hasEvidence: true, hasBlocker: false,
    });
    await expectAllowed('production-shaped initial submission stays within rules budget', initialBatch.commit());

    const revisionUrl = 'https://example.com/revision';
    const revisionRequestedEvent = {
      at: 2, type: 'director_revision_requested', round: 2, byUid: 'dir1',
      byEmail: 'dir1@example.com', byRole: 'director', fromStage: 'director_review',
      toStage: 'editing', status: '修正中', reason: 'テロップ修正',
    };
    const revisionSubmittedEvent = {
      at: 5, type: 'editor_submitted', round: 2, byUid: 'external1',
      byEmail: 'external1@example.com', byRole: '担当編集者', fromStage: 'editing',
      toStage: 'director_review', status: '修正稿提出済み', evidenceUrl: revisionUrl,
    };
    const revisionBatch = writeBatch(external1);
    revisionBatch.update(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-revision-save'), {
      status: '修正稿提出済み', evidenceUrl: revisionUrl,
      workflow: { round: 2, stage: 'director_review' },
      progressEvents: [revisionRequestedEvent, revisionSubmittedEvent],
      progressMilestones: [{
        key: 'revision_submitted', label: '修正稿を提出', status: '修正稿提出済み', at: 5,
        byUid: 'external1', byEmail: 'external1@example.com', byName: 'external1',
        byRole: '担当編集者', evidenceUrl: revisionUrl,
      }],
      lastProgressChangedByUid: 'external1', lastProgressChangedByEmail: 'external1@example.com',
      lastProgressChangedByRole: '担当編集者', updatedAt: 5,
      history: [...workflowHistory, {
        at: 5, type: 'editor_milestone', by: 'external1', byEmail: 'external1@example.com',
        byName: 'external1', byRole: '担当編集者', status: '修正稿提出済み',
        milestone: 'revision_submitted', evidenceUrl: revisionUrl,
      }],
    });
    revisionBatch.set(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-revision-save', 'events', 'revision-submission'), {
      at: serverTimestamp(), type: 'editor_milestone', byUid: 'external1',
      byEmail: 'external1@example.com', byRole: '担当編集者', status: '修正稿提出済み',
      milestone: 'revision_submitted', deliveryDate: '', hasEvidence: true, hasBlocker: false,
    });
    await expectAllowed('production-shaped revision submission stays within rules budget', revisionBatch.commit());

    const completedDeliveryDate = '2026-09-01';
    const deliveryUrl = 'https://example.com/delivery-final';
    const clientReviewEvent = {
      at: 2, type: 'client_submitted', round: 1, byUid: 'dir1',
      byEmail: 'dir1@example.com', byRole: 'director', fromStage: 'client_submission',
      toStage: 'client_review', status: '先方確認中', evidenceUrl: 'https://example.com/initial',
    };
    const deliveryEvent = {
      at: 4, type: 'editor_delivery_completed', round: 1, byUid: 'external1',
      byEmail: 'external1@example.com', byRole: '担当編集者', fromStage: 'client_review',
      toStage: 'delivered', status: '完了', completedDeliveryDate, evidenceUrl: deliveryUrl,
    };
    const deliveryBatch = writeBatch(external1);
    deliveryBatch.update(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-delivery-save'), {
      status: '完了', completedDeliveryDate, evidenceUrl: deliveryUrl, blocker: '',
      workflow: { round: 1, stage: 'delivered' }, progressEvents: [clientReviewEvent, deliveryEvent],
      lastProgressChangedByUid: 'external1', lastProgressChangedByEmail: 'external1@example.com',
      lastProgressChangedByRole: '担当編集者', updatedAt: 4,
      history: [...workflowHistory, {
        at: 4, type: 'editor_delivery_completed', by: 'external1',
        byEmail: 'external1@example.com', byName: 'external1', byRole: '担当編集者',
        status: '完了', completedDeliveryDate, evidenceUrl: deliveryUrl,
      }],
    });
    deliveryBatch.set(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'workflow-delivery-save', 'events', 'delivery-completion'), {
      at: serverTimestamp(), type: 'editor_delivery_completed', byUid: 'external1',
      byEmail: 'external1@example.com', byRole: '担当編集者', fromStage: 'client_review',
      toStage: 'delivered', round: 1, status: '完了', completedDeliveryDate,
      evidenceUrl: deliveryUrl,
    });
    await expectAllowed('production-shaped delivery completion stays within rules budget', deliveryBatch.commit());
    await expectAllowed('editor creates a direct-client dispatch without a planned delivery date', setDoc(
      doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'normal-no-delivery-date'),
      portalJob('external1', { directorUid: 'dir1', deadline: '', deliveryDate: '' })
    ));
    const missingEditorPay = portalJob('external1', { directorUid: 'dir1', deadline: '', deliveryDate: '' });
    delete missingEditorPay.editorPayAmount;
    await expectDenied('direct-client dispatch requires editor payment amount', setDoc(
      doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'missing-editor-pay'), missingEditorPay
    ));
    await expectDenied('direct-client dispatch rejects a zero editor payment amount', setDoc(
      doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'zero-editor-pay'),
      portalJob('external1', { directorUid: 'dir1', deadline: '', deliveryDate: '', editorPayAmount: 0 })
    ));
    const editorDraftDateUpdate = (date) => ({
      editorDraftDate: date,
      lastProgressChangedByUid: 'direct1',
      lastProgressChangedByEmail: 'direct1@example.com',
      lastProgressChangedByRole: '担当編集者',
      updatedAt: 2,
    });
    await expectDenied('editor cannot change a creator-set first-draft date', updateDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'draft-creator'), editorDraftDateUpdate('2026-09-07')));
    await expectAllowed('editor can change an editor-set first-draft date', updateDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'draft-editor'), editorDraftDateUpdate('2026-09-07')));
    await expectAllowed('legacy job without setter keeps editor-set first-draft behavior', updateDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'draft-legacy'), editorDraftDateUpdate('2026-09-07')));
    await expectAllowed('video director saves own weekly editor schedule', setDoc(doc(dir1, 'editor_schedules', 'dir1'), weeklySchedule({ name: 'Dir 1' })));

    await expectAllowed('editor saves one-week calendar and routine', setDoc(doc(direct1, 'editor_schedules', 'direct1'), weeklySchedule()));
    await expectDenied('editor cannot store private schedule reason', setDoc(doc(direct1, 'editor_schedules', 'direct1'), weeklySchedule({ privateReason: '通院' })));
    await expectDenied('editor cannot save more than one week', setDoc(doc(direct1, 'editor_schedules', 'direct1'), weeklySchedule({ days: [...weeklySchedule().days, weeklySchedule().days[0]] })));
    await expectAllowed('editors see team availability', getDoc(doc(external1, 'editor_schedules', 'direct1')));
    await expectDenied('non-video staff cannot read editor availability', getDoc(doc(sales1, 'editor_schedules', 'direct1')));
    await expectAllowed('owner synchronizes direct-editor catalog with rename trail', setDoc(doc(owner, 'editor_portals', 'direct1', 'client_catalog', 'master-c1'), clientCatalog({ formerNames: ['旧クライアントA'], accounts: [{ id: 'a1', name: '新アカウントA', formerNames: ['旧アカウントA'] }] })));
    await expectAllowed('owner explicitly shares a catalog with an external editor', setDoc(doc(owner, 'editor_portals', 'external1', 'client_catalog', 'master-c1'), clientCatalog({ formerNames: ['旧クライアントA'] })));
    await expectDenied('direct editor cannot auto-sync a master catalog', setDoc(doc(direct1, 'editor_portals', 'direct1', 'client_catalog', 'master-c2'), clientCatalog({ sourceClientId: 'legacy-client-2' })));
    await expectDenied('external editor cannot receive a company catalog through automatic sync', setDoc(doc(external1, 'editor_portals', 'external1', 'client_catalog', 'master-c1'), clientCatalog({ formerNames: ['旧クライアントA'] })));
    await expectDenied('catalog rejects non-list formerNames', setDoc(doc(owner, 'editor_portals', 'direct1', 'client_catalog', 'bad-former-type'), clientCatalog({ formerNames: '旧クライアントA' })));
    await expectDenied('catalog rejects excessive formerNames', setDoc(doc(owner, 'editor_portals', 'direct1', 'client_catalog', 'bad-former-count'), clientCatalog({ formerNames: Array.from({ length: 101 }, (_, i) => `旧名${i}`) })));
    await expectAllowed('director explicitly shares a catalog with own external editor', setDoc(doc(dir1, 'editor_portals', 'external1', 'client_catalog', 'c2'), clientCatalog({ name: 'クライアントB', accounts: [{ id: 'a2', name: 'アカウントB' }], formerNames: ['旧クライアントB'] })));
    await expectAllowed('editor reads own catalog', getDoc(doc(external1, 'editor_portals', 'external1', 'client_catalog', 'c1')));
    await expectDenied('editor cannot read another catalog', getDoc(doc(direct1, 'editor_portals', 'external1', 'client_catalog', 'c1')));
    await expectAllowed('global manual is visible', getDoc(doc(direct1, 'editor_manuals', 'global')));
    await expectAllowed('assigned manual is visible to assignee', getDoc(doc(external1, 'editor_manuals', 'assigned')));
    await expectDenied('assigned manual hidden from unrelated editor', getDoc(doc(direct1, 'editor_manuals', 'assigned')));
    await expectAllowed('director can read manuals authored for own external team', getDoc(doc(dir1, 'editor_manuals', 'assigned')));
    await expectDenied('other director cannot read another directors manual', getDoc(doc(dir2, 'editor_manuals', 'assigned')));
    await expectDenied('non-video staff cannot read a global editor manual', getDoc(doc(sales1, 'editor_manuals', 'global')));
    await expectDenied('portal submissions fail closed until a schema-backed path is shipped', addDoc(collection(direct1, 'editor_portals', 'direct1', 'submissions'), { arbitrary: 'untrusted' }));

    await expectAllowed('anonymous suggestion stores no identity', addDoc(collection(direct1, 'editor_suggestions'), { category: '業務改善', message: '改善案', replyCode: 'abc', status: '未確認', createdAt: serverTimestamp() }));
    await expectDenied('suggestion rejects submitter UID', addDoc(collection(direct1, 'editor_suggestions'), { category: '業務改善', message: '改善案', replyCode: '', status: '未確認', submitterUid: 'direct1', createdAt: serverTimestamp() }));

    await expectDenied('director cannot write mono.create settlement fields into an external portal job', updateDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'done1'), { ownPay: 5000, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'dir1' }));
    await expectDenied('owner cannot write mono.create settlement fields into an external portal job', updateDoc(doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'done1'), { ownPay: 5000, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'owner' }));
    await expectDenied('external editor cannot remove own legacy settlement fields', updateDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'priced1'), { ownPay: deleteField(), payableApproved: deleteField(), payableApprovedAt: deleteField(), payableMonth: deleteField(), updatedAt: 2, updatedBy: 'external1' }));
    await expectDenied('director cannot remove an external editor legacy settlement fields', updateDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'priced1'), { ownPay: deleteField(), payableApproved: deleteField(), payableApprovedAt: deleteField(), payableMonth: deleteField(), updatedAt: 2, updatedBy: 'dir1' }));
    await expectAllowed('owner can safely migrate a legacy priced external job by removing every amount field', updateDoc(doc(owner, 'editor_portals', 'external1', 'editor_jobs', 'priced1'), { ownPay: deleteField(), payableApproved: deleteField(), payableApprovedAt: deleteField(), payableMonth: deleteField(), updatedAt: 2, updatedBy: 'owner' }));
    await expectDenied('direct editor cannot remove own legacy settlement fields', updateDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'priced-direct1'), { ownPay: deleteField(), payableApproved: deleteField(), payableApprovedAt: deleteField(), payableMonth: deleteField(), updatedAt: 2, updatedBy: 'direct1' }));
    await expectAllowed('owner can migrate a direct editor legacy settlement before changing contract kind', updateDoc(doc(owner, 'editor_portals', 'direct1', 'editor_jobs', 'priced-direct1'), { ownPay: deleteField(), payableApproved: deleteField(), payableApprovedAt: deleteField(), payableMonth: deleteField(), updatedAt: 2, updatedBy: 'owner' }));
    await expectAllowed('external editor can read the job after its amount fields are removed', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'priced1')));
    await expectDenied('external editor cannot read own mono.create invoice', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_invoices', 'inv1')));
    await expectDenied('external editor cannot read own mono.create invoice events', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_invoices', 'inv1', 'events', 'e1')));
    await expectDenied('external editor cannot read own mono.create invoice authorization', getDoc(doc(external1, 'editor_portals', 'external1', 'invoice_authorizations', 'auth1')));
    await expectDenied('external editor cannot read own mono.create invoice authorization events', getDoc(doc(external1, 'editor_portals', 'external1', 'invoice_authorizations', 'auth1', 'events', 'e1')));
    await expectDenied('external editor cannot create a mono.create invoice', setDoc(doc(external1, 'editor_portals', 'external1', 'editor_invoices', 'external-create'), manualInvoice('external1', { idempotencyKey: 'manual-external-create' })));
    await expectAllowed('direct editor creates a manual invoice only with scheduled billing dates', setDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_invoices', 'manual-scheduled'), manualInvoice('direct1', { idempotencyKey: 'manual-direct-scheduled' })));
    await expectDenied('direct editor cannot change the payment date independently of the calculated schedule', setDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_invoices', 'manual-tampered'), manualInvoice('direct1', { idempotencyKey: 'manual-direct-tampered', dueDate: '2026-09-30' })));
    await expectAllowed('direct editor keeps own mono.create invoice access', getDoc(doc(direct1, 'editor_portals', 'direct1', 'editor_invoices', 'inv1')));
    await expectAllowed('direct editor keeps own invoice authorization access', getDoc(doc(direct1, 'editor_portals', 'direct1', 'invoice_authorizations', 'auth1')));
    await expectAllowed('video director keeps own direct-editor invoice access', getDoc(doc(dir1, 'editor_portals', 'dir1', 'editor_invoices', 'inv1')));
    await expectAllowed('video director keeps own direct-editor invoice authorization access', getDoc(doc(dir1, 'editor_portals', 'dir1', 'invoice_authorizations', 'auth1')));
    await expectDenied('director cannot read an external editor invoice', getDoc(doc(dir1, 'editor_portals', 'external1', 'editor_invoices', 'inv1')));
    await expectDenied('other director cannot see invoice', getDoc(doc(dir2, 'editor_portals', 'external1', 'editor_invoices', 'inv1')));

    await expectAllowed('first editor atomically claims board', runTransaction(direct1, async (tx) => {
      const boardRef = doc(direct1, 'editor_job_board', 'direct-open');
      const snap = await tx.get(boardRef);
      if (snap.data().status !== 'open') throw new Error('not open');
      tx.update(boardRef, { status: 'assigned', assignedUid: 'direct1', assignedName: 'Direct 1', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'direct-open'), claimedBoardPortalJob('direct1', 'direct-open', snap.data()));
    }));
    await expectDenied('accepted board job cannot be cloned under another portal document id', setDoc(
      doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'direct-open-clone'),
      claimedBoardPortalJob('direct1', 'direct-open', boardJob())
    ));
    await expectAllowed('legacy board missing optional projection fields still claims through the UI fallbacks', runTransaction(direct2, async (tx) => {
      const boardRef = doc(direct2, 'editor_job_board', 'direct-legacy');
      const snap = await tx.get(boardRef);
      tx.update(boardRef, { status: 'assigned', assignedUid: 'direct2', assignedName: 'Direct 2', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(direct2, 'editor_portals', 'direct2', 'editor_jobs', 'direct-legacy'), claimedBoardPortalJob('direct2', 'direct-legacy', snap.data()));
    }));
    await expectDenied('atomic claim rejects a portal payload that differs from the published board', runTransaction(direct2, async (tx) => {
      const boardRef = doc(direct2, 'editor_job_board', 'direct-tamper');
      const snap = await tx.get(boardRef);
      tx.update(boardRef, { status: 'assigned', assignedUid: 'direct2', assignedName: 'Direct 2', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(direct2, 'editor_portals', 'direct2', 'editor_jobs', 'direct-tamper'), claimedBoardPortalJob('direct2', 'direct-tamper', snap.data(), { title: '改竄後の案件名' }));
    }));
    await expectDenied('director cannot republish own team board job to the direct pool', updateDoc(
      doc(dir1, 'editor_job_board', 'external-one'), { audience: 'direct', eligibleUids: [], directorUid: '', updatedAt: serverTimestamp() }
    ));
    await expectDenied('director cannot transfer own team board job to another directors editor', updateDoc(
      doc(dir1, 'editor_job_board', 'external-one'), { eligibleUids: ['external2'], updatedAt: serverTimestamp() }
    ));
    await expectDenied('second editor cannot double claim board', runTransaction(direct2, async (tx) => {
      const boardRef = doc(direct2, 'editor_job_board', 'direct-open');
      const snap = await tx.get(boardRef);
      tx.update(boardRef, { status: 'assigned', assignedUid: 'direct2', assignedName: 'Direct 2', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(direct2, 'editor_portals', 'direct2', 'editor_jobs', 'direct-open'), portalJob('direct2', { businessType: 'edit_agency', boardJobId: 'direct-open', source: 'job_board' }));
      return snap;
    }));

    // Moving an external editor to another director instantly invalidates the
    // old director pair, including historic thread, message and read paths.
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'access', 'external1'), { directorUid: 'dir2' }, { merge: true });
    });
    await expectDenied('former director cannot read a moved external editors old DM', getDoc(doc(dir1, 'direct_threads', 'dm-dir1-external1')));
    await expectDenied('former director cannot append to a moved external editors old DM', setDoc(doc(dir1, 'direct_threads', 'dm-dir1-external1', 'messages', 'after-move'), { senderUid: 'dir1', senderName: 'Dir 1', body: '旧所属から送信', createdAt: serverTimestamp() }));
    await expectDenied('former director cannot read a moved external editors receipt', getDoc(doc(dir1, 'direct_threads', 'dm-dir1-external1', 'reads', 'dir1')));
    await expectDenied('new director cannot read old thread when not a participant', getDoc(doc(dir2, 'direct_threads', 'dm-dir1-external1')));
    await expectAllowed('new director can start a DM after external editor moves', setDoc(doc(dir2, 'direct_threads', 'dm-dir2-external1'), directThread('dir2', 'external1')));
    await expectAllowed('owner DM remains readable after external editor moves', getDoc(doc(owner, 'direct_threads', 'dm-owner-external1')));
    await expectAllowed('external editor keeps owner DM after director move', getDoc(doc(external1, 'direct_threads', 'dm-owner-external1')));

    process.stdout.write('PASSED Firestore role boundary suite\n');
  } finally {
    await env.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
