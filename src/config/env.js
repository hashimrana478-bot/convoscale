import dotenv from 'dotenv';
dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/convoscale',
  dbPoolMin: parseInt(process.env.DB_POOL_MIN || '5', 10),
  dbPoolMax: parseInt(process.env.DB_POOL_MAX || '30', 10),
  dbPoolIdleTimeoutMs: parseInt(process.env.DB_POOL_IDLE_TIMEOUT_MS || '30000', 10),
  dbPoolConnectionTimeoutMs: parseInt(process.env.DB_POOL_CONNECTION_TIMEOUT_MS || '5000', 10),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  useEmbeddedEngines: process.env.USE_EMBEDDED_ENGINES || 'auto',
  jwtSecret: process.env.JWT_SECRET || 'convo-scale-super-secret-jwt-key-32-chars-minimum',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '24h',
  rateLimitWindowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
  rateLimitMaxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '1000', 10),
  logLevel: process.env.LOG_LEVEL || 'info',
};
