import json
import os

def finalize():
    # 1. Load Data
    with open('tmp_data.js', 'r', encoding='utf-8') as f:
        data_js = f.read()
    
    # 2. Part 1: Top of file up to where data_js goes
    part1 = r"""<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <title>الخلاصة في المصاصاة 🦷 — Standalone</title>
  <link href="https://fonts.googleapis.com/css2?family=Cairo:wght@300;400;600;700;900&family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
  <style>
    :root { --navy: #0D1B3E; --navy2: #162455; --teal: #00C9D4; --teal2: #007A85; --gold: #F5C842; --gold2: #C49A10; --rose: #FF4D8D; --rose2: #B5005E; --green: #00D68F; --bg: #090e1c; --card: rgba(255, 255, 255, 0.06); --border: rgba(255, 255, 255, 0.08); --txt: rgba(255, 255, 255, 0.88); --txt2: rgba(255, 255, 255, 0.5); --txt3: rgba(255, 255, 255, 0.3) }
    * { margin: 0; padding: 0; box-sizing: border-box; -webkit-tap-highlight-color: transparent }
    body { background: var(--bg); min-height: 100dvh; font-family: 'Cairo', sans-serif; color: var(--txt); overflow-x: hidden; padding-bottom: 72px }
    .hide { display: none !important }
    .user-select { min-height: 100dvh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px; gap: 20px }
    .us-title { font-size: 28px; font-weight: 900; text-align: center; background: linear-gradient(90deg, var(--gold), #FFF59D, var(--gold)); -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text }
    .us-sub { color: var(--txt2); font-size: 13px; text-align: center }
    .us-cards { display: flex; flex-direction: column; gap: 12px; width: 100%; max-width: 360px }
    .us-card { background: var(--card); border: 1.5px solid var(--border); border-radius: 16px; padding: 18px 20px; display: flex; align-items: center; gap: 14px; cursor: pointer; transition: all .25s }
    .us-card:hover { transform: scale(1.03); border-color: rgba(255, 255, 255, 0.2) }
    .us-av { width: 48px; height: 48px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 22px; flex-shrink: 0 }
    .app-header { position: sticky; top: 0; z-index: 100; background: linear-gradient(180deg, var(--bg) 0%, rgba(9, 14, 28, 0.95) 100%); backdrop-filter: blur(12px); padding: 14px 16px 10px; display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--border) }
    .ah-back { width: 36px; height: 36px; border-radius: 10px; background: var(--card); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 16px; cursor: pointer; color: var(--txt2) }
    .ah-info { flex: 1 } .ah-name { font-size: 15px; font-weight: 700 } .ah-stat { font-size: 11px; color: var(--txt2); font-family: 'Inter', sans-serif }
    .ah-pct { font-size: 22px; font-weight: 900; font-family: 'Inter', sans-serif; color: var(--teal) }
    .tabs { display: flex; gap: 4px; padding: 8px 16px; position: sticky; top: 62px; z-index: 99; background: var(--bg) }
    .tab { flex: 1; padding: 9px 6px; border-radius: 10px; text-align: center; font-size: 12px; font-weight: 700; cursor: pointer; background: var(--card); border: 1px solid var(--border); color: var(--txt2); transition: all .2s }
    .tab.on { background: linear-gradient(135deg, var(--teal2), var(--teal)); color: white; border-color: var(--teal) }
    .filters { padding: 8px 16px; display: flex; flex-direction: column; gap: 8px }
    .filter-row { display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; scrollbar-width: none }
    .filter-row::-webkit-scrollbar { display: none }
    .chip { padding: 6px 12px; border-radius: 20px; font-size: 11px; font-weight: 700; white-space: nowrap; cursor: pointer; background: var(--card); border: 1px solid var(--border); color: var(--txt2); transition: all .2s; flex-shrink: 0 }
    .chip.on { background: rgba(0, 201, 212, 0.15); border-color: var(--teal); color: var(--teal) }
    .chip-q.on { background: rgba(245, 200, 66, 0.15); border-color: var(--gold); color: var(--gold) }
    .subj-progress { padding: 0 16px 8px; display: flex; flex-direction: column; gap: 6px }
    .sp-row { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 600 }
    .sp-nm { flex: 1; color: var(--txt2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis }
    .sp-bar { flex: 2; height: 6px; border-radius: 3px; background: rgba(255, 255, 255, 0.06); overflow: hidden }
    .sp-fill { height: 100%; border-radius: 3px; transition: width .4s }
    .sp-pct { width: 36px; text-align: left; font-family: 'Inter', sans-serif; color: var(--txt2); font-size: 10px }
    .lec-list { padding: 0 16px 16px; display: flex; flex-direction: column; gap: 8px }
    .lec { background: var(--card); border: 1.5px solid var(--border); border-radius: 14px; padding: 12px 14px; display: flex; align-items: flex-start; gap: 12px; cursor: pointer; transition: all .2s; position: relative; overflow: hidden; animation: pop .3s ease both }
    .lec:active { transform: scale(0.98) }
    .lec.done { border-color: rgba(0, 214, 143, 0.3) }
    .lec-check { width: 28px; height: 28px; border-radius: 8px; border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; flex-shrink: 0; font-size: 14px; transition: all .2s; margin-top: 2px }
    .lec.done .lec-check { background: var(--green); border-color: var(--green); color: white }
    .lec-info { flex: 1; min-width: 0 }
    .lec-title { font-size: 13px; font-weight: 700; line-height: 1.4 }
    .lec-meta { display: flex; gap: 8px; margin-top: 4px; flex-wrap: wrap }
    .lec-tag { font-size: 9px; padding: 2px 8px; border-radius: 10px; font-weight: 600; font-family: 'Inter', sans-serif }
    .lt-quiz { background: rgba(245, 200, 66, 0.1); color: var(--gold) }
    .lb-page { padding: 16px }
    .lb-title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: var(--txt3); text-align: center; margin-bottom: 12px; font-family: 'Inter', sans-serif }
    .lb-cards { display: flex; flex-direction: column; gap: 10px }
    .lb-card { background: var(--card); border: 1.5px solid var(--border); border-radius: 16px; padding: 16px; position: relative; overflow: hidden }
    .lb-card::before { content: ''; position: absolute; top: 0; left: 0; right: 0; height: 3px }
    .lb-card.r1::before { background: linear-gradient(90deg, var(--gold2), var(--gold), #FFF59D, var(--gold)) }
    .lb-card.r2::before { background: linear-gradient(90deg, #888, #ccc, #888) }
    .lb-card.r3::before { background: linear-gradient(90deg, #8B4513, #CD853F, #8B4513) }
    .lb-top { display: flex; align-items: center; gap: 12px; margin-bottom: 10px }
    .lb-rank { font-size: 28px; line-height: 1 }
    .lb-av { width: 42px; height: 42px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 20px }
    .lb-nm { font-size: 15px; font-weight: 700; flex: 1 }
    .lb-total { text-align: left; font-family: 'Inter', sans-serif }
    .lb-total .n { font-size: 22px; font-weight: 900; color: var(--teal) }
    .lb-total .d { font-size: 10px; color: var(--txt3) }
    .lb-bar-wrap { height: 8px; border-radius: 4px; background: rgba(255, 255, 255, 0.06); overflow: hidden; margin-bottom: 8px }
    .lb-bar-fill { height: 100%; border-radius: 4px; transition: width .5s }
    .lb-subjects { display: grid; grid-template-columns: 1fr 1fr; gap: 4px }
    .lb-subj { font-size: 10px; color: var(--txt2); display: flex; justify-content: space-between; padding: 2px 6px; border-radius: 4px; background: rgba(255, 255, 255, 0.03) }
    .lb-subj span:last-child { font-family: 'Inter', sans-serif; font-weight: 600 }
    .search-wrap { padding: 0 16px 4px; position: relative }
    .search-input { width: 100%; padding: 10px 14px 10px 38px; border-radius: 12px; border: 1px solid var(--border); background: var(--card); color: var(--txt); font-family: 'Cairo', sans-serif; font-size: 13px; font-weight: 600; outline: none; transition: border-color .2s }
    .search-input:focus { border-color: var(--teal) }
    .search-icon { position: absolute; right: 28px; top: 50%; transform: translateY(-50%); font-size: 15px; color: var(--txt3); pointer-events: none }
    .toast { position: fixed; top: -100px; left: 50%; transform: translateX(-50%); z-index: 9999; padding: 12px 20px; border-radius: 14px; font-size: 13px; font-weight: 700; text-align: center; max-width: 92%; transition: top .4s cubic-bezier(0.34, 1.56, 0.64, 1); pointer-events: none }
    .toast.show { top: 16px }
    .toast-success { background: linear-gradient(135deg, #0a3d2a, #0d4a33); border: 1px solid rgba(0, 214, 143, 0.3); color: var(--green) }
    .toast-warn { background: linear-gradient(135deg, #3d2a0a, #4a330d); border: 1px solid rgba(245,200,66,0.3); color: var(--gold) }
    .toast-fire { background: linear-gradient(135deg, #3d0a0a, #4a0d0d); border: 1px solid rgba(255,77,141,0.3); color: var(--rose) }
    .level-banner { margin: 0 16px 8px; padding: 14px 16px; border-radius: 14px; display: flex; align-items: center; gap: 12px; position: relative; overflow: hidden }
    .level-banner .lb-emoji { font-size: 28px; line-height: 1 }
    .level-banner .lb-text { flex: 1 }
    .level-banner .lb-phrase { font-size: 14px; font-weight: 900 }
    .level-banner .lb-level { font-size: 10px; font-weight: 600; font-family: 'Inter', sans-serif; opacity: 0.7 }
    .lb-lv1 { background: linear-gradient(135deg, rgba(0, 201, 212, 0.1), rgba(0, 201, 212, 0.05)); border: 1px solid rgba(0, 201, 212, 0.15); color: var(--teal) }
    .lb-lv2 { background: linear-gradient(135deg, rgba(0, 214, 143, 0.1), rgba(0, 214, 143, 0.05)); border: 1px solid rgba(0, 214, 143, 0.15); color: var(--green) }
    .lb-lv3 { background: linear-gradient(135deg, rgba(245, 200, 66, 0.1), rgba(245, 200, 66, 0.05)); border: 1px solid rgba(245, 200, 66, 0.15); color: var(--gold) }
    .lb-lv4 { background: linear-gradient(135deg, rgba(0, 122, 133, 0.15), rgba(13, 27, 62, 0.15)); border: 1px solid rgba(0, 201, 212, 0.2); color: var(--teal) }
    .lb-lv5 { background: linear-gradient(135deg, rgba(139, 92, 246, 0.12), rgba(23, 0, 64, 0.15)); border: 1px solid rgba(139, 92, 246, 0.25); color: #c4b5fd }
    .lb-lv6 { background: linear-gradient(135deg, rgba(245, 200, 66, 0.15), rgba(196, 154, 16, 0.1)); border: 1px solid rgba(245, 200, 66, 0.3); color: var(--gold) }
    @keyframes pop { 0% { transform: scale(0.8); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
    .modal-overlay { position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(9, 14, 28, 0.85); backdrop-filter: blur(10px); z-index: 99999; display: flex; align-items: center; justify-content: center; opacity: 0; pointer-events: none; transition: all .3s }
    .modal-overlay.show { opacity: 1; pointer-events: all }
    .modal-box { background: var(--bg); border: 1px solid var(--border); border-radius: 24px; width: 90%; max-width: 340px; padding: 24px; transform: translateY(20px); transition: all .3s; box-shadow: 0 24px 48px rgba(0,0,0,0.5); position: relative }
    .modal-overlay.show .modal-box { transform: translateY(0) }
    .m-title { font-size: 18px; font-weight: 900; margin-bottom: 8px; text-align: center }
    .m-sub { font-size: 12px; color: var(--txt2); margin-bottom: 20px; text-align: center; line-height: 1.5 }
    .m-close { position: absolute; top: 16px; left: 16px; width: 30px; height: 30px; border-radius: 50%; background: rgba(255, 255, 255, 0.05); display: flex; align-items: center; justify-content: center; font-size: 14px; cursor: pointer; color: var(--txt3); z-index: 1 }
    .pct-btn { width: 100%; padding: 14px; border-radius: 14px; background: rgba(255, 255, 255, 0.04); border: 1px solid var(--border); color: var(--txt); display: flex; align-items: center; justify-content: space-between; cursor: pointer; margin-bottom: 8px; transition: all .2s; font-family: 'Cairo', sans-serif; font-size: 13px; font-weight: 700; outline: none; }
    .pct-btn:hover { background: rgba(255, 255, 255, 0.08); border-color: rgba(255, 255, 255, 0.2) }
    .pct-btn .p-val { font-size: 14px; font-weight: 900; font-family: 'Inter', sans-serif }
  </style>
</head>
<body>

  <!-- MODALS -->
  <div class="modal-overlay" id="pinModal">
    <div class="modal-box">
      <div class="m-close" onclick="closePinModal()">✕</div>
      <div class="m-title" id="pinTitle">كلمة المرور</div>
      <div class="m-sub">أدخل الرقم السري الخاص بك</div>
      <input type="password" inputmode="numeric" id="pinInput" style="width:100%;background:rgba(255,255,255,0.05);border:1px solid var(--border);border-radius:12px;padding:14px;color:var(--teal);font-size:24px;text-align:center;letter-spacing:8px;outline:none;font-family:'Inter',sans-serif" maxlength="4" placeholder="••••" oninput="checkPin()">
      <div id="pinError" style="color:var(--rose);font-size:11px;text-align:center;margin-top:8px;opacity:0;transition:opacity .2s">الرقم غير صحيح</div>
    </div>
  </div>

  <div class="modal-overlay" id="pctModal">
    <div class="modal-box">
      <div class="m-close" onclick="closePctModal()">✕</div>
      <div class="m-title">نسبة الاستيعاب 🧠</div>
      <div class="m-sub">حدد نسبة فهمك للمحاضرة</div>
      <button class="pct-btn" onclick="selectPct(100)" style="border-color:rgba(0,214,143,0.3)"><span>كفاية يا عالمي انت لخصت الخلاصة</span><span class="p-val" style="color:var(--green)">100%</span></button>
      <button class="pct-btn" onclick="selectPct(75)"><span>حل عليها كفاية كدة</span><span class="p-val">75%</span></button>
      <button class="pct-btn" onclick="selectPct(50)"><span>ذاكرها كمان مرة هتثبت</span><span class="p-val">50%</span></button>
      <button class="pct-btn" onclick="selectPct(25)"><span>مش كفاية تتذاكر مرة واحدة</span><span class="p-val">25%</span></button>
      <button class="pct-btn" onclick="selectPct(0)" style="border-color:rgba(255,77,141,0.3)"><span>انت محتاج تشتري ورق</span><span class="p-val" style="color:var(--rose)">0%</span></button>
      <button class="pct-btn" onclick="selectPct(null)" style="margin-top:8px;color:var(--txt3);border-style:dashed;"><span>إلغاء التحديد</span><span>✕</span></button>
    </div>
  </div>

  <div class="modal-overlay" id="confirmModal">
    <div class="modal-box" style="max-width:320px">
      <div class="m-title" id="confirmTitle">تأكيد الشراء 🏗️</div>
      <div class="m-sub" id="confirmText">هل تأكدت من شراء هذه المحاضرة؟ سيتم إزالتها من قائمة النواقص تلقائياً.</div>
      <div style="display:flex;gap:10px;margin-top:10px">
        <button class="pct-btn" id="confirmBtn" style="flex:1;justify-content:center;background:rgba(0,214,143,0.12);border-color:rgba(0,214,143,0.3);color:var(--green)">تأكيد</button>
        <button class="pct-btn" onclick="closeConfirmModal()" style="flex:1;justify-content:center;color:var(--txt2);background:rgba(255,255,255,0.04)">تراجع</button>
      </div>
    </div>
  </div>

  <div id="userSelect" class="user-select">
    <div style="font-size:48px">🦷</div>
    <div class="us-title">الخلاصة في المصاصاة</div>
    <div class="us-sub">اختار اسمك عشان تبدأ تتبع المحاضرات</div>
    <div class="us-cards" id="usCards"></div>
  </div>

  <div id="mainApp" class="hide">
    <div class="app-header">
      <div class="ah-back" onclick="logout()">👤</div>
      <div class="ah-info"><div class="ah-name" id="ahName"></div><div class="ah-stat" id="ahStat"></div></div>
      <div class="ah-pct" id="ahPct"></div>
    </div>
    <div class="tabs">
      <div class="tab on" data-tab="lectures" onclick="switchTab('lectures')">📚 المحاضرات</div>
      <div class="tab" data-tab="leaderboard" onclick="switchTab('leaderboard')">🏆 المنافسة</div>
      <div class="tab" data-tab="buy" onclick="switchTab('buy')">💸 لازم تشتريها</div>
    </div>
    <div class="toast" id="toast"></div>
    <div id="pageLectures">
      <div class="search-wrap"><span class="search-icon">🔍</span><input class="search-input" id="searchInput" type="text" placeholder="ابحث عن محاضرة..." oninput="onSearch()"></div>
      <div class="filters"><div class="filter-row" id="subjFilters"></div><div class="filter-row" id="quizFilters"></div></div>
      <div id="levelBanner"></div>
      <div class="subj-progress" id="subjProgress"></div>
      <div class="lec-list" id="lecList"></div>
    </div>
    <div id="pageLeaderboard" class="hide"><div class="lb-page"><div class="lb-title">🔥 LEADERBOARD — ترتيب الأعضاء</div><div class="lb-cards" id="lbCards"></div></div></div>
    <div id="pageBuy" class="hide"><div class="lb-page"><div class="lb-title">💸 محاضرات لازم تشتريها</div><div class="lb-cards" id="buyCards"></div></div></div>
  </div>

<script>
"""
    
    # 3. Part 2: Bottom of file after data_js
    part2 = r"""
  const SUBJ_COLORS = ["#00C9D4", "#F5C842", "#FF4D8D", "#00D68F", "#8B5CF6", "#EC4899", "#3B82F6", "#10B981"];
  const SUBJ_SHORT = { "Perio": "Perio", "Medicine": "Medicine", "Surgery": "Surgery", "Prosthesis": "Prosthesis", "Operative": "Operative", "Fixed Prosth.": "Fixed", "Endo": "Endo", "العلاج التحفظي": "تحفظي", "التركيبات الثابتة": "ثابتة", "علاج الجذور": "جذور", "جراحة الفم والوجه والفك والتجميل (Surgery)": "جراحة", "استعاضة صناعية (Prosthesis)": "استعاضة", "طب الفم وأمراض اللثة (Perio)": "لثة", "طب الفم (Medicine)": "طب فم" };
  const SUBJECTS = [...new Set(LECTURES.map(l => l.s))];
  const QUIZZES = ["كويز 1", "بين كويز 1 و 2", "كويز 2", "بعد كويز 2"];
  const LEVEL_NAMES = ["المستوى 0: البداية", "المستوى 1: المثابر", "المستوى 2: المجتهد", "المستوى 3: المتفوق", "المستوى 4: العملاق", "المستوى 5: الأسطورة", "المستوى 6: الخلاصة"];
  const EMOJIS = [ ["🌱","☘️"], ["📖","✍️"], ["🔥","⚡"], ["🚀","🌟"], ["👑","🏆"], ["💎","🌌"], ["🧠","🦷"] ];
  const PHRASES = [ ["البداية دايماً صعبة، استمر!"], ["خطوة كويسة، كمل يا بطل"], ["الحماس شغال، عاش جداً"], ["انت في الطريق الصحيح"], ["مستوى مذهل، لا يتوقف!"], ["أداء أسطوري، قربت تخلص"], ["انت الخلاصة في المصاصة!"] ];
  
  let currentUser = null;
  let filterSubj = 'all';
  let filterQuiz = 'all';
  let searchQuery = '';

  function getLevel(p) { if(p>=100)return 6; if(p>=85)return 5; if(p>=70)return 4; if(p>=50)return 3; if(p>=30)return 2; if(p>=10)return 1; return 0; }

  // ── TOAST ──────────────────────────────────────────
  let toastTimer = null;
  function showToast(msg, type = 'success') {
    const el = document.getElementById('toast');
    el.className = 'toast toast-' + type;
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
  }

  // ── STORAGE ────────────────────────────────────────
  function getProgress(uid) {
    try { return JSON.parse(localStorage.getItem('streak_p_' + uid) || '{}'); } catch { return {}; }
  }
  function setProgress(uid, data) {
    localStorage.setItem('streak_p_' + uid, JSON.stringify(data));
  }

  // ── APP NAVIGATION ──────────────────────────────────
  function buildUserSelect() {
    const c = document.getElementById('usCards');
    c.innerHTML = MEMBERS.map((m, i) => `
      <div class="us-card" onclick="openPinModal(${i})" style="border-color:${m.color}22">
        <div class="us-av" style="background:${m.color}18">${m.emoji}</div>
        <div><div class="nm" style="color:${m.color}">${m.name}</div><div class="rl">${m.roleAr}</div></div>
      </div>`).join('');
  }

  function openPinModal(uid) {
    window._pendingUid = uid;
    document.getElementById('pinTitle').textContent = MEMBERS[uid].name;
    document.getElementById('pinModal').classList.add('show');
    document.getElementById('pinInput').value = '';
    document.getElementById('pinInput').focus();
  }
  function closePinModal() { document.getElementById('pinModal').classList.remove('show'); }
  function checkPin() {
    const v = document.getElementById('pinInput').value;
    if (v.length === 4) {
      if (v === (MEMBERS[window._pendingUid].pin || '1234')) {
        selectUser(window._pendingUid);
        closePinModal();
      } else {
        document.getElementById('pinError').style.opacity = '1';
        setTimeout(() => document.getElementById('pinError').style.opacity = '0', 2000);
        document.getElementById('pinInput').value = '';
      }
    }
  }

  function selectUser(i) {
    currentUser = i;
    localStorage.setItem('streak_user', i);
    document.getElementById('userSelect').classList.add('hide');
    document.getElementById('mainApp').classList.remove('hide');
    initApp();
  }
  function logout() {
    localStorage.removeItem('streak_user');
    location.reload();
  }

  function switchTab(tab) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === tab));
    document.getElementById('pageLectures').classList.toggle('hide', tab !== 'lectures');
    document.getElementById('pageLeaderboard').classList.toggle('hide', tab !== 'leaderboard');
    document.getElementById('pageBuy').classList.toggle('hide', tab !== 'buy');
    if (tab === 'leaderboard') renderLeaderboard();
    if (tab === 'buy') renderBuyList();
  }

  // ── RENDERING ──────────────────────────────────────
  function initApp() {
    buildFilters();
    updateUI();
  }
  function updateUI() {
    renderHeader();
    renderLevelBanner();
    renderSubjProgress();
    renderLectures();
  }

  function renderHeader() {
    const m = MEMBERS[currentUser];
    const p = getProgress(currentUser);
    const done = Object.values(p).filter(v => v >= 50).length;
    const pct = Math.round((done / LECTURES.length) * 100);
    document.getElementById('ahName').textContent = m.name;
    document.getElementById('ahName').style.color = m.color;
    document.getElementById('ahStat').textContent = `${done} / ${LECTURES.length} مكتملة`;
    document.getElementById('ahPct').textContent = pct + '%';
  }

  function renderLevelBanner() {
    const p = getProgress(currentUser);
    const done = Object.values(p).filter(v => v >= 50).length;
    const pct = Math.round((done / LECTURES.length) * 100);
    const lv = getLevel(pct);
    document.getElementById('levelBanner').innerHTML = `
      <div class="level-banner lb-lv${lv+1}">
        <div class="lb-emoji">${EMOJIS[lv][0]}</div>
        <div class="lb-text">
          <div class="lb-phrase">${PHRASES[lv][0]}</div>
          <div class="lb-level">${LEVEL_NAMES[lv]} — ${done}/${LECTURES.length}</div>
        </div>
      </div>`;
  }

  function buildFilters() {
    const sf = document.getElementById('subjFilters');
    sf.innerHTML = `<div class="chip on" onclick="setSubjFilter('all')">الكل</div>` +
      SUBJECTS.map((s, i) => `<div class="chip" onclick="setSubjFilter('${s}')">${SUBJ_SHORT[s] || s}</div>`).join('');
    const qf = document.getElementById('quizFilters');
    qf.innerHTML = `<div class="chip chip-q on" onclick="setQuizFilter('all')">الكل</div>` +
      QUIZZES.map(q => `<div class="chip chip-q" onclick="setQuizFilter('${q}')">${q}</div>`).join('');
  }
  function setSubjFilter(v) { 
    filterSubj = v; 
    document.querySelectorAll('#subjFilters .chip').forEach(c => c.classList.toggle('on', c.textContent === (v==='all'?'الكل':(SUBJ_SHORT[v]||v))));
    updateUI();
  }
  function setQuizFilter(v) { 
    filterQuiz = v; 
    document.querySelectorAll('#quizFilters .chip').forEach(c => c.classList.toggle('on', c.textContent === (v==='all'?'الكل':v)));
    updateUI();
  }
  function onSearch() { searchQuery = document.getElementById('searchInput').value.toLowerCase(); renderLectures(); }

  function renderSubjProgress() {
    const p = getProgress(currentUser);
    const subjs = filterSubj === 'all' ? SUBJECTS.slice(0, 5) : [filterSubj];
    document.getElementById('subjProgress').innerHTML = subjs.map(s => {
      const total = LECTURES.filter(l => l.s === s).length;
      const done = LECTURES.filter(l => l.s === s && p[l.id] >= 50).length;
      const pct = Math.round((done/total)*100) || 0;
      const color = SUBJ_COLORS[SUBJECTS.indexOf(s)] || '#888';
      return `<div class="sp-row"><div class="sp-nm">${SUBJ_SHORT[s]}</div><div class="sp-bar"><div class="sp-fill" style="width:${pct}%;background:${color}"></div></div><div class="sp-pct">${done}/${total}</div></div>`;
    }).join('');
  }

  function renderLectures() {
    const p = getProgress(currentUser);
    let lecs = LECTURES.filter(l => (filterSubj==='all' || l.s===filterSubj) && (filterQuiz==='all' || l.q===filterQuiz));
    if (searchQuery) lecs = lecs.filter(l => l.t.toLowerCase().includes(searchQuery));
    document.getElementById('lecList').innerHTML = lecs.map(l => {
      const val = p[l.id];
      const isDone = val >= 50;
      const color = SUBJ_COLORS[SUBJECTS.indexOf(l.s)] || '#888';
      return `<div class="lec ${isDone?'done':''}" onclick="openPctModal(${l.id})" style="${isDone?`border-color:${color}44`:''}">
        <div class="lec-check" style="${isDone?`background:${color};border-color:${color}`:''}"> ${isDone?'✓':''} </div>
        <div class="lec-info">
          <div class="lec-title">${l.t}</div>
          <div class="lec-meta">
            <span class="lec-tag" style="background:${color}15;color:${color}">${SUBJ_SHORT[l.s]}</span>
            <span class="lec-tag lt-quiz">${l.q}</span>
            ${val !== undefined ? `<span class="lec-tag" style="background:rgba(255,255,255,0.05)">${val}%</span>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');
  }

  // ── MODAL LOGIC ──────────────────────────────────────
  let _activeLecId = null;
  function openPctModal(id) { _activeLecId = id; document.getElementById('pctModal').classList.add('show'); }
  function closePctModal() { document.getElementById('pctModal').classList.remove('show'); }
  function selectPct(val) {
    const p = getProgress(currentUser);
    if (val === null) delete p[_activeLecId]; else p[_activeLecId] = val;
    setProgress(currentUser, p);
    closePctModal();
    if (val === 100) showToast('عاش يا بطل! 🚀', 'success');
    updateUI();
  }

  function renderLeaderboard() {
    const data = MEMBERS.map((m, i) => {
      const p = getProgress(i);
      const done = LECTURES.filter(l => p[l.id] >= 50).length;
      return { m, done, pct: Math.round((done/LECTURES.length)*100) };
    }).sort((a,b) => b.done - a.done);
    document.getElementById('lbCards').innerHTML = data.map((d, i) => `
      <div class="lb-card r${i+1}">
        <div class="lb-top">
          <div class="lb-rank">${i<3?['🥇','🥈','🥉'][i]:'🎖️'}</div>
          <div class="lb-av" style="background:${d.m.color}20">${d.m.emoji}</div>
          <div class="lb-nm" style="color:${d.m.color}">${d.m.name}</div>
          <div class="lb-total"><div class="n">${d.pct}%</div><div class="d">${d.done}/${LECTURES.length}</div></div>
        </div>
        <div class="lb-bar-wrap"><div class="lb-bar-fill" style="width:${d.pct}%;background:${d.m.color}"></div></div>
      </div>`).join('');
  }

  function renderBuyList() {
    const data = MEMBERS.map((m, i) => {
      const p = getProgress(i);
      const buy = LECTURES.filter(l => p[l.id] === 0);
      return { m, buy, i };
    }).filter(d => d.buy.length > 0);
    document.getElementById('buyCards').innerHTML = data.map(d => `
      <div class="lb-card" style="border-color:${d.m.color}44">
        <div class="lb-nm" style="color:${d.m.color};margin-bottom:8px">${d.m.emoji} ${d.m.name}</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${d.buy.map(l => `<div style="font-size:12px;background:rgba(255,255,255,0.03);padding:8px;border-radius:8px;display:flex;justify-content:space-between;align-items:center">
            <span>${l.t}</span>
            ${d.i === currentUser ? `<button onclick="event.stopPropagation();markAsBought(${l.id})" style="background:var(--green);border:none;color:white;padding:4px 8px;border-radius:6px;font-size:10px;cursor:pointer">تم الشراء ✅</button>` : ''}
          </div>`).join('')}
        </div>
      </div>`).join('');
  }

  function markAsBought(id) {
    window._buyId = parseInt(id);
    document.getElementById('confirmModal').classList.add('show');
    document.getElementById('confirmBtn').onclick = () => {
      const uid = parseInt(currentUser);
      const lid = parseInt(window._buyId);
      const p = getProgress(uid);
      delete p[lid];
      setProgress(uid, p);
      document.getElementById('confirmModal').classList.remove('show');
      showToast('مبروك يا دكتور! كدة المحاضرة اتشالت 👍', 'success');
      renderBuyList();
      updateUI();
    };
  }
  function closeConfirmModal() { document.getElementById('confirmModal').classList.remove('show'); }

  // ── BOOT ──────────────────────────────────────────
  buildUserSelect();
  const saved = localStorage.getItem('streak_user');
  if (saved !== null) selectUser(parseInt(saved));
</script>
</body>
</html>
"""
    
    # Final write
    with open(r'e:\contant\program\الخلاصة في المصاصة\deploy\index.html', 'w', encoding='utf-8') as f:
        f.write(part1 + data_js + part2)
    print("Restore complete.")

if __name__ == '__main__':
    finalize()
