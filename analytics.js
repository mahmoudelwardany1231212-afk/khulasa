/**
 * analytics.js — Lecture-Driven Analytics, Heatmap, Dashboard
 * All stats pulled from Firebase lecture progress + Pomodoro sessions
 */

const Analytics = (() => {
  // Get per-subject stats from LIVE lecture progress
  function getSubjectStats() {
    if (typeof store === 'undefined' || typeof LECTURES === 'undefined' || typeof SUBJECTS === 'undefined') return [];
    const s = store.get();
    if (s.currentUser === null) return [];
    const p = s.progress[s.currentUser] || {};

    return SUBJECTS.map((subj, si) => {
      const subjLecs = LECTURES.filter(l => l.s === subj);
      const total = subjLecs.length;
      const done = subjLecs.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
      const perfect = subjLecs.filter(l => parseFloat(p[l.id]) === 100).length;
      const weak = subjLecs.filter(l => { const v = parseFloat(p[l.id]); return v > 0 && v <= 50; }).length;
      const avgPct = done > 0 ? Math.round(subjLecs.reduce((sum, l) => sum + (parseFloat(p[l.id]) || 0), 0) / total) : 0;
      const color = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[si] || '#888' : '#888';
      const short = typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[subj] || subj : subj;
      return { subj, short, total, done, perfect, weak, avgPct, color, pct: Math.round(done / total * 100) };
    });
  }

  // Overall stats
  function getOverallStats() {
    if (typeof store === 'undefined' || typeof LECTURES === 'undefined') return {};
    const s = store.get();
    if (s.currentUser === null) return {};
    const p = s.progress[s.currentUser] || {};
    const totalLecs = LECTURES.length;
    const perfect = LECTURES.filter(l => parseFloat(p[l.id]) === 100).length;
    const weak = LECTURES.filter(l => { const v = parseFloat(p[l.id]); return v > 0 && v <= 50; }).length;
    const scoreData = typeof window.getUserScore === 'function' ? window.getUserScore(s.currentUser, s.progress) : { scorePct: 0, done: 0 };
    const avgPct = scoreData.scorePct;
    const done = scoreData.done;
    const pomoMins = typeof PomodoroModule !== 'undefined' ? PomodoroModule.getTodayMinutes() : 0;
    const streak = typeof Wellness !== 'undefined' ? Wellness.getStreak() : 0;
    const xp = typeof Gamification !== 'undefined' ? Gamification.getXP() : 0;
    return { totalLecs, done, perfect, weak, avgPct, pomoMins, streak, xp, remaining: totalLecs - done };
  }

  // Heatmap from check-ins + pomodoro
  function getHeatmapData(days = 84) {
    const data = [];
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      const checkin = LS.get('checkin_' + dateStr, null);
      const sessions = (LS.get('pomo_sessions', [])).filter(s => s.date === dateStr);
      const totalMin = sessions.reduce((sum, s) => sum + s.duration, 0) / 60;
      data.push({
        date: dateStr, day: d.getDay(),
        mood: checkin?.mood || 0,
        minutes: Math.round(totalMin),
        intensity: Math.min(4, Math.floor(totalMin / 30))
      });
    }
    return data;
  }

  // Team comparison
  function getTeamComparison() {
    if (typeof store === 'undefined' || typeof MEMBERS === 'undefined' || typeof LECTURES === 'undefined') return [];
    const s = store.get();
    return MEMBERS.map((m, i) => {
      const scoreData = typeof window.getUserScore === 'function' ? window.getUserScore(i, s.progress) : { scorePct: 0, totalScoreAchieved: 0, done: 0 };
      return { m, i, done: scoreData.done, pct: scoreData.scorePct, score: scoreData.totalScoreAchieved };
    }).sort((a, b) => b.score - a.score);
  }

  return { getSubjectStats, getOverallStats, getHeatmapData, getTeamComparison };
})();


// ── ANALYTICS PAGE RENDERER ──
function renderAnalyticsPage() {
  const c = document.getElementById('pageAnalytics');
  if (!c) return;

  const stats = Analytics.getOverallStats();
  const subjs = Analytics.getSubjectStats();
  const team = Analytics.getTeamComparison();
  const heatmap = Analytics.getHeatmapData(84);
  const intensityColors = ['var(--surface-2)', '#0D4429', '#0F7B3B', '#1AAD52', '#2DD66B'];

  let html = `<div style="padding:var(--spacing-md);">
    <!-- Overall Stats -->
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:14px;">
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--accent-blue)">${stats.done || 0}</div>
        <div style="font-size:8px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">محاضرة خلصانة</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--semantic-danger)">${stats.remaining || 0}</div>
        <div style="font-size:8px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">باقي</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:var(--semantic-success)">${stats.perfect || 0}</div>
        <div style="font-size:8px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">100% كامل</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-bottom:16px;">
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#FFB300">${stats.avgPct || 0}%</div>
        <div style="font-size:8px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">متوسط الفهم</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#FF4D8D">${stats.weak || 0}</div>
        <div style="font-size:8px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">ضعيفة ≤50%</div>
      </div>
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
        <div style="font-size:22px;font-weight:900;color:#8B5CF6">🔥 ${stats.streak || 0}</div>
        <div style="font-size:8px;color:var(--ink-muted);font-weight:700;text-transform:uppercase;letter-spacing:1px">يوم streak</div>
      </div>
    </div>

    <!-- Per-Subject Breakdown -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">📊 تقدم المواد</div>
    ${subjs.map(s => `
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:10px 12px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:6px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <div style="font-size:12px;font-weight:800;color:${s.color}">${s.short}</div>
          <div style="display:flex;gap:8px;font-size:9px;color:var(--ink-muted);">
            <span>✅ ${s.done}/${s.total}</span>
            <span>💯 ${s.perfect}</span>
            ${s.weak > 0 ? `<span style="color:var(--semantic-danger)">⚠️ ${s.weak} ضعيف</span>` : ''}
          </div>
        </div>
        <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden">
          <div style="height:100%;width:${s.pct}%;background:${s.color};border-radius:3px;transition:width .5s"></div>
        </div>
        <div style="display:flex;justify-content:space-between;margin-top:4px;">
          <span style="font-size:9px;color:var(--ink-muted)">${s.pct}% إكتمال</span>
          <span style="font-size:9px;color:var(--ink-muted)">متوسط ${s.avgPct}% فهم</span>
        </div>
      </div>
    `).join('')}

    <!-- Team Comparison -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px">🏆 مقارنة الفريق</div>
    ${team.map((t, rank) => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;">
        <div style="font-size:14px;font-weight:900;color:${rank === 0 ? '#FFB300' : 'var(--ink-muted)'};width:20px;text-align:center">${rank + 1}</div>
        <div style="font-size:14px">${t.m.emoji}</div>
        <div style="flex:1;font-size:11px;font-weight:700;color:${t.m.color}">${t.m.name.split(' ')[0]}</div>
        <div style="font-size:12px;font-weight:900;color:var(--accent-blue);font-family:'Inter',sans-serif">${t.done}</div>
        <div style="width:50px;height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden">
          <div style="height:100%;width:${t.pct}%;background:${t.m.color};border-radius:2px"></div>
        </div>
        <div style="font-size:9px;color:var(--ink-muted);width:28px;text-align:left">${t.pct}%</div>
      </div>
    `).join('')}

    <!-- Heatmap -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin:16px 0 10px">🗓️ خريطة النشاط</div>
    <div style="overflow-x:auto;margin-bottom:6px;scrollbar-width:none;">
      <div style="display:grid;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;gap:2px;min-width:${Math.ceil(heatmap.length/7)*14}px;">
        ${heatmap.map(d => `<div title="${d.date}: ${d.minutes} دقيقة" style="width:11px;height:11px;background:${intensityColors[d.intensity]};border-radius:2px"></div>`).join('')}
      </div>
    </div>
    <div style="display:flex;align-items:center;gap:3px;justify-content:flex-end;margin-bottom:8px;">
      <span style="font-size:8px;color:var(--ink-muted)">أقل</span>
      ${intensityColors.map(c => `<div style="width:9px;height:9px;background:${c};border-radius:2px"></div>`).join('')}
      <span style="font-size:8px;color:var(--ink-muted)">أكتر</span>
    </div>
  </div>`;

  c.innerHTML = html;
}
