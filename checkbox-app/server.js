import http from 'node:http';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './src/config.js';
import { createRedisClients } from './src/redis.js';
import { createRateLimiter } from './src/rateLimiter.js';
import { createAuth } from './src/auth.js';
import { createCheckboxStore } from './src/checkboxStore.js';
import { createWebSocketHub } from './src/websocket.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = express();
  const server = http.createServer(app);
  const redis = await createRedisClients();
  const rateLimiter = createRateLimiter(redis.client);
  const auth = createAuth(redis.client, rateLimiter);
  const checkboxStore = createCheckboxStore(redis.client, redis.publisher);

  app.set('trust proxy', true);
  app.use(express.json({ limit: '20kb' }));
  app.use(express.static(path.join(__dirname, 'public')));

  auth.routes(app);

  app.get('/api/config', (_req, res) => {
    res.json({ checkboxCount: config.checkboxCount, wsPath: '/ws' });
  });

  app.get('/health', async (_req, res) => {
    const connectedSockets = await redis.client.hLen('checkbox:connections');
    res.json({ healthy: true, serverId: config.serverId, checkboxCount: config.checkboxCount, connectedSockets });
  });

  createWebSocketHub({
    server,
    redis: redis.client,
    subscriber: redis.subscriber,
    checkboxStore,
    auth,
    rateLimiter,
  });

  app.use((error, _req, res, _next) => {
    console.error(error);
    res.status(500).json({ error: 'internal_error' });
  });

  server.listen(config.port, () => {
    console.log(`server is listening at ${config.port}`);
    console.log(`Redis: ${config.redisUrl}`);
    console.log(`OIDC issuer: ${config.issuer}`);
  });

  async function shutdown() {
    server.close();
    await Promise.allSettled([
      redis.subscriber.quit(),
      redis.publisher.quit(),
      redis.client.quit(),
    ]);
    process.exit(0);
  }

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
