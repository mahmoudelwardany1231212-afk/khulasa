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

    if (typeof SUBJECTS !== 'undefined') {
      SUBJECTS.forEach(subj => {
        const subjLecs = LECTURES.filter(l => l.s === subj);
        const memberProgress = MEMBERS.map((m, i) => {
          const p = s.progress[i] || {};
          const done = subjLecs.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
          return { m, i, done, total: subjLecs.length, pct: Math.round((done / subjLecs.length) * 100) };
        });
        const avgPct = Math.round(memberProgress.reduce((s, x) => s + x.pct, 0) / MEMBERS.length);

        // Team coverage (union): lectures where at least one member >= 80%
        let coveredUnion = 0;
        const gapLectures = [];
        subjLecs.forEach(lec => {
          let maxPct = 0;
          let who = -1;
          for (let i = 0; i < MEMBERS.length; i++) {
            const pct = parseFloat((s.progress[i] || {})[lec.id]);
            if (!isNaN(pct) && pct > maxPct) { maxPct = pct; who = i; }
          }
          if (maxPct >= 80) coveredUnion++;
          else gapLectures.push({ id: lec.id, title: lec.t || lec.s || lec.id, maxPct: Math.round(maxPct), bestMember: who });
        });
        const teamCoveragePct = subjLecs.length ? Math.round((coveredUnion / subjLecs.length) * 100) : 0;

        challenges.push({
          title: `خلصوا ${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[subj] || subj : subj} كلكم!`,
          emoji: '🎯',
          avgPct,
          teamCoveragePct,
          gap: subjLecs.length - coveredUnion,
          totalLecs: subjLecs.length,
          gapLectures,
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
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
      <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px">🎯 تحديات الفريق</div>
      <button onclick="renderSocialPage()" style="background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink-muted);padding:4px 8px;font-size:10px;cursor:pointer;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif">🔄 تحديث</button>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
      ${challenges.map(ch => {
        const avgColor = ch.avgPct >= 80 ? 'var(--semantic-success)' : ch.avgPct >= 50 ? '#FFB300' : 'var(--accent-blue)';
        const covColor = ch.teamCoveragePct >= 80 ? 'var(--semantic-success)' : ch.teamCoveragePct >= 50 ? '#FFB300' : '#ef4444';
        return `
        <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
            <span style="font-size:18px">${ch.emoji}</span>
            <div style="flex:1">
              <div style="font-size:12px;font-weight:700;color:var(--ink)">${ch.title}</div>
            </div>
          </div>

          <div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--ink-muted);margin-bottom:2px">
              <span>📊 متوسط الفريق</span>
              <span style="font-weight:700;color:${avgColor}">${ch.avgPct}%</span>
            </div>
            <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${ch.avgPct}%;background:${avgColor};transition:width .5s;border-radius:3px"></div>
            </div>
          </div>

          <div style="margin-bottom:6px">
            <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--ink-muted);margin-bottom:2px">
              <span>👥 تغطية الفريق (union)</span>
              <span style="font-weight:700;color:${covColor}">${ch.teamCoveragePct}%</span>
            </div>
            <div style="height:5px;background:var(--surface-2);border-radius:3px;overflow:hidden">
              <div style="height:100%;width:${ch.teamCoveragePct}%;background:${covColor};transition:width .5s;border-radius:3px"></div>
            </div>
          </div>

          ${ch.gap > 0 ? `
          <div style="margin-bottom:6px">
            <div style="font-size:9px;color:#ef4444;margin-bottom:4px">
              <strong>⚠️ فجوة: ${ch.gap} محاضرة</strong> — مفيش ولا واحد عارفها
              <span style="color:var(--ink-muted);font-size:8px;cursor:pointer" onclick="(function(el){
                var t=el.closest('div').nextElementSibling;t.style.display=t.style.display==='none'?'block':'none'
              })(this)"> [عرض/إخفاء]</span>
            </div>
            <div style="display:none" data-gap>
              <div style="display:flex;gap:4px;margin-bottom:4px;flex-wrap:wrap">
                <input type="text" placeholder="🔍 بحث..." oninput="(function(el,v){
                  el.closest('[data-gap]').querySelectorAll('tbody tr').forEach(function(r){
                    r.style.display=r.children[0].textContent.toLowerCase().indexOf(v.toLowerCase())===-1?'none':''
                  })
                })(this,this.value)" style="flex:1;min-width:60px;padding:3px 5px;font-size:9px;background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif">
                <select onchange="(function(el,v){
                  el.closest('[data-gap]').querySelectorAll('tbody tr').forEach(function(r){
                    var pct=parseInt(r.children[1].textContent);
                    if(v==='all'){r.style.display=''}else{var p=v.split('-'),lo=parseInt(p[0]),hi=parseInt(p[1]);r.style.display=pct>=lo&&pct<hi?'':'none'}
                  })
                })(this,this.value)" style="padding:3px 5px;font-size:9px;background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif">
                  <option value="all">📊 النسبة: الكل</option>
                  <option value="0-20">0-20%</option>
                  <option value="20-40">20-40%</option>
                  <option value="40-60">40-60%</option>
                  <option value="60-80">60-80%</option>
                </select>
                <select onchange="(function(el,v){
                  el.closest('[data-gap]').querySelectorAll('tbody tr').forEach(function(r){
                    if(v==='all'){r.style.display=''}else{
                      var cellName = r.children[2].textContent.replace(/✏️/g,'').trim();
                      r.style.display=cellName.indexOf(v)!==-1?'':'none';
                    }
                  })
                })(this,this.value)" style="padding:3px 5px;font-size:9px;background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif">
                  <option value="all">👤 العضو: الكل</option>
                  ${ch.members.map(function(mp){return '<option value="' + mp.m.name.split(' ')[0] + '">' + mp.m.emoji + ' ' + mp.m.name.split(' ')[0] + '</option>';}).join('')}
                </select>
              </div>
              <div style="max-height:180px;overflow-y:auto;border:1px solid var(--hairline)">
                <table style="width:100%;border-collapse:collapse;font-size:8px">
                  <thead><tr style="background:var(--surface-2)">
                    <th style="padding:3px 4px;text-align:right;position:sticky;top:0;background:var(--surface-2)">المحاضرة</th>
                    <th style="padding:3px 4px;text-align:center;position:sticky;top:0;background:var(--surface-2)">أعلى فهم</th>
                    <th style="padding:3px 4px;text-align:center;position:sticky;top:0;background:var(--surface-2)">المكلف في الخطة</th>
                  </tr></thead>
                  <tbody>
                    ${function(){
                      var ownershipMap = {};
                      try {
                        if (typeof CoverageEngine !== 'undefined') {
                          var plan = CoverageEngine.loadLatestPlan();
                          if (plan && plan.ownershipMap) { ownershipMap = plan.ownershipMap; }
                        }
                        if (!ownershipMap || Object.keys(ownershipMap).length === 0) {
                          if (typeof CoverageEngine !== 'undefined' && typeof MEMBERS !== 'undefined') {
                            var members = Array.from(MEMBERS, function(m, i) { return { id: i, name: m.name || 'عضو ' + i }; });
                            var progress = typeof store !== 'undefined' ? store.get().progress : {};
                            var distResult = CoverageEngine.distributeLectures(
                              typeof LECTURES !== 'undefined' ? LECTURES : [], members, progress, {}
                            );
                            if (distResult && distResult.ownershipMap) ownershipMap = distResult.ownershipMap;
                          }
                        }
                      } catch(e) { console.warn('[Social] could not load coverage map', e); }
                      return ch.gapLectures.map(function(gl){
                        var riskColor = gl.maxPct < 20 ? '#ef4444' : gl.maxPct < 50 ? '#f59e0b' : '#6366f1';
                        var ownerEntry = ownershipMap[gl.id];
                        var memberName, memberColor;
                        if (ownerEntry) {
                          memberName = ownerEntry.ownerName || '—';
                          var idx = MEMBERS.findIndex(function(m) { return m.id === ownerEntry.owner; });
                          memberColor = (idx >= 0 && MEMBERS[idx].color) ? MEMBERS[idx].color : 'var(--ink-muted)';
                        } else if (gl.bestMember >= 0 && MEMBERS[gl.bestMember]) {
                          memberName = MEMBERS[gl.bestMember].name;
                          memberColor = MEMBERS[gl.bestMember].color || 'var(--ink-muted)';
                        } else {
                          memberName = '—';
                          memberColor = 'var(--ink-muted)';
                        }
                        return '<tr>' +
                          '<td style="padding:3px 4px;font-weight:600;border-top:1px solid var(--hairline)">' + gl.title + '</td>' +
                          '<td style="padding:3px 4px;text-align:center;font-weight:700;color:' + riskColor + ';border-top:1px solid var(--hairline)">' + gl.maxPct + '%</td>' +
                          '<td style="padding:3px 4px;text-align:center;font-weight:700;color:' + memberColor + ';border-top:1px solid var(--hairline)">✏️ ' + memberName + '</td>' +
                        '</tr>';
                      }).join('');
                    }()}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          ` : '<div style="font-size:9px;color:var(--semantic-success);margin-bottom:6px">✅ كل المحاضرات مغطاة — فرد واحد على الأقل عارف كل محاضرة</div>'}

          <div style="display:flex;gap:4px;flex-wrap:wrap;">
            ${ch.members.map(mp => `
              <div style="display:flex;align-items:center;gap:3px;padding:3px 6px;background:${mp.m.color}10;border:1px solid ${mp.m.color}30;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-size:9px;">
                <span>${mp.m.emoji}</span>
                <span style="font-weight:800;color:${mp.m.color}">${mp.m.name.split(' ')[0]}</span>
                <span style="font-weight:900;color:${mp.pct >= 80 ? 'var(--semantic-success)' : 'var(--ink-muted)'}">${mp.pct}%</span>
              </div>
            `).join('')}
          </div>
        </div>
        `;
      }).join('')}
    </div>

  </div>`;

  c.innerHTML = html;
}
