/**
 * tasks.js — Lecture-Driven Tasks, Weekly Goals, Subject Selection
 * Tasks are generated FROM lecture data, not independently.
 */

const Tasks = (() => {
  // Today's chosen subject
  function getTodaySubject() { return LS.get('today_subject', null); }
  function setTodaySubject(subj) { LS.set('today_subject', subj); }

  // Custom tasks (user-created)
  function getCustomTasks() { return LS.get('custom_tasks', []); }
  function addCustomTask(text) {
    LS.push('custom_tasks', { id: LS.uid(), text, done: false, date: LS.today(), createdAt: Date.now() }, 100);
  }
  function toggleCustomTask(id) {
    LS.update('custom_tasks', arr => { const t = arr.find(x => x.id === id); if (t) t.done = !t.done; return arr; }, []);
  }
  function removeCustomTask(id) { LS.update('custom_tasks', arr => arr.filter(x => x.id !== id), []); }

  // Weekly goal (lectures per week)
  function getWeeklyGoal() {
    const wStart = _getWeekStart();
    const wg = LS.get('weekly_goal', null);
    if (!wg || wg.weekStart !== wStart) return { target: 10, weekStart: wStart };
    return wg;
  }
  function setWeeklyTarget(t) { const wg = getWeeklyGoal(); wg.target = t; LS.set('weekly_goal', wg); }
  function _getWeekStart() { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().split('T')[0]; }

  // Get pending lectures for a subject
  function getPendingLectures(subject) {
    if (typeof store === 'undefined' || typeof LECTURES === 'undefined') return [];
    const s = store.get();
    if (s.currentUser === null) return [];
    const p = s.progress[s.currentUser] || {};
    let lecs = LECTURES.filter(l => {
      const val = p[l.id];
      return val === undefined || parseFloat(val) <= 0;
    });
    if (subject && subject !== 'all') lecs = lecs.filter(l => l.s === subject);
    return lecs;
  }

  // Get weak lectures (done but ≤50%)
  function getWeakLectures(subject) {
    if (typeof store === 'undefined' || typeof LECTURES === 'undefined') return [];
    const s = store.get();
    if (s.currentUser === null) return [];
    const p = s.progress[s.currentUser] || {};
    let lecs = LECTURES.filter(l => {
      const val = p[l.id];
      return val !== undefined && parseFloat(val) > 0 && parseFloat(val) <= 50;
    }).map(l => ({ ...l, pct: parseFloat(p[l.id]) }));
    if (subject && subject !== 'all') lecs = lecs.filter(l => l.s === subject);
    return lecs;
  }

  // Get done count this week (from Firebase progress)
  function getWeeklyDoneCount() {
    // We can't track exact "this week" without timestamps in Firebase,
    // so we use total done as a proxy - users understand this
    if (typeof store === 'undefined' || typeof LECTURES === 'undefined') return 0;
    const s = store.get();
    if (s.currentUser === null) return 0;
    const p = s.progress[s.currentUser] || {};
    return LECTURES.filter(l => p[l.id] !== undefined && parseFloat(p[l.id]) > 0).length;
  }

  return { getTodaySubject, setTodaySubject, getCustomTasks, addCustomTask, toggleCustomTask, removeCustomTask, getWeeklyGoal, setWeeklyTarget, getPendingLectures, getWeakLectures, getWeeklyDoneCount };
})();


// ── TASKS PAGE RENDERER (Lecture-Driven) ──
function renderTasksPage() {
  const c = document.getElementById('pageTasks');
  if (!c) return;

  const todaySubj = Tasks.getTodaySubject();
  const wg = Tasks.getWeeklyGoal();
  const totalDone = Tasks.getWeeklyDoneCount();
  const customTasks = Tasks.getCustomTasks().filter(t => t.date === LS.today() || !t.done);

  // Subject stats
  const subjStats = typeof SUBJECTS !== 'undefined' ? SUBJECTS.map(s => {
    const pending = Tasks.getPendingLectures(s);
    const weak = Tasks.getWeakLectures(s);
    return { subj: s, pending: pending.length, weak: weak.length };
  }) : [];

  const selectedPending = todaySubj ? Tasks.getPendingLectures(todaySubj) : [];
  const selectedWeak = todaySubj ? Tasks.getWeakLectures(todaySubj) : [];

  let html = `<div style="padding:var(--spacing-md);">

    <!-- Weekly Progress -->
    <div style="background:linear-gradient(135deg,rgba(0,229,255,0.05),transparent);border:1px solid var(--accent-blue);padding:14px;clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px">🎯 إجمالي المحاضرات</div>
        <div style="font-size:14px;font-weight:900;color:var(--accent-blue)">${totalDone}/${typeof LECTURES !== 'undefined' ? LECTURES.length : '?'}</div>
      </div>
      <div style="height:6px;background:var(--surface-2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${typeof LECTURES !== 'undefined' ? Math.round(totalDone/LECTURES.length*100) : 0}%;background:var(--accent-blue);transition:width .5s;border-radius:3px"></div>
      </div>
    </div>

    <!-- Subject Selector: "اختار مادة النهاردة" -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">📚 اختار مادة النهاردة</div>
    <div style="display:flex;gap:4px;overflow-x:auto;margin-bottom:14px;scrollbar-width:none;padding-bottom:4px;">
      ${subjStats.map((ss, si) => {
        const isOn = todaySubj === ss.subj;
        const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[si] || '#888' : '#888';
        return `<div onclick="Tasks.setTodaySubject('${isOn ? '' : ss.subj}');renderTasksPage()" style="
          flex-shrink:0;padding:8px 14px;font-size:11px;font-weight:800;cursor:pointer;
          clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);
          background:${isOn ? col + '22' : 'var(--surface-1)'};
          color:${isOn ? col : 'var(--ink-muted)'};
          border:1px solid ${isOn ? col : 'var(--hairline)'};
          box-shadow:${isOn ? `0 0 10px ${col}40` : 'none'};transition:all .2s;white-space:nowrap;
        ">${isOn ? '✓ ' : ''}${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[ss.subj] || ss.subj : ss.subj} <span style="opacity:0.6;font-size:9px">(${ss.pending} ناقصة)</span></div>`;
      }).join('')}
    </div>

    ${todaySubj ? `
      <!-- Pending Lectures for Selected Subject -->
      <div style="font-size:12px;font-weight:800;color:var(--accent-blue);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">
        📋 محاضرات ناقصة في ${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[todaySubj] || todaySubj : todaySubj} (${selectedPending.length})
      </div>
      ${selectedPending.length === 0 ? '<div style="text-align:center;padding:20px;color:var(--semantic-success);font-size:12px;font-weight:700">🏆 خلصت كل المحاضرات في المادة دي!</div>' : `
        ${selectedPending.slice(0, 15).map(l => {
          const ci = typeof SUBJECTS !== 'undefined' ? SUBJECTS.indexOf(l.s) : 0;
          const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[ci] || '#888' : '#888';
          return `<div onclick="toggleLecture(${l.id})" style="display:flex;align-items:center;gap:8px;padding:10px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;cursor:pointer;">
            <div style="width:18px;height:18px;border-radius:50%;border:2px solid var(--hairline);flex-shrink:0"></div>
            <div style="flex:1;min-width:0;">
              <div style="font-size:11px;font-weight:600;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${l.t}</div>
              <div style="font-size:9px;color:var(--ink-muted)">${l.q}</div>
            </div>
            ${l.u ? `<a href="${l.u}" target="_blank" onclick="event.stopPropagation()" style="font-size:10px;color:var(--accent-blue);text-decoration:none;flex-shrink:0">🔗</a>` : ''}
          </div>`;
        }).join('')}
        ${selectedPending.length > 15 ? `<div style="text-align:center;font-size:10px;color:var(--ink-muted);padding:8px">+${selectedPending.length - 15} محاضرات أخرى</div>` : ''}
      `}

      <!-- Weak lectures -->
      ${selectedWeak.length > 0 ? `
        <div style="font-size:12px;font-weight:800;color:var(--semantic-danger);text-transform:uppercase;letter-spacing:1px;margin:14px 0 8px">🔄 محتاجة مراجعة (≤50%) — ${selectedWeak.length}</div>
        ${selectedWeak.map(l => {
          const pctCol = l.pct <= 25 ? 'var(--semantic-danger)' : '#FFB300';
          return `<div onclick="toggleLecture(${l.id})" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);border-right:3px solid ${pctCol};clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;cursor:pointer">
            <div style="font-size:12px;font-weight:900;color:${pctCol};width:28px;text-align:center;font-family:'Inter',sans-serif">${l.pct}%</div>
            <div style="flex:1;font-size:11px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.t}</div>
          </div>`;
        }).join('')}
      ` : ''}
    ` : `
      <div style="text-align:center;padding:40px 20px;color:var(--ink-muted)">
        <div style="font-size:36px;margin-bottom:10px">📚</div>
        <div style="font-size:13px;font-weight:700">اختار مادة من فوق</div>
        <div style="font-size:11px;margin-top:4px;opacity:0.6">هيظهرلك المحاضرات الناقصة واللي محتاجة مراجعة</div>
      </div>
    `}

    <!-- Custom Tasks -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin:16px 0 8px">✏️ مهام شخصية</div>
    <div style="display:flex;gap:6px;margin-bottom:10px;">
      <input id="taskInput" type="text" placeholder="أضف مهمة..." style="flex:1;padding:10px;background:#000;border:1px solid var(--accent-blue);color:var(--ink);font-size:12px;font-family:'Cairo',sans-serif;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);outline:none">
      <button onclick="_addCustomTask()" style="padding:10px 14px;background:var(--accent-blue);color:#000;border:none;font-weight:900;cursor:pointer;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);font-family:'Cairo',sans-serif;font-size:12px">+</button>
    </div>
    ${customTasks.map(t => `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;${t.done ? 'opacity:0.5;' : ''}">
        <div onclick="Tasks.toggleCustomTask('${t.id}');renderTasksPage()" style="width:20px;height:20px;border-radius:50%;border:2px solid ${t.done ? 'var(--semantic-success)' : 'var(--hairline)'};display:flex;align-items:center;justify-content:center;cursor:pointer;flex-shrink:0;background:${t.done ? 'var(--semantic-success)' : 'transparent'};font-size:11px;color:#000">${t.done ? '✓' : ''}</div>
        <div style="flex:1;font-size:11px;font-weight:600;color:var(--ink);${t.done ? 'text-decoration:line-through;' : ''}">${t.text}</div>
        <div onclick="Tasks.removeCustomTask('${t.id}');renderTasksPage()" style="cursor:pointer;font-size:12px;color:var(--ink-muted);padding:4px">✕</div>
      </div>
    `).join('')}
  </div>`;

  c.innerHTML = html;
}

function _addCustomTask() {
  const input = document.getElementById('taskInput');
  if (!input || !input.value.trim()) return;
  Tasks.addCustomTask(input.value.trim());
  input.value = '';
  renderTasksPage();
}
