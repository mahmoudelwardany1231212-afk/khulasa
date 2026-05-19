(function () {
  "use strict";

  function _members() {
    if (typeof MEMBERS === "undefined") return [];
    return Array.from(MEMBERS, function(m, i) { return { id: i, name: m.name || "عضو " + i }; });
  }

  function _lectures() { return typeof LECTURES !== "undefined" ? LECTURES : []; }
  function _progress() { return (typeof store !== "undefined" && store.get().progress) || {}; }

  var COLORS = [
    "#6366f1","#0ea5e9","#10b981","#f59e0b",
    "#ef4444","#8b5cf6","#ec4899",
  ];

  var _state = {
    selectedSubjects : [],
    grade100         : false,
    result           : null,
    teamCoverage     : null,
    loading          : false,
    activeTab        : "members",
    whyLectureId     : null,
  };

  function _uniqueSubjects() {
    var seen = {}, out = [];
    _lectures().forEach(function(l) {
      if (l.s && !seen[l.s]) { seen[l.s] = true; out.push(l.s); }
    });
    return out.sort();
  }

  function _detectActiveSubjects() {
    try {
      if (typeof EXAM_SCHEDULE === 'undefined' || !EXAM_SCHEDULE.length) return [];
      var now = Date.now();
      var active = [];
      EXAM_SCHEDULE.forEach(function(exam) {
        var examTime = new Date(exam.iso).getTime();
        var daysUntil = (examTime - now) / 86400000;
        if (daysUntil > 0 && daysUntil <= 60) active.push(exam.name);
      });
      if (!active.length) return [];
      var subs = _uniqueSubjects();
      return subs.filter(function(s) { return active.some(function(a) { return s.indexOf(a) !== -1 || a.indexOf(s) !== -1; }); });
    } catch (e) { return []; }
  }

  /* Auto-select active subjects on first render */
  var _initialDetectDone = false;

  /* ══════════════════════════════════════════════════════════════════
     RENDER
  ══════════════════════════════════════════════════════════════════ */

  function render() {
    var el = document.getElementById("pageCoverage");
    if (!el) return;

    if (!_initialDetectDone) {
      _initialDetectDone = true;
      var active = _detectActiveSubjects();
      if (active.length) {
        _state.selectedSubjects = active;
        _state.result = null;
      }
    }

    var latest  = CoverageEngine.loadLatestPlan();
    var expired = CoverageEngine.isPlanExpired(latest);
    var daysLeft = expired ? 0 : CoverageEngine.getDaysUntilExpiry(latest);

    el.innerHTML =
'<div class="cov-wrapper">' +

  '<div class="cov-header">' +
    '<div class="cov-header-icon">🗺️</div>' +
    '<div style="flex:1">' +
      '<h2 class="cov-title">توزيع التغطية</h2>' +
      '<p class="cov-subtitle">كل عضو يزاكر محاضرات مختلفة — وبعدين يشرح اللي زاكره للباقيين. المجموعة تغطي المنهج كامل بوقت أقل بكتير.</p>' +
    '</div>' +
    (!expired && latest
      ? '<div class="cov-ttl-badge">⏳ الخطة تنتهي خلال <strong>' + daysLeft + '</strong> ' + (daysLeft === 1 ? "يوم" : "أيام") + '</div>'
      : "") +
  '</div>' +

  '<div class="cov-card">' +
    '<div class="cov-section-label">📚 اختار اسم المادة</div>' +
    (function() {
      var active = _detectActiveSubjects();
      var h = '';
      if (active.length) {
        h += '<div class="cov-active-badge"><span>📅 المواد النشطة (عليها ور): </span>' + active.join(' · ') + '</div>';
      }
      var subs = _uniqueSubjects();
      if (!subs.length) return '<p class="cov-empty-hint">مفيش محاضرات متوفرة.</p>';
      var h = '<div class="cov-subject-grid">';
      subs.forEach(function(s) {
        var on = _state.selectedSubjects.indexOf(s) !== -1;
        h += '<button class="cov-subject-btn' + (on ? ' active' : '') + '" onclick="CoverageUI._toggleSubject(\'' + s.replace(/'/g, "\\'") + '\')">' + s + '</button>';
      });
      h += '</div>';
      h += '<div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap;">';
      h += '<button class="cov-btn-sm' + (_state.grade100 ? ' active' : '') + '" onclick="CoverageUI._toggleGrade100()">100</button>';
      h += '<button class="cov-btn-sm" onclick="CoverageUI._clearAll()">كل المواد</button>';
      h += '</div>';
      return h;
    })() +
  '</div>' +

  (!expired && latest && daysLeft <= 1
    ? '<div class="cov-warning-banner">⚠️ الخطة الحالية هتنتهي قريبًا — يُفضَّل إعادة التوزيع قبل الجلسة الجاية.<button class="cov-refresh-btn" onclick="CoverageUI._generate()">🔄 أعد التوزيع</button></div>'
    : "") +

  '<div class="cov-actions">' +
    '<button class="cov-generate-btn' + (_state.loading ? " loading" : "") + '" onclick="CoverageUI._generate()"' + ((_state.selectedSubjects.length === 0 && !_state.grade100) || _state.loading ? "disabled" : "") + '>' +
      (_state.loading
        ? '<span class="cov-spinner"></span> جاري التوزيع…'
        : "⚡ وزّع المحاضرات") +
    '</button>' +
    (_state.result
      ? '<button class="cov-export-btn" onclick="CoverageUI._exportPDF()">📥 تصدير PDF + واتساب</button>'
      : "") +
  '</div>' +

  (_state.result ? _renderResults(_state.result) : _renderEmpty()) +

'</div>';
  }

  function _renderEmpty() {
    return '<div class="cov-empty">' +
      '<div class="cov-empty-icon">🎯</div>' +
      '<p>اختار المادة وضغط "وزّع المحاضرات"</p>' +
      '<p class="cov-empty-hint">الخوارزمية بتراعي تقدم كل عضو + موثوقيته + حمله الحالي</p>' +
    '</div>';
  }

  function _renderResults(result) {
    return (
      '<div class="cov-risk-warning">⚠️ هذا توزيع أولويات — الكل هيدرس كل المحاضرات، لكن بتركيز مختلف. المكلف بالشرح قد لا يكون متمكنًا، والبعض قد لا يلتزم. لازم backup دايما.</div>' +
      _renderStatsBar(result.stats) +
      _renderTabBar() +
      (_state.activeTab === "members"
        ? _renderMembersTab(result.stats)
        : _renderHeatmapTab(result.stats, result.assignmentReasons)) +
      _renderCoverageSummary(result.stats) +
      _renderWhyPopup(result.assignmentReasons)
    );
  }

  function _renderStatsBar(stats) {
    var tc = _state.teamCoverage;
    return (
      '<div class="cov-stats-bar">' +
        (tc
          ? _chip("👥", tc.teamCoveragePercent + "%",  "تغطية الفريق (union)",  _coverColor(tc.teamCoveragePercent))
          : "") +
        _chip("📖", stats.coveragePercent + "%",    "نسبة التوزيع",          _coverColor(stats.coveragePercent)) +
        _chip("✨", stats.effectiveCoverage + "%",  "التغطية الفعلية",        _coverColor(stats.effectiveCoverage)) +
        _chip("⚖️", Math.round(stats.lbs * 100) + "%", "LBS — توازن الحمل", _lbsColor(stats.lbs)) +
        _chip("🔁", stats.redundantLectures,         "احتياطي للأهمية",       "#8b5cf6") +
      '</div>' +
      (tc
        ? '<div class="cov-effective-note">👥 تغطية الفريق = لو كلنا دخلنا الامتحان النهاردة، هنعرف نجاوب على <strong>' + tc.teamCoveragePercent + '%</strong> من المنهج (أي عضو في الفريق يعرفها). الفجوة: <strong>' + tc.uncoveredLectures + '</strong> محاضرة مفيش ولا واحد عارفها.</div>'
        : '<div class="cov-effective-note">💡 التغطية الفعلية = التوزيع × متوسط الموثوقية × جودة الشرح — بتعكس مدى فاعلية المجموعة فعلًا مش بس عدد المحاضرات.</div>')
    );
  }

  function _chip(icon, value, label, color) {
    return '<div class="cov-chip">' +
      '<div class="cov-chip-icon" style="color:' + color + '">' + icon + '</div>' +
      '<div class="cov-chip-val"  style="color:' + color + '">' + value + '</div>' +
      '<div class="cov-chip-lbl">' + label + '</div>' +
    '</div>';
  }

  function _renderTabBar() {
    return '<div class="cov-tab-bar">' +
      '<button class="cov-tab' + (_state.activeTab === "members" ? " active" : "") + '" onclick="CoverageUI._setTab(\'members\')">👥 توزيع الأعضاء</button>' +
      '<button class="cov-tab' + (_state.activeTab === "heatmap" ? " active" : "") + '" onclick="CoverageUI._setTab(\'heatmap\')">🔥 Heatmap التغطية</button>' +
    '</div>';
  }

  function _renderMembersTab(stats) {
    return (
      _renderBalanceBar(stats.memberBreakdown) +
      '<div class="cov-members-grid">' +
        stats.memberBreakdown.map(function(m, i) { return _renderMemberCard(m, i); }).join("") +
      '</div>' +
      _renderTeachingPairs(stats.memberBreakdown)
    );
  }

  function _renderBalanceBar(breakdown) {
    var maxH = Math.max.apply(null, breakdown.map(function(m) { return m.hours; })) || 0.1;
    return '<div class="cov-card">' +
      '<div class="cov-section-label">📊 توزيع ساعات الدراسة</div>' +
      '<div class="cov-balance-list">' +
        breakdown.map(function(m, i) {
          return '<div class="cov-balance-row">' +
            '<span class="cov-bal-name">' + m.name + '</span>' +
            '<div class="cov-bal-track">' +
              '<div class="cov-bal-fill" style="width:' + (m.hours / maxH) * 100 + '%;background:' + COLORS[i % COLORS.length] + '"></div>' +
            '</div>' +
            '<span class="cov-bal-val">' + m.hours + 'h · ' + m.lectureCount + ' محاضرة</span>' +
            _renderRiskBadge(m.riskScore) +
          '</div>';
        }).join("") +
      '</div>' +
    '</div>';
  }

  function _renderRiskBadge(risk) {
    if (risk < 0.3) return '<span class="cov-risk-badge low">موثوق</span>';
    if (risk < 0.6) return '<span class="cov-risk-badge med">متوسط</span>';
    return '<span class="cov-risk-badge high">خطر</span>';
  }

  function _renderMemberCard(member, idx) {
    var color    = COLORS[idx % COLORS.length];
    var initials = (member.name || "").slice(0, 2);

    return '<div class="cov-member-card" style="--cov-accent:' + color + '">' +
      '<div class="cov-mc-header">' +
        '<div class="cov-mc-avatar" style="background:' + color + '20;color:' + color + '">' + initials + '</div>' +
        '<div style="flex:1">' +
          '<div class="cov-mc-name">' + member.name + '</div>' +
          '<div class="cov-mc-meta">' + member.lectureCount + ' محاضرة · ' + member.hours + 'h</div>' +
        '</div>' +
        _renderRiskBadge(member.riskScore) +
      '</div>' +

      (member.owned.length
        ? '<div class="cov-lec-list">' +
          member.owned.map(function(l) {
            return '<div class="cov-lec-row">' +
              '<span class="cov-lec-badge primary" style="background:' + color + '18;color:' + color + '">✏️ مسؤول</span>' +
              '<span class="cov-lec-name">' + (l.t || l.s || l.id) + '</span>' +
              (l.imp != null ? '<span class="cov-lec-imp">⭐' + l.imp + '</span>' : "") +
            '</div>';
          }).join("") +
          '</div>'
        : "") +

      (member.backup.length
        ? '<div class="cov-backup-section">' +
          '<div class="cov-backup-label">احتياطي:</div>' +
          member.backup.map(function(l) {
            return '<div class="cov-lec-row">' +
              '<span class="cov-lec-badge backup">🔁 احتياطي</span>' +
              '<span class="cov-lec-name">' + (l.t || l.s || l.id) + '</span>' +
            '</div>';
          }).join("") +
          '</div>'
        : "") +
    '</div>';
  }

  function _renderTeachingPairs(breakdown) {
    var teachers = breakdown.filter(function(m) { return m.owned.length > 0; });
    if (teachers.length < 2) return "";
    return '<div class="cov-card cov-teaching-card">' +
      '<div class="cov-section-label">🎓 جدول الشرح المقترح</div>' +
      '<div class="cov-teaching-list">' +
        teachers.map(function(t) {
          return '<div class="cov-teaching-row">' +
            '<div class="cov-teaching-teacher"><strong>' + t.name + '</strong> يشرح ' + t.owned.length + ' محاضرة</div>' +
            '<span class="cov-teaching-arrow">→</span>' +
            '<div class="cov-teaching-students">' +
              breakdown.filter(function(m) { return m.id !== t.id; }).map(function(s) {
                return '<span class="cov-student-chip">' + s.name + '</span>';
              }).join("") +
            '</div>' +
          '</div>';
        }).join("") +
      '</div>' +
      '<p class="cov-teaching-note">💡 كل عضو يشرح محاضراته للباقيين — وبكده كل الأعضاء يبقوا مزاكرين كل المنهج.</p>' +
    '</div>';
  }

  function _renderHeatmapTab(stats, assignmentReasons) {
    var rows = stats.heatmap;
    return '<div class="cov-card cov-heatmap-card">' +
      '<div class="cov-section-label">🔥 خريطة حرارة التغطية</div>' +
      '<div class="cov-table-wrapper">' +
        '<table class="cov-heatmap-table">' +
          '<thead><tr>' +
            '<th>المحاضرة</th><th>الأهمية</th><th>المسؤول</th><th>الاحتياطي</th><th>مستوى الخطر</th><th>لماذا؟</th>' +
          '</tr></thead>' +
          '<tbody>' +
            rows.map(function(row) {
              return '<tr class="cov-heatmap-row risk-' + row.coverageRisk.toLowerCase() + '">' +
                '<td class="cov-ht-name">' + row.lectureName + '</td>' +
                '<td class="cov-ht-imp">' + "⭐".repeat(Math.round(row.imp / 2)) + '</td>' +
                '<td class="cov-ht-owner">' + row.owner + (row.promoted ? '<span class="cov-promoted-tag">↑ مُرقِّي</span>' : "") + '</td>' +
                '<td class="cov-ht-backup">' + row.backup + '</td>' +
                '<td><span class="cov-risk-pill ' + row.coverageRisk.toLowerCase() + '">' + _riskArabic(row.coverageRisk) + '</span></td>' +
                '<td>' +
                  (assignmentReasons && assignmentReasons[row.lectureId]
                    ? '<button class="cov-why-btn" onclick="CoverageUI._openWhy(\'' + row.lectureId + '\')">لماذا؟</button>'
                    : "—") +
                '</td>' +
              '</tr>';
            }).join("") +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>';
  }

  function _riskArabic(risk) {
    var map = { HIGH: "عالي 🔴", MEDIUM: "متوسط 🟡", LOW: "منخفض 🟢", UNCOVERED: "غير مغطى ⚪" };
    return map[risk] || risk;
  }

  function _renderWhyPopup(assignmentReasons) {
    if (!_state.whyLectureId || !assignmentReasons) return "";
    var entry = assignmentReasons[_state.whyLectureId];
    if (!entry) return "";

    return '<div class="cov-why-overlay" onclick="CoverageUI._closeWhy()">' +
      '<div class="cov-why-card" onclick="event.stopPropagation()">' +
        '<div class="cov-why-header">' +
          '<span>🤔 لماذا اتعين لـ ' + entry.memberName + '؟</span>' +
          '<button class="cov-why-close" onclick="CoverageUI._closeWhy()">✕</button>' +
        '</div>' +
        '<ul class="cov-why-list">' +
          entry.reasons.map(function(r) { return '<li>✅ ' + r + '</li>'; }).join("") +
        '</ul>' +
        '<p class="cov-why-note">النظام بيوازن بين: التقدم الحالي + الحمل + الموثوقية + التنويع المقصود.</p>' +
      '</div>' +
    '</div>';
  }

  function _renderCoverageSummary(stats) {
    var missing = stats.totalLectures - stats.coveredLectures;
    var tc = _state.teamCoverage;
    var h = '<div class="cov-summary-note">' +
      '<span>📊</span>' +
      '<span>توزيع: <strong>' + stats.coveredLectures + '</strong> من <strong>' + stats.totalLectures + '</strong> محاضرة (فعلي: <strong>' + stats.effectiveCoverage + '%</strong>) — ' +
      (stats.coveragePercent === 100
        ? "✅ توزيع كامل"
        : "⚠️ " + missing + " خارج التوزيع") +
      '</span>' +
    '</div>';
    if (tc) {
      h += '<div class="cov-summary-note" style="margin-top:6px;background:var(--surface-2)">' +
        '<span>👥</span>' +
        '<span>تغطية الفريق: <strong>' + tc.coveredLectures + '</strong> من <strong>' + tc.totalLectures + '</strong> محاضرة يعرفها عضو واحد على الأقل (<strong>' + tc.teamCoveragePercent + '%</strong>) — ' +
        (tc.teamCoveragePercent >= 90
          ? "🔥 الفريق يغطي المنهج بالكامل تقريبًا"
          : "⚠️ " + tc.uncoveredLectures + " محاضرة مفيش ولا واحد عارفها، محتاجة تركيز") +
        '</span>' +
      '</div>';
    }
    return h;
  }

  function _coverColor(p) { return p >= 85 ? "#10b981" : p >= 65 ? "#f59e0b" : "#ef4444"; }
  function _lbsColor(k)   { return k >= 0.8 ? "#10b981" : k >= 0.6 ? "#f59e0b" : "#ef4444"; }

  /* ══════════════════════════════════════════════════════════════════
     ACTIONS
  ══════════════════════════════════════════════════════════════════ */

  function _toggleSubject(subject) {
    var idx = _state.selectedSubjects.indexOf(subject);
    if (idx === -1) _state.selectedSubjects.push(subject);
    else _state.selectedSubjects.splice(idx, 1);
    _state.result = null;
    render();
  }

  function _toggleGrade100() {
    _state.grade100 = !_state.grade100;
    _state.result   = null;
    render();
  }

  function _clearAll() {
    _state.selectedSubjects = [];
    _state.grade100         = false;
    _state.result           = null;
    render();
  }

  function _generate() {
    if ((_state.selectedSubjects.length === 0 && !_state.grade100) || _state.loading) return;
    _state.loading = true;
    render();

    var opts = {};
    if (_state.grade100) opts.gradeFilter = '100';
    if (_state.selectedSubjects.length > 0) opts.subjectFilter = _state.selectedSubjects.slice();

    setTimeout(function() {
      try {
        _state.result = CoverageEngine.distributeLectures(
          _lectures(), _members(), _progress(), opts
        );
        if (typeof Engine !== 'undefined' && Engine.getTeamCoverage) {
          var filtered = _lectures().filter(function(l) { return (_state.selectedSubjects.length === 0 || _state.selectedSubjects.indexOf(l.s) !== -1) && (!_state.grade100 || String(l.g) === '100'); });
          _state.teamCoverage = Engine.getTeamCoverage(
            filtered.length ? filtered : _lectures(),
            _progress()
          );
        }
      } catch (err) {
        console.error("[CoverageUI] Generate error:", err);
        if (typeof showToast === 'function') showToast('فشل التوزيع: ' + err.message, 'fire');
        _state.result = null;
      }
      _state.loading = false;
      render();
    }, 60);
  }

  function _save() {
    if (!_state.result) return;
    CoverageEngine.savePlan(
      { grade: _state.selectedGrade, stats: _state.result.stats },
      typeof _fbDb  !== "undefined" ? _fbDb  : null,
      typeof _fbSDK !== "undefined" ? _fbSDK : null
    );
    _state.saved = true;
    render();
    if (typeof showToast === 'function') showToast('تم حفظ الخطة ✅', 'success');
  }

  function _setTab(tab) {
    _state.activeTab = tab;
    render();
  }

  function _openWhy(lectureId) {
    _state.whyLectureId = lectureId;
    render();
  }

  function _closeWhy() {
    _state.whyLectureId = null;
    render();
  }

  function _exportPDF() {
    if (!_state.result) return;
    var s = _state.result.stats;
    var lines = [];

    function esc(t) { return (t || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }

    lines.push('<!DOCTYPE html><html dir="rtl"><head><meta charset="UTF-8"><title>🗺️ توزيع التغطية</title>');
    lines.push('<style>');
    lines.push('body{font-family:"Cairo",sans-serif;background:#fff;color:#111;padding:2rem;max-width:800px;margin:0 auto}');
    lines.push('h1{font-size:1.5rem;margin-bottom:4px}');
    lines.push('.sub{color:#666;font-size:.9rem;margin-bottom:1.5rem}');
    lines.push('.stats{display:flex;gap:12px;margin-bottom:1.5rem;flex-wrap:wrap}');
    lines.push('.stat{background:#f5f5f5;padding:10px 16px;border-radius:8px;text-align:center;flex:1;min-width:100px}');
    lines.push('.stat-num{font-size:1.3rem;font-weight:700;color:#7c3aed}');
    lines.push('.stat-lbl{font-size:.75rem;color:#888;margin-top:2px}');
    lines.push('h2{font-size:1.1rem;margin:1.5rem 0 .5rem;padding-bottom:4px;border-bottom:2px solid #eee}');
    lines.push('.member{margin-bottom:1rem;padding:10px;border:1px solid #eee;border-radius:8px}');
    lines.push('.member h3{margin:0 0 6px;font-size:1rem}');
    lines.push('.lec{font-size:.85rem;padding:3px 0;color:#333}');
    lines.push('.lec span{display:inline-block;background:#ede9fe;color:#7c3aed;font-size:.7rem;padding:1px 8px;border-radius:4px;margin-left:6px}');
    lines.push('.lec .backup{background:#f1f5f9;color:#64748b}');
    lines.push('.teaching{margin-top:1rem;padding:10px;background:#f9fafb;border-radius:8px;font-size:.85rem}');
    lines.push('.teaching strong{color:#7c3aed}');
    lines.push('.footer{text-align:center;margin-top:2rem;font-size:.8rem;color:#aaa}');
    lines.push('@media print{body{padding:1rem}.stats{break-inside:avoid}.member{break-inside:avoid}}');
    lines.push('</style></head><body>');

    lines.push('<h1>🗺️ توزيع التغطية</h1>');
    lines.push('<div class="sub">' + new Date().toLocaleDateString("ar-EG") + ' — ' + (_state.grade100 ? 'جميع المواد' : _state.selectedSubjects.join("، ")) + '</div>');

    lines.push('<div class="stats">');
    lines.push('<div class="stat"><div class="stat-num">' + s.coveragePercent + '%</div><div class="stat-lbl">نسبة التغطية</div></div>');
    lines.push('<div class="stat"><div class="stat-num">' + s.effectiveCoverage + '%</div><div class="stat-lbl">التغطية الفعلية</div></div>');
    lines.push('<div class="stat"><div class="stat-num">' + Math.round(s.lbs * 100) + '%</div><div class="stat-lbl">توازن الحمل (LBS)</div></div>');
    lines.push('<div class="stat"><div class="stat-num">' + s.redundantLectures + '</div><div class="stat-lbl">احتياطي</div></div>');
    lines.push('</div>');

    s.memberBreakdown.forEach(function(m) {
      lines.push('<div class="member"><h3>✏️ ' + esc(m.name) + ' — ' + m.lectureCount + ' محاضرة (' + m.hours + 'h)</h3>');
      m.owned.forEach(function(l) {
        lines.push('<div class="lec"><span>مسؤول</span>' + esc(l.t || l.s || l.id) + (l.imp ? ' ⭐' + l.imp : '') + '</div>');
      });
      m.backup.forEach(function(l) {
        lines.push('<div class="lec"><span class="backup">احتياطي</span>' + esc(l.t || l.s || l.id) + '</div>');
      });
      lines.push('</div>');
    });

    // Teaching pairs
    var teachers = s.memberBreakdown.filter(function(m) { return m.owned.length > 0; });
    if (teachers.length >= 2) {
      lines.push('<h2>🎓 جدول الشرح المقترح</h2>');
      teachers.forEach(function(t) {
        lines.push('<div class="teaching"><strong>' + esc(t.name) + '</strong> يشرح ' + t.owned.length + ' محاضرة ← ' +
          s.memberBreakdown.filter(function(m) { return m.id !== t.id; }).map(function(m) { return esc(m.name); }).join("، ") + '</div>');
      });
    }

    var missing = s.totalLectures - s.coveredLectures;
    lines.push('<div style="margin-top:1.5rem;padding:10px;background:#f0fdf4;border-radius:8px;font-size:.85rem">📊 تغطية <strong>' + s.coveredLectures + '</strong> من <strong>' + s.totalLectures + '</strong> محاضرة' +
      (s.coveragePercent === 100 ? ' ✅ تغطية كاملة' : ' ⚠️ ' + missing + ' خارج التوزيع') + '</div>');

    lines.push('<div class="footer">تم الإنشاء بواسطة الخلاصة — ' + new Date().toLocaleString("ar-EG") + '</div>');
    lines.push('</body></html>');

    // Also open WhatsApp with text summary
    var txt = [];
    txt.push("🗺️ توزيع التغطية");
    txt.push("📅 " + new Date().toLocaleDateString("ar-EG"));
    txt.push("📊 تغطية: " + s.coveragePercent + "% | فعلي: " + s.effectiveCoverage + "% | LBS: " + Math.round(s.lbs * 100) + "%");
    txt.push("");
    s.memberBreakdown.forEach(function(m) {
      var owned = m.owned.map(function(l) { return l.t || l.s || l.id; });
      txt.push("● " + m.name + " (" + m.lectureCount + "م - " + m.hours + "س):");
      if (owned.length) txt.push("  ✏️ " + owned.join("، "));
      if (m.backup.length) txt.push("  🔁 احتياطي");
    });
    txt.push("");
    txt.push("⚠️ مخاطر التوزيع:");
    txt.push("• المكلف بالشرح قد لا يكون متمكنًا من الشرح");
    txt.push("• قد لا يلتزم البعض بالمواعيد");
    txt.push("• الجميع سيدرس كل المحاضرات لكن باختلاف الأولويات");
    txt.push("• عدم الالتزام قد يؤثر على المجموعة بأكملها");
    txt.push("");
    txt.push("تم بواسطة الخلاصة");
    window.open("https://wa.me/?text=" + encodeURIComponent(txt.join("\n")), "_blank");

    // Open print-friendly PDF view
    var w = window.open('', '_blank', 'width=800,height=600');
    if (w) {
      w.document.write(lines.join('\n'));
      w.document.close();
      w.focus();
      setTimeout(function() { w.print(); }, 500);
    }
  }

  window.CoverageUI = { render: render, _toggleSubject: _toggleSubject, _toggleGrade100: _toggleGrade100, _clearAll: _clearAll, _generate: _generate, _setTab: _setTab, _openWhy: _openWhy, _closeWhy: _closeWhy, _exportPDF: _exportPDF };

})();
