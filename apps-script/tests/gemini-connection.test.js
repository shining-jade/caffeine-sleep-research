import test from 'node:test';
import assert from 'node:assert/strict';
import { loadAppsScript } from './harness.js';

const secret = 'synthetic-private-key-not-for-logging';
async function fixture({ key = secret, status = 200, body, error, authorizationError } = {}) {
  const requests = [], logs = [], requiredScopes = [];
  const loaded = await loadAppsScript({
    files: ['Code.gs'], properties: { GEMINI_API_KEY: key },
    globals: {
      safeLog_: (value) => logs.push(String(value)),
      Logger: { log: (value) => logs.push(String(value)) },
      console: { info: (value) => logs.push(String(value)) },
      ScriptApp: { AuthMode: { FULL: 'FULL' }, requireScopes(mode, scopes) {
        requiredScopes.push({ mode, scopes: [...scopes] });
        if (authorizationError) throw authorizationError;
      } },
      UrlFetchApp: { fetch(url, options) {
        requests.push({ url, options });
        if (error) throw error;
        return { getResponseCode: () => status, getContentText: () => body ?? JSON.stringify({ candidates: [{ content: { parts: [{ text: 'CONNECTION_OK' }] } }] }) };
      } },
    },
  });
  return { ...loaded, requests, logs, requiredScopes };
}

test('connection check sends one neutral request, never reads records or exposes key', async () => {
  const f = await fixture();
  const result = f.context.checkGeminiAPIKey();
  assert.equal(result.success, true);
  assert.equal(result.httpStatus, 200);
  assert.equal(result.code, 'CONNECTION_OK');
  assert.equal(f.requests.length, 1);
  assert.deepEqual(f.requiredScopes, [{ mode: 'FULL', scopes: ['https://www.googleapis.com/auth/script.external_request'] }]);
  assert.deepEqual(f.openedIds, []);
  const { url, options } = f.requests[0];
  assert.equal(url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent');
  assert.equal(options.headers['x-goog-api-key'], secret);
  assert.equal(JSON.parse(options.payload).contents[0].parts[0].text, 'Reply with exactly CONNECTION_OK.');
  assert.equal(JSON.stringify({ result, logs: f.logs, url, payload: options.payload }).includes(secret), false);
});

test('missing Google authorization reaches IDE consent before any API request', async () => {
  const error = new Error('Authorization required');
  const f = await fixture({ authorizationError: error });
  assert.throws(() => f.context.checkGeminiAPIKey(), /Authorization required/);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.logs, []);
});

for (const key of ['', '   ']) test('missing key does not call API: ' + JSON.stringify(key), async () => {
  const f = await fixture({ key });
  assert.equal(f.context.checkGeminiAPIKey().code, 'NO_API_KEY');
  assert.equal(f.requests.length, 0);
});

for (const status of [400, 401, 403, 404, 429, 500]) test('HTTP ' + status + ' is sanitized and never retried', async () => {
  const f = await fixture({ status, body: JSON.stringify({ error: { message: secret } }) });
  const result = f.context.checkGeminiAPIKey();
  assert.equal(result.success, false);
  assert.equal(result.httpStatus, status);
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.stringify({ result, logs: f.logs }).includes(secret), false);
});

for (const body of ['invalid JSON', '{}', JSON.stringify({ candidates: [{ content: { parts: [{ text: 'wrong' }] } }] })]) test('invalid response is not success: ' + body, async () => {
  const f = await fixture({ body });
  assert.equal(f.context.checkGeminiAPIKey().success, false);
});

test('transport exception is sanitized', async () => {
  const f = await fixture({ error: new Error(secret) });
  const result = f.context.checkGeminiAPIKey();
  assert.equal(result.code, 'TRANSPORT_ERROR');
  assert.equal(result.success, false);
  assert.equal(JSON.stringify({ result, logs: f.logs }).includes(secret), false);
});

test('external-request scope mention is identified without logging exception text', async () => {
  const f = await fixture({ error: new Error('You do not have permission to call UrlFetchApp.fetch. Required permissions: https://www.googleapis.com/auth/script.external_request ' + secret) });
  const result = f.context.checkGeminiAPIKey();
  assert.equal(result.errorMentionsExternalRequestScope, true);
  assert.equal(result.urlFetchPermissionDenied, true);
  assert.equal(JSON.stringify({ result, logs: f.logs }).includes(secret), false);
});

for (const [message, code] of [
  ['You do not have permission to call UrlFetchApp.fetch', 'URL_FETCH_PERMISSION_DENIED'],
  ['Invalid argument: Header:' + secret, 'INVALID_REQUEST_HEADER'],
  ['DNS error: googleapis.com', 'DNS_ERROR'],
  ['Service invoked too many times for one day: urlfetch.', 'URL_FETCH_QUOTA_EXCEEDED'],
]) test('transport diagnosis uses fixed codes: ' + code, async () => {
  const f = await fixture({ error: new Error(message) });
  assert.equal(f.context.checkGeminiAPIKey().code, code);
  assert.equal(JSON.stringify(f.logs).includes(secret), false);
});
