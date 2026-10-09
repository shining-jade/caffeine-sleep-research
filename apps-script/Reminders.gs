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
  if (value instanceof Date) return Utilities.formatDate(value, 'Asia/Seoul', 'yyyy-MM-dd');
  return String(value || '').trim().slice(0, 10);
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
  var recordDateColumn = requireNamedColumn_(recordSheet.headers, type === 'sleep' ? ['취침날짜', '날짜', '수면날짜'] : ['섭취시간', '날짜']);
  var completedMap = {};
  recordSheet.values.forEach(function(row) {
    if (reminderDateValue_(row[recordDateColumn]) === referenceDate) {
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
    return String(row[1]) === referenceDate && String(row[2]) === type && String(row[6]) === 'success';
  }).map(function(row) { return String(row[0]); });

  return {
    config: getReminderConfig_(),
    students: students,
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
      if (!result || !allowedStatuses[result.status] || (result.type !== 'sleep' && result.type !== 'caffeine')) {
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
