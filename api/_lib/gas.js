import { getRuntimeConfig } from './env.js';

export const GAS_TIMEOUT_MS = 50_000;

export class GasGatewayError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'GasGatewayError';
    this.status = status;
    this.code = code;
  }
}

let publicDbCache;
let publicDbPending;

export async function callGas(input) {
  const sharedDb = input.action === 'getCaffeineDB' && !input.fetchImpl;
  const key = sharedDb ? getRuntimeConfig().gasApiUrl : null;
  if (sharedDb && publicDbCache?.key === key && publicDbCache.expires > Date.now()) return publicDbCache.value;
  if (sharedDb && publicDbPending?.key === key) return publicDbPending.promise;
  const promise = callGasReadWithRetry(input);
  if (!sharedDb) return promise;
  publicDbPending = { key, promise };
  try {
    const value = await promise;
    if (value?.success === true && Array.isArray(value.data) && value.data.length) {
      publicDbCache = { key, value, expires: Date.now() + 5 * 60 * 1000 };
    }
    return value;
  } finally {
    if (publicDbPending?.promise === promise) publicDbPending = null;
  }
}

async function callGasReadWithRetry(input) {
  const deadline = Date.now() + (input.timeoutMs ?? GAS_TIMEOUT_MS);
  // Only these idempotent snapshots may be executed again for a fresh output URL.
  // Claiming deliveries and recording/sending results must never enter this path.
  const snapshotRead = (input.role === 'teacher' && input.action === 'getTeacherData')
    || (input.role === 'scheduler' && input.action === 'getReminderDispatchSnapshot');
  for (let attempt = 0; ; attempt++) {
    try {
      return await callGasOnce({ ...input, timeoutMs: Math.max(1, snapshotRead && attempt === 0 ? Math.min(25000, deadline - Date.now()) : deadline - Date.now()) });
    } catch (error) {
      const retryable = snapshotRead ? ['GAS_UNAVAILABLE','GAS_TIMEOUT'].includes(error.code) && attempt < 1 : input.action === 'getCaffeineDB' && error.code === 'GAS_UNAVAILABLE' && attempt < 2;
      if (!retryable || Date.now() >= deadline) throw error;
    }
  }
}

async function callGasOnce({
  role,
  action,
  params,
  subject,
  fetchImpl = fetch,
  timeoutMs = GAS_TIMEOUT_MS,
  onDiagnostic = (event) => console.warn('gas_gateway_failure', JSON.stringify(event)),
  onRecovery = (event) => console.info('gas_output_recovered', JSON.stringify(event)),
}) {
  const config = getRuntimeConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const started = Date.now();
  let stage = 'execution';
  let reason = 'network';
  let upstreamStatus = null;
  let redirectKind = null;
  let output302Reread = false;
  let outputReads = 0;

  try {
    let url = config.gasApiUrl;
    let options = {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({
        secret: config.gasSharedSecret,
        role,
        action,
        params,
        subject,
      }),
      signal: controller.signal,
      redirect: 'manual',
    };
    let response;
    let payload;
    for (let redirects = 0; redirects <= 5; redirects++) {
      const outputRead = options.method === 'GET' && new URL(url).hostname === 'script.googleusercontent.com';
      stage = outputRead ? 'output' : 'execution';
      // Reading a generated result can be retried without executing its mutation again.
      for (let attempt = 0; ; attempt++) {
        reason = 'network';
        upstreamStatus = null;
        try {
          if (outputRead) outputReads += 1;
          response = await fetchImpl(url, options);
          upstreamStatus = response.status;
        } catch (error) {
          if (!outputRead || attempt >= 1 || controller.signal.aborted || error?.name === 'AbortError') throw error;
          continue;
        }
        if (outputRead && attempt < 1 && !controller.signal.aborted && (response.status === 302 || response.status === 404 || response.status === 429 || response.status >= 500)) {
          if (response.status === 302) output302Reread = true;
          try { await response.body?.cancel(); } catch { /* Releasing the failed result must not replay the POST. */ }
          continue;
        }
        if (response.ok && ![301, 302, 303, 307, 308].includes(response.status)) {
          reason = 'invalid_json';
          try {
            payload = await response.json();
          } catch (error) {
            if (error?.name === 'AbortError' || controller.signal.aborted) throw error;
            if (error?.name === 'TypeError') {
              reason = 'body_transport';
              if (outputRead && attempt < 1) continue;
            }
            throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
          }
        }
        break;
      }
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      reason = 'invalid_redirect';
      const location = response.headers.get('location');
      redirectKind = !location ? 'missing_location' : redirects === 5 ? 'redirect_limit' : 'invalid_url';
      if (!location || redirects === 5) throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
      const next = new URL(location, url);
      redirectKind = next.protocol !== 'https:' ? 'invalid_scheme'
        : next.hostname === 'accounts.google.com' ? 'google_sign_in' : 'external_host';
      if (next.protocol !== 'https:' || !['script.google.com', 'script.googleusercontent.com'].includes(next.hostname)) {
        throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
      }
      if (next.hostname === 'script.googleusercontent.com') {
        options = { method: 'GET', signal: controller.signal, redirect: 'manual' };
      } else if (options.method !== 'POST') {
        redirectKind = 'execution_from_output';
        throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
      }
      redirectKind = null;
      url = next.href;
    }

    if (!response.ok) {
      reason = 'http_status';
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      reason = 'invalid_payload';
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
    }
    if (payload.success !== true) {
      reason = 'rejected';
      throw new GasGatewayError(502, 'GAS_REJECTED', 'The data service rejected the request.');
    }
    if (!Object.hasOwn(payload, 'data')) {
      reason = 'missing_data';
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
    }
    if (['getCaffeineLogs', 'getSleepLogs'].includes(action) && !Array.isArray(payload.data)) {
      reason = 'invalid_data';
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
    }
    if (output302Reread) {
      try { onRecovery({ role, action, upstreamStatus: 302, outputReads }); }
      catch { /* Recovery diagnostics cannot change a successful result. */ }
    }
    return payload.data;
  } catch (error) {
    const timedOut = error?.name === 'AbortError' || controller.signal.aborted;
    try {
      onDiagnostic({ role, action, stage, reason: timedOut ? 'timeout' : reason, upstreamStatus,
        ...(redirectKind ? { redirectKind } : {}),
        code: error instanceof GasGatewayError ? error.code : timedOut ? 'GAS_TIMEOUT' : 'GAS_UNAVAILABLE',
        elapsedMs: Date.now() - started });
    } catch { /* Diagnostics cannot change the API result. */ }
    if (error instanceof GasGatewayError) throw error;
    if (timedOut) {
      throw new GasGatewayError(504, 'GAS_TIMEOUT', 'The data service timed out.');
    }
    throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
}
