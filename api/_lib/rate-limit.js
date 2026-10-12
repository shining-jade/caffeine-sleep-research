import { createHash } from 'node:crypto';

const buckets = new Map();

function clientKey(req, scope, identity = '') {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || String(req.socket?.remoteAddress || 'unknown');
  return createHash('sha256').update(JSON.stringify([scope, address, identity])).digest('hex');
}

export function checkLoginRateLimit(req, scope, { max = 10, windowMs = 10 * 60 * 1000, now = Date.now(), identity = '' } = {}) {
  const key = clientKey(req, scope, identity);
  for (const [storedKey, stored] of buckets) if (stored.resetAt <= now) buckets.delete(storedKey);
  while (!buckets.has(key) && buckets.size >= 1000) buckets.delete(buckets.keys().next().value);
  const current = buckets.get(key);
  const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  return {
    allowed: bucket.count <= max,
    retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
  };
}

export function checkStudentLoginRateLimit(req, studentId) {
  // A classroom shares one public IP. Keep the small repeated-account budget
  // separate from the aggregate network budget, which also bounds ID rotation.
  const network = checkLoginRateLimit(req, 'student-login-network', { max: 120 });
  if (!network.allowed) return network;
  return checkLoginRateLimit(req, 'student-login-account', { max: 12, identity: studentId });
}
