var STUDENT_ACTIONS_ = {
  saveCaffeineData: 'identityPayload', getCaffeineLogs: 'identityFirst',
  deleteCaffeineData: 'caffeineRecord', updateCaffeineData: 'caffeinePayload',
  saveSleepData: 'identityPayload', getSleepLogs: 'identityFirst',
  deleteSleepData: 'sleepRecord', updateSleepData: 'sleepPayload',
  getWeightData: 'identityFirst', saveInitialSetup: 'identityPayload',
  getStats: 'identityFirst', getFilteredStats: 'identityFirst',
  getTeacherAwardsForStudent: 'identityFirst', markTeacherAwardsSeen: 'identityPair',
  submitInquiry: 'identityPayload', getMyInquiries: 'identityFirst',
  getCaffeineDB: 'passthrough', testConnection: 'passthrough',
  generateAIHealthReport: 'identityPair', analyzeDrinkImageWithAI: 'passthrough',
  getTeacherMessages: 'identityFirst', markTeacherMessageRead: 'messageRow',
  replyToTeacherMessage: 'messageRow', getBadgeConfig: 'passthrough',
  getChallengeBadgeConfig: 'passthrough', getSleepSettings: 'passthrough'
};

var TEACHER_ACTIONS_ = {
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
  saveSleepSettings: true
};

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
  if (request.role === 'student') {
    return dispatchStudentAction_(request.action, request.params, requireSubject_(request.subject));
  }
  if (request.role === 'teacher') return dispatchTeacherAction_(request.action, request.params);
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
  if (rule === 'caffeineRecord') requireOwnedRecord_('caffeine', safeParams[0], subject);
  if (rule === 'sleepRecord') requireOwnedRecord_('sleep', safeParams[0], subject);
  if (rule === 'caffeinePayload') requireOwnedRecord_('caffeine', safeParams[0].id, subject);
  if (rule === 'sleepPayload') requireOwnedRecord_('sleep', safeParams[0].id, subject);
  if (rule === 'messageRow') requireOwnedRow_('teacher_messages', safeParams[0], subject);
  return invokeAction_(action, safeParams);
}

function dispatchTeacherAction_(action, params) {
  if (!TEACHER_ACTIONS_[action]) throw new Error('REQUEST_REJECTED');
  return invokeAction_(action, params.slice());
}

function invokeAction_(action, params) {
  switch (action) {
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
  }
  throw new Error('REQUEST_REJECTED');
}
