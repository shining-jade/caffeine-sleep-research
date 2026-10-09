import { validateMessageInput } from './message-validation.js';

const ACTION_NAMES = [
  'getTeacherData',
  'updateTeacherHiddenStudents',
  'handleAIReportForTeacher',
  'grantTeacherAwards',
  'revokeTeacherAward',
  'getInquiries',
  'replyToInquiry',
  'deleteInquiry',
  'getUnreadInquiries',
  'markInquiryNotified',
  'exportDataToNewSheet',
  'sendTeacherMessage',
  'saveTeacherPdfAndSendMessage',
  'getSentTeacherMessages',
  'deleteTeacherMessage',
  'deleteBulkTeacherMessages',
  'getUnreadStudentReplies',
  'markStudentReplyRead',
  'saveBadgeConfig',
  'getChallengeBadgeConfig',
  'saveChallengeBadgeConfig',
  'getPendingBadges',
  'savePendingBadgesData',
  'getDismissedBadges',
  'saveDismissedBadgesData',
  'getAwardSettings',
  'saveAwardSettingsData',
  'saveAIReport',
  'getAIReport',
  'saveSleepSettings',
  'getReminderAdminConfig',
  'saveReminderAdminConfig',
  'saveTeacherTestSubscription',
  'deactivateTeacherTestSubscription',
  'getTestStudentReminderStatus',
  'getTestStudentReminderTargets',
  'recordTestStudentReminderResults',
];

export const TEACHER_ACTIONS = new Set(ACTION_NAMES);

export function normalizeTeacherRequest(action, params) {
  if (!TEACHER_ACTIONS.has(action)) throw new Error('Teacher action is not allowed.');
  if (!Array.isArray(params)) throw new Error('Action parameters must be an array.');
  validateMessageInput(action, params);
  return { action, params: [...params], subject: null };
}
