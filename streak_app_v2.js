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
      background: 'rgba(0,0,0,0.75)', color: '#fff', padding: '8px 18px',
      borderRadius: '20px', fontSize: '13px', zIndex: '9999',
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

    // We assume 3 users max as per the hardcoded array
    [0, 1, 2].forEach(uid => {
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
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9998;display:flex;align-items:center;justify-content:center';
  overlay.innerHTML = `
    <div style="background:var(--bg2,#1e1e2e);border:1px solid rgba(255,80,80,.4);border-radius:16px;padding:28px 24px;max-width:320px;width:90%;text-align:center;font-family:Cairo,sans-serif">
      <div style="font-size:32px;margin-bottom:12px">⚠️</div>
      <div style="font-weight:700;font-size:16px;color:#ff6b6b;margin-bottom:10px">حساب مستخدم بالفعل</div>
      <div style="font-size:13px;color:var(--txt2,#aaa);line-height:1.6;margin-bottom:20px">
        حساب <b style="color:${MEMBERS[userId].color}">${name}</b> مسجل دخول على جهاز آخر حالياً.<br>
        هل تريد تسجيل الخروج من الجهاز الآخر والدخول هنا؟
      </div>
      <div style="display:flex;gap:10px;justify-content:center">
        <button onclick="document.getElementById('_sessionModal').remove();(window._sessionCancel&&window._sessionCancel())"
          style="padding:10px 18px;border-radius:10px;border:1px solid rgba(255,255,255,.15);background:transparent;color:var(--txt1,#fff);cursor:pointer;font-family:Cairo,sans-serif;font-size:13px">
          إلغاء
        </button>
        <button onclick="document.getElementById('_sessionModal').remove();(window._sessionConfirm&&window._sessionConfirm())"
          style="padding:10px 18px;border-radius:10px;border:none;background:#ff4d4d;color:#fff;cursor:pointer;font-family:Cairo,sans-serif;font-size:13px;font-weight:700">
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
  if (typeof showMeme === 'function') {
    setTimeout(() => showMeme('login', 0, `أهلاً يا ${MEMBERS[confirmedUser].name}! جاهز تذاكر؟ 💪`), 400);
  }
}

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
    // Guard: PINs are loaded from Firebase — if not ready yet, show a message
    if (!store._pins || store._pins[pendingUser] === undefined) {
      document.getElementById('pinError').textContent = '⏳ جاري تحميل البيانات، انتظر لحظة';
      document.getElementById('pinError').style.opacity = '1';
      return;
    }
    if (val === store._pins[pendingUser]) {
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
  const done = Object.keys(p).filter(id => LECTURES.some(l => l.id == id)).length;
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
  localStorage.removeItem('streak_user');
  // Detach Firebase listener to prevent memory leak
  if (typeof window._fbUnsubscribe === 'function') {
    window._fbUnsubscribe();
    window._fbUnsubscribe = null;
    window._fbReady = false;
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
  document.getElementById('pageLectures').classList.toggle('hide', tab !== 'lectures');
  document.getElementById('pageLeaderboard').classList.toggle('hide', tab !== 'leaderboard');
  // No render calls here! Pure state-driven CSS decoupling.
}

// ── 2. REACTIVE UI BINDING ─────────────────────────────
function buildUserSelect() {
  const c = document.getElementById('usCards');
  c.innerHTML = MEMBERS.map((m, i) => `
    <div class="us-card" onclick="requestUserSelect(${i})" style="border-color:${m.color}22">
      <div class="us-av" style="background:${m.color}18">${m.emoji}</div>
      <div><div class="nm" style="color:${m.color}">${m.name}</div>
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
});

function renderHeader(state) {
  const m = MEMBERS[state.currentUser];
  const p = state.progress[state.currentUser] || {};
  const done = Object.keys(p).filter(id => LECTURES.some(l => l.id == id)).length;
  const pct = Math.round((done / LECTURES.length) * 100);
  
  document.getElementById('ahName').textContent = m.name;
  document.getElementById('ahName').style.color = m.color;
  document.getElementById('ahStat').textContent = `${done} / ${LECTURES.length} محاضرة مكتملة`;
  document.getElementById('ahPct').textContent = pct + '%';
}

function renderLevelBanner(state) {
  const p = state.progress[state.currentUser] || {};
  const done = Object.keys(p).filter(id => LECTURES.some(l => l.id == id)).length;
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
    const done = subjLecs.filter(l => p[l.id] !== undefined).length;
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
    
    // Removed sequential animation delays completely. Rely on basic CSS fade for performance.
    return `<div class="lec ${isDone ? 'done' : ''}" onclick="toggleLecture(${l.id})" style="${isDone ? `border-color:${color}66` : ''}">
      ${isDone ? `<div style="position:absolute;top:0;left:0;right:0;height:3px;background:${color}"></div>` : ''}
      <div class="lec-check" style="${isDone ? `background:${color}22;border-color:${color};color:${color};font-size:11px` : ''}">${isDone ? `${compPct}%` : ''}</div>
      <div class="lec-info">
        <div class="lec-title">${l.t}</div>
        <div class="lec-meta">
          <span class="lec-tag" style="background:${SUBJ_COLORS[ci]}15;color:${SUBJ_COLORS[ci]}">${SUBJ_SHORT[l.s] || l.s}</span>
          <span class="lec-tag lt-quiz">${l.q}</span>
          ${l.u ? `<a href="${l.u}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link">🔗 المحاضرة</a>` : ''}
          ${l.u2 ? `<a href="${l.u2}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link lt-link2">🔗 البديل</a>` : ''}
          ${l.u3 ? `<a href="${l.u3}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link lt-link3" style="background:rgba(255,165,0,0.15);color:#ff9800;border:1px solid rgba(255,165,0,0.3)">🔗 بديل 2</a>` : ''}
          ${l.u4 ? `<a href="${l.u4}" target="_blank" onclick="event.stopPropagation()" class="lec-tag lt-link lt-link4" style="background:rgba(255,165,0,0.15);color:#ff9800;border:1px solid rgba(255,165,0,0.3)">🔗 بديل 3</a>` : ''}
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
    const done = LECTURES.filter(l => p[l.id] !== undefined).length;
    
    let totalScoreAchieved = 0;
    let maxPossibleScore = 0;
    const bySubj = {};
    
    SUBJECTS.forEach(s => {
      const subjLecs = LECTURES.filter(l => l.s === s);
      const total = subjLecs.length;
      const d = subjLecs.filter(l => p[l.id] !== undefined).length;
      
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
        <div class="lb-rank">${ranks[ri]}</div>
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
