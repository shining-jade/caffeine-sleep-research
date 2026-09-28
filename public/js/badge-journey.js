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
    return Number.isNaN(date.getTime()) ? null : date;
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
    const caffeine = uniqueValidDates(input.caffeineDates);
    const sleep = uniqueValidDates(input.sleepDates);
    const completeDates = dateRange(schedule.start, schedule.end).filter((date) => caffeine.has(date) && sleep.has(date));
    const today = String(input.today || '');
    return {
      completeDates,
      totalComplete: completeDates.length,
      today: {
        caffeine: caffeine.has(today),
        sleep: sleep.has(today),
        complete: caffeine.has(today) && sleep.has(today),
      },
      initial: countsForRange(caffeine, sleep, schedule.initialStart, schedule.initialEnd),
      action: countsForRange(caffeine, sleep, schedule.actionStart, schedule.actionEnd),
    };
  }

  function classFromStudentId(studentId) {
    const value = String(studentId || '').trim();
    return /^\d{4}$/.test(value) ? value.charAt(1) : '';
  }

  function milestoneProgress(completeDates, badges) {
    const current = uniqueValidDates(completeDates).size;
    return (badges || []).map((badge) => ({
      ...badge,
      current,
      earned: current >= Number(badge.days || 0),
      remaining: Math.max(0, Number(badge.days || 0) - current),
    }));
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
    if (!today) return { dates: [], states: [], complete: 0 };
    const monday = new Date(today);
    const day = monday.getUTCDay();
    monday.setUTCDate(monday.getUTCDate() - (day === 0 ? 6 : day - 1));
    const sunday = new Date(monday);
    sunday.setUTCDate(sunday.getUTCDate() + 6);
    const dates = dateRange(formatDate(monday), formatDate(sunday));
    const caffeine = uniqueValidDates(input.caffeineDates);
    const sleep = uniqueValidDates(input.sleepDates);
    const states = dates.map((date) => {
      if (caffeine.has(date) && sleep.has(date)) return 'complete';
      if (caffeine.has(date) || sleep.has(date)) return 'partial';
      return 'empty';
    });
    return { dates, states, complete: states.filter((state) => state === 'complete').length };
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

  root.BadgeJourney = Object.freeze({
    DEFAULT_CONFIG,
    classFromStudentId,
    dateRange,
    mergeConfig,
    milestoneProgress,
    studentStage,
    summarize,
    weekProgress,
  });
})(globalThis);
