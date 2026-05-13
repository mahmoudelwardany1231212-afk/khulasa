/**
 * pomodoro.js — Pomodoro Timer, Stopwatch, Session History
 * FIXED: Timestamp-based timer (survives screen lock & tab switch)
 * FIXED: State persisted in localStorage → restored on page load/logout
 * FIXED: Page Visibility API re-syncs time when tab becomes visible again
 */

const PomodoroModule = (() => {
  let _timer = null;
  let _state = {
    mode: 'idle',         // 'idle' | 'running' | 'paused' | 'done'
    seconds: 0,           // calculated from timestamps
    target: 25 * 60,
    type: 'pomodoro',
    running: false,
    startedAt: null,      // epoch ms when timer last started/resumed
    pausedTotalMs: 0,     // total ms spent in paused state
    pausedAt: null        // epoch ms when current pause began
  };
  let _onTick = null;

  const DEFAULTS = { workMin: 25, breakMin: 5, longBreakMin: 15, sessionsBeforeLong: 4 };

  function getPrefs() { return LS.get('pomo_prefs', DEFAULTS); }
  function setPrefs(p) { LS.set('pomo_prefs', p); }

  // ── Calculate elapsed seconds from timestamps (screen-lock safe) ──
  function _calcSeconds() {
    if (!_state.startedAt) return _state.seconds;
    const pausedMs = (_state.pausedTotalMs || 0);
    return Math.floor((Date.now() - _state.startedAt - pausedMs) / 1000);
  }

  // ── Persist running state to localStorage ──
  function _persistState() {
    try {
      const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
      localStorage.setItem('_pomo_state', JSON.stringify({ ..._state, _savedUserId: uid }));
    } catch(e) {}
  }

  function _clearPersistedState() {
    try { localStorage.removeItem('_pomo_state'); } catch(e) {}
  }

  // ── Restore timer state on page load (survives logout/refresh) ──
  function _restoreState() {
    try {
      const raw = localStorage.getItem('_pomo_state');
      if (!raw) return;
      const saved = JSON.parse(raw);

      // Only restore if it was actually running
      if (!saved.running || !saved.startedAt || saved.mode !== 'running') return;

      const pausedMs = saved.pausedTotalMs || 0;
      const elapsed = Math.floor((Date.now() - saved.startedAt - pausedMs) / 1000);

      // If a finite timer already finished while we were away, don't restore
      if (saved.type !== 'stopwatch' && elapsed >= saved.target) {
        _clearPersistedState();
        return;
      }

      _state = { ...saved, seconds: elapsed };
      _timer = setInterval(_tick, 1000);
      _notify();
    } catch(e) {}
  }

  function start(type = 'pomodoro') {
    const p = getPrefs();
    stop(false);
    _state.type = type;
    if (type === 'pomodoro') _state.target = p.workMin * 60;
    else if (type === 'break') _state.target = p.breakMin * 60;
    else if (type === 'longbreak') _state.target = p.longBreakMin * 60;
    else if (type === 'stopwatch') _state.target = Infinity;
    _state.seconds = 0;
    _state.running = true;
    _state.mode = 'running';
    _state.startedAt = Date.now();
    _state.pausedTotalMs = 0;
    _state.pausedAt = null;
    _persistState();
    _timer = setInterval(_tick, 1000);
    _notify();
  }

  function pause() {
    _state.running = !_state.running;
    _state.mode = _state.running ? 'running' : 'paused';
    if (_state.running) {
      // Resuming: account for paused duration
      if (_state.pausedAt) {
        _state.pausedTotalMs = (_state.pausedTotalMs || 0) + (Date.now() - _state.pausedAt);
        _state.pausedAt = null;
      }
      _timer = setInterval(_tick, 1000);
    } else {
      // Pausing: record when pause started
      _state.pausedAt = Date.now();
      clearInterval(_timer);
    }
    _persistState();
    _notify();
  }

  function stop(save = true) {
    clearInterval(_timer);
    if (save && _state.seconds > 30) {
      _saveSession();
    }
    _state = {
      mode: 'idle', seconds: 0, target: 25 * 60,
      type: 'pomodoro', running: false,
      startedAt: null, pausedTotalMs: 0, pausedAt: null
    };
    _clearPersistedState();
    _notify();
  }

  function _tick() {
    // Timestamp-based: immune to setInterval drift & screen lock
    if (_state.startedAt) {
      _state.seconds = Math.floor(
        (Date.now() - _state.startedAt - (_state.pausedTotalMs || 0)) / 1000
      );
    } else {
      _state.seconds++;
    }

    if (_state.type !== 'stopwatch' && _state.seconds >= _state.target) {
      _onComplete();
    } else {
      _persistState();
      _notify();
    }
  }

  function _onComplete() {
    clearInterval(_timer);
    _state.mode = 'done';
    _state.running = false;
    _saveSession();
    _clearPersistedState();
    // Browser notification
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('⏰ الخلاصة', {
        body: _state.type === 'pomodoro' ? 'وقت الراحة!' : 'يلا نرجع للمذاكرة!'
      });
    }
    // Audio beep
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      osc.type = 'sine'; osc.frequency.value = 880;
      osc.connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.3);
    } catch {}
    _notify();
  }

  function _saveSession() {
    const uid = typeof store !== 'undefined' ? store.get().currentUser : null;
    const session = {
      id: LS.uid(),
      type: _state.type,
      duration: _state.seconds,
      date: LS.today(),
      timestamp: _state.startedAt || Date.now(),
      userId: uid
    };
    LS.push('pomo_sessions', session, 1000);

    // ── Firebase sync: save pomodoro sessions per user ──
    if (uid !== null && typeof window._writeUserData === 'function') {
      const all = LS.get('pomo_sessions', []);
      // Keep last 200 sessions in Firebase (to avoid huge payloads)
      const recent = all.slice(-200);
      window._writeUserData(uid, { pomo_sessions: recent });
    }

    // Award XP
    if (typeof Gamification !== 'undefined' && _state.type === 'pomodoro' && _state.seconds >= _state.target * 0.8) {
      Gamification.addXP(25, 'pomodoro_complete');
    }
  }

  function getSessions(days = 30) {
    const all = LS.get('pomo_sessions', []);
    const cutoff = Date.now() - days * 86400000;
    return all.filter(s => s.timestamp > cutoff);
  }

  function getTodaySessions() {
    const today = LS.today();
    return LS.get('pomo_sessions', []).filter(s => s.date === today);
  }

  function getTodayMinutes() {
    return Math.round(getTodaySessions().reduce((sum, s) => sum + s.duration, 0) / 60);
  }

  function getState() { return { ..._state }; }
  function onUpdate(fn) { _onTick = fn; }
  function _notify() { if (_onTick) _onTick(_state); }

  function formatTime(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  }

  function requestNotifPermission() {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }

  // ── Page Visibility API: re-sync time when tab becomes active ──
  // This is the core fix for screen lock / app switcher scenarios
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && _state.running && _state.startedAt) {
      clearInterval(_timer);
      const pausedMs = _state.pausedTotalMs || 0;
      _state.seconds = Math.floor((Date.now() - _state.startedAt - pausedMs) / 1000);

      if (_state.type !== 'stopwatch' && _state.seconds >= _state.target) {
        _onComplete();
      } else {
        _timer = setInterval(_tick, 1000);
        _notify();
      }
    }
  });

  // Restore any in-progress timer from before page load / logout
  _restoreState();

  return {
    start, pause, stop,
    getState, getSessions, getTodaySessions, getTodayMinutes,
    getPrefs, setPrefs, onUpdate, formatTime, requestNotifPermission,
    DEFAULTS
  };
})();


// ── POMODORO UI RENDERER ──
function renderPomodoroPage() {
  const c = document.getElementById('pagePomodoro');
  if (!c) return;

  const st = PomodoroModule.getState();
  const prefs = PomodoroModule.getPrefs();
  const todayMins = PomodoroModule.getTodayMinutes();
  const todaySessions = PomodoroModule.getTodaySessions();
  const isRunning = st.mode === 'running';
  const isPaused = st.mode === 'paused';
  const isDone = st.mode === 'done';
  const isIdle = st.mode === 'idle';

  const elapsed = st.seconds;
  const remaining = st.type === 'stopwatch' ? elapsed : Math.max(0, st.target - elapsed);
  const progress = st.type === 'stopwatch' ? 0 : Math.min(100, (elapsed / st.target) * 100);

  const timerColor = st.type === 'pomodoro' ? 'var(--semantic-danger)' : st.type === 'stopwatch' ? 'var(--accent-blue)' : 'var(--semantic-success)';
  const displayTime = PomodoroModule.formatTime(st.type === 'stopwatch' ? elapsed : remaining);

  let html = `
    <div style="padding:var(--spacing-md);max-width:500px;margin:0 auto;">
      <!-- Timer Display -->
      <div style="text-align:center;padding:30px 0;">
        <div style="position:relative;width:200px;height:200px;margin:0 auto;">
          <svg width="200" height="200" style="transform:rotate(-90deg)">
            <circle cx="100" cy="100" r="90" stroke="var(--surface-2)" stroke-width="8" fill="none"/>
            <circle cx="100" cy="100" r="90" stroke="${timerColor}" stroke-width="8" fill="none"
              stroke-dasharray="${2 * Math.PI * 90}" stroke-dashoffset="${2 * Math.PI * 90 * (1 - progress / 100)}"
              stroke-linecap="round" style="transition:stroke-dashoffset .5s"/>
          </svg>
          <div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;">
            <div style="font-size:36px;font-weight:900;color:var(--ink);font-family:'Inter',monospace;letter-spacing:2px;text-shadow:0 0 15px ${timerColor}50">${displayTime}</div>
            <div style="font-size:11px;color:${timerColor};text-transform:uppercase;font-weight:800;letter-spacing:2px;margin-top:4px">
              ${st.type === 'pomodoro' ? '🍅 تركيز' : st.type === 'stopwatch' ? '⏱️ ساعة إيقاف' : st.type === 'break' ? '☕ راحة' : '🌴 راحة طويلة'}
            </div>
          </div>
        </div>
      </div>

      <!-- Controls -->
      <div style="display:flex;gap:8px;justify-content:center;margin-bottom:20px;">
        ${isIdle || isDone ? `
          <button onclick="PomodoroModule.start('pomodoro');PomodoroModule.requestNotifPermission()" style="flex:1;max-width:120px;padding:12px;background:var(--semantic-danger);color:var(--canvas);border:none;font-size:13px;font-weight:800;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif;text-transform:uppercase;letter-spacing:1px">🍅 تركيز</button>
          <button onclick="PomodoroModule.start('break')" style="flex:1;max-width:120px;padding:12px;background:var(--semantic-success);color:#000;border:none;font-size:13px;font-weight:800;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif;text-transform:uppercase;letter-spacing:1px">☕ راحة</button>
          <button onclick="PomodoroModule.start('stopwatch')" style="flex:1;max-width:120px;padding:12px;background:var(--accent-blue);color:#000;border:none;font-size:13px;font-weight:800;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif;text-transform:uppercase;letter-spacing:1px">⏱️ حر</button>
        ` : `
          <button onclick="PomodoroModule.pause()" style="flex:1;max-width:140px;padding:14px;background:${isPaused ? 'var(--accent-blue)' : '#FFB300'};color:#000;border:none;font-size:14px;font-weight:900;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif;text-transform:uppercase;letter-spacing:1px">${isPaused ? '▶ استمر' : '⏸ وقف'}</button>
          <button onclick="PomodoroModule.stop()" style="flex:1;max-width:140px;padding:14px;background:var(--surface-2);color:var(--ink);border:1px solid var(--hairline);font-size:14px;font-weight:900;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif;text-transform:uppercase;letter-spacing:1px">⏹ إنهاء</button>
        `}
      </div>

      <!-- Today Stats -->
      <div style="display:flex;gap:8px;margin-bottom:16px;">
        <div style="flex:1;background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
          <div style="font-size:20px;font-weight:900;color:var(--accent-blue)">${todayMins}</div>
          <div style="font-size:9px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:1px;font-weight:700">دقيقة اليوم</div>
        </div>
        <div style="flex:1;background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
          <div style="font-size:20px;font-weight:900;color:var(--semantic-success)">${todaySessions.filter(s=>s.type==='pomodoro').length}</div>
          <div style="font-size:9px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:1px;font-weight:700">🍅 جلسة تركيز</div>
        </div>
        <div style="flex:1;background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);text-align:center;">
          <div style="font-size:20px;font-weight:900;color:#FFB300">${Math.round(todaySessions.reduce((s,x)=>s+x.duration,0)/3600*10)/10}</div>
          <div style="font-size:9px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:1px;font-weight:700">ساعة إجمالي</div>
        </div>
      </div>

      <!-- Settings -->
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin-bottom:16px;">
        <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">⚙️ إعدادات المؤقت</div>
        <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px;">
          <span style="font-size:11px;color:var(--ink-muted);flex:1">وقت التركيز</span>
          <select id="pomoWork" onchange="PomodoroModule.setPrefs({...PomodoroModule.getPrefs(),workMin:+this.value})" style="background:var(--surface-2);color:var(--ink);border:1px solid var(--hairline);padding:4px 8px;font-size:12px;font-family:'Cairo',sans-serif">
            ${[15,20,25,30,45,60].map(m=>`<option value="${m}" ${prefs.workMin===m?'selected':''}>${m} دقيقة</option>`).join('')}
          </select>
        </div>
        <div style="display:flex;gap:8px;align-items:center;">
          <span style="font-size:11px;color:var(--ink-muted);flex:1">وقت الراحة</span>
          <select id="pomoBreak" onchange="PomodoroModule.setPrefs({...PomodoroModule.getPrefs(),breakMin:+this.value})" style="background:var(--surface-2);color:var(--ink);border:1px solid var(--hairline);padding:4px 8px;font-size:12px;font-family:'Cairo',sans-serif">
            ${[3,5,10,15].map(m=>`<option value="${m}" ${prefs.breakMin===m?'selected':''}>${m} دقيقة</option>`).join('')}
          </select>
        </div>
      </div>

      <!-- Presence Panel (Who's Focusing) -->
      <div id="pomoPresencePanel"></div>

      <!-- Music Player -->
      <div id="pomoMusicPlayer"></div>

      <!-- Recent Sessions -->
      ${todaySessions.length > 0 ? `
        <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📋 جلسات اليوم</div>
        ${todaySessions.slice(-5).reverse().map(s => `
          <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;">
            <span style="font-size:14px">${s.type === 'pomodoro' ? '🍅' : s.type === 'stopwatch' ? '⏱️' : '☕'}</span>
            <span style="flex:1;font-size:11px;color:var(--ink-muted);font-weight:600">${new Date(s.timestamp).toLocaleTimeString('ar-EG',{hour:'2-digit',minute:'2-digit'})}</span>
            <span style="font-size:12px;font-weight:900;color:var(--accent-blue);font-family:'Inter',sans-serif">${PomodoroModule.formatTime(s.duration)}</span>
          </div>
        `).join('')}
      ` : ''}
    </div>`;

  c.innerHTML = html;
  // Re-render music UI (preserves playing state across timer ticks)
  if (typeof PomoMusic !== 'undefined') PomoMusic.renderMusicUI();
  // Re-render presence panel
  if (typeof PresenceModule !== 'undefined') PresenceModule.renderPresencePanel(document.getElementById('pomoPresencePanel'));
}

// Auto-update: render UI + canvas + music (single combined callback)

// ══════════════════════════════════════════════════════
// POMO BACKGROUND CANVAS — Racing Speed Lines (SpaceX / Aerospace Theme)
// ══════════════════════════════════════════════════════
const PomoCanvas = (() => {
  let canvas, ctx, raf, lines = [], active = false;
  const LINE_COUNT = 70;

  function init() {
    if (canvas) return;
    canvas = document.createElement('canvas');
    canvas.id = 'pomoCanvas';
    Object.assign(canvas.style, {
      position: 'fixed', top: '0', left: '0',
      width: '100%', height: '100%',
      pointerEvents: 'none', zIndex: '1',
      opacity: '0', transition: 'opacity 1.2s ease'
    });
    document.body.appendChild(canvas);
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', resize);
  }

  function resize() {
    if (!canvas) return;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }

  function makeLine(color) {
    return {
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      length: Math.random() * 150 + 50,
      speed: Math.random() * 12 + 4,
      alpha: Math.random() * 0.3 + 0.05,
      thickness: Math.random() * 1.5 + 0.5,
      color
    };
  }

  function getColor(type) {
    if (type === 'pomodoro') return '255,60,80'; // Racing Red
    if (type === 'break' || type === 'longbreak') return '0,255,136'; // Success Green
    return '0,229,255'; // Aerospace Blue
  }

  function draw() {
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const st = PomodoroModule.getState();
    const col = getColor(st.type);

    lines.forEach(p => {
      p.x -= p.speed; // move leftwards simulating forward speed
      if (p.x + p.length < 0) {
        p.x = canvas.width;
        p.y = Math.random() * canvas.height;
        p.speed = Math.random() * 12 + 4; // randomize speed on reset
      }

      ctx.beginPath();
      // Gradient for speed line effect
      const grad = ctx.createLinearGradient(p.x, p.y, p.x + p.length, p.y);
      grad.addColorStop(0, `rgba(${col}, 0)`);
      grad.addColorStop(0.5, `rgba(${col}, ${p.alpha})`);
      grad.addColorStop(1, `rgba(${col}, 0)`);

      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x + p.length, p.y);
      ctx.strokeStyle = grad;
      ctx.lineWidth = p.thickness;
      ctx.stroke();
    });

    raf = requestAnimationFrame(draw);
  }

  function show(type) {
    init();
    const col = getColor(type);
    lines = Array.from({ length: LINE_COUNT }, () => makeLine(col));
    active = true;
    canvas.style.opacity = '1';
    if (!raf) draw();
  }

  function hide() {
    active = false;
    if (canvas) canvas.style.opacity = '0';
    setTimeout(() => { cancelAnimationFrame(raf); raf = null; }, 1300);
  }

  return { show, hide };
})();

// Combined onUpdate: render + canvas animation
PomodoroModule.onUpdate(st => {
  renderPomodoroPage();
  if (st.mode === 'running') PomoCanvas.show(st.type);
  else PomoCanvas.hide();
});

// ══════════════════════════════════════════════════════
// FOCUS MUSIC PLAYER
// ══════════════════════════════════════════════════════
const PomoMusic = (() => {
  const TRACKS = [
    { id: 'lofi',    label: '🎵 Lo-Fi Hip Hop',      ytId: 'jfKfPfyJRdk' },
    { id: 'nature',  label: '🌧️ Rain & Nature',      ytId: 'q76bMs-NwRk' },
    { id: 'deep',    label: '🧠 Deep Focus',          ytId: 'WPni755-Krg' },
    { id: 'coffee',  label: '☕ Coffee Shop',         ytId: '5qap5aO4i9A' },
    { id: 'alpha',   label: '🌊 Alpha Waves',         ytId: 'Dm2lGP6EbHw' },
  ];

  let currentTrack = null;
  let volume = 40;
  let iframe = null;
  let playing = false;

  function getContainer() { return document.getElementById('pomoMusicPlayer'); }

  function buildIframe(ytId) {
    // Remove old iframe
    const old = document.getElementById('pomoYTFrame');
    if (old) old.remove();
    iframe = document.createElement('iframe');
    iframe.id = 'pomoYTFrame';
    // volume param isn't standard in YouTube iframe embed but we keep it just in case; YouTube JS API is normally needed for volume control.
    iframe.src = `https://www.youtube.com/embed/${ytId}?autoplay=1&loop=1&playlist=${ytId}&controls=0&mute=0`;
    iframe.setAttribute('allow', 'autoplay');
    Object.assign(iframe.style, {
      width: '1px', height: '1px', border: 'none', position: 'absolute', opacity: '0.01', pointerEvents: 'none'
    });
    document.body.appendChild(iframe);
    playing = true;
  }

  function play(trackId) {
    const t = TRACKS.find(x => x.id === trackId) || TRACKS[0];
    currentTrack = t.id;
    buildIframe(t.ytId);
    renderMusicUI();
  }

  function stop() {
    const f = document.getElementById('pomoYTFrame');
    if (f) f.remove();
    iframe = null; playing = false; currentTrack = null;
    renderMusicUI();
  }

  function renderMusicUI() {
    const el = getContainer();
    if (!el) return;
    el.innerHTML = `
      <div style="background:var(--surface-1);border:1px solid var(--hairline);padding:12px;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);margin-bottom:16px;">
        <div style="font-size:11px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px">🎧 موسيقى التركيز</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px;">
          ${TRACKS.map(t => `
            <button onclick="PomoMusic.play('${t.id}')"
              style="padding:6px 10px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid ${currentTrack===t.id?'var(--accent-blue)':'var(--hairline)'};background:${currentTrack===t.id?'rgba(0,229,255,0.12)':'var(--surface-2)'};color:${currentTrack===t.id?'var(--accent-blue)':'var(--ink-muted)'};font-family:'Cairo',sans-serif;clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%);transition:all .2s">
              ${t.label}
            </button>`).join('')}
        </div>
        ${playing ? `
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:10px;color:var(--semantic-success);animation:pulse 1.5s infinite;font-weight:700">▶ يشغل</span>
            <input type="range" min="0" max="100" value="${volume}" oninput="PomoMusic.setVol(+this.value)"
              style="flex:1;accent-color:var(--accent-blue);height:3px;cursor:pointer">
            <button onclick="PomoMusic.stop()"
              style="padding:4px 10px;font-size:11px;font-weight:700;cursor:pointer;border:1px solid var(--semantic-danger);background:transparent;color:var(--semantic-danger);font-family:'Cairo',sans-serif;clip-path:polygon(5px 0,100% 0,calc(100% - 5px) 100%,0 100%)">
              ⏹ إيقاف
            </button>
          </div>` : ''}
      </div>`;
  }

  function setVol(v) {
    volume = v;
    // Reload iframe with new volume by replacing src
    if (iframe) {
      const t = TRACKS.find(x => x.id === currentTrack);
      if (t) iframe.src = `https://www.youtube.com/embed/${t.ytId}?autoplay=1&loop=1&playlist=${t.ytId}&controls=0&volume=${v}`;
    }
  }

  function init() { renderMusicUI(); }

  return { play, stop, setVol, init, renderMusicUI };
})();

