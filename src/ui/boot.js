/*
 * ui/boot.js - loaded last: every core module, the runtime and all page modules are registered by now.
 */
(function (root) {
  'use strict';
  const STATE_KEY = 'veyvo-state';

  /** The stored state that keeps the app from starting, or null (nothing stored / storage blocked). */
  function storedState() {
    try { return root.localStorage.getItem(STATE_KEY); } catch (e) { return null; }
  }

  /**
   * A way out when the saved state cannot be shown: keep it under 'veyvo-state-corrupt-<time>' (the
   * same place VeyvoStore keeps unreadable data), start empty and restore from Settings › Data.
   */
  function safeStart() {
    const raw = storedState();
    if (raw === null) return false;
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const prefix = (root.VeyvoStore && root.VeyvoStore.CORRUPT_KEY_PREFIX) || 'veyvo-state-corrupt-';
    const key = prefix + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    try {
      root.localStorage.setItem(key, raw);
      if (root.localStorage.getItem(key) !== raw) return false;
      root.localStorage.removeItem(STATE_KEY);
    } catch (e) { return false; }
    root.location.reload();
    return true;
  }

  try {
    root.VeyvoUI.app.start();
  } catch (err) {
    console.error('VEYVO failed to start', err);
    const doc = root.document;
    const I18n = root.VeyvoI18n;
    const tr = (key, fallback) => (I18n && typeof I18n.has === 'function' && I18n.has(key) ? I18n.t(key) : fallback);
    const box = doc.createElement('div');
    box.setAttribute('role', 'alert');
    box.style.cssText = 'position:fixed;inset:auto 16px 16px 16px;padding:14px 16px;border-radius:8px;background:#23262C;color:#F3F4F6;font:14px/1.45 system-ui,sans-serif;z-index:99';
    const text = doc.createElement('p');
    text.style.margin = '0';
    text.textContent = 'VEYVO: ' + (err && err.message ? err.message : String(err));
    box.appendChild(text);
    if (storedState() !== null) {
      const hint = doc.createElement('p');
      hint.style.cssText = 'margin:8px 0 10px;color:#A9B0BA';
      hint.textContent = tr('ui.boot.safeStartHint', 'The saved data stays in a copy on this device. You can then restore it in Settings › Data › Automatic backups.');
      const button = doc.createElement('button');
      button.type = 'button';
      button.setAttribute('data-key', 'boot-safe-start');
      button.style.cssText = 'min-height:44px;padding:0 16px;border:0;border-radius:8px;background:#F5621A;color:#160700;font:600 14px/1 system-ui,sans-serif;cursor:pointer';
      button.textContent = tr('ui.boot.safeStart', 'Start without the saved data');
      button.addEventListener('click', safeStart);
      box.appendChild(hint);
      box.appendChild(button);
    }
    doc.body.appendChild(box);
  }
})(globalThis);
