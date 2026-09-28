import { STUDENT_ACTION_RULES } from './actions.js';

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
    normalizedParams[0] = {
      ...payload,
      studentId: session.studentId,
      name: session.name,
    };
  }

  return { action, params: normalizedParams, subject };
}
