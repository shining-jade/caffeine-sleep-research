import { sendJson } from '../../http.js';
import { requireTeacherSession } from './_shared.js';

// Set once immediately before the approved immutable candidate is built.
// Zero is fail-closed; the deployed file remains present after expiry.
const INSPECTION_EXPIRES_AT = 1792581772;

// Temporary, server-only comparison against the single previously confirmed deployment.
const EXPECTED_GAS_API_URL = 'https://script.google.com/macros/s/AKfycbxtCvuN_ytAs4M769uCuq4kUuXRFFSoyR7QlKuNKQoJjlRnZICVDI-0H4QOTa4NQiC88Q/exec';

export function createRuntimeBindingHandler({ now = () => Math.floor(Date.now() / 1000) } = {}) {
  return async function runtimeBindingHandler(req, res) {
    const nowSeconds = now();
    if (!Number.isSafeInteger(nowSeconds) || !Number.isSafeInteger(INSPECTION_EXPIRES_AT)
        || INSPECTION_EXPIRES_AT <= 0 || nowSeconds >= INSPECTION_EXPIRES_AT) {
      sendJson(res, 404, { success: false, error: 'NOT_FOUND' });
      return;
    }
    if (req.method !== 'GET') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }
    try { requireTeacherSession(req, nowSeconds); } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }
    // Request parameters never supply or alter the single comparison target.
    const gasApiUrl = process.env.GAS_API_URL;
    const deploymentId = process.env.VERCEL_DEPLOYMENT_ID;
    if (typeof gasApiUrl !== 'string' || !gasApiUrl || typeof deploymentId !== 'string' || !deploymentId) {
      sendJson(res, 503, { success: false, error: 'CONFIG_UNAVAILABLE' });
      return;
    }
    sendJson(res, 200, { matchesExpected: gasApiUrl === EXPECTED_GAS_API_URL, deploymentId });
  };
}

export default createRuntimeBindingHandler();
