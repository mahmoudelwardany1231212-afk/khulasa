/**
 * notifications.js — Real-time Notification System
 * Listens to Firebase 'events' node and triggers UI toasts and dedicated page updates.
 */

const NotificationsSystem = (() => {
  let isInitialized = false;
  let initialLoadDone = false;
  const events = [];

  function init() {
    if (isInitialized) return;
    if (!window._fbReady || !window._fbDb || !window.firebase_database) {
      // Retry after Firebase is ready
      if (!window._fbReady) {
        const onReady = () => { init(); };
        window.addEventListener('firebase-ready', onReady, { once: true });
      }
      return;
    }
    
    isInitialized = true;
    const { ref, query, limitToLast, onChildAdded } = window.firebase_database;
    const db = window._fbDb;

    // Listen to the last 100 events
    const eventsRef = query(ref(db, 'events'), limitToLast(100));

    // After 2 seconds, we consider the initial bulk load complete so we can show toasts for NEW events
    setTimeout(() => { initialLoadDone = true; }, 2000);

    onChildAdded(eventsRef, (snapshot) => {
      const event = snapshot.val();
      if (!event) return;
      
      // Store event locally
      events.unshift(event);
      if (events.length > 200) events.pop();

      // Render Page if it is currently visible
      if (document.getElementById('pageNotifications') && !document.getElementById('pageNotifications').classList.contains('hide')) {
        renderPage();
      }

      // Show Toast only for new events (not during initial load)
      if (initialLoadDone) {
        showAppToast(event);
      }
    });
  }

  function pushEvent(type, targetId, value) {
    if (!window._fbReady || !window._fbDb || !window.firebase_database) return;
    if (typeof store === 'undefined') return;

    const s = store.get();
    if (s.currentUser === null) return;

    try {
      const { ref, push, set } = window.firebase_database;
      const db = window._fbDb;
      
      const newEventRef = push(ref(db, 'events'));
      set(newEventRef, {
        userId: s.currentUser,
        type: type, // 'progress', 'pomodoro', 'note', etc.
        targetId: targetId || null,
        value: value,
        timestamp: Date.now()
      });
    } catch (e) {
      console.error('[Notifications] Failed to push event:', e);
    }
  }

  function getEventMessage(event) {
    if (typeof MEMBERS === 'undefined') return { text: 'حدث جديد', emoji: '🔔', clickTarget: null };
    
    const user = MEMBERS[event.userId];
    if (!user) return { text: 'حدث جديد', emoji: '🔔', clickTarget: null };

    const userName = `<span style="color:${user.color};font-weight:800">${user.name.split(' ')[0]}</span>`;

    switch (event.type) {
      case 'progress':
        const lecId = event.targetId;
        const pct = event.value;
        let lecName = 'محاضرة';
        let subjTag = '';
        let clickTarget = 'lectures';
        if (typeof LECTURES !== 'undefined') {
          const lec = LECTURES.find(l => l.id == lecId);
          if (lec) {
            lecName = lec.t;
            if (typeof SUBJECTS !== 'undefined' && typeof SUBJ_COLORS !== 'undefined') {
              const ci = SUBJECTS.indexOf(lec.s);
              const col = SUBJ_COLORS[ci] || '#888';
              const shortName = typeof SUBJ_SHORT !== 'undefined' ? (SUBJ_SHORT[lec.s] || lec.s) : lec.s;
              subjTag = `<span style="font-size:9px;color:${col};background:${col}15;padding:2px 6px;clip-path:polygon(3px 0,100% 0,calc(100% - 3px) 100%,0 100%);font-weight:800;">${shortName}</span>`;
            }
          }
        }
        
        let pctEmoji = '🌱';
        if (pct === 100) pctEmoji = '🔥';
        else if (pct >= 75) pctEmoji = '⚡';
        else if (pct >= 50) pctEmoji = '📖';

        return {
          html: `${userName} خلص ${pct}% من ${lecName} ${pctEmoji}`,
          extra: subjTag,
          clickTarget: 'lectures'
        };

      case 'pomodoro':
        const mins = Math.round(event.value / 60);
        return {
          html: `${userName} خلص جلسة تركيز ${mins} دقيقة ⏱️`,
          extra: '',
          clickTarget: 'pomodoro'
        };

      case 'note':
        return {
          html: `${userName} ضاف ملاحظة جديدة 📝`,
          extra: '',
          clickTarget: 'notes'
        };

      default:
        return {
          html: `${userName} قام بنشاط جديد ✨`,
          extra: '',
          clickTarget: null
        };
    }
  }

  function showAppToast(event) {
    // Don't show toast for my own events to avoid double notification
    if (typeof store !== 'undefined' && store.get().currentUser === event.userId) return;

    const container = document.getElementById('appNotificationContainer');
    if (!container) return;

    const msgInfo = getEventMessage(event);
    
    const toast = document.createElement('div');
    Object.assign(toast.style, {
      background: 'var(--surface-1)',
      border: '1px solid var(--accent-blue)',
      boxShadow: '0 8px 32px rgba(0, 229, 255, 0.2)',
      padding: '12px 16px',
      color: 'var(--ink)',
      fontSize: '12px',
      pointerEvents: 'auto',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      clipPath: 'polygon(10px 0, 100% 0, calc(100% - 10px) 100%, 0 100%)',
      opacity: '0',
      transform: 'translateY(-20px)',
      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    });

    const userEmoji = MEMBERS && MEMBERS[event.userId] ? MEMBERS[event.userId].emoji : '👤';

    toast.innerHTML = `
      <div style="font-size: 20px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.2));">${userEmoji}</div>
      <div style="flex:1; line-height: 1.4;">${msgInfo.html}</div>
    `;

    toast.onclick = () => {
      if (msgInfo.clickTarget && typeof navTo === 'function') {
        navTo(msgInfo.clickTarget);
      }
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(-20px)';
      setTimeout(() => toast.remove(), 400);
    };

    container.appendChild(toast);

    // Animate in
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0)';
    });

    // Auto remove after 5 seconds
    setTimeout(() => {
      if (toast.parentNode) {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
      }
    }, 5000);
  }

  function renderPage() {
    const c = document.getElementById('pageNotifications');
    if (!c) return;

    let html = `
      <div style="padding:var(--spacing-md);max-width:600px;margin:0 auto;">
        <div style="font-size:16px;font-weight:900;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:16px;display:flex;align-items:center;gap:8px;">
          <span style="font-size:24px;">🔔</span> سجل الإشعارات
        </div>
    `;

    if (events.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--ink-muted);font-size:13px;border:1px dashed var(--hairline);clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%);">لا توجد إشعارات حتى الآن...</div></div>';
      c.innerHTML = html;
      return;
    }

    html += '<div style="display:flex;flex-direction:column;gap:12px;">';
    
    events.slice(0, 100).forEach(ev => {
      const msgInfo = getEventMessage(ev);
      const userEmoji = MEMBERS && MEMBERS[ev.userId] ? MEMBERS[ev.userId].emoji : '👤';
      
      // Calculate human readable time difference
      const diffMs = Date.now() - ev.timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      let timeStr = '';
      if (diffMins < 1) timeStr = 'الآن';
      else if (diffMins < 60) timeStr = `منذ ${diffMins} دقيقة`;
      else if (diffMins < 1440) timeStr = `منذ ${Math.floor(diffMins/60)} ساعة`;
      else timeStr = `منذ ${Math.floor(diffMins/1440)} يوم`;

      const exactTime = new Date(ev.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

      html += `
        <div onclick="if('${msgInfo.clickTarget}' !== 'null') { navTo('${msgInfo.clickTarget}'); }" 
             style="display:flex; align-items:flex-start; gap:12px; padding:16px; background:var(--surface-1); border:1px solid var(--hairline); clip-path:polygon(10px 0,100% 0,calc(100% - 10px) 100%,0 100%); cursor:pointer; transition:all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);"
             onmouseover="this.style.background='var(--surface-2)'; this.style.borderColor='var(--accent-blue)'; this.style.transform='translateX(-5px)';"
             onmouseout="this.style.background='var(--surface-1)'; this.style.borderColor='var(--hairline)'; this.style.transform='translateX(0)';">
          
          <div style="font-size:24px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.1));">${userEmoji}</div>
          
          <div style="flex:1; min-width:0;">
            <div style="font-size:13px; color:var(--ink); margin-bottom:4px; line-height: 1.5;">${msgInfo.html}</div>
            <div style="display:flex; align-items:center; gap:8px;">
              <div style="font-size:10px; color:var(--ink-muted); font-weight:600;">${timeStr} • ${exactTime}</div>
              ${msgInfo.extra ? msgInfo.extra : ''}
            </div>
          </div>
          
        </div>
      `;
    });

    html += '</div></div>';
    c.innerHTML = html;
  }

  return { init, pushEvent, renderPage };
})();
