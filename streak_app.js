// ── STATE ──────────────────────────────────────────
let currentUser = null;
let filterSubj = 'all';
let filterQuiz = 'all';
let searchQuery = '';
let pendingLecId = null;
let pendingUser = null;

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

const PCT_COLORS = {
  100: 'var(--green)',
  75: 'var(--teal)',
  50: 'var(--gold)',
  25: 'var(--rose)',
  0: 'var(--txt3)'
};

const PCT_MSGS = {
  100: 'كفاية يا عالمي انت لخصت الخلاصة',
  75: 'حل عليها كفاية كدة',
  50: 'ذاكرها كمان مرة هتثبت',
  25: 'مش كفاية تتذاكر مرة واحدة',
  0: 'انت محتاج تشتري ورق'
};

// ── GAMIFICATION ───────────────────────────────────
const EMOJIS = {
  1: ['🦷', '💡', '📖'],
  2: ['⚡', '💚', '🔋', '🌱'],
  3: ['⭐', '🌟', '✨', '🏆'],
  4: ['🔥', '💎', '🧬', '🧠'],
  5: ['🔥💀', '👾', '💥', '⚡🔥'],
  6: ['👑']
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

const LEVEL_NAMES = {
  1: 'مبتدئ — Level 1',
  2: 'شغال — Level 2',
  3: 'ماشي كويس — Level 3',
  4: 'وحش — Level 4',
  5: 'أسطوري — Level 5',
  6: 'الخلاصة في المصاصاة — MAX'
};

function getLevel(pct) {
  if (pct >= 90) return 6;
  if (pct >= 70) return 5;
  if (pct >= 50) return 4;
  if (pct >= 30) return 3;
  if (pct >= 10) return 2;
  return 1;
}

function getLevelPhrase(pct) {
  const lv = getLevel(pct);
  const arr = PHRASES[lv];
  return arr[Math.floor(Math.random() * arr.length)];
}

// ── TOAST ──────────────────────────────────────────
let toastTimer = null;
function showToast(msg, type = 'success') {
  const el = document.getElementById('toast');
  el.className = 'toast toast-' + type;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ── STORAGE ────────────────────────────────────────
function getProgress(uid) {
  let p = {};
  try {
    const raw = localStorage.getItem('streak_p_' + uid);
    if (raw) p = JSON.parse(raw);
  } catch(e) {}
  
  try {
    const oldRaw = localStorage.getItem('streak_p' + uid);
    if (oldRaw) {
      let oldP = JSON.parse(oldRaw);
      let changed = false;
      for (let k in oldP) {
        if (p[k] === undefined) {
          p[k] = (oldP[k] > 100) ? 100 : oldP[k];
          changed = true;
        }
      }
      if (changed) setProgress(uid, p);
    }
  } catch(e) {}
  
  return p || {};
}
function setProgress(uid, data) {
  localStorage.setItem('streak_p_' + uid, JSON.stringify(data));
}

// ── MODALS ─────────────────────────────────────────
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
      // Success
      closePinModal();
      currentUser = pendingUser;
      localStorage.setItem('streak_user', currentUser);
      document.getElementById('userSelect').classList.add('hide');
      document.getElementById('mainApp').classList.remove('hide');
      initApp();
      showToast(`أهلاً بك يا ${MEMBERS[currentUser].name} 💪`, 'success');
    } else {
      document.getElementById('pinError').style.opacity = '1';
      setTimeout(() => input.value = '', 500);
    }
  } else {
    document.getElementById('pinError').style.opacity = '0';
  }
}

function closePctModal() {
  document.getElementById('pctModal').classList.remove('show');
  pendingLecId = null;
}

function toggleLecture(lecId) {
  const p = getProgress(currentUser);
  if (p[lecId] !== undefined) {
    // If already done, uncheck it
    delete p[lecId];
    setProgress(currentUser, p);
    renderLectures();
    renderHeader();
    renderLevelBanner();
  } else {
    // If not done, ask for percentage
    pendingLecId = lecId;
    document.getElementById('pctModal').classList.add('show');
  }
}

function selectPct(pctVal) {
  if (pendingLecId === null) return;
  const lecId = pendingLecId;
  closePctModal();
  
  const p = getProgress(currentUser);
  p[lecId] = pctVal; // Store the percentage
  setProgress(currentUser, p);
  
  const done = Object.keys(p).length;
  const progressPct = Math.round((done / LECTURES.length) * 100);
  const lv = getLevel(progressPct);

  // Show the specific message based on comprehension percentage
  showToast(PCT_MSGS[pctVal], pctVal >= 75 ? 'success' : pctVal >= 50 ? 'warn' : 'fire');

  // Competitive milestone toasts AND motivational toasts
  setTimeout(() => {
    let tIdx;
    do { tIdx = Math.floor(Math.random() * MOTIVATIONAL_TOASTS.length); } while(tIdx === lastToastIdx);
    lastToastIdx = tIdx;
    
    // Check milestones or show daily random motivational text
    if (done === 1) showToast('🎯 أول محاضرة! ادخل اللعبة يا دكتور', 'success');
    else if (progressPct === 100) showToast('🏆 خلصت كل حاجة!! أنت الخلاصة في المصاصاة', 'epic');
    else {
      let msg = MOTIVATIONAL_TOASTS[tIdx];
      let tType = 'epic';
      
      const otherScores = MEMBERS.map((m, i) => ({
        idx: i, name: m.name,
        done: Object.keys(getProgress(i)).length
      })).filter(x => x.idx !== currentUser).sort((a,b) => b.done - a.done);
      
      const leader = otherScores[0];
      if (leader && done > leader.done && done === leader.done + 1) {
        msg = `🥇 عديت ${leader.name}! أنت الأول دلوقتي`;
        tType = 'fire';
      } else if (leader && leader.done > done && leader.done - done <= 3) {
        msg = `⚡ ${leader.name} قدامك بـ ${leader.done - done} بس! لحقه`;
        tType = 'warn';
      }
      
      showToast(msg, tType);
    }
  }, 3500);

  renderLectures();
  renderHeader();
  renderLevelBanner();
}

// ── USER SELECT ────────────────────────────────────
function buildUserSelect() {
  const c = document.getElementById('usCards');
  c.innerHTML = MEMBERS.map((m, i) => `
    <div class="us-card" onclick="requestUserSelect(${i})" style="border-color:${m.color}22">
      <div class="us-av" style="background:${m.color}18">${m.emoji}</div>
      <div><div class="nm" style="color:${m.color}">${m.name}</div>
      <div class="rl">${m.role} — ${m.roleAr}</div></div>
    </div>`).join('');
}

function requestUserSelect(i) {
  pendingUser = i;
  document.getElementById('pinTitle').innerHTML = `كلمة المرور لـ <span style="color:${MEMBERS[i].color}">${MEMBERS[i].name}</span>`;
  document.getElementById('pinModal').classList.add('show');
  setTimeout(() => document.getElementById('pinInput').focus(), 100);
}

function logout() {
  localStorage.removeItem('streak_user');
  currentUser = null;
  document.getElementById('mainApp').classList.add('hide');
  document.getElementById('userSelect').classList.remove('hide');
}

// ── INIT APP ───────────────────────────────────────
function initApp() {
  buildFilters();
  renderHeader();
  renderLevelBanner();
  renderSubjProgress();
  switchTab('lectures');
}

// ── HEADER ─────────────────────────────────────────
function renderHeader() {
  const m = MEMBERS[currentUser];
  const p = getProgress(currentUser);
  const done = Object.keys(p).length;
  const pct = Math.round((done / LECTURES.length) * 100);
  document.getElementById('ahName').textContent = m.name;
  document.getElementById('ahName').style.color = m.color;
  document.getElementById('ahStat').textContent = `${done} / ${LECTURES.length} محاضرة مكتملة`;
  document.getElementById('ahPct').textContent = pct + '%';
}

// ── LEVEL BANNER ───────────────────────────────────
function renderLevelBanner() {
  const p = getProgress(currentUser);
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

// ── TABS ───────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
  document.getElementById('pageLectures').classList.toggle('hide', tab !== 'lectures');
  document.getElementById('pageLeaderboard').classList.toggle('hide', tab !== 'leaderboard');
  if (tab === 'leaderboard') renderLeaderboard();
  if (tab === 'lectures') { renderLevelBanner(); renderSubjProgress(); renderLectures(); }
}

// ── SEARCH ─────────────────────────────────────────
function onSearch() {
  searchQuery = document.getElementById('searchInput').value.trim().toLowerCase();
  renderLectures();
}

// ── FILTERS ────────────────────────────────────────
function buildFilters() {
  const sf = document.getElementById('subjFilters');
  sf.innerHTML = `<div class="chip on" onclick="setSubjFilter('all')">الكل</div>` +
    SUBJECTS.map((s, i) => `<div class="chip sc${i}" onclick="setSubjFilter('${s}')">${SUBJ_SHORT[s] || s}</div>`).join('');

  const qf = document.getElementById('quizFilters');
  qf.innerHTML = `<div class="chip chip-q on" onclick="setQuizFilter('all')">الكل</div>` +
    QUIZZES.map(q => `<div class="chip chip-q" onclick="setQuizFilter('${q}')">${q}</div>`).join('');
}

function setSubjFilter(v) {
  filterSubj = v;
  document.querySelectorAll('#subjFilters .chip').forEach(c => {
    c.classList.toggle('on', (v === 'all' && c.textContent === 'الكل') || (c.getAttribute('onclick') && c.getAttribute('onclick').includes(`'${v}'`)));
  });
  renderSubjProgress();
  renderLectures();
}

function setQuizFilter(v) {
  filterQuiz = v;
  document.querySelectorAll('#quizFilters .chip').forEach(c => {
    c.classList.toggle('on', (v === 'all' && c.textContent === 'الكل') || (c.getAttribute('onclick') && c.getAttribute('onclick').includes(`'${v}'`)));
  });
  renderLectures();
}

// ── SUBJECT PROGRESS ───────────────────────────────
function renderSubjProgress() {
  const p = getProgress(currentUser);
  const c = document.getElementById('subjProgress');
  const subjs = filterSubj === 'all' ? SUBJECTS : [filterSubj];
  c.innerHTML = subjs.map((s, i) => {
    const total = LECTURES.filter(l => l.s === s).length;
    const subjLecs = LECTURES.filter(l => l.s === s);
    const done = subjLecs.filter(l => p[l.id] !== undefined).length;
    
    // Calculate total grades achieved for this subject
    const subjectGrade = subjLecs[0]?.g || 100; // default 100 if no grade
    let gradeAchieved = 0;
    subjLecs.forEach(l => {
      if (p[l.id] !== undefined) {
        // p[l.id] is the comprehension percentage (0-100)
        gradeAchieved += (subjectGrade / total) * (p[l.id] / 100);
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

// ── LECTURES ───────────────────────────────────────
function renderLectures() {
  const p = getProgress(currentUser);
  let lecs = LECTURES;
  if (filterSubj !== 'all') lecs = lecs.filter(l => l.s === filterSubj);
  if (filterQuiz !== 'all') lecs = lecs.filter(l => l.q === filterQuiz);
  if (searchQuery) lecs = lecs.filter(l => l.t.toLowerCase().includes(searchQuery) || l.s.toLowerCase().includes(searchQuery) || (SUBJ_SHORT[l.s] || '').toLowerCase().includes(searchQuery));

  const c = document.getElementById('lecList');
  c.innerHTML = lecs.map((l, idx) => {
    const isDone = p[l.id] !== undefined;
    const compPct = isDone ? p[l.id] : null; // comprehension percentage
    const ci = SUBJECTS.indexOf(l.s);
    const color = isDone ? PCT_COLORS[compPct] : (SUBJ_COLORS[ci] || '#888');
    
    const delay = Math.min(idx * 0.015, 0.4); // max 0.4s to load
    return `<div class="lec ${isDone ? 'done' : ''}" onclick="toggleLecture(${l.id})" style="animation-delay:${delay}s;${isDone ? `border-color:${color}66` : ''}">
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

// ── LEADERBOARD ────────────────────────────────────
function renderLeaderboard() {
  const data = MEMBERS.map((m, i) => {
    const p = getProgress(i);
    const done = LECTURES.filter(l => p[l.id] !== undefined).length;
    
    // Calculate total score based on comprehension % and grades
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
    
    // Auto-detect empty state for debugging
    if (Object.keys(p).length > 0 && totalScoreAchieved === 0) {
      console.warn("Found progress but 0 score for", m.name, p);
    }
    
    return { idx: i, m, done, bySubj, totalScoreAchieved, maxPossibleScore };
  }).sort((a, b) => b.totalScoreAchieved - a.totalScoreAchieved); // Sort by actual score now!

  const ranks = ['🥇','🥈','🥉'];
  const rClasses = ['r1','r2','r3'];
  const c = document.getElementById('lbCards');
  c.innerHTML = data.map((d, ri) => {
    const pct = Math.round((d.done / LECTURES.length) * 100); // Progress %
    const scorePct = Math.round((d.totalScoreAchieved / d.maxPossibleScore) * 100); // Score %
    const lv = getLevel(pct);
    const lvEmoji = EMOJIS[lv][d.done % EMOJIS[lv].length] || '🌟';
    const lvPhrase = PHRASES[lv][d.done % PHRASES[lv].length] || 'عظيم';
    return `<div class="lb-card ${rClasses[ri]}">
      <div class="lb-top">
        <div class="lb-rank">${ranks[ri] || '🎖️'}</div>
        <div class="lb-av" style="background:${d.m.color}20">${d.m.emoji}</div>
        <div class="lb-nm" style="color:${d.m.color}">${d.m.name}</div>
        <div class="lb-total">
          <div class="n" style="font-size:18px">${d.totalScoreAchieved.toFixed(1)}${d.totalScoreAchieved === 0 ? `<br><span style="font-size:8px;color:red">Keys: ${Object.keys(getProgress(d.idx)).join(',')}</span>` : ''} <span style="font-size:10px;color:var(--txt3)">درجة</span></div>
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

// ── BOOT ───────────────────────────────────────────
buildUserSelect();
const saved = localStorage.getItem('streak_user');
if (saved !== null && MEMBERS[parseInt(saved)]) {
  // If previously logged in, we bypass PIN for convenience (or we could enforce it)
  // Let's enforce it for safety:
  requestUserSelect(parseInt(saved));
}
