function invalidInput() {
  throw Object.assign(new Error('Invalid message input.'), { code:'INVALID_INPUT', status:400 });
}
function requireText(value) {
  if (typeof value !== 'string' || !value.trim()) invalidInput();
}
export function validateMessageInput(action, params) {
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
}
