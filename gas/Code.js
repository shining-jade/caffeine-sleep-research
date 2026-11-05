// ===== public/js/sleep-record-policy.js =====
/* Shared research policy. Reported bedtime is not an observed sleep-onset measurement. */
var SleepRecordPolicy = (function () {
  'use strict';
  var version = '2026-10-21-episode-preservation-v2';
  function pick(r, keys) { for (var k of keys) if (r && r[k] !== undefined && r[k] !== null && r[k] !== '') return r[k]; return ''; }
  function present(r, keys) { for (var k of keys) if (r && Object.prototype.hasOwnProperty.call(r, k)) return r[k]; return undefined; }
  function id(value) { return value === undefined || value === null ? '' : String(value).trim(); }
  function instant(value) {
    if (typeof value === 'number') return Number.isFinite(value) ? value : NaN;
    if (Object.prototype.toString.call(value) === '[object Date]') return Number(value);
    var s = String(value || '').trim();
    var m = s.match(/^(\d{4})[-/.]\s*(\d{1,2})[-/.]\s*(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?)?(Z|[+-]\d{2}:?\d{2})?$/i);
    if (!m || m[8] && !m[4]) return NaN;
    var a = [+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)];
    var utc = Date.UTC.apply(Date, a), d = new Date(utc);
    if (d.getUTCFullYear() !== a[0] || d.getUTCMonth() !== a[1] || d.getUTCDate() !== a[2] || a[3] > 23 || a[4] > 59 || a[5] > 59) return NaN;
    if (m[8]) return Date.parse(m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0') + 'T' + m[4].padStart(2, '0') + ':' + m[5] + ':' + (m[6] || '00') + (m[7] || '') + m[8]);
    return utc + Number(m[7] || 0) * 1000 - 9 * 3600000;
  }
  function date(value) { var t = instant(value); return Number.isFinite(t) ? new Date(t + 9 * 3600000).toISOString().slice(0, 10) : ''; }
  function previous(day) { var t = instant(day); return /^\d{4}-\d{2}-\d{2}$/.test(String(day)) && Number.isFinite(t) ? date(t - 86400000) : ''; }
  function type(value) { var names = {main:'main','주수면':'main',main_candidate:'main_candidate','주수면 후보':'main_candidate',nap:'nap','낮잠':'nap',unclassified:'unclassified','미분류':'unclassified',uncollected:'uncollected','유형 미수집':'uncollected'}, key = String(value || '').trim(); return Object.prototype.hasOwnProperty.call(names,key) ? names[key] : 'uncollected'; }
  function score(value) { var s = String(value || '').trim(); if (/^[1-5]$/.test(s)) return +s; var i = ['😫','😴','😐','🙂','😊'].findIndex(function(e) { return s.indexOf(e) >= 0; }); return i < 0 ? null : i + 1; }
  function amount(value) { if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '') return null; var n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
  function describe(r, options) {
    r = r || {}; options = options || {};
    var rawBedDate = pick(r, ['date','날짜','취침날짜']), rawBedTime = pick(r, ['start','sleepTime','취침','취침시간']);
    var rawWakeDate = pick(r, ['wakeDate','기상날짜']), rawWakeTime = pick(r, ['end','wakeTime','기상','기상시간']);
    var bed = instant(pick(r, ['bedDateTime']) || String(rawBedDate) + 'T' + String(rawBedTime));
    var wake = instant(pick(r, ['wakeDateTime']) || String(rawWakeDate) + 'T' + String(rawWakeTime));
    var kind = type(pick(r, ['sleepType','수면유형'])), wakeDay = Number.isFinite(wake) ? date(wake) : '';
    var status = String(pick(r, ['classificationStatus','분류상태']) || 'unconfirmed');
    var source = String(pick(r, ['typeSource','classificationSource','유형입력경로']) || 'uncollected');
    var explicit = kind === 'main' && ['student_confirmed','teacher_confirmed','researcher_confirmed'].indexOf(status) >= 0;
    var protocol = options.allowProtocolCandidate === true && kind === 'main_candidate' && status === 'candidate' && source === 'basic_form';
    var intervalHours = Number.isFinite(bed) && Number.isFinite(wake) && wake > bed ? (wake - bed) / 3600000 : null;
    return {source:r,id:id(pick(r, ['recordId','id','고유ID','기록ID'])),type:kind,bed:bed,wake:wake,wakeDate:wakeDay,
      targetDate:kind === 'main' ? previous(wakeDay) : '',proposedTargetDate:kind === 'main_candidate' ? previous(wakeDay) : '',
      analysisDate:kind === 'nap' ? '' : previous(wakeDay),analysisDateBasis:'actual_wake_date_minus_one',eligibleRecord:intervalHours !== null && !(r.identityConflict || r.__identityConflict),
      intervalHours:intervalHours,condition:score(pick(r, ['condition','컨디션','수면컨디션','수면 후 컨디션'])),
      classificationStatus:status,typeSource:source,confirmedMain:explicit,eligibleMain:explicit || protocol,
      identityConflict:!!(r.identityConflict || r.__identityConflict),version:version};
  }
  function revision(r) { var n = Number(pick(r, ['revision','metaRevision','기록수정버전']) || 0); return Number.isFinite(n) && n >= 0 ? n : 0; }
  function recordFingerprint(r) {
    var d = describe(r), fields = [['studentId','전체학번','학번','학생ID'],['name','성명','이름'],['hours','수면시간(h)','수면시간','시간','수면 시간','자가보고취침기상간시간(h)'],['condition','컨디션','수면 후 컨디션'],['memo','메모'],['smartphone','취침전스마트폰'],['activity','취침전활동'],['latency','잠들기소요시간'],['awakenings','수면중각성'],['daytime','낮졸림'],['classificationStatus','분류상태'],['typeSource','유형입력경로']];
    return JSON.stringify([Number.isFinite(d.bed) ? d.bed : String(pick(r,['date','날짜'])) + ' ' + pick(r,['start','sleepTime','취침시간']),Number.isFinite(d.wake) ? d.wake : String(pick(r,['wakeDate','기상날짜'])) + ' ' + pick(r,['end','wakeTime','기상시간']),d.type,String(pick(r,['state','기록상태']) || 'active')].concat(fields.map(function(keys) { return String(pick(r, keys)); })));
  }
  function resolveRevisions(records) {
    var result = [], ids = new Map();
    (records || []).forEach(function(r) { var key = describe(r).id; if (!key) { result.push(r); return; } if (!ids.has(key)) ids.set(key, []); ids.get(key).push(r); });
    ids.forEach(function(list) {
      var versions = new Map(), owners = new Set(), collision = list.some(function(r) { return r.identityConflict || r.__identityConflict; });
      list.forEach(function(r) { var v = revision(r); if (!versions.has(v)) versions.set(v,new Map()); versions.get(v).set(recordFingerprint(r),r); owners.add(String(pick(r,['studentId','전체학번','학번','학생ID']))); });
      if (owners.size > 1) collision = true;
      versions.forEach(function(items) { if (items.size > 1) collision = true; });
      if (collision) { versions.forEach(function(items) { items.forEach(function(r) { result.push(Object.assign({},r,{identityConflict:true})); }); }); return; }
      var current = versions.get(Math.max.apply(Math,Array.from(versions.keys()))).values().next().value;
      if (String(pick(current,['state','기록상태'])) !== 'deleted') result.push(current);
    }); return result;
  }
  function unique(records, options) { return resolveRevisions(records).map(function(r) { return describe(r, options); }); }
  function overlaps(record, records) {
    var d = describe(record); if (d.intervalHours === null) return [];
    return unique(records).filter(function(old) { return !(d.id && old.id === d.id) && old.intervalHours !== null && d.bed < old.wake && old.bed < d.wake; });
  }
  function relations(record, records) {
    var d = describe(record), peers = unique(records).filter(function(old) { return !(d.id && old.id === d.id); });
    return {overlaps:overlaps(record,records),sameWakeDate:peers.filter(function(old) { return d.wakeDate && old.wakeDate === d.wakeDate; }),unknownIntervals:peers.filter(function(old) { return old.intervalHours === null; })};
  }
  function days(records, options) {
    var all = unique(records, options), groups = new Map(), result = new Map();
    all.forEach(function(d) { var key = d.analysisDate; if (!key || d.type === 'nap') return; if (!groups.has(key)) groups.set(key,[]); groups.get(key).push(d); });
    groups.forEach(function(list,key) {
      var collision = list.some(function(d) { return d.identityConflict; });
      var overlap = list.some(function(d) { return all.some(function(other) { return !(d.id && d.id === other.id) && d.intervalHours !== null && other.intervalHours !== null && d.bed < other.wake && other.bed < d.wake; }); });
      var reason = collision ? 'identity_conflict' : overlap ? 'overlap' : list.length > 1 ? 'multiple_episodes' : list[0].intervalHours === null ? 'invalid_interval' : '';
      result.set(key,{date:key,status:reason ? 'held' : 'ready',holdReason:reason,recordCount:list.length,record:reason ? null : list[0],records:list});
    }); return result;
  }
  function selectPeriod(records, options) {
    options = options || {}; var basis = options.basis || 'target';
    var selected = [], unassigned = [], excluded = [], outside = [], all = resolveRevisions(records);
    all.forEach(function(r) { var d = describe(r,options), key = basis === 'wake' ? d.wakeDate : basis === 'bed' ? date(d.bed) : d.type === 'nap' ? d.wakeDate : d.analysisDate;
      if (!key) { unassigned.push(r); return; }
      if (options.start && key < options.start || options.end && key > options.end) outside.push(r); else { selected.push(r); if(d.type === 'nap') excluded.push(r); }
    });
    return {basis:basis,records:selected,unassigned:unassigned,excluded:excluded,outside:outside,allRecordCount:all.length,allReviewRecords:selected.concat(unassigned),unassignedScope:'loaded_inventory_without_assignable_'+basis+'_date'};
  }
  function timedInstant(value) { return typeof value === 'string' && !/[ T]\d{1,2}:\d{2}/.test(value) ? NaN : instant(value); }
  function caffeineWindow(record, records, hours) {
    var d = describe(record), valid = Number.isFinite(d.bed) && Number.isFinite(hours) && hours > 0;
    var lower = d.bed - hours * 3600000, rows = [], unplaced = [];
    (records || []).forEach(function(r) { var raw = pick(r,['time','섭취시간']),t = timedInstant(raw); if (valid && Number.isFinite(t) && t >= lower && t < d.bed) rows.push(r); else if (valid && !Number.isFinite(t)) { var day = date(raw); if (day && day >= date(lower) && day <= date(d.bed)) unplaced.push(r); } });
    var unknown = unplaced.length > 0, knownSubtotal = 0, positive = false;
    rows.forEach(function(r) { var n = amount(present(r,['amount','함량','mg'])); if (n === null) unknown = true; else { knownSubtotal += n; if (n > 0) positive = true; } });
    var status = !valid ? 'invalid_window' : !rows.length && !unplaced.length ? 'missing' : unknown ? 'unknown' : 'known';
    return {records:rows,unplacedRecords:unplaced,total:status === 'known' ? knownSubtotal : null,knownSubtotal:knownSubtotal,status:status,recordedIntake:positive ? true : status === 'known' ? false : null};
  }
  function caffeineDays(records) {
    var groups = new Map(); (records || []).forEach(function(r) { var day = date(pick(r,['time','섭취시간'])); if (!day) return; if (!groups.has(day)) groups.set(day,{date:day,records:[],knownSubtotal:0,status:'known',total:0}); var g = groups.get(day),n = amount(present(r,['amount','함량','mg'])); g.records.push(r); if (n === null) g.status = 'unknown'; else g.knownSubtotal += n; g.total = g.status === 'known' ? g.knownSubtotal : null; }); return groups;
  }
  function summarize(records, options) {
    options = options || {}; var groups = days(records,options),selection = selectPeriod(records,Object.assign({},options,{basis:'target'})),hourTotal = 0,conditionTotal = 0,hourDays = 0,conditionDays = 0,heldDays = 0,held = new Set();
    groups.forEach(function(g,key) { if (options.start && key < options.start || options.end && key > options.end) return; if (g.status === 'held') { heldDays++; g.records.forEach(function(d) { held.add(d.id || d.source); }); return; } if (g.record.intervalHours !== null) { hourTotal += g.record.intervalHours; hourDays++; } if (g.record.condition !== null) { conditionTotal += g.record.condition; conditionDays++; } });
    return {recordCount:selection.records.length,allRecordCount:selection.allRecordCount,unassignedRecordCount:selection.unassigned.length,unassignedHeldRecordCount:selection.unassigned.length,unassignedRecords:selection.unassigned,unassignedScope:selection.unassignedScope,excludedNapCount:selection.excluded.length,validHourDays:hourDays,validConditionDays:conditionDays,hourTotal:hourTotal,conditionTotal:conditionTotal,meanHours:hourDays ? hourTotal / hourDays : null,meanCondition:conditionDays ? conditionTotal / conditionDays : null,heldDays:heldDays,periodHeldRecordCount:held.size,heldRecordCount:held.size + selection.unassigned.length,days:groups,policyVersion:version};
  }
  return {version:version,pick:pick,id:id,instant:instant,date:date,previous:previous,type:type,score:score,amount:amount,describe:describe,revision:revision,recordFingerprint:recordFingerprint,resolveRevisions:resolveRevisions,unique:unique,overlaps:overlaps,relations:relations,days:days,selectPeriod:selectPeriod,caffeineWindow:caffeineWindow,caffeineDays:caffeineDays,summarize:summarize};
}());

// ===== public/js/badge-journey.js =====
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

// ===== apps-script/BadgeCelebrations.gs =====
// Called only through authenticated student dispatch, which holds the script lock.
// Consume-before-response deliberately provides at-most-once authorization, not guaranteed delivery.
function claimBadgeCelebrations(studentId, studentName) {
  try {
    var ss = getSpreadsheet_();
    var id = normalizeOwnerId_(studentId), name = String(studentName || '').trim();
    var roster = ss.getSheetByName('students');
    if (!id || !name || !roster || !roster.getDataRange().getValues().slice(1).some(function(row) {
      var rowId = normalizeOwnerId_(row[4]), rowName = String(row[3] || '').trim();
      return rowName === name && (rowId === id || rowId + '_' + rowName === id);
    })) throw new Error('INVALID_SUBJECT');
    var settings = getChallengeBadgeConfig();
    if (!settings || settings.success !== true || !settings.config) throw new Error('CONFIG_UNAVAILABLE');
    var cfg = BadgeJourney.mergeConfig(settings.config);
    var schedule = cfg.schedules[BadgeJourney.classFromStudentId(id)] || cfg.schedules[cfg.defaultClass || '3'];
    var caffeine = getCaffeineLogs(id, undefined, undefined, true);
    var sleep = getSleepLogs(id, undefined, undefined, true);
    var teacher = getTeacherAwardsForStudent(id);
    if (!Array.isArray(caffeine) || !Array.isArray(sleep) || !teacher || teacher.success !== true || !Array.isArray(teacher.awards)) throw new Error('READ_UNAVAILABLE');
    var summary = BadgeJourney.summarize({
      caffeineDates: caffeine.map(function(log) { return String(log.time || '').slice(0, 10); }),
      sleepDates: sleep.map(function(log) { return SleepRecordPolicy.describe(log).wakeDate; }),
      schedule: schedule
    });
    var earned = BadgeJourney.milestoneProgress(summary.completeDates, cfg.badges).filter(function(badge) {
      return badge.auto === true && badge.earned && typeof badge.id === 'string' && badge.id;
    });
    var headers = ['studentId', 'name', 'stateJson', 'updatedAt'];
    var sheet = ss.getSheetByName('badge_celebrations');
    if (!sheet) sheet = ss.insertSheet('badge_celebrations');
    // A creation interrupted before the header write leaves an empty sheet; retry safely.
    if (sheet.getLastRow() === 0) sheet.appendRow(headers);
    var rows = sheet.getDataRange().getValues();
    if (headers.some(function(h, i) { return rows[0][i] !== h; })) throw new Error('INVALID_STATE_HEADER');
    var matches = [];
    for (var i = 1; i < rows.length; i++) if (String(rows[i][0]) === id && String(rows[i][1]) === name) matches.push(i);
    if (matches.length > 1) throw new Error('DUPLICATE_STATE');
    var initialized = matches.length === 0;
    var state = initialized ? { version: 2, automaticIds: [], teacherKeys: [] } : JSON.parse(rows[matches[0]][2]);
    if (!state || [1, 2].indexOf(state.version) < 0 || !Array.isArray(state.automaticIds) || !Array.isArray(state.teacherKeys)
        || state.automaticIds.concat(state.teacherKeys).some(function(key) { return typeof key !== 'string' || !key; })) throw new Error('INVALID_STATE');
    // Legacy v1 combined silent baseline and consumed claims; do not replay ambiguous IDs.
    var legacyHistoryUncertain = state.version === 1 || state.legacyHistoryUncertain === true;
    state.version = 2; state.legacyHistoryUncertain = legacyHistoryUncertain;
    var autoIds = new Set(state.automaticIds), teacherKeys = new Set(state.teacherKeys), items = [];
    var previouslyConsumedAutomatic = new Set(state.automaticIds);
    function matchesMilestone(award, badge) {
      return award.awardId === badge.id || award.badgeId === badge.id
        || (award.name && String(award.name).trim() === String(badge.name).trim());
    }
    earned.forEach(function(badge) {
      var hasTeacherVersion = teacher.awards.some(function(award) { return matchesMilestone(award, badge); });
      if (!autoIds.has(badge.id) && !hasTeacherVersion) items.push({
        kind: 'automatic', claimKey: 'automatic:' + badge.id, awardId: badge.id,
        name: badge.name, image: badge.image, bg: badge.bg, color: badge.color,
        message: '기록을 이어 온 나에게 박수를 보내요!'
      });
      autoIds.add(badge.id);
    });
    teacher.awards.forEach(function(award) {
      var key = JSON.stringify([award.awardId || award.badgeId || '', award.grantedAt || '', award.name || '']);
      var automaticAlreadyConsumed = earned.some(function(badge) {
        return previouslyConsumedAutomatic.has(badge.id) && matchesMilestone(award, badge);
      });
      if (!award.seenAt && !teacherKeys.has(key) && !automaticAlreadyConsumed) items.push({
        kind: 'teacher', claimKey: 'teacher:' + key, awardId: award.awardId || award.badgeId || '',
        name: award.name, image: award.image, bg: award.bg, color: award.color,
        message: award.message, grantedAt: award.grantedAt
      });
      teacherKeys.add(key);
    });
    state.automaticIds = Array.from(autoIds); state.teacherKeys = Array.from(teacherKeys);
    var row = initialized ? sheet.getLastRow() + 1 : matches[0] + 1;
    sheet.getRange(row, 1, 1, 4).setValues([[id, name, JSON.stringify(state), new Date().toISOString()]]);
    SpreadsheetApp.flush();
    return { success: true, initialized: initialized, legacyHistoryUncertain: legacyHistoryUncertain, items: items };
  } catch (_) {
    return { success: false, error: 'BADGE_CELEBRATION_UNAVAILABLE' };
  }
}

// ===== apps-script/SleepEpisodeGuard.gs =====
// Called inside dispatchStudentAction_'s script lock, after replay recognition.
function preservedSleepRecordForPolicy_(row) {
  return {id:String(row[13] === undefined ? '' : row[13]),date:recordDateText_(row[6]),start:recordTimeText_(row[7]),wakeDate:recordDateText_(row[8]),end:recordTimeText_(row[9]),hours:row[10],condition:row[11]};
}
function preservedSleepIntervalGuard_(values, sheet, payload) {
  var incoming = preservedSleepRecordForPolicy_(values), d = SleepRecordPolicy.describe(incoming);
  if (d.intervalHours === null) {
    var missing = [6,7,8,9].some(function(i) { return values[i] === undefined || values[i] === null || String(values[i]).trim() === ''; });
    // Old clients may have never collected a wake date. Preserve that absence.
    if (missing && !payload.sleepPolicyVersion) return {intervalReviewRequired:true};
    return {success:false,error:'SLEEP_INTERVAL_INVALID'};
  }
  var peers = sheet.getDataRange().getValues().slice(1).filter(function(row) { return ownerMatchesSubject_(row[4],row[5],payload); }).map(preservedSleepRecordForPolicy_);
  var conflicts = SleepRecordPolicy.overlaps(incoming,peers);
  if (!conflicts.length) return {};
  return {success:false,error:'SLEEP_INTERVAL_OVERLAP',conflicts:conflicts.map(function(c) { return {id:c.id,date:c.source.date,start:c.source.start,wakeDate:c.source.wakeDate,end:c.source.end}; })};
}

// ===== apps-script/SleepEpisodeMetadata.gs =====
// Classification/provenance only. The original 19-column sleep row is not extended.
var SLEEP_EPISODE_META_HEADERS_=['record_id','owner_key','sleep_type','classification_status','classification_source','policy_version','revision','updated_at'];
function preservedSleepOwnerKey_(row) {
  var owner=normalizeOwnerId_(row[4]);
  return syncHash_([owner,/^\d+$/.test(owner)?'':String(row[5]||'').trim()]);
}
function preservedSleepMetadataIndex_() {
  var sheet=getSpreadsheet_().getSheetByName('_sleep_record_meta'),groups=new Map();
  if(sheet)sheet.getDataRange().getValues().slice(1).forEach(function(row,i){var key=SleepRecordPolicy.id(row[0]);if(!key)return;if(!groups.has(key))groups.set(key,[]);groups.get(key).push({row:row,index:i+2});});
  return {sheet:sheet,groups:groups};
}
function preservedSleepMetadataForRow_(row,index) {
  index=index||preservedSleepMetadataIndex_();var entries=index.groups.get(SleepRecordPolicy.id(row[13]))||[],owner=preservedSleepOwnerKey_(row);
  if(!entries.length)return {exists:false,kind:'',status:'uncollected',source:'legacy_uncollected',policyVersion:'',revision:0,identityConflict:false};
  if(entries.length!==1||String(entries[0].row[1])!==owner)return {exists:true,kind:'',status:'conflict',source:'metadata_conflict',policyVersion:'',revision:0,identityConflict:true};
  var entry=entries[0],r=entry.row,revision=Number(r[6]);
  if(!Number.isSafeInteger(revision)||revision<1)return {exists:true,kind:'',status:'conflict',source:'metadata_conflict',policyVersion:'',revision:0,identityConflict:true};
  return {exists:true,kind:String(r[2]||''),status:String(r[3]||''),source:String(r[4]||''),policyVersion:String(r[5]||''),revision:revision,index:entry.index,identityConflict:false};
}
function preservedSleepMetadataFields_(meta){return [meta.kind,meta.status,meta.source,meta.policyVersion];}
function preservedSleepMetadataEqual_(a,b){return JSON.stringify(preservedSleepMetadataFields_(a))===JSON.stringify(preservedSleepMetadataFields_(b));}
function preservedSleepMetadataFromPayload_(payload,current) {
  var has=function(k){return Object.prototype.hasOwnProperty.call(payload,k);};
  if(!['sleepType','classificationStatus','typeSource'].some(has))return Object.assign({},current,{write:false});
  var kind=has('sleepType')?String(payload.sleepType||'').trim():current.kind;
  if(!kind&&!current.exists)return Object.assign({},current,{write:false});
  if(['main','main_candidate','nap','unclassified'].indexOf(kind)<0)return {error:'SLEEP_CLASSIFICATION_INVALID'};
  var status=has('classificationStatus')?String(payload.classificationStatus):current.exists&&kind===current.kind?current.status:kind==='main_candidate'?'candidate':'unconfirmed';
  var source=has('typeSource')?String(payload.typeSource):current.exists&&kind===current.kind?current.source:'client_unspecified';
  if(['candidate','unconfirmed','student_selected','student_confirmed'].indexOf(status)<0||!/^[a-z0-9_-]{1,80}$/.test(source))return {error:'SLEEP_CLASSIFICATION_INVALID'};
  var next={exists:true,kind:kind,status:status,source:source,policyVersion:SleepRecordPolicy.version,revision:current.exists?current.revision+1:1,index:current.index,identityConflict:false,write:true};
  if(current.exists&&preservedSleepMetadataEqual_(next,current))return Object.assign({},current,{write:false});
  return next;
}
function preservedSleepMetadataRequest_(row,next) {
  if(!next.write)return null;
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName('_sleep_record_meta');
  if(!sheet){sheet=ss.insertSheet('_sleep_record_meta');sheet.appendRow(SLEEP_EPISODE_META_HEADERS_);}
  var values=[String(row[13]),preservedSleepOwnerKey_(row),next.kind,next.status,next.source,next.policyVersion,next.revision,getKSTTimestamp()];
  var cells=values.map(function(v){return {userEnteredValue:typeof v==='number'?{numberValue:v}:{stringValue:String(v)}};});
  return next.index?{updateCells:{start:{sheetId:sheet.getSheetId(),rowIndex:next.index-1,columnIndex:0},rows:[{values:cells}],fields:'userEnteredValue'}}
    :{appendCells:{sheetId:sheet.getSheetId(),rows:[{values:cells}],fields:'userEnteredValue'}};
}
function preservedSleepMetadataView_(row,meta) {
  meta=meta||preservedSleepMetadataForRow_(row);
  var record=Object.assign(preservedSleepRecordForPolicy_(row),{sleepType:meta.kind,classificationStatus:meta.status,typeSource:meta.source,identityConflict:meta.identityConflict});
  var d=SleepRecordPolicy.describe(record);
  return {sleepType:meta.kind,classificationStatus:meta.status,typeSource:meta.source,classificationPolicyVersion:meta.policyVersion,metaRevision:meta.revision,identityConflict:meta.identityConflict,intervalHours:d.intervalHours,analysisDate:d.analysisDate,analysisDateBasis:d.analysisDateBasis,analysisTargetDate:d.targetDate,recordUsable:d.eligibleRecord,policyVersion:SleepRecordPolicy.version};
}

// ===== apps-script/Spreadsheet.gs =====
function getSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (!spreadsheetId) throw new Error('SPREADSHEET_NOT_CONFIGURED');
  return SpreadsheetApp.openById(spreadsheetId);
}

// Keep numeric student IDs compatible with the students-sheet VLOOKUP keys.
function studentIdCellValue_(value) {
  var text = String(value == null ? '' : value).trim();
  var number = Number(text);
  return /^(0|[1-9][0-9]*)$/.test(text) && Number.isSafeInteger(number) ? number : text;
}

// Native table append grows the table atomically and ignores ARRAYFORMULA spill rows.
function appendRecordRow_(sheet, values, replaceRow, confirmation) {
  var idColumns = { caffeine: 4, sleep: 4, info: 5 };
  var idColumn = idColumns[sheet.getName()];
  if (idColumn !== undefined && values.length > idColumn) {
    values = values.slice();
    values[idColumn] = studentIdCellValue_(values[idColumn]);
  }
  var tableIds = {
    students: '2014874531', caffeine: '2029527919', sleep: '363107583',
    info: '1885862728', inquiries: '1093000658', teacher_awards: '1664194152',
    teacher_messages: '1114109815', ai_reports: '828886298'
  };
  var sheetIds = { students: 1719931031, caffeine: 1399656889, sleep: 630091192, info: 1695164716,
    inquiries: 1181027465, teacher_awards: 1683406443, teacher_messages: 2044179537, ai_reports: 1501207574 };
  var tableId = tableIds[sheet.getName()];
  // A recovery-created sheet has a new ID and no existing native table.
  var nativeTable = tableId && sheet.getSheetId() === sheetIds[sheet.getName()];
  if (!nativeTable && !confirmation) {
    if (replaceRow) return sheet.getRange(replaceRow, 1, 1, values.length).setValues([values]);
    return sheet.appendRow(values);
  }
  var dateColumns = { caffeine: [0,8], sleep: [0,6,8], info: [0], inquiries: [0,10], teacher_messages: [0], ai_reports: [5] };
  var cells = values.map(function(value, index) {
    if (value === null || value === undefined || value === '') return {};
    if (value instanceof Date) return { userEnteredValue: { numberValue: value.getTime() / 86400000 + 25569 + 9 / 24 } };
    if (typeof value === 'number') return { userEnteredValue: { numberValue: value } };
    if (typeof value === 'boolean') return { userEnteredValue: { boolValue: value } };
    var match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/);
    if (match && (dateColumns[sheet.getName()] || []).indexOf(index) >= 0) {
      return { userEnteredValue: { numberValue: Date.UTC(Number(match[1]), Number(match[2])-1, Number(match[3]), Number(match[4]||0), Number(match[5]||0), Number(match[6]||0)) / 86400000 + 25569 } };
    }
    return { userEnteredValue: { stringValue: String(value) } };
  });
  var request = replaceRow
    ? { updateCells: { start: { sheetId: sheet.getSheetId(), rowIndex: replaceRow-1, columnIndex: 0 }, rows: [{ values: cells }], fields: 'userEnteredValue' } }
    : { appendCells: { sheetId: sheet.getSheetId(), ...(nativeTable ? { tableId: tableId } : {}), rows: [{ values: cells }], fields: 'userEnteredValue' } };
  var requests = [request].concat(confirmation ? (Array.isArray(confirmation) ? confirmation : [confirmation]) : []);
  try {
    // Sheets rejects appendCells on a message table containing only its header.
    // Reserve its first body row in the same batch, keeping the existing columns.
    if (nativeTable && !replaceRow && sheet.getName() === 'teacher_messages' && sheet.getLastRow() === 1) {
      var metadata = Sheets.Spreadsheets.get(sheet.getParent().getId(), { fields: 'sheets(tables(tableId,range))' });
      var table;
      (metadata.sheets || []).forEach(function(item) {
        (item.tables || []).forEach(function(candidate) { if (candidate.tableId === tableId) table = candidate; });
      });
      if (!table) throw new Error('TABLE_MAPPING_MISMATCH');
      var firstBodyRow = (table.range.startRowIndex || 0) + 2;
      if (table.range.endRowIndex < firstBodyRow) {
        requests.unshift({ updateTable: { table: { tableId: tableId, range: Object.assign({}, table.range, { endRowIndex: firstBodyRow }) }, fields: 'range' } });
      }
    }
    Sheets.Spreadsheets.batchUpdate({ requests: requests }, sheet.getParent().getId());
  }
  catch (error) { throw new Error('TABLE_APPEND_FAILED'); }
  return sheet;
}

// Read-only deployment check: no research rows are written.
function verifyTableAppendAccess() {
  var ss = getSpreadsheet_();
  var sheets = Sheets.Spreadsheets.get(ss.getId(), { fields: 'sheets(properties(sheetId,title),tables(tableId,range))' }).sheets || [];
  var expected = { caffeine: '2029527919', sleep: '363107583', info: '1885862728', inquiries: '1093000658', teacher_awards: '1664194152', teacher_messages: '1114109815', ai_reports: '828886298' };
  Object.keys(expected).forEach(function(name) {
    var found = sheets.filter(function(item) { return item.properties.title === name; })[0];
    if (!found || !(found.tables || []).some(function(table) { return table.tableId === expected[name] && table.range.sheetId === found.properties.sheetId; })) throw new Error('TABLE_MAPPING_MISMATCH');
  });
  Logger.log('Native table API access confirmed');
}

// ===== apps-script/Security.gs =====
function secureEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  var mismatch = left.length ^ right.length;
  var length = Math.max(left.length, right.length);
  for (var i = 0; i < length; i++) {
    mismatch |= (left.charCodeAt(i % Math.max(left.length, 1)) || 0)
      ^ (right.charCodeAt(i % Math.max(right.length, 1)) || 0);
  }
  return mismatch === 0;
}

function verifyGatewaySecret_(candidate) {
  var expected = PropertiesService.getScriptProperties().getProperty('GAS_SHARED_SECRET');
  if (!expected || !secureEquals_(candidate, expected)) throw new Error('REQUEST_REJECTED');
}

function requireSubject_(subject) {
  if (!subject || !subject.studentId || !subject.name) throw new Error('REQUEST_REJECTED');
  return {
    studentId: String(subject.studentId).trim(),
    name: String(subject.name).trim()
  };
}

// Production requests must not write student identifiers or health records to execution logs.
function safeLog_() {}

// ===== apps-script/Ownership.gs =====
function normalizeOwnerId_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (typeof value === 'number') return String(Math.round(value)).trim();
  return String(value).replace(/\.0+$/, '').trim();
}

function ownerMatchesSubject_(rowId, rowName, subject) {
  var subjectId = normalizeOwnerId_(subject.studentId);
  var subjectName = String(subject.name || '').trim();
  var storedId = normalizeOwnerId_(rowId);
  var storedName = String(rowName || '').trim();
  if (!subjectId || !subjectName || !storedId) return false;
  if (/^\d+$/.test(subjectId)) return storedId === subjectId;
  return storedName === subjectName
    && (storedId === subjectId || storedId + '_' + storedName === subjectId);
}

function requireOwnedRecord_(sheetName, recordId, subject) {
  if (!recordId) throw new Error('REQUEST_REJECTED');
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) throw new Error('REQUEST_REJECTED');
  var rows = sheet.getDataRange().getValues();
  if (!rows.length) throw new Error('REQUEST_REJECTED');
  var headers = rows[0].map(function(value) { return String(value || '').trim(); });
  var idColumn = findHeaderColumn_(headers, ['고유ID', 'id', 'ID']);
  var ownerColumn = findHeaderColumn_(headers, ['전체학번', '학번', 'studentId']);
  var nameColumn = findHeaderColumn_(headers, ['성명', '이름', 'name']);
  if (idColumn < 0 || ownerColumn < 0 || nameColumn < 0) throw new Error('REQUEST_REJECTED');
  var found = false;
  for (var row = 1; row < rows.length; row++) {
    if (String(rows[row][idColumn]) !== String(recordId)) continue;
    found = true;
    if (!ownerMatchesSubject_(rows[row][ownerColumn], rows[row][nameColumn], subject)) {
      throw new Error('REQUEST_REJECTED');
    }
  }
  if (found) return;
  throw new Error('REQUEST_REJECTED');
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function requireOwnedRow_(sheetName, rowIndex, subject) {
  var normalizedRow = Number(rowIndex);
  if (!Number.isInteger(normalizedRow) || normalizedRow < 2) throw new Error('REQUEST_REJECTED');
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet || normalizedRow > sheet.getLastRow()) throw new Error('REQUEST_REJECTED');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
    .map(function(value) { return String(value || '').trim(); });
  var ownerColumn = findHeaderColumn_(headers, ['전체학번', '학번', 'studentId']);
  var nameColumn = findHeaderColumn_(headers, ['성명', '이름', 'name', 'studentName']);
  if (ownerColumn < 0 || nameColumn < 0) throw new Error('REQUEST_REJECTED');
  var values = sheet.getRange(normalizedRow, 1, 1, sheet.getLastColumn()).getValues()[0];
  var matches = sheetName === 'teacher_messages' && values[12] === 'privatePdf'
    ? privateReportOwnerMatches_(values, subject.studentId, subject.name)
    : ownerMatchesSubject_(values[ownerColumn], values[nameColumn], subject);
  if (!matches) {
    throw new Error('REQUEST_REJECTED');
  }
}

function findHeaderColumn_(headers, candidates) {
  for (var i = 0; i < candidates.length; i++) {
    var index = headers.indexOf(candidates[i]);
    if (index >= 0) return index;
  }
  return -1;
}

// ===== apps-script/Reminders.gs =====
var REMINDER_SHEETS_ = {
  config: {
    name: '알림설정',
    headers: [
      '설정버전', '전체활성화', '수면활성화', '카페인활성화', '수면알림시각', '카페인알림시각', '주말포함',
      '1반시작일', '1반종료일', '2반시작일', '2반종료일', '3반시작일', '3반종료일', '4반시작일', '4반종료일',
      '수정시각', '수정주체'
    ]
  },
  subscriptions: {
    name: '푸시구독',
    headers: [
      '구독ID', '역할', '학생학번', 'endpoint', 'p256dh', 'auth', '수면알림허용', '카페인알림허용',
      '활성상태', '생성시각', '마지막갱신시각', '마지막성공시각', '마지막오류코드'
    ]
  },
  deliveries: {
    name: '알림발송로그',
    headers: ['중복방지키', '기준날짜', '알림유형', '학번', '구독ID', '발송시각', '결과', '오류코드']
  }
};

function reminderNowIso_() {
  return new Date().toISOString();
}

function normalizeReminderHour_(value) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'HH:mm');
  }
  var match = String(value || '').trim().match(/^(\d{1,2})(?::00)?$/);
  if (!match) throw new Error('REQUEST_REJECTED');
  var hour = Number(match[1]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new Error('REQUEST_REJECTED');
  return String(hour).padStart(2, '0') + ':00';
}

function normalizeReminderDate_(value, allowEmpty) {
  if (value instanceof Date && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  var text = String(value || '').trim();
  if (!text && allowEmpty) return '';
  var match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) throw new Error('REQUEST_REJECTED');
  var date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() + 1 !== Number(match[2])
      || date.getUTCDate() !== Number(match[3])) throw new Error('REQUEST_REJECTED');
  return text;
}

function ensureReminderSheets_() {
  var spreadsheet = getSpreadsheet_();
  Object.keys(REMINDER_SHEETS_).forEach(function(key) {
    var definition = REMINDER_SHEETS_[key];
    var sheet = spreadsheet.getSheetByName(definition.name);
    if (!sheet) sheet = spreadsheet.insertSheet(definition.name);
    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, definition.headers.length).setValues([definition.headers]);
    }
  });
  return spreadsheet;
}

function defaultReminderConfig_() {
  return {
    version: 1,
    enabled: false,
    sleepEnabled: false,
    caffeineEnabled: false,
    sleepTime: '08:00',
    caffeineTime: '20:00',
    includeWeekends: false,
    classPeriods: [1, 2, 3, 4].map(function(classId) {
      return { classId: String(classId), startDate: '', endDate: '' };
    }),
    updatedAt: '',
    updatedBy: ''
  };
}

function reminderConfigFromRow_(row) {
  if (!row || !row.length) return defaultReminderConfig_();
  var periods = [];
  for (var classIndex = 0; classIndex < 4; classIndex++) {
    var offset = 7 + classIndex * 2;
    periods.push({
      classId: String(classIndex + 1),
      startDate: normalizeReminderDate_(row[offset], true),
      endDate: normalizeReminderDate_(row[offset + 1], true)
    });
  }
  return {
    version: Number(row[0]) || 1,
    enabled: row[1] === true,
    sleepEnabled: row[2] === true,
    caffeineEnabled: row[3] === true,
    sleepTime: normalizeReminderHour_(row[4]),
    caffeineTime: normalizeReminderHour_(row[5]),
    includeWeekends: row[6] === true,
    classPeriods: periods,
    updatedAt: String(row[15] || ''),
    updatedBy: String(row[16] || '')
  };
}

function reminderConfigToRow_(config) {
  var row = [
    config.version, config.enabled, config.sleepEnabled, config.caffeineEnabled,
    config.sleepTime, config.caffeineTime, config.includeWeekends
  ];
  config.classPeriods.forEach(function(period) { row.push(period.startDate, period.endDate); });
  row.push(config.updatedAt, config.updatedBy);
  return row;
}

function normalizeReminderConfig_(value, actor) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('REQUEST_REJECTED');
  if (normalizeReminderHour_(value.sleepTime) !== '08:00' || normalizeReminderHour_(value.caffeineTime) !== '20:00') {
    throw new Error('REQUEST_REJECTED');
  }
  if (!Array.isArray(value.classPeriods) || value.classPeriods.length !== 4) throw new Error('REQUEST_REJECTED');
  var byClass = {};
  value.classPeriods.forEach(function(period) {
    var classId = String(period && period.classId || '').trim();
    var startDate = normalizeReminderDate_(period && period.startDate, false);
    var endDate = normalizeReminderDate_(period && period.endDate, false);
    if (!/^[1-4]$/.test(classId) || byClass[classId] || startDate > endDate) throw new Error('REQUEST_REJECTED');
    byClass[classId] = { classId: classId, startDate: startDate, endDate: endDate };
  });
  return {
    version: 1,
    enabled: value.enabled === true,
    sleepEnabled: value.sleepEnabled === true,
    caffeineEnabled: value.caffeineEnabled === true,
    sleepTime: normalizeReminderHour_(value.sleepTime),
    caffeineTime: normalizeReminderHour_(value.caffeineTime),
    includeWeekends: value.includeWeekends === true,
    classPeriods: [byClass['1'], byClass['2'], byClass['3'], byClass['4']],
    updatedAt: reminderNowIso_(),
    updatedBy: String(actor || '').trim()
  };
}

function getReminderConfig_() {
  var spreadsheet = ensureReminderSheets_();
  var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.config.name);
  if (sheet.getLastRow() < 2) return defaultReminderConfig_();
  return reminderConfigFromRow_(sheet.getRange(2, 1, 1, REMINDER_SHEETS_.config.headers.length).getValues()[0]);
}

function saveReminderConfig_(value, actor) {
  var config = normalizeReminderConfig_(value, actor);
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.config.name);
    sheet.getRange(2, 1, 1, REMINDER_SHEETS_.config.headers.length).setValues([reminderConfigToRow_(config)]);
    return config;
  });
}

function reminderHash_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function(byte) {
    return ((byte + 256) % 256).toString(16).padStart(2, '0');
  }).join('');
}

function requirePushRecord_(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('REQUEST_REJECTED');
  var role = String(record.role || '');
  var studentId = normalizeOwnerId_(record.studentId);
  var endpoint = String(record.endpoint || '').trim();
  var p256dh = String(record.keys && record.keys.p256dh || '').trim();
  var auth = String(record.keys && record.keys.auth || '').trim();
  if ((role !== 'student' && role !== 'teacher-test') || !/^https:\/\//.test(endpoint) || !p256dh || !auth) {
    throw new Error('REQUEST_REJECTED');
  }
  if (role === 'student' && !studentId) throw new Error('REQUEST_REJECTED');
  return {
    subscriptionId: reminderHash_(endpoint),
    role: role,
    studentId: role === 'student' ? studentId : '',
    endpoint: endpoint,
    p256dh: p256dh,
    auth: auth,
    sleepEnabled: record.sleepEnabled === true,
    caffeineEnabled: record.caffeineEnabled === true,
    active: record.active !== false
  };
}

function findSubscriptionRow_(sheet, subscriptionId) {
  if (!subscriptionId || sheet.getLastRow() < 2) return -1;
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues();
  for (var index = 0; index < values.length; index++) {
    if (String(values[index][0]) === String(subscriptionId)) return index + 2;
  }
  return -1;
}

function subscriptionViewFromRow_(row) {
  return {
    subscriptionId: String(row[0] || ''),
    sleepEnabled: row[6] === true,
    caffeineEnabled: row[7] === true,
    active: row[8] === true
  };
}

function requireOwnedSubscriptionRow_(sheet, subscriptionId, subject) {
  var rowIndex = findSubscriptionRow_(sheet, subscriptionId);
  if (rowIndex < 2) throw new Error('REQUEST_REJECTED');
  var row = sheet.getRange(rowIndex, 1, 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues()[0];
  if (String(row[1]) !== 'student' || normalizeOwnerId_(row[2]) !== normalizeOwnerId_(subject && subject.studentId)) {
    throw new Error('REQUEST_REJECTED');
  }
  return { rowIndex: rowIndex, row: row };
}

function upsertPushSubscription_(input) {
  var record = requirePushRecord_(input);
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
    var rowIndex = findSubscriptionRow_(sheet, record.subscriptionId);
    var now = reminderNowIso_();
    var createdAt = now;
    var lastSuccess = '';
    var lastError = '';
    if (rowIndex >= 2) {
      var existing = sheet.getRange(rowIndex, 1, 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues()[0];
      if (String(existing[1]) !== record.role || normalizeOwnerId_(existing[2]) !== record.studentId) {
        throw new Error('REQUEST_REJECTED');
      }
      createdAt = String(existing[9] || now);
      lastSuccess = existing[11] || '';
      lastError = existing[12] || '';
    } else {
      rowIndex = sheet.getLastRow() + 1;
    }
    var row = [
      record.subscriptionId, record.role, record.studentId, record.endpoint, record.p256dh, record.auth,
      record.sleepEnabled, record.caffeineEnabled, record.active, createdAt, now, lastSuccess, lastError
    ];
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    return subscriptionViewFromRow_(row);
  });
}

function getPushPreferences_(subscriptionId, subject) {
  var spreadsheet = ensureReminderSheets_();
  var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
  return subscriptionViewFromRow_(requireOwnedSubscriptionRow_(sheet, subscriptionId, subject).row);
}

function setPushPreferences_(subscriptionId, subject, preferences) {
  if (!preferences || typeof preferences !== 'object' || Array.isArray(preferences)) throw new Error('REQUEST_REJECTED');
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
    var owned = requireOwnedSubscriptionRow_(sheet, subscriptionId, subject);
    owned.row[6] = preferences.sleepEnabled === true;
    owned.row[7] = preferences.caffeineEnabled === true;
    owned.row[10] = reminderNowIso_();
    sheet.getRange(owned.rowIndex, 1, 1, owned.row.length).setValues([owned.row]);
    return subscriptionViewFromRow_(owned.row);
  });
}

function deactivatePushSubscription_(subscriptionId, subject) {
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
    var owned = requireOwnedSubscriptionRow_(sheet, subscriptionId, subject);
    owned.row[8] = false;
    owned.row[10] = reminderNowIso_();
    sheet.getRange(owned.rowIndex, 1, 1, owned.row.length).setValues([owned.row]);
    return subscriptionViewFromRow_(owned.row);
  });
}

function requireNamedColumn_(headers, names) {
  var index = findHeaderColumn_(headers, names);
  if (index < 0) throw new Error('REQUEST_REJECTED');
  return index;
}

function reminderRows_(sheet) {
  if (!sheet || sheet.getLastRow() < 1) throw new Error('REQUEST_REJECTED');
  var rows = sheet.getDataRange().getValues();
  return {
    headers: rows[0].map(function(value) { return String(value || '').trim(); }),
    values: rows.slice(1)
  };
}

function reminderDateValue_(value) {
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  var text = String(value || '').trim();
  // Offset-bearing actual instants must cross midnight in Asia/Seoul correctly.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(text)) {
    var instant = new Date(text);
    return isNaN(instant.getTime()) ? '' : Utilities.formatDate(instant, 'Asia/Seoul', 'yyyy-MM-dd');
  }
  if (!/^\d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?)?$/.test(text)) return '';
  try { return normalizeReminderDate_(text.slice(0, 10), false); } catch (_) { return ''; }
}

function previousReminderDate_(dateText) {
  var parts = dateText.split('-').map(Number);
  var previous = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] - 1));
  return Utilities.formatDate(previous, 'UTC', 'yyyy-MM-dd');
}

function getReminderDispatchSnapshot_(type, nowIso) {
  if (type !== 'sleep' && type !== 'caffeine') throw new Error('REQUEST_REJECTED');
  var now = new Date(nowIso);
  if (isNaN(now.getTime())) throw new Error('REQUEST_REJECTED');
  var currentDate = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd');
  var referenceDate = type === 'sleep' ? previousReminderDate_(currentDate) : currentDate;
  var spreadsheet = ensureReminderSheets_();

  var roster = reminderRows_(spreadsheet.getSheetByName('students'));
  var rosterIdColumn = requireNamedColumn_(roster.headers, ['학번ID', '전체학번', '학번', 'studentId']);
  var rosterClassColumn = requireNamedColumn_(roster.headers, ['반', 'classId']);
  var students = roster.values.map(function(row) {
    return { studentId: normalizeOwnerId_(row[rosterIdColumn]), classId: String(row[rosterClassColumn] || '').trim() };
  }).filter(function(student) { return student.studentId && student.classId; });

  var recordSheet = reminderRows_(spreadsheet.getSheetByName(type === 'sleep' ? 'sleep' : 'caffeine'));
  var recordIdColumn = requireNamedColumn_(recordSheet.headers, ['전체학번', '학번ID', '학번', 'studentId']);
  // Completion is today's actual wake/intake date. Keep the existing delivery key/link date separate.
  var recordDateColumn = requireNamedColumn_(recordSheet.headers, type === 'sleep' ? ['기상날짜', '기상일', 'wakeDate'] : ['섭취시간', '날짜']);
  var completedMap = {};
  recordSheet.values.forEach(function(row) {
    if (reminderDateValue_(row[recordDateColumn]) === currentDate) {
      var studentId = normalizeOwnerId_(row[recordIdColumn]);
      if (studentId) completedMap[studentId] = true;
    }
  });

  var subscriptionSheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
  var subscriptionRows = subscriptionSheet.getLastRow() < 2 ? []
    : subscriptionSheet.getRange(2, 1, subscriptionSheet.getLastRow() - 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues();
  var subscriptions = subscriptionRows.filter(function(row) {
    return String(row[1]) === 'student' && row[8] === true;
  }).map(function(row) {
    return {
      subscriptionId: String(row[0]),
      studentId: normalizeOwnerId_(row[2]),
      endpoint: String(row[3]),
      keys: { p256dh: String(row[4]), auth: String(row[5]) },
      sleepEnabled: row[6] === true,
      caffeineEnabled: row[7] === true,
      active: true
    };
  });

  var deliverySheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.deliveries.name);
  var deliveryRows = deliverySheet.getLastRow() < 2 ? []
    : deliverySheet.getRange(2, 1, deliverySheet.getLastRow() - 1, REMINDER_SHEETS_.deliveries.headers.length).getValues();
  var successfulDeliveryKeys = deliveryRows.filter(function(row) {
    return String(row[6]) === 'success' && (
      (String(row[1]) === referenceDate && String(row[2]) === type)
      || (String(row[1]) === currentDate && String(row[2]) === 'evening')
    );
  }).map(function(row) { return String(row[0]); });

  return {
    config: getReminderConfig_(),
    students: students,
    protocolVersion: 'wake-day-evening-v1',
    completedStudentIds: Object.keys(completedMap),
    subscriptions: subscriptions,
    successfulDeliveryKeys: successfulDeliveryKeys
  };
}

function reminderLeaseProperty_(deliveryKey) {
  return 'REMINDER_LEASE_' + reminderHash_(deliveryKey);
}

function claimReminderDeliveries_(deliveryKeys, executionId, nowIso) {
  if (!Array.isArray(deliveryKeys) || !String(executionId || '').trim()) throw new Error('REQUEST_REJECTED');
  var now = new Date(nowIso).getTime();
  if (!Number.isFinite(now)) throw new Error('REQUEST_REJECTED');
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var deliverySheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.deliveries.name);
    var rows = deliverySheet.getLastRow() < 2 ? []
      : deliverySheet.getRange(2, 1, deliverySheet.getLastRow() - 1, REMINDER_SHEETS_.deliveries.headers.length).getValues();
    var successful = {};
    rows.forEach(function(row) { if (String(row[6]) === 'success') successful[String(row[0])] = true; });
    var properties = PropertiesService.getScriptProperties();
    var claimed = [];
    var seen = {};
    deliveryKeys.forEach(function(value) {
      var key = String(value || '').trim();
      if (!key || seen[key] || successful[key]) return;
      seen[key] = true;
      var propertyName = reminderLeaseProperty_(key);
      var lease = null;
      try { lease = JSON.parse(properties.getProperty(propertyName) || 'null'); } catch (_error) { lease = null; }
      if (lease && Number(lease.expiresAt) > now) return;
      properties.setProperty(propertyName, JSON.stringify({
        executionId: String(executionId), expiresAt: now + 5 * 60 * 1000
      }));
      claimed.push(key);
    });
    return claimed;
  });
}

function recordReminderDeliveryResults_(results) {
  if (!Array.isArray(results)) throw new Error('REQUEST_REJECTED');
  var allowedStatuses = { success: true, expired: true, failed: true, skipped: true };
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var deliverySheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.deliveries.name);
    var subscriptionSheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
    var properties = PropertiesService.getScriptProperties();
    var now = reminderNowIso_();
    results.forEach(function(result) {
      if (!result || !allowedStatuses[result.status] || (result.type !== 'sleep' && result.type !== 'caffeine' && result.type !== 'evening')) {
        throw new Error('REQUEST_REJECTED');
      }
      var key = String(result.deliveryKey || '').trim();
      var subscriptionId = String(result.subscriptionId || '').trim();
      if (!key || !subscriptionId) throw new Error('REQUEST_REJECTED');
      deliverySheet.appendRow([
        key, String(result.referenceDate || ''), result.type, normalizeOwnerId_(result.studentId),
        subscriptionId, now, result.status, String(result.errorCode || '')
      ]);
      var rowIndex = findSubscriptionRow_(subscriptionSheet, subscriptionId);
      if (rowIndex >= 2) {
        var row = subscriptionSheet.getRange(rowIndex, 1, 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues()[0];
        if (result.status === 'success') { row[11] = now; row[12] = ''; }
        if (result.status === 'expired') row[8] = false;
        if (result.status !== 'success') row[12] = String(result.errorCode || '');
        row[10] = now;
        subscriptionSheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
      }
      properties.deleteProperty(reminderLeaseProperty_(key));
    });
    return { recorded: results.length };
  });
}

function getReminderAdminConfig_() {
  var spreadsheet = ensureReminderSheets_();
  var subscriptionSheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
  var subscriptionRows = subscriptionSheet.getLastRow() < 2 ? []
    : subscriptionSheet.getRange(2, 1, subscriptionSheet.getLastRow() - 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues();
  var activeStudents = {};
  var activeRows = subscriptionRows.filter(function(row) {
    var active = String(row[1]) === 'student' && row[8] === true;
    if (active) activeStudents[normalizeOwnerId_(row[2])] = true;
    return active;
  });

  var classByStudent = {};
  var rosterSheet = spreadsheet.getSheetByName('students');
  if (rosterSheet && rosterSheet.getLastRow() >= 1) {
    var roster = reminderRows_(rosterSheet);
    var idColumn = findHeaderColumn_(roster.headers, ['학번ID', '전체학번', '학번', 'studentId']);
    var classColumn = findHeaderColumn_(roster.headers, ['반', 'classId']);
    if (idColumn >= 0 && classColumn >= 0) {
      roster.values.forEach(function(row) {
        classByStudent[normalizeOwnerId_(row[idColumn])] = String(row[classColumn] || '').trim();
      });
    }
  }
  var byClass = { 1: 0, 2: 0, 3: 0, 4: 0 };
  activeRows.forEach(function(row) {
    var classId = classByStudent[normalizeOwnerId_(row[2])];
    if (Object.prototype.hasOwnProperty.call(byClass, classId)) byClass[classId] += 1;
  });

  var lastRun = { at: '', targeted: 0, sent: 0, expired: 0, failed: 0 };
  var deliverySheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.deliveries.name);
  if (deliverySheet.getLastRow() >= 2) {
    var deliveryRows = deliverySheet.getRange(
      2, 1, deliverySheet.getLastRow() - 1, REMINDER_SHEETS_.deliveries.headers.length
    ).getValues();
    deliveryRows.forEach(function(row) {
      var timestamp = String(row[5] || '');
      if (timestamp > lastRun.at) lastRun.at = timestamp;
    });
    deliveryRows.filter(function(row) { return String(row[5] || '') === lastRun.at; }).forEach(function(row) {
      lastRun.targeted += 1;
      var status = String(row[6] || '');
      if (status === 'success') lastRun.sent += 1;
      if (status === 'expired') lastRun.expired += 1;
      if (status === 'failed') lastRun.failed += 1;
    });
  }

  return {
    config: getReminderConfig_(),
    subscriberCounts: {
      students: Object.keys(activeStudents).length,
      devices: activeRows.length,
      byClass: byClass
    },
    lastRun: lastRun
  };
}

function getReminderStudentConfig_() {
  var config = getReminderConfig_();
  return {
    sleepTime: config.sleepTime,
    caffeineTime: config.caffeineTime,
    globallyEnabled: config.enabled
  };
}

function saveReminderAdminConfig_(config) {
  return saveReminderConfig_(config, 'teacher');
}

function saveTeacherTestSubscription_(record) {
  var safeRecord = Object.assign({}, record || {}, { role: 'teacher-test', studentId: '' });
  return upsertPushSubscription_(safeRecord);
}

function deactivateTeacherTestSubscription_(subscriptionId) {
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
    var rowIndex = findSubscriptionRow_(sheet, subscriptionId);
    if (rowIndex < 2) throw new Error('REQUEST_REJECTED');
    var row = sheet.getRange(rowIndex, 1, 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues()[0];
    if (String(row[1]) !== 'teacher-test') throw new Error('REQUEST_REJECTED');
    row[8] = false;
    row[10] = reminderNowIso_();
    sheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    return subscriptionViewFromRow_(row);
  });
}

function resolveExactTestStudent_() {
  var spreadsheet = ensureReminderSheets_();
  var roster = reminderRows_(spreadsheet.getSheetByName('students'));
  var idColumn = requireNamedColumn_(roster.headers, ['학번ID', '전체학번', '학번', 'studentId']);
  var nameColumn = requireNamedColumn_(roster.headers, ['이름', '성명', 'name']);
  var matches = roster.values.map(function(row) {
    return {
      studentId: normalizeOwnerId_(row[idColumn]),
      name: String(row[nameColumn] || '').trim()
    };
  }).filter(function(student) {
    return student.studentId && student.name === '테스트';
  });
  if (matches.length !== 1) throw new Error('REQUEST_REJECTED');
  return matches[0];
}

function testStudentSubscriptionRows_(studentId) {
  var spreadsheet = ensureReminderSheets_();
  var sheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, REMINDER_SHEETS_.subscriptions.headers.length)
    .getValues().filter(function(row) {
      return String(row[1]) === 'student'
        && normalizeOwnerId_(row[2]) === normalizeOwnerId_(studentId)
        && row[8] === true;
    });
}

function getTestStudentReminderStatus_() {
  var student = resolveExactTestStudent_();
  var rows = testStudentSubscriptionRows_(student.studentId);
  return {
    name: '테스트',
    sleepDevices: rows.filter(function(row) { return row[6] === true; }).length,
    caffeineDevices: rows.filter(function(row) { return row[7] === true; }).length
  };
}

function getTestStudentReminderTargets_(type) {
  if (type !== 'sleep' && type !== 'caffeine') throw new Error('REQUEST_REJECTED');
  var student = resolveExactTestStudent_();
  var preferenceColumn = type === 'sleep' ? 6 : 7;
  return {
    name: '테스트',
    subscriptions: testStudentSubscriptionRows_(student.studentId).filter(function(row) {
      return row[preferenceColumn] === true;
    }).map(function(row) {
      return {
        studentId: student.studentId,
        subscriptionId: String(row[0]),
        endpoint: String(row[3]),
        keys: { p256dh: String(row[4]), auth: String(row[5]) }
      };
    })
  };
}

function recordTestStudentReminderResults_(type, referenceDate, results) {
  if (type !== 'sleep' && type !== 'caffeine') throw new Error('REQUEST_REJECTED');
  var safeDate = normalizeReminderDate_(referenceDate, false);
  if (!Array.isArray(results)) throw new Error('REQUEST_REJECTED');
  var allowedStatuses = { success: true, expired: true, failed: true };
  var student = resolveExactTestStudent_();
  return withScriptLock_(function() {
    var spreadsheet = ensureReminderSheets_();
    var deliverySheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.deliveries.name);
    var subscriptionSheet = spreadsheet.getSheetByName(REMINDER_SHEETS_.subscriptions.name);
    var now = reminderNowIso_();
    results.forEach(function(result) {
      var deliveryKey = String(result && result.deliveryKey || '').trim();
      var subscriptionId = String(result && result.subscriptionId || '').trim();
      var studentId = normalizeOwnerId_(result && result.studentId);
      var status = String(result && result.status || '');
      var keySuffix = ':' + type + ':' + subscriptionId;
      if (!allowedStatuses[status]
          || !/^manual-test:[^:]+:(sleep|caffeine):[a-f0-9]{64}$/.test(deliveryKey)
          || !deliveryKey.endsWith(keySuffix)
          || studentId !== student.studentId) throw new Error('REQUEST_REJECTED');
      var rowIndex = findSubscriptionRow_(subscriptionSheet, subscriptionId);
      if (rowIndex < 2) throw new Error('REQUEST_REJECTED');
      var row = subscriptionSheet.getRange(rowIndex, 1, 1, REMINDER_SHEETS_.subscriptions.headers.length).getValues()[0];
      if (String(row[1]) !== 'student' || normalizeOwnerId_(row[2]) !== student.studentId) {
        throw new Error('REQUEST_REJECTED');
      }
      deliverySheet.appendRow([
        deliveryKey, safeDate, type, student.studentId, subscriptionId, now,
        status, String(result.errorCode || '')
      ]);
      if (status === 'success') { row[11] = now; row[12] = ''; }
      if (status === 'expired') row[8] = false;
      if (status !== 'success') row[12] = String(result.errorCode || '');
      row[10] = now;
      subscriptionSheet.getRange(rowIndex, 1, 1, row.length).setValues([row]);
    });
    return { recorded: results.length };
  });
}

// ===== apps-script/Sync.gs =====
// Optional local-first writes. Called under the existing student mutation lock.
function syncCanonical_(value) {
  if (Array.isArray(value)) return value.map(syncCanonical_);
  if (value && typeof value === 'object') {
    var out = {};
    Object.keys(value).sort().forEach(function(key) { out[key] = syncCanonical_(value[key]); });
    return out;
  }
  return value;
}
function syncHash_(value) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(syncCanonical_(value)), Utilities.Charset.UTF_8)
    .map(function(n) { return ('0' + ((n + 256) % 256).toString(16)).slice(-2); }).join('');
}
function syncLedger_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName('_sync_receipts');
  if (!sheet) {
    sheet = ss.insertSheet('_sync_receipts');
    sheet.appendRow(['key', 'digest', 'state', 'recordId', 'createdAt', 'receipt']);
  }
  return sheet;
}
function syncLedgerFind_(key) {
  var sheet = syncLedger_();
  if (sheet.getLastRow() < 2) return null;
  var match = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(key).matchEntireCell(true).findNext();
  if (!match) return null;
  var row = (Sheets.Spreadsheets.Values.get(sheet.getParent().getId(), "'_sync_receipts'!A" + match.getRow() + ':F' + match.getRow(), {valueRenderOption:'UNFORMATTED_VALUE'}).values || [[]])[0];
  return { row: match.getRow(), key: row[0], digest: row[1], state: row[2], id: row[3], result: row[5] ? JSON.parse(row[5]) : null };
}
function syncLedgerPending_(key, digest, id) {
  var sheet = syncLedger_();
  sheet.appendRow([key, digest, 'pending', id, new Date().toISOString(), '']);
  SpreadsheetApp.flush();
  return { row: sheet.getLastRow(), key: key, digest: digest, state: 'pending', id: id };
}
function syncLedgerCommit_(entry, result) {
  syncLedger_().getRange(entry.row, 3, 1, 4).setValues([['committed', entry.id, result.committedAt, JSON.stringify(result)]]);
  SpreadsheetApp.flush();
}
function syncProfileState_(subject) {
  var sheet = getSpreadsheet_().getSheetByName('info');
  // Sheets API writes bypass SpreadsheetApp's per-execution read cache.
  var rows = Sheets.Spreadsheets.Values.get(sheet.getParent().getId(), "'info'!A:L", { valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'SERIAL_NUMBER' }).values || [];
  rows = rows.map(function(row) { return Array.from({length:row[11] ? 12 : 11},function(_,i){return row[i] == null ? '' : row[i];}); });
  for (var i = 1; i < rows.length; i++) {
    if (normalizeId(rows[i][5]) === normalizeId(subject.studentId)) {
      return { sheet: sheet, row: i + 1, values: rows[i], version: syncHash_(rows[i].slice(6)) };
    }
  }
  return { sheet: sheet, row: null, values: null, version: 'missing' };
}
function syncRecordExists_(action, id, subject) {
  var type = action === 'saveCaffeineData' ? 'caffeine' : 'sleep';
  var sheet = getSpreadsheet_().getSheetByName(type);
  if (sheet.getLastRow() < 2) return false;
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var column = findHeaderColumn_(headers, ['고유ID', 'id', 'ID']) + 1;
  if (column < 1) throw new Error('REQUEST_REJECTED');
  var match = sheet.getRange(2, column, sheet.getLastRow() - 1, 1).createTextFinder(id).matchEntireCell(true).findNext();
  if (!match) return false;
  requireOwnedRecord_(type, id, subject);
  return true;
}
function syncCells_(values) {
  return values.map(function(value) {
    return { userEnteredValue: typeof value === 'number' ? { numberValue: value } : { stringValue: String(value == null ? '' : value) } };
  });
}
function syncConfirmation_(entry, receipt) {
  return { updateCells: { start: { sheetId: syncLedger_().getSheetId(), rowIndex: entry.row - 1, columnIndex: 2 },
    rows: [{ values: syncCells_(['committed', entry.id, receipt.committedAt, JSON.stringify(receipt)]) }], fields: 'userEnteredValue' } };
}
function syncSaveProfile_(payload, subject, entry, receipt) {
  var state = syncProfileState_(subject);
  if (payload._sync.baseVersion !== state.version) return { success: false, error: 'SYNC_CONFLICT' };
  var p = parseStudentId(normalizeId(subject.studentId));
  var values = [getKSTTimestamp(), p.grade, p.class, p.number, subject.name, studentIdCellValue_(subject.studentId),
    payload.weight, payload.targetCaf || '', payload.targetBedtime || '', payload.targetWakeTime || '', payload.ageGroup || 'teen'];
  if (Array.isArray(payload.confirmedGoals)) values.push(confirmedGoalValue_(payload));
  else if (state.values?.[11]) values.push(state.values[11]);
  receipt.version = syncHash_(values.slice(6));
  var cells = syncCells_(values);
  cells[0] = { userEnteredValue: { numberValue: Date.parse(String(values[0]).replace(' ', 'T') + 'Z') / 86400000 + 25569 } };
  var write = state.row ? { updateCells: { start: { sheetId: state.sheet.getSheetId(), rowIndex: state.row - 1, columnIndex: 0 }, rows: [{ values: cells }], fields: 'userEnteredValue' } }
    : { appendCells: { sheetId: state.sheet.getSheetId(), rows: [{ values: cells }], fields: 'userEnteredValue' } };
  // Native table appends must supply sheetId as well as the known production table.
  if (!state.row && state.sheet.getSheetId() === 1695164716) write.appendCells.tableId = '1885862728';
  var confirmation = syncConfirmation_(entry, receipt);
  Sheets.Spreadsheets.batchUpdate({ requests: [write, confirmation] }, state.sheet.getParent().getId());
  return receipt;
}
function runSyncedMutation_(action, payload, subject, execute) {
  if (['saveCaffeineData','saveSleepData','saveInitialSetup'].indexOf(action) < 0) throw new Error('REQUEST_REJECTED');
  var meta = payload._sync;
  if (!meta || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(meta.mutationId || '')) throw new Error('REQUEST_REJECTED');
  if (action === 'saveInitialSetup' && typeof meta.baseVersion !== 'string') return { success: false, error: 'SYNC_PROFILE_REQUIRED' };
  var fingerprint = Object.assign({}, payload);
  delete fingerprint.id;
  var key = syncHash_([subject.studentId, subject.name, action, meta.mutationId]);
  var digest = syncHash_(fingerprint);
  var entry = syncLedgerFind_(key);
  if (entry && entry.digest !== digest) throw new Error('REQUEST_REJECTED');
  if (entry && entry.state === 'committed') return entry.result;
  payload.id = 'sync_' + key;
  if (!entry) entry = syncLedgerPending_(key, digest, payload.id);
  var receipt = { success: true, mutationId: meta.mutationId, recordId: payload.id, committedAt: new Date().toISOString() };
  if (action === 'saveInitialSetup') return syncSaveProfile_(payload, subject, entry, receipt);
  if (action === 'saveSleepData') {
    // Keep the existing fingerprint/receipt contract; each new sleep appends by request ID.
    var saved = execute(syncConfirmation_(entry, receipt));
    // Legacy clients understand REQUEST_REJECTED as a permanent review state.
    if (saved && saved.success === false && ['SLEEP_RECORD_ID_CONFLICT','SLEEP_REQUEST_ID_REQUIRED','SLEEP_INTERVAL_OVERLAP','SLEEP_INTERVAL_INVALID','SLEEP_CLASSIFICATION_INVALID','SLEEP_RECORD_DELETED'].indexOf(saved.error) >= 0) return {success:false,error:'REQUEST_REJECTED',reason:saved.error};
    return saved && saved.success === true ? receipt : saved || {success:false,error:'SYNC_UNCONFIRMED'};
  }
  var result;
  if (syncRecordExists_(action, payload.id, subject)) result = { success: true };
  else result = execute();
  if (!result || result.success !== true) return result || { success: false, error: 'SYNC_UNCONFIRMED' };
  receipt = Object.assign({}, result, receipt);
  if (action === 'saveCaffeineData') receipt.record = { id: payload.id, name: payload.drink, company: payload.company || '', foodName: payload.foodName || '', amount: Number(payload.mg), time: payload.time, reason: payload.reason || '', symptom: payload.symptom || '' };
  syncLedgerCommit_(entry, receipt);
  return receipt;
}

// ===== apps-script/SleepPreservation.gs =====
// Current-row storage, stable ID/CAS/replay and separate classification metadata.
function preservedSleepCells_(row) {
  return Array.from({length:19},function(_,i){var v=row[i];if(i===0)return recordTimestampText_(v);if(i===6||i===8)return recordDateText_(v);if(i===7||i===9)return recordTimeText_(v);if(i===10&&v!==''&&v!==null&&v!==undefined&&Number.isFinite(Number(v)))return String(Number(v));return String(v===null||v===undefined?'':v);});
}
function preservedSleepVersion_(row,meta) {
  if(arguments.length<2)meta=preservedSleepMetadataForRow_(row);
  var version=[String(row[13]),syncHash_(preservedSleepCells_(row))];
  if(meta.exists)version.push(syncHash_([preservedSleepMetadataFields_(meta),meta.revision,meta.identityConflict]));
  return JSON.stringify(version);
}
function preservedSleepMatches_(sheet,id) {
  if(!id)throw new Error('REQUEST_REJECTED');
  return sheet.getDataRange().getValues().slice(1).map(function(row,i){return {row:row,index:i+2};}).filter(function(item){return String(item.row[13])===String(id);});
}
function preservedSleepValues_(p,old) {
  var who=parseStudentId(normalizeId(p.studentId)),r=old?old.slice(0,19):Array(19).fill('');r[0]=getKSTTimestamp();
  if(!old){r[1]=who.grade;r[2]=who.class;r[3]=who.number;r[4]=normalizeId(p.studentId);r[5]=p.name;r[13]=p.id;}
  r[6]=p.date;r[7]=p.sleepTime;r[8]=p.wakeDate===undefined?(old?old[8]:''):p.wakeDate;r[9]=p.wakeTime;r[10]=p.hours;r[11]=p.condition;r[12]=p.memo||'';
  ['smartphone','activity','latency','awakenings','daytime'].forEach(function(k,i){if(p[k]!==undefined)r[14+i]=p[k]||'';});return r;
}
function savePreservedSleep_(p,confirmation) {
  if(!p||!p.studentId||!p.name||!p.date||!p.id)throw new Error('REQUEST_REJECTED');
  var ss=getSpreadsheet_(),sheet=ss.getSheetByName('sleep');
  if(!sheet){sheet=ss.insertSheet('sleep');sheet.appendRow(['타임스탬프','학년','반','번호','전체학번','성명','날짜','취침시간','기상날짜','기상시간','수면시간','컨디션','메모','고유ID','취침전스마트폰','취침전활동','잠들기소요시간','수면중각성','낮졸림']);sheet.setFrozenRows(1);}
  var matches=preservedSleepMatches_(sheet,p.id),values=preservedSleepValues_(p);
  if(matches.some(function(m){return !ownerMatchesSubject_(m.row[4],m.row[5],p);}))throw new Error('REQUEST_REJECTED');
  if(matches.length>1)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  var currentMeta=preservedSleepMetadataForRow_(matches.length?matches[0].row:values);
  if(currentMeta.identityConflict)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  var nextMeta=preservedSleepMetadataFromPayload_(p,currentMeta);
  if(nextMeta.error)return {success:false,error:nextMeta.error};
  if(matches.length){
    if(JSON.stringify(preservedSleepCells_(matches[0].row).slice(6))!==JSON.stringify(preservedSleepCells_(values).slice(6))||nextMeta.write)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
    if(confirmation)Sheets.Spreadsheets.batchUpdate({requests:[confirmation]},ss.getId());
    return {success:true,recordId:String(p.id),duplicateRequest:true,updated:false};
  }
  if(currentMeta.exists)return {success:false,error:'SLEEP_RECORD_DELETED'};
  var intervalCheck=preservedSleepIntervalGuard_(values,sheet,p);if(intervalCheck.error)return intervalCheck;
  var extra=[],metadataRequest=preservedSleepMetadataRequest_(values,nextMeta);
  if(metadataRequest)extra.push(metadataRequest);if(confirmation)extra.push(confirmation);
  appendRecordRow_(sheet,values,null,extra.length?extra:null);
  return Object.assign({success:true,recordId:String(p.id),updated:false},intervalCheck.intervalReviewRequired?{intervalReviewRequired:true}:{});
}
function updatePreservedSleep_(p) {
  var sheet=getSpreadsheet_().getSheetByName('sleep');if(!sheet)throw new Error('REQUEST_REJECTED');
  var matches=preservedSleepMatches_(sheet,p.id);if(matches.length>1)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  if(matches.length!==1||!ownerMatchesSubject_(matches[0].row[4],matches[0].row[5],p))throw new Error('REQUEST_REJECTED');
  var old=matches[0].row,currentMeta=preservedSleepMetadataForRow_(old);
  if(currentMeta.identityConflict)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  if(typeof p.baseVersion!=='string'||!p.baseVersion)return {success:false,error:'SLEEP_EDIT_VERSION_REQUIRED'};
  var nextMeta=preservedSleepMetadataFromPayload_(p,currentMeta);if(nextMeta.error)return {success:false,error:nextMeta.error};
  var version=preservedSleepVersion_(old,currentMeta),values=preservedSleepValues_(p,old);
  if(p.baseVersion!==version){var previousTarget;try{previousTarget=JSON.parse(p.baseVersion)[0];}catch(_invalidVersion){}
    if(previousTarget===String(p.id)&&JSON.stringify(preservedSleepCells_(values).slice(1))===JSON.stringify(preservedSleepCells_(old).slice(1))&&preservedSleepMetadataEqual_(nextMeta,currentMeta))return {success:true,recordId:String(p.id),editVersion:version,duplicateRequest:true};
    return {success:false,error:'SLEEP_EDIT_CONFLICT'};
  }
  var intervalCheck=preservedSleepIntervalGuard_(values,sheet,p);if(intervalCheck.error)return intervalCheck;
  var metadataRequest=preservedSleepMetadataRequest_(values,nextMeta);
  appendRecordRow_(sheet,values,matches[0].index,metadataRequest?[metadataRequest]:null);
  return {success:true,recordId:String(p.id),editVersion:preservedSleepVersion_(values,nextMeta)};
}
function deletePreservedSleep_(id) {
  var sheet=getSpreadsheet_().getSheetByName('sleep');if(!sheet)throw new Error('REQUEST_REJECTED');var matches=preservedSleepMatches_(sheet,id);
  if(matches.length>1)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  if(matches.length!==1)throw new Error('REQUEST_REJECTED');
  if(preservedSleepMetadataForRow_(matches[0].row).identityConflict)return {success:false,error:'SLEEP_RECORD_ID_CONFLICT'};
  sheet.deleteRow(matches[0].index);return {success:true};
}

// ===== apps-script/FeedbackEngine.gs =====
/** Pure report engine. Callers supply date-aligned, owner-filtered records. */
const FEEDBACK_DAY_MS_ = 86400000;
const FEEDBACK_CONDITION_ = ['최악', '나쁨', '보통', '좋음', '최고'];
const FEEDBACK_WEEKDAY_ = ['일', '월', '화', '수', '목', '금', '토'];
const FEEDBACK_BEDTIME_WHY_ = '우리 또래는 몸이 바뀌면서 밤에 늦게 졸리기 쉬워요. 일어나는 시각이 그대로라면, 늦게 잘수록 잠잘 시간이 줄어요.';
const FEEDBACK_CAFFEINE_WHY_ = '카페인은 마신 뒤 몇 시간 동안 잠을 깨우는 힘이 남아 있어요. 그래서 저녁에 마시면 누워도 잠이 잘 안 올 수 있어요.';
const FEEDBACK_REFS_ = {
  cusick2020: { label: 'Cusick 외 (2020) · 청소년의 카페인 섭취와 수면', url: 'https://doi.org/10.1093/jpepsy/jsaa033' },
  sleepTimingSR: { label: 'Dutil 외 (2022) · 아동·청소년의 취침 시각과 건강', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC9116724/' },
  paruthi2016: { label: 'Paruthi 외 (2016) · 미국수면의학회 청소년 수면 권고', url: 'https://doi.org/10.5664/jcsm.5866' },
  cho2022: { label: '조창모·최원석 (2022) · 청소년기 여학생의 신체활동과 수면', url: 'https://doi.org/10.15831/JKSSPE.2022.27.2.1' },
  oh2019: { label: '오윤정 (2019) · 청소년의 고카페인 에너지음료 섭취와 불편감', url: 'https://doi.org/10.22156/CS4SMB.2019.9.6.035' },
  meneo2025: { label: 'Meneo 외 (2025) · 사춘기 수면 건강과 생활환경', url: 'https://doi.org/10.1080/28324765.2025.2541697' },
  lunsford2022: { label: 'Lunsford-Avery 외 (2022) · 청소년의 카페인 섭취 시각과 수면', url: 'https://pmc.ncbi.nlm.nih.gov/articles/PMC8883093/' },
  brosnan2024: { label: 'Brosnan 외 (2024) · 청소년의 취침 무렵 화면 사용과 수면', url: 'https://doi.org/10.1001/jamapediatrics.2024.2914' },
};

function feedbackDate_(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const ms = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value ? ms : null;
}

function feedbackClock_(value) {
  if (Number.isInteger(value) && value >= 0 && value < 2160) return value;
  const match = typeof value === 'string' && /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return match ? +match[1] * 60 + +match[2] : null;
}

function feedbackBed_(value) {
  const clock = feedbackClock_(value);
  return clock === null || clock >= 720 ? clock : clock + 1440;
}

function feedbackNumber_(value, min = 0, max = Infinity) {
  return Number.isFinite(value) && value >= min && value <= max ? value : null;
}

function feedbackClean_(value, limit = 100) {
  return typeof value === 'string' ? value.replace(/\p{Extended_Pictographic}\uFE0F?|[\r\n]/gu, '').trim().slice(0, limit) : '';
}

function feedbackBand_(value) {
  if (value === '30분~60분' || value === '30분~1시간') return '30~60분';
  if (value === '1시간 이상') return '60분 이상';
  return ['안 함', '30분 미만', '30~60분', '60분 이상'].includes(value) ? value : null;
}

function feedbackLatency_(value) {
  if (Number.isFinite(value) && value >= 0) return value <= 15 ? '15분 이내' : value < 30 ? '15~30분' : '30분 이상';
  if (/^15\s*(?:분)?[~–-]\s*30분$/.test(value)) return '15~30분';
  return ['15분 이내', '30분 이상', '30~60분', '30분~60분', '30분~1시간', '60분 이상', '1시간 이상'].includes(value)
    ? (value === '15분 이내' ? value : '30분 이상') : null;
}

function feedbackNormalizeDays_(input) {
  const start = feedbackDate_(input.start);
  const end = feedbackDate_(input.end);
  if (start === null || end === null || end < start || (end - start) / FEEDBACK_DAY_MS_ >= 366) {
    throw new Error('분석 기간을 확인해 주세요.');
  }
  const byDate = new Map();
  for (const day of input.days || []) {
    const time = feedbackDate_(day?.date);
    if (time === null || time < start || time > end) continue;
    if (byDate.has(day.date)) throw new Error('같은 날짜의 기록을 먼저 정리해 주세요.');
    byDate.set(day.date, day);
  }
  const days = [];
  for (let time = start; time <= end; time += FEEDBACK_DAY_MS_) {
    const date = new Date(time).toISOString().slice(0, 10);
    const row = byDate.get(date) || {};
    const caf = row.caffeine || {};
    const intakes = (Array.isArray(caf.intakes) ? caf.intakes : []).map(item => ({
      time: feedbackNumber_(feedbackClock_(item?.time), 0, 1439), drink: feedbackClean_(item?.drink),
      mg: feedbackNumber_(item?.mg), reason: feedbackClean_(item?.reason), symptom: feedbackClean_(item?.symptom),
    }));
    const recorded = caf.recorded === true || (caf.recorded !== false && intakes.length > 0);
    const totalMg = !recorded || intakes.some(item => item.mg === null) ? null : feedbackNumber_(caf.totalMg);
    const status = !recorded ? 'missing' : totalMg === null ? 'unknown' : totalMg === 0 ? 'zero' : 'known';
    const sleep = row.sleep || {};
    const usable = sleep.recorded === true && sleep.held !== true;
    const condition = usable && Number.isInteger(sleep.condition) ? feedbackNumber_(sleep.condition, 1, 5) : null;
    const wake = usable ? feedbackNumber_(feedbackClock_(sleep.wake), 0, 1439) : null;
    days.push({
      date, dow: new Date(time).getUTCDay(),
      caffeine: { recorded, status, totalMg, intakes: recorded ? intakes : [] },
      sleep: { recorded: sleep.recorded === true || sleep.held === true, held: sleep.held === true,
        bed: usable ? (sleep.bedOnTimeline !== undefined ? feedbackNumber_(sleep.bedOnTimeline, 0, 2159) : feedbackBed_(sleep.bed)) : null,
        wake, hours: usable ? feedbackNumber_(sleep.hours, .01, 24) : null,
        latency: usable ? feedbackLatency_(sleep.latency) : null,
        awakenings: usable ? feedbackClean_(String(sleep.awakenings ?? '')) || null : null,
        drowsy: usable ? feedbackClean_(sleep.drowsy) || null : null, condition },
      habits: { phone: usable ? feedbackBand_(row.habits?.phone) : null, activity: usable ? feedbackBand_(row.habits?.activity) : null },
    });
  }
  return days;
}

function feedbackMinimum_(length) {
  return length < 7 ? null : length < 14 ? 2 : length < 28 ? 3 : 4;
}

function feedbackAverage_(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function feedbackRound_(value) {
  return Math.round(value * 10) / 10;
}

function feedbackCompare_(left, right, minimum, options = {}) {
  const { unit = '점', margin = .5, lowerIsBetter = false, labels = ['해당하는 날', '다른 날'] } = options;
  const values = [left, right].map(group => group.filter(Number.isFinite));
  const means = values.map(feedbackAverage_);
  const groups = values.map((group, index) => ({ label: labels[index], n: group.length,
    mean: means[index] === null ? null : feedbackRound_(means[index]), unit,
    ...(unit === '%' ? { matches: group.filter(value => value === 100).length } : {}) }));
  if (!minimum || groups.some(group => group.n < minimum)) {
    return { result: 'notEnough', groups, delta: null, strength: 0,
      reason: minimum ? '비교하려면 두 그룹에 확인할 수 있는 기록이 각각 ' + minimum + '일 이상 필요해요.' : '7일 미만은 비교하지 않아요.' };
  }
  const delta = means[0] - means[1];
  const strength = Math.abs(delta) < margin - 1e-9 ? 0 : feedbackRound_(Math.abs(delta));
  const positive = lowerIsBetter ? delta < 0 : delta > 0;
  return { result: !strength ? 'similar' : positive ? 'better' : 'worse', groups, delta: feedbackRound_(delta), strength };
}

function feedbackGroups_(days, classify) {
  const groups = [[], []];
  days.forEach((day, index) => {
    const member = classify(day, index);
    if (member === true || member === false) groups[member ? 0 : 1].push(day);
  });
  return groups;
}

function feedbackCompareGroups_(groups, field, minimum, options = {}) {
  const values = groups.map(group => group.map(field));
  const metric = feedbackCompare_(values[0], values[1], minimum, options);
  const metricId = options.metricId || (options.unit === undefined ? 'condition' : null);
  return { ...metric, metricId, dates: groups.map((group, index) =>
    group.filter((_, i) => Number.isFinite(values[index][i])).map(day => day.date)) };
}

function feedbackDateLabel_(date) {
  return date.slice(5).replace('-', '.');
}

function feedbackMinutesText_(minutes) {
  const value = Math.round(minutes);
  return (value >= 60 ? Math.floor(value / 60) + '시간' : '') + (value % 60 || value === 0 ? (value >= 60 ? ' ' : '') + value % 60 + '분' : '');
}

function feedbackScoreText_(value, withScale = true) {
  const label = FEEDBACK_CONDITION_[Math.min(5, Math.max(1, Math.round(value))) - 1];
  return (withScale ? '5점 중 ' : '') + feedbackRound_(value) + '점(' + label + ')';
}

function feedbackGroupText_(metric) {
  return metric.groups.map(group => group.label.replace(/ 날$/, '') + ' ' + group.n + '일은 평균 '
    + (group.unit === '점' ? feedbackScoreText_(group.mean, false) : group.unit === '시간'
      ? feedbackMinutesText_(group.mean * 60) : group.mean + group.unit) + '이었어요.').join(' ');
}

function feedbackLatencyText_(metric, labels) {
  const clauses = metric.groups.map((group, index) => {
    const total = labels[index] + ' ' + group.n + '일';
    if (group.matches === 0) return total + '은 모두 15분 안에 잠들었';
    if (group.matches === group.n) return total + '은 모두 15분 넘게 걸렸';
    return total + ' 중 ' + group.matches + '일은 15분 넘게 걸렸';
  });
  return clauses[0] + '고, ' + clauses[1] + '어요.';
}

function feedbackStreak_(days, predicate) {
  let best = 0;
  let run = 0;
  for (const day of days) {
    run = predicate(day) ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

function feedbackFinding_(id, topic, data, options = {}) {
  const { result = 'observed', groups = [], dates = [], strength = 0, refs = [], goalRelated = false,
    text = '', action = '', finalAction = '', why = '', featured = true, comparison = null } = options;
  return { id, topic, result, groups, dates, strength, refs, goalRelated, text, action, finalAction, why, featured, comparison, data };
}

function feedbackRecordHabit_(days) {
  const recorded = day => day.caffeine.recorded || day.sleep.recorded;
  const count = days.filter(recorded).length;
  const rate = count / days.length;
  const half = Math.floor(days.length / 2);
  const halves = half ? [days.slice(0, half), days.slice(-half)].map(group => group.filter(recorded).length / group.length) : [];
  const misses = FEEDBACK_WEEKDAY_.map((label, dow) => ({ label, n: days.filter(day => day.dow === dow && !recorded(day)).length }))
    .sort((a, b) => b.n - a.n);
  const advice = rate >= .8 ? '꾸준히 남겨 줬어요.' : rate >= .5
    ? (misses[0].n ? misses[0].label + '요일에 빠진 기록이 가장 많았어요. 기록하기 편한 시간을 하나 정해 봐요.' : '기록을 잘 이어 가고 있어요.')
    : '오늘은 잠자리에 든 시각처럼 기억하기 쉬운 한 가지부터 남겨 봐요.';
  const text = days.length + '일 중 ' + count + '일을 기록했어요. ' + advice
    + (days.length >= 7 && halves[1] > halves[0] ? ' 기간 후반에는 전반보다 더 자주 기록했어요.' : '');
  return feedbackFinding_('recordHabit', 'record', { count, rate, halves,
    streak: feedbackStreak_(days, recorded), zeroDays: days.filter(day => day.caffeine.status === 'zero').length },
  { text, featured: false });
}

function feedbackGoalRule_(goal) {
  const threshold = feedbackNumber_(goal.threshold);
  const band = (key, long) => day => day.habits[key] === null ? null :
    (['30~60분', '60분 이상'].includes(day.habits[key]) === long);
  const judge = (field, passes) => day => field(day) === null ? null : passes(field(day));
  if (goal.criterion === 'caffeineMax' && threshold !== null) return judge(day => day.caffeine.totalMg, value => value <= threshold);
  if (goal.criterion === 'sleepMin' && threshold !== null) return judge(day => day.sleep.hours, value => value >= threshold);
  if (goal.criterion === 'bedtime' && feedbackBed_(goal.threshold) !== null) return judge(day => day.sleep.bed, value => value <= feedbackBed_(goal.threshold));
  if (goal.criterion === 'wakeTime' && feedbackClock_(goal.threshold) !== null) return judge(day => day.sleep.wake, value => value <= feedbackClock_(goal.threshold));
  if (goal.criterion === 'phone') return band('phone', false);
  if (goal.criterion === 'activity') return band('activity', true);
  return null;
}

function feedbackGoals_(days, goals, minimum) {
  const entries = goals.filter(goal => ['student', 'class'].includes(goal.source) &&
    days.some(day => (!goal.start || day.date >= goal.start) && (!goal.end || day.date <= goal.end))).map(goal => {
    const matches = days.filter(day => (!goal.start || day.date >= goal.start) && (!goal.end || day.date <= goal.end));
    let rule = feedbackGoalRule_(goal);
    let inferred = '';
    if (!rule && goal.source === 'class' && !goal.criterion) {
      if (/폰|휴대전화|화면|유튜브|게임|SNS/i.test(goal.label)) inferred = 'phone';
      else if (/운동|걷기|걸어|산책|신체활동|스트레칭|줄넘기/.test(goal.label)) inferred = 'activity';
      if (inferred) rule = feedbackGoalRule_({ criterion: inferred });
    }
    const decisions = matches.map(day => ({ date: day.date, kept: rule ? rule(day) : null, condition: day.sleep.condition }));
    const passed = decisions.filter(day => day.kept === true);
    const missed = decisions.filter(day => day.kept === false);
    const measured = passed.length + missed.length;
    const rate = measured ? passed.length / measured : null;
    const streak = feedbackStreak_(decisions, day => day.kept === true);
    const condition = feedbackCompareGroups_([passed, missed], day => day.condition, minimum,
      { labels: ['지킨 날', '못 지킨 날'] });
    const cheer = rate >= .8 ? '꾸준히 지켰네요. 정말 잘했어요!' : rate > .5 ? '절반 넘게 지켰어요. 잘됐던 날의 방법을 이어 가 봐요.'
      : rate === .5 ? '절반을 지켰어요. 잘됐던 날의 방법을 이어 가 봐요.' : '한 번 실천하기 쉬운 방법을 골라 작게 시작해 봐요.';
    const prefix = inferred ? (inferred === 'phone' ? '자기 전 스마트폰 30분 미만' : '신체활동 30분 이상') + ' 응답으로 살펴봤어요. ' : '';
    const text = !rule ? '앱 기록으로 확인할 수 없는 목표예요. 지키기 쉬웠던 날에는 무엇을 했나요?'
      : !measured ? prefix + '이 목표를 확인할 기록이 아직 없어요.'
      : prefix + '기록한 ' + measured + '일 중 ' + passed.length + '일 지켰어요. ' + cheer;
    const missedDates = new Set(missed.map(day => day.date));
    const missedRows = matches.filter(day => missedDates.has(day.date));
    const weekdays = FEEDBACK_WEEKDAY_.map((label, dow) => ({ label, n: missedRows.filter(day => day.dow === dow).length }))
      .filter(item => item.n >= 2).sort((a, b) => b.n - a.n);
    const common = { weekdays, phone: missedRows.filter(day => ['30~60분', '60분 이상'].includes(day.habits.phone)).length,
      evening: missedRows.filter(day => feedbackLateClock_(day) === true).length };
    const details = [];
    if (streak >= 2) details.push(streak + '일 연속으로 지킨 적도 있어요.');
    if (condition.result !== 'notEnough') {
      const conclusion = { better: '지킨 날 아침 컨디션이 더 좋았어요.', worse: '지킨 날 아침 컨디션이 더 낮았어요.', similar: '두 경우의 아침 컨디션은 비슷했어요.' };
      details.push(conclusion[condition.result] + ' ' + feedbackGroupText_(condition));
    }
    if (common.phone >= 2 && (goal.criterion || inferred) !== 'phone') details.push('못 지킨 날 중 ' + common.phone + '일은 자기 전에 스마트폰을 30분 이상 썼어요.');
    if (common.evening >= 2) details.push('못 지킨 날 중 ' + common.evening + '일은 저녁 6시 이후에 카페인을 마셨어요.');
    return { id: goal.id, label: feedbackClean_(goal.label) || '내 목표', source: goal.source, criterion: goal.criterion || inferred,
      measured, kept: passed.length, rate, streak, condition, common, days: decisions, text, details };
  });
  return feedbackFinding_('goalProgress', 'goal', { goals: entries }, {
    text: entries[0]?.text || '', result: entries.length ? 'observed' : 'notEnough', featured: false,
  });
}

function feedbackLateClock_(day) {
  const caf = day.caffeine;
  if (caf.status === 'zero') return false;
  const positive = caf.intakes.filter(item => item.mg > 0);
  if (caf.status !== 'known' || !positive.length || positive.some(item => item.time === null)) return null;
  return positive.some(item => item.time >= 1080);
}

function feedbackNearBed_(day, next) {
  if (day.sleep.bed === null || feedbackLateClock_(day) === null) return null;
  const bedtime = day.sleep.bed;
  const within = time => time < bedtime && bedtime - time <= 360;
  if (day.caffeine.intakes.some(item => item.mg > 0 && within(item.time))) return true;
  if (bedtime <= 1440) return false;
  if (!next || feedbackLateClock_(next) === null) return null;
  return next.caffeine.intakes.some(item => item.mg > 0 && within(item.time + 1440));
}

function feedbackConditionComparison_(days, classify, labels, minimum) {
  const groups = feedbackGroups_(days, classify);
  return { groups, metric: feedbackCompareGroups_(groups, day => day.sleep.condition, minimum, { labels }) };
}

function feedbackContrast_(subject, metric) {
  if (metric.result === 'notEnough') return '';
  if (metric.result === 'similar') {
    const [first, second] = metric.groups;
    const scores = first.mean === second.mean ? '둘 다 평균 ' + feedbackScoreText_(first.mean, false) + '으로'
      : '평균 ' + feedbackScoreText_(first.mean, false) + '과 ' + feedbackScoreText_(second.mean, false) + '으로';
    return first.label + '과 ' + second.label + '의 아침 컨디션은 ' + scores + ' 비슷했어요.';
  }
  return subject + (metric.result === 'better' ? '은 아침 컨디션이 더 좋았어요. ' : '은 아침 컨디션이 더 낮았어요. ')
    + feedbackGroupText_(metric);
}

function feedbackHabitComparison_(id, days, minimum, spec, goals) {
  const { topic, classify, labels, action, why, refs = [], criteria = [] } = spec;
  const { groups, metric } = feedbackConditionComparison_(days, classify, labels, minimum);
  const data = { condition: metric, members: groups.map(group => group.map(day => day.date)) };
  if (id === 'phoneBeforeBed') {
    data.latencyOver15 = feedbackCompareGroups_(groups, day => day.sleep.latency === null ? null :
      day.sleep.latency === '15분 이내' ? 0 : 100, minimum, { labels, metricId: 'latency', unit: '%', margin: 10, lowerIsBetter: true });
  }
  if (id === 'midnightBedtime' && minimum) {
    // Match disjoint days greedily by the closest recorded interval, never reusing a day.
    const remaining = groups[1].filter(day => day.sleep.hours !== null);
    const pairs = [];
    for (const left of groups[0].filter(day => day.sleep.hours !== null && day.sleep.condition !== null)) {
      const best = remaining.reduce((best, right, index) => {
        const gap = Math.abs(left.sleep.hours - right.sleep.hours);
        return gap <= .5 && right.sleep.condition !== null && (best === -1 || gap < Math.abs(left.sleep.hours - remaining[best].sleep.hours)) ? index : best;
      }, -1);
      if (best !== -1) pairs.push([left, remaining.splice(best, 1)[0]]);
    }
    data.similarDuration = feedbackCompare_(pairs.map(pair => pair[0].sleep.condition), pairs.map(pair => pair[1].sleep.condition), minimum, { labels });
    data.similarDuration.pairedDates = pairs.map(pair => pair.map(day => day.date));
  }
  const latency = data.latencyOver15;
  const primary = latency && (metric.result === 'notEnough' || (metric.result === 'similar' && ['better', 'worse'].includes(latency.result))) ? latency : metric;
  const text = primary === metric ? feedbackContrast_(labels[0], metric) : primary.result === 'notEnough' ? ''
    : feedbackLatencyText_(primary, ['자기 전 스마트폰을 30분 이상 쓴', '30분 미만 쓴']);
  return feedbackFinding_(id, topic, data, {
    result: primary.result, groups: primary.groups, strength: primary === data.latencyOver15 ? primary.strength / 25 : primary.strength,
    dates: data.members[0], refs: text ? refs : [], why, text, action, comparison: primary,
    goalRelated: goals.some(goal => criteria.includes(goal.criterion)),
  });
}

function feedbackLateCaffeine_(days, minimum, goals) {
  const compare = (classifier, labels) => {
    const groups = feedbackGroups_(days, classifier);
    const metrics = {
      condition: feedbackCompareGroups_(groups, day => day.sleep.condition, minimum, { labels }),
      bedtime: feedbackCompareGroups_(groups, day => day.sleep.bed, minimum, { labels, metricId: 'bedtime', unit: '분', margin: 15, lowerIsBetter: true }),
      hours: feedbackCompareGroups_(groups, day => day.sleep.hours, minimum, { labels, metricId: 'hours', unit: '시간', margin: .5 }),
      latencyOver15: feedbackCompareGroups_(groups, day => day.sleep.latency === null ? null :
        day.sleep.latency === '15분 이내' ? 0 : 100, minimum, { labels, metricId: 'latency', unit: '%', margin: 10, lowerIsBetter: true }),
    };
    return { metrics, members: groups.map(group => group.map(day => day.date)) };
  };
  const byClock = compare(feedbackLateClock_, ['저녁 6시 이후 카페인을 마신 날', '그 시간에 카페인을 마시지 않은 날']);
  const byBedtime = compare((day, i) => feedbackNearBed_(day, days[i + 1]), ['잠자리 전 6시간 안에 카페인을 마신 날', '그 시간에 카페인을 마시지 않은 날']);
  const useClock = Object.values(byClock.metrics).some(metric => metric.result !== 'notEnough');
  const selected = useClock ? byClock : byBedtime;
  const windowLabel = useClock ? '저녁 6시 이후' : '잠자리 전 6시간 안에';
  const entries = [
    { key: 'condition', metric: selected.metrics.condition, scale: 1 },
    { key: 'latency', metric: selected.metrics.latencyOver15, scale: 25 },
    { key: 'bedtime', metric: selected.metrics.bedtime, scale: 30 },
    { key: 'hours', metric: selected.metrics.hours, scale: .5 },
  ].filter(entry => entry.metric.result !== 'notEnough').sort((a, b) => b.metric.strength / b.scale - a.metric.strength / a.scale);
  const best = entries[0];
  let text = '';
  if (best?.key === 'condition') text = feedbackContrast_(best.metric.groups[0].label, best.metric);
  if (best?.key === 'latency') {
    const { result, groups } = best.metric;
    const subject = (useClock ? '저녁 6시 이후에' : windowLabel) + ' 카페인을 마신 날은 ';
    const conclusion = result === 'similar' ? '누워서 잠들기까지 15분 넘게 걸리는 일이 두 경우에 비슷했어요.'
      : groups[0].matches === groups[0].n && groups[1].matches === 0
        ? subject + '누워서 잠들기까지 더 오래 걸렸어요.'
        : subject + '누워서 잠들기까지 15분 넘게 걸리는 일이 ' + (result === 'worse' ? '더 잦았어요.' : '더 드물었어요.');
    text = conclusion + ' ' + feedbackLatencyText_(best.metric, ['마신', '그 시간에 마시지 않은']);
  }
  if (best?.key === 'bedtime') {
    const { result, delta, groups } = best.metric;
    const clock = value => { const min = ((Math.round(value) % 1440) + 1440) % 1440; return String(Math.floor(min / 60)).padStart(2, '0') + ':' + String(min % 60).padStart(2, '0'); };
    text = (result === 'similar' ? '두 경우의 잠자리에 든 시각은 비슷했어요.'
      : windowLabel + ' 카페인을 마신 날에는 평균 ' + feedbackMinutesText_(Math.abs(delta)) + ' ' + (delta > 0 ? '늦게' : '일찍') + ' 잠자리에 들었어요.')
      + ' ' + groups.map(group => group.label + ' ' + group.n + '일의 평균 취침 시각은 ' + clock(group.mean) + '이었어요.').join(' ');
  }
  if (best?.key === 'hours') text = (best.metric.result === 'similar' ? '두 경우의 잠자리에 있던 시간은 비슷했어요.'
    : windowLabel + ' 카페인을 마신 날은 잠자리에 있던 시간이 더 ' + (best.metric.delta < 0 ? '짧았어요.' : '길었어요.'))
    + ' ' + feedbackGroupText_(best.metric);
  return feedbackFinding_('lateCaffeine', 'caffeine', { byClock, byBedtime }, {
    result: best?.metric.result || 'notEnough', groups: best?.metric.groups || byClock.metrics.condition.groups,
    strength: best ? best.metric.strength / best.scale : 0, dates: selected.members[0], text, comparison: best?.metric,
    refs: text ? ['lunsford2022', 'cusick2020'] : [],
    why: FEEDBACK_CAFFEINE_WHY_,
    action: '저녁에 마실 음료 한 번을 카페인 없는 음료로 바꿔 보고, 그날 잠들기까지 얼마나 걸렸는지 적어 봐요.',
    finalAction: '저녁에 음료를 고를 때 카페인 없는 음료부터 살펴봐요.',
    goalRelated: goals.some(goal => ['caffeineMax', 'bedtime'].includes(goal.criterion)),
  });
}

function feedbackLongSleep_(days, minimum) {
  const longDays = days.filter(day => day.sleep.hours > 10);
  const longest = longDays.reduce((best, day) => !best || day.sleep.hours > best.sleep.hours ? day : best, null);
  const weekdays = longest ? days.filter(day => day !== longest && day.dow >= 1 && day.dow <= 5 && day.sleep.hours !== null) : [];
  const weekdayMean = minimum && weekdays.length >= minimum ? feedbackAverage_(weekdays.map(day => day.sleep.hours)) : null;
  const gap = weekdayMean === null ? null : longest.sleep.hours - weekdayMean;
  let text = '';
  if (longest) {
    text = feedbackDateLabel_(longest.date) + '에는 잠자리에 든 뒤 일어나기까지 '
      + feedbackMinutesText_(longest.sleep.hours * 60) + '이 걸렸어요.';
    if (gap !== null && gap > 0) text = feedbackDateLabel_(longest.date) + '에는 잠자리에 든 뒤 일어나기까지 걸린 시간이 평일 평균보다 '
      + feedbackMinutesText_(gap * 60) + ' 길었어요.';
    if (longest.sleep.condition !== null) text += ' 그날 아침 컨디션은 ' + feedbackScoreText_(longest.sleep.condition) + '이었어요.';
  }
  return feedbackFinding_('longSleep', 'sleep', { count: longDays.length, longest: longest?.date || null,
    hours: longest?.sleep.hours ?? null, weekdayN: weekdays.length, weekdayMean, condition: longest?.sleep.condition ?? null },
  { text, dates: longDays.map(day => day.date), result: longest ? 'observed' : 'notEnough', strength: longest ? .4 : 0 });
}

function feedbackShortNextDay_(days, minimum) {
  const pairs = days.slice(0, -1).map((day, index) => ({ day, next: days[index + 1], date: days[index + 1].date }));
  const groups = feedbackGroups_(pairs, pair => pair.day.sleep.hours === null ? null : pair.day.sleep.hours < 7);
  const labels = ['잠자리에 든 뒤 일어나기까지 7시간이 안 됐던 다음 날', '그 시간이 7시간 이상이었던 다음 날'];
  const caffeine = feedbackCompareGroups_(groups, pair => pair.next.caffeine.totalMg, minimum, { labels, metricId: 'caffeine', unit: 'mg', margin: 15, lowerIsBetter: true });
  const condition = feedbackCompareGroups_(groups.map(group => group.map(pair => pair.day)), day => day.sleep.condition, minimum, { labels });
  const metric = caffeine.result !== 'notEnough' ? caffeine : condition;
  const text = metric === condition ? feedbackContrast_(labels[0], condition) : (caffeine.result === 'similar'
    ? '잠자리에 든 뒤 일어나기까지 7시간이 안 됐던 날과 7시간 이상이었던 날을 비교했어요. 다음 날 카페인 양은 비슷했어요.'
    : labels[0] + '에는 카페인을 ' + (caffeine.delta > 0 ? '더 많이' : '더 적게') + ' 마셨어요.')
    + ' ' + caffeine.groups.map((group, index) => (index === 0 ? '7시간이 안 됐던 경우에는 ' : '7시간 이상이었던 경우에는 ')
      + '다음 날 카페인 양을 적은 ' + group.n + '일의 평균이 ' + group.mean + 'mg이었어요.').join(' ');
  return feedbackFinding_('shortSleepNextDay', 'sleep', { caffeine, condition }, { result: metric.result, groups: metric.groups,
    strength: metric === caffeine ? caffeine.strength / 30 : condition.strength, text, comparison: metric,
    dates: groups[0].map(pair => pair.next.date), action: '잠자리에 있던 시간이 짧았던 다음 날 어떤 음료를 골랐는지 살펴봐요.' });
}

function feedbackCaffeineSummary_(days) {
  const states = ['zero', 'missing', 'unknown', 'known'];
  const counts = Object.fromEntries(states.map(state => [state, days.filter(day => day.caffeine.status === state).length]));
  const totals = days.map(day => day.caffeine.totalMg).filter(Number.isFinite);
  return feedbackFinding_('caffeineSummary', 'caffeine', { counts, meanMg: feedbackAverage_(totals),
    days: days.map(day => ({ date: day.date, ...day.caffeine })) }, { featured: false });
}

function feedbackOverLimit_(days, limit, goals) {
  const target = goals.find(goal => goal.criterion === 'caffeineMax' && feedbackNumber_(goal.threshold) !== null);
  const rows = days.flatMap(day => {
    const applies = target && (!target.start || day.date >= target.start) && (!target.end || day.date <= target.end);
    const cap = applies ? target.threshold : limit;
    if (cap === null || day.caffeine.totalMg === null || day.caffeine.totalMg <= cap) return [];
    const drink = day.caffeine.intakes.reduce((best, item) => item.mg > 0 && (!best || item.mg > best.mg) ? item : best, null);
    return [{ date: day.date, totalMg: day.caffeine.totalMg, limit: cap, source: applies ? target.source : 'default', drink }];
  });
  const label = rows.every(row => row.source !== 'default') ? '목표' : rows.every(row => row.source === 'default') ? '기준' : '그날 적용된 상한';
  const sameDrink = rows[0]?.drink?.drink && rows.every(row => row.drink?.drink === rows[0].drink.drink) ? rows[0].drink.drink : '';
  const peak = rows.reduce((best, row) => !best || row.totalMg > best.totalMg ? row : best, null);
  const text = peak ? label + '을 넘긴 날이 ' + rows.length + '일 있었어요.'
    + (sameDrink ? ' 그날 가장 많은 양을 차지한 음료는 모두 ' + sameDrink + '였어요.' : '')
    + ' 가장 많이 기록한 날은 ' + feedbackDateLabel_(peak.date) + ' ' + peak.totalMg + 'mg이었어요.' : '';
  return feedbackFinding_('overLimitDrink', 'caffeine', { rows }, { text, result: peak ? 'observed' : 'notEnough',
    strength: peak ? .6 + Math.min(rows.length, 5) / 5 : 0, dates: rows.map(row => row.date), goalRelated: !!target,
    action: '마시기 전에 음료의 카페인 함량을 확인하고, 양이 적은 음료도 골라 봐요.' });
}

function feedbackSideEffect_(days) {
  const intake = days.flatMap(day => day.caffeine.intakes.filter(item => item.mg > 0)
    .map(item => ({ date: day.date, ...item })));
  const answers = intake.filter(item => item.symptom);
  const discomfort = answers.filter(item => !/^(없음|해당 없음|없었어요|없다)$/.test(item.symptom));
  const n = intake.length;
  const text = discomfort.length ? '카페인 섭취가 확인된 ' + n + '번 중 ' + discomfort.length + '번에 불편감을 적었어요.'
    + (answers.length < n ? ' 불편감에 답한 기록은 ' + answers.length + '번이에요.' : '') : '';
  return feedbackFinding_('sideEffect', 'caffeine', { n, answered: answers.length, k: discomfort.length, entries: discomfort },
    { result: discomfort.length ? 'observed' : 'notEnough', text, dates: [...new Set(discomfort.map(item => item.date))],
      strength: discomfort.length ? .5 : 0,
      refs: discomfort.some(item => /에너지\s*음료|에너지\s*드링크|energy drink/i.test(item.drink)) ? ['oh2019'] : [],
      why: '국내 고등학생 조사에서도 고카페인 에너지음료를 마신 뒤 두근거림 같은 불편감을 보고한 학생이 있었어요.',
      action: '불편했던 날에 마신 음료와 시각을 함께 살펴봐요.' });
}

function feedbackSleepDetails_(days, minimum, habits) {
  const awake = days.filter(day => day.sleep.awakenings !== null && !/^(없음|안 깸|0\s*(?:회|번)?)$/.test(day.sleep.awakenings));
  const slow = days.filter(day => day.sleep.latency === '30분 이상');
  const knownFast = days.filter(day => day.sleep.latency !== null && day.sleep.latency !== '30분 이상');
  const slowGroups = [slow, knownFast];
  const habitSpecs = [
    ['저녁 카페인 섭취', feedbackLateClock_],
    ['자기 전 스마트폰 30분 이상', day => day.habits.phone === null ? null : ['30~60분', '60분 이상'].includes(day.habits.phone)],
  ];
  const slowPatterns = habitSpecs.map(([label, check]) => ({
    label, metric: feedbackCompareGroups_(slowGroups, day => { const value = check(day); return value === null ? null : value ? 100 : 0; },
      minimum, { unit: '%', margin: 10, labels: ['30분 이상 걸린 날', '30분 미만인 날'] }),
  }));
  const pattern = slowPatterns.find(item => item.metric.result === 'better');
  const latencyText = slow.length ? '잠들기까지 30분 이상 걸린 날이 ' + slow.length + '일 있었어요.'
    + (pattern ? ' 그날에는 ' + pattern.label + '도 더 자주 나타났어요. ' + pattern.metric.groups
      .map(group => group.label + ' ' + group.n + '일 중 ' + group.matches + '일에는 ' + pattern.label + '도 기록했어요.').join(' ') : '') : '';
  const latency = feedbackFinding_('latencyPattern', 'sleep', { count: slow.length, patterns: slowPatterns }, {
    result: slow.length ? 'observed' : 'notEnough', text: latencyText, dates: slow.map(day => day.date),
    strength: slow.length ? .4 : 0, refs: pattern?.label === '저녁 카페인 섭취' ? ['lunsford2022'] : [],
    why: pattern?.label === '저녁 카페인 섭취' ? FEEDBACK_CAFFEINE_WHY_ : '', action: '잠들기까지 걸린 시간과 잠들기 직전에 무엇을 했는지 같이 적어 봐요.',
  });
  const wakeups = feedbackFinding_('wakeups', 'sleep', { entries: awake.map(day => ({ date: day.date, count: day.sleep.awakenings,
    phone: day.habits.phone, lateCaffeine: feedbackLateClock_(day) })) }, { result: awake.length ? 'observed' : 'notEnough',
    dates: awake.map(day => day.date), strength: .2, text: awake.length ? '밤에 깼다고 기록한 날이 ' + awake.length + '일 있었어요. 그날의 생활 기록을 같이 살펴봐요.' : '' });
  const rows = [
    ['latency', '잠드는 데 걸린 시간', day => day.sleep.latency, latency.text],
    ['awakenings', '수면 중 깬 횟수', day => day.sleep.awakenings, wakeups.text],
    ['drowsy', '낮 졸림', day => day.sleep.drowsy, ''],
    ['activity', '신체활동', day => day.habits.activity, habits.find(item => item.id === 'activity').text],
    ['phone', '자기 전 스마트폰', day => day.habits.phone, habits.find(item => item.id === 'phoneBeforeBed').text],
  ].map(([key, label, field, observed]) => {
    const counts = new Map();
    for (const value of days.map(field).filter(value => value !== null)) counts.set(value, (counts.get(value) || 0) + 1);
    const responses = [...counts].map(([value, n]) => ({ value, n })).sort((a, b) => b.n - a.n);
    const n = responses.reduce((sum, response) => sum + response.n, 0);
    const text = responses.length === 1 ? n + '일 모두 ' + responses[0].value : responses.length
      ? responses.map(entry => entry.value + ' ' + entry.n + '일').join(' · ') : '기록 없음';
    return { key, label, n, responses, text, observed, findingId: { latency: 'latencyPattern', awakenings: 'wakeups',
      activity: 'activity', phone: 'phoneBeforeBed' }[key] || null };
  });
  const quality = feedbackFinding_('sleepQuality', 'sleep', { rows }, { featured: false });
  return [latency, wakeups, quality];
}

function feedbackBestDay_(days, minimum) {
  const scored = days.filter(day => day.sleep.condition !== null);
  const high = scored.filter(day => day.sleep.condition >= 4);
  const earlyBed = high.filter(day => day.sleep.bed !== null && day.sleep.bed < 1440).length;
  const timed = high.filter(day => feedbackLateClock_(day) !== null);
  const noLate = timed.filter(day => feedbackLateClock_(day) === false).length;
  const text = high.length ? '아침 컨디션이 좋음 이상인 날이 ' + high.length + '일 있었어요.'
    + (minimum && high.length >= minimum && earlyBed >= 2 ? ' 그중 ' + earlyBed + '일에는 자정 전에 잠자리에 들었어요.' : '')
    + (minimum && timed.length >= minimum && noLate >= 2 ? ' 저녁 섭취를 확인할 수 있는 ' + timed.length + '일 중 ' + noLate + '일은 그 시간에 카페인을 마시지 않았어요.' : '') : '';
  return feedbackFinding_('bestDay', 'sleep', { count: high.length, earlyBed, timed: timed.length, noLate },
    { text, result: high.length ? 'observed' : 'notEnough', dates: high.map(day => day.date), strength: .3,
      action: '아침 컨디션이 좋았던 날의 습관 중 편하게 이어 갈 수 있는 한 가지를 골라요.' });
}

function feedbackHealthStandards_(days, limit) {
  const rules = [
    ...(limit === null ? [] : [['caffeineMax', '카페인 기준 ' + limit + 'mg 이하', day => day.caffeine.totalMg, value => value <= limit]]),
    ['sleepMin', '잠자리에 있던 시간 8시간 이상', day => day.sleep.hours, value => value >= 8],
    ['bedtime', '자정 전 잠자리에 들기', day => day.sleep.bed, value => value < 1440],
  ];
  const rows = rules.map(([id, label, field, passes]) => {
    const states = days.map(day => ({ date: day.date, kept: field(day) === null ? null : passes(field(day)) }));
    return { id, label, source: 'default', days: states, measured: states.filter(day => day.kept !== null).length,
      kept: states.filter(day => day.kept === true).length };
  });
  return feedbackFinding_('healthStandards', 'goal', { rows }, { featured: false, refs: ['paruthi2016'] });
}

function feedbackWeekdayPattern_(days, goals, minimum) {
  if (!minimum) return feedbackFinding_('weekdayPattern', 'weekday', {}, { result: 'notEnough' });
  const patterns = FEEDBACK_WEEKDAY_.flatMap((label, dow) => {
    const rows = days.filter(day => day.dow === dow);
    const eligible = rows.filter(day => day.sleep.hours !== null);
    const short = eligible.filter(day => day.sleep.hours < 7);
    const dates = new Set(rows.map(day => day.date));
    const shortDates = new Set(short.map(day => day.date));
    const hasShort = eligible.length >= minimum && short.length >= 2;
    const repeat = goals.flatMap(goal => {
      const checked = goal.days.filter(day => dates.has(day.date) && day.kept !== null);
      const misses = checked.filter(day => day.kept === false);
      if (checked.length < minimum || misses.length < 2) return [];
      const overlap = goal.criterion === 'bedtime' && hasShort ? misses.filter(day => shortDates.has(day.date)) : [];
      return [{ goal, misses, overlap }];
    }).sort((a, b) => b.overlap.length - a.overlap.length || b.misses.length - a.misses.length)[0];
    if (repeat && repeat.overlap.length < 2) {
      return [{ label, dates: repeat.misses.map(day => day.date), repeat, n: eligible.length, short, hasShort: false }];
    }
    if (!hasShort) return [];
    return [{ label, dates: short.map(day => day.date), repeat, n: eligible.length, short, hasShort }];
  });
  const pattern = patterns.sort((a, b) => (b.repeat?.overlap.length || 0) - (a.repeat?.overlap.length || 0)
    || Number(Boolean(b.repeat)) - Number(Boolean(a.repeat)) || b.dates.length - a.dates.length)[0];
  if (!pattern) return feedbackFinding_('weekdayPattern', 'weekday', {}, { result: 'notEnough' });
  const { label, n, short, repeat, hasShort } = pattern;
  const weekday = label + '요일';
  const criterion = repeat?.goal.criterion;
  const bedtime = hasShort || criterion === 'bedtime' || criterion === 'sleepMin';
  let text;
  if (hasShort && repeat?.overlap.length === n) {
    text = '기록을 확인한 ' + weekday + ' ' + n + '일 모두 목표 시각보다 늦게 잠자리에 들었어요. '
      + '그날은 모두 잠자리에 든 뒤 일어나기까지 7시간이 안 됐어요.';
  } else if (hasShort) {
    text = weekday + '에 기록을 확인한 ' + n + '일 중 ' + short.length + '일은 잠자리에 든 뒤 일어나기까지 7시간이 안 됐어요.';
    if (repeat) text += ' 그중 ' + repeat.overlap.length + '일은 목표 시각보다 늦게 잠자리에 들었어요.';
  } else {
    text = weekday + '에 ‘' + repeat.goal.label + '’ 목표를 지키지 못한 날이 ' + repeat.misses.length + '일 있었어요.';
  }
  const steps = {
    caffeineMax: '마실 음료를 고를 때 카페인이 적은 음료부터 살펴봐요.',
    wakeTime: '아침에 일어날 시각에 맞춰 전날 밤에 알람을 맞춰요.',
    phone: '밤에 스마트폰을 침대 밖에 두고 잠자리에 들어요.',
    activity: '점심시간이나 하교 후에 10분 걷기부터 시작해 봐요.',
  };
  return feedbackFinding_('weekdayPattern', 'weekday', { patterns }, {
    text, dates: pattern.dates, strength: 1.5, goalRelated: Boolean(repeat),
    refs: bedtime ? ['meneo2025'] : [], why: bedtime ? FEEDBACK_BEDTIME_WHY_ : '',
    action: bedtime ? weekday + ' 밤만 잠자리 준비를 30분 일찍 시작해 봐요.' : weekday + '에는 ' + steps[criterion],
    finalAction: bedtime ? weekday + '에는 잠자리 준비를 평소보다 30분 일찍 시작해 봐요.' : '',
  });
}

function feedbackPeriod_(days, tier, mode, minimum) {
  if (!minimum || (mode !== 'final' && tier === 'week')) return null;
  const segment = days.length < 14 ? Math.floor(days.length / 2) : 7;
  const first = days.slice(0, segment);
  const last = mode === 'ongoing' && tier === 'change' ? days.slice(7, 14) : days.slice(-segment);
  const labels = [mode === 'ongoing' && tier === 'change' ? '둘째 주' : '마지막 구간', '처음 구간'];
  const groups = [last, first];
  const condition = feedbackCompareGroups_(groups, day => day.sleep.condition, minimum, { labels });
  const hours = feedbackCompareGroups_(groups, day => day.sleep.hours, minimum, { labels, unit: '시간' });
  const caffeine = feedbackCompareGroups_(groups, day => day.caffeine.totalMg, minimum, { labels, unit: 'mg', margin: 15, lowerIsBetter: true });
  const metrics = [
    { key: 'condition', metric: condition, scale: .5, labels: ['아침 컨디션이 더 좋았어요.', '아침 컨디션이 더 낮았어요.'] },
    { key: 'hours', metric: hours, scale: .5, labels: ['잠자리에 있던 시간이 더 길었어요.', '잠자리에 있던 시간이 더 짧았어요.'] },
    { key: 'caffeine', metric: caffeine, scale: 15, labels: ['카페인 섭취량이 더 적었어요.', '카페인 섭취량이 더 많았어요.'] },
  ].filter(entry => entry.metric.result !== 'notEnough');
  if (!metrics.length) return null;
  const strongest = [...metrics].sort((a, b) => (b.metric.strength / b.scale) - (a.metric.strength / a.scale))[0];
  const improvement = [...metrics].filter(entry => entry.metric.result === 'better' && entry.key !== 'hours')
    .sort((a, b) => b.metric.strength / b.scale - a.metric.strength / a.scale)[0];
  const show = entry => (entry.metric.result === 'similar' ? '앞뒤 기록이 비슷했어요.' :
    labels[0] + '에는 ' + entry.labels[entry.metric.result === 'better' ? 0 : 1]) + ' ' + feedbackGroupText_(entry.metric);
  const items = [show(strongest)];
  if (mode === 'final' && improvement) {
    const [end, start] = improvement.metric.groups;
    const unit = improvement.key === 'condition' ? '점' : 'mg';
    const change = improvement.key === 'condition' ? '아침 컨디션이 ' : '하루 평균 카페인 섭취량이 ';
    const firstLabel = start.n === first.length ? '처음 ' : '처음 구간에 아침 컨디션을 적은 ';
    const lastLabel = end.n === last.length ? '마지막 ' : '마지막 구간에 아침 컨디션을 적은 ';
    const context = improvement.key === 'condition'
      ? firstLabel + start.n + '일의 평균은 ' + feedbackScoreText_(start.mean) + '이었어요. '
        + lastLabel + end.n + '일의 평균은 ' + feedbackScoreText_(end.mean) + '이었어요.'
      : '처음에 카페인 양을 확인할 수 있었던 날은 ' + start.n + '일이고, 마지막에는 ' + end.n + '일이었어요.';
    const praise = change + start.mean + unit + '에서 ' + end.mean + unit + '으로 '
      + (improvement.key === 'condition' ? '올랐어요.' : '줄었어요.') + ' 정말 잘했어요! ' + context;
    if (improvement === strongest) items[0] = praise;
    else items.unshift(praise);
  }
  const weeks = [];
  for (let i = 0; i < days.length; i += 7) {
    const rows = days.slice(i, i + 7);
    const scores = rows.map(day => day.sleep.condition).filter(Number.isFinite);
    weeks.push({ start: rows[0].date, end: rows[rows.length - 1].date, n: scores.length,
      mean: scores.length >= minimum ? feedbackRound_(feedbackAverage_(scores)) : null });
  }
  if (tier === 'flow' && mode !== 'final') {
    const visible = weeks.map((week, i) => week.mean === null ? '' : (i + 1) + '주 차에는 ' + week.n
      + '일의 아침 컨디션이 평균 ' + feedbackScoreText_(week.mean) + '이었어요.').filter(Boolean);
    if (visible.length >= 2) items.push(visible.join(' '));
  }
  if (tier === 'change' && mode !== 'final') items.push('지난번에 해 보기로 고른 행동이 있다면, 실천한 날을 표시해 봐요.');
  return { items, weeks, metrics: { condition, hours, caffeine } };
}

function eligibleFeedbackFindings_(findings, goalComparisons) {
  const signature = metric => metric?.metricId && metric.result !== 'notEnough'
    && metric.dates?.length === 2 && metric.dates.every(group => group.length && group.every(Boolean))
    ? JSON.stringify([metric.metricId, metric.dates.map(group => [...group].sort()).sort()]) : null;
  const covered = new Set(goalComparisons.map(signature).filter(Boolean));
  return findings.filter(finding => finding.featured !== false && finding.result !== 'notEnough' && finding.text
      && !covered.has(signature(finding.comparison)))
    .sort((a, b) => Number(b.goalRelated) - Number(a.goalRelated) || b.strength - a.strength);
}

function selectFeedbackFindings_(findings, max, goalComparisons = []) {
  const sorted = eligibleFeedbackFindings_(findings, goalComparisons).filter(finding => finding.result !== 'similar');
  const topics = new Set();
  return sorted.filter(finding => {
    if (topics.has(finding.topic)) return false;
    topics.add(finding.topic);
    return true;
  }).slice(0, max);
}

function buildFeedbackReport_(input) {
  const days = feedbackNormalizeDays_(input);
  const minimum = feedbackMinimum_(days.length);
  const tier = days.length < 7 ? 'first' : days.length < 14 ? 'week' : days.length < 28 ? 'change' : 'flow';
  const mode = input.mode === 'final' && input.audience !== 'student' ? 'final' : 'ongoing';
  const record = feedbackRecordHabit_(days);
  const inputs = (Array.isArray(input.goals) ? input.goals : []).filter(goal => goal && typeof goal.id === 'string');
  const goal = feedbackGoals_(days, inputs, minimum);
  const goals = goal.data.goals;
  const habitBand = key => day => day.habits[key] === null ? null : ['30~60분', '60분 이상'].includes(day.habits[key]);
  const habits = [
    feedbackHabitComparison_('phoneBeforeBed', days, minimum, { topic: 'habits', classify: habitBand('phone'),
      labels: ['자기 전 스마트폰을 30분 이상 쓴 날', '30분 미만인 날'], criteria: ['phone', 'bedtime'],
      refs: ['meneo2025', 'brosnan2024'], why: '침대에서 화면을 보면 잠드는 시각이 늦어지기 쉬워요. 잠이 잘 오지 않아 화면을 보는 경우도 있어요.',
      action: '자기 전에 스마트폰을 침대 밖에 두는 날을 한 번 만들어 봐요.' }, goals),
    feedbackHabitComparison_('midnightBedtime', days, minimum, { topic: 'sleep',
      classify: day => day.sleep.bed === null ? null : day.sleep.bed < 1440, labels: ['자정 전에 잠자리에 든 날', '자정 이후인 날'],
      criteria: ['bedtime'], refs: ['sleepTimingSR', 'meneo2025'], why: FEEDBACK_BEDTIME_WHY_,
      action: '자정 전에 잠자리에 들기 편한 준비 시각을 하나 정해 봐요.' }, goals),
    feedbackHabitComparison_('eightHours', days, minimum, { topic: 'sleep',
      classify: day => day.sleep.hours === null ? null : day.sleep.hours >= 8, labels: ['잠자리에 있던 시간이 8시간 이상인 날', '8시간 미만인 날'],
      criteria: ['sleepMin'], refs: ['paruthi2016'], why: '미국수면의학회는 13~18세에게 하루 8~10시간의 수면을 권해요. 앱에서 잠자리에 있던 시간은 잠자리에 든 때부터 일어난 때까지예요.', action: '기상 시각에서 거꾸로 계산해 잠자리 준비 시간을 정해 봐요.' }, goals),
    feedbackHabitComparison_('activity', days, minimum, { topic: 'habits', classify: habitBand('activity'),
      labels: ['신체활동을 30분 이상 한 날', '30분 미만인 날'], criteria: ['activity'], refs: ['cho2022'],
      why: '국내 여고생 연구에서도 활동이 많았던 날에 수면 기록이 함께 달라지는 모습이 관찰됐어요.',
      action: '점심시간이나 하교 후에 10분 걷기부터 해 봐요.' }, goals),
  ];
  const late = feedbackLateCaffeine_(days, minimum, goals);
  const limit = feedbackNumber_(input.caffeineLimitMg);
  const weekday = feedbackWeekdayPattern_(days, goals, minimum);
  const findings = [record, goal, late, ...habits, weekday, feedbackHealthStandards_(days, limit), feedbackOverLimit_(days, limit, goals),
    feedbackShortNextDay_(days, minimum), feedbackLongSleep_(days, minimum), feedbackSideEffect_(days), feedbackBestDay_(days, minimum),
    ...feedbackSleepDetails_(days, minimum, habits), feedbackCaffeineSummary_(days),
    feedbackFinding_('bedtimeSeries', 'sleep', { midnight: 1440,
      target: goals.filter(entry => entry.criterion === 'bedtime').map(entry => ({
        id: entry.id, minutes: feedbackBed_(inputs.find(goal => goal.id === entry.id)?.threshold),
        start: entry.days[0]?.date, end: entry.days[entry.days.length - 1]?.date,
      })),
      days: days.map(day => ({ date: day.date, ...day.sleep })) }, { featured: false })];
  for (const finding of findings) finding.refs = finding.refs.filter(id => Object.prototype.hasOwnProperty.call(FEEDBACK_REFS_, id));
  const goalComparisons = goals.map(entry => entry.condition);
  const featured = selectFeedbackFindings_(findings, tier === 'first' || tier === 'week' ? 1 : 3, goalComparisons);
  const period = feedbackPeriod_(days, tier, mode, minimum);
  const hasDifference = findings.some(finding => finding.featured !== false && ['better', 'worse'].includes(finding.result))
    || goalComparisons.some(metric => ['better', 'worse'].includes(metric.result))
    || Object.values(period?.metrics || {}).some(metric => ['better', 'worse'].includes(metric.result));
  const similar = !hasDifference && eligibleFeedbackFindings_(findings, goalComparisons).find(finding => finding.result === 'similar');
  const used = new Set(['recordHabit']);
  const { count, streak } = record.data;
  let recordText = record.text;
  if (mode === 'final') {
    recordText = count && count === days.length
      ? days.length + '일 동안 하루도 빠짐없이 기록했어요. 정말 대단해요!'
      : days.length + '일 중 ' + count + '일의 기록을 남겼어요.';
    if (streak) recordText += ' 가장 길게는 ' + streak + '일 연속으로 기록했어요.';
    recordText += ' 참여해 줘서 고마워요.';
  }
  const sections = [{ id: 'record', title: '📝 기록 습관', items: [recordText] }];
  if (goals.length) {
    used.add('goalProgress');
    sections.push({ id: 'goals', title: '🎯 내 목표',
      items: goals.flatMap(entry => ['‘' + entry.label + '’ 목표를 살펴봤어요. ' + entry.text, ...entry.details]) });
  }
  if (period) sections.push({ id: 'transition', title: mode === 'ongoing' && tier === 'change' ? '🔍 첫째 주와 둘째 주' : '🔍 기간의 처음과 끝', items: period.items });
  const observations = featured.map(finding => { used.add(finding.id); return finding.text; });
  if (observations.length) sections.push({ id: 'findings', title: '🔍 이번 기록에서 찾은 것', items: observations });
  else if (!similar) sections.push({ id: 'findings', title: '🔍 이번 기록에서 찾은 것', items: [
    minimum ? '조건별로 비교할 기록이 아직 충분하지 않았어요.' : '기록한 날의 모습만 살펴봤어요. 7일 미만은 비교하지 않아요.',
  ] });
  if (similar) sections.push({ id: 'similar', title: '비교해 본 기록', items: [similar.text.split(/(?<=요\.)\s+/)[0]] });
  const explanations = featured.filter(finding => finding.refs.length && finding.why);
  const why = [...new Set(explanations.map(finding => finding.why))];
  if (why.length) sections.push({ id: 'why', title: '💡 알아 두면 좋아요', items: why });
  const actionOrder = featured.includes(weekday) ? [weekday, ...featured.filter(finding => finding !== weekday)] : featured;
  const actions = [...new Set(actionOrder.map(finding => mode === 'final' && finding.finalAction ? finding.finalAction : finding.action).filter(Boolean))];
  const defaultAction = '잠자리에 든 시각처럼 기억하기 쉬운 한 가지부터 기록해 봐요.';
  sections.push({ id: 'action', title: mode === 'final' ? '🌱 앞으로 이어 갈 한 가지' : '🧪 이번 주 해 볼 것',
    items: actions.length ? actions.slice(0, mode === 'final' || tier === 'week' || tier === 'first' ? 1 : 3) : [defaultAction] });
  const refs = new Set(findings.filter(finding => used.has(finding.id)).flatMap(finding => finding.refs));
  return { tier, mode, minimum, sections, findings, featuredFindingIds: featured.map(finding => finding.id),
    explanationFindingIds: explanations.map(finding => finding.id),
    usedFindingIds: [...used], references: [...refs].map(id => ({ id, ...FEEDBACK_REFS_[id] })),
    availableReferences: [...new Set(findings.flatMap(finding => finding.refs))].map(id => ({ id, ...FEEDBACK_REFS_[id] })), period };
}

function feedbackSourceRows_() {
  const ss = getSpreadsheet_();
  const rows = name => ss.getSheetByName(name)?.getDataRange().getValues().slice(1) || [];
  const sleep = rows('sleep');
  const sleepIds = new Map();
  for (const row of sleep) {
    const id = SleepRecordPolicy.id(row[13]);
    if (id) sleepIds.set(id, (sleepIds.get(id) || 0) + 1);
  }
  return { caffeine: rows('caffeine'), sleep, sleepIds, sleepMetadata: preservedSleepMetadataIndex_(), info: rows('info') };
}

function feedbackSourceInput_(source, student, start, end, classGoals, options = {}) {
  const subject = { studentId: student.dashboardId || makeTeacherUniqueId(student.id, student.name), name: student.name };
  const owned = (id, name) => String(name || '').trim() === student.name && ownerMatchesSubject_(id, name, subject);
  const caffeine = new Map();
  for (const row of source.caffeine) {
    if (!owned(row[4], row[5])) continue;
    const date = SleepRecordPolicy.date(row[8]) || recordDateText_(row[8]);
    if (!date || date < start || date > end) continue;
    const items = caffeine.get(date) || [];
    const time = row[8] instanceof Date || /(?:Z|[+-]\d{2}:?\d{2})$/i.test(String(row[8]))
      ? (Number.isFinite(SleepRecordPolicy.instant(row[8])) ? new Date(SleepRecordPolicy.instant(row[8]) + 9 * 3600000).toISOString().slice(11, 16) : null)
      : String(row[8]).match(/[ T](\d{1,2}:[0-5]\d)(?::[0-5]\d)?(?:$|\s)/)?.[1];
    items.push({ time: time && recordTimeText_(time), drink: row[6], mg: recordNumber_(row[7]), reason: row[10], symptom: row[11] });
    caffeine.set(date, items);
  }
  const sleep = SleepRecordPolicy.days(source.sleep.filter(row => owned(row[4], row[5])).map(row => {
    const metadata = preservedSleepMetadataView_(row, preservedSleepMetadataForRow_(row, source.sleepMetadata));
    return { ...preservedSleepRecordForPolicy_(row), ...metadata,
      identityConflict: metadata.identityConflict || (source.sleepIds.get(SleepRecordPolicy.id(row[13])) || 0) > 1,
      smartphone: row[14], activity: row[15], latency: row[16], awakenings: row[17], daytime: row[18] };
  }));
  const days = [];
  for (let date = start; date <= end; date = shiftRecordDate_(date, 1)) {
    const intakes = caffeine.get(date);
    const group = sleep.get(date);
    const record = group?.record;
    const raw = record?.source;
    const clock = value => Number.isFinite(value) ? new Date(value + 9 * 3600000).toISOString().slice(11, 16) : null;
    days.push({ date,
      caffeine: intakes && { recorded: true, totalMg: intakes.some(item => item.mg === null) ? null : intakes.reduce((sum, item) => sum + item.mg, 0), intakes },
      sleep: group && { recorded: true, held: group.status === 'held',
        bedOnTimeline: record ? Math.floor((record.bed - Date.parse(date) + 9 * 3600000) / 60000) : null, wake: clock(record?.wake),
        hours: record?.intervalHours, condition: record?.condition, latency: raw?.latency, awakenings: raw?.awakenings, drowsy: raw?.daytime },
      habits: raw && { phone: raw.smartphone, activity: raw.activity } });
  }
  const profile = source.info.find(row => owned(row[5], row[4]));
  const goals = [];
  const criteria = [
    ['caffeineMax', '카페인', value => value + 'mg 이하로 마시기'],
    ['sleepMin', '수면', value => value + '시간 이상 잠자리 시간 확보하기'],
    ['bedtime', '취침', value => value + '까지 잠자리에 들기'],
    ['wakeTime', '기상', value => value + '까지 일어나기'],
  ];
  const personal = readConfirmedGoals_(profile?.[11], [recordNumber_(profile?.[7]), toProfileHHMM_(profile?.[8]), toProfileHHMM_(profile?.[9])]);
  for (const [criterion, , label] of criteria) {
    if (personal[criterion] !== undefined) goals.push({ id: 'student-' + criterion, criterion, threshold: personal[criterion],
      source: 'student', label: label(personal[criterion]) });
  }
  const applied = [];
  for (const day of days) {
    const goal = classGoals.find(entry => entry.start <= day.date && day.date <= entry.end);
    if (!goal) continue;
    const prior = applied[applied.length - 1];
    if (prior?.goal === goal && shiftRecordDate_(prior.end, 1) === day.date) prior.end = day.date;
    else applied.push({ goal, start: day.date, end: day.date });
  }
  for (const [index, { goal, ...period }] of applied.entries()) {
    const values = criteria.filter(([criterion]) => goal[criterion] !== null && goal[criterion] !== undefined && goal[criterion] !== '');
    if (!values.length) goals.push({ ...period, id: 'class-' + index, source: 'class', label: goal.goal });
    for (const [criterion, field, label] of values) goals.push({ ...period, id: 'class-' + index + '-' + criterion,
      source: 'class', criterion, threshold: goal[criterion], label: values.length === 1 ? goal.goal : field + ' · ' + label(goal[criterion]) });
  }
  return { start, end, days, goals, ...options };
}

function feedbackClassGoals_(student, rows) {
  const id = student.dashboardId || makeTeacherUniqueId(student.id, student.name);
  return rows.filter(goal => goal.id === id && goal.name === student.name);
}

function feedbackClassRows_() {
  return (getSpreadsheet_().getSheetByName('teacher_class_goals')?.getDataRange().getValues().slice(1) || [])
    .reverse().filter(row => row[0]).map(row => JSON.parse(row[0]));
}

function feedbackReportText_(sections) {
  return sections.map(section => [section.title, ...section.items].join('\n')).join('\n\n');
}

// ===== apps-script/TeacherReports.gs =====
const REPORT_HABITS_ = ['안 함', '30분 미만', '30~60분', '60분 이상'];
const CLASS_GOALS_SHEET_ = 'teacher_class_goals';
const PRIVATE_PDF_TYPE_ = 'privatePdf';
const REPORT_PDF_LIMIT_ = 3 * 1024 * 1024;
const REPORT_TIME_ = /^([01]\d|2[0-3]):[0-5]\d$/;

function teacherReportDates_(start, end) {
  const first = Date.parse(start + 'T00:00:00Z');
  const last = Date.parse(end + 'T00:00:00Z');
  const days = (last - first) / 86400000 + 1;
  if (!Number.isInteger(days) || days < 1 || days > 366
      || new Date(first).toISOString().slice(0, 10) !== start
      || new Date(last).toISOString().slice(0, 10) !== end) {
    throw new Error('기간은 시작일과 종료일을 포함해 1~366일로 선택해 주세요.');
  }
  return Array.from({length: days}, (_, i) => new Date(first + i * 86400000).toISOString().slice(0, 10));
}

function teacherReportRoster_() {
  const sheet = getSpreadsheet_().getSheetByName('students');
  if (!sheet) throw new Error('학생 명단을 불러올 수 없습니다.');
  return sheet.getDataRange().getValues().slice(1).map(row => {
    const id = normalizeOwnerId_(row[4]);
    const name = String(row[3] || '').trim();
    return { id, name, dashboardId: makeTeacherUniqueId(id, name) };
  }).filter(student => student.id && student.name);
}

function matchReportStudent_(roster, value) {
  const id = normalizeOwnerId_(value && value.studentId);
  const name = typeof value?.studentName === 'string' ? value.studentName.trim() : '';
  const candidates = roster.filter(student => student.id === id || student.dashboardId === id);
  if (/^\d+$/.test(id) && candidates.length !== 1) return null;
  const matches = candidates.filter(student => student.name === name);
  return matches.length === 1 ? matches[0] : null;
}

function saveTeacherClassGoals(request) {
  const { start, end, goals, preview, uploadId } = request || {};
  teacherReportDates_(start, end);
  if (!Array.isArray(goals) || goals.length < 1 || goals.length > 500) {
    return { success: false, error: '파일당 목표를 1~500개 넣어 주세요.' };
  }
  const roster = teacherReportRoster_();
  const seen = new Set();
  const errors = [];
  const entries = [];
  goals.forEach((row, index) => {
    const line = Number.isInteger(row?.line) && row.line > 0 ? row.line : index + 2;
    const student = matchReportStudent_(roster, row);
    const goal = typeof row?.goal === 'string' ? row.goal.trim() : '';
    const { caffeineMax = null, sleepMin = null, bedtime = '', wakeTime = '' } = row || {};
    let error = '';
    if (!student) error = '학번과 이름이 명단에 일치하는 학생 한 명을 찾을 수 없습니다.';
    else if (seen.has(student.dashboardId)) error = '같은 학생의 목표가 파일에 두 번 이상 들어 있습니다.';
    else if (!goal || goal.length > 500) error = '목표를 1~500자로 입력해 주세요.';
    else if ((caffeineMax !== null && (!Number.isFinite(caffeineMax) || caffeineMax < 0 || caffeineMax > 1000))
        || (sleepMin !== null && (!Number.isFinite(sleepMin) || sleepMin <= 0 || sleepMin > 24))
        || (bedtime !== '' && !REPORT_TIME_.test(bedtime)) || (wakeTime !== '' && !REPORT_TIME_.test(wakeTime))) {
      error = '카페인은 0~1000mg, 수면은 0 초과~24시간, 취침·기상 시각은 HH:MM으로 입력해 주세요.';
    }
    if (student) seen.add(student.dashboardId);
    if (error) errors.push({ line, error });
    else entries.push({ id: student.dashboardId, name: student.name, start, end, goal, caffeineMax, sleepMin, bedtime, wakeTime,
      uploadId: typeof uploadId === 'string' && /^[0-9a-f-]{36}$/i.test(uploadId) ? uploadId : '' });
  });
  if (errors.length) return { success: false, errors };
  if (preview !== true) {
    const ss = getSpreadsheet_();
    let sheet = ss.getSheetByName(CLASS_GOALS_SHEET_);
    if (!sheet) {
      sheet = ss.insertSheet(CLASS_GOALS_SHEET_);
      sheet.getRange(1, 1).setValue('goal_json');
    }
    // JSON starts with a literal brace, so arbitrary goal text never becomes a spreadsheet formula.
    const first = sheet.getLastRow() + 1;
    if (entries[0].uploadId && first > 2) {
      const previous = sheet.getRange(2, 1, first - 2, 1).getValues().filter(row => row[0])
        .map(row => JSON.parse(row[0])).filter(row => row.uploadId === entries[0].uploadId);
      if (previous.length) {
        if (JSON.stringify(previous) !== JSON.stringify(entries)) return { success: false, error: '파일을 다시 선택해 주세요.' };
        return { success: true, count: entries.length };
      }
    }
    const needed = first + entries.length - 1 - sheet.getMaxRows();
    if (needed > 0) sheet.insertRowsAfter(sheet.getMaxRows(), needed);
    sheet.getRange(first, 1, entries.length, 1).setValues(entries.map(entry => [JSON.stringify(entry)]));
  }
  return { success: true, count: entries.length };
}

function classGoalFeedback_(goals, days) {
  const applied = [];
  for (const day of days) {
    const goal = goals.find(entry => entry.start <= day.date && day.date <= entry.end);
    if (!goal) continue;
    const last = applied[applied.length - 1];
    if (last?.goal === goal && shiftRecordDate_(last.rows[last.rows.length - 1].date, 1) === day.date) last.rows.push(day);
    else applied.push({ goal, rows: [day] });
  }
  function minutes(time) { return Number(time.slice(0, 2)) * 60 + Number(time.slice(3)); }
  // An early-morning deadline follows the evening on the analysis day.
  function bedtimeDeadline(time) { const value = minutes(time); return value < 720 ? value + 1440 : value; }
  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  const weekday = day => weekdays[new Date(day.date + 'T00:00:00Z').getUTCDay()];
  const present = value => value !== null && value !== undefined && value !== '';
  const mean = records => records.reduce((sum, day) => sum + day.condition, 0) / records.length;
  const score = value => (Math.round(value * 10) / 10).toFixed(1);
  const feeling = value => value >= 3.5 ? '좋음 쪽' : value >= 2.5 ? '보통' : '나쁨 쪽';
  const heavyPhone = day => REPORT_HABITS_.indexOf(day.phone) >= 2;
  return applied.map(({ goal, rows }) => {
    const items = ['목표 · ' + goal.goal];
    const criteria = [];
    if (goal.caffeineMax !== null) criteria.push({ key: 'caffeine', label: '카페인 ' + goal.caffeineMax + 'mg 이하',
      value: day => day.caffeine, passes: value => value <= goal.caffeineMax });
    if (goal.sleepMin !== null) criteria.push({ key: 'sleep', label: '취침·기상 간격 ' + goal.sleepMin + '시간 이상',
      value: day => day.sleep, passes: value => value >= goal.sleepMin });
    if (goal.bedtime) criteria.push({ key: 'bedtime', label: goal.bedtime + '까지 잠자리에 들기',
      value: day => day.bedtime, passes: value => value <= bedtimeDeadline(goal.bedtime) });
    if (goal.wakeTime) criteria.push({ key: 'wake', label: goal.wakeTime + '까지 일어나기',
      value: day => day.wakeTime, passes: value => minutes(value) <= minutes(goal.wakeTime) });
    if (!criteria.length && /폰|휴대전화|화면|유튜브|게임|SNS/i.test(goal.goal)) {
      criteria.push({ key: 'phone', inferred: true, label: '자기 전 스마트폰 30분 미만',
        value: day => day.phone, passes: value => REPORT_HABITS_.indexOf(value) < 2 });
    } else if (!criteria.length && /운동|걷기|걸어|산책|신체활동|스트레칭|줄넘기/.test(goal.goal)) {
      criteria.push({ key: 'activity', inferred: true, label: '신체활동 30분 이상',
        value: day => day.activity, passes: value => REPORT_HABITS_.indexOf(value) >= 2 });
    }
    const results = [];
    for (const criterion of criteria) {
      if (criterion.inferred) items.push('이 목표는 앱 기록 중 가장 가까운 \'' + criterion.label + '\' 응답으로 확인했어요.');
      const measured = rows.filter(day => present(criterion.value(day)));
      if (!measured.length) {
        items.push(criterion.label + ' · 확인할 수 있는 기록이 없어요. 기록이 있어야 지킨 날을 셀 수 있어요.');
        continue;
      }
      const kept = measured.filter(day => criterion.passes(criterion.value(day)));
      const missed = measured.filter(day => !criterion.passes(criterion.value(day)));
      const rate = kept.length / measured.length;
      const cheer = rate >= 0.8 ? '거의 매일 지켰어요. 정말 잘하고 있어요!'
        : rate >= 0.5 ? '절반 이상 지켰어요. 조금만 더 이어 가 봐요.'
        : kept.length ? '아직은 어려운 날이 더 많았어요. 지킨 날이 어떤 날이었는지가 힌트예요.'
        : '아직 지킨 날이 없어요. 목표를 조금 쉽게 바꿔서 시작해도 괜찮아요.';
      items.push(criterion.label + ' · 기록한 ' + measured.length + '일 중 ' + kept.length + '일 지켰어요. ' + cheer);
      let best = 0, run = 0;
      for (const day of rows) {
        const value = criterion.value(day);
        run = present(value) && criterion.passes(value) ? run + 1 : 0;
        best = Math.max(best, run);
      }
      if (best >= 2) items.push(best + '일 연속으로 지킨 적도 있어요.');
      const keptScored = kept.filter(day => day.condition !== null);
      const missedScored = missed.filter(day => day.condition !== null);
      if (keptScored.length >= 2 && missedScored.length >= 2) {
        const keptMean = mean(keptScored), missedMean = mean(missedScored);
        const lead = keptMean - missedMean >= 0.5 ? '목표를 지킨 날 아침 컨디션이 더 좋았어요.'
          : missedMean - keptMean >= 0.5 ? '이번에는 목표를 지킨 날 아침 컨디션이 오히려 낮았어요. 그날 다른 일이 있었는지 떠올려 봐요.'
          : '목표를 지킨 날과 못 지킨 날의 아침 컨디션은 비슷했어요.';
        items.push(lead + ' (지킨 날 ' + keptScored.length + '일: 5점 중 ' + score(keptMean) + '점, ' + feeling(keptMean)
          + ' · 못 지킨 날 ' + missedScored.length + '일: 5점 중 ' + score(missedMean) + '점, ' + feeling(missedMean) + ')');
      }
      if (missed.length >= 2) {
        const counts = new Map();
        missed.forEach(day => counts.set(weekday(day), (counts.get(weekday(day)) || 0) + 1));
        const [day, count] = [...counts].sort((a, b) => b[1] - a[1])[0];
        if (count >= 2) items.push('못 지킨 날 중 ' + count + '일이 ' + day + '요일이었어요. 이 요일에 지키기 쉬운 방법을 따로 정해 봐요.');
        if (criterion.key !== 'phone' && criterion.key !== 'activity') {
          const phone = missed.filter(heavyPhone).length;
          if (phone >= 2) items.push('못 지킨 ' + missed.length + '일 중 ' + phone + '일은 자기 전에 스마트폰을 30분 이상 쓴 날이었어요.');
          const evening = missed.filter(day => day.caffeineTiming === 'evening').length;
          if (evening >= 2) items.push('못 지킨 ' + missed.length + '일 중 ' + evening + '일은 저녁 6시 이후에 카페인을 마신 날이었어요.');
        }
      }
      results.push({ key: criterion.key, label: criterion.label, kept: kept.length, measured: measured.length });
    }
    if (!criteria.length) {
      const caffeine = rows.filter(day => day.caffeine !== null);
      const sleep = rows.filter(day => day.sleep !== null);
      items.push('목표 기간 ' + rows.length + '일 중 카페인을 기록한 날은 ' + caffeine.length + '일, 수면을 기록한 날은 ' + sleep.length + '일이에요.');
      items.push('이 목표는 앱 기록으로 자동으로 셀 수 없어요. 목표를 지킨 날과 어려웠던 날을 하나씩 떠올리고, 두 날의 아침 컨디션을 비교해 보세요.');
    }
    return { title: '내 목표 · ' + rows[0].date + ' ~ ' + rows[rows.length - 1].date, tone: 'goal', icon: '🎯', items,
      goalText: goal.goal, results };
  });
}

function teacherBatchFeedback_(days, limit, thresholds, goals, observations) {
  const caffeineDays = days.filter(day => day.caffeine !== null);
  const sleepDays = days.filter(day => day.sleep !== null);
  const conditionDays = days.filter(day => day.condition !== null);
  const boundary = limit * getTeacherCaffeineThresholds_(thresholds).over / 100;
  const highCaffeine = caffeineDays.filter(day => day.caffeine >= boundary);
  const shortSleep = sleepDays.filter(day => recordSleepCategory_(day.sleep) === '권장보다 짧음');
  const longSleep = sleepDays.filter(day => recordSleepCategory_(day.sleep) === '권장보다 김');
  const inRange = sleepDays.length - shortSleep.length - longSleep.length;
  const held = days.filter(day => day.held).length;
  const unknown = days.filter(day => day.unknown).length;
  const dayLabel = day => day.date.slice(5).replace('-', '.');
  const average = (records, key) => records.reduce((sum, day) => sum + day[key], 0) / records.length;
  const quantity = value => String(Math.round(value * 10) / 10);
  function duration(hours) {
    const minutes = Math.round(hours * 60);
    const remainder = minutes % 60;
    return Math.floor(minutes / 60) + '시간' + (remainder ? ' ' + remainder + '분' : '');
  }
  function metric(label, records, value) {
    return { label, value: records.length ? value() : '기록 없음', detail: '유효 기록 ' + records.length + '/' + days.length + '일' };
  }

  const caffeine = [], sleep = [], habits = [], notes = [], next = [];
  const suggest = (id, text) => next.push({ id, text });
  const zero = caffeineDays.filter(day => day.caffeine === 0).length;
  if (zero) caffeine.push('카페인을 마시지 않은 ' + zero + '일을 0mg으로 남겨, 기록이 빠진 날과 구분할 수 있었어요.');
  if (caffeineDays.length >= 3 && !highCaffeine.length && zero < caffeineDays.length) {
    caffeine.push('카페인 양을 확인할 수 있는 ' + caffeineDays.length + '일 모두 이번 분석 기준인 ' + quantity(boundary) + 'mg보다 낮았어요.');
  }
  if (inRange) sleep.push('주수면을 확인할 수 있는 ' + sleepDays.length + '일 중 ' + inRange + '일은 취침·기상 간격이 8~10시간이었어요.');

  if (highCaffeine.length) {
    const highest = highCaffeine.reduce((peak, day) => day.caffeine > peak.caffeine ? day : peak);
    caffeine.push('카페인을 기록한 ' + caffeineDays.length + '일 중 ' + highCaffeine.length + '일에 이번 분석 기준인 ' + quantity(boundary) + 'mg에 도달했어요. 가장 높은 날은 ' + dayLabel(highest) + ' ' + quantity(highest.caffeine) + 'mg이었어요.');
    suggest('caffeine_high', dayLabel(highest) + '에 마신 음료를 확인해 보세요. 다음에 비슷한 음료를 고를 때 카페인 함량을 비교하거나 양을 줄여 보세요.');
  } else if (caffeineDays.length + unknown < days.length) {
    suggest('caffeine_log', '하루를 마무리할 때 카페인 기록을 한 번 확인해 보세요. 마시지 않은 날은 0mg으로 남겨요.');
  } else if (unknown) {
    suggest('caffeine_label', '함량을 확인하지 못한 음료는 포장이나 메뉴의 카페인 표시를 확인해 기록을 보완해 보세요.');
  }
  const laterCaffeine = caffeineDays.filter(day => day.caffeine > 0 && ['afternoon', 'evening'].includes(day.caffeineTiming));
  if (laterCaffeine.length) {
    const latest = laterCaffeine[laterCaffeine.length - 1];
    const time = latest.caffeineTiming === 'evening' ? '저녁' : '오후';
    caffeine.push('오후나 저녁에 카페인을 마신 기록이 ' + laterCaffeine.length + '일 있어요. 가장 최근은 ' + dayLabel(latest) + ' ' + time + '예요.');
    suggest('caffeine_earlier', '다음에 ' + time + '에 음료를 고를 때 카페인 없는 음료로 한 번 바꿔 보고, 그날 잠자리에 든 시각을 적어 보세요.');
  }
  if (shortSleep.length) {
    const shortest = shortSleep.reduce((min, day) => day.sleep < min.sleep ? day : min);
    sleep.push('취침·기상 간격이 8시간보다 짧은 날은 ' + shortSleep.length + '일이었어요. 가장 짧은 날은 ' + dayLabel(shortest) + ' ' + duration(shortest.sleep) + '이었어요.');
    suggest('sleep_short', '다음 3일 중 하루는 평소보다 15분 일찍 잠자리에 들 준비를 시작해 보세요. 실제로 잠자리에 든 시각과 다음 날 아침 컨디션을 적어 보세요.');
  }
  if (longSleep.length) {
    const longest = longSleep.reduce((max, day) => day.sleep > max.sleep ? day : max);
    sleep.push('취침·기상 간격이 10시간을 넘은 날은 ' + longSleep.length + '일이었어요. 가장 긴 날은 ' + dayLabel(longest) + ' ' + duration(longest.sleep) + '이었어요.');
    if (!shortSleep.length) suggest('sleep_long', dayLabel(longest) + '의 아침 컨디션을 다른 날과 비교해 보고, 그날의 기상 시각이나 중간에 깬 일이 기억나면 함께 적어 보세요.');
  }
  if (unknown) caffeine.push('함량을 확인할 수 없는 카페인 기록 ' + unknown + '일은 평균에서 뺐어요.');
  if (held) sleep.push('기록이 겹치거나 충돌한 주수면 ' + held + '일은 비교에서 뺐어요.');
  if (conditionDays.length) {
    const labels = ['최악', '나쁨', '보통', '좋음', '최고'];
    const counts = labels.map((label, index) => label + ' ' + conditionDays.filter(day => day.condition === index + 1).length + '일');
    sleep.push('기상 후 컨디션 ' + conditionDays.length + '일 · ' + counts.join(' · '));
  }
  const timed = sleepDays.filter(day => day.bedtime !== null && day.wakeTime);
  if (timed.length) {
    const bed = reportAverageClock_(timed.map(day => day.bedtime));
    const wake = reportAverageClock_(timed.map(day => Number(day.wakeTime.slice(0, 2)) * 60 + Number(day.wakeTime.slice(3))));
    if (bed && wake) sleep.push('취침 평균 ' + bed + ' · 기상 평균 ' + wake + ' (시각 기록 ' + timed.length + '일)');
  }
  for (const [key, label, lines] of [
    ['reasons', '섭취 이유', caffeine], ['symptoms', '기록한 불편감', caffeine],
    ['phone', '취침 전 스마트폰', habits], ['activity', '신체활동', habits],
    ['latency', '잠드는 데 걸린 시간', sleep], ['wake', '수면 중 각성', sleep], ['drowsy', '낮 졸림', sleep],
  ]) {
    const value = observations?.[key];
    if (typeof value === 'string' && value.trim()) lines.push(label + ' · ' + value.trim().slice(0, 130));
  }
  const phoneDays = days.filter(day => day.phone !== null);
  const longPhone = phoneDays.filter(day => REPORT_HABITS_.indexOf(day.phone) >= 2);
  if (longPhone.length) {
    suggest('sleep_phone', '자기 전 스마트폰을 30분 이상 쓴 날이 기록한 ' + phoneDays.length + '일 중 ' + longPhone.length + '일이었어요. 오늘은 침대에 들어가기 전에 폰을 충전기에 두고, 평소보다 일찍 잠자리에 들 수 있었는지 살펴봐요.');
  } else if (phoneDays.length) {
    habits.push('스마트폰을 기록한 ' + phoneDays.length + '일 모두 자기 전에는 30분 미만으로 사용했어요. 이 습관을 이어 가 보세요.');
  }
  const activityDays = days.filter(day => day.activity !== null);
  const noActivity = activityDays.filter(day => day.activity === '안 함');
  if (noActivity.length) {
    suggest('sleep_activity', '신체활동을 하지 않은 날이 기록한 ' + activityDays.length + '일 중 ' + noActivity.length + '일이었어요. 점심시간이나 하교 후에 10분 걸어 보고, 그날 잠들기까지 걸린 시간과 다음 날 아침 컨디션을 적어 보세요.');
  }
  if (!caffeineDays.length) caffeine.unshift('이번 기간에 양을 확인할 수 있는 카페인 기록이 없어요.');
  else if (!caffeine.length) caffeine.push('카페인을 기록한 날은 ' + caffeineDays.length + '일이고, 기록한 날의 평균 섭취량은 ' + Math.round(average(caffeineDays, 'caffeine')) + 'mg이에요.');
  if (!sleepDays.length) sleep.unshift('이번 기간에 취침·기상 간격을 확인할 수 있는 주수면 기록이 없어요.');
  if ((caffeineDays.length > 0 && caffeineDays.length < 3) || (sleepDays.length > 0 && sleepDays.length < 3)) {
    notes.push('기록이 적은 항목은 이번에 확인한 날의 관찰로 봐 주세요.');
  }
  if (!sleepDays.length) suggest('sleep_log', '다음에 일어나면 어제 잠자리에 든 시각과 오늘 일어난 시각, 아침 컨디션을 함께 남겨 보세요.');
  else if (!shortSleep.length && !longSleep.length) suggest('sleep_keep', '지금처럼 취침·기상 시각을 기록하고, 아침에 개운했던 날의 생활을 한 가지 떠올려 보세요.');
  const hasData = caffeineDays.length || sleepDays.length || conditionDays.length;
  const goalSections = classGoalFeedback_(goals, days);
  // Start with the student's own goal, then actions based on recorded behavior.
  const goalAdvice = {
    caffeine: /^caffeine_/, sleep: /^sleep_(short|schedule)$/, bedtime: /^sleep_(schedule|short|phone)$/,
    wake: /^sleep_schedule$/, phone: /^sleep_phone$/, activity: /^sleep_activity$/,
  };
  const goalKeys = goalSections.flatMap(section => section.results.map(result => result.key));
  const related = item => goalKeys.some(key => goalAdvice[key].test(item.id));
  if (goalKeys.includes('phone') && !next.some(item => item.id === 'sleep_phone')) suggest('sleep_phone', '잠자리에 들기 전에 스마트폰을 손이 닿지 않는 곳에 두고, 다음 날 아침 컨디션을 기록해 보세요.');
  if (goalKeys.includes('activity') && !next.some(item => item.id === 'sleep_activity')) suggest('sleep_activity', '활동 시간을 정해 실천하고, 그날 밤 취침 시각과 다음 날 아침 컨디션을 기록해 보세요.');
  const adviceRank = item => related(item) ? 0 : /^(caffeine_log|sleep_log|sleep_keep)$/.test(item.id) ? 2 : 1;
  next.sort((a, b) => adviceRank(a) - adviceRank(b));
  const firstGoal = goalSections.find(section => section.results.length);
  const goalLead = firstGoal ? '이번 기간 목표 \'' + firstGoal.goalText + '\'를 '
    + firstGoal.results.map(result => (firstGoal.results.length > 1 ? result.label + ' 기준 ' : '')
      + '기록한 ' + result.measured + '일 중 ' + result.kept + '일').join(', ') + ' 지켰어요. ' : '';
  return {
    summary: goalLead + (!hasData ? '이번 기간에는 비교할 수 있는 유효한 기록이 없어요. 아래 제안 중 하나부터 기록해 봐요.'
      : shortSleep.length ? '수면을 기록한 ' + sleepDays.length + '일 중 ' + shortSleep.length + '일은 취침·기상 간격이 8시간보다 짧았어요. 아래에서 이번 주에 해 볼 행동을 하나 골라 보세요.'
      : highCaffeine.length ? '카페인 기록에서 섭취량이 높았던 날이 있었어요. 어떤 음료를 골랐는지 살펴봐요.'
      : '기록이 있는 날을 모아 봤어요. 아래에서 이어 갈 점과 다음 기록에서 확인할 점을 살펴봐요.'),
    metrics: [
      metric('카페인', caffeineDays, () => Math.round(average(caffeineDays, 'caffeine')) + 'mg'),
      metric('주수면', sleepDays, () => duration(average(sleepDays, 'sleep'))),
      metric('기상 후 컨디션', conditionDays, () => average(conditionDays, 'condition').toFixed(1) + ' / 5점'),
    ],
    sections: [
      ...goalSections.map(({ title, tone, icon, items }) => ({ title, tone, icon, items })),
      { title: '카페인', tone: 'caffeine', icon: '☕', items: caffeine },
      { title: '수면', tone: 'sleep', icon: '🌙', items: sleep },
      { title: '수면에 영향을 줄 수 있는 생활습관', tone: 'habit', icon: '📱', items: habits },
      { title: '실천 제안', tone: 'next', icon: '🧪', items: next.map(item => item.text) },
    ].filter(section => section.items.length),
    note: ['평균은 유효 기록일만 사용해요. 카페인 0mg은 기록에 포함하고, 주수면은 기록된 취침·기상 시각 사이의 간격으로 계산해요.', ...notes, ...(goalSections.length ? [] : ['이 분석 기간에 적용된 수업 목표가 없어 기록을 바탕으로 피드백을 작성했어요.'])].join(' '),
    reference: '식품의약품안전처 카페인 섭취 권고 · 미국수면의학회(AASM) 13~18세 수면 권고(2016)',
  };
}

function reportAverageClock_(minutes) {
  const angles = minutes.map(value => value * 2 * Math.PI / 1440);
  const x = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
  const y = angles.reduce((sum, angle) => sum + Math.sin(angle), 0);
  if (Math.hypot(x, y) < 1e-6) return '';
  const mean = (Math.round(Math.atan2(y, x) * 1440 / (2 * Math.PI)) + 1440) % 1440;
  return String(Math.floor(mean / 60)).padStart(2, '0') + ':' + String(mean % 60).padStart(2, '0');
}

function analyzeTeacherBatch(request) {
  const { start, end, students, thresholds, mode = 'rule' } = request || {};
  const dates = teacherReportDates_(start, end);
  if (!Array.isArray(students) || !students.length || students.length > 30) throw new Error('분석 대상을 다시 선택해 주세요.');
  const roster = teacherReportRoster_();
  if (request.reportVersion === 2) {
    if (request.reportMode !== undefined && !['ongoing', 'final'].includes(request.reportMode)) throw new Error('분석 모드를 확인해 주세요.');
    const source = feedbackSourceRows_();
    const classRows = feedbackClassRows_();
    return { success: true, reports: students.map(entry => {
      const student = matchReportStudent_(roster, entry);
      if (!student) return { studentId: entry?.studentId, error: '명단에서 학번과 이름을 확인해 주세요.' };
      const input = feedbackSourceInput_(source, student, start, end, feedbackClassGoals_(student, classRows),
        { mode: request.reportMode, audience: 'teacher', caffeineLimitMg: Number.isFinite(entry.limit) && entry.limit > 0 ? entry.limit : null });
      const engine = buildFeedbackReport_(input);
      const tones = { record: 'habit', goals: 'goal', transition: 'sleep', findings: 'sleep', similar: 'sleep', why: 'caffeine', action: 'next' };
      const sections = engine.sections.map(section => {
        if (section.id === 'similar') return { ...section, tone: tones.similar };
        const [icon, ...title] = section.title.split(' ');
        return { ...section, title: title.join(' '), icon, tone: tones[section.id] };
      });
      return { studentId: entry.studentId, analysis: feedbackReportText_(engine.sections),
        feedback: { mode: 'rule', aiFallback: mode === 'ai', reportMode: engine.mode, sections, sources: engine.references, engine } };
    }) };
  }
  const sheet = getSpreadsheet_().getSheetByName(CLASS_GOALS_SHEET_);
  const goals = sheet ? sheet.getDataRange().getValues().slice(1).reverse().filter(row => row[0]).map(row => JSON.parse(row[0])) : [];
  const reports = students.map(entry => {
    const student = matchReportStudent_(roster, entry);
    if (!student) return { studentId: entry?.studentId, error: '명단에서 학번과 이름을 확인해 주세요.' };
    if (!Array.isArray(entry.daily) || entry.daily.length !== dates.length
        || !Number.isFinite(entry.limit) || entry.limit <= 0) {
      return { studentId: entry.studentId, error: '학생 기록을 다시 불러와 주세요.' };
    }
    function measured(value, max) { return Number.isFinite(value) && value >= 0 && value <= max ? value : null; }
    const days = dates.map((date, index) => {
      const [mg, hours, score, bed, wake, state, unknown, timing, phone, activity] = Array.isArray(entry.daily[index]) ? entry.daily[index] : [];
      const sleep = measured(hours, Infinity);
      return { date, caffeine: measured(mg, Infinity), sleep,
        condition: Number.isInteger(score) && score >= 1 && score <= 5 ? score : null,
        bedtime: sleep !== null && Number.isInteger(bed) ? bed : null,
        wakeTime: sleep !== null && REPORT_TIME_.test(wake) ? wake : '',
        held: state === 'held', unknown: unknown === true,
        phone: state !== 'held' && REPORT_HABITS_.includes(phone) ? phone : null,
        activity: state !== 'held' && REPORT_HABITS_.includes(activity) ? activity : null,
        caffeineTiming: ['morning', 'afternoon', 'evening'].includes(timing) ? timing : null };
    });
    const feedback = teacherBatchFeedback_(days, entry.limit, thresholds,
      goals.filter(goal => goal.id === student.dashboardId && goal.name === student.name), entry.observations);
    const analysis = [
      feedback.summary,
      feedback.metrics.map(item => item.label + ' 평균 ' + item.value + ' · ' + item.detail).join('\n'),
      ...feedback.sections.map(section => [(section.icon ? section.icon + ' ' : '') + section.title, ...section.items].join('\n')),
      feedback.note, '참고 · ' + feedback.reference,
    ].join('\n\n');
    return { studentId: entry.studentId, analysis, feedback };
  });
  return { success: true, reports };
}

function makeTeacherReportPdf_(request) {
  if (typeof request?.html !== 'string' || !request.html.trim() || request.html.length > 4000000) {
    throw new Error('PDF 내용을 다시 만들어 주세요.');
  }
  const fileName = (String(request.fileName || 'health-report.pdf').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\.pdf$/i, '').slice(0, 180) || 'health-report') + '.pdf';
  const blob = Utilities.newBlob(request.html, 'text/html', 'report.html').getAs(MimeType.PDF).setName(fileName);
  const bytes = blob.getBytes();
  if (bytes.length > REPORT_PDF_LIMIT_) throw new Error('PDF 용량이 큽니다. 출력 기간을 줄여 주세요.');
  return { fileName, blob, bytes };
}

function renderTeacherReportPdf(request) {
  const { fileName, bytes } = makeTeacherReportPdf_(request);
  return { success: true, fileName, pdf: Utilities.base64Encode(bytes) };
}

function sendPrivateTeacherReport(request) {
  const { start, end, deliveryId } = request || {};
  teacherReportDates_(start, end);
  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(deliveryId)) throw new Error('전송 번호가 올바르지 않습니다.');
  const student = matchReportStudent_(teacherReportRoster_(), request);
  if (!student) return { success: false, error: '학번과 이름이 명단과 일치하지 않습니다.' };
  const sheet = ensureTeacherMessageSheet_();
  const prefix = deliveryId + ':';
  const prior = sheet.getDataRange().getValues().slice(1).find(row => row[12] === PRIVATE_PDF_TYPE_ && String(row[11]).startsWith(prefix));
  if (prior) {
    if (!privateReportOwnerMatches_(prior, student.id, student.name)) throw new Error('전송 번호가 이미 사용되었습니다.');
    return { success: true };
  }
  const { fileName, blob } = makeTeacherReportPdf_(request);
  const file = DriveApp.createFile(blob);
  try {
    if (file.getSharingAccess() !== DriveApp.Access.PRIVATE) throw new Error('PDF의 비공개 상태를 확인할 수 없습니다.');
    appendRecordRow_(sheet, [
      Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss'),
      student.id, student.name, '건강 기록 PDF', start + ' ~ ' + end + ' 건강 기록 PDF입니다.',
      '미읽음', '', '', '', '', fileName, prefix + file.getId(), PRIVATE_PDF_TYPE_,
    ]);
  } catch (error) {
    // An append can succeed before its response is lost. Preserve the file if the message exists.
    const rows = sheet.getDataRange().getValues();
    if (rows.some(row => row[11] === prefix + file.getId() && row[12] === PRIVATE_PDF_TYPE_)) return { success: true };
    try { file.setTrashed(true); } catch (_) { /* The file remains private. */ }
    throw error;
  }
  return { success: true };
}

function privateReportOwnerMatches_(row, studentId, name) {
  const id = normalizeOwnerId_(studentId);
  const studentName = String(name || '').trim();
  return !!id && !!studentName && String(row[2]).trim() === studentName
    && makeTeacherUniqueId(normalizeOwnerId_(row[1]), studentName) === makeTeacherUniqueId(id, studentName);
}

function readPrivateTeacherPdf_(messageKey, subject) {
  const missing = { success: false, code: 'REPORT_NOT_FOUND' };
  if (!/^[a-f0-9]{64}$/.test(messageKey)) return missing;
  const sheet = getSpreadsheet_().getSheetByName('teacher_messages');
  if (!sheet) return missing;
  const matches = sheet.getDataRange().getValues().slice(1).filter(row =>
    row[12] === PRIVATE_PDF_TYPE_ && (!subject || privateReportOwnerMatches_(row, subject.studentId, subject.name))
    && teacherMessageKey_(row) === messageKey);
  if (matches.length !== 1) return missing;
  const row = matches[0];
  const fileId = String(row[11]).split(':')[1];
  if (!/^[\w-]+$/.test(fileId || '')) return missing;
  const bytes = DriveApp.getFileById(fileId).getBlob().getBytes();
  if (bytes.length > REPORT_PDF_LIMIT_) return missing;
  return { success: true, fileName: String(row[10]), pdf: Utilities.base64Encode(bytes) };
}

function downloadStudentReportPdf(studentId, name, messageKey) {
  return readPrivateTeacherPdf_(messageKey, { studentId, name });
}

function downloadTeacherReportPdf(messageKey) {
  return readPrivateTeacherPdf_(messageKey, null);
}

// ===== apps-script/Api.gs =====
var STUDENT_ACTIONS_ = {
  saveCaffeineData: 'identityPayload', getCaffeineLogs: 'identityFirst',
  deleteCaffeineData: 'caffeineRecord', updateCaffeineData: 'caffeinePayload',
  saveSleepData: 'identityPayload', getSleepLogs: 'identityFirst',
  deleteSleepData: 'sleepRecord', updateSleepData: 'sleepPayload',
  getWeightData: 'identityFirst', saveInitialSetup: 'identityPayload',
  getStats: 'identityFirst', getStudentBootstrap: 'identityFirst', getFilteredStats: 'identityFirst',
  getTeacherAwardsForStudent: 'identityFirst', markTeacherAwardsSeen: 'identityPair',
  claimBadgeCelebrations: 'identityPair',
  submitInquiry: 'identityPayload', getMyInquiries: 'identityFirst',
  markInquiryRepliesSeen: 'identityPair',
  getCaffeineDB: 'passthrough', testConnection: 'passthrough',
  generateAIHealthReport: 'identityPair', analyzeDrinkImageWithAI: 'passthrough',
  getTeacherMessages: 'identityFirst', markTeacherMessageRead: 'messageRow',
  downloadStudentReportPdf: 'identityPair',
  replyToTeacherMessage: 'messageRow', getBadgeConfig: 'passthrough',
  getChallengeBadgeConfig: 'passthrough', getSleepSettings: 'passthrough'
  , savePushSubscription: 'pushSubscription', getPushPreferences: 'subscriptionOwned'
  , savePushPreferences: 'subscriptionOwned', deactivatePushSubscription: 'subscriptionOwned'
  , getReminderStudentConfig: 'passthrough'
};

var TEACHER_ACTIONS_ = {
  saveTeacherClassGoals: true, analyzeTeacherBatch: true, renderTeacherReportPdf: true,
  sendPrivateTeacherReport: true, downloadTeacherReportPdf: true,
  updateTeacherHiddenStudents: true,
  getTeacherData: true, handleAIReportForTeacher: true, grantTeacherAwards: true,
  revokeTeacherAward: true, getInquiries: true, replyToInquiry: true,
  deleteInquiry: true, getUnreadInquiries: true, markInquiryNotified: true,
  exportDataToNewSheet: true, sendTeacherMessage: true,
  saveTeacherPdfAndSendMessage: true, getSentTeacherMessages: true,
  deleteTeacherMessage: true, deleteBulkTeacherMessages: true,
  getUnreadStudentReplies: true, markStudentReplyRead: true,
  saveBadgeConfig: true, getChallengeBadgeConfig: true,
  saveChallengeBadgeConfig: true, getPendingBadges: true,
  savePendingBadgesData: true, getDismissedBadges: true,
  saveDismissedBadgesData: true, getAwardSettings: true,
  saveAwardSettingsData: true, saveAIReport: true, getAIReport: true,
  saveSleepSettings: true, getReminderAdminConfig: true, saveReminderAdminConfig: true,
  saveTeacherTestSubscription: true, deactivateTeacherTestSubscription: true,
  getTestStudentReminderStatus: true, getTestStudentReminderTargets: true,
  recordTestStudentReminderResults: true
};

var SCHEDULER_ACTIONS_ = {
  getReminderDispatchSnapshot: true,
  claimReminderDeliveries: true,
  recordReminderDeliveryResults: true
};

var STUDENT_MUTATIONS_ = {
  saveCaffeineData: true, deleteCaffeineData: true, updateCaffeineData: true,
  saveSleepData: true, deleteSleepData: true, updateSleepData: true,
  saveInitialSetup: true, markTeacherAwardsSeen: true, claimBadgeCelebrations: true, submitInquiry: true,
  markInquiryRepliesSeen: true,
  markTeacherMessageRead: true, replyToTeacherMessage: true
};

var TEACHER_MUTATIONS_ = {
  saveTeacherClassGoals: true, sendPrivateTeacherReport: true,
  updateTeacherHiddenStudents: true,
  grantTeacherAwards: true, revokeTeacherAward: true, replyToInquiry: true,
  deleteInquiry: true, markInquiryNotified: true, exportDataToNewSheet: true,
  sendTeacherMessage: true, saveTeacherPdfAndSendMessage: true,
  deleteTeacherMessage: true, deleteBulkTeacherMessages: true,
  markStudentReplyRead: true, saveBadgeConfig: true, saveChallengeBadgeConfig: true,
  savePendingBadgesData: true, saveDismissedBadgesData: true,
  saveAwardSettingsData: true, saveAIReport: true, saveSleepSettings: true,
  recordTestStudentReminderResults: true
};

function normalizeCaffeineTime_(value) {
  if (value === null || value === undefined || value === '') return '';
  var match = String(value).trim().match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match) throw new Error('REQUEST_REJECTED');
  var year = Number(match[1]);
  var month = Number(match[2]);
  var day = Number(match[3]);
  var hour = Number(match[4]);
  var minute = Number(match[5]);
  var second = Number(match[6] || '0');
  var date = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day
      || date.getUTCHours() !== hour || date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new Error('REQUEST_REJECTED');
  }
  function two(number) { return String(number).padStart(2, '0'); }
  return String(year).padStart(4, '0') + '-' + two(month) + '-' + two(day)
    + ' ' + two(hour) + ':' + two(minute) + ':' + two(second);
}

function jsonOutput_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return jsonOutput_({ success: true, service: 'caffeine-sleep-api' });
}

function doPost(e) {
  var diagnostic = { stage: 'decode' };
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') throw new Error('REQUEST_REJECTED');
    var request = JSON.parse(e.postData.contents);
    var result = handleApiRequest_(request, diagnostic);
    return jsonOutput_({ success: true, data: result });
  } catch (error) {
    // Only fixed categories leave this boundary; exception text may contain PII.
    var message = String(error && error.message || '');
    diagnostic.kind = message === 'REQUEST_REJECTED' ? 'rejected'
      : /quota|rate limit|too many times|resource.exhausted/i.test(message) ? 'rate_limit'
      : /service unavailable|temporarily unavailable|internal error|timed?\s*out|timeout/i.test(message) ? 'service_unavailable'
      : 'unexpected';
    try { Logger.log('API request rejected ' + JSON.stringify(diagnostic)); } catch (_logError) {}
    return jsonOutput_({ success: false, error: 'REQUEST_REJECTED', diagnostic: diagnostic });
  }
}

function handleApiRequest_(request, diagnostic) {
  diagnostic = diagnostic || {};
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('REQUEST_REJECTED');
  diagnostic.stage = 'authorization';
  verifyGatewaySecret_(request.secret);
  diagnostic.stage = 'dispatch';
  if (typeof request.action !== 'string' || !Array.isArray(request.params)) throw new Error('REQUEST_REJECTED');
  if (request.role === 'public') {
    if (request.action !== 'checkLogin') throw new Error('REQUEST_REJECTED');
    return invokeAction_(request.action, request.params);
  }
  if (request.role === 'health') {
    if (request.action !== 'testConnection') throw new Error('REQUEST_REJECTED');
    return invokeAction_(request.action, []);
  }
  if (request.role === 'student') {
    return dispatchStudentAction_(request.action, request.params, requireSubject_(request.subject), diagnostic);
  }
  if (request.role === 'teacher') return dispatchTeacherAction_(request.action, request.params);
  if (request.role === 'scheduler') return dispatchSchedulerAction_(request.action, request.params);
  throw new Error('REQUEST_REJECTED');
}

function validateGoalPayload_(payload) {
  var time = /^([01]\d|2[0-3]):[0-5]\d$/;
  if (!Number.isFinite(payload.weight) || payload.weight <= 0 || payload.weight > 200
      || !Number.isInteger(payload.targetCaf) || payload.targetCaf < 1 || payload.targetCaf > 1000
      || !time.test(payload.targetBedtime) || !time.test(payload.targetWakeTime)) throw new Error('REQUEST_REJECTED');
  if (payload.confirmedGoals !== undefined && (!Array.isArray(payload.confirmedGoals) || payload.confirmedGoals.length > 3
      || !payload.confirmedGoals.every(key => ['caffeineMax', 'bedtime', 'wakeTime'].includes(key)))) throw new Error('REQUEST_REJECTED');
}

function dispatchStudentAction_(action, params, subject, diagnostic) {
  diagnostic = diagnostic || {};
  var rule = STUDENT_ACTIONS_[action];
  if (!rule) throw new Error('REQUEST_REJECTED');
  var safeParams = params.slice();
  if (rule === 'identityFirst') safeParams[0] = subject.studentId;
  if (action === 'getTeacherMessages') safeParams[1] = subject.name;
  if (rule === 'identityPair') { safeParams[0] = subject.studentId; safeParams[1] = subject.name; }
  if (rule === 'identityPayload' || rule === 'caffeinePayload' || rule === 'sleepPayload') {
    if (!safeParams[0] || typeof safeParams[0] !== 'object' || Array.isArray(safeParams[0])) throw new Error('REQUEST_REJECTED');
    safeParams[0] = Object.assign({}, safeParams[0], { studentId: subject.studentId, name: subject.name });
  }
  if (rule === 'pushSubscription') {
    if (!safeParams[0] || typeof safeParams[0] !== 'object' || Array.isArray(safeParams[0])) throw new Error('REQUEST_REJECTED');
    safeParams[0] = Object.assign({}, safeParams[0], { role: 'student', studentId: subject.studentId });
    delete safeParams[0].name;
  }
  if (action === 'saveInitialSetup') validateGoalPayload_(safeParams[0]);
  if (rule === 'subscriptionOwned') {
    safeParams = action === 'savePushPreferences'
      ? [safeParams[0], subject, safeParams[1]]
      : [safeParams[0], subject];
  }
  if (action === 'saveCaffeineData' || action === 'updateCaffeineData') {
    safeParams[0].time = normalizeCaffeineTime_(safeParams[0].time);
    if (action === 'saveCaffeineData') {
      safeParams[0].company = String(safeParams[0].company || '').trim().slice(0, 120);
      safeParams[0].foodName = String(safeParams[0].foodName || '').trim().slice(0, 240);
    }
  }
  if (action === 'saveCaffeineData') safeParams[0].id = Utilities.getUuid();
  if (action === 'saveSleepData') {
    var clientRequestId = safeParams[0].id;
    if (!safeParams[0]._sync && (clientRequestId === undefined || clientRequestId === null || String(clientRequestId) === '')) return {success:false,error:'SLEEP_REQUEST_ID_REQUIRED'};
    safeParams[0].id = safeParams[0]._sync ? Utilities.getUuid()
      : 'sleep_' + syncHash_([subject.studentId, subject.name, String(clientRequestId)]);
  }
  var execute = function(syncConfirmation) {
    if (rule === 'caffeineRecord') requireOwnedRecord_('caffeine', safeParams[0], subject);
    if (rule === 'sleepRecord') requireOwnedRecord_('sleep', safeParams[0], subject);
    if (rule === 'caffeinePayload') requireOwnedRecord_('caffeine', safeParams[0].id, subject);
    if (rule === 'sleepPayload') requireOwnedRecord_('sleep', safeParams[0].id, subject);
    if (rule === 'messageRow') {
      var messageKey = safeParams[action === 'replyToTeacherMessage' ? 2 : 1];
      var messageSheet = getSpreadsheet_().getSheetByName('teacher_messages');
      var messageRow = resolveTeacherMessageRow_(messageSheet, safeParams[0], messageKey);
      if (!messageRow) return messageTargetChanged_();
      safeParams[0] = messageRow;
      requireOwnedRow_('teacher_messages', messageRow, subject);
    }
    var result = action === 'saveSleepData' && syncConfirmation ? saveSleepData(safeParams[0], syncConfirmation) : invokeAction_(action, safeParams);
    if (action === 'saveCaffeineData' && result && result.success === true) {
      var saved = safeParams[0];
      result.record = { id: saved.id, name: saved.drink, company: saved.company || '', foodName: saved.foodName || '', amount: Number(saved.mg), time: saved.time, reason: saved.reason || '', symptom: saved.symptom || '' };
    }
    return result;
  };
  var synced = ['saveCaffeineData','saveSleepData','saveInitialSetup'].indexOf(action) >= 0 && safeParams[0] && safeParams[0]._sync;
  var operation = synced ? function() { return runSyncedMutation_(action, safeParams[0], subject, execute); } : execute;
  diagnostic.stage = 'student_operation';
  var result = STUDENT_MUTATIONS_[action] ? withScriptLock_(operation) : operation();
  diagnostic.stage = 'profile_sync';
  if (action === 'getWeightData' && result) result.syncVersion = syncProfileState_(subject).version;
  if (action === 'getStudentBootstrap' && result && result.weight) result.weight.syncVersion = syncProfileState_(subject).version;
  return result;
}

function dispatchTeacherAction_(action, params) {
  if (!TEACHER_ACTIONS_[action]) throw new Error('REQUEST_REJECTED');
  var safeParams = params.slice();
  var execute = function() { return invokeAction_(action, safeParams); };
  return TEACHER_MUTATIONS_[action] ? withScriptLock_(execute) : execute();
}

function dispatchSchedulerAction_(action, params) {
  if (!SCHEDULER_ACTIONS_[action]) throw new Error('REQUEST_REJECTED');
  return invokeAction_(action, params.slice());
}

function invokeAction_(action, params) {
  switch (action) {
    case 'saveTeacherClassGoals': return saveTeacherClassGoals(params[0]);
    case 'analyzeTeacherBatch': return analyzeTeacherBatch(params[0]);
    case 'renderTeacherReportPdf': return renderTeacherReportPdf(params[0]);
    case 'sendPrivateTeacherReport': return sendPrivateTeacherReport(params[0]);
    case 'downloadStudentReportPdf': return downloadStudentReportPdf(params[0], params[1], params[2]);
    case 'downloadTeacherReportPdf': return downloadTeacherReportPdf(params[0]);
    case 'getTeacherHiddenStudents': return getTeacherHiddenStudents();
    case 'updateTeacherHiddenStudents': return updateTeacherHiddenStudents.apply(null, params);
    case 'checkLogin': return checkLogin.apply(null, params);
    case 'saveCaffeineData': return saveCaffeineData.apply(null, params);
    case 'getCaffeineLogs': return getCaffeineLogs.apply(null, params);
    case 'deleteCaffeineData': return deleteCaffeineData.apply(null, params);
    case 'updateCaffeineData': return updateCaffeineData.apply(null, params);
    case 'saveSleepData': return saveSleepData.apply(null, params);
    case 'getSleepLogs': return getSleepLogs.apply(null, params);
    case 'deleteSleepData': return deleteSleepData.apply(null, params);
    case 'updateSleepData': return updateSleepData.apply(null, params);
    case 'getWeightData': return getWeightData.apply(null, params);
    case 'saveInitialSetup': return saveInitialSetup.apply(null, params);
    case 'getStats': return getStats.apply(null, params);
    case 'getStudentBootstrap': return getStudentBootstrap.apply(null, params);
    case 'getFilteredStats': return getFilteredStats.apply(null, params);
    case 'getTeacherAwardsForStudent': return getTeacherAwardsForStudent.apply(null, params);
    case 'markTeacherAwardsSeen': return markTeacherAwardsSeen.apply(null, params);
    case 'claimBadgeCelebrations': return claimBadgeCelebrations.apply(null, params);
    case 'submitInquiry': return submitInquiry.apply(null, params);
    case 'getMyInquiries': return getMyInquiries.apply(null, params);
    case 'getCaffeineDB': return getCaffeineDB.apply(null, params);
    case 'testConnection': return testConnection.apply(null, params);
    case 'generateAIHealthReport': return generateAIHealthReport.apply(null, params);
    case 'analyzeDrinkImageWithAI': return analyzeDrinkImageWithAI.apply(null, params);
    case 'getTeacherMessages': return getTeacherMessages.apply(null, params);
    case 'markTeacherMessageRead': return markTeacherMessageRead.apply(null, params);
    case 'replyToTeacherMessage': return replyToTeacherMessage.apply(null, params);
    case 'getBadgeConfig': return getBadgeConfig.apply(null, params);
    case 'getChallengeBadgeConfig': return getChallengeBadgeConfig.apply(null, params);
    case 'getSleepSettings': return getSleepSettings.apply(null, params);
    case 'savePushSubscription': return upsertPushSubscription_.apply(null, params);
    case 'getPushPreferences': return getPushPreferences_.apply(null, params);
    case 'savePushPreferences': return setPushPreferences_.apply(null, params);
    case 'deactivatePushSubscription': return deactivatePushSubscription_.apply(null, params);
    case 'getReminderStudentConfig': return getReminderStudentConfig_.apply(null, params);
    case 'getTeacherData': return getTeacherData.apply(null, params);
    case 'handleAIReportForTeacher': return handleAIReportForTeacher.apply(null, params);
    case 'grantTeacherAwards': return grantTeacherAwards.apply(null, params);
    case 'revokeTeacherAward': return revokeTeacherAward.apply(null, params);
    case 'getInquiries': return getInquiries.apply(null, params);
    case 'replyToInquiry': return replyToInquiry.apply(null, params);
    case 'deleteInquiry': return deleteInquiry.apply(null, params);
    case 'getUnreadInquiries': return getUnreadInquiries.apply(null, params);
    case 'markInquiryNotified': return markInquiryNotified.apply(null, params);
    case 'markInquiryRepliesSeen': return markInquiryRepliesSeen.apply(null, params);
    case 'exportDataToNewSheet': return exportDataToNewSheet.apply(null, params);
    case 'sendTeacherMessage': return sendTeacherMessage.apply(null, params);
    case 'saveTeacherPdfAndSendMessage': return saveTeacherPdfAndSendMessage.apply(null, params);
    case 'getSentTeacherMessages': return getSentTeacherMessages.apply(null, params);
    case 'deleteTeacherMessage': return deleteTeacherMessage.apply(null, params);
    case 'deleteBulkTeacherMessages': return deleteBulkTeacherMessages.apply(null, params);
    case 'getUnreadStudentReplies': return getUnreadStudentReplies.apply(null, params);
    case 'markStudentReplyRead': return markStudentReplyRead.apply(null, params);
    case 'saveBadgeConfig': return saveBadgeConfig.apply(null, params);
    case 'saveChallengeBadgeConfig': return saveChallengeBadgeConfig.apply(null, params);
    case 'getPendingBadges': return getPendingBadges.apply(null, params);
    case 'savePendingBadgesData': return savePendingBadgesData.apply(null, params);
    case 'getDismissedBadges': return getDismissedBadges.apply(null, params);
    case 'saveDismissedBadgesData': return saveDismissedBadgesData.apply(null, params);
    case 'getAwardSettings': return getAwardSettings.apply(null, params);
    case 'saveAwardSettingsData': return saveAwardSettingsData.apply(null, params);
    case 'saveAIReport': return saveAIReport.apply(null, params);
    case 'getAIReport': return getAIReport.apply(null, params);
    case 'saveSleepSettings': return saveSleepSettings.apply(null, params);
    case 'getReminderAdminConfig': return getReminderAdminConfig_.apply(null, params);
    case 'saveReminderAdminConfig': return saveReminderAdminConfig_.apply(null, params);
    case 'saveTeacherTestSubscription': return saveTeacherTestSubscription_.apply(null, params);
    case 'deactivateTeacherTestSubscription': return deactivateTeacherTestSubscription_.apply(null, params);
    case 'getTestStudentReminderStatus': return getTestStudentReminderStatus_.apply(null, params);
    case 'getTestStudentReminderTargets': return getTestStudentReminderTargets_.apply(null, params);
    case 'recordTestStudentReminderResults': return recordTestStudentReminderResults_.apply(null, params);
    case 'getReminderDispatchSnapshot': return getReminderDispatchSnapshot_.apply(null, params);
    case 'claimReminderDeliveries': return claimReminderDeliveries_.apply(null, params);
    case 'recordReminderDeliveryResults': return recordReminderDeliveryResults_.apply(null, params);
  }
  throw new Error('REQUEST_REJECTED');
}

// Teacher-only analysis exclusions; research sheets and student access remain intact.
function getTeacherHiddenStudents(){
  var raw=PropertiesService.getScriptProperties().getProperty('TEACHER_HIDDEN_STUDENTS');
  var ids=raw?JSON.parse(raw):[];
  if(!Array.isArray(ids))throw new Error('REQUEST_REJECTED');
  return {success:true,hiddenStudentIds:ids};
}
function updateTeacherHiddenStudents(ids,hidden){
  if(!Array.isArray(ids)||ids.length>500||typeof hidden!=='boolean')throw new Error('REQUEST_REJECTED');
  var clean=ids.map(function(id){
    if(typeof id!=='string'||!id||id.length>100||/[<>\x00-\x1f]/.test(id))throw new Error('REQUEST_REJECTED');
    return id;
  });
  var current=getTeacherHiddenStudents().hiddenStudentIds;
  clean.forEach(function(id){
    var index=current.indexOf(id);
    if(hidden&&index<0)current.push(id);
    if(!hidden&&index>=0)current.splice(index,1);
  });
  var encoded=JSON.stringify(current);
  if(encoded.length>8000)throw new Error('REQUEST_REJECTED');
  PropertiesService.getScriptProperties().setProperty('TEACHER_HIDDEN_STUDENTS',encoded);
  return {success:true,hiddenStudentIds:current};
}

// ===== apps-script/Code.gs =====
/**
 * 카페인 모니터링 시스템 - Google Apps Script 백엔드
 */

// Students 시트 자동 학번 생성
// Identifying example omitted from the archived source.
function onEdit(e) {
  try {
    const sheet = e.source.getActiveSheet();
    const sheetName = sheet.getName();

    // students 시트에서만 동작
    if (sheetName !== 'students') return;

    const range = e.range;
    const row = range.getRow();

    // 헤더 행은 제외
    if (row === 1) return;

    // 편집된 컬럼이 A(학년), B(반), C(번호) 중 하나인 경우
    const col = range.getColumn();
    if (col >= 1 && col <= 3) {
      const gradeCell = sheet.getRange(row, 1); // A: 학년
      const classCell = sheet.getRange(row, 2); // B: 반
      const numberCell = sheet.getRange(row, 3); // C: 번호
      const idCell = sheet.getRange(row, 5);    // E: 학번 ID

      const grade = gradeCell.getValue();
      const classNum = classCell.getValue();
      const number = numberCell.getValue();

      // 모든 값이 입력되었는지 확인
      if (grade && classNum && number) {
        // 학번 생성: 학년(1자리) + 반(1자리) + 번호(2자리)
        const studentId = String(grade) + String(classNum) + String(number).padStart(2, '0');
        idCell.setValue(Number(studentId));

        safeLog_(`자동 학번 생성: ${row}행 - ${studentId}`);
      }
    }
  } catch (error) {
    safeLog_('onEdit 오류: ' + error);
  }
}

// 학번 분석 함수
function parseStudentId(studentId) {
  const str = normalizeId(studentId);
  if (str.length === 4) {
    return {
      grade: str.charAt(0),
      class: str.charAt(1),
      number: str.substring(2)
    };
  }
  return { grade: "-", class: "-", number: "-" };
}

// Identifying example omitted from the archived source.
function normalizeId(val) {
  if (val === null || val === undefined || val === '') return '';
  if (typeof val === 'number') return String(Math.round(val)).trim();
  return String(val).replace(/\.0+$/, '').trim();
}

// KST 시간 포맷 함수
function getKSTTimestamp() {
  const now = new Date();
  return Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
}

// KST 날짜만 포맷
function getKSTDate() {
  const now = new Date();
  return Utilities.formatDate(now, "Asia/Seoul", "yyyy-MM-dd");
}

// 로그인 확인
// Students 시트 구조: A:학년, B:반, C:번호, D:이름, E:학번ID
function checkLogin(studentId, name) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("students");

    if (!sheet) {
      safeLog_('❌ students 시트를 찾을 수 없음');
      return { success: false, message: "학생 명단 시트를 찾을 수 없습니다." };
    }

    const lastRow = sheet.getLastRow();
    const data = lastRow > 1 ? sheet.getRange(2, 4, lastRow - 1, 2).getValues() : [];
    const inputId = normalizeId(studentId);
    const inputName = String(name).trim();
    for (let i = 0; i < data.length; i++) {
      // Identifying example omitted from the archived source.
      const rowId   = normalizeId(data[i][1]);  // E열: 학번
      const rowName = String(data[i][0]).trim(); // D열: 이름

      if (rowId === inputId && rowName === inputName) {
        safeLog_('✅ 로그인 성공: ' + i + '행에서 일치');
        // 비수치 학번(교직원·교생)은 "학번_이름" 복합키로 고유화
        const uniqueId = /^\d+$/.test(inputId) ? inputId : inputId + '_' + name.trim();
        return {
          success: true,
          studentId: uniqueId,
          name: name
        };
      }
    }

    safeLog_('❌ 일치하는 데이터 없음');
    return { success: false, message: "등록되지 않은 정보입니다. 학번과 이름을 다시 확인해주세요." };
  } catch (error) {
    safeLog_('❌ 로그인 오류: ' + error);
    return { success: false, message: "오류가 발생했습니다: " + error.message };
  }
}

// 카페인 데이터 저장
// 컬럼: A:타임스탬프, B:학년, C:반, D:번호, E:전체학번, F:성명, G:음료명, H:함량, I:섭취시간, J:고유ID, K:섭취이유
function saveCaffeineData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      throw new Error("카페인 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));

    // 섭취 시간 처리
    let intakeTime = payload.time || kstTimestamp;
    if (intakeTime.includes('T')) {
      const dt = new Date(intakeTime);
      intakeTime = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    }

    appendRecordRow_(sheet, [
      kstTimestamp,      // A: 타임스탬프 (기록 시간)
      p.grade,           // B: 학년
      p.class,           // C: 반
      p.number,          // D: 번호
      normalizeId(payload.studentId), // E: 전체학번
      payload.name,      // F: 성명
      payload.drink,     // G: 음료명
      payload.mg,        // H: 함량
      intakeTime,        // I: 섭취시간
      payload.id || '',      // J: 고유ID
      payload.reason || '',  // K: 섭취이유
      payload.symptom || '', // L: 부작용 경험
      '',                    // M: 연구대상자코드 (기존 수식 유지)
      String(payload.company || '').trim().slice(0, 120), // N: 업체명
      String(payload.foodName || '').trim().slice(0, 240) // O: 원본 식품명
    ]);

    return { success: true };
  } catch (error) {
    safeLog_('카페인 저장 오류: ' + error);
    throw error;
  }
}

// 수면 데이터 저장 (중복 날짜 처리)
// 컬럼: A:타임스탬프, B:학년, C:반, D:번호, E:전체학번, F:성명, G:날짜, H:취침, I:기상, J:시간, K:컨디션, L:메모, M:고유ID
function getWakeDateFromSleepPayload(payload) {
  const sleepDate = String(payload && payload.date || '').substring(0, 10);
  const sleepTime = String(payload && payload.sleepTime || '').substring(0, 5);
  const wakeTime = String(payload && payload.wakeTime || '').substring(0, 5);
  if (!sleepDate) return '';
  if (!sleepTime || !wakeTime || wakeTime > sleepTime) return sleepDate;
  const parts = sleepDate.split('-').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return sleepDate;
  const d = new Date(parts[0], parts[1] - 1, parts[2]);
  d.setDate(d.getDate() + 1);
  return Utilities.formatDate(d, 'Asia/Seoul', 'yyyy-MM-dd');
}

function saveSleepData(payload, syncConfirmation) {
  return savePreservedSleep_(payload, syncConfirmation);
}

function saveWeightData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("info");

    if (!sheet) {
      throw new Error("info 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));

    // 기존 데이터 확인
    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === normalizeId(payload.studentId)) {
        rowIndex = i + 1; // 시트 행 번호 (1-based)
        break;
      }
    }

    if (rowIndex > 0) {
      // 기존 데이터 업데이트
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);
      sheet.getRange(rowIndex, 7).setValue(payload.weight);
    } else {
      // 새 데이터 추가
      appendRecordRow_(sheet, [
        kstTimestamp,      // A: 타임스탬프
        p.grade,           // B: 학년
        p.class,           // C: 반
        p.number,          // D: 번호
        payload.name,      // E: 성명
        normalizeId(payload.studentId), // F: 전체학번
        payload.weight     // G: 몸무게
      ]);
    }

    return { success: true };
  } catch (error) {
    safeLog_('체중 저장 오류: ' + error);
    throw error;
  }
}

function toProfileHHMM_(value) {
  if (value === '' || value === null || value === undefined) return '';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : Utilities.formatDate(value, 'Asia/Seoul', 'HH:mm');
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1) {
    var minutes = Math.round(value * 1440) % 1440;
    return String(Math.floor(minutes / 60)).padStart(2, '0') + ':' + String(minutes % 60).padStart(2, '0');
  }
  var match = String(value).trim().match(/^(\d{1,2}):([0-5]\d)(?::[0-5]\d)?$/);
  return match && Number(match[1]) < 24 ? match[1].padStart(2, '0') + ':' + match[2] : '';
}

// 체중 데이터 조회
const CONFIRMED_GOAL_FIELDS_ = [['caffeineMax', 'targetCaf'], ['bedtime', 'targetBedtime'], ['wakeTime', 'targetWakeTime']];

function readConfirmedGoals_(stored, values) {
  let saved;
  try { saved = JSON.parse(stored); } catch (_) { return {}; }
  if (!saved || typeof saved !== 'object') return {};
  return Object.fromEntries(CONFIRMED_GOAL_FIELDS_.flatMap(([id], i) =>
    values[i] != null && values[i] !== '' && saved[id] === values[i] ? [[id, values[i]]] : []));
}

function confirmedGoalValue_(payload) {
  return JSON.stringify(Object.fromEntries(CONFIRMED_GOAL_FIELDS_.flatMap(([id, key]) =>
    payload.confirmedGoals.includes(id) ? [[id, payload[key]]] : [])));
}

function getWeightData(studentId, strictRead) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("info");

    if (!sheet) {
      if (strictRead) throw new Error('BOOTSTRAP_SHEET_MISSING');
      safeLog_('info 시트를 찾을 수 없습니다');
      return { success: false, weight: null };
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      safeLog_('info 데이터가 없습니다');
      return { success: false, weight: null };
    }

    // F열(6)~K열(11): 학번, 몸무게, 목표카페인, 목표취침, 목표기상, 연령대
    const range = sheet.getRange(2, 6, lastRow - 1, 7);
    const data = range.getValues();

    for (let i = 0; i < data.length; i++) {
      if (String(data[i][0]).trim() === normalizeId(studentId)) {
        const weight = parseFloat(data[i][1]);
        if (weight && weight > 0) {
          safeLog_(`초기설정 조회 성공: ${studentId} = ${weight}kg`);
          return {
            success: true,
            weight: weight,
            targetCaf:     data[i][2] ? parseInt(data[i][2])    : null,
            targetBedtime: toProfileHHMM_(data[i][3]) || null,
            targetWakeTime: toProfileHHMM_(data[i][4]) || null,
            ageGroup:      data[i][5] ? String(data[i][5]).trim() : 'teen',
            confirmedGoals: Object.keys(readConfirmedGoals_(data[i][6], [
              recordNumber_(data[i][2]), toProfileHHMM_(data[i][3]), toProfileHHMM_(data[i][4])
            ])),
          };
        }
      }
    }

    safeLog_(`초기설정 정보 없음: ${studentId}`);
    return { success: false, weight: null };
  } catch (error) {
    if (strictRead) throw error;
    safeLog_('체중 조회 오류: ' + error);
    return { success: false, weight: null };
  }
}

// 학생 앱 재실행 시 필요한 초기 데이터를 한 번의 게이트웨이 요청으로 조회
function getStudentBootstrap(studentId) {
  return {
    weight: getWeightData(studentId, true),
    stats: getStats(studentId, true),
    caffeineLogs: getCaffeineLogs(studentId, null, null, true),
    sleepLogs: getSleepLogs(studentId, null, null, true),
    sleepPolicyVersion: SleepRecordPolicy.version,
    sleepSettings: getSleepSettings(true)
  };
}

// 초기 설정 저장 (체중 + 목표 카페인 + 목표 취침/기상시간)
function saveInitialSetup(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("info");
    if (!sheet) throw new Error("info 시트를 찾을 수 없습니다.");

    const kstTimestamp = getKSTTimestamp();
    const p = parseStudentId(normalizeId(payload.studentId));
    const normId = normalizeId(payload.studentId);

    const data = sheet.getDataRange().getValues();
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][5]).trim() === normId) { rowIndex = i + 1; break; }
    }

    if (rowIndex > 0) {
      // 기존 행 업데이트
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);        // A: 타임스탬프
      sheet.getRange(rowIndex, 7).setValue(payload.weight);      // G: 몸무게
      sheet.getRange(rowIndex, 8).setValue(payload.targetCaf || '');   // H: 목표카페인
      sheet.getRange(rowIndex, 9).setValue(payload.targetBedtime || ''); // I: 목표취침
      sheet.getRange(rowIndex, 10).setValue(payload.targetWakeTime || ''); // J: 목표기상
      sheet.getRange(rowIndex, 11).setValue(payload.ageGroup || 'teen'); // K: 연령대
      if (Array.isArray(payload.confirmedGoals)) sheet.getRange(rowIndex, 12).setValue(confirmedGoalValue_(payload));
    } else {
      // 새 행 추가
      appendRecordRow_(sheet, [
        kstTimestamp,   // A: 타임스탬프
        p.grade,        // B: 학년
        p.class,        // C: 반
        p.number,       // D: 번호
        payload.name,   // E: 성명
        normId,         // F: 전체학번
        payload.weight, // G: 몸무게
        payload.targetCaf || '',       // H: 목표카페인
        payload.targetBedtime || '',   // I: 목표취침시간
        payload.targetWakeTime || '',  // J: 목표기상시간
        payload.ageGroup || 'teen',    // K: 연령대
        ...(Array.isArray(payload.confirmedGoals) ? [confirmedGoalValue_(payload)] : [])
      ]);
    }

    safeLog_(`초기설정 저장 완료: ${normId}, 체중=${payload.weight}, 목표카페인=${payload.targetCaf}, 취침=${payload.targetBedtime}, 기상=${payload.targetWakeTime}`);
    return { success: true };
  } catch (error) {
    safeLog_('초기설정 저장 오류: ' + error);
    throw error;
  }
}

// 카페인 데이터 업데이트
function updateCaffeineData(payload) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      throw new Error("카페인 시트를 찾을 수 없습니다.");
    }

    const kstTimestamp = getKSTTimestamp();

    let intakeTime = payload.time || kstTimestamp;
    if (intakeTime.includes('T')) {
      const dt = new Date(intakeTime);
      intakeTime = Utilities.formatDate(dt, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
    }

    let rowIndex = -1;
    if (payload.id) {
      const data = sheet.getDataRange().getValues();
      for (let i = 1; i < data.length; i++) {
        if (String(data[i][9]) === String(payload.id)) { // J열: 고유ID
          rowIndex = i + 1;
          break;
        }
      }
    }

    if (rowIndex > 0) {
      sheet.getRange(rowIndex, 1).setValue(kstTimestamp);          // A: 타임스탬프
      sheet.getRange(rowIndex, 7).setValue(payload.drink);         // G: 음료명
      sheet.getRange(rowIndex, 8).setValue(payload.mg);            // H: 함량
      sheet.getRange(rowIndex, 9).setValue(intakeTime);            // I: 섭취시간
      sheet.getRange(rowIndex, 11).setValue(payload.reason || '');  // K: 섭취이유
      sheet.getRange(rowIndex, 12).setValue(payload.symptom || ''); // L: 부작용 경험
      return { success: true };
    }

    throw new Error("수정할 기록을 찾을 수 없습니다.");
  } catch (error) {
    safeLog_('카페인 수정 오류: ' + error);
    throw error;
  }
}

// 수면 데이터 업데이트
function updateSleepData(payload) {
  return updatePreservedSleep_(payload);
}

function deleteCaffeineData(id) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      throw new Error("카페인 시트를 찾을 수 없습니다.");
    }

    const data = sheet.getDataRange().getValues();

    for (let i = 1; i < data.length; i++) {
      if (String(data[i][9]) === String(id)) { // J열: 고유ID
        const rowIndex = i + 1;
        sheet.deleteRow(rowIndex);
        safeLog_(`카페인 기록 삭제 완료: ID=${id}, Row=${rowIndex}`);
        return { success: true };
      }
    }

    throw new Error("삭제할 기록을 찾을 수 없습니다.");
  } catch (error) {
    safeLog_('카페인 삭제 오류: ' + error);
    throw error;
  }
}

// 수면 데이터 삭제 (실제 행 삭제)
function deleteSleepData(id) {
  return deletePreservedSleep_(id);
}

function getCaffeineLogs(studentId, startDate, endDate, strictRead) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("caffeine");

    if (!sheet) {
      if (strictRead) throw new Error('BOOTSTRAP_SHEET_MISSING');
      safeLog_('카페인 시트를 찾을 수 없습니다');
      return [];
    }

    const lastRow = sheet.getLastRow();
    if (lastRow <= 1) {
      safeLog_('카페인 데이터가 없습니다');
      return [];
    }

    const data = sheet.getRange(2, 1, lastRow - 1, Math.min(15, sheet.getLastColumn())).getValues();
    const logs = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowStudentId = String(row[4]).trim(); // E열: 전체학번

      if (rowStudentId === normalizeId(studentId)) {
        const intakeTime = row[8]; // I열: 섭취시간
        let timeStr = '';

        if (intakeTime instanceof Date) {
          timeStr = Utilities.formatDate(intakeTime, "Asia/Seoul", "yyyy-MM-dd HH:mm:ss");
        } else if (typeof intakeTime === 'string') {
          timeStr = intakeTime;
        }

        const dateStr = timeStr.split(' ')[0];

        if (startDate && endDate) {
          if (dateStr < startDate || dateStr > endDate) {
            continue;
          }
        }

        logs.push({
          id: row[9] || '',                    // J열: 고유ID
          name: row[6] || '',                  // G열: 음료명
          amount: parseFloat(row[7]) || 0,     // H열: 함량
          time: timeStr,
          reason: row[10] || '',              // K열: 섭취이유
          company: row[13] || '',
          foodName: row[14] || '',
          symptom: row[11] || ''              // L열: 부작용 경험
        });
      }
    }

    logs.sort((a, b) => {
      const dateA = new Date(a.time);
      const dateB = new Date(b.time);
      return dateB - dateA;
    });

    return logs;
  } catch (error) {
    if (strictRead) throw error;
    safeLog_('카페인 로그 조회 오류: ' + error);
    return [];
  }
}

// 수면 로그 조회 (강화된 디버깅 버전)
function getSleepLogs(studentId, startDate, endDate, strictRead) {
  try {
    safeLog_(`=== getSleepLogs 시작 ===`);
    safeLog_(`입력 파라미터:`);
    safeLog_(`  studentId: "${studentId}" (타입: ${typeof studentId})`);
    safeLog_(`  startDate: ${startDate}`);
    safeLog_(`  endDate: ${endDate}`);

    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("sleep");

    if (!sheet) {
      if (strictRead) throw new Error('BOOTSTRAP_SHEET_MISSING');
      safeLog_('❌ 수면 시트를 찾을 수 없습니다');
      return [];
    }

    const lastRow = sheet.getLastRow();
    safeLog_(`✓ 수면 시트 총 행 수: ${lastRow}`);

    if (lastRow <= 1) {
      safeLog_('⚠️ 수면 데이터가 없습니다 (헤더만 존재)');
      return [];
    }

    // 모든 데이터 읽기 (A:R, 18개 컬럼)
    const data = sheet.getRange(2, 1, lastRow - 1, 19).getValues();
    safeLog_(`✓ 읽어온 데이터 행 수: ${data.length}`);

    const logs = [];
    const sleepMetadataIndex = preservedSleepMetadataIndex_();
    let matchCount = 0;
    let skipCount = 0;

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const rowStudentId = String(row[4]).trim(); // E열: 전체학번

      // 모든 행의 학번 출력 (처음 5개만)
      if (i < 5) {
        safeLog_(`Row ${i + 2}: 학번="${rowStudentId}" vs 입력학번="${studentId}"`);
      }

      // 학번 비교
      if (rowStudentId === normalizeId(studentId)) {
        matchCount++;
        safeLog_(`  ✓ Row ${i + 2} 매칭됨!`);

        const sleepDate = row[6]; // G열: 날짜
        let dateStr = '';

        // 날짜 형식 처리
        if (sleepDate instanceof Date) {
          dateStr = Utilities.formatDate(sleepDate, "Asia/Seoul", "yyyy-MM-dd");
          safeLog_(`    날짜(Date): ${dateStr}`);
        } else if (sleepDate) {
          dateStr = String(sleepDate);
          safeLog_(`    날짜(String): ${dateStr}`);
        } else {
          safeLog_(`    ⚠️ 날짜가 비어있음`);
          dateStr = '';
        }

        // 날짜 필터링
        if (startDate && endDate) {
          if (dateStr < startDate || dateStr > endDate) {
            safeLog_(`    ⏭️ 날짜 범위 벗어남 (${startDate} ~ ${endDate})`);
            skipCount++;
            continue;
          }
        }

        // 시간 데이터 처리
        let startTime = '';
        let endTime = '';

        if (row[7] instanceof Date) {
          startTime = Utilities.formatDate(row[7], "Asia/Seoul", "HH:mm");
        } else {
          startTime = String(row[7] || '');
        }

        let wakeDateStr = '';
        if (row[8] instanceof Date) {
          wakeDateStr = Utilities.formatDate(row[8], "Asia/Seoul", "yyyy-MM-dd");
        } else {
          wakeDateStr = String(row[8] || '').substring(0, 10);
        }

        if (row[9] instanceof Date) {
          endTime = Utilities.formatDate(row[9], "Asia/Seoul", "HH:mm");
        } else {
          endTime = String(row[9] || '');
        }

        // 로그 객체 생성
        const sleepMeta = preservedSleepMetadataForRow_(row, sleepMetadataIndex);
        const log = {
          id: String(row[13] || ''),           // N: id
          editVersion: typeof preservedSleepVersion_ === 'function' ? preservedSleepVersion_(row, sleepMeta) : undefined,
          date: dateStr,                       // G열: 날짜
          start: startTime,                    // H열: 취침
          wakeDate: wakeDateStr,
          end: endTime,                        // I열: 기상
          savedAt: recordTimestampText_(row[0]),
          sourceRow:i+1,
          hours: recordNumber_(row[10]),      // J열: 시간
          condition: String(row[11] || ''),    // L: condition
          memo: String(row[12] || ''),         // M: memo
          smartphone: String(row[14] || ''),   // O: smartphone
          activity:   String(row[15] || ''),   // P: activity
          latency:    String(row[16] || ''),   // Q: latency
          awakenings: String(row[17] || ''),   // R: awakenings
          daytime:    String(row[18] || '')    // S: daytime
        };

        safeLog_(`    로그 생성: ${JSON.stringify(log)}`);
        Object.assign(log, preservedSleepMetadataView_(row, sleepMeta));
        if (data.filter(function(other) { return SleepRecordPolicy.id(other[13]) === SleepRecordPolicy.id(row[13]); }).length > 1) log.identityConflict = true;
        logs.push(log);
      }
    }

    safeLog_(`\n📊 결과 요약:`);
    safeLog_(`  총 검사한 행: ${data.length}`);
    safeLog_(`  학번 매칭: ${matchCount}개`);
    safeLog_(`  날짜 필터로 제외: ${skipCount}개`);
    safeLog_(`  최종 반환: ${logs.length}개`);

    // 날짜 역순 정렬
    logs.sort((a, b) => {
      const dateA = new Date(a.date);
      const dateB = new Date(b.date);
      return dateB - dateA;
    });

    safeLog_(`=== getSleepLogs 완료 ===\n`);

    return logs;
  } catch (error) {
    if (strictRead) throw error;
    safeLog_('❌ 수면 로그 조회 오류: ' + error);
    safeLog_('오류 스택: ' + error.stack);
    return [];
  }
}

// 대시보드 데이터 조회 (사용 안 함 - getStats, getFilteredStats 사용)
function getDashboardData(studentId, startDate, endDate) {
  try {
    const ss = getSpreadsheet_();
    const caffeineSheet = ss.getSheetByName("caffeine");
    const sleepSheet = ss.getSheetByName("sleep");

    const dates = [];
    const caffeineData = [];
    const sleepData = [];

    const start = new Date(startDate);
    const end = new Date(endDate);

    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
      const dateStr = Utilities.formatDate(d, "Asia/Seoul", "yyyy-MM-dd");
      dates.push(dateStr.substr(5));

      let dailyCaffeine = 0;
      let dailySleep = 0;

      if (caffeineSheet) {
        const caffeineRows = caffeineSheet.getDataRange().getValues();
        for (let i = 1; i < caffeineRows.length; i++) {
          if (normalizeId(caffeineRows[i][4]) === normalizeId(studentId)) {
            const intakeTime = caffeineRows[i][8]; // I열
            let intakeDateStr;
            if (intakeTime instanceof Date) {
              intakeDateStr = Utilities.formatDate(intakeTime, "Asia/Seoul", "yyyy-MM-dd");
            } else if (typeof intakeTime === 'string') {
              intakeDateStr = intakeTime.split(' ')[0];
            }
            if (intakeDateStr === dateStr) {
              dailyCaffeine += parseFloat(caffeineRows[i][7]) || 0; // H열
            }
          }
        }
      }

      if (sleepSheet) {
        const sleepRows = sleepSheet.getDataRange().getValues();
        for (let i = 1; i < sleepRows.length; i++) {
          if (normalizeId(sleepRows[i][4]) === normalizeId(studentId)) {
            const sleepDate = sleepRows[i][6]; // G열
            let sleepDateStr;
            if (sleepDate instanceof Date) {
              sleepDateStr = Utilities.formatDate(sleepDate, "Asia/Seoul", "yyyy-MM-dd");
            } else {
              sleepDateStr = String(sleepDate);
            }
            if (sleepDateStr === dateStr) {
              dailySleep = parseFloat(sleepRows[i][9]) || 0; // J열
            }
          }
        }
      }

      caffeineData.push(dailyCaffeine);
      sleepData.push(dailySleep);
    }

    return {
      labels: dates,
      caffeineData: caffeineData,
      sleepData: sleepData
    };
  } catch (error) {
    safeLog_('대시보드 데이터 조회 오류: ' + error);
    return {
      labels: [],
      caffeineData: [],
      sleepData: []
    };
  }
}

// 통계 조회 (최근 7일)
function getStats(studentId, strictRead) {
  try {
    if(strictRead){const ss=getSpreadsheet_();if(!ss.getSheetByName('caffeine')||!ss.getSheetByName('sleep'))throw new Error('BOOTSTRAP_SHEET_MISSING');}
    return getFilteredStats(studentId,getKSTDate());
  } catch(error) {
    if(strictRead)throw error;
    return {todayTotal:0,todayHasRecord:false,labels:[],caffeineData:[],caffeineHasData:[],sleepData:[]};
  }
}

function getFilteredStats(studentId, endDateStr) {
  const end=recordDateText_(endDateStr);
  if(!end)throw new Error('분석 기간을 다시 선택해주세요.');
  const data=getWeeklyDetailedData(studentId,shiftRecordDate_(end,-6),end);
  const last=data.dailyRecords[data.dailyRecords.length-1];
  return {todayTotal:last?.caffeine ?? null,todayHasRecord:!!last && last.caffeineStatus!=='missing',todayCaffeineStatus:last?.caffeineStatus || 'missing',chartEndDate:end,
    labels:data.dailyRecords.map(r=>r.date.slice(5).replace('-','/')),
    caffeineData:data.dailyRecords.map(r=>r.caffeine),caffeineHasData:data.dailyRecords.map(r=>r.caffeineStatus!=='missing'),sleepData:data.dailyRecords.map(r=>r.sleep),
    sleepRecordedDays:data.sleepRecordedDays,conditionRecordedDays:data.conditionRecordedDays,sleepDayStatuses:data.dailyRecords.map(r=>r.sleepStatus),sleepEpisodeCounts:data.dailyRecords.map(r=>r.sleepRecordCount),sleepEpisodes:data.sleepEpisodes,sleepHeldDays:data.sleepHeldDays,sleepHeldRecordCount:data.sleepHeldRecordCount,sleepUnassignedRecordCount:data.sleepUnassignedRecordCount,caffeineStatuses:data.dailyRecords.map(r=>r.caffeineStatus),sleepPolicyVersion:SleepRecordPolicy.version};
}

function debugCurrentCode(studentId) {
  safeLog_('🔍 ===== 코드 상태 진단 시작 =====');

  // 1. getWeeklyDetailedData 함수 테스트
  safeLog_('\n📝 테스트 1: getWeeklyDetailedData 함수');
  try {
  if (!studentId) throw new Error('STUDENT_ID_REQUIRED'); const testResult = getWeeklyDetailedData(studentId);

    safeLog_('반환 타입: ' + typeof testResult);

    if (typeof testResult === 'string') {
      safeLog_('❌❌❌ 치명적 오류: 문자열로 반환됨!');
      safeLog_('❌ 코드가 수정되지 않았습니다!');
      safeLog_('❌ 최종_정리_코드.gs 파일의 getWeeklyDetailedData 함수로 교체 필요');
    } else if (typeof testResult === 'object') {
      safeLog_('✅ 객체로 반환됨 (정상)');
      safeLog_('✅ recordedDays: ' + testResult.recordedDays);
      safeLog_('✅ totalDays: ' + testResult.totalDays);

      if (testResult.recordedDays !== undefined) {
        safeLog_('✅✅✅ 코드가 올바르게 수정됨!');
      } else {
        safeLog_('❌ recordedDays가 없음 - 수정 실패');
      }
    }
  } catch (error) {
    safeLog_('❌ 함수 실행 오류: ' + error);
  }

  // 2. generateAIHealthReport 함수 확인
  safeLog_('\n📝 테스트 2: generateAIHealthReport 함수 시그니처 확인');
  const funcString = generateAIHealthReport.toString();

  if (funcString.includes('recordedDays < 3')) {
    safeLog_('✅ 데이터 부족 체크 코드 있음');
  } else {
    safeLog_('❌ 데이터 부족 체크 코드 없음 - 수정 필요');
  }

  if (funcString.includes('getInsufficientDataMessage')) {
    safeLog_('✅ 데이터 부족 메시지 함수 호출 있음');
  } else {
    safeLog_('❌ 데이터 부족 메시지 함수 호출 없음 - 수정 필요');
  }

  safeLog_('\n🔍 ===== 코드 상태 진단 완료 =====');
  safeLog_('\n📋 결과 요약:');
  safeLog_('위 로그를 확인하여:');
  safeLog_('- ✅가 모두 표시되면: 코드 수정 완료, 웹앱 재배포 필요');
  safeLog_('- ❌가 하나라도 있으면: 코드 재수정 필요');
}

// ============================================
// 주간 상세 데이터 수집 (카페인/수면 개별 카운트)
// ============================================

function getWeeklyDetailedData(studentId, startDate, endDate) {
  const ss=getSpreadsheet_(),dates=[];
  const end=endDate||Utilities.formatDate(new Date(),'Asia/Seoul','yyyy-MM-dd'),start=startDate||shiftRecordDate_(end,-6);
  const startTime=Date.parse(start+'T00:00:00Z'),endTime=Date.parse(end+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||!Number.isFinite(startTime)||!Number.isFinite(endTime)||new Date(startTime).toISOString().slice(0,10)!==start||new Date(endTime).toISOString().slice(0,10)!==end||endTime<startTime||endTime-startTime>3660*86400000)throw new Error('분석 기간을 다시 선택해주세요.');
  for(let day=start;day<=end;day=shiftRecordDate_(day,1))dates.push(day);
  const caffeineSheet=ss.getSheetByName('caffeine');
  // Load actual intake instants before applying the calendar-day analysis filter.
  const caffeineRows=(caffeineSheet?caffeineSheet.getDataRange().getValues().slice(1):[]).filter(row=>normalizeOwnerId_(row[4])===normalizeOwnerId_(studentId)).map(row=>({id:String(row[9]||''),time:row[8],amount:row[7]}));
  const caffeine=SleepRecordPolicy.caffeineDays(caffeineRows),allSleep=getSleepLogs(studentId,null,null,true),sleep=SleepRecordPolicy.days(allSleep);
  const selection=SleepRecordPolicy.selectPeriod(allSleep,{basis:'target',start:start,end:end});
  const summarizeIds=rows=>new Set(rows.map((r,i)=>SleepRecordPolicy.id(r.id)||'unassigned-source-row:'+i)).size;
  const sleepEpisodes=selection.records.map(record=>{
    const d=SleepRecordPolicy.describe(record),group=sleep.get(d.analysisDate),window=SleepRecordPolicy.caffeineWindow(record,caffeineRows,24);
    return Object.assign({},record,{analysisDate:d.analysisDate,wakeDate:d.wakeDate,intervalHours:d.intervalHours,analysisStatus:d.type==='nap'?'excluded':group?group.status:'held',analysisHoldReason:d.type==='nap'?'nap':group?group.holdReason:'unknown_date',exposure24h:{total:window.total,status:window.status,knownSubtotal:window.knownSubtotal,recordCount:window.records.length,unplacedRecordCount:window.unplacedRecords.length,boundary:'[bed-24h,bed)'}});
  });
  let caffeineTotal=0,sleepTotal=0,conditionTotal=0,caffeineRecordedDays=0,sleepRecordedDays=0,conditionRecordedDays=0,caffeineMissingDays=0,recordedDays=0,sleepHeldDays=0,sleepHeldRecordCount=0,caffeineNoRecordDays=0;
  const overCaffeineDays=[],details=[],dailyRecords=[];
  dates.forEach(day=>{
    const caf=caffeine.get(day),group=sleep.get(day),ready=group&&group.status==='ready';
    const hours=ready?group.record.intervalHours:null,condition=ready?group.record.condition:null;
    const cafStatus=!caf?'missing':caf.status;
    if(cafStatus==='known'){caffeineRecordedDays++;caffeineTotal+=caf.total;overCaffeineDays.push({date:day,mg:caf.total});}
    if(cafStatus==='unknown')caffeineMissingDays++;if(cafStatus==='missing')caffeineNoRecordDays++;
    if(hours!==null){sleepRecordedDays++;sleepTotal+=hours;}if(condition!==null){conditionRecordedDays++;conditionTotal+=condition;}
    if(group&&group.status==='held'){sleepHeldDays++;sleepHeldRecordCount+=new Set(group.records.map((r,i)=>r.id||'source:'+i)).size;}
    if(caf||group)recordedDays++;
    const sleepStatus=group?group.status:'missing',episodeCount=group?new Set(group.records.map((r,i)=>r.id||'source:'+i)).size:0;
    dailyRecords.push({date:day,caffeine:cafStatus==='known'?caf.total:null,caffeineStatus:cafStatus,caffeineKnownSubtotal:caf?caf.knownSubtotal:null,sleep:hours,condition:condition,sleepStatus:sleepStatus,sleepHoldReason:group?group.holdReason:'',sleepRecordCount:episodeCount,sleepSourceRowCount:group?group.records.length:0});
    details.push(day+': '+(cafStatus==='known'?'카페인 '+caf.total+'mg':cafStatus==='unknown'?'카페인 함량 미상':'카페인 미기록')+', '+(sleepStatus==='held'?'수면 기록 '+episodeCount+'건 · 분석 확인 필요':hours!==null?'자가보고 취침·기상 구간 '+hours+'h':'수면 미기록')+', '+(condition!==null?'기상 후 컨디션 '+condition+'점':'컨디션 평균 제외'));
  });
  return {details:details.join('\n'),dailyRecords:dailyRecords,recordedDays:recordedDays,caffeineRecordedDays:caffeineRecordedDays,sleepRecordedDays:sleepRecordedDays,conditionRecordedDays:conditionRecordedDays,caffeineMissingDays:caffeineMissingDays,caffeineUnknownDays:caffeineMissingDays,caffeineNoRecordDays:caffeineNoRecordDays,totalDays:dates.length,caffeineTotal:caffeineTotal,sleepTotal:sleepTotal,conditionTotal:conditionTotal,overCaffeineDays:overCaffeineDays,sleepRecordCount:summarizeIds(selection.records),sleepSourceRowCount:selection.records.length,sleepHeldDays:sleepHeldDays,sleepHeldRecordCount:sleepHeldRecordCount,sleepEpisodes:sleepEpisodes,sleepUnassignedRecordCount:summarizeIds(selection.unassigned),sleepUnassignedEpisodes:selection.unassigned,sleepInventoryRecordCount:summarizeIds(allSleep),policyVersion:SleepRecordPolicy.version,sleepDateBasis:'actual_wake_date_minus_one',caffeineDateBasis:'actual_intake_calendar_day'};
}
function recordNumber_(value) {
  if(value===null||value===undefined||String(value).trim()==='')return null;
  const number=Number(value);return Number.isFinite(number)&&number>=0?number:null;
}
function recordDateText_(value) {
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Seoul','yyyy-MM-dd');
  const match=String(value||'').match(/^(\d{4})[.\/-]\s*(\d{1,2})[.\/-]\s*(\d{1,2})/);
  return match?match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0'):'';
}
function recordTimeText_(value) {
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Seoul','HH:mm');
  const match=String(value||'').match(/^(\d{1,2}):(\d{2})/);return match?match[1].padStart(2,'0')+':'+match[2]:'';
}
function recordTimestampText_(value) {
  if(value instanceof Date)return Utilities.formatDate(value,'Asia/Seoul','yyyy-MM-dd HH:mm:ss');
  return String(value||'').trim().replace('T',' ');
}
function shiftRecordDate_(day,offset) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day))return '';
  const date=new Date(day+'T00:00:00Z');date.setUTCDate(date.getUTCDate()+offset);return date.toISOString().slice(0,10);
}
function conditionScore_(value) {
  const text=String(value||'').replace(/[\ufe0e\ufe0f]/g,'').trim();
  const emojis=['😫','😴','😐','🙂','😊'];
  const index=emojis.findIndex(e=>text.includes(e));if(index>=0)return index+1;
  return /^[1-5]$/.test(text)?Number(text):null;
}
function recordSleepCategory_(hours) {
  return hours===null?'미기록':hours<8?'권장보다 짧음':hours<=10?'권장 범위':'권장보다 김';
}
function recordFeedbackNumber_(value) {
  if((typeof value!=='number'&&typeof value!=='string')||String(value).trim()==='')return null;
  const n=Number(value);return Number.isFinite(n)&&n>=0?n:null;
}
function recordFeedbackFixed_(value) {
  return (Math.round((value+Number.EPSILON)*10)/10).toFixed(1);
}
function summarizeCircularSleepClock_(values) {
  const valid=(values||[]).filter(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<1440);
  if(!valid.length)return {validCount:0,meanMinute:null,meanAbsoluteDeviation:null};
  let x=0,y=0;valid.forEach(v=>{const angle=v*2*Math.PI/1440;x+=Math.cos(angle);y+=Math.sin(angle);});
  if(Math.sqrt(x*x+y*y)/valid.length<1e-8)return {validCount:valid.length,meanMinute:null,meanAbsoluteDeviation:null};
  let center=(Math.atan2(y,x)*1440/(2*Math.PI)+1440)%1440;if(Math.min(center,1440-center)<1e-8)center=0;
  const deviation=valid.reduce((sum,v)=>{const d=Math.abs(v-center);return sum+Math.min(d,1440-d);},0)/valid.length;
  return {validCount:valid.length,meanMinute:center,meanAbsoluteDeviation:deviation};
}
function summarizeSleepOutcomes_(data) {
  data=data||{};
  const hasDaily=Array.isArray(data.dailyRecords),daily=hasDaily?data.dailyRecords:[],ready=daily.filter(r=>r&&r.sleepStatus==='ready');
  const conditionCounts=[0,0,0,0,0],intervalCounts=[0,0,0],conditions=[],intervals=[];
  ready.forEach(r=>{const condition=conditionScore_(r.condition),hours=recordFeedbackNumber_(r.sleep);if(condition!==null){conditions.push(condition);conditionCounts[condition-1]++;}if(hours!==null){intervals.push(hours);intervalCounts[hours<8?0:hours<=10?1:2]++;}});
  const legacyCount=value=>Number.isInteger(value)&&value>0?value:0;
  const condCount=hasDaily?conditions.length:legacyCount(data.conditionRecordedDays),hourCount=hasDaily?intervals.length:legacyCount(data.sleepRecordedDays);
  const conditionTotal=hasDaily?conditions.reduce((a,b)=>a+b,0):recordFeedbackNumber_(data.conditionTotal),hourTotal=hasDaily?intervals.reduce((a,b)=>a+b,0):recordFeedbackNumber_(data.sleepTotal);
  const conditionMean=condCount&&conditionTotal!==null?conditionTotal/condCount:null,hourMean=hourCount&&hourTotal!==null?hourTotal/hourCount:null;
  const percent=(n,total)=>total?Math.round(n*1000/total)/10:null;
  const conditionDistribution=hasDaily&&condCount>0,intervalDistribution=hasDaily&&hourCount>0,normalCount=conditionCounts[2]+conditionCounts[3]+conditionCounts[4];
  const readyDates=new Set(ready.map(r=>r.date)),bedMinutes=[],wakeMinutes=[],seen=new Set();let excludedNapCount=0;
  (Array.isArray(data.sleepEpisodes)?data.sleepEpisodes:[]).forEach(record=>{
    const d=SleepRecordPolicy.describe(record);if(d.type==='nap'){excludedNapCount++;return;}
    if(record.analysisStatus!=='ready'||!readyDates.has(d.analysisDate)||!d.eligibleRecord)return;
    const key=d.id||String(d.bed)+'|'+String(d.wake);if(seen.has(key))return;seen.add(key);
    const bed=new Date(d.bed+9*3600000),wake=new Date(d.wake+9*3600000);bedMinutes.push(bed.getUTCHours()*60+bed.getUTCMinutes());wakeMinutes.push(wake.getUTCHours()*60+wake.getUTCMinutes());
  });
  return {
    condition:{validCount:condCount,mean:conditionMean!==null&&conditionMean>=1&&conditionMean<=5?conditionMean:null,counts:conditionCounts,percentages:conditionCounts.map(n=>conditionDistribution?percent(n,condCount):null),distributionAvailable:conditionDistribution,atLeastNormalCount:conditionDistribution?normalCount:null,atLeastNormalPercent:conditionDistribution?percent(normalCount,condCount):null,missingOrInvalidReadyCount:hasDaily?ready.length-conditions.length:null},
    interval:{validCount:hourCount,mean:hourMean,counts:intervalCounts,percentages:intervalCounts.map(n=>intervalDistribution?percent(n,hourCount):null),distributionAvailable:intervalDistribution,min:intervals.length?Math.min.apply(Math,intervals):null,max:intervals.length?Math.max.apply(Math,intervals):null,missingOrInvalidReadyCount:hasDaily?ready.length-intervals.length:null},
    bedtime:summarizeCircularSleepClock_(bedMinutes),waking:summarizeCircularSleepClock_(wakeMinutes),
    heldDays:recordFeedbackNumber_(data.sleepHeldDays)||daily.filter(r=>r&&r.sleepStatus==='held').length,
    heldRecordCount:recordFeedbackNumber_(data.sleepHeldRecordCount)||0,unassignedRecordCount:recordFeedbackNumber_(data.sleepUnassignedRecordCount)||0,excludedNapCount:excludedNapCount
  };
}
function buildSleepOutcomeFeedback_(data) {
  const s=summarizeSleepOutcomes_(data),c=s.condition,h=s.interval,labels=['최악','나쁨','보통','좋음','최고'],summary=[],lines=[];
  if(c.distributionAvailable){
    const observed=labels.map((label,i)=>c.counts[i]?label+' '+c.counts[i]+'건':'').filter(Boolean).join(' · ');
    summary.push('기상 후 컨디션은 '+observed+'이며, 평균 '+recordFeedbackFixed_(c.mean)+'점입니다.');
    lines.push('기상 후 컨디션 평균 '+recordFeedbackFixed_(c.mean)+'점 / 5점 · 유효 응답 '+c.validCount+'건');
    lines.push(labels.map((label,i)=>label+'('+(i+1)+'점) '+c.counts[i]+'건 ('+recordFeedbackFixed_(c.percentages[i])+'%)').join(' · '));
    lines.push('보통 이상(3~5점)은 '+c.atLeastNormalCount+'/'+c.validCount+'건 ('+recordFeedbackFixed_(c.atLeastNormalPercent)+'%)입니다. 이 비율은 기록된 응답의 분포입니다.');
  }else if(c.mean!==null){
    summary.push('기상 후 컨디션 평균은 '+recordFeedbackFixed_(c.mean)+'점입니다.');lines.push('기상 후 컨디션 평균 '+recordFeedbackFixed_(c.mean)+'점 · 유효 응답 '+c.validCount+'건. 개별 점수 자료가 없어 분포는 제시하지 않습니다.');
  }else lines.push('기상 후 컨디션 미기록 또는 유효한 1~5점 응답이 없어 평균·분포를 계산하지 않았습니다.');
  if(h.mean!==null){
    summary.push('자가보고 취침~기상 간격은 평균 '+recordFeedbackFixed_(h.mean)+'시간입니다.');
    lines.push('자가보고 취침~기상 간격 평균 '+recordFeedbackFixed_(h.mean)+'h · 유효 '+h.validCount+'건'+(h.distributionAvailable?' · 최소 '+recordFeedbackFixed_(h.min)+'h ~ 최대 '+recordFeedbackFixed_(h.max)+'h':''));
    if(h.distributionAvailable)lines.push(['8시간 미만','8~10시간','10시간 초과'].map((label,i)=>label+' '+h.counts[i]+'건 ('+recordFeedbackFixed_(h.percentages[i])+'%)').join(' · '));
    else lines.push('개별 간격 자료가 없어 구간별 분포는 제시하지 않습니다.');
  }else lines.push(data.sleepRecordCount||s.heldDays||s.excludedNapCount||s.unassignedRecordCount?'수면 기록 중 선택 기간에 배정해 분석할 수 있는 유효한 일별 취침·기상 간격이 없어 평균을 보류합니다.':'수면 미기록 — 취침·기상 간격 평균을 계산하지 못했습니다.');
  if(s.bedtime.validCount){
    const clock=n=>{const m=Math.round(n)%1440;return String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');};
    lines.push(s.bedtime.meanMinute===null||s.waking.meanMinute===null?'취침·기상 시각의 분포가 대칭이라 평균 시각을 정하기 어렵습니다.':'취침·기상 패턴: 취침 평균 약 '+clock(s.bedtime.meanMinute)+' / 기상 평균 약 '+clock(s.waking.meanMinute)+' (일시가 있는 유효 '+s.bedtime.validCount+'건, 자정 넘김 반영)');
  }
  if(c.missingOrInvalidReadyCount)lines.push('간격이 유효한 수면 중 컨디션 미기록·무효 '+c.missingOrInvalidReadyCount+'건은 컨디션 분모에서 제외했습니다.');
  const held=[];if(s.heldDays)held.push('분석 보류 '+s.heldDays+'일'+(s.heldRecordCount?' ('+s.heldRecordCount+'건)':''));if(s.unassignedRecordCount)held.push('날짜 미확정 '+s.unassignedRecordCount+'건');if(s.excludedNapCount)held.push('명시된 낮잠·추가 수면 '+s.excludedNapCount+'건');if(held.length)lines.push(held.join(' · ')+'은 일별 결과 계산에서 제외했습니다.');
  lines.push('이 간격은 실측 수면시간이 아닌 입력한 취침·기상 시각의 차이입니다.');
  return {summary:summary.join(' '),details:lines.join('\n')+'\n',statistics:s};
}
function buildRecordFeedback_(data,limit,teacher,period,thresholds,lifestyle) {
  if (data.feedbackEngine) return feedbackReportText_(data.feedbackEngine.sections);
  const count=data.totalDays||7, cafDays=data.caffeineRecordedDays||0,slpDays=data.sleepRecordedDays||0,condDays=data.conditionRecordedDays||0;
  const caf=cafDays?data.caffeineTotal/cafDays:null,slp=slpDays?data.sleepTotal/slpDays:null,condition=condDays?data.conditionTotal/condDays:null;
  const note=days=>days>0&&days<3?(teacher?' — 기록이 적어 경향 해석에 주의가 필요합니다.':' — 기록이 '+days+'일로 적어, 평소 습관으로 판단하기에는 아직 부족해요.'):'';
  const sleepOutcome=buildSleepOutcomeFeedback_(data);
  let text=(teacher?'건강 관찰 소견':'기록 기반 건강 피드백')+' ('+period+')\n'+(sleepOutcome.summary?sleepOutcome.summary+'\n':'')+'평균은 각 항목의 유효 기록일을 기준으로 계산했으며, 미기록일은 계산에서 제외했습니다.\n\n☕ 카페인\n';
  if(caf===null)text+='카페인 미기록 또는 함량 누락으로 평균을 계산하지 못했습니다.\n';
  else {
    text+='기록일 기준 일평균 '+Math.round(caf)+'mg / 목표 섭취량 '+Math.round(limit)+'mg · 기록 '+cafDays+'/'+count+'일'+note(cafDays)+'\n';
    if(cafDays>=3) {
      if(teacher)text+=getTeacherCaffeineSummary_(caf,limit,cafDays,data.overCaffeineDays||[],thresholds).section+'\n';
      else text+=(caf>limit?'기록일 평균이 목표 섭취량을 넘었습니다.':'기록일 평균은 목표 섭취량 이내입니다.')+'\n';
    }
    const zero=(data.overCaffeineDays||[]).filter(d=>d.mg===0).length;
    if(zero)text+=zero+'일은 카페인 없이 보낸 것으로 명시적 0mg이 기록되었습니다.\n';
  }
  text+='카페인 기록 '+cafDays+'/'+count+'일'+(data.caffeineMissingDays?' · 함량 누락 '+data.caffeineMissingDays+'일':'')+'\n\n😴 수면\n';
  text+=sleepOutcome.details;
  if(slpDays>0&&slpDays<3)text+='수면 결과'+note(slpDays)+'\n';
  if(slpDays>=3)text+='수면시간: '+recordSleepCategory_(slp)+' (수업 기준 8~10시간)\n';
  if(condDays>0&&condDays<3)text+='컨디션 결과'+note(condDays)+'\n';
  if(teacher)text+='수면시간과 기상 후 컨디션은 별도로 살펴봅니다.\n';
  else {
    if(slpDays>=3&&condDays>=3)text+='수면시간과 컨디션을 함께 기록했네요. 컨디션이 좋았던 날과 아쉬웠던 날의 수면시간을 나란히 비교해 보세요.\n';
  }
  if(teacher&&lifestyle)text+='\n생활 습관 관찰\n'+lifestyle+'\n';
  if(teacher)text+='\n💡 실천 제안\n1. 기록이 없는 날과 카페인을 섭취하지 않은 날의 0mg 기록을 구분해 주세요.\n2. 수면시간과 기상 후 컨디션을 기록하고 나의 생활과 함께 비교해 보세요.\n이 피드백은 자기관찰을 위한 교육자료입니다.';
  else {
    const overDays=(data.overCaffeineDays||[]).filter(day=>day.mg>limit).length;
    let caffeineTip;
    if(data.caffeineMissingDays)caffeineTip='함량이 빠진 날의 음료명과 양을 확인하고 카페인 함량을 보완해 보세요.';
    else if(cafDays<3)caffeineTip='오늘 마신 음료와 카페인 양을 기록해 보세요. 카페인을 마시지 않은 날도 0mg으로 남기면 다음 분석에 반영할 수 있어요.';
    else if(overDays)caffeineTip='목표 섭취량을 넘은 '+overDays+'일의 기록에서 어떤 음료를 얼마나 마셨는지 확인해 보세요.';
    else caffeineTip='카페인을 마신 날의 음료와 양을 확인하고, 다음 기록에서도 목표 섭취량과 비교해 보세요.';
    let sleepTip;
    if(slpDays<3)sleepTip='다음 수면부터 취침·기상 시각과 기상 후 컨디션을 함께 기록해 보세요. 기록이 쌓이면 날짜별 차이를 비교할 수 있어요.';
    else if(condDays<3)sleepTip='다음에 일어나면 기상 후 컨디션을 1~5점으로 기록해 보세요. 수면시간 옆에 점수를 남기면 어떤 날 더 개운했는지 비교할 수 있어요.';
    else if(slp<8)sleepTip='수면시간이 가장 짧았던 날의 취침·기상 시각을 확인하고, 그날의 컨디션을 다른 날과 비교해 보세요.';
    else if(slp>10)sleepTip='수면시간이 가장 길었던 날의 취침·기상 시각을 확인하고, 그날의 컨디션을 다른 날과 비교해 보세요.';
    else sleepTip='컨디션이 좋았던 날의 취침·기상 시각을 확인하고, 다른 날과 어떤 차이가 있었는지 비교해 보세요.';
    text+='\n💡 실천 제안\n1. '+caffeineTip+'\n2. '+sleepTip;
  }
  return text;
}

function getStudentAnalysisPeriod_(startDate, endDate) {
  if (startDate == null && endDate == null) {
    endDate = Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd");
    const start = new Date(endDate + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - 6);
    startDate = start.toISOString().slice(0, 10);
  }
  function validDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(value + 'T00:00:00Z');
    return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }
  if (!validDate(startDate) || !validDate(endDate)
      || new Date(endDate + 'T00:00:00Z') - new Date(startDate + 'T00:00:00Z') !== 6 * 86400000) {
    throw new Error('INVALID_PERIOD');
  }
  return { start: startDate, end: endDate };
}

function generateAIHealthReport(studentId, name, weekCaffeineTotal, avgCaffeine, avgSleep, weight, limit, startDate, endDate, reportVersion) {
  let period;
  try {period=getStudentAnalysisPeriod_(startDate,endDate);}catch(_error){return {success:false,errorCode:'INVALID_PERIOD',error:'분석 기간을 다시 선택해주세요.'};}
  if (reportVersion === 2) {
    const student = { id: normalizeOwnerId_(studentId), name: String(name || '').trim() };
    const input = feedbackSourceInput_(feedbackSourceRows_(), student, period.start, period.end,
      feedbackClassGoals_(student, feedbackClassRows_()), { audience: 'student', caffeineLimitMg: Number(limit) || 150 });
    const engine = buildFeedbackReport_(input);
    return { success: true, source: 'Rule', policyVersion: SleepRecordPolicy.version,
      recordedDays: engine.findings.find(finding => finding.id === 'recordHabit').data.count,
      analysis: buildRecordFeedback_({ feedbackEngine: engine }), sections: engine.sections,
      featuredFindingIds: engine.featuredFindingIds, references: engine.references };
  }
  const data=getWeeklyDetailedData(studentId,period.start,period.end);
  return {success:true,source:'Rule',policyVersion:'2026-10-14',recordedDays:data.recordedDays,
    analysis:buildRecordFeedback_(data,Number(limit)||150,false,period.start+' ~ '+period.end)};
}

function getInsufficientDataMessage(recordedDays, totalDays, avgCaffeine, avgSleep, caffeineCount, sleepCount) {
  safeLog_('⚠️ 데이터 부족 메시지 생성');
  safeLog_(`카페인: ${caffeineCount}일, 수면: ${sleepCount}일`);

  // 프론트엔드 카드 렌더러가 파싱할 수 있는 구조화된 마커 형식으로 반환
  const cafNeed = Math.max(0, 3 - caffeineCount);
  const slpNeed = Math.max(0, 3 - sleepCount);

  let message = `__INSUFFICIENT__\n`;
  message += `☕:${caffeineCount}:${cafNeed}\n`;
  message += `😴:${sleepCount}:${slpNeed}\n`;
  if (caffeineCount > 0) message += `__CAF_AVG__:${Math.round(avgCaffeine)}\n`;
  if (sleepCount > 0)    message += `__SLP_AVG__:${avgSleep.toFixed(1)}\n`;

  return message;
}

// ============================================
// 대체 분석 메시지 (예시 구조 기반 - ☕ 😴 💪 섹션 형식)
// ============================================

function getStructuredFallbackAnalysis(avgCaffeine, avgSleep, limit, weekTotal, caffeineCount, sleepCount, totalDays, overCaffeineDays) {
  return buildRecordFeedback_({caffeineRecordedDays:caffeineCount,sleepRecordedDays:sleepCount,caffeineTotal:avgCaffeine*caffeineCount,sleepTotal:avgSleep*sleepCount,totalDays:totalDays||7,overCaffeineDays:overCaffeineDays||[]},limit,false,'조회 기간');
}

function getBadgeThresholds() {
  try {
    const props = PropertiesService.getScriptProperties();
    return {
      success: true,
      habitStart:     parseInt(props.getProperty('BADGE_HABIT_DAYS')   || '3'),
      streak:         parseInt(props.getProperty('BADGE_STREAK_DAYS')  || '7'),
      monthly:        parseInt(props.getProperty('BADGE_MONTHLY_DAYS') || '10'),
      habitStartName: props.getProperty('BADGE_HABIT_NAME')   || '습관의 시작',
      streakName:     props.getProperty('BADGE_STREAK_NAME')  || '꾸준한 습관',
      monthlyName:    props.getProperty('BADGE_MONTHLY_NAME') || '챌린지 달성'
    };
  } catch(e) {
    return {
      success: false, error: e.message,
      habitStart: 3, streak: 7, monthly: 10,
      habitStartName: '습관의 시작', streakName: '꾸준한 습관', monthlyName: '챌린지 달성'
    };
  }
}

function saveBadgeThresholds(habitStart, streak, monthly, habitStartName, streakName, monthlyName) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('BADGE_HABIT_DAYS',   String(parseInt(habitStart) || 3));
    props.setProperty('BADGE_STREAK_DAYS',  String(parseInt(streak)     || 7));
    props.setProperty('BADGE_MONTHLY_DAYS', String(parseInt(monthly)    || 10));
    if (habitStartName !== undefined) props.setProperty('BADGE_HABIT_NAME',   String(habitStartName).trim() || '습관의 시작');
    if (streakName     !== undefined) props.setProperty('BADGE_STREAK_NAME',  String(streakName).trim()     || '꾸준한 습관');
    if (monthlyName    !== undefined) props.setProperty('BADGE_MONTHLY_NAME', String(monthlyName).trim()    || '챌린지 달성');
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// 수면 기준 설정 (연령대별: 청소년/성인)
// ============================================

function getSleepSettings(strictRead) {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('SLEEP_SETTINGS');
    if (raw) return { success: true, settings: JSON.parse(raw) };
    return { success: true, settings: { ageGroup: 'teen', sleepSevere: 7, sleepWarn: 8, sleepGood: 10, sleepMax: 11 } };
  } catch(e) {
    if (strictRead) throw e;
    return { success: false, error: e.message, settings: { ageGroup: 'teen', sleepSevere: 7, sleepWarn: 8, sleepGood: 10, sleepMax: 11 } };
  }
}

function saveSleepSettings(settings) {
  try {
    PropertiesService.getScriptProperties().setProperty('SLEEP_SETTINGS', JSON.stringify(settings));
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ---------------------------------------------------------------------------
// Teacher message attachments / PDF delivery
// Shared message helpers preserve attachment metadata for both dashboards.
// ---------------------------------------------------------------------------
function ensureTeacherMessageSheet_() {
  const ss = getSpreadsheet_();
  let sheet = ss.getSheetByName('teacher_messages');
  const headers = [
    'timestamp', 'studentId', 'studentName', 'title', 'content',
    'readStatus', 'readTime', 'studentReply', 'studentReplyTime', 'studentReplyRead',
    'attachmentName', 'attachmentUrl', 'attachmentType'
  ];
  if (!sheet) {
    sheet = ss.insertSheet('teacher_messages');
    appendRecordRow_(sheet, headers);
    return sheet;
  }
  const width = sheet.getLastColumn();
  if (width < headers.length) {
    sheet.getRange(1, width + 1, 1, headers.length - width).setValues([headers.slice(width)]);
  }
  return sheet;
}

function formatTeacherMsgDate_(value) {
  if (!value) return '';
  return value instanceof Date
    ? Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss')
    : String(value);
}

function messageDigest_(parts) {
  const values = parts.map(value => value instanceof Date ? value.toISOString()
    : String(value === null || value === undefined ? '' : value));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(values), Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

// Include original message/attachment fields, never mutable read/reply columns.
function teacherMessageKey_(row) {
  return messageDigest_([0, 1, 2, 3, 4, 10, 11, 12].map(index => row[index]));
}

function studentReplyKey_(row) {
  return messageDigest_([teacherMessageKey_(row), row[7], row[8]]);
}

function messageTargetChanged_() {
  return { success: false, code: 'MESSAGE_TARGET_CHANGED',
    error: '메시지가 삭제 또는 변경되었거나 동일한 메시지가 여러 건 있습니다. 목록을 확인한 뒤 다시 선택하세요.' };
}

// Mutation gateway holds the shared script lock while resolving and writing.
function resolveTeacherMessageRow_(sheet, rowIndex, expectedKey) {
  if (!sheet || !Number.isInteger(rowIndex) || rowIndex < 2 || typeof expectedKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedKey)) return 0;
  const rows = sheet.getDataRange().getValues();
  let found = 0;
  for (let i = 1; i < rows.length; i++) {
    if (teacherMessageKey_(rows[i]) !== expectedKey) continue;
    if (found) return 0;
    found = i + 1;
  }
  return found;
}

function readTeacherMessageRow_(row, rowIndex, includeStudent) {
  const item = {
    rowIndex: rowIndex,
    messageKey: teacherMessageKey_(row),
    timestamp: formatTeacherMsgDate_(row[0]),
    title: String(row[3] || ''),
    content: String(row[4] || ''),
    readStatus: String(row[5] || '미읽음'),
    readTime: formatTeacherMsgDate_(row[6]),
    studentReply: String(row[7] || ''),
    studentReplyTime: formatTeacherMsgDate_(row[8]),
    studentReplyRead: String(row[9] || ''),
    attachmentName: String(row[10] || ''),
    attachmentUrl: row[12] === 'privatePdf' ? '' : String(row[11] || ''),
    attachmentType: String(row[12] || '')
  };
  if (includeStudent) {
    item.studentId = String(row[1] || '');
    item.studentName = String(row[2] || '');
  }
  return item;
}

function sendTeacherMessage(data) {
  try {
    const attachmentType = data.attachmentType === 'pdf' || data.attachmentType === 'link' ? data.attachmentType : '';
    const sheet = ensureTeacherMessageSheet_();
    const ts = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    appendRecordRow_(sheet, [
      ts,
      String(data.studentId),
      String(data.studentName),
      String(data.title),
      String(data.content),
      '미읽음',
      '',
      '',
      '',
      '',
      String(data.attachmentName || ''),
      String(data.attachmentUrl || ''),
      attachmentType
    ]);
    return { success: true };
  } catch (err) {
    safeLog_('sendTeacherMessage error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function getSentTeacherMessages() {
  try {
    const sheet = ensureTeacherMessageSheet_();
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      result.push(readTeacherMessageRow_(rows[i], i + 1, true));
    }
    result.reverse();
    return { success: true, data: result };
  } catch (err) {
    safeLog_('getSentTeacherMessages error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function getTeacherMessages(studentId, studentName) {
  try {
    const sheet = ensureTeacherMessageSheet_();
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const matches = rows[i][12] === 'privatePdf'
        ? privateReportOwnerMatches_(rows[i], studentId, studentName)
        : normalizeId(rows[i][1]) === normalizeId(studentId);
      if (matches) {
        result.push(readTeacherMessageRow_(rows[i], i + 1, false));
      }
    }
    result.reverse();
    return { success: true, data: result };
  } catch (err) {
    safeLog_('getTeacherMessages error: ' + err.message);
    return { success: false, error: err.message };
  }
}

function saveTeacherPdfAndSendMessage(data) {
  try {
    const dates = String(data?.fileName || '').match(/_(\d{4}-\d{2}-\d{2})_(\d{4}-\d{2}-\d{2})\.pdf$/i);
    const today = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd').slice(0, 10);
    return sendPrivateTeacherReport({ ...data, start: dates?.[1] || today, end: dates?.[2] || today,
      deliveryId: Utilities.getUuid() });
  } catch (err) {
    safeLog_('saveTeacherPdfAndSendMessage error: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ============================================
// 뱃지 설정 v2 — 연속/누적 타입 지원
// ============================================

/**
 * 뱃지 설정 반환
 * config 형식: {
 *   challengeName: string,
 *   badges: [{ id, type('streak'|'count'), days, name, emoji, color, bg }, ...]
 * }
 */
function getBadgeConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('BADGE_CONFIG_V2');
    if (raw) {
      return { success: true, config: JSON.parse(raw) };
    }
    // 기본 설정 (구버전 설정값 반영)
    const habitDays   = parseInt(props.getProperty('BADGE_HABIT_DAYS')   || '3');
    const streakDays  = parseInt(props.getProperty('BADGE_STREAK_DAYS')  || '7');
    const monthlyDays = parseInt(props.getProperty('BADGE_MONTHLY_DAYS') || '10');
    const habitName   = props.getProperty('BADGE_HABIT_NAME')   || '습관의 시작';
    const streakName  = props.getProperty('BADGE_STREAK_NAME')  || '꾸준한 습관';
    const monthlyName = props.getProperty('BADGE_MONTHLY_NAME') || '챌린지 달성';
    return {
      success: true,
      config: {
        challengeName: '건강 챌린지',
        badges: [
          { id: 'b1', type: 'streak', days: habitDays,   name: habitName,   emoji: '🌱', color: '#059669', bg: '#ecfdf5' },
          { id: 'b2', type: 'streak', days: streakDays,  name: streakName,  emoji: '🏆', color: '#d97706', bg: '#fffbeb' },
          { id: 'b3', type: 'count',  days: monthlyDays, name: monthlyName, emoji: '🌟', color: '#7c3aed', bg: '#f5f3ff' }
        ]
      }
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * 뱃지 설정 저장
 * @param {Object} configJson  { challengeName, badges: [...] }
 */
function saveBadgeConfig(configJson) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('BADGE_CONFIG_V2', JSON.stringify(configJson));
    return { success: true };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

// ============================================
// 챌린지 뱃지 설정 v3 — 교사 승인 방식 + 카페인/수면/기간 지원
// ============================================

/**
 * 챌린지 뱃지 설정 v3 반환
 * config 형식: {
 *   challengeName: string,
 *   challengeStart: string (YYYY-MM-DD),
 *   challengeEnd: string (YYYY-MM-DD),
 *   badges: [{ id, name, image, bg, color,
 *              type: 'caffeine'|'sleep'|'both',
 *              method: 'consecutive'|'cumulative',
 *              days }, ...]
 * }
 */
function getChallengeBadgeConfig() {
  try {
    const props = PropertiesService.getScriptProperties();
    const raw = props.getProperty('BADGE_CONFIG_V3');
    if (raw) {
      return { success: true, config: JSON.parse(raw) };
    }
    // v3 없으면 v2에서 변환 (하위 호환)
    const v2Raw = props.getProperty('BADGE_CONFIG_V2');
    if (v2Raw) {
      const v2 = JSON.parse(v2Raw);
      const v3 = {
        challengeName: v2.challengeName || '건강 챌린지',
        challengeStart: '',
        challengeEnd: '',
        badges: (v2.badges || []).map(function(b) {
          return {
            id: b.id,
            name: b.name,
            image: b.emoji || '🏅',
            bg: b.bg || '#f5f3ff',
            color: b.color || '#7c3aed',
            type: 'caffeine',
            method: b.type === 'streak' ? 'consecutive' : 'cumulative',
            days: b.days || 3
          };
        })
      };
      return { success: true, config: v3 };
    }
    // 기본값 (미설정)
    return {
      success: true,
      config: { challengeName: '', challengeStart: '', challengeEnd: '', badges: [] }
    };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

/**
 * 챌린지 뱃지 설정 v3 저장
 * @param {Object} config  { challengeName, challengeStart, challengeEnd, badges: [...] }
 */
function saveChallengeBadgeConfig(config) {
  try {
    const props = PropertiesService.getScriptProperties();
    props.setProperty('BADGE_CONFIG_V3', JSON.stringify(config));
    safeLog_('✅ saveChallengeBadgeConfig 저장 완료: ' + config.challengeName);
    return { success: true };
  } catch(e) {
    safeLog_('❌ saveChallengeBadgeConfig 오류: ' + e.message);
    return { success: false, error: e.message };
  }
}

// ── 승인 대기 / 기각 / 수여설정 GAS 동기화 ─────────────────
function getPendingBadges() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('PENDING_BADGES');
    return { success: true, data: raw ? JSON.parse(raw) : [] };
  } catch(e) { return { success: false, error: e.message, data: [] }; }
}
function savePendingBadgesData(data) {
  try {
    PropertiesService.getScriptProperties().setProperty('PENDING_BADGES', JSON.stringify(data));
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}
function getDismissedBadges() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('DISMISSED_BADGES');
    return { success: true, data: raw ? JSON.parse(raw) : [] };
  } catch(e) { return { success: false, error: e.message, data: [] }; }
}
function saveDismissedBadgesData(data) {
  try {
    PropertiesService.getScriptProperties().setProperty('DISMISSED_BADGES', JSON.stringify(data));
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}
function getAwardSettings() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty('AWARD_SETTINGS');
    return { success: true, data: raw ? JSON.parse(raw) : null };
  } catch(e) { return { success: false, error: e.message, data: null }; }
}
function saveAwardSettingsData(data) {
  try {
    PropertiesService.getScriptProperties().setProperty('AWARD_SETTINGS', JSON.stringify(data));
    return { success: true };
  } catch(e) { return { success: false, error: e.message }; }
}

// ============================================
// AI 분석 결과 저장/불러오기 (교사가 수정한 내용 → 시트에 보관)
// ============================================
// 컬럼 순서: A=이름, B=학번, C=시작일, D=종료일, E=내용, F=저장일시

function stripHtmlForSheet(html) {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function saveAIReport(studentId, startDate, endDate, content, name) {
  try {
    const ss    = getSpreadsheet_();
    let sheet   = ss.getSheetByName('ai_reports');
    if (!sheet) {
      sheet = ss.insertSheet('ai_reports');
      appendRecordRow_(sheet, ['이름', '학번', '시작일', '종료일', '내용', '저장일시']);
      sheet.setFrozenRows(1);
    }
    const now  = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    const sid  = String(studentId);
    const sname = String(name || '');
    const cleanContent = stripHtmlForSheet(String(content || ''));
    sheet.getRange(1,7).setValue('정책버전');
    // 기존 행 찾아 덮어쓰기 (학번+시작일+종료일 기준)
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (String(data[i][1]) === sid && String(data[i][2]) === startDate && String(data[i][3]) === endDate) {
        // 이름도 최신화, 내용·저장일시 갱신
        sheet.getRange(i + 1, 1, 1, 7).setValues([[sname, sid, startDate, endDate, cleanContent, now, '2026-10-14']]);
        return { success: true, action: 'updated' };
      }
    }
    // 없으면 새 행 추가
    appendRecordRow_(sheet, [sname, sid, startDate, endDate, cleanContent, now, '2026-10-14']);
    return { success: true, action: 'inserted' };
  } catch(e) {
    return { success: false, error: e.message };
  }
}

function getAIReport(studentId, startDate, endDate) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = ss.getSheetByName('ai_reports');
    if (!sheet) return { success: true, content: null };
    const sid  = String(studentId);
    const data = sheet.getDataRange().getValues();
    // 헤더가 이름/학번 순인지 학번 순인지 자동 감지
    const isNewFormat = data.length > 0 && String(data[0][0]) === '이름';
    for (let i = data.length - 1; i >= 1; i--) {
      if (isNewFormat) {
        // 새 형식: B=학번(1), C=시작일(2), D=종료일(3), E=내용(4), F=저장일시(5)
        if (String(data[i][1]) === sid && String(data[i][2]) === startDate && String(data[i][3]) === endDate) {
          return { success: true, content: String(data[i][4]), savedAt: String(data[i][5]), policyVersion:String(data[i][6]||''), studentName: String(data[i][0] || '').trim() };
        }
      } else {
        // 구 형식: A=학번(0), B=시작일(1), C=종료일(2), D=내용(3), E=저장일시(4)
        if (String(data[i][0]) === sid && String(data[i][1]) === startDate && String(data[i][2]) === endDate) {
          return { success: true, content: String(data[i][3]), savedAt: String(data[i][4]) };
        }
      }
    }
    return { success: true, content: null };
  } catch(e) {
    return { success: false, error: e.message, content: null };
  }
}

// 편집기 전용 분석 시험. 실존 학생 조회/저장 없이 고정 가상 기록만 사용합니다.
function testAIAnalysis() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/script.external_request"]);
  const payload = {
    studentId: "fictional-analysis-fixture", name: "실존 인물이 아닌 가상 자료",
    weight: 60, limit: 150, startDate: "2000-01-01", endDate: "2000-01-03",
    caffeineData: { topReasons: "가상 응답: 기호", topSymptoms: "없음" },
    sleepData: { topPhone: "안 함", topActivity: "30분 미만", topLatency: "15분 이내", topWake: "0회", topDrowsy: "없음" }
  };
  const weekly = {
    caffeineRecordedDays: 3, sleepRecordedDays: 3, recordedDays: 3, totalDays: 3,
    caffeineTotal: 150, sleepTotal: 24.5, overCaffeineDays: [],
    details: "모든 수치는 검증을 위해 만든 가상 기록입니다.\n2000-01-01: 카페인 0mg, 수면 8시간\n2000-01-02: 카페인 50mg, 수면 8시간\n2000-01-03: 카페인 100mg, 수면 8.5시간"
  };
  const models = [getTeacherAnalysisModel_(), "gemini-3.5-flash-lite"];
  const report = { fictionalDataOnly: true, results: [] };
  models.forEach(function(model) {
    const result = analyzeTeacherHealthData_(payload, weekly, model, 1);
    report.results.push({model: model, source: result.source || "ERROR", httpStatus: result.httpStatus || null, errorCode: result.errorCode || null, analysis: result.analysis || ""});
  });
  console.info(JSON.stringify(report));
  return report;
}

// 수면 로그 테스트 함수
function testSleepLogs(studentId) {
  if (!studentId) throw new Error('STUDENT_ID_REQUIRED');
  safeLog_("=== 수면 로그 테스트 시작 ===");
  safeLog_("학번: " + studentId);

  const logs = getSleepLogs(studentId);

  safeLog_("=== 결과 ===");
  safeLog_("총 로그 개수: " + logs.length);

  if (logs.length > 0) {
    safeLog_("첫 번째 로그:");
    safeLog_(JSON.stringify(logs[0], null, 2));
  } else {
    safeLog_("로그가 없습니다!");
  }
}

// 카페인 로그 테스트 함수
function testCaffeineLogs(studentId) {
  if (!studentId) throw new Error('STUDENT_ID_REQUIRED');
  safeLog_("=== 카페인 로그 테스트 시작 ===");
  safeLog_("학번: " + studentId);

  const logs = getCaffeineLogs(studentId);

  safeLog_("=== 결과 ===");
  safeLog_("총 로그 개수: " + logs.length);

  if (logs.length > 0) {
    safeLog_("첫 번째 로그:");
    safeLog_(JSON.stringify(logs[0], null, 2));
  } else {
    safeLog_("로그가 없습니다!");
  }
}

// ============================================
// 학번 자동 생성 관련 함수
// ============================================

// 수동으로 모든 학생의 학번 생성 (한 번만 실행)
function generateAllStudentIds() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("students");

    if (!sheet) {
      safeLog_('students 시트를 찾을 수 없습니다');
      return;
    }

    const lastRow = sheet.getLastRow();
    let updateCount = 0;

    for (let row = 2; row <= lastRow; row++) {
      const grade = sheet.getRange(row, 1).getValue();    // A: 학년
      const classNum = sheet.getRange(row, 2).getValue(); // B: 반
      const number = sheet.getRange(row, 3).getValue();   // C: 번호

      if (grade && classNum && number) {
        const studentId = String(grade) + String(classNum) + String(number).padStart(2, '0');
        sheet.getRange(row, 5).setValue(Number(studentId)); // E: 학번 ID
        updateCount++;
        safeLog_(`${row}행: ${grade}학년 ${classNum}반 ${number}번 → 학번 ${studentId}`);
      }
    }

    safeLog_(`총 ${updateCount}개의 학번이 생성되었습니다.`);
  } catch (error) {
    safeLog_('학번 생성 오류: ' + error);
  }
}

// ============================================
// 테스트 함수들
// ============================================

// 연결 테스트
function testConnection() {
  safeLog_('testConnection 호출됨');
  return {
    success: true,
    message: 'Google Apps Script 연결 성공!',
    timestamp: new Date().toISOString()
  };
}

// 간단한 객체 저장 테스트
function testSaveSimple(data) {
  safeLog_('=== testSaveSimple 시작 ===');
  safeLog_('받은 데이터 타입: ' + typeof data);
  safeLog_('받은 데이터: ' + JSON.stringify(data));

  if (!data) {
    safeLog_('❌ data가 undefined입니다');
    throw new Error('데이터가 전달되지 않았습니다');
  }

  if (!data.studentId) {
    safeLog_('❌ data.studentId가 없습니다');
    throw new Error('studentId가 없습니다');
  }

  safeLog_('✅ 데이터 검증 성공');

  return {
    success: true,
    receivedData: data,
    message: '데이터를 성공적으로 받았습니다'
  };
}

// saveSleepData 디버깅 버전
function saveSleepDataDebug(payload) {
  safeLog_('=== saveSleepDataDebug 시작 ===');
  safeLog_('Arguments 개수: ' + arguments.length);
  safeLog_('payload 타입: ' + typeof payload);
  safeLog_('payload 값: ' + JSON.stringify(payload));

  // 각 필드 개별 확인
  const fields = ['studentId', 'name', 'date', 'sleepTime', 'wakeTime', 'hours', 'condition', 'memo', 'id'];
  const report = {};

  if (payload) {
    fields.forEach(field => {
      report[field] = {
        exists: payload.hasOwnProperty(field),
        type: typeof payload[field],
        value: payload[field]
      };
    });
  } else {
    report.error = 'payload is null or undefined';
  }

  safeLog_('필드 분석: ' + JSON.stringify(report, null, 2));

  return {
    success: true,
    analysis: report,
    rawPayload: payload
  };
}

// 수면 저장 단순화 버전 (디버깅용)
function saveSleepDataSimple(studentId, name, date, sleepTime, wakeTime, hours, condition, memo, id) {
  safeLog_('=== saveSleepDataSimple (개별 파라미터) ===');
  safeLog_(`studentId: ${studentId}`);
  safeLog_(`name: ${name}`);
  safeLog_(`date: ${date}`);

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("sleep");

  if (!sheet) {
    throw new Error("수면 시트를 찾을 수 없습니다.");
  }

  const kstTimestamp = getKSTTimestamp();
  const p = parseStudentId(studentId);

  appendRecordRow_(sheet, [
    kstTimestamp,
    p.grade,
    p.class,
    p.number,
    studentId,
    name,
    date,
    sleepTime,
    wakeTime,
    hours,
    condition,
    memo || '',
    id || Date.now()
  ]);

  return { success: true, message: '저장 완료' };
}

// ============================================
// 중복 데이터 테스트 함수
// ============================================

// 특정 학번의 수면 데이터 확인
function checkSleepDataForStudent(testStudentId, testDate) {
  if (!testStudentId) throw new Error('STUDENT_ID_REQUIRED');
  if (!testDate) throw new Error('DATE_REQUIRED');

  safeLog_(`=== 수면 데이터 확인: 학번=${testStudentId}, 날짜=${testDate} ===`);

  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("sleep");

  if (!sheet) {
    safeLog_("❌ sleep 시트 없음");
    return;
  }

  const data = sheet.getDataRange().getValues();
  safeLog_(`총 데이터 행 수: ${data.length - 1}`);

  let foundCount = 0;

  for (let i = 1; i < data.length; i++) {
    const rowStudentId = normalizeId(data[i][4]);
    const rowDateRaw = data[i][6];

    let rowDate = '';
    if (rowDateRaw instanceof Date) {
      rowDate = Utilities.formatDate(rowDateRaw, "Asia/Seoul", "yyyy-MM-dd");
    } else {
      rowDate = String(rowDateRaw).trim();
    }

    if (rowStudentId === testStudentId) {
      safeLog_(`\nRow ${i + 1}:`);
      safeLog_(`  날짜: ${rowDate}`);
      safeLog_(`  취침: ${data[i][7]}`);
      safeLog_(`  기상: ${data[i][8]}`);
      safeLog_(`  시간: ${data[i][9]}시간`);
      safeLog_(`  컨디션: ${data[i][10]}`);
      safeLog_(`  메모: ${data[i][11]}`);

      if (rowDate === testDate) {
        safeLog_(`  ⭐ 대상 날짜와 일치!`);
        foundCount++;
      }
    }
  }

  safeLog_(`\n${testDate} 날짜의 데이터: ${foundCount}개`);
  if (foundCount > 1) {
    safeLog_(`⚠️ 중복 데이터 발견! ${foundCount}개가 있습니다.`);
  }
}

// 중복 제거 실행
function removeDuplicateSleepData() {
  const ss = getSpreadsheet_();
  const sheet = ss.getSheetByName("sleep");

  if (!sheet) {
    safeLog_("❌ sleep 시트 없음");
    return;
  }

  safeLog_("=== 중복 데이터 제거 시작 ===");

  const data = sheet.getDataRange().getValues();
  const seen = new Set();
  const rowsToDelete = [];

  for (let i = data.length - 1; i >= 1; i--) {
    const studentId = normalizeId(data[i][4]);
    const dateRaw = data[i][6];

    let date = '';
    if (dateRaw instanceof Date) {
      date = Utilities.formatDate(dateRaw, "Asia/Seoul", "yyyy-MM-dd");
    } else {
      date = String(dateRaw).trim();
    }

    const key = `${studentId}-${date}`;

    if (seen.has(key)) {
      safeLog_(`중복 발견: Row ${i + 1} - ${key}`);
      rowsToDelete.push(i + 1);
    } else {
      seen.add(key);
    }
  }

  safeLog_(`\n삭제할 행 수: ${rowsToDelete.length}`);

  // 뒤에서부터 삭제 (인덱스 변화 방지)
  rowsToDelete.forEach(rowIndex => {
    safeLog_(`Row ${rowIndex} 삭제`);
    sheet.deleteRow(rowIndex);
  });

  safeLog_("✅ 중복 제거 완료");
}

// ============================================
// AI 이미지 분석 기능 (Gemini Vision API)
// ============================================

// ============================================================
// 공공데이터 포털 식약처 카페인 DB API
// ============================================================

/**
 * 공공데이터 포털 카페인 DB API 키 저장 (최초 1회 실행)
 * Apps Script 편집기에서 직접 실행하세요.
 */
function setCaffeinePublicAPIKey() {
  // ⚠️ 보안상 API 키를 코드에 직접 입력하지 마세요.
  // Apps Script 편집기 → 프로젝트 설정(⚙️) → 스크립트 속성 탭에서
  // 속성: CAFFEINE_PUBLIC_API_KEY / 값: 공공데이터 포털 API 키 를 직접 등록하세요.
  const apiKey = PropertiesService.getScriptProperties().getProperty("CAFFEINE_PUBLIC_API_KEY");
  if (!apiKey) {
    safeLog_("❌ API 키가 스크립트 속성에 설정되지 않았습니다.");
    safeLog_("   Apps Script → 프로젝트 설정 → 스크립트 속성에서 CAFFEINE_PUBLIC_API_KEY를 추가하세요.");
    return;
  }
  safeLog_("✅ 공공데이터 포털 카페인 DB API 키 확인 완료");
}

/**
 * 식품의약품안전처 카페인 함량 DB API 내부 호출
 * @param {string} foodName - 검색할 식품/음료명
 * @param {number} numOfRows - 결과 개수 (기본 10)
 * @returns {Object} { success, data: [{foodName, caffeineAmount, caffeinePerServing, servingSize, maker, category}] }
 */
function searchCaffeineDBAPI(foodName, numOfRows) {
  try {
    numOfRows = numOfRows || 10;
    const apiKey = PropertiesService.getScriptProperties().getProperty("CAFFEINE_PUBLIC_API_KEY");
    if (!apiKey) {
      safeLog_("❌ 공공데이터 API 키 없음 → setCaffeinePublicAPIKey() 실행 필요");
      return { success: false, error: "API 키 미설정", data: [] };
    }

    // 한글 키워드 인코딩
    const encodedName = encodeURIComponent(foodName);
    const url = "https://apis.data.go.kr/B553748/CaffeineInfo/getCaffeineInfo"
      + "?serviceKey=" + apiKey
      + "&type=json"
      + "&pageNo=1"
      + "&numOfRows=" + numOfRows
      + "&food_Nm=" + encodedName;

    safeLog_("📡 공공DB 호출: " + foodName);

    const response = UrlFetchApp.fetch(url, { method: "get", muteHttpExceptions: true });
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();
    safeLog_("공공DB 응답코드: " + responseCode);

    if (responseCode !== 200) {
      safeLog_("❌ 공공DB 오류: " + responseText.substring(0, 200));
      return { success: false, error: "API 오류 " + responseCode, data: [] };
    }

    let parsed;
    try {
      parsed = JSON.parse(responseText);
    } catch (e) {
      safeLog_("공공DB JSON 파싱 실패: " + responseText.substring(0, 300));
      return { success: false, error: "응답 파싱 실패", data: [] };
    }

    // 응답 구조: { response: { body: { items: { item: [...] }, totalCount } } }
    const body = parsed && parsed.response && parsed.response.body;
    if (!body) return { success: false, error: "응답 구조 오류", data: [] };

    const totalCount = parseInt(body.totalCount) || 0;
    if (totalCount === 0) {
      safeLog_("공공DB 결과 없음: " + foodName);
      return { success: true, data: [], totalCount: 0 };
    }

    let items = body.items && body.items.item;
    if (!items) return { success: true, data: [], totalCount: 0 };
    if (!Array.isArray(items)) items = [items]; // 1건이면 객체로 옴

    const results = items.map(function(item) {
      const caffeineBase    = parseFloat(item.caffein_Amount         || 0); // 100ml/g 기준 mg
      const caffeineServing = parseFloat(item.caffein_AmountPerServ  || 0); // 1회분 mg
      return {
        foodName:          String(item.food_Nm  || "").trim(),
        caffeineAmount:    caffeineBase,
        caffeinePerServing: caffeineServing,
        servingSize:       String(item.serv_Wt  || "").trim(), // 1회 제공량
        maker:             String(item.comp_Nm  || "").trim(), // 제조사
        category:          String(item.food_Cls || "").trim(), // 식품분류
        reportYear:        String(item.rpt_Yr   || "").trim()  // 보고연도
      };
    });

    safeLog_("✅ 공공DB " + results.length + "건 (전체 " + totalCount + "건)");
    return { success: true, data: results, totalCount: totalCount };

  } catch (error) {
    safeLog_("❌ searchCaffeineDBAPI 오류: " + error);
    return { success: false, error: error.toString(), data: [] };
  }
}

/**
 * 음료명 검색 - Gemini AI 1차 + 식약처 공공DB 2차 병합
 * AI가 폭넓게 먼저 검색, 공공DB 결과가 있으면 앞에 추가
 * @param {string} keyword
 * @returns {Object} { success, results: [{name, caffeine, maker, serving, category, source}] }
 */
function searchDrinkCaffeine(keyword) {
  try {
    if (!keyword || keyword.trim().length < 1) {
      return { success: true, results: [] };
    }
    keyword = keyword.trim();
    safeLog_("검색 키워드: [" + keyword + "]");

    // 1차: Gemini AI 검색 (항상 실행 - 가장 빠르고 넓은 커버리지)
    var aiResults = [];
    try {
      aiResults = searchDrinkCaffeineWithAI(keyword) || [];
      safeLog_("AI 결과: " + aiResults.length + "건");
    } catch (aiErr) {
      safeLog_("AI 검색 오류(무시): " + aiErr);
    }

    // 2차: 식약처 공공DB 검색 (성공하면 앞에 추가)
    var dbResults = [];
    try {
      var dbResult = searchCaffeineDBAPI(keyword, 5);
      if (dbResult && dbResult.success && dbResult.data && dbResult.data.length > 0) {
        safeLog_("공공DB 결과: " + dbResult.data.length + "건");
        dbResults = dbResult.data.map(function(item) {
          var caffeine = item.caffeinePerServing > 0
            ? Math.round(item.caffeinePerServing)
            : Math.round(item.caffeineAmount);
          return {
            name:     item.foodName,
            caffeine: caffeine,
            maker:    item.maker,
            serving:  item.servingSize,
            category: item.category,
            source:   "db"
          };
        });
      }
    } catch (dbErr) {
      safeLog_("공공DB 오류(무시): " + dbErr);
    }

    // DB 결과 먼저, AI 결과 뒤에 (중복 이름 제거)
    var seen = {};
    var merged = [];
    dbResults.forEach(function(item) {
      var key = (item.name || "").replace(/\s/g, "").toLowerCase();
      if (key && !seen[key]) { seen[key] = true; merged.push(item); }
    });
    aiResults.forEach(function(item) {
      var key = (item.name || "").replace(/\s/g, "").toLowerCase();
      if (key && !seen[key]) { seen[key] = true; merged.push(item); }
    });

    safeLog_("최종: " + merged.length + "건 (DB:" + dbResults.length + " AI:" + aiResults.length + ")");
    return { success: true, results: merged, fromDB: dbResults.length > 0 };

  } catch (error) {
    safeLog_("searchDrinkCaffeine 오류: " + error);
    return { success: false, error: error.toString(), results: [] };
  }
}

/**
 * Gemini AI 텍스트 검색 - 한국 시중 음료 카페인 정보 반환
 * @param {string} keyword
 * @returns {Array}
 */
function searchDrinkCaffeineWithAI(keyword) {
  try {
    var apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      safeLog_("Gemini API 키 없음");
      return [];
    }

    var modelName = "gemini-2.0-flash";
    var apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/"
      + modelName + ":generateContent?key=" + apiKey;

    var prompt =
      "당신은 한국 시중 음료의 카페인 함량 전문가입니다.\n"
      + "검색어: \"" + keyword + "\"\n\n"
      + "이 검색어와 관련된 한국 시중 음료 제품을 최대 6개 찾아주세요.\n"
      + "편의점·카페에서 구매 가능한 제품 위주, 브랜드별/용량별 변형도 포함하세요.\n\n"
      + "반드시 아래 JSON 배열 형식만 응답하세요 (설명 없이, 마크다운 없이):\n"
      + "[\n"
      + "  {\n"
      + "    \"name\": \"제품 전체명 (예: 스타벅스 아메리카노 톨 355ml)\",\n"
      + "    \"caffeine\": 카페인mg숫자(1회제공량기준),\n"
      + "    \"maker\": \"브랜드명\",\n"
      + "    \"serving\": \"1회제공량(예: 355ml)\",\n"
      + "    \"category\": \"음료종류(예: 커피음료)\"\n"
      + "  }\n"
      + "]\n\n"
      + "caffeine은 반드시 1회 제공량 기준 mg값. 관련 음료 없으면 [] 반환.";

    var payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        topK: 10,
        topP: 0.8,
        maxOutputTokens: 1000
      }
    };

    safeLog_("Gemini 검색 API 호출 (재시도 포함)...");
    var srchFetchResult   = fetchWithRetry(apiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    }, 3);

    var srchFetchResponse = srchFetchResult.response;
    if (!srchFetchResponse || srchFetchResponse.getResponseCode() !== 200) {
      safeLog_("Gemini 검색 실패: " + (srchFetchResult.errorCode || 'UNKNOWN'));
      return [];
    }

    var responseCode = srchFetchResponse.getResponseCode();
    var responseText = srchFetchResponse.getContentText();
    safeLog_("Gemini 응답코드: " + responseCode);

    var result = JSON.parse(responseText);
    if (!result.candidates || result.candidates.length === 0) {
      safeLog_("Gemini 후보 없음");
      return [];
    }

    var aiText = result.candidates[0].content.parts[0].text.trim();
    safeLog_("Gemini 응답 원문: " + aiText.substring(0, 500));

    // 코드블록 마크다운 제거
    aiText = aiText.replace(/```json\s*/g, "").replace(/```\s*/g, "").trim();

    var aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch (e) {
      // JSON 배열만 추출 시도
      var match = aiText.match(/\[[\s\S]*\]/);
      if (match) {
        try { aiData = JSON.parse(match[0]); }
        catch (e2) { safeLog_("배열 추출 실패"); return []; }
      } else {
        safeLog_("JSON 파싱 실패: " + aiText.substring(0, 100));
        return [];
      }
    }

    if (!Array.isArray(aiData)) {
      safeLog_("결과가 배열이 아님");
      return [];
    }

    var cleaned = [];
    for (var i = 0; i < aiData.length; i++) {
      var item = aiData[i];
      var name = String(item.name || "").trim();
      if (!name) continue;
      cleaned.push({
        name:     name,
        caffeine: Math.round(Math.max(0, parseFloat(item.caffeine) || 0)),
        maker:    String(item.maker    || "").trim(),
        serving:  String(item.serving  || "").trim(),
        category: String(item.category || "").trim(),
        source:   "ai"
      });
    }

    safeLog_("AI 파싱 완료: " + cleaned.length + "건");
    for (var j = 0; j < cleaned.length; j++) {
      safeLog_("  [" + j + "] " + cleaned[j].name + " | " + cleaned[j].caffeine + "mg");
    }
    return cleaned;

  } catch (error) {
    safeLog_("searchDrinkCaffeineWithAI 오류: " + error);
    safeLog_(error.stack || "");
    return [];
  }
}


/**
 * AI 이미지 분석 + 공공DB 교차검증 (개선버전)
 * Gemini로 제품명/카페인 추출 → 공공DB에서 정확한 값 조회
 */
function analyzeDrinkImageWithAI(base64Image) {
  try {
    safeLog_('=== AI 이미지 분석 시작 (공공DB 교차검증 포함) ===');

    const apiKey = PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY");
    if (!apiKey) {
      safeLog_("❌ Gemini API 키 없음");
      return { success: false, error: "API 키가 설정되지 않았습니다" };
    }

    const modelName = "gemini-2.0-flash";
    const apiUrl = "https://generativelanguage.googleapis.com/v1beta/models/" + modelName + ":generateContent?key=" + apiKey;

    // Step 1: Gemini 이미지 분석 - 음료/의약품 모두 카페인 성분 직독
    const prompt = "You are an expert at reading Korean product labels, nutrition facts tables, and pharmaceutical ingredient lists.\n\n"
      + "TARGET: Extract caffeine content from ANY product — beverages (음료), energy drinks, coffee, medicine/pharmaceuticals (의약품), supplements.\n\n"
      + "ANALYSIS PRIORITY (in order):\n"
      + "1. PHARMACEUTICAL INGREDIENT LIST (성분/유효성분표): look for '카페인무수물', '카페인(KP)', '카페인수화물', 'Caffeine anhydrous'\n"
      + "   e.g. '카페인무수물(KP) 50mg' → caffeine=50. Read the mg number directly. -> confidence=high, source=label\n"
      + "2. FRONT LABEL caffeine declaration on beverages: '고카페인함유 (NNNmg/캔)', '카페인 NNNmg', 'caffeine NNNmg'\n"
      + "   -> confidence=high, source=label\n"
      + "3. Nutrition facts table (영양성분표 / Nutrition Facts) - read caffeine row directly\n"
      + "   -> confidence=high, source=label\n"
      + "4. If no caffeine number found but product is identified, use product name for DB search\n"
      + "   -> confidence=medium, source=estimate\n"
      + "5. If nothing identifiable, return caffeine=null\n"
      + "   -> confidence=low, source=estimate\n\n"
      + "KNOWN HINTS: Monster Energy 355ml=100mg, Red Bull 250ml=80mg, Starbucks Doubleshot 200ml=108mg\n"
      + "Common OTC caffeine pills (박카스, 타이레놀이엑스 등) contain 30~50mg caffeine per tablet.\n\n"
      + "Respond ONLY with a valid JSON object, no other text:\n"
      + "{\n"
      + "  \"drinkName\": \"Full product name in Korean (e.g. 몬스터에너지 355ml / 타이레놀이엑스 1정)\",\n"
      + "  \"caffeine\": <total caffeine in mg as a number, or null if not found>,\n"
      + "  \"volume\": \"serving size string e.g. 355ml or 1정, or null\",\n"
      + "  \"confidence\": \"high|medium|low\",\n"
      + "  \"source\": \"label|estimate\",\n"
      + "  \"searchKeyword\": \"short 2-3 word Korean keyword (e.g. 몬스터에너지, 타이레놀이엑스)\"\n"
      + "}\n\n"
      + "confidence: high=caffeine mg read directly from label/ingredient list, medium=product identified, low=unknown\n"
      + "source: label=read from text on product, estimate=inferred\n"
      + "IMPORTANT: If caffeine is listed per tablet/capsule in ingredient list, report that value as caffeine.";

    const geminiPayload = {
      contents: [{
        parts: [
          { text: prompt },
          { inline_data: { mime_type: "image/jpeg", data: base64Image } }  // ⭐ 프론트에서 항상 JPEG로 압축 변환됨
        ]
      }],
      generationConfig: { temperature: 0.1, topK: 10, topP: 0.8, maxOutputTokens: 400 }
    };

    safeLog_('🔍 Gemini API 호출 (재시도 포함)...');
    const imgFetchResult   = fetchWithRetry(apiUrl, {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(geminiPayload),
      muteHttpExceptions: true
    }, 3);

    const imgFetchResponse = imgFetchResult.response;
    const imgErrCode       = imgFetchResult.errorCode;

    if (!imgFetchResponse || imgFetchResponse.getResponseCode() !== 200) {
      const errInfo = getApiErrorInfo(imgErrCode || 'UNKNOWN_ERROR');
      // ⭐ 실제 응답 본문을 로그에 기록 → 400/UNKNOWN_ERROR 원인 파악용
      const errBody = imgFetchResponse ? imgFetchResponse.getContentText().substring(0, 300) : '(응답 없음)';
      safeLog_("❌ 이미지 분석 API 실패: HTTP " + (imgFetchResponse ? imgFetchResponse.getResponseCode() : 'null')
                 + ", errorCode=" + (imgErrCode || 'UNKNOWN_ERROR')
                 + ", body=" + errBody);
      return {
        success:   false,
        error:     errInfo.title + ' — ' + errInfo.desc,
        errorCode: imgErrCode || 'UNKNOWN_ERROR'
      };
    }

    const responseCode = imgFetchResponse.getResponseCode();
    const responseText = imgFetchResponse.getContentText();
    safeLog_("Gemini 응답코드: " + responseCode);

    let geminiResult;
    try {
      geminiResult = JSON.parse(responseText);
    } catch (parseErr) {
      safeLog_("❌ 응답 JSON 파싱 실패: " + responseText.substring(0, 200));
      return { success: false, error: "AI 응답을 해석할 수 없습니다. 다시 시도해주세요.", errorCode: "PARSE_ERROR" };
    }

    // candidates 없는 경우: 이미지 품질 불량, 안전 필터, 할당량 초과 등
    if (!geminiResult.candidates || geminiResult.candidates.length === 0) {
      // promptFeedback 확인 (안전 필터 등)
      const feedback = geminiResult.promptFeedback;
      const blockReason = feedback && feedback.blockReason ? feedback.blockReason : null;
      safeLog_("⚠️ candidates 없음. blockReason=" + blockReason + ", 원문=" + responseText.substring(0, 300));

      if (blockReason === "SAFETY") {
        return { success: false, error: "이미지를 분석할 수 없습니다 (안전 정책).\n음료 라벨/영양성분표 사진을 다시 촬영해주세요.", errorCode: "SAFETY_BLOCK" };
      }
      return { success: false, error: "AI가 이미지를 인식하지 못했습니다.\n📸 사진이 흐리거나 너무 어두우면 다시 촬영해주세요.", errorCode: "NO_CANDIDATES" };
    }

    // finishReason 확인 (MAX_TOKENS, SAFETY 등)
    const finishReason = geminiResult.candidates[0].finishReason;
    if (finishReason === "SAFETY") {
      return { success: false, error: "이미지 분석이 차단되었습니다 (안전 정책).\n음료 라벨 사진을 다시 촬영해주세요.", errorCode: "SAFETY_BLOCK" };
    }
    if (!geminiResult.candidates[0].content || !geminiResult.candidates[0].content.parts) {
      return { success: false, error: "📸 사진이 너무 어둡거나 흐릿합니다. 밝은 곳에서 가까이 다시 촬영해주세요.", errorCode: "EMPTY_CONTENT" };
    }

    let aiText = geminiResult.candidates[0].content.parts[0].text.trim();
    if (aiText.includes("```")) {
      aiText = aiText.replace(/```json/g, "").replace(/```/g, "").trim();
    }

    let aiData;
    try {
      aiData = JSON.parse(aiText);
    } catch (e) {
      safeLog_("AI JSON 파싱 실패. aiText=" + aiText.substring(0, 300));
      // AI가 자연어로 답변한 경우 (이미지 품질 불량 등)
      if (aiText.length > 0) {
        const lower = aiText.toLowerCase();
        if (lower.includes("unclear") || lower.includes("blur") || lower.includes("흐") || lower.includes("불분명") || lower.includes("인식")) {
          return { success: false, error: "📸 사진이 흐릿하거나 너무 어둡습니다.\n밝은 곳에서 성분표에 가까이 대고 다시 촬영해주세요.", errorCode: "BLUR_IMAGE" };
        }
      }
      return { success: false, error: "📸 성분표/영양성분표가 잘 보이도록 다시 촬영해주세요.\n(너무 어둡거나 흔들린 경우 재촬영 필요)", errorCode: "PARSE_FAIL" };
    }

    safeLog_("AI 추출: " + JSON.stringify(aiData));

    // ⭐ null 문자열 정규화: AI가 "null" 문자열을 반환하는 경우 빈 문자열로 치환
    function sanitizeNull(v) {
      if (v === null || v === undefined || v === "null" || v === "undefined") return "";
      return String(v).trim();
    }

    const aiDrinkName = sanitizeNull(aiData.drinkName);
    const aiVolume    = sanitizeNull(aiData.volume);

    // ⭐ 음료/식품 아닌 이미지 감지: drinkName이 비어있고 confidence=low → 잘못된 사진
    if (!aiDrinkName && (aiData.confidence === "low" || !aiData.confidence)) {
      safeLog_("⚠️ 제품 인식 실패 (drinkName 없음, confidence=low) → 재촬영 안내");
      return {
        success:   false,
        error:     "음료나 식품 라벨이 인식되지 않았습니다.\n📸 음료의 영양성분표나 성분표가 잘 보이도록 촬영해주세요.",
        errorCode: "NOT_A_DRINK"
      };
    }

    // Step 2: 영양성분표 직독 (high/label) → 공공DB로 제조사 등 부가 정보만 보강
    if (aiData.confidence === "high" && aiData.source === "label" && aiData.caffeine !== null) {
      safeLog_("✅ 영양성분표 직독 완료 - 공공DB 부가정보 조회");
      let makerInfo = "", servingInfo = "";
      if (aiData.searchKeyword) {
        const dbCheck = searchCaffeineDBAPI(aiData.searchKeyword, 3);
        if (dbCheck.success && dbCheck.data.length > 0) {
          const m = dbCheck.data[0];
          if (m.maker) makerInfo = m.maker;
          if (m.servingSize) servingInfo = m.servingSize;
        }
      }
      const caffeine  = parseInt(aiData.caffeine);
      const volumeStr = aiVolume || servingInfo || "";
      return {
        success:    true,
        drinkName:  aiDrinkName || "제품",
        caffeine:   caffeine,
        volume:     volumeStr,
        maker:      makerInfo,
        confidence: "high",
        source:     "label",
        dbVerified: false,
        analysis:   (aiDrinkName || "제품") + " · " + caffeine + "mg"
                    + (volumeStr ? " · " + volumeStr : "")
                    + " (성분표/영양성분표 직접 확인 ✅)"
      };
    }

    // Step 3: 제품명 기반 추정 → 공공DB 교차검증
    const searchTerm = sanitizeNull(aiData.searchKeyword) || aiDrinkName || "";
    if (searchTerm) {
      safeLog_("📡 공공DB 교차검증: " + searchTerm);
      const dbResult = searchCaffeineDBAPI(searchTerm, 5);

      if (dbResult.success && dbResult.data.length > 0) {
        const best      = dbResult.data[0];
        const caffeine  = best.caffeinePerServing > 0
          ? Math.round(best.caffeinePerServing)
          : Math.round(best.caffeineAmount);
        const volumeStr = best.servingSize || aiVolume || "";

        safeLog_("✅ 공공DB 매칭: " + best.foodName + " " + caffeine + "mg");
        return {
          success:    true,
          drinkName:  best.foodName,
          caffeine:   caffeine,
          volume:     volumeStr,
          maker:      best.maker,
          confidence: "high",
          source:     "database",
          dbVerified: true,
          dbInfo:     { maker: best.maker, serving: best.servingSize, category: best.category },
          analysis:   best.foodName + " · " + caffeine + "mg"
                      + (volumeStr ? " · " + volumeStr : "")
                      + (best.maker ? " · " + best.maker : "")
                      + " (식약처 공공DB 확인 ✅)"
        };
      }
      safeLog_("공공DB 결과 없음 → AI 추정값 사용");
    }

    // Step 4: DB도 없음 → AI 추정값 반환 (낮은 신뢰도 안내 포함)
    const aiCaffeine = (aiData.caffeine !== null && aiData.caffeine !== undefined)
      ? parseInt(aiData.caffeine) : 0;
    let warningMsg = (aiData.confidence === "low")
      ? " ⚠️ 추정치 — 성분표가 잘 보이도록 다시 촬영해주세요"
      : " (AI 추정 — 오차 가능)";

    return {
      success:    true,
      drinkName:  aiDrinkName || "알 수 없는 제품",
      caffeine:   aiCaffeine,
      volume:     aiVolume || "",
      maker:      "",
      confidence: aiData.confidence || "low",
      source:     "estimate",
      dbVerified: false,
      analysis:   (aiDrinkName || "알 수 없는 제품") + " · 약 " + aiCaffeine + "mg"
                  + (aiVolume ? " · " + aiVolume : "")
                  + warningMsg
    };

  } catch (error) {
    safeLog_('❌ analyzeDrinkImageWithAI 오류: ' + error);
    safeLog_('스택: ' + error.stack);
    return { success: false, error: error.toString() };
  }
}

// ── 공공DB API 연결 테스트 ─────────────────────────────────────
function testCaffeineDBSearch() {
  safeLog_("=== 공공DB 검색 테스트 ===");
  ["아메리카노", "레드불", "몬스터", "콜라"].forEach(function(kw) {
    safeLog_("\n🔍 " + kw);
    const r = searchDrinkCaffeine(kw);
    if (r.success && r.results.length > 0) {
      r.results.forEach(function(item) {
        safeLog_("  ✅ " + item.name + " - " + item.caffeine + "mg" + (item.maker ? " (" + item.maker + ")" : "") + (item.serving ? " / " + item.serving : ""));
      });
    } else {
      safeLog_("  결과 없음: " + JSON.stringify(r));
    }
  });
}

// testImageAnalysis → testCaffeineDBSearch 로 통합됨 (위의 새 함수 참조)

// ============================================
// Gemini API 키 설정 함수
// ============================================

/**
 * Gemini API 키 설정
 * ✅ 사용법: Apps Script 편집기 → 프로젝트 설정(⚙️) → 스크립트 속성 탭에서
 *           속성 이름: GEMINI_API_KEY, 값: 발급받은 Gemini API 키를 직접 입력하세요.
 *           이 함수는 키 등록 여부를 확인하는 용도로 사용합니다.
 */
function setGeminiAPIKey() {
  // ⚠️ 보안상 API 키를 코드에 직접 입력하지 마세요.
  // Apps Script → 프로젝트 설정 → 스크립트 속성에서 GEMINI_API_KEY를 등록하세요.
  const apiKey = PropertiesService.getScriptProperties()
    .getProperty("GEMINI_API_KEY");

  if (!apiKey) {
    safeLog_("❌ API 키가 스크립트 속성에 설정되지 않았습니다!");
    safeLog_("   Apps Script → 프로젝트 설정 → 스크립트 속성에서 GEMINI_API_KEY를 추가하세요.");
    return;
  }
  safeLog_("✅ Gemini API 키가 설정되어 있습니다!");
  safeLog_("실제 연결 확인은 checkGeminiAPIKey()를 실행하세요.");
}

/**
 * 편집기 전용 연결 시험. 학생 기록을 읽거나 전송하지 않고 요청 1회만 실행합니다.
 * 키/원문 오류/응답 내용은 기록하지 않습니다. 웹 API에 공개하지 마세요.
 */
function checkGeminiAPIKey() {
  const apiKey = String(PropertiesService.getScriptProperties()
    .getProperty("GEMINI_API_KEY") || "").trim();
  const model = "gemini-3.5-flash-lite";
  const result = { configured: !!apiKey, success: false, model: model, httpStatus: null, code: "NO_API_KEY" };
  if (apiKey) {
    // IDE의 세부 권한 승인 흐름을 사용합니다. 승인 예외를 삼키지 않습니다.
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ["https://www.googleapis.com/auth/script.external_request"]);
    try {
      const response = UrlFetchApp.fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "post", contentType: "application/json", muteHttpExceptions: true,
          headers: { "x-goog-api-key": apiKey },
          payload: JSON.stringify({
            contents: [{ parts: [{ text: "Reply with exactly CONNECTION_OK." }] }],
            generationConfig: { maxOutputTokens: 1024 }
          })
        }
      );
      result.httpStatus = response.getResponseCode();
      if (result.httpStatus !== 200) {
        const codes = { 400: "INVALID_REQUEST_OR_KEY", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "MODEL_NOT_FOUND", 429: "QUOTA_EXCEEDED" };
        result.code = codes[result.httpStatus] || "HTTP_ERROR";
      } else {
        result.code = "INVALID_RESPONSE";
        try {
          const data = JSON.parse(response.getContentText());
          const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
          const answer = Array.isArray(parts) ? parts.filter(function(part) { return !part.thought && typeof part.text === "string"; }).map(function(part) { return part.text; }).join("").trim() : "";
          if (answer === "CONNECTION_OK") {
            result.success = true;
            result.code = "CONNECTION_OK";
          }
        } catch (ignored) { /* 원문 응답을 로그에 남기지 않습니다. */ }
      }
    } catch (error) {
      result.code = "TRANSPORT_ERROR";
      const message = String(error && error.message || "");
      result.errorMentionsExternalRequestScope = /script\.external_request/.test(message);
      result.urlFetchPermissionDenied = /UrlFetchApp\.fetch/.test(message) && /permission|권한/i.test(message);
      if (/permission|authorization|권한|승인/i.test(message)) result.code = "URL_FETCH_PERMISSION_DENIED";
      else if (/header|헤더/i.test(message)) result.code = "INVALID_REQUEST_HEADER";
      else if (/DNS/i.test(message)) result.code = "DNS_ERROR";
      else if (/too many times|quota|할당량/i.test(message)) result.code = "URL_FETCH_QUOTA_EXCEEDED";
    }
  }
  // 고정된 진단 필드만 출력하며 학생/키/제공자 원문은 포함하지 않습니다.
  console.info(JSON.stringify(result));
  return result;
}

/**
 * API 키 삭제 (필요시)
 */
function deleteGeminiAPIKey() {
  PropertiesService.getScriptProperties()
    .deleteProperty("GEMINI_API_KEY");

  safeLog_("🗑️ API 키가 삭제되었습니다");
}

function testWithRealStudentId(realStudentId) {
  safeLog_('=== 실제 학번으로 테스트 ===');

  // 여기에 실제 사용 중인 학번 입력
  if (!realStudentId) throw new Error('STUDENT_ID_REQUIRED');

  const result = getWeeklyDetailedData(realStudentId);

  safeLog_('학번: ' + realStudentId);
  safeLog_('반환 타입: ' + typeof result);
  safeLog_('recordedDays: ' + result.recordedDays);
  safeLog_('totalDays: ' + result.totalDays);

  if (result.recordedDays > 0) {
    safeLog_('✅✅✅ 데이터 있음! 정상 작동!');
  } else {
    safeLog_('⚠️ 이 학번에는 데이터가 없습니다');
    safeLog_('스프레드시트에서 데이터가 있는 학번을 확인하세요');
  }
}
/**
 * 교사용 전체 데이터 조회
 * students / caffeine / sleep / info 시트 전체 반환
 *
 * 시트 컬럼 구조:
 *   students : A=학년, B=반, C=번호, D=이름, E=학번
 *   caffeine : A=타임스탬프, B=학년, C=반, D=번호, E=전체학번,
 *              F=성명, G=음료명, H=함량, I=섭취시간, J=고유ID
 *   sleep    : A=타임스탬프, B=학년, C=반, D=번호, E=전체학번,
 *              F=성명, G=날짜, H=취침, I=기상, J=시간,
 *              K=수면 후 컨디션, L=메모, M=고유ID
 *   info     : A=타임스탬프, B=학년, C=반, D=번호, E=성명,
 *              F=전체학번, G=몸무게
 */
// 비수치 학번(교직원·교생)의 고유 ID 생성.
// 새 형식("교직원_이름")은 그대로, 구 형식("교직원")은 "_이름" 접미사 추가.
function makeTeacherUniqueId(rawId, name) {
  if (/^\d+$/.test(rawId)) return rawId;           // 숫자 학번은 그대로
  const suffix = '_' + String(name || '').trim();
  return rawId.endsWith(suffix) ? rawId : rawId + suffix;
}

function getTeacherData() {
  try {
    const ss = getSpreadsheet_();

    // ── students ─────────────────────────────────────
    const studSheet = ss.getSheetByName('students');
    if (!studSheet) throw new Error('students 시트를 찾을 수 없습니다');
    const studRaw = studSheet.getDataRange().getValues();
    const students = [];

    for (let i = 1; i < studRaw.length; i++) {
      const r = studRaw[i];
      const rawId = String(r[4]).trim();
      if (!rawId || rawId === 'undefined') continue;
      // ※ 테스트 계정(학번=0) 제외하려면 아래 주석 해제
      // if (rawId === '0') continue;
      const studName = String(r[3] || '');
      // 교직원·교생 등 비수치 학번은 "학번_이름" 복합키로 고유화
      const id = makeTeacherUniqueId(rawId, studName);
      students.push({
        학번: id,
        이름: studName,
        학년: String(parseInt(r[0]) || ''),
        반:   String(parseInt(r[1]) || ''),
        번호: String(parseInt(r[2]) || '')
      });
    }

    // ── caffeine ─────────────────────────────────────
    const cafSheet = ss.getSheetByName('caffeine');
    if (!cafSheet) throw new Error('caffeine 시트를 찾을 수 없습니다');
    const cafLastRow = cafSheet.getLastRow();
    const caffeine = [];

    if (cafLastRow > 1) {
      const cafRaw = cafSheet.getRange(2, 1, cafLastRow - 1, Math.min(15, cafSheet.getLastColumn())).getValues();
      for (let i = 0; i < cafRaw.length; i++) {
        const r = cafRaw[i];
        const cafRawId = String(r[4]).trim();  // E열: 전체학번
        if (!cafRawId || cafRawId === 'undefined') continue;
        const cafName = String(r[5] || '');    // F열: 성명
        // 교직원·교생 등 비수치 학번은 "학번_이름" 복합키
        const id = makeTeacherUniqueId(cafRawId, cafName);

        // I열: 섭취시간 → "yyyy-MM-dd HH:mm:ss" 형식
        const intakeTime = r[8];
        let timeStr = '';
        if (intakeTime instanceof Date) {
          timeStr = Utilities.formatDate(intakeTime, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
        } else {
          timeStr = String(intakeTime || '');
        }

        caffeine.push({
          학번:   id,
          name:   cafName,
          음료명:  String(r[6] || ''),   // G열
          함량:   recordNumber_(r[7]), // H열
          섭취시간: timeStr,
          이유:   String(r[10] || ''),   // K열
          업체명: String(r[13] || ''),
          원본식품명: String(r[14] || ''),
          부작용: String(r[11] || '')    // L열
        });
      }
    }

    // ── sleep ─────────────────────────────────────────
    const sleepSheet = ss.getSheetByName('sleep');
    if (!sleepSheet) throw new Error('sleep 시트를 찾을 수 없습니다');
    const sleepLastRow = sleepSheet.getLastRow();
    const sleep = [];
    const sleepMetadataIndex=preservedSleepMetadataIndex_();

    if (sleepLastRow > 1) {
      const sleepRaw = sleepSheet.getRange(2, 1, sleepLastRow - 1, 19).getValues();
      for (let i = 0; i < sleepRaw.length; i++) {
        const r = sleepRaw[i];
        const sleepRawId = String(r[4]).trim();  // E열: 전체학번
        if (!sleepRawId || sleepRawId === 'undefined') continue;
        const sleepName = String(r[5] || '');    // F열: 성명
        // 교직원·교생 등 비수치 학번은 "학번_이름" 복합키
        const id = makeTeacherUniqueId(sleepRawId, sleepName);

        // G열: 날짜 → "yyyy-MM-dd"
        const dateVal = r[6];
        const wakeDateVal = r[8];
        let dateStr = '';
        let wakeDateStr = '';
        if (dateVal instanceof Date) {
          dateStr = Utilities.formatDate(dateVal, 'Asia/Seoul', 'yyyy-MM-dd');
        } else {
          dateStr = String(dateVal || '').substring(0, 10);
        }
        if (wakeDateVal instanceof Date) {
          wakeDateStr = Utilities.formatDate(wakeDateVal, 'Asia/Seoul', 'yyyy-MM-dd');
        } else {
          wakeDateStr = String(wakeDateVal || '').substring(0, 10);
        }

        // H열: 취침, I열: 기상 → "HH:mm" 형식
        function toHHMM(val) {
          if (!val) return '';
          if (val instanceof Date) return Utilities.formatDate(val, 'Asia/Seoul', 'HH:mm');
          const m = String(val).match(/^(\d{1,2}):(\d{2})/);
          return m ? m[1].padStart(2, '0') + ':' + m[2] : String(val);
        }

        sleep.push(Object.assign({
          id:             String(r[13] || ''),
          학번:           id,
          name:           sleepName,
          날짜:           dateStr,
          wakeDate:       wakeDateStr,
          취침:           toHHMM(r[7]),          // H열
          기상:           toHHMM(r[9]),          // I열
          저장시각:        recordTimestampText_(r[0]),
          원본행번호:      i+2,
          시간:           recordNumber_(r[10]), // J열
          '수면 후 컨디션': String(r[11] || ''),  // K열
          메모:           String(r[12] || ''),   // L열
          스마트폰:        String(r[14] || ''),   // N열
          활동:           String(r[15] || ''),   // O열
          잠들기:          String(r[16] || ''),   // P열
          각성:           String(r[17] || ''),   // Q열
          낮졸림:          String(r[18] || '')    // R열
        },preservedSleepMetadataView_(r,preservedSleepMetadataForRow_(r,sleepMetadataIndex))));
      }
    }

    // ── info (몸무게) ─────────────────────────────────
    const infoSheet = ss.getSheetByName('info');
    if (!infoSheet) throw new Error('info 시트를 찾을 수 없습니다');
    const infoRaw = infoSheet.getDataRange().getValues();
    const info = [];
    const seenInfo = new Set();

    for (let i = 1; i < infoRaw.length; i++) {
      const r = infoRaw[i];
      const id = String(r[5]).trim();  // F열: 전체학번
      if (!id || id === '' || id === 'undefined') continue;
      const name = String(r[4] || '').trim();
      const ownerKey = JSON.stringify([id, name]);
      if (seenInfo.has(ownerKey)) continue;
      seenInfo.add(ownerKey);
      info.push({
        학번: id,
        name: name,
        몸무게: parseFloat(r[6]) || 60,        // G열: 몸무게
        목표카페인: parseFloat(r[7]) || null,  // H열: 목표 카페인
        목표취침: toProfileHHMM_(r[8]),           // I열: 목표 취침
        목표기상: toProfileHHMM_(r[9])            // J열: 목표 기상
      });
    }

    safeLog_(`✅ getTeacherData 완료: 학생 ${students.length}명, 카페인 ${caffeine.length}건, 수면 ${sleep.length}건, 체중 ${info.length}건`);

    // ── teacher_awards (교사 수여 뱃지) ─────────────────
    // 교사 앱 localStorage를 GAS 시트 기준으로 동기화하기 위해 함께 반환
    const manualAwards = {}; // { [studentId]: [ awardObj, ... ] }
    try {
      const awardSheet = ss.getSheetByName('teacher_awards');
      if (awardSheet && awardSheet.getLastRow() > 1) {
        const awardData  = awardSheet.getDataRange().getValues();
        // ⭐ 헤더 컬럼 수로 신규/구버전 판단 (학번 길이에 무관 → 학번 0도 정상 처리)
        const totalCols2 = awardData[0] ? awardData[0].length : 0;
        // ⭐ 포맷 판단: 컬럼 수가 아닌 B열(index1) 헤더값으로 구분
        // 신규(12+열): B열='학년' → E열(index4)=학번, G열(index6)=awardId
        // 구버전( 9열): B열='studentid' → B열(index1)=학번, C열(index2)=awardId
        const hdr1_2 = String(awardData[0][1] || '').toLowerCase();
        const isNew2 = (totalCols2 >= 12) && (hdr1_2 === '학년' || hdr1_2 === 'grade');
        safeLog_('getTeacherData - 뱃지 포맷: ' + (isNew2 ? '신규(12+열)' : '구버전') + ', 컬럼=' + totalCols2 + ', B헤더="' + hdr1_2 + '"');

        for (let i = 1; i < awardData.length; i++) {
          const row = awardData[i];
          const ts  = _tsToStr_(row[0]);
          const sid = isNew2 ? normalizeId(row[4]) : normalizeId(row[1]);
          if (!sid) continue; // 학번 없는 행 스킵

          if (!manualAwards[sid]) manualAwards[sid] = [];
          manualAwards[sid].push({
            grantedAt : ts,
            studentName: isNew2 ? String(row[5] || '').trim() : '',
            awardId   : isNew2 ? String(row[6]  || '') : String(row[2] || ''),
            name      : isNew2 ? String(row[7]  || '') : String(row[3] || ''),
            image     : isNew2 ? String(row[8]  || '🏅') : String(row[4] || '🏅'),
            bg        : isNew2 ? String(row[9]  || '#f5f3ff') : String(row[5] || '#f5f3ff'),
            color     : isNew2 ? String(row[10] || '#7c3aed') : String(row[6] || '#7c3aed'),
            message   : isNew2 ? String(row[11] || '') : String(row[7] || ''),
            grantedBy : isNew2 ? String(row[12] || '') : String(row[8] || '')
          });
        }
        safeLog_('getTeacherData - 뱃지 로드 완료: ' + Object.keys(manualAwards).length + '명');
      }
    } catch (awardErr) {
      safeLog_('⚠️ teacher_awards 로드 실패 (계속 진행): ' + awardErr);
    }

    return {
      success      : true,
      hiddenStudentIds: getTeacherHiddenStudents().hiddenStudentIds,
      students     : students,
      caffeine     : caffeine,
      sleep        : sleep,
      info         : info,
      manualAwards : manualAwards  // ⭐ 교사 앱 localStorage 동기화용
    };

  } catch (err) {
    safeLog_('❌ getTeacherData 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용 AI 건강분석 요청 처리
 * ⭐ 학생용과 별도로 생활기록부 소견 스타일 전용 프롬프트 사용
 */
function getTeacherCaffeineThresholds_(values) {
  values = values || {};
  const warn = Number(values.warn == null ? 56 : values.warn);
  const over = Number(values.over == null ? 100 : values.over);
  return isFinite(warn) && isFinite(over) && warn >= 10 && over >= 50 && warn < over && over < 120
    ? {warn: warn, over: over} : {warn: 56, over: 100};
}

// Teacher lists, charts and reports classify against the teacher basis, independently of the personal goal.
function getTeacherCaffeineSummary_(average, limit, recordedDays, dailyRecords, values) {
  const thresholds = getTeacherCaffeineThresholds_(values);
  const pct = average / limit * 100;
  const stage = !recordedDays ? -1 : average === 0 ? 0 : pct >= 200 ? 5 : pct >= 120 ? 4 : pct >= thresholds.over ? 3 : pct >= thresholds.warn ? 2 : 1;
  const labels = ['카페인 섭취 안 함', '1단계: 안전', '2단계: 적정/제한', '3단계: 과다', '4단계: 고위험', '5단계: 위험/중독'];
  const status = stage < 0 ? '카페인 미기록' : labels[stage];
  const overLimit = limit * thresholds.over / 100;
  const overDays = (dailyRecords || []).filter(d => d.mg > 0 && d.mg >= overLimit);
  let section = !recordedDays ? '카페인 미기록으로 섭취 상태를 판정할 수 없습니다.'
    : average === 0 ? '카페인 기록 ' + recordedDays + '일 모두 카페인 섭취 안 함(0mg)으로 기록되었습니다.'
    : '기록일 기준 일평균 ' + Math.round(average) + 'mg이며, 일일 최대 섭취량(' + limit + 'mg)의 ' + Math.round(pct) + '%로 ' + status + '입니다.';
  if (overDays.length) {
    section += '\n카페인 기록 ' + recordedDays + '일 중 ' + overDays.length + '일에 초과 경계(' + Math.round(overLimit * 10) / 10 + 'mg, ' + thresholds.over + '%) 이상을 섭취했습니다.\n초과 기록:\n'
      + overDays.map(d => '  - ' + d.date.substr(5) + ': ' + d.mg + 'mg').join('\n');
  }
  return {stage: stage, status: status, overDays: overDays, section: section};
}

function getTeacherLifestyleValues_(summary, ignored) {
  return String(summary || '').split(',').map(v => v.trim()).filter(v => {
    const label = v.replace(/\([^)]*\)/g, '').replace(/\s/g, '');
    return label && ['없음', '데이터없음', '기록없음'].concat(ignored || []).indexOf(label) < 0;
  });
}

function handleAIReportForTeacher(payload) {
  try {
    return analyzeTeacherHealthData_(payload, getWeeklyDetailedData(payload.studentId, payload.startDate || null, payload.endDate || null), getTeacherAnalysisModel_(), 3);
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function getTeacherAnalysisModel_() { return "gemini-2.0-flash"; }

// 데이터 수집을 분리하여 고정 가상 기록으로도 같은 분석 처리를 검사합니다.
function analyzeTeacherHealthData_(payload, weeklyData, modelName, maxRetry) {
  const caf=payload.caffeineData||{},slp=payload.sleepData||{};
  const observations=[];
  for(const [label,value] of [['섭취 이유',caf.topReasons],['기록된 불편 경험',caf.topSymptoms],['취침 전 스마트폰',slp.topPhone],['신체활동',slp.topActivity],['잠드는 데 걸린 시간',slp.topLatency],['낮 졸림',slp.topDrowsy]]) {
    if(value&&value!=='없음'&&value!=='데이터 없음'&&!String(value).startsWith('안 함'))observations.push(label+': '+value);
  }
  return {success:true,source:'Rule',policyVersion:'2026-10-14',recordedDays:weeklyData.recordedDays,
    analysis:buildRecordFeedback_(weeklyData,Number(payload.limit)||150,true,(payload.startDate||'')+' ~ '+(payload.endDate||''),payload.caffeineThresholds,observations.join('\n'))};
}

function getTeacherFallbackAnalysis(avgCaffeine, avgSleep, limit, cafDays, sleepDays, periodLabel, overDays, periodForHeader, lifeAdvice, caffeineThresholds) {
  return buildRecordFeedback_({caffeineRecordedDays:cafDays,sleepRecordedDays:sleepDays,caffeineTotal:avgCaffeine*cafDays,sleepTotal:avgSleep*sleepDays,totalDays:7,overCaffeineDays:overDays||[]},limit,true,periodForHeader||periodLabel,caffeineThresholds,lifeAdvice);
}

function getTeacherInsufficientMessage(cafDays, sleepDays, totalDays, periodLabel) {
  totalDays   = totalDays   || 7;
  periodLabel = periodLabel || Utilities.formatDate(new Date(), "Asia/Seoul", "yyyy-MM-dd") + ' 기준 최근 7일';
  return `[건강 관찰 소견 / ${periodLabel}]

◎ 분석 불가 안내
현재 수집된 데이터가 분석 최소 기준(카페인·수면 각 3일 이상)에 미달하여 AI 건강 소견 작성이 불가합니다.

◎ 현재 기록 현황
- 카페인 기록: ${cafDays}/${totalDays}일 ${cafDays >= 3 ? '(충족)' : '(미충족 — ' + (3 - cafDays) + '일 추가 필요)'}
- 수면 기록:   ${sleepDays}/${totalDays}일 ${sleepDays >= 3 ? '(충족)' : '(미충족 — ' + (3 - sleepDays) + '일 추가 필요)'}

◎ 지도 방향
해당 학생이 카페인 및 수면 데이터를 꾸준히 입력할 수 있도록 독려하시기 바랍니다. 각 항목 3일 이상 기록 시 AI 건강 소견이 자동 생성됩니다.`;
}

// ============================================
// 문의하기 기능
// ============================================

/**
 * 학생이 문의 제출
 */
function submitInquiry(data) {
  try {
    const ss = getSpreadsheet_();
    let sheet = ss.getSheetByName("inquiries");

    // inquiries 시트가 없으면 생성 (새 헤더 구조)
    if (!sheet) {
      sheet = ss.insertSheet("inquiries");
      sheet.getRange(1, 1, 1, 11).setValues([[
        "타임스탬프", "학년", "반", "번호", "학번", "이름", "제목", "내용", "상태", "응답내용", "응답시간"
      ]]);
      sheet.setFrozenRows(1);
    }

    const timestamp = getKSTTimestamp();
    const p = parseStudentId(data.studentId);

    appendRecordRow_(sheet, [
      timestamp,               // A: 타임스탬프
      p.grade,                 // B: 학년
      p.class,                 // C: 반
      p.number,                // D: 번호
      String(data.studentId),  // E: 학번
      String(data.name),       // F: 이름
      String(data.title || ''),// G: 제목
      String(data.content || ''),// H: 내용
      "미응답",                // I: 상태
      "",                      // J: 응답내용
      ""                       // K: 응답시간
    ]);

    safeLog_(`✅ 문의 저장 완료: ${data.studentId} - ${data.title}`);
    return { success: true };
  } catch (error) {
    safeLog_('❌ 문의 저장 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 교사용: 전체 문의 목록 조회 (새 헤더: A타임스탬프, B학년, C반, D번호, E학번, F이름, G제목, H내용, I상태, J응답내용, K응답시간)
 */
// A read-only fingerprint avoids migrating existing inquiry rows. Reply/notification
// columns are excluded so acknowledgments do not invalidate an open reply draft.
function inquiryKey_(row) {
  const original = row.slice(0, 8).map(value => value instanceof Date
    ? value.toISOString() : String(value === null || value === undefined ? '' : value));
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, JSON.stringify(original), Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

// Gateway inquiry mutations already run inside the same script lock. Resolve
// again under that lock: a row number from an older screen is only a hint.
function resolveInquiryRow_(sheet, rowIndex, expectedKey) {
  if (!Number.isInteger(rowIndex) || rowIndex < 2 || typeof expectedKey !== 'string'
      || !/^[a-f0-9]{64}$/.test(expectedKey)) return 0;
  const rows = sheet.getDataRange().getValues();
  let found = 0;
  for (let i = 1; i < rows.length; i++) {
    if (inquiryKey_(rows[i]) !== expectedKey) continue;
    if (found) return 0; // Identical legacy rows cannot be safely distinguished.
    found = i + 1;
  }
  return found;
}

function inquiryTargetChanged_() {
  return { success: false, code: 'INQUIRY_TARGET_CHANGED',
    error: '문의가 삭제 또는 변경되었거나 동일한 문의가 여러 건 있습니다. 목록을 확인한 뒤 다시 선택하세요. 작성한 응답은 유지됩니다.' };
}

function getInquiries() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("inquiries");

    if (!sheet) return { success: true, data: [] };

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    const inquiries = [];
    for (let i = 1; i < data.length; i++) {
      inquiries.push({
        rowIndex:  i + 1,
        inquiryKey: inquiryKey_(data[i]),
        timestamp: data[i][0] ? String(data[i][0]) : '',
        grade:     String(data[i][1] || ''),
        classNum:  String(data[i][2] || ''),
        number:    String(data[i][3] || ''),
        studentId: String(data[i][4] === null || data[i][4] === undefined ? '' : data[i][4]),
        name:      String(data[i][5] || ''),
        title:     String(data[i][6] || ''),
        content:   String(data[i][7] || ''),
        status:    String(data[i][8] || '미응답'),
        reply:     String(data[i][9] || ''),
        replyTime: data[i][10] ? String(data[i][10]) : ''
      });
    }

    inquiries.reverse();
    return { success: true, data: inquiries };
  } catch (error) {
    safeLog_('❌ 문의 조회 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 교사용: 문의에 응답 (상태: I=9, 응답내용: J=10, 응답시간: K=11)
 */
function replyToInquiry(rowIndex, replyContent, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("inquiries");

    if (!sheet) return { success: false, error: "inquiries 시트 없음" };

    const targetRow = resolveInquiryRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return inquiryTargetChanged_();
    if (typeof replyContent !== 'string' || !replyContent.trim()) return { success: false, error: '응답 내용을 입력하세요.' };
    const replyTime = getKSTTimestamp();
    sheet.getRange(targetRow, 9, 1, 3).setValues([["응답완료", replyContent, replyTime]]);

    safeLog_(`✅ 문의 응답 완료: 행 ${rowIndex}`);
    return { success: true };
  } catch (error) {
    safeLog_('❌ 문의 응답 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}

/**
 * 교사용: 문의 행 삭제
 * @param {number} rowIndex - 삭제할 시트 행 번호 (1-based)
 */
function deleteInquiry(rowIndex, expectedKey) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = ss.getSheetByName('inquiries');
    if (!sheet) return { success: false, error: 'inquiries 시트 없음' };
    const targetRow = resolveInquiryRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return inquiryTargetChanged_();
    sheet.deleteRow(targetRow);
    safeLog_('✅ 문의 삭제 완료: 행 ' + rowIndex);
    return { success: true };
  } catch (err) {
    safeLog_('❌ deleteInquiry 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 교사가 아직 확인하지 않은 새 문의 목록 조회
 * L열(12번): 교사확인 — 빈 값이면 미확인
 */
function getUnreadInquiries() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('inquiries');
    if (!sheet) return { success: true, data: [] };
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < data.length; i++) {
      const notified = String(data[i][11] || '');
      if (notified === '확인') continue;
      result.push({
        rowIndex:  i + 1,
        inquiryKey: inquiryKey_(data[i]),
        timestamp: data[i][0] ? String(data[i][0]) : '',
        studentId: String(data[i][4] || ''),
        name:      String(data[i][5] || ''),
        title:     String(data[i][6] || ''),
        content:   String(data[i][7] || ''),
        status:    String(data[i][8] || '미응답')
      });
    }
    return { success: true, data: result };
  } catch (err) {
    safeLog_('❌ getUnreadInquiries 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 문의 팝업 확인 처리 (L열 = '확인')
 */
function markInquiryNotified(rowIndex, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('inquiries');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveInquiryRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return inquiryTargetChanged_();
    sheet.getRange(targetRow, 12).setValue('확인');
    return { success: true };
  } catch (err) {
    safeLog_('❌ markInquiryNotified 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 학생용: 자신의 문의 목록 및 응답 확인 (E열=학번[4])
 */
function inquiryReplyKey_(row) {
  if (String(row[8]) !== '응답완료' || !row[9]) return '';
  const time = row[10] instanceof Date ? row[10].toISOString() : String(row[10] || '');
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify([inquiryKey_(row), String(row[9]), time]), Utilities.Charset.UTF_8)
    .map(byte => ('0' + ((byte + 256) % 256).toString(16)).slice(-2)).join('');
}

// M stores the exact reply receipt; an edited answer has a different key.
// The authenticated gateway supplies the identity and holds the script lock.
function markInquiryRepliesSeen(studentId, name, replyKeys) {
  try {
    if (!Array.isArray(replyKeys) || !replyKeys.length || replyKeys.length > 100
        || replyKeys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) {
      return {success:false, error:'확인할 답변 정보가 올바르지 않습니다.'};
    }
    const sheet = getSpreadsheet_().getSheetByName('inquiries');
    if (!sheet) return inquiryTargetChanged_();
    const rows = sheet.getDataRange().getValues();
    const header = String((rows[0] || [])[12] || '');
    if (header && header !== '학생답변확인키') return {success:false, error:'답변 확인 저장 열을 확인해주세요.'};
    const subject = {studentId:studentId, name:name};
    const targets = [];
    for (const key of [...new Set(replyKeys)]) {
      const matches = [];
      for (let i = 1; i < rows.length; i++) {
        if (ownerMatchesSubject_(rows[i][4], rows[i][5], subject) && inquiryReplyKey_(rows[i]) === key) matches.push(i + 1);
      }
      if (matches.length !== 1) return inquiryTargetChanged_();
      targets.push({row:matches[0], key:key});
    }
    if (!header) sheet.getRange(1, 13).setValue('학생답변확인키');
    targets.forEach(target => sheet.getRange(target.row, 13).setValue(target.key));
    return {success:true};
  } catch (error) {
    safeLog_('답변 확인 저장 실패: ' + error.message);
    return {success:false, error:'답변 확인 상태를 저장하지 못했습니다.'};
  }
}

function getMyInquiries(studentId) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName("inquiries");

    if (!sheet) return { success: true, data: [] };

    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, data: [] };

    const inquiries = [];
    for (let i = 1; i < data.length; i++) {
      if (normalizeId(data[i][4]) === normalizeId(studentId)) { // E열: 학번
        const replyKey = inquiryReplyKey_(data[i]);
        inquiries.push({
          replyKey: replyKey,
          replySeen: !!replyKey && String(data[i][12] || '') === replyKey,
          timestamp: data[i][0] ? String(data[i][0]) : '',
          title:     String(data[i][6] || ''),  // G열
          content:   String(data[i][7] || ''),  // H열
          status:    String(data[i][8] || '미응답'), // I열
          reply:     String(data[i][9] || ''),  // J열
          replyTime: data[i][10] ? String(data[i][10]) : '' // K열
        });
      }
    }

    inquiries.reverse();
    return { success: true, data: inquiries };
  } catch (error) {
    safeLog_('❌ 내 문의 조회 오류: ' + error.message);
    return { success: false, error: error.message };
  }
}
/**
 * caffeine_db 시트 전체를 읽어 카페인 DB 배열 반환
 * 컬럼: A=식품명, B=업체명, C=기준량, D=카페인(mg), E=출처
 * @returns {{ success: boolean, data: Array }}
 */
function getCaffeineDB() {
  try {
    var ss = getSpreadsheet_();
    var ws = ss.getSheetByName('caffeine_db');
    if (!ws) {
      safeLog_('getCaffeineDB: caffeine_db 시트 없음');
      return { success: false, data: [], error: 'caffeine_db 시트를 찾을 수 없습니다.' };
    }

    var lastRow = ws.getLastRow();
    if (lastRow < 2) {
      return { success: true, data: [] };
    }

    // A~D열만 읽기 (E열 출처는 불필요)
    // 헤더(1행) 제외, 2행부터
    var rawData = ws.getRange(2, 1, lastRow - 1, 4).getValues();
    // 컬럼 인덱스 (0-based):
    //   0: A열 = 식품명(f)
    //   1: B열 = 업체명(c)
    //   2: C열 = 기준량(s) — '100g', '100ml', '355㎖' 등
    //   3: D열 = 카페인(mg) — 숫자 또는 '39㎎' 문자열

    var result = [];
    for (var i = 0; i < rawData.length; i++) {
      var row = rawData[i];
      var foodName  = row[0] ? String(row[0]).trim() : '';
      var company   = row[1] ? String(row[1]).trim() : '';
      var stdStr    = row[2] ? String(row[2]).trim() : '100g';
      var mgRaw     = row[3];

      // 빈 행 건너뜀
      if (!foodName) continue;

      // 기준량 정규화: ㎖ → ml, ㎎ → mg (특수 단위 문자 처리)
      var stdNorm = stdStr
        .replace(/㎖/g, 'ml')
        .replace(/㎎/g, 'mg')
        .replace(/㎏/g, 'kg')
        .replace(/，/g, ',');

      // 카페인(mg) 파싱: 숫자 또는 '39㎎' 같은 문자열
      var mgVal = 0;
      if (typeof mgRaw === 'number') {
        mgVal = mgRaw;
      } else if (mgRaw) {
        var mgStr = String(mgRaw).replace(/㎎/g, '').replace(/mg/gi, '').trim();
        mgVal = parseFloat(mgStr) || 0;
      }
      mgVal = Math.round(mgVal * 100) / 100; // 소수점 2자리

      // w(식품중량) 필드: 비표준 기준량이면 그 값 자체가 1회 제공량
      // 예: '355ml' → w='355ml' (용량 입력창 기본값으로 사용)
      var stdNumMatch = stdNorm.replace(',','').match(/[\d.]+/);
      var stdNum = stdNumMatch ? parseFloat(stdNumMatch[0]) : 100;
      var wVal = stdNum === 100 ? '' : stdNorm; // 100g/100ml이면 w 비워둠

      result.push({
        f:  foodName,  // 식품명 (카테고리_음료명 형식)
        c:  company,   // 업체명
        s:  stdNorm,   // 기준량 (정규화)
        w:  wVal,      // 식품중량 (비표준 기준량이면 해당 값, 100g/100ml이면 '')
        mg: mgVal      // 기준량당 카페인 mg
      });
    }

    safeLog_('getCaffeineDB: ' + result.length + '건 반환');
    return { success: true, data: result };

  } catch (error) {
    safeLog_('getCaffeineDB 오류: ' + error);
    return { success: false, data: [], error: error.toString() };
  }
}
// ============================================================
// ★ fetchWithRetry & getApiErrorInfo — 오류 코드별 재시도 유틸리티
// ============================================================

/**
 * Gemini API를 지수 백오프로 안전하게 호출
 * @param {string} apiUrl
 * @param {Object} options  - UrlFetchApp.fetch 옵션 (muteHttpExceptions: true 필수)
 * @param {number} maxRetry - 최대 재시도 횟수 (기본 3)
 * @returns {{ response: HTTPResponse|null, errorCode: string|null }}
 */
function fetchWithRetry(apiUrl, options, maxRetry) {
  maxRetry = maxRetry || 3;

  var RETRYABLE = {
    500: 'SERVER_ERROR',
    502: 'SERVER_ERROR',
    503: 'SERVER_ERROR',
    504: 'SERVER_ERROR'
  };

  var lastResponse = null;
  var lastCode     = null;

  for (var attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      var response = UrlFetchApp.fetch(apiUrl, options);
      var code     = response.getResponseCode();
      safeLog_('[fetchWithRetry] 시도 ' + attempt + '/' + maxRetry + ' → HTTP ' + code);

      if (code === 200) {
        return { response: response, errorCode: null }; // ✅ 성공
      }

      lastResponse = response;
      lastCode     = code;

      if (RETRYABLE[code] && attempt < maxRetry) {
        var waitMs = Math.min(Math.pow(2, attempt) * 1000, 20000);

        // 429 Retry-After 헤더 우선 적용
        if (code === 429) {
          try {
            var headers = response.getHeaders();
            if (headers && headers['Retry-After']) {
              waitMs = Math.max(waitMs, Math.min(parseInt(headers['Retry-After']) * 1000, 30000));
            }
          } catch (e) { /* 헤더 없을 수 있음 */ }
        }

        safeLog_('[fetchWithRetry] HTTP ' + code + ' → ' + (waitMs / 1000) + 's 대기 후 재시도...');
        Utilities.sleep(waitMs);
        continue;
      }

      break; // 재시도 불필요한 오류 (401, 403, 400 등)

    } catch (networkErr) {
      safeLog_('[fetchWithRetry] 네트워크 오류 (시도 ' + attempt + '): ' + networkErr);
      if (attempt < maxRetry) {
        Utilities.sleep(Math.min(Math.pow(2, attempt) * 1000, 20000));
      } else {
        return { response: null, errorCode: 'NETWORK_ERROR' };
      }
    }
  }

  // errorCode 결정
  var errorCode = 'UNKNOWN_ERROR';
  if (lastCode) {
    if (RETRYABLE[lastCode])                           errorCode = RETRYABLE[lastCode];
    else if (lastCode === 401 || lastCode === 403)     errorCode = 'AUTH_ERROR';
  }

  safeLog_('[fetchWithRetry] 최종 실패. code=' + lastCode + ', errorCode=' + errorCode);
  return { response: lastResponse, errorCode: errorCode };
}

/**
 * errorCode → 사용자 안내 메시지 (한국어)
 * @param {string} errorCode
 * @returns {{ title: string, desc: string }}
 */
function getApiErrorInfo(errorCode) {
  var map = {
    'RATE_LIMIT':    { title: '요청 한도 초과 (429)',   desc: 'Gemini API 일일 요청 한도에 도달했습니다. 잠시 후 또는 내일 다시 시도해 주세요.' },
    'SERVER_ERROR':  { title: 'AI 서버 오류 (5xx)',     desc: 'Gemini 서버가 일시적으로 응답하지 않습니다. 1~2분 후 다시 시도해 주세요.' },
    'AUTH_ERROR':    { title: 'API 키 오류 (401/403)',  desc: 'API 키가 유효하지 않거나 권한이 없습니다. 관리자에게 문의해 주세요.' },
    'NO_API_KEY':    { title: 'API 키 미설정',           desc: 'Gemini API 키가 설정되지 않았습니다. 관리자에게 문의해 주세요.' },
    'NETWORK_ERROR': { title: '네트워크 오류',            desc: '서버와의 통신 중 연결이 끊겼습니다. 인터넷 상태를 확인 후 다시 시도해 주세요.' },
    'INCOMPLETE':    { title: 'AI 응답 미완성',           desc: 'AI 응답이 완성되지 않아 기본 분석으로 대체했습니다.' },
    'UNKNOWN_ERROR': { title: '알 수 없는 오류',          desc: '일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.' }
  };
  return map[errorCode] || map['UNKNOWN_ERROR'];
}

// ═══════════════════════════════════════════════════════════════════
// 🏅 교사 수여 뱃지 시스템 — Code.gs 추가 함수
// 시트명: "teacher_awards"
// 컬럼 구조 (A~L열):
//   A: grantedAt    수여 일시 (예: 2026-02-26 14:30)
//   B: grade        학년
//   C: class        반
//   D: number       번호
//   E: studentId    학번
//   F: studentName  학생 이름
//   G: awardId      뱃지 ID (예: manual_1234567890)
//   H: awardName    뱃지 이름
//   I: image        이모지 또는 이미지 URL
//   J: bg           배경색 (#f5f3ff)
//   K: color        글자색 (#7c3aed)
//   L: message      수여 메시지 (선택)
//   M: grantedBy    수여 교사 (선택)
// ═══════════════════════════════════════════════════════════════════

/**
 * 특정 학생에게 부여된 교사 수여 뱃지 목록 반환
 * 학생 앱(index.html)의 checkTeacherAwards()에서 호출
 *
 * @param {string} studentId  학번
 * @returns {{ success: boolean, awards: Array }}
 */
function getTeacherAwardsForStudent(studentId) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);

    const data = sheet.getDataRange().getValues();
    safeLog_('=== getTeacherAwardsForStudent ===');
    safeLog_('요청 학번(원본): "' + studentId + '"');
    safeLog_('시트 전체 행 수: ' + data.length + ' (헤더 포함)');

    if (data.length <= 1) {
      safeLog_('⚠️ 데이터 없음 (헤더만 존재)');
      return { success: true, awards: [] };
    }

    const totalCols = data[0] ? data[0].length : 0;
    const targetId  = normalizeId(studentId);
    safeLog_('헤더 컬럼 수: ' + totalCols);
    safeLog_('헤더: ' + JSON.stringify(data[0]));
    safeLog_('정규화된 학번: "' + targetId + '"');

    // ──────────────────────────────────────────────────────
    // 컬럼 레이아웃 자동 감지
    // 신규(12~13열): A=수여일시, B=학년, C=반, D=번호, E=학번, F=학생이름,
    //                G=awardId,  H=뱃지이름, I=이미지, J=배경색, K=글자색,
    //                L=코멘트,   M=수여교사(13열만 존재)
    // 구버전(~9열): A=수여일시, B=학번, C=awardId, D=뱃지이름 ...
    // ──────────────────────────────────────────────────────
    // ⭐ 헤더 2번째 값(index1)으로 포맷 구분
    //    신규: '학년' / 구버전: 'studentid' 또는 학번 직접
    const hdr1 = String(data[0][1] || '').toLowerCase();
    const isNewFormat = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');

    safeLog_('포맷: ' + (isNewFormat ? '신규(12+열, B=학년)' : '구버전(B=학번)'));

    // 데이터 샘플 로그 (최대 3행)
    for (var si = 1; si < Math.min(4, data.length); si++) {
      var sRow = data[si];
      var sId  = isNewFormat ? normalizeId(sRow[4]) : normalizeId(sRow[1]);
      safeLog_('  ' + si + '행 학번="' + sId + '" | 원본E="' + sRow[4] + '" | A열ts="' + sRow[0] + '"');
    }

    const awards = [];
    for (let i = 1; i < data.length; i++) {
      const row    = data[i];
      const rowSid = isNewFormat ? normalizeId(row[4]) : normalizeId(row[1]);

      if (rowSid !== targetId) continue;

      safeLog_('✅ 매칭 행 ' + (i+1) + ': 학번=' + rowSid + ', 뱃지=' + (isNewFormat ? row[7] : row[3]));

      if (isNewFormat) {
        awards.push({
          grantedAt   : _tsToStr_(row[0]),
          grade       : String(row[1]  || ''),
          classNum    : String(row[2]  || ''),
          number      : String(row[3]  || ''),
          studentId   : String(row[4]  || ''),
          studentName : String(row[5]  || ''),
          awardId     : String(row[6]  || ''),
          name        : String(row[7]  || ''),
          image       : String(row[8]  || '🏅'),
          bg          : String(row[9]  || '#f5f3ff'),
          color       : String(row[10] || '#7c3aed'),
          message     : String(row[11] || ''),
          grantedBy   : String(row[12] || ''), // 13열 없으면 빈 문자열
          seenAt      : _tsToStr_(row[13])
        });
      } else {
        // 구버전: B=학번, C=awardId, D=뱃지이름, E=이미지, F=배경색, G=글자색, H=메시지, I=교사
        awards.push({
          grantedAt : _tsToStr_(row[0]),
          studentId : String(row[1] || ''),
          awardId   : String(row[2] || ''),
          name      : String(row[3] || ''),
          image     : String(row[4] || '🏅'),
          bg        : String(row[5] || '#f5f3ff'),
          color     : String(row[6] || '#7c3aed'),
          message   : String(row[7] || ''),
          grantedBy : String(row[8] || ''),
          seenAt    : _tsToStr_(row[9])
        });
      }
    }

    safeLog_('결과: ' + awards.length + '개 뱃지 반환');
    awards.sort((a, b) => b.grantedAt.localeCompare(a.grantedAt));
    return { success: true, awards: awards };

  } catch (err) {
    safeLog_('❌ getTeacherAwardsForStudent 오류: ' + err.message);
    return { success: false, awards: [], error: err.message };
  }
}

/**
 * 학생이 교사 수여 뱃지 알림을 확인한 시각을 시트에 저장한다.
 * 브라우저 localStorage가 삭제되거나 다른 기기에서 로그인해도 재알림하지 않기 위한 서버 상태다.
 *
 * @param {string} studentId
 * @param {{grantedAt:string, awardId:string, name:string}[]} awardKeys
 * @returns {{success:boolean, updated:number}}
 */
function markTeacherAwardsSeen(studentId, studentName, awardKeys) {
  try {
    const keys = Array.isArray(awardKeys) ? awardKeys : [];
    const ss = getSpreadsheet_();
    const targetId = normalizeId(studentId);
    const targetName = String(studentName || '').trim();
    if (!targetId || !targetName || !keys.length) {
      return { success: false, updated: 0, error: '학생 정보 또는 뱃지 확인 항목이 없습니다.' };
    }

    const studentsSheet = ss.getSheetByName('students');
    if (!studentsSheet) return { success: false, updated: 0, error: '학생 명단을 찾을 수 없습니다.' };
    const students = studentsSheet.getDataRange().getValues();
    const validStudent = students.slice(1).some(function(row) {
      const rowId = normalizeId(row[4]);
      const rowName = String(row[3] || '').trim();
      return rowName === targetName && (targetId === rowId || targetId === rowId + '_' + rowName);
    });
    if (!validStudent) return { success: false, updated: 0, error: '로그인 학생 정보가 일치하지 않습니다.' };

    const sheet = _getOrCreateAwardSheet_(ss);
    const lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
    const data = sheet.getDataRange().getValues();
    if (data.length <= 1) return { success: true, updated: 0 };

    const totalCols = data[0] ? data[0].length : 0;
    const hdr1 = String(data[0][1] || '').toLowerCase();
    const isNewFormat = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');
    const seenColumn = isNewFormat ? 14 : 10;
    const seenAt = _nowKST_();

    if (!data[0][seenColumn - 1]) {
      sheet.getRange(1, seenColumn).setValue('학생확인일시');
    }

    let updated = 0;
    for (let i = 1; i < data.length; i++) {
      const row = data[i];
      const rowSid = isNewFormat ? normalizeId(row[4]) : normalizeId(row[1]);
      if (rowSid !== targetId) continue;

      const rowAwardId = String((isNewFormat ? row[6] : row[2]) || '');
      const rowName = String((isNewFormat ? row[7] : row[3]) || '');
      const rowGrantedAt = _tsToStr_(row[0]);
      const matched = keys.some(function(key) {
        const keyAwardId = String(key && key.awardId || '');
        const keyName = String(key && key.name || '');
        const keyGrantedAt = String(key && key.grantedAt || '');
        if (keyAwardId && rowAwardId !== keyAwardId) return false;
        if (keyGrantedAt && rowGrantedAt !== keyGrantedAt) return false;
        if (!keyAwardId && keyName && rowName !== keyName) return false;
        return !!(keyAwardId || keyName || keyGrantedAt);
      });

      if (matched && !row[seenColumn - 1]) {
        sheet.getRange(i + 1, seenColumn).setValue(seenAt);
        updated++;
      }
    }

    safeLog_('✅ 학생 뱃지 확인 저장: 학번=' + targetId + ', ' + updated + '건');
    return { success: true, updated: updated };
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    safeLog_('❌ markTeacherAwardsSeen 오류: ' + err.message);
    return { success: false, updated: 0, error: err.message };
  }
}

/**
 * 교사 앱(teacher_v3.html)에서 뱃지 수여 시 호출
 * 단일 또는 일괄 수여 모두 처리
 *
 * @param {Object} params
 *   params.studentIds  {string[]}  수여 대상 학번 배열
 *   params.awards      {Object[]}  수여할 뱃지 배열 (name, image, bg, color)
 *   params.message     {string}    수여 메시지 (공통)
 *   params.grantedBy   {string}    수여 교사명 (선택)
 * @returns {{ success: boolean, count: number }}
 */
function grantTeacherAwards(params) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);

    const studentIds = params.studentIds || [];
    const awards     = params.awards     || [];
    const message    = params.message    || '';
    const grantedBy  = params.grantedBy  || '';
    // ⭐ JS에서 전달된 grantedAt 사용 (없으면 서버 시간 폴백)
    // → localStorage와 시트의 grantedAt이 동일해야 삭제 시 매칭 성공
    const grantedAt  = (params.grantedAt && String(params.grantedAt).length >= 10)
                       ? String(params.grantedAt)
                       : _nowKST_();

    if (!studentIds.length || !awards.length) {
      return { success: false, error: '수여 대상 또는 뱃지가 없습니다.' };
    }

    // students 시트에서 학생 정보 조회 (학번 → 학년/반/번호/이름)
    const studentMap = {};
    try {
      const studSheet = ss.getSheetByName('students');
      if (studSheet) {
        const studData = studSheet.getDataRange().getValues();
        for (let i = 1; i < studData.length; i++) {
          const sid = normalizeId(studData[i][4]); // E열: 학번
          if (sid) {
            studentMap[sid] = {
              grade  : String(studData[i][0] || ''), // A: 학년
              cls    : String(studData[i][1] || ''), // B: 반
              number : String(studData[i][2] || ''), // C: 번호
              name   : String(studData[i][3] || '')  // D: 이름
            };
          }
        }
      }
    } catch (mapErr) {
      safeLog_('⚠️ 학생 정보 조회 실패 (계속 진행): ' + mapErr);
    }

    // 중복 수여 방지: 시트에서 기존 수여 내역 읽기 (학번+뱃지ID 조합)
    const existingSet = new Set();
    try {
      const lastRow = sheet.getLastRow();
      if (lastRow > 1) {
        const existing = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
        existing.forEach(r => {
          const sid = normalizeId(r[4]);
          const aid = String(r[6] || '');
          if (sid && aid) existingSet.add(sid + '|' + aid);
        });
      }
    } catch(e) { safeLog_('⚠️ 중복 체크 조회 실패 (계속 진행): ' + e); }

    const rows = [];
    studentIds.forEach(sid => {
      const normSid = normalizeId(sid);
      const info = studentMap[normSid] || { grade: '', cls: '', number: '', name: '' };
      awards.forEach(a => {
        const awardId = String(a.awardId || '');
        if (existingSet.has(normSid + '|' + awardId)) {
          safeLog_('⏭️ 중복 수여 건너뜀: ' + normSid + ' / ' + awardId);
          return;
        }
        rows.push([
          grantedAt,                       // A: 수여 일시
          String(info.grade),              // B: 학년
          String(info.cls),                // C: 반
          String(info.number),             // D: 번호
          normSid,                         // E: 학번
          String(info.name),               // F: 학생 이름
          awardId,                         // G: 뱃지 ID
          String(a.name     || ''),        // H: 뱃지 이름
          String(a.image    || '🏅'),      // I: 이모지/URL
          String(a.bg       || '#f5f3ff'), // J: 배경색
          String(a.color    || '#7c3aed'), // K: 글자색
          String(message),                 // L: 메시지
          String(grantedBy)                // M: 교사명
        ]);
      });
    });

    // 시트에 일괄 append
    if (rows.length > 0) {
      const lastRow = Math.max(sheet.getLastRow(), 1);
      const range = sheet.getRange(lastRow + 1, 1, rows.length, 13);
      range.setValues(rows);
      // ⭐ A열(수여일시)을 텍스트 형식으로 강제 지정 → Sheets 자동 Date 변환 차단
      sheet.getRange(lastRow + 1, 1, rows.length, 1)
           .setNumberFormat('@STRING@');
    }

    safeLog_('✅ 뱃지 수여 완료: ' + studentIds.length + '명 × ' + awards.length + '개 = ' + rows.length + '행');
    return { success: true, count: rows.length, grantedAt: grantedAt };

  } catch (err) {
    safeLog_('❌ grantTeacherAwards 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 특정 학생의 특정 뱃지 취소 (교사 앱용)
 *
 * @param {string} studentId
 * @param {string} grantedAt   수여 일시 (A열 값, 고유 식별자로 활용)
 * @param {string} awardId     뱃지 ID (C열 값)
 * @returns {{ success: boolean }}
 */
function revokeTeacherAward(studentId, grantedAt, awardId) {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);
    const data  = sheet.getDataRange().getValues();

    const targetSid  = normalizeId(studentId);
    const targetTs   = String(grantedAt || '').substring(0, 16); // "YYYY-MM-DD HH:mm"
    const targetDate = String(grantedAt || '').substring(0, 10); // "YYYY-MM-DD"
    const aidTarget  = String(awardId || '').trim();

    // ⭐ 포맷 감지: 헤더 B열(index1) 값으로 신규/구버전 판단
    // 신규(12+열): B=학년 → E열(index4)=학번, G열(index6)=awardId
    // 구버전(~9열): B=학번 → B열(index1)=학번, C열(index2)=awardId
    const totalCols = data[0] ? data[0].length : 0;
    const hdr1 = String(data[0] ? (data[0][1] || '') : '').toLowerCase();
    const isNewFormat = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');

    safeLog_('revokeTeacherAward: 학번=' + studentId + ', grantedAt=' + grantedAt + ', awardId=' + awardId);
    safeLog_('포맷: ' + (isNewFormat ? '신규(12+열)' : '구버전') + ', 컬럼수=' + totalCols + ', B헤더="' + hdr1 + '"');

    function getRowSid(row) {
      return isNewFormat ? normalizeId(row[4]) : normalizeId(row[1]);
    }
    function getRowAid(row) {
      return isNewFormat ? String(row[6] || '').trim() : String(row[2] || '').trim();
    }

    // ─── 1단계: 학번 + 시간(16자리) + awardId 완전 매칭 ───────────
    for (let i = data.length - 1; i >= 1; i--) {
      const row   = data[i];
      const rowTs = _tsToStr_(row[0]);
      const rowSid = getRowSid(row);
      const rowAid = getRowAid(row);

      if (rowSid !== targetSid) continue;
      if (rowTs.substring(0, 16) !== targetTs) continue;
      if (aidTarget && rowAid !== aidTarget) continue;

      sheet.deleteRow(i + 1);
      safeLog_('✅ 뱃지 취소(완전매칭): 학번=' + studentId + ', ts=' + rowTs + ', aid=' + aidTarget);
      return { success: true };
    }

    // ─── 2단계: 학번 + 날짜(10자리) + awardId 완화 매칭 ─────────
    for (let i = data.length - 1; i >= 1; i--) {
      const row    = data[i];
      const rowTs  = _tsToStr_(row[0]);
      const rowSid = getRowSid(row);
      const rowAid = getRowAid(row);

      if (rowSid !== targetSid) continue;
      if (rowTs.substring(0, 10) !== targetDate) continue;
      if (aidTarget && rowAid !== aidTarget) continue;

      sheet.deleteRow(i + 1);
      safeLog_('✅ 뱃지 취소(날짜+id 매칭): 학번=' + studentId + ', date=' + targetDate);
      return { success: true };
    }

    // ─── 3단계: 학번 + 날짜만 (awardId 무시, 최후 수단) ──────────
    if (aidTarget) {
      for (let i = data.length - 1; i >= 1; i--) {
        const row    = data[i];
        const rowTs  = _tsToStr_(row[0]);
        const rowSid = getRowSid(row);

        if (rowSid !== targetSid) continue;
        if (rowTs.substring(0, 10) !== targetDate) continue;

        sheet.deleteRow(i + 1);
        safeLog_('⚠️ 뱃지 취소(날짜만 매칭): 학번=' + studentId);
        return { success: true };
      }
    }

    safeLog_('❌ revokeTeacherAward 매칭 실패: 학번=' + studentId + ', grantedAt=' + grantedAt + ', awardId=' + awardId + ', isNewFormat=' + isNewFormat + ', totalCols=' + totalCols);
    return { success: false, error: '해당 뱃지 기록을 찾을 수 없습니다.' };

  } catch (err) {
    safeLog_('❌ revokeTeacherAward 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사 앱 초기화용 — teacher_awards 시트 전체를 읽어서
 * { [studentId]: [ award, ... ] } 형태로 반환
 * → 교사 앱 시작 시 GAS 시트 → manualAwards 동기화에 사용
 *
 * @returns {{ success: boolean, byStudent: Object }}
 */
function getAllTeacherAwards() {
  try {
    const ss    = getSpreadsheet_();
    const sheet = _getOrCreateAwardSheet_(ss);
    const data  = sheet.getDataRange().getValues();

    safeLog_('=== getAllTeacherAwards === 행 수: ' + data.length);
    if (data.length <= 1) return { success: true, byStudent: {} };

    const totalCols = data[0] ? data[0].length : 0;
    const hdr1      = String(data[0][1] || '').toLowerCase();
    const isNew     = (totalCols >= 12) && (hdr1 === '학년' || hdr1 === 'grade');
    safeLog_('포맷: ' + (isNew ? '신규' : '구버전') + ', 컬럼수=' + totalCols);

    const byStudent = {};
    for (var i = 1; i < data.length; i++) {
      const row = data[i];
      const sid = isNew ? String(normalizeId(row[4])) : String(normalizeId(row[1]));
      if (!sid || sid === '0') continue; // 학번 없는 행 스킵

      const award = isNew ? {
        grantedAt   : _tsToStr_(row[0]),
        grade       : String(row[1]  || ''),
        classNum    : String(row[2]  || ''),
        number      : String(row[3]  || ''),
        studentId   : sid,
        studentName : String(row[5]  || ''),
        awardId     : String(row[6]  || ''),
        name        : String(row[7]  || ''),
        image       : String(row[8]  || '🏅'),
        bg          : String(row[9]  || '#f5f3ff'),
        color       : String(row[10] || '#7c3aed'),
        message     : String(row[11] || ''),
        grantedBy   : String(row[12] || '')
      } : {
        grantedAt   : _tsToStr_(row[0]),
        studentId   : sid,
        awardId     : String(row[2] || ''),
        name        : String(row[3] || ''),
        image       : String(row[4] || '🏅'),
        bg          : String(row[5] || '#f5f3ff'),
        color       : String(row[6] || '#7c3aed'),
        message     : String(row[7] || ''),
        grantedBy   : String(row[8] || '')
      };

      if (!byStudent[sid]) byStudent[sid] = [];
      byStudent[sid].push(award);
    }

    // 학생별 최신순 정렬
    Object.keys(byStudent).forEach(function(sid) {
      byStudent[sid].sort(function(a, b) { return b.grantedAt.localeCompare(a.grantedAt); });
    });

    safeLog_('getAllTeacherAwards 완료: ' + Object.keys(byStudent).length + '명 데이터 반환');
    return { success: true, byStudent: byStudent };

  } catch (err) {
    safeLog_('❌ getAllTeacherAwards 오류: ' + err.message);
    return { success: false, byStudent: {}, error: err.message };
  }
}

// ── 내부 헬퍼 ──────────────────────────────────────────────────────

/**
 * teacher_awards 시트 반환 (없으면 자동 생성 + 헤더 설정)
 */
function _getOrCreateAwardSheet_(ss) {
  let sheet = ss.getSheetByName('teacher_awards');
  if (!sheet) {
    sheet = ss.insertSheet('teacher_awards');
    // 헤더 행 작성 (신규 14컬럼 구조)
    sheet.getRange(1, 1, 1, 14).setValues([[
      '수여일시', '학년', '반', '번호', '학번', '학생이름',
      'awardId', '뱃지이름', '이미지', '배경색', '글자색',
      '코멘트', '수여교사', '학생확인일시'
    ]]);
    // 헤더 스타일
    const hdr = sheet.getRange(1, 1, 1, 14);
    hdr.setBackground('#7c3aed');
    hdr.setFontColor('#ffffff');
    hdr.setFontWeight('bold');
    sheet.setFrozenRows(1);
    // 열 너비 설정
    sheet.setColumnWidth(1, 140); // 수여일시
    sheet.setColumnWidth(2, 60);  // 학년
    sheet.setColumnWidth(3, 60);  // 반
    sheet.setColumnWidth(4, 60);  // 번호
    sheet.setColumnWidth(5, 90);  // 학번
    sheet.setColumnWidth(6, 100); // 학생이름
    sheet.setColumnWidth(7, 150); // awardId
    sheet.setColumnWidth(8, 100); // 뱃지이름
    sheet.setColumnWidth(9, 60);  // 이미지
    sheet.setColumnWidth(12, 200); // 코멘트
    sheet.setColumnWidth(13, 100); // 수여교사
    sheet.setColumnWidth(14, 140); // 학생확인일시
    safeLog_('✅ teacher_awards 시트 자동 생성 (신규 14컬럼)');
  } else {
    const awardData = sheet.getDataRange().getValues();
    const hdrVals = awardData[0] || [];
    const header1 = String(hdrVals[1] || '').trim().toLowerCase();
    const isCurrentHeader = header1 === '학년' || header1 === 'grade';
    const isLegacyHeader = hdrVals.length <= 10 && ['studentid', 'student_id', '학번'].includes(header1);
    const isEmptyHeader = hdrVals.every(function(value) { return String(value || '').trim() === ''; });
    if (isLegacyHeader) {
      const migrationLock = LockService.getScriptLock();
      migrationLock.waitLock(10000);
      try {
        const latestData = sheet.getDataRange().getValues();
        const latestHeader = latestData[0] || [];
        const latestHeader1 = String(latestHeader[1] || '').trim().toLowerCase();
        if (latestHeader.length <= 10 && ['studentid', 'student_id', '학번'].includes(latestHeader1)) {
          _migrateLegacyAwardSheet_(sheet, latestData);
          safeLog_('✅ teacher_awards 구버전 시트를 14열 형식으로 변환했습니다.');
        }
      } finally {
        migrationLock.releaseLock();
      }
    } else if (isCurrentHeader && !hdrVals[13]) {
      sheet.getRange(1, 14).setValue('학생확인일시');
    } else if (isEmptyHeader) {
      sheet.getRange(1, 1, 1, 14).setValues([[
        '수여일시', '학년', '반', '번호', '학번', '학생이름',
        'awardId', '뱃지이름', '이미지', '배경색', '글자색',
        '코멘트', '수여교사', '학생확인일시'
      ]]);
    } else if (!isCurrentHeader) {
      throw new Error('teacher_awards 시트의 헤더 형식을 확인할 수 없습니다. 기존 데이터를 보호하기 위해 쓰기를 중단합니다.');
    }
  }
  return sheet;
}

/** 구형 9~10열 뱃지 시트를 현재 14열 형식으로 보존 변환한다. */
function _migrateLegacyAwardSheet_(sheet, legacyData) {
  const source = legacyData || [];
  const migrated = [[
    '수여일시', '학년', '반', '번호', '학번', '학생이름',
    'awardId', '뱃지이름', '이미지', '배경색', '글자색',
    '코멘트', '수여교사', '학생확인일시'
  ]];
  for (let i = 1; i < source.length; i++) {
    const row = source[i];
    migrated.push([
      row[0] || '', '', '', '', row[1] || '', '',
      row[2] || '', row[3] || '', row[4] || '🏅',
      row[5] || '#f5f3ff', row[6] || '#7c3aed',
      row[7] || '', row[8] || '', row[9] || ''
    ]);
  }
  sheet.getRange(1, 1, migrated.length, 14).setValues(migrated);
}

/**
 * 현재 KST 시각을 "YYYY-MM-DD HH:mm" 형식으로 반환
 */
function _nowKST_() {
  var now = new Date();
  var kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  function pad(n) { return String(n).padStart(2, '0'); }
  return kst.getUTCFullYear() + '-' + pad(kst.getUTCMonth() + 1) + '-' + pad(kst.getUTCDate())
       + ' ' + pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes());
}

/**
 * Google Sheets 셀 값(Date 객체 or 문자열)을 "YYYY-MM-DD HH:mm" 문자열로 정규화
 * → Sheets가 날짜형 문자열을 자동으로 Date 객체로 변환하는 문제 해결
 */
function _tsToStr_(val) {
  if (!val) return '';
  if (val instanceof Date) {
    // Date 객체 → KST 기준 "YYYY-MM-DD HH:mm"
    var kst = new Date(val.getTime() + 9 * 60 * 60 * 1000);
    function pad(n) { return String(n).padStart(2, '0'); }
    return kst.getUTCFullYear() + '-' + pad(kst.getUTCMonth() + 1) + '-' + pad(kst.getUTCDate())
         + ' ' + pad(kst.getUTCHours()) + ':' + pad(kst.getUTCMinutes());
  }
  // 문자열이면 앞 16자리만 반환
  return String(val).substring(0, 16);
}

// ═══════════════════════════════════════════════════════════════════
// 📊 구글 시트 내보내기 — 학생 모니터링 데이터를 현재 스프레드시트에 새 시트로 저장
// ═══════════════════════════════════════════════════════════════════

/**
 * 교사용 학생 목록 데이터를 현재 스프레드시트에 새 시트로 저장
 *
 * @param {Object} params
 *   params.sheetName   {string}   새 시트 이름 (없으면 자동 생성)
 *   params.rows        {Array[]}  헤더 포함 데이터 배열 (2D)
 * @returns {{ success: boolean, sheetName: string, rowCount: number }}
 */
function exportDataToNewSheet(params) {
  try {
    const ss = getSpreadsheet_();
    const rows = params.rows || [];
    if (rows.length === 0) {
      return { success: false, error: '내보낼 데이터가 없습니다.' };
    }

    // 시트 이름 결정 (중복 시 자동 suffix)
    let baseName = params.sheetName || ('모니터링_' + _nowKST_().substring(0, 10));
    let sheetName = baseName;
    let suffix = 1;
    while (ss.getSheetByName(sheetName)) {
      sheetName = baseName + '_' + suffix;
      suffix++;
    }

    // 새 시트 생성
    const newSheet = ss.insertSheet(sheetName);

    // 데이터 일괄 기록
    const colCount = rows[0].length;
    newSheet.getRange(1, 1, rows.length, colCount).setValues(rows);

    // 헤더 스타일
    const hdr = newSheet.getRange(1, 1, 1, colCount);
    hdr.setBackground('#1e3a5f');
    hdr.setFontColor('#ffffff');
    hdr.setFontWeight('bold');
    newSheet.setFrozenRows(1);

    // 열 너비 자동 조정
    newSheet.autoResizeColumns(1, colCount);

    // 데이터 행 교대 색상
    for (let r = 2; r <= rows.length; r++) {
      if (r % 2 === 0) {
        newSheet.getRange(r, 1, 1, colCount).setBackground('#f8fafc');
      }
    }

    // ⭐ 드롭다운 다중선택 열 적용
    // params.dropdownCols: [ { colIndex: 1기반, values: ['값1','값2',...] }, ... ]
    var dropdownCols = params.dropdownCols || [];
    if (dropdownCols.length > 0 && rows.length > 1) {
      dropdownCols.forEach(function(dc) {
        if (!dc.colIndex || !dc.values || !dc.values.length) return;
        var rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(dc.values, true)
          .setAllowInvalid(true)
          .build();
        // 데이터 행에만 적용 (헤더 제외, 2행부터)
        var dataRange = newSheet.getRange(2, dc.colIndex, rows.length - 1, 1);
        dataRange.setDataValidation(rule);
      });
    }

    safeLog_('✅ exportDataToNewSheet 완료: ' + sheetName + ' (' + (rows.length - 1) + '행)');
    return {
      success   : true,
      sheetName : sheetName,
      rowCount  : rows.length - 1  // 헤더 제외
    };

  } catch (err) {
    safeLog_('❌ exportDataToNewSheet 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// 교사→학생 메시지 기능
// 시트: teacher_messages
// 컬럼: A=타임스탬프, B=학번, C=이름, D=제목, E=내용, F=읽음여부, G=읽은시간
// ──────────────────────────────────────────────────────────────────────────────

/**
 * 교사가 특정 학생에게 메시지 발송
 * data: { studentId, studentName, title, content }
 */


/**
 * 교사용: 발송한 전체 메시지 목록 조회
 */


/**
 * 학생용: 자신에게 온 메시지 조회
 * 시트 열: A타임스탬프 B학번 C이름 D제목 E내용 F읽음여부 G읽은시간 H학생답장 I학생답장시간 J학생답장읽음
 */


/**
 * 학생용: 메시지 읽음 처리
 */
function markTeacherMessageRead(rowIndex, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    const now = new Date();
    const ts = Utilities.formatDate(now, 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss');
    sheet.getRange(targetRow, 6, 1, 2).setValues([['읽음', ts]]);
    return { success: true };
  } catch (err) {
    safeLog_('❌ markTeacherMessageRead 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 발송 메시지 삭제
 */
function deleteTeacherMessage(rowIndex, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    sheet.deleteRow(targetRow);
    return { success: true };
  } catch (err) {
    safeLog_('❌ deleteTeacherMessage 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사 발신 메시지 다중 삭제
 * 행 번호가 큰 것부터 삭제해야 인덱스 밀림 방지
 */
function deleteBulkTeacherMessages(targets) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    if (!Array.isArray(targets) || !targets.length) return messageTargetChanged_();
    const keys = new Set();
    const indices = new Set();
    const resolved = [];
    for (const target of targets) {
      if (!target || keys.has(target.messageKey) || indices.has(target.rowIndex)) return messageTargetChanged_();
      const targetRow = resolveTeacherMessageRow_(sheet, target.rowIndex, target.messageKey);
      if (!targetRow) return messageTargetChanged_();
      keys.add(target.messageKey); indices.add(target.rowIndex); resolved.push(targetRow);
    }
    // Verify the entire selection before the first deletion, then delete bottom-up.
    const sorted = resolved.sort((a, b) => b - a);
    sorted.forEach(r => sheet.deleteRow(r));
    return { success: true, deleted: sorted.length };
  } catch (err) {
    safeLog_('❌ deleteBulkTeacherMessages 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 학생용: 교사 메시지에 답장 저장
 * H열: 학생답장, I열: 학생답장시간, J열: 학생답장읽음
 */
function replyToTeacherMessage(rowIndex, replyContent, expectedKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    if (typeof replyContent !== 'string' || !replyContent.trim()) return { success: false, error: '답장 내용을 입력하세요.' };
    // Persist millisecond precision and advance monotonically under the gateway
    // lock so even identical replies at the same clock instant get a new key.
    const previousTime = sheet.getRange(targetRow, 9).getValue();
    const previousMillis = previousTime instanceof Date ? previousTime.getTime() : 0;
    const ts = new Date(Math.max(Date.now(), previousMillis + 1));
    sheet.getRange(targetRow, 8, 1, 3).setValues([[replyContent, ts, '미확인']]);
    return { success: true };
  } catch (err) {
    safeLog_('❌ replyToTeacherMessage 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 미확인 학생 답장 목록 조회
 */
function getUnreadStudentReplies() {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: true, data: [] };
    const rows = sheet.getDataRange().getValues();
    if (rows.length <= 1) return { success: true, data: [] };
    const result = [];
    for (let i = 1; i < rows.length; i++) {
      const reply = String(rows[i][7] || '');
      const replyRead = String(rows[i][9] || '');
      if (reply && replyRead === '미확인') {
        result.push({
          rowIndex:         i + 1,
          messageKey:       teacherMessageKey_(rows[i]),
          replyKey:         studentReplyKey_(rows[i]),
          timestamp:        rows[i][0] ? (rows[i][0] instanceof Date ? Utilities.formatDate(rows[i][0], 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') : String(rows[i][0])) : '',
          studentId:        String(rows[i][1] || ''),
          studentName:      String(rows[i][2] || ''),
          title:            String(rows[i][3] || ''),
          studentReply:     reply,
          studentReplyTime: rows[i][8] ? (rows[i][8] instanceof Date ? Utilities.formatDate(rows[i][8], 'Asia/Seoul', 'yyyy-MM-dd HH:mm:ss') : String(rows[i][8])) : ''
        });
      }
    }
    return { success: true, data: result };
  } catch (err) {
    safeLog_('❌ getUnreadStudentReplies 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 교사용: 학생 답장 확인 처리
 */
function markStudentReplyRead(rowIndex, expectedKey, expectedReplyKey) {
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getSheetByName('teacher_messages');
    if (!sheet) return { success: false, error: '시트 없음' };
    const targetRow = resolveTeacherMessageRow_(sheet, rowIndex, expectedKey);
    if (!targetRow) return messageTargetChanged_();
    const row = sheet.getRange(targetRow, 1, 1, 13).getValues()[0];
    if (!row[7] || studentReplyKey_(row) !== expectedReplyKey) return messageTargetChanged_();
    sheet.getRange(targetRow, 10).setValue('확인');
    return { success: true };
  } catch (err) {
    safeLog_('❌ markStudentReplyRead 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}

/**
 * 수면 메모 단어를 Gemini AI로 의미별 카테고리로 분류
 * @param {string[]} words - 분류할 단어 배열
 * @returns {{ success: boolean, data?: Object, error?: string }}
 */
function analyzeSleepMemoWords(words) {
  try {
    const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
    if (!apiKey) return { success: false, error: 'API 키가 설정되지 않았습니다.' };
    if (!words || words.length === 0) return { success: false, error: '분류할 단어가 없습니다.' };

    const modelName = 'gemini-2.0-flash';
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    const wordListText = words.join(', ');
    const prompt = `다음은 청소년들이 수면 메모에 적은 단어/표현 목록이야. 의미가 비슷한 것끼리 묶어서 5개 이하의 카테고리로 분류해줘.

단어 목록: ${wordListText}

규칙:
1. 카테고리 이름은 짧고 직관적으로 (예: 피로·졸림, 스트레스, 불안·걱정, 기분 좋음, 신체 증상)
2. 모든 단어는 반드시 하나의 카테고리에 포함
3. 반드시 아래 JSON 형식으로만 답해. 다른 설명 없이 JSON만 출력.
4. 카테고리는 5개 이하로 제한

출력 형식 (JSON만):
{"카테고리명1": ["단어1", "단어2"], "카테고리명2": ["단어3"]}`;

    const payload = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 500,
        candidateCount: 1
      }
    };

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(apiUrl, options);
    const json = JSON.parse(response.getContentText());

    if (!json.candidates || !json.candidates[0]) {
      safeLog_('Gemini 응답: ' + JSON.stringify(json));
      return { success: false, error: 'Gemini 응답을 받지 못했습니다.' };
    }

    const text = json.candidates[0].content.parts[0].text.trim();
    safeLog_('Gemini 단어 분류 응답: ' + text);

    // 마크다운 코드블록 안의 JSON 추출
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { success: false, error: 'JSON 형식 파싱 실패' };

    const categories = JSON.parse(jsonMatch[0]);
    return { success: true, data: categories };

  } catch (err) {
    safeLog_('❌ analyzeSleepMemoWords 오류: ' + err.message);
    return { success: false, error: err.message };
  }
}
