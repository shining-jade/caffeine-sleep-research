import { createHash } from 'node:crypto';

const buckets = new Map();

function clientKey(req, scope) {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || String(req.socket?.remoteAddress || 'unknown');
  return createHash('sha256').update(`${scope}:${address}`).digest('hex');
}

export function checkLoginRateLimit(req, scope, { max = 10, windowMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const key = clientKey(req, scope);
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 1000) {
    for (const [storedKey, stored] of buckets) if (stored.resetAt <= now) buckets.delete(storedKey);
  }
  return {
    allowed: bucket.count <= max,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}
