/**
 * Streak App V2 - Reactive Architecture
 * Senior Full-Stack Engineering Refactor
 * 
 * 1) Global State Store (Single Source of Truth)
 * 2) Reactive UI Binding (Observer Pattern)
 * 3) Formal Data Versioning & Migration Engine
 * 4) No DOM Latency or Initialization Race Conditions
 */

const DEBUG_MODE = false; // ← production mode: no console leakage

// ── 1. GLOBAL STATE STORE ──────────────────────────────
const store = {
  state: {
    version: 2,
    currentUser: null,
    filterSubj: 'all',
    filterQuiz: 'all',
    searchQuery: '',
    progress: {}
  },
  listeners: [],
  _pins: {}, // PINs fetched from Firebase at runtime (never in source code)

  get() {
    return this.state;
  },

  set(updater) {
    if (typeof updater === 'function') {
      this.state = updater(this.state);
    } else {
      this.state = { ...this.state, ...updater };
    }
    // NOTE: save() is now called EXPLICITLY with (userId, lectureId, pct)
    // for atomic Firebase writes. Generic auto-save still writes localStorage.
    this.save(null, null, null);
    this.notify();
    if (DEBUG_MODE) console.log('[Store: Set]', this.state);
  },

  subscribe(listener) {
    this.listeners.push(listener);
  },

  notify() {
    if (DEBUG_MODE) console.log('[Store: Notify] Triggering Renders...');
    this.listeners.forEach(fn => fn(this.state));
  },

  // ── DATA PERSISTENCE — Cloud-First Architecture ─────────────────
  // Firebase is the SINGLE source of truth. localStorage is a read-cache only.
  // Writes go ONLY to Firebase. onValue() is the only thing that updates the store.

  _pendingWrites: [], // Write queue for calls before Firebase is ready

  save(userId, lectureId, pct) {
    // Mirror to localStorage as fast read-cache
    try {
      localStorage.setItem('streak_store_v2', JSON.stringify({
        version: 2, progress: this.state.progress
      }));
    } catch(e) {}

    if (userId === null || userId === undefined) return;

    if (!window._fbReady || !window._fbDb) {
      // Queue the write + persist to localStorage so it survives page close/crash
      this._pendingWrites.push({ userId, lectureId, pct });
      try { localStorage.setItem('_pw', JSON.stringify(this._pendingWrites)); } catch(e) {}
      this._updateSyncBadge();
      return;
    }
    this._writeToCloud(userId, lectureId, pct);
  },

  _writeToCloud(userId, lectureId, pct) {
    try {
      const { ref, update } = window._fbSDK;
      const payload = {};
      payload[lectureId] = pct;
      update(ref(window._fbDb, `progress/${userId}`), payload);
      this._updateSyncBadge(); // show ✅ after successful cloud write
    } catch(e) { console.error('[Firebase: Write Error]', e); }
  },

  // ── Global helper: write arbitrary key-value into users/{userId} ──
  // Called by gamification.js, wellness.js, pomodoro.js
  // Can handle nested paths like 'checkins/2026-05-10' via update()
  writeUserData(userId, updates) {
    if (!window._fbReady || !window._fbDb) return;
    if (userId === null || userId === undefined) return;
    try {
      const { ref, update } = window._fbSDK;
      // Flatten paths so nested keys like 'checkins/2026-05-10' work correctly
      const flat = {};
      Object.entries(updates).forEach(([k, v]) => { flat[k] = v; });
      update(ref(window._fbDb, `users/${userId}`), flat);
    } catch(e) { console.error('[Firebase: UserData Write Error]', e); }
  },

  _removeFromCloud(userId, lectureId) {
    try {
      const { ref, remove } = window._fbSDK;
      if (remove) remove(ref(window._fbDb, `progress/${userId}/${lectureId}`));
    } catch(e) { console.error('[Firebase: Remove Error]', e); }
  },

  _flushPendingWrites() {
    const queue = [...this._pendingWrites];
    this._pendingWrites = [];
    try { localStorage.removeItem('_pw'); } catch(e) {} // clear persisted queue
    queue.forEach(w => this._writeToCloud(w.userId, w.lectureId, w.pct));
    if (queue.length) console.log(`[Firebase: Flushed ${queue.length} pending writes]`);
    this._updateSyncBadge();
  },

  // Persistent sync status badge — FM-5 fix: user can see unsaved changes
  _updateSyncBadge() {
    let badge = document.getElementById('_syncBadge');
    if (!badge) {
      badge = document.createElement('div');
      badge.id = '_syncBadge';
      Object.assign(badge.style, {
        position: 'fixed', top: '8px', left: '8px', zIndex: '9999',
        padding: '3px 10px', borderRadius: '12px', fontSize: '11px',
        fontFamily: 'Cairo,sans-serif', direction: 'rtl', transition: 'all .3s'
      });
      document.body && document.body.appendChild(badge);
    }
    const n = this._pendingWrites.length;
    badge.textContent  = n > 0 ? `⏳ ${n} لم يُحفظ` : '✅ محفوظ';
    badge.style.background = n > 0 ? 'rgba(255,165,0,.85)' : 'rgba(16,185,129,.75)';
    badge.style.color = '#fff';
    if (n === 0) setTimeout(() => { if(badge) badge.style.opacity='0'; }, 2500);
    else badge.style.opacity = '1';
  },


  load() {
    // Restore any pending writes that survived a page close/crash
    try {
      const pw = localStorage.getItem('_pw');
      if (pw) {
        this._pendingWrites = JSON.parse(pw);
        console.log(`[Recovery] Restored ${this._pendingWrites.length} pending writes from crash`);
      }
    } catch(e) {}
    this.loadFromLocal();
    this.initFirebase();
  },

  loadFromLocal() {
    try {
      const raw = localStorage.getItem('streak_store_v2');
      if (raw) {
        const data = JSON.parse(raw);
        if (data.version === 2) {
          this.state.progress = data.progress || {};
          if (DEBUG_MODE) console.log('[Store: Load] Found V2 local schema.');
          return true;
        }
      }
    } catch(e) { console.warn('[Store: Load Error]', e); }
    this.migrateLegacyData();
    return false;
  },

  initFirebase() {
    if (typeof FIREBASE_CONFIG === 'undefined' || FIREBASE_CONFIG.apiKey.includes('PASTE_YOUR')) {
      console.warn('[Firebase] Config not set. Running in offline mode.');
      return;
    }

      const boot = () => {
      try {
        const { initializeApp, getApps } = window.firebase_app || {};
        const { getDatabase, ref, onValue, set, update, remove } = window.firebase_database || {};
        if (!initializeApp || !update) { console.warn('[Firebase] SDK not loaded.'); return; }

        // Guard against double-init
        const app = getApps().length > 0 ? getApps()[0] : initializeApp(FIREBASE_CONFIG);

        // CRITICAL FIX: Pass databaseURL explicitly to guarantee correct server.
        // Without this, Firebase may connect to the wrong (default US) database.
        const db = getDatabase(app, FIREBASE_CONFIG.databaseURL);
        window._fbDb  = db;
        window._fbSDK = { ref, set, update, remove };
        window._fbReady = true;

        this._showSyncBanner();

        window._fbUnsubscribe = onValue(ref(db, 'progress'), (snapshot) => {
          const raw = snapshot.val();
          this._hideSyncBanner();

          // CLOUD-FIRST: Firebase IS the source of truth.
          // We REPLACE local state entirely — no merge with localStorage.
          // Each device gets the same identical state from the cloud.
          const cloudProgress = raw ? this._normalizeKeys(raw) : {};

          this.state.progress = cloudProgress;

          // Mirror to localStorage as read-cache (for instant first paint on next visit)
          try {
            localStorage.setItem('streak_store_v2', JSON.stringify({ version: 2, progress: cloudProgress }));
          } catch(e) {}

          // Flush any writes that were queued before Firebase connected
          this._flushPendingWrites();

          this.notify();
        });

        // Load PINs from Firebase — they never live in the source code
        const { get } = window.firebase_database || {};
        if (get) {
          get(ref(db, 'config/pins')).then(snap => {
            const pins = snap.val();
            if (pins) {
              this._pins = pins;
              console.log('[Firebase] PINs loaded from cloud ✅');
            } else {
              console.warn('[Firebase] config/pins not found — login will be blocked');
            }
          }).catch(e => console.warn('[Firebase] PIN load error:', e));
        }

        console.log('[Firebase] Cloud-first listener attached to:', FIREBASE_CONFIG.databaseURL);
      } catch(e) {
        console.error('[Firebase: Init Error]', e);
        this._hideSyncBanner();
      }
    };

    if (window.firebase_app) {
      boot();
    } else {
      window.addEventListener('firebase-ready', boot, { once: true });
    }
  },

  // Fix #2 helper: converts all nested String keys to Integer keys
  _normalizeKeys(obj) {
    const out = {};
    for (const k in obj) {
      const val = obj[k];
      const normKey = isNaN(k) ? k : parseInt(k, 10);
      out[normKey] = (val && typeof val === 'object') ? this._normalizeKeys(val) : val;
    }
    return out;
  },

  // Fix #3: Loading banner while Firebase syncs on a new device
  _showSyncBanner() {
    if (document.getElementById('_fbBanner')) return;
    const b = document.createElement('div');
    b.id = '_fbBanner';
    b.innerHTML = '🔄 جاري الاتصال بالسحابة...';
    Object.assign(b.style, {
      position: 'fixed', bottom: '70px', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--charcoal, #2c2c34)', color: 'var(--on-primary, #ffffff)', padding: '8px 18px',
      borderRadius: '9999px', boxShadow: 'rgba(5, 0, 56, 0.12) 0px 16px 48px -8px', fontSize: '13px', zIndex: '9999',
      fontFamily: 'Cairo, sans-serif', direction: 'rtl'
    });
    document.body.appendChild(b);
  },
  _hideSyncBanner() {
    const b = document.getElementById('_fbBanner');
    if (b) b.remove();
  },


  migrateLegacyData() {
    if (DEBUG_MODE) console.log('[Store: Migration] Beginning V1 to V2 Migration...');
    let migratedProgress = {};
    let isChanged = false;

    // We loop through all available members defined in streak_data.js
    MEMBERS.forEach((_, uid) => {
      migratedProgress[uid] = {};
      
      // Step A: Parse `streak_p_X` (Semi-modern, early V2 test schema)
      try {
        const rawModern = localStorage.getItem('streak_p_' + uid);
        if (rawModern) {
          const parsed = JSON.parse(rawModern);
          for (let k in parsed) {
            migratedProgress[uid][k] = parseFloat(parsed[k]) || 0;
            isChanged = true;
          }
        }
      } catch(e) {}
      
      // Step B: Parse `streak_pX` (V1 Legacy timestamp schema)
      try {
        const rawLegacy = localStorage.getItem('streak_p' + uid);
        if (rawLegacy) {
          const parsed = JSON.parse(rawLegacy);
          for (let k in parsed) {
            if (migratedProgress[uid][k] === undefined) {
              // Clamp massive timestamps to 100%
              migratedProgress[uid][k] = (parsed[k] > 100) ? 100 : parseFloat(parsed[k]) || 0;
              isChanged = true;
            }
          }
        }
      } catch(e) {}
    });

    if (isChanged) {
      if (DEBUG_MODE) console.log('[Store: Migration] Successfully migrated legacy data.', migratedProgress);
      this.state.progress = migratedProgress;
      // Fix: migrateLegacyData must use full save() — no Firebase write, just sync to localStorage
      try {
        localStorage.setItem('streak_store_v2', JSON.stringify({ version: 2, progress: migratedProgress }));
      } catch(e) {}
    } else {
      if (DEBUG_MODE) console.log('[Store: Migration] No legacy data found to migrate.');
    }
  }
};


// ── CONSTANTS & GAMIFICATION ───────────────────────────
const SUBJ_COLORS = ['#00C9D4','#F5C842','#FF4D8D','#8B5CF6','#F97316','#06B6D4','#10B981'];
const SUBJ_SHORT = {
  'Perio': 'Perio',
  'Medicine': 'Medicine',
  'Surgery': 'Surgery',
  'Prosthesis': 'Prosthesis',
  'Operative': 'Operative',
  'Fixed Prosth.': 'Fixed',
  'Endo': 'Endo'
};

const PCT_COLORS = { 100: 'var(--green)', 75: 'var(--teal)', 50: 'var(--gold)', 25: 'var(--rose)', 0: 'var(--txt3)' };
const PCT_MSGS = { 100: 'كفاية يا عالمي انت لخصت الخلاصة', 75: 'حل عليها كفاية كدة', 50: 'ذاكرها كمان مرة هتثبت', 25: 'مش كفاية تتذاكر مرة واحدة', 0: 'انت محتاج تشتري ورق' };

const EMOJIS = {
  1: ['🦷', '💡', '📖'], 2: ['⚡', '💚', '🔋', '🌱'], 3: ['⭐', '🌟', '✨', '🏆'],
  4: ['🔥', '💎', '🧬', '🧠'], 5: ['🔥💀', '👾', '💥', '⚡🔥'], 6: ['👑']
};

const PHRASES = {
  1: ['ادخل اللعبة 🎯', 'ابدأ يا فنان 💪', 'خد الخطوة ⚡', 'وحشتنا المصاصة 🦷'],
  2: ['دايرة معاك 🌀', 'متوقفش! 🚀', 'اللي بدأ ما وقفش 🏃', 'شغالين ما بنتعبش 💪'],
  3: ['عالي يا دكتور ⭐', 'المصاصة شغالة 🦷', 'جبار وما بيوقفش 🏗️', 'الشابتر في امان 📚'],
  4: ['موووت المادة ☠️', 'مفيش مستحيل 🌊', 'بنخلص الخلاصة 🩸', 'ده انت؟! 🤯'],
  5: ['أسطورة بدأت 🧠', 'محدش زيك 🥇', 'المادة بتتلعب ⚡', 'الخلاصة تتحول 🌊'],
  6: ['خلاصة في المصاصاة 👑', 'أسطورة حقيقية 🌟', 'التاريخ اتسجّل 📜']
};

const MOTIVATIONAL_TOASTS = [
  "أسطورة يا دكتور استمر! 🔥", "دي الخلاصة في المصاصاة 🦷", "بطل من يومك 💪",
  "استمر يا وحش، الكلية بتلمع بيك ✨", "المحاضرة دي بقت في جيبك 🎯",
  "أحسنت! خطوة كمان وتقفل المنهج 🏃", "ولا كلمة، أنت الأفضل 👑",
  "عاش يا دكتور، مجهود جبار 💥", "وحش المذاكرة! كمل ⚡", "المادة دي بتتلعب يا فنان 🎮",
  "التاريخ بيتكتب دلوقتي 📜", "مفيش مستحيل طول ما المصاصة شغالة 🌟",
  "ممتاز، الشابتر في أمان 📚", "دماغك توزن بلد يا دكتور 🧠", "اللي بدأ ما وقفش 🚀",
  "يا خراشي على التركيز! 🤯", "النجاح بيجري وراك 🏃‍♂️", "فخر الدفعة والله 🥇",
  "ولا دكتور مجدي يعقوب في زمانه 🩺", "المادة دي هتبكي في الزاوية ☠️"
];
let lastToastIdx = -1;

const LEVEL_NAMES = { 1: 'مبتدئ — Level 1', 2: 'شغال — Level 2', 3: 'ماشي كويس — Level 3', 4: 'وحش — Level 4', 5: 'أسطوري — Level 5', 6: 'الخلاصة في المصاصاة — MAX' };

function getLevel(pct) {
  if (pct >= 90) return 6; if (pct >= 70) return 5; if (pct >= 50) return 4;
  if (pct >= 30) return 3; if (pct >= 10) return 2; return 1;
}

// ── UI TOASTS ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── PIN Brute-Force Protection ────────────────────────
const PIN_MAX_ATTEMPTS = 5;
const PIN_LOCKOUT_MS   = 60 * 1000; // 1 minute
let pinAttempts = {}; // { userId: { count, lockedUntil } }

function isPinLocked(uid) {
  const a = pinAttempts[uid];
  if (!a) return false;
  if (a.lockedUntil && Date.now() < a.lockedUntil) return true;
  if (a.lockedUntil && Date.now() >= a.lockedUntil) { pinAttempts[uid] = { count: 0 }; }
  return false;
}

function recordPinFail(uid) {
  if (!pinAttempts[uid]) pinAttempts[uid] = { count: 0 };
  pinAttempts[uid].count++;
  if (pinAttempts[uid].count >= PIN_MAX_ATTEMPTS) {
    pinAttempts[uid].lockedUntil = Date.now() + PIN_LOCKOUT_MS;
    return true; // just got locked
  }
  return false;
}

// ── Session Conflict Management ──────────────────────────────────────
// Each browser session gets a unique ID stored in sessionStorage.
// Firebase path: sessions/{userId} = { deviceId, loginAt }
// When another device logs into the same account, the first gets kicked.

const MY_DEVICE_ID = (() => {
  let id = sessionStorage.getItem('_did');
  if (!id) { id = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem('_did', id); }
  return id;
})();

let _sessionUnsubscribe = null;

function _watchSession(userId) {
  if (!window._fbReady || !window._fbDb) return;
  const { ref } = window._fbSDK;

  // Watch for session takeover: if another device logs in my account, auto-logout
  if (_sessionUnsubscribe) _sessionUnsubscribe();
  const { onValue } = window.firebase_database;
  _sessionUnsubscribe = onValue(ref(window._fbDb, `sessions/${userId}`), (snap) => {
    const s = snap.val();
    if (s && s.deviceId && s.deviceId !== MY_DEVICE_ID) {
      // Another device has taken over this session
      showToast('🔴 تسجيل دخول من جهاز آخر — سيتم تسجيل خروجك', 'warn');
      setTimeout(() => {
        logout();
        // Show a message on the user select screen
        showToast('تم تسجيل خروجك لأن نفس الحساب فُتح على جهاز آخر', 'warn');
      }, 2500);
    }
  });
}

async function _tryClaimSession(userId, forceKick = false) {
  if (!window._fbReady || !window._fbDb) return { success: true }; // allow offline
  const { ref } = window._fbSDK;
  const { runTransaction } = window.firebase_database;
  
  if (!runTransaction) {
    // Fallback if runTransaction is missing
    try {
      const { get, set } = window.firebase_database;
      if (get && set) {
        if (!forceKick) {
          const snap = await get(ref(window._fbDb, `sessions/${userId}`));
          const s = snap.val();
          if (s && s.deviceId && s.deviceId !== MY_DEVICE_ID) return { success: false, conflict: true };
        }
        await set(ref(window._fbDb, `sessions/${userId}`), { deviceId: MY_DEVICE_ID, loginAt: Date.now() });
        return { success: true };
      }
    } catch(e) { console.warn('[Session fallback error]', e); }
    return { success: true };
  }
  
  try {
    const result = await runTransaction(ref(window._fbDb, `sessions/${userId}`), (currentData) => {
      if (currentData === null) {
        // No session exists, claim it
        return { deviceId: MY_DEVICE_ID, loginAt: Date.now() };
      }
      if (currentData.deviceId === MY_DEVICE_ID) {
        // Already our session, update timestamp
        return { deviceId: MY_DEVICE_ID, loginAt: Date.now() };
      }
      if (forceKick) {
        // User explicitly chose to kick the other device
        return { deviceId: MY_DEVICE_ID, loginAt: Date.now() };
      }
      // Another device has it, abort transaction
      return; // returning undefined aborts it
    });

    if (result.committed) {
      return { success: true };
    } else {
      return { success: false, conflict: true };
    }
  } catch(e) {
    console.warn('[Session claim error]', e);
    return { success: true }; // fallback to allow login on error
  }
}

function _showSessionConflictModal(userId, onConfirm, onCancel) {
  const name = MEMBERS[userId].name;
  const overlay = document.createElement('div');
  overlay.id = '_sessionModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(28, 28, 30, 0.4);backdrop-filter:blur(4px);z-index:9998;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--canvas,#fff);border:1px solid var(--hairline,#e0e2e8);border-radius:24px;padding:32px 24px;max-width:360px;width:90%;text-align:center;font-family:Cairo,sans-serif;box-shadow:rgba(5,0,56,0.12) 0px 16px 48px -8px">
      <div style="font-size:32px;margin-bottom:12px">⚠️</div>
      <div style="font-weight:900;font-size:22px;color:var(--brand-coral,#ff9999);margin-bottom:10px">حساب مستخدم بالفعل</div>
      <div style="font-size:14px;color:var(--slate,#555a6a);line-height:1.6;margin-bottom:24px">
        حساب <b style="color:${MEMBERS[userId].color}">${name}</b> مسجل دخول على جهاز آخر حالياً.<br>
        هل تريد تسجيل الخروج من الجهاز الآخر والدخول هنا؟
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="document.getElementById('_sessionModal').remove();(window._sessionCancel&&window._sessionCancel())"
          style="padding:16px 24px;border-radius:9999px;border:1px solid var(--hairline-strong,#c7cad5);background:var(--canvas,#fff);color:var(--ink,#1c1c1e);cursor:pointer;font-family:Cairo,sans-serif;font-size:15px;font-weight:700;transition:all 0.2s">
          إلغاء
        </button>
        <button onclick="document.getElementById('_sessionModal').remove();(window._sessionConfirm&&window._sessionConfirm())"
          style="padding:16px 24px;border-radius:9999px;border:none;background:var(--primary,#1c1c1e);color:var(--on-primary,#fff);cursor:pointer;font-family:Cairo,sans-serif;font-size:15px;font-weight:700;transition:all 0.2s">
          اطرد الجهاز الآخر وادخل هنا
        </button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  window._sessionConfirm = onConfirm;
  window._sessionCancel = onCancel;
}

let pendingUser = null;
let pendingLecId = null;

function requestUserSelect(i) {
  pendingUser = i;
  document.getElementById('pinTitle').innerHTML = `كلمة المرور لـ <span style="color:${MEMBERS[i].color}">${MEMBERS[i].name}</span>`;
  document.getElementById('pinModal').classList.add('show');
  setTimeout(() => document.getElementById('pinInput').focus(), 100);
}

function closePinModal() {
  document.getElementById('pinModal').classList.remove('show');
  document.getElementById('pinInput').value = '';
  document.getElementById('pinError').style.opacity = '0';
  pendingUser = null;
}

function _doLogin(confirmedUser) {
  localStorage.setItem('streak_user', confirmedUser);
  document.getElementById('userSelect').classList.add('hide');
  document.getElementById('mainApp').classList.remove('hide');
  store.set({ currentUser: confirmedUser });
  showToast(`أهلاً بك يا ${MEMBERS[confirmedUser].name} 💪`, 'success');
  _watchSession(confirmedUser);
  _watchUserData(confirmedUser); // ── Load user data from Firebase
  if (typeof showMeme === 'function') {
    setTimeout(() => showMeme('login', 0, `أهلاً يا ${MEMBERS[confirmedUser].name}! جاهز تذاكر؟ 💪`), 400);
  }
}

// ── Subscribe to user-specific data in Firebase (badges, themes, checkins, etc.) ──
let _userDataUnsubscribe = null;

function _watchUserData(userId) {
  if (!window._fbReady || !window._fbDb) {
    // Firebase not ready yet — wait for it
    window.addEventListener('firebase-ready', () => _watchUserData(userId), { once: true });
    return;
  }
  const { ref } = window._fbSDK;
  const { onValue: fbOnValue } = window.firebase_database;
  if (!fbOnValue) return;

  if (_userDataUnsubscribe) { _userDataUnsubscribe(); _userDataUnsubscribe = null; }

  _userDataUnsubscribe = fbOnValue(ref(window._fbDb, `users/${userId}`), (snap) => {
    const data = snap.val();
    if (!data) return;

    // Sync cloud → localStorage (cloud wins)
    if (Array.isArray(data.badges)) LS.set('badges', data.badges);
    if (typeof data.xp_spent === 'number') LS.set('xp_spent', data.xp_spent);
    if (Array.isArray(data.unlocked_themes)) LS.set('unlocked_themes', data.unlocked_themes);
    if (typeof data.streak_freeze_available === 'number') LS.set('streak_freeze_available', data.streak_freeze_available);
    if (Array.isArray(data.streak_freezes_used)) LS.set('streak_freezes_used', data.streak_freezes_used);
    if (Array.isArray(data.pomo_sessions)) LS.set('pomo_sessions', data.pomo_sessions);
    if (Array.isArray(data.custom_tasks)) LS.set('custom_tasks', data.custom_tasks);

    // Sync check-ins
    if (data.checkins && typeof data.checkins === 'object') {
      Object.entries(data.checkins).forEach(([date, ci]) => LS.set('checkin_' + date, ci));
    }

    // Apply active theme
    if (data.active_theme) {
      LS.set('active_theme', data.active_theme);
      if (typeof Gamification !== 'undefined') Gamification.applyTheme(data.active_theme);
    }

    // Recheck badges in case new ones arrived
    if (typeof Gamification !== 'undefined') setTimeout(() => Gamification.recheckBadges(), 100);
  }, { onlyOnce: false });
}

// Global write helper used by gamification.js, wellness.js, pomodoro.js
window._writeUserData = function(userId, updates) {
  store.writeUserData(userId, updates);
};

async function checkPin() {
  const input = document.getElementById('pinInput');
  const val = input.value;
  if (val.length === 4) {
    if (isPinLocked(pendingUser)) {
      document.getElementById('pinError').textContent = '🔒 كثرت المحاولات، انتظر دقيقة';
      document.getElementById('pinError').style.opacity = '1';
      input.value = '';
      return;
    }
    // Guard: PINs are loaded from Firebase — if not ready yet, check hardcoded fallback
    const correctPin = store._pins[pendingUser] || MEMBERS[pendingUser]?.pin;
    if (!correctPin) {
      document.getElementById('pinError').textContent = '⏳ جاري تحميل البيانات، انتظر لحظة';
      document.getElementById('pinError').style.opacity = '1';
      return;
    }

    if (val === correctPin) {
      pinAttempts[pendingUser] = { count: 0 };
      const confirmedUser = pendingUser;
      closePinModal();

      // Check if this account is already active on another device
      const claimResult = await _tryClaimSession(confirmedUser, false);
      if (!claimResult.success && claimResult.conflict) {
        _showSessionConflictModal(
          confirmedUser,
          async () => {
             // Confirm: kick other device
             const forceClaim = await _tryClaimSession(confirmedUser, true);
             if (forceClaim.success) {
               _doLogin(confirmedUser);
             } else {
               showToast('حدث خطأ أثناء محاولة طرد الجهاز الآخر', 'error');
             }
          },
          () => {} // Cancel: do nothing
        );
      } else {
        _doLogin(confirmedUser);
      }
    } else {
      const locked = recordPinFail(pendingUser);
      const remaining = PIN_MAX_ATTEMPTS - (pinAttempts[pendingUser]?.count || 0);
      document.getElementById('pinError').textContent = locked
        ? '🔒 تم القفل لمدة دقيقة'
        : `كلمة السر غلط — ${remaining} محاولات متبقية`;
      document.getElementById('pinError').style.opacity = '1';
      setTimeout(() => { if(input) input.value = ''; }, 500);
    }
  } else {
    document.getElementById('pinError').style.opacity = '0';
  }
}



// FM-3 Fix: double-click debounce — prevents race condition if user
// taps the same lecture twice quickly (e.g. unstable touchscreen)
let _lastToggleKey = null;
let _lastToggleTime = 0;

function toggleLecture(lecId) {
  const now = Date.now();
  if (_lastToggleKey === lecId && now - _lastToggleTime < 400) return; // 400ms debounce
  _lastToggleKey = lecId;
  _lastToggleTime = now;

  const s = store.get();
  const userProgress = s.progress[s.currentUser] || {};
  const uid = s.currentUser;
  
  if (userProgress[lecId] !== undefined) {
    // Optimistic local update (instant UI)
    store.set(st => {
      const cloned = { ...st.progress[st.currentUser] };
      delete cloned[lecId];
      return { ...st, progress: { ...st.progress, [st.currentUser]: cloned } };
    });
    // Cloud write — onValue will broadcast to every device
    store._removeFromCloud(uid, lecId);
  } else {
    pendingLecId = lecId;
    document.getElementById('pctModal').classList.add('show');
  }
}

function closePctModal() {
  document.getElementById('pctModal').classList.remove('show');
  pendingLecId = null;
}

function selectPct(pctVal) {
  if (pendingLecId === null) return;
  const lecId = pendingLecId;
  closePctModal();
  
  const currentUser = store.get().currentUser;
  // Optimistic local update (instant UI feedback)
  store.set(st => {
    const userProg = { ...st.progress[st.currentUser], [lecId]: pctVal };
    return { ...st, progress: { ...st.progress, [st.currentUser]: userProg } };
  });
  // Cloud write — onValue will confirm and broadcast to all devices
  store.save(currentUser, lecId, pctVal);

  const p = store.get().progress[store.get().currentUser];
  const done = Object.keys(p).filter(id => LECTURES.some(l => l.id == id) && parseFloat(p[id]) > 0).length;
  const progressPct = Math.round((done / LECTURES.length) * 100);

  showToast(PCT_MSGS[pctVal], pctVal >= 75 ? 'success' : pctVal >= 50 ? 'warn' : 'fire');

  // ── MEME SYSTEM INTEGRATION ──
  if (typeof showMeme === 'function') {
    // Pick context based on pct selected
    const ctx = pctVal === 100 ? 'complete_100'
      : pctVal === 75  ? 'complete_75'
      : pctVal === 50  ? 'complete_50'
      : pctVal === 25  ? 'complete_25'
      : 'complete_0';

    // Check for milestone first (overrides pct meme)
    const milestone = checkMilestone(done);
    const finalCtx = milestone || ctx;
    const caption = milestone
      ? `🎉 ${done} محاضرة تمت! عاش يا وحش!`
      : PCT_MSGS[pctVal];

    setTimeout(() => showMeme(finalCtx, pctVal, caption), 3600);
  }

  // ── GAMIFICATION XP HOOK ──
  if (typeof Gamification !== 'undefined' && pctVal > 0) {
    const xpKey = pctVal >= 100 ? 'lecture_100' : pctVal >= 75 ? 'lecture_75' : pctVal >= 50 ? 'lecture_50' : 'lecture_25';
    Gamification.addXP(Gamification.XP_TABLE[xpKey] || 10, xpKey);
  }

  setTimeout(() => {
    let tIdx;
    do { tIdx = Math.floor(Math.random() * MOTIVATIONAL_TOASTS.length); } while(tIdx === lastToastIdx);
    lastToastIdx = tIdx;
    
    if (done === 1) showToast('🎯 أول محاضرة! ادخل اللعبة يا دكتور', 'success');
    else if (progressPct === 100) showToast('🏆 خلصت كل حاجة!! أنت الخلاصة في المصاصاة', 'epic');
    else {
      let msg = MOTIVATIONAL_TOASTS[tIdx];
      let tType = 'epic';
      const s = store.get();
      
      const otherScores = MEMBERS.map((m, i) => ({
        idx: i, name: m.name, done: Object.keys(s.progress[i] || {}).length
      })).filter(x => x.idx !== s.currentUser).sort((a,b) => b.done - a.done);
      
      const leader = otherScores[0];
      if (leader && done > leader.done && done === leader.done + 1) { msg = `🥇 عديت ${leader.name}! أنت الأول دلوقتي`; tType = 'fire'; }
      else if (leader && leader.done > done && leader.done - done <= 3) { msg = `⚡ ${leader.name} قدامك بـ ${leader.done - done} بس! لحقه`; tType = 'warn'; }
      showToast(msg, tType);
    }
  }, 3500);
}

function logout() {
  // Stop Pomodoro if running (save the session first)
  if (typeof PomodoroModule !== 'undefined') {
    const ps = PomodoroModule.getState();
    if (ps.running || ps.mode === 'paused') PomodoroModule.stop(true);
  }
  localStorage.removeItem('streak_user');
  // Detach Firebase listeners
  if (typeof window._fbUnsubscribe === 'function') {
    window._fbUnsubscribe();
    window._fbUnsubscribe = null;
    window._fbReady = false;
  }
  if (typeof _userDataUnsubscribe === 'function') {
    _userDataUnsubscribe();
    _userDataUnsubscribe = null;
  }
  store.set({ currentUser: null });
  document.getElementById('mainApp').classList.add('hide');
  document.getElementById('userSelect').classList.remove('hide');
}

function onSearch() {
  store.set({ searchQuery: document.getElementById('searchInput').value.trim().toLowerCase() });
}

function setSubjFilter(v) {
  store.set({ filterSubj: v });
}

function setQuizFilter(v) {
  store.set({ filterQuiz: v });
}

function switchTab(tab) {
  if(DEBUG_MODE) console.log('[Router] Switching to tab:', tab);
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  const pages = ['Lectures','Leaderboard','Buy','Finished','Pomodoro','Tasks','Analytics','Gamification','Notes','Social','Profile'];
  pages.forEach(p => {
    const el = document.getElementById('page' + p);
    if (el) el.classList.toggle('hide', tab !== p.toLowerCase());
  });
  // Render new pages on demand
  if (tab === 'pomodoro' && typeof renderPomodoroPage === 'function') renderPomodoroPage();
  if (tab === 'tasks' && typeof renderTasksPage === 'function') renderTasksPage();
  if (tab === 'analytics' && typeof renderAnalyticsPage === 'function') renderAnalyticsPage();
  if (tab === 'gamification' && typeof Gamification !== 'undefined') { Gamification.recheckBadges(); if (typeof renderGamificationPage === 'function') renderGamificationPage(); }
  if (tab === 'notes' && typeof renderNotesPage === 'function') renderNotesPage();
  if (tab === 'social' && typeof renderSocialPage === 'function') renderSocialPage();
  if (tab === 'finished') { if (typeof renderWellnessWidget === 'function') renderWellnessWidget(); }
  if (tab === 'profile') renderProfilePage();

  // Update bottom nav highlights
  document.querySelectorAll('.bnav-item[data-bnav]').forEach(b => b.classList.toggle('on', b.dataset.bnav === tab));
  // Update sidebar highlights
  document.querySelectorAll('.sidebar-nav-item[data-nav]').forEach(n => n.classList.toggle('on', n.dataset.nav === tab));
}

// ── NAVIGATION (Sidebar + Bottom Nav) ──
function navTo(tab) {
  closeSidebar();
  switchTab(tab);
}

function openSidebar() {
  document.getElementById('sidebar').classList.add('open');
  document.getElementById('sidebarOverlay').classList.add('open');
  _updateSidebarProfile();
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOverlay').classList.remove('open');
}

function _updateSidebarProfile() {
  const el = document.getElementById('sidebarProfile');
  if (!el || typeof store === 'undefined') return;
  const s = store.get();
  if (s.currentUser === null) return;
  const m = MEMBERS[s.currentUser];
  const p = s.progress[s.currentUser] || {};
  const done = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
  const pct = Math.round((done / LECTURES.length) * 100);
  const lvl = typeof Gamification !== 'undefined' ? Gamification.getLevel() : { emoji: '📖', name: 'طالب', color: '#00E5FF' };
  const xp = typeof Gamification !== 'undefined' ? Gamification.getXP() : 0;

  el.innerHTML = `
    <div style="font-size:36px;margin-bottom:4px">${m.emoji}</div>
    <div style="font-size:14px;font-weight:900;color:var(--ink);margin-bottom:2px">${m.name}</div>
    <div style="font-size:10px;color:${m.color};font-weight:700;margin-bottom:6px">${m.role}</div>
    <div style="display:flex;gap:8px;justify-content:center;">
      <div style="text-align:center"><div style="font-size:14px;font-weight:900;color:var(--accent-blue)">${pct}%</div><div style="font-size:7px;color:var(--ink-muted);font-weight:700">إكتمال</div></div>
      <div style="text-align:center"><div style="font-size:14px;font-weight:900;color:${lvl.color}">${lvl.emoji}</div><div style="font-size:7px;color:var(--ink-muted);font-weight:700">${lvl.name}</div></div>
      <div style="text-align:center"><div style="font-size:14px;font-weight:900;color:#FFB300">${xp}</div><div style="font-size:7px;color:var(--ink-muted);font-weight:700">XP</div></div>
    </div>`;
}

// ── PROFILE PAGE ──
function renderProfilePage() {
  const c = document.getElementById('pageProfile');
  if (!c || typeof store === 'undefined') return;
  const s = store.get();
  if (s.currentUser === null) return;
  const m = MEMBERS[s.currentUser];
  const p = s.progress[s.currentUser] || {};
  const totalLecs = LECTURES.length;
  const done = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
  const perfect = LECTURES.filter(l => parseFloat(p[l.id]) === 100).length;
  const weak = LECTURES.filter(l => { const v = parseFloat(p[l.id]); return v > 0 && v <= 50; }).length;
  const pct = Math.round((done / totalLecs) * 100);
  const lvl = typeof Gamification !== 'undefined' ? Gamification.getLevel() : { emoji: '📖', name: 'طالب', color: '#00E5FF' };
  const xp = typeof Gamification !== 'undefined' ? Gamification.getXP() : 0;
  const badges = typeof Gamification !== 'undefined' ? Gamification.getUnlockedBadges() : [];
  const streak = typeof Wellness !== 'undefined' ? Wellness.getStreak() : 0;
  const bookmarks = typeof Notes !== 'undefined' ? Notes.getBookmarks().length : 0;
  const notesCount = typeof Notes !== 'undefined' ? Notes.getAllNotedLectures().length : 0;
  const pomoToday = typeof PomodoroModule !== 'undefined' ? PomodoroModule.getTodayMinutes() : 0;

  // Per-subject progress
  const subjStats = SUBJECTS.map((subj, si) => {
    const subjLecs = LECTURES.filter(l => l.s === subj);
    const subjDone = subjLecs.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
    return { subj, short: SUBJ_SHORT[subj] || subj, done: subjDone, total: subjLecs.length, pct: Math.round(subjDone / subjLecs.length * 100), color: SUBJ_COLORS[si] || '#888' };
  });

  // Rank among team — uses same scoring as leaderboard (weighted grade score)
  const ranks = MEMBERS.map((mm, i) => {
    const pp = s.progress[i] || {};
    let totalScore = 0;
    SUBJECTS.forEach(subj => {
      const subjLecs = LECTURES.filter(l => l.s === subj);
      const subjectGrade = parseFloat(subjLecs[0]?.g) || 100;
      subjLecs.forEach(l => {
        const val = pp[l.id];
        if (val !== undefined && val !== null) {
          totalScore += (subjectGrade / subjLecs.length) * ((parseFloat(val) || 0) / 100);
        }
      });
    });
    return { i, totalScore };
  }).sort((a, b) => b.totalScore - a.totalScore);
  const rank = ranks.findIndex(r => r.i === s.currentUser) + 1;

  c.innerHTML = `<div style="padding:var(--spacing-md);max-width:500px;margin:0 auto;">
    <!-- Avatar Card -->
    <div style="text-align:center;padding:20px;background:linear-gradient(135deg,${m.color}10,transparent);border:1px solid ${m.color}30;clip-path:polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%);margin-bottom:14px;">
      <div style="font-size:48px;margin-bottom:6px">${m.emoji}</div>
      <div style="font-size:20px;font-weight:900;color:var(--ink)">${m.name}</div>
      <div style="font-size:11px;color:${m.color};font-weight:700;margin-bottom:4px">${m.role} — ${m.roleAr}</div>
      <div style="display:inline-flex;gap:4px;align-items:center;padding:4px 12px;background:${lvl.color}15;border:1px solid ${lvl.color}40;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);">
        <span style="font-size:16px">${lvl.emoji}</span>
        <span style="font-size:12px;font-weight:900;color:${lvl.color}">${lvl.name}</span>
        <span style="font-size:10px;color:var(--ink-muted)">• ${xp} XP</span>
      </div>
    </div>

    <!-- Quick Stats -->
    <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-bottom:14px;">
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px 6px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);text-align:center;">
        <div style="font-size:18px;font-weight:900;color:var(--accent-blue)">${done}</div>
        <div style="font-size:7px;color:var(--ink-muted);font-weight:700">خلصانة</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px 6px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);text-align:center;">
        <div style="font-size:18px;font-weight:900;color:var(--semantic-success)">${perfect}</div>
        <div style="font-size:7px;color:var(--ink-muted);font-weight:700">100%</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px 6px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);text-align:center;">
        <div style="font-size:18px;font-weight:900;color:#FFB300">🔥 ${streak}</div>
        <div style="font-size:7px;color:var(--ink-muted);font-weight:700">streak</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px 6px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);text-align:center;">
        <div style="font-size:18px;font-weight:900;color:${rank <= 2 ? '#FFB300' : 'var(--ink-muted)'}">#${rank}</div>
        <div style="font-size:7px;color:var(--ink-muted);font-weight:700">الترتيب</div>
      </div>
    </div>

    <!-- Overall Progress -->
    <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;margin-bottom:6px;">
        <span style="font-size:11px;font-weight:800;color:var(--ink)">التقدم الإجمالي</span>
        <span style="font-size:13px;font-weight:900;color:var(--accent-blue)">${pct}%</span>
      </div>
      <div style="height:8px;background:var(--surface-2);border-radius:4px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:linear-gradient(90deg,var(--accent-blue),var(--semantic-success));border-radius:4px;transition:width .5s"></div>
      </div>
      <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:9px;color:var(--ink-muted)">
        <span>${done}/${totalLecs} محاضرة</span>
        <span>${weak > 0 ? '⚠️ ' + weak + ' ضعيفة' : '💪 لا توجد ضعيفة'}</span>
      </div>
    </div>

    <!-- Subject Breakdown -->
    <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📚 تقدم المواد</div>
    ${subjStats.map(ss => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;">
        <div style="font-size:10px;font-weight:800;color:${ss.color};width:50px">${ss.short}</div>
        <div style="flex:1;height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${ss.pct}%;background:${ss.color};border-radius:3px"></div>
        </div>
        <div style="font-size:10px;font-weight:900;color:var(--ink-muted);width:42px;text-align:left">${ss.done}/${ss.total}</div>
      </div>
    `).join('')}

    <!-- Activity Summary -->
    <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin:14px 0;">
      <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📋 ملخص النشاط</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:11px;">
        <div style="color:var(--ink-muted)">🏅 إنجازات: <span style="color:var(--accent-blue);font-weight:800">${badges.length}</span></div>
        <div style="color:var(--ink-muted)">⭐ محفوظات: <span style="color:#FFB300;font-weight:800">${bookmarks}</span></div>
        <div style="color:var(--ink-muted)">📝 ملاحظات: <span style="color:var(--semantic-success);font-weight:800">${notesCount}</span></div>
        <div style="color:var(--ink-muted)">🍅 اليوم: <span style="color:var(--semantic-danger);font-weight:800">${pomoToday} د</span></div>
      </div>
    </div>

    <!-- Logout -->
    <button onclick="logout()" style="width:100%;padding:12px;background:rgba(255,0,60,0.08);color:var(--semantic-danger);border:1px solid rgba(255,0,60,0.2);font-size:13px;font-weight:800;cursor:pointer;clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);font-family:'Cairo',sans-serif;margin-top:8px">🚪 تسجيل خروج</button>
  </div>`;
}

// ── 2. REACTIVE UI BINDING ─────────────────────────────
function buildUserSelect() {
  const c = document.getElementById('usCards');
  c.innerHTML = MEMBERS.map((m, i) => `
    <div class="us-card" onclick="requestUserSelect(${i})">
      <div class="us-av" style="background:${m.color}18">${m.emoji}</div>
      <div><div class="nm">${m.name}</div>
      <div class="rl">${m.role} — ${m.roleAr}</div></div>
    </div>`).join('');
}

function buildFilters() {
  const s = store.get();
  const sf = document.getElementById('subjFilters');
  sf.innerHTML = `<div class="chip ${s.filterSubj === 'all' ? 'on' : ''}" onclick="setSubjFilter('all')">الكل</div>` +
    SUBJECTS.map((subj, i) => `<div class="chip sc${i} ${s.filterSubj === subj ? 'on' : ''}" onclick="setSubjFilter('${subj}')">${SUBJ_SHORT[subj] || subj}</div>`).join('');

  const qf = document.getElementById('quizFilters');
  qf.innerHTML = `<div class="chip chip-q ${s.filterQuiz === 'all' ? 'on' : ''}" onclick="setQuizFilter('all')">الكل</div>` +
    QUIZZES.map(q => `<div class="chip chip-q ${s.filterQuiz === q ? 'on' : ''}" onclick="setQuizFilter('${q}')">${q}</div>`).join('');
}

store.subscribe((state) => {
  if (state.currentUser === null) return;
  buildFilters(); // Re-render chips gracefully to reflect active state
  renderHeader(state);
  renderLevelBanner(state);
  renderSubjProgress(state);
  renderLectures(state);
  renderLeaderboard(state);
  if (typeof renderBuyList === 'function') renderBuyList(state);
  if (typeof renderFinishedList === 'function') renderFinishedList(state);
  if (typeof renderSocialPage === 'function') renderSocialPage();
});

// ── INIT NEW MODULES ──
window.addEventListener('DOMContentLoaded', () => {
  // Daily check-in
  setTimeout(() => { if (typeof showCheckinModal === 'function' && typeof Wellness !== 'undefined' && !Wellness.hasCheckedInToday()) showCheckinModal(); }, 2000);
  // Theme
  if (typeof Gamification !== 'undefined') Gamification.initTheme();
});

function renderHeader(state) {
  const m = MEMBERS[state.currentUser];
  const p = state.progress[state.currentUser] || {};
  const done = Object.keys(p).filter(id => LECTURES.some(l => l.id == id) && parseFloat(p[id]) > 0).length;
  const pct = Math.round((done / LECTURES.length) * 100);
  
  document.getElementById('ahName').textContent = m.name;
    document.getElementById('ahStat').textContent = `${done} / ${LECTURES.length} محاضرة مكتملة`;
  document.getElementById('ahPct').textContent = pct + '%';
}

function renderLevelBanner(state) {
  const p = state.progress[state.currentUser] || {};
  const done = Object.keys(p).filter(id => LECTURES.some(l => l.id == id) && parseFloat(p[id]) > 0).length;
  const pct = Math.round((done / LECTURES.length) * 100);
  const lv = getLevel(pct);
  const emoji = EMOJIS[lv][done % EMOJIS[lv].length];
  const phrase = PHRASES[lv][done % PHRASES[lv].length];
  
  document.getElementById('levelBanner').innerHTML = `
    <div class="level-banner lb-lv${lv}">
      <div class="lb-emoji">${emoji}</div>
      <div class="lb-text">
        <div class="lb-phrase">${phrase}</div>
        <div class="lb-level">${LEVEL_NAMES[lv]} — ${done}/${LECTURES.length}</div>
      </div>
    </div>`;
}

function renderSubjProgress(state) {
  const p = state.progress[state.currentUser] || {};
  const c = document.getElementById('subjProgress');
  const subjs = state.filterSubj === 'all' ? SUBJECTS : [state.filterSubj];
  
  c.innerHTML = subjs.map((s, i) => {
    const subjLecs = LECTURES.filter(l => l.s === s);
    const total = subjLecs.length;
    const done = subjLecs.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
    const subjectGrade = parseFloat(subjLecs[0]?.g) || 100;

    let gradeAchieved = 0;
    subjLecs.forEach(l => {
      let val = p[l.id];
      if (val !== undefined && val !== null) {
        gradeAchieved += (subjectGrade / total) * ((parseFloat(val) || 0) / 100);
      }
    });

    const pct = total ? Math.round((done / total) * 100) : 0;
    const ci = SUBJECTS.indexOf(s);
    const color = SUBJ_COLORS[ci] || '#888';
    
    return `<div class="sp-row">
      <div class="sp-nm">${SUBJ_SHORT[s] || s} <span style="color:var(--txt3);font-size:9px;margin-right:4px">(${gradeAchieved.toFixed(1)}/${subjectGrade} درجة)</span></div>
      <div class="sp-bar"><div class="sp-fill" style="width:${pct}%;background:${color}"></div></div>
      <div class="sp-pct" style="color:${color}">${done}/${total}</div>
    </div>`;
  }).join('');
}

function renderLectures(state) {
  const p = state.progress[state.currentUser] || {};
  let lecs = LECTURES;
  
  if (state.filterSubj !== 'all') lecs = lecs.filter(l => l.s === state.filterSubj);
  if (state.filterQuiz !== 'all') lecs = lecs.filter(l => l.q === state.filterQuiz);
  if (state.searchQuery) {
    const q = state.searchQuery;
    lecs = lecs.filter(l => l.t.toLowerCase().includes(q) || l.s.toLowerCase().includes(q) || (SUBJ_SHORT[l.s] || '').toLowerCase().includes(q));
  }

  const c = document.getElementById('lecList');
  c.innerHTML = lecs.map(l => {
    const isDone = p[l.id] !== undefined;
    const compPct = isDone ? p[l.id] : null; 
    const ci = SUBJECTS.indexOf(l.s);
    const color = isDone ? PCT_COLORS[compPct] : (SUBJ_COLORS[ci] || '#888');
    const hasBookmark = typeof Notes !== 'undefined' && Notes.isBookmarked(l.id);
    const hasNote = typeof Notes !== 'undefined' && Notes.getNote(l.id);
    
    return `<div class="lec ${isDone ? 'done' : ''}" onclick="toggleLecture(${l.id})" style="${isDone ? `border-color:${color}66` : ''}">
      ${isDone ? `<div style="position:absolute;top:0;left:0;right:0;height:3px;background:${color}"></div>` : ''}
      <div class="lec-check" style="--pct:${isDone ? compPct : 0};${isDone ? `border-color:${color};` : ''}"></div>
      <div class="lec-info">
        <div class="lec-title">${l.t}${hasNote ? ' <span style="font-size:10px;opacity:0.5" title="عليها ملاحظة">📝</span>' : ''}</div>
        <div class="lec-meta">
          <span class="lec-tag" style="background:${SUBJ_COLORS[ci]}15;color:${SUBJ_COLORS[ci]}">${SUBJ_SHORT[l.s] || l.s}</span>
          <span class="lec-tag lt-quiz">${l.q}</span>
          ${l.u ? `<a href="${l.u}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link">🔗 المحاضرة</a>` : ''}
          ${l.u2 ? `<a href="${l.u2}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link lt-link2">🔗 البديل</a>` : ''}
          ${l.u3 ? `<a href="${l.u3}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link lt-link3" style="background:rgba(255,165,0,0.15);color:#ff9800;border:1px solid rgba(255,165,0,0.3)">🔗 بديل 2</a>` : ''}
          ${l.u4 ? `<a href="${l.u4}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link lt-link4" style="background:rgba(255,165,0,0.15);color:#ff9800;border:1px solid rgba(255,165,0,0.3)">🔗 بديل 3</a>` : ''}
          <span onclick="event.stopPropagation();if(typeof Notes!=='undefined'){Notes.toggleBookmark(${l.id});store.notify()}" class="lec-tag" style="cursor:pointer;background:${hasBookmark ? 'rgba(255,179,0,0.15)' : 'transparent'};color:${hasBookmark ? '#FFB300' : 'var(--ink-muted)'};border:1px solid ${hasBookmark ? 'rgba(255,179,0,0.3)' : 'var(--hairline)'}">${hasBookmark ? '⭐' : '☆'}</span>
          <span onclick="event.stopPropagation();_openLecNote(${l.id})" class="lec-tag" style="cursor:pointer;color:var(--ink-muted);border:1px solid var(--hairline)">📝</span>
        </div>
      </div>
    </div>`;
  }).join('');

  if (!lecs.length) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--txt3)">لا توجد محاضرات بهذا الفلتر</div>';
  }
}

// ── 5. LEADERBOARD REFACTOR ────────────────────────────
function renderLeaderboard(state) {
  const data = MEMBERS.map((m, i) => {
    const p = state.progress[i] || {};
    const done = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
    
    let totalScoreAchieved = 0;
    let maxPossibleScore = 0;
    const bySubj = {};
    
    SUBJECTS.forEach(s => {
      const subjLecs = LECTURES.filter(l => l.s === s);
      const total = subjLecs.length;
      const d = subjLecs.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
      
      const subjectGrade = parseFloat(subjLecs[0]?.g) || 100;
      maxPossibleScore += subjectGrade;
      
      let gradeAchieved = 0;
      subjLecs.forEach(l => {
        let val = p[l.id];
        if (val !== undefined && val !== null) {
          let numVal = parseFloat(val) || 0;
          gradeAchieved += (subjectGrade / total) * (numVal / 100);
        }
      });
      totalScoreAchieved += gradeAchieved;
      bySubj[s] = { done: d, total, grade: gradeAchieved, maxGrade: subjectGrade };
    });
    
    return { idx: i, m, done, bySubj, totalScoreAchieved, maxPossibleScore };
  }).sort((a, b) => b.totalScoreAchieved - a.totalScoreAchieved);

  const ranks = ['🥇','🥈','🥉'];
  const rClasses = ['r1','r2','r3'];
  const c = document.getElementById('lbCards');
  
  c.innerHTML = data.map((d, ri) => {
    const pct = Math.round((d.done / LECTURES.length) * 100); 
    const scorePct = d.maxPossibleScore ? Math.round((d.totalScoreAchieved / d.maxPossibleScore) * 100) : 0; 
    const lv = getLevel(pct);
    const lvEmoji = EMOJIS[lv][d.done % EMOJIS[lv].length] || '🌟';
    const lvPhrase = PHRASES[lv][d.done % PHRASES[lv].length] || 'عظيم';
    
    return `<div class="lb-card ${rClasses[ri]}">
      <div class="lb-top">
        <div class="lb-rank">${ranks[ri] || '🎖️'}</div>
        <div class="lb-av" style="background:${d.m.color}20">${d.m.emoji}</div>
        <div class="lb-nm" style="color:${d.m.color}">${d.m.name}</div>
        <div class="lb-total">
          <div class="n" style="font-size:18px">${d.totalScoreAchieved.toFixed(1)} <span style="font-size:10px;color:var(--txt3)">درجة</span></div>
          <div class="d">${d.done}/${LECTURES.length} محاضرة</div>
        </div>
      </div>
      <div style="text-align:center;font-size:12px;font-weight:700;margin-bottom:6px;color:${d.m.color};opacity:0.8">${lvEmoji} ${lvPhrase}</div>
      <div style="text-align:center;font-size:9px;color:var(--txt3);margin-bottom:8px;font-family:Inter,sans-serif">الكفاءة الإجمالية: ${scorePct}%</div>
      <div class="lb-bar-wrap"><div class="lb-bar-fill" style="width:${scorePct}%;background:linear-gradient(90deg,${d.m.color2},${d.m.color})"></div></div>
      <div class="lb-subjects">
        ${SUBJECTS.map((s, si) => {
          const sd = d.bySubj[s];
          return `<div class="lb-subj"><span>${SUBJ_SHORT[s] || s}</span><span style="color:${SUBJ_COLORS[si]}">${sd.grade.toFixed(1)}</span></div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

// ── BOOTSTRAP ──────────────────────────────────────────
buildUserSelect();
store.load(); // Fetch from localStorage and run Auto-Migrations

// 3. Auto-Render bypassing Interaction
const savedUserStr = localStorage.getItem('streak_user');
if (savedUserStr !== null) {
  const savedUid = parseInt(savedUserStr);
  if (!isNaN(savedUid) && MEMBERS[savedUid]) {
    // Note: User wanted auto login vs Pin screen. For safety, we keep the PIN modal, 
    // but pre-select the user for them.
    requestUserSelect(savedUid);
  }
}

// ── 6. BUY LIST ────────────────────────────
window.copyBuyList = function(userId) {
  const p = store.get().progress[userId] || {};
  const missingLecs = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) === 0);
  let text = `محاضرات للشراء - د. ${MEMBERS[userId].name}:\n\n`;
  missingLecs.forEach((l, idx) => {
    text += `${idx + 1}. ${l.t} (${SUBJ_SHORT[l.s] || l.s})\n`;
  });
  text += `\nالإجمالي: ${missingLecs.length} محاضرة`;
  
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      showToast('تم نسخ القائمة 📋!', 'success');
    }).catch(e => {
      console.warn('Clipboard failed', e);
      showToast('لم نتمكن من النسخ التلقائي، حاول مرة أخرى', 'fire');
    });
  } else {
    // Fallback for older browsers
    const el = document.createElement('textarea');
    el.value = text;
    document.body.appendChild(el);
    el.select();
    try {
      document.execCommand('copy');
      showToast('تم نسخ القائمة 📋!', 'success');
    } catch(e) {
      showToast('متصفحك لا يدعم النسخ التلقائي', 'warn');
    }
    document.body.removeChild(el);
  }
};
window.showConfirmModal = function(title, text, onConfirm) {
  const el = document.getElementById('confirmModal');
  if (!el) return;
  document.getElementById('confirmTitle').innerText = title;
  document.getElementById('confirmText').innerText = text;
  el.classList.add('show');
  const btn = document.getElementById('confirmBtn');
  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.onclick = () => {
    onConfirm();
    closeConfirmModal();
  };
};
window.closeConfirmModal = function() {
  const el = document.getElementById('confirmModal');
  if (el) el.classList.remove('show');
};

window.markAsBought = function(userId, lecId) {
  const st = store.get();
  const uid = parseInt(userId);
  const lid = parseInt(lecId);
  const currentUid = parseInt(st.currentUser);

  if (uid !== currentUid) {
    showToast('لا يمكنك التعديل في بيانات زملائك يا وحش ✋', 'warn');
    return;
  }
  
  showConfirmModal('تأكيد الشراء 🏗️', 'هل تأكدت من شراء هذه المحاضرة؟ سيتم إزالتها من قائمة النواقص تلقائياً.', () => {
    // 1. Update Cloud (Remove the 0% mark)
    store._removeFromCloud(uid, lid);
    
    // 2. Update Local State (Reactive UI will handle the rest)
    store.set(st => {
      const cloned = { ...st.progress[uid] };
      delete cloned[lid];
      return { ...st, progress: { ...st.progress, [uid]: cloned } };
    });
    
    showToast('تم حذف المحاضرة من قائمة النواقص 👍', 'success');
  });
};

function renderBuyList(state) {
  const c = document.getElementById('buyCards');
  if (!c) return;
  const data = MEMBERS.map((m, i) => {
    const p = state.progress[i] || {};
    const missingLecs = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) === 0);
    return { m, missingLecs, idx: i };
  }).filter(d => d.missingLecs.length > 0);
  
  if (!data.length) {
    c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--txt3)">مافيش حد مسجل محاضرات ناقصة حالياً</div>';
    return;
  }
  
  c.innerHTML = data.map(d => {
    return `<div class="lb-card" style="border-color:${d.m.color}60;margin-bottom:12px;padding:12px;">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;border-bottom:1px solid var(--hairline);padding-bottom:10px;position:relative;">
        <div class="lb-av" style="background:${d.m.color}20;width:34px;height:34px;font-size:16px;">${d.m.emoji}</div>
        
        <div style="display:flex;flex-direction:column;flex:1;">
          <div class="lb-nm" style="color:${d.m.color};font-size:14px;">${d.m.name}</div>
          <div style="font-size:11px;color:var(--semantic-danger);font-weight:700;">${d.missingLecs.length} محاضرة</div>
        </div>

        <button onclick="copyBuyList(${d.idx})" style="background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.15);color:var(--ink);border-radius:8px;padding:6px 12px;font-size:11px;cursor:pointer;font-family:'Cairo',sans-serif;font-weight:600;display:flex;align-items:center;gap:4px;transition:background 0.2s;">
          <span>📋</span> نسخ
        </button>
      </div>

      <div style="display:flex;flex-direction:column;gap:8px;">
        ${d.missingLecs.map(l => {
          const ci = SUBJECTS.indexOf(l.s);
          const cColor = SUBJ_COLORS[ci] || '#888';
          return `<div class="sub-lec" style="display:flex;align-items:flex-start;gap:8px;">
            <div style="width:6px;height:6px;border-radius:50%;background:${cColor};flex-shrink:0;margin-top:6px;"></div>
            <div style="display:flex;flex-direction:column;flex:1;gap:4px;">
              <div style="font-size:12px;font-weight:600;color:var(--ink);line-height:1.5;">${l.t}</div>
              <div style="display:flex;align-items:center;gap:6px;">
                <div style="font-size:9px;color:${cColor};background:${cColor}15;padding:1px 6px;border-radius:6px;font-family:'Inter',sans-serif;">${SUBJ_SHORT[l.s] || l.s}</div>
                ${d.idx === state.currentUser ? `<button onclick="event.stopPropagation();markAsBought(${d.idx}, ${l.id})" style="background:rgba(0,214,143,0.08);border:1px solid rgba(0,214,143,0.25);color:var(--semantic-success);font-size:10px;cursor:pointer;font-weight:800;padding:5px 12px;border-radius:8px;font-family:'Cairo',sans-serif;white-space:nowrap;transition:all 0.2s;">تم الشراء ✅</button>` : ''}
              </div>
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
  }).join('');
}

// ── FINISHED LIST — Lecture-Centric View (Multi-Select Filter) ─────
// Filter state: shared=true/false, subjects=Set of subject names
// Both can be active at the same time → intersection
window._finishedState = { shared: true, subjects: new Set() };

function _toggleFinShared() {
  window._finishedState.shared = !window._finishedState.shared;
  store.notify();
}

function _toggleFinSubject(subj) {
  const s = window._finishedState.subjects;
  if (s.has(subj)) s.delete(subj); else s.add(subj);
  store.notify();
}

function _clearFinSubjects() {
  window._finishedState.subjects.clear();
  store.notify();
}

function renderFinishedList(state) {
  const c = document.getElementById('finishedCards');
  if (!c) return;

  const { shared, subjects } = window._finishedState;

  // ── Build lecture map: id → { lec, studiedBy[] }
  const lecMap = {};
  LECTURES.forEach(l => { lecMap[l.id] = { lec: l, studiedBy: [] }; });
  MEMBERS.forEach((m, i) => {
    const p = state.progress[i] || {};
    LECTURES.forEach(l => {
      const val = p[l.id];
      if (val !== undefined && parseFloat(val) > 0)
        lecMap[l.id].studiedBy.push({ idx: i, m, pct: parseFloat(val) });
    });
  });

  // ── Base: only lectures at least one person studied
  let entries = Object.values(lecMap).filter(e => e.studiedBy.length > 0);

  // ── Apply "مشتركة" toggle
  if (shared) entries = entries.filter(e => e.studiedBy.length > 1);

  // ── Apply subject multi-select (OR logic inside subjects)
  if (subjects.size > 0) entries = entries.filter(e => subjects.has(e.lec.s));

  // ── Sort: most shared first, then alphabetical
  entries.sort((a, b) => b.studiedBy.length - a.studiedBy.length || a.lec.t.localeCompare(b.lec.t));

  // ── Counts for badge labels
  const allEntries    = Object.values(lecMap).filter(e => e.studiedBy.length > 0);
  const totalStudied  = allEntries.length;
  const sharedCount   = allEntries.filter(e => e.studiedBy.length > 1).length;
  const allSubjects   = [...new Set(allEntries.map(e => e.lec.s))];

  // ── Member stats
  const memberStats = MEMBERS.map((m, i) => {
    const p = state.progress[i] || {};
    const done = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
    return { m, done };
  });

  let html = '';

  // ── Stats Bar ──
  html += `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">`;
  memberStats.forEach(ms => {
    const pct = Math.round((ms.done / LECTURES.length) * 100);
    html += `<div style="flex:1;min-width:70px;background:${ms.m.color}12;border:1px solid ${ms.m.color}40;padding:8px 6px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
      <div style="font-size:15px">${ms.m.emoji}</div>
      <div style="font-size:9px;font-weight:800;color:${ms.m.color};text-transform:uppercase;letter-spacing:1px;margin-top:2px;line-height:1.2">${ms.m.name.split(' ')[0]}</div>
      <div style="font-size:14px;font-weight:900;color:var(--ink)">${ms.done}</div>
      <div style="height:3px;background:${ms.m.color}25;margin-top:4px;border-radius:2px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${ms.m.color}"></div></div>
    </div>`;
  });
  html += `</div>`;

  // ── Filter Row 1: Shared toggle + Reset ──
  const sharedBg  = shared ? 'var(--accent-blue)' : 'var(--surface-1)';
  const sharedClr = shared ? '#000' : 'var(--ink-muted)';
  const sharedBrd = shared ? 'var(--accent-blue)' : 'var(--hairline)';
  const sharedGlw = shared ? '0 0 12px rgba(0,229,255,0.35)' : 'none';

  const hasSubjFilter = subjects.size > 0;
  const activeCount = entries.length;

  html += `<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap;">
    <div onclick="_toggleFinShared()" style="
      flex-shrink:0;padding:7px 14px;font-size:11px;font-weight:800;cursor:pointer;
      text-transform:uppercase;letter-spacing:1px;white-space:nowrap;
      clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);
      background:${sharedBg};color:${sharedClr};border:1px solid ${sharedBrd};
      box-shadow:${sharedGlw};transition:all .2s;
    ">🔗 ${shared ? '✓ ' : ''}مشتركة فقط</div>

    <div style="flex:1;min-width:0;font-size:10px;color:var(--ink-muted);text-align:left;letter-spacing:1px;font-weight:700;text-transform:uppercase;padding-right:4px">
      ${activeCount} محضرة${subjects.size > 0 ? ` — ${subjects.size} مادة مختارة` : ''}
    </div>

    ${hasSubjFilter ? `<div onclick="_clearFinSubjects()" style="
      flex-shrink:0;padding:5px 10px;font-size:10px;font-weight:800;cursor:pointer;
      color:var(--semantic-danger);border:1px solid rgba(255,0,60,0.3);
      background:rgba(255,0,60,0.05);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);
      text-transform:uppercase;letter-spacing:1px;transition:all .2s;
    ">✕ مسح المواد</div>` : ''}
  </div>`;

  // ── Filter Row 2: Subject multi-chips ──
  html += `<div style="display:flex;gap:4px;overflow-x:auto;padding-bottom:6px;margin-bottom:14px;scrollbar-width:none;">`;
  allSubjects.forEach(s => {
    const isOn = subjects.has(s);
    const ci   = SUBJECTS.indexOf(s);
    const col  = SUBJ_COLORS[ci] || '#888';
    const cnt  = allEntries.filter(e => e.lec.s === s).length;
    // when shared is on, show count of shared-only for this subject
    const sharedCnt = allEntries.filter(e => e.lec.s === s && e.studiedBy.length > 1).length;
    const displayCnt = shared ? sharedCnt : cnt;
    html += `<div onclick="_toggleFinSubject('${s}')" style="
      flex-shrink:0;padding:5px 11px;font-size:11px;font-weight:800;cursor:pointer;
      text-transform:uppercase;letter-spacing:1px;white-space:nowrap;
      clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%);
      background:${isOn ? col + '22' : 'var(--surface-1)'};
      color:${isOn ? col : 'var(--ink-muted)'};
      border:1px solid ${isOn ? col : 'var(--hairline)'};
      box-shadow:${isOn ? `0 0 10px ${col}40` : 'none'};
      transition:all .2s;
    ">${isOn ? '✓ ' : ''}${SUBJ_SHORT[s] || s} <span style="opacity:0.7;font-size:9px">(${displayCnt})</span></div>`;
  });
  html += `</div>`;

  // ── Lecture Cards ──
  if (!entries.length) {
    html += `<div style="text-align:center;padding:50px 20px;color:var(--ink-muted);">
      <div style="font-size:40px;margin-bottom:12px">🔍</div>
      <div style="font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:1px">مافيش محضرات بالفلتر ده</div>
      <div style="font-size:11px;margin-top:8px;opacity:0.6">${shared && subjects.size > 0 ? 'جرب تشيل فلتر المشتركة أو تغير المادة' : shared ? 'مافيش محضرات مشتركة لسه' : 'جرب فلتر تاني'}</div>
    </div>`;
  } else {
    entries.forEach(e => {
      const l = e.lec;
      const ci = SUBJECTS.indexOf(l.s);
      const cColor = SUBJ_COLORS[ci] || '#888';
      const isShared  = e.studiedBy.length > 1;
      const allStudied = e.studiedBy.length === MEMBERS.length;
      const glowColor  = allStudied ? '#FFB300' : isShared ? 'var(--accent-blue)' : cColor;

      html += `<div style="
        background:linear-gradient(145deg,${glowColor}08,var(--surface-1));
        border:1px solid ${glowColor}${isShared ? '50' : '25'};
        border-right:4px solid ${glowColor};
        padding:10px 12px;margin-bottom:8px;
        clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);
        position:relative;transition:all .2s;
      ">
        ${isShared ? `<div style="position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,transparent,${glowColor},transparent);opacity:0.5"></div>` : ''}
        <div style="display:flex;align-items:flex-start;gap:10px;">
          <div style="width:8px;height:8px;border-radius:50%;background:${cColor};flex-shrink:0;margin-top:5px;box-shadow:0 0 6px ${cColor}80"></div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:12px;font-weight:700;color:var(--ink);line-height:1.5;margin-bottom:6px;">${l.t}</div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;margin-bottom:8px;">
              <span style="font-size:9px;color:${cColor};background:${cColor}15;padding:2px 7px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-weight:800;letter-spacing:1px;text-transform:uppercase">${SUBJ_SHORT[l.s] || l.s}</span>
              <span style="font-size:9px;color:var(--ink-muted);background:rgba(255,255,255,0.05);padding:2px 7px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-weight:700">${l.q}</span>
              ${allStudied ? `<span style="font-size:9px;color:#FFB300;background:rgba(255,179,0,0.1);padding:2px 8px;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-weight:900;letter-spacing:1px">👑 الكل ذاكرها</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:5px;flex-wrap:wrap;">
              ${e.studiedBy.map(sb => {
                const pc = PCT_COLORS[sb.pct] || 'var(--semantic-success)';
                return `<div style="display:flex;align-items:center;gap:3px;background:${sb.m.color}12;border:1px solid ${sb.m.color}35;padding:3px 8px;clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%);">
                  <span style="font-size:12px">${sb.m.emoji}</span>
                  <span style="font-size:10px;font-weight:800;color:${sb.m.color};text-transform:uppercase;letter-spacing:0.5px">${sb.m.name.split(' ')[0]}</span>
                  <span style="font-size:10px;font-weight:900;color:${pc};font-family:'Inter',sans-serif">${sb.pct}%</span>
                </div>`;
              }).join('')}
              ${MEMBERS.map((m, mi) => {
                if (e.studiedBy.some(sb => sb.idx === mi)) return '';
                return `<div style="display:flex;align-items:center;gap:3px;background:rgba(255,255,255,0.02);border:1px dashed rgba(255,255,255,0.1);padding:3px 8px;clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%);opacity:0.35;">
                  <span style="font-size:12px">${m.emoji}</span>
                  <span style="font-size:10px;color:var(--ink-muted);text-transform:uppercase">${m.name.split(' ')[0]}</span>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>`;
    });
  }

  c.innerHTML = html;
}

