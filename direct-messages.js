/* mono.create direct messages
 *
 * A deliberately small data layer shared by the manager and editor portals.
 * It stores only conversational metadata and text; case, client and payment
 * records stay in their existing collections.
 */
(function (global) {
  'use strict';

  const OWNER_EMAILS = ['nakamurakouta512@gmail.com', 'mono.create.group@gmail.com'];
  const MAX_MESSAGE_LENGTH = 2000;
  const MAX_PREVIEW_LENGTH = 120;
  const MAX_MESSAGES = 100;
  const CLOUD_WRITE_PAUSED_MESSAGE = 'クラウド接続停止中。再読み込み後に操作してください';
  let peerCache = [];
  // A read receipt is an acknowledgement of one concrete thread update.  Keep
  // it locally only after the write succeeds so a failed request remains
  // retryable, while repeated Firestore snapshots cannot create duplicate
  // writes for the same incoming message.
  const readAcknowledgements = new Map();
  const readAcknowledgementWrites = new Map();
  const activeWatchStops = new Set();
  const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);
  const trim = value => String(value == null ? '' : value).trim();
  const millis = value => value && typeof value.toMillis === 'function' ? value.toMillis() : Number(value || 0);
  function quotaWatchError(error, scope) {
    try { return global.EditflowFirestoreQuota?.handle?.(error, `direct messages ${scope}`) === true; } catch (_) { return false; }
  }
  // The page-level quota circuit has already stopped Firestore networking.
  // Do not turn a user action into an in-memory "success" or queue it for a
  // later implicit write: the person must deliberately reload and retry.
  function assertCloudWriteAvailable() {
    if (!global.EditflowFirestoreQuota?.isOpen?.()) return;
    const error = new Error(CLOUD_WRITE_PAUSED_MESSAGE);
    error.code = 'firestore-quota-circuit-open';
    throw error;
  }
  function trackedStop(stop) {
    let active = true;
    const wrapped = () => {
      if (!active) return;
      active = false;
      activeWatchStops.delete(wrapped);
      try { stop(); } catch (_) {}
    };
    activeWatchStops.add(wrapped);
    return wrapped;
  }
  function stopAllWatches() { [...activeWatchStops].forEach(stop => stop()); }
  global.EditflowFirestoreQuota?.registerStop?.(stopAllWatches);

  function globals() {
    /* `typeof` also works when this file is loaded after a page-level `let`. */
    const pick = name => {
      try { return typeof global[name] !== 'undefined' ? global[name] : undefined; } catch (_) { return undefined; }
    };
    let lexicalDb, lexicalUser, lexicalAccess, lexicalRecords, lexicalDemo, lexicalPreview;
    try { if (typeof fbDb !== 'undefined') lexicalDb = fbDb; } catch (_) {}
    try { if (typeof db !== 'undefined') lexicalDb = lexicalDb || db; } catch (_) {}
    try { if (typeof FB_USER !== 'undefined') lexicalUser = FB_USER; } catch (_) {}
    try { if (typeof user !== 'undefined') lexicalUser = lexicalUser || user; } catch (_) {}
    try { if (typeof APP_ACCESS !== 'undefined') lexicalAccess = APP_ACCESS; } catch (_) {}
    try { if (typeof access !== 'undefined') lexicalAccess = lexicalAccess || access; } catch (_) {}
    try { if (typeof ACCESS_RECORDS !== 'undefined') lexicalRecords = ACCESS_RECORDS; } catch (_) {}
    try { if (typeof DEMO !== 'undefined') lexicalDemo = DEMO; } catch (_) {}
    try { if (typeof ADMIN_PREVIEW !== 'undefined') lexicalPreview = ADMIN_PREVIEW; } catch (_) {}
    return {
      db: lexicalDb || pick('fbDb') || pick('db'), user: lexicalUser || pick('FB_USER') || pick('user'),
      access: lexicalAccess || pick('APP_ACCESS') || pick('access'),
      records: Array.isArray(lexicalRecords) ? lexicalRecords : (Array.isArray(pick('ACCESS_RECORDS')) ? pick('ACCESS_RECORDS') : []),
      firebase: pick('firebase'),
      demo: !!(lexicalDemo || lexicalPreview || pick('DEMO') || pick('ADMIN_PREVIEW') || new URLSearchParams(global.location?.search || '').has('previewUid'))
    };
  }

  function current() {
    const state = globals();
    const user = state.user;
    if (!user || !trim(user.uid)) return null;
    const record = isObject(state.access) ? state.access : state.records.find(item => item && item.id === user.uid) || {};
    return { uid: trim(user.uid), email: trim(user.email).toLowerCase(), name: trim(record.name || user.displayName || user.email || 'メンバー'), record, state };
  }

  function approved(record) { return !!record && record.approved === true && Array.isArray(record.roles); }
  function roles(record) { return Array.isArray(record?.roles) ? record.roles.map(String) : []; }
  function isDirector(record) { return roles(record).includes('動画編集ディレクター'); }
  function isEditor(record) { return roles(record).includes('動画編集者') || isDirector(record); }
  function isExternal(record) { return trim(record?.editorKind || 'direct') === 'external'; }
  function isOwnerRecord(record, email = '') {
    const address = trim(record?.email || email).toLowerCase();
    return OWNER_EMAILS.includes(address) || record?.owner === true;
  }
  function knownMembers() {
    const state = globals();
    const merged = new Map();
    [...state.records, ...peerCache].forEach(record => {
      if (approved(record) && trim(record.id)) merged.set(trim(record.id), record);
    });
    return [...merged.values()];
  }
  function member(uid) { return knownMembers().find(record => record.id === uid) || null; }
  function isCurrentOwner(me) { return !!me && isOwnerRecord(me.record, me.email); }

  // The same policy is repeated in Firestore rules.  Never infer a relation
  // merely from a display name or a job assignment.
  function mayTalk(me, peer) {
    if (!me || !peer || !approved(peer) || peer.id === me.uid) return false;
    const mine = me.record || {};
    if (isCurrentOwner(me)) return isEditor(peer); // owner ↔ approved editor/director
    if (isOwnerRecord(peer)) return isEditor(mine);
    if (!isEditor(peer)) return false;
    if (isDirector(mine) && isExternal(peer) && trim(peer.directorUid) === me.uid) return true;
    if (isExternal(mine) && isDirector(peer) && trim(mine.directorUid) === peer.id) return true;
    return false;
  }

  function peers() {
    const me = current();
    if (!me) return [];
    return knownMembers().filter(record => mayTalk(me, record)).map(record => ({
      uid: record.id, name: trim(record.name || record.email || 'メンバー'), email: trim(record.email),
      roles: roles(record), editorKind: trim(record.editorKind || 'direct'), directorUid: trim(record.directorUid)
    })).sort((a, b) => a.name.localeCompare(b.name, 'ja'));
  }

  async function loadPeers() {
    const me = current();
    if (!me?.state.db) return peers();
    const queries = [];
    if (isCurrentOwner(me)) {
      queries.push(me.state.db.collection('access').where('approved', '==', true).get());
    } else {
      // Editors can discover the owners, but not unrelated member records.
      queries.push(me.state.db.collection('access').where('email', 'in', OWNER_EMAILS).get());
      if (isDirector(me.record)) {
        queries.push(me.state.db.collection('access').where('directorUid', '==', me.uid).get());
      } else if (isExternal(me.record) && trim(me.record.directorUid)) {
        queries.push(me.state.db.collection('access').doc(trim(me.record.directorUid)).get());
      }
    }
    const rows = [];
    const settled = await Promise.allSettled(queries);
    settled.forEach(result => {
      if (result.status !== 'fulfilled') return;
      const value = result.value;
      if (value && Array.isArray(value.docs)) value.docs.forEach(doc => rows.push({ id: doc.id, ...readData(doc.data()) }));
      else if (value?.exists) rows.push({ id: value.id, ...readData(value.data()) });
    });
    peerCache = rows;
    return peers();
  }

  function threadId(firstUid, secondUid) {
    const ids = [trim(firstUid), trim(secondUid)].filter(Boolean).sort();
    if (ids.length !== 2 || ids[0] === ids[1]) throw new Error('invalid-direct-message-participants');
    // Firebase UIDs do not contain '/', but encode defensively so the ID stays
    // a document ID even with a future non-Firebase identity provider.
    return `dm_v1_${ids.map(id => encodeURIComponent(id).replace(/%/g, '_')).join('__')}`;
  }
  function peerFor(uid) {
    const me = current();
    const peer = member(trim(uid));
    if (!me) throw new Error('not-signed-in');
    if (!peer || !mayTalk(me, peer)) throw new Error('direct-message-not-allowed');
    return { me, peer };
  }
  function canWrite() { const me = current(); return !!me && !!me.state.db && !me.state.demo; }
  function serverTime() {
    const state = globals();
    return state.firebase?.firestore?.FieldValue?.serverTimestamp ? state.firebase.firestore.FieldValue.serverTimestamp() : Date.now();
  }
  function preview(body) { return trim(body).replace(/\s+/g, ' ').slice(0, MAX_PREVIEW_LENGTH); }
  function readData(data) { return isObject(data) ? data : {}; }
  function otherParticipant(thread, uid) { return thread.participantA === uid ? thread.participantB : thread.participantA; }
  function readToken(thread) {
    if (!thread || !trim(thread.lastSenderUid) || !millis(thread.lastMessageAt)) return '';
    return `${trim(thread.lastSenderUid)}:${millis(thread.lastMessageAt)}:${trim(thread.lastMessagePreview)}`;
  }

  async function ensureThread(peerUid) {
    assertCloudWriteAvailable();
    const { me, peer } = peerFor(peerUid);
    const id = threadId(me.uid, peer.id);
    if (!canWrite()) return { id, demo: true, participantA: [me.uid, peer.id].sort()[0], participantB: [me.uid, peer.id].sort()[1] };
    const [participantA, participantB] = [me.uid, peer.id].sort();
    const ownerUid = isCurrentOwner(me) ? me.uid : (isOwnerRecord(peer) ? peer.id : '');
    const ref = me.state.db.collection('direct_threads').doc(id);
    const existing = await ref.get();
    if (!existing.exists) await ref.set({
      participantA, participantB, participants: [participantA, participantB], ownerUid,
      createdAt: serverTime(), updatedAt: serverTime(), lastMessageAt: null,
      lastMessagePreview: '', lastSenderUid: '', lastSenderName: ''
    });
    return { id, participantA, participantB };
  }

  async function send(peerUid, body) {
    assertCloudWriteAvailable();
    const text = trim(body);
    if (!text || text.length > MAX_MESSAGE_LENGTH) throw new Error('invalid-direct-message-body');
    const { me, peer } = peerFor(peerUid);
    const thread = await ensureThread(peer.id);
    if (!canWrite()) return { id: `demo-${Date.now()}`, threadId: thread.id, demo: true, body: text };
    const ref = me.state.db.collection('direct_threads').doc(thread.id);
    const messageRef = ref.collection('messages').doc();
    const batch = me.state.db.batch();
    batch.set(messageRef, { senderUid: me.uid, senderName: me.name, body: text, createdAt: serverTime() });
    batch.set(ref, { updatedAt: serverTime(), lastMessageAt: serverTime(), lastMessagePreview: preview(text), lastSenderUid: me.uid, lastSenderName: me.name }, { merge: true });
    await batch.commit();
    return { id: messageRef.id, threadId: thread.id, body: text };
  }

  function validateThreadForCurrent(thread) {
    const me = current();
    if (!me || !thread || ![thread.participantA, thread.participantB].includes(me.uid)) throw new Error('direct-message-not-allowed');
    return me;
  }

  async function messages(threadIdValue, limit = 50) {
    const me = current();
    if (!me?.state.db) return [];
    const threadRef = me.state.db.collection('direct_threads').doc(trim(threadIdValue));
    const threadSnap = await threadRef.get();
    if (!threadSnap.exists) return [];
    validateThreadForCurrent(readData(threadSnap.data()));
    const size = Math.max(1, Math.min(MAX_MESSAGES, Number(limit) || 50));
    const snap = await threadRef.collection('messages').orderBy('createdAt', 'desc').limit(size).get();
    return snap.docs.map(doc => ({ id: doc.id, ...readData(doc.data()) })).reverse();
  }

  async function markRead(threadIdValue, threadHint = null) {
    assertCloudWriteAvailable();
    const me = current();
    if (!me) throw new Error('not-signed-in');
    const id = trim(threadIdValue);
    if (!id) throw new Error('invalid-direct-message-thread');
    if (!canWrite()) return { id, demo: true };
    const threadRef = me.state.db.collection('direct_threads').doc(id);
    let thread = isObject(threadHint) && trim(threadHint.id) === id ? threadHint : null;
    if (!thread) {
      const snapshot = await threadRef.get();
      if (!snapshot.exists) throw new Error('direct-message-thread-not-found');
      thread = { id: snapshot.id, ...readData(snapshot.data()) };
    }
    validateThreadForCurrent(thread);
    const token = readToken(thread);
    if (!token || thread.lastSenderUid === me.uid) return { id, skipped: true };
    if (readAcknowledgements.get(id) === token) return { id, skipped: true };
    const pending = readAcknowledgementWrites.get(id);
    if (pending?.token === token) return pending.promise;
    const promise = threadRef.collection('reads').doc(me.uid).set({ readerUid: me.uid, lastReadAt: serverTime(), updatedAt: serverTime() }, { merge: true })
      .then(() => { readAcknowledgements.set(id, token); return { id }; })
      .finally(() => { if (readAcknowledgementWrites.get(id)?.promise === promise) readAcknowledgementWrites.delete(id); });
    readAcknowledgementWrites.set(id, { token, promise });
    return promise;
  }

  async function markAllRead(threadIds) {
    assertCloudWriteAvailable();
    const me = current();
    if (!me) throw new Error('not-signed-in');
    const inputs = Array.isArray(threadIds) ? threadIds : [];
    const unique = new Map();
    inputs.forEach(value => {
      const id = trim(isObject(value) ? value.id : value);
      if (id && !unique.has(id)) unique.set(id, isObject(value) ? value : null);
    });
    const entries = [...unique.entries()].slice(0, 450);
    if (!entries.length) return { count: 0 };
    if (!canWrite()) return { count: entries.length, demo: true };
    const permitted = [];
    for (const [id, hint] of entries) {
      let thread = hint;
      if (!thread) {
        const snapshot = await me.state.db.collection('direct_threads').doc(id).get();
        if (!snapshot.exists) continue;
        thread = { id: snapshot.id, ...readData(snapshot.data()) };
      }
      validateThreadForCurrent(thread);
      const token = readToken(thread);
      if (token && thread.lastSenderUid !== me.uid && readAcknowledgements.get(id) !== token) permitted.push({ id, token });
    }
    const batch = me.state.db.batch();
    permitted.forEach(({ id }) => batch.set(me.state.db.collection('direct_threads').doc(id).collection('reads').doc(me.uid), { readerUid: me.uid, lastReadAt: serverTime(), updatedAt: serverTime() }, { merge: true }));
    if (permitted.length) await batch.commit();
    permitted.forEach(({ id, token }) => readAcknowledgements.set(id, token));
    return { count: permitted.length };
  }

  function ownerThreadQuery(me) {
    let query = me.state.db.collection('direct_threads').where('participants', 'array-contains', me.uid);
    // The Firestore rule mirrors this exact split.  Do not replace it with a
    // generic participants-only query: it cannot prove a live director/
    // external relationship and must be denied by the rules engine.
    return isCurrentOwner(me)
      ? query.where('ownerUid', '==', me.uid)
      : query.where('ownerUid', '!=', '');
  }

  async function ownerConversationThreads(me) {
    const snapshot = await ownerThreadQuery(me).get();
    return snapshot.docs.map(doc => ({ id: doc.id, ...readData(doc.data()) })).filter(thread => {
      try { validateThreadForCurrent(thread); return true; } catch (_) { return false; }
    });
  }

  async function currentPeerThreads(me) {
    if (isCurrentOwner(me)) return [];
    const candidates = peers().filter(peer => !isOwnerRecord(member(peer.uid) || peer, peer.email));
    const snapshots = await Promise.all(candidates.map(async peer => {
      try {
        const snap = await me.state.db.collection('direct_threads').doc(threadId(me.uid, peer.uid)).get();
        if (!snap.exists) return null;
        const thread = { id: snap.id, ...readData(snap.data()) };
        validateThreadForCurrent(thread);
        return thread;
      } catch (_) { return null; }
    }));
    return snapshots.filter(Boolean);
  }

  async function enrichThreads(me, sourceThreads) {
    const byId = new Map();
    (Array.isArray(sourceThreads) ? sourceThreads : []).forEach(thread => {
      try { validateThreadForCurrent(thread); byId.set(thread.id, thread); } catch (_) {}
    });
    const threads = [...byId.values()];
    const enriched = await Promise.all(threads.map(async thread => {
      let receipt = {};
      try { const snap = await me.state.db.collection('direct_threads').doc(thread.id).collection('reads').doc(me.uid).get(); receipt = snap.exists ? readData(snap.data()) : {}; } catch (_) {}
      const lastAt = millis(thread.lastMessageAt), readAt = millis(receipt.lastReadAt);
      const unread = thread.lastSenderUid !== me.uid && lastAt > readAt;
      const counterpartUid = otherParticipant(thread, me.uid);
      let counterpart = member(counterpartUid);
      // An owner can safely start the first conversation before their optional
      // access-directory row exists.  The existing immutable thread then acts
      // as the relationship proof so the editor can open and reply to it.
      if (!counterpart && thread.ownerUid === counterpartUid) {
        counterpart = { id: counterpartUid, name: 'オーナー', email: '', approved: true, owner: true, roles: ['動画編集ディレクター'], editorKind: 'direct' };
        peerCache = [...peerCache.filter(item => item.id !== counterpartUid), counterpart];
      }
      return { ...thread, counterpartUid: otherParticipant(thread, me.uid), counterpartName: trim(counterpart?.name || counterpart?.email || 'メンバー'), lastReadAt: receipt.lastReadAt || null, unread };
    }));
    return enriched.sort((a, b) => millis(b.lastMessageAt || b.updatedAt) - millis(a.lastMessageAt || a.updatedAt));
  }

  async function list() {
    const me = current();
    if (!me?.state.db) return [];
    const sources = await Promise.all([ownerConversationThreads(me), currentPeerThreads(me)]);
    return enrichThreads(me, sources.flat());
  }

  function watch(callback) {
    const me = current();
    if (global.EditflowFirestoreQuota?.isOpen?.() || !me?.state.db || typeof callback !== 'function') return () => {};
    let cancelled = false, queued = false, emitVersion = 0;
    const ownerThreads = new Map(), peerThreads = new Map();
    const emit = () => {
      if (queued || cancelled) return;
      queued = true;
      Promise.resolve().then(async () => {
        queued = false;
        if (cancelled) return;
        const version = ++emitVersion;
        const snapshots = [...ownerThreads.values(), ...peerThreads.values()];
        try {
          const rows = await enrichThreads(me, snapshots);
          if (!cancelled && version === emitVersion) callback(rows);
        } catch (error) { if (!cancelled && version === emitVersion) callback([], error); }
      });
    };
    const unsubs = [ownerThreadQuery(me).onSnapshot(snapshot => {
      ownerThreads.clear();
      snapshot.docs.forEach(doc => ownerThreads.set(doc.id, { id: doc.id, ...readData(doc.data()) }));
      emit();
    }, error => { if (!cancelled && !quotaWatchError(error, 'threads')) callback([], error); })];
    // Current director/external conversations are watched by deterministic
    // document ID, never by a broad thread-list query.
    if (!isCurrentOwner(me)) peers().filter(peer => !isOwnerRecord(member(peer.uid) || peer, peer.email)).forEach(peer => {
      const id = threadId(me.uid, peer.uid);
      unsubs.push(me.state.db.collection('direct_threads').doc(id).onSnapshot(snapshot => {
        if (snapshot.exists) peerThreads.set(id, { id: snapshot.id, ...readData(snapshot.data()) });
        else peerThreads.delete(id);
        emit();
      }, error => {
        // A peer can move teams while a screen is open.  The denied old watch
        // is simply removed from the merged list; it is not a user-facing app error.
        if (!cancelled && error?.code !== 'permission-denied' && !quotaWatchError(error, 'peer thread')) callback([], error);
      }));
    });
    return trackedStop(() => { cancelled = true; unsubs.forEach(unsub => { try { unsub(); } catch (_) {} }); });
  }
  function watchMessages(threadIdValue, callback, limit = 50) {
    const me = current();
    if (global.EditflowFirestoreQuota?.isOpen?.() || !me?.state.db || typeof callback !== 'function') return () => {};
    const id = trim(threadIdValue);
    const unsub = me.state.db.collection('direct_threads').doc(id).collection('messages').orderBy('createdAt', 'desc').limit(Math.max(1, Math.min(MAX_MESSAGES, Number(limit) || 50))).onSnapshot(snapshot => {
      callback(snapshot.docs.map(doc => ({ id: doc.id, ...readData(doc.data()) })).reverse());
    }, error => { if (!quotaWatchError(error, 'messages')) callback([], error); });
    return trackedStop(unsub);
  }

  global.EditflowDM = Object.freeze({
    version: '1.0.0', threadId, peers, canMessage: uid => { try { peerFor(uid); return true; } catch (_) { return false; } },
    loadPeers, ensureThread, send, messages, list, markRead, markAllRead, watch, watchMessages, stopAllWatches,
    limits: Object.freeze({ maxMessageLength: MAX_MESSAGE_LENGTH, maxMessages: MAX_MESSAGES }),
    cloudWritePausedMessage: CLOUD_WRITE_PAUSED_MESSAGE
  });
})(window);
