/**
 * Meme Engagement System
 * Context-aware meme selection for the Dental Lecture Tracker
 * Only reads from local memes/ folder — never creates new content
 */

// ── MEME CATALOG ──────────────────────────────────────────────────────────────
// All 117 memes from the /memes folder, distributed by category.
// Categories: celebratory | shocked | encouraging | funny | sarcastic | easter_egg

const MEME_DB = {
  // 🎉 تحتفل - للإنجازات والـ Milestones
  celebratory: [
    "000013.jpg","000013 (2).jpg","000013 (3).jpg",
    "000021.jpg","000021 (2).jpg","000021 (3).jpg","000021 (4).jpg",
    "000025.jpg","000025 (2).jpg","000025 (3).jpg","000025 (4).jpg",
    "000031.jpg","000031 (2).jpg","000031 (3).jpg","000031 (4).jpg",
    "000040.jpg","000040 (2).jpg","000040 (3).jpg","000040 (4).jpg",
    "000043.jpg","000043 (2).jpg","000043 (3).jpg",
    "000048.jpg"
  ],
  // 😱 مصدوم - لأول مرة أو إنجاز مفاجئ
  shocked: [
    "000001.jpg","000001 (2).jpg","000001 (3).jpg","000001 (4).jpg",
    "000007.jpg","000007 (2).jpg",
    "000012.jpg","000012 (2).jpg",
    "000014.jpg",
    "000017.jpg","000017 (2).jpg","000017 (3).jpg",
    "000023.jpg","000023 (2).jpg","000023 (3).jpg","000023 (4).jpg",
    "000030.jpg","000030 (2).jpg","000030 (3).jpg","000030 (4).jpg",
    "000038.jpg","000038 (2).jpg","000038 (3).jpg"
  ],
  // 💪 مشجع - للمستخدم الكسلان أو الابتداء
  encouraging: [
    "000002.jpg","000002 (2).jpg","000002 (3).jpg",
    "000005.jpg",
    "000009.jpg","000009 (2).jpg",
    "000011.jpg","000011 (2).jpg",
    "000015.jpg",
    "000016.jpg","000016 (2).jpg",
    "000020.jpg","000020 (2).jpg","000020 (3).jpg",
    "000022.jpg",
    "000026.jpg",
    "000028.jpg","000028 (2).jpg","000028 (3).jpg",
    "000033.jpg","000033 (2).jpg",
    "000036.jpg",
    "000049.jpg"
  ],
  // 😂 ضحك - عشوائي أو بعد تصحيح خطأ
  funny: [
    "000003.jpg","000003 (2).jpg","000003 (3).jpg",
    "000004.jpg","000004 (2).jpg",
    "000006.jpg","000006 (2).jpg","000006 (3).jpg","000006 (4).jpg",
    "000008.jpg","000008 (2).jpg","000008 (3).jpg","000008 (4).jpg",
    "000018.jpg","000018 (2).jpg",
    "000024.jpg","000024 (2).jpg","000024 (3).jpg","000024 (4).jpg",
    "000027.jpg","000027 (2).jpg",
    "000029.jpg","000029 (2).jpg",
    "000032.jpg","000032 (2).jpg","000032 (3).jpg",
    "000034.jpg","000034 (2).jpg","000034 (3).jpg"
  ],
  // 😏 ساخر - للـ 0% استيعاب أو محاضرات نسيها
  sarcastic: [
    "000035.jpg","000035 (2).jpg",
    "000037.jpg","000037 (2).jpg",
    "000039.jpg","000039 (2).jpg","000039 (3).jpg",
    "000041.jpg","000041 (2).jpg",
    "000042.jpg",
    "000044.jpg","000044 (2).jpg","000044 (3).jpg",
    "000045.jpg","000045 (2).jpg",
    "000046.jpg","000046 (2).jpg",
    "000047.jpg","000047 (2).jpg"
  ],
  // 🥚 Easter Eggs - للمفاجآت العشوائية بعد محاضرات متتالية
  easter_egg: [
    "000006.jpg","000008 (4).jpg","000013 (3).jpg",
    "000021 (4).jpg","000025 (4).jpg","000031 (4).jpg",
    "000040 (4).jpg","000048.jpg","000049.jpg"
  ]
};

// Track last shown meme to avoid immediate repetition
let lastMemeFile = null;
let lecturesSinceLastMeme = 0;
const EASTER_EGG_THRESHOLD = 5; // Show easter egg every 5 lectures

// ── MEME PICKER ─────────────────────────────────────────────────────────────
function getMeme(category) {
  const pool = MEME_DB[category] || MEME_DB.funny;
  let filtered = pool.filter(f => f !== lastMemeFile);
  if (!filtered.length) filtered = pool;
  const chosen = filtered[Math.floor(Math.random() * filtered.length)];
  lastMemeFile = chosen;
  return 'memes/' + encodeURIComponent(chosen);
}

// ── MEME CONTEXT SELECTOR ────────────────────────────────────────────────────
function getMemeForContext(context, pct) {
  lecturesSinceLastMeme++;

  // Easter egg every N lectures (overrides everything)
  if (lecturesSinceLastMeme >= EASTER_EGG_THRESHOLD) {
    lecturesSinceLastMeme = 0;
    return { src: getMeme('easter_egg'), label: '🥚 مفاجأة!' };
  }

  switch(context) {
    case 'first_lecture':
      return { src: getMeme('shocked'), label: 'أول محاضرة! 🎯' };
    case 'complete_100':
      return { src: getMeme('celebratory'), label: 'فاهمها 100%! 🔥' };
    case 'complete_75':
      return { src: getMeme('encouraged'), label: 'تمام يا دكتور! 💪' };
    case 'complete_50':
      return { src: getMeme('funny'), label: 'ذاكرها تاني! 😅' };
    case 'complete_25':
      return { src: getMeme('sarcastic'), label: 'مش كفاية يا حبيب! 😏' };
    case 'complete_0':
      return { src: getMeme('sarcastic'), label: 'انت محتاج تشتري ورق 📝' };
    case 'milestone_10':
      return { src: getMeme('funny'), label: '10 محاضرات! دايرة معاك 🌀' };
    case 'milestone_25':
      return { src: getMeme('encouraging'), label: '25 محاضرة! ماشي كويس 🚀' };
    case 'milestone_50':
      return { src: getMeme('celebratory'), label: 'نص المنهج! وحش 💪' };
    case 'milestone_100':
      return { src: getMeme('celebratory'), label: '100 محاضرة! أسطورة 👑' };
    case 'milestone_all':
      return { src: getMeme('celebratory'), label: 'خلصت كل حاجة! 🏆' };
    case 'beat_friend':
      return { src: getMeme('celebratory'), label: 'عديت زميلك! 🥇' };
    case 'surpassed':
      return { src: getMeme('shocked'), label: 'عدوك قدامك! 😱' };
    case 'login':
      return { src: getMeme('encouraging'), label: 'أهلاً بيك! 💪' };
    case 'idle':
      return { src: getMeme('sarcastic'), label: 'فين ما بعيد! 👀' };
    default:
      return { src: getMeme('funny'), label: 'عاش! 😄' };
  }
}

// ── MEME MODAL ───────────────────────────────────────────────────────────────
let memeTimer = null;

function showMeme(context, pct, caption, autoClose = true) {
  const meme = getMemeForContext(context, pct);
  const modal = document.getElementById('memeModal');
  const img = document.getElementById('memeImg');
  const cap = document.getElementById('memeCaption');
  const badge = document.getElementById('memeBadge');

  img.src = meme.src;
  if (cap) cap.textContent = caption || meme.label;
  if (badge) badge.textContent = meme.label;

  modal.classList.add('show');

  // Auto-close after 4 seconds
  clearTimeout(memeTimer);
  if (autoClose) {
    memeTimer = setTimeout(() => closeMeme(), 4000);
  }
}

function closeMeme() {
  const modal = document.getElementById('memeModal');
  if (modal) modal.classList.remove('show');
  clearTimeout(memeTimer);
}

// ── MILESTONE CHECKER ────────────────────────────────────────────────────────
let lastMilestone = 0;
function checkMilestone(done) {
  const milestones = [1, 10, 25, 50, 75, 100, 159];
  for (const m of milestones) {
    if (done === m && lastMilestone < m) {
      lastMilestone = m;
      const ctx = m === 1 ? 'first_lecture'
        : m === 10 ? 'milestone_10'
        : m === 25 ? 'milestone_25'
        : m === 50 ? 'milestone_50'
        : m === 100 ? 'milestone_100'
        : m === 159 ? 'milestone_all'
        : null;
      if (ctx) return ctx;
    }
  }
  return null;
}
