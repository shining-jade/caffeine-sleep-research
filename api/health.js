import { callGas as defaultCallGas } from './_lib/gas.js';
import { sendJson } from './_lib/http.js';

export function createHealthHandler({ callGas = defaultCallGas } = {}) {
  return async function healthHandler(req, res) {
    if (req.method !== 'GET') {
      sendJson(res, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try {
      await callGas({ role: 'health', action: 'testConnection', params: [], subject: null });
      sendJson(res, 200, { ok: true, service: 'caffeine-sleep' });
    } catch (_error) {
      sendJson(res, 503, { ok: false, error: 'SERVICE_UNAVAILABLE' });
    }
  };
}

export default createHealthHandler();
