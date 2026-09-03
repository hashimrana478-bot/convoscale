import express from 'express';
import { query, dbHealthCheck } from '../db/pool.js';
import { redisHealthCheck } from '../services/redis.js';

const router = express.Router();

router.get('/stats', async (req, res, next) => {
  try {
    const [usersCount, convosCount, msgsCount, dbHealth, redisHealth] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM users'),
      query('SELECT COUNT(*) AS total FROM conversations'),
      query('SELECT COUNT(*) AS total FROM messages'),
      dbHealthCheck(),
      redisHealthCheck(),
    ]);

    res.status(200).json({
      success: true,
      timestamp: new Date().toISOString(),
      counts: {
        users: parseInt(usersCount.rows[0]?.total || '0', 10),
        conversations: parseInt(convosCount.rows[0]?.total || '0', 10),
        messages: parseInt(msgsCount.rows[0]?.total || '0', 10),
      },
      database: dbHealth,
      redis: redisHealth,
      process: {
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
        pid: process.pid,
      },
    });
  } catch (err) {
    next(err);
  }
});

router.get('/metrics', async (req, res, next) => {
  try {
    const memory = process.memoryUsage();
    const uptime = process.uptime();

    // Prometheus-compatible text format
    const lines = [
      '# HELP convoscale_uptime_seconds Process uptime in seconds',
      '# TYPE convoscale_uptime_seconds gauge',
      `convoscale_uptime_seconds ${uptime}`,
      '# HELP convoscale_memory_rss_bytes Resident set size in bytes',
      '# TYPE convoscale_memory_rss_bytes gauge',
      `convoscale_memory_rss_bytes ${memory.rss}`,
      '# HELP convoscale_memory_heap_used_bytes Heap used in bytes',
      '# TYPE convoscale_memory_heap_used_bytes gauge',
      `convoscale_memory_heap_used_bytes ${memory.heapUsed}`,
    ];

    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(lines.join('\n') + '\n');
  } catch (err) {
    next(err);
  }
});

export default router;
