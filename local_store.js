/**
 * local_store.js — Unified localStorage wrapper
 * Namespace: ls_ prefix for all keys
 * Features: JSON auto-parse, TTL, defaults, atomic updates
 *
 * _fbHook: set by streak_app_v2 after user login — called on every write
 * _noSync: set to true when writing FROM Firebase to avoid infinite loops
 */
const LS = {
  _p: 'ls_',
  _fbHook: null,
  _noSync: false,

  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(this._p + key);
      if (raw === null) return fallback;
      const parsed = JSON.parse(raw);
      if (parsed && parsed._ttl && Date.now() > parsed._ttl) {
        this.del(key);
        return fallback;
      }
      return parsed._ttl ? parsed.v : parsed;
    } catch { return fallback; }
  },

  set(key, value, ttlMs = 0) {
    try {
      const data = ttlMs > 0 ? { v: value, _ttl: Date.now() + ttlMs } : value;
      localStorage.setItem(this._p + key, JSON.stringify(data));
      if (this._fbHook && !this._noSync) {
        try { this._fbHook(key, value); } catch (e) { }
      }
    } catch (e) { console.warn('[LS] Write failed:', key, e); }
  },

  del(key) {
    localStorage.removeItem(this._p + key);
    if (this._fbHook && !this._noSync) {
      try { this._fbHook(key, null); } catch (e) { }
    }
  },

  update(key, fn, fallback = {}) {
    const cur = this.get(key, fallback);
    const next = fn(cur);
    this.set(key, next);
    return next;
  },

  push(key, item, maxLen = 500) {
    const arr = this.get(key, []);
    arr.push(item);
    if (arr.length > maxLen) arr.splice(0, arr.length - maxLen);
    this.set(key, arr);
  },

  keys(prefix = '') {
    const full = this._p + prefix;
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) out.push(k.slice(this._p.length));
    }
    return out;
  },

  today() {
    return new Date().toISOString().split('T')[0];
  },

  uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }
};
