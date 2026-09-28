import { getPushRuntimeConfig } from '../../_lib/env.js';
import { callGas as defaultCallGas } from '../../_lib/gas.js';
import { readJson, sendJson } from '../../_lib/http.js';
import { getNextReminderTimes, normalizeReminderConfig } from '../../_lib/reminder-policy.js';
import { normalizeTeacherRequest } from '../../_lib/teacher-policy.js';
import { requireTeacherSession, sendReminderError } from './_shared.js';

function nonnegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
}

function safeCounts(value) {
  const byClass = {};
  for (const classId of ['1', '2', '3', '4']) byClass[classId] = nonnegative(value?.byClass?.[classId]);
  return { students: nonnegative(value?.students), devices: nonnegative(value?.devices), byClass };
}

function safeLastRun(value) {
  return {
    at: typeof value?.at === 'string' ? value.at : '',
    targeted: nonnegative(value?.targeted),
    sent: nonnegative(value?.sent),
    expired: nonnegative(value?.expired),
    failed: nonnegative(value?.failed),
  };
}

function normalizeStoredConfig(value) {
  try {
    return normalizeReminderConfig(value);
  } catch (error) {
    const periods = Array.isArray(value?.classPeriods) ? value.classPeriods : [];
    const isInitialDisabledConfig = value?.enabled !== true && periods.length > 0
      && periods.every((period) => period?.startDate === '' && period?.endDate === '');
    if (!isInitialDisabledConfig) throw error;

    const normalized = normalizeReminderConfig({
      ...value,
      classPeriods: periods.map((period) => ({
        ...period,
        startDate: '2000-01-01',
        endDate: '2000-01-01',
      })),
    });
    return {
      ...normalized,
      classPeriods: normalized.classPeriods.map((period) => ({
        ...period,
        startDate: '',
        endDate: '',
      })),
    };
  }
}

export function createReminderConfigHandler({
  callGas = defaultCallGas,
  getPushConfig = getPushRuntimeConfig,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function reminderConfigHandler(req, res) {
    if (req.method !== 'GET' && req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try { requireTeacherSession(req, now()); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }

    if (req.method === 'POST') {
      let normalized;
      try { normalized = normalizeReminderConfig(await readJson(req)); } catch (error) {
        sendReminderError(res, error, Number.isInteger(error?.status) ? error.status : 400);
        return;
      }
      try {
        const request = normalizeTeacherRequest('saveReminderAdminConfig', [normalized]);
        const data = await callGas({ role: 'teacher', ...request });
        sendJson(res, 200, { success: true, config: normalizeReminderConfig(data) });
      } catch (error) {
        sendReminderError(res, error);
      }
      return;
    }

    try {
      const request = normalizeTeacherRequest('getReminderAdminConfig', []);
      const data = await callGas({ role: 'teacher', ...request });
      const normalized = normalizeStoredConfig(data?.config);
      sendJson(res, 200, {
        success: true,
        publicKey: getPushConfig().publicKey,
        config: normalized,
        subscriberCounts: safeCounts(data?.subscriberCounts),
        lastRun: safeLastRun(data?.lastRun),
        nextRuns: getNextReminderTimes({ config: normalized, nowMs: now() * 1000 }),
      });
    } catch (error) {
      sendReminderError(res, error);
    }
  };
}

export default createReminderConfigHandler();
