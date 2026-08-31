/* EditFlow unread notification registry.
 *
 * Push delivery is only a wake-up hint.  The badge must be derived from
 * authoritative unread records, not from the number of browser notifications
 * that happened to arrive on this device.  Each UI source replaces its own
 * snapshot and all sources share one stable Firestore notification ID space.
 */
(function (global) {
  'use strict';

  const sources = new Map();
  const listeners = new Set();
  const text = value => String(value == null ? '' : value).trim();

  function stableId(value) {
    const id = text(value);
    return id && id.length <= 512 ? id : '';
  }

  function itemId(item) {
    if (!item || typeof item !== 'object') return '';
    // `notificationId` is the shared canonical field.  `stableId` and `id`
    // are compatibility aliases for existing DM/case/bulletin callers.
    return stableId(item.notificationId || item.stableId || item.id);
  }

  function normalize(items) {
    const next = new Map();
    (Array.isArray(items) ? items : []).forEach(item => {
      if (item?.unread === false) return;
      const id = itemId(item);
      if (id) next.set(id, { ...item, id, notificationId: id });
    });
    return next;
  }

  function aggregate() {
    const all = new Map();
    sources.forEach(records => records.forEach((item, id) => {
      // The same Firestore record can be rendered as a DM, case alert, or
      // bulletin entry.  Its stable ID intentionally counts only once.
      if (!all.has(id)) all.set(id, item);
    }));
    return all;
  }

  function sourceSnapshot(source) {
    const records = sources.get(text(source)) || new Map();
    return Object.freeze({ count: Math.min(999, records.size), ids: Object.freeze([...records.keys()].sort()), items: Object.freeze([...records.values()]) });
  }

  function emit() {
    const snapshot = api.snapshot();
    listeners.forEach(listener => { try { listener(snapshot); } catch (_) {} });
    try { global.dispatchEvent(new CustomEvent('editflow-unread-changed', { detail: snapshot })); } catch (_) {}
  }

  function set(source, items) {
    const key = text(source);
    if (!key) return api.snapshot();
    sources.set(key, normalize(items));
    emit();
    return api.snapshot();
  }

  function clear(source) {
    const key = text(source);
    if (!key || !sources.delete(key)) return api.snapshot();
    emit();
    return api.snapshot();
  }

  function reset() {
    if (!sources.size) return api.snapshot();
    sources.clear();
    emit();
    return api.snapshot();
  }

  const api = Object.freeze({
    stableId,
    set,
    clear,
    reset,
    sourceSnapshot,
    snapshot: () => {
      const records = aggregate();
      return Object.freeze({ count: Math.min(999, records.size), ids: Object.freeze([...records.keys()].sort()), items: Object.freeze([...records.values()]) });
    },
    subscribe(listener) {
      if (typeof listener !== 'function') return () => {};
      listeners.add(listener);
      try { listener(api.snapshot()); } catch (_) {}
      return () => listeners.delete(listener);
    },
  });

  global.EditflowUnread = api;
}(window));
