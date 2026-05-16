/**
 * social.js — Activity Feed, Presence Indicators, Team Challenges (pseudo-social via Firebase)
 */

const Social = (() => {
  // Old Activity Feed removed, handled by new Real-time Notifications system in sidebar

  // Team Challenges — automated challenges
  function getTeamChallenges() {
    if (typeof store === 'undefined' || typeof MEMBERS === 'undefined' || typeof LECTURES === 'undefined') return [];
    const s = store.get();
    const challenges = [];

    // Challenge: Everyone finish Perio
    if (typeof SUBJECTS !== 'undefined') {
      SUBJECTS.forEach(subj => {
        const subjLecs = LECTURES.filter(l => l.s === subj);
        const memberProgress = MEMBERS.map((m, i) => {
          const p = s.progress[i] || {};
          const done = subjLecs.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
          return { m, i, done, total: subjLecs.length, pct: Math.round((done / subjLecs.length) * 100) };
        });
        const avgPct = Math.round(memberProgress.reduce((s, x) => s + x.pct, 0) / MEMBERS.length);
        challenges.push({
          title: `خلصوا ${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[subj] || subj : subj} كلكم!`,
          emoji: '🎯',
          avgPct,
          members: memberProgress
        });
      });
    }
    return challenges;
  }

  // Study Presence — who's active (based on Firebase session data)
  function getPresence() {
    // This is a best-effort indicator based on session activity
    if (typeof store === 'undefined' || typeof MEMBERS === 'undefined') return [];
    const s = store.get();
    return MEMBERS.map((m, i) => {
      const p = s.progress[i] || {};
      const lectureCount = Object.keys(p).filter(k => parseFloat(p[k]) > 0).length;
      return { m, i, lectureCount, active: lectureCount > 0 };
    });
  }

  return { getTeamChallenges, getPresence };
})();


// ── SOCIAL PAGE RENDERER ──
function renderSocialPage() {
  const c = document.getElementById('pageSocial');
  if (!c) return;

  const challenges = Social.getTeamChallenges();

  let html = `<div style="padding:var(--spacing-md);">
    <!-- Team Challenges -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🎯 تحديات الفريق</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
      ${challenges.map(ch => `
        <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
            <span style="font-size:18px">${ch.emoji}</span>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700;color:var(--ink)">${ch.title}</div>
              <div style="font-size:10px;color:var(--ink-muted)">متوسط التقدم: ${ch.avgPct}%</div>
            </div>
          </div>
          <div style="height:4px;background:var(--surface-2);border-radius:2px;overflow:hidden;margin-bottom:8px">
            <div style="height:100%;width:${ch.avgPct}%;background:${ch.avgPct >= 80 ? 'var(--semantic-success)' : ch.avgPct >= 50 ? '#FFB300' : 'var(--accent-blue)'};transition:width .5s;border-radius:2px"></div>
          </div>
          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${ch.members.map(mp => `
              <div style="display:flex;align-items:center;gap:3px;padding:3px 6px;background:${mp.m.color}10;border:1px solid ${mp.m.color}30;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-size:9px;">
                <span>${mp.m.emoji}</span>
                <span style="font-weight:800;color:${mp.m.color}">${mp.m.name.split(' ')[0]}</span>
                <span style="font-weight:900;color:${mp.pct >= 80 ? 'var(--semantic-success)' : 'var(--ink-muted)'};font-family:'Inter',sans-serif">${mp.pct}%</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}
    </div>

  </div>`;

  c.innerHTML = html;
}
