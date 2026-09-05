/*
 * Editor Portal Web Push client.
 *
 * This module deliberately contains no private key and never treats a local
 * browser permission as proof that background delivery is available.  The
 * server endpoint and VAPID public key are injected only after the dedicated
 * worker has been configured and deployed.
 */
(function (global) {
  'use strict';

  const STORAGE_PREFIX = 'mc_editor_push_device_';
  const INSTALL_SEEN_KEY = 'mc_editor_push_install_seen';
  const SCHEMA_VERSION = 1;
  const NOTIFY_KINDS = ['invoice_submitted', 'invoice_returned', 'feedback', 'case_message'];

  /*
   * `reason` is a stable machine code and `message` is the sentence to show.
   * Splitting them lets the UI branch on the cause (for example: offer the
   * iPhone install steps only when installation is actually what is missing)
   * without matching on Japanese prose.
   */
  const REASON_MESSAGES = Object.freeze({
    unsupported: 'この端末・ブラウザでは通知を利用できません。',
    ios_not_installed: 'iPhoneは、共有メニューから「ホーム画面に追加」してから通知を設定してください。',
    ios_open_from_home: 'ホーム画面に追加済みです。追加したアイコンからアプリを開き直すと通知を設定できます。',
    permission_denied: '通知が拒否されています。端末の設定から通知を許可してください。',
    permission_default: '通知を許可してください。',
    server_not_ready: '通知サーバーの準備中です。設定が完了するまで通知は有効になりません。',
    not_subscribed: 'この端末はまだ通知に登録されていません。「通知を有効にする」を押してください。',
    unknown: '通知の状態を確認できませんでした。通信を確認して、もう一度お試しください。',
    ok: 'この端末で通知を受け取れます。',
  });

  function string(value, max) {
    return String(value || '').trim().slice(0, max);
  }

  function config() {
    const source = global.EDITOR_PUSH_CONFIG || {};
    const endpoint = string(source.endpoint, 500);
    const vapidPublicKey = string(source.vapidPublicKey, 300);
    const enabled = source.enabled === true
      && /^https:\/\//.test(endpoint)
      && /^[A-Za-z0-9_-]{40,200}$/.test(vapidPublicKey);
    return { enabled, endpoint, vapidPublicKey };
  }

  function isSecure() {
    return global.isSecureContext === true || /^(localhost|127\.0\.0\.1)$/i.test(global.location?.hostname || '');
  }

  function isInstalled() {
    return Boolean(
      global.matchMedia?.('(display-mode: standalone)')?.matches
      || global.navigator?.standalone === true
    );
  }

  // Desktop browsers can receive Web Push without an installed PWA.  iOS is
  // the exception: Apple only exposes push to a Home Screen web app.  Keeping
  // that distinction here avoids telling PC users that installation is a
  // prerequisite when it is not.
  function requiresInstalledApp() {
    const ua = String(global.navigator?.userAgent || '');
    return /iphone|ipad|ipod/i.test(ua);
  }

  // The worker accepts only these two fixed destinations.  A device record
  // never gets to choose an arbitrary URL from a DM or case payload.
  function appPath() {
    return /\/editor\.html$/i.test(String(global.location?.pathname || ''))
      ? './editor.html?notification=1'
      : './?notification=1';
  }

  // An iPhone that is opened from Safari and one that was never added to the
  // Home Screen look identical to the page.  Remembering that this browser has
  // run in standalone mode at least once separates the two, so the user is
  // told to re-open the installed app instead of installing it again.
  function rememberInstalled() {
    if (!isInstalled()) return false;
    try { global.localStorage?.setItem(INSTALL_SEEN_KEY, '1'); } catch (_) {}
    return true;
  }

  function everInstalled() {
    try { return global.localStorage?.getItem(INSTALL_SEEN_KEY) === '1'; } catch (_) { return false; }
  }

  function supported() {
    return Boolean(
      isSecure()
      && global.navigator?.serviceWorker
      && global.PushManager
      && global.Notification
    );
  }

  function permission() {
    return typeof global.Notification === 'undefined' ? 'unsupported' : global.Notification.permission;
  }

  function toBase64Url(bytes) {
    let binary = '';
    new Uint8Array(bytes).forEach((byte) => { binary += String.fromCharCode(byte); });
    return global.btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function fromBase64Url(value) {
    const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
    const padded = raw + '='.repeat((4 - (raw.length % 4)) % 4);
    const binary = global.atob(padded);
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  }

  function stableDeviceId(uid) {
    const key = `${STORAGE_PREFIX}${string(uid, 128)}`;
    try {
      const saved = string(global.localStorage?.getItem(key), 80);
      if (/^[A-Za-z0-9_-]{20,80}$/.test(saved)) return saved;
      const bytes = new Uint8Array(18);
      global.crypto?.getRandomValues?.(bytes);
      const next = bytes.some(Boolean) ? toBase64Url(bytes) : `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      global.localStorage?.setItem(key, next);
      return next;
    } catch (_) {
      return `device_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }
  }

  function subscriptionData(subscription, uid) {
    const json = subscription?.toJSON?.() || {};
    const keys = json.keys || {};
    const endpoint = string(json.endpoint || subscription?.endpoint, 2000);
    if (!/^https:\/\//.test(endpoint) || !string(keys.p256dh, 300) || !string(keys.auth, 300)) {
      throw new Error('push_subscription_invalid');
    }
    const deviceId = stableDeviceId(uid);
    return {
      deviceId,
      endpoint,
      keys: { p256dh: string(keys.p256dh, 300), auth: string(keys.auth, 300) },
      permission: permission(),
      // This remains true for desktop clients because an installed PWA is not
      // required there.  The server-side device record is a delivery target,
      // not proof of an app installation.
      appInstalled: isInstalled() || !requiresInstalledApp(),
      appPath: appPath(),
      platform: string(global.navigator?.platform || global.navigator?.userAgent || '', 180),
      userAgent: string(global.navigator?.userAgent || '', 400),
      schemaVersion: SCHEMA_VERSION,
      updatedAt: Date.now(),
    };
  }

  function deviceRef(db, uid) {
    if (!db || !uid) throw new Error('push_not_signed_in');
    return db.collection('editor_portals').doc(uid).collection('push_devices').doc(stableDeviceId(uid));
  }

  async function registration() {
    if (!global.navigator?.serviceWorker) throw new Error('push_unsupported');
    return global.navigator.serviceWorker.ready;
  }

  function withReason(result, reason) {
    result.reason = reason;
    result.message = REASON_MESSAGES[reason] || REASON_MESSAGES.unknown;
    return result;
  }

  async function status(options) {
    const uid = string(options?.uid, 128);
    rememberInstalled();
    const result = {
      supported: supported(),
      secure: isSecure(),
      installed: isInstalled(),
      permission: permission(),
      configured: config().enabled,
      backendReady: config().enabled,
      subscribed: false,
      stored: false,
      ready: false,
      reason: '',
      message: '',
    };
    // The iPhone check runs first on purpose: Safari hides parts of the push
    // API outside a Home Screen app, so "unsupported" would otherwise hide the
    // one instruction that actually fixes it.
    if (requiresInstalledApp() && !result.installed) {
      return withReason(result, everInstalled() ? 'ios_open_from_home' : 'ios_not_installed');
    }
    if (!result.supported) return withReason(result, 'unsupported');
    if (result.permission !== 'granted') {
      return withReason(result, result.permission === 'denied' ? 'permission_denied' : 'permission_default');
    }
    if (!result.configured) return withReason(result, 'server_not_ready');
    try {
      const reg = await registration();
      result.subscribed = Boolean(await reg.pushManager.getSubscription());
      if (options?.db && uid) result.stored = Boolean((await deviceRef(options.db, uid).get()).exists);
      result.ready = result.subscribed && result.stored;
      return withReason(result, result.ready ? 'ok' : 'not_subscribed');
    } catch (_) {
      return withReason(result, 'unknown');
    }
  }

  async function subscribe(options) {
    const db = options?.db;
    const uid = string(options?.uid, 128);
    if (!supported()) throw new Error('push_unsupported');
    if (requiresInstalledApp() && !isInstalled()) throw new Error('push_install_required');
    const active = config();
    if (!active.enabled) throw new Error('push_server_not_ready');
    let currentPermission = permission();
    if (currentPermission === 'default') currentPermission = await global.Notification.requestPermission();
    if (currentPermission !== 'granted') throw new Error('push_permission_not_granted');
    const reg = await registration();
    let subscription = await reg.pushManager.getSubscription();
    if (!subscription) {
      subscription = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: fromBase64Url(active.vapidPublicKey),
      });
    }
    const data = subscriptionData(subscription, uid);
    const ref = deviceRef(db, uid);
    const existing = await ref.get();
    // Firestore keeps createdAt immutable.  Old device rows can therefore be
    // upgraded with appPath without rewriting their original creation time.
    await ref.set(existing.exists ? data : { ...data, createdAt: Date.now() }, { merge: true });
    return status({ db, uid });
  }

  /*
   * A push endpoint can be dropped by the browser or expired by the push
   * service, and the worker deletes the device row when it sees 404/410.  This
   * re-registers the device on the next app start so the user does not have to
   * notice the silence and re-enable notifications by hand.  It never prompts:
   * without an already-granted permission it just reports the current status.
   */
  async function ensureSubscribed(options) {
    rememberInstalled();
    const current = await status(options);
    if (current.ready) return current;
    if (current.permission !== 'granted' || !current.configured || !current.supported) return current;
    if (requiresInstalledApp() && !current.installed) return current;
    try {
      return await subscribe(options);
    } catch (_) {
      return current;
    }
  }

  async function unsubscribe(options) {
    const db = options?.db;
    const uid = string(options?.uid, 128);
    const reg = await registration();
    const subscription = await reg.pushManager.getSubscription();
    if (subscription) await subscription.unsubscribe();
    if (db && uid) await deviceRef(db, uid).delete();
    return { unsubscribed: true };
  }

  // The app icon badge is a local reflection of already-authoritative unread
  // records.  It never writes to Firestore and silently falls back on browsers
  // that do not support the Badging API.
  async function syncBadge(count) {
    const value = Math.max(0, Math.min(999, Number(count) || 0));
    try {
      if (value > 0 && typeof global.navigator?.setAppBadge === 'function') {
        await global.navigator.setAppBadge(value);
      } else if (value === 0 && typeof global.navigator?.clearAppBadge === 'function') {
        await global.navigator.clearAppBadge();
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  async function pendingBadgeCount() {
    // Browser notifications are delivery attempts, not unread records.  A
    // stale notification (or a second tab) must never inflate the icon badge.
    // Callers re-sync their Firestore-backed registries after a push hint.
    return 0;
  }

  // A push can arrive while the page is open but its Firestore listener has
  // not delivered the new record yet. Treat it as a re-sync hint only: the
  // service-worker badge count is not authoritative and is deliberately not
  // copied into the app badge.
  if (global.navigator?.serviceWorker?.addEventListener) {
    global.navigator.serviceWorker.addEventListener('message', (event) => {
      if (event?.data?.type !== 'editflow-push-received') return;
      const notificationId = string(event?.data?.notificationId, 512);
      try {
        global.dispatchEvent(new CustomEvent('editflow-push-received', { detail: { notificationId, authoritative: false } }));
      } catch (_) {}
    });
  }

  /*
   * Dispatch is intentionally constrained to a resource identifier.  A client
   * must never choose a recipient UID: the worker derives the other party from
   * a Firestore direct-thread record after verifying the Firebase ID token.
   */
  async function dispatchDirectThread(options) {
    const active = config();
    const threadId = string(options?.threadId, 300);
    const token = string(options?.idToken, 4096);
    if (!active.enabled) throw new Error('push_server_not_ready');
    if (!threadId || !token) throw new Error('push_dispatch_input_invalid');
    const response = await global.fetch(`${active.endpoint.replace(/\/$/, '')}/v1/push/direct-thread`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ threadId }),
      credentials: 'omit',
    });
    if (!response.ok) throw new Error('push_dispatch_rejected');
    return response.json();
  }

  /*
   * Like dispatchDirectThread, this names a record — never a recipient.  The
   * worker re-checks the caller's Firestore access to that record and derives
   * who should be told.  A `targetUid` is not accepted here and is ignored by
   * the server.
   *
   * Unlike dispatchDirectThread this resolves instead of throwing, because the
   * caller has already committed the underlying write: a failed notification
   * is a warning to show, not a reason to unwind a saved invoice or feedback.
   */
  async function dispatchNotify(options) {
    const active = config();
    const kind = string(options?.kind, 40);
    const token = string(options?.idToken, 4096);
    if (!active.enabled) return { ok: false, reason: 'push_server_not_ready' };
    if (!NOTIFY_KINDS.includes(kind)) return { ok: false, reason: 'push_kind_invalid' };
    if (!token) return { ok: false, reason: 'push_dispatch_input_invalid' };
    const payload = { kind };
    ['portalUid', 'jobId', 'invoiceId', 'threadId'].forEach((key) => {
      const value = string(options?.[key], 300);
      if (value) payload[key] = value;
    });
    try {
      const response = await global.fetch(`${active.endpoint.replace(/\/$/, '')}/v1/push/notify`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify(payload),
        credentials: 'omit',
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result?.ok !== true) {
        return { ok: false, reason: string(result?.error, 120) || `push_dispatch_rejected_${response.status}` };
      }
      return { ok: true, ...result };
    } catch (_) {
      return { ok: false, reason: 'push_dispatch_unreachable' };
    }
  }

  rememberInstalled();

  global.EditorPush = Object.freeze({
    config, supported, isInstalled, requiresInstalledApp, appPath, permission, status, subscribe, unsubscribe,
    enable: subscribe, disable: unsubscribe, ensureSubscribed, dispatchDirectThread, dispatchNotify, stableDeviceId,
    syncBadge, pendingBadgeCount, reasonMessages: REASON_MESSAGES, notifyKinds: Object.freeze(NOTIFY_KINDS.slice()),
  });
}(window));
