import crypto from 'crypto';
import { query } from '../db/pool.js';
import { getRedisClient } from '../services/redis.js';

/**
 * Idempotency Middleware
 * Prevents duplicate state-modifying requests (e.g. network retries or rapid double-clicks).
 */
export function idempotencyMiddleware({ ttlSeconds = 86400 } = {}) {
  return async (req, res, next) => {
    // Only apply to state-modifying methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
      return next();
    }

    const idempotencyKey = req.headers['idempotency-key'] || req.headers['x-idempotency-key'];
    if (!idempotencyKey) {
      return next();
    }

    const userId = req.user?.id || 'anonymous';
    const redis = getRedisClient();
    const redisKey = `idemp:${userId}:${idempotencyKey}`;
    const endpoint = req.originalUrl;
    const bodyStr = JSON.stringify(req.body || {});
    const requestHash = crypto.createHash('sha256').update(bodyStr).digest('hex');

    try {
      // 1. Check Redis first for sub-millisecond replay
      const cached = await redis.get(redisKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed.status === 'PROCESSING') {
          return res.status(409).json({
            type: 'https://convoscale.io/errors/conflict',
            title: 'Conflict',
            status: 409,
            detail: 'A request with this idempotency key is currently being processed.',
          });
        }
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(parsed.status).json(parsed.body);
      }

      // 2. Fallback check DB
      const dbRes = await query(
        `SELECT response_status, response_body FROM idempotency_keys 
         WHERE key = $1 AND user_id = $2 AND expires_at > CURRENT_TIMESTAMP`,
        [idempotencyKey, userId]
      );

      if (dbRes.rows.length > 0 && dbRes.rows[0].response_status) {
        const row = dbRes.rows[0];
        const body = JSON.parse(row.response_body);
        // Populate Redis cache for future fast reads
        await redis.set(redisKey, JSON.stringify({ status: row.response_status, body }), 'EX', ttlSeconds);
        res.setHeader('X-Idempotent-Replay', 'true');
        return res.status(row.response_status).json(body);
      }

      // 3. Mark as in-flight in Redis
      await redis.set(redisKey, JSON.stringify({ status: 'PROCESSING' }), 'EX', 60);

      // 4. Intercept response to store result
      const originalJson = res.json.bind(res);
      res.json = function (data) {
        const statusCode = res.statusCode;

        // Asynchronously persist to cache and DB
        (async () => {
          try {
            const dataStr = JSON.stringify(data);
            await redis.set(redisKey, JSON.stringify({ status: statusCode, body: data }), 'EX', ttlSeconds);

            const expiresAt = new Date(Date.now() + ttlSeconds * 1000);
            await query(
              `INSERT INTO idempotency_keys (key, user_id, endpoint, request_hash, response_status, response_body, expires_at)
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               ON CONFLICT (key) DO UPDATE 
               SET response_status = $5, response_body = $6, expires_at = $7`,
              [idempotencyKey, userId, endpoint, requestHash, statusCode, dataStr, expiresAt]
            );
          } catch (persistErr) {
            console.error('[Idempotency Persist Error]:', persistErr.message);
          }
        })();

        return originalJson(data);
      };

      next();
    } catch (err) {
      console.error('[Idempotency Middleware Error]:', err.message);
      next();
    }
  };
}
