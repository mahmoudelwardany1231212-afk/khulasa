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
  function _arraysEqual(a, b) { return a && b && a.length === b.length && a.every(function(v,i){return v===b[i];}); }

  var _state = {
    result       : null,
    teamCoverage : null,
    activeTab    : "members",
    gapFilters   : { search: '', person: 'all', range: 'all' },
    planSubjects : null,
    hideCompleted: true,
  };

  function _uniqueSubjects() {
    var seen = {}, out = [];
    _lectures().forEach(function(l) {
      if (l.s && !seen[l.s]) { seen[l.s] = true; out.push(l.s); }
    });
    return out.sort();
  }

  var EXAM_SUBJECT_ALIASES = {
    'Crown': 'Fixed Prosth.'
  };

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
      var aliasTarget = EXAM_SUBJECT_ALIASES[closest.name];
      var matches = [];
      subs.forEach(function(s) {
        if (s.indexOf(closest.name) !== -1 || closest.name.indexOf(s) !== -1 || (aliasTarget && s === aliasTarget))
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
    if (!subs.length) { _state.result = null; _state.planSubjects = null; return; }
    // If we already have a plan for the same subjects, don't regenerate
    if (_state.result && _state.planSubjects && _state.planSubjects.join(',') === subs.join(',')) return;
    try {
      _state.result = CoverageEngine.distributeLectures(
        _lectures(),
        _members(),
        _progress(),
        { subjectFilter: subs, ignoreHistory: true }
      );
      _state.planSubjects = subs.slice();
      window._evalPlan = { result: _state.result, planSubjects: subs.slice(), savedAt: Date.now() };
      if (typeof Engine !== 'undefined' && Engine.getTeamCoverage) {
        var filtered = _lectures().filter(function(l) { return subs.indexOf(l.s) !== -1; });
        _state.teamCoverage = Engine.getTeamCoverage(
          filtered.length ? filtered : _lectures(),
          _progress()
        );
      }
    } catch (e) {
      _state.result = null;
      _state.planSubjects = null;
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
    var h = '<div class="cov-active-badge" style="margin-bottom:6px"><span>📅 الكونت دون: </span>';
    h += exams.map(function(e) {
      var isActive = subs.some(function(s) { return e.name.indexOf(s) !== -1 || s.indexOf(e.name) !== -1; });
      return (isActive ? '<strong>👉 ' : '') + e.name + ' (' + e.daysUntil + ' يوم)' + (isActive ? ' ⬅️</strong>' : '');
    }).join(' · ');
    if (subs.length) h += '<div style="font-size:.75rem;opacity:.7;margin-top:2px">📚 المواد: ' + subs.join(' + ') + '</div>';
    h += '</div>';
    return h;
  }

  /* ── Tabs ── */

  function _setTab(t) {
    _state.activeTab = t;
    render();
  }

  /* ── Gap Filters ── */

  function _setGapSearch(val) {
    _state.gapFilters.search = val;
    render();
  }

  function _setGapPerson(val) {
    _state.gapFilters.person = val;
    render();
  }

  function _setGapRange(val) {
    _state.gapFilters.range = val;
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
    var tc = _state.teamCoverage;

    if (!_state.result) return h;

    var r = _state.result;

    // Tabs
    h += _renderTabs();

    // Stats bar
    (function() {
      var critGap = tc ? tc.lectureDetails.filter(function(d){return d.maxPct<20;}).length : 0;
      var critTotal = tc ? tc.totalLectures : 0;
      var critCovered = critTotal - critGap;
      var critPct = critTotal > 0 ? Math.round((critCovered / critTotal) * 100) : 0;
      h += '<div class="cov-stats-bar">' +
        (tc ? _statChip('👥', 'تغطية الفريق / الاستعدادية', critPct + '%') : '') +
        _statChip('📊', 'التوزيع', r.stats.coveragePercent + '%') +
        _statChip('🎯', 'التغطية الفعلية', r.stats.effectiveCoverage + '%') +
        _statChip('⚖️', 'التوازن (LBS)', Math.round(r.stats.lbs * 100) + '%') +
      '</div>' +
      (tc
        ? '<div class="cov-effective-note">👥 تغطية الفريق = الاستعدادية = لو كلنا دخلنا الامتحان النهاردة، هنعرف نجاوب على <strong>' + critPct + '%</strong> من المنهج. الفجوة: <strong>' + critGap + '</strong> محاضرة لسه محتاجة شغل.</div>'
        : '');
    })() +

    // Gap lectures section: scrollable table with filters
    (function() {
      var criticalGap = tc ? tc.lectureDetails.filter(function(d){return d.maxPct<20;}).length : 0;
      return (tc && criticalGap > 0 && r.ownershipMap
      ? '<div class="cov-card" style="margin-top:8px">' +
        '<div class="cov-section-label" style="display:flex;justify-content:space-between;align-items:center">' +
          '<span>⚠️ محاضرات الفجوة — مين المكلف في الخطة؟</span>' +
          '<button onclick="EvalCenter._refresh()" style="background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink-muted);padding:2px 6px;font-size:9px;cursor:pointer;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:\'Cairo\',sans-serif">🔄</button>' +
        '</div>' +

        // Filter bar
        '<div style="display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap">' +
          '<input id="gapSearchInput" type="text" placeholder="🔍 بحث..." value="' + _state.gapFilters.search.replace(/"/g,'&quot;') + '" ' +
            'oninput="EvalCenter._setGapSearch(this.value)" ' +
            'style="flex:1;min-width:80px;padding:4px 6px;font-size:10px;background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:\'Cairo\',sans-serif">' +
          '<select onchange="EvalCenter._setGapPerson(this.value)" ' +
            'style="padding:4px 6px;font-size:10px;background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:\'Cairo\',sans-serif">' +
            '<option value="all"' + (_state.gapFilters.person === 'all' ? ' selected' : '') + '>👤 الكل</option>' +
            _members().map(function(m) {
              return '<option value="' + m.id + '"' + (_state.gapFilters.person === String(m.id) ? ' selected' : '') + '>' + m.name + '</option>';
            }).join('') +
          '</select>' +
          '<select onchange="EvalCenter._setGapRange(this.value)" ' +
            'style="padding:4px 6px;font-size:10px;background:var(--surface-2);border:1px solid var(--hairline);color:var(--ink);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:\'Cairo\',sans-serif">' +
            '<option value="all"' + (_state.gapFilters.range === 'all' ? ' selected' : '') + '>📊 الكل</option>' +
            '<option value="0-20"' + (_state.gapFilters.range === '0-20' ? ' selected' : '') + '>0-20%</option>' +
            '<option value="20-40"' + (_state.gapFilters.range === '20-40' ? ' selected' : '') + '>20-40%</option>' +
            '<option value="40-60"' + (_state.gapFilters.range === '40-60' ? ' selected' : '') + '>40-60%</option>' +
            '<option value="60-80"' + (_state.gapFilters.range === '60-80' ? ' selected' : '') + '>60-80%</option>' +
          '</select>' +
        '</div>' +

        // Table
        '<div class="cov-table-wrapper" style="max-height:260px;overflow-y:auto">' +
        '<table class="cov-heatmap-table" style="font-size:10px">' +
        '<thead><tr>' +
        '<th style="position:sticky;top:0;background:var(--surface-1);z-index:1">المحاضرة</th>' +
        '<th style="position:sticky;top:0;background:var(--surface-1);z-index:1">أعلى فهم</th>' +
        '<th style="position:sticky;top:0;background:var(--surface-1);z-index:1">المكلف في الخطة</th>' +
        '</tr></thead><tbody>' +
        (function() {
          var query = _state.gapFilters.search.trim().toLowerCase();
          var person = _state.gapFilters.person;
          var range = _state.gapFilters.range;
          return tc.lectureDetails.filter(function(d) {
            if (d.maxPct >= 20) return false;
            if (query && (d.title || '').toLowerCase().indexOf(query) === -1) return false;
            if (person !== 'all') {
              var oi = _ownerForGap(r, d);
              if (oi !== person) return false;
            }
            if (range !== 'all') {
              var parts = range.split('-');
              var lo = parseInt(parts[0]), hi = parseInt(parts[1]);
              if (d.maxPct < lo || d.maxPct >= hi) return false;
            }
            return true;
          }).map(function(d) {
            var ownerEntry = r.ownershipMap[d.lectureId];
            var ownerName, ownerColor;
            if (ownerEntry) {
              ownerName = ownerEntry.ownerName;
              var mi = _members().findIndex(function(m) { return m.id === ownerEntry.owner; });
              ownerColor = mi >= 0 ? COLORS[mi % COLORS.length] : 'var(--ink-muted)';
            } else if (d.topMember >= 0) {
              var mi = _members().findIndex(function(m) { return m.id === d.topMember; });
              ownerName = mi >= 0 ? _members()[mi].name : 'أحد الأعضاء';
              ownerColor = mi >= 0 ? COLORS[mi % COLORS.length] : 'var(--ink-muted)';
            } else {
              ownerName = 'غير موزع';
              ownerColor = 'var(--semantic-danger)';
            }
            var riskColor = d.maxPct < 20 ? '#ef4444' : d.maxPct < 50 ? '#f59e0b' : '#6366f1';
            return '<tr>' +
              '<td style="font-weight:600">' + (d.title || d.lectureId) + '</td>' +
              '<td style="color:' + riskColor + ';font-weight:700">' + d.maxPct + '%</td>' +
              '<td style="color:' + ownerColor + ';font-weight:700">✏️ ' + ownerName + '</td>' +
            '</tr>';
          }).join('') || '<tr><td colspan="3" style="text-align:center;color:var(--ink-muted);font-size:10px">لا توجد نتائج</td></tr>';
        })() +
        '</tbody></table></div></div>'
      : '');
    })();

    if (_state.activeTab === 'members') {
      // Toggle: hide completed
      h += '<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">' +
        '<label style="font-size:.75rem;color:var(--ink-muted);display:flex;align-items:center;gap:4px;cursor:pointer">' +
        '<input type="checkbox" ' + (_state.hideCompleted ? 'checked' : '') + ' onchange="EvalCenter._toggleHideCompleted(this.checked)" style="margin:0">' +
        'إخفاء المخلص (≥80%)</label></div>';

      // Member cards
      r.stats.memberBreakdown.forEach(function(m, i) {
        var color = COLORS[i % COLORS.length];
        var ownedList = m.owned.filter(function(l) {
          if (!_state.hideCompleted) return true;
          var pct = _memberPct(m.id, l.id);
          return pct === undefined || pct < 80;
        });
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
        ownedList.forEach(function(l) {
          var pct = _memberPct(m.id, l.id);
          var pctVal = pct !== undefined ? parseFloat(pct) : 0;
          var bg = _pctColor(pctVal);
          var risk = _riskBadge(l.risk || 0);
          h += '<span class="cov-lecture-chip" style="background:' + bg + '20;border-color:' + bg + '60">' +
            (l.t || l.s || l.id) + ' <span style="font-weight:700;color:' + bg + '">' + Math.round(pctVal) + '%</span> ' + risk +
            (l.ttlExpiry ? ' <span class="cov-ttl-badge">⌛' + l.ttlExpiry + ' أيام</span>' : '') +
            '</span>';
        });
        if (!ownedList.length) {
          h += '<span style="color:var(--ink-muted);font-size:.75rem">✅ خلصت كل محاضراتك</span>';
        }
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

  function _ownerForGap(result, detail) {
    var oe = result.ownershipMap[detail.lectureId];
    if (oe) return String(oe.owner);
    if (detail.topMember >= 0) return String(detail.topMember);
    return '';
  }

  function _pctColor(pct) {
    if (pct == null) return 'var(--surface-2)';
    var r = Math.round(255 * (1 - pct / 100));
    var g = Math.round(255 * (pct / 100));
    return 'rgb(' + r + ',' + g + ',50)';
  }

  function _memberPct(memberId, lectureId) {
    var p = _progress()[memberId];
    return p ? p[lectureId] : undefined;
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

    if (!_state.result) {
      // Try loading shared plan
      var subs = _getCoverageSubjects();
      if (window._evalPlan && _arraysEqual(window._evalPlan.planSubjects, subs)) {
        _state.result = window._evalPlan.result;
        _state.planSubjects = subs;
      }
      _autoGenerate();
    }

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
      '<p class="s">📊 توزيع: ' + s.coveragePercent + '% | فعلي: ' + s.effectiveCoverage + '% | LBS: ' + Math.round(s.lbs * 100) + '%' +
      (_state.teamCoverage ? ' | 👥 فريق: ' + _state.teamCoverage.teamCoveragePercent + '%' : '') + '</p>'
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

  function _refresh() {
    if (typeof Engine !== 'undefined' && Engine.getTeamCoverage) {
      var progress = _progress();
      var lectures = _lectures();
      var subs = _getCoverageSubjects();
      var filtered = subs.length ? lectures.filter(function(l) { return subs.indexOf(l.s) !== -1; }) : lectures;
      _state.teamCoverage = Engine.getTeamCoverage(filtered.length ? filtered : lectures, progress);
      if (typeof store !== 'undefined' && typeof renderSocialPage === 'function') renderSocialPage();
    }
    render();
  }

  function _toggleHideCompleted(val) {
    _state.hideCompleted = !!val;
    render();
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
    _refresh: _refresh,
    _setTab: _setTab,
    _setGapSearch: _setGapSearch,
    _setGapPerson: _setGapPerson,
    _setGapRange: _setGapRange,
    _toggleHideCompleted: _toggleHideCompleted,
    _exportPDF: _exportPDF,
    _openRating: _openRating,
    _submitRating: _submitRating,
  };

})();
