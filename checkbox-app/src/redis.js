import { createClient } from 'redis';
import { config } from './config.js';

export async function createRedisClients() {
  const options = {
    url: config.redisUrl,
    socket: {
      reconnectStrategy(retries) {
        return retries > 5 ? new Error('Redis is required. Start Redis or set REDIS_URL.') : 250;
      },
    },
  };
  const client = createClient(options);
  const publisher = client.duplicate();
  const subscriber = client.duplicate();

  for (const redisClient of [client, publisher, subscriber]) {
    redisClient.on('error', (error) => {
      console.error('Redis error:', error.message);
    });
  }

  await Promise.all([client.connect(), publisher.connect(), subscriber.connect()]);
  return { client, publisher, subscriber };
}
