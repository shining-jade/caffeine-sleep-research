(function attachBadgeJourney(root) {
  'use strict';

  const DEFAULT_CONFIG = Object.freeze({
    version: 4,
    challengeName: '나의 건강기록 여정',
    schedules: Object.freeze({
      '1': Object.freeze({ start: '2026-10-19', end: '2026-11-22', initialStart: '2026-10-19', initialEnd: '2026-10-25', actionStart: '2026-11-16', actionEnd: '2026-11-22', finalClassDate: '2026-11-23' }),
      '2': Object.freeze({ start: '2026-10-23', end: '2026-11-26', initialStart: '2026-10-23', initialEnd: '2026-10-29', actionStart: '2026-11-20', actionEnd: '2026-11-26', finalClassDate: '2026-11-27' }),
      '3': Object.freeze({ start: '2026-10-13', end: '2026-11-16', initialStart: '2026-10-13', initialEnd: '2026-10-19', actionStart: '2026-11-10', actionEnd: '2026-11-16', finalClassDate: '2026-11-17' }),
      '4': Object.freeze({ start: '2026-10-13', end: '2026-11-16', initialStart: '2026-10-13', initialEnd: '2026-10-19', actionStart: '2026-11-10', actionEnd: '2026-11-16', finalClassDate: '2026-11-17' }),
    }),
    badges: Object.freeze([
      Object.freeze({ id: 'journey_3', name: '기록 첫걸음', image: '🌱', days: 3, bg: '#ecfdf5', color: '#047857', auto: true }),
      Object.freeze({ id: 'journey_7', name: '일주일 관찰자', image: '🔍', days: 7, bg: '#eff6ff', color: '#1d4ed8', auto: true }),
      Object.freeze({ id: 'journey_14', name: '데이터 탐험가', image: '🧭', days: 14, bg: '#f5f3ff', color: '#6d28d9', auto: true }),
      Object.freeze({ id: 'journey_21', name: '꾸준한 기록가', image: '🌳', days: 21, bg: '#f0fdf4', color: '#166534', auto: true }),
      Object.freeze({ id: 'journey_28', name: '건강 라이프로거', image: '⭐', days: 28, bg: '#fefce8', color: '#a16207', auto: true }),
    ]),
  });

  function parseDate(value) {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
    if (!match) return null;
    const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
    return Number.isNaN(date.getTime()) || formatDate(date) !== String(value) ? null : date;
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function dateRange(start, end) {
    const first = parseDate(start);
    const last = parseDate(end);
    if (!first || !last || first > last) return [];
    const result = [];
    for (let cursor = new Date(first); cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
      result.push(formatDate(cursor));
    }
    return result;
  }

  function uniqueValidDates(values) {
    return new Set((values || []).filter((value) => parseDate(value)));
  }

  function shiftDate(value, days) {
    const date = parseDate(value);
    if (!date) return '';
    date.setUTCDate(date.getUTCDate() + days);
    return formatDate(date);
  }

  function sleepWakeDates(records, dateBasis, policy) {
    if (dateBasis !== 'caffeine_day_next_wake') return records.map(record => policy.describe(record).wakeDate);
    const ids = new Set(records.map(record => policy.describe(record).id));
    const episodes = records.map((record, index) => {
      if (policy.describe(record).id) return record;
      let key = 'badge-unassigned:' + index;
      while (ids.has(key)) key += ':';
      ids.add(key);
      return {...record, recordId:key};
    });
    const dates = [];
    policy.days(episodes, { allowProtocolCandidate: true }).forEach(group => {
      if (group.status !== 'ready') return;
      const record = group.record;
      const selectedMain = record.type === 'main' && record.classificationStatus === 'student_selected';
      // The server supplies this provenance for older rows without type metadata.
      // Count their verified wake for participation without classifying them as main sleep.
      const legacyWake = record.type === 'uncollected'
        && record.classificationStatus === 'uncollected' && record.typeSource === 'legacy_uncollected';
      if (record.eligibleMain || selectedMain || legacyWake) {
        dates.push(record.wakeDate);
      }
    });
    return dates;
  }

  // Intake day D is paired with the following actual wake day D+1.
  // Keep the daily activity card on actual calendar dates, separate from this pairing.
  function pairedSets(input) {
    const paired = input.dateBasis === 'caffeine_day_next_wake';
    const today = paired && parseDate(input.today) ? input.today : '';
    const caffeine = uniqueValidDates((input.caffeineDates || []).filter(d => !today || d <= today));
    const wake = uniqueValidDates((input.sleepDates || []).filter(d => !today || d <= today));
    const sleep = paired ? new Set([...wake].map(d => shiftDate(d, -1))) : wake;
    return { caffeine, wake, sleep };
  }

  function countsForRange(caffeine, sleep, start, end) {
    const dates = dateRange(start, end);
    let caffeineCount = 0;
    let sleepCount = 0;
    let completeCount = 0;
    dates.forEach((date) => {
      const hasCaffeine = caffeine.has(date);
      const hasSleep = sleep.has(date);
      if (hasCaffeine) caffeineCount += 1;
      if (hasSleep) sleepCount += 1;
      if (hasCaffeine && hasSleep) completeCount += 1;
    });
    return { caffeine: caffeineCount, sleep: sleepCount, complete: completeCount, totalDays: dates.length };
  }

  function summarize(input) {
    const schedule = input.schedule || {};
    const { caffeine, sleep, wake } = pairedSets(input);
    const dailyWake = input.dailySleepDates ? uniqueValidDates(input.dailySleepDates) : wake;
    const completeDates = dateRange(schedule.start, schedule.end).filter((date) => caffeine.has(date) && sleep.has(date));
    const today = String(input.today || '');
    return {
      completeDates,
      totalComplete: completeDates.length,
      today: {
        caffeine: caffeine.has(today),
        sleep: dailyWake.has(today),
        complete: caffeine.has(today) && dailyWake.has(today),
      },
      initial: countsForRange(caffeine, sleep, schedule.initialStart, schedule.initialEnd),
      action: countsForRange(caffeine, sleep, schedule.actionStart, schedule.actionEnd),
    };
  }

  function classFromStudentId(studentId) {
    const value = String(studentId || '').trim();
    return /^\d{4}$/.test(value) ? value.charAt(1) : '';
  }

  function milestoneProgress(completeDates, badges, schedule) {
    const current = uniqueValidDates(completeDates).size;
    const totalDays = schedule ? dateRange(schedule.start, schedule.end).length : 0;
    return (badges || []).map((badge) => {
      const ratio = Number(badge.ratio);
      const days = badge.ratio !== undefined
        ? (ratio > 0 && ratio <= 1 && totalDays > 0 ? Math.ceil(totalDays * ratio) : 0)
        : Number(badge.days || 0);
      return { ...badge, days, totalDays, current, earned: days > 0 && current >= days, remaining: Math.max(0, days - current) };
    });
  }

  function studentStage(schedule, today) {
    if (!schedule || !parseDate(today)) return { key: 'prepare', label: '기록 준비하기' };
    if (today < schedule.start) return { key: 'prepare', label: '기록 준비하기' };
    if (today <= schedule.initialEnd) return { key: 'start', label: '기록 시작하기' };
    if (today < schedule.actionStart) return { key: 'observe', label: '나의 생활 살펴보기' };
    if (today <= schedule.actionEnd) return { key: 'action', label: '건강행동 실천하기' };
    return { key: 'reflect', label: '변화를 돌아보기' };
  }

  function weekProgress(input) {
    const today = parseDate(input.today);
    if (!today) return { dates: [], states: [], complete: 0, totalDays: 0 };
    const monday = new Date(today);
    const day = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const dates = dateRange(formatDate(monday), formatDate(sunday));
    const inSchedule = date => !input.schedule || (date >= input.schedule.start && date <= input.schedule.end);
    const { caffeine, sleep } = pairedSets(input);
    const states = dates.map((date) => {
      if (!inSchedule(date)) return 'empty';
      if (caffeine.has(date) && sleep.has(date)) return 'complete';
      if (caffeine.has(date) || sleep.has(date)) return 'partial';
      return 'empty';
    });
    return { dates, states, complete: states.filter((state) => state === 'complete').length, totalDays: dates.filter(inSchedule).length };
  }

  function mergeConfig(config) {
    const input = config && typeof config === 'object' ? config : {};
    if (Number(input.version || 0) < DEFAULT_CONFIG.version) {
      return {
        ...DEFAULT_CONFIG,
        schedules: { ...DEFAULT_CONFIG.schedules },
        badges: [...DEFAULT_CONFIG.badges],
      };
    }
    return {
      ...DEFAULT_CONFIG,
      ...input,
      schedules: { ...DEFAULT_CONFIG.schedules, ...(input.schedules || {}) },
      badges: Array.isArray(input.badges) && input.badges.length ? input.badges : [...DEFAULT_CONFIG.badges],
    };
  }

  // Explicit teacher draft only. Never activate v5 by merely loading the app.
  function prepareUpgrade(config) {
    const current = mergeConfig(config);
    const starts = { '1': '2026-10-12', '2': '2026-10-16', '3': '2026-10-06', '4': '2026-10-06' };
    const finals = { '1': '2026-11-12', '2': '2026-11-12', '3': '2026-11-11', '4': '2026-11-10' };
    const actions = { '1': '2026-11-06', '2': '2026-11-06', '3': '2026-11-04', '4': '2026-11-04' };
    const schedules = {};
    Object.keys(starts).forEach(key => {
      schedules[key] = { ...current.schedules[key], start: starts[key], end: shiftDate(finals[key], -1), actionStart: actions[key], actionEnd: shiftDate(finals[key], -1), finalClassDate: finals[key] };
    });
    return { ...current, version: 5, dateBasis: 'caffeine_day_next_wake', schedules,
      badges: [...DEFAULT_CONFIG.badges.slice(0, 3), { id: 'journey_finish_v5', name: '건강기록 여정 마무리', image: '🏁', ratio: 0.8, bg: '#fefce8', color: '#a16207', auto: true }] };
  }

  root.BadgeJourney = Object.freeze({
    DEFAULT_CONFIG,
    classFromStudentId,
    dateRange,
    mergeConfig,
    milestoneProgress,
    prepareUpgrade,
    shiftDate,
    sleepWakeDates,
    studentStage,
    summarize,
    weekProgress,
  });
})(globalThis);
