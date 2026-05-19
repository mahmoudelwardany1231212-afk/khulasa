/**
 * smart-plan-ui.js — Smart Plan UI Module
 *
 * Lightweight, fast, actionable sidebar tab.
 * No business logic — pure rendering from Scheduler output.
 */
const SmartPlanUI = (() => {
let _currentVariant = 'daily';
let _currentPlan = null;
let _currentSessions = null;
let _teamCoverage = null;
let _generating = false;
let _debugMode = false;

  // ── Cache ──
  function _loadCache() {
    try {
      if (typeof LS === 'undefined' || !LS) return null;
      const raw = LS.getItem('khulasa_smartplan');
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (data && data.plan && data.sessions) {
        _currentPlan = data.plan;
        _currentSessions = data.sessions;
        return data;
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  function _saveCache(plan, sessions) {
    try {
      if (typeof LS !== 'undefined' && LS) {
        LS.setItem('khulasa_smartplan', JSON.stringify({ plan, sessions }));
      }
    } catch (e) { /* ignore */ }
  }

  // ── Helpers ──
  function _timeStr(iso) {
    if (!iso) return '--:--';
    const d = new Date(iso);
    return d.toLocaleTimeString('ar-EG', { hour: '2-digit', minute: '2-digit', hour12: true });
  }

  function _memberName(uid) {
    return (typeof MEMBERS !== 'undefined' && MEMBERS[uid]) ? MEMBERS[uid].name : 'عضو ' + uid;
  }

  function _memberEmoji(uid) {
    return (typeof MEMBERS !== 'undefined' && MEMBERS[uid]) ? MEMBERS[uid].emoji : '👤';
  }

  function _typeClass(type) {
    return 'sp-type-' + (type || 'mini');
  }

  function _typeLabel(type) {
    const labels = {
      full: 'FULL MEETING',
      mini: 'MINI SESSION',
      recovery: 'RECOVERY',
      summary: 'SUMMARY',
      split: 'SPLIT TEAM',
      self_study: 'SELF STUDY',
      rapid_review: 'RAPID REVIEW'
    };
    return labels[type] || type.toUpperCase();
  }

  // ── Render: Main ──
  function render() {
    const container = document.getElementById('smartPlanContainer');
    if (!container) return;

    // Try cache first
    const cached = _loadCache();

    let html = '<div class="sp-container">';

    // Header
    html += '<div class="sp-header"><div><div class="sp-title">🤖 الخطة الذكية</div><div class="sp-subtitle">Smart Plan — تنسيق المذاكرة الجماعية</div></div>';
    html += `<button class="sp-debug-toggle" style="background:none;border:1px solid var(--hairline);color:var(--ink-muted);font-size:10px;padding:4px 8px;cursor:pointer;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif;transition:all .2s;${_debugMode ? 'border-color:var(--accent-blue);color:var(--accent-blue);' : ''}">${_debugMode ? '🔍 Debug ON' : '🔍 Debug'}</button>`;
    html += '</div>';

    // Variant selector
    html += _renderVariantSelector();

    // Generate button
    html += _renderGenerateButton();

    // Loading or content
    if (_generating) {
      html += _renderLoadingState();
    } else if (_currentPlan && _currentSessions) {
      // Stats
      html += _renderStats();

      // Overload alerts
      html += _renderOverloadAlerts();

      // Danger lectures
      html += _renderDangerLectures();

      // Session timeline (the actual session cards)
      html += _renderSessionTimeline();

      // Debug panel (only when debug mode is on)
      if (_debugMode) {
        html += _renderDebugPanel();
        html += _renderQualityMetrics();
      }
    }

    html += '</div>';
    container.innerHTML = html;

    // Bind variant clicks
    container.querySelectorAll('.sp-variant').forEach(el => {
      el.addEventListener('click', function () {
        _currentVariant = this.dataset.variant;
        render();
      });
    });

    // Bind debug toggle
    const debugBtn = container.querySelector('.sp-debug-toggle');
    if (debugBtn) {
      debugBtn.addEventListener('click', function () {
        _debugMode = !_debugMode;
        render();
      });
    }

    // Bind generate click
    const btn = container.querySelector('.sp-gen-btn');
    if (btn) {
      btn.addEventListener('click', function () {
        _generate(_currentVariant);
      });
    }

    // Bind card toggle clicks
    container.querySelectorAll('.sp-card-header').forEach(el => {
      el.addEventListener('click', function () {
        this.parentElement.classList.toggle('open');
      });
    });

    // Bind feedback button clicks
    container.querySelectorAll('.sp-feedback-btn').forEach(el => {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        _openFeedbackModal(this.dataset.sessionId);
      });
    });
  }

  // ── Render: Variant Selector ──
  function _renderVariantSelector() {
    const variants = [
      { key: 'daily', label: '📅 Daily', desc: 'متوازنة' },
      { key: 'weekly', label: '📆 Weekly', desc: 'شاملة' },
      { key: 'cram', label: '🚨 CRAM', desc: 'طوارئ' }
    ];
    let h = '<div class="sp-variants">';
    variants.forEach(v => {
      const isOn = _currentVariant === v.key;
      const extra = v.key === 'cram' ? ' sp-variant-cram' : '';
      h += `<div class="sp-variant${isOn ? ' on' : ''}${extra}" data-variant="${v.key}">${v.label}<div style="font-size:9px;font-weight:400;margin-top:2px;opacity:0.7">${v.desc}</div></div>`;
    });
    h += '</div>';
    return h;
  }

  // ── Render: Generate Button ──
  function _renderGenerateButton() {
    const isCram = _currentVariant === 'cram';
    const extra = isCram ? ' sp-cram-mode' : '';
    const disabled = _generating ? ' disabled' : '';
    return `<button class="sp-gen-btn${extra}"${disabled}>${_generating ? '⚙️ جاري الإنشاء...' : '🚀 Generate Plan'}</button>`;
  }

  // ── Render: Loading State ──
  function _renderLoadingState() {
    return `<div class="sp-loading">
      <div class="sp-loading-dots"><div class="sp-loading-dot"></div><div class="sp-loading-dot"></div><div class="sp-loading-dot"></div></div>
      <div class="sp-loading-text">${_getLoadingText()}</div>
    </div>`;
  }

  let _loadingStep = 0;
  const _loadingMessages = [
    'جاري تحليل المحاضرات...',
    'حساب الأولويات...',
    'تصنيف نوع الجلسات...',
    'توزيع الأدوار...',
    'تقسيم الفرق...',
    'تحسين الجدول الزمني...',
    'إنشاء الخطة...'
  ];

  function _getLoadingText() {
    return _loadingMessages[_loadingStep % _loadingMessages.length];
  }

  // ── Render: Stats ──
  function _renderStats() {
    if (!_currentPlan) return '';
    const p = _currentPlan;
    const totalHours = Math.round(p.totalDuration / 60 * 10) / 10;
    let h = `<div class="sp-stats">
      <div class="sp-stat"><div class="sp-stat-num">${p.sessionCount}</div><div class="sp-stat-label">جلسة</div></div>
      <div class="sp-stat"><div class="sp-stat-num">${totalHours}</div><div class="sp-stat-label">ساعة</div></div>
      <div class="sp-stat"><div class="sp-stat-num">${p.variant === 'cram' ? '🚨' : p.variant === 'weekly' ? '📆' : '📅'}</div><div class="sp-stat-label">${p.variant}</div></div>
    </div>`;
    if (_teamCoverage) {
      const tc = _teamCoverage;
      h += `<div class="cov-effective-note" style="margin:0 0 var(--spacing-sm) 0;font-size:.75rem">👥 تغطية الفريق (union): <strong>${tc.teamCoveragePercent}%</strong> — ${tc.coveredLectures}/${tc.totalLectures} محاضرة يعرفها عضو واحد على الأقل. الفجوة: ${tc.uncoveredLectures} محاضرة.</div>`;
    }
    return h;
  }

  // ── Render: Overload Alerts ──
  function _renderOverloadAlerts() {
    if (!_currentPlan || !_currentPlan.overload) return '';
    const o = _currentPlan.overload;
    if (o.severity === 'ok' && o.totalRedCount === 0) {
      return `<div class="sp-alert sp-alert-ok"><div class="sp-alert-icon">✅</div><div class="sp-alert-body"><strong>لا يوجد overload</strong><br>توازن الفريق سليم — لا توجد محاضرات حرجة</div></div>`;
    }

    let html = '';
    if (o.severity === 'critical' || o.severity === 'warning') {
      const cls = o.severity === 'critical' ? 'sp-alert-critical' : 'sp-alert-warning';
      const title = o.severity === 'critical' ? '⚠️ حمل زائد — وضع حرج' : '⚠️ حمل زائد ملحوظ';
      html += `<div class="sp-alert ${cls}"><div class="sp-alert-icon">⚠️</div><div class="sp-alert-body">`;
      html += `<strong>${title}</strong><br>`;
      html += `${o.totalRedCount} محاضرة تحتاج تدخل عاجل (أهمية عالية + نسبة فهم منخفضة)<br>`;
      if (o.overloadedSubjects.length > 0) {
        html += 'مواد مكدسة: ' + o.overloadedSubjects.map(s => s.subject + ' (' + s.count + ')').join('، ');
      }
      html += '</div></div>';
    }

    return html;
  }

  // ── Render: Danger Lectures ──
  function _renderDangerLectures() {
    if (!_currentPlan || !_currentPlan.overload) return '';
    const reds = _currentPlan.overload.redLectures || [];
    if (reds.length === 0) return '';

    let html = '<div class="sp-section">🔴 محاضرات خطر</div>';
    reds.slice(0, 5).forEach(r => {
      const gapLabel = r.avgPct < 20 ? 'فجوة معرفة حرجة' : r.avgPct < 30 ? 'فجوة معرفة كبيرة' : 'فجوة معرفة ملحوظة';
      html += `<div class="sp-danger-card"><div><div class="sp-danger-name">${r.title}</div><div class="sp-danger-meta">${r.subject} — ${gapLabel}</div></div><div style="font-size:10px;color:var(--semantic-danger);font-weight:700">⚠️</div></div>`;
    });
    return html;
  }

  // ── Render: Session Timeline ──
  function _renderSessionTimeline() {
    if (!_currentSessions || _currentSessions.length === 0) return '';
    const sorted = [..._currentSessions].sort((a, b) => new Date(a.startTime) - new Date(b.startTime));
    let html = '<div class="sp-section">📋 جدول الجلسات (Session Timeline)</div>';
    sorted.forEach(s => {
      html += _renderSessionCard(s);
    });
    return html;
  }

  // ── Render: Single Session Card ──
  function _renderSessionCard(session) {
    const s = session;
    const startStr = _timeStr(s.startTime);
    const endStr = _timeStr(s.endTime);
    const emoji = s.type === 'full' ? '🟦' : s.type === 'recovery' ? '🟩' : s.type === 'split' ? '🟥' : s.type === 'summary' ? '⬜' : '🟨';

    let html = `<div class="sp-card">`;
    html += `<div class="sp-card-header">`;
    html += `<span class="sp-card-type ${_typeClass(s.type)}">${emoji} ${_typeLabel(s.type)}</span>`;
    html += `<span class="sp-card-lecture">${s.subject ? '[' + s.subject + '] ' : ''}${s.lectureTitle || ''}</span>`;
    html += `<span class="sp-card-time">${startStr} → ${endStr}</span>`;
    html += `<span class="sp-card-priority">${s.priorityScore || ''}</span>`;
    html += `<span class="sp-card-arrow">▾</span>`;
    html += `</div>`;
    html += `<div class="sp-card-body"><div class="sp-card-inner">`;

    // Roles
    if (s.roles) {
      const roleList = [
        { key: 'explainer', label: 'Explainer' },
        { key: 'summarizer', label: 'Summarizer' },
        { key: 'questionHunter', label: 'Hunter' },
        { key: 'weakReviewer', label: 'Reviewer' }
      ];
      roleList.forEach(r => {
        if (s.roles[r.key]) {
          const role = s.roles[r.key];
          html += `<div class="sp-role-row"><span class="sp-role-label">${r.label}</span><span class="sp-role-name">${_memberEmoji(role.userId)} ${role.name}</span><span class="sp-role-reason">${role.reason || ''}</span></div>`;
        }
      });
    }

    // Reason
    if (s.reason) {
      html += `<div class="sp-card-reason">💡 ${s.reason}</div>`;
    }

    // Participants
    if (s.participants && s.participants.length > 0) {
      html += `<div class="sp-participants">`;
      s.participants.forEach(uid => {
        html += `<span class="sp-participant">${_memberEmoji(uid)} ${_memberName(uid)}</span>`;
      });
      html += `</div>`;
    }

    // Feedback button
    const hasFeedback = typeof SessionFeedback !== 'undefined' && SessionFeedback.getFeedback(s.id);
    html += `<div style="margin-top:var(--spacing-xs);display:flex;gap:6px;">`;
    html += `<button class="sp-feedback-btn" data-session-id="${s.id}" style="flex:1;padding:6px 10px;font-size:10px;font-weight:700;border:1px solid var(--hairline);background:var(--surface-2);color:var(--ink-muted);cursor:pointer;clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);font-family:'Cairo',sans-serif;transition:all .2s;">${hasFeedback ? '✅ تم التقييم' : '📝 تقييم الجلسة'}</button>`;
    html += `</div>`;

    // Debug info (only when debug mode is on)
    if (_debugMode) {
      html += _renderCardDebug(s);
    }

    html += `</div></div></div>`;
    return html;
  }

  // ── Render: Empty State ──
  function _renderEmptyState() {
    return `<div class="sp-empty">
      <div class="sp-empty-icon">🤖</div>
      <div class="sp-empty-title">الخطة الذكية جاهزة</div>
      <div class="sp-empty-desc">اضغط "Generate Plan" لإنشاء خطة مذاكرة ذكية مبنية على أداء الفريق.<br>سيتم تحليل المحاضرات، توزيع الأدوار، وتحديد أولويات المذاكرة الجماعية.</div>
    </div>`;
  }

  // ── Render: Debug Panel (internal) ──
  function _renderDebugPanel() {
    if (!_currentPlan) return '';
    let html = '<div class="sp-debug-panel"><div class="sp-section">🔍 Debug Panel</div>';

    const p = _currentPlan;
    html += '<div class="sp-debug-section"><div class="sp-debug-head">Plan Settings</div>';
    html += '<div class="sp-debug-row">Variant: <b>' + p.variant + '</b></div>';
    html += '<div class="sp-debug-row">Generated: ' + (p.generatedAt ? new Date(p.generatedAt).toLocaleString() : 'N/A') + '</div>';
    html += '<div class="sp-debug-row">Sessions: ' + p.sessionCount + ' | Total: ' + Math.round(p.totalDuration / 60 * 10) / 10 + 'h</div>';
    html += '<div class="sp-debug-row">Base duration: ' + (p.settings && p.settings.baseDuration || 45) + 'min</div>';
    html += '</div>';

    if (p.overload) {
      html += '<div class="sp-debug-section"><div class="sp-debug-head">Overload Source</div>';
      html += '<div class="sp-debug-row">Severity: <b class="' + (p.overload.severity === 'critical' ? 'sp-danger' : 'sp-warn') + '">' + p.overload.severity + '</b></div>';
      html += '<div class="sp-debug-row">Red lectures: ' + p.overload.totalRedCount + '</div>';
      if (p.overload.overloadedSubjects.length > 0) {
        html += '<div class="sp-debug-row">Overloaded subjects: ' + p.overload.overloadedSubjects.map(function (s) { return s.subject + ' (' + s.count + ')'; }).join(', ') + '</div>';
      }
      html += '</div>';
    }

    if (typeof Roles !== 'undefined') {
      html += '<div class="sp-debug-section"><div class="sp-debug-head">Teaching Fatigue & Rotation (7/14d)</div>';
      var mCount = typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7;
      for (var u = 0; u < mCount; u++) {
        var nm = (typeof MEMBERS !== 'undefined' && MEMBERS[u]) ? MEMBERS[u].name : 'عضو ' + u;
        var ec = Roles.getExplainerCount(u);
        var wc = Roles.getWeakReviewerCount(u, 14);
        html += '<div class="sp-debug-row">' + nm + ': explainer×' + ec + ', weak×' + wc + '</div>';
      }
      html += '</div>';
    }

    html += '</div>';
    return html;
  }

  // ── Render: Quality Metrics ──
  function _renderQualityMetrics() {
    if (!_currentSessions || typeof SessionFeedback === 'undefined') return '';
    var fbCount = 0;
    _currentSessions.forEach(function (s) {
      if (SessionFeedback.getFeedback(s.id)) fbCount++;
    });
    if (fbCount === 0) return '';

    var sessionIds = _currentSessions.map(function (s) { return s.id; });
    var helpfulness = SessionFeedback.getAvgHelpfulness(sessionIds);
    var understanding = SessionFeedback.getAvgUnderstandingGain(sessionIds);
    var reliability = SessionFeedback.getReliabilityScores();

    var html = '<div class="sp-debug-panel"><div class="sp-section">📊 Plan Quality Metrics</div>';
    html += '<div class="sp-debug-section">';
    html += '<div class="sp-debug-row">Sessions with feedback: <b>' + fbCount + '/' + _currentSessions.length + '</b></div>';
    if (helpfulness !== null) html += '<div class="sp-debug-row">Avg helpfulness: <b>' + helpfulness.toFixed(1) + '/5</b></div>';
    if (understanding !== null) html += '<div class="sp-debug-row">Avg understanding gain: <b>' + understanding.toFixed(0) + '%</b></div>';

    var reliable = 0, totalM = 0;
    for (var key in reliability) {
      if (reliability.hasOwnProperty(key)) {
        totalM++;
        if (reliability[key].reliability !== null && reliability[key].reliability >= 0.8) reliable++;
      }
    }
    if (totalM > 0) {
      html += '<div class="sp-debug-row">Reliable members (&ge;80%): <b>' + reliable + '/' + totalM + '</b></div>';
    }

    html += '</div></div>';

    if (_teamCoverage) {
      html += '<div class="sp-debug-section"><div class="sp-debug-head">👥 Team Coverage (Union)</div>';
      html += '<div class="sp-debug-row">Team coverage: <b>' + _teamCoverage.teamCoveragePercent + '%</b></div>';
      html += '<div class="sp-debug-row">Knowledge level: <b>' + _teamCoverage.teamKnowledgePercent + '%</b></div>';
      html += '<div class="sp-debug-row">Uncovered lectures: <b class="sp-danger">' + _teamCoverage.uncoveredLectures + '</b></div>';
      html += '</div>';
    }

    return html;
  }

  // ── Render: Card Debug Extensions ──
  function _renderCardDebug(session) {
    var cd = session.classificationDebug;
    if (!cd) return '';

    var html = '<div class="sp-debug-card-section">';

    var bd = cd.priorityBreakdown || session.priorityBreakdown;
    if (bd) {
      html += '<div class="sp-debug-card-row"><span class="sp-debug-label">Priority:</span> ';
      html += 'imp(' + bd.raw.imp + 'x0.4=' + bd.normImp + ') + diff(' + bd.raw.diff + 'x0.3=' + bd.normDiff + ') + exam(' + bd.raw.examDays + 'd->' + bd.normExam + ') - progress(' + bd.progressPenalty + ')';
      html += ' = <b>' + bd.total + '</b></div>';
    }

    html += '<div class="sp-debug-card-row"><span class="sp-debug-label">Rule:</span> <b>' + cd.rule + '</b>';
    if (cd.factors) {
      html += ' &mdash; imp=' + cd.factors.imp + ', diff=' + cd.factors.diff + ', exam=' + cd.factors.examDays + 'd';
      if (cd.factors.splitThreshold) html += ', splitThreshold=' + cd.factors.splitThreshold;
    }
    html += '</div>';

    if (cd.stats) {
      html += '<div class="sp-debug-card-row"><span class="sp-debug-label">Stats:</span> avg=' + cd.stats.avgPct + '%, sd=' + cd.stats.stdDev + '%, weak=' + cd.stats.weak + ', strong=' + cd.stats.strong + ', notStudied=' + cd.stats.notStudied + '</div>';
    }

    if (session.roles && session.roles.explainer && session.roles.explainer.breakdown) {
      var eb = session.roles.explainer.breakdown;
      html += '<div class="sp-debug-card-row"><span class="sp-debug-label">Explainer (uid ' + session.roles.explainer.userId + '):</span> ';
      html += 'lecturePct(' + eb.lecturePct + ') + avgx0.3(' + eb.overallAvg + 'x0.3=' + (eb.overallAvg * 0.3).toFixed(1) + ') + quizx0.1(' + eb.quizScore + 'x0.1=' + (eb.quizScore * 0.1).toFixed(1) + ')';
      html += ' - confx50(' + (eb.confidencePenalty * 50).toFixed(1) + ') - fatiguex100(' + (eb.fatiguePenalty * 100).toFixed(1) + ') + rotationx50(' + (eb.rotationBoost * 50).toFixed(1) + ')';
      html += ' = <b>' + eb.rawScore + '</b></div>';
    }

    html += '</div>';
    return html;
  }

  // ── Feedback Modal ──
  function _openFeedbackModal(sessionId) {
    if (typeof SessionFeedback === 'undefined') return;

    // Find session data
    const session = _currentSessions && _currentSessions.find(s => s.id === sessionId);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.85);backdrop-filter:blur(8px);z-index:9999;display:flex;align-items:center;justify-content:center;opacity:0;pointer-events:none;transition:opacity .3s;';

    overlay.innerHTML = `<div class="modal-box" style="position:relative;background:var(--surface-1);width:90%;max-width:380px;padding:var(--spacing-lg);border:1px solid var(--hairline);clip-path:polygon(16px 0,100% 0,calc(100% - 16px) 100%,0 100%);transform:translateY(20px);transition:all .3s;">
      <div class="m-close" style="position:absolute;top:12px;left:12px;width:30px;height:30px;background:#000;border:1px solid var(--accent-blue);display:flex;align-items:center;justify-content:center;cursor:pointer;font-size:12px;color:var(--accent-blue);clip-path:polygon(25% 0%,100% 0%,75% 100%,0% 100%);">✕</div>
      <div class="m-title" style="font-size:18px;font-weight:700;color:var(--ink);text-align:center;margin-bottom:4px;">📝 تقييم الجلسة</div>
      <div class="m-sub" style="font-size:11px;color:var(--ink-muted);text-align:center;margin-bottom:var(--spacing-md);">${session ? session.lectureTitle : ''}</div>
      <div style="display:flex;flex-direction:column;gap:var(--spacing-sm);">
        <div><div style="font-size:11px;font-weight:700;color:var(--ink-muted);margin-bottom:4px;">مدى الاستفادة (Helpfulness)</div>
          <div style="display:flex;gap:6px;" id="fbHelpfulness">
            ${[1,2,3,4,5].map(n => `<div class="fb-star" data-v="${n}" style="flex:1;text-align:center;padding:6px;border:1px solid var(--hairline);cursor:pointer;font-size:13px;background:var(--surface-2);color:var(--ink-muted);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);">${n}</div>`).join('')}
          </div></div>
        <div><div style="font-size:11px;font-weight:700;color:var(--ink-muted);margin-bottom:4px;">جودة الشرح (Explainer Quality)</div>
          <div style="display:flex;gap:6px;" id="fbExplainer">
            ${[1,2,3,4,5].map(n => `<div class="fb-star" data-v="${n}" style="flex:1;text-align:center;padding:6px;border:1px solid var(--hairline);cursor:pointer;font-size:13px;background:var(--surface-2);color:var(--ink-muted);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);">${n}</div>`).join('')}
          </div></div>
        <div><div style="font-size:11px;font-weight:700;color:var(--ink-muted);margin-bottom:4px;">نسبة الفهم بعد الجلسة</div>
          <div style="display:flex;gap:6px;" id="fbUnderstanding">
            ${[20,40,60,80,100].map(n => `<div class="fb-star" data-v="${n}" style="flex:1;text-align:center;padding:6px;border:1px solid var(--hairline);cursor:pointer;font-size:11px;background:var(--surface-2);color:var(--ink-muted);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);">${n}%</div>`).join('')}
          </div></div>
        <div><div style="font-size:11px;font-weight:700;color:var(--ink-muted);margin-bottom:4px;">مستوى الطاقة بعد الجلسة</div>
          <div style="display:flex;gap:6px;" id="fbEnergy">
            ${[1,2,3,4,5].map(n => `<div class="fb-star" data-v="${n}" style="flex:1;text-align:center;padding:6px;border:1px solid var(--hairline);cursor:pointer;font-size:13px;background:var(--surface-2);color:var(--ink-muted);clip-path:polygon(4px 0,100% 0,calc(100% - 4px) 100%,0 100%);">${n}</div>`).join('')}
          </div></div>
        <button id="fbSubmitBtn" style="width:100%;padding:12px;background:var(--gradient-violet);border:none;color:#000;font-size:14px;font-weight:900;cursor:pointer;clip-path:polygon(8px 0,100% 0,calc(100% - 8px) 100%,0 100%);font-family:'Cairo',sans-serif;margin-top:var(--spacing-xs);">إرسال التقييم</button>
      </div>
    </div>`;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => { overlay.style.opacity = '1'; overlay.style.pointerEvents = 'all'; });
    const box = overlay.querySelector('.modal-box');
    requestAnimationFrame(() => { box.style.transform = 'translateY(0)'; });

    // Star select logic
    const selections = {};
    overlay.querySelectorAll('.fb-star').forEach(el => {
      el.addEventListener('click', function () {
        const parent = this.parentElement;
        const val = parseInt(this.dataset.v);
        parent.querySelectorAll('.fb-star').forEach(s => {
          s.style.borderColor = 'var(--hairline)';
          s.style.background = 'var(--surface-2)';
          s.style.color = 'var(--ink-muted)';
        });
        parent.querySelectorAll('.fb-star').forEach(s => {
          if (parseInt(s.dataset.v) <= val) {
            s.style.borderColor = 'var(--accent-blue)';
            s.style.background = 'rgba(0,229,255,0.1)';
            s.style.color = 'var(--accent-blue)';
          }
        });
        selections[parent.id] = val;
      });
    });

    // Submit
    overlay.querySelector('#fbSubmitBtn').addEventListener('click', function () {
      const helpfulness = selections.fbHelpfulness;
      const explainerQuality = selections.fbExplainer;
      const understandingGained = selections.fbUnderstanding;
      const energyLevel = selections.fbEnergy;

      if (!helpfulness || !explainerQuality || !understandingGained || !energyLevel) {
        showToast('يرجى تقييم جميع الحقول', 'warn');
        return;
      }

      SessionFeedback.saveFeedback(sessionId, {
        helpfulness,
        explainerQuality,
        understandingGained,
        energyLevel,
        actualDuration: session ? session.duration : 30,
        attended: true
      });

      overlay.remove();
      render();
      showToast('تم حفظ التقييم ✅', 'success');
    });

    // Close
    overlay.addEventListener('click', function (e) {
      if (e.target === overlay) overlay.remove();
    });
    overlay.querySelector('.m-close').addEventListener('click', function () {
      overlay.remove();
    });
  }

  // ── Generate Flow ──
  function _generate(variant) {
    if (_generating) return;
    _generating = true;
    _loadingStep = 0;
    render();

    // Animate loading steps
    const stepInterval = setInterval(() => {
      _loadingStep++;
      const textEl = document.querySelector('.sp-loading-text');
      if (textEl) textEl.textContent = _getLoadingText();
    }, 600);

    // Defer to avoid blocking UI
    setTimeout(() => {
      try {
        const result = Scheduler.generatePlan(variant);
        _currentPlan = result.plan;
        _currentSessions = result.sessions;

        if (typeof Engine !== 'undefined' && Engine.getTeamCoverage) {
          _teamCoverage = Engine.getTeamCoverage(
            typeof LECTURES !== 'undefined' ? LECTURES : [],
            typeof store !== 'undefined' ? store.get().progress : {}
          );
        }

        // Try to save to Firebase
        if (typeof Scheduler.saveToFirebase === 'function') {
          Scheduler.saveToFirebase(result.plan, result.sessions);
        }

        _saveCache(result.plan, result.sessions);
      } catch (e) {
        console.error('[SmartPlanUI] Generation error:', e);
        showToast('فشل إنشاء الخطة: ' + e.message, 'fire');
      } finally {
        _generating = false;
        clearInterval(stepInterval);
        render();
      }
    }, 100);
  }

  return { render };
})();

if (typeof window !== 'undefined') window.SmartPlanUI = SmartPlanUI;
