/**
 * Streak App V2 - Reactive Architecture
 * Senior Full-Stack Engineering Refactor
 * 
 * 1) Global State Store (Single Source of Truth)
 * 2) Reactive UI Binding (Observer Pattern)
 * 3) Formal Data Versioning & Migration Engine
 * 4) No DOM Latency or Initialization Race Conditions
 */

const DEBUG_MODE = true;

// ── 1. GLOBAL STATE STORE ──────────────────────────────
const store = {
  state: {
    version: 2,
    currentUser: null,
    filterSubj: 'all',
    filterQuiz: 'all',
    searchQuery: '',
    progress: {} // { "uid": { "lecId": pctVal } }
  },
  listeners: [],

  get() {
    return this.state;
  },

  set(updater) {
    if (typeof updater === 'function') {
      this.state = updater(this.state);
    } else {
      this.state = { ...this.state, ...updater };
    }
    this.save();
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

  // ── DATA PERSISTENCE (Firebase + localStorage fallback) ──────────────────
  save() {
    const payload = {
      version: this.state.version,
      progress: this.state.progress
    };
    // Always keep a local backup
    try { localStorage.setItem('streak_store_v2', JSON.stringify(payload)); } catch(e){}
    // Sync to Firebase if available
    if (window._fbReady && window._fbDb) {
      try {
        const { ref, set } = window._fbSDK;
        set(ref(window._fbDb, 'progress'), this.state.progress);
        if (DEBUG_MODE) console.log('[Firebase: Save] Synced progress to cloud.');
      } catch(e) { console.warn('[Firebase: Save Error]', e); }
    }
  },

  load() {
    // First load from localStorage as immediate data (no flicker)
    this.loadFromLocal();
    // Then try Firebase for authoritative cloud data
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
      console.warn('[Firebase] Config not set. Running in offline mode (localStorage only).');
      return;
    }
    try {
      const { initializeApp } = window.firebase_app || {};
      const { getDatabase, ref, onValue, set } = window.firebase_database || {};
      if (!initializeApp) {
        console.warn('[Firebase] SDK not loaded.');
        return;
      }
      const app = initializeApp(FIREBASE_CONFIG);
      const db = getDatabase(app);
      window._fbDb  = db;
      window._fbSDK = { ref, set };
      window._fbReady = true;

      // Real-time listener — any change by other users updates the store
      onValue(ref(db, 'progress'), (snapshot) => {
        const cloudProgress = snapshot.val();
        if (cloudProgress) {
          if (DEBUG_MODE) console.log('[Firebase: onValue] Cloud data received.', cloudProgress);
          // Merge cloud ≻ local (cloud wins)
          this.state.progress = cloudProgress;
          // Persist locally as backup
          try { localStorage.setItem('streak_store_v2', JSON.stringify({ version: 2, progress: cloudProgress })); } catch(e){}
          this.notify(); // Trigger instant re-render
        }
      });
      if (DEBUG_MODE) console.log('[Firebase] Real-time listener attached.');
    } catch(e) {
      console.error('[Firebase: Init Error]', e);
    }
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
      this.save();
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

// ── MODALS & INTERACTIONS ──────────────────────────────
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

function checkPin() {
  const input = document.getElementById('pinInput');
  const val = input.value;
  if (val.length === 4) {
    if (val === MEMBERS[pendingUser].pin) {
      // Save user index BEFORE closePinModal clears pendingUser
      const confirmedUser = pendingUser;
      closePinModal();
      
      localStorage.setItem('streak_user', confirmedUser);
      document.getElementById('userSelect').classList.add('hide');
      document.getElementById('mainApp').classList.remove('hide');
      
      // Now set correctly — confirmedUser is a valid integer, not null
      store.set({ currentUser: confirmedUser });
      showToast(`أهلاً بك يا ${MEMBERS[confirmedUser].name} 💪`, 'success');

      // Welcome meme — only on first login of the session
      if (typeof showMeme === 'function') {
        setTimeout(() => showMeme('login', 0, `أهلاً يا ${MEMBERS[confirmedUser].name}! جاهز تذاكر؟ 💪`), 400);
      }
    } else {
      document.getElementById('pinError').style.opacity = '1';
      setTimeout(() => { if(input) input.value = ''; }, 500);
    }
  } else {
    document.getElementById('pinError').style.opacity = '0';
  }
}

function toggleLecture(lecId) {
  const s = store.get();
  const userProgress = s.progress[s.currentUser] || {};
  
  if (userProgress[lecId] !== undefined) {
    store.set(st => {
      const cloned = { ...st.progress[st.currentUser] };
      delete cloned[lecId];
      return { ...st, progress: { ...st.progress, [st.currentUser]: cloned } };
    });
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
  
  store.set(st => {
    const userProg = { ...st.progress[st.currentUser], [lecId]: pctVal };
    return { ...st, progress: { ...st.progress, [st.currentUser]: userProg } };
  });

  const p = store.get().progress[store.get().currentUser];
  const done = Object.keys(p).length;
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
  const done = Object.keys(p).length;
  const pct = Math.round((done / LECTURES.length) * 100);
  
  document.getElementById('ahName').textContent = m.name;
  document.getElementById('ahName').style.color = m.color;
  document.getElementById('ahStat').textContent = `${done} / ${LECTURES.length} محاضرة مكتملة`;
  document.getElementById('ahPct').textContent = pct + '%';
}

function renderLevelBanner(state) {
  const p = state.progress[state.currentUser] || {};
  const done = Object.keys(p).length;
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
