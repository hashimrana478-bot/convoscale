import { logger } from './requestLogger.js';

export function notFoundHandler(req, res, next) {
  res.status(404).json({
    type: 'https://convoscale.io/errors/not-found',
    title: 'Resource Not Found',
    status: 404,
    detail: `Route ${req.method} ${req.originalUrl} does not exist on this server.`,
  });
}

export function errorHandler(err, req, res, next) {
  const statusCode = err.status || err.statusCode || 500;
  const requestId = req.requestId || 'unknown';

  logger.error({
    err: {
      message: err.message,
      stack: err.stack,
      code: err.code,
    },
    requestId,
    method: req.method,
    path: req.originalUrl,
  });

  const response = {
    type: err.type || 'https://convoscale.io/errors/internal-server-error',
    title: err.title || (statusCode === 500 ? 'Internal Server Error' : 'Error'),
    status: statusCode,
    detail: statusCode === 500 && process.env.NODE_ENV === 'production' 
      ? 'An unexpected error occurred. Please contact system support.' 
      : err.message,
    requestId,
  };

  if (err.errors) {
    response.errors = err.errors;
  }

  res.status(statusCode).json(response);
}
