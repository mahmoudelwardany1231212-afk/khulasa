/**
 * team-split.js — Adaptive Team Splitting Engine
 *
 * Uses stdDev of lecture progress to decide:
 *   stdDev > 25 → split into balanced subgroups
 *   else       → single full session
 *
 * Balanced split ensures each subgroup has a mix:
 *   - top performer (Explainer)
 *   - mid-range
 *   - weak member
 *
 * Pure functions.  No DOM, no Firebase.
 */
const TeamSplit = (() => {
  const MEMBER_COUNT = typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7;

  function _getPct(progressMap, userId, lectureId) {
    const p = progressMap[userId];
    if (!p) return undefined;
    const v = p[lectureId];
    return v !== undefined && v !== null ? +v : undefined;
  }

  function _stdDev(values) {
    if (values.length < 2) return 0;
    const avg = values.reduce((s, v) => s + v, 0) / values.length;
    const sqDiffs = values.map(v => (v - avg) ** 2);
    return Math.sqrt(sqDiffs.reduce((s, v) => s + v, 0) / values.length);
  }

  // ── Get sorted members by pct for a lecture ──
  function _getSortedMembers(lectureId, progressMap) {
    const members = [];
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const pct = _getPct(progressMap, uid, lectureId);
      members.push({ userId: uid, pct: pct !== undefined ? pct : -1 });
    }
    members.sort((a, b) => b.pct - a.pct);
    return members;
  }

  // ── Decide structure: split or full (dynamic threshold) ──
  function decideStructure(lectureId, progressMap, difficulty) {
    const allPcts = [];
    for (let uid = 0; uid < MEMBER_COUNT; uid++) {
      const pct = _getPct(progressMap, uid, lectureId);
      if (pct !== undefined) allPcts.push(pct);
    }

    const stdDev = _stdDev(allPcts);
    const studiedCount = allPcts.length;
    const allStudied = studiedCount === MEMBER_COUNT;

    // Dynamic threshold: harder lectures tolerate more variance
    const diff = difficulty || 3;
    const splitThreshold = 20 + (diff * 1.5);

    if (stdDev > splitThreshold && studiedCount >= 4) {
      return {
        decision: 'split',
        stdDev,
        studiedCount,
        allStudied,
        splitThreshold,
        reason: `تفاوت كبير (${Math.round(stdDev)}%) — سيتم تقسيم الفريق`,
        groupCount: stdDev > splitThreshold + 10 ? 3 : 2
      };
    }

    return {
      decision: 'full',
      stdDev,
      studiedCount,
      allStudied,
      splitThreshold,
      reason: studiedCount < 4
        ? 'عدد المذاكرين قليل — جلسة كاملة'
        : `التفاوت منخفض (${Math.round(stdDev)}%) — جلسة كاملة`,
      groupCount: 1
    };
  }

  // ── Balanced split: snake-draft distribution ──
  function balancedSplit(lectureId, progressMap, groupCount) {
    const sorted = _getSortedMembers(lectureId, progressMap);
    const groups = Array.from({ length: groupCount }, () => []);

    // Snake draft: strongest goes to group 0, then next to last group, etc.
    sorted.forEach((member, index) => {
      const round = Math.floor(index / groupCount);
      const position = index % groupCount;
      const groupIdx = round % 2 === 0 ? position : (groupCount - 1 - position);
      groups[groupIdx].push(member.userId);
    });

    // Assign explainer for each group (highest pct in that group)
    return groups.map((g, i) => {
      let explainer = g[0];
      let topPct = -1;
      g.forEach(uid => {
        const pct = _getPct(progressMap, uid, lectureId);
        if (pct !== undefined && pct > topPct) {
          topPct = pct;
          explainer = uid;
        }
      });
      return {
        groupIndex: i,
        members: g,
        explainer,
        memberCount: g.length
      };
    });
  }

  // ── Full group (no split) ──
  function fullGroup(lectureId, progressMap) {
    const members = Array.from({ length: MEMBER_COUNT }, (_, i) => i);
    let explainer = 0;
    let topPct = -1;
    members.forEach(uid => {
      const pct = _getPct(progressMap, uid, lectureId);
      if (pct !== undefined && pct > topPct) {
        topPct = pct;
        explainer = uid;
      }
    });
    return [{
      groupIndex: 0,
      members,
      explainer,
      memberCount: MEMBER_COUNT
    }];
  }

  // ── Main entry point ──
  function splitTeam(lectureId, progressMap, difficulty) {
    const structure = decideStructure(lectureId, progressMap, difficulty);
    const groups = structure.decision === 'split'
      ? balancedSplit(lectureId, progressMap, structure.groupCount)
      : fullGroup(lectureId, progressMap);

    return { structure, groups };
  }

  return { decideStructure, balancedSplit, fullGroup, splitTeam };
})();

if (typeof window !== 'undefined') window.TeamSplit = TeamSplit;
