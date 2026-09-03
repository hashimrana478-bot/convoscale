import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import { query } from '../db/pool.js';

export function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

  if (!token) {
    return res.status(401).json({
      type: 'https://convoscale.io/errors/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: 'Authorization token required. Please include Bearer token in the Authorization header.',
    });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    req.user = payload;
    next();
  } catch (err) {
    const isExpired = err.name === 'TokenExpiredError';
    return res.status(401).json({
      type: 'https://convoscale.io/errors/unauthorized',
      title: 'Unauthorized',
      status: 401,
      detail: isExpired ? 'Authentication token has expired. Please log in again.' : 'Invalid or malformed authentication token.',
    });
  }
}

/**
 * Strict Ownership Authorization Guard
 * Prevents unauthorized access or IDOR (Insecure Direct Object Reference).
 */
export function authorizeConversationOwnership(req, res, next) {
  const conversationId = req.params.conversationId || req.params.id;

  if (!conversationId) {
    return res.status(400).json({
      type: 'https://convoscale.io/errors/bad-request',
      title: 'Bad Request',
      status: 400,
      detail: 'Conversation ID parameter is required.',
    });
  }

  query(
    'SELECT id, user_id, title, message_count, version, created_at, updated_at FROM conversations WHERE id = $1',
    [conversationId]
  )
    .then((result) => {
      if (result.rows.length === 0) {
        return res.status(404).json({
          type: 'https://convoscale.io/errors/not-found',
          title: 'Not Found',
          status: 404,
          detail: `Conversation with ID ${conversationId} not found.`,
        });
      }

      const conversation = result.rows[0];
      if (conversation.user_id !== req.user.id) {
        return res.status(403).json({
          type: 'https://convoscale.io/errors/forbidden',
          title: 'Forbidden',
          status: 403,
          detail: 'Access denied. You do not have permission to access or modify this conversation.',
        });
      }

      req.conversation = conversation;
      next();
    })
    .catch((err) => {
      console.error('[Ownership Guard Error]:', err.message);
      next(err);
    });
}
