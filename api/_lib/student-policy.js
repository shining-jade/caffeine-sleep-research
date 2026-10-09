import { STUDENT_ACTION_RULES } from './actions.js';
import { validateMessageInput } from './message-validation.js';

function requireStudentSession(session) {
  if (session?.role !== 'student'
      || typeof session.studentId !== 'string' || !session.studentId
      || typeof session.name !== 'string' || !session.name) {
    throw new Error('A valid student session is required.');
  }
}

export function normalizeStudentRequest(action, params, session) {
  requireStudentSession(session);
  const rule = Object.hasOwn(STUDENT_ACTION_RULES, action)
    ? STUDENT_ACTION_RULES[action]
    : null;
  if (!rule) throw new Error('Student action is not allowed.');
  if (!Array.isArray(params)) throw new Error('Action parameters must be an array.');

  const subject = { studentId: session.studentId, name: session.name };
  let normalizedParams = [...params];

  if (rule === 'identityFirst') {
    normalizedParams[0] = session.studentId;
  } else if (rule === 'identityPair') {
    normalizedParams[0] = session.studentId;
    normalizedParams[1] = session.name;
  } else if (rule === 'identityPayload') {
    const payload = params[0];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('The first action parameter must be a payload object.');
    }
    if (payload._sync !== undefined) {
      if (!['saveCaffeineData', 'saveSleepData', 'saveInitialSetup'].includes(action)
          || !payload._sync || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload._sync.mutationId || '')
          || (action === 'saveInitialSetup' && (typeof payload._sync.baseVersion !== 'string' || payload._sync.baseVersion.length > 100))) throw new Error('Invalid sync metadata');
    }
    normalizedParams[0] = {
      ...payload,
      studentId: session.studentId,
      name: session.name,
    };
  } else if (rule === 'pushSubscription') {
    const payload = params[0];
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('The first action parameter must be a payload object.');
    }
    const { role: _role, studentId: _studentId, name: _name, ...subscription } = payload;
    normalizedParams[0] = { ...subscription, role: 'student', studentId: session.studentId };
  }

  validateMessageInput(action, normalizedParams);
  return { action, params: normalizedParams, subject };
}
