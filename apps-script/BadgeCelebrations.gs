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
