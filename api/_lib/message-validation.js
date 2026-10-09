function invalidInput() {
  throw Object.assign(new Error('Invalid message input.'), { code:'INVALID_INPUT', status:400 });
}
function requireText(value) {
  if (typeof value !== 'string' || !value.trim()) invalidInput();
}
function requireTarget(rowIndex, key) {
  if (!Number.isInteger(rowIndex) || rowIndex < 2 || typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) invalidInput();
}
export function validateMessageInput(action, params) {
  if (action === 'markInquiryRepliesSeen') {
    const keys = params[2];
    if (!Array.isArray(keys) || !keys.length || keys.length > 100
        || keys.some(key => typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) invalidInput();
  }
  if (action === 'submitInquiry' || action === 'sendTeacherMessage') {
    const payload = params[0];
    requireText(payload?.title);
    requireText(payload?.content);
    if (action === 'sendTeacherMessage') {
      requireText(payload?.studentId);
      requireText(payload?.studentName);
    }
  } else if (action === 'replyToTeacherMessage' || action === 'replyToInquiry') {
    if (!Number.isInteger(params[0]) || params[0] < 2) invalidInput();
    requireText(params[1]);
  }
  if (['replyToInquiry','deleteInquiry','markInquiryNotified'].includes(action)) {
    requireTarget(params[0], params[action === 'replyToInquiry' ? 2 : 1]);
  }
  if (['replyToTeacherMessage','markTeacherMessageRead','deleteTeacherMessage','markStudentReplyRead'].includes(action)) {
    requireTarget(params[0], params[action === 'replyToTeacherMessage' ? 2 : 1]);
    if (action === 'markStudentReplyRead') requireTarget(params[0], params[2]);
  }
  if (action === 'deleteBulkTeacherMessages') {
    const targets = params[0];
    if (!Array.isArray(targets) || !targets.length) invalidInput();
    const keys = new Set(), rows = new Set();
    for (const target of targets) {
      requireTarget(target?.rowIndex, target?.messageKey);
      if (keys.has(target.messageKey) || rows.has(target.rowIndex)) invalidInput();
      keys.add(target.messageKey); rows.add(target.rowIndex);
    }
  }
}
