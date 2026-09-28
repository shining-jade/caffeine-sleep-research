export function requireEnv(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Missing required server configuration: ${name}`);
  }
  return value;
}

export function getRuntimeConfig() {
  return {
    gasApiUrl: requireEnv('GAS_API_URL'),
    gasSharedSecret: requireEnv('GAS_SHARED_SECRET'),
    sessionSecret: requireEnv('SESSION_SECRET'),
    teacherPasswordSalt: requireEnv('TEACHER_PASSWORD_SALT'),
    teacherPasswordHash: requireEnv('TEACHER_PASSWORD_HASH'),
  };
}
