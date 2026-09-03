import Redis from 'ioredis';
import RedisMock from 'ioredis-mock';
import { config } from '../config/env.js';

let redisClient = null;
let isMock = false;
let initPromise = null;

export async function ensureRedisClient() {
  if (redisClient) return redisClient;
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (config.useEmbeddedEngines === 'true') {
      redisClient = new RedisMock();
      isMock = true;
      return redisClient;
    }

    try {
      const client = new Redis(config.redisUrl, {
        maxRetriesPerRequest: 1,
        connectTimeout: 800,
        retryStrategy: () => null,
        lazyConnect: true,
      });

      // Prevent unhandled error event in Node.js
      client.on('error', () => {});

      await client.connect();
      redisClient = client;
      isMock = false;
      return redisClient;
    } catch (err) {
      if (config.useEmbeddedEngines === 'auto') {
        redisClient = new RedisMock();
        isMock = true;
        return redisClient;
      }
      throw err;
    }
  })();

  return initPromise;
}

export function getRedisClient() {
  if (!redisClient) {
    if (config.useEmbeddedEngines === 'auto' || config.useEmbeddedEngines === 'true') {
      redisClient = new RedisMock();
      isMock = true;
    } else {
      redisClient = new Redis(config.redisUrl);
      redisClient.on('error', () => {});
    }
  }
  return redisClient;
}

export function isRedisMock() {
  return isMock;
}

// Cache-aside pattern with automatic fallback
export async function cacheAside(key, ttlSeconds, fetcher) {
  const client = await ensureRedisClient();
  try {
    const cached = await client.get(key);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    console.warn(`[Redis Cache Error for ${key}]:`, err.message);
  }

  // Fetch fresh data from DB
  const freshData = await fetcher();

  if (freshData !== undefined && freshData !== null) {
    try {
      await client.set(key, JSON.stringify(freshData), 'EX', ttlSeconds);
    } catch (err) {
      console.warn(`[Redis Set Error for ${key}]:`, err.message);
    }
  }

  return freshData;
}

export async function invalidateCache(key) {
  const client = await ensureRedisClient();
  try {
    await client.del(key);
  } catch (err) {
    console.warn(`[Redis Delete Error for ${key}]:`, err.message);
  }
}

export async function redisHealthCheck() {
  try {
    const client = await ensureRedisClient();
    const start = Date.now();
    await client.ping();
    const latency = Date.now() - start;
    return {
      status: 'healthy',
      latencyMs: latency,
      isMock,
    };
  } catch (err) {
    return {
      status: 'degraded',
      error: err.message,
      isMock,
    };
  }
}
