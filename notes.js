/**
 * notes.js — Lecture-Linked Notes, Bookmarks, Per-Lecture Notes Modal
 * Everything is bidirectionally linked to the lecture system.
 */

const Notes = (() => {
  // Per-lecture notes
  function getNote(lecId) { return LS.get('note_' + lecId, ''); }
  function setNote(lecId, text) {
    if (text && text.trim()) LS.set('note_' + lecId, text.trim());
    else LS.del('note_' + lecId);
  }
  function getAllNotedLectures() {
    const noted = [];
    if (typeof LECTURES === 'undefined') return noted;
    LECTURES.forEach(l => {
      const n = getNote(l.id);
      if (n) noted.push({ lec: l, note: n });
    });
    return noted;
  }

  // Bookmarks
  function getBookmarks() { return LS.get('bookmarks', []); }
  function toggleBookmark(lecId) {
    LS.update('bookmarks', arr => {
      const idx = arr.indexOf(lecId);
      if (idx >= 0) arr.splice(idx, 1); else arr.push(lecId);
      return arr;
    }, []);
  }
  function isBookmarked(lecId) { return getBookmarks().includes(lecId); }
  function getBookmarkedLectures() {
    if (typeof LECTURES === 'undefined') return [];
    const bm = getBookmarks();
    return LECTURES.filter(l => bm.includes(l.id));
  }

  // Sticky Notes (free-form, quick capture)
  function getStickies() { return LS.get('stickies', []); }
  function addSticky(text, color = '#FFB300') {
    LS.push('stickies', { id: LS.uid(), text, color, createdAt: Date.now() }, 50);
  }
  function removeSticky(id) {
    LS.update('stickies', arr => arr.filter(s => s.id !== id), []);
  }

  return { getNote, setNote, getAllNotedLectures, getBookmarks, toggleBookmark, isBookmarked, getBookmarkedLectures, getStickies, addSticky, removeSticky };
})();

// ── PER-LECTURE NOTE MODAL ──
function _openLecNote(lecId) {
  const lec = typeof LECTURES !== 'undefined' ? LECTURES.find(l => l.id === lecId) : null;
  if (!lec) return;

  const existing = Notes.getNote(lecId);
  let overlay = document.getElementById('noteModal');
  if (overlay) overlay.remove();

  overlay = document.createElement('div');
  overlay.id = 'noteModal';
  overlay.className = 'modal-overlay show';
  overlay.style.zIndex = '10000';

  const ci = typeof SUBJECTS !== 'undefined' ? SUBJECTS.indexOf(lec.s) : 0;
  const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[ci] || '#888' : '#888';

  overlay.innerHTML = `
    <div class="modal-box" style="position:relative;max-width:380px;transform:translateY(0) scale(1) skewX(0deg);">
      <div class="m-close" onclick="document.getElementById('noteModal').remove()">✕</div>
      <div style="font-size:11px;color:${col};font-weight:800;text-transform:uppercase;letter-spacing:1px;margin-bottom:4px">${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[lec.s] || lec.s : lec.s} — ${lec.q}</div>
      <div class="m-title" style="font-size:14px;line-height:1.5;margin-bottom:12px">${lec.t}</div>
      <textarea id="lecNoteText" placeholder="أكتب ملاحظاتك هنا... (نقاط مهمة، أسئلة، ملخص سريع)" style="width:100%;min-height:120px;padding:12px;background:#000;border:1px solid var(--accent-blue);color:var(--ink);font-size:13px;font-family:'Cairo',sans-serif;resize:vertical;outline:none;border-radius:6px;line-height:1.8">${existing || ''}</textarea>
      <div style="display:flex;gap:8px;margin-top:10px;">
        <button onclick="_saveLecNote(${lecId})" style="flex:1;padding:12px;background:var(--accent-blue);color:#000;border:none;font-size:13px;font-weight:900;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif">💾 حفظ</button>
        ${existing ? `<button onclick="Notes.setNote(${lecId},'');document.getElementById('noteModal').remove();store.notify()" style="padding:12px 16px;background:rgba(255,0,60,0.1);color:var(--semantic-danger);border:1px solid rgba(255,0,60,0.3);font-size:12px;font-weight:800;cursor:pointer;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);font-family:'Cairo',sans-serif">🗑️</button>` : ''}
      </div>
    </div>`;

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  document.body.appendChild(overlay);
  document.getElementById('lecNoteText').focus();
}

function _saveLecNote(lecId) {
  const text = document.getElementById('lecNoteText').value;
  Notes.setNote(lecId, text);
  document.getElementById('noteModal').remove();
  store.notify(); // re-render lecture cards to show 📝 indicator
  if (typeof showToast === 'function') showToast('💾 الملاحظة محفوظة', 'success');
}


// ── NOTES PAGE RENDERER ──
function renderNotesPage() {
  const c = document.getElementById('pageNotes');
  if (!c) return;

  const stickies = Notes.getStickies();
  const bookmarkedLecs = Notes.getBookmarkedLectures();
  const notedLecs = Notes.getAllNotedLectures();

  // Revision mode: lectures ≤50%
  const revisionLecs = [];
  if (typeof LECTURES !== 'undefined' && typeof store !== 'undefined') {
    const s = store.get();
    if (s.currentUser !== null) {
      const p = s.progress[s.currentUser] || {};
      LECTURES.forEach(l => {
        const val = p[l.id];
        if (val !== undefined && parseFloat(val) > 0 && parseFloat(val) <= 50) {
          revisionLecs.push({ ...l, pct: parseFloat(val) });
        }
      });
    }
  }

  const STICKY_COLORS = ['#FFB300', '#FF4D8D', '#00E5FF', '#10B981', '#8B5CF6'];

  let html = `<div style="padding:var(--spacing-md);">
    <!-- Quick Sticky Notes -->
    <div style="font-size:12px;font-weight:800;color:var(--ink);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📌 ملاحظات سريعة</div>
    <div style="display:flex;gap:6px;margin-bottom:10px;">
      <input id="stickyInput" type="text" placeholder="ملاحظة سريعة..." style="flex:1;padding:10px;background:#000;border:1px solid var(--accent-blue);color:var(--ink);font-size:12px;font-family:'Cairo',sans-serif;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);outline:none">
      <button onclick="_addSticky()" style="padding:10px 14px;background:var(--accent-blue);color:#000;border:none;font-weight:900;cursor:pointer;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);font-family:'Cairo',sans-serif;font-size:12px">+</button>
    </div>
    ${stickies.length > 0 ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:14px;">
      ${stickies.map(s => `
        <div style="background:${s.color}12;border:1px solid ${s.color}35;padding:10px;position:relative;min-height:50px;clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);">
          <div onclick="Notes.removeSticky('${s.id}');renderNotesPage()" style="position:absolute;top:4px;left:4px;cursor:pointer;font-size:10px;color:${s.color};opacity:0.6">✕</div>
          <div style="font-size:11px;color:var(--ink);line-height:1.6;font-weight:600">${s.text}</div>
        </div>
      `).join('')}
    </div>` : ''}

    <!-- Lecture Notes -->
    <div style="font-size:12px;font-weight:800;color:var(--accent-blue);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">📝 ملاحظات المحاضرات (${notedLecs.length})</div>
    ${notedLecs.length === 0 ? '<div style="text-align:center;padding:16px;color:var(--ink-muted);font-size:11px;margin-bottom:14px">اضغط 📝 على أي محاضرة عشان تضيف ملاحظة</div>' : `
      <div style="margin-bottom:14px;">
        ${notedLecs.map(nl => {
          const ci = typeof SUBJECTS !== 'undefined' ? SUBJECTS.indexOf(nl.lec.s) : 0;
          const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[ci] || '#888' : '#888';
          return `<div onclick="_openLecNote(${nl.lec.id})" style="padding:10px;background:var(--surface-1);border:1px solid var(--hairline);border-right:3px solid ${col};clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:5px;cursor:pointer;">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;">
              <span style="font-size:9px;color:${col};font-weight:800">${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[nl.lec.s] || nl.lec.s : nl.lec.s}</span>
              <span style="font-size:10px;font-weight:700;color:var(--ink);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${nl.lec.t}</span>
            </div>
            <div style="font-size:11px;color:var(--ink-muted);line-height:1.5;max-height:40px;overflow:hidden;text-overflow:ellipsis">${nl.note}</div>
          </div>`;
        }).join('')}
      </div>
    `}

    <!-- Bookmarked Lectures -->
    <div style="font-size:12px;font-weight:800;color:#FFB300;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">⭐ محاضرات محفوظة (${bookmarkedLecs.length})</div>
    ${bookmarkedLecs.length === 0 ? '<div style="text-align:center;padding:16px;color:var(--ink-muted);font-size:11px;margin-bottom:14px">اضغط ☆ على أي محاضرة لحفظها</div>' : `
      <div style="margin-bottom:14px;">
        ${bookmarkedLecs.map(l => {
          const ci = typeof SUBJECTS !== 'undefined' ? SUBJECTS.indexOf(l.s) : 0;
          const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[ci] || '#888' : '#888';
          // Get current pct
          let pctText = '';
          if (typeof store !== 'undefined') {
            const s = store.get();
            if (s.currentUser !== null) {
              const p = s.progress[s.currentUser] || {};
              const val = p[l.id];
              if (val !== undefined && parseFloat(val) > 0) pctText = parseFloat(val) + '%';
            }
          }
          return `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid rgba(255,179,0,0.2);clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;">
            <div onclick="Notes.toggleBookmark(${l.id});store.notify();renderNotesPage()" style="cursor:pointer;font-size:14px">⭐</div>
            <div onclick="toggleLecture(${l.id})" style="flex:1;font-size:11px;font-weight:600;color:var(--ink);cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.t}</div>
            <span style="font-size:9px;color:${col};font-weight:800">${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[l.s] || l.s : l.s}</span>
            ${pctText ? `<span style="font-size:10px;font-weight:900;color:var(--accent-blue);font-family:'Inter',sans-serif">${pctText}</span>` : ''}
          </div>`;
        }).join('')}
      </div>
    `}

    <!-- Revision Mode -->
    ${revisionLecs.length > 0 ? `
      <div style="font-size:12px;font-weight:800;color:var(--semantic-danger);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">🔄 محتاجة مراجعة — ≤50% (${revisionLecs.length})</div>
      ${revisionLecs.map(l => {
        const ci = typeof SUBJECTS !== 'undefined' ? SUBJECTS.indexOf(l.s) : 0;
        const col = typeof SUBJ_COLORS !== 'undefined' ? SUBJ_COLORS[ci] || '#888' : '#888';
        const pctCol = l.pct <= 25 ? 'var(--semantic-danger)' : '#FFB300';
        return `<div onclick="toggleLecture(${l.id})" style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface-1);border:1px solid var(--hairline);border-right:3px solid ${pctCol};clip-path:polygon(6px 0,100% 0,calc(100% - 6px) 100%,0 100%);margin-bottom:4px;cursor:pointer;">
          <div style="font-size:12px;font-weight:900;color:${pctCol};width:28px;text-align:center;font-family:'Inter',sans-serif">${l.pct}%</div>
          <div style="flex:1;font-size:11px;font-weight:600;color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${l.t}</div>
          <span style="font-size:9px;color:${col};font-weight:800">${typeof SUBJ_SHORT !== 'undefined' ? SUBJ_SHORT[l.s] || l.s : l.s}</span>
        </div>`;
      }).join('')}
    ` : ''}
  </div>`;

  c.innerHTML = html;
}

function _addSticky() {
  const input = document.getElementById('stickyInput');
  if (!input || !input.value.trim()) return;
  const colors = ['#FFB300', '#FF4D8D', '#00E5FF', '#10B981', '#8B5CF6'];
  Notes.addSticky(input.value.trim(), colors[Math.floor(Math.random() * colors.length)]);
  input.value = '';
  renderNotesPage();
}
