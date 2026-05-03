const toNumber = (value, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
};

export const config = {
  port: toNumber(process.env.PORT, 8000),
  redisUrl: process.env.REDIS_URL || 'redis://127.0.0.1:6379',
  checkboxCount: toNumber(process.env.CHECKBOX_COUNT, 1000),
  jwtSecret: process.env.OIDC_JWT_SECRET || 'dev-only-change-me',
  issuer: process.env.OIDC_ISSUER || 'http://localhost:8000',
  audience: process.env.OIDC_AUDIENCE || 'checkbox-app',
  serverId: process.env.SERVER_ID || `server-${process.pid}`,
  pubSubChannel: 'checkbox:updates',
};
