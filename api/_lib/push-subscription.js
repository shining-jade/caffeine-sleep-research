import { createHash } from 'node:crypto';

function invalidSubscription() {
  return new Error('Invalid push subscription.');
}

function boundedString(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

export function subscriptionIdForEndpoint(endpoint) {
  if (!boundedString(endpoint, 2048)) throw invalidSubscription();
  let url;
  try { url = new URL(endpoint); } catch { throw invalidSubscription(); }
  if (url.protocol !== 'https:' || url.username || url.password) throw invalidSubscription();
  return createHash('sha256').update(endpoint, 'utf8').digest('hex');
}

export function normalizePushSubscription(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalidSubscription();
  const endpoint = typeof value.endpoint === 'string' ? value.endpoint.trim() : '';
  subscriptionIdForEndpoint(endpoint);
  const p256dh = value.keys?.p256dh;
  const auth = value.keys?.auth;
  if (!boundedString(p256dh, 512) || !boundedString(auth, 512)) throw invalidSubscription();
  const expirationTime = value.expirationTime ?? null;
  if (expirationTime !== null && (!Number.isFinite(expirationTime) || expirationTime < 0)) {
    throw invalidSubscription();
  }
  return { endpoint, expirationTime, keys: { p256dh, auth } };
}

export function normalizeSubscriptionId(value) {
  const id = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!/^[a-f0-9]{64}$/.test(id)) throw invalidSubscription();
  return id;
}
