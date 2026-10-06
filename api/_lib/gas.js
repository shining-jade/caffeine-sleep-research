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
  for (let attempt = 0; ; attempt++) {
    try {
      return await callGasOnce({ ...input, timeoutMs: Math.max(1, deadline - Date.now()) });
    } catch (error) {
      if (input.action !== 'getCaffeineDB' || error.code !== 'GAS_UNAVAILABLE' || attempt >= 2 || Date.now() >= deadline) throw error;
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
}) {
  const config = getRuntimeConfig();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

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
    for (let redirects = 0; redirects <= 5; redirects++) {
      response = await fetchImpl(url, options);
      if (![301, 302, 303, 307, 308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location || redirects === 5) throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
      const next = new URL(location, url);
      if (next.protocol !== 'https:' || !['script.google.com', 'script.googleusercontent.com'].includes(next.hostname)) {
        throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
      }
      if (next.hostname === 'script.googleusercontent.com') {
        options = { method: 'GET', signal: controller.signal, redirect: 'manual' };
      } else if (options.method !== 'POST') {
        throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
      }
      url = next.href;
    }

    if (!response.ok) {
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
    }

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
    }
    if (payload.success !== true) {
      throw new GasGatewayError(502, 'GAS_REJECTED', 'The data service rejected the request.');
    }
    if (action === 'getCaffeineDB' && !Object.hasOwn(payload, 'data')) {
      const upstream = new URL(response.url || config.gasApiUrl);
      console.warn('CAFFEINE_DB_MISSING_DATA', { keys: Object.keys(payload), host: upstream.hostname, path: upstream.pathname });
      throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service returned an invalid response.');
    }
    return payload.data;
  } catch (error) {
    if (error instanceof GasGatewayError) throw error;
    if (error?.name === 'AbortError') {
      throw new GasGatewayError(504, 'GAS_TIMEOUT', 'The data service timed out.');
    }
    throw new GasGatewayError(502, 'GAS_UNAVAILABLE', 'The data service is unavailable.');
  } finally {
    clearTimeout(timeout);
  }
}
