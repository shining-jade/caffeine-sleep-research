import { readSessionCookie, verifySession } from './session.js';
import { sendJson } from './http.js';

export function createReportHandler({ callGas, now }) {
  return async function reportHandler(req, res) {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    const url = new URL(req.url, 'https://reports.invalid');
    const key = url.searchParams.get('report');
    const role = url.searchParams.get('viewer') === 'teacher' ? 'teacher' : 'student';
    let session;
    try {
      session = verifySession(readSessionCookie(req, role), role, now());
    } catch {
      return sendJson(res, 401, { error: '로그인한 뒤 메시지함에서 PDF를 다시 열어 주세요.' });
    }
    if (!/^[a-f0-9]{64}$/.test(key || '')) return sendJson(res, 404, { error: 'PDF를 찾을 수 없습니다.' });

    try {
      const subject = role === 'student' ? { studentId: session.studentId, name: session.name } : null;
      const action = subject ? 'downloadStudentReportPdf' : 'downloadTeacherReportPdf';
      const params = subject ? [subject.studentId, subject.name, key] : [key];
      const report = await callGas({ role, action, params, subject });
      if (report?.success !== true || typeof report.pdf !== 'string') {
        return sendJson(res, 404, { error: 'PDF를 찾을 수 없습니다.' });
      }
      const bytes = Buffer.from(report.pdf, 'base64');
      if (bytes.length > 3 * 1024 * 1024 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
        return sendJson(res, 502, { error: 'PDF를 읽을 수 없습니다.' });
      }
      const fileName = encodeURIComponent(String(report.fileName || 'health-report.pdf').toWellFormed())
        .replace(/['()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());
      res.statusCode = 200;
      res.setHeader('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Content-Disposition', "inline; filename=\"health-report.pdf\"; filename*=UTF-8''" + fileName);
      res.end(bytes);
    } catch {
      sendJson(res, 502, { error: 'PDF를 열 수 없습니다. 잠시 뒤 다시 시도해 주세요.' });
    }
  };
}

