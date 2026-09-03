import express from 'express';
import { dbHealthCheck } from '../db/pool.js';
import { redisHealthCheck } from '../services/redis.js';

const router = express.Router();

router.get('/', async (req, res) => {
  const [dbStatus, redisStatus] = await Promise.all([
    dbHealthCheck(),
    redisHealthCheck(),
  ]);

  const isHealthy = dbStatus.status === 'healthy';

  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    timestamp: new Date().toISOString(),
    uptimeSeconds: Math.floor(process.uptime()),
    components: {
      database: dbStatus,
      redis: redisStatus,
    },
    system: {
      nodeVersion: process.version,
      memoryUsage: process.memoryUsage(),
    },
  });
});

router.get('/ready', async (req, res) => {
  const db = await dbHealthCheck();
  if (db.status === 'healthy') {
    res.status(200).json({ status: 'ready' });
  } else {
    res.status(503).json({ status: 'not_ready', detail: db.error });
  }
});

router.get('/live', (req, res) => {
  res.status(200).json({ status: 'alive' });
});

export default router;
