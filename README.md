# 1 Million Checkbox

A realtime checkbox grid built with plain HTML, CSS, JavaScript, Node.js, Express, WebSockets, and Redis.

Users can watch the grid anonymously in read-only mode. After logging in through the app's OAuth/OIDC-style authentication flow, users can toggle checkboxes and every connected browser receives updates in real time.

## Features

- Plain HTML, CSS, and JavaScript frontend
- Express backend
- Native WebSocket server using `ws`
- Redis-backed checkbox state
- Redis Pub/Sub for broadcasting checkbox updates across multiple server instances
- Local OAuth 2.0 / OIDC-style auth endpoints
- Anonymous read-only mode
- Logged-in interactive mode
- Socket ID generation and connected-user tracking
- Custom Redis-backed rate limiting without external rate-limit packages
- Basic spam-click protection for WebSocket toggle events
- Clean project structure

## Project Structure

```text
.
|-- README.md
|-- .gitignore
`-- checkbox-app
    |-- package.json
    |-- pnpm-lock.yaml
    |-- server.js
    |-- public
    |   |-- index.html
    |   |-- style.css
    |   `-- app.js
    `-- src
        |-- auth.js
        |-- checkboxStore.js
        |-- config.js
        |-- rateLimiter.js
        |-- redis.js
        `-- websocket.js
```

## Requirements

- Node.js 18.19 or newer
- pnpm
- Redis running on `127.0.0.1:6379`

## Start Redis With Docker

If you are on Windows, Docker is the easiest way to run Redis locally.

```powershell
docker run -d --name checkbox-redis -p 6379:6379 redis:latest
```

Check Redis:

```powershell
docker exec -it checkbox-redis redis-cli ping
```

Expected output:

```text
PONG
```

Useful commands:

```powershell
docker stop checkbox-redis
docker start checkbox-redis
docker rm -f checkbox-redis
```

## Install And Run

```powershell
cd checkbox-app
pnpm install
pnpm start
```

The server starts on:

```text
http://localhost:8000
```

## Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `8000` | HTTP/WebSocket server port |
| `REDIS_URL` | `redis://127.0.0.1:6379` | Redis connection URL |
| `CHECKBOX_COUNT` | `1000` | Number of checkboxes rendered by the frontend |
| `OIDC_JWT_SECRET` | `dev-only-change-me` | Secret used to sign local ID tokens |
| `OIDC_ISSUER` | `http://localhost:8000` | OIDC issuer URL |
| `OIDC_AUDIENCE` | `checkbox-app` | OIDC token audience |
| `SERVER_ID` | `server-{process.pid}` | Server instance ID for Pub/Sub metadata |

Example:

```powershell
$env:CHECKBOX_COUNT='5000'
$env:OIDC_JWT_SECRET='replace-this-in-real-deployments'
pnpm start
```

## How To Test

1. Open `http://localhost:8000`.
2. Before login, checkboxes should be disabled because anonymous users are read-only.
3. Enter any username and click `Log in`.
4. Checkboxes should become interactive.
5. Open the same URL in a second browser window.
6. Log in there too.
7. Toggle a checkbox in one window.
8. The same checkbox should update in the other window immediately.

## Health Check

```powershell
Invoke-RestMethod http://localhost:8000/health
```

Example response:

```json
{
  "healthy": true,
  "serverId": "server-12345",
  "checkboxCount": 1000,
  "connectedSockets": 2
}
```

## OIDC / OAuth Endpoints

Discovery endpoint:

```text
http://localhost:8000/.well-known/openid-configuration
```

Implemented endpoints:

- `GET /.well-known/openid-configuration`
- `GET /oauth/authorize`
- `POST /oauth/token`
- `GET /oauth/userinfo`
- `POST /oauth/logout`

The app uses a simple local auth server for project/demo purposes. For production, replace this with a real OIDC provider and stronger session/security handling.

## Redis Keys

The app uses Redis for state, Pub/Sub, auth, rate limiting, and socket tracking.

| Key | Purpose |
| --- | --- |
| `checkbox:checked` | Set of checked checkbox indexes |
| `checkbox:connections` | Hash of connected socket IDs and user metadata |
| `checkbox:updates` | Pub/Sub channel for checkbox updates |
| `auth:token:*` | Logged-in access tokens |
| `auth:code:*` | Short-lived authorization codes |
| `rl:*` | Rate limiting counters |

Inspect Redis:

```powershell
docker exec -it checkbox-redis redis-cli
```

Then run:

```redis
SMEMBERS checkbox:checked
HGETALL checkbox:connections
```

## Rate Limiting

Rate limiting is implemented manually in `src/rateLimiter.js` using Redis counters and expiries.

Current limits:

- OAuth token endpoint: 10 requests per minute per IP
- WebSocket checkbox toggles: 30 toggle messages per 10 seconds per user and socket

No external rate-limit package is used.

## Scaling Notes

Each server instance keeps only its own active WebSocket connections in memory. Checkbox state lives in Redis. When a user toggles a checkbox:

1. The WebSocket server validates the user and rate limit.
2. The checkbox state is written to Redis.
3. A compact update message is published to Redis Pub/Sub.
4. Every server instance subscribed to the channel broadcasts that update to its local connected sockets.

This allows multiple Node.js server instances to coordinate through Redis while keeping per-instance WebSocket management simple.
