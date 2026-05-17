/**
 * presence.js — Focus Presence System
 * - Writes focus status to Firebase /presence/{userId} when Pomodoro starts
 * - Reads all members' statuses in real-time
 * - Renders "زملاؤك يذاكرون الآن" panel in the Pomodoro page
 * - Shows browser notifications when a teammate starts studying
 * - Profile toggle to disable broadcasting your own status
 */

const PresenceModule = (() => {
  const PREF_KEY = 'presence_visible'; // localStorage key
  let _unsubscribeFn = null;
  let _membersStatus = {}; // { userId: { mode, type, startedAt, name, emoji } | null }

  // ── Prefs ──
  function isVisible() {
    const raw = localStorage.getItem(PREF_KEY);
    return raw === null ? true : raw === 'true'; // default ON
  }
  function setVisible(v) {
    localStorage.setItem(PREF_KEY, String(v));
    if (!v) _clearPresence(); // wipe status immediately if turned off
  }

  // ── Firebase helpers ──
  function _db() { return window._fbDb; }
  function _sdk() { return window._fbSDK; }
  function _dbLib() { return window.firebase_database; }

  function _ready() {
    return !!(window._fbReady && _db() && _sdk() && _dbLib()?.set && _dbLib()?.ref);
  }

  function _presenceRef(userId) {
    return _sdk().ref(_db(), `presence/${userId}`);
  }

  // ── Write my status ──
  function broadcastFocus(userId, type) {
    if (!_ready() || !isVisible()) return;
    try {
      _dbLib().set(_presenceRef(userId), {
        mode: 'focus',
        type,
        startedAt: Date.now(),
        name: typeof MEMBERS !== 'undefined' ? MEMBERS[userId]?.name : '',
        emoji: typeof MEMBERS !== 'undefined' ? MEMBERS[userId]?.emoji : '',
      });
    } catch (e) { console.warn('[Presence] write error', e); }
  }

  function _clearPresence(userId) {
    if (!_ready()) return;
    const uid = userId ?? (typeof store !== 'undefined' ? store.get().currentUser : null);
    if (uid === null || uid === undefined) return;
    try {
      _dbLib().set(_presenceRef(uid), null);
    } catch (e) {}
  }

  // ── Listen to all members' statuses ──
  function startListening() {
    if (!_ready()) {
      window.addEventListener('firebase-ready', startListening, { once: true });
      return;
    }
    if (_unsubscribeFn) { _unsubscribeFn(); }

    const rootRef = _sdk().ref(_db(), 'presence');
    _unsubscribeFn = _dbLib().onValue(rootRef, (snap) => {
      const data = snap.val() || {};
      const oldStatus = _membersStatus;
      _membersStatus = data;
      
      // Check for new focusers and send notifications
      const myId = typeof store !== 'undefined' ? store.get().currentUser : null;
      for (const uid in data) {
        if (data[uid] && data[uid].mode === 'focus') {
          // If this person just started focusing (didn't exist or wasn't focusing before)
          if (!oldStatus[uid] || oldStatus[uid].mode !== 'focus') {
            if (parseInt(uid) !== myId && data[uid].startedAt > Date.now() - 60000) { // Only if started within the last minute
               _notifyTeammateStarted(data[uid].name || 'زميل', data[uid].emoji || '👤');
            }
          }
        }
      }

      _refreshPresenceUI();
    });
  }

  function _notifyTeammateStarted(name, emoji) {
    if ('Notification' in window && Notification.permission === 'granted') {
      const messages = [
        `دخل كابينة السباق الآن! 🏎️`,
        `داس بنزين وبدأ جلسة تركيز! 🚀`,
        `شغل وضع الطيران وبدأ يذاكر! ✈️`,
        `بقى أونلاين وبدأ يفرم في المنهج! 🔥`,
        `فتح العداد ومستنيك تحصله! ⏱️`
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];
      new Notification(`🔥 الخلاصة في المصاصة`, { 
        body: `${emoji} زميلك ${name} ${msg}`,
        icon: 'https://cdn-icons-png.flaticon.com/512/3141/3141416.png'
      });
    }
  }

  function stopListening() {
    if (_unsubscribeFn) { _unsubscribeFn(); _unsubscribeFn = null; }
  }

  // ── Get active focusers (excluding self) ──
  function getActiveFocusers() {
    const myId = typeof store !== 'undefined' ? store.get().currentUser : null;
    const now = Date.now();
    return Object.entries(_membersStatus)
      .filter(([uid, st]) => {
        if (!st || st.mode !== 'focus') return false;
        if (parseInt(uid) === myId) return false; // exclude self
        if (st.startedAt && now - st.startedAt > 3 * 60 * 60 * 1000) return false; // stale > 3h
        return true;
      })
      .map(([uid, st]) => ({
        userId: parseInt(uid),
        ...st,
        elapsed: st.startedAt ? Math.floor((now - st.startedAt) / 60000) : 0,
        memberName: (typeof MEMBERS !== 'undefined' && MEMBERS[parseInt(uid)])
          ? MEMBERS[parseInt(uid)].name : st.name || 'زميل',
        memberEmoji: (typeof MEMBERS !== 'undefined' && MEMBERS[parseInt(uid)])
          ? MEMBERS[parseInt(uid)].emoji : st.emoji || '👤',
        memberColor: (typeof MEMBERS !== 'undefined' && MEMBERS[parseInt(uid)])
          ? MEMBERS[parseInt(uid)].color : '#00E5FF',
      }));
  }

  // ── Refresh presence panel in Pomodoro page (non-destructive) ──
  function _refreshPresenceUI() {
    const el = document.getElementById('pomoPresencePanel');
    if (!el) return;
    renderPresencePanel(el);
  }

  function renderPresencePanel(container) {
    const focusers = getActiveFocusers();
    if (!container) return;

    if (!focusers.length) {
      container.innerHTML = `
        <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px 14px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin-bottom:16px;display:flex;align-items:center;gap:8px">
          <span style="font-size:13px">💤</span>
          <span style="font-size:10px;color:var(--ink-muted);font-weight:600">لا يوجد أحد يذاكر الآن</span>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div style="background:var(--surface-1);border:1px solid rgba(0,229,255,0.25);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin-bottom:16px;box-shadow:0 0 12px rgba(0,229,255,0.06)">
        <div style="font-size:10px;font-weight:800;color:var(--accent-blue);text-transform:uppercase;letter-spacing:1.5px;margin-bottom:10px">
          🟢 زملاؤك يذاكرون الآن
        </div>
        <div style="display:flex;flex-direction:column;gap:7px">
          ${focusers.map(f => `
            <div style="display:flex;align-items:center;gap:10px;padding:6px 10px;background:rgba(0,229,255,0.04);border:1px solid rgba(0,229,255,0.08);clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)">
              <span style="font-size:20px;position:relative">
                ${f.memberEmoji}
                <span style="position:absolute;bottom:-1px;right:-3px;width:8px;height:8px;background:#00ff88;border-radius:50%;border:1px solid var(--canvas);animation:pulse-dot 1.5s infinite"></span>
              </span>
              <div style="flex:1">
                <div style="font-size:12px;font-weight:800;color:var(--ink)">${f.memberName}</div>
                <div style="font-size:9px;color:var(--ink-muted)">🍅 جلسة تركيز • منذ ${f.elapsed} دقيقة</div>
              </div>
              <div style="font-size:9px;font-weight:700;color:var(--semantic-success);padding:2px 7px;background:rgba(0,255,136,0.08);border:1px solid rgba(0,255,136,0.2)">LIVE</div>
            </div>
          `).join('')}
        </div>
      </div>`;
  }

  // ── Public API ──
  return {
    isVisible,
    setVisible,
    broadcastFocus,
    clearPresence: _clearPresence,
    startListening,
    stopListening,
    getActiveFocusers,
    renderPresencePanel,
  };
})();

// ── CSS for pulse dot ──
(function injectPresenceCSS() {
  if (document.getElementById('presenceCSS')) return;
  const s = document.createElement('style');
  s.id = 'presenceCSS';
  s.textContent = `
    @keyframes pulse-dot {
      0%,100% { transform: scale(1); opacity: 1; }
      50%      { transform: scale(1.4); opacity: 0.6; }
    }
  `;
  document.head.appendChild(s);
})();

// ── Hook into Pomodoro lifecycle ──
// Wait for both PomodoroModule and Firebase to be ready
(function hookPresenceToPomodoro() {
  function _hook() {
    if (typeof PomodoroModule === 'undefined') {
      setTimeout(_hook, 300);
      return;
    }

    // Intercept start: broadcast presence
    const _origStart = PomodoroModule.start.bind(PomodoroModule);
    PomodoroModule.start = function(type = 'pomodoro') {
      _origStart(type);
      if (type === 'pomodoro') {
        const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
        if (uid !== null) PresenceModule.broadcastFocus(uid, type);
      }
    };

    // Intercept stop/pause: clear presence
    const _origStop = PomodoroModule.stop.bind(PomodoroModule);
    PomodoroModule.stop = function(save = true) {
      _origStop(save);
      const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
      if (uid !== null) PresenceModule.clearPresence(uid);
    };

    // Also clear on pause (show as not focusing)
    const _origPause = PomodoroModule.pause.bind(PomodoroModule);
    PomodoroModule.pause = function() {
      _origPause();
      const st = PomodoroModule.getState();
      const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
      if (uid !== null) {
        if (!st.running) PresenceModule.clearPresence(uid); // just paused
        else PresenceModule.broadcastFocus(uid, st.type);   // resumed
      }
    };
  }

  _hook();
})();

// ── Start listening when Firebase is ready ──
if (window._fbReady) {
  PresenceModule.startListening();
} else {
  window.addEventListener('firebase-ready', () => PresenceModule.startListening(), { once: true });
}

// ── Clear presence on logout/tab close ──
window.addEventListener('beforeunload', () => {
  const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
  if (uid !== null) PresenceModule.clearPresence(uid);
});
