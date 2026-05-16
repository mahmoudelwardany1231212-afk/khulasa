/**
 * notifications.js — Real-time Notification System
 * Listens to Firebase 'events' node and triggers UI toasts and sidebar updates.
 */

const NotificationsSystem = (() => {
  let isInitialized = false;
  let initialLoadDone = false;
  const events = [];

  function init() {
    if (isInitialized) return;
    if (!window._fbReady || !window._fbDb || !window.firebase_database) return;
    
    isInitialized = true;
    const { ref, query, limitToLast, onChildAdded } = window.firebase_database;
    const db = window._fbDb;

    // Listen to the last 30 events
    const eventsRef = query(ref(db, 'events'), limitToLast(30));

    // After 2 seconds, we consider the initial bulk load complete so we can show toasts for NEW events
    setTimeout(() => { initialLoadDone = true; }, 2000);

    onChildAdded(eventsRef, (snapshot) => {
      const event = snapshot.val();
      if (!event) return;
      
      // Store event locally
      events.unshift(event);
      if (events.length > 50) events.pop();

      // Render Sidebar
      renderSidebarNotifications();

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
        let clickTarget = 'lectures';
        if (typeof LECTURES !== 'undefined') {
          const lec = LECTURES.find(l => l.id == lecId);
          if (lec) lecName = lec.t;
        }
        
        let pctEmoji = '🌱';
        if (pct === 100) pctEmoji = '🔥';
        else if (pct >= 75) pctEmoji = '⚡';
        else if (pct >= 50) pctEmoji = '📖';

        return {
          html: `${userName} خلص ${pct}% من ${lecName} ${pctEmoji}`,
          clickTarget: 'lectures'
        };

      case 'pomodoro':
        const mins = Math.round(event.value / 60);
        return {
          html: `${userName} خلص جلسة تركيز ${mins} دقيقة ⏱️`,
          clickTarget: 'pomodoro'
        };

      case 'note':
        return {
          html: `${userName} ضاف ملاحظة جديدة 📝`,
          clickTarget: 'notes'
        };

      default:
        return {
          html: `${userName} قام بنشاط جديد ✨`,
          clickTarget: null
        };
    }
  }

  function showAppToast(event) {
    // Don't show toast for my own events to avoid double notification (since I already get the main toast)
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

  function renderSidebarNotifications() {
    const container = document.getElementById('sidebarNotifications');
    if (!container) return;

    if (events.length === 0) {
      container.innerHTML = '<div style="font-size:11px;color:var(--ink-muted);text-align:center;padding:10px;">لا توجد أحداث بعد</div>';
      return;
    }

    let html = '';
    events.slice(0, 15).forEach(ev => {
      const msgInfo = getEventMessage(ev);
      const userEmoji = MEMBERS && MEMBERS[ev.userId] ? MEMBERS[ev.userId].emoji : '👤';
      
      const timeStr = new Date(ev.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });

      html += `
        <div onclick="if('${msgInfo.clickTarget}' !== 'null') { navTo('${msgInfo.clickTarget}'); closeSidebar(); }" 
             style="display:flex; align-items:flex-start; gap:8px; padding:8px 10px; background:rgba(255,255,255,0.03); border:1px solid var(--hairline); clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%); cursor:pointer; transition:all 0.2s;"
             onmouseover="this.style.background='rgba(0, 229, 255, 0.1)'; this.style.borderColor='var(--accent-blue)';"
             onmouseout="this.style.background='rgba(255,255,255,0.03)'; this.style.borderColor='var(--hairline)';">
          <div style="font-size:16px;">${userEmoji}</div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:11px; color:var(--ink); margin-bottom:2px; line-height: 1.4;">${msgInfo.html}</div>
            <div style="font-size:9px; color:var(--ink-muted);">${timeStr}</div>
          </div>
        </div>
      `;
    });

    container.innerHTML = html;
  }

  return { init, pushEvent };
})();
