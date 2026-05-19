/**
 * engine.js — Core Adaptive Study Coordination Engine
 *
 * Pure decision layer.  No DOM, no Firebase.
 * All functions are deterministic given (lecture, progressMap).
 */
const Engine = (() => {
  const MEMBER_COUNT = typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7;

  // ── Cache ──
  const _lectureStatsCache = {};

  function _invalidateCache(lectureId) {
    delete _lectureStatsCache[lectureId];
  }
  function _invalidateAllCache() {
    Object.keys(_lectureStatsCache).forEach(k => delete _lectureStatsCache[k]);
  }

  // ── Low-level helpers ──
  function _getPct(progressMap, userId, lectureId) {
    const p = progressMap[userId];
    if (!p) return undefined;
    const v = p[lectureId];
    return v !== undefined && v !== null ? +v : undefined;
  }

  function _getAllPcts(progressMap, lectureId) {
    const out = [];
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const v = _getPct(progressMap, uid, lectureId);
      if (v !== undefined) out.push(v);
    }
    return out;
  }

  function _daysUntil(dateStr) {
    if (!dateStr) return 30;
    const target = new Date(dateStr);
    const now = new Date();
    const diff = Math.ceil((target - now) / (1000 * 60 * 60 * 24));
    return diff > 0 ? diff : 0;
  }

  function _stdDev(values) {
    if (values.length < 2) return 0;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const sqDiffs = values.map(v => (v - avg) ** 2);
    return Math.sqrt(sqDiffs.reduce((s, v) => s + v, 0) / values.length);
  }

  // ── 1. getLectureStats (cached) ──
  function getLectureStats(lectureId, progressMap) {
    const key = lectureId + '|' + (progressMap._version || 0);
    if (_lectureStatsCache[key]) return _lectureStatsCache[key];

    const allPcts = _getAllPcts(progressMap, lectureId);
    const avgPct = allPcts.length > 0
      ? allPcts.reduce((s, v) => s + v, 0) / allPcts.length
      : 0;
    const stdDev = _stdDev(allPcts);

    let weak = 0, moderate = 0, strong = 0, notStudied = 0;
    const weakMembers = [];
    const strongMembers = [];
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const pct = _getPct(progressMap, uid, lectureId);
      if (pct === undefined) { notStudied++; weakMembers.push(uid); continue; }
      if (pct >= 80) { strong++; strongMembers.push(uid); }
      else if (pct >= 40) { moderate++; }
      else { weak++; weakMembers.push(uid); }
    }

    // top performer = highest pct (tiebreak by uid)
    let topPerformer = 0;
    let topPct = -1;
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const pct = _getPct(progressMap, uid, lectureId);
      const effective = pct !== undefined ? pct : -1;
      if (effective > topPct) { topPct = effective; topPerformer = uid; }
    }

    const stats = { avgPct, stdDev, weak, moderate, strong, notStudied, weakMembers, strongMembers, topPerformer, topPct };
    _lectureStatsCache[key] = stats;
    return stats;
  }

  // ── 2. calcPriority (weighted additive, normalized) ──
  function calcPriority(lecture, progressMap) {
    const imp = lecture.imp || 3;
    const diff = lecture.diff || 3;
    const examDays = _daysUntil(lecture.exam);
    // examFactor: 0 (exam passed) to 30 (exam tomorrow)
    const examFactor = examDays > 0 ? Math.max(1, 30 - examDays) : 0;

    // Normalize each factor to 0-1 range
    const normImp = imp / 10;
    const normDiff = diff / 10;
    const normExam = examFactor / 30;

    // Progress penalty: higher progress → lower priority
    const stats = getLectureStats(lecture.id, progressMap);
    const progressPenalty = (stats.avgPct / 100) * 0.5;

    // Weighted additive formula
    return (0.4 * normImp) + (0.3 * normDiff) + (0.3 * normExam) - progressPenalty;
  }

  // ── 3. calcCoverageEfficiency ──
  function calcCoverageEfficiency(lecture, progressMap) {
    const estHours = (lecture.g || 120) / 60;
    if (estHours <= 0) return 0;

    let knowledgeGap = 0;
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const pct = _getPct(progressMap, uid, lecture.id);
      if (pct === undefined || pct < 100) {
        knowledgeGap += 100 - (pct || 0);
      }
    }
    return knowledgeGap / estHours;
  }

  // ── Breakdown: priority components for explainability ──
  function _getPriorityBreakdown(lecture, progressMap) {
    const imp = lecture.imp || 3;
    const diff = lecture.diff || 3;
    const examDays = _daysUntil(lecture.exam);
    const examFactor = examDays > 0 ? Math.max(1, 30 - examDays) : 0;
    const normImp = imp / 10;
    const normDiff = diff / 10;
    const normExam = examFactor / 30;
    const stats = getLectureStats(lecture.id, progressMap);
    const progressPenalty = (stats.avgPct / 100) * 0.5;
    return {
      normImp: +(normImp * 0.4).toFixed(3),
      normDiff: +(normDiff * 0.3).toFixed(3),
      normExam: +(normExam * 0.3).toFixed(3),
      progressPenalty: +progressPenalty.toFixed(3),
      total: +(0.4 * normImp + 0.3 * normDiff + 0.3 * normExam - progressPenalty).toFixed(3),
      raw: { imp, diff, examDays, avgPct: +stats.avgPct.toFixed(1) }
    };
  }

  // ── 4. classifyMeeting (the core rule engine) ──
  function classifyMeeting(lecture, progressMap) {
    const stats = getLectureStats(lecture.id, progressMap);
    const priority = calcPriority(lecture, progressMap);
    const imp = lecture.imp || 3;
    const diff = lecture.diff || 3;
    const examDays = _daysUntil(lecture.exam);
    const bd = _getPriorityBreakdown(lecture, progressMap);

    // Dynamic split threshold based on difficulty
    const splitThreshold = 20 + (diff * 1.5);

    // Shared debug snapshot
    const debugSnapshot = {
      stats: { avgPct: Math.round(stats.avgPct), stdDev: Math.round(stats.stdDev), weak: stats.weak, strong: stats.strong, notStudied: stats.notStudied },
      factors: { imp, diff, examDays, splitThreshold: +splitThreshold.toFixed(1) },
      priorityBreakdown: bd
    };

    // Rule: high stdDev → split team
    if (stats.stdDev >= splitThreshold) {
      return {
        type: 'split',
        reason: `تفاوت كبير (${Math.round(stats.stdDev)}%) — تقسيم الفريق`,
        participants: [...Array(MEMBER_COUNT).keys()],
        priority,
        splitRequired: true,
        debug: { ...debugSnapshot, rule: 'high_stdDev_split' }
      };
    }

    // Rule: avg >= 80% AND weak <= 2 → recovery session for weak members
    if (stats.avgPct >= 80 && stats.weak <= 2) {
      return {
        type: 'recovery',
        reason: `${stats.weak} عضو يحتاج مراجعة — باقي الفريق فوق 80%`,
        participants: stats.weakMembers.length > 0 ? [...stats.weakMembers] : [...stats.notStudied > 0 ? stats.weakMembers : []],
        priority,
        debug: { ...debugSnapshot, rule: 'avg_high_weak_few_recovery' }
      };
    }

    // Rule: importance >= 8 AND exam within 7 days → full group mandatory meeting
    if (imp >= 8 && examDays <= 7) {
      return {
        type: 'full',
        reason: `أهمية عالية (${imp}/10) وامتحان بعد ${examDays} يوم — حضور إلزامي`,
        participants: [...Array(MEMBER_COUNT).keys()],
        priority,
        debug: { ...debugSnapshot, rule: 'high_imp_close_exam_full' }
      };
    }

    // Rule: avg >= 70% AND difficulty <= 4 → summary only (rapid review)
    if (stats.avgPct >= 70 && diff <= 4) {
      return {
        type: 'summary',
        reason: 'الفريق فاهم معظم المحاضرة — مراجعة سريعة فقط',
        participants: [...Array(MEMBER_COUNT).keys()],
        priority,
        revisionMode: true,
        debug: { ...debugSnapshot, rule: 'high_avg_easy_summary' }
      };
    }

    // Rule: avg < 40% AND imp >= 3 → mini focused session
    if (stats.avgPct < 40 && imp >= 3) {
      return {
        type: 'mini',
        reason: `نسبة الفهم منخفضة (${Math.round(stats.avgPct)}%) — جلسة مركزة`,
        participants: [...stats.weakMembers, ...Array.from({ length: MEMBER_COUNT }, (_, i) => i).filter(i => !stats.weakMembers.includes(i) && _getPct(progressMap, i, lecture.id) !== undefined).slice(0, 2)],
        priority,
        debug: { ...debugSnapshot, rule: 'low_avg_imp_mini' }
      };
    }

    // Rule: avg >= 80% → self study (no meeting)
    if (stats.avgPct >= 80) {
      return {
        type: 'self_study',
        reason: 'الفريق فاهم المحاضرة — مذاكرة فردية',
        participants: [],
        priority,
        debug: { ...debugSnapshot, rule: 'high_avg_self_study' }
      };
    }

    // Default: balanced mini meeting
    const allMembers = Array.from({ length: MEMBER_COUNT }, (_, i) => i);
    const participants = [...stats.weakMembers, ...allMembers.filter(i => !stats.weakMembers.includes(i) && stats.strongMembers.includes(i)).slice(0, 1)];
    return {
      type: 'mini',
      reason: `توزيع متوسط — ${Math.round(stats.avgPct)}% فهم`,
      participants: participants.length > 0 ? participants : allMembers.slice(0, 4),
      priority,
      debug: { ...debugSnapshot, rule: 'default_balanced_mini' }
    };
  }

  // ── 5. detectOverload ──
  function detectOverload(lectures, progressMap) {
    const redLectures = [];
    const subjectCounts = {};

    lectures.forEach(lec => {
      const imp = lec.imp || 3;
      const stats = getLectureStats(lec.id, progressMap);

      if (imp >= 8 && stats.avgPct < 40) {
        redLectures.push({ lectureId: lec.id, subject: lec.s, title: lec.t, avgPct: Math.round(stats.avgPct) });
        subjectCounts[lec.s] = (subjectCounts[lec.s] || 0) + 1;
      }
    });

    const overloadedSubjects = Object.entries(subjectCounts)
      .filter(([, count]) => count >= 3)
      .map(([subject, count]) => ({ subject, count }));

    const totalRed = redLectures.length;
    return {
      overloaded: totalRed >= 3,
      redLectures,
      overloadedSubjects,
      totalRedCount: totalRed,
      severity: totalRed >= 5 ? 'critical' : totalRed >= 3 ? 'warning' : 'ok'
    };
  }

  // ── 6. Memory Decay Factor (for CRAM mode) ──
  function calcMemoryDecay(lecture, progressMap) {
    const stats = getLectureStats(lecture.id, progressMap);
    const examDays = _daysUntil(lecture.exam);
    // Only applies when exam is close and people already studied it
    if (examDays > 7 || examDays <= 0) return 0;
    if (stats.avgPct < 50) return 0; // not yet studied enough to decay

    // Closer to exam + higher prior progress = more decay concern
    const daysSinceRelevance = Math.max(1, 14 - examDays);
    const decayBoost = 0.15 * (1 - Math.exp(-0.08 * daysSinceRelevance));
    return decayBoost;
  }

  // ── 7. getTeamCoverage — union-based team knowledge coverage ──
  function getTeamCoverage(lectures, progressMap) {
    const total = lectures.length;
    let covered = 0;
    let maxSum = 0;
    const lectureDetails = [];

    lectures.forEach(lec => {
      let maxPct = 0;
      let who = -1;
      for (let uid = 0; uid < MEMBER_COUNT; uid++) {
        const pct = _getPct(progressMap, uid, lec.id);
        if (pct !== undefined && pct > maxPct) { maxPct = pct; who = uid; }
      }
      const isCovered = maxPct >= 80;
      if (isCovered) covered++;
      maxSum += maxPct;
      lectureDetails.push({
        lectureId: lec.id,
        title: lec.t || lec.s || lec.id,
        maxPct: Math.round(maxPct),
        covered: isCovered,
        topMember: who,
      });
    });

    return {
      teamCoveragePercent: total ? Math.round((covered / total) * 100) : 0,
      teamKnowledgePercent: total ? Math.round(maxSum / total) : 0,
      coveredLectures: covered,
      totalLectures: total,
      uncoveredLectures: total - covered,
      lectureDetails,
    };
  }

  // ── 8. priority-sorted lecture list ──
  function getPrioritySorted(lectures, progressMap) {
    const scored = lectures.map(lec => {
      const priority = calcPriority(lec, progressMap);
      const efficiency = calcCoverageEfficiency(lec, progressMap);
      const meeting = classifyMeeting(lec, progressMap);
      return { lecture: lec, priorityScore: priority, coverageEfficiency: efficiency, meetingType: meeting };
    });
    scored.sort((a, b) => b.priorityScore - a.priorityScore);
    return scored;
  }

  // ── Public API ──
  return {
    getLectureStats,
    getTeamCoverage,
    calcPriority,
    getPriorityBreakdown: _getPriorityBreakdown,
    calcCoverageEfficiency,
    classifyMeeting,
    detectOverload,
    calcMemoryDecay,
    getPrioritySorted,
    _invalidateCache,
    _invalidateAllCache
  };
})();

if (typeof window !== 'undefined') window.Engine = Engine;
