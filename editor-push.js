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
  const SCHEMA_VERSION = 1;

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

  async function status(options) {
    const uid = string(options?.uid, 128);
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
    };
    if (!result.supported) {
      result.reason = 'この端末・ブラウザでは通知を利用できません。';
      return result;
    }
    if (requiresInstalledApp() && !result.installed) {
      result.reason = 'iPhoneではホーム画面に追加してから通知を設定してください。';
      return result;
    }
    if (result.permission !== 'granted') {
      result.reason = result.permission === 'denied' ? '通知が拒否されています。端末の設定から許可してください。' : '通知を許可してください。';
      return result;
    }
    if (!result.configured) {
      result.reason = '通知サーバーの準備中です。設定が完了するまで通知は有効になりません。';
      return result;
    }
    try {
      const reg = await registration();
      result.subscribed = Boolean(await reg.pushManager.getSubscription());
      if (options?.db && uid) result.stored = Boolean((await deviceRef(options.db, uid).get()).exists);
      result.ready = result.subscribed && result.stored;
      result.reason = result.ready ? 'この端末で通知を受け取れます。' : '通知の登録を完了してください。';
    } catch (_) {
      result.reason = '通知の状態を確認できませんでした。通信を確認して、もう一度お試しください。';
    }
    return result;
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

  global.EditorPush = Object.freeze({
    config, supported, isInstalled, requiresInstalledApp, appPath, permission, status, subscribe, unsubscribe,
    enable: subscribe, disable: unsubscribe, dispatchDirectThread, stableDeviceId,
    syncBadge, pendingBadgeCount,
  });
}(window));
