/**
 * wellness.js — Daily Check-In, Mood, Focus, Streak Freeze, Burnout Detection
 */

const Wellness = (() => {
  const MOODS = [
    { emoji: '😫', label: 'تعبان', value: 1 },
    { emoji: '😐', label: 'عادي', value: 2 },
    { emoji: '😊', label: 'كويس', value: 3 },
    { emoji: '😄', label: 'ممتاز', value: 4 },
    { emoji: '🔥', label: 'مشتعل', value: 5 }
  ];

  function getCheckin(date) { return LS.get('checkin_' + (date || LS.today()), null); }
  function setCheckin(data) { LS.set('checkin_' + LS.today(), data); }
  function hasCheckedInToday() { return getCheckin() !== null; }

  function getStreak() {
    let streak = 0;
    const d = new Date();
    for (let i = 1; i <= 365; i++) {
      d.setDate(d.getDate() - 1);
      const dateStr = d.toISOString().split('T')[0];
      const ci = LS.get('checkin_' + dateStr, null);
      if (ci) streak++;
      else {
        // Check streak freeze
        const freezes = LS.get('streak_freezes_used', []);
        if (freezes.includes(dateStr)) { streak++; continue; }
        break;
      }
    }
    if (hasCheckedInToday()) streak++;
    return streak;
  }

  function getFreezeCount() { return LS.get('streak_freeze_available', 2); }
  function useFreeze() {
    const available = getFreezeCount();
    if (available <= 0) return false;
    const newAvailable = available - 1;
    LS.set('streak_freeze_available', newAvailable);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().split('T')[0];
    LS.update('streak_freezes_used', arr => { arr.push(yesterdayStr); return arr; }, []);
    // ── Firebase sync ──
    const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
    if (uid !== null && typeof window._writeUserData === 'function') {
      window._writeUserData(uid, {
        streak_freeze_available: newAvailable,
        streak_freezes_used: LS.get('streak_freezes_used', [])
      });
    }
    return true;
  }

  function getWeekMoods() {
    const moods = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const ci = LS.get('checkin_' + dateStr, null);
      moods.push({ date: dateStr, day: d.toLocaleDateString('ar-EG', { weekday: 'short' }), mood: ci?.mood || 0, focus: ci?.focus || 0 });
    }
    return moods;
  }

  function detectBurnout() {
    const week = getWeekMoods();
    const recentMoods = week.filter(w => w.mood > 0).slice(-3);
    if (recentMoods.length >= 3 && recentMoods.every(m => m.mood <= 2)) return true;
    return false;
  }

  function doCheckin(mood, focus) {
    const data = { mood, focus, date: LS.today(), timestamp: Date.now() };
    setCheckin(data);
    if (typeof Gamification !== 'undefined') Gamification.addXP(10, 'daily_checkin');
    // ── Firebase sync ──
    const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
    if (uid !== null && typeof window._writeUserData === 'function') {
      window._writeUserData(uid, { ['checkins/' + LS.today()]: data });
    }
    return data;
  }

  return { MOODS, getCheckin, hasCheckedInToday, getStreak, getFreezeCount, useFreeze, getWeekMoods, detectBurnout, doCheckin };
})();


// ── CHECK-IN MODAL ──
function showCheckinModal() {
  if (Wellness.hasCheckedInToday()) return;
  const overlay = document.createElement('div');
  overlay.id = 'checkinModal';
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '10000';

  const streak = Wellness.getStreak();
  const burnout = Wellness.detectBurnout();

  overlay.innerHTML = `
    <div class="modal-box" style="position:relative;max-width:360px;transform:translateY(0) scale(1) skewX(0deg);">
      <div style="text-align:center;font-size:40px;margin-bottom:10px">${burnout ? '⚠️' : '☀️'}</div>
      <div class="m-title" style="font-size:20px">${burnout ? 'خد بالك من نفسك!' : 'صباح الخير يا دكتور!'}</div>
      <div class="m-sub" style="margin-bottom:8px">${burnout ? 'شكلك مرهق الأيام اللي فاتت — ريّح شوية 💙' : 'إزاي حالتك النهاردة؟'}</div>

      ${streak > 0 ? `<div style="text-align:center;margin-bottom:12px;font-size:12px;color:#FFB300;font-weight:800">🔥 ${streak} يوم streak متتالي!</div>` : ''}

      <div style="font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px">المزاج</div>
      <div id="checkinMoods" style="display:flex;gap:6px;justify-content:center;margin-bottom:16px;">
        ${Wellness.MOODS.map(m => `
          <div onclick="document.querySelectorAll('#checkinMoods>div').forEach(d=>d.style.border='1px solid var(--hairline)');this.style.border='2px solid var(--accent-blue)';this.dataset.selected='1';window._checkinMood=${m.value}" style="flex:1;text-align:center;padding:10px 4px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);cursor:pointer;transition:all .2s">
            <div style="font-size:22px">${m.emoji}</div>
            <div style="font-size:8px;color:var(--ink-muted);font-weight:700;margin-top:2px">${m.label}</div>
          </div>
        `).join('')}
      </div>

      <div style="font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:1px;font-weight:700;margin-bottom:8px">التركيز المتوقع</div>
      <div style="display:flex;gap:6px;justify-content:center;margin-bottom:20px;">
        ${[1,2,3,4,5].map(f => `
          <div onclick="document.querySelectorAll('.focus-dot').forEach(d=>d.style.background='var(--surface-1)');for(let i=0;i<=${f-1};i++)document.querySelectorAll('.focus-dot')[i].style.background='var(--accent-blue)';window._checkinFocus=${f}" class="focus-dot" style="width:36px;height:36px;border-radius:50%;background:var(--surface-1);border:2px solid var(--hairline);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;font-weight:900;color:var(--ink);transition:all .2s">${f}</div>
        `).join('')}
      </div>

      <button onclick="if(window._checkinMood&&window._checkinFocus){Wellness.doCheckin(window._checkinMood,window._checkinFocus);document.getElementById('checkinModal').remove();if(typeof showToast==='function')showToast('تم التسجيل! يلا بينا 💪','success')}" style="width:100%;padding:14px;background:var(--accent-blue);color:#000;border:none;font-size:14px;font-weight:900;cursor:pointer;clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);font-family:'Cairo',sans-serif;text-transform:uppercase;letter-spacing:1px">✅ يلا نبدأ اليوم</button>
    </div>`;

  document.body.appendChild(overlay);
}

// ── WELLNESS DASHBOARD RENDERER ──
function renderWellnessWidget() {
  const el = document.getElementById('wellnessWidget');
  if (!el) return;

  const streak = Wellness.getStreak();
  const freezes = Wellness.getFreezeCount();
  const week = Wellness.getWeekMoods();
  const todayCI = Wellness.getCheckin();
  const burnout = Wellness.detectBurnout();

  const moodEmojis = { 1: '😫', 2: '😐', 3: '😊', 4: '😄', 5: '🔥' };

  let html = `
    <div style="display:flex;gap:8px;margin-bottom:12px;">
      <div style="flex:1;background:linear-gradient(135deg,rgba(255,179,0,0.08),transparent);border:1px solid rgba(255,179,0,0.3);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#FFB300">🔥 ${streak}</div>
        <div style="font-size:9px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">يوم streak</div>
      </div>
      <div style="flex:1;background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--accent-blue)">❄️ ${freezes}</div>
        <div style="font-size:9px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">Freeze متاح</div>
      </div>
      <div style="flex:1;background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px">${todayCI ? moodEmojis[todayCI.mood] || '❓' : '❓'}</div>
        <div style="font-size:9px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">${todayCI ? 'مزاج اليوم' : 'لم يُسجَّل'}</div>
      </div>
    </div>

    ${burnout ? `<div style="background:rgba(255,0,60,0.08);border:1px solid rgba(255,0,60,0.3);padding:10px 12px;margin-bottom:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-size:12px;color:var(--semantic-danger);font-weight:700;text-align:center">⚠️ مؤشر إرهاق — خد راحة النهاردة 💙</div>` : ''}

    <!-- Week Mood Chart -->
    <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📊 مزاج الأسبوع</div>
    <div style="display:flex;gap:4px;align-items:flex-end;height:80px;margin-bottom:8px;">
      ${week.map(w => {
        const h = w.mood ? (w.mood / 5) * 60 + 10 : 5;
        const col = w.mood >= 4 ? 'var(--semantic-success)' : w.mood >= 3 ? 'var(--accent-blue)' : w.mood >= 2 ? '#FFB300' : w.mood >= 1 ? 'var(--semantic-danger)' : 'var(--surface-2)';
        return `<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;">
          <div style="font-size:12px">${w.mood ? moodEmojis[w.mood] : '·'}</div>
          <div style="width:100%;height:${h}px;background:${col};border-radius:2px;transition:height .3s"></div>
          <div style="font-size:8px;color:var(--ink-muted);font-weight:700">${w.day}</div>
        </div>`;
      }).join('')}
    </div>`;

  el.innerHTML = html;
}
