/**
 * notifications.js — Advanced Real-time Notification System
 * Includes audio feedback, swipe/close toasts, read/unread states, and reactions.
 */
const NotificationsSystem = (() => {
  let isInitialized = false;
  let initialLoadDone = false;
  const events = []; // Array of { id, data }
  let lastReadTimestamp = parseInt(localStorage.getItem('streak_lastReadNotif') || '0', 10);
  
  // Available Emojis for Reactions
  const REACTION_EMOJIS = ['🔥', '🎯', '💪', '🦷', '⚡', '✨'];

  // ── SOUND ──
  function playPopSound() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.2);
    } catch (e) {}
  }

  // ── INIT ──
  function init() {
    if (isInitialized) return;
    
    // _fbDb is set slightly after 'firebase-ready' fires (inside store.boot's onValue callback)
    // so we poll with retries to handle the race condition.
    if (!window._fbDb || !window.firebase_database) {
      let retries = 0;
      const poll = setInterval(() => {
        retries++;
        if (window._fbDb && window.firebase_database) {
          clearInterval(poll);
          _connect();
        } else if (retries > 30) { // give up after ~3 seconds
          clearInterval(poll);
          console.warn('[Notifications] Firebase not ready after 30 retries.');
        }
      }, 100);
      return;
    }
    _connect();
  }

  function _connect() {
    if (isInitialized) return;
    
    isInitialized = true;
    const { ref, query, limitToLast, onChildAdded, onChildChanged } = window.firebase_database;
    const db = window._fbDb;

    const eventsRef = query(ref(db, 'events'), limitToLast(100));

    setTimeout(() => { initialLoadDone = true; updateBadge(); }, 2000);

    onChildAdded(eventsRef, (snapshot) => {
      const eventId = snapshot.key;
      const eventData = snapshot.val();
      if (!eventData) return;
      
      const evt = { id: eventId, ...eventData };
      events.unshift(evt);
      if (events.length > 200) events.pop();
      events.sort((a,b) => b.timestamp - a.timestamp);

      if (document.getElementById('pageNotifications') && !document.getElementById('pageNotifications').classList.contains('hide')) {
        renderPage();
      }

      if (initialLoadDone) {
        if (!store || store.get().currentUser !== evt.userId) {
          playPopSound();
          showAppToast(evt);
        }
        updateBadge();
      }
    });

    // Support for reactions
    if (onChildChanged) {
      onChildChanged(eventsRef, (snapshot) => {
        const eventId = snapshot.key;
        const eventData = snapshot.val();
        if (!eventData) return;
        
        const idx = events.findIndex(e => e.id === eventId);
        if (idx !== -1) {
          events[idx] = { id: eventId, ...eventData };
          if (document.getElementById('pageNotifications') && !document.getElementById('pageNotifications').classList.contains('hide')) {
            renderPage();
          }
        }
      });
    }
  }

  // ── PUSH EVENT ──
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
        type: type,
        targetId: targetId || null,
        value: value,
        timestamp: Date.now(),
        reactions: {}
      });
    } catch (e) {
      console.error('[Notifications] Failed to push event:', e);
    }
  }

  // ── ADD REACTION ──
  function addReaction(eventId, emoji) {
    if (!window._fbReady || !window._fbDb || !window.firebase_database) return;
    if (typeof store === 'undefined') return;
    const s = store.get();
    if (s.currentUser === null) return;
    
    try {
      const { ref, update } = window.firebase_database;
      const db = window._fbDb;
      const updates = {};
      updates[`events/${eventId}/reactions/${s.currentUser}`] = emoji;
      update(ref(db), updates);
    } catch (e) {
      console.error('[Notifications] Failed to add reaction:', e);
    }
  }

  // ── BADGE UPDATER ──
  function updateBadge() {
    const unreadCount = events.filter(e => e.timestamp > lastReadTimestamp).length;
    const sidebarItem = document.querySelector('.sidebar-nav-item[data-nav="notifications"]');
    if (sidebarItem) {
      let badge = sidebarItem.querySelector('.notif-badge');
      if (unreadCount > 0) {
        if (!badge) {
          badge = document.createElement('span');
          badge.className = 'notif-badge';
          Object.assign(badge.style, {
            background: 'var(--semantic-danger, #FF003C)', color: '#fff', fontSize: '10px',
            fontWeight: '900', padding: '2px 6px', borderRadius: '10px', marginLeft: 'auto'
          });
          sidebarItem.appendChild(badge);
        }
        badge.textContent = unreadCount > 99 ? '+99' : unreadCount;
      } else {
        if (badge) badge.remove();
      }
    }
  }

  function markAllAsRead() {
    if (events.length > 0) {
      lastReadTimestamp = events[0].timestamp;
      localStorage.setItem('streak_lastReadNotif', lastReadTimestamp.toString());
      updateBadge();
      renderPage();
    }
  }

  // ── FORMATTER ──
  function getEventMessage(event) {
    const userName = MEMBERS && MEMBERS[event.userId] ? MEMBERS[event.userId].name.split(' ')[0] : 'زميل';
    let subjTag = '';
    
    switch (event.type) {
      case 'progress':
        const pct = parseFloat(event.value) || 0;
        let lecName = 'محاضرة';
        if (event.targetId && typeof LECTURES !== 'undefined') {
          const l = LECTURES.find(x => x.id == event.targetId);
          if (l) {
            lecName = l.t;
            if (typeof SUBJ_COLORS !== 'undefined' && typeof SUBJECTS !== 'undefined') {
              const ci = SUBJECTS.indexOf(l.s);
              const col = SUBJ_COLORS[ci] || '#888';
              subjTag = `<span style="font-size:9px;color:${col};font-weight:800;border:1px solid ${col}40;padding:2px 6px;border-radius:4px;">${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[l.s] || l.s : l.s}</span>`;
            }
          }
        }
        let pctEmoji = '🌱';
        let actionStr = `خلص <b style="color:var(--accent-blue)">${pct}%</b> من`;
        
        if (pct === 100) {
          pctEmoji = '🔥';
          actionStr = `قفل المحاضرة بنسبة <b style="color:var(--semantic-success)">100%</b> 👑`;
        } else if (pct >= 75) {
          pctEmoji = '⚡';
          actionStr = `شبه خلص <b style="color:var(--teal)">${pct}%</b> من`;
        } else if (pct >= 50) {
          pctEmoji = '📖';
          actionStr = `وصل لـ <b style="color:var(--gold)">${pct}%</b> في`;
        } else if (pct > 0) {
          pctEmoji = '🌱';
          actionStr = `بدأ وذاكر <b style="color:var(--rose)">${pct}%</b> من`;
        } else {
          pctEmoji = '👀';
          actionStr = `هيبدأ يذاكر`;
        }

        return {
          html: `<b>${userName}</b> ${actionStr} ${lecName} ${pctEmoji}`,
          extra: subjTag,
          clickTarget: 'lectures'
        };

      case 'pomodoro':
        const mins = Math.round(event.value / 60);
        return {
          html: `<b>${userName}</b> خلص جلسة تركيز <b style="color:var(--semantic-danger)">${mins} دقيقة</b> ⏱️`,
          extra: '',
          clickTarget: 'pomodoro'
        };

      case 'note':
        return {
          html: `<b>${userName}</b> ضاف ملاحظة جديدة 📝`,
          extra: `<div style="font-size:10px;color:var(--ink-muted);background:var(--surface-2);padding:4px;border-radius:4px;margin-top:4px;">"${event.value}"</div>`,
          clickTarget: 'notes'
        };

      default:
        return {
          html: `<b>${userName}</b> قام بنشاط جديد ✨`,
          extra: '',
          clickTarget: null
        };
    }
  }

  // ── TOAST ──
  function showAppToast(event) {
    const container = document.getElementById('appNotificationContainer');
    if (!container) return;

    const msgInfo = getEventMessage(event);
    const userEmoji = MEMBERS && MEMBERS[event.userId] ? MEMBERS[event.userId].emoji : '👤';
    
    const toast = document.createElement('div');
    Object.assign(toast.style, {
      background: 'rgba(28, 28, 30, 0.8)',
      backdropFilter: 'blur(12px)',
      WebkitBackdropFilter: 'blur(12px)',
      border: '1px solid rgba(255,255,255,0.1)',
      boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
      padding: '12px 16px',
      color: '#fff',
      fontSize: '12px',
      pointerEvents: 'auto',
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      gap: '12px',
      borderRadius: '16px',
      opacity: '0',
      transform: 'translateY(-20px) scale(0.95)',
      transition: 'all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275)'
    });

    toast.innerHTML = `
      <div style="font-size: 24px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.2));">${userEmoji}</div>
      <div style="flex:1; line-height: 1.5; font-family:'Cairo',sans-serif;">${msgInfo.html}</div>
      <div class="toast-close" style="font-size:14px;color:rgba(255,255,255,0.5);padding:4px;">✕</div>
    `;

    toast.onclick = (e) => {
      if (e.target.classList.contains('toast-close')) {
        dismissToast(toast);
        return;
      }
      if (typeof navTo === 'function') {
        navTo('notifications'); 
      }
      dismissToast(toast);
    };

    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.style.opacity = '1';
      toast.style.transform = 'translateY(0) scale(1)';
    });

    setTimeout(() => dismissToast(toast), 6000);
  }

  function dismissToast(toast) {
    if (!toast.parentNode) return;
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px) scale(0.95)';
    setTimeout(() => { if (toast.parentNode) toast.remove(); }, 400);
  }

  // ── RENDER PAGE ──
  window._addReaction = function(eventId, emoji) {
    addReaction(eventId, emoji);
  };

  function renderPage() {
    const c = document.getElementById('pageNotifications');
    if (!c) return;
    
    // Automatically update read timestamp on view
    if (events.length > 0 && events[0].timestamp > lastReadTimestamp) {
      lastReadTimestamp = events[0].timestamp;
      localStorage.setItem('streak_lastReadNotif', lastReadTimestamp.toString());
      updateBadge();
    }

    let html = `
      <div style="padding:var(--spacing-md);max-width:600px;margin:0 auto;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <div style="font-size:16px;font-weight:900;color:var(--ink);text-transform:uppercase;letter-spacing:1px;display:flex;align-items:center;gap:8px;">
            <span style="font-size:24px;">🔔</span> الإشعارات والتفاعلات
          </div>
          <button onclick="NotificationsSystem.markAllAsRead()" style="background:var(--surface-2);border:none;color:var(--ink-muted);padding:6px 12px;border-radius:20px;font-size:11px;cursor:pointer;font-weight:bold;font-family:'Cairo',sans-serif">
            تحديد الكل كمقروء ✓
          </button>
        </div>
    `;

    if (events.length === 0) {
      html += '<div style="text-align:center;padding:40px;color:var(--ink-muted);font-size:13px;border:1px dashed var(--hairline);border-radius:16px;">لا توجد إشعارات حتى الآن...</div></div>';
      c.innerHTML = html;
      return;
    }

    html += '<div style="display:flex;flex-direction:column;gap:12px;">';
    
    events.slice(0, 100).forEach(ev => {
      const msgInfo = getEventMessage(ev);
      const userEmoji = MEMBERS && MEMBERS[ev.userId] ? MEMBERS[ev.userId].emoji : '👤';
      
      const diffMs = Date.now() - ev.timestamp;
      const diffMins = Math.floor(diffMs / 60000);
      let timeStr = '';
      if (diffMins < 1) timeStr = 'الآن';
      else if (diffMins < 60) timeStr = `منذ ${diffMins} دقيقة`;
      else if (diffMins < 1440) timeStr = `منذ ${Math.floor(diffMins/60)} ساعة`;
      else timeStr = `منذ ${Math.floor(diffMins/1440)} يوم`;

      const exactTime = new Date(ev.timestamp).toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit' });
      
      const rxCount = {};
      const rxUsers = {};
      if (ev.reactions) {
        Object.keys(ev.reactions).forEach(uid => {
          const em = ev.reactions[uid];
          if (!rxCount[em]) { rxCount[em] = 0; rxUsers[em] = []; }
          rxCount[em]++;
          if (MEMBERS[uid]) rxUsers[em].push(MEMBERS[uid].name.split(' ')[0]);
        });
      }

      html += `
        <div style="background:var(--surface-1); border:1px solid var(--hairline); border-radius:16px; padding:16px; display:flex; flex-direction:column; gap:10px; box-shadow: 0 4px 12px rgba(0,0,0,0.02);">
          
          <div style="display:flex; align-items:flex-start; gap:12px;">
            <div style="font-size:24px; filter: drop-shadow(0 0 5px rgba(255,255,255,0.1));">${userEmoji}</div>
            
            <div style="flex:1; min-width:0;">
              <div style="font-size:13px; color:var(--ink); margin-bottom:4px; line-height: 1.5; font-family:'Cairo',sans-serif;">${msgInfo.html}</div>
              ${msgInfo.extra ? `<div style="margin-bottom:6px">${msgInfo.extra}</div>` : ''}
              <div style="font-size:10px; color:var(--ink-muted); font-weight:600;">${timeStr} • ${exactTime}</div>
            </div>
          </div>
          
          <!-- Reactions Bar -->
          <div style="display:flex; flex-wrap:wrap; gap:6px; margin-top:4px; align-items:center; padding-top:10px; border-top:1px dashed var(--hairline);">
            ${Object.keys(rxCount).map(em => `
              <div title="${rxUsers[em].join(', ')}" style="display:flex;align-items:center;gap:4px;background:var(--surface-2);padding:4px 8px;border-radius:12px;font-size:11px;color:var(--ink);font-weight:bold;cursor:pointer;">
                <span>${em}</span><span>${rxCount[em]}</span>
              </div>
            `).join('')}
            
            <div style="display:flex; gap:4px; margin-right:auto;">
              ${REACTION_EMOJIS.map(em => `
                <button onclick="_addReaction('${ev.id}', '${em}')" style="background:none;border:none;cursor:pointer;font-size:16px;padding:2px;transition:transform 0.2s;" onmouseover="this.style.transform='scale(1.2)'" onmouseout="this.style.transform='scale(1)'">${em}</button>
              `).join('')}
            </div>
          </div>
        </div>
      `;
    });

    html += '</div></div>';
    c.innerHTML = html;
  }

  return { init, pushEvent, renderPage, markAllAsRead };
})();
