import { v4 as uuidv4 } from 'uuid';
import pino from 'pino';
import { config } from '../config/env.js';
import { enqueueAuditLog } from '../services/backgroundQueue.js';

export const logger = pino({
  level: process.env.LOG_LEVEL || config.logLevel,
  redact: ['password', 'req.headers.authorization', '*.password', 'token'],
  transport:
    (process.env.LOG_LEVEL || config.logLevel) !== 'silent' && config.nodeEnv !== 'production'
      ? {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:standard' },
        }
      : undefined,
});

export function requestLogger(req, res, next) {
  if (process.env.LOG_LEVEL === 'silent' || config.logLevel === 'silent') {
    return next();
  }

  const requestId = req.headers['x-request-id'] || uuidv4();
  req.requestId = requestId;
  res.setHeader('X-Request-Id', requestId);

  const start = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - start;
    const userId = req.user?.id || null;

    logger.info({
      requestId,
      method: req.method,
      path: req.originalUrl,
      status: res.statusCode,
      durationMs,
      userId,
      ip: req.ip,
    });

    enqueueAuditLog({
      requestId,
      method: req.method,
      path: req.originalUrl,
      statusCode: res.statusCode,
      durationMs,
      userId,
    });
  });

  next();
}
