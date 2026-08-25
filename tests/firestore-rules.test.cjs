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
  collection,
  addDoc,
  runTransaction,
  serverTimestamp,
} = require('firebase/firestore');

const root = path.resolve(__dirname, '..');
const projectId = 'demo-editflow';
const claims = (email) => ({ email, email_verified: true });

function portalJob(uid, overrides = {}) {
  return {
    recordType: 'editor_portal_job', businessType: 'dispatch', title: '案件1', caseName: '9月分',
    clientId: 'c1', clientDisplay: 'クライアントA', accountId: 'a1', accountDisplay: 'アカウントA',
    deadline: '2026-09-10', sharedDate: '2026-09-01', editorDraftDate: '2026-09-05',
    clientDraftDate: '2026-09-06', thumbnailDate: '', deliveryDate: '2026-09-10',
    requestUrl: 'https://example.com/request', sourceUrl: 'https://example.com/source',
    instructions: '編集指示', urgent: false, status: '受注済み', progress: '', evidenceUrl: '', blocker: '',
    workDate: '', startTime: '', endTime: '', submittedByUid: uid, editorUid: uid,
    editorEmail: `${uid}@example.com`, editorName: uid, directorUid: '', source: 'direct_client',
    createdAt: 1, updatedAt: 1, history: [{ at: 1, type: 'created', by: uid, status: '受注済み' }],
    ...overrides,
  };
}

function boardJob(overrides = {}) {
  return {
    businessType: 'edit_agency', title: '公開案件', caseName: '9月分', clientId: 'c1', clientName: 'クライアントA',
    accountId: 'a1', accountName: 'アカウントA', summary: '概要', instructions: '編集指示',
    requestUrl: 'https://example.com/request', sourceUrl: 'https://example.com/source',
    editorDraftDate: '2026-09-05', clientDraftDate: '2026-09-06', thumbnailDate: '',
    deliveryDate: '2026-09-10', urgent: false, status: 'open', audience: 'direct',
    eligibleUids: [], directorUid: '', createdByUid: 'owner', createdByName: 'owner',
    createdAt: 1, updatedAt: 1, assignedUid: '', assignedName: '', assignedAt: null,
    ...overrides,
  };
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
        ['direct1', { uid: 'direct1', email: 'direct1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'direct' }],
        ['direct2', { uid: 'direct2', email: 'direct2@example.com', approved: true, roles: ['動画編集者'], editorKind: 'direct' }],
        ['external1', { uid: 'external1', email: 'external1@example.com', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'dir1', invoiceRecipientName: 'Dir 1' }],
        ['external2', { uid: 'external2', email: 'external2@example.com', approved: true, roles: ['動画編集者'], editorKind: 'external', directorUid: 'dir2', invoiceRecipientName: 'Dir 2' }],
        ['dir1', { uid: 'dir1', email: 'dir1@example.com', approved: true, roles: ['動画編集ディレクター'] }],
        ['dir2', { uid: 'dir2', email: 'dir2@example.com', approved: true, roles: ['動画編集ディレクター'] }],
      ];
      for (const [uid, data] of access) await setDoc(doc(db, 'access', uid), data);
      await setDoc(doc(db, 'system', 'access_control'), { enforced: true, compatibilityEmails: [] });
      await setDoc(doc(db, 'editor_job_board', 'direct-open'), boardJob());
      await setDoc(doc(db, 'editor_job_board', 'external-one'), boardJob({ audience: 'director_team', directorUid: 'dir1', eligibleUids: ['external1'] }));
      await setDoc(doc(db, 'editor_job_board', 'external-two'), boardJob({ audience: 'director_team', directorUid: 'dir2', eligibleUids: ['external2'] }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_jobs', 'done1'), portalJob('external1', { directorUid: 'dir1', status: '完了', evidenceUrl: 'https://example.com/delivery' }));
      await setDoc(doc(db, 'editor_portals', 'external2', 'editor_jobs', 'done2'), portalJob('external2', { directorUid: 'dir2', status: '完了', evidenceUrl: 'https://example.com/delivery' }));
      await setDoc(doc(db, 'editor_portals', 'external1', 'client_catalog', 'c1'), { name: 'クライアントA', accounts: [{ id: 'a1', name: 'アカウントA' }], active: true, manualIds: [], updatedAt: 1, updatedBy: 'owner' });
      await setDoc(doc(db, 'editor_manuals', 'global'), { title: '全体', scope: 'global', scopeLabel: '全体', clientId: '', accountId: '', version: '1', body: '本文', url: '', required: true, audience: 'all', allowedUids: [], directorUid: '', updatedAt: 1, updatedBy: 'owner' });
      await setDoc(doc(db, 'editor_manuals', 'assigned'), { title: '個別', scope: 'client', scopeLabel: '個別', clientId: 'c1', accountId: '', version: '1', body: '本文', url: '', required: false, audience: 'assigned', allowedUids: ['external1'], directorUid: 'dir1', updatedAt: 1, updatedBy: 'dir1' });
      await setDoc(doc(db, 'editor_portals', 'external1', 'editor_invoices', 'inv1'), { recordType: 'editor_invoice', editorUid: 'external1', editorEmail: 'external1@example.com', status: '提出済み' });
      await setDoc(doc(db, 'shared', 'mcapp'), { clientPrice: 999999, profit: 999999 });
    });

    const direct1 = env.authenticatedContext('direct1', claims('direct1@example.com')).firestore();
    const direct2 = env.authenticatedContext('direct2', claims('direct2@example.com')).firestore();
    const external1 = env.authenticatedContext('external1', claims('external1@example.com')).firestore();
    const dir1 = env.authenticatedContext('dir1', claims('dir1@example.com')).firestore();
    const dir2 = env.authenticatedContext('dir2', claims('dir2@example.com')).firestore();
    const owner = env.authenticatedContext('owner', claims('mono.create.group@gmail.com')).firestore();

    await expectAllowed('owner publishes edit-agency board job', setDoc(doc(owner, 'editor_job_board', 'owner-new'), boardJob({ createdByUid: 'owner' })));
    await expectAllowed('director publishes own edit-agency board job', setDoc(doc(dir1, 'editor_job_board', 'dir-new'), boardJob({ audience: 'director_team', directorUid: 'dir1', eligibleUids: ['external1'], createdByUid: 'dir1' })));
    await expectDenied('board rejects an unsupported business type', setDoc(doc(owner, 'editor_job_board', 'wrong-biz'), boardJob({ businessType: 'dispatch', createdByUid: 'owner' })));

    await expectAllowed('direct editor sees direct board', getDoc(doc(direct1, 'editor_job_board', 'direct-open')));
    await expectDenied('external editor cannot see direct board', getDoc(doc(external1, 'editor_job_board', 'direct-open')));
    await expectAllowed('external editor sees own director board', getDoc(doc(external1, 'editor_job_board', 'external-one')));
    await expectDenied('external editor cannot see another director board', getDoc(doc(external1, 'editor_job_board', 'external-two')));
    await expectAllowed('editor reads own portal', getDoc(doc(external1, 'editor_portals', 'external1', 'editor_jobs', 'done1')));
    await expectDenied('editor cannot read another portal', getDoc(doc(external1, 'editor_portals', 'external2', 'editor_jobs', 'done2')));
    await expectAllowed('director reads assigned external editor', getDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'done1')));
    await expectDenied('director cannot read another director editor', getDoc(doc(dir1, 'editor_portals', 'external2', 'editor_jobs', 'done2')));
    await expectAllowed('owner reads every portal', getDoc(doc(owner, 'editor_portals', 'external2', 'editor_jobs', 'done2')));
    await expectDenied('editor cannot read shared financial monolith', getDoc(doc(direct1, 'shared', 'mcapp')));

    await expectAllowed('editor saves one-week calendar and routine', setDoc(doc(direct1, 'editor_schedules', 'direct1'), weeklySchedule()));
    await expectDenied('editor cannot store private schedule reason', setDoc(doc(direct1, 'editor_schedules', 'direct1'), weeklySchedule({ privateReason: '通院' })));
    await expectDenied('editor cannot save more than one week', setDoc(doc(direct1, 'editor_schedules', 'direct1'), weeklySchedule({ days: [...weeklySchedule().days, weeklySchedule().days[0]] })));
    await expectAllowed('editors see team availability', getDoc(doc(external1, 'editor_schedules', 'direct1')));
    await expectAllowed('owner shares existing client source id', setDoc(doc(owner, 'editor_portals', 'external1', 'client_catalog', 'c2'), { sourceClientId: 'legacy-client-1', name: 'クライアントB', accounts: [{ id: 'a2', name: 'アカウントB' }], active: true, manualIds: [], updatedAt: 1, updatedBy: 'owner' }));
    await expectAllowed('editor reads own catalog', getDoc(doc(external1, 'editor_portals', 'external1', 'client_catalog', 'c1')));
    await expectDenied('editor cannot read another catalog', getDoc(doc(direct1, 'editor_portals', 'external1', 'client_catalog', 'c1')));
    await expectAllowed('global manual is visible', getDoc(doc(direct1, 'editor_manuals', 'global')));
    await expectAllowed('assigned manual is visible to assignee', getDoc(doc(external1, 'editor_manuals', 'assigned')));
    await expectDenied('assigned manual hidden from unrelated editor', getDoc(doc(direct1, 'editor_manuals', 'assigned')));

    await expectAllowed('anonymous suggestion stores no identity', addDoc(collection(direct1, 'editor_suggestions'), { category: '業務改善', message: '改善案', replyCode: 'abc', status: '未確認', createdAt: serverTimestamp() }));
    await expectDenied('suggestion rejects submitter UID', addDoc(collection(direct1, 'editor_suggestions'), { category: '業務改善', message: '改善案', replyCode: '', status: '未確認', submitterUid: 'direct1', createdAt: serverTimestamp() }));

    await expectAllowed('director can set own external editor pay', updateDoc(doc(dir1, 'editor_portals', 'external1', 'editor_jobs', 'done1'), { ownPay: 5000, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'dir1' }));
    await expectDenied('director cannot set another team pay', updateDoc(doc(dir1, 'editor_portals', 'external2', 'editor_jobs', 'done2'), { ownPay: 5000, payableApproved: true, payableApprovedAt: 2, payableMonth: '2026-09', updatedAt: 2, updatedBy: 'dir1' }));
    await expectAllowed('director sees assigned invoice', getDoc(doc(dir1, 'editor_portals', 'external1', 'editor_invoices', 'inv1')));
    await expectDenied('other director cannot see invoice', getDoc(doc(dir2, 'editor_portals', 'external1', 'editor_invoices', 'inv1')));

    await expectAllowed('first editor atomically claims board', runTransaction(direct1, async (tx) => {
      const boardRef = doc(direct1, 'editor_job_board', 'direct-open');
      const snap = await tx.get(boardRef);
      if (snap.data().status !== 'open') throw new Error('not open');
      tx.update(boardRef, { status: 'assigned', assignedUid: 'direct1', assignedName: 'Direct 1', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(direct1, 'editor_portals', 'direct1', 'editor_jobs', 'direct-open'), portalJob('direct1', { businessType: 'edit_agency', boardJobId: 'direct-open', source: 'job_board' }));
    }));
    await expectDenied('second editor cannot double claim board', runTransaction(direct2, async (tx) => {
      const boardRef = doc(direct2, 'editor_job_board', 'direct-open');
      const snap = await tx.get(boardRef);
      tx.update(boardRef, { status: 'assigned', assignedUid: 'direct2', assignedName: 'Direct 2', assignedAt: serverTimestamp(), updatedAt: serverTimestamp() });
      tx.set(doc(direct2, 'editor_portals', 'direct2', 'editor_jobs', 'direct-open'), portalJob('direct2', { businessType: 'edit_agency', boardJobId: 'direct-open', source: 'job_board' }));
      return snap;
    }));

    process.stdout.write('PASSED Firestore role boundary suite\n');
  } finally {
    await env.cleanup();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
