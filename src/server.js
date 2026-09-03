import app from './app.js';
import { config } from './config/env.js';
import { getDbPool, initDatabase } from './db/pool.js';
import { seedDatabase } from './db/seed.js';
import { ensureRedisClient } from './services/redis.js';
import { startBackgroundWorker, stopBackgroundWorker } from './services/backgroundQueue.js';
import { logger } from './middleware/requestLogger.js';

let server = null;

async function bootstrap() {
  try {
    logger.info('Initializing ConvoScale High-Performance Chat Backend...');

    // 1. Initialize Database & Schema
    await initDatabase();

    // 2. Seed initial data (bot rules, demo users)
    await seedDatabase();

    // 3. Ensure Redis connection / fallback
    await ensureRedisClient();

    // 4. Start asynchronous background job worker
    startBackgroundWorker();

    // 5. Start HTTP Server
    server = app.listen(config.port, () => {
      logger.info({
        message: `ConvoScale Server listening on port ${config.port}`,
        environment: config.nodeEnv,
        pid: process.pid,
        healthEndpoint: `http://localhost:${config.port}/health`,
        statsEndpoint: `http://localhost:${config.port}/api/v1/system/stats`,
        webUi: `http://localhost:${config.port}`,
      });
      console.log(`\n===============================================================`);
      console.log(`  ConvoScale High-Performance Chat Engine`);
      console.log(`  Target: 10,000 requests per minute (~167 req/s)`);
      console.log(`  Running on: http://localhost:${config.port}`);
      console.log(`  Chat UI:    http://localhost:${config.port}/index.html`);
      console.log(`  Health:     http://localhost:${config.port}/health`);
      console.log(`  System:     http://localhost:${config.port}/api/v1/system/stats`);
      console.log(`===============================================================\n`);
    });
  } catch (error) {
    logger.fatal({ err: error }, 'Failed to start ConvoScale server');
    process.exit(1);
  }
}

// Graceful Shutdown
async function gracefulShutdown(signal) {
  logger.info(`Received ${signal}. Gracefully shutting down ConvoScale...`);

  if (server) {
    server.close(async () => {
      logger.info('Closed active HTTP server.');
      await stopBackgroundWorker();

      try {
        const pool = await getDbPool();
        await pool.end();
        logger.info('Closed database connection pool.');
      } catch (poolErr) {
        // ignore on shutdown
      }

      logger.info('ConvoScale server stopped cleanly.');
      process.exit(0);
    });

    // Force close if graceful timeout is exceeded
    setTimeout(() => {
      logger.error('Could not close connections in time, forcefully shutting down');
      process.exit(1);
    }, 10000);
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

bootstrap();
