import crypto from 'node:crypto';
import { config } from './config.js';
import { getRequestIp } from './rateLimiter.js';

const TOKEN_TTL_SECONDS = 60 * 60;

function base64Url(input) {
  return Buffer.from(input).toString('base64url');
}

function signJwt(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const encodedHeader = base64Url(JSON.stringify(header));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64url');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token) {
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expected = crypto
    .createHmac('sha256', config.jwtSecret)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (signatureBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)) {
    return null;
  }

  const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  if (claims.exp && claims.exp < Math.floor(Date.now() / 1000)) return null;
  return claims;
}

function createTokenResponse(user) {
  const now = Math.floor(Date.now() / 1000);
  const accessToken = crypto.randomBytes(32).toString('base64url');
  const idToken = signJwt({
    iss: config.issuer,
    aud: config.audience,
    sub: user.id,
    name: user.name,
    iat: now,
    exp: now + TOKEN_TTL_SECONDS,
  });

  return { accessToken, idToken, expiresIn: TOKEN_TTL_SECONDS };
}

function cleanName(value) {
  return String(value || '').trim().replace(/[^a-zA-Z0-9_. -]/g, '').slice(0, 40);
}

export function createAuth(redis, rateLimiter) {
  async function saveToken(accessToken, user) {
    await redis.set(`auth:token:${accessToken}`, JSON.stringify(user), { EX: TOKEN_TTL_SECONDS });
  }

  async function authenticateBearer(token) {
    if (!token) return null;
    const raw = await redis.get(`auth:token:${token}`);
    return raw ? JSON.parse(raw) : null;
  }

  async function authMiddleware(req, _res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    req.user = await authenticateBearer(token);
    next();
  }

  function routes(app) {
    app.get('/.well-known/openid-configuration', (_req, res) => {
      res.json({
        issuer: config.issuer,
        authorization_endpoint: `${config.issuer}/oauth/authorize`,
        token_endpoint: `${config.issuer}/oauth/token`,
        userinfo_endpoint: `${config.issuer}/oauth/userinfo`,
        response_types_supported: ['code'],
        grant_types_supported: ['password', 'authorization_code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['HS256'],
      });
    });

    app.get('/oauth/authorize', async (req, res) => {
      const username = cleanName(req.query.login_hint || 'demo-user');
      const redirectUri = String(req.query.redirect_uri || '/');
      const state = req.query.state ? `&state=${encodeURIComponent(req.query.state)}` : '';
      const code = crypto.randomBytes(24).toString('base64url');
      const user = { id: `user:${username.toLowerCase()}`, name: username };
      await redis.set(`auth:code:${code}`, JSON.stringify(user), { EX: 120 });
      res.redirect(`${redirectUri}${redirectUri.includes('?') ? '&' : '?'}code=${code}${state}`);
    });

    app.post('/oauth/token', rateLimiter.http({ prefix: 'token', limit: 10, windowSeconds: 60, identity: getRequestIp }), async (req, res) => {
      const grantType = req.body.grant_type || 'password';
      let user;

      if (grantType === 'authorization_code') {
        const code = String(req.body.code || '');
        const raw = await redis.getDel(`auth:code:${code}`);
        if (!raw) return res.status(400).json({ error: 'invalid_grant' });
        user = JSON.parse(raw);
      } else if (grantType === 'password') {
        const username = cleanName(req.body.username);
        if (!username) return res.status(400).json({ error: 'invalid_request', message: 'username is required' });
        user = { id: `user:${username.toLowerCase()}`, name: username };
      } else {
        return res.status(400).json({ error: 'unsupported_grant_type' });
      }

      const tokens = createTokenResponse(user);
      await saveToken(tokens.accessToken, user);
      res.json({
        access_token: tokens.accessToken,
        token_type: 'Bearer',
        expires_in: tokens.expiresIn,
        id_token: tokens.idToken,
      });
    });

    app.get('/oauth/userinfo', authMiddleware, (req, res) => {
      if (!req.user) return res.status(401).json({ error: 'unauthorized' });
      res.json({ sub: req.user.id, name: req.user.name });
    });

    app.post('/oauth/logout', authMiddleware, async (req, res) => {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : null;
      if (token) await redis.del(`auth:token:${token}`);
      res.status(204).send();
    });
  }

  return { routes, authenticateBearer, verifyJwt };
}
