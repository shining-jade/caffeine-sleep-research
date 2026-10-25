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
