/**
 * confidence.js — Self-Rating vs. Actual-Performance Gap Detector
 *
 * ConfidenceGap = SelfRating - ActualPerformance
 *
 * If the gap is large:
 *   - User is blocked from being Explainer
 *   - User is placed in a validation session
 *
 * Pure functions.  No DOM, no Firebase.
 */
const Confidence = (() => {
  const MEMBER_COUNT = typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7;

  // ── Self-rating storage ──
  // selfRatings[userId][lectureId] = 0-100 (self-reported)
  const _selfRatings = {};

  function setSelfRating(userId, lectureId, rating) {
    if (!_selfRatings[userId]) _selfRatings[userId] = {};
    _selfRatings[userId][lectureId] = Math.min(100, Math.max(0, +rating));
  }

  function getSelfRating(userId, lectureId) {
    return _selfRatings[userId] && _selfRatings[userId][lectureId] !== undefined
      ? _selfRatings[userId][lectureId]
      : null;
  }

  function clearSelfRatings(userId) {
    delete _selfRatings[userId];
  }

  // ── Get actual performance from progress map ──
  function _getActualPct(progressMap, userId, lectureId) {
    const p = progressMap[userId];
    if (!p) return undefined;
    const v = p[lectureId];
    return v !== undefined && v !== null ? +v : undefined;
  }

  // ── Confidence Gap for one user + one lecture ──
  function calcConfidenceGap(userId, lectureId, progressMap) {
    const selfRating = getSelfRating(userId, lectureId);
    if (selfRating === null) return null; // no self-rating → neutral

    const actual = _getActualPct(progressMap, userId, lectureId);
    if (actual === undefined) return null; // no progress data → neutral

    return {
      gap: selfRating - actual,
      selfRating,
      actual,
      overconfident: (selfRating - actual) > 20,
      underconfident: (actual - selfRating) > 20
    };
  }

  // ── Overall accuracy score per user (0-1) ──
  function getAccuracy(userId, progressMap) {
    const ratings = _selfRatings[userId];
    if (!ratings) return 0.5;
    let totalGap = 0, count = 0;
    LECTURES.forEach(l => {
      if (ratings[l.id] !== undefined) {
        const actual = _getActualPct(progressMap, userId, l.id);
        if (actual !== undefined) {
          totalGap += Math.abs(ratings[l.id] - actual);
          count++;
        }
      }
    });
    if (count === 0) return 0.5;
    const avgGap = totalGap / count;
    // accuracy = 1 - (avgGap / 100), clamped 0-1
    return Math.max(0, Math.min(1, 1 - avgGap / 100));
  }

  // ── Explainer penalty from overconfidence (soft, not hard block) ──
  function getExplainerPenalty(userId, progressMap) {
    const accuracy = getAccuracy(userId, progressMap);
    // accuracy 0-1.  0.7+ = no penalty.  Below 0.7 = gradual penalty.
    // At accuracy 0.4 → penalty 0.3.  At accuracy 0.2 → penalty 0.5.
    if (accuracy >= 0.7) return 0;
    return Math.min(0.6, (0.7 - accuracy));
  }

  // ── Get members who need a validation session ──
  function getValidationCandidates(progressMap) {
    const candidates = [];
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const ratings = _selfRatings[uid];
      if (!ratings) continue;
      let largeGaps = 0, total = 0;
      LECTURES.forEach(l => {
        if (ratings[l.id] !== undefined) {
          const actual = _getActualPct(progressMap, uid, l.id);
          if (actual !== undefined && (ratings[l.id] - actual) > 20) {
            largeGaps++;
          }
          total++;
        }
      });
      if (total > 0 && (largeGaps / total) >= 0.5) {
        candidates.push(uid);
      }
    }
    return candidates;
  }

  // ── Group members by confidence profile ──
  function getConfidenceProfiles(progressMap) {
    const overconfident = [];
    const underconfident = [];
    const accurate = [];

    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const accuracy = getAccuracy(uid, progressMap);
      if (accuracy >= 0.7) accurate.push(uid);
      else if (accuracy >= 0.4) underconfident.push(uid);
      else overconfident.push(uid);
    }

    return { overconfident, underconfident, accurate };
  }

  // ── Score: how suitable is a user for Explainer (soft overconfidence penalty) ──
  function getExplainerSuitability(userId, lectureId, progressMap) {
    const actualPct = _getActualPct(progressMap, userId, lectureId);
    if (actualPct === undefined) return 0;

    const gapData = calcConfidenceGap(userId, lectureId, progressMap);
    let gapPenalty = 0;
    if (gapData && gapData.overconfident) {
      gapPenalty = (gapData.gap / 100) * 0.3;
    }

    const overallPenalty = getExplainerPenalty(userId, progressMap);
    const totalPenalty = Math.max(gapPenalty, overallPenalty);

    return Math.max(0, actualPct * (1 - totalPenalty));
  }

  return {
    setSelfRating,
    getSelfRating,
    clearSelfRatings,
    calcConfidenceGap,
    getAccuracy,
    getExplainerPenalty,
    getValidationCandidates,
    getConfidenceProfiles,
    getExplainerSuitability
  };
})();

if (typeof window !== 'undefined') window.Confidence = Confidence;
