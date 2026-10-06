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

export async function callGas({
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
      if (action === 'getCaffeineDB') console.info('CAFFEINE_DB_REDIRECT', { status: response.status, method: options.method, host: next.hostname, path: next.pathname });
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
