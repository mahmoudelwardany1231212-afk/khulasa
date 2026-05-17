/**
 * gamification.js — DYNAMIC XP, Badges, Themes
 * XP is COMPUTED from current lecture state, NOT stored as a running counter.
 * This means: undo a lecture → XP drops. First load → existing progress counted.
 */

const Gamification = (() => {
  const XP_PER_LECTURE = { 100: 50, 75: 35, 50: 20, 25: 10 };
  const XP_CHECKIN = 10;
  const XP_POMO = 5; // per completed pomodoro session

  const BADGES = [
    { id: 'first_lec', name: 'أول محاضرة', desc: 'أكملت أول محاضرة', emoji: '🏅', check: d => d.totalDone >= 1 },
    { id: 'lecs_5', name: '5 محاضرات', desc: 'خلصت 5 محاضرات', emoji: '📗', check: d => d.totalDone >= 5 },
    { id: 'lecs_10', name: '10 محاضرات', desc: 'خلصت 10 محاضرات', emoji: '📚', check: d => d.totalDone >= 10 },
    { id: 'lecs_25', name: '25 محاضرة', desc: 'ربع الطريق!', emoji: '🌟', check: d => d.totalDone >= 25 },
    { id: 'lecs_50', name: '50 محاضرة', desc: 'نصف الطريق!', emoji: '💎', check: d => d.totalDone >= 50 },
    { id: 'lecs_75', name: '75 محاضرة', desc: '75%!', emoji: '🔥', check: d => d.totalDone >= 75 },
    { id: 'lecs_100', name: '100 محاضرة', desc: 'الرقم 100!', emoji: '💯', check: d => d.totalDone >= 100 },
    { id: 'half_done', name: 'نصف المنهج', desc: '50% من كل المحاضرات', emoji: '🏆', check: d => d.totalDone >= Math.floor(d.totalAvailable / 2) },
    { id: 'all_done', name: 'الخلاصة', desc: 'خلّصت كل المحاضرات!', emoji: '👑', check: d => d.totalDone >= d.totalAvailable && d.totalAvailable > 0 },
    { id: 'perfect_5', name: '5 بالتمام', desc: '5 محاضرات بـ 100%', emoji: '⭐', check: d => d.perfectCount >= 5 },
    { id: 'perfect_20', name: '20 بالتمام', desc: '20 محاضرة بـ 100%!', emoji: '🌈', check: d => d.perfectCount >= 20 },
    { id: 'subj_done', name: 'مادة كاملة', desc: 'خلصت مادة بالكامل', emoji: '🎯', check: d => d.anySubjComplete },
    { id: 'streak_3', name: '3 أيام streak', desc: '3 أيام متتالية', emoji: '🔥', check: d => d.streak >= 3 },
    { id: 'streak_7', name: 'أسبوع كامل', desc: '7 أيام streak', emoji: '⚡', check: d => d.streak >= 7 },
    { id: 'streak_14', name: 'أسبوعين', desc: '14 يوم streak', emoji: '💪', check: d => d.streak >= 14 },
    { id: 'streak_30', name: 'شهر كامل', desc: '30 يوم streak!', emoji: '👑', check: d => d.streak >= 30 },
  ];

  const LEVELS = [
    { min: 0, name: 'مبتدئ', emoji: '🌱', color: '#10B981' },
    { min: 100, name: 'طالب', emoji: '📖', color: '#00C9D4' },
    { min: 300, name: 'مجتهد', emoji: '⚡', color: '#FFB300' },
    { min: 600, name: 'متميز', emoji: '⭐', color: '#F97316' },
    { min: 1000, name: 'محترف', emoji: '💎', color: '#8B5CF6' },
    { min: 2000, name: 'خبير', emoji: '🔥', color: '#FF4D8D' },
    { min: 4000, name: 'أسطوري', emoji: '🏆', color: '#FFB300' },
    { min: 8000, name: 'الخلاصة', emoji: '👑', color: '#F5C842' },
  ];

  const THEMES = [
    { id: 'default', name: 'Racing HUD', cost: 0, unlocked: true },
    { id: 'vodafone', name: 'Vodafone Red', cost: 500, vars: { '--canvas': '#ffffff', '--surface-1': '#f2f2f2', '--surface-2': '#ffffff', '--accent-blue': '#e60000', '--ink': '#25282b', '--ink-muted': '#7e7e7e', '--hairline': '#e0e0e0', '--semantic-success': '#00D68F', '--semantic-danger': '#e60000' }},
    { id: 'spotify', name: 'Spotify Green', cost: 800, vars: { '--canvas': '#121212', '--surface-1': '#181818', '--surface-2': '#1f1f1f', '--accent-blue': '#1ed760', '--ink': '#ffffff', '--ink-muted': '#b3b3b3', '--hairline': '#4d4d4d', '--semantic-success': '#1ed760', '--semantic-danger': '#ff4444' }},
    { id: 'spacex', name: 'Spasex Dark', cost: 1200, vars: { '--canvas': '#000000', '--surface-1': '#0a0a0a', '--surface-2': '#000000', '--accent-blue': '#ffffff', '--ink': '#ffffff', '--ink-muted': '#5a5a5f', '--hairline': '#3a3a3f', '--semantic-success': '#00FF88', '--semantic-danger': '#FF003C' }},
  ];

  /**
   * CORE: Compute XP dynamically from current state.
   * Called every time we need XP — never stale.
   */
  function computeXP() {
    let xp = 0;

    // 1. XP from lecture progress (the main source)
    if (typeof store !== 'undefined' && typeof LECTURES !== 'undefined') {
      const s = store.get();
      if (s.currentUser !== null) {
        const p = s.progress[s.currentUser] || {};
        LECTURES.forEach(l => {
          const val = parseFloat(p[l.id]);
          if (val > 0) {
            // Find closest XP bracket
            if (val >= 100) xp += XP_PER_LECTURE[100];
            else if (val >= 75) xp += XP_PER_LECTURE[75];
            else if (val >= 50) xp += XP_PER_LECTURE[50];
            else if (val >= 25) xp += XP_PER_LECTURE[25];
            else xp += 5; // tiny XP for any progress
          }
        });
      }
    }

    // 2. XP from check-ins
    const ciKeys = LS.keys('checkin_');
    xp += ciKeys.length * XP_CHECKIN;

    // 3. XP from pomodoro sessions
    const sessions = LS.get('pomo_sessions', []);
    xp += sessions.filter(s => s.type === 'pomodoro').length * XP_POMO;

    return xp;
  }

  function getXP() { return computeXP(); }

  // Legacy addXP no longer stores anything — XP is computed.
  // But we keep it for toast/notification triggers.
  function addXP(amount, reason) {
    _checkNewBadges();
    return computeXP();
  }

  function getLevel() {
    const xp = getXP();
    let lvl = LEVELS[0];
    for (const l of LEVELS) { if (xp >= l.min) lvl = l; }
    return lvl;
  }

  function getNextLevel() {
    const xp = getXP();
    for (const l of LEVELS) { if (xp < l.min) return l; }
    return null;
  }

  function getUnlockedBadges() { return LS.get('badges', []); }

  function _buildBadgeData() {
    let totalDone = 0, perfectCount = 0, anySubjComplete = false;

    if (typeof store !== 'undefined' && typeof LECTURES !== 'undefined') {
      const s = store.get();
      if (s.currentUser !== null) {
        const p = s.progress[s.currentUser] || {};
        totalDone = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
        perfectCount = LECTURES.filter(l => parseFloat(p[l.id]) === 100).length;

        if (typeof SUBJECTS !== 'undefined') {
          anySubjComplete = SUBJECTS.some(subj => {
            const subjLecs = LECTURES.filter(l => l.s === subj);
            return subjLecs.length > 0 && subjLecs.every(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0);
          });
        }
      }
    }

    return {
      xp: computeXP(), totalDone, perfectCount, anySubjComplete,
      totalAvailable: typeof LECTURES !== 'undefined' ? LECTURES.length : 999,
      streak: typeof Wellness !== 'undefined' ? Wellness.getStreak() : 0,
    };
  }

  function _checkNewBadges() {
    const unlocked = new Set(getUnlockedBadges());
    const data = _buildBadgeData();
    let newBadge = null;
    BADGES.forEach(b => {
      if (!unlocked.has(b.id) && b.check(data)) {
        unlocked.add(b.id);
        newBadge = b;
      }
    });
    LS.set('badges', [...unlocked]);
    if (newBadge && typeof showToast === 'function') {
      setTimeout(() => showToast(`${newBadge.emoji} بادج جديد: ${newBadge.name}!`, 'epic'), 500);
    }
  }

  // Force a badge check (call after login/page load)
  function recheckBadges() { _checkNewBadges(); }

  // Themes
  function getActiveTheme() { return LS.get('active_theme', 'default'); }
  function getUnlockedThemes() { return LS.get('unlocked_themes', ['default']); }
  function unlockTheme(id) {
    const theme = THEMES.find(t => t.id === id);
    if (!theme) return false;
    // Themes cost XP but we can't "subtract" dynamic XP.
    // Use a "spent XP" ledger instead.
    const spent = LS.get('xp_spent', 0);
    const available = computeXP() - spent;
    if (available < theme.cost) return false;
    LS.set('xp_spent', spent + theme.cost);
    LS.update('unlocked_themes', arr => { if (!arr.includes(id)) arr.push(id); return arr; }, ['default']);
    return true;
  }
  function getAvailableXP() { return computeXP() - LS.get('xp_spent', 0); }
  function applyTheme(id) {
    LS.set('active_theme', id);
    const theme = THEMES.find(t => t.id === id);
    if (theme && theme.vars) {
      Object.entries(theme.vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
    } else {
      ['--canvas','--surface-1','--surface-2','--accent-blue','--ink','--ink-muted','--hairline','--semantic-success','--semantic-danger'].forEach(k => document.documentElement.style.removeProperty(k));
    }
    // Set data-theme for CSS-level overrides (e.g. Vodafone light mode)
    document.documentElement.setAttribute('data-theme', id);
  }
  function initTheme() { applyTheme(getActiveTheme()); recheckBadges(); }

  return { XP_PER_LECTURE, BADGES, LEVELS, THEMES, getXP, addXP, getLevel, getNextLevel, getUnlockedBadges, recheckBadges, getActiveTheme, getUnlockedThemes, unlockTheme, getAvailableXP, applyTheme, initTheme, computeXP };
})();


// ── GAMIFICATION DASHBOARD RENDERER ──
function renderGamificationPage() {
  const c = document.getElementById('pageGamification');
  if (!c) return;

  const xp = Gamification.getXP();
  const availableXP = Gamification.getAvailableXP();
  const level = Gamification.getLevel();
  const nextLvl = Gamification.getNextLevel();
  const badges = Gamification.getUnlockedBadges();
  const xpToNext = nextLvl ? nextLvl.min - xp : 0;
  const lvlProgress = nextLvl ? Math.round(((xp - level.min) / (nextLvl.min - level.min)) * 100) : 100;

  // Lecture stats for context
  let lecDone = 0, lecTotal = 0, perfectCount = 0;
  if (typeof store !== 'undefined' && typeof LECTURES !== 'undefined') {
    const s = store.get();
    if (s.currentUser !== null) {
      const p = s.progress[s.currentUser] || {};
      lecTotal = LECTURES.length;
      lecDone = LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
      perfectCount = LECTURES.filter(l => parseFloat(p[l.id]) === 100).length;
    }
  }

  let html = `<div style="padding:var(--spacing-md);">
    <!-- XP & Level -->
    <div style="background:linear-gradient(135deg,${level.color}15,transparent);border:1px solid ${level.color}50;padding:16px;clip-path:polygon(12px 0,100% 0,calc(100% - 12px) 100%,0 100%);margin-bottom:14px;text-align:center;">
      <div style="font-size:36px;margin-bottom:4px">${level.emoji}</div>
      <div style="font-size:18px;font-weight:900;color:${level.color};text-transform:uppercase;letter-spacing:2px">${level.name}</div>
      <div style="font-size:28px;font-weight:900;color:var(--ink);margin:4px 0">${xp} <span style="font-size:12px;color:var(--ink-muted)">XP</span></div>
      ${nextLvl ? `
        <div style="height:6px;background:var(--surface-2);border-radius:3px;margin:8px 0;overflow:hidden">
          <div style="height:100%;width:${lvlProgress}%;background:${level.color};transition:width .5s;border-radius:3px"></div>
        </div>
        <div style="font-size:10px;color:var(--ink-muted);font-weight:700">${xpToNext} XP للمستوى التالي: ${nextLvl.emoji} ${nextLvl.name}</div>
      ` : '<div style="font-size:11px;color:#FFB300;font-weight:800">🏆 أعلى مستوى!</div>'}
    </div>

    <!-- XP Breakdown -->
    <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin-bottom:14px;">
      <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📊 مصادر الـ XP</div>
      <div style="font-size:10px;color:var(--ink-muted);line-height:2;">
        <div style="display:flex;justify-content:space-between"><span>📚 محاضرات مكتملة (${lecDone})</span><span style="color:var(--accent-blue);font-weight:900">الأساسي</span></div>
        <div style="display:flex;justify-content:space-between"><span>💯 محاضرات 100% (${perfectCount})</span><span style="color:var(--semantic-success);font-weight:900">+50 لكل واحدة</span></div>
        <div style="display:flex;justify-content:space-between"><span>✅ Check-ins</span><span style="color:#FFB300;font-weight:900">+10 لكل يوم</span></div>
        <div style="display:flex;justify-content:space-between"><span>🍅 جلسات Pomodoro</span><span style="color:var(--semantic-danger);font-weight:900">+5 لكل جلسة</span></div>
      </div>
      <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--hairline);font-size:10px;color:var(--ink-muted)">
        ⚡ الـ XP بيتحسب تلقائيًا — لو رجعت في محاضرة الـ XP بينقص
      </div>
    </div>

    <!-- Badges -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🏅 الإنجازات (${badges.length}/${Gamification.BADGES.length})</div>
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px;">
      ${Gamification.BADGES.map(b => {
        const unlocked = badges.includes(b.id);
        return `<div title="${b.desc}" style="width:52px;height:60px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;background:${unlocked ? 'var(--surface-1)' : 'var(--surface-2)'};border:1px solid ${unlocked ? 'var(--accent-blue)' : 'var(--hairline)'};clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);${unlocked ? '' : 'opacity:0.35;filter:grayscale(1);'}">
          <div style="font-size:20px">${b.emoji}</div>
          <div style="font-size:7px;color:var(--ink-muted);font-weight:700;text-align:center;line-height:1.2;padding:0 2px">${b.name}</div>
        </div>`;
      }).join('')}
    </div>

    <!-- Themes Shop -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🎨 متجر الثيمات <span style="color:var(--accent-blue);font-size:10px">(${availableXP} XP متاح)</span></div>
    <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:16px;">
      ${Gamification.THEMES.map(t => {
        const unlocked = Gamification.getUnlockedThemes().includes(t.id);
        const active = Gamification.getActiveTheme() === t.id;
        const canBuy = availableXP >= (t.cost || 0);
        return `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:var(--surface-1);border:1px solid ${active ? 'var(--accent-blue)' : 'var(--hairline)'};clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);">
          <div style="width:30px;height:30px;border-radius:4px;background:${t.vars ? t.vars['--canvas'] : 'var(--canvas)'};border:2px solid ${t.vars ? t.vars['--accent-blue'] || 'var(--accent-blue)' : 'var(--accent-blue)'}"></div>
          <div style="flex:1">
            <div style="font-size:12px;font-weight:700;color:var(--ink)">${t.name}</div>
            <div style="font-size:10px;color:var(--ink-muted)">${t.cost === 0 ? 'مجاني' : t.cost + ' XP'}</div>
          </div>
          ${active ? '<div style="font-size:10px;color:var(--accent-blue);font-weight:900">✓ مفعّل</div>' :
            unlocked ? `<button onclick="Gamification.applyTheme('${t.id}');renderGamificationPage()" style="padding:5px 10px;background:var(--accent-blue);color:var(--ink);border:none;font-size:10px;font-weight:800;cursor:pointer;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif">تفعيل</button>` :
            canBuy ? `<button onclick="if(Gamification.unlockTheme('${t.id}')){Gamification.applyTheme('${t.id}');renderGamificationPage()}" style="padding:5px 10px;background:#FFB300;color:var(--ink);border:none;font-size:10px;font-weight:800;cursor:pointer;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif">🔓 شراء</button>` :
            `<div style="font-size:9px;color:var(--ink-muted)">🔒 محتاج ${t.cost - availableXP} XP كمان</div>`
          }
        </div>`;
      }).join('')}
    </div>

    <!-- Reset Shop -->
    <button onclick="resetThemeShop()" style="width:100%;padding:12px;background:rgba(255,0,60,0.08);color:var(--semantic-danger);border:1px solid rgba(255,0,60,0.2);font-size:13px;font-weight:800;cursor:pointer;clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);font-family:'Cairo',sans-serif;margin-top:8px">🔄 استرجاع الـ XP (تصفير المتجر)</button>
  </div>`;

  c.innerHTML = html;
}

function resetThemeShop() {
  if (!confirm('هل أنت متأكد؟ سيتم استرجاع كل XP المشتريات وتصفير المتجر.')) return;
  LS.set('xp_spent', 0);
  LS.set('unlocked_themes', ['default']);
  LS.set('active_theme', 'default');
  if (typeof Gamification !== 'undefined') { Gamification.initTheme(); Gamification.recheckBadges(); }
  renderGamificationPage();
}
