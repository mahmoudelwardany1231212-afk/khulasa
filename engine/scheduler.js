/**
 * scheduler.js — Session Generation Orchestrator
 *
 * The main entry point for plan generation.
 * Flow:
 *   1. Load members + progress from store
 *   2. Analyze all lectures via Engine
 *   3. Priority-score → classify meeting type
 *   4. Assign roles (Roles.assignRoleSet)
 *   5. Split teams if needed (TeamSplit.splitTeam)
 *   6. Generate session objects
 *   7. Write to Firebase (sessions + plans) using update()
 *   8. Return plan for UI rendering
 */
const Scheduler = (() => {
  const FB_DB = typeof window !== 'undefined' && window._fbDb ? window._fbDb : null;
  const FB_SDK = typeof window !== 'undefined' && window.firebase_database ? window.firebase_database : null;
  const FB_REF = typeof window !== 'undefined' && window._fbSDK ? window._fbSDK.ref : null;

  const MEMBER_COUNT = typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7;

  // ── Config ──
  const BASE_SESSION_DURATION = 45; // minutes
  const SHORT_SESSION_DURATION = 25;
  const CRAM_SESSION_DURATION = 20;
  const MAX_DAILY_HOURS = 5; // hard limit: total session hours per day
  const MAX_CONSECUTIVE_SESSIONS = 3; // hard limit: sessions before a break
  const MIN_BREAK_MINUTES = 15; // minimum break between consecutive sessions

  // ── Get progress as a proper map { userId: { lectureId: pct } } ──
  function _getProgressMap() {
    const raw = typeof store !== 'undefined' ? store.get().progress : {};
    const map = {};
    Object.keys(raw).forEach(uid => {
      const entry = raw[uid];
      if (entry && typeof entry === 'object') {
        map[uid] = {};
        Object.keys(entry).forEach(lecId => {
          map[uid][lecId] = +entry[lecId];
        });
      }
    });
    return map;
  }

  // ── Pick lectures based on variant ──
  function _getLecturesForVariant(variant) {
    switch (variant) {
      case 'daily':
        // Daily: top priority lectures that fit in 2-hour window
        return LECTURES.filter(l => (l.imp || 3) >= 3);
      case 'weekly':
        // Weekly: all lectures
        return [...LECTURES];
      case 'cram':
        // Cram: boost priority, include low importance, shorter slots
        return LECTURES.filter(l => {
          if ((l.imp || 3) >= 3) return true;
          // Include low-importance lectures that have close exams
          if (l.exam) {
            const days = Math.ceil((new Date(l.exam) - new Date()) / (1000 * 60 * 60 * 24));
            return days > 0 && days <= 14;
          }
          return false;
        });
      default:
        return [...LECTURES];
    }
  }

  // ── Get session duration based on type and variant ──
  function _getDuration(meetingType, variant) {
    if (variant === 'cram') return CRAM_SESSION_DURATION;
    if (meetingType === 'summary' || meetingType === 'rapid_review') return SHORT_SESSION_DURATION;
    if (meetingType === 'recovery') return SHORT_SESSION_DURATION;
    return BASE_SESSION_DURATION;
  }

  // ── Generate a time slot with breaks between consecutive sessions ──
  function _generateTimeSlot(sessionIndex, variant) {
    const now = new Date();
    const baseMinutes = _getDuration(null, variant) + MIN_BREAK_MINUTES;
    if (variant === 'daily') {
      const start = new Date(now);
      start.setHours(start.getHours() + 1, 0, 0, 0);
      // After MAX_CONSECUTIVE_SESSIONS, add a longer break
      const blockIndex = Math.floor(sessionIndex / MAX_CONSECUTIVE_SESSIONS);
      const slotInBlock = sessionIndex % MAX_CONSECUTIVE_SESSIONS;
      const offset = blockIndex * (MAX_CONSECUTIVE_SESSIONS * baseMinutes + 45) + slotInBlock * baseMinutes;
      start.setMinutes(start.getMinutes() + offset);
      return start.toISOString();
    }
    // Weekly / cram: spread across week
    const dayOffset = Math.floor(sessionIndex / 4);
    const slotOffset = sessionIndex % 4;
    const start = new Date(now);
    start.setDate(start.getDate() + dayOffset);
    start.setHours(9 + slotOffset * 2, 0, 0, 0);
    return start.toISOString();
  }

  // ── Apply cram-specific overrides ──
  function _applyCramOverrides(sortedLectures, progressMap) {
    return sortedLectures.map(item => {
      const lec = item.lecture;
      const examDays = lec.exam
        ? Math.ceil((new Date(lec.exam) - new Date()) / (1000 * 60 * 60 * 24))
        : 30;

      // Boost priority for close exams
      if (examDays <= 7) {
        item.priorityScore *= 1.5;
      }

      // Memory decay boost: if progress is high but old, add recall urgency
      if (typeof Engine.calcMemoryDecay === 'function') {
        const decayBoost = Engine.calcMemoryDecay(lec, progressMap);
        if (decayBoost > 0) {
          item.priorityScore += decayBoost;
          if (item.meetingType.type === 'self_study') {
            item.meetingType.type = 'recovery';
            item.meetingType.reason = 'مراجعة سريعة لمنع النسيان';
            item.meetingType.participants = [...Array(typeof MEMBERS !== 'undefined' ? MEMBERS.length : 7).keys()];
          }
        }
      }

      // Downgrade low-importance lectures to self_study
      if ((lec.imp || 3) <= 2 && examDays > 7) {
        item.meetingType = {
          type: 'self_study',
          reason: 'أولوية منخفضة — مذاكرة فردية',
          participants: [],
          priority: item.priorityScore
        };
      }

      // Convert non-essential meetings to recovery
      if (item.meetingType.type === 'mini' && examDays > 7) {
        item.meetingType.type = 'recovery';
        item.meetingType.reason = 'كرام — جلسة مراجعة سريعة';
      }

      return item;
    });
  }

  // ── Main: generate plan ──
  function generatePlan(variant) {
    variant = variant || 'daily';
    const progressMap = _getProgressMap();
    const lectures = _getLecturesForVariant(variant);

    // 1. Sort by priority
    let sorted = Engine.getPrioritySorted(lectures, progressMap);

    // 2. Apply cram overrides
    if (variant === 'cram') {
      sorted = _applyCramOverrides(sorted, progressMap);
      sorted.sort((a, b) => b.priorityScore - a.priorityScore);
    }

    // 3. Detect overload
    const overload = Engine.detectOverload(lectures, progressMap);

    // 4. Generate sessions (skip self_study) with hard limits
    const sessions = [];
    let sessionIndex = 0;
    let totalMinutes = 0;
    const maxTotalMinutes = MAX_DAILY_HOURS * 60;

    // Heap-ordering: already sorted by priority, so first = most important
    sorted.forEach(item => {
      if (item.meetingType.type === 'self_study') return;

      const lec = item.lecture;
      const meetingType = item.meetingType;

      // Hard limit: total daily hours
      const duration = _getDuration(meetingType.type, variant);
      if (totalMinutes + duration > maxTotalMinutes) return;

      // Determine participants and handling
      let groups = [];
      if (meetingType.splitRequired) {
        const splitResult = TeamSplit.splitTeam(lec.id, progressMap, lec.diff);
        groups = splitResult.groups;
      } else {
        groups = [{ groupIndex: 0, members: meetingType.participants, explainer: null }];
      }

      groups.forEach(group => {
        const sessionDuration = _getDuration(meetingType.type, variant);
        if (totalMinutes + sessionDuration > maxTotalMinutes) return;

        let roles;
        if (group.members.length < MEMBER_COUNT) {
          roles = Roles.assignRoleSetForGroup(lec.id, group.members, progressMap);
        } else {
          roles = Roles.assignRoleSet(lec.id, progressMap);
        }

        const sessionId = `session_${Date.now()}_${sessionIndex}`;
        const startTime = _generateTimeSlot(sessionIndex, variant);

        const priorityBd = typeof Engine.getPriorityBreakdown === 'function'
          ? Engine.getPriorityBreakdown(lec, progressMap) : null;

        sessions.push({
          id: sessionId,
          lectureId: lec.id,
          lectureTitle: lec.t,
          subject: lec.s,
          type: meetingType.type,
          reason: meetingType.reason,
          startTime,
          duration: sessionDuration,
          endTime: new Date(new Date(startTime).getTime() + sessionDuration * 60000).toISOString(),
          participants: group.members,
          groupIndex: group.groupIndex,
          roles: {
            explainer: roles.explainer,
            summarizer: roles.summarizer,
            questionHunter: roles.questionHunter,
            weakReviewer: roles.weakReviewer
          },
          classificationDebug: meetingType.debug || null,
          priorityBreakdown: priorityBd,
          priorityScore: Math.round(item.priorityScore * 100) / 100,
          status: 'scheduled',
          variant
        });

        totalMinutes += sessionDuration + MIN_BREAK_MINUTES;
        sessionIndex++;
      });
    });

    // 5. Build plan object
    const planDate = new Date().toISOString().split('T')[0];
    const planId = `plan_${planDate}_${variant}_${Date.now()}`;
    const plan = {
      id: planId,
      planDate,
      variant,
      generatedAt: new Date().toISOString(),
      generatedBy: store && store.get().currentUser !== undefined ? store.get().currentUser : 'unknown',
      sessionCount: sessions.length,
      totalDuration: sessions.reduce((s, se) => s + se.duration, 0),
      sessionIds: sessions.map(s => s.id),
      overload,
      settings: {
        includeLowImportance: variant === 'cram' || variant === 'weekly',
        baseDuration: variant === 'cram' ? CRAM_SESSION_DURATION : BASE_SESSION_DURATION
      }
    };

    return { plan, sessions };
  }

  // ── Save plan + sessions to Firebase using update() ──
  function saveToFirebase(plan, sessions, onComplete) {
    if (!FB_DB || !FB_SDK) {
      console.warn('[Scheduler] Firebase not available — plan not saved');
      if (onComplete) onComplete(null);
      return;
    }

    // Build session writes
    const sessionUpdates = {};
    sessions.forEach(s => {
      sessionUpdates[`sessions/${s.id}`] = s;
    });

    // Build plan write
    const planUpdates = {};
    planUpdates[`plans/${plan.id}`] = plan;

    // Atomic update — won't break realtime state
    FB_SDK.ref(FB_DB).update(sessionUpdates)
      .then(() => FB_SDK.ref(FB_DB).update(planUpdates))
      .then(() => {
        console.log(`[Scheduler] Plan ${plan.id} saved with ${sessions.length} sessions`);
        if (onComplete) onComplete(plan);
      })
      .catch(err => {
        console.error('[Scheduler] Firebase write failed:', err);
        if (onComplete) onComplete(null);
      });

    // Also store locally for fast access
    try {
      if (typeof LS !== 'undefined' && LS) {
        LS.setItem('khulasa_last_plan', JSON.stringify({ plan, sessions }));
      }
    } catch (e) {
      // localStorage may be full
    }
  }

  // ── Load last plan from localStorage ──
  function loadLastPlan() {
    try {
      if (typeof LS !== 'undefined' && LS) {
        const raw = LS.getItem('khulasa_last_plan');
        if (raw) return JSON.parse(raw);
      }
    } catch (e) { /* ignore */ }
    return null;
  }

  // ── High-level: generate + save in one call ──
  function generateAndSave(variant, onComplete) {
    const { plan, sessions } = generatePlan(variant);
    saveToFirebase(plan, sessions, onComplete);
    return { plan, sessions };
  }

  return {
    generatePlan,
    saveToFirebase,
    loadLastPlan,
    generateAndSave
  };
})();

if (typeof window !== 'undefined') window.Scheduler = Scheduler;
