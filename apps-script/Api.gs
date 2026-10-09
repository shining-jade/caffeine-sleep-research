var STUDENT_ACTIONS_ = {
  saveCaffeineData: 'identityPayload', getCaffeineLogs: 'identityFirst',
  deleteCaffeineData: 'caffeineRecord', updateCaffeineData: 'caffeinePayload',
  saveSleepData: 'identityPayload', getSleepLogs: 'identityFirst',
  deleteSleepData: 'sleepRecord', updateSleepData: 'sleepPayload',
  getWeightData: 'identityFirst', saveInitialSetup: 'identityPayload',
  getStats: 'identityFirst', getStudentBootstrap: 'identityFirst', getFilteredStats: 'identityFirst',
  getTeacherAwardsForStudent: 'identityFirst', markTeacherAwardsSeen: 'identityPair',
  submitInquiry: 'identityPayload', getMyInquiries: 'identityFirst',
  getCaffeineDB: 'passthrough', testConnection: 'passthrough',
  generateAIHealthReport: 'identityPair', analyzeDrinkImageWithAI: 'passthrough',
  getTeacherMessages: 'identityFirst', markTeacherMessageRead: 'messageRow',
  replyToTeacherMessage: 'messageRow', getBadgeConfig: 'passthrough',
  getChallengeBadgeConfig: 'passthrough', getSleepSettings: 'passthrough'
  , savePushSubscription: 'pushSubscription', getPushPreferences: 'subscriptionOwned'
  , savePushPreferences: 'subscriptionOwned', deactivatePushSubscription: 'subscriptionOwned'
  , getReminderStudentConfig: 'passthrough'
};

var TEACHER_ACTIONS_ = {
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
  saveInitialSetup: true, markTeacherAwardsSeen: true, submitInquiry: true,
  markTeacherMessageRead: true, replyToTeacherMessage: true
};

var TEACHER_MUTATIONS_ = {
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
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') throw new Error('REQUEST_REJECTED');
    var request = JSON.parse(e.postData.contents);
    var result = handleApiRequest_(request);
    return jsonOutput_({ success: true, data: result });
  } catch (error) {
    Logger.log('API request rejected');
    return jsonOutput_({ success: false, error: 'REQUEST_REJECTED' });
  }
}

function handleApiRequest_(request) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('REQUEST_REJECTED');
  verifyGatewaySecret_(request.secret);
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
    return dispatchStudentAction_(request.action, request.params, requireSubject_(request.subject));
  }
  if (request.role === 'teacher') return dispatchTeacherAction_(request.action, request.params);
  if (request.role === 'scheduler') return dispatchSchedulerAction_(request.action, request.params);
  throw new Error('REQUEST_REJECTED');
}

function dispatchStudentAction_(action, params, subject) {
  var rule = STUDENT_ACTIONS_[action];
  if (!rule) throw new Error('REQUEST_REJECTED');
  var safeParams = params.slice();
  if (rule === 'identityFirst') safeParams[0] = subject.studentId;
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
  if (action === 'saveCaffeineData' || action === 'saveSleepData') safeParams[0].id = Utilities.getUuid();
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
  var result = STUDENT_MUTATIONS_[action] ? withScriptLock_(operation) : operation();
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
