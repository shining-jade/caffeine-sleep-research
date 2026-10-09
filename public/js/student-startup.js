export async function restoreStudentSession({ getSession, onAuthenticated, onUnauthenticated }) {
  try {
    const session = await getSession();
    if (!session?.authenticated || !session.studentId || !session.name) throw new Error('Unauthenticated.');
    await onAuthenticated(session);
    return session;
  } catch (error) {
    if (error?.code === 'STALE_SESSION') return null;
    await onUnauthenticated();
    return null;
  }
}

export async function loadStudentBootstrap({ requestBootstrap, applyBootstrap, fallback }) {
  try {
    const data = await requestBootstrap();
    if (!data || typeof data !== 'object'
        || !Array.isArray(data.caffeineLogs) || !Array.isArray(data.sleepLogs)) {
      throw new Error('Invalid bootstrap response.');
    }
    await applyBootstrap(data);
    return true;
  } catch {
    await fallback();
    return false;
  }
}

if (typeof window !== 'undefined') {
  window.studentStartup = {
    loadStudentBootstrap,
    restoreStudentSession,
  };
}

export function createStudentRecordCache(storage) {
  const key = 'student-record-snapshot-v1';
  const ownerKey = subject => subject && typeof subject.studentId === 'string' && subject.studentId && typeof subject.name === 'string' && subject.name ? JSON.stringify([subject.studentId, subject.name]) : null;
  function clear() { try { storage.removeItem(key); } catch {} }
  function read(subject) {
    const owner = ownerKey(subject);
    if (!owner) return null;
    try {
      const saved = JSON.parse(storage.getItem(key));
      if (!saved || saved.owner !== owner) { clear(); return null; }
      if (!saved.records || typeof saved.records !== 'object') return null;
      return saved.records;
    } catch { return null; }
  }
  function write(subject, kind, logs) {
    const owner = ownerKey(subject);
    if (!owner || !['caffeineLogs', 'sleepLogs'].includes(kind) || !Array.isArray(logs)) return;
    const records = read(subject) || {};
    records[kind] = logs;
    try { storage.setItem(key, JSON.stringify({ owner, records })); } catch {}
  }
  return { read, write, clear };
}

if (typeof window !== 'undefined') {
  try { window.studentRecordCache = createStudentRecordCache(window.sessionStorage); } catch {}
}
