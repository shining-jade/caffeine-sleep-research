export async function restoreStudentSession({ getSession, onAuthenticated, onUnauthenticated }) {
  try {
    const session = await getSession();
    if (!session?.authenticated || !session.studentId || !session.name) throw new Error('Unauthenticated.');
    await onAuthenticated(session);
    return session;
  } catch {
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

export function shouldDeferStudentBootstrap({ analyzingVisible, cameraHasFile }) {
  return analyzingVisible === true || cameraHasFile === true;
}

if (typeof window !== 'undefined') {
  window.studentStartup = {
    loadStudentBootstrap,
    restoreStudentSession,
    shouldDeferStudentBootstrap,
  };
}
