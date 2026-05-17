/**
 * evaluation-center.js — مركز التقييم
 *
 * Member evaluation dashboard + coverage distribution, merged.
 * Replaces Smart Plan + standalone Coverage UI.
 */
(function () {
  "use strict";

  function _members() {
    if (typeof MEMBERS === "undefined") return [];
    return Array.from(MEMBERS, function(m, i) { return { id: i, name: m.name || "عضو " + i, emoji: m.emoji || "👤" }; });
  }

  function _lectures() { return typeof LECTURES !== "undefined" ? LECTURES : []; }
  function _progress() { return (typeof store !== "undefined" && store.get().progress) || {}; }

  var COLORS = [
    "#6366f1","#0ea5e9","#10b981","#f59e0b",
    "#ef4444","#8b5cf6","#ec4899",
  ];

  function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  var _state = {
    result       : null,
    activeTab    : "members",
  };

  function _uniqueSubjects() {
    var seen = {}, out = [];
    _lectures().forEach(function(l) {
      if (l.s && !seen[l.s]) { seen[l.s] = true; out.push(l.s); }
    });
    return out.sort();
  }

  function _getCoverageSubjects() {
    try {
      if (typeof EXAM_SCHEDULE === 'undefined' || !EXAM_SCHEDULE.length) return [];
      var now = Date.now();
      var closest = null;
      EXAM_SCHEDULE.forEach(function(exam) {
        var examTime = new Date(exam.iso).getTime();
        var daysUntil = Math.round((examTime - now) / 86400000);
        if (daysUntil > 0 && (closest === null || daysUntil < closest.days))
          closest = { name: exam.name, days: daysUntil };
      });
      if (!closest) return [];

      var subs = _uniqueSubjects();
      var matches = [];
      subs.forEach(function(s) {
        if (s.indexOf(closest.name) !== -1 || closest.name.indexOf(s) !== -1)
          if (matches.indexOf(s) === -1) matches.push(s);
      });
      return matches;
    } catch (e) { return []; }
  }

  function _examCountdown() {
    try {
      if (typeof EXAM_SCHEDULE === 'undefined') return [];
      var now = Date.now();
      var out = [];
      EXAM_SCHEDULE.forEach(function(exam) {
        var examTime = new Date(exam.iso).getTime();
        var daysUntil = Math.round((examTime - now) / 86400000);
        if (daysUntil > 0 && daysUntil <= 60) {
          out.push({ name: exam.name, daysUntil: daysUntil });
        }
      });
      return out.sort(function(a, b) { return a.daysUntil - b.daysUntil; });
    } catch (e) { return []; }
  }

  function _autoGenerate() {
    if (typeof CoverageEngine === 'undefined') return;
    var subs = _getCoverageSubjects();
    if (!subs.length) { _state.result = null; return; }
    try {
      _state.result = CoverageEngine.distributeLectures(
        _lectures(),
        _members(),
        _progress(),
        { subjectFilter: subs }
      );
    } catch (e) {
      _state.result = null;
    }
  }

  /* ══════════════════════════════════════════════════════════════════
     MEMBER EVALUATION
  ══════════════════════════════════════════════════════════════════ */

  function _statChip(icon, label, val) {
    return '<div class="cov-chip"><div class="cov-chip-icon">' + icon + '</div><div class="cov-chip-lbl">' + label + '</div><div class="cov-chip-val">' + val + '</div></div>';
  }

  /* ══════════════════════════════════════════════════════════════════
     COVERAGE RESULTS
  ══════════════════════════════════════════════════════════════════ */

  function _renderActiveBadge() {
    var exams = _examCountdown();
    if (!exams.length) return '';
    var subs = _getCoverageSubjects();
    var activeName = subs.length ? subs[0] : '';
    var h = '<div class="cov-active-badge" style="margin-bottom:6px"><span>📅 الكونت دون: </span>';
    h += exams.map(function(e) {
      var isActive = activeName && (e.name.indexOf(activeName) !== -1 || activeName.indexOf(e.name) !== -1);
      return (isActive ? '<strong>👉 ' : '') + e.name + ' (' + e.daysUntil + ' يوم)' + (isActive ? ' ⬅️</strong>' : '');
    }).join(' · ');
    h += '</div>';
    return h;
  }

  /* ── Tabs ── */

  function _setTab(t) {
    _state.activeTab = t;
    render();
  }

  function _renderTabs() {
    var t = _state.activeTab;
    return '<div class="cov-tab-bar">' +
      '<button class="cov-tab' + (t === 'members' ? ' active' : '') + '" onclick="EvalCenter._setTab(\'members\')">الأعضاء</button>' +
      '<button class="cov-tab' + (t === 'heatmap' ? ' active' : '') + '" onclick="EvalCenter._setTab(\'heatmap\')">التوزيع</button>' +
      '</div>';
  }

  function _renderCoverageSection() {
    var h = _renderActiveBadge();

    if (!_state.result) return h;

    var r = _state.result;

    // Tabs
    h += _renderTabs();

    // Stats bar
    h += '<div class="cov-stats-bar">' +
      _statChip('📊', 'التغطية', r.stats.coveragePercent + '%') +
      _statChip('🎯', 'التغطية الفعلية', r.stats.effectiveCoverage + '%') +
      _statChip('⚖️', 'التوازن (LBS)', Math.round(r.stats.lbs * 100) + '%') +
      _statChip('🔄', 'الاستعدادية', r.stats.redundancyPercent + '%') +
    '</div>';

    if (_state.activeTab === 'members') {
      // Member cards
      r.stats.memberBreakdown.forEach(function(m, i) {
        var color = COLORS[i % COLORS.length];
        h += '<div class="cov-member-card" style="border-right:4px solid ' + color + '">' +
          '<div class="cov-member-header">' +
            '<div><div class="cov-member-name">' + (m.name || 'عضو ' + i) + '</div>' +
            '<div class="cov-member-role" style="opacity:.7;font-size:.75rem">مكلف بـ ' + m.lectureCount + ' محاضرة | ' + Math.round(m.hours) + ' ساعة</div></div>' +
            '<div style="display:flex;align-items:center;gap:6px">' +
              '<button class="cov-btn-sm" onclick="EvalCenter._openRating(\'' + m.id + '\',\'' + m.name.replace(/'/g, "\\'") + '\')" title="تقييم" style="font-size:1rem;padding:2px 8px">⭐</button>' +
              '<div class="cov-member-hours" style="color:' + color + '">' + Math.round(m.hours) + '<span style="font-size:.6rem;opacity:.7">س</span></div>' +
            '</div>' +
          '</div>' +
          '<div class="cov-member-lectures">';
        m.owned.forEach(function(l) {
          var risk = _riskBadge(l.risk || 0);
          h += '<span class="cov-lecture-chip">' +
            (l.t || l.s || l.id) + ' ' + risk +
            (l.ttlExpiry ? ' <span class="cov-ttl-badge">⌛' + l.ttlExpiry + ' أيام</span>' : '') +
            '</span>';
        });
        if (m.backup && m.backup.length) {
          h += '<div style="margin-top:4px;font-size:.7rem;opacity:.6">🔁 احتياطي: ' +
            m.backup.map(function(l) { return l.t || l.s || l.id; }).join(', ') + '</div>';
        }
        h += '</div></div>';
      });
    } else {
      // Heatmap tab
      h += _renderHeatmap(r);
    }

    // Risk warning
    h += '<div class="cov-risk-warning">⚠️ <strong>تنبيه:</strong> في ناس ممكن متلتزمش. النظام بياخد الموثوقية في الاعتبار (من الفيدباك) — اللي موثوقيته قليلة بياخد تكليفات أقل. برضو خلي بالك: التوزيع مبني على الأولويات، وعدم الالتزام هيأثر على المجموعة كلها.</div>';

    // Export
    h += '<button class="cov-export-btn" onclick="EvalCenter._exportPDF()">📄 تصدير PDF</button>';

    return h;
  }

  function _riskBadge(risk) {
    if (risk >= 0.7) return '<span class="cov-risk-badge cov-risk-high">HIGH</span>';
    if (risk >= 0.4) return '<span class="cov-risk-badge cov-risk-med">MED</span>';
    return '<span class="cov-risk-badge cov-risk-low">LOW</span>';
  }

  function _renderHeatmap(r) {
    if (!r || !r.stats || !r.stats.memberBreakdown) return '';
    var allIds = {};
    r.stats.memberBreakdown.forEach(function(m) {
      (m.owned || []).forEach(function(l) { allIds[l.id] = l; });
    });
    var ids = Object.keys(allIds);
    if (!ids.length) return '<p class="cov-empty-hint">مفيش محاضرات في التوزيع.</p>';

    var h = '<div style="overflow-x:auto"><table class="cov-heatmap-table">' +
      '<thead><tr><th>المحاضرة</th>';
    r.stats.memberBreakdown.forEach(function(m) {
      h += '<th>' + (m.name || 'عضو') + '</th>';
    });
    h += '<th>المخاطر</th></tr></thead><tbody>';

    ids.forEach(function(id) {
      var l = allIds[id];
      h += '<tr><td>' + (l.t || l.s || l.id) + '</td>';
      r.stats.memberBreakdown.forEach(function(m) {
        var owned = (m.owned || []).some(function(o) { return o.id == id; });
        var backup = (m.backup || []).some(function(o) { return o.id == id; });
        if (owned) h += '<td class="cov-cell-owned" title="مكلف">✔️</td>';
        else if (backup) h += '<td class="cov-cell-backup" title="احتياطي">🔄</td>';
        else h += '<td class="cov-cell-empty">—</td>';
      });
      h += '<td>' + _riskBadge(l.risk || 0) + '</td></tr>';
    });
    h += '</tbody></table></div>';
    return h;
  }

  function render() {
    var el = document.getElementById("pageEvalCenter");
    if (!el) return;

    if (!_state.result) _autoGenerate();

    el.innerHTML =
    '<div class="cov-wrapper">' +
      '<div class="cov-header">' +
        '<div class="cov-header-icon">🍭</div>' +
        '<div style="flex:1">' +
          '<h2 class="cov-title">آخر مصة</h2>' +
          '<p class="cov-subtitle">توزيع تلقائي حسب جدول الامتحانات — كل member يغطي محاضرات مختلفة.</p>' +
        '</div>' +
      '</div>' +
      _renderCoverageSection() +
    '</div>';
  }

  /* ── Why Popup ── */

  /* ── Export ── */

  function _exportPDF() {
    var r = _state.result;
    if (!r) { showToast('اعمل توزيع الأول', 'warn'); return; }
    var s = r.stats;

    var lines = [
      '<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>توزيع التغطية</title>',
      '<style>body{font-family:system-ui,sans-serif;padding:20px;max-width:700px;margin:auto}h1{font-size:1.3rem}.m{border:1px solid #ddd;padding:10px;margin:8px 0;border-radius:8px}.s{color:#666;font-size:.8rem}.risk{color:#e44}table{width:100%;border-collapse:collapse;margin:12px 0;font-size:.8rem}th,td{border:1px solid #ddd;padding:6px 8px;text-align:right}th{background:#f5f5f5;font-weight:700}.t{background:#e8f5e9}.b{background:#fff3e0}.e{color:#999}</style></head><body>',
      '<h1>🍭 آخر مصة — توزيع التغطية</h1>',
      '<p class="s">' + new Date().toLocaleDateString("ar-EG") + '</p>',
      '<p class="s">📊 تغطية: ' + s.coveragePercent + '% | فعلي: ' + s.effectiveCoverage + '% | LBS: ' + Math.round(s.lbs * 100) + '%</p>'
    ];

    // Heatmap table
    var allIds = {};
    s.memberBreakdown.forEach(function(m) {
      (m.owned || []).forEach(function(l) { allIds[l.id] = l; });
    });
    var ids = Object.keys(allIds);
    if (ids.length) {
      lines.push('<table><thead><tr><th>المحاضرة</th>');
      s.memberBreakdown.forEach(function(m) { lines.push('<th>' + (m.name || 'عضو') + '</th>'); });
      lines.push('</tr></thead><tbody>');
      ids.forEach(function(id) {
        var l = allIds[id];
        lines.push('<tr><td>' + (l.t || l.s || l.id) + '</td>');
        s.memberBreakdown.forEach(function(m) {
          var owned = (m.owned || []).some(function(o) { return o.id == id; });
          var backup = (m.backup || []).some(function(o) { return o.id == id; });
          if (owned) lines.push('<td class="t">✔️</td>');
          else if (backup) lines.push('<td class="b">🔄</td>');
          else lines.push('<td class="e">—</td>');
        });
        lines.push('</tr>');
      });
      lines.push('</tbody></table>');
    }

    // Member detail cards
    s.memberBreakdown.forEach(function(m) {
      lines.push('<div class="m"><strong>' + (m.name || 'عضو') + '</strong> — ' + m.lectureCount + 'م، ' + Math.round(m.hours) + 'س');
      m.owned.forEach(function(l) {
        lines.push('<div>✏️ ' + (l.t || l.s || l.id) + (l.risk >= 0.5 ? ' <span class="risk">⚠️</span>' : '') + '</div>');
      });
      if (m.backup && m.backup.length) {
        lines.push('<div class="s">🔁 احتياطي: ' + m.backup.map(function(l){return l.t||l.s||l.id;}).join(', ') + '</div>');
      }
      lines.push('</div>');
    });

    lines.push('<p class="risk">⚠️ المخاطر: عدم الالتزام بالجدول هيأثر على المجموعة كلها.</p>');
    lines.push('<p class="s">تم بواسطة الخلاصة</p>');
    lines.push('</body></html>');

    var w = window.open('', '_blank', 'width=800,height=600');
    if (w) {
      w.document.write(lines.join('\n'));
      w.document.close();
      w.focus();
      setTimeout(function() { w.print(); }, 500);
    }
  }

  function _openRating(memberId, memberName) {
    var overlay = document.createElement('div');
    overlay.className = 'cov-why-overlay';
    overlay.innerHTML =
      '<div class="cov-why-card" style="max-width:320px">' +
        '<div class="cov-why-header">⭐ تقييم ' + memberName + '<button class="cov-why-close" onclick="this.closest(\'.cov-why-overlay\').remove()">✕</button></div>' +
        '<div style="display:flex;flex-direction:column;gap:8px">' +
          '<label style="font-size:.82rem;color:var(--ink-muted)">جودة الشرح <span style="float:right" id="rQualityVal">3</span></label>' +
          '<input type="range" min="1" max="5" value="3" step="1" id="rQuality" oninput="document.getElementById(\'rQualityVal\').textContent=this.value" style="width:100%">' +
          '<label style="font-size:.82rem;color:var(--ink-muted)">المساعدة <span style="float:right" id="rHelpVal">3</span></label>' +
          '<input type="range" min="1" max="5" value="3" step="1" id="rHelp" oninput="document.getElementById(\'rHelpVal\').textContent=this.value" style="width:100%">' +
          '<label style="font-size:.82rem;color:var(--ink-muted)">الطاقة <span style="float:right" id="rEnergyVal">3</span></label>' +
          '<input type="range" min="1" max="5" value="3" step="1" id="rEnergy" oninput="document.getElementById(\'rEnergyVal\').textContent=this.value" style="width:100%">' +
          '<label style="font-size:.82rem;color:var(--ink-muted);display:flex;align-items:center;gap:6px">' +
            '<input type="checkbox" id="rAttended" checked> حضر الميتنج' +
          '</label>' +
          '<button class="cov-export-btn" onclick="EvalCenter._submitRating(\'' + memberId + '\', this)" style="margin-top:4px">💾 حفظ</button>' +
        '</div></div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function(e) { if (e.target === overlay) overlay.remove(); });
  }

  function _submitRating(memberId, btn) {
    var quality = parseInt(document.getElementById('rQuality').value);
    var help = parseInt(document.getElementById('rHelp').value);
    var energy = parseInt(document.getElementById('rEnergy').value);
    var attended = document.getElementById('rAttended').checked;
    var sid = 'eval_' + Date.now();
    if (typeof SessionFeedback !== 'undefined') {
      SessionFeedback.saveFeedback(sid, {
        explainerId: memberId,
        explainerQuality: quality,
        helpfulness: help,
        energyLevel: energy,
        attended: attended,
        actualDuration: 30,
        understandingGained: 50
      });
      btn.closest('.cov-why-overlay').remove();
      if (typeof showToast === 'function') showToast('تم حفظ التقييم ✅', 'success');
    } else {
      if (typeof showToast === 'function') showToast('الفيدباك مش متاح', 'error');
    }
  }

  window.EvalCenter = {
    render: render,
    _setTab: _setTab,
    _exportPDF: _exportPDF,
    _openRating: _openRating,
    _submitRating: _submitRating,
  };

})();
