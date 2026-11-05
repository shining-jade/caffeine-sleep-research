import { applyTeacherAI as defaultApplyTeacherAI, interpretTeacherGoal as defaultInterpretTeacherGoal } from '../_lib/teacher-openai.js';
import { callGas as defaultCallGas } from '../_lib/gas.js';
import { DEFAULT_MAX_BYTES, readJson, sendJson } from '../_lib/http.js';
import { readSessionCookie, verifySession } from '../_lib/session.js';
import { normalizeTeacherRequest } from '../_lib/teacher-policy.js';

const LEGACY_PDF_MAX_BYTES = 4 * 1024 * 1024;
const LEGACY_PDF_ACTIONS = new Set(['saveTeacherPdfAndSendMessage', 'renderTeacherReportPdf']);
const IMAGE_PDF_ACTION = 'sendPrivateTeacherReport';
// A 3 MiB PDF encodes to 4 MiB. Allow the JSON envelope below the platform's 4.5 MB limit.
const ENCODED_PDF_MAX_LENGTH = 4 * 1024 * 1024;
const IMAGE_PDF_REQUEST_MAX_BYTES = ENCODED_PDF_MAX_LENGTH + 16 * 1024;

export function createActionHandler({
  callGas = defaultCallGas,
  applyTeacherAI = defaultApplyTeacherAI,
  interpretTeacherGoal = defaultInterpretTeacherGoal,
  now = () => Math.floor(Date.now() / 1000),
} = {}) {
  return async function actionHandler(req, res) {
    if (req.method !== 'POST') {
      sendJson(res, 405, { success: false, error: 'METHOD_NOT_ALLOWED' });
      return;
    }

    try {
      verifySession(readSessionCookie(req, "teacher"), 'teacher', now());
    } catch {
      sendJson(res, 401, { success: false, error: 'UNAUTHENTICATED' });
      return;
    }

    let body;
    try {
      body = await readJson(req, {
        maxBytes: IMAGE_PDF_REQUEST_MAX_BYTES,
        maxBytesForBody: (value) => {
          if (value?.action === IMAGE_PDF_ACTION) return IMAGE_PDF_REQUEST_MAX_BYTES;
          if (LEGACY_PDF_ACTIONS.has(value?.action)) return LEGACY_PDF_MAX_BYTES;
          if (['saveTeacherClassGoals', 'analyzeTeacherBatch'].includes(value?.action)) return 1024 * 1024;
          return DEFAULT_MAX_BYTES;
        },
      });
    } catch (error) {
      sendJson(res, error.status || 400, { success: false, error: error.code || 'INVALID_REQUEST' });
      return;
    }

    let normalized;
    try {
      normalized = normalizeTeacherRequest(body?.action, body?.params);
    } catch (error) {
      sendJson(res, error?.code === 'INVALID_INPUT' ? 400 : 403, { success: false, error: error?.code === 'INVALID_INPUT' ? 'INVALID_INPUT' : 'ACTION_NOT_ALLOWED' });
      return;
    }

    if (normalized.action === IMAGE_PDF_ACTION) {
      const report = normalized.params[0];
      if (typeof report?.pdf !== 'string' || !report.pdf || Object.hasOwn(report, 'html')) {
        sendJson(res, 400, { success: false, error: 'INVALID_INPUT' });
        return;
      }
      if (report.pdf.length > ENCODED_PDF_MAX_LENGTH) {
        sendJson(res, 413, { success: false, error: 'PAYLOAD_TOO_LARGE' });
        return;
      }
    }

    try {
      if (normalized.action === 'interpretTeacherGoal') {
        const [sentence] = normalized.params;
        const interpretation = normalized.params.length === 1 ? await interpretTeacherGoal(sentence) : null;
        sendJson(res, 200, { success:true, data:{ success:true, interpretation } });
        return;
      }
      const request = normalized.action === 'analyzeTeacherBatch' ? normalized.params[0] : null;
      const wantsAI = request?.mode === 'ai' && !request.goalComparison;
      const params = wantsAI ? [{ ...request, mode: 'rule' }] : normalized.params;
      let data = await callGas({ role: 'teacher', ...normalized, params });
      if (wantsAI) data = await applyTeacherAI(data);
      sendJson(res, 200, { success: true, data });
    } catch (error) {
      sendJson(res, error?.status || 500, {
        success: false,
        error: typeof error?.code === 'string' ? error.code : 'INTERNAL_ERROR',
      });
    }
  };
}

export default createActionHandler();
