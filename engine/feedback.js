/**
 * feedback.js — Session Outcome Feedback Layer
 *
 * Collects post-session metrics that calibrate the engine:
 *   - helpfulness / explainer quality → role quality
 *   - understanding gained → confidence accuracy
 *   - actual duration → scheduler tuning
 *   - energy / attendance → overload & reliability
 *
 * Pure data layer + Firebase sync.  No DOM.
 */
const SessionFeedback = (() => {
  const LS_KEY = 'khulasa_session_feedback';
  const FB_PATH = 'feedback';
  let _cache = null;

  // ── Persistence ──
  function _loadAll() {
    if (_cache) return _cache;
    try {
      if (typeof LS !== 'undefined' && LS) {
        const raw = LS.getItem(LS_KEY);
        if (raw) {
          _cache = JSON.parse(raw);
          return _cache;
        }
      }
    } catch (e) { /* ignore */ }
    _cache = {};
    return _cache;
  }

  function _saveAll() {
    try {
      if (typeof LS !== 'undefined' && LS && _cache) {
        LS.setItem(LS_KEY, JSON.stringify(_cache));
      }
    } catch (e) { /* ignore */ }
  }

  // ── Save one feedback entry ──
  function saveFeedback(sessionId, data) {
    const all = _loadAll();
    const entry = {
      sessionId,
      userId: (typeof store !== 'undefined' && store.get().currentUser !== null)
        ? store.get().currentUser : 'unknown',
      explainerId: data.explainerId || null,
      helpfulness: Math.min(5, Math.max(1, +data.helpfulness || 3)),
      explainerQuality: Math.min(5, Math.max(1, +data.explainerQuality || 3)),
      understandingGained: Math.min(100, Math.max(0, +data.understandingGained || 50)),
      actualDuration: Math.min(180, Math.max(1, +data.actualDuration || 30)),
      energyLevel: Math.min(5, Math.max(1, +data.energyLevel || 3)),
      attended: data.attended !== undefined ? !!data.attended : true,
      timestamp: Date.now()
    };
    all[sessionId] = entry;
    _cache = all;
    _saveAll();

    // Sync to Firebase
    _syncToFirebase(sessionId, entry);

    return entry;
  }

  function _syncToFirebase(sessionId, entry) {
    const db = typeof window !== 'undefined' && window._fbDb ? window._fbDb : null;
    const sdk = typeof window !== 'undefined' && window.firebase_database ? window.firebase_database : null;
    if (!db || !sdk || !sdk.ref || !sdk.update) return;
    try {
      sdk.update(sdk.ref(db, FB_PATH + '/' + sessionId), entry);
    } catch (e) {
      console.warn('[Feedback] Firebase sync failed:', e);
    }
  }

  // ── Get feedback for a session ──
  function getFeedback(sessionId) {
    const all = _loadAll();
    return all[sessionId] || null;
  }

  // ── Aggregate: average helpfulness for a user's explainer sessions ──
  function getExplainerRating(userId, sessionIds) {
    const all = _loadAll();
    let sum = 0, count = 0;
    (sessionIds || Object.keys(all)).forEach(sid => {
      const fb = all[sid];
      if (fb && fb.explainerQuality && fb.explainerId == userId) {
        sum += fb.explainerQuality;
        count++;
      }
    });
    return count > 0 ? sum / count : null;
  }

  // ── Aggregate: average understanding gain per session ──
  function getAvgUnderstandingGain(sessionIds) {
    const all = _loadAll();
    let sum = 0, count = 0;
    (sessionIds || Object.keys(all)).forEach(sid => {
      const fb = all[sid];
      if (fb && fb.understandingGained !== undefined) {
        sum += fb.understandingGained;
        count++;
      }
    });
    return count > 0 ? sum / count : null;
  }

  // ── Aggregate: average helpfulness across all sessions ──
  function getAvgHelpfulness(sessionIds) {
    const all = _loadAll();
    let sum = 0, count = 0;
    (sessionIds || Object.keys(all)).forEach(sid => {
      const fb = all[sid];
      if (fb && fb.helpfulness !== undefined) {
        sum += fb.helpfulness;
        count++;
      }
    });
    return count > 0 ? sum / count : null;
  }

  // ── Calibration: how accurate was the estimated duration vs actual? ──
  function getDurationAccuracy(sessionIds) {
    const all = _loadAll();
    let totalRatio = 0, count = 0;
    (sessionIds || Object.keys(all)).forEach(sid => {
      const fb = all[sid];
      if (fb && fb.actualDuration) {
        // We don't have estimated duration here; caller should provide
        totalRatio += fb.actualDuration;
        count++;
      }
    });
    return count > 0 ? totalRatio / count : null;
  }

  // ── Get members with low reliability (missed sessions) ──
  function getReliabilityScores(progressMap) {
    const all = _loadAll();
    const scores = {};
    // Initialize from progressMap keys if provided
    if (progressMap) {
      Object.keys(progressMap).forEach(uid => {
        scores[uid] = { attended: 0, missed: 0, total: 0 };
      });
    }
    Object.values(all).forEach(fb => {
      if (fb && fb.attended !== undefined && fb.userId !== undefined) {
        if (!scores[fb.userId]) scores[fb.userId] = { attended: 0, missed: 0, total: 0 };
        scores[fb.userId].total++;
        if (fb.attended) scores[fb.userId].attended++;
        else scores[fb.userId].missed++;
      }
    });
    Object.keys(scores).forEach(uid => {
      const s = scores[uid];
      s.reliability = s.total > 0 ? s.attended / s.total : null;
    });
    return scores;
  }

  // ── Compute weighted contribution to confidence accuracy ──
  function getConfidenceCalibration(userId, progressMap) {
    const all = _loadAll();
    let totalGain = 0, count = 0;
    Object.values(all).forEach(fb => {
      if (fb && fb.userId == userId && fb.understandingGained !== undefined) {
        totalGain += fb.understandingGained;
        count++;
      }
    });
    return count > 0 ? Math.min(100, totalGain / count) : null;
  }

  return {
    saveFeedback,
    getFeedback,
    getAllFeedback: function() { return _loadAll(); },
    getExplainerRating,
    getAvgUnderstandingGain,
    getAvgHelpfulness,
    getDurationAccuracy,
    getReliabilityScores,
    getConfidenceCalibration
  };
})();

if (typeof window !== 'undefined') window.SessionFeedback = SessionFeedback;
