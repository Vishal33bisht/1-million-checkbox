export function getRequestIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

export function createRateLimiter(redis) {
  async function check({ key, limit, windowSeconds }) {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, windowSeconds);
    }

    return {
      allowed: count <= limit,
      count,
      limit,
      retryAfterSeconds: count > limit ? await redis.ttl(key) : 0,
    };
  }

  function http({ prefix, limit, windowSeconds, identity }) {
    return async (req, res, next) => {
      try {
        const id = identity ? identity(req) : getRequestIp(req);
        const result = await check({
          key: `rl:${prefix}:${id}`,
          limit,
          windowSeconds,
        });

        res.setHeader('X-RateLimit-Limit', String(limit));
        res.setHeader('X-RateLimit-Remaining', String(Math.max(0, limit - result.count)));

        if (!result.allowed) {
          res.setHeader('Retry-After', String(Math.max(1, result.retryAfterSeconds)));
          return res.status(429).json({ error: 'rate_limited', retryAfterSeconds: result.retryAfterSeconds });
        }

        next();
      } catch (error) {
        next(error);
      }
    };
  }

  return { check, http };
}
