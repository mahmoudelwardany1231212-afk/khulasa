/**
 * social.js — Activity Feed, Presence Indicators, Team Challenges (pseudo-social via Firebase)
 */

const Social = (() => {
  // Activity Feed — reads from Firebase progress changes
  function getActivityFeed() {
    if (typeof store === 'undefined' || typeof MEMBERS === 'undefined' || typeof LECTURES === 'undefined') return [];
    const s = store.get();
    const feed = [];
    MEMBERS.forEach((m, i) => {
      const p = s.progress[i] || {};
      Object.entries(p).forEach(([lecId, pct]) => {
        if (parseFloat(pct) > 0) {
          const lec = LECTURES.find(l => l.id == lecId);
          if (lec) feed.push({ user: m, userId: i, lec, pct: parseFloat(pct), lecId: parseInt(lecId) });
        }
      });
    });
    // Sort by most recent first (we don't have timestamps, so sort by count as proxy)
    return feed.reverse().slice(0, 30);
  }

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

  return { getActivityFeed, getTeamChallenges, getPresence };
})();


// ── SOCIAL PAGE RENDERER ──
function renderSocialPage() {
  const c = document.getElementById('pageSocial');
  if (!c) return;

  const feed = Social.getActivityFeed();
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

    <!-- Activity Feed -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">📡 آخر الأحداث</div>
    ${feed.length === 0 ? '<div style="text-align:center;padding:30px;color:var(--ink-muted);font-size:11px">مافيش نشاط لسه</div>' : `
      ${feed.slice(0, 20).map(f => {
        const ci = typeof SUBJECTS !== 'undefined' ? SUBJECTS.indexOf(f.lec.s) : 0;
        const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[ci] || '#888' : '#888';
        const pctLabel = f.pct === 100 ? '🔥' : f.pct >= 75 ? '⚡' : f.pct >= 50 ? '📖' : '🌱';
        return `<div style="display:flex;align-items:flex-start;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;">
          <div style="font-size:16px;flex-shrink:0;margin-top:2px">${f.user.emoji}</div>
          <div style="flex:1;min-width:0;">
            <div style="font-size:10px;color:var(--ink-muted);margin-bottom:2px">
              <span style="font-weight:800;color:${f.user.color}">${f.user.name.split(' ')[0]}</span> خلص محاضرة بـ ${f.pct}% ${pctLabel}
            </div>
            <div style="font-size:11px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${f.lec.t}</div>
          </div>
          <span style="font-size:8px;color:${col};background:${col}15;padding:2px 5px;clip-path:polygon(3px 0,100% 0,calc(100% - 3px) 100%,0 100%);font-weight:800;flex-shrink:0">${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[f.lec.s] || f.lec.s : f.lec.s}</span>
        </div>`;
      }).join('')}
    `}
  </div>`;

  c.innerHTML = html;
}
