/**
 * roles.js — Dynamic Role Assignment Engine
 *
 * Assigns 4 roles per session based on progress + confidence accuracy:
 *   Explainer        — highest progress + confidence suit (minus teaching fatigue)
 *   Summarizer       — 50-70% overall (benefits most from teaching)
 *   QuestionHunter   — highest overall average + confidence accuracy
 *   WeakReviewer     — lowest progress for this lecture (with rotation)
 *
 * Pure functions for computation.  Side-effect tracking in localStorage.
 */
const Roles = (() => {
  const MEMBER_COUNT = typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7;
  const LS_KEY = 'khulasa_role_history';

  // ── Teaching Fatigue & Role History (localStorage) ──
  let _roleHistory = null;

  function _loadHistory() {
    if (_roleHistory) return _roleHistory;
    try {
      if (typeof LS !== 'undefined' && LS) {
        const raw = LS.getItem(LS_KEY);
        if (raw) {
          _roleHistory = JSON.parse(raw);
          if (_roleHistory && _roleHistory.explainers) return _roleHistory;
        }
      }
    } catch (e) { /* ignore */ }
    _roleHistory = { explainers: {}, weakReviewers: {} };
    return _roleHistory;
  }

  function _saveHistory() {
    try {
      if (typeof LS !== 'undefined' && LS && _roleHistory) {
        LS.setItem(LS_KEY, JSON.stringify(_roleHistory));
      }
    } catch (e) { /* ignore */ }
  }

  function _getExplainerCount(userId, daysBack) {
    daysBack = daysBack || 7;
    const h = _loadHistory();
    const entries = h.explainers[userId] || [];
    const cutoff = Date.now() - daysBack * 86400000;
    return entries.filter(ts => ts > cutoff).length;
  }

  function _getWeakReviewerCount(userId, daysBack) {
    daysBack = daysBack || 7;
    const h = _loadHistory();
    const entries = h.weakReviewers[userId] || [];
    const cutoff = Date.now() - daysBack * 86400000;
    return entries.filter(ts => ts > cutoff).length;
  }

  function trackAssignment(role, userId, lectureId) {
    const h = _loadHistory();
    const now = Date.now();
    if (role === 'explainer') {
      if (!h.explainers[userId]) h.explainers[userId] = [];
      h.explainers[userId].push(now);
    } else if (role === 'weakReviewer') {
      if (!h.weakReviewers[userId]) h.weakReviewers[userId] = [];
      h.weakReviewers[userId].push(now);
    }
    _saveHistory();
  }

  // ── Pure helpers ──
  function _getPct(progressMap, userId, lectureId) {
    const p = progressMap[userId];
    if (!p) return undefined;
    const v = p[lectureId];
    return v !== undefined && v !== null ? +v : undefined;
  }

  function _getOverallAvg(progressMap, userId) {
    const p = progressMap[userId];
    if (!p) return 0;
    let sum = 0, count = 0;
    LECTURES.forEach(l => {
      const v = p[l.id];
      if (v !== undefined && v !== null && +v > 0) {
        sum += +v;
        count++;
      }
    });
    return count > 0 ? sum / count : 0;
  }

  function _getQuizScore(progressMap, userId) {
    const p = progressMap[userId];
    if (!p) return 0;
    let total = 0;
    LECTURES.forEach(l => {
      if (l.q) {
        const v = p[l.id];
        if (v !== undefined && v !== null) total += +v;
      }
    });
    return total;
  }

  function _getMemberName(uid) {
    return (typeof MEMBERS !== 'undefined' && MEMBERS[uid]) ? MEMBERS[uid].name : `عضو ${uid}`;
  }

  function _getConfidencePenalty(progressMap, userId) {
    if (typeof window.Confidence !== 'undefined' && window.Confidence.getExplainerSuitability) {
      return 1 - window.Confidence.getExplainerSuitability(userId, null, progressMap) / 100;
    }
    return 0;
  }

  function _getTeachingFatiguePenalty(userId) {
    const count = _getExplainerCount(userId, 7);
    if (count <= 1) return 0;
    // Base fatigue: -5% per extra explainer assignment, max -30%
    let penalty = Math.min(0.3, (count - 1) * 0.05);

    // Feedback-based calibration: good explainer ratings reduce penalty
    if (typeof window.SessionFeedback !== 'undefined') {
      const rating = window.SessionFeedback.getExplainerRating(userId);
      if (rating !== null) {
        // rating 1-5: at 4+ quality, reduce penalty by half; at 2- quality, double it
        if (rating >= 4) penalty *= 0.5;
        else if (rating <= 2) penalty = Math.min(0.4, penalty * 2);
      }
    }
    return penalty;
  }

  function _getRotationBoost(userId) {
    const weakCount = _getWeakReviewerCount(userId, 14);
    // After 3 times as weak reviewer in 2 weeks, give rotation boost
    if (weakCount >= 3) {
      return weakCount * 0.03; // +3% per weak assignment
    }
    return 0;
  }

  // ── Build explainer score breakdown for debug ──
  function _buildExplainerBreakdown(progressMap, uid, lectureId) {
    const pct = _getPct(progressMap, uid, lectureId);
    const overallAvg = _getOverallAvg(progressMap, uid);
    const quizScore = _getQuizScore(progressMap, uid);
    const lecturePct = pct !== undefined ? pct : 0;
    const confidencePenalty = _getConfidencePenalty(progressMap, uid);
    const fatiguePenalty = _getTeachingFatiguePenalty(uid);
    const rotationBoost = _getRotationBoost(uid);
    const rawScore = lecturePct + overallAvg * 0.3 + quizScore * 0.1 - (confidencePenalty * 50) - (fatiguePenalty * 100) + (rotationBoost * 50);
    return {
      lecturePct: +lecturePct.toFixed(1),
      overallAvg: +overallAvg.toFixed(1),
      quizScore: +quizScore.toFixed(1),
      confidencePenalty: +confidencePenalty.toFixed(3),
      fatiguePenalty: +fatiguePenalty.toFixed(3),
      rotationBoost: +rotationBoost.toFixed(3),
      rawScore: +rawScore.toFixed(1)
    };
  }

  // ── assignRoleSet: 4 roles for a specific lecture across all members ──
  function assignRoleSet(lectureId, progressMap) {
    let explainer = null, summarizer = null, questionHunter = null, weakReviewer = null;
    let explainerScore = -Infinity, summarizerScore = Infinity, hunterScore = -Infinity, weakScore = Infinity;
    let explainerBreakdown = null;

    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const pct = _getPct(progressMap, uid, lectureId);
      const overallAvg = _getOverallAvg(progressMap, uid);
      const quizScore = _getQuizScore(progressMap, uid);
      const lecturePct = pct !== undefined ? pct : 0;

      // Explainer: highest lecture pct + confidence suit, minus fatigue
      const confidencePenalty = _getConfidencePenalty(progressMap, uid);
      const fatiguePenalty = _getTeachingFatiguePenalty(uid);
      const rotationBoost = _getRotationBoost(uid);
      const explainerCandidate = lecturePct + overallAvg * 0.3 + quizScore * 0.1 - (confidencePenalty * 50) - (fatiguePenalty * 100) + (rotationBoost * 50);
      if (explainerCandidate > explainerScore) {
        explainer = uid;
        explainerScore = explainerCandidate;
        explainerBreakdown = _buildExplainerBreakdown(progressMap, uid, lectureId);
      }

      // Summarizer: overallAvg closest to 60 (benefits most from teaching)
      const distFrom60 = Math.abs(overallAvg - 60);
      if (overallAvg > 0 && distFrom60 < summarizerScore) {
        summarizer = uid;
        summarizerScore = distFrom60;
      }

      // QuestionHunter: highest overall avg + confidence accuracy
      const hunterCandidate = overallAvg * 0.6;
      if (hunterCandidate > hunterScore) {
        questionHunter = uid;
        hunterScore = hunterCandidate;
      }

      // WeakReviewer: lowest lecture pct (with rotation: if already weak too many times, skip)
      const weakMaxCount = _getWeakReviewerCount(uid, 14);
      if (pct !== undefined && lecturePct < weakScore && weakMaxCount < 5) {
        weakReviewer = uid;
        weakScore = lecturePct;
      }
    }

    // Fallback for weakReviewer
    if (weakReviewer === null) {
      weakScore = Infinity;
      for (let uid = 0; uid < MEMBER_COUNT; uid++) {
        const avg = _getOverallAvg(progressMap, uid);
        if (avg < weakScore) {
          weakReviewer = uid;
          weakScore = avg;
        }
      }
    }

    // Ensure all 4 roles are distinct
    const used = new Set();
    function pickUnique(preferred) {
      if (preferred !== null && !used.has(preferred)) {
        used.add(preferred);
        return preferred;
      }
      for (let uid = 0; uid < MEMBER_COUNT; uid++) {
        if (!used.has(uid)) { used.add(uid); return uid; }
      }
      return 0;
    }

    explainer = pickUnique(explainer);
    summarizer = pickUnique(summarizer !== null && summarizer !== explainer ? summarizer : null);
    questionHunter = pickUnique(questionHunter !== null && questionHunter !== explainer && questionHunter !== summarizer ? questionHunter : null);
    weakReviewer = pickUnique(weakReviewer !== null && weakReviewer !== explainer && weakReviewer !== summarizer && weakReviewer !== questionHunter ? weakReviewer : null);

    // Track assignments
    trackAssignment('explainer', explainer, lectureId);
    trackAssignment('weakReviewer', weakReviewer, lectureId);

    return {
      explainer: { userId: explainer, name: _getMemberName(explainer), reason: `أعلى نسبة فهم (${Math.round(explainerScore)}%)`, breakdown: explainerBreakdown },
      summarizer: { userId: summarizer, name: _getMemberName(summarizer), reason: `يحتاج الشرح للتثبيت (المتوسط ${Math.round(_getOverallAvg(progressMap, summarizer))}%)` },
      questionHunter: { userId: questionHunter, name: _getMemberName(questionHunter), reason: `أعلى متوسط عام (${Math.round(hunterScore)})` },
      weakReviewer: { userId: weakReviewer, name: _getMemberName(weakReviewer), reason: `يحتاج مراجعة (نسبته ${Math.round(weakScore)}%)` }
    };
  }

  // ── assignRoleSetForGroup: scoped to a participant subset ──
  function assignRoleSetForGroup(lectureId, participantIds, progressMap) {
    let explainer = null, summarizer = null, questionHunter = null, weakReviewer = null;
    let explainerScore = -Infinity, summarizerScore = Infinity, hunterScore = -Infinity, weakScore = Infinity;
    let explainerBreakdown = null;

    participantIds.forEach(uid => {
      const pct = _getPct(progressMap, uid, lectureId);
      const overallAvg = _getOverallAvg(progressMap, uid);
      const quizScore = _getQuizScore(progressMap, uid);
      const lecturePct = pct !== undefined ? pct : 0;

      const confidencePenalty = _getConfidencePenalty(progressMap, uid);
      const fatiguePenalty = _getTeachingFatiguePenalty(uid);
      const rotationBoost = _getRotationBoost(uid);
      const explainerCandidate = lecturePct + overallAvg * 0.3 + quizScore * 0.1 - (confidencePenalty * 50) - (fatiguePenalty * 100) + (rotationBoost * 50);
      if (explainerCandidate > explainerScore) {
        explainer = uid; explainerScore = explainerCandidate;
        explainerBreakdown = _buildExplainerBreakdown(progressMap, uid, lectureId);
      }

      const distFrom60 = Math.abs(overallAvg - 60);
      if (overallAvg > 0 && distFrom60 < summarizerScore) {
        summarizer = uid; summarizerScore = distFrom60;
      }

      const hunterCandidate = overallAvg * 0.6;
      if (hunterCandidate > hunterScore) {
        questionHunter = uid; hunterScore = hunterCandidate;
      }

      const weakMaxCount = _getWeakReviewerCount(uid, 14);
      if (pct !== undefined && lecturePct < weakScore && weakMaxCount < 5) {
        weakReviewer = uid; weakScore = lecturePct;
      }
    });

    if (weakReviewer === null) {
      weakScore = Infinity;
      participantIds.forEach(uid => {
        const avg = _getOverallAvg(progressMap, uid);
        if (avg < weakScore) { weakReviewer = uid; weakScore = avg; }
      });
    }

    const used = new Set();
    function pickUnique(preferred) {
      if (preferred !== null && !used.has(preferred)) { used.add(preferred); return preferred; }
      for (let i = 0; i < participantIds.length; i++) {
        if (!used.has(participantIds[i])) { used.add(participantIds[i]); return participantIds[i]; }
      }
      return participantIds[0] || 0;
    }

    explainer = pickUnique(explainer);
    summarizer = pickUnique(summarizer !== null && summarizer !== explainer ? summarizer : null);
    questionHunter = pickUnique(questionHunter !== null && questionHunter !== explainer && questionHunter !== summarizer ? questionHunter : null);
    weakReviewer = pickUnique(weakReviewer !== null && weakReviewer !== explainer && weakReviewer !== summarizer && weakReviewer !== questionHunter ? weakReviewer : null);

    trackAssignment('explainer', explainer, lectureId);
    trackAssignment('weakReviewer', weakReviewer, lectureId);

    return {
      explainer: { userId: explainer, name: _getMemberName(explainer), reason: `أعلى نسبة فهم (${Math.round(explainerScore)}%)`, breakdown: explainerBreakdown },
      summarizer: { userId: summarizer, name: _getMemberName(summarizer), reason: 'يحتاج الشرح للتثبيت' },
      questionHunter: { userId: questionHunter, name: _getMemberName(questionHunter), reason: `أعلى متوسط عام (${Math.round(hunterScore)})` },
      weakReviewer: { userId: weakReviewer, name: _getMemberName(weakReviewer), reason: `يحتاج مراجعة (نسبته ${Math.round(weakScore)}%)` }
    };
  }

  return {
    assignRoleSet,
    assignRoleSetForGroup,
    trackAssignment,
    getExplainerCount: _getExplainerCount,
    getWeakReviewerCount: _getWeakReviewerCount
  };
})();

if (typeof window !== 'undefined') window.Roles = Roles;
