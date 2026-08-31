/* Owner-only delivery performance data layer.
 *
 * This module deliberately has no eager subscriptions and no dependency on a
 * particular screen.  The owner page can load it once and call renderPage or
 * renderGate when that page is opened.  Editor-visible collections are never
 * used to store finance, goals, daily approval, or quality evaluations.
 */
(function (global) {
  'use strict';

  const OWNER_EMAILS = new Set(['nakamurakouta512@gmail.com', 'mono.create.group@gmail.com']);
  const GOAL_CATEGORIES = Object.freeze([
    { key: 'internal', label: '社内編集', hint: 'mono.create内で自分が編集', countField: 'internalTargetCount', amountField: 'internalTargetAmount' },
    { key: 'agency', label: '編集代行', hint: '編集者へ外注', countField: 'agencyTargetCount', amountField: 'agencyTargetAmount' },
    { key: 'dispatch', label: '編集者派遣', hint: '派遣先から直接受注', countField: 'dispatchTargetCount', amountField: 'dispatchTargetAmount' },
  ]);
  const state = {
    started: '', goal: null, dailyCheck: null, qualityReviews: [], publishedRanking: null,
    ready: { goal: false, daily: false, quality: false }, error: '', stops: [], onChange: null,
    lastOptions: {}, writePending: new Set(),
  };
  const text = value => String(value == null ? '' : value).trim();
  const number = value => Number.isFinite(Number(value)) ? Number(value) : null;
  const dateOnly = value => /^\d{4}-\d{2}-\d{2}$/.test(text(value)) ? text(value) : '';
  const ymd = value => { const d = value instanceof Date ? value : new Date(value); return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  const monthOf = value => /^\d{4}-\d{2}$/.test(text(value)) ? text(value) : dateOnly(value).slice(0, 7);
  const escapeHtml = value => text(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const daysBetweenInclusive = (from, to) => {
    const start = new Date(`${dateOnly(from)}T12:00:00`), end = new Date(`${dateOnly(to)}T12:00:00`);
    return !dateOnly(from) || !dateOnly(to) || end < start ? 0 : Math.floor((end - start) / 86400000) + 1;
  };
  const addDays = (date, count) => { const d = new Date(`${dateOnly(date)}T12:00:00`); d.setDate(d.getDate() + count); return ymd(d); };
  const safeKey = value => text(value).replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 160) || 'unknown';
  const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);

  function goalBreakdown(goal = {}) {
    const hasBreakdown = GOAL_CATEGORIES.some(category => hasOwn(goal, category.countField) || hasOwn(goal, category.amountField));
    const rows = {};
    GOAL_CATEGORIES.forEach(category => {
      rows[category.key] = {
        key: category.key,
        label: category.label,
        count: Math.max(0, number(goal?.[category.countField]) || 0),
        amount: Math.max(0, number(goal?.[category.amountField]) || 0),
      };
    });
    const legacyCount = Math.max(0, number(goal?.targetCount ?? goal?.deliveryTarget) || 0);
    const legacyAmount = Math.max(0, number(goal?.targetAmount ?? goal?.amountTarget) || 0);
    // The former screen had one video-business total. Keep that value editable
    // instead of dropping it when the owner first opens the three-way form.
    const migratedFromLegacy = !hasBreakdown && (legacyCount > 0 || legacyAmount > 0);
    if (migratedFromLegacy) rows.agency = { ...rows.agency, count: legacyCount, amount: legacyAmount };
    return { rows, hasBreakdown, migratedFromLegacy };
  }

  function goalTotals(goal = {}) {
    const breakdown = goalBreakdown(goal);
    const targetCount = GOAL_CATEGORIES.reduce((total, category) => total + breakdown.rows[category.key].count, 0);
    const targetAmount = GOAL_CATEGORIES.reduce((total, category) => total + breakdown.rows[category.key].amount, 0);
    return { ...breakdown, targetCount, targetAmount };
  }

  function globals() {
    let db, user, jobs, portalJobs, selfWid, firebaseApi;
    try { if (typeof fbDb !== 'undefined') db = fbDb; } catch (_) {}
    try { if (typeof FB_USER !== 'undefined') user = FB_USER; } catch (_) {}
    try { if (typeof S !== 'undefined') jobs = S && Array.isArray(S.jobs) ? S.jobs : []; } catch (_) {}
    try { if (typeof PORTAL_JOBS !== 'undefined') portalJobs = Array.isArray(PORTAL_JOBS) ? PORTAL_JOBS : []; } catch (_) {}
    try { if (typeof SELF_WID !== 'undefined') selfWid = SELF_WID; } catch (_) {}
    try { if (typeof firebase !== 'undefined') firebaseApi = firebase; } catch (_) {}
    return { db: db || global.fbDb, user: user || global.FB_USER, jobs: jobs || (global.S && global.S.jobs) || [], portalJobs: portalJobs || global.PORTAL_JOBS || [], selfWid: selfWid || global.SELF_WID || '__self', firebase: firebaseApi || global.firebase };
  }

  function isOwner() {
    try { if (typeof _isOwner === 'function') return _isOwner() === true; } catch (_) {}
    try { if (typeof _isActualOwner === 'function') return _isActualOwner() === true && !global.ROLE_PREVIEW; } catch (_) {}
    const email = text(globals().user?.email).toLowerCase();
    return OWNER_EMAILS.has(email);
  }

  function cloudPaused() {
    try { if (global.EditflowFirestoreQuota?.isOpen?.()) return true; } catch (_) {}
    try { if (typeof _fbQuotaReadCircuitOpen !== 'undefined' && _fbQuotaReadCircuitOpen) return true; } catch (_) {}
    return false;
  }

  function businessCategory(unit, selfWid) {
    if (text(unit.workerId) === text(selfWid)) return 'internal';
    const business = text(unit.businessType || unit.biz || unit.business).toLowerCase();
    return ['haken', 'dispatch', 'editor_dispatch', '編集者派遣'].includes(business) ? 'dispatch' : 'agency';
  }

  function legacyHasPortalLink(row, portalLegacyIds) {
    const direct = [row.portalUid, row.portalJobId, row.linkedPortalUid, row.linkedPortalJobId].some(value => text(value));
    return direct || portalLegacyIds.has(text(row.id)) || portalLegacyIds.has(text(row.linkedLegacyJobId));
  }

  function normalizeWorkUnits(portalJobs = [], legacyJobs = [], selfWid = '__self') {
    const portal = Array.isArray(portalJobs) ? portalJobs : [];
    const legacy = Array.isArray(legacyJobs) ? legacyJobs : [];
    const portalLegacyIds = new Set(portal.flatMap(row => [row?.linkedLegacyJobId, row?.legacyJobId]).map(text).filter(Boolean));
    const units = [], seen = new Set();
    const push = raw => {
      const key = text(raw.key); if (!key || seen.has(key)) return; seen.add(key);
      const completedDeliveryDate = dateOnly(raw.completedDeliveryDate);
      const completed = text(raw.status) === '完了' && !!completedDeliveryDate;
      units.push({ ...raw, key, completedDeliveryDate, completed, category: businessCategory(raw, selfWid) });
    };
    // Portal records are authoritative when both ledgers describe the same work.
    portal.forEach(row => {
      if (!row || !text(row.id)) return;
      push({ ...row, source: 'portal', key: `portal:${text(row._portalUid || row.portalUid || row.editorUid)}:${text(row.id)}`, workerId: row.workerId || row.assigneeWorkerId || row.editorUid || '', editorUid: row.editorUid || row._portalUid || '', editorName: row.editorName || row.assigneeName || '', deadline: row.deadline || row.deliveryDate || '' });
    });
    legacy.forEach(parent => {
      if (!parent || legacyHasPortalLink(parent, portalLegacyIds)) return;
      const children = Array.isArray(parent.subtasks) ? parent.subtasks.filter(Boolean) : [];
      // A parent with children is a container, never an additional delivered video.
      const rows = children.length ? children : [parent];
      rows.forEach((child, index) => {
        const merged = { ...parent, ...child };
        if (legacyHasPortalLink(merged, portalLegacyIds)) return;
        const childId = text(child.id || child.subtaskId || index);
        push({ ...merged, source: 'legacy', key: `legacy:${text(parent.id)}:${children.length ? childId : 'parent'}`, legacyJobId: text(merged.legacyJobId || (children.length ? `${text(parent.id)}:${childId}` : parent.id)), workerId: merged.workerId || merged.assigneeWorkerId || '', editorUid: merged.editorUid || merged.assignedUid || '', editorName: merged.editorName || merged.assignee || merged.assignedName || '', completedDeliveryDate: merged.completedDeliveryDate || merged.deliveryCompletedDate || '', deadline: merged.deadline || merged.deliveryDate || '' });
      });
    });
    return units;
  }

  function completedWorkUnits(units) { return (units || []).filter(unit => unit?.completed === true); }

  function financeIndex(records = []) {
    const index = new Map();
    (Array.isArray(records) ? records : []).forEach(record => {
      if (!record) return;
      if (text(record.portalUid) && text(record.portalJobId)) index.set(`portal:${text(record.portalUid)}:${text(record.portalJobId)}`, record);
      if (text(record.legacyJobId)) {
        index.set(`legacy:${text(record.legacyJobId)}`, record);
        if (record.recordType === 'owner_legacy_finance') {
          (Array.isArray(record.subtaskAmounts) ? record.subtaskAmounts : []).forEach((line, rowIndex) => {
            const childId = text(line?.id || line?.subtaskId || rowIndex);
            index.set(`legacy:${text(record.legacyJobId)}:${childId}`, { ...record, _deliveryFinanceLine: line });
          });
        }
      }
    });
    return index;
  }

  function financeAmount(record) {
    for (const field of ['unitPrice', 'clientUnitPrice', 'masterClientUnitPrice', 'amount']) {
      const value = number(record?._deliveryFinanceLine?.[field] ?? record?.[field]);
      if (value !== null && value >= 0) return value;
    }
    if (record?.recordType === 'owner_legacy_finance') {
      const value = number(record?.parentAmounts?.unitPrice);
      if (value !== null && value >= 0) return value;
    }
    /* Compatibility for the immutable per-case ledger. */
    for (const field of ['clientUnitPrice', 'masterClientUnitPrice', 'amount']) {
      const value = number(record?.[field]);
      if (value !== null && value >= 0) return value;
    }
    return null;
  }

  function joinOwnerFinance(units, financeRecords = []) {
    const index = financeIndex(financeRecords);
    return (units || []).map(unit => {
      const finance = index.get(unit.key)
        || (unit.source === 'legacy' ? index.get(unit.key.replace(/^legacy:/, 'legacy:')) : null)
        || (unit.legacyJobId ? index.get(`legacy:${text(unit.legacyJobId)}`) : null)
        || null;
      const amount = financeAmount(finance);
      return { ...unit, finance, amount, amountMissing: amount === null };
    });
  }

  function summarizeDelivery(units, { month = '', weekStart = '', date = '' } = {}) {
    const monthKey = monthOf(month);
    const dateKey = dateOnly(date);
    const weekEnd = weekStart ? addDays(weekStart, 6) : '';
    const rows = completedWorkUnits(units).filter(unit => (!monthKey || unit.completedDeliveryDate.slice(0, 7) === monthKey) && (!dateKey || unit.completedDeliveryDate === dateKey) && (!weekStart || (unit.completedDeliveryDate >= weekStart && unit.completedDeliveryDate <= weekEnd)));
    const groups = { all: { count: 0, amount: 0, missingAmountCount: 0 }, internal: { count: 0, amount: 0, missingAmountCount: 0 }, agency: { count: 0, amount: 0, missingAmountCount: 0 }, dispatch: { count: 0, amount: 0, missingAmountCount: 0 } };
    rows.forEach(unit => {
      for (const group of [groups.all, groups[unit.category] || groups.agency]) {
        group.count += 1;
        if (unit.amountMissing) group.missingAmountCount += 1; else group.amount += unit.amount;
      }
    });
    return { rows, ...groups };
  }

  function monthlyPace(goal = {}, summary = {}, todayValue = ymd(new Date())) {
    const month = monthOf(goal.month || todayValue) || monthOf(todayValue);
    const [year, monthNumber] = month.split('-').map(Number);
    const end = `${month}-${String(new Date(year, monthNumber, 0).getDate()).padStart(2, '0')}`;
    const { targetCount, targetAmount } = goalTotals(goal);
    const actualCount = Math.max(0, number(summary.count) || 0);
    const actualAmount = Math.max(0, number(summary.amount) || 0);
    const remainingDays = Math.max(1, daysBetweenInclusive(todayValue, end));
    const dayOfWeek = new Date(`${todayValue}T12:00:00`).getDay();
    const toSunday = dayOfWeek === 0 ? 1 : 8 - dayOfWeek;
    const remainingWeekDays = Math.max(1, Math.min(remainingDays, toSunday));
    const remainingCount = Math.max(0, targetCount - actualCount), remainingAmount = Math.max(0, targetAmount - actualAmount);
    const daily = { count: remainingCount / remainingDays, amount: remainingAmount / remainingDays };
    return { month, targetCount, targetAmount, actualCount, actualAmount, remainingCount, remainingAmount, remainingDays, remainingWeekDays, daily, weekly: { count: daily.count * 7, amount: daily.amount * 7 } };
  }

  function weeklyEditorRanking(units, qualityReviews = [], { weekStart, selfWid = '__self' } = {}) {
    const start = dateOnly(weekStart); const end = start ? addDays(start, 6) : '';
    const rows = completedWorkUnits(units).filter(unit => !start || (unit.completedDeliveryDate >= start && unit.completedDeliveryDate <= end));
    const byEditor = new Map();
    rows.forEach(unit => {
      const id = text(unit.editorUid || unit.workerId || unit.editorName || 'unknown');
      const current = byEditor.get(id) || { editorId: id, editorName: text(unit.editorName) || (text(unit.workerId) === text(selfWid) ? 'mono.create社内' : '未設定'), delivered: 0, dated: 0, onTime: 0, reviews: [] };
      current.delivered += 1;
      if (dateOnly(unit.deadline)) { current.dated += 1; if (unit.completedDeliveryDate <= unit.deadline) current.onTime += 1; }
      byEditor.set(id, current);
    });
    (Array.isArray(qualityReviews) ? qualityReviews : []).forEach(review => {
      const id = text(review.editorUid || review.editorId || review.workerId); if (!byEditor.has(id)) return;
      const score = number(review.score); if (score !== null && score >= 1 && score <= 5) byEditor.get(id).reviews.push(score);
    });
    const maxDelivered = Math.max(1, ...[...byEditor.values()].map(row => row.delivered));
    return [...byEditor.values()].map(row => {
      const deliveryScore = row.delivered / maxDelivered * 40;
      const deadlineScore = row.dated ? row.onTime / row.dated * 30 : 0;
      const averageQuality = row.reviews.length ? row.reviews.reduce((total, value) => total + value, 0) / row.reviews.length : null;
      const qualityScore = averageQuality === null ? null : averageQuality / 5 * 30;
      const evaluatedWeight = 40 + (row.dated ? 30 : 0) + (qualityScore === null ? 0 : 30);
      const rawScore = deliveryScore + deadlineScore + (qualityScore || 0);
      return { ...row, onTimeRate: row.dated ? row.onTime / row.dated : null, averageQuality, qualityScore, qualityEvaluationRate: row.delivered ? row.reviews.length / row.delivered : 0, score: evaluatedWeight ? rawScore / evaluatedWeight * 100 : null, evaluatedWeight };
    }).sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || b.delivered - a.delivered || a.editorName.localeCompare(b.editorName, 'ja'))
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  function dashboard({ portalJobs, jobs, finance, goal, qualityReviews, selfWid, month, today: todayValue, weekStart } = {}) {
    const g = globals();
    const normalized = normalizeWorkUnits(portalJobs || g.portalJobs, jobs || g.jobs, selfWid || g.selfWid);
    const financed = joinOwnerFinance(normalized, finance || []);
    const todayKey = dateOnly(todayValue || ymd(new Date()));
    const currentMonth = monthOf(month || goal?.month || todayKey);
    const monthSummary = summarizeDelivery(financed, { month: currentMonth });
    const todaySummary = summarizeDelivery(financed, { date: todayKey });
    return { units: financed, monthSummary, todaySummary, pace: monthlyPace({ ...(goal || {}), month: currentMonth }, monthSummary.all, todayKey), ranking: weeklyEditorRanking(financed, qualityReviews || [], { weekStart: weekStart || mondayOf(todayKey), selfWid: selfWid || g.selfWid }) };
  }

  function mondayOf(date) { const d = new Date(`${dateOnly(date)}T12:00:00`); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return ymd(d); }
  function stop() {
    state.stops.splice(0).forEach(fn => { try { fn(); } catch (_) {} });
    state.started = ''; state.goal = null; state.dailyCheck = null; state.qualityReviews = [];
    state.publishedRanking = null; state.ready = { goal: false, daily: false, quality: false }; state.error = '';
  }
  function snapshotRows(snapshot) { return snapshot?.docs ? snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) : []; }
  function lazyStart({ month = monthOf(ymd(new Date())), date = ymd(new Date()), weekStart = mondayOf(date), includeQuality = false, onChange } = {}) {
    if (!isOwner() || cloudPaused()) return false;
    const { db } = globals(); if (!db?.collection) return false;
    const key = `${month}|${date}|${weekStart}|${includeQuality ? 'quality' : 'gate'}`;
    if (state.started === key) { state.onChange = onChange || state.onChange; return true; }
    stop(); state.started = key; state.onChange = onChange || null; state.error = ''; state.ready.quality = !includeQuality;
    const changed = () => { try { state.onChange?.(); } catch (_) {} };
    const watch = (ref, readyKey, assign) => state.stops.push(ref.onSnapshot(snapshot => {
      assign(snapshot); state.ready[readyKey] = true; state.error = ''; changed();
    }, error => {
      state.ready[readyKey] = false; state.error = text(error?.code || error || 'read-error');
      console.warn('owner performance read', error?.code || error); changed();
    }));
    watch(db.collection('owner_delivery_goals').doc(month), 'goal', snapshot => { state.goal = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null; });
    watch(db.collection('owner_daily_delivery_checks').doc(date), 'daily', snapshot => { state.dailyCheck = snapshot.exists ? { id: snapshot.id, ...snapshot.data() } : null; });
    if (includeQuality) watch(db.collection('owner_editor_quality_reviews').where('weekStart', '==', weekStart), 'quality', snapshot => { state.qualityReviews = snapshotRows(snapshot); });
    return true;
  }

  function serverTime() { const firebase = globals().firebase; return firebase?.firestore?.FieldValue?.serverTimestamp ? firebase.firestore.FieldValue.serverTimestamp() : Date.now(); }
  function assertOwnerDb() { if (!isOwner()) throw new Error('owner-only'); if (cloudPaused()) throw new Error('cloud-paused'); const db = globals().db; if (!db?.collection) throw new Error('firestore-unavailable'); return db; }
  async function saveGoal(input = {}) {
    const db = assertOwnerDb(), month = monthOf(input.month || ymd(new Date()));
    if (!month) throw new Error('invalid-month');
    const hasBreakdownInput = GOAL_CATEGORIES.some(category => hasOwn(input, category.countField) || hasOwn(input, category.amountField));
    const legacyCount = number(input.targetCount), legacyAmount = number(input.targetAmount);
    const values = {};
    GOAL_CATEGORIES.forEach(category => {
      const count = hasBreakdownInput ? number(input[category.countField] ?? 0) : (category.key === 'agency' ? legacyCount : 0);
      const amount = hasBreakdownInput ? number(input[category.amountField] ?? 0) : (category.key === 'agency' ? legacyAmount : 0);
      if (count === null || !Number.isInteger(count) || count < 0 || count > 1000000 || amount === null || !Number.isInteger(amount) || amount < 0 || amount > 1000000000) throw new Error('invalid-goal');
      values[category.countField] = count;
      values[category.amountField] = amount;
    });
    const targetCount = GOAL_CATEGORIES.reduce((total, category) => total + values[category.countField], 0);
    const targetAmount = GOAL_CATEGORIES.reduce((total, category) => total + values[category.amountField], 0);
    if (targetCount > 1000000 || targetAmount > 1000000000) throw new Error('invalid-goal');
    const existing = state.goal?.month === month ? state.goal : null, email = text(globals().user?.email), payload = {
      recordType: 'owner_delivery_goal', month, ...values, targetCount, targetAmount,
      active: input.active !== false, revision: Number(existing?.revision || 0) + 1,
      updatedAt: serverTime(), updatedBy: email,
    };
    if (!existing) Object.assign(payload, { createdAt: serverTime(), createdBy: email });
    await db.collection('owner_delivery_goals').doc(month).set(payload, { merge: true });
  }

  function sourceHash(units) {
    const raw = (units || []).map(unit => `${unit.key}:${unit.completedDeliveryDate}:${unit.amountMissing ? 'missing' : unit.amount}`).sort().join('|');
    let hash = 2166136261;
    for (let index = 0; index < raw.length; index += 1) { hash ^= raw.charCodeAt(index); hash = Math.imul(hash, 16777619); }
    return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
  }

  async function confirmDailyCheck(input = {}) {
    if (input.confirmed !== true) throw new Error('explicit-owner-confirmation-required');
    const db = assertOwnerDb(), date = dateOnly(input.date || ymd(new Date())); if (!date) throw new Error('invalid-date');
    if (state.dailyCheck?.confirmed === true) return;
    const summary = input.summary || {};
    if (!summary.sourcesReady || Number(summary.missingAmountCount || 0) > 0) throw new Error('delivery-summary-incomplete');
    const ref = db.collection('owner_daily_delivery_checks').doc(date), email = text(globals().user?.email);
    await db.runTransaction(async transaction => {
      const existing = await transaction.get(ref); if (existing.exists) return;
      transaction.set(ref, {
        recordType: 'owner_daily_delivery_check', date, confirmed: true,
        confirmedAt: serverTime(), confirmedBy: email,
        summary: {
          month: monthOf(summary.month || date), targetCount: Math.max(0, Math.round(number(summary.targetCount) || 0)),
          targetAmount: Math.max(0, Math.round(number(summary.targetAmount) || 0)), actualCount: Math.max(0, Math.round(number(summary.actualCount) || 0)),
          actualAmount: Math.max(0, Math.round(number(summary.actualAmount) || 0)), todayCount: Math.max(0, Math.round(number(summary.todayCount) || 0)),
          todayAmount: Math.max(0, Math.round(number(summary.todayAmount) || 0)), missingAmountCount: 0,
          remainingCount: Math.max(0, Math.round(number(summary.remainingCount) || 0)), remainingAmount: Math.max(0, Math.round(number(summary.remainingAmount) || 0)),
          sourceHash: text(summary.sourceHash).slice(0, 120),
        },
      });
    });
  }
  async function saveQualityReview(input = {}) {
    const db = assertOwnerDb(), score = number(input.score), weekStart = dateOnly(input.weekStart || mondayOf(ymd(new Date()))), editorUid = text(input.editorUid || input.editorId || input.workerId), unitKey = text(input.unitKey);
    if (!weekStart || !editorUid || !unitKey || score === null || !Number.isInteger(score) || score < 1 || score > 5) throw new Error('invalid-quality-review');
    const note = text(input.note); if (note.length > 2000) throw new Error('quality-note-too-long');
    const id = `${weekStart}_${safeKey(editorUid)}_${safeKey(unitKey)}`;
    const existing = state.qualityReviews.find(row => row.id === id), email = text(globals().user?.email), payload = {
      recordType: 'owner_editor_quality_review', weekStart, editorUid, unitKey, score, note,
      active: input.active !== false, revision: Number(existing?.revision || 0) + 1,
      updatedAt: serverTime(), updatedBy: email,
    };
    if (!existing) Object.assign(payload, { createdAt: serverTime(), createdBy: email });
    await db.collection('owner_editor_quality_reviews').doc(id).set(payload, { merge: true });
  }
  async function publishWeeklyRanking(input = {}) {
    const db = assertOwnerDb(), weekStart = dateOnly(input.weekStart || mondayOf(ymd(new Date()))), rows = Array.isArray(input.rows) ? input.rows : [];
    if (!weekStart) throw new Error('invalid-week');
    const safeRows = rows.slice(0, 200).map(row => ({
      editorUid: text(row.editorId || row.editorUid).slice(0, 160), editorName: text(row.editorName).slice(0, 100),
      rank: Math.max(1, Math.round(number(row.rank) || 1)), delivered: Math.max(0, Math.round(number(row.delivered) || 0)),
      onTimeRate: row.onTimeRate === null ? null : Math.max(0, Math.min(1, number(row.onTimeRate) || 0)),
      averageQuality: row.averageQuality === null ? null : Math.max(1, Math.min(5, number(row.averageQuality) || 1)),
      qualityEvaluationRate: Math.max(0, Math.min(1, number(row.qualityEvaluationRate) || 0)),
      qualityEvaluationCount: Math.max(0, Math.round(number(row.reviews?.length) || 0)),
      score: row.score === null ? null : Math.max(0, Math.min(100, number(row.score) || 0)),
    })).filter(row => row.editorUid);
    const email = text(globals().user?.email), ref = db.collection('editor_weekly_rankings').doc(weekStart);
    await ref.set({ recordType: 'editor_weekly_ranking', weekStart, rows: safeRows, revision: Number(input.revision || 0) + 1, updatedAt: serverTime(), updatedBy: email }, { merge: true });
  }
  function gatePassed(date = ymd(new Date())) { return state.ready.daily && state.dailyCheck?.date === dateOnly(date) && state.dailyCheck?.confirmed === true && !!state.dailyCheck?.confirmedAt; }
  function allReady(options = {}) { return options.sourcesReady === true && state.ready.goal && state.ready.daily && state.ready.quality && !state.error; }
  function currentDashboard(options = {}) {
    const finance = Array.isArray(options.finance) ? options.finance : [];
    return dashboard({ ...options, finance, goal: state.goal || options.goal, qualityReviews: state.qualityReviews, today: options.today || ymd(new Date()) });
  }
  function renderGate(target, options = {}) {
    const date = dateOnly(options.date || options.today || ymd(new Date())); state.lastOptions = { ...options, date, today: date };
    if (!options.skipStart) lazyStart({ ...options, date, includeQuality: false, onChange: options.onChange });
    const passed = gatePassed(date), ready = allReady(options), data = ready ? currentDashboard(state.lastOptions) : null;
    const missing = data?.monthSummary?.all?.missingAmountCount || 0, goal = state.goal;
    const html = `<section class="owner-delivery-gate" data-gate-passed="${passed ? 'true' : 'false'}"><div class="company-gate-kicker">OWNER DAILY DELIVERY CHECK</div><h1>${passed ? '本日の確認済み' : '納品本数・金額を確認'}</h1>${!ready ? `<p>${state.error ? '集計データを読み込めません。再読み込み後に確認してください。' : '実績と目標を読み込んでいます。'}</p>` : `<div class="owner-performance-cards"><article><b>今日の納品</b><div>${data.todaySummary.all.count}本</div></article><article><b>今日の確定売上</b><div>${data.todaySummary.all.amount.toLocaleString('ja-JP')}円</div><small>金額未設定 ${data.todaySummary.all.missingAmountCount}件</small></article><article><b>今月の納品・売上</b><div>${data.monthSummary.all.count}本 / ${data.monthSummary.all.amount.toLocaleString('ja-JP')}円</div><small>金額未設定 ${missing}件</small></article><article><b>目標まで</b><div>${data.pace.remainingCount}本 / ${data.pace.remainingAmount.toLocaleString('ja-JP')}円</div></article></div>`}${!goal?.active ? '<p class="notice">今月の目標が未設定です。「納品・目標」画面で設定してください。</p>' : ''}${missing ? `<p class="notice">金額未設定が${missing}件あるため、確認を確定できません。</p>` : ''}${passed ? '<p>オーナー確認が完了しています。</p>' : `<label class="company-gate-check"><input id="owner-performance-confirm" type="checkbox" ${ready && goal?.active && !missing ? '' : 'disabled'}>本日の納品本数・金額・目標ペースを確認しました</label><div class="actions"><button class="btn btn-p" onclick="ownerPerformanceConfirmToday()" ${ready && goal?.active && !missing ? '' : 'disabled'}>確認して社内アプリを開く</button><button class="btn btn-g" onclick="setV('videoperformance')">納品・目標を開く</button></div>`}</section>`;
    if (target && typeof target === 'object') target.innerHTML = html;
    return html;
  }
  function renderPage(target, options = {}) {
    state.lastOptions = { ...options, includeQuality: true }; lazyStart({ ...options, includeQuality: true, onChange: () => { if (target?.isConnected) renderPage(target, options); else options.onChange?.(); } });
    if (!allReady(options)) {
      const html = `<section class="owner-video-performance"><h2>納品・目標</h2><p>${state.error ? '集計データを読み込めません。ページを再読み込みしてください。' : '実績・目標・品質評価を読み込んでいます。'}</p></section>`;
      if (target && typeof target === 'object') target.innerHTML = html; return html;
    }
    const data = currentDashboard(options), month = data.pace.month, weekStart = mondayOf(options.today || ymd(new Date()));
    const targets = goalTotals(state.goal || {});
    const groups = [
      ['社内編集', data.monthSummary.internal, targets.rows.internal],
      ['編集代行', data.monthSummary.agency, targets.rows.agency],
      ['編集者派遣', data.monthSummary.dispatch, targets.rows.dispatch],
      ['合計', data.monthSummary.all, { count: targets.targetCount, amount: targets.targetAmount }],
    ];
    const cards = groups.map(([label, row, targetGoal]) => `<article><b>${escapeHtml(label)}</b><div>${row.count}本 / ${row.amount.toLocaleString('ja-JP')}円</div><small>目標 ${targetGoal.count}本 / ${targetGoal.amount.toLocaleString('ja-JP')}円<br>金額未登録 ${row.missingAmountCount}件</small></article>`).join('');
    const goalInputs = GOAL_CATEGORIES.map(category => {
      const targetGoal = targets.rows[category.key];
      return `<article class="owner-goal-category"><h4>${escapeHtml(category.label)}</h4><p>${escapeHtml(category.hint)}</p><div class="form-grid"><label>目標本数（本）<input id="owner-goal-${category.key}-count" type="number" min="0" step="1" inputmode="numeric" value="${targetGoal.count}" oninput="ownerPerformanceUpdateGoalTotal()"></label><label>目標報酬額（円）<input id="owner-goal-${category.key}-amount" type="number" min="0" step="1" inputmode="numeric" value="${targetGoal.amount}" oninput="ownerPerformanceUpdateGoalTotal()"></label></div></article>`;
    }).join('');
    const ranking = data.ranking.map(row => `<li><b>${row.rank}位 ${escapeHtml(row.editorName)}</b> — ${row.delivered}本 / ${row.score === null ? '集計対象なし' : row.score.toFixed(1) + '点'} / 納期遵守 ${row.onTimeRate === null ? '対象なし' : Math.round(row.onTimeRate * 100) + '%'} / 品質評価 ${Math.round(row.qualityEvaluationRate * 100)}%</li>`).join('') || '<li>今週の納品はありません</li>';
    const weekUnits = data.units.filter(unit => unit.completed && unit.completedDeliveryDate >= weekStart && unit.completedDeliveryDate <= addDays(weekStart, 6));
    const quality = weekUnits.map(unit => { const review = state.qualityReviews.find(row => row.unitKey === unit.key && row.active !== false), id = safeKey(unit.key), action = `ownerPerformanceSaveQuality(${JSON.stringify(unit.key)},${JSON.stringify(unit.editorUid || unit.workerId || unit.editorName || '')})`; return `<article class="card"><b>${escapeHtml(unit.title || unit.jobTitle || unit.key)}</b><div class="muted">${escapeHtml(unit.editorName || '担当者未設定')} ・ ${unit.completedDeliveryDate}</div><div class="form-grid"><label>品質<select id="owner-quality-${id}">${[1,2,3,4,5].map(score => `<option value="${score}" ${Number(review?.score || 0) === score ? 'selected' : ''}>${score}</option>`).join('')}</select></label><label>コメント（任意）<input id="owner-quality-note-${id}" maxlength="2000" value="${escapeHtml(review?.note || '')}"></label></div><button class="btn btn-g btn-sm" onclick="${escapeHtml(action)}">品質評価を保存</button></article>`; }).join('') || '<div class="card">今週の納品はありません。</div>';
    const html = `<section class="owner-video-performance"><div class="ph"><div><div class="ph-title">納品・目標</div><div class="muted">完了案件とオーナー専用の確定単価から自動集計</div></div></div><div class="card owner-goal-editor"><h3>${month} の目標</h3><p class="muted">3つの編集形態ごとに、目標本数と目標報酬額を設定します。</p><div class="owner-goal-category-grid">${goalInputs}</div><aside class="owner-goal-total" aria-live="polite"><span>合計目標</span><b><strong id="owner-goal-total-count">${targets.targetCount}</strong>本</b><b><strong id="owner-goal-total-amount">${targets.targetAmount.toLocaleString('ja-JP')}</strong>円</b><small>3区分の入力から自動計算</small></aside>${targets.migratedFromLegacy ? '<p class="notice">旧形式の月目標は「編集代行」へ引き継いで表示しています。3区分を確認して保存してください。</p>' : ''}<div class="actions"><button class="btn btn-p" onclick="ownerPerformanceSaveGoal()">3区分の月目標を保存</button>${state.goal?.active ? '<button class="btn btn-g" onclick="ownerPerformanceDeactivateGoal()">目標を無効化</button>' : ''}</div></div><div class="owner-performance-cards">${cards}</div><div class="card"><b>残り ${data.pace.remainingCount}本・${data.pace.remainingAmount.toLocaleString('ja-JP')}円</b><p>1日平均：${data.pace.daily.count.toFixed(2)}本・${Math.ceil(data.pace.daily.amount).toLocaleString('ja-JP')}円</p><p>1週間平均：${data.pace.weekly.count.toFixed(2)}本・${Math.ceil(data.pace.weekly.amount).toLocaleString('ja-JP')}円</p></div><h3>今週の品質評価</h3><div class="feature-grid two">${quality}</div><div class="card"><div class="section-title"><h3>編集者ランキング</h3><span>${weekStart} から7日間</span></div><ol>${ranking}</ol><button class="btn btn-p btn-sm" onclick="ownerPerformancePublishRanking()">このランキングを編集者へ公開</button></div>${renderGate(null, { ...options, date: options.today || ymd(new Date()), skipStart: true })}</section>`;
    if (target && typeof target === 'object') target.innerHTML = html;
    return html;
  }

  async function withPending(key, action) { if (state.writePending.has(key)) return; state.writePending.add(key); try { await action(); } finally { state.writePending.delete(key); } }
  function notify(message, kind) { try { if (typeof global.toast === 'function') global.toast(message, kind); } catch (_) {} }
  function goalInputFromPage() {
    const input = {};
    GOAL_CATEGORIES.forEach(category => {
      input[category.countField] = Number(global.document?.getElementById(`owner-goal-${category.key}-count`)?.value || 0);
      input[category.amountField] = Number(global.document?.getElementById(`owner-goal-${category.key}-amount`)?.value || 0);
    });
    return input;
  }
  function updateGoalTotalFromPage() {
    const totals = goalTotals(goalInputFromPage());
    const count = global.document?.getElementById('owner-goal-total-count'), amount = global.document?.getElementById('owner-goal-total-amount');
    if (count) count.textContent = String(totals.targetCount);
    if (amount) amount.textContent = totals.targetAmount.toLocaleString('ja-JP');
    return totals;
  }
  async function saveGoalFromPage(active = true) { return withPending('goal', async () => { try { await saveGoal({ month: monthOf(state.lastOptions.today || ymd(new Date())), ...goalInputFromPage(), active }); notify(active ? '3区分の月目標を保存しました' : '月目標を無効化しました'); } catch (error) { console.warn(error); notify('月目標を保存できませんでした', 'err'); } }); }
  async function confirmFromPage() { return withPending('daily', async () => { try { if (!global.document?.getElementById('owner-performance-confirm')?.checked) throw new Error('explicit-owner-confirmation-required'); const data = currentDashboard(state.lastOptions), summary = { sourcesReady: state.lastOptions.sourcesReady === true, month: data.pace.month, targetCount: data.pace.targetCount, targetAmount: data.pace.targetAmount, actualCount: data.pace.actualCount, actualAmount: data.pace.actualAmount, todayCount: data.todaySummary.all.count, todayAmount: data.todaySummary.all.amount, missingAmountCount: data.monthSummary.all.missingAmountCount, remainingCount: data.pace.remainingCount, remainingAmount: data.pace.remainingAmount, sourceHash: sourceHash(data.monthSummary.rows) }; await confirmDailyCheck({ confirmed: true, date: state.lastOptions.today || ymd(new Date()), summary }); notify('本日の納品本数・金額を確認しました'); state.lastOptions.onChange?.(); } catch (error) { console.warn(error); notify(error?.message === 'delivery-summary-incomplete' ? '金額未設定の納品があるため確認できません' : '本日の確認を保存できませんでした', 'err'); } }); }
  async function saveQualityFromPage(unitKey, editorUid) { return withPending(`quality:${unitKey}`, async () => { const id = safeKey(unitKey); try { await saveQualityReview({ unitKey, editorUid, weekStart: mondayOf(state.lastOptions.today || ymd(new Date())), score: Number(global.document?.getElementById(`owner-quality-${id}`)?.value), note: global.document?.getElementById(`owner-quality-note-${id}`)?.value || '' }); notify('品質評価を保存しました'); } catch (error) { console.warn(error); notify('品質評価を保存できませんでした', 'err'); } }); }
  async function publishFromPage() { return withPending('ranking', async () => { try { const data = currentDashboard(state.lastOptions); await publishWeeklyRanking({ weekStart: mondayOf(state.lastOptions.today || ymd(new Date())), rows: data.ranking }); notify('編集者ランキングを公開しました'); } catch (error) { console.warn(error); notify('編集者ランキングを公開できませんでした', 'err'); } }); }

  global.ownerPerformanceSaveGoal = () => saveGoalFromPage(true);
  global.ownerPerformanceDeactivateGoal = () => saveGoalFromPage(false);
  global.ownerPerformanceUpdateGoalTotal = updateGoalTotalFromPage;
  global.ownerPerformanceConfirmToday = confirmFromPage;
  global.ownerPerformanceSaveQuality = saveQualityFromPage;
  global.ownerPerformancePublishRanking = publishFromPage;
  global.EditflowOwnerPerformance = { logic: { goalBreakdown, goalTotals, normalizeWorkUnits, completedWorkUnits, joinOwnerFinance, summarizeDelivery, monthlyPace, weeklyEditorRanking, dashboard, mondayOf, sourceHash }, lazyStart, stop, saveGoal, confirmDailyCheck, saveQualityReview, publishWeeklyRanking, gatePassed, allReady, renderGate, renderPage };
})(typeof window !== 'undefined' ? window : globalThis);
