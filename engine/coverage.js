(function () {
  "use strict";

  /* ══════════════════════════════════════════════════════════════════════
     CONSTANTS
  ══════════════════════════════════════════════════════════════════════ */
  const LS_KEY                   = "khulasa_coverage_plans";
  const REDUNDANCY_IMP_THRESHOLD = 5;
  const MAX_STUDY_HOURS          = 50;
  const OWNERSHIP_TTL_MS         = 5 * 24 * 60 * 60 * 1000;
  const NOVELTY_OWNED_WINDOW_MS  = 14 * 24 * 60 * 60 * 1000;
  const NOVELTY_OWNED_THRESHOLD  = 3;

  /* ══════════════════════════════════════════════════════════════════════
     UTILITIES
  ══════════════════════════════════════════════════════════════════════ */

  function _clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function _norm(val, min, max) {
    return max === min ? 0.5 : (val - min) / (max - min);
  }

  function _estimateHours(lecture) {
    if (lecture.realAvgDuration && lecture.realAvgDuration > 0)
      return lecture.realAvgDuration;
    return 0.5 + ((lecture.diff ?? 5) / 10) * 2;
  }

  /* ══════════════════════════════════════════════════════════════════════
     [Fix #1] AFFINITY — مع Exploration Factor
  ══════════════════════════════════════════════════════════════════════ */

  function _affinity(memberId, lecture, progressMap, assignmentHistory) {
    const pct = ((progressMap[memberId] || {})[lecture.id]) ?? 0;

    // Quadratic: peaks at ~55% (ideal teacher), drops at extremes
    var ratio = pct / 100;
    var base = 0.8 + 2.0 * ratio - 1.8 * ratio * ratio;

    const recentOwned = (assignmentHistory[memberId] || []).filter(
      t => (Date.now() - t) < NOVELTY_OWNED_WINDOW_MS
    ).length;
    const noveltyBoost = (pct < 10 && recentOwned < NOVELTY_OWNED_THRESHOLD) ? 0.15 : 0;

    return base + noveltyBoost;
  }

  /* ══════════════════════════════════════════════════════════════════════
     [Fix #3] OWNER RISK SCORE
  ══════════════════════════════════════════════════════════════════════ */

  function _getOwnerRiskScore(memberId) {
    try {
      if (typeof window.SessionFeedback === 'undefined') return 0.4;
      var rel = window.SessionFeedback.getReliabilityScores();
      var riskRel = 0.4;
      if (rel && rel[memberId] && rel[memberId].reliability !== null) {
        riskRel = _clamp(1 - rel[memberId].reliability, 0, 0.8);
      }
      // Include quality ratings (explainerQuality + helpfulness) as part of risk
      var allFb = window.SessionFeedback.getAllFeedback();
      if (allFb) {
        var vals = Object.values(allFb);
        var sumQual = 0, countQual = 0;
        vals.forEach(function(fb) {
          if (fb && +fb.explainerId === +memberId) {
            var avg = ((+fb.explainerQuality || 3) + (+fb.helpfulness || 3)) / 2;
            sumQual += avg;
            countQual++;
          }
        });
        if (countQual > 0) {
          var avgQual = sumQual / countQual; // 1-5
          var qualRisk = _clamp(1 - (avgQual - 1) / 4, 0, 0.8);
          return (riskRel + qualRisk) / 2; // average attendance risk + quality risk
        }
      }
      return riskRel;
    } catch (e) {
      return 0.4;
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     ASSIGNMENT HISTORY
  ══════════════════════════════════════════════════════════════════════ */

  function _getAssignmentHistory() {
    try {
      var all     = _loadAll();
      var history = {};
      Object.values(all).forEach(function(plan) {
        if (!plan.ownershipMap) return;
        Object.values(plan.ownershipMap).forEach(function(entry) {
          if (!history[entry.owner]) history[entry.owner] = [];
          history[entry.owner].push(plan.savedAt || 0);
        });
      });
      return history;
    } catch (e) {
      return {};
    }
  }

  /* ══════════════════════════════════════════════════════════════════════
     SCORE LECTURES
  ══════════════════════════════════════════════════════════════════════ */

  function _scoreLectures(lectures) {
    var imps  = lectures.map(function(l) { return l.imp  || 5; });
    var diffs = lectures.map(function(l) { return l.diff || 5; });
    var minI  = Math.min.apply(null, imps),  maxI = Math.max.apply(null, imps);
    var minD  = Math.min.apply(null, diffs), maxD = Math.max.apply(null, diffs);

    // Exam proximity: find closest exam day for each subject
    var now = Date.now();
    var examDays = {};
    if (typeof EXAM_SCHEDULE !== 'undefined') {
      EXAM_SCHEDULE.forEach(function(ex) {
        var t = new Date(ex.iso).getTime();
        var d = Math.max(0, Math.round((t - now) / 86400000));
        examDays[ex.name] = d;
      });
    }

    return lectures.map(function(l) {
      var examD = 999;
      if (l.s) {
        Object.keys(examDays).forEach(function(k) {
          if (l.s.indexOf(k) !== -1 || k.indexOf(l.s) !== -1) {
            examD = Math.min(examD, examDays[k]);
          }
        });
      }
      var examUrgency = examD <= 60 ? _clamp(1 - examD / 60, 0, 1) : 0;
      return Object.assign({}, l, {
        _priority : 0.4 * _norm(l.imp  || 5, minI, maxI)
                 + 0.3 * _norm(l.diff || 5, minD, maxD)
                 + 0.3 * examUrgency,
        _hours    : _estimateHours(l),
      });
    });
  }

  /* ══════════════════════════════════════════════════════════════════════
     CORE DISTRIBUTION ALGORITHM
  ══════════════════════════════════════════════════════════════════════ */

  function distributeLectures(lectures, members, progressMap, options) {
    if (!options) options = {};
    var gradeFilter         = options.gradeFilter         || null;
    var subjectFilter       = options.subjectFilter       || null;
    var redundancyThreshold = options.redundancyThreshold || REDUNDANCY_IMP_THRESHOLD;
    var maxHours            = options.maxHours            || MAX_STUDY_HOURS;
    var ignoreHistory       = options.ignoreHistory       || false;

    var targets = gradeFilter
      ? lectures.filter(function(l) { return String(l.g) === String(gradeFilter); })
      : lectures.slice();

    if (subjectFilter && subjectFilter.length > 0) {
      targets = targets.filter(function(l) { return l.s && subjectFilter.indexOf(l.s) !== -1; });
    }

    targets = targets.filter(function(l) {
      return members.some(function(m) { return ((progressMap[m.id] || {})[l.id] || 0) < 80; });
    });

    if (!targets.length || !members.length)
      return { ownershipMap: {}, stats: _emptyStats() };

    var scored = _scoreLectures(targets).sort(function(a, b) { return b._priority - a._priority; });

    var riskScores       = {};
    var assignmentHistory = ignoreHistory ? {} : _getAssignmentHistory();
    members.forEach(function(m) { riskScores[m.id] = _getOwnerRiskScore(m.id); });

    var load  = {};
    var count = {};
    members.forEach(function(m) { load[m.id] = 0; count[m.id] = 0; });

    var ownershipMap   = {};
    var assignmentReasons = {};

    for (var si = 0; si < scored.length; si++) {
      var lec = scored[si];
      var bestId    = null;
      var bestScore = -Infinity;
      var candidateScores = {};

      for (var mi = 0; mi < members.length; mi++) {
        var m   = members[mi];
        var aff = _affinity(m.id, lec, progressMap, assignmentHistory);
        if (aff < 0) continue;

        var loadRatio   = load[m.id] / maxHours;
        var riskPenalty = riskScores[m.id] * 0.5;
        var score       = aff - loadRatio * 2.0 - riskPenalty;

        candidateScores[m.id] = { aff: aff, loadRatio: loadRatio, riskPenalty: riskPenalty, score: score };
        if (score > bestScore) { bestScore = score; bestId = m.id; }
      }

      if (!bestId) {
        bestId = members.reduce(function(a, b) { return (load[a.id] <= load[b.id] ? a : b); }).id;
      }

      load[bestId] += lec._hours;
      count[bestId]++;

      var pct    = ((progressMap[bestId] || {})[lec.id]) || 0;
      var cs     = candidateScores[bestId] || {};
      var reasons = [];

      if (pct >= 40)                            reasons.push("بدأ فيها فعلًا (" + pct + "%)");
      else if (pct >= 10)                       reasons.push("عنده بداية فيها (" + pct + "%)");
      else                                      reasons.push("لسه ما بدأش — diversity");
      if ((cs.loadRatio || 0) < 0.3)            reasons.push("حمله خفيف حاليًا");
      if (riskScores[bestId] < 0.3)             reasons.push("موثوقيته عالية");
      var recentOwned = (assignmentHistory[bestId] || []).filter(function(t) {
        return (Date.now() - t) < NOVELTY_OWNED_WINDOW_MS;
      }).length;
      if (recentOwned < NOVELTY_OWNED_THRESHOLD) reasons.push("مش شايل كتير مؤخرًا");

      assignmentReasons[lec.id] = {
        memberId : bestId,
        memberName: members.find(function(m) { return m.id === bestId; })?.name || bestId,
        reasons  : reasons,
      };

      ownershipMap[lec.id] = {
        owner           : bestId,
        ownerName       : members.find(function(m) { return m.id === bestId; })?.name || bestId,
        backupOwner     : null,
        backupOwnerName : null,
        priority        : lec._priority,
        estimatedHours  : lec._hours,
        ownerRiskScore  : riskScores[bestId],
        lecture         : lec,
      };
    }

    var backupCount = {};
    members.forEach(function(m) { backupCount[m.id] = 0; });

    for (var si2 = 0; si2 < scored.length; si2++) {
      var lec2 = scored[si2];
      if ((lec2.imp || 5) < redundancyThreshold) continue;
      var entry = ownershipMap[lec2.id];
      if (!entry) continue;

      var bkId = null;
      var eligible = [];
      for (var mi2 = 0; mi2 < members.length; mi2++) {
        var m2 = members[mi2];
        if (m2.id === entry.owner) continue;
        var aff2 = _affinity(m2.id, lec2, progressMap, assignmentHistory);
        if (aff2 < 0) continue;
        eligible.push(m2.id);
      }
      if (eligible.length) {
        // Round-robin: pick eligible with fewest backups; tiebreaker = lower risk
        bkId = eligible.reduce(function(a, b) {
          var diff = backupCount[a] - backupCount[b];
          if (diff !== 0) return diff < 0 ? a : b;
          return (riskScores[a] || 0.4) <= (riskScores[b] || 0.4) ? a : b;
        });
      }

      if (bkId) {
        entry.backupOwner     = bkId;
        entry.backupOwnerName = members.find(function(m) { return m.id === bkId; })?.name || bkId;
        entry.backupRiskScore = riskScores[bkId];
        load[bkId] += lec2._hours * 0.4;
        backupCount[bkId] = (backupCount[bkId] || 0) + 1;
        entry.backupPromoted  = entry.ownerRiskScore > 0.6;
      }
    }

    var stats = _buildStats(ownershipMap, members, load, count, targets, riskScores);

    return { ownershipMap: ownershipMap, stats: stats, assignmentReasons: assignmentReasons };
  }

  /* ══════════════════════════════════════════════════════════════════════
     STATS
  ══════════════════════════════════════════════════════════════════════ */

  function _emptyStats() {
    return {
      totalLectures: 0, coveredLectures: 0, coveragePercent: 0,
      effectiveCoverage: 0, redundantLectures: 0,
      memberBreakdown: [], lbs: 1, heatmap: [],
    };
  }

  function _buildStats(ownershipMap, members, load, count, allLectures, riskScores) {
    if (!riskScores) riskScores = {};
    var entries   = Object.values(ownershipMap);
    var covered   = entries.length;
    var total     = allLectures.length;
    var redundant = entries.filter(function(e) { return e.backupOwner; }).length;

    var memberBreakdown = members.map(function(m) {
      return {
        id           : m.id,
        name         : m.name,
        lectureCount : count[m.id] || 0,
        hours        : Math.round((load[m.id] || 0) * 10) / 10,
        riskScore    : riskScores[m.id] || 0.4,
        owned        : entries.filter(function(e) { return e.owner       === m.id; }).map(function(e) { return e.lecture; }),
        backup       : entries.filter(function(e) { return e.backupOwner === m.id; }).map(function(e) { return e.lecture; }),
      };
    });

    var hoursArr = Object.values(load);
    var mean     = hoursArr.reduce(function(s, v) { return s + v; }, 0) / (hoursArr.length || 1);
    var stdDev   = Math.sqrt(
      hoursArr.reduce(function(s, v) { return s + (v - mean) * (v - mean); }, 0) / (hoursArr.length || 1)
    );
    var lbs = mean > 0
      ? Math.round(_clamp(1 - stdDev / (mean + 1), 0, 1) * 100) / 100
      : 1;

    var avgReliability   = _getAvgFeedbackScore("reliability");
    var avgTeachingScore = _getAvgFeedbackScore("explainerQuality");
    var effectiveCoverage = total > 0
      ? Math.round((covered / total) * avgReliability * avgTeachingScore * 100)
      : 0;

    var heatmap = allLectures.map(function(l) {
      var entry = ownershipMap[l.id];
      var risk  = _calcCoverageRisk(entry);
      return {
        lectureId   : l.id,
        lectureName : l.t || l.s || l.id,
        owner       : entry ? entry.ownerName         : "—",
        backup      : entry ? entry.backupOwnerName   : "—",
        coverageRisk: risk,
        promoted    : entry ? entry.backupPromoted    : false,
        imp         : l.imp || 5,
      };
    });

    return {
      totalLectures     : total,
      coveredLectures   : covered,
      coveragePercent   : total ? Math.round((covered / total) * 100) : 0,
      effectiveCoverage : effectiveCoverage,
      redundantLectures : redundant,
      redundancyPercent : total ? Math.round((redundant / total) * 100) : 0,
      memberBreakdown   : memberBreakdown,
      lbs               : lbs,
      heatmap           : heatmap,
    };
  }

  function _calcCoverageRisk(entry) {
    if (!entry)                                          return "UNCOVERED";
    if (!entry.backupOwner && entry.ownerRiskScore > 0.6) return "HIGH";
    if (!entry.backupOwner && entry.ownerRiskScore > 0.3) return "MEDIUM";
    if (entry.backupOwner  && entry.ownerRiskScore > 0.6) return "MEDIUM";
    return "LOW";
  }

  function _getAvgFeedbackScore(field) {
    try {
      if (typeof window.SessionFeedback === 'undefined') return 0.8;
      if (field === 'reliability') {
        var rel = window.SessionFeedback.getReliabilityScores();
        var vals = Object.values(rel).map(function(s) { return s.reliability; }).filter(function(v) { return v !== null; });
        return vals.length ? _clamp(vals.reduce(function(a,b){return a+b;},0)/vals.length, 0.1, 1) : 0.8;
      }
      if (field === 'explainerQuality') {
        var h = window.SessionFeedback.getAvgHelpfulness();
        return h !== null ? _clamp(h/5, 0.1, 1) : 0.8;
      }
      return 0.8;
    } catch (e) { return 0.8; }
  }

  /* ══════════════════════════════════════════════════════════════════════
     GRADE GROUPS
  ══════════════════════════════════════════════════════════════════════ */

  function getGradeGroups(lectures) {
    var map = {};
    for (var i = 0; i < lectures.length; i++) {
      var l = lectures[i];
      var g = String(l.g || "other");
      if (!map[g]) map[g] = { grade: g, lectures: [], label: _gradeLabel(g) };
      map[g].lectures.push(l);
    }
    return Object.values(map).sort(function(a, b) { return Number(b.grade) - Number(a.grade); });
  }

  function _gradeLabel(g) {
    var n = Number(g);
    if (n === 120) return "المادة الكاملة (120 درجة)";
    if (n === 90)  return "90 درجة";
    if (n === 60)  return "60 درجة";
    return "مجموعة " + g;
  }

  /* ══════════════════════════════════════════════════════════════════════
     [Fix #4] TTL / EXPIRY
  ══════════════════════════════════════════════════════════════════════ */

  function isPlanExpired(plan) {
    if (!plan) return true;
    return (Date.now() - (plan.savedAt || 0)) > OWNERSHIP_TTL_MS;
  }

  function getDaysUntilExpiry(plan) {
    if (!plan) return 0;
    var remaining = OWNERSHIP_TTL_MS - (Date.now() - (plan.savedAt || 0));
    return Math.max(0, Math.round(remaining / 86400000));
  }

  /* ══════════════════════════════════════════════════════════════════════
     PERSIST
  ══════════════════════════════════════════════════════════════════════ */

  function savePlan(plan, fbDb, fbSDK) {
    try {
      var all = _loadAll();
      var key = "cov_" + Date.now();
      all[key] = Object.assign({}, plan, { savedAt: Date.now() });
      localStorage.setItem(LS_KEY, JSON.stringify(all));

      if (fbDb && fbSDK && fbSDK.ref && fbSDK.update) {
        var date = new Date().toISOString().slice(0, 10);
        var ref  = fbSDK.ref(fbDb, "coverage/" + date + "/" + key);
        fbSDK.update(ref, {
          savedAt          : Date.now(),
          grade            : plan.grade,
          lbs              : plan.stats ? plan.stats.lbs : null,
          coverage         : plan.stats ? plan.stats.coveragePercent : null,
          effectiveCoverage: plan.stats ? plan.stats.effectiveCoverage : null,
          totalLecs        : plan.stats ? plan.stats.totalLectures : null,
          expiresAt        : Date.now() + OWNERSHIP_TTL_MS,
        }).catch(function(e) { console.warn("[Coverage] Firebase sync failed:", e); });
      }

      return key;
    } catch (e) {
      console.error("[Coverage] Save failed:", e);
      return null;
    }
  }

  function loadLatestPlan() {
    var all  = _loadAll();
    var keys = Object.keys(all).sort();
    return keys.length ? all[keys[keys.length - 1]] : null;
  }

  function _loadAll() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || "{}"); }
    catch (e) { return {}; }
  }

  /* ══════════════════════════════════════════════════════════════════════
     PUBLIC API
  ══════════════════════════════════════════════════════════════════════ */

  window.CoverageEngine = {
    distributeLectures  : distributeLectures,
    getGradeGroups      : getGradeGroups,
    savePlan            : savePlan,
    loadLatestPlan      : loadLatestPlan,
    isPlanExpired       : isPlanExpired,
    getDaysUntilExpiry  : getDaysUntilExpiry,
  };

})();
