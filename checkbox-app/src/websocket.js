import crypto from 'node:crypto';
import WebSocket, { WebSocketServer } from 'ws';
import { config } from './config.js';

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function parseTokenFromRequest(req) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  return url.searchParams.get('token');
}

export function createWebSocketHub({ server, redis, subscriber, checkboxStore, auth, rateLimiter }) {
  const wss = new WebSocketServer({ server, path: '/ws' });
  const connections = new Map();

  function publicConnectionList() {
    return Array.from(connections.values()).map((connection) => ({
      socketId: connection.socketId,
      user: connection.user ? { id: connection.user.id, name: connection.user.name } : null,
    }));
  }

  function broadcastLocal(payload) {
    for (const connection of connections.values()) {
      send(connection.ws, payload);
    }
  }

  async function rememberConnection(connection) {
    await redis.hSet('checkbox:connections', connection.socketId, JSON.stringify({
      userId: connection.user?.id || 'anonymous',
      userName: connection.user?.name || 'Anonymous',
      serverId: config.serverId,
      connectedAt: connection.connectedAt,
    }));
  }

  async function forgetConnection(socketId) {
    await redis.hDel('checkbox:connections', socketId);
  }

  wss.on('connection', async (ws, req) => {
    const socketId = crypto.randomUUID();
    const user = await auth.authenticateBearer(parseTokenFromRequest(req));
    const connection = { ws, socketId, user, connectedAt: Date.now() };
    connections.set(socketId, connection);
    await rememberConnection(connection);

    send(ws, {
      type: 'connected',
      socketId,
      mode: user ? 'interactive' : 'read-only',
      user,
    });
    send(ws, { type: 'initial-state', ...(await checkboxStore.getInitialState()) });
    broadcastLocal({ type: 'presence', count: connections.size, users: publicConnectionList() });

    ws.on('message', async (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return send(ws, { type: 'error', error: 'invalid_json' });
      }

      if (message.type !== 'toggle') {
        return send(ws, { type: 'error', error: 'unknown_message_type' });
      }

      if (!connection.user) {
        return send(ws, { type: 'error', error: 'login_required', message: 'Anonymous users are read-only.' });
      }

      const rateKey = `rl:toggle:${connection.user.id}:${socketId}`;
      const rate = await rateLimiter.check({ key: rateKey, limit: 30, windowSeconds: 10 });
      if (!rate.allowed) {
        return send(ws, { type: 'rate-limited', retryAfterSeconds: rate.retryAfterSeconds });
      }

      const result = await checkboxStore.setCheckbox({
        index: Number(message.index),
        checked: Boolean(message.checked),
        user: connection.user,
        socketId,
      });

      if (!result.ok) {
        send(ws, { type: 'error', error: result.error });
      }
    });

    ws.on('close', async () => {
      connections.delete(socketId);
      await forgetConnection(socketId);
      broadcastLocal({ type: 'presence', count: connections.size, users: publicConnectionList() });
    });
  });

  subscriber.subscribe(config.pubSubChannel, (message) => {
    const update = JSON.parse(message);
    broadcastLocal(update);
  }).catch((error) => console.error('Redis subscribe error:', error.message));

  return { wss, connections };
}

